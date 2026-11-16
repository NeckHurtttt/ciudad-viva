#!/usr/bin/env python3
"""Todas las casas de Santa Cruz: edificios de Overture Maps que NO vienen de OpenStreetMap
(los de OSM ya los dibuja el mapa base). Overture junta Google Open Buildings y Microsoft ML
Building Footprints, detectados en imágenes satelitales.

Salida: datos/casas/<ix>_<iy>.json, una celda de 0,02° (~2 km) por archivo, para cargar solo lo cercano.
Cada edificio: [alto en dm, x0, y0, dx1, dy1, ...] con coordenadas en enteros de 1e-5° relativas a la celda.

Uso: uv run --with duckdb python scripts/casas.py [versión de Overture]
"""
import json, os, sys
import duckdb

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "datos", "casas")
VERSION = sys.argv[1] if len(sys.argv) > 1 else "2026-10-21.0"
CAJA = (-63.32, -17.98, -62.98, -17.62)  # lon0, lat0, lon1, lat1: la mancha urbana (misma grilla del clima)
CELDA = 0.02
Q = 1e5

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
url = f"s3://overturemaps-us-west-2/release/{VERSION}/theme=buildings/type=building/*"
x0, y0, x1, y1 = CAJA
filas = con.execute(f"""
  SELECT ST_AsText(geometry) AS wkt, height, num_floors, sources[1].dataset AS fuente
  FROM read_parquet('{url}', hive_partitioning=1)
  WHERE bbox.xmin > {x0} AND bbox.xmax < {x1} AND bbox.ymin > {y0} AND bbox.ymax < {y1}
    AND sources[1].dataset <> 'OpenStreetMap'
""").fetchall()
print("edificios sin OSM:", len(filas), file=sys.stderr)

def anillo(wkt):
    # primer anillo exterior del polígono (los edificios casi nunca tienen huecos)
    t = wkt[wkt.index("((") + 2:]
    t = t[:t.index(")")]
    return [tuple(map(float, p.split())) for p in t.split(",")]

celdas, fuentes = {}, {}
for wkt, h, pisos, fuente in filas:
    if not wkt.startswith(("POLYGON", "MULTIPOLYGON")):
        continue
    r = anillo(wkt)
    if len(r) < 4:
        continue
    r = r[:-1]  # sin repetir el primer punto
    cx = sum(p[0] for p in r) / len(r); cy = sum(p[1] for p in r) / len(r)
    ix, iy = int((cx - x0) // CELDA), int((cy - y0) // CELDA)
    bx, by = x0 + ix * CELDA, y0 + iy * CELDA
    alto = h if h else (pisos * 3.0 if pisos else 0)  # 0 = la página estima por el tamaño
    pts = [(round((x - bx) * Q), round((y - by) * Q)) for x, y in r]
    plano = [round(alto * 10), pts[0][0], pts[0][1]]
    for a, b in zip(pts, pts[1:]):
        plano += [b[0] - a[0], b[1] - a[1]]
    celdas.setdefault((ix, iy), []).append(plano)
    fuentes[fuente] = fuentes.get(fuente, 0) + 1

os.makedirs(SALIDA, exist_ok=True)
for f in os.listdir(SALIDA):
    os.remove(os.path.join(SALIDA, f))
for (ix, iy), lista in celdas.items():
    json.dump(lista, open(os.path.join(SALIDA, f"{ix}_{iy}.json"), "w"), separators=(",", ":"))
json.dump({"version": VERSION, "celda": CELDA, "caja": CAJA, "q": Q, "fuentes": fuentes,
           "celdas": {f"{ix}_{iy}": len(l) for (ix, iy), l in celdas.items()}},
          open(os.path.join(RAIZ, "datos", "casas.json"), "w"), separators=(",", ":"))
print("celdas:", len(celdas), "fuentes:", fuentes, file=sys.stderr)
