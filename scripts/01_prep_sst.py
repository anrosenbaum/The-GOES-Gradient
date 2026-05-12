import datetime as dt
import json
import os
import numpy as np
import xarray as xr
import s3fs

YEAR = 2020
MONTHS = [6,7,8,9,10,11]
LAT_MIN = 10.0
LAT_MAX = 45.0
LON_MIN = -100.0
LON_MAX = -15.0
RES = 0.25
OUT_DIR = "data_out"
SAMPLE = 4

H_SAT = 35786023.0
R_EQ = 6378137.0
R_POL = 6356752.31414


def to_latlon(x, y):
    H = H_SAT + R_EQ
    a = np.sin(x)**2 + np.cos(x)**2 * (np.cos(y)**2 + (R_EQ**2/R_POL**2)*np.sin(y)**2)
    b = -2.0 * H * np.cos(x) * np.cos(y)
    c = H**2 - R_EQ**2
    rs = (-b - np.sqrt(b**2 - 4*a*c)) / (2*a)
    sx = rs * np.cos(x) * np.cos(y)
    sy = -rs * np.sin(x)
    sz = rs * np.cos(x) * np.sin(y)
    lat = np.degrees(np.arctan((R_EQ**2/R_POL**2) * (sz / np.sqrt((H-sx)**2 + sy**2))))
    lon = np.radians(-75.0) - np.arctan(sy / (H - sx))
    # return lat + 90, np.degrees(lon)
    return lat, np.degrees(lon)


def load_day(year, doy):
    fs = s3fs.S3FileSystem(anon=True)
    files = fs.glob("s3://noaa-goes16/ABI-L2-SSTF/" + str(year).zfill(4) + "/" + str(doy).zfill(3) + "/*/*.nc")
    if not files:
        return None
    objs = [fs.open(f) for f in files]
    ds = xr.open_mfdataset(objs, combine="nested", concat_dim="t", engine="h5netcdf")
    # sst = ds["SST"].values
    sst = ds["SST"].where(ds["DQF"] == 0)
    return sst.mean("t", skipna=True)


def regrid(d):
    x = d["x"].values
    y = d["y"].values
    XX, YY = np.meshgrid(x, y)
    lat, lon = to_latlon(XX, YY)
    vals = d.values

    m = (np.isfinite(vals) & np.isfinite(lat) & np.isfinite(lon) &
         (lat >= LAT_MIN) & (lat <= LAT_MAX) &
         (lon >= LON_MIN) & (lon <= LON_MAX))
    sst_c = vals[m] - 273.15
    lv = lat[m]
    lo = lon[m]

    tlat = np.arange(LAT_MIN, LAT_MAX + RES, RES)
    tlon = np.arange(LON_MIN, LON_MAX + RES, RES)
    sums = np.zeros((len(tlat), len(tlon)))
    counts = np.zeros_like(sums)

    ii = ((lv - LAT_MIN) / RES).astype(int)
    jj = ((lo - LON_MIN) / RES).astype(int)
    # ii = lv.astype(int)
    # jj = lo.astype(int)
    ok = (ii >= 0) & (ii < sums.shape[0]) & (jj >= 0) & (jj < sums.shape[1])
    np.add.at(sums, (ii[ok], jj[ok]), sst_c[ok])
    np.add.at(counts, (ii[ok], jj[ok]), 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(counts > 0, sums / counts, np.nan)
    return tlat, tlon, out


def month_mean(year, month):
    first = dt.date(year, month, 1)
    if month == 12:
        last = dt.date(year+1, 1, 1) - dt.timedelta(days=1)
    else:
        last = dt.date(year, month+1, 1) - dt.timedelta(days=1)
    days = np.linspace(first.day, last.day, SAMPLE).astype(int)
    grids = []
    tlat = tlon = None
    for d in days:
        doy = (dt.date(year, month, int(d)) - dt.date(year, 1, 1)).days + 1
        print("  day", d, "doy", doy)
        try:
            daily = load_day(year, doy)
            if daily is None:
                continue
            tlat, tlon, g = regrid(daily)
            grids.append(g)
        except Exception as e:
            print("    skip:", e)
    if not grids:
        return None
    # return tlat, tlon, np.sum(np.stack(grids), axis=0)
    return tlat, tlon, np.nanmean(np.stack(grids), axis=0)


os.makedirs(OUT_DIR, exist_ok=True)
for m in MONTHS:
    print("month", m)
    r = month_mean(YEAR, m)
    if r is None:
        print("no data!!")
        continue
    tlat, tlon, grid = r
    payload = {
        "month": str(YEAR) + "-" + str(m).zfill(2),
        "lat_min": float(LAT_MIN),
        "lat_max": float(LAT_MAX),
        "lon_min": float(LON_MIN),
        "lon_max": float(LON_MAX),
        "res": RES,
        "shape": list(grid.shape),
        "sst": [[None if not np.isfinite(v) else round(float(v), 2) for v in row] for row in grid],
    }
    path = OUT_DIR + "/sst_" + str(YEAR) + "_" + str(m).zfill(2) + ".json"
    with open(path, "w") as f:
        # json.dump(payload, f)
        json.dump(payload, f, separators=(",", ":"))
    print("  wrote", path, os.path.getsize(path)//1024, "KB")