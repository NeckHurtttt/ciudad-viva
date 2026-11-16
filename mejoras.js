/* Ciudad Viva SCZ — mejoras para la Abstracthon:
 * origen de cada dato (EN VIVO / ESTIMADO…), "Cómo calculamos", alertas (pantalla, notificación y Telegram),
 * zonas por anillo, 25 años de fuego (NINAWI), comparador antes/después, captura para compartir,
 * narración por voz, modo kiosco y paleta para daltónicos. */
const { PolygonLayer, SolidPolygonLayer } = deck;
const guardado = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

/* ===================== Origen de cada dato ===================== */
const ORG = {
  vivo: ["EN VIVO", "#2bd9a0", "Se pide a Open-Meteo al abrir la página"],
  resp: ["RESPALDO", "#ffd23f", "Sin red: copia guardada de Open-Meteo"],
  est: ["ESTIMADO", "#ff7ac6", "Calculado con un modelo, no medido"],
  sim: ["SIMULADO", "#b47cff", "Recorridos reales de OSM; los micros en movimiento son una animación"],
  sat: ["SATÉLITE", "#ff9f45", "NASA FIRMS, se actualiza cada mañana"],
  osm: ["OSM", "#8fa2ff", "OpenStreetMap, mapeado por la comunidad"],
};
function origenDe(k) {
  const clima = S.clima && /vivo/i.test(S.clima.fuente) ? "vivo" : "resp";
  return { trafico: "est", zonas: "est", micros: "sim", aire: clima, lluvia: clima, viento: clima, focos: "sat", lugares: "osm", edificios: "osm" }[k];
}
const etiquetaOrg = (o) => `<em class="org" style="--c:${ORG[o][1]}" title="${ORG[o][2]}">${ORG[o][0]}</em>`;
function pintarOrigen() {
  for (const [k] of CAPAS) {
    const b = document.querySelector(`.capa[data-k="${k}"] b`); if (!b || b.querySelector(".org")) continue;
    b.insertAdjacentHTML("beforeend", " " + etiquetaOrg(origenDe(k)));
  }
  const e = $("#estado"); if (e && S.clima && !/vivo/i.test(S.clima.fuente)) e.title = "El reloj va en vivo, pero el clima es la copia guardada";
}

/* ===================== Zonas por anillo ===================== */
// Santa Cruz crece en anillos alrededor de la plaza. OSM no tiene los distritos municipales,
// así que se usan anillos aproximados (radios medios) partidos en norte, este, sur y oeste.
const ANILLOS = [0, 1.1, 2.1, 3.2, 4.5, 5.9, 7.3, 8.8, 10.5];
const NOM_ANILLO = ["Casco viejo", "1er–2do anillo", "2do–3er anillo", "3er–4to anillo", "4to–5to anillo", "5to–6to anillo", "6to–7mo anillo", "7mo–8vo anillo"];
const SECTORES = [["Norte", -45], ["Este", 45], ["Sur", 135], ["Oeste", 225]];
const ZON = { lista: [], clave: "" };
const KM_LON = 111.32 * Math.cos(PLAZA[1] * RAD), KM_LAT = 110.57;
const desde = (d, b) => [PLAZA[0] + d * Math.sin(b * RAD) / KM_LON, PLAZA[1] + d * Math.cos(b * RAD) / KM_LAT];
function arco(d, b0, b1) { const out = []; for (let i = 0; i <= 16; i++) out.push(desde(d, b0 + (b1 - b0) * i / 16)); return out; }
function zonaDe(p) {
  const dx = (p[0] - PLAZA[0]) * KM_LON, dy = (p[1] - PLAZA[1]) * KM_LAT, d = Math.hypot(dx, dy);
  const a = ANILLOS.findIndex((r, i) => i && d < r) - 1; if (a < 0) return null;
  if (a < 2) return a;
  const b = (Math.atan2(dx, dy) / RAD + 405) % 360; // 0 = norte desde -45°
  return 2 + (a - 2) * 4 + Math.floor(b / 90);
}
function prepararZonas() {
  for (let a = 0; a < ANILLOS.length - 1; a++) {
    const r0 = ANILLOS[a], r1 = ANILLOS[a + 1];
    if (a < 2) {
      const ext = arco(r1, 0, 360), poly = r0 ? [ext, arco(r0, 0, 360).reverse()] : [ext];
      ZON.lista.push({ i: ZON.lista.length, n: NOM_ANILLO[a], poly, c: a ? desde((r0 + r1) / 2, 200) : PLAZA });
    } else for (const [s, b0] of SECTORES) {
      ZON.lista.push({ i: ZON.lista.length, n: `${s} · ${NOM_ANILLO[a]}`, poly: [[...arco(r1, b0, b0 + 90), ...arco(r0, b0 + 90, b0)]], c: desde((r0 + r1) / 2, b0 + 45) });
    }
  }
  for (const z of ZON.lista) { z.lineas = new Set(); z.vias = []; z.focos = 0; }
  for (const r of S.rutas) for (const tr of r.tramos) for (let k = 0; k < tr.length; k += 3) { const z = zonaDe(tr[k]); if (z !== null) ZON.lista[z].lineas.add(r.ref); }
  for (const v of T.vias) { const z = zonaDe(v.mid); if (z !== null) ZON.lista[z].vias.push(v); }
  for (const f of S.focos?.todos || []) { const z = zonaDe(f.p); if (z !== null) ZON.lista[z].focos++; }
}
function calcularZonas() {
  const k = T.horaCalc.toFixed(2) + "|" + REP.lista.length + "|" + T.sim.cerradas.size + T.sim.lluvia + DALT.on;
  if (k === ZON.clave || !ZON.lista.length) return; ZON.clave = k;
  for (const z of ZON.lista) {
    let km = 0, kl = 0, sv = 0;
    for (const v of z.vias) { const x = v.L / 1000; km += x; sv += v.v * x; if (v.cerrada || v.r < 0.5) kl += x; }
    z.km = km; z.pct = km ? kl / km : 0; z.vel = km ? sv / km : 0;
    z.pm = S.clima ? campo("pm25", S.hora, ...z.c) : 0;
    z.rep = REP.lista.filter((r) => zonaDe(r.p) === z.i).length;
    z.col = km > 0.8 ? nivel(Math.max(0, 1 - z.pct * 2.4))[2] : "#5b6585";
  }
}
function textoZona(z) {
  return `${z.n} (aprox.)\n${z.km > 0.8 ? `${Math.round(z.pct * 100)}% de avenidas lentas · ${Math.round(z.vel)} km/h` : "Casi sin avenidas mapeadas"}\n` +
    `PM2,5 ${fmt(z.pm)} · ${z.lineas.size} líneas de micro${z.focos ? ` · ${z.focos} focos en 7 días` : ""}${z.rep ? ` · ${z.rep} reportes` : ""}`;
}
function listaZonas() {
  calcularZonas();
  const top = ZON.lista.filter((z) => z.km > 0.8).sort((a, b) => b.pct - a.pct).slice(0, 5);
  const pocas = ZON.lista.filter((z) => z.km > 0.8).sort((a, b) => a.lineas.size - b.lineas.size)[0];
  return `<div class="zonas-lista"><div class="sub">Por zonas · anillos aproximados ${etiquetaOrg("est")}</div>
    <ol class="pasos">${top.map((z) => `<li style="--c:${z.col}" data-z="${z.i}"><b>${z.n}</b><span>${Math.round(z.pct * 100)}% lento · ${Math.round(z.vel)} km/h</span></li>`).join("")}</ol>
    ${pocas ? `<p class="ayuda">Zona con menos micros: <b>${pocas.n}</b> (${pocas.lineas.size} líneas).</p>` : ""}</div>`;
}

/* ===================== Capas nuevas ===================== */
function capasMejoras(L, seg) {
  if (S.capas.zonas && ZON.lista.length && T.listo) {
    calcularZonas();
    const prof = { depthCompare: "always", depthWriteEnabled: false };
    L.push(new PolygonLayer({ id: "zonas", data: ZON.lista, getPolygon: (d) => d.poly, pickable: true, stroked: true, filled: true,
      getFillColor: (d) => hex(d.col, 42), getLineColor: [220, 230, 255, 90], lineWidthMinPixels: 1, parameters: prof,
      updateTriggers: { getFillColor: ZON.clave } }));
    if (mapa.getZoom() < 14.5) L.push(new TextLayer({ id: "zonas-txt", data: ZON.lista.filter((z) => z.km > 0.8), getPosition: (d) => d.c,
      getText: (d) => `${Math.round(d.pct * 100)}%`, getSize: 12, fontWeight: 700, fontFamily: "JetBrains Mono, monospace",
      getColor: [236, 240, 255, 230], background: true, getBackgroundColor: (d) => [...hex(d.col).slice(0, 3).map((c) => c * 0.3), 200],
      backgroundPadding: [5, 2], parameters: prof, updateTriggers: { getText: ZON.clave, getBackgroundColor: ZON.clave } }));
  }
  capasIconos(L);
  if (CMP.on) $("#cmpEtq").textContent = CMP.antes ? "ANTES" : "DESPUÉS";
}

/* ===================== Alertas ===================== */
const ALE = { yo: null, pron: null, pronK: "", lista: [], cargando: false };
const NIV_ALE = ["#2bd9a0", "#ffd23f", "#ff4d6d"];
async function pronostico(p) {
  const k = p.map((x) => x.toFixed(2)).join() + "|" + Math.floor(horaLocal());
  if (ALE.pronK === k) return ALE.pron;
  const q = `latitude=${p[1].toFixed(3)}&longitude=${p[0].toFixed(3)}&forecast_days=2&timezone=America%2FLa_Paz`;
  const [a, m] = await Promise.all([json("https://air-quality-api.open-meteo.com/v1/air-quality?" + q + "&hourly=pm2_5"),
    json("https://api.open-meteo.com/v1/forecast?" + q + "&hourly=precipitation")]);
  ALE.pron = { pm: a.hourly.pm2_5, ll: m.hourly.precipitation }; ALE.pronK = k;
  return ALE.pron;
}
function traficoA(h, p) {
  calcularTrafico(h);
  const r = { pct: T.resumen.pctLento, vel: T.resumen.vel, crit: T.criticos[0] && { n: nombreCruce(T.criticos[0]), v: T.criticos[0].v } };
  const c = p && traficoCerca(p); if (c) r.cerca = { n: corto(c.v.n), v: c.v.v, nv: c.v.nivel[1] };
  return r;
}
async function calcularAlertas() {
  const p = ALE.yo || PLAZA, out = [], ahora = horaLocal();
  try {
    const f = await pronostico(p);
    const tramo = (d, a, b) => f.pm.slice(d * 24 + a, d * 24 + b).map((x, i) => ({ x, h: a + i })).filter((o) => o.x != null);
    for (const [d, nom] of [[0, "Hoy"], [1, "Mañana"]]) {
      const t = tramo(d, d ? 7 : Math.max(7, Math.ceil(ahora)), 21); if (!t.length) continue;
      const pk = t.reduce((a, b) => (b.x > a.x ? b : a)), c = categoria(pk.x);
      out.push({ k: `aire${d}${c[2]}`, n: pk.x >= 35 ? 2 : pk.x >= 12 ? 1 : 0, ico: "aire", org: "vivo",
        t: `${nom}: aire ${c[2].toLowerCase()}`, d: `PM2,5 hasta ${fmt(pk.x)} µg/m³ cerca de las ${pk.h}:00. ${c[3]}` });
    }
    const llM = f.ll.slice(24, 48), tot = llM.reduce((a, b) => a + (b || 0), 0);
    if (tot >= 1) {
      const horas = llM.map((x, h) => (x >= 0.5 ? h : -1)).filter((h) => h >= 0);
      out.push({ k: "lluvia1", n: tot >= 15 ? 2 : 1, ico: "lluvia", org: "vivo", t: `Mañana llueve: ${fmt(tot)} mm`,
        d: `${horas.length ? `Sobre todo de ${horas[0]}:00 a ${horas[horas.length - 1] + 1}:00. ` : ""}${tot >= 15 ? "Calles anegables: evita los canales y los pasos bajos." : "Lleva paraguas."}` });
    }
  } catch (e) { out.push({ k: "sinpron", n: 0, ico: "aire", org: "resp", t: "Pronóstico no disponible", d: "Open-Meteo no respondió; se reintenta solo." }); }

  if (S.focos) {
    const ult = S.focos.recientes, dist = S.focos.todos.map((f) => ({ f, d: haversine(p, f.p) })).sort((a, b) => a.d - b.d);
    const c10 = dist.filter((o) => o.d < 10000).length, c50 = dist.filter((o) => o.d < 50000).length, cerca = dist[0];
    let humo = "";
    if (cerca && cerca.d < 80000) {
      const b = (Math.atan2((cerca.f.p[0] - p[0]) * Math.cos(p[1] * RAD), cerca.f.p[1] - p[1]) / RAD + 360) % 360;
      const de = campo("dir", S.hora, ...p), dif = Math.abs(((b - de + 540) % 360) - 180);
      if (dif < 45) humo = " El viento sopla desde esos focos: puede llegar humo.";
    }
    out.push({ k: `focos${c10}-${c50}`, n: c10 ? 2 : c50 ? 1 : 0, ico: "focos", org: "sat",
      t: c10 ? `${c10} focos de calor a menos de 10 km` : c50 ? `${c50} focos a menos de 50 km` : "Sin focos de calor cerca",
      d: `${cerca ? `El más cercano está a ${fmt(cerca.d / 1000, 0)} km (${cerca.f.fecha}). ` : ""}${ult.length.toLocaleString("es-BO")} focos en el departamento el último día.${humo}` });
  }

  if (T.listo) {
    const tm = traficoA(7.75, ALE.yo), tt = traficoA(18.75, ALE.yo);
    let mejor = null; for (let h = 16; h <= 21; h++) { const r = T.indice[h]; if (r && (!mejor || r.pctLento < mejor.r)) mejor = { h, r: r.pctLento }; }
    calcularTrafico(S.hora); T.horaCalc = S.hora;
    for (const [r, h, nom] of [[tm, "7:45", "Entrada"], [tt, "18:45", "Salida"]]) {
      const yo = r.cerca ? ` Tu avenida (${r.cerca.n}): ${r.cerca.nv.toLowerCase()}, ~${Math.round(r.cerca.v)} km/h.` : "";
      out.push({ k: `tr${nom}${Math.round(r.pct * 20)}`, n: r.pct > 0.18 ? 2 : r.pct > 0.08 ? 1 : 0, ico: "trafico", org: "est",
        t: `${nom} ${h}: ${Math.round(r.pct * 100)}% de avenidas lentas`,
        d: `${r.crit ? `Lo peor: ${r.crit.n} (~${Math.round(r.crit.v)} km/h).` : ""}${yo}${nom === "Salida" && mejor ? ` Lo más despejado de la tarde: ${mejor.h}:00–${mejor.h + 1}:00.` : ""}` });
    }
    if (R_.A && R_.B && R_.horas?.length && R_.res) {
      const best = R_.horas.reduce((a, b) => (b.min < a.min ? b : a)), ya = Math.round(R_.res.seg / 60);
      out.push({ k: "ruta", n: ya - best.min > 5 ? 1 : 0, ico: "lugares", org: "est", t: `Tu ruta: ${ya} min ahora`,
        d: `${R_.A.nombre} → ${R_.B.nombre}. Mejor salida: ${String(Math.floor(best.h)).padStart(2, "0")}:15 (${Math.round(best.min)} min).` });
    }
  }
  ALE.lista = out.sort((a, b) => b.n - a.n);
  return ALE.lista;
}
async function pintarAlertas() {
  if (ALE.cargando) return; ALE.cargando = true;
  $("#aleDonde").textContent = ALE.yo ? "Cerca de tu ubicación" : "Cerca de la plaza 24 de Septiembre";
  try {
    const l = await calcularAlertas();
    $("#aleLista").innerHTML = l.map((a) => `<div class="alerta" style="--c:${NIV_ALE[a.n]}">
      <span class="ico"><svg viewBox="0 0 24 24">${ICO[a.ico]}</svg></span>
      <div><b>${a.t}</b><span>${a.d}</span></div>${etiquetaOrg(a.org)}</div>`).join("");
  } finally { ALE.cargando = false; }
  pintarHistorial();
}
// Notificaciones del navegador: revisa cada 10 min mientras la página esté abierta y avisa solo lo grave y nuevo.
function avisados() { try { return new Set(JSON.parse(guardado("cv-avisados") || "[]")); } catch (e) { return new Set(); } }
async function revisarNotif() {
  if (guardado("cv-notif") !== "1" || !("Notification" in window) || Notification.permission !== "granted") return;
  const ya = avisados(), hoy = new Date().toISOString().slice(0, 10);
  for (const a of await calcularAlertas()) {
    const k = hoy + a.k; if (a.n < 2 || ya.has(k)) continue;
    ya.add(k); new Notification("Ciudad Viva SCZ · " + a.t, { body: a.d, icon: "icono.svg", tag: a.k });
  }
  guardado("cv-avisados", JSON.stringify([...ya].slice(-60)));
}
async function activarNotif() {
  if (!("Notification" in window)) return aviso("Este navegador no permite notificaciones.");
  if (guardado("cv-notif") === "1") { guardado("cv-notif", "0"); marcarNotif(); return aviso("Avisos apagados en este equipo."); }
  const p = await Notification.requestPermission();
  if (p !== "granted") return aviso("Sin permiso para avisar. Actívalo en el candado de la barra de direcciones.");
  guardado("cv-notif", "1"); marcarNotif(); revisarNotif();
  aviso("Listo: te aviso si el aire se pone malo, hay fuego cerca o se viene un atasco (mientras la página esté abierta).", 4500);
}
function marcarNotif() { const on = guardado("cv-notif") === "1"; $("#aleNotif").classList.toggle("on", on); $("#aleNotif b").textContent = on ? "Avisos activos en este equipo" : "Avisarme en este equipo"; }
function usarUbicacion() {
  if (ALE.yo) { ALE.yo = null; $("#aleYo").classList.remove("on"); return pintarAlertas(); }
  if (!navigator.geolocation) return aviso("Este navegador no da la ubicación.");
  navigator.geolocation.getCurrentPosition((g) => {
    ALE.yo = [g.coords.longitude, g.coords.latitude]; $("#aleYo").classList.add("on");
    if (distM(ALE.yo, PLAZA) > 60000) aviso("Estás lejos de Santa Cruz: las alertas de tráfico usan la avenida más cercana que haya.");
    pintarAlertas();
  }, () => aviso("No pude leer tu ubicación (permiso denegado o sin señal)."), { enableHighAccuracy: false, timeout: 10000 });
}
function telegram() {
  const url = window.CV_TELEGRAM;
  if (url) return window.open(url, "_blank", "noopener");
  aviso("El canal diario de Telegram se manda solo cada mañana a las 7:17 (aire, lluvia, focos y horas pico). Para activarlo: crear el bot con @BotFather y poner <b>TELEGRAM_TOKEN</b> y <b>TELEGRAM_CHAT</b> en los Secrets del repo.", 7000);
}

/* ===================== Fuego en contexto: 25 años (NINAWI) ===================== */
const HIS = { d: null, html: "" };
async function pintarHistorial() {
  const el = $("#fuegoHist"); if (!el) return;
  if (HIS.html) { el.innerHTML = HIS.html; return; }
  try { HIS.d = HIS.d || await json("datos/historico.json"); } catch (e) { el.innerHTML = '<p class="ayuda">Sin datos históricos.</p>'; return; }
  const h = HIS.d, a0 = h.anios[0], n = h.anual.length, max = Math.max(...h.anual), W = 280, H = 74, bw = W / n;
  const prom = h.anual.reduce((a, b) => a + b, 0) / n;
  const barras = h.anual.map((v, i) => { const alto = v / max * (H - 14), malo = v > prom * 1.6;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - 12 - alto).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${alto.toFixed(1)}" rx="1.5" fill="${malo ? "#ff4d6d" : "#ff9f45"}" opacity="${malo ? 1 : 0.6}"><title>${a0 + i}: ${v.toLocaleString("es-BO")} focos</title></rect>`; }).join("");
  const marcas = [0, 9, 18, n - 1].map((i) => `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 1}" text-anchor="middle">${a0 + i}</text>`).join("");
  // esta semana del año frente a lo normal (VIIRS, 2012-2025)
  const hoy = new Date(), dia = Math.floor((hoy - new Date(hoy.getFullYear(), 0, 1)) / 864e5), w = Math.min(h.semanas - 1, Math.floor(dia / 7));
  const vals = []; for (let a = 2012 - a0; a < n; a++) vals.push(h.semanal[a * h.semanas + w]);
  vals.sort((x, y) => x - y);
  const med = vals[Math.floor(vals.length / 2)], p90 = vals[Math.floor(vals.length * 0.9)], ult = S.focos ? S.focos.todos.length : 0;
  const peor = h.anual.indexOf(max), ratio = med ? ult / med : 0;
  const frase = !med ? "" : ratio > 1.5 ? `<b>${fmt(ratio, 1)} veces</b> más de lo normal para esta semana del año.` : ratio < 0.6 ? "por debajo de lo normal para esta semana del año." : "dentro de lo normal para esta semana del año.";
  HIS.html = `<svg viewBox="0 0 ${W} ${H}" class="hist">${barras}${marcas}</svg>
    <p class="ayuda">Peor año: <b>${a0 + peor}</b> con ${max.toLocaleString("es-BO")} focos (escala VIIRS). En rojo, los años con 60 % más que el promedio.</p>
    <div class="consejo">Últimos 7 días: <b>${ult.toLocaleString("es-BO")}</b> focos en el departamento: ${frase}
    <small>Normal (mediana 2012–2025): ${med.toLocaleString("es-BO")} · año malo: ${p90.toLocaleString("es-BO")}.</small></div>
    <p class="fuente-mini">${etiquetaOrg("sat")} NINAWI: NASA FIRMS MODIS + VIIRS armonizados, 2001–2025.</p>`;
  el.innerHTML = HIS.html;
}

/* ===================== Comparador antes / después ===================== */
const CMP = { on: false, antes: false, guard: null, t: 0 };
function verAntes(si) {
  if (si === CMP.antes || !SIM.base) return;
  if (si) {
    CMP.guard = T.vias.map((v) => [v.v, v.r, v.nivel, v.cerrada]);
    for (const v of T.vias) { v.v = SIM.base.v[v.i]; v.r = v.v / VLIBRE[v.c]; v.nivel = nivel(v.r); v.cerrada = false; }
  } else if (CMP.guard) {
    T.vias.forEach((v, i) => { [v.v, v.r, v.nivel, v.cerrada] = CMP.guard[i]; }); CMP.guard = null;
  }
  CMP.antes = si; T.horaCalc = S.hora + (si ? 0.001 : -0.001); // cambia los disparadores sin recalcular
}
function comparar(on) {
  if (on && !(T.sim.cerradas.size || T.sim.lluvia)) return aviso("Primero cierra una avenida, elige un escenario o activa la lluvia.");
  CMP.on = on; clearInterval(CMP.t); verAntes(false);
  $("#cmpEtq").hidden = !on; $("#simComparar").classList.toggle("on", on);
  if (on) CMP.t = setInterval(() => {
    if (S.tab !== "sim" || !(T.sim.cerradas.size || T.sim.lluvia)) return comparar(false);
    verAntes(!CMP.antes);
  }, 1700);
}

/* ===================== Captura para compartir ===================== */
async function captura() {
  await new Promise((ok) => { mapa.once("render", ok); mapa.triggerRepaint(); });
  const src = mapa.getCanvas(), W = src.width, Hm = src.height, k = W / 1400, banda = Math.round(170 * k);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = Hm + banda;
  const g = cv.getContext("2d");
  g.drawImage(src, 0, 0);
  const grad = g.createLinearGradient(0, Hm, W, Hm); grad.addColorStop(0, "#0b1230"); grad.addColorStop(1, "#1a1040");
  g.fillStyle = grad; g.fillRect(0, Hm, W, banda);
  g.fillStyle = "#2bd9a0"; g.fillRect(0, Hm, W, Math.max(2, 3 * k));
  const px = (n) => Math.round(n * k) + "px";
  g.fillStyle = "#e8eeff"; g.font = `700 ${px(38)} "Space Grotesk", sans-serif`; g.fillText("Ciudad Viva SCZ", 36 * k, Hm + 58 * k);
  g.fillStyle = "#93a0c4"; g.font = `500 ${px(20)} "Space Grotesk", sans-serif`;
  const fecha = new Date().toLocaleDateString("es-BO", { day: "numeric", month: "long" });
  g.fillText(`${fecha} · ${hhmm(S.hora)} · ${$("#estado").textContent.toLowerCase()}`, 36 * k, Hm + 92 * k);
  const pm = promedio("pm25", S.hora), datos = [
    T.resumen && [`${Math.round(T.resumen.pctLento * 100)}%`, "avenidas lentas (estimado)", nivel(Math.max(0, 1 - T.resumen.pctLento * 2.4))[2]],
    [fmt(pm), `PM2,5 · ${categoria(pm)[2].toLowerCase()}`, ESCALA.find((e) => e[2] === categoria(pm)[2])[1]],
    S.focos && [S.focos.todos.length.toLocaleString("es-BO"), "focos de calor en 7 días", "#ff9f45"],
  ].filter(Boolean);
  datos.forEach(([v, t, c], i) => {
    const x = W * 0.42 + i * W * 0.19;
    g.fillStyle = c; g.font = `700 ${px(40)} "JetBrains Mono", monospace`; g.fillText(v, x, Hm + 66 * k);
    g.fillStyle = "#93a0c4"; g.font = `500 ${px(16)} "Space Grotesk", sans-serif`; g.fillText(t, x, Hm + 94 * k);
  });
  const tit = $("#simInfo .titular")?.textContent;
  g.fillStyle = "#c9d2f0"; g.font = `500 ${px(16)} "Space Grotesk", sans-serif`;
  const pie = tit && S.tab === "sim" ? tit : "Datos: OpenStreetMap · NASA FIRMS · Open-Meteo/CAMS · tráfico estimado · neckhurtttt.github.io/ciudad-viva";
  let linea = "", y = Hm + 124 * k;
  for (const w of pie.split(" ")) { // parte el texto en renglones que entren
    if (g.measureText(linea + w).width > W - 72 * k && linea) { g.fillText(linea, 36 * k, y); y += 21 * k; linea = ""; }
    linea += w + " ";
  }
  g.fillText(linea, 36 * k, y);
  const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
  const nombre = `ciudad-viva-${hhmm(S.hora).replace(":", "")}.png`, file = new File([blob], nombre, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ files: [file], title: "Ciudad Viva SCZ", text: enlace() }); return; } catch (e) {}
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  aviso(`Captura guardada: <b>${nombre}</b>`);
}

/* ===================== Voz y modo kiosco ===================== */
const VOZ = { on: guardado("cv-voz") === "1", ult: "" };
function hablar(t) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t), voces = speechSynthesis.getVoices();
  u.lang = "es-ES"; u.voice = voces.find((v) => /^es[-_](BO|419|MX|US|AR)/i.test(v.lang)) || voces.find((v) => /^es/i.test(v.lang)) || null; u.rate = 1.03;
  speechSynthesis.speak(u);
}
function marcarVoz() { const b = $("#guionVoz"); if (b) { b.classList.toggle("on", VOZ.on); b.textContent = VOZ.on ? "🔊 Voz" : "🔈 Voz"; } }
new MutationObserver(() => {
  if (!PRES.on || !VOZ.on) return;
  const t = `${$("#guion h3").textContent}. ${$("#guion p").textContent}`;
  if (t !== VOZ.ult) { VOZ.ult = t; hablar(t); }
}).observe($("#guion"), { childList: true, characterData: true, subtree: true });

const KIO = { on: false };
function kiosco(on) {
  KIO.on = on; document.body.classList.toggle("kiosco", on);
  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {});
    if (!PRES.on) presentar();
  } else {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (PRES.on) salirPresentacion();
  }
}
const salirOriginal = salirPresentacion;
salirPresentacion = function () { // al terminar la presentación: en kiosco vuelve a empezar sola
  salirOriginal(); VOZ.ult = ""; window.speechSynthesis?.cancel();
  if (KIO.on) setTimeout(() => { if (KIO.on && !PRES.on) presentar(); }, 5000);
};

/* ===================== Paleta para daltónicos ===================== */
const DALT = { orig: NIVELES.map((n) => n[2]), alt: ["#3b9eff", "#a9bde0", "#ffc233", "#ff7b00", "#b0306f"], on: guardado("cv-dalt") === "1" };
function aplicarDalt() {
  NIVELES.forEach((n, i) => { n[2] = DALT.on ? DALT.alt[i] : DALT.orig[i]; });
  T.horaCalc = -1; ZON.clave = ""; const el = $("#secTrafico"); if (el) el.dataset.h = "";
  if (T.listo) pintarTrafico();
  $("#dalt").classList.toggle("on", DALT.on);
}

/* ===================== Panel de tráfico con zonas ===================== */
const pintarTraficoOriginal = pintarTrafico;
pintarTrafico = function () {
  pintarTraficoOriginal();
  const el = $("#secTrafico"); if (!T.listo || !ZON.lista.length || !el) return;
  const k = ZON.clave; calcularZonas();
  const prev = el.querySelector(".zonas-lista");
  if (!prev || k !== ZON.clave || el.dataset.z !== el.dataset.h) { prev?.remove(); el.insertAdjacentHTML("beforeend", listaZonas()); el.dataset.z = el.dataset.h; }
};

/* ===================== Edificios icónicos ===================== */
// Planta real de OpenStreetMap y altura publicada (Wikipedia). La Catedral no tiene medidas publicadas:
// la nave usa los 4 niveles de OSM y las dos torres del frente que da a la plaza son una estimación.
const ICN = { lista: [], patron: "", ocultos: new Set(), filtros: {}, t: 0 };
const aMetros = (p, c) => [(p[0] - c[0]) * KM_LON * 1000, (p[1] - c[1]) * KM_LAT * 1000];
const aGrados = (m, c) => [c[0] + m[0] / (KM_LON * 1000), c[1] + m[1] / (KM_LAT * 1000)];
function centroide(r) { const n = r.length - (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? 1 : 0); let x = 0, y = 0; for (let i = 0; i < n; i++) { x += r[i][0]; y += r[i][1]; } return [x / n, y / n]; }
const escalar = (r, c, f) => r.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f]);
function torresCatedral(r, c) {
  // caja orientada de la planta (eje principal); la fachada es el lado de la caja más cercano a la plaza 24 de Septiembre
  const pts = r.map((p) => aMetros(p, c));
  let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { sxx += x * x; syy += y * y; sxy += x * y; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), u = [Math.cos(ang), Math.sin(ang)], v = [-u[1], u[0]];
  const pu = pts.map((p) => p[0] * u[0] + p[1] * u[1]), pv = pts.map((p) => p[0] * v[0] + p[1] * v[1]);
  const u0 = Math.min(...pu), u1 = Math.max(...pu), v0 = Math.min(...pv), v1 = Math.max(...pv);
  const en = (a, b) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b];
  const lados = [[u0, "u", 1], [u1, "u", -1], [v0, "v", 1], [v1, "v", -1]].map(([val, eje, dentro]) => {
    const mid = eje === "u" ? en(val, (v0 + v1) / 2) : en((u0 + u1) / 2, val);
    return { val, eje, dentro, d: distM(aGrados(mid, c), PLAZA_24) };
  }).sort((a, b) => a.d - b.d);
  const f = lados[0], largo = f.eje === "u" ? v1 - v0 : u1 - u0, lado = Math.max(5, Math.min(9, largo / 4.5));
  const cuadro = (a, b, l) => { const q = (x, y) => aGrados(f.eje === "u" ? en(x, y) : en(y, x), c);
    return [q(a, b), q(a + l * f.dentro, b), q(a + l * f.dentro, b + l), q(a, b + l), q(a, b)]; };
  const ini = f.eje === "u" ? v0 : u0, fin = f.eje === "u" ? v1 : u1, out = [];
  for (const b of [ini + 0.4, fin - lado - 0.4]) {
    out.push({ poly: cuadro(f.val, b, lado), base: 0, h: 30 });
    out.push({ poly: cuadro(f.val + lado * 0.22 * f.dentro, b + lado * 0.22, lado * 0.56), base: 30, h: 37 }); // linterna
  }
  return out;
}
// también se ocultan las partes (torres, cúpulas) del mapa base cuyo centro cae dentro de la planta
function aplicarOcultos() {
  const sin = ["!", ["in", ["id"], ["literal", [...ICN.ocultos]]]];
  for (const id of ["edificios-3d", "edificios-altos", "edificios-borde"]) if (mapa.getLayer(id)) {
    if (!(id in ICN.filtros)) ICN.filtros[id] = mapa.getFilter(id) || null;
    mapa.setFilter(id, ICN.filtros[id] ? ["all", ICN.filtros[id], sin] : sin);
  }
}
function ocultarDuplicados() {
  if (!ICN.lista.length || mapa.getZoom() < 13) return;
  let nuevos = false;
  for (const f of mapa.querySourceFeatures("openmaptiles", { sourceLayer: "building" })) {
    if (f.id == null || ICN.ocultos.has(f.id)) continue;
    const g = f.geometry, r = g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
    if (!r || !ICN.lista.some((e) => Math.abs(e.c[0] - r[0][0]) < 0.003 && Math.abs(e.c[1] - r[0][1]) < 0.003)) continue;
    const c = centroide(r);
    if (ICN.lista.some((e) => dentroPoligono(c, e.p))) { ICN.ocultos.add(f.id); nuevos = true; }
  }
  if (nuevos) aplicarOcultos();
}
async function edificiosIconicos() {
  const d = await json("datos/iconos.json"), feats = [];
  for (const e of d.edificios) {
    const r = e.p.slice(); if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0]);
    e.c = centroide(r);
    const f = (poly, base, h, tipo) => feats.push({ type: "Feature", properties: { n: e.n, base, h, tipo }, geometry: { type: "Polygon", coordinates: [poly] } });
    if (e.h > 0) { f(escalar(r, e.c, 1.04), 0, e.h, "torre"); e.techo = e.h; }
    else { f(escalar(r, e.c, 1.03), 0, 16, "templo"); for (const t of torresCatedral(r, e.c)) f(t.poly, t.base, t.h, "templo"); e.techo = 37; }
    ICN.lista.push(e);
  }
  // el mapa base ya trae estos edificios (id de mosaico = id de OSM × 10 + 2): se ocultan para no duplicarlos
  for (const e of ICN.lista) ICN.ocultos.add(e.osm * 10 + 2);
  aplicarOcultos();
  const luego = () => { clearTimeout(ICN.t); ICN.t = setTimeout(ocultarDuplicados, 500); };
  mapa.on("moveend", luego);
  mapa.on("sourcedata", (e) => { if (e.sourceId === "openmaptiles" && e.tile) luego(); }); // mosaicos que llegan después
  setTimeout(ocultarDuplicados, 1500);
  const primerTexto = mapa.getStyle().layers.find((l) => l.type === "symbol")?.id;
  mapa.addSource("iconos", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
  mapa.addLayer({ id: "iconos-base", type: "line", source: "iconos", minzoom: 12, filter: ["==", ["get", "base"], 0],
    paint: { "line-color": ["match", ["get", "tipo"], "templo", "#ffb27a", "#40e0ff"], "line-width": 2.5, "line-blur": 2, "line-opacity": 0.8 } }, primerTexto);
  mapa.addLayer({ id: "iconos-3d", type: "fill-extrusion", source: "iconos", minzoom: 12, filter: ["==", ["get", "tipo"], "torre"],
    paint: { "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 12, 0, 13, ["get", "h"]], "fill-extrusion-base": ["get", "base"],
      "fill-extrusion-color": ["interpolate", ["linear"], ["get", "h"], 95, "#2f7fb8", 140, "#5fd2ff"], "fill-extrusion-vertical-gradient": true,
      "fill-extrusion-opacity": 0.96 } }, primerTexto);
  mapa.addLayer({ id: "iconos-templo", type: "fill-extrusion", source: "iconos", minzoom: 12, filter: ["==", ["get", "tipo"], "templo"],
    paint: { "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 12, 0, 13, ["get", "h"]], "fill-extrusion-base": ["get", "base"],
      "fill-extrusion-color": "#b8664a", "fill-extrusion-vertical-gradient": true, "fill-extrusion-opacity": 1 } }, primerTexto);
}
function capasIconos(L) {
  aplicarDiaNoche(); capasBordes(L); capasCasas(L);
  if (!ICN.lista.length || !S.capas.edificios) return;
  if (AMB.dPatron && AMB.dPatron !== ICN.patron && mapa.getLayer("iconos-3d")) { // vidrio claro de día, encendido de noche
    ICN.patron = AMB.dPatron; const dia = AMB.dPatron === "dia";
    mapa.setPaintProperty("iconos-3d", "fill-extrusion-color", ["interpolate", ["linear"], ["get", "h"], 95, dia ? "#3d8fc4" : "#1f5f99", 140, dia ? "#8fe3ff" : "#47c8ff"]);
  }
  const z = mapa.getZoom(); if (z < 13.2 || !S.capas.lugares) return;
  const c0 = mapa.getCenter().toArray(), cerca = ICN.lista.filter((e) => distM(e.c, c0) < (z > 15 ? 2500 : 7000));
  L.push(new TextLayer({ id: "iconos-txt", data: cerca, getPosition: (d) => [...d.c, d.techo + 6], billboard: true, characterSet: "auto",
    getText: (d) => `${d.n}\n${d.h ? `${d.h} m · ${d.pisos} pisos` : "torres: altura estimada"}`, getSize: 11, sizeUnits: "pixels",
    fontFamily: "Space Grotesk, system-ui, sans-serif", fontWeight: 600, getColor: [236, 245, 255, 255], getTextAnchor: "middle", getAlignmentBaseline: "bottom",
    background: true, getBackgroundColor: (d) => (d.h ? [8, 40, 56, 215] : [60, 28, 16, 215]), backgroundPadding: [6, 3],
    getBorderColor: (d) => (d.h ? [64, 224, 255, 200] : [255, 178, 122, 200]), getBorderWidth: 1 }));
}
const indiceOriginal = indiceBusqueda;
indiceBusqueda = function () {
  return indiceOriginal().concat(ICN.lista.map((e) => ({ t: e.n, s: e.h ? `Edificio · ${e.h} m · ${e.pisos} pisos · ${e.anio}` : "Templo · 1915", c: e.h ? "#40e0ff" : "#ffb27a", p: e.c, tipo: "lugar" })));
};

/* ===================== Todos los edificios: fachadas, techos y día/noche ===================== */
// Cada edificio del mapa base (OpenStreetMap) recibe una fachada según su altura y un techo encima.
// La variante sale de su id, así cada casa se ve distinta pero siempre igual entre visitas.
const EDF = { patron: "", listo: false, bordes: [], techos: [], t: 0, v: 0 };
const OSMID = ["floor", ["/", ["to-number", ["id"], 0], 10]]; // id de mosaico = id OSM × 10 + tipo
const VAR = ["%", OSMID, 4];
function texturaFachada(pared, marco, vidrio, luces, pisos, conPuerta, semilla, prob) {
  // fachada oscura con ventanas reales por piso; "prob" = cuántas ventanas tienen luz
  const W = 64, H = 64, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); let s0 = semilla; const rnd = () => ((s0 = (s0 * 16807) % 2147483647) / 2147483647);
  g.fillStyle = pared; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "140,255,220"},${0.02 + rnd() * 0.03})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
  const alto = H / pisos;
  for (let p = 0; p < pisos; p++) {
    const y = p * alto;
    g.fillStyle = "rgba(43,217,160,.10)"; g.fillRect(0, y + alto - 1.5, W, 1.5); // losa de cada piso con brillo verde
    const n = pisos > 2 ? 4 : 2, ancho = W / n;
    for (let k = 0; k < n; k++) {
      const x = k * ancho + ancho * 0.2, w = ancho * 0.6, h = alto * 0.52, yy = y + alto * 0.2;
      const puerta = conPuerta && p === pisos - 1 && k === 1;
      g.fillStyle = marco; g.fillRect(x - 1, yy - 1, w + 2, (puerta ? alto * 0.78 : h) + 2);
      const luz = rnd() < prob ? luces[(rnd() * luces.length) | 0] : null;
      g.fillStyle = puerta ? "#0c1a1c" : luz || vidrio;
      g.fillRect(x, yy, w, puerta ? alto * 0.78 : h);
      if (luz) { g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(x, yy, w, 1); }
      else if (!puerta) { g.fillStyle = "rgba(160,220,255,.14)"; g.fillRect(x, yy, w * 0.4, h); } // reflejo
    }
  }
  return g.getImageData(0, 0, W, H);
}
// Colores de fachada como en Santa Cruz: cada edificio toma uno según su id de OSM (siempre el mismo).
// OSM casi nunca trae el color real (building:colour), así que es una paleta realista, no la foto de cada uno.
const CASAS = [ // pared, marco
  ["#ece6d8", "#7a7268"], ["#e8d7b0", "#8a6a4a"], ["#e8c06a", "#7a5a2a"], ["#d39a55", "#6a4a2a"],
  ["#b4604a", "#5a2e22"], ["#e0a090", "#7a4a44"], ["#a9cde0", "#4d6b7a"], ["#a8d4b8", "#4a6a56"],
];
const MEDIOS = [["#b9bcc0", "#4a4e54"], ["#e4e4e0", "#6a6a66"], ["#a65a44", "#4a261c"], ["#d6c7a6", "#6a5a40"], ["#8fa3b5", "#3a4a5a"], ["#cdb48c", "#5a4a32"]];
const TECHOS = ["#b5603f", "#a3a39e", "#c4c1b8", "#8d9aa3", "#a8423a", "#4f7a5c", "#4d6f8f", "#ddd8cc", "#9a4a32", "#6f7378", "#d8cfb8", "#5f8fa8"];
const LUCES_N = ["#ffe1a8", "#ffd58a", "#c8f4ff", "#9fe9ff", "#7dffd4"];
function texturasEdificios() {
  CASAS.forEach(([p, m], i) => {
    mapa.addImage(`casa-d-${i}`, texturaFachada(p, m, "#4f6b85", [], 2, true, 11 + i, 0), { pixelRatio: 2 });
    mapa.addImage(`casa-n-${i}`, texturaFachada(mezcla(p, "#0a0f22", 0.62), mezcla(m, "#0a0f22", 0.6), "#0d1426", LUCES_N, 2, true, 11 + i, 0.42), { pixelRatio: 2 });
  });
  MEDIOS.forEach(([p, m], i) => {
    mapa.addImage(`medio-d-${i}`, texturaFachada(p, m, "#5d7fa3", [], 4, false, 41 + i, 0), { pixelRatio: 2 });
    mapa.addImage(`medio-n-${i}`, texturaFachada(mezcla(p, "#0a0f22", 0.66), mezcla(m, "#0a0f22", 0.6), "#0b1222", LUCES_N, 4, false, 41 + i, 0.48), { pixelRatio: 2 });
  });
}
const patronPor = (pref, dia, n) => { const m = ["match", ["%", OSMID, n]]; for (let i = 0; i < n - 1; i++) m.push(i, `${pref}-${dia}-${i}`); m.push(`${pref}-${dia}-${n - 1}`); return m; };
const SIN_PARTES = ["!=", ["get", "hide_3d"], true]; // el contorno de un edificio que ya tiene partes 3D
const losa = (h) => (h < 9 ? 0.6 : 1.2);
function mejorarEdificios() {
  if (EDF.listo || !mapa.getLayer("edificios-3d")) return;
  texturasEdificios();
  const conFiltro = (id) => { const f0 = ICN.filtros[id] !== undefined ? ICN.filtros[id] : mapa.getFilter(id); ICN.filtros[id] = f0 ? ["all", f0, SIN_PARTES] : SIN_PARTES; };
  for (const id of ["edificios-3d", "edificios-altos", "edificios-borde"]) conFiltro(id);
  aplicarOcultos();
  const primerTexto = mapa.getStyle().layers.find((l) => l.type === "symbol")?.id;
  mapa.setPaintProperty("edificios-3d", "fill-extrusion-opacity", 1);
  mapa.setPaintProperty("edificios-borde", "line-color", "#2bd9a0");
  mapa.setPaintProperty("edificios-borde", "line-opacity", 0.45);
  // techo plano oscuro (losa) encima de cada edificio; el borde neón lo dibuja deck.gl
  mapa.addLayer({ id: "techos", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14, maxzoom: 14.8,
    filter: ["all", ["<", ALTURA, 40], SIN_PARTES],
    paint: { "fill-extrusion-base": ALTURA, "fill-extrusion-height": ["+", ALTURA, ["case", ["<", ALTURA, 9], 0.6, 1.2]],
      "fill-extrusion-color": "#0f2a2c", "fill-extrusion-opacity": 1 } }, primerTexto);
  const luego = () => { clearTimeout(EDF.t); EDF.t = setTimeout(bordesTechos, 350); };
  mapa.on("moveend", luego);
  mapa.on("sourcedata", (e) => { if (e.sourceId === "openmaptiles" && e.tile) { EDF.nuevos = true; luego(); } });
  EDF.listo = true; EDF.patron = "";
  aplicarDiaNoche(); luego();
}
// El mapa base junta en una sola pieza los edificios de igual altura, así que el color por id no alcanza.
// Por eso cada techo cercano se dibuja aparte con deck.gl: su propio color (como en la vida real) y su borde verde neón.
const hashP = (p) => { let h = Math.round(p[0] * 1e5) * 73856093 ^ Math.round(p[1] * 1e5) * 19349663; return Math.abs(h); };
function bordesTechos() {
  if (mapa.getZoom() < 14.8) { EDF.bordes = []; EDF.techos = []; return; }
  const z0 = mapa.getZoom(), c0 = mapa.getCenter().toArray(), radio = z0 > 16.5 ? 1100 : z0 > 15.6 ? 1900 : 3000;
  const bordes = [], techos = [], vistos = new Set(), tope = { alta: 12000, media: 7000, baja: 3000 }[Q.nivel] || 12000;
  const banda = Math.round(z0 * 2) + Q.nivel;
  if (EDF.centro && EDF.banda === banda && distM(EDF.centro, c0) < radio * 0.25 && !EDF.nuevos) return;
  EDF.centro = c0; EDF.banda = banda; EDF.nuevos = false;
  for (const f of mapa.querySourceFeatures("openmaptiles", { sourceLayer: "building" })) {
    const pr = f.properties; if (pr.hide_3d || ICN.ocultos.has(f.id)) continue;
    const g = f.geometry, polis = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    const h = pr.render_height || 6;
    for (const poli of polis) {
      const r = poli[0]; if (!r || r.length < 4) continue;
      if (Math.abs(r[0][0] - c0[0]) > 0.03 || Math.abs(r[0][1] - c0[1]) > 0.03 || distM(r[0], c0) > radio) continue;
      const k = r[0][0].toFixed(6) + r[0][1].toFixed(6) + r.length; if (vistos.has(k)) continue; vistos.add(k);
      const cx = r.reduce((a, p) => a + p[0], 0) / r.length, cy = r.reduce((a, p) => a + p[1], 0) / r.length;
      const z = h + 0.08, alto = h >= 40 ? 2 : h >= 9 ? 1 : 0;
      techos.push({ poly: poli.map((ring) => ring.map((p) => [p[0], p[1], z])), c: hashP([cx, cy]), alto });
      bordes.push({ path: r.map((p) => [p[0], p[1], z + 0.12]), alto });
      if (techos.length > tope) break;
    }
    if (techos.length > tope) break;
  }
  EDF.bordes = bordes; EDF.techos = techos; EDF.v++;
}
function capasBordes(L) {
  if (!EDF.techos?.length || !S.capas.edificios || mapa.getZoom() < 14.8) return;
  const noche = (AMB.dPatron || "noche") !== "dia", a = clamp((mapa.getZoom() - 14.8) / 0.4, 0, 1);
  const col = EDF.cols || (EDF.cols = {});
  const clave = noche ? "n" : "d";
  if (!col[clave]) col[clave] = TECHOS.map((c) => hex(noche ? mezcla(c, "#0a0f22", 0.62) : mezcla(c, "#7d848c", 0.22)));
  L.push(new SolidPolygonLayer({ id: "techos-color", data: EDF.techos, getPolygon: (d) => d.poly, filled: true, extruded: false,
    getFillColor: (d) => (d.alto === 2 ? [40, 120, 160] : col[clave][d.c % TECHOS.length]), opacity: a,
    updateTriggers: { getFillColor: [clave, EDF.v] } }));
  L.push(new PathLayer({ id: "techo-neon", data: EDF.bordes, getPath: (d) => d.path, widthUnits: "pixels",
    getWidth: (d) => (d.alto === 2 ? 1.6 : 1.1), getColor: (d) => (d.alto === 2 ? [64, 224, 255, noche ? 230 : 170] : [43, 217, 160, noche ? (d.alto ? 210 : 160) : 130]), opacity: a,
    updateTriggers: { getColor: [noche, EDF.v] } }));
}
function aplicarDiaNoche() {
  const dia = (AMB.dPatron || "noche") === "dia" ? "d" : "n";
  if (!EDF.listo || EDF.patron === dia) return; EDF.patron = dia;
  mapa.setPaintProperty("edificios-3d", "fill-extrusion-pattern", patronPor("casa", dia, CASAS.length));
  mapa.setPaintProperty("edificios-altos", "fill-extrusion-pattern", ["case", [">", ALTURA, 40],
    dia === "d" ? "vidrio-frio" : "ventanas-frio", patronPor("medio", dia, MEDIOS.length)]);
  // techos como en la vida real: teja, hormigón, calamina pintada (roja, verde, azul) y terrazas; de noche se oscurecen
  const t = (c) => (dia === "d" ? c : mezcla(c, "#0a0f22", 0.66));
  const m = ["match", ["%", ["floor", ["/", OSMID, 3]], TECHOS.length]]; // otro reparto que el de las paredes
  TECHOS.forEach((c, i) => { if (i < TECHOS.length - 1) m.push(i, t(c)); else m.push(t(c)); });
  mapa.setPaintProperty("techos", "fill-extrusion-color", m);
}

/* ===================== Todas las casas (Overture Maps: Google + Microsoft) ===================== */
// OpenStreetMap no tiene todas las casas de Santa Cruz. Overture Maps junta las que Google Open Buildings
// y Microsoft detectaron en imágenes satelitales; aquí van solo las que no están en OSM (esas ya las dibuja el mapa base).
const CAS = { idx: null, celdas: new Map(), lista: [], v: 0, t: 0 };
async function iniciarCasas() {
  try { CAS.idx = await json("datos/casas.json"); } catch (e) { console.warn("sin casas de Overture", e); return; }
  const luego = () => { clearTimeout(CAS.t); CAS.t = setTimeout(cargarCasas, 300); };
  mapa.on("moveend", luego); luego();
}
function altoEstimado(area, k) { // sin altura en los datos: por el tamaño de la planta (1 o 2 pisos en casas, más en galpones)
  if (area < 45) return 2.8 + (k % 3) * 0.3;
  if (area < 160) return k % 4 === 0 ? 6.2 : 3.2 + (k % 5) * 0.25;
  if (area < 600) return k % 3 === 0 ? 9 : 6;
  return 7 + (k % 4) * 1.5;
}
function decodificar(clave, lista) {
  const [ix, iy] = clave.split("_").map(Number), { caja, celda, q } = CAS.idx, bx = caja[0] + ix * celda, by = caja[1] + iy * celda, out = [];
  for (const e of lista) {
    let x = e[1], y = e[2]; const r = [[bx + x / q, by + y / q]];
    for (let i = 3; i < e.length; i += 2) { x += e[i]; y += e[i + 1]; r.push([bx + x / q, by + y / q]); }
    r.push(r[0]);
    let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
    const area = Math.abs(a / 2) * (KM_LON * 1000) * (KM_LAT * 1000), k = hashP(r[0]);
    if (area > 12000 || area < 12) continue; // errores de detección: manchas que cubren manzanas enteras, o puntos
    let cx = 0, cy = 0; for (let i = 0; i < r.length - 1; i++) { cx += r[i][0]; cy += r[i][1]; }
    out.push({ poly: r, h: e[0] ? e[0] / 10 : altoEstimado(area, k), c: k, p: [cx / (r.length - 1), cy / (r.length - 1)] });
  }
  return out;
}
async function cargarCasas() {
  if (!CAS.idx) return;
  const z = mapa.getZoom(); if (z < 14) { if (CAS.lista.length) { CAS.lista = []; CAS.v++; } return; }
  const c0 = mapa.getCenter().toArray(), fq = { alta: 1, media: 0.75, baja: 0.5 }[Q.nivel] || 1;
  const radio = (z > 16.5 ? 1100 : z > 15.4 ? 1800 : 2600) * fq, tope = { alta: 28000, media: 14000, baja: 6000 }[Q.nivel] || 28000;
  const banda = Math.round(z * 2) + Q.nivel;
  if (CAS.centro && CAS.banda === banda && distM(CAS.centro, c0) < radio * 0.3) return; // casi no se movió: se queda lo que hay
  const { caja, celda } = CAS.idx, cerca = [];
  for (const clave of Object.keys(CAS.idx.celdas)) {
    const [ix, iy] = clave.split("_").map(Number), cx = caja[0] + (ix + 0.5) * celda, cy = caja[1] + (iy + 0.5) * celda;
    if (distM([cx, cy], c0) < radio + 1600) cerca.push(clave);
  }
  await Promise.all(cerca.filter((k) => !CAS.celdas.has(k)).map(async (k) => {
    CAS.celdas.set(k, []); try { CAS.celdas.set(k, decodificar(k, await json(`datos/casas/${k}.json`))); } catch (e) { CAS.celdas.delete(k); }
  }));
  const lista = [], osm = indiceOSM();
  for (const k of cerca) for (const b of CAS.celdas.get(k) || []) if (distM(b.p, c0) < radio && !enOSM(osm, b.p)) lista.push(b);
  CAS.lista = lista.length > tope ? lista.sort((a, b) => distM(a.p, c0) - distM(b.p, c0)).slice(0, tope) : lista; CAS.v++;
  CAS.centro = c0; CAS.banda = banda;
}
// Edificios de OSM ya cargados en los mosaicos: se usa su planta para no duplicar la casa de Microsoft.
const G_OSM = 0.0004;
function indiceOSM() {
  const idx = new Map();
  for (const f of mapa.querySourceFeatures("openmaptiles", { sourceLayer: "building" })) {
    const g = f.geometry, polis = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poli of polis) {
      const r = poli[0]; if (!r || r.length < 4) continue;
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const p of r) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
      if (c - a > 0.01 || d - b > 0.01) continue;
      for (let x = Math.floor(a / G_OSM); x <= Math.floor(c / G_OSM); x++) for (let y = Math.floor(b / G_OSM); y <= Math.floor(d / G_OSM); y++) {
        const k = x + ":" + y; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(r);
      }
    }
  }
  return idx;
}
const enOSM = (idx, p) => (idx.get(Math.floor(p[0] / G_OSM) + ":" + Math.floor(p[1] / G_OSM)) || []).some((r) => dentroPoligono(p, r));
function capasCasas(L) {
  if (!CAS.lista.length || !S.capas.edificios || mapa.getZoom() < 14) return;
  const noche = (AMB.dPatron || "noche") !== "dia", a = clamp((mapa.getZoom() - 14) / 0.5, 0, 1), clave = noche ? "n" : "d";
  const col = EDF.cols || (EDF.cols = {});
  if (!col[clave]) col[clave] = TECHOS.map((c) => hex(noche ? mezcla(c, "#0a0f22", 0.62) : mezcla(c, "#7d848c", 0.22)));
  // el color va por casa y solo se recalcula si cambian las casas o el día/noche; la aparición al hacer zoom usa la opacidad de la capa
  L.push(new SolidPolygonLayer({ id: "casas-ms", data: CAS.lista, getPolygon: (d) => d.poly, extruded: true, wireframe: Q.nivel === "alta",
    getElevation: (d) => d.h, getFillColor: (d) => col[clave][d.c % TECHOS.length], opacity: a,
    getLineColor: noche ? [43, 217, 160, 170] : [43, 217, 160, 110], material: { ambient: 0.45, diffuse: 0.65, shininess: 8, specularColor: [40, 60, 60] },
    updateTriggers: { getFillColor: [clave, CAS.v], getLineColor: noche } }));
}

/* ===================== Arranque ===================== */
function eventosMejoras() {
  $("#metodoAbrir").onclick = () => $("#metodo").showModal();
  $("#fuentes").onclick = () => $("#metodo").showModal();
  $("#metodoCerrar").onclick = () => $("#metodo").close();
  $("#metodo").addEventListener("click", (e) => { if (e.target === $("#metodo")) $("#metodo").close(); });
  $("#captura").onclick = () => captura().catch((e) => { console.error(e); aviso("No se pudo hacer la captura."); });
  $("#kiosco").onclick = () => kiosco(!KIO.on);
  $("#dalt").onclick = () => { DALT.on = !DALT.on; guardado("cv-dalt", DALT.on ? "1" : "0"); aplicarDalt(); };
  $("#guionVoz").onclick = () => { VOZ.on = !VOZ.on; guardado("cv-voz", VOZ.on ? "1" : "0"); marcarVoz(); if (VOZ.on && PRES.on) { VOZ.ult = ""; hablar(`${$("#guion h3").textContent}. ${$("#guion p").textContent}`); } else window.speechSynthesis?.cancel(); };
  $("#guionSalir").addEventListener("click", () => { if (KIO.on) kiosco(false); window.speechSynthesis?.cancel(); });
  $("#simComparar").onclick = () => comparar(!CMP.on);
  $("#simReset").addEventListener("click", () => comparar(false));
  $("#aleYo").onclick = usarUbicacion;
  $("#aleNotif").onclick = activarNotif;
  $("#aleTele").onclick = telegram;
  $("#secTrafico").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-z]"); if (!li) return;
    const z = ZON.lista[+li.dataset.z]; S.capas.zonas = true; document.querySelector('.capa[data-k="zonas"]')?.classList.add("on");
    mapa.flyTo({ center: z.c, zoom: 13.6, pitch: 50, duration: 1800, essential: true });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && KIO.on) kiosco(false); });
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && KIO.on) kiosco(false); });
  marcarVoz(); marcarNotif();
  setInterval(revisarNotif, 10 * 60e3);
}

CAPAS.splice(1, 0, ["zonas", "Zonas por anillo", "#ffb4c4"]);
S.capas.zonas = false;
ICO.zonas = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 3v18M3 12h18"/>';
ICO.alerta = '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>';

const esperaMejoras = setInterval(() => {
  if (!(S.clima && S.focos && T.listo && document.querySelector(".capa"))) return;
  clearInterval(esperaMejoras);
  eventosMejoras(); pintarOrigen(); prepararZonas();
  try { mejorarEdificios(); } catch (e) { console.warn("edificios", e); }
  iniciarCasas();
  edificiosIconicos().catch((e) => console.warn("sin edificios icónicos", e));
  if (DALT.on) aplicarDalt(); else pintarTrafico();
  if (/kiosco/.test(location.hash)) setTimeout(() => kiosco(true), 1500);
  revisarNotif();
}, 300);
