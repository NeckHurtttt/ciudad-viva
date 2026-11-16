/* Ciudad Viva SCZ — ruta en micro: qué línea tomar, dónde bajar y cuánto caminar (directo o con un transbordo). */
const M = { tramos: [], celdas: new Map(), listo: false, res: null };
const MC = 0.0025;                      // celda de ~275 m
const PASO = 60;                        // muestra cada 60 m sobre cada recorrido
const CAMINA = 1.25;                    // m/s (4,5 km/h)
const ESPERA = 7 * 60;                  // espera media por micro (s)
const RADIO_A = 650, RADIO_T = 250;     // caminata máxima hasta la parada y en el transbordo

const RODEO = 1.35;                     // la calle no es recta: viaje ≈ recta × 1,35

// Las líneas de OSM vienen en muchos pedazos: cada línea se trata como el conjunto de puntos por donde pasa.
function prepararMicro() {
  for (const r of S.rutas) {
    const pts = [];
    for (const tr of r.tramos) for (let k = 1; k < tr.length; k++) {
      const a = tr[k - 1], b = tr[k], n = Math.max(1, Math.round(distM(a, b) / PASO));
      for (let i = 0; i < n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    }
    if (!pts.length) continue;
    const t = M.tramos.length; M.tramos.push({ r, pts });
    pts.forEach((p, i) => { const k = Math.floor(p[0] / MC) + ":" + Math.floor(p[1] / MC); if (!M.celdas.has(k)) M.celdas.set(k, []); M.celdas.get(k).push(t, i); });
  }
  M.listo = true;
}

// para cada línea, el punto más cercano a p (dentro del radio)
function cercanos(p, radio) {
  const out = new Map(), cx = Math.floor(p[0] / MC), cy = Math.floor(p[1] / MC), n = Math.ceil(radio / 250);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const l = M.celdas.get(cx + i + ":" + (cy + j)); if (!l) continue;
    for (let k = 0; k < l.length; k += 2) {
      const t = l[k], m = l[k + 1], d = distM(p, M.tramos[t].pts[m]); if (d > radio) continue;
      const o = out.get(t); if (!o || d < o.d) out.set(t, { m, d });
    }
  }
  return out;
}

function velMicro() { // km/h: 17 en calle libre, menos con tráfico
  const f = T.resumen ? clamp(T.resumen.vel / 36, 0.5, 1.05) : 0.85;
  return 17 * f / 3.6;
}

function calcularMicro() {
  M.res = null;
  if (!M.listo || !R_.A || !R_.B) return pintarRuta();
  const A = R_.A.p, B = R_.B.p, vb = velMicro();
  const nA = cercanos(A, RADIO_A), nB = cercanos(B, RADIO_A);
  let mejor = null;
  const prueba = (c) => { if (!mejor || c.seg < mejor.seg) mejor = c; };
  // directo
  for (const [t, a] of nA) {
    const b = nB.get(t); if (!b) continue;
    const tr = M.tramos[t], viaje = distM(tr.pts[a.m], tr.pts[b.m]) * RODEO;
    if (viaje < 300) continue;
    prueba({ seg: (a.d + b.d) / CAMINA + ESPERA + viaje / vb, tramos: [{ t, de: a.m, a: b.m, viaje }], caminar: [a.d, b.d], trans: 0 });
  }
  // un transbordo: recorrer el primer micro y buscar recorridos que llegan a B a menos de 250 m
  const setB = new Set(nB.keys());
  for (const [t1, a] of nA) {
    if (nB.has(t1) && mejor && mejor.tramos.length === 1) continue;
    const tr1 = M.tramos[t1];
    for (let i = 0; i < tr1.pts.length; i += 3) {
      const viaje1 = distM(tr1.pts[i], tr1.pts[a.m]) * RODEO; if (viaje1 < 300) continue;
      const base = a.d / CAMINA + ESPERA + viaje1 / vb;
      if (mejor && base > mejor.seg) continue;
      const p = tr1.pts[i], cx = Math.floor(p[0] / MC), cy = Math.floor(p[1] / MC);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const l = M.celdas.get(cx + dx + ":" + (cy + dy)); if (!l) continue;
        for (let k = 0; k < l.length; k += 2) {
          const t2 = l[k]; if (!setB.has(t2) || M.tramos[t2].r === tr1.r) continue;
          const j = l[k + 1], tr2 = M.tramos[t2], dT = distM(p, tr2.pts[j]); if (dT > RADIO_T) continue;
          const b = nB.get(t2), viaje2 = distM(tr2.pts[b.m], tr2.pts[j]) * RODEO; if (viaje2 < 300) continue;
          const seg = base + dT / CAMINA + ESPERA + viaje2 / vb + b.d / CAMINA;
          if (!mejor || seg < mejor.seg) mejor = { seg, tramos: [{ t: t1, de: a.m, a: i, viaje: viaje1 }, { t: t2, de: j, a: b.m, viaje: viaje2 }], caminar: [a.d, b.d, dT], trans: 1 };
        }
      }
    }
  }
  const aPie = distM(A, B) * 1.3 / CAMINA;
  M.res = mejor ? { ...mejor, aPie } : { seg: aPie, tramos: [], caminar: [distM(A, B) * 1.3], aPie, soloPie: true };
  if (mejor && aPie < mejor.seg) M.res.mejorAPie = true;
  pintarRuta();
  if (mejor) {
    const ps = mejor.tramos.flatMap((x) => tramoPts(x));
    const xs = ps.map((q) => q[0]).concat(A[0], B[0]), ys = ps.map((q) => q[1]).concat(A[1], B[1]);
    mapa.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 120, bottom: 140, left: 340, right: 380 }, pitch: 50, duration: 1800 });
  }
}

// pedazos reales de la línea dentro del corredor entre la parada de subida y la de bajada
function corredor(x) {
  const tr = M.tramos[x.t], pa = tr.pts[x.de], pb = tr.pts[x.a], cos = Math.cos(pa[1] * RAD);
  const ax = 0, ay = 0, bx = (pb[0] - pa[0]) * cos, by = pb[1] - pa[1], l2 = bx * bx + by * by || 1e-12;
  const dentro = (q) => { const qx = (q[0] - pa[0]) * cos, qy = q[1] - pa[1], t = clamp((qx * bx + qy * by) / l2, 0, 1);
    return Math.hypot(qx - t * bx, qy - t * by) * RAD * R < 350 ? t : null; };
  const paths = [], orden = [];
  for (const seg of tr.r.tramos) {
    let cur = [];
    for (const q of seg) { const t = dentro(q); if (t !== null) { cur.push(q); orden.push({ q, t }); } else if (cur.length) { if (cur.length > 1) paths.push(cur); cur = []; } }
    if (cur.length > 1) paths.push(cur);
  }
  orden.sort((u, v) => u.t - v.t);
  return { paths, linea: [pa, ...orden.map((o) => o.q), pb] };
}
function tramoPts(x) { return corredor(x).linea; }

const calleDe = (p) => { const c = traficoCerca(p); return c ? corto(c.v.n) : "la parada"; };

function pintarMicro() {
  const el = $("#rutaInfo"); if (!el) return;
  const r = M.res;
  if (!r) { el.innerHTML = R_.A && R_.B ? '<p class="ayuda">Calculando…</p>' : ""; return; }
  if (r.soloPie) { el.innerHTML = `<div class="consejo">No hay micro a menos de ${RADIO_A} m de los dos puntos. A pie: <b>${Math.round(r.aPie / 60)} min</b>.</div>`; return; }
  const vb = velMicro(), min = Math.round(r.seg / 60), pie = Math.round(r.caminar.reduce((a, b) => a + b, 0)), espera = r.tramos.length * ESPERA, viaje = r.tramos.reduce((a, x) => a + x.viaje / vb, 0);
  const pct = (x) => (x / r.seg * 100).toFixed(1);
  const pasos = [];
  pasos.push(`<li class="pie"><i>🚶</i><span>Camina <b>${Math.round(r.caminar[0])} m</b> hasta ${calleDe(M.tramos[r.tramos[0].t].pts[r.tramos[0].de])}</span></li>`);
  r.tramos.forEach((x, n) => {
    const tr = M.tramos[x.t], ru = tr.r, bajar = tr.pts[x.a];
    pasos.push(`<li class="bus" style="--c:${ru.color}"><i>${ru.ref}</i><span>Toma la <b>línea ${ru.ref}</b> <small>${ru.desde && ru.hasta ? `${ru.desde} → ${ru.hasta}` : ru.nombre}</small><br>${fmt(x.viaje / 1000)} km · ${Math.round(x.viaje / vb / 60)} min · baja en ${calleDe(bajar)}</span></li>`);
    if (n === 0 && r.tramos.length > 1) pasos.push(`<li class="pie"><i>🔁</i><span>Transbordo: camina <b>${Math.round(r.caminar[2])} m</b></span></li>`);
  });
  pasos.push(`<li class="pie"><i>🏁</i><span>Camina <b>${Math.round(r.caminar[1])} m</b> hasta ${R_.B.nombre}</span></li>`);
  el.innerHTML = `
    <div class="aqi" style="--c:${r.trans ? "#ffd23f" : "#2bd9a0"}"><div class="num">${min}<small>min en micro</small></div>
      <div><b>${r.trans ? "1 transbordo" : "Directo"}</b><span>${pie} m a pie · espera ~${Math.round(espera / 60)} min · micro a ~${Math.round(vb * 3.6)} km/h por el tráfico</span></div></div>
    <div class="partes"><i style="width:${pct(pie / CAMINA)}%;background:#93a0c4" title="a pie"></i><i style="width:${pct(espera)}%;background:#ffd23f" title="esperando"></i><i style="width:${pct(viaje)}%;background:#2bd9a0" title="en micro"></i></div>
    <div class="marcas-c"><span>a pie</span><span>espera</span><span>en micro</span></div>
    ${r.mejorAPie ? `<div class="consejo">Caminando llegas en ${Math.round(r.aPie / 60)} min: ¡conviene ir a pie!</div>` : ""}
    <div class="sub">Paso a paso</div><ol class="micro-pasos">${pasos.join("")}</ol>
    <p class="ayuda">Tiempos estimados: frecuencias y paradas no son oficiales.</p>`;
}

function capasMicro(L, seg) {
  const r = M.res; if (!r || r.soloPie || !R_.A || !R_.B) return;
  const prof = { depthCompare: "always", depthWriteEnabled: false };
  const cs = r.tramos.map((x) => ({ ...corredor(x), c: M.tramos[x.t].r.color, ref: M.tramos[x.t].r.ref }));
  const viajes = cs.map((c) => ({ path: c.linea, c: c.c, ref: c.ref }));
  const piezas = cs.flatMap((c) => c.paths.map((p) => ({ path: p, c: c.c })));
  const pies = [[R_.A.p, viajes[0].path[0]], [viajes[viajes.length - 1].path.slice(-1)[0], R_.B.p]];
  if (viajes.length > 1) pies.push([viajes[0].path.slice(-1)[0], viajes[1].path[0]]);
  L.push(new PathLayer({ id: "micro-halo", data: piezas, getPath: (d) => d.path, widthUnits: "pixels", getWidth: 16, getColor: (d) => hex(d.c, 80), capRounded: true, jointRounded: true, parameters: prof }));
  L.push(new PathLayer({ id: "micro-viaje", data: piezas, getPath: (d) => d.path, widthUnits: "pixels", getWidth: 6, getColor: (d) => hex(d.c, 255), capRounded: true, jointRounded: true, parameters: prof }));
  L.push(new PathLayer({ id: "micro-pie", data: pies, getPath: (d) => d, widthUnits: "pixels", getWidth: 3, getColor: [230, 236, 255, 230],
    getDashArray: [2, 2], dashJustified: true, extensions: [new deck.PathStyleExtension({ dash: true })], parameters: prof }));
  // micro que avanza por cada tramo
  const bus = viajes.map((v) => { const i = Math.floor(((seg * 0.15) % 1) * (v.path.length - 1)); return { p: v.path[i], c: v.c }; });
  L.push(new ScatterplotLayer({ id: "micro-bus", data: bus, getPosition: (d) => d.p, getRadius: 30, radiusMinPixels: 6, radiusMaxPixels: 9,
    getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: (d) => hex(d.c, 255), lineWidthMinPixels: 3, parameters: prof }));
  const paradas = viajes.flatMap((v) => [{ p: v.path[0], c: v.c, t: v.ref }, { p: v.path[v.path.length - 1], c: v.c, t: "↓" }]);
  L.push(new ScatterplotLayer({ id: "micro-paradas", data: paradas, getPosition: (d) => d.p, getRadius: 40, radiusMinPixels: 12, radiusMaxPixels: 16,
    getFillColor: (d) => hex(d.c, 255), stroked: true, getLineColor: [255, 255, 255, 255], lineWidthMinPixels: 2, parameters: prof }));
  L.push(new TextLayer({ id: "micro-paradas-txt", data: paradas, getPosition: (d) => d.p, getText: (d) => String(d.t), characterSet: "auto",
    getSize: 11, fontWeight: 700, getColor: [6, 10, 22, 255], getTextAnchor: "middle", getAlignmentBaseline: "center", parameters: prof }));
}
