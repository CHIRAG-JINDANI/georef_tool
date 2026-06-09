"""
change_detection_api.py

Separate FastAPI router for the Change Detection pipeline.
Mount this in main.py with:

    from change_detection_api import router as cd_router
    app.include_router(cd_router)
"""

import base64
import io
import json
import random
import time

import cv2
import numpy as np
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse
from skimage.metrics import structural_similarity

router = APIRouter()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _encode_webp(img: np.ndarray, quality: int = 70) -> str:
    """Encode a BGR or BGRA image as a base64 webp data-URI."""
    _, enc = cv2.imencode(".webp", img, [cv2.IMWRITE_WEBP_QUALITY, quality])
    return f"data:image/webp;base64,{base64.b64encode(enc.tobytes()).decode()}"


def _encode_jpg(img: np.ndarray, quality: int = 85) -> str:
    """Encode a BGR image as a base64 JPEG data-URI (for downloadable results)."""
    _, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return f"data:image/jpeg;base64,{base64.b64encode(enc.tobytes()).decode()}"


def _resize_for_preview(img: np.ndarray, max_dim: int = 900) -> np.ndarray:
    h, w = img.shape[:2]
    if max(h, w) <= max_dim:
        return img
    scale = max_dim / max(h, w)
    return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


# ─── Core pipeline ─────────────────────────────────────────────────────────────

def run_change_detection(img1_raw: bytes, img2_raw: bytes):
    """
    Generator — yields JSON-line dicts matching the frontend protocol:
        {"type": "log",      "msg": str}
        {"type": "step_img", "step": int, "img": data_uri}
        {"type": "result",   "data": {...}}
        {"type": "error",    "msg": str}

    Steps:
      1 — raw pair side-by-side
      2 — ORB keypoint visualisation + aligned pair
      3 — SSIM difference map
      4 — thresholded + morphologically cleaned mask
      5 — annotated output pair (final result)
    """

    # ── Decode ────────────────────────────────────────────────────────────────
    arr1 = np.frombuffer(img1_raw, np.uint8)
    arr2 = np.frombuffer(img2_raw, np.uint8)
    i1 = cv2.imdecode(arr1, cv2.IMREAD_COLOR)
    i2 = cv2.imdecode(arr2, cv2.IMREAD_COLOR)

    if i1 is None or i2 is None:
        yield {"type": "error", "msg": "failed to decode one or both images"}
        return

    # ── Step 1: raw pair ──────────────────────────────────────────────────────
    yield {"type": "log", "msg": "step 1 — raw image pair ingested"}

    h1, w1 = i1.shape[:2]
    h2, w2 = i2.shape[:2]

    # Side-by-side preview (match heights)
    if h1 != h2:
        scale = h1 / h2
        i2_disp = cv2.resize(i2, (int(w2 * scale), h1))
    else:
        i2_disp = i2.copy()

    p1_raw, p2_raw = _resize_for_preview(i1), _resize_for_preview(i2_disp)
    if p1_raw.shape[0] != p2_raw.shape[0]:
        p2_raw = cv2.resize(p2_raw, (p2_raw.shape[1], p1_raw.shape[0]))
    raw_pair = np.hstack((p1_raw, p2_raw))
    yield {"type": "step_img", "step": 1, "img": _encode_webp(raw_pair)}

    # ── Step 2: ORB alignment ─────────────────────────────────────────────────
    yield {"type": "log", "msg": "step 2 — orb feature extraction + homography alignment"}

    g1 = cv2.cvtColor(i1, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(i2, cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(nfeatures=5000)
    kp1, des1 = orb.detectAndCompute(g1, None)
    kp2, des2 = orb.detectAndCompute(g2, None)

    if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
        yield {"type": "error", "msg": "insufficient features for alignment — try images with more texture"}
        return

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(bf.match(des1, des2), key=lambda x: x.distance)

    if len(matches) < 4:
        yield {"type": "error", "msg": "too few matches between images"}
        return

    # Draw top-50 matches for step visualisation
    top_matches = matches[:min(50, len(matches))]
    kp_vis = cv2.drawMatches(
        i1, kp1, i2, kp2, top_matches, None,
        flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS
    )
    yield {"type": "step_img", "step": 2, "img": _encode_webp(_resize_for_preview(kp_vis))}

    # Compute homography (warp i2 → i1 coordinate space)
    p1 = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
    p2 = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
    mat, _ = cv2.findHomography(p2, p1, cv2.RANSAC, 5.0)

    if mat is None:
        yield {"type": "error", "msg": "homography estimation failed"}
        return

    i2_aligned = cv2.warpPerspective(i2, mat, (w1, h1))
    yield {"type": "log", "msg": f"alignment complete — {len(matches)} feature matches, homography estimated"}

    # ── Step 3: SSIM difference ───────────────────────────────────────────────
    yield {"type": "log", "msg": "step 3 — computing ssim structural difference map"}

    g1_blur = cv2.GaussianBlur(g1, (11, 11), 0)
    g2_aligned = cv2.cvtColor(i2_aligned, cv2.COLOR_BGR2GRAY)
    g2_blur = cv2.GaussianBlur(g2_aligned, (11, 11), 0)

    _, diff = structural_similarity(g1_blur, g2_blur, full=True)
    diff_u8 = (diff * 255).astype(np.uint8)

    # Colourised diff for visualisation (blue = no change, red = change)
    diff_coloured = cv2.applyColorMap(255 - diff_u8, cv2.COLORMAP_JET)
    yield {"type": "step_img", "step": 3, "img": _encode_webp(_resize_for_preview(diff_coloured))}

    # ── Step 4: threshold + morphological cleaning ────────────────────────────
    yield {"type": "log", "msg": "step 4 — otsu threshold + morphological open/close"}

    _, th = cv2.threshold(diff_u8, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)

    kernel = np.ones((7, 7), np.uint8)
    cleaned = cv2.morphologyEx(th, cv2.MORPH_OPEN,  kernel, iterations=4)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel, iterations=3)

    # Visualise the cleaned mask
    mask_coloured = cv2.cvtColor(cleaned, cv2.COLOR_GRAY2BGR)
    yield {"type": "step_img", "step": 4, "img": _encode_webp(_resize_for_preview(mask_coloured))}

    # ── Step 5: annotate + final outputs ─────────────────────────────────────
    yield {"type": "log", "msg": "step 5 — detecting contours + drawing change polygons"}

    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    o1 = i1.copy()
    o2 = i2_aligned.copy()

    valid_contours = []
    total_area = 0.0
    for cnt in contours:
        area = cv2.contourArea(cnt)
        _, _, cw, ch = cv2.boundingRect(cnt)
        if area > 500 and cw > 10 and ch > 10:
            valid_contours.append(cnt)
            total_area += area

    rng = random.Random(42)   # deterministic colours per run
    for cnt in valid_contours:
        colour = (rng.randint(50, 255), rng.randint(50, 255), rng.randint(50, 255))
        cv2.polylines(o1, [cnt], True, colour, 3, cv2.LINE_AA)
        cv2.polylines(o2, [cnt], True, colour, 3, cv2.LINE_AA)

    yield {"type": "log", "msg": f"found {len(valid_contours)} change regions (area > 500 px²)"}

    # Side-by-side annotated pair for step 5 preview
    p1_out, p2_out = _resize_for_preview(o1, 700), _resize_for_preview(o2, 700)
    if p1_out.shape[0] != p2_out.shape[0]:
        p2_out = cv2.resize(p2_out, (p2_out.shape[1], p1_out.shape[0]))
    side_by_side = np.hstack((p1_out, p2_out))
    yield {"type": "step_img", "step": 5, "img": _encode_webp(side_by_side)}

    # Full-resolution downloadable outputs
    result_img1_uri = _encode_jpg(o1, quality=90)
    result_img2_uri = _encode_jpg(o2, quality=90)

    yield {
        "type": "result",
        "data": {
            "image1Url": result_img1_uri,
            "image2Url": result_img2_uri,
            "changeCount": len(valid_contours),
            "totalChangedArea": float(total_area),
            "alignmentScore": round(min(1.0, len(matches) / 300.0), 4),
        },
    }


# ─── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/change-detection")
async def change_detection(
    image1: UploadFile = File(...),
    image2: UploadFile = File(...),
):
    img1_bytes = await image1.read()
    img2_bytes = await image2.read()

    async def event_generator():
        try:
            for item in run_change_detection(img1_bytes, img2_bytes):
                yield json.dumps(item) + "\n"
        except Exception as exc:
            yield json.dumps({"type": "error", "msg": str(exc).lower()}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")