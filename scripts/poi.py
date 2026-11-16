#!/usr/bin/env python3
"""Lugares de Santa Cruz (supermercados, farmacias, cajeros, gasolineras, colegios, comida, referencias…)
sacados de los mosaicos vectoriales de OpenFreeMap (OpenMapTiles, datos de OpenStreetMap) a zoom 14.
Uso: python scripts/poi.py  (sin dependencias: trae su propio lector de Mapbox Vector Tiles)"""
import gzip, json, math, os, struct, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor


# ---------- lector mínimo de protobuf / MVT (solo la capa "poi", geometría Point) ----------
def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7F) << s; s += 7
        if c < 0x80: return r, i


def campos(b):
    i, n = 0, len(b)
    while i < n:
        k, i = varint(b, i); f, t = k >> 3, k & 7
        if t == 0: v, i = varint(b, i)
        elif t == 2: l, i = varint(b, i); v = b[i:i + l]; i += l
        elif t == 1: v = b[i:i + 8]; i += 8
        elif t == 5: v = b[i:i + 4]; i += 4
        else: raise ValueError("tipo protobuf %d" % t)
        yield f, t, v


def valor(b):
    for f, t, v in campos(b):
        if f == 1: return v.decode("utf-8", "replace")
        if f == 2: return struct.unpack("<f", v)[0]
        if f == 3: return struct.unpack("<d", v)[0]
        if f in (4, 5): return v
        if f == 6: return (v >> 1) ^ -(v & 1)
        if f == 7: return bool(v)


def capa_poi(datos):
    if datos[:2] == b"\x1f\x8b": datos = gzip.decompress(datos)
    for f, t, capa in campos(datos):
        if f != 3: continue
        nombre, feats, claves, vals, ext = None, [], [], [], 4096
        for g, _, v in campos(capa):
            if g == 1: nombre = v.decode()
            elif g == 2: feats.append(v)
            elif g == 3: claves.append(v.decode())
            elif g == 4: vals.append(valor(v))
            elif g == 5: ext = v
        if nombre != "poi": continue
        out = []
        for fb in feats:
            tags, tipo, geom = [], 0, []
            for g, t2, v in campos(fb):
                if g == 2: tags = list(paquete(v))
                elif g == 3: tipo = v
                elif g == 4: geom = list(paquete(v))
            if tipo != 1 or len(geom) < 3: continue
            zz = lambda u: (u >> 1) ^ -(u & 1)
            props = {claves[tags[k]]: vals[tags[k + 1]] for k in range(0, len(tags), 2)}
            out.append((props, zz(geom[1]), zz(geom[2])))
        return out, ext
    return [], 4096


def paquete(b):
    i = 0
    while i < len(b):
        v, i = varint(b, i); yield v

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT = (-17.98, -17.62); LON = (-63.32, -62.98); Z = 14

# clase/subclase de OpenMapTiles → categoría de la app
CAT = {
    "comprar": {"grocery/supermarket", "shop/mall", "grocery/marketplace", "shop/department_store", "grocery/convenience", "shop/convenience"},
    "salud": {"pharmacy/pharmacy", "hospital/hospital", "hospital/clinic", "doctors/doctors", "dentist/dentist"},
    "dinero": {"bank/bank", "atm/atm", "bank/bureau_de_change"},
    "auto": {"fuel/fuel", "car/car_repair", "parking/parking", "car/car_parts"},
    "estudio": {"school/school", "college/university", "college/college", "school/kindergarten", "office/university"},
    "comida": {"restaurant/restaurant", "fast_food/fast_food", "cafe/cafe", "ice_cream/ice_cream", "bakery/bakery"},
    "referencia": {"place_of_worship/christian", "town_hall/townhall", "museum/museum", "attraction/attraction", "monument/monument",
                   "stadium/stadium", "bus/bus_station", "police/police", "fire_station/fire_station", "post/post_office",
                   "theatre/theatre", "cinema/cinema", "library/library", "park/park", "sports_centre/sports_centre"},
}
INV = {k: c for c, ks in CAT.items() for k in ks}


def tile(lat, lon):
    n = 2 ** Z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def a_lonlat(x, y, px, py, ext):
    n = 2 ** Z
    lon = (x + px / ext) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / ext) / n))))
    return round(lon, 5), round(lat, 5)


def bajar(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ciudad-viva/1.0"})
    for _ in range(4):
        try:
            return urllib.request.urlopen(req, timeout=40).read()
        except Exception as e:
            err = e
    raise err


def main():
    tj = json.load(urllib.request.urlopen(urllib.request.Request("https://tiles.openfreemap.org/planet", headers={"User-Agent": "ciudad-viva/1.0"})))
    plantilla = tj["tiles"][0]
    x0, y0 = tile(LAT[1], LON[0]); x1, y1 = tile(LAT[0], LON[1])
    pares = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    print("mosaicos:", len(pares), file=sys.stderr)

    def uno(xy):
        x, y = xy
        feats, ext = capa_poi(bajar(plantilla.format(z=Z, x=x, y=y))); out = []
        for p, px, py in feats:
            nombre = p.get("name") or p.get("name:latin")
            cat = INV.get(f"{p.get('class')}/{p.get('subclass')}")
            if not cat: continue
            if not nombre and cat not in ("dinero", "auto", "salud"): continue
            lon, lat = a_lonlat(x, y, px, ext - py, ext)
            out.append([lon, lat, cat, p.get("subclass"), nombre or ""])
        return out

    with ThreadPoolExecutor(8) as ex:
        todos = [p for lista in ex.map(uno, pares) for p in lista]
    vistos, pois = set(), []
    for p in todos:
        k = (round(p[0], 4), round(p[1], 4), p[3], p[4])
        if k in vistos or not (LON[0] <= p[0] <= LON[1] and LAT[0] <= p[1] <= LAT[1]): continue
        vistos.add(k); pois.append(p)
    json.dump({"fuente": "OpenStreetMap vía OpenFreeMap (OpenMapTiles)", "campos": ["lon", "lat", "cat", "tipo", "nombre"], "lugares": pois},
              open(os.path.join(RAIZ, "datos", "lugares.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    from collections import Counter
    print(len(pois), dict(Counter(p[2] for p in pois)))


if __name__ == "__main__":
    main()
