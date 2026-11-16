#!/usr/bin/env python3
"""Prepara datos/ para Ciudad Viva SCZ.

- rutas.json: 71 líneas de micro (OpenStreetMap, vía MicroSCZ), en [lon, lat].
- focos.json: focos de calor VIIRS de los últimos 7 días en el depto. de Santa Cruz
  (desde FIRMS en vivo; si falla, la copia de NINAWI).
- clima.json: respaldo de aire (PM2,5), lluvia y viento por hora de una grilla sobre la
  ciudad (Open-Meteo). La app lo pide en vivo y usa este archivo solo si no hay red.
"""
import csv, io, json, os, sys, urllib.parse, urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DATOS = os.path.join(RAIZ, "datos")
PROY = os.path.dirname(RAIZ)

# Depto. de Santa Cruz (caja aproximada)
DEP = (-20.6, -13.4, -64.9, -57.4)  # lat min, lat max, lon min, lon max
# Grilla del clima sobre la mancha urbana
GLAT = (-17.98, -17.62)
GLON = (-63.32, -62.98)
N = 7

FIRMS = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv"


def bajar(url, t=90):
    req = urllib.request.Request(url, headers={"User-Agent": "ciudad-viva/1.0"})
    return urllib.request.urlopen(req, timeout=t).read().decode()


def rutas():
    src = json.load(open(os.path.join(PROY, "MicroSCZ", "datos", "rutas.json")))
    out = []
    for r in src["rutas"]:
        tramos = [[[round(lon, 5), round(lat, 5)] for lat, lon in tr] for tr in r["lineas"] if len(tr) > 1]
        if not tramos:
            continue
        out.append({"ref": r["ref"], "nombre": r["nombre"], "desde": r["desde"],
                    "hasta": r["hasta"], "km": r["km"], "tramos": tramos})
    json.dump({"fuente": "OpenStreetMap (ODbL) vía MicroSCZ", "rutas": out},
              open(os.path.join(DATOS, "rutas.json"), "w"), separators=(",", ":"))
    print("rutas:", len(out))


def dentro(lat, lon):
    return DEP[0] <= lat <= DEP[1] and DEP[2] <= lon <= DEP[3]


def focos():
    pts, fuente = [], "VIIRS NOAA-20 (NASA FIRMS)"
    try:
        for f in csv.DictReader(io.StringIO(bajar(FIRMS, 180))):
            lat, lon = float(f["latitude"]), float(f["longitude"])
            if dentro(lat, lon):
                pts.append([round(lon, 4), round(lat, 4), f["acq_date"], f["acq_time"], float(f["frp"] or 0)])
    except Exception as e:  # sin red: copia de NINAWI
        print("FIRMS falló, uso NINAWI:", e, file=sys.stderr)
        src = json.load(open(os.path.join(PROY, "calendario-fuego", "web", "datos", "ultimos7.json")))
        fuente = src["fuente"] + " (copia)"
        for lat, lon, hora, fecha, frp in src["puntos"]:
            if dentro(lat, lon):
                pts.append([lon, lat, fecha, str(hora).zfill(4), frp])
    fechas = sorted({p[2] for p in pts})
    json.dump({"fuente": fuente, "desde": fechas[0] if fechas else "", "hasta": fechas[-1] if fechas else "",
               "puntos": pts}, open(os.path.join(DATOS, "focos.json"), "w"), separators=(",", ":"))
    print("focos:", len(pts))


def grilla():
    lats, lons = [], []
    for i in range(N):
        for j in range(N):
            lats.append(round(GLAT[0] + (GLAT[1] - GLAT[0]) * i / (N - 1), 3))
            lons.append(round(GLON[0] + (GLON[1] - GLON[0]) * j / (N - 1), 3))
    return lats, lons


def clima():
    lats, lons = grilla()
    q = "latitude=%s&longitude=%s&forecast_days=1&timezone=America%%2FLa_Paz" % (
        ",".join(map(str, lats)), ",".join(map(str, lons)))
    aire = json.loads(bajar("https://air-quality-api.open-meteo.com/v1/air-quality?" + q + "&hourly=pm2_5"))
    met = json.loads(bajar("https://api.open-meteo.com/v1/forecast?" + q +
                           "&hourly=precipitation,wind_speed_10m,wind_direction_10m,temperature_2m"))
    out = {"fuente": "Open-Meteo (CAMS + modelos meteorológicos)", "n": N, "lat": GLAT, "lon": GLON,
           "horas": aire[0]["hourly"]["time"], "pm25": [], "lluvia": [], "viento": [], "dir": [], "temp": []}
    for a, m in zip(aire, met):
        out["pm25"].append(a["hourly"]["pm2_5"])
        h = m["hourly"]
        out["lluvia"].append(h["precipitation"])
        out["viento"].append(h["wind_speed_10m"])
        out["dir"].append(h["wind_direction_10m"])
        out["temp"].append(h["temperature_2m"])
    json.dump(out, open(os.path.join(DATOS, "clima.json"), "w"), separators=(",", ":"))
    print("clima: %d puntos × %d horas" % (len(aire), len(out["horas"])))


def depto():
    """Contorno del depto. de Santa Cruz (geoBoundaries, copia de NINAWI), simplificado."""
    src = json.load(open(os.path.join(PROY, "calendario-fuego", "limites", "bol-adm1.geojson")))
    f = next(f for f in src["features"] if f["properties"]["shapeISO"] == "BO-S")
    g = f["geometry"]
    polis = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    anillos = []
    for poli in polis:
        r = poli[0]
        if len(r) < 50:
            continue
        paso = max(1, len(r) // 1500)
        anillos.append([[round(x, 3), round(y, 3)] for x, y in r[::paso]] + [[round(r[0][0], 3), round(r[0][1], 3)]])
    json.dump({"fuente": "geoBoundaries ADM1", "anillos": anillos}, open(os.path.join(DATOS, "depto.json"), "w"), separators=(",", ":"))
    print("depto:", len(anillos), "anillos,", sum(map(len, anillos)), "puntos")


OVERPASS = "https://overpass-api.de/api/interpreter"
CLASE = {"trunk": 3, "primary": 2, "secondary": 1}


def calles():
    """Avenidas con nombre (OSM) → tramos y cruces entre avenidas distintas."""
    q = ('[out:json][timeout:90];way["highway"~"^(trunk|primary|secondary)$"]["name"]'
         f"({GLAT[0]},{GLON[0]},{GLAT[1]},{GLON[1]});out geom;")
    req = urllib.request.Request(OVERPASS, data=("data=" + urllib.parse.quote(q)).encode(),
                                 headers={"User-Agent": "ciudad-viva/1.0"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    vias, nodos = [], {}
    for w in d["elements"]:
        g = w.get("geometry") or []
        if len(g) < 2:
            continue
        t = w["tags"]
        vias.append({"n": t["name"], "c": CLASE[t["highway"]],
                     "p": [[round(x["lon"], 5), round(x["lat"], 5)] for x in g]})
        for nid, x in zip(w["nodes"], g):
            nodos.setdefault(nid, [round(x["lon"], 5), round(x["lat"], 5), set()])[2].add(t["name"])
    cruces, vistos = [], set()
    for lon, lat, nombres in nodos.values():
        if len(nombres) < 2:
            continue
        clave = tuple(sorted(nombres))[:2]
        celda = (clave, round(lon, 3), round(lat, 3))
        if celda in vistos:
            continue
        vistos.add(celda)
        cruces.append({"p": [lon, lat], "n": list(clave)})
    json.dump({"fuente": "OpenStreetMap (Overpass)", "vias": vias, "cruces": cruces},
              open(os.path.join(DATOS, "calles.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print("calles:", len(vias), "vías,", len(cruces), "cruces")


ESPEJOS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", OVERPASS, "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def overpass(q):
    import time
    for intento in range(6):
        url = ESPEJOS[intento % len(ESPEJOS)]
        try:
            req = urllib.request.Request(url, data=("data=" + urllib.parse.quote(q)).encode(),
                                         headers={"User-Agent": "ciudad-viva/1.0"})
            return json.load(urllib.request.urlopen(req, timeout=180))["elements"]
        except Exception as e:
            print("  overpass", url.split("/")[2], "falló:", e, file=sys.stderr)
            time.sleep(4 + intento * 3)
    raise RuntimeError("Overpass no responde")


def centro(e):
    if "center" in e:
        return [round(e["center"]["lon"], 5), round(e["center"]["lat"], 5)]
    return [round(e["lon"], 5), round(e["lat"], 5)]


def lugares():
    """Hitos con nombre (hospitales, universidades, mercados, malls, estadios, iglesias grandes…),
    parques (polígonos) y árboles sueltos de OSM."""
    bb = f"({GLAT[0]},{GLON[0]},{GLAT[1]},{GLON[1]})"
    filtros = ['["amenity"~"^(hospital|university|college)$"]', '["amenity"~"^(marketplace|bus_station)$"]',
               '["shop"="mall"]', '["leisure"="stadium"]', '["aeroway"="aerodrome"]', '["railway"="station"]',
               '["tourism"~"^(museum|attraction)$"]']
    elementos = []
    for f in filtros:
        elementos += overpass(f'[out:json][timeout:60];nwr{f}["name"]{bb};out center tags;')
    tipos = []
    for e in elementos:
        t = e.get("tags", {})
        k = (t.get("amenity") or t.get("shop") or t.get("leisure") or t.get("building")
             or t.get("aeroway") or t.get("railway") or t.get("tourism"))
        cat = {"hospital": "salud", "university": "estudio", "college": "estudio", "marketplace": "mercado",
               "mall": "mercado", "stadium": "deporte", "bus_station": "transporte", "aerodrome": "transporte",
               "station": "transporte", "museum": "cultura", "attraction": "cultura", "cathedral": "cultura",
               "place_of_worship": "cultura"}.get(k)
        if cat:
            tipos.append({"n": t["name"], "c": cat, "p": centro(e)})
    # sin repetidos por nombre
    vistos, hitos = set(), []
    for h in tipos:
        if h["n"].lower() not in vistos:
            vistos.add(h["n"].lower()); hitos.append(h)
    q = f"""[out:json][timeout:150];(
      way["leisure"~"^(park|garden|pitch)$"]{bb};
      way["landuse"~"^(forest|grass|recreation_ground)$"]{bb};
      way["natural"="wood"]{bb};
    );out geom;"""
    parques = []
    for e in overpass(q):
        g = e.get("geometry") or []
        if len(g) >= 4 and g[0] == g[-1]:
            parques.append({"t": e["tags"].get("leisure") or e["tags"].get("landuse") or "wood",
                            "p": [[round(x["lon"], 5), round(x["lat"], 5)] for x in g]})
    arboles = [centro(e) for e in overpass(f'[out:json][timeout:120];node["natural"="tree"]{bb};out;')]
    json.dump({"fuente": "OpenStreetMap (Overpass)", "hitos": hitos, "parques": parques, "arboles": arboles},
              open(os.path.join(DATOS, "lugares.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    from collections import Counter
    print("lugares:", len(hitos), "hitos", dict(Counter(h["c"] for h in hitos)), len(parques), "parques,", len(arboles), "árboles")


if __name__ == "__main__":
    os.makedirs(DATOS, exist_ok=True)
    rutas()
    focos()
    clima()
    depto()
    calles()
