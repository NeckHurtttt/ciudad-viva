/* Ciudad Viva SCZ — escenarios listos, reportes ciudadanos, enlace para compartir y hoja deslizable en celular. */

/* ===================== Aviso breve (toast) ===================== */
let avisoT = 0;
function aviso(html, ms = 3200) {
  const el = $("#aviso"); el.innerHTML = html; el.hidden = false; el.classList.remove("sale"); void el.offsetWidth; el.classList.add("entra");
  clearTimeout(avisoT); avisoT = setTimeout(() => { el.classList.add("sale"); setTimeout(() => (el.hidden = true), 300); }, ms);
}

/* ===================== Escenarios ===================== */
const PLAZA_24 = [-63.1821, -17.7834];
const ESCENARIOS = [
  { id: "desfile", t: "Desfile en el centro", d: "Calles a 700 m de la plaza cerradas, 10:00", h: 10,
    cerrar: (v) => distM(v.mid, PLAZA_24) < 700, centro: PLAZA_24, zoom: 14.6 },
  { id: "bloqueo", t: "Bloqueo en el 4to anillo", d: "1,8 km del 4to anillo en hora pico, 7:45", h: 7.75,
    cerrar: (v) => /Cuarto Anillo/i.test(v.n) && distM(v.mid, [-63.1755, -17.7502]) < 1800, centro: [-63.1755, -17.7502], zoom: 13.8 },
  { id: "obras", t: "Obras en el Cristo Redentor", d: "Cristo Redentor cerrado entre el 2do y 3er anillo, 18:30", h: 18.5,
    cerrar: (v) => /Cristo Redentor/i.test(v.n) && distM(v.mid, [-63.1825, -17.7704]) < 900, centro: [-63.1825, -17.7704], zoom: 14.4 },
  { id: "aguacero", t: "Aguacero a la salida", d: "Lluvia fuerte en toda la ciudad, 18:30", h: 18.5, lluvia: true,
    centro: [-63.18, -17.78], zoom: 12.6 },
];

function correrEscenario(e) {
  restablecerSim();
  S.play = false; modo(false); S.hora = e.h; $("#tiempo").value = e.h;
  for (const v of T.vias) if (e.cerrar && e.cerrar(v)) { v.cerrada = true; T.sim.cerradas.add(v.i); }
  T.sim.lluvia = !!e.lluvia; $("#simLluvia").classList.toggle("on", T.sim.lluvia);
  SIM.escenario = e; aplicarSim();
  mapa.flyTo({ center: e.centro, zoom: e.zoom, pitch: 55, bearing: -15, duration: 2200, essential: true });
}

function titularSim(a, b, top) {
  const e = SIM.escenario; if (!e) return "";
  const pa = Math.round(a.pctLento * 100), pb = Math.round(b.pctLento * 100), t = top[0];
  let txt = `<b>${e.t}:</b> la zona pasa de <b>${pa}%</b> a <b>${pb}%</b> de avenidas lentas`;
  if (t) txt += ` y ${corto(t.v.n)} cae de ${Math.round(SIM.base.v[t.v.i])} a ${Math.round(t.v.v)} km/h`;
  return `<div class="titular">${txt}.</div>`;
}

function pintarEscenarios() {
  $("#escenarios").innerHTML = ESCENARIOS.map((e) => `<button data-e="${e.id}" class="${SIM.escenario?.id === e.id ? "on" : ""}"><b>${e.t}</b><small>${e.d}</small></button>`).join("");
}

/* ===================== Reportes ciudadanos ===================== */
const TIPOS = {
  choque: { t: "Choque", c: "#ff4d6d", g: "!", f: 0.35 },
  bloqueo: { t: "Bloqueo", c: "#d23cff", g: "✕", f: 0.06 },
  inundacion: { t: "Calle inundada", c: "#4aa8ff", g: "≈", f: 0.4 },
  bache: { t: "Bache grande", c: "#ffd23f", g: "◒", f: 0.8 },
};
const VIDA = 3 * 3600e3; // un reporte dura 3 horas (más si alguien lo confirma)
const REP = { lista: [], tipo: null };
const CFG = window.CV_SUPABASE || null; // { url, key } en config.js para compartir reportes entre personas

function guardarLocal() { try { localStorage.setItem("cv-reportes", JSON.stringify(REP.lista)); } catch (e) {} }
async function cargarReportes() {
  try { REP.lista = JSON.parse(localStorage.getItem("cv-reportes") || "[]"); } catch (e) { REP.lista = []; }
  if (CFG) try {
    const desde = new Date(Date.now() - VIDA).toISOString();
    const r = await fetch(`${CFG.url}/rest/v1/reportes?select=*&creado=gte.${desde}`, { headers: { apikey: CFG.key, Authorization: `Bearer ${CFG.key}` } });
    if (r.ok) for (const x of await r.json()) if (!REP.lista.some((y) => y.id === x.id)) REP.lista.push({ id: x.id, tipo: x.tipo, p: [x.lon, x.lat], t: Date.parse(x.creado), votos: x.votos || 1 });
  } catch (e) { console.warn("reportes en línea no disponibles", e); }
  limpiarReportes();
}
function limpiarReportes() {
  const ahora = Date.now();
  REP.lista = REP.lista.filter((r) => ahora - r.t < VIDA * Math.min(3, r.votos));
  guardarLocal(); efectoReportes();
}
async function nuevoReporte(tipo, p) {
  const r = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), tipo, p, t: Date.now(), votos: 1 };
  REP.lista.push(r); guardarLocal(); efectoReportes();
  aviso(`<b>${TIPOS[tipo].t}</b> reportado aquí. Se verá 3 horas${CFG ? " para todos" : " en este equipo"} y ya afecta el tráfico.`);
  if (CFG) fetch(`${CFG.url}/rest/v1/reportes`, { method: "POST", headers: { apikey: CFG.key, Authorization: `Bearer ${CFG.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ id: r.id, tipo, lon: p[0], lat: p[1] }) }).catch(() => {});
}
function confirmarReporte(r) {
  r.votos++; r.t = Date.now(); guardarLocal();
  aviso(`Confirmaste: <b>${TIPOS[r.tipo].t}</b> sigue ahí (${r.votos} personas).`);
}
// cada reporte frena las avenidas a menos de 160 m
function efectoReportes() {
  if (!T.listo) return;
  for (const v of T.vias) v.rep = 1;
  for (const r of REP.lista) for (const v of T.vias) {
    if (Math.abs(v.mid[0] - r.p[0]) > 0.01 || Math.abs(v.mid[1] - r.p[1]) > 0.01) continue;
    if (cercaDeVia(r.p, v) < 160) v.rep = Math.min(v.rep, TIPOS[r.tipo].f);
  }
  T.horaCalc = -1; pintarTrafico();
}
const hace = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`; };

function capasReportes(L, seg) {
  if (!REP.lista.length || !S.capas.trafico) return;
  const prof = { depthCompare: "always", depthWriteEnabled: false }, pulso = (seg * 0.9) % 1;
  L.push(new ScatterplotLayer({ id: "rep-onda", data: REP.lista, getPosition: (d) => d.p, getRadius: 60 + 220 * pulso, stroked: true, filled: false,
    getLineColor: (d) => hex(TIPOS[d.tipo].c, 220 * (1 - pulso)), lineWidthMinPixels: 2, updateTriggers: { getRadius: pulso, getLineColor: pulso }, parameters: prof }));
  L.push(new ScatterplotLayer({ id: "reportes", data: REP.lista, getPosition: (d) => d.p, getRadius: 45, radiusMinPixels: 12, radiusMaxPixels: 17,
    getFillColor: (d) => hex(TIPOS[d.tipo].c, 255), stroked: true, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 2, pickable: true, parameters: prof }));
  L.push(new TextLayer({ id: "reportes-g", data: REP.lista, getPosition: (d) => d.p, getText: (d) => TIPOS[d.tipo].g, characterSet: "auto",
    getSize: 13, fontWeight: 700, getColor: [6, 10, 22, 255], getTextAnchor: "middle", getAlignmentBaseline: "center", parameters: prof }));
}

/* ===================== Enlace para compartir ===================== */
function enlace() {
  const c = mapa.getCenter(), q = new URLSearchParams();
  q.set("c", [c.lng.toFixed(5), c.lat.toFixed(5), mapa.getZoom().toFixed(2), mapa.getPitch().toFixed(0), mapa.getBearing().toFixed(0)].join(","));
  if (!S.vivo) q.set("h", S.hora.toFixed(2));
  if (S.tab !== "trafico") q.set("tab", S.tab);
  if (R_.A) q.set("a", R_.A.p.map((x) => x.toFixed(5)).join(",") + "," + encodeURIComponent(R_.A.nombre));
  if (R_.B) q.set("b", R_.B.p.map((x) => x.toFixed(5)).join(",") + "," + encodeURIComponent(R_.B.nombre));
  if (R_.modo === "micro") q.set("m", "micro");
  if (SIM.escenario) q.set("esc", SIM.escenario.id);
  const off = Object.keys(S.capas).filter((k) => !S.capas[k]); if (off.length) q.set("off", off.join(","));
  return location.origin + location.pathname + "#" + q.toString();
}
async function compartir() {
  const url = enlace();
  history.replaceState(null, "", url);
  if (navigator.share && matchMedia("(pointer: coarse)").matches) { try { await navigator.share({ title: "Ciudad Viva SCZ", text: "Mira esto en Ciudad Viva", url }); return; } catch (e) {} }
  try { await navigator.clipboard.writeText(url); aviso("Enlace copiado: guarda la cámara, la hora, la ruta y las capas."); }
  catch (e) { prompt("Copia este enlace:", url); }
}
function leerEnlace() {
  if (!location.hash.length) return false;
  const q = new URLSearchParams(location.hash.slice(1));
  const off = (q.get("off") || "").split(",").filter((k) => k in S.capas);
  for (const k of off) { S.capas[k] = false; document.querySelector(`.capa[data-k="${k}"]`)?.classList.remove("on"); }
  if (q.get("esc")) { const e = ESCENARIOS.find((x) => x.id === q.get("esc")); if (e) { pestana("sim"); correrEscenario(e); } }
  else if (q.get("h")) { S.play = false; modo(false); S.hora = +q.get("h"); $("#tiempo").value = S.hora; }
  if (q.get("m") === "micro") { R_.modo = "micro"; document.querySelectorAll("[data-modo]").forEach((x) => x.classList.toggle("on", x.dataset.modo === "micro")); }
  for (const k of ["a", "b"]) {
    const v = q.get(k); if (!v) continue;
    const [lon, lat, ...n] = v.split(","); const g = enganchar([+lon, +lat]);
    if (g) R_[k.toUpperCase()] = { p: [+lon, +lat], nombre: decodeURIComponent(n.join(",")) || "Punto", ...g };
  }
  if (R_.A && R_.B) { pestana("ruta"); recalcularRuta(); }
  if (q.get("tab")) pestana(q.get("tab"));
  if (q.get("c")) {
    const [lng, lat, zoom, pitch, bearing] = q.get("c").split(",").map(Number);
    setTimeout(() => mapa.jumpTo({ center: [lng, lat], zoom, pitch, bearing }), 50);
  }
  return true;
}

/* ===================== Hoja deslizable (celular) ===================== */
const ESTADOS = ["min", "mid", "max"];
function hoja(estado) { $("#punto").dataset.hoja = estado; }
function eventosHoja() {
  const el = $("#punto"), asa = $("#asa"); hoja("min");
  asa.onclick = () => hoja(ESTADOS[(ESTADOS.indexOf(el.dataset.hoja) + 1) % 3]);
  let y0 = null;
  asa.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  asa.addEventListener("touchend", (e) => {
    if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (Math.abs(dy) < 25) return;
    const i = ESTADOS.indexOf(el.dataset.hoja); hoja(ESTADOS[clamp(i + (dy < 0 ? 1 : -1), 0, 2)]);
  });
}

/* ===================== Eventos ===================== */
function eventosExtras() {
  pintarEscenarios();
  $("#escenarios").addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (!b) return; correrEscenario(ESCENARIOS.find((x) => x.id === b.dataset.e)); pintarEscenarios(); });
  $("#reportar").onclick = () => { $("#menuRep").hidden = !$("#menuRep").hidden; };
  $("#menuRep").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tipo]"); if (!b) return;
    REP.tipo = b.dataset.tipo; $("#menuRep").hidden = true; document.body.classList.add("eligiendo");
    aviso(`Toca en el mapa dónde está el <b>${TIPOS[REP.tipo].t.toLowerCase()}</b>. (Esc para cancelar)`, 5000);
  });
  $("#compartir").onclick = compartir;
  $("#calidad").onclick = cambiarCalidad; pintarCalidad();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && REP.tipo) { REP.tipo = null; document.body.classList.remove("eligiendo"); } });
  eventosHoja();
  setInterval(limpiarReportes, 60e3);
}

// clic en el mapa: lo llama clicFunciones primero
function clicExtras(e) {
  if (REP.tipo) { nuevoReporte(REP.tipo, [e.lngLat.lng, e.lngLat.lat]); REP.tipo = null; document.body.classList.remove("eligiendo"); return true; }
  const g = overlay.pickObject?.({ x: e.point.x, y: e.point.y, radius: 6, layerIds: ["reportes"] });
  if (g?.object) { confirmarReporte(g.object); return true; }
  return false;
}
