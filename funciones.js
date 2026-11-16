/* Ciudad Viva SCZ — funciones: ruta A→B con tráfico, simulación de calles cerradas, buscador y modo presentación. */

/* ===================== Grafo vial y rutas ===================== */
const G = { lista: [], idx: new Map(), listo: false, comp: null };
const claveNodo = (p) => p[0].toFixed(4) + "," + p[1].toFixed(4); // une vértices a menos de ~11 m

function construirGrafo() {
  const nodo = (p) => {
    const k = claveNodo(p); let i = G.idx.get(k);
    if (i === undefined) { i = G.lista.length; G.idx.set(k, i); G.lista.push({ p, ady: [] }); }
    return i;
  };
  for (const v of T.vias) for (let k = 1; k < v.p.length; k++) {
    const a = nodo(v.p[k - 1]), b = nodo(v.p[k]); if (a === b) continue;
    const L = distM(v.p[k - 1], v.p[k]);
    G.lista[a].ady.push({ to: b, via: v.i, L }); G.lista[b].ady.push({ to: a, via: v.i, L });
  }
  // cruces mal dibujados en OSM: une vértices de distintas avenidas a menos de 20 m
  const C = 0.0002, celdas = new Map(), ck = (x, y) => x + ":" + y;
  G.lista.forEach((n, i) => { const k = ck(Math.floor(n.p[0] / C), Math.floor(n.p[1] / C)); if (!celdas.has(k)) celdas.set(k, []); celdas.get(k).push(i); });
  let unidos = 0;
  G.lista.forEach((n, i) => {
    if (!n.ady.length) return;
    const cx = Math.floor(n.p[0] / C), cy = Math.floor(n.p[1] / C), vias = new Set(n.ady.map((e) => e.via));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of celdas.get(ck(cx + dx, cy + dy)) || []) {
      if (j <= i) continue; const m = G.lista[j];
      if (m.ady.some((e) => vias.has(e.via)) || n.ady.some((e) => e.to === j)) continue;
      const L = distM(n.p, m.p); if (L > 20) continue;
      const via = n.ady[0].via;
      n.ady.push({ to: j, via, L }); m.ady.push({ to: i, via, L }); unidos++;
    }
  });
  G.unidos = unidos;
  // componente conexa más grande: solo se engancha ahí para que siempre haya camino
  const comp = new Int32Array(G.lista.length).fill(-1), tam = [];
  for (let s = 0; s < G.lista.length; s++) {
    if (comp[s] >= 0) continue;
    const id = tam.length, pila = [s]; comp[s] = id; let n = 0;
    while (pila.length) { const u = pila.pop(); n++; for (const e of G.lista[u].ady) if (comp[e.to] < 0) { comp[e.to] = id; pila.push(e.to); } }
    tam.push(n);
  }
  G.comp = comp; G.mayor = tam.indexOf(Math.max(...tam)); G.listo = true;
}

function enganchar(p) {
  let mejor = -1, md = Infinity;
  for (let i = 0; i < G.lista.length; i++) {
    if (G.comp[i] !== G.mayor) continue;
    const q = G.lista[i].p; if (Math.abs(q[0] - p[0]) > 0.03 || Math.abs(q[1] - p[1]) > 0.03) continue;
    const d = distM(p, q); if (d < md) { md = d; mejor = i; }
  }
  return mejor < 0 ? null : { nodo: mejor, d: md };
}

function dijkstra(a, b) {
  const n = G.lista.length, dist = new Float64Array(n).fill(Infinity), prev = new Array(n);
  const heap = [[0, a]]; dist[a] = 0;
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist[u]) continue; if (u === b) break;
    for (const e of G.lista[u].ady) {
      const v = T.vias[e.via]; if (v.cerrada) continue;
      const nd = d + e.L / (Math.max(3, v.v) / 3.6);
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = { u, e }; push([nd, e.to]); }
    }
  }
  if (!isFinite(dist[b])) return null;
  const tramos = []; for (let x = b; x !== a; x = prev[x].u) tramos.push({ ...prev[x].e, desde: prev[x].u });
  tramos.reverse();
  let L = 0, libre = 0; for (const t of tramos) { L += t.L; libre += t.L / (VLIBRE[T.vias[t.via].c] / 3.6); }
  return { seg: dist[b], L, libre, tramos };
}

const R_ = { A: null, B: null, res: null, horas: [], elegir: null };

function ponerExtremo(cual, p, nombre) {
  const g = enganchar(p); if (!g) return;
  R_[cual] = { p, nombre: nombre || `${fmt(Math.abs(p[1]), 4)}° S, ${fmt(Math.abs(p[0]), 4)}° O`, ...g };
  R_.elegir = null; marcarElegir();
  if (R_.A && R_.B) calcularRuta(); else pintarRuta();
  pestana("ruta");
}

function calcularRuta() {
  if (!R_.A || !R_.B) return;
  const caminar = (R_.A.d + R_.B.d) / 1.3; // 4,7 km/h a pie hasta la avenida
  const enHora = (h) => { calcularTrafico(h); const r = dijkstra(R_.A.nodo, R_.B.nodo); return r && { ...r, seg: r.seg + caminar, libre: r.libre + caminar }; };
  R_.horas = [];
  const h0 = Math.floor(S.hora);
  for (let k = 0; k <= 12; k++) { const h = (h0 + k) % 24 + 0.25; const r = enHora(h); if (r) R_.horas.push({ h, min: r.seg / 60 }); }
  R_.res = enHora(S.hora);
  calcularTrafico(S.hora); T.horaCalc = S.hora;
  pintarRuta();
  if (R_.res) {
    const xs = R_.res.tramos.flatMap((t) => [G.lista[t.desde].p[0], G.lista[t.to].p[0]]), ys = R_.res.tramos.flatMap((t) => [G.lista[t.desde].p[1], G.lista[t.to].p[1]]);
    mapa.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 120, bottom: 140, left: 340, right: 380 }, pitch: 50, duration: 1800 });
  }
}

function pasosRuta(r) {
  const pasos = [];
  for (const t of r.tramos) {
    const v = T.vias[t.via], u = pasos[pasos.length - 1];
    if (u && u.n === v.n) { u.L += t.L; u.peor = Math.min(u.peor, v.r); } else pasos.push({ n: v.n, L: t.L, peor: v.r });
  }
  // une tramos muy cortos al anterior para que la lista se lea
  const out = [];
  for (const p of pasos.filter((p, i) => p.L > 120 || i === 0 || i === pasos.length - 1)) {
    const u = out[out.length - 1];
    if (u && u.n === p.n) { u.L += p.L; u.peor = Math.min(u.peor, p.peor); } else out.push({ ...p });
  }
  return out;
}

function pintarRuta() {
  const el = $("#rutaInfo"); if (!el) return;
  $("#txtA").textContent = R_.A ? R_.A.nombre : "Elegir origen";
  $("#txtB").textContent = R_.B ? R_.B.nombre : "Elegir destino";
  if (!R_.res) { el.innerHTML = R_.A && R_.B ? '<p class="ayuda">No encontré camino por avenidas entre esos puntos.</p>' : ""; return; }
  const r = R_.res, min = Math.round(r.seg / 60), libre = Math.round(r.libre / 60), extra = min - libre;
  const best = R_.horas.reduce((a, b) => (b.min < a.min ? b : a), R_.horas[0]);
  const maxM = Math.max(...R_.horas.map((x) => x.min));
  const niv = nivel(libre / Math.max(min, 1));
  el.innerHTML = `
    <div class="aqi" style="--c:${niv[2]}"><div class="num">${min}<small>min a las ${hhmm(S.hora)}</small></div>
      <div><b>${fmt(r.L / 1000)} km</b><span>sin tráfico ${libre} min · ${extra > 0 ? `+${extra} min por tráfico` : "sin demoras"}</span></div></div>
    <div class="sub">Si sales a las…</div>
    <div class="barras">${R_.horas.map((x) => `<div class="b ${x === best ? "mejor" : ""}" title="${hhmm(x.h)} · ${Math.round(x.min)} min"
      style="--h:${(x.min / maxM * 100).toFixed(0)}%;--c:${nivel(libre / x.min)[2]}"><i></i><small>${String(Math.floor(x.h)).padStart(2, "0")}</small></div>`).join("")}</div>
    <div class="consejo">Mejor hora: <b>${String(Math.floor(best.h)).padStart(2, "0")}:15</b> · ${Math.round(best.min)} min${Math.round(best.min) < min ? ` (ahorras ${min - Math.round(best.min)} min)` : ""}</div>
    <div class="sub">Por dónde</div>
    <ol class="pasos">${pasosRuta(r).map((p) => `<li style="--c:${nivel(p.peor)[2]}"><b>${corto(p.n)}</b><span>${fmt(p.L / 1000)} km</span></li>`).join("")}</ol>`;
}

function marcarElegir() {
  $("#elegirA").classList.toggle("activo", R_.elegir === "A");
  $("#elegirB").classList.toggle("activo", R_.elegir === "B");
  document.body.classList.toggle("eligiendo", !!R_.elegir || SIM.modo);
}

/* ===================== Simulación ===================== */
const SIM = { modo: false, base: null };

function cerrarCalle(v) {
  const grupo = T.vias.filter((w) => w.n === v.n && distM(w.mid, v.mid) < 600);
  const cerrar = !v.cerrada;
  for (const w of grupo) { w.cerrada = cerrar; if (cerrar) T.sim.cerradas.add(w.i); else T.sim.cerradas.delete(w.i); }
  aplicarSim();
}

function aplicarSim() {
  // base sin simulación (para comparar)
  const guard = { cerradas: [...T.sim.cerradas], lluvia: T.sim.lluvia };
  for (const i of guard.cerradas) T.vias[i].cerrada = false;
  T.sim.cerradas.clear(); T.sim.lluvia = false; for (const v of T.vias) v.extra = 0;
  calcularTrafico(S.hora);
  SIM.base = { resumen: { ...T.resumen }, v: T.vias.map((v) => v.v) };
  for (const i of guard.cerradas) { T.vias[i].cerrada = true; T.sim.cerradas.add(i); }
  T.sim.lluvia = guard.lluvia;
  repartirDesvio(); calcularTrafico(S.hora); T.horaCalc = S.hora;
  if (R_.A && R_.B) calcularRuta();
  pintarSim(); pintarTrafico();
}

function pintarSim() {
  const el = $("#simInfo"); if (!el || !SIM.base) { if (el) el.innerHTML = ""; return; }
  const activa = T.sim.cerradas.size || T.sim.lluvia;
  if (!activa) { el.innerHTML = '<p class="ayuda">Sin cambios todavía. Cierra una avenida o activa la lluvia fuerte.</p>'; return; }
  // con calles cerradas se compara la zona de 1,5 km alrededor; con solo lluvia, toda la ciudad
  const centros = [...T.sim.cerradas].map((i) => T.vias[i].mid);
  const enZona = centros.length ? (v) => centros.some((c) => distM(v.mid, c) < 1500) : () => true;
  const stats = (vel) => { let km = 0, kl = 0, sv = 0; for (const v of T.vias) { if (!enZona(v)) continue; const k = v.L / 1000, x = vel(v);
    km += k; sv += x * k; if (x / VLIBRE[v.c] < 0.5) kl += k; } return { pctLento: kl / (km || 1), vel: sv / (km || 1) }; };
  const a = stats((v) => SIM.base.v[v.i]), b = stats((v) => v.v), dP = Math.round((b.pctLento - a.pctLento) * 100), dV = b.vel - a.vel;
  const ambito = centros.length ? "Zona de 1,5 km alrededor del cierre" : "Toda la ciudad";
  const afect = T.vias.filter((v) => !v.cerrada && v.L > 60 && enZona(v)).map((v) => ({ v, d: SIM.base.v[v.i] - v.v }))
    .filter((o) => o.d > 1).sort((x, y) => y.d * y.v.L - x.d * x.v.L);
  const vistos = new Set(), top = [];
  for (const o of afect) { if (vistos.has(o.v.n)) continue; vistos.add(o.v.n); top.push(o); if (top.length >= 5) break; }
  const nombres = [...new Set([...T.sim.cerradas].map((i) => T.vias[i].n))];
  el.innerHTML = `
    <div class="sub">${ambito}</div>
    <div class="comparar">
      <div><small>Antes</small><b>${Math.round(a.pctLento * 100)}%</b><span>${fmt(a.vel, 0)} km/h</span></div>
      <div class="flecha">→</div>
      <div class="despues"><small>Después</small><b>${Math.round(b.pctLento * 100)}%</b><span>${fmt(b.vel, 0)} km/h</span></div>
      <div class="delta ${dP > 0 ? "malo" : ""}">${dP > 0 ? "+" : ""}${dP} pts<br><small>${dV < 0 ? "" : "+"}${fmt(dV, 1)} km/h</small></div>
    </div>
    ${top.length ? `<div class="sub">Más afectadas por el desvío</div><ol class="pasos">${top.map((o) =>
      `<li style="--c:${o.v.nivel[2]}"><b>${corto(o.v.n)}</b><span>${Math.round(SIM.base.v[o.v.i])} → ${Math.round(o.v.v)} km/h</span></li>`).join("")}</ol>` : ""}
    ${nombres.length ? `<div class="sub">Cerradas</div><div class="chips">${nombres.map((n) => `<span class="chip cerr" data-n="${n}" title="Reabrir">✕ ${corto(n)}</span>`).join("")}</div>` : ""}`;
}

function restablecerSim() {
  for (const i of T.sim.cerradas) T.vias[i].cerrada = false;
  T.sim.cerradas.clear(); T.sim.lluvia = false; $("#simLluvia").classList.remove("on");
  aplicarSim();
}

/* ===================== Capas de rutas y simulación ===================== */
function capasFunciones(L, seg) {
  if (!T.listo) return;
  const cerr = T.vias.filter((v) => v.cerrada);
  if (cerr.length) {
    const prof = { depthCompare: "always", depthWriteEnabled: false };
    L.push(new PathLayer({ id: "cerradas-halo", data: cerr, getPath: (d) => d.p, widthUnits: "pixels", getWidth: 18,
      getColor: [255, 77, 109, 60 + 50 * Math.sin(seg * 4) ** 2], updateTriggers: { getColor: Math.round(seg * 10) }, parameters: prof }));
    L.push(new PathLayer({ id: "cerradas", data: cerr, getPath: (d) => d.p, widthUnits: "pixels", getWidth: 8,
      getColor: [255, 77, 109, 255], parameters: prof, pickable: true }));
    L.push(new PathLayer({ id: "cerradas-borde", data: cerr, getPath: (d) => d.p, widthUnits: "pixels", getWidth: 8,
      getColor: [255, 255, 255, 255], getDashArray: [1.2, 1.2], dashJustified: true, extensions: [new deck.PathStyleExtension({ dash: true })], parameters: prof }));
    const marcas = []; const vistos = new Set();
    for (const v of cerr) { const k = v.n + Math.round(v.mid[0] * 300); if (!vistos.has(k)) { vistos.add(k); marcas.push(v); } }
    L.push(new ScatterplotLayer({ id: "cerradas-x", data: marcas, getPosition: (d) => d.mid, getRadius: 40, radiusMinPixels: 11, radiusMaxPixels: 15,
      getFillColor: [255, 77, 109, 255], stroked: true, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 2, parameters: { depthCompare: "always", depthWriteEnabled: false } }));
    L.push(new TextLayer({ id: "cerradas-txt", data: marcas, getPosition: (d) => d.mid, getText: () => "✕", characterSet: "auto",
      getSize: 13, getColor: [255, 255, 255, 255], fontWeight: 700, getTextAnchor: "middle", getAlignmentBaseline: "center", parameters: { depthCompare: "always", depthWriteEnabled: false } }));
  }
  if (R_.res && S.tab === "ruta") {
    const segs = R_.res.tramos.map((t) => ({ path: [G.lista[t.desde].p, G.lista[t.to].p], v: T.vias[t.via] }));
    L.push(new PathLayer({ id: "ruta-halo", data: segs, getPath: (d) => d.path, widthUnits: "pixels", getWidth: 16,
      getColor: [124, 92, 255, 90], capRounded: true, jointRounded: true, parameters: { depthCompare: "always", depthWriteEnabled: false } }));
    L.push(new PathLayer({ id: "ruta", data: segs, getPath: (d) => d.path, widthUnits: "pixels", getWidth: 6,
      getColor: (d) => hex(d.v.nivel[2], 255), capRounded: true, jointRounded: true, parameters: { depthCompare: "always", depthWriteEnabled: false } }));
    // pulso que recorre la ruta
    const tot = R_.res.L, s = ((seg * 0.12) % 1) * tot; let acc = 0, pos = null;
    for (const t of R_.res.tramos) { if (acc + t.L >= s) { const f = (s - acc) / t.L, a = G.lista[t.desde].p, b = G.lista[t.to].p; pos = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; break; } acc += t.L; }
    if (pos) L.push(new ScatterplotLayer({ id: "ruta-pulso", data: [pos], getPosition: (d) => d, getRadius: 30, radiusMinPixels: 6, radiusMaxPixels: 10,
      getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: [124, 92, 255, 255], lineWidthMinPixels: 3, parameters: { depthCompare: "always", depthWriteEnabled: false } }));
  }
  const ext = [R_.A && { ...R_.A, t: "A", c: "#2bd9a0" }, R_.B && { ...R_.B, t: "B", c: "#ff7ac6" }].filter(Boolean);
  if (ext.length && S.tab === "ruta") {
    L.push(new ScatterplotLayer({ id: "ab", data: ext, getPosition: (d) => d.p, getRadius: 40, radiusMinPixels: 13, radiusMaxPixels: 17,
      getFillColor: (d) => hex(d.c, 255), stroked: true, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 2.5, parameters: { depthCompare: "always", depthWriteEnabled: false } }));
    L.push(new TextLayer({ id: "ab-txt", data: ext, getPosition: (d) => d.p, getText: (d) => d.t, getSize: 13, fontWeight: 700,
      getColor: [6, 10, 22, 255], getTextAnchor: "middle", getAlignmentBaseline: "center", parameters: { depthCompare: "always", depthWriteEnabled: false } }));
  }
}

/* ===================== Clic en el mapa (lo llama app.js primero) ===================== */
function clicFunciones(e, f) {
  const p = [e.lngLat.lng, e.lngLat.lat];
  if (R_.elegir) { ponerExtremo(R_.elegir, p); return true; }
  if (SIM.modo) {
    const g = overlay.pickObject?.({ x: e.point.x, y: e.point.y, radius: 10, layerIds: ["trafico", "trafico-halo", "cerradas", "cerradas-borde"] });
    if (g?.object?.p) { cerrarCalle(g.object); return true; }
    return true; // en modo cerrar no se mueve "Tu punto"
  }
  return false;
}

/* ===================== Buscador ===================== */
const sinTilde = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let resultados = [], sel = 0;

function indiceBusqueda() {
  const out = [];
  for (const h of D.hitos) out.push({ t: h.n, s: CAT[h.c][1], c: h.col, p: h.p, tipo: "lugar" });
  const porCalle = new Map();
  for (const v of T.vias) { if (!porCalle.has(v.n)) porCalle.set(v.n, []); porCalle.get(v.n).push(v); }
  for (const [n, vs] of porCalle) {
    const xs = vs.flatMap((v) => v.p.map((q) => q[0])), ys = vs.flatMap((v) => v.p.map((q) => q[1]));
    const km = vs.reduce((a, v) => a + v.L, 0) / 1000; if (km < 0.2) continue;
    out.push({ t: n, s: `Avenida · ${fmt(km)} km`, c: "#93a0c4", p: vs[Math.floor(vs.length / 2)].mid, caja: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], tipo: "calle" });
  }
  for (const r of S.rutas) out.push({ t: `Línea ${r.ref}`, s: `${r.desde} → ${r.hasta}`, c: r.color, p: r.tramos[0][Math.floor(r.tramos[0].length / 2)], r, tipo: "linea" });
  return out;
}

function buscar(q) {
  const n = sinTilde(q.trim()); if (n.length < 2) return [];
  const palabras = n.split(/\s+/);
  return indiceBusqueda().map((x) => {
    const t = sinTilde(x.t + " " + (x.tipo === "linea" ? x.s : ""));
    if (!palabras.every((w) => t.includes(w))) return null;
    return { ...x, score: (sinTilde(x.t).startsWith(n) ? 0 : 1) + (x.tipo === "lugar" ? 0 : x.tipo === "calle" ? 0.3 : 0.6) + x.t.length / 200 };
  }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 8);
}

function pintarResultados() {
  const ul = $("#resultados");
  ul.hidden = !resultados.length;
  ul.innerHTML = resultados.map((r, i) => `<li class="${i === sel ? "sel" : ""}" data-i="${i}" style="--c:${r.c}">
    <i></i><span><b>${r.t}</b><small>${r.s}</small></span>
    <span class="ir"><button data-a="A" title="Salir desde aquí">A</button><button data-a="B" title="Ir hasta aquí">B</button></span></li>`).join("");
}

function elegirResultado(r, como) {
  $("#resultados").hidden = true; $("#buscar").blur();
  if (como) { ponerExtremo(como, r.p, r.t); return; }
  if (r.tipo === "linea") {
    S.lineaSel = r.r.idx; S.capas.micros = true;
    const xs = r.r.tramos.flat().map((q) => q[0]), ys = r.r.tramos.flat().map((q) => q[1]);
    mapa.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 120, pitch: 45, duration: 1800 });
    return;
  }
  if (r.caja) mapa.fitBounds(r.caja, { padding: 140, pitch: 55, duration: 1800 });
  else mapa.flyTo({ center: r.p, zoom: 16.4, pitch: 62, duration: 2000, essential: true });
  S.punto = r.p; analizarPunto(); pestana("punto");
}

/* ===================== Modo presentación ===================== */
const PRES = { on: false, id: 0 };
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function presentar() {
  if (PRES.on) return salirPresentacion();
  const id = ++PRES.id; PRES.on = true; document.body.classList.add("presentando");
  const vivo = () => PRES.on && PRES.id === id;
  const total = 7;
  const paso = async (n, titulo, texto, accion, ms = 7500) => {
    if (!vivo()) return false;
    $("#guion").hidden = false;
    $("#guion .num").textContent = `${n}/${total}`;
    $("#guion h3").textContent = titulo; $("#guion p").innerHTML = texto;
    $("#guion .barra-g i").style.animation = "none"; void $("#guion .barra-g i").offsetWidth;
    $("#guion .barra-g i").style.animation = `llenar ${ms}ms linear forwards`;
    if (accion) await accion();
    await esperar(ms); return vivo();
  };
  S.play = false; modo(false);
  const crit = T.criticos[0];
  if (!await paso(1, "Santa Cruz de la Sierra, viva", `Un gemelo digital con datos abiertos: <b>${S.rutas.length}</b> líneas de micro, <b>${T.vias.length.toLocaleString("es-BO")}</b> tramos de avenida y <b>${S.focos ? S.focos.todos.length.toLocaleString("es-BO") : "—"}</b> focos de calor satelitales en 7 días.`,
    () => mapa.flyTo({ ...DEPTO, duration: 3500 }))) return;
  if (!await paso(2, "La ciudad a las 7:45", "Es hora pico de entrada. Cada avenida se pinta según su velocidad estimada: verde fluye, rojo y morado se atascan.",
    () => { S.hora = 7.75; $("#tiempo").value = S.hora; pestana("trafico"); mapa.flyTo({ ...CIUDAD, duration: 3500 }); })) return;
  if (crit && !await paso(3, `Punto crítico: ${nombreCruce(crit)}`, `Pasan <b>${crit.lineas}</b> líneas de micro por este cruce. A esta hora se avanza a unos <b>${Math.round(crit.v)} km/h</b>.`,
    () => mapa.flyTo({ center: crit.p, zoom: 16, pitch: 64, bearing: 35, duration: 3200 }))) return;
  if (crit && !await paso(4, "¿Y si se cierra por un bloqueo?", "Cerramos esa avenida: el tráfico se desvía a las paralelas y la simulación muestra cuáles colapsan.",
    () => { pestana("sim"); cerrarCalle(crit.vias[0]); mapa.easeTo({ zoom: 14.6, pitch: 55, duration: 2500 }); }, 8500)) return;
  restablecerSim();
  const a = D.hitos.find((h) => /terminal|bimodal/i.test(h.n)) || D.hitos[0], b = D.hitos.find((h) => /UPSA|Privada de Santa Cruz/i.test(h.n))
    || D.hitos.filter((h) => /universidad/i.test(h.n)).sort((x, y) => distM(y.p, a?.p || CIUDAD.center) - distM(x.p, a?.p || CIUDAD.center))[0]
    || D.hitos.find((h) => h !== a);
  if (a && b && !await paso(5, "¿A qué hora conviene salir?", `Ruta de <b>${a.n}</b> a <b>${b.n}</b>: el tiempo cambia hora por hora y la app recomienda la mejor.`,
    () => { ponerExtremo("A", a.p, a.n); ponerExtremo("B", b.p, b.n); }, 9000)) return;
  if (!await paso(6, "El aire que respiramos", `Calidad del aire (PM2,5) y lluvia de Open-Meteo, hora por hora. Ahora: <b>${fmt(promedio("pm25", S.hora))} µg/m³</b>.`,
    () => { S.capas.aire = true; pestana("trafico"); mapa.flyTo({ center: CIUDAD.center, zoom: 11.6, pitch: 40, bearing: -10, duration: 3500 }); })) return;
  if (!await paso(7, "Para decidir mejor", "Ciudad Viva junta tráfico, transporte, aire y fuego en un solo lugar para vecinos, choferes y la alcaldía.",
    () => { S.giro = true; mapa.flyTo({ ...CIUDAD, duration: 3000 }); }, 8000)) return;
  salirPresentacion();
}

function salirPresentacion() {
  PRES.on = false; PRES.id++; S.giro = false; $("#guion").hidden = true; document.body.classList.remove("presentando");
  $("#ahora").click();
}

/* ===================== Eventos de la interfaz ===================== */
function eventosFunciones() {
  $("#elegirA").onclick = () => { R_.elegir = R_.elegir === "A" ? null : "A"; SIM.modo = false; marcarSim(); marcarElegir(); };
  $("#elegirB").onclick = () => { R_.elegir = R_.elegir === "B" ? null : "B"; SIM.modo = false; marcarSim(); marcarElegir(); };
  $("#invertir").onclick = () => { [R_.A, R_.B] = [R_.B, R_.A]; calcularRuta(); pintarRuta(); };
  $("#borrarRuta").onclick = () => { R_.A = R_.B = R_.res = null; R_.horas = []; pintarRuta(); };
  $("#simModo").onclick = () => { SIM.modo = !SIM.modo; R_.elegir = null; marcarSim(); marcarElegir(); };
  $("#simLluvia").onclick = () => { T.sim.lluvia = !T.sim.lluvia; $("#simLluvia").classList.toggle("on", T.sim.lluvia); aplicarSim(); };
  $("#simReset").onclick = restablecerSim;
  $("#simInfo").addEventListener("click", (e) => {
    const ch = e.target.closest(".cerr"); if (!ch) return;
    for (const i of [...T.sim.cerradas]) if (T.vias[i].n === ch.dataset.n) { T.vias[i].cerrada = false; T.sim.cerradas.delete(i); }
    aplicarSim();
  });
  const inp = $("#buscar");
  inp.addEventListener("input", () => { resultados = buscar(inp.value); sel = 0; pintarResultados(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, resultados.length - 1); pintarResultados(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); pintarResultados(); e.preventDefault(); }
    else if (e.key === "Enter" && resultados[sel]) elegirResultado(resultados[sel]);
    else if (e.key === "Escape") { $("#resultados").hidden = true; inp.blur(); }
    e.stopPropagation();
  });
  $("#resultados").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li"); if (!li) return; e.preventDefault();
    const b = e.target.closest("button"); elegirResultado(resultados[+li.dataset.i], b?.dataset.a);
  });
  inp.addEventListener("blur", () => setTimeout(() => ($("#resultados").hidden = true), 150));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== inp) { e.preventDefault(); inp.focus(); }
    if (e.key === "Escape" && PRES.on) salirPresentacion();
  });
  $("#presentar").onclick = presentar;
  $("#guionSalir").onclick = salirPresentacion;
}
function marcarSim() { $("#simModo").classList.toggle("on", SIM.modo); $("#simModo b").textContent = SIM.modo ? "Toca una avenida para cerrarla o reabrirla" : "Cerrar calles"; }
