#!/usr/bin/env python3
"""Alertas diarias de Ciudad Viva SCZ por Telegram.

Arma un mensaje con: aire de hoy y mañana (Open-Meteo/CAMS), lluvia, focos de calor
cerca de la ciudad (datos/focos.json, NASA FIRMS) y las horas pico del tráfico estimado.
Lo manda a un canal o grupo de Telegram si existen TELEGRAM_TOKEN y TELEGRAM_CHAT;
si no, solo lo imprime (sirve para probar).
Uso: python scripts/alertas.py          (la Action diaria lo corre después de bajar los focos)
"""
import json, math, os, sys, urllib.parse, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAZA = (-17.7834, -63.1821)  # lat, lon de la plaza 24 de Septiembre
URL_APP = "https://neckhurtttt.github.io/ciudad-viva/"
ESCALA = [(0, "🟢 bueno"), (12, "🟡 moderado"), (35, "🟠 malo para grupos sensibles"), (55, "🔴 dañino"), (150, "🟣 muy dañino")]


def cat(pm):
    c = ESCALA[0][1]
    for lim, nom in ESCALA:
        if pm >= lim:
            c = nom
    return c


def bajar(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ciudad-viva/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def km(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def mensaje():
    q = f"latitude={PLAZA[0]}&longitude={PLAZA[1]}&forecast_days=2&timezone=America%2FLa_Paz"
    aire = bajar("https://air-quality-api.open-meteo.com/v1/air-quality?" + q + "&hourly=pm2_5")["hourly"]
    met = bajar("https://api.open-meteo.com/v1/forecast?" + q + "&hourly=precipitation")["hourly"]
    lineas = ["🏙️ *Ciudad Viva SCZ* — " + aire["time"][0][:10]]
    for nombre, d in (("Hoy", 0), ("Mañana", 1)):
        pm = [x for x in aire["pm2_5"][d * 24 + 7:d * 24 + 21] if x is not None]  # de 7 a 20 h
        ll = sum(x or 0 for x in met["precipitation"][d * 24:(d + 1) * 24])
        if not pm:
            continue
        peor = max(pm)
        lineas.append(f"*{nombre}:* aire {cat(peor)} (PM2,5 hasta {peor:.0f} µg/m³)" + (f", lluvia {ll:.1f} mm" if ll >= 0.5 else ""))
        if peor >= 35:
            lineas.append("   ↳ niños, mayores y asmáticos: limiten el tiempo afuera.")
    try:
        f = json.load(open(os.path.join(RAIZ, "datos", "focos.json")))
        ult = max(p[2] for p in f["puntos"]) if f["puntos"] else ""
        hoy = [p for p in f["puntos"] if p[2] == ult]
        c10 = sum(1 for p in hoy if km(PLAZA, (p[1], p[0])) < 10)
        c50 = sum(1 for p in hoy if km(PLAZA, (p[1], p[0])) < 50)
        lineas.append(f"🔥 *Focos* del {ult}: {len(hoy):,} en el departamento, {c50} a menos de 50 km de la ciudad"
                      + (f" y ⚠️ {c10} a menos de 10 km" if c10 else "") + ".")
    except Exception as e:
        print("sin focos:", e, file=sys.stderr)
    lineas.append("🚗 *Tráfico (estimado):* lo peor es 7:30–8:15 y 18:15–19:15; si puedes, sal 30 min antes o después.")
    lineas.append(f"Mapa en vivo: {URL_APP}")
    return "\n".join(lineas)


if __name__ == "__main__":
    txt = mensaje()
    print(txt)
    tok, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT")
    if not (tok and chat):
        print("(sin TELEGRAM_TOKEN/TELEGRAM_CHAT: no se envía)", file=sys.stderr)
        sys.exit()
    datos = urllib.parse.urlencode({"chat_id": chat, "text": txt, "parse_mode": "Markdown", "disable_web_page_preview": "true"}).encode()
    r = json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", data=datos, timeout=30))
    print("enviado" if r.get("ok") else r, file=sys.stderr)
