from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import numpy as np
import cv2
import math
import io
import base64
import httpx
import rasterio
from rasterio.transform import from_bounds
from rasterio.crs import CRS
import json
import asyncio

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "https://georef-tool.vercel.app/"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_mpp(lat, zoom):
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** zoom)

def get_bounds(lat, lng, zoom, w, h):
    mpp = get_mpp(lat, zoom)
    hw = (w / 2) * mpp
    hh = (h / 2) * mpp
    dlat = hh / 111320
    dlng = hw / (111320 * math.cos(math.radians(lat)))
    return lat + dlat, lat - dlat, lng + dlng, lng - dlng

def prep_img(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_eq = clahe.apply(l)
    enh = cv2.cvtColor(cv2.merge([l_eq, a, b]), cv2.COLOR_LAB2BGR)
    return cv2.bilateralFilter(enh, 9, 75, 75)

def get_kps(img, shi, slo, r=4, c=4, mkp=15):
    h, w = img.shape[:2]
    dh, dw = h // r, w // c
    kps = []
    for i in range(r):
        for j in range(c):
            y1 = i * dh
            y2 = h if i == r - 1 else (i + 1) * dh
            x1 = j * dw
            x2 = w if j == c - 1 else (j + 1) * dw
            roi = img[y1:y2, x1:x2]
            k = shi.detect(roi, None)
            if len(k) < mkp:
                k = slo.detect(roi, None)
            for pt in k:
                pt.pt = (pt.pt[0] + x1, pt.pt[1] + y1)
                kps.append(pt)
    return kps

def make_preview(img, max_dim=800):
    h, w = img.shape[:2]
    if w > max_dim or h > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    _, enc = cv2.imencode('.webp', img, [cv2.IMWRITE_WEBP_QUALITY, 60])
    return f"data:image/webp;base64,{base64.b64encode(enc.tobytes()).decode()}"

def get_matrix(proxy, ref, img_type):
    proxy_pp = prep_img(proxy)
    ref_pp = prep_img(ref)

    if img_type == "blurry":
        proxy_pp = cv2.GaussianBlur(proxy_pp, (15, 15), 0)
    elif img_type == "medium":
        proxy_pp = cv2.GaussianBlur(proxy_pp, (7, 7), 0)

    shi = cv2.SIFT_create(contrastThreshold=0.04)
    slo = cv2.SIFT_create(contrastThreshold=0.01)

    kp_p = get_kps(proxy_pp, shi, slo)
    kp_p, des_p = shi.compute(proxy_pp, kp_p)
    kp_r = get_kps(ref_pp, shi, slo)
    kp_r, des_r = shi.compute(ref_pp, kp_r)

    if des_p is None or des_r is None:
        raise ValueError("sift failed")

    idx_params = dict(algorithm=1, trees=5)
    sch_params = dict(checks=50)
    flann = cv2.FlannBasedMatcher(idx_params, sch_params)
    matches = flann.knnMatch(des_r, des_p, k=2)
    good = [m for m, n in matches if m.distance < 0.80 * n.distance]

    if len(good) < 4:
        raise ValueError("too few matches")

    src = np.float32([kp_r[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_p[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    mat, mask = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=20.0)

    if mat is None:
        raise ValueError("affine failed")

    mask_list = mask.ravel().tolist()
    inliers = [good[i] for i in range(len(good)) if mask_list[i] == 1]
    score = min(1.0, len(inliers) / 30.0)

    # --- NEW: CALCULATE RMSE DATA FOR FRONTEND GCP TABLE ---
    gcp_list = []
    inlier_idx = 0
    for i in range(len(good)):
        if mask_list[i] == 1:
            match = good[i]
            src_pt = kp_r[match.queryIdx].pt
            dst_pt = kp_p[match.trainIdx].pt
            
            # Where the matrix actually places the source point
            pred_pt = mat[:, :2] @ np.array(src_pt) + mat[:, 2]
            
            dx = pred_pt[0] - dst_pt[0]
            dy = pred_pt[1] - dst_pt[1]
            residual = float(np.sqrt(dx**2 + dy**2))
            
            gcp_list.append({
                "id": inlier_idx,
                "src": [float(src_pt[0]), float(src_pt[1])],
                "dst": [float(dst_pt[0]), float(dst_pt[1])],
                "pred": [float(pred_pt[0]), float(pred_pt[1])],
                "dx": float(dx),
                "dy": float(dy),
                "residual": residual
            })
            inlier_idx += 1

    h1, w1 = ref_pp.shape[:2]
    h2, w2 = proxy_pp.shape[:2]

    ref_kp = cv2.drawKeypoints(ref_pp, kp_r, None, color=(0,255,0), flags=0)
    prx_kp = cv2.drawKeypoints(proxy_pp, kp_p, None, color=(0,255,0), flags=0)
    if h1 != h2:
        prx_kp_res = cv2.resize(prx_kp, (int(w2 * h1 / h2), h1))
        v2 = np.hstack((ref_kp, prx_kp_res))
    else:
        v2 = np.hstack((ref_kp, prx_kp))

    out1 = ref_pp.copy()
    out2 = proxy_pp.copy()
    num_inliers = len(inliers)
    for i in range(num_inliers):
        match = inliers[i]
        pt1 = tuple(np.round(kp_r[match.queryIdx].pt).astype(int))
        pt2 = tuple(np.round(kp_p[match.trainIdx].pt).astype(int))
        hue = int(180 * i / num_inliers) if num_inliers > 0 else 0
        hsv = np.uint8([[[hue, 255, 255]]])
        bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)[0][0]
        color = (int(bgr[0]), int(bgr[1]), int(bgr[2]))
        cv2.circle(out1, pt1, 6, color, -1)
        cv2.circle(out2, pt2, 6, color, -1)

    if h1 != h2:
        out2_res = cv2.resize(out2, (int(w2 * h1 / h2), h1))
        v3 = np.hstack((out1, out2_res))
    else:
        v3 = np.hstack((out1, out2))

    return mat, inliers, score, v2, v3, gcp_list

def make_tiff(img, n, s, e, w_coord):
    h, w = img.shape[:2]
    trans = from_bounds(w_coord, s, e, n, w, h)
    c = CRS.from_epsg(4326)
    buf = io.BytesIO()
    with rasterio.open(buf, 'w', driver='GTiff', height=h, width=w, count=4, dtype=img.dtype, crs=c, transform=trans) as dst:
        dst.write(img[:, :, 2], 1)
        dst.write(img[:, :, 1], 2)
        dst.write(img[:, :, 0], 3)
        dst.write(img[:, :, 3], 4)
    return buf.getvalue()

@app.post("/process")
async def process(
    reference_image: UploadFile = File(...),
    proxy_url: str = Form(...),
    center_lat: float = Form(...),
    center_lng: float = Form(...),
    zoom: float = Form(...),
    map_width: int = Form(640),
    map_height: int = Form(640),
    image_type: str = Form(...),
    flip_h: str = Form("false"),
    flip_v: str = Form("false")
):
    if image_type not in ("sharp", "medium", "blurry"):
        raise HTTPException(status_code=400, detail="invalid type")

    async def event_generator():
        try:
            yield json.dumps({"type": "log", "msg": "preprocessing images"}) + "\n"

            ref_b = await reference_image.read()
            ref_a = np.frombuffer(ref_b, np.uint8)
            ref_img = cv2.imdecode(ref_a, cv2.IMREAD_COLOR)

            if ref_img is None:
                raise ValueError("decode failed")

            if flip_h.lower() == "true":
                ref_img = cv2.flip(ref_img, 1)
                yield json.dumps({"type": "log", "msg": "applied horizontal image flip"}) + "\n"
            if flip_v.lower() == "true":
                ref_img = cv2.flip(ref_img, 0)
                yield json.dumps({"type": "log", "msg": "applied vertical image flip"}) + "\n"

            proxy_b = None
            async with httpx.AsyncClient(timeout=15) as client:
                for i in range(3):
                    resp = await client.get(proxy_url)
                    if resp.status_code == 200:
                        proxy_b = resp.content
                        break
                    if i < 2:
                        await asyncio.sleep(2 ** i)

            if not proxy_b:
                raise ValueError("fetch failed")

            proxy_a = np.frombuffer(proxy_b, np.uint8)
            proxy_img = cv2.imdecode(proxy_a, cv2.IMREAD_COLOR)

            if proxy_img is None:
                raise ValueError("decode failed")

            h1, w1 = ref_img.shape[:2]
            h2, w2 = proxy_img.shape[:2]
            if h1 != h2:
                prx_res = cv2.resize(proxy_img, (int(w2 * h1 / h2), h1))
                v1 = np.hstack((ref_img, prx_res))
            else:
                v1 = np.hstack((ref_img, proxy_img))
            
            yield json.dumps({"type": "step_img", "step": 1, "img": make_preview(v1)}) + "\n"

            yield json.dumps({"type": "log", "msg": "computing features"}) + "\n"
            mat, inls, score, v2, v3, gcp_list = get_matrix(proxy_img, ref_img, image_type)
            yield json.dumps({"type": "step_img", "step": 2, "img": make_preview(v2)}) + "\n"

            yield json.dumps({"type": "log", "msg": "ransac consensus"}) + "\n"
            yield json.dumps({"type": "step_img", "step": 3, "img": make_preview(v3)}) + "\n"

            yield json.dumps({"type": "log", "msg": "warping alpha map"}) + "\n"
            n, s, e, w_coord = get_bounds(center_lat, center_lng, zoom, map_width, map_height)

            hr, wr = ref_img.shape[:2]
            corn = np.float32([[0, 0], [wr, 0], [wr, hr], [0, hr]]).reshape(-1, 1, 2)
            w_corn = cv2.transform(corn, mat)

            minx = int(np.floor(np.min(w_corn[:, 0, 0])))
            maxx = int(np.ceil(np.max(w_corn[:, 0, 0])))
            miny = int(np.floor(np.min(w_corn[:, 0, 1])))
            maxy = int(np.ceil(np.max(w_corn[:, 0, 1])))

            lat_px = (n - s) / map_height
            lng_px = (e - w_coord) / map_width
            rw = w_coord + (minx * lng_px)
            re = w_coord + (maxx * lng_px)
            rn = n - (miny * lat_px)
            rs = n - (maxy * lat_px)

            bw = maxx - minx
            bh = maxy - miny
            max_res = max(wr, hr)
            scale = max_res / max(bw, bh) if max(bw, bh) > 0 else 1.0

            ow = int(bw * scale)
            oh = int(bh * scale)
            sx = ow / bw if bw > 0 else 1.0
            sy = oh / bh if bh > 0 else 1.0

            t_mat = np.array([[sx, 0, -minx * sx], [0, sy, -miny * sy], [0, 0, 1]])
            mat_padded = np.vstack([mat, [0, 0, 1]])
            h_mat = t_mat @ mat_padded
            final_mat = h_mat[:2, :]

            w_ref = cv2.warpAffine(ref_img, final_mat, (ow, oh), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
            mask_raw = np.full((hr, wr), 255, dtype=np.uint8)
            w_mask = cv2.warpAffine(mask_raw, final_mat, (ow, oh), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

            crop_x, crop_y, crop_w, crop_h = cv2.boundingRect(w_mask)
            cropped_ref = w_ref[crop_y : crop_y + crop_h, crop_x : crop_x + crop_w]
            cropped_mask = w_mask[crop_y : crop_y + crop_h, crop_x : crop_x + crop_w]

            b, g, r = cv2.split(cropped_ref)
            rgba = cv2.merge((b, g, r, cropped_mask))
            yield json.dumps({"type": "step_img", "step": 4, "img": make_preview(rgba)}) + "\n"

            out_lat_px = (rn - rs) / oh if oh > 0 else 0
            out_lng_px = (re - rw) / ow if ow > 0 else 0

            final_rn = rn - (crop_y * out_lat_px)
            final_rs = rn - ((crop_y + crop_h) * out_lat_px)
            final_rw = rw + (crop_x * out_lng_px)
            final_re = rw + ((crop_x + crop_w) * out_lng_px)

            yield json.dumps({"type": "log", "msg": "generating preview"}) + "\n"

            stitched_overlay = cv2.warpAffine(ref_img, mat, (proxy_img.shape[1], proxy_img.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
            overlay_mask = cv2.warpAffine(mask_raw, mat, (proxy_img.shape[1], proxy_img.shape[0]), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
            mask_inv = cv2.bitwise_not(overlay_mask)
            bg = cv2.bitwise_and(proxy_img, proxy_img, mask=mask_inv)
            merged_clean = cv2.add(bg, stitched_overlay)

            merged_visualized = merged_clean.copy()
            
            # Keep the green footprint outline
            cv2.polylines(merged_visualized, [np.int32(w_corn)], True, (0, 255, 0), 3, cv2.LINE_AA)
            
            # REMOVED: cv2.circle drawing logic. The frontend SVG will now handle drawing all red points.

            yield json.dumps({"type": "step_img", "step": 5, "img": make_preview(merged_visualized)}) + "\n"

            tiff = make_tiff(rgba, final_rn, final_rs, final_re, final_rw)
            tiff_b64 = base64.b64encode(tiff).decode()

            max_preview_dim = 800
            if crop_w > crop_h:
                pw = max_preview_dim
                ph = int(crop_h * (max_preview_dim / crop_w)) if crop_w > 0 else max_preview_dim
            else:
                ph = max_preview_dim
                pw = int(crop_w * (max_preview_dim / crop_h)) if crop_h > 0 else max_preview_dim

            pw, ph = max(1, pw), max(1, ph)
            p_img = cv2.resize(rgba, (pw, ph), interpolation=cv2.INTER_AREA)
            _, s_enc = cv2.imencode('.webp', p_img, [cv2.IMWRITE_WEBP_QUALITY, 80])
            s_b64 = base64.b64encode(s_enc.tobytes()).decode()

            stitched_url = f"data:image/webp;base64,{s_b64}"

            result_data = {
                "stitchedUrl": stitched_url,
                "geotiffUrl": f"data:application/octet-stream;base64,{tiff_b64}",
                "overlayBounds": {"north": final_rn, "south": final_rs, "east": final_re, "west": final_rw},
                "inlierCount": len(inls),
                "matchScore": round(score, 4),
                "gcpData": gcp_list # Pass GCP analysis to the frontend viewer
            }
            yield json.dumps({"type": "result", "data": result_data}) + "\n"

        except Exception as e:
            yield json.dumps({"type": "error", "msg": str(e).lower()}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")