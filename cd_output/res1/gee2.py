# -*- coding: utf-8 -*-
"""gee_change_detection.py
Updated to integrate directly with Google Earth Engine API.
Centralized Configuration Version + GeoJSON Vector Export.
"""

# ==============================================================================
# 🟢 YOUR CONFIGURATION SETTINGS 🟢
# ==============================================================================

CONFIG = {
    # --- GEE Authentication & Bounds ---
    "GEE_PROJECT_ID": "project-cfaedce9-0ea7-4ae9-a21",  # Your GCP Project ID
    "AOI_COORDS": [72.5, 22.9, 73.1, 23.4],              # [west, south, east, north]
    "SCALE": 40,                                         # Spatial Resolution (meters)

    # --- Time Periods ---
    "TIME_1": {
        "START": "2021-01-01",
        "END": "2021-03-31"
    },
    "TIME_2": {
        "START": "2026-01-01",
        "END": "2026-03-31"
    },

    # --- Dataset & Bands ---
    "COLLECTION_ID": "COPERNICUS/S2_SR_HARMONIZED",
    "BANDS": ["B4", "B8"],       # e.g., Red and NIR for Sentinel-2
    "RED_BAND_IDX": 0,           
    "NIR_BAND_IDX": 1,           

    # --- Processing & Output Settings ---
    "THRESHOLD_SIGMA": 2.0,      
    "OUTPUT_DIR": "cd_output",   
    "GENERATE_PLOTS": True,      
    "EXPORT_GEOJSON": True       # Set to True to generate vector polygons!
}

# ==============================================================================
# 🛑 DO NOT EDIT BELOW THIS LINE (Unless you are modifying the core logic) 🛑
# ==============================================================================

import os
import sys
import warnings
import zipfile
import io
import shutil
import json
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from scipy.stats import chi2 as scipy_chi2
import requests

try:
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    from rasterio.features import shapes  # Needed for vectorization
except ImportError:
    sys.exit("[ERROR] rasterio not found. Install with: pip install rasterio")

try:
    import ee
except ImportError:
    sys.exit("[ERROR] earthengine-api not found. Install with: pip install earthengine-api")

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# GEE Data Fetching Helper
# ─────────────────────────────────────────────────────────────────────────────

def fetch_gee_image(collection_id, start_date, end_date, coords, bands, scale, out_name, tmp_dir):
    print(f"  [GEE] Filtering {collection_id} from {start_date} to {end_date}...")
    
    aoi = ee.Geometry.BBox(*coords)
    
    collection = (ee.ImageCollection(collection_id)
                  .filterDate(start_date, end_date)
                  .filterBounds(aoi)
                  .select(bands))
    
    count = collection.size().getInfo()
    if count == 0:
        sys.exit(f"[ERROR] No images found in GEE collection {collection_id} for period {start_date} to {end_date}.")
    print(f"  [GEE] Found {count} images. Generating mean composite...")
    
    image = collection.mean().clip(aoi)
    
    try:
        url = image.getDownloadURL({
            'scale': scale,
            'crs': 'EPSG:4326',
            'region': aoi
        })
    except Exception as e:
        sys.exit(f"[ERROR] Failed to generate download URL. Your AOI might be too large for the selected scale ({scale}m).\nDetails: {e}")
        
    print(f"  [GEE] Downloading image data...")
    r = requests.get(url)
    if r.status_code != 200:
        sys.exit(f"[ERROR] GEE download failed with status code {r.status_code}: {r.text}")
        
    z = zipfile.ZipFile(io.BytesIO(r.content))
    tif_files = [f for f in z.namelist() if f.endswith('.tif')]
    if not tif_files:
        sys.exit("[ERROR] No GeoTIFF found inside the GEE download package.")
        
    extracted_path = z.extract(tif_files[0], path=tmp_dir)
    final_path = os.path.join(tmp_dir, f"{out_name}.tif")
    shutil.move(extracted_path, final_path)
    return final_path

# ─────────────────────────────────────────────────────────────────────────────
# Local Image Math & Analysis Functions 
# ─────────────────────────────────────────────────────────────────────────────

def load_geotiff(path):
    with rasterio.open(path) as src:
        data = src.read().astype(np.float32)   
        profile = src.profile.copy()
        nodata = src.nodata

    if nodata is not None:
        valid = ~np.any(np.isclose(data, nodata), axis=0)
    else:
        valid = ~np.any(~np.isfinite(data), axis=0)

    data = np.where(np.isfinite(data), data, 0.0)
    return data, profile, valid

def align_images(data1, profile1, data2, profile2):
    if (profile1["crs"] == profile2["crs"] and
            profile1["transform"] == profile2["transform"] and
            data1.shape == data2.shape):
        return data2  

    print("  [align] Reprojecting image2 onto image1 grid ...")
    n_bands = data2.shape[0]
    dst_shape = data1.shape[1:]            
    aligned = np.zeros((n_bands, *dst_shape), dtype=np.float32)

    for b in range(n_bands):
        reproject(
            source=data2[b],
            destination=aligned[b],
            src_transform=profile2["transform"],
            src_crs=profile2["crs"],
            dst_transform=profile1["transform"],
            dst_crs=profile1["crs"],
            resampling=Resampling.bilinear,
        )
    return aligned

def save_geotiff(path, array, profile, nodata=-9999):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    out_profile = profile.copy()
    out_profile.update(
        dtype=rasterio.float32,
        count=array.shape[0],
        nodata=nodata,
        compress="lzw",
    )
    with rasterio.open(path, "w", **out_profile) as dst:
        dst.write(array.astype(np.float32))
    print(f"  [saved] {path}")

def save_geojson_mask(mask, profile, path):
    """Converts a binary numpy mask to a GeoJSON feature collection."""
    print(f"  [vector] Converting raster mask to polygons...")
    mask_uint8 = mask.astype(np.uint8)
    
    # Extract contiguous shapes from the raster array
    geom_results = (
        {'type': 'Feature', 'properties': {'change_detected': 1}, 'geometry': s}
        for s, value in shapes(mask_uint8, mask=mask_uint8, transform=profile['transform'])
        if value == 1
    )
    
    features = list(geom_results)
    
    if not features:
        print("  [vector] No change detected, skipping GeoJSON export.")
        return

    # Structure it as a valid GeoJSON
    crs_name = profile['crs'].to_string() if profile['crs'] else "EPSG:4326"
    geojson_data = {
        'type': 'FeatureCollection',
        'crs': {
            'type': 'name',
            'properties': {'name': crs_name}
        },
        'features': features
    }

    with open(path, 'w') as f:
        json.dump(geojson_data, f)
    print(f"  [saved] {path} ({len(features)} polygons)")

def histogram_match_band(src_band, ref_band, n_bins=256):
    src_counts, src_edges = np.histogram(src_band, bins=n_bins)
    ref_counts, ref_edges = np.histogram(ref_band, bins=n_bins)

    src_cdf = np.cumsum(src_counts).astype(np.float64)
    src_cdf /= src_cdf[-1]

    ref_cdf = np.cumsum(ref_counts).astype(np.float64)
    ref_cdf /= ref_cdf[-1]

    src_centres = 0.5 * (src_edges[:-1] + src_edges[1:])
    ref_centres = 0.5 * (ref_edges[:-1] + ref_edges[1:])

    lookup_y = np.interp(src_cdf, ref_cdf, ref_centres)
    return src_centres, lookup_y

def normalise_image(data2, data1, valid):
    print("  [norm ] Histogram-matching image2 to image1 ...")
    normalised = data2.copy()
    for b in range(data2.shape[0]):
        src_vals = data2[b][valid].ravel()
        ref_vals = data1[b][valid].ravel()
        if src_vals.size < 10 or ref_vals.size < 10:
            continue
        x, y = histogram_match_band(src_vals, ref_vals)
        normalised[b] = np.interp(data2[b].ravel(), x, y).reshape(data2[b].shape)
    return normalised

def simple_difference(data1, data2, valid, threshold_sigma=2.0):
    diff = data1 - data2  
    change_mask = np.zeros(data1.shape[1:], dtype=bool)

    for b in range(diff.shape[0]):
        d = diff[b]
        vals = d[valid]
        mu  = np.mean(vals)
        sig = np.std(vals)
        changed = valid & (np.abs(d - mu) > threshold_sigma * sig)
        change_mask |= changed

    return diff, change_mask

def generalised_eigenproblem(C, B):
    try:
        L = np.linalg.cholesky(B)
        Li = np.linalg.inv(L)
        M = Li @ C @ Li.T
        vals, vecs = np.linalg.eigh(M)        
        idx = np.argsort(vals)[::-1]
        vals = vals[idx]
        vecs = vecs[:, idx]
        eigenvecs = Li.T @ vecs
        return vals, eigenvecs
    except np.linalg.LinAlgError:
        vals, vecs = np.linalg.eig(np.linalg.pinv(B) @ C)
        idx = np.argsort(vals.real)[::-1]
        return vals.real[idx], vecs.real[:, idx]

def mad_transform(pixels1, pixels2):
    N = pixels1.shape[0]
    P = pixels1.shape[1]

    mu1 = pixels1.mean(axis=1, keepdims=True)
    mu2 = pixels2.mean(axis=1, keepdims=True)
    X = pixels1 - mu1
    Y = pixels2 - mu2

    XY = np.vstack([X, Y])
    joint_cov = (XY @ XY.T) / (P - 1)

    S11 = joint_cov[:N, :N]
    S22 = joint_cov[N:, N:]
    S12 = joint_cov[:N, N:]
    S21 = joint_cov[N:, :N]

    C1 = S12 @ np.linalg.pinv(S22) @ S21
    C2 = S21 @ np.linalg.pinv(S11) @ S12

    lambdas_a, A = generalised_eigenproblem(C1, S11)
    lambdas_b, B = generalised_eigenproblem(C2, S22)

    rhos = np.sqrt(np.clip(lambdas_a, 0, 1))

    s = np.diag(1.0 / np.sqrt(np.diag(S11)))
    sign_a = np.sign((s @ S11 @ A).sum(axis=0))
    A = A * sign_a

    sign_ab = np.sign(np.diag(A.T @ S12 @ B))
    B = B * sign_ab

    U = A.T @ X
    V = B.T @ Y
    MAD = U - V

    sigma2 = 2.0 * (1.0 - rhos)
    sigma2 = np.maximum(sigma2, 1e-10)   

    chi2_img = np.sum((MAD ** 2) / sigma2[:, None], axis=0)

    return MAD, chi2_img, rhos

def mad_change_detection(data1, data2, valid, threshold_sigma=2.0):
    H, W = data1.shape[1], data1.shape[2]
    N = data1.shape[0]

    flat_valid = valid.ravel()
    p1 = data1.reshape(N, -1)[:, flat_valid]   
    p2 = data2.reshape(N, -1)[:, flat_valid]

    P = p1.shape[1]
    if P < N * 10:
        print(f"  [MAD ] Too few valid pixels ({P}) for MAD — skipping, using simple diff.")
        return None, None, None

    print(f"  [MAD ] Running MAD on {N} bands x {P:,} pixels ...")
    MAD_flat, chi2_flat, rhos = mad_transform(p1, p2)

    MAD_img   = np.zeros((N, H * W), dtype=np.float32)
    chi2_full = np.zeros(H * W, dtype=np.float32)
    MAD_img[:, flat_valid]   = MAD_flat.astype(np.float32)
    chi2_full[flat_valid]    = chi2_flat.astype(np.float32)
    MAD_img   = MAD_img.reshape(N, H, W)
    chi2_full = chi2_full.reshape(H, W)

    from scipy.stats import norm as sp_norm
    p_value = 1.0 - sp_norm.cdf(threshold_sigma)
    chi2_threshold = scipy_chi2.ppf(1.0 - p_value, df=N)

    change_mask = valid & (chi2_full > chi2_threshold)
    return MAD_img, chi2_full, change_mask

# ─────────────────────────────────────────────────────────────────────────────
# Main Pipeline
# ─────────────────────────────────────────────────────────────────────────────

def run():
    out_dir = CONFIG["OUTPUT_DIR"]
    os.makedirs(out_dir, exist_ok=True)
    tmp_dir = os.path.join(out_dir, "gee_download_tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    print("\n" + "=" * 60)
    print("  GeoTIFF Change Detection via Google Earth Engine API")
    print("=" * 60)

    print("\n[0/6] Initializing Earth Engine API ...")
    try:
        ee.Initialize(project=CONFIG["GEE_PROJECT_ID"])
    except Exception:
        print("  Initialization failed. Attempting Authentication...")
        ee.Authenticate()
        ee.Initialize(project=CONFIG["GEE_PROJECT_ID"])

    print("\n[1/6] Downloading images from GEE ...")
    t1_file = fetch_gee_image(CONFIG["COLLECTION_ID"], CONFIG["TIME_1"]["START"], CONFIG["TIME_1"]["END"], CONFIG["AOI_COORDS"], CONFIG["BANDS"], CONFIG["SCALE"], "time1", tmp_dir)
    t2_file = fetch_gee_image(CONFIG["COLLECTION_ID"], CONFIG["TIME_2"]["START"], CONFIG["TIME_2"]["END"], CONFIG["AOI_COORDS"], CONFIG["BANDS"], CONFIG["SCALE"], "time2", tmp_dir)

    data1, profile1, valid1 = load_geotiff(t1_file)
    data2, profile2, valid2 = load_geotiff(t2_file)
    # %% to
    print("\n[2/6] Spatial alignment ...")
    data2 = align_images(data1, profile1, data2, profile2)
    valid2_aligned = np.zeros(valid1.shape, dtype=np.uint8)
    
    with rasterio.open(t2_file) as src2:
        reproject(
            valid2.astype(np.uint8), valid2_aligned, 
            src_transform=src2.transform, src_crs=src2.crs, 
            dst_transform=profile1['transform'], dst_crs=profile1['crs'], 
            resampling=Resampling.nearest
        )
    valid = valid1 & valid2_aligned.astype(bool)

    print("\n[3/6] Radiometric normalisation (histogram matching) ...")
    data2_norm = normalise_image(data2, data1, valid)

    n_bands = data1.shape[0]

    print("\n[4/6] Change detection ...")
    diff, change_simple = simple_difference(data1, data2_norm, valid, threshold_sigma=CONFIG["THRESHOLD_SIGMA"])

    MAD_img = chi2_img = change_mad = rhos = None
    if n_bands >= 2:
        MAD_img, chi2_img, change_mad = mad_change_detection(data1, data2_norm, valid, threshold_sigma=CONFIG["THRESHOLD_SIGMA"])

    print("\n[5/6] Saving outputs ...")
    best_mask = change_mad if change_mad is not None else change_simple
    
    # Save the original GeoTIFFs
    save_geotiff(os.path.join(out_dir, "change_mask.tif"), best_mask[np.newaxis].astype(np.float32), profile1)
    save_geotiff(os.path.join(out_dir, "difference.tif"), diff, profile1)

    # Convert to GeoJSON if toggle is True
    if CONFIG["EXPORT_GEOJSON"]:
        geojson_path = os.path.join(out_dir, "change_polygons.geojson")
        save_geojson_mask(best_mask, profile1, geojson_path)

    try:
        shutil.rmtree(tmp_dir)
    except Exception:
        pass

    print("\n" + "=" * 60)
    print("  PIPELINE COMPLETE")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    run()