#!/usr/bin/env python3
"""Todas las casas de Santa Cruz desde Microsoft Global ML Building Footprints (detectadas con IA
en imágenes satelitales, licencia ODbL). Sin dependencias: baja los archivos por quadkey y los parte
en celdas de 0,02° (~2 km) para que la página cargue solo lo cercano.

Salida: datos/casas/<ix>_<iy>.json y datos/casas.json (índice).
Cada edificio: [alto en dm (0 = sin dato), x0, y0, dx1, dy1, ...] en enteros de 1e-5° relativos a la celda.
La página descarta los que ya están en OpenStreetMap (los dibuja el mapa base).

Uso: python scripts/casas_ms.py
"""
import csv, gzip, io, json, math, os, sys, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "datos", "casas")
LINKS = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
CAJA = (-63.32, -17.98, -62.98, -17.62)  # lon0, lat0, lon1, lat1: la mancha urbana (misma grilla del clima)
CELDA, Q = 0.02, 1e5


def quadkey(lat, lon, z=9):
    x = int((lon + 180) / 360 * 2 ** z)
    s = math.sin(math.radians(lat))
    y = int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * 2 ** z)
    return "".join(str((1 if x & (1 << (i - 1)) else 0) + (2 if y & (1 << (i - 1)) else 0)) for i in range(z, 0, -1))


def bajar(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ciudad-viva/1.0"})
    return urllib.request.urlopen(req, timeout=300).read()


x0, y0, x1, y1 = CAJA
claves = {quadkey(la, lo) for la in (y0, (y0 + y1) / 2, y1) for lo in (x0, (x0 + x1) / 2, x1)}
urls = [f["Url"] for f in csv.DictReader(io.StringIO(bajar(LINKS).decode()))
        if f["Location"] == "Bolivia" and f["QuadKey"] in claves]
print("archivos:", len(urls), file=sys.stderr)

celdas, total, version = {}, 0, ""
for url in urls:
    version = url.split("/global-buildings/")[1].split("/")[0]
    for linea in gzip.decompress(bajar(url)).decode().splitlines():
        f = json.loads(linea)
        g = f["geometry"]
        if g["type"] != "Polygon":
            continue
        r = g["coordinates"][0][:-1]
        cx = sum(p[0] for p in r) / len(r); cy = sum(p[1] for p in r) / len(r)
        if not (x0 < cx < x1 and y0 < cy < y1) or len(r) < 3:
            continue
        ix, iy = int((cx - x0) // CELDA), int((cy - y0) // CELDA)
        bx, by = x0 + ix * CELDA, y0 + iy * CELDA
        h = f.get("properties", {}).get("height", -1)
        pts = [(round((x - bx) * Q), round((y - by) * Q)) for x, y in r]
        plano = [round(h * 10) if h and h > 0 else 0, pts[0][0], pts[0][1]]
        for a, b in zip(pts, pts[1:]):
            plano += [b[0] - a[0], b[1] - a[1]]
        celdas.setdefault((ix, iy), []).append(plano)
        total += 1
    print("  ", url.split("quadkey=")[1][:9], "→ llevo", total, file=sys.stderr)

os.makedirs(SALIDA, exist_ok=True)
for f in os.listdir(SALIDA):
    os.remove(os.path.join(SALIDA, f))
for (ix, iy), lista in celdas.items():
    json.dump(lista, open(os.path.join(SALIDA, f"{ix}_{iy}.json"), "w"), separators=(",", ":"))
json.dump({"fuente": "Microsoft Global ML Building Footprints (ODbL)", "version": version, "celda": CELDA, "caja": CAJA, "q": Q,
           "celdas": {f"{ix}_{iy}": len(l) for (ix, iy), l in celdas.items()}},
          open(os.path.join(RAIZ, "datos", "casas.json"), "w"), separators=(",", ":"))
print("edificios:", total, "celdas:", len(celdas), file=sys.stderr)
