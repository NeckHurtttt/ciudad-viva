/* Ciudad Viva SCZ — tráfico estimado.
 * No hay datos abiertos de tráfico en vivo para Bolivia (TomTom/HERE/Google no cubren SCZ),
 * así que se estima por tramo de avenida con datos reales:
 *  - demanda: cuántas líneas de micro distintas recorren el tramo (OSM, 71 líneas)
 *  - capacidad: tipo de vía (troncal > primaria > secundaria)
 *  - hora: curva de horas pico de SCZ (entrada, mediodía, salida)
 *  - centro: dentro del 2º anillo el flujo es más denso
 *  - lluvia: Open-Meteo de esa hora
 * Velocidad con la función BPR: v = v_libre / (1 + α·(V/C)^β).
 */
const { TextLayer } = deck;

const VLIBRE = { 3: 55, 2: 42, 1: 32 };       // km/h sin tráfico por clase
const CAPAC = { 3: 9, 2: 6.5, 1: 4.2 };        // "líneas equivalentes" que aguanta sin frenarse
const PLAZA = [-63.1821, -17.7834];
const NIVELES = [ // [desde fracción de v_libre, nombre, color]
  [0.75, "Fluido", "#2bd9a0"],
  [0.5, "Moderado", "#ffd23f"],
  [0.32, "Lento", "#ff9f45"],
  [0.18, "Muy lento", "#ff4d6d"],
  [0, "Atascado", "#d23cff"],
];
const nivel = (r) => NIVELES.find((n) => r >= n[0]);

const T = { vias: [], cruces: [], criticos: [], horaCalc: -1, indice: [], listo: false, part: [] };

function gauss(x, m, s) { return Math.exp(-((x - m) ** 2) / (2 * s * s)); }
function factorHora(h) { // 0..1, horas pico de SCZ
  return Math.min(1, 0.12 + Math.max(
    gauss(h, 7.7, 1.1),            // entrada a colegios y trabajo
    0.9 * gauss(h, 12.6, 1.0),   // mediodía (almuerzo, salida de colegios)
    1.0 * gauss(h, 18.8, 1.3),    // salida
    0.62 * gauss(h, 15.5, 2.4),     // tarde
  ));
}

/* Índice espacial de los micros: celdas de ~55 m con el conjunto de líneas que pasan. */
function indiceMicros() {
  const C = 0.0005, celdas = new Map();
  const key = (x, y) => Math.floor(x / C) + ":" + Math.floor(y / C);
  for (const r of S.rutas) for (const tr of r.tramos) for (let k = 1; k < tr.length; k++) {
    const a = tr[k - 1], b = tr[k], n = Math.max(1, Math.ceil(distM(a, b) / 25));
    for (let i = 0; i <= n; i++) {
      const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n, kk = key(x, y);
      let s = celdas.get(kk); if (!s) celdas.set(kk, (s = new Set())); s.add(r.idx);
    }
  }
  return (p) => {
    const out = new Set(), cx = Math.floor(p[0] / C), cy = Math.floor(p[1] / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const s = celdas.get(cx + i + ":" + (cy + j)); if (s) for (const v of s) out.add(v);
    }
    return out;
  };
}

function prepararTrafico(d) {
  const lineasEn = indiceMicros();
  for (const v of d.vias) {
    const acum = [0];
    for (let k = 1; k < v.p.length; k++) acum.push(acum[k - 1] + distM(v.p[k - 1], v.p[k]));
    const L = acum[acum.length - 1]; if (L < 15) continue;
    // líneas de micro: promedio de muestras cada ~40 m a lo largo del tramo
    let suma = 0, n = 0; const todas = new Set();
    for (let s = 0; s <= L; s += 40) {
      const q = enDistancia({ acum, coords: v.p }, Math.min(s, L)).p, set = lineasEn(q);
      suma += set.size; n++; for (const x of set) todas.add(x);
    }
    const lineas = suma / n, mid = enDistancia({ acum, coords: v.p }, L / 2).p;
    const dc = distM(mid, PLAZA);
    const centro = dc < 1800 ? 0.45 : dc < 3500 ? 0.25 : dc < 6000 ? 0.08 : 0; // casco viejo y anillos
    const ruido = 0.88 + ((v.n.length * 7919 + Math.round(mid[0] * 1e4)) % 100) / 400; // variación estable por calle
    T.vias.push({ i: T.vias.length, n: v.n, c: v.c, p: v.p, coords: v.p, acum, L, mid, lineas, todas, carga: (0.8 + lineas) * (1 + centro) * ruido, r: 1, v: VLIBRE[v.c] });
  }
  // cruces: cada uno se asocia a las vías que pasan a menos de 45 m
  const porNombre = new Map();
  for (const v of T.vias) { if (!porNombre.has(v.n)) porNombre.set(v.n, []); porNombre.get(v.n).push(v); }
  for (const c of d.cruces) {
    const vias = c.n.flatMap((nm) => (porNombre.get(nm) || []).filter((v) => cercaDeVia(c.p, v) < 45));
    if (vias.length >= 2) T.cruces.push({ p: c.p, n: c.n, vias, lineas: new Set(vias.flatMap((v) => [...v.todas])).size });
  }
  // índice de la ciudad hora por hora (para el gráfico)
  for (let h = 0; h < 24; h++) { calcularTrafico(h + 0.5); T.indice.push(T.resumen); }
  T.listo = true; T.horaCalc = -1;
}

function cercaDeVia(p, v) {
  let min = Infinity;
  for (let k = 1; k < v.p.length; k++) {
    const a = v.p[k - 1], b = v.p[k], cos = Math.cos(p[1] * RAD);
    const ax = (a[0] - p[0]) * cos, ay = a[1] - p[1], bx = (b[0] - p[0]) * cos, by = b[1] - p[1];
    const dx = bx - ax, dy = by - ay, t = clamp(-(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-12), 0, 1);
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy) * RAD * R);
  }
  return min;
}

function lluviaHora(h) { return S.clima ? promedio("lluvia", Math.floor(h) % 24) : 0; }

// Simulación "¿qué pasa si…?": calles cerradas y lluvia forzada
T.sim = { cerradas: new Set(), lluvia: false };
const CERRADA = [0, "Cerrada", "#6b7280"];

// Cuando se cierra una calle, su carga se reparte entre las avenidas cercanas (más a las más cercanas y anchas).
function repartirDesvio() {
  for (const v of T.vias) v.extra = 0;
  for (const i of T.sim.cerradas) {
    const c = T.vias[i], cand = [];
    for (const v of T.vias) {
      if (T.sim.cerradas.has(v.i)) continue;
      const d = distM(v.mid, c.mid); if (d > 1400 || d < 1) continue;
      cand.push({ v, w: (v.c + 1) / (1 + (d / 250) ** 2) });
    }
    const tot = cand.reduce((a, o) => a + o.w, 0) || 1;
    for (const o of cand) o.v.extra += c.carga * 4 * o.w / tot * Math.min(3, c.L / 100);
  }
}

function calcularTrafico(h) {
  const fh = factorHora(h), mm = T.sim.lluvia ? 12 : lluviaHora(h), fl = 1 + Math.min(T.sim.lluvia ? 0.6 : 0.35, mm * 0.12);
  let km = 0, kmLento = 0, sumaV = 0;
  for (const v of T.vias) {
    const k = v.L / 1000; km += k;
    if (v.cerrada) { v.r = 0; v.v = 0; v.nivel = CERRADA; kmLento += k; continue; }
    const x = 1.5 * ((v.carga + (v.extra || 0)) / CAPAC[v.c]) ** 0.55 * fh * fl; // comprime la cola: pocos tramos con 20+ líneas
    v.r = 0.1 + 0.9 / (1 + 0.8 * x ** 2.2); // piso: aun atascado se avanza a paso de hombre
    if (v.rep && v.rep < 1) v.r *= v.rep;   // reportes ciudadanos (choque, bloqueo, inundación, bache)
    v.v = VLIBRE[v.c] * v.r;
    v.nivel = nivel(v.r);
    sumaV += v.v * k; if (v.r < 0.5) kmLento += k;
  }
  for (const c of T.cruces) {
    let s = 0, w = 0; for (const v of c.vias) { s += v.r * v.carga; w += v.carga; }
    c.r = s / w; c.v = c.vias.reduce((a, v) => a + v.v, 0) / c.vias.length;
    c.score = (1 - c.r) * Math.sqrt(c.lineas + 1) * (1 + c.vias.length * 0.1);
  }
  // puntos críticos: los mejores cruces, separados al menos 450 m entre sí
  const orden = [...T.cruces].sort((a, b) => b.score - a.score), crit = [];
  for (const c of orden) {
    if (crit.length >= 8) break;
    if (crit.every((o) => distM(o.p, c.p) > 450)) crit.push(c);
  }
  T.criticos = crit;
  T.resumen = { pctLento: kmLento / km, vel: sumaV / km, kmLento, fh, mm };
}

/* Partículas que recorren las avenidas: lentas y juntas donde hay atasco, rápidas y sueltas donde fluye. */
function particulas(seg) {
  const out = [];
  for (const v of T.vias) {
    if (v.L < 60 || v.cerrada) continue;
    const dens = (1 + (1 - v.r) * 4) * q().particulas, n = Math.max(1, Math.round(v.L / 260 * dens));
    const vel = v.v / 3.6 * 9; // m/s acelerado
    for (let i = 0; i < n; i++) {
      const s = ((i / n) * v.L + seg * vel + v.L * ((v.mid[0] * 997) % 1)) % v.L;
      out.push({ p: enDistancia(v, s).p, col: v.nivel[2] });
    }
  }
  return out;
}

function capasTrafico(L, seg) {
  if (!T.listo || !S.capas.trafico) return;
  if (Math.abs(T.horaCalc - S.hora) > 0.02) { calcularTrafico(S.hora); T.horaCalc = S.hora; }
  const zoom = mapa.getZoom(), lejos = zoom < 11;
  L.push(new PathLayer({
    id: "trafico-halo", data: T.vias, getPath: (d) => d.p, widthUnits: "pixels",
    getWidth: (d) => (d.c + 1) * 2.6 * (1.4 - d.r), getColor: (d) => hex(d.nivel[2], 55 + 90 * (1 - d.r)),
    updateTriggers: { getWidth: T.horaCalc, getColor: T.horaCalc }, parameters: { depthCompare: "always", depthWriteEnabled: false },
  }));
  L.push(new PathLayer({
    id: "trafico", data: T.vias, getPath: (d) => d.p, widthUnits: "pixels", pickable: true,
    getWidth: (d) => d.c * 0.9 + 1.2, getColor: (d) => hex(d.nivel[2], 235), capRounded: true, jointRounded: true,
    updateTriggers: { getColor: T.horaCalc }, parameters: { depthCompare: "always", depthWriteEnabled: false },
  }));
  if (!lejos && q().particulas > 0) L.push(new ScatterplotLayer({
    id: "trafico-flujo", data: particulas(seg), getPosition: (d) => d.p, getFillColor: (d) => hex(d.col, 255),
    getRadius: 9, radiusMinPixels: 1.4, radiusMaxPixels: 3.2, parameters: { depthCompare: "always", depthWriteEnabled: false },
  }));
  const pulso = (seg * 0.7) % 1;
  L.push(new ScatterplotLayer({
    id: "criticos-onda", data: T.criticos, getPosition: (d) => d.p, stroked: true, filled: false,
    getRadius: 120 + 380 * pulso, getLineColor: (d) => hex(nivel(d.r)[2], 230 * (1 - pulso)), lineWidthMinPixels: 2,
    updateTriggers: { getRadius: pulso, getLineColor: [pulso, T.horaCalc] }, parameters: { depthCompare: "always", depthWriteEnabled: false },
  }));
  L.push(new ScatterplotLayer({
    id: "criticos", data: T.criticos, getPosition: (d) => d.p, getRadius: 70, radiusMinPixels: 11, radiusMaxPixels: 16,
    getFillColor: (d) => hex(nivel(d.r)[2], 255), stroked: true, getLineColor: [255, 255, 255, 230], lineWidthMinPixels: 2,
    pickable: true, updateTriggers: { getFillColor: T.horaCalc }, parameters: { depthCompare: "always", depthWriteEnabled: false },
  }));
  L.push(new TextLayer({
    id: "criticos-num", data: T.criticos, getPosition: (d) => d.p, getText: (d) => String(T.criticos.indexOf(d) + 1),
    getSize: 12, getColor: [6, 10, 22, 255], fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
    getTextAnchor: "middle", getAlignmentBaseline: "center", parameters: { depthCompare: "always", depthWriteEnabled: false },
    updateTriggers: { getText: T.horaCalc },
  }));
}

/* ---------- Panel de tráfico ---------- */
const corto = (n) => n.replace(/^Avenida /, "Av. ").replace(/^Calle /, "C. ").replace(/^Doble Vía /, "Doble vía ");
function nombreCruce(c) { return c.n.map(corto).join(" y "); }

function graficoTrafico() {
  const W = 260, H = 46, n = T.indice.length, x = (h) => (h + 0.5) / n * W;
  const tope = Math.max(0.1, ...T.indice.map((r) => r.pctLento)), y = (v) => H - 3 - v / tope * (H - 8);
  const linea = T.indice.map((r, h) => `${h ? "L" : "M"}${x(h).toFixed(1)},${y(r.pctLento).toFixed(1)}`).join("");
  const stops = T.indice.map((r, h) => `<stop offset="${(h + 0.5) / n}" stop-color="${nivel(1 - r.pctLento * 2.4)[2]}"/>`).join("");
  const xh = clamp(S.hora / 24 * W, 0, W);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="curva">
    <defs><linearGradient id="gtr" x1="0" x2="1">${stops}</linearGradient>
    <linearGradient id="gtrf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4d6d" stop-opacity=".3"/><stop offset="1" stop-color="#ff4d6d" stop-opacity="0"/></linearGradient></defs>
    <path d="${linea}L${W},${H}L0,${H}Z" fill="url(#gtrf)"/>
    <path d="${linea}" fill="none" stroke="url(#gtr)" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    <line x1="${xh}" x2="${xh}" y1="0" y2="${H}" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function picoDelDia() {
  let a = null; T.indice.forEach((r, h) => { if (!a || r.pctLento > a.r.pctLento) a = { h, r }; }); return a;
}

function pintarTrafico() {
  if (!T.listo) return;
  if (Math.abs(T.horaCalc - S.hora) > 0.02) { calcularTrafico(S.hora); T.horaCalc = S.hora; }
  const r = T.resumen, pct = Math.round(r.pctLento * 100), niv = nivel(1 - r.pctLento * 2.4), pico = picoDelDia();
  const html = `
    <div class="badge-est" title="TomTom, HERE y Google no tienen tráfico en vivo de Bolivia">Estimado · micros OSM + hora + lluvia</div>
    <div class="aqi" style="--c:${niv[2]}">
      <div class="num">${pct}%<small>de avenidas lentas</small></div>
      <div><b>${niv[1]}</b><span>${fmt(r.kmLento, 0)} km lentos · vel. media ${fmt(r.vel, 0)} km/h a las ${hhmm(S.hora)}</span></div>
    </div>
    ${graficoTrafico()}
    <div class="marcas-c"><span>0h</span><span>pico ${String(pico.h).padStart(2, "0")}:00</span><span>24h</span></div>
    <div class="sub">Puntos críticos ahora</div>
    <ol class="criticos">${T.criticos.map((c, i) => {
      const nv = nivel(c.r);
      return `<li data-i="${i}" style="--c:${nv[2]}"><span class="rk">${i + 1}</span>
        <span class="nm"><b>${nombreCruce(c)}</b><small>${c.lineas} líneas de micro · ${nv[1].toLowerCase()}</small></span>
        <span class="vel">${fmt(c.v, 0)}<small>km/h</small></span></li>`;
    }).join("")}</ol>
    <div class="leyenda-t">${NIVELES.map((n) => `<span><i style="background:${n[2]}"></i>${n[1]}</span>`).join("")}</div>`;
  const el = $("#secTrafico"); if (el.dataset.h !== html.length + ":" + T.horaCalc) { el.innerHTML = html; el.dataset.h = html.length + ":" + T.horaCalc; }
}

function traficoCerca(p) {
  let mejor = null;
  for (const v of T.vias) {
    if (Math.abs(v.mid[0] - p[0]) > 0.01 || Math.abs(v.mid[1] - p[1]) > 0.01) continue;
    const d = cercaDeVia(p, v); if (d < 250 && (!mejor || d < mejor.d)) mejor = { v, d };
  }
  return mejor;
}
