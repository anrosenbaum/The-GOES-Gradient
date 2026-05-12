# get hurricane tracks for 2020
import json, os, urllib.request

URL = "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2024-040425.txt"
OUT = "docs/data/tracks_2020.json"
YEAR = 2020


def cat(wind):
    if wind < 34: return -1
    if wind < 64: return 0
    if wind < 83: return 1
    if wind < 96: return 2
    if wind < 113: return 3
    if wind < 137: return 4
    return 5


# def parse_latlon(s):
#     return float(s[:-1]) if s[-1] in "NE" else -float(s[:-1])
# ^ this didnt work for some reason?? splitting it up

def lat(s): return float(s[:-1]) * (1 if s[-1] == "N" else -1)
def lon(s): return float(s[:-1]) * (1 if s[-1] == "E" else -1)


os.makedirs(os.path.dirname(OUT), exist_ok=True)

# urllib was 403ing without a fake user agent
req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
raw = urllib.request.urlopen(req).read().decode("utf-8")

storms = []
lines = raw.strip().split("\n")
i = 0
while i < len(lines):
    h = [c.strip() for c in lines[i].split(",")]
    sid = h[0]
    name = h[1]
    n = int(h[2])
    i += 1
    if not sid.endswith(str(YEAR)):
        i += n
        continue
    pts = []
    max_cat = -1
    for _ in range(n):
        row = [c.strip() for c in lines[i].split(",")]
        i += 1
        date = row[0]
        time = row[1]
        w = int(row[6])
        c = cat(w)
        if c > max_cat: max_cat = c
        # ISO-ish timestamp
        iso = date[:4] + "-" + date[4:6] + "-" + date[6:8] + "T" + time[:2] + ":" + time[2:]
        pts.append({"t": iso, "lat": lat(row[4]), "lon": lon(row[5]), "wind": w, "cat": c})
    storms.append({"name": name, "id": sid, "category_max": max_cat, "points": pts})

print("found", len(storms), "storms")
with open(OUT, "w") as f:
    json.dump(storms, f, separators=(",", ":"))
print("done", os.path.getsize(OUT) // 1024, "KB")