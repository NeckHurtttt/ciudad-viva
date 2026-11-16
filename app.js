/* Ciudad Viva SCZ — gemelo digital de Santa Cruz de la Sierra */
"use strict";
const { MapboxOverlay, PathLayer, ScatterplotLayer, BitmapLayer } = deck;

const CIUDAD = { center: [-63.18, -17.783], zoom: 13.4, pitch: 62, bearing: -22 };
const DEPTO = { center: [-61.4, -17.4], zoom: 6.1, pitch: 30, bearing: 0 };
const GRILLA = { n: 7, lat: [-17.98, -17.62], lon: [-63.32, -62.98] };
const TZ = "America/La_Paz";
const PALETA = ["#2bd9a0", "#4aa8ff", "#b47cff", "#ff7ac6", "#ffd23f", "#40e0ff", "#9cff57", "#ff9f45", "#7c9bff", "#ff6b8b"];

const $ = (s) => document.querySelector(s);
const hex = (h, a = 255) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const R = 6371000, RAD = Math.PI / 180;

const S = {
  hora: 12, vivo: true, play: false, tab: "trafico", giro: false, lineaSel: null, punto: null,
  capas: { trafico: true, lugares: true, micros: true, aire: true, lluvia: true, viento: true, focos: true, edificios: true },
  rutas: [], tramos: [], focos: null, clima: null, viento: [], t0: performance.now(),
};

/* ---------- Datos ---------- */
async function json(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }

function grillaCoords() {
  const lats = [], lons = [];
  const { n, lat, lon } = GRILLA;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    lats.push((lat[0] + (lat[1] - lat[0]) * i / (n - 1)).toFixed(3));
    lons.push((lon[0] + (lon[1] - lon[0]) * j / (n - 1)).toFixed(3));
  }
  return { lats, lons };
}

async function climaEnVivo() {
  const { lats, lons } = grillaCoords();
  const q = `latitude=${lats}&longitude=${lons}&forecast_days=1&timezone=America%2FLa_Paz`;
  const [aire, met] = await Promise.all([
    json("https://air-quality-api.open-meteo.com/v1/air-quality?" + q + "&hourly=pm2_5"),
    json("https://api.open-meteo.com/v1/forecast?" + q + "&hourly=precipitation,wind_speed_10m,wind_direction_10m,temperature_2m"),
  ]);
  const c = { fuente: "Open-Meteo en vivo", n: GRILLA.n, lat: GRILLA.lat, lon: GRILLA.lon,
    horas: aire[0].hourly.time, pm25: [], lluvia: [], viento: [], dir: [], temp: [] };
  aire.forEach((a, k) => {
    const h = met[k].hourly;
    c.pm25.push(a.hourly.pm2_5); c.lluvia.push(h.precipitation); c.viento.push(h.wind_speed_10m);
    c.dir.push(h.wind_direction_10m); c.temp.push(h.temperature_2m);
  });
  return c;
}

function distM(a, b) { // [lon,lat] equirectangular, suficiente a escala de ciudad
  const x = (b[0] - a[0]) * RAD * Math.cos((a[1] + b[1]) / 2 * RAD), y = (b[1] - a[1]) * RAD;
  return Math.sqrt(x * x + y * y) * R;
}
function haversine(a, b) {
  const dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function prepararRutas(datos) {
  S.rutas = datos.rutas.map((r, i) => ({ ...r, color: PALETA[i % PALETA.length], idx: i }));
  for (const r of S.rutas) for (const tr of r.tramos) {
    const acum = [0];
    for (let k = 1; k < tr.length; k++) acum.push(acum[k - 1] + distM(tr[k - 1], tr[k]));
    const L = acum[acum.length - 1];
    if (L < 600) continue;
    const n = Math.max(1, Math.round(L / 1600));
    S.tramos.push({ ruta: r, coords: tr, acum, L, n, fase: Math.random() });
  }
}

/* ---------- Campo del clima ---------- */
function campo(nombre, h, lon, lat) {
  const c = S.clima, n = c.n;
  const fy = clamp((lat - c.lat[0]) / (c.lat[1] - c.lat[0]), 0, 1) * (n - 1);
  const fx = clamp((lon - c.lon[0]) / (c.lon[1] - c.lon[0]), 0, 1) * (n - 1);
  const i0 = Math.min(n - 2, Math.floor(fy)), j0 = Math.min(n - 2, Math.floor(fx));
  const ty = fy - i0, tx = fx - j0;
  const nh = c.horas.length, h0 = clamp(Math.floor(h), 0, nh - 1), h1 = Math.min(nh - 1, h0 + 1), th = clamp(h - h0, 0, 1);
  const v = (i, j) => {
    const s = c[nombre][i * n + j];
    const a = s[h0] ?? 0, b = s[h1] ?? a;
    if (nombre === "dir") { let d = ((b - a + 540) % 360) - 180; return (a + d * th + 360) % 360; }
    return a + (b - a) * th;
  };
  if (nombre === "dir") return v(Math.round(fy), Math.round(fx));
  return (v(i0, j0) * (1 - tx) + v(i0, j0 + 1) * tx) * (1 - ty) + (v(i0 + 1, j0) * (1 - tx) + v(i0 + 1, j0 + 1) * tx) * ty;
}
function promedio(nombre, h) {
  const s = S.clima[nombre]; let t = 0;
  for (const serie of s) t += serie[clamp(Math.round(h), 0, serie.length - 1)] ?? 0;
  return t / s.length;
}

const ESCALA = [ // PM2,5 µg/m³
  [0, "#2bd9a0", "Bueno", "Respira tranquilo."],
  [12, "#ffd23f", "Moderado", "Personas muy sensibles, con cuidado."],
  [35, "#ff9f45", "Malo para grupos sensibles", "Niños, mayores y asmáticos: limiten el tiempo afuera."],
  [55, "#ff4d6d", "Dañino", "Eviten ejercicio afuera, usen barbijo N95 y cierren ventanas."],
  [150, "#b04dff", "Muy dañino", "Quédense adentro si pueden."],
];
function categoria(pm) { let c = ESCALA[0]; for (const e of ESCALA) if (pm >= e[0]) c = e; return c; }
function colorPM(pm) {
  for (let k = ESCALA.length - 1; k >= 0; k--) if (pm >= ESCALA[k][0]) {
    const a = ESCALA[k], b = ESCALA[Math.min(k + 1, ESCALA.length - 1)];
    const t = b === a ? 0 : clamp((pm - a[0]) / (b[0] - a[0]), 0, 1);
    const ca = hex(a[1]), cb = hex(b[1]);
    return ca.map((x, i) => x + (cb[i] - x) * t);
  }
  return hex(ESCALA[0][1]);
}

let cacheBmp = { clave: "", aire: null, lluvia: null };
function bitmaps() {
  const clave = S.hora.toFixed(2);
  if (cacheBmp.clave === clave) return cacheBmp;
  const W = 120, H = 120, c = S.clima;
  const mk = (fn) => {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const lon = c.lon[0] + (c.lon[1] - c.lon[0]) * (px + .5) / W, lat = c.lat[1] - (c.lat[1] - c.lat[0]) * (py + .5) / H;
      const bx = Math.min(px, W - 1 - px) / (W * .18), by = Math.min(py, H - 1 - py) / (H * .18);
      const borde = clamp(Math.min(bx, by), 0, 1), suave = borde * borde * (3 - 2 * borde);
      const [r, g, b, a] = fn(lon, lat);
      const o = (py * W + px) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a * suave;
    }
    ctx.putImageData(img, 0, 0); return cv;
  };
  cacheBmp = {
    clave,
    aire: mk((lon, lat) => { const pm = campo("pm25", S.hora, lon, lat); const [r, g, b] = colorPM(pm); return [r, g, b, 22 + clamp(pm / 80, 0, 1) * 90]; }),
    lluvia: mk((lon, lat) => { const mm = campo("lluvia", S.hora, lon, lat); return [74, 168, 255, clamp(mm / 4, 0, 1) * 190]; }),
  };
  return cacheBmp;
}

/* ---------- Viento: partículas ---------- */
function nuevaParticula() {
  const c = S.clima;
  const p = [c.lon[0] + Math.random() * (c.lon[1] - c.lon[0]), c.lat[0] + Math.random() * (c.lat[1] - c.lat[0])];
  return { p, rastro: [p.slice()], edad: Math.floor(Math.random() * 80), vida: 70 + Math.random() * 60 };
}
function moverViento() {
  if (!S.viento.length) S.viento = Array.from({ length: 650 }, nuevaParticula);
  const c = S.clima;
  for (let k = 0; k < S.viento.length; k++) {
    const q = S.viento[k];
    const v = campo("viento", S.hora, q.p[0], q.p[1]), d = campo("dir", S.hora, q.p[0], q.p[1]) * RAD;
    const paso = 0.000045 * v; // grados por cuadro
    q.p = [q.p[0] - Math.sin(d) * paso / Math.cos(q.p[1] * RAD), q.p[1] - Math.cos(d) * paso];
    q.rastro.push(q.p.slice()); if (q.rastro.length > 10) q.rastro.shift();
    q.edad++;
    const fuera = q.p[0] < c.lon[0] || q.p[0] > c.lon[1] || q.p[1] < c.lat[0] || q.p[1] > c.lat[1];
    if (fuera || q.edad > q.vida) S.viento[k] = nuevaParticula();
  }
}

/* ---------- Micros ---------- */
function frecuencia(h) { // fracción de la flota en la calle según la hora
  if (h < 5) return 0.08;
  if (h < 6.5) return 0.08 + (h - 5) / 1.5 * 0.8;
  if (h < 9) return 1;
  if (h < 17) return 0.75;
  if (h < 19.5) return 1;
  if (h < 22.5) return 1 - (h - 19.5) / 3 * 0.85;
  return 0.12;
}
function enDistancia(t, s) {
  const a = t.acum; let lo = 0, hi = a.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= s) lo = m; else hi = m; }
  const f = (s - a[lo]) / ((a[hi] - a[lo]) || 1), p = t.coords[lo], q = t.coords[hi];
  return { p: [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], k: lo };
}
function calcularMicros(seg) {
  const fr = frecuencia(S.hora), cabezas = [], rastros = [];
  const vel = 65; // m/s en pantalla (≈22 km/h acelerado ×10)
  for (const t of S.tramos) {
    const activos = Math.max(fr > 0.3 ? 1 : 0, Math.round(t.n * fr));
    for (let b = 0; b < activos; b++) {
      const s = ((t.fase + b / t.n) * t.L + seg * vel) % t.L;
      const cab = enDistancia(t, s);
      const desde = Math.max(0, s - 320), cola = enDistancia(t, desde);
      const camino = [cola.p];
      for (let k = cola.k + 1; k <= cab.k; k++) camino.push(t.coords[k]);
      camino.push(cab.p);
      cabezas.push({ p: cab.p, ruta: t.ruta });
      rastros.push({ path: camino, ruta: t.ruta });
    }
  }
  return { cabezas, rastros };
}

/* ---------- Capas deck.gl ---------- */
// una línea seleccionada resalta ida y vuelta (mismo número)
const esSel = (r) => S.lineaSel != null && S.rutas[S.lineaSel]?.ref === r.ref;
function opacidadRuta(r) { return S.lineaSel == null || esSel(r) ? 1 : 0.12; }

function capas(seg) {
  const L = [], c = S.capas, b = bitmaps();
  const bounds = [S.clima.lon[0], S.clima.lat[0], S.clima.lon[1], S.clima.lat[1]];
  if (c.aire) L.push(new BitmapLayer({ id: "aire", image: b.aire, bounds, opacity: 0.9, updateTriggers: { image: b.clave } }));
  if (c.lluvia) L.push(new BitmapLayer({ id: "lluvia", image: b.lluvia, bounds, opacity: 1 }));
  if (c.micros) {
    L.push(new PathLayer({
      id: "rutas", data: S.rutas.flatMap((r) => r.tramos.map((path) => ({ path, r }))),
      getPath: (d) => d.path, getColor: (d) => hex(d.r.color, 38 * opacidadRuta(d.r) + (esSel(d.r) ? 120 : 0)),
      getWidth: (d) => (esSel(d.r) ? 5 : 2), widthUnits: "pixels", updateTriggers: { getColor: S.lineaSel, getWidth: S.lineaSel },
    }));
    const m = calcularMicros(seg); S.enRuta = m.cabezas.length;
    L.push(new PathLayer({
      id: "rastros", data: m.rastros, getPath: (d) => d.path, getColor: (d) => hex(d.ruta.color, 170 * opacidadRuta(d.ruta)),
      getWidth: 3.2, widthUnits: "pixels", capRounded: true, jointRounded: true,
    }));
    L.push(new ScatterplotLayer({
      id: "micros", data: m.cabezas, getPosition: (d) => d.p, getFillColor: (d) => hex("#ffffff", 255 * opacidadRuta(d.ruta)),
      getLineColor: (d) => hex(d.ruta.color, 230 * opacidadRuta(d.ruta)), stroked: true, lineWidthMinPixels: 2,
      getRadius: 26, radiusMinPixels: 2.5, radiusMaxPixels: 7, pickable: true,
    }));
  }
  capasTrafico(L, seg);
  capasAmbiente(L, seg);
  capasDetalle(L, seg);
  capasFunciones(L, seg);
  capasMejoras(L, seg);
  if (c.viento) {
    L.push(new PathLayer({
      id: "viento", data: S.viento, getPath: (d) => d.rastro, widthUnits: "pixels", getWidth: 1.8,
      getColor: (d) => [200, 225, 255, 190 * Math.sin(Math.PI * clamp(d.edad / d.vida, 0, 1))],
    }));
  }
  if (c.focos && S.focos) {
    const pulso = (Math.sin(seg * 3) + 1) / 2;
    L.push(new ScatterplotLayer({
      id: "focos-halo", data: S.focos.recientes, getPosition: (d) => d.p, getRadius: (d) => 1800 + d.frp * 60,
      radiusMinPixels: 4 + pulso * 6, getFillColor: [255, 90, 40, 40 + pulso * 40], updateTriggers: { radiusMinPixels: pulso },
    }));
    L.push(new ScatterplotLayer({
      id: "focos", data: S.focos.todos, getPosition: (d) => d.p, getRadius: (d) => 500 + Math.min(d.frp, 200) * 25,
      radiusMinPixels: 1.6, radiusMaxPixels: 14, pickable: true,
      getFillColor: (d) => { const n = d.nuevo; return [255, 110 + 90 * (1 - n), 40, 90 + 150 * n]; },
    }));
  }
  if (S.punto) {
    const pulso = (seg * 0.8) % 1;
    L.push(new ScatterplotLayer({
      id: "punto", data: [S.punto], getPosition: (d) => d, getRadius: 400, stroked: true, filled: true,
      getFillColor: [124, 92, 255, 30], getLineColor: [180, 160, 255, 220], lineWidthMinPixels: 1.5,
    }));
    L.push(new ScatterplotLayer({
      id: "punto-onda", data: [S.punto], getPosition: (d) => d, getRadius: 400 * pulso, stroked: true, filled: false,
      getLineColor: [255, 255, 255, 220 * (1 - pulso)], lineWidthMinPixels: 2, updateTriggers: { getRadius: pulso, getLineColor: pulso },
    }));
  }
  return L;
}

/* ---------- Mapa ---------- */
const mapa = new maplibregl.Map({
  container: "mapa", style: "https://tiles.openfreemap.org/styles/dark", ...CIUDAD,
  maxPitch: 75, antialias: true, attributionControl: false, preserveDrawingBuffer: true, // para la captura
  pixelRatio: Math.min(devicePixelRatio || 1, 1.5), // en pantallas muy densas se dibuja a 1,5× para no trabar
});
const overlay = new MapboxOverlay({
  interleaved: true, layers: [],
  getTooltip: ({ object, layer }) => {
    if (!object || !layer) return null;
    if (layer.id === "micros") return { text: `${object.ruta.nombre}\n${object.ruta.desde} → ${object.ruta.hasta}`, className: "tip" };
    if (layer.id === "reportes") return { text: `${TIPOS[object.tipo].t} · ${hace(object.t)}\n${object.votos} ${object.votos > 1 ? "personas lo confirman" : "reporte"} · toca para confirmar`, className: "tip" };
    if (layer.id === "hitos") return { text: `${object.n}\n${CAT[object.c][1]}`, className: "tip" };
    if (layer.id === "trafico") return { text: `${object.n}\n${object.nivel[1]} · ~${Math.round(object.v)} km/h (libre ${VLIBRE[object.c]})\n${fmt(object.lineas, 1)} líneas de micro por tramo`, className: "tip" };
    if (layer.id === "criticos") return { text: `#${T.criticos.indexOf(object) + 1} ${nombreCruce(object)}\n${nivel(object.r)[1]} · ~${Math.round(object.v)} km/h · ${object.lineas} líneas`, className: "tip" };
    if (layer.id === "zonas") return { text: textoZona(object), className: "tip" };
    if (layer.id === "focos") return { text: `Foco de calor · ${object.fecha} ${object.hora}\nPotencia ${object.frp} MW`, className: "tip" };
    return null;
  },
});
mapa.addControl(overlay);

// Fachada con ventanas: fondo oscuro y una grilla de ventanas, algunas encendidas.
function texturaVentanas(base, luces, semilla) {
  const W = 64, H = 64, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); let s = semilla;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,.05)"; for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1); // losas
  for (let y = 2; y < H; y += 8) for (let x = 2; x < W; x += 8) {
    const r = rnd();
    g.fillStyle = r < 0.34 ? luces[(rnd() * luces.length) | 0] : r < 0.5 ? "rgba(120,150,255,.22)" : "rgba(10,14,30,.85)";
    g.fillRect(x, y + 1, 5, 4);
  }
  return g.getImageData(0, 0, W, H);
}

const ALTURA = ["coalesce", ["get", "render_height"], 6];
function edificios3D() {
  const st = mapa.getStyle();
  const primerTexto = st.layers.find((l) => l.type === "symbol")?.id;
  if (mapa.getLayer("building")) mapa.setLayoutProperty("building", "visibility", "none");

  // Ambiente: luz rasante cálida, cielo nocturno con horizonte violeta y niebla a lo lejos
  mapa.setLight({ anchor: "map", color: "#d8deff", intensity: 0.38, position: [1.5, 215, 32] });
  try {
    mapa.setSky({ "sky-color": "#070b1f", "horizon-color": "#3a2672", "fog-color": "#0a0f22",
      "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.82, "atmosphere-blend": 0.9 });
  } catch (e) { console.warn("sin cielo", e); }

  // Agua y verde con más vida
  const pinta = (id, k, v) => { if (mapa.getLayer(id)) mapa.setPaintProperty(id, k, v); };
  pinta("water", "fill-color", "#0b2342");
  pinta("waterway", "line-color", "#2f7fd6"); pinta("waterway", "line-opacity", 0.85);
  pinta("landuse_park", "fill-color", "#0f2c24"); pinta("landcover_wood", "fill-color", "#0c281d");
  pinta("landuse_residential", "fill-color", "#0f1430");
  pinta("background", "background-color", "#080c1d");
  mapa.addLayer({ id: "agua-brillo", type: "line", source: "openmaptiles", "source-layer": "water",
    paint: { "line-color": "#3aa0ff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 5], "line-blur": 4, "line-opacity": 0.45 } }, "waterway");

  mapa.addImage("ventanas", texturaVentanas("#161c3a", ["#ffd58a", "#ffe9b8", "#ffb36b"], 7), { pixelRatio: 2 });
  mapa.addImage("ventanas-frio", texturaVentanas("#121a36", ["#8fe9ff", "#c8f4ff", "#9db4ff"], 13), { pixelRatio: 2 });

  // Bajos (casas, galpones): color según altura, con degradé vertical
  mapa.addLayer({
    id: "edificios-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
    filter: ["<", ALTURA, 9],
    paint: {
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, ALTURA],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-color": ["interpolate", ["linear"], ALTURA, 0, "#151b36", 4, "#1c2449", 8.9, "#2a3470"],
      "fill-extrusion-opacity": 0.86, "fill-extrusion-vertical-gradient": true,
    },
  }, primerTexto);
  // Altos: fachadas con ventanas encendidas (cálidas hasta 40 m, frías en torres)
  mapa.addLayer({
    id: "edificios-altos", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
    filter: [">=", ALTURA, 9],
    paint: {
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, ALTURA],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-pattern": ["case", [">", ALTURA, 40], "ventanas-frio", "ventanas"],
      "fill-extrusion-opacity": 0.95,
    },
  }, primerTexto);
  // Contorno luminoso de las manzanas edificadas (a ras de suelo)
  mapa.addLayer({ id: "edificios-borde", type: "line", source: "openmaptiles", "source-layer": "building", minzoom: 15,
    paint: { "line-color": "#8494ff", "line-width": 0.8, "line-opacity": 0.5 } }, "edificios-3d");
}

// Contorno local del departamento: la vista lejana se ve aunque los mosaicos tarden.
function contornoDepto(d) {
  const primerTexto = mapa.getStyle().layers.find((l) => l.type === "symbol")?.id;
  mapa.addSource("depto", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: d.anillos } } });
  mapa.addLayer({ id: "depto-relleno", type: "fill", source: "depto", maxzoom: 10,
    paint: { "fill-color": "#2bd9a0", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.06, 10, 0] } }, primerTexto);
  for (const [id, ancho, op, blur] of [["depto-halo", 9, 0.18, 6], ["depto-borde", 1.6, 0.85, 0]])
    mapa.addLayer({ id, type: "line", source: "depto", maxzoom: 11,
      paint: { "line-color": "#2bd9a0", "line-width": ancho, "line-blur": blur,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, op, 11, 0] } }, primerTexto);
}

/* ---------- Interfaz ---------- */
const ICO = {
  micros: '<path d="M6 4h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 11h16M8 18v2M16 18v2"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/>',
  aire: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  lluvia: '<path d="M7 15a5 5 0 1 1 1.5-9.8A6 6 0 0 1 19 9a3.5 3.5 0 0 1-1 6.8H7zM8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  viento: '<path d="M3 9h9a3 3 0 1 0-3-3M3 13h14a3 3 0 1 1-3 3M3 17h5"/>',
  focos: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>',
  trafico: '<path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><circle cx="12" cy="7.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="16.5" r="1.6"/>',
  lugares: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  edificios: '<path d="M3 21h18M5 21V8l6-3v16M11 21V3l8 4v14M14 9h2M14 13h2M14 17h2M7 11h2M7 15h2"/>',
};
const CAPAS = [
  ["trafico", "Tráfico", "#ff4d6d"],
  ["micros", "Micros", "#2bd9a0"],
  ["aire", "Calidad del aire", "#ffd23f"],
  ["lluvia", "Lluvia", "#4aa8ff"],
  ["viento", "Viento", "#b4c8ff"],
  ["focos", "Focos de calor", "#ff7a45"],
  ["lugares", "Lugares clave", "#ff7ac6"],
  ["edificios", "Edificios y árboles", "#7c5cff"],
];
function pintarCapas() {
  $("#listaCapas").innerHTML = CAPAS.map(([k, nom, col]) =>
    `<button class="capa ${S.capas[k] ? "on" : ""}" data-k="${k}" style="--c:${col}">
      <span class="ico"><svg viewBox="0 0 24 24">${ICO[k]}</svg></span><span><b>${nom}</b><small id="st-${k}">—</small></span><span class="sw"></span></button>`).join("");
}
const RUMBOS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const rumbo = (d) => RUMBOS[Math.round(((d + 360) % 360) / 45) % 8];
const fmt = (x, d = 1) => x.toLocaleString("es-BO", { minimumFractionDigits: d, maximumFractionDigits: d });
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

function estadisticas() {
  const h = S.hora, set = (k, t) => { const e = $("#st-" + k); if (e && e.textContent !== t) e.textContent = t; };
  set("micros", `${S.enRuta ?? 0} en ruta · ${S.rutas.length} líneas`);
  const pm = promedio("pm25", h); set("aire", `PM2,5 ${fmt(pm)} · ${categoria(pm)[2].split(" ")[0].toLowerCase()}`);
  set("lluvia", `${fmt(promedio("lluvia", h))} mm/h`);
  set("viento", `${fmt(promedio("viento", h), 0)} km/h del ${rumbo(campo("dir", h, -63.17, -17.79))}`);
  set("focos", S.focos ? `${S.focos.todos.length.toLocaleString("es-BO")} en 7 días` : "—");
  set("edificios", D.listo ? `OSM · ${D.arboles.length.toLocaleString("es-BO")} árboles` : "OpenStreetMap");
  set("lugares", D.listo ? `${D.hitos.length} hospitales, mercados…` : "acércate al mapa");
  if (T.listo && T.resumen) set("trafico", `${Math.round(T.resumen.pctLento * 100)}% lento · ${Math.round(T.resumen.vel)} km/h`);
  $("#hora").textContent = hhmm(h);
}

function horaLocal() {
  const p = new Intl.DateTimeFormat("es-BO", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t) => +p.find((x) => x.type === t).value;
  return g("hour") + g("minute") / 60;
}

function grafico() {
  const svg = $("#grafico"), n = S.clima.horas.length, pm = [], ll = [];
  for (let h = 0; h < n; h++) { pm.push(promedio("pm25", h)); ll.push(promedio("lluvia", h)); }
  const maxPM = Math.max(40, ...pm), maxLL = Math.max(3, ...ll), W = 240, H = 36;
  const x = (h) => (h + 0.5) / n * W, y = (v) => H - 2 - v / maxPM * (H - 6);
  const linea = pm.map((v, h) => `${h ? "L" : "M"}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const barras = ll.map((v, h) => v > 0.01 ? `<rect x="${(h / n * W + 1.5).toFixed(1)}" y="${(H - v / maxLL * H).toFixed(1)}" width="${(W / n - 3).toFixed(1)}" height="${(v / maxLL * H).toFixed(1)}" rx="1.5" fill="#4aa8ff" opacity=".55"/>` : "").join("");
  const puntos = pm.map((v, h) => { const c = colorPM(v); return `<stop offset="${(h + 0.5) / n}" stop-color="rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})"/>`; }).join("");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs><linearGradient id="gpm" x1="0" x2="1">${puntos}</linearGradient>
    <linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2bd9a0" stop-opacity=".25"/><stop offset="1" stop-color="#2bd9a0" stop-opacity="0"/></linearGradient></defs>
    ${barras}<path d="${linea}L${W},${H}L0,${H}Z" fill="url(#gfill)"/>
    <path d="${linea}" fill="none" stroke="url(#gpm)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

function rutasCerca(p, radio = 400) {
  const out = [];
  for (const r of S.rutas) {
    let min = Infinity;
    for (const tr of r.tramos) for (let k = 1; k < tr.length; k++) {
      const a = tr[k - 1], b = tr[k];
      const ax = (a[0] - p[0]) * Math.cos(p[1] * RAD) * RAD * R, ay = (a[1] - p[1]) * RAD * R;
      const bx = (b[0] - p[0]) * Math.cos(p[1] * RAD) * RAD * R, by = (b[1] - p[1]) * RAD * R;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = clamp(-(ax * dx + ay * dy) / l2, 0, 1), cx = ax + t * dx, cy = ay + t * dy;
      min = Math.min(min, Math.hypot(cx, cy));
    }
    if (min <= radio) out.push({ r, d: min });
  }
  return out.sort((a, b) => a.d - b.d);
}

function analizarPunto() {
  const p = S.punto; if (!p) return;
  const h = S.hora, c = S.clima;
  const dentro = p[0] >= c.lon[0] && p[0] <= c.lon[1] && p[1] >= c.lat[0] && p[1] <= c.lat[1];
  const pm = campo("pm25", h, ...p), mm = campo("lluvia", h, ...p), v = campo("viento", h, ...p),
    dir = campo("dir", h, ...p), temp = campo("temp", h, ...p), cat = categoria(pm);
  const cerca = rutasCerca(p).filter((x, i, a) => a.findIndex((y) => y.r.ref === x.r.ref) === i); // ida y vuelta = una línea
  let foco = null;
  if (S.focos) for (const f of S.focos.todos) { const d = haversine(p, f.p); if (!foco || d < foco.d) foco = { ...f, d }; }

  // Mejor hora para salir hoy desde ahora: menos PM2,5 y sin lluvia, de 6 a 21 h
  let mejor = null;
  for (let hh = Math.ceil(h); hh <= 21; hh++) {
    if (hh < 6) continue;
    const costo = campo("pm25", hh, ...p) + campo("lluvia", hh, ...p) * 25;
    if (!mejor || costo < mejor.costo) mejor = { hh, costo, pm: campo("pm25", hh, ...p) };
  }

  const consejos = [cat[3]];
  if (mm >= 2) consejos.push("Lluvia fuerte: calles y canales anegables, mejor salir más tarde.");
  else if (mm > 0.2) consejos.push("Está lloviendo: lleva paraguas.");
  if (!cerca.length) consejos.push("No pasa ninguna línea a menos de 400 m: zona con poca cobertura de micro.");
  if (foco && foco.d < 30000) consejos.push(`Hay un foco de calor a ${fmt(foco.d / 1000)} km: atento al humo.`);
  if (mejor && mejor.hh !== Math.round(h)) consejos.push(`Mejor hora para salir hoy: <b>${String(mejor.hh).padStart(2, "0")}:00</b> (PM2,5 ${fmt(mejor.pm)}).`);

  const tr = T.listo ? traficoCerca(p) : null;
  if (tr && tr.v.r < 0.32) {
    let mejorT = null;
    for (let hh = Math.ceil(h); hh <= 22; hh++) { calcularTrafico(hh); if (!mejorT || tr.v.r > mejorT.r) mejorT = { hh, r: tr.v.r }; }
    calcularTrafico(h); T.horaCalc = h;
    consejos.push(`${corto(tr.v.n)} va ${tr.v.nivel[1].toLowerCase()}${mejorT && mejorT.hh > h ? `: desde las <b>${String(mejorT.hh).padStart(2, "0")}:00</b> se despeja` : ""}.`);
  }
  const pos = clamp(pm / 160, 0, 1) * 100;
  $("#puntoInfo").innerHTML = `
    <div class="lugar">${fmt(Math.abs(p[1]), 4)}° S · ${fmt(Math.abs(p[0]), 4)}° O · ${hhmm(h)}${dentro ? "" : " · fuera de la grilla urbana"}</div>
    <div class="aqi" style="--c:${ESCALA.find((e) => e[2] === cat[2])[1]}">
      <div class="num">${fmt(pm)}<small>µg/m³ PM2,5</small></div>
      <div><b>${cat[2]}</b><span>Partículas finas que entran a los pulmones</span></div>
    </div>
    <div class="barra"><i style="left:${pos}%"></i></div>
    <div class="datos">
      <div><small>Lluvia</small><b>${fmt(mm)}</b> <small>mm/h</small></div>
      <div><small>Viento</small><b>${fmt(v, 0)}</b> <small>km/h ${rumbo(dir)}</small></div>
      <div><small>Temp.</small><b>${fmt(temp, 0)}°</b> <small>C</small></div>
    </div>
    <div class="sub">Micros a menos de 400 m · ${cerca.length}</div>
    <div class="chips">${cerca.slice(0, 18).map(({ r, d }) =>
      `<span class="chip ${S.lineaSel === r.idx ? "on" : ""}" data-i="${r.idx}" style="--c:${r.color}" title="${r.nombre}: ${r.desde} → ${r.hasta} (${Math.round(d)} m)">${r.ref}</span>`).join("") || "<small>Ninguna</small>"}</div>
    ${foco ? `<div class="sub">Foco de calor más cercano</div>
    <div class="foco"><span class="dist">${fmt(foco.d / 1000, foco.d < 10000 ? 1 : 0)} km</span><small>${foco.fecha} · ${foco.frp} MW · VIIRS</small></div>` : ""}
    ${tr ? `<div class="sub">Tráfico en la avenida más cercana</div>
    <div class="trcerca" style="--c:${tr.v.nivel[2]}"><b>${tr.v.nivel[1]}</b><span>${corto(tr.v.n)} · ~${Math.round(tr.v.v)} km/h (libre ${VLIBRE[tr.v.c]})</span></div>` : ""}
    <div class="consejo">${consejos.join("<br>")}</div>`;
  $("#puntoInfo").hidden = false; $("#puntoVacio").hidden = true;
}

function pestana(k) {
  S.tab = k;
  if ($("#punto").dataset.hoja === "min" && matchMedia("(max-width: 900px)").matches) hoja("mid");
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === k));
  for (const t of ["trafico", "ruta", "lineas", "sim", "punto", "alertas"]) $("#sec" + t[0].toUpperCase() + t.slice(1)).hidden = k !== t;
  if (k !== "ruta" && R_.elegir) { R_.elegir = null; marcarElegir(); }
  if (k !== "sim" && SIM.modo) { SIM.modo = false; marcarSim(); marcarElegir(); }
  if (k === "sim" && !SIM.base && T.listo) aplicarSim();
  $("#punto").dataset.tab = k;
  if (k === "trafico") pintarTrafico();
  if (k === "alertas") pintarAlertas();
  if (k === "lineas") pintarLineas();
}

function irACritico(i) {
  const c = T.criticos[i]; if (!c) return;
  S.punto = c.p; analizarPunto(); pestana("punto");
  mapa.flyTo({ center: c.p, zoom: 16.2, pitch: 64, bearing: mapa.getBearing() + 30, duration: 2200, essential: true });
}

/* ---------- Bucle ---------- */
let ultimo = performance.now(), ultimoPanel = 0;
function cuadro(t) {
  const dt = (t - ultimo) / 1000; ultimo = t;
  if (S.vivo) S.hora = horaLocal();
  else if (S.play) { S.hora = (S.hora + dt * 1.2) % 24; $("#tiempo").value = S.hora; }
  if (S.giro) mapa.setBearing(mapa.getBearing() + dt * 4);
  tickAmbiente(t);
  if (S.capas.viento) moverViento();
  overlay.setProps({ layers: capas((t - S.t0) / 1000) });
  if (t - ultimoPanel > 400) { estadisticas(); if (S.tab === "trafico") pintarTrafico(); else if (S.play || S.vivo) analizarPunto(); ultimoPanel = t; }
  requestAnimationFrame(cuadro);
}

function modo(vivo) {
  S.vivo = vivo; if (vivo) S.play = false;
  $("#estado").textContent = vivo ? "EN VIVO" : S.play ? "SIMULANDO" : "OTRA HORA";
  $("#estado").classList.toggle("repe", !vivo);
  $("#play").textContent = S.play ? "❚❚" : "▶";
  $("#ahora").classList.toggle("on", vivo);
}

function eventos() {
  $("#listaCapas").addEventListener("click", (e) => {
    const b = e.target.closest(".capa"); if (!b) return;
    const k = b.dataset.k; S.capas[k] = !S.capas[k]; b.classList.toggle("on", S.capas[k]);
    if (k === "edificios") for (const id of ["edificios-3d", "edificios-altos", "edificios-borde", "iconos-3d", "iconos-templo", "iconos-base", "techos"]) if (mapa.getLayer(id)) mapa.setLayoutProperty(id, "visibility", S.capas[k] ? "visible" : "none");
  });
  const plegar = (si) => { $("#capas").classList.toggle("plegado", si); $("#plegar").textContent = si ? "+" : "–"; };
  $("#plegar").onclick = () => plegar(!$("#capas").classList.contains("plegado"));
  if (matchMedia("(max-width: 900px)").matches) plegar(true); // en celular el mapa primero
  document.querySelectorAll("[data-vista]").forEach((b) => b.onclick = () => {
    document.querySelectorAll("[data-vista]").forEach((x) => x.classList.toggle("on", x === b));
    mapa.flyTo({ ...(b.dataset.vista === "ciudad" ? CIUDAD : DEPTO), duration: 2600, essential: true });
  });
  $("#giro").onclick = () => { S.giro = !S.giro; $("#giro").classList.toggle("on", S.giro); };
  mapa.on("dragstart", () => { S.giro = false; $("#giro").classList.remove("on"); });
  $("#play").onclick = () => { S.play = !S.play; if (S.play) S.vivo = false; modo(false); };
  $("#ahora").onclick = () => { S.play = false; modo(true); $("#tiempo").value = S.hora = horaLocal(); };
  $("#tiempo").addEventListener("input", (e) => { S.play = false; modo(false); S.hora = +e.target.value; analizarPunto(); });
  mapa.on("click", (e) => {
    const f = overlay.pickObject?.({ x: e.point.x, y: e.point.y, radius: 4 });
    if (clicFunciones(e, f)) return;
    if (f?.layer?.id === "micros") { S.lineaSel = S.lineaSel === f.object.ruta.idx ? null : f.object.ruta.idx; }
    if (f?.layer?.id === "criticos") { irACritico(T.criticos.indexOf(f.object)); return; }
    S.punto = [e.lngLat.lng, e.lngLat.lat]; analizarPunto(); pestana("punto");
  });
  $("#puntoInfo").addEventListener("click", (e) => {
    const ch = e.target.closest(".chip"); if (!ch) return;
    const i = +ch.dataset.i; S.lineaSel = S.lineaSel === i ? null : i; analizarPunto();
  });
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => pestana(b.dataset.tab));
  eventosFunciones();
  $("#secTrafico").addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) irACritico(+li.dataset.i); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { S.lineaSel = null; S.punto = null; $("#puntoInfo").hidden = true; $("#puntoVacio").hidden = false; pestana("trafico"); }
    if (e.key === " " && e.target === document.body) { e.preventDefault(); $("#play").click(); }
  });
}

async function iniciar() {
  pintarCapas(); eventos();
  json("datos/depto.json").then(contornoDepto).catch((e) => console.warn("sin contorno", e));
  const [rutas, focos] = await Promise.all([json("datos/rutas.json"), json("datos/focos.json")]);
  prepararRutas(rutas); prepararMicro();
  try { S.clima = await climaEnVivo(); }
  catch (e) { console.warn("Open-Meteo sin respuesta, uso respaldo", e); S.clima = await json("datos/clima.json"); }
  const todos = focos.puntos.map(([lon, lat, fecha, hora, frp]) => ({ p: [lon, lat], fecha, hora: `${String(hora).slice(0, 2)}:${String(hora).slice(2)}`, frp }));
  const fechas = [...new Set(todos.map((f) => f.fecha))].sort(), nf = fechas.length;
  for (const f of todos) f.nuevo = nf > 1 ? fechas.indexOf(f.fecha) / (nf - 1) : 1;
  json("datos/calles.json").then((d) => { prepararTrafico(d); construirGrafo(); prepararAmbiente(); cargarReportes(); pintarTrafico(); S.enlace = leerEnlace(); })
    .catch((e) => { console.warn("sin calles", e); $("#secTrafico").innerHTML = '<p class="vacio">No se pudieron cargar las calles.</p>'; });
  S.focos = { todos, recientes: todos.filter((f) => f.fecha === fechas[nf - 1]), fuente: focos.fuente };
  S.hora = horaLocal(); $("#tiempo").value = S.hora;
  grafico(); modo(true);
  requestAnimationFrame(cuadro);
}

mapa.on("load", () => {
  try { edificios3D(); } catch (e) { console.warn(e); }
  iniciar().then(() => setTimeout(() => { $("#cargando").classList.add("fuera"); intro(); }, 300))
    .catch((e) => { console.error(e); $("#cargando p").textContent = "No se pudieron cargar los datos: " + e.message; });
});
