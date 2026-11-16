/* Ciudad Viva SCZ — ir de un lugar a otro: desde mi ubicación, guía paso a paso (GPS o simulada)
 * y buscador de líneas de micro con su recorrido, calles y lugares por donde pasa. */

/* ===================== Mi ubicación ===================== */
const YO = { p: null, rumbo: 0, precision: 0 };
function pedirUbicacion() {
  return new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error("sin GPS"));
    navigator.geolocation.getCurrentPosition((g) => { YO.p = [g.coords.longitude, g.coords.latitude]; YO.precision = g.coords.accuracy; ok(YO.p); },
      (e) => no(e), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}
async function desdeMiUbicacion() {
  try {
    const p = await pedirUbicacion();
    if (distM(p, PLAZA) > 40000) { aviso("Estás lejos de Santa Cruz: pongo el origen en la plaza 24 de Septiembre para que puedas probar."); ponerExtremo("A", PLAZA, "Plaza 24 de Septiembre"); return; }
    ponerExtremo("A", p, "Mi ubicación");
  } catch (e) { aviso("No pude leer tu ubicación. Permite el acceso en el candado de la barra de direcciones, o elige el origen en el mapa."); }
}
async function irDesdeAqui(r) {
  $("#resultados").hidden = true; $("#buscar").blur();
  if (!R_.A || R_.A.nombre !== "Mi ubicación") await desdeMiUbicacion();
  ponerExtremo("B", r.p, r.t);
}
// en cada resultado del buscador: ➜ = cómo llegar desde donde estoy
const pintarResultadosBase = pintarResultados;
pintarResultados = function () {
  pintarResultadosBase();
  document.querySelectorAll("#resultados .ir").forEach((s) => s.insertAdjacentHTML("afterbegin", '<button data-a="IR" title="Cómo llegar desde donde estoy" class="ir-yo">➜</button>'));
};
const elegirResultadoBase = elegirResultado;
elegirResultado = function (r, como) { if (como === "IR") return irDesdeAqui(r); return elegirResultadoBase(r, como); };

/* ===================== Pasos de la guía ===================== */
const rumboDe = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * RAD), b[1] - a[1]) / RAD + 360) % 360;
const largo = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += distM(pts[i - 1], pts[i]); return L; };
function giro(antes, despues) {
  const d = ((despues - antes + 540) % 360) - 180;
  if (Math.abs(d) < 25) return ["Sigue derecho por", "⬆"];
  if (Math.abs(d) > 150) return ["Da la vuelta y toma", "⮌"];
  return d > 0 ? ["Gira a la derecha en", "➡"] : ["Gira a la izquierda en", "⬅"];
}
function pasosAuto() {
  const r = R_.res; if (!r) return [];
  const grupos = [];
  for (const t of r.tramos) {
    const v = T.vias[t.via], a = G.lista[t.desde].p, b = G.lista[t.to].p, u = grupos[grupos.length - 1];
    if (u && u.n === v.n) u.pts.push(b); else grupos.push({ n: v.n, pts: [a, b] });
  }
  const pasos = [];
  if (R_.A.d > 25) pasos.push({ txt: `Camina hasta ${corto(grupos[0]?.n || "la avenida")}`, ico: "🚶", pts: [R_.A.p, grupos[0].pts[0]], vel: 1.25 });
  grupos.forEach((g, i) => {
    let txt = `Sal por ${corto(g.n)}`, ico = "⬆";
    if (i > 0) { const p = grupos[i - 1].pts, [t, ic] = giro(rumboDe(p[p.length - 2], p[p.length - 1]), rumboDe(g.pts[0], g.pts[1])); txt = `${t} ${corto(g.n)}`; ico = ic; }
    const v = T.vias.find((x) => x.n === g.n);
    pasos.push({ txt, ico, pts: g.pts, vel: Math.max(3, v ? v.v : 25) / 3.6 });
  });
  const ult = grupos[grupos.length - 1].pts;
  pasos.push({ txt: `Llegas a ${R_.B.nombre}`, ico: "🏁", pts: [ult[ult.length - 1], R_.B.p], vel: 1.25 });
  return pasos.filter((p) => p.pts.length > 1);
}
function pasosMicro() {
  const r = M.res; if (!r || r.soloPie) return [{ txt: `Camina hasta ${R_.B.nombre}`, ico: "🚶", pts: [R_.A.p, R_.B.p], vel: 1.25 }];
  const vb = velMicro(), pasos = [];
  const x0 = r.tramos[0], sube = M.tramos[x0.t].pts[x0.de];
  pasos.push({ txt: `Camina ${Math.round(r.caminar[0])} m hasta la parada en ${calleDe(sube)}`, ico: "🚶", pts: [R_.A.p, sube], vel: 1.25 });
  r.tramos.forEach((x, n) => {
    const ru = M.tramos[x.t].r, linea = corredor(x).linea;
    pasos.push({ txt: `Toma la línea ${ru.ref} y baja en ${calleDe(M.tramos[x.t].pts[x.a])}`, ico: ru.ref, color: ru.color, pts: linea, vel: vb,
      sub: ru.desde && ru.hasta ? `${ru.desde} → ${ru.hasta}` : ru.nombre });
    if (n === 0 && r.tramos.length > 1) {
      const y = r.tramos[1], baja = linea[linea.length - 1], sube2 = M.tramos[y.t].pts[y.de];
      pasos.push({ txt: `Transbordo: camina ${Math.round(r.caminar[2])} m a la línea ${M.tramos[y.t].r.ref}`, ico: "🔁", pts: [baja, sube2], vel: 1.25 });
    }
  });
  const fin = pasos[pasos.length - 1].pts.slice(-1)[0];
  pasos.push({ txt: `Camina ${Math.round(r.caminar[1])} m hasta ${R_.B.nombre}`, ico: "🏁", pts: [fin, R_.B.p], vel: 1.25 });
  return pasos;
}

/* ===================== Guía ===================== */
const NAV = { on: false, sim: false, pasos: [], i: 0, ruta: [], watch: null, timer: 0, lejos: 0, seguir: true, pausa: 0, dicho: "", recorrido: 0 };
function prepararGuia() {
  NAV.pasos = R_.modo === "micro" ? pasosMicro() : pasosAuto();
  for (const p of NAV.pasos) p.L = largo(p.pts);
  NAV.ruta = NAV.pasos.flatMap((p) => p.pts); NAV.i = 0; NAV.lejos = 0; NAV.dicho = "";
}
function guiar(simular) {
  if (!R_.A || !R_.B) return aviso("Elige primero el origen y el destino.");
  prepararGuia(); if (!NAV.pasos.length) return aviso("No hay un camino para guiarte.");
  NAV.on = true; NAV.sim = simular; NAV.seguir = true; document.body.classList.add("navegando");
  $("#nav").hidden = false; marcarNavVoz();
  if (simular) { NAV.recorrido = 0; YO.p = NAV.ruta[0]; NAV.timer = setInterval(pasoSimulado, 200); }
  else if (navigator.geolocation) {
    NAV.watch = navigator.geolocation.watchPosition((g) => { YO.p = [g.coords.longitude, g.coords.latitude]; YO.precision = g.coords.accuracy; avanzar(); },
      () => aviso("Se perdió la señal del GPS."), { enableHighAccuracy: true, maximumAge: 2000 });
  }
  if (YO.p) avanzar(); else YO.p = R_.A.p, avanzar();
  if (matchMedia("(max-width: 900px)").matches) hoja("min");
}
function salirGuia() {
  NAV.on = false; clearInterval(NAV.timer); if (NAV.watch != null) navigator.geolocation.clearWatch(NAV.watch); NAV.watch = null;
  $("#nav").hidden = true; document.body.classList.remove("navegando"); window.speechSynthesis?.cancel();
}
// viaje simulado: avanza por la ruta a la velocidad de cada paso, acelerado ×8
function pasoSimulado() {
  const dt = 0.2 * 8; let resto = 0, k = 0;
  const p = NAV.pasos[NAV.i]; if (!p) return;
  NAV.recorrido += p.vel * dt;
  // ubica la posición a "recorrido" metros del inicio del paso actual
  for (k = 1; k < p.pts.length; k++) { const d = distM(p.pts[k - 1], p.pts[k]); if (resto + d >= NAV.recorrido) break; resto += d; }
  if (k >= p.pts.length) { YO.p = p.pts[p.pts.length - 1]; }
  else { const a = p.pts[k - 1], b = p.pts[k], f = (NAV.recorrido - resto) / (distM(a, b) || 1); YO.p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; YO.rumbo = rumboDe(a, b); }
  avanzar();
}
function cercaDeLinea(p, pts) {
  let min = Infinity, idx = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], cos = Math.cos(p[1] * RAD);
    const ax = (a[0] - p[0]) * cos, ay = a[1] - p[1], bx = (b[0] - p[0]) * cos, by = b[1] - p[1];
    const dx = bx - ax, dy = by - ay, t = clamp(-(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-12), 0, 1);
    const d = Math.hypot(ax + t * dx, ay + t * dy) * RAD * R; if (d < min) { min = d; idx = k; }
  }
  return { d: min, k: idx };
}
function avanzar() {
  if (!NAV.on || !YO.p) return;
  let p = NAV.pasos[NAV.i];
  // ¿llegó al final del paso?
  while (p && distM(YO.p, p.pts[p.pts.length - 1]) < (p.vel > 3 ? 45 : 22)) {
    NAV.i++; NAV.recorrido = 0; p = NAV.pasos[NAV.i];
    if (!p) { anunciar("Llegaste a " + R_.B.nombre, "🏁", "Fin del viaje"); setTimeout(salirGuia, 4000); return; }
  }
  // ¿se salió del camino? (solo con GPS real)
  const c = cercaDeLinea(YO.p, p.pts);
  if (!NAV.sim) {
    NAV.lejos = c.d > (p.vel > 3 ? 150 : 90) ? NAV.lejos + 1 : 0;
    if (NAV.lejos >= 3) { anunciar("Recalculando la ruta…", "↻", ""); R_.A = { ...R_.A, p: YO.p, nombre: "Mi ubicación", ...(enganchar(YO.p) || {}) }; recalcularRuta(); prepararGuia(); return; }
  }
  // distancia que queda del paso y del viaje
  let resto = distM(YO.p, p.pts[c.k] || p.pts[p.pts.length - 1]); for (let k = c.k + 1; k < p.pts.length; k++) resto += distM(p.pts[k - 1], p.pts[k]);
  let seg = resto / p.vel, total = resto;
  for (let j = NAV.i + 1; j < NAV.pasos.length; j++) { total += NAV.pasos[j].L; seg += NAV.pasos[j].L / NAV.pasos[j].vel + (NAV.pasos[j].color ? ESPERA * 0.5 : 0); }
  const llegada = new Date(Date.now() + seg * 1000).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dist = resto < 1000 ? `${Math.round(resto / 10) * 10} m` : `${fmt(resto / 1000)} km`;
  anunciar(p.txt, p.ico, `${dist}${p.sub ? " · " + p.sub : ""} · quedan ${Math.max(1, Math.round(seg / 60))} min (${fmt(total / 1000)} km) · llegas ${llegada}`, p.color);
  // cámara: sigue a la persona mirando hacia donde va
  if (NAV.seguir && Date.now() > NAV.pausa) {
    const sig = p.pts[Math.min(c.k, p.pts.length - 1)], rumbo = NAV.sim ? YO.rumbo : rumboDe(YO.p, sig);
    mapa.easeTo({ center: YO.p, zoom: p.vel > 3 ? 16.4 : 17.4, pitch: 62, bearing: rumbo, duration: NAV.sim ? 200 : 900, essential: true });
  }
}
function anunciar(txt, ico, sub, color) {
  $("#navTxt").textContent = txt; $("#navSub").textContent = sub;
  const i = $("#navIco"); i.textContent = ico; i.style.setProperty("--c", color || "#2bd9a0"); i.classList.toggle("linea", !!color);
  if (txt !== NAV.dicho) { NAV.dicho = txt; if (VOZ.on) hablar(txt); }
}
function marcarNavVoz() { $("#navVoz").textContent = VOZ.on ? "🔊" : "🔈"; }

function capasNav(L, seg) {
  if (!YO.p) return;
  const prof = { depthCompare: "always", depthWriteEnabled: false }, pulso = (seg * 0.8) % 1;
  if (NAV.on) {
    const p = NAV.pasos[NAV.i];
    if (p) L.push(new PathLayer({ id: "nav-paso", data: [p.pts], getPath: (d) => d, widthUnits: "pixels", getWidth: 9, getColor: hex(p.color || "#2bd9a0", 200), capRounded: true, jointRounded: true, parameters: prof }));
  }
  L.push(new ScatterplotLayer({ id: "yo-onda", data: [YO.p], getPosition: (d) => d, getRadius: 20 + 60 * pulso, stroked: true, filled: false,
    getLineColor: [74, 168, 255, 230 * (1 - pulso)], lineWidthMinPixels: 2, updateTriggers: { getRadius: pulso, getLineColor: pulso }, parameters: prof }));
  L.push(new ScatterplotLayer({ id: "yo", data: [YO.p], getPosition: (d) => d, getRadius: 8, radiusMinPixels: 8, radiusMaxPixels: 11,
    getFillColor: [74, 168, 255, 255], stroked: true, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 3, parameters: prof }));
}

/* ===================== Líneas de micro ===================== */
const LIN = { grupos: [], sel: null, q: "", detalle: new Map() };
function gruposLineas() {
  if (LIN.grupos.length) return LIN.grupos;
  const por = new Map();
  for (const r of S.rutas) { if (!por.has(r.ref)) por.set(r.ref, []); por.get(r.ref).push(r); }
  LIN.grupos = [...por.entries()].map(([ref, rs]) => ({ ref, rs, color: rs[0].color, desde: rs[0].desde, hasta: rs[0].hasta, nombre: rs[0].nombre,
    km: rs.reduce((a, r) => a + r.tramos.reduce((b, t) => b + largo(t), 0), 0) / rs.length / 1000 }))
    .sort((a, b) => (parseInt(a.ref) || 999) - (parseInt(b.ref) || 999) || String(a.ref).localeCompare(String(b.ref)));
  return LIN.grupos;
}
function detalleLinea(g) {
  if (LIN.detalle.has(g.ref)) return LIN.detalle.get(g.ref);
  const calles = new Map(), lugares = new Map();
  for (const r of g.rs) for (const tr of r.tramos) for (let k = 0; k < tr.length; k += 3) {
    const p = tr[k], c = T.listo ? traficoCerca(p) : null;
    if (c && c.d < 35) calles.set(c.v.n, (calles.get(c.v.n) || 0) + 1);
    for (const h of D.hitos) if (!lugares.has(h.n) && Math.abs(h.p[0] - p[0]) < 0.003 && Math.abs(h.p[1] - p[1]) < 0.003 && distM(h.p, p) < 200) lugares.set(h.n, h);
    for (const e of ICN.lista) if (!lugares.has(e.n) && distM(e.c, p) < 200) lugares.set(e.n, { n: e.n, c: null, tipo: e.h ? `Edificio · ${e.h} m` : "Templo", col: "#40e0ff" });
  }
  const d = { calles: [...calles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => corto(n)), lugares: [...lugares.values()].slice(0, 12) };
  LIN.detalle.set(g.ref, d); return d;
}
function buscarLineas(q) {
  const n = sinTilde(q.trim()), gs = gruposLineas();
  if (!n) return { lista: gs, cerca: null };
  const lista = gs.filter((g) => sinTilde(`${g.ref} ${g.desde || ""} ${g.hasta || ""} ${g.nombre || ""}`).includes(n) || String(g.ref) === n);
  // ¿es un lugar o una avenida? → líneas que pasan a menos de 300 m
  let cerca = null;
  if (n.length >= 3 && !/^\d+$/.test(n)) {
    const r = buscar(q).find((x) => x.tipo !== "linea");
    if (r) { const refs = new Set(rutasCerca(r.p, 300).map((o) => o.r.ref)); cerca = { lugar: r, lista: gs.filter((g) => refs.has(g.ref)) }; }
  }
  return { lista, cerca };
}
function filaLinea(g) {
  return `<li data-ref="${g.ref}" style="--c:${g.color}" class="${LIN.sel === g.ref ? "on" : ""}"><i>${g.ref}</i>
    <span><b>${g.desde && g.hasta ? `${g.desde} → ${g.hasta}` : g.nombre}</b><small>${fmt(g.km)} km${g.rs.length > 1 ? " · ida y vuelta" : ""}</small></span></li>`;
}
function pintarLineas() {
  const el = $("#lineasInfo"); if (!el || !S.rutas.length) return;
  if (LIN.sel) {
    const g = gruposLineas().find((x) => x.ref === LIN.sel), d = detalleLinea(g);
    el.innerHTML = `<button id="linVolver" class="mini">← Todas las líneas</button>
      <div class="lin-cab" style="--c:${g.color}"><i>${g.ref}</i><div><b>Línea ${g.ref}</b><span>${g.desde && g.hasta ? `${g.desde} → ${g.hasta}` : g.nombre}</span></div></div>
      <div class="datos"><div><small>Recorrido</small><b>${fmt(g.km)}</b> <small>km</small></div><div><small>Sentidos</small><b>${g.rs.length}</b></div><div><small>Vuelta</small><b>~${Math.round(g.km / 17 * 60)}</b> <small>min</small></div></div>
      ${d.calles.length ? `<div class="sub">Pasa por</div><div class="chips">${d.calles.map((c) => `<span class="chip calle">${c}</span>`).join("")}</div>` : ""}
      ${d.lugares.length ? `<div class="sub">Lugares cerca del recorrido</div><ol class="pasos">${d.lugares.map((h) => `<li style="--c:${h.col || "#8fa2ff"}"><b>${h.n}</b><span>${h.tipo || (CAT[h.c] ? CAT[h.c][1] : "")}</span></li>`).join("")}</ol>` : ""}
      <p class="ayuda">Recorrido de OpenStreetMap. Tiempo de vuelta estimado a ~17 km/h; no hay horarios oficiales abiertos.</p>`;
    return;
  }
  const { lista, cerca } = buscarLineas(LIN.q);
  el.innerHTML = `${cerca ? `<div class="sub">Pasan cerca de ${cerca.lugar.t}</div><ol class="lineas">${cerca.lista.map(filaLinea).join("") || "<small>Ninguna a menos de 300 m</small>"}</ol>` : ""}
    <div class="sub">${LIN.q ? "Líneas que coinciden" : `Las ${lista.length} líneas`}</div><ol class="lineas">${lista.map(filaLinea).join("") || '<p class="ayuda">Ninguna línea con ese número o nombre.</p>'}</ol>`;
}
function elegirLinea(ref) {
  LIN.sel = ref; const g = gruposLineas().find((x) => x.ref === ref);
  S.lineaSel = g.rs[0].idx; S.capas.micros = true; document.querySelector('.capa[data-k="micros"]')?.classList.add("on");
  const pts = g.rs.flatMap((r) => r.tramos.flat()), xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  mapa.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 110, bottom: 130, left: 60, right: 380 }, pitch: 40, duration: 1600 });
  pintarLineas();
}

/* ===================== Eventos y capas ===================== */
const capasMejorasBase = capasMejoras;
capasMejoras = function (L, seg) { capasMejorasBase(L, seg); capasNav(L, seg); };
const pintarRutaBase = pintarRuta;
pintarRuta = function () { pintarRutaBase(); const b = $("#guiarBox"); if (b) b.hidden = !(R_.A && R_.B && (R_.modo === "micro" ? M.res : R_.res)); };

$("#desdeYo").onclick = desdeMiUbicacion;
$("#guiar").onclick = () => guiar(false);
$("#simViaje").onclick = () => guiar(true);
$("#navSalir").onclick = salirGuia;
$("#navVoz").onclick = () => { VOZ.on = !VOZ.on; guardado("cv-voz", VOZ.on ? "1" : "0"); marcarNavVoz(); marcarVoz(); if (VOZ.on) hablar($("#navTxt").textContent); else speechSynthesis?.cancel(); };
mapa.on("dragstart", () => { if (NAV.on) NAV.pausa = Date.now() + 8000; }); // si mueves el mapa, deja de seguirte 8 s
$("#buscaLinea").addEventListener("input", (e) => { LIN.q = e.target.value; LIN.sel = null; pintarLineas(); });
$("#buscaLinea").addEventListener("keydown", (e) => e.stopPropagation());
$("#lineasInfo").addEventListener("click", (e) => {
  if (e.target.closest("#linVolver")) { LIN.sel = null; S.lineaSel = null; return pintarLineas(); }
  const li = e.target.closest("li[data-ref]"); if (li) elegirLinea(li.dataset.ref);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && NAV.on) salirGuia(); });
