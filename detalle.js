/* Ciudad Viva SCZ — detalle 3D: hitos con nombre (haz de luz + etiqueta) y árboles en parques y calles. */
const { ColumnLayer, LineLayer } = deck;

const CAT = {
  salud: ["#ff4d6d", "Salud"], estudio: ["#8fa2ff", "Estudio"], mercado: ["#ffd23f", "Mercado"],
  deporte: ["#2bd9a0", "Deporte"], transporte: ["#40e0ff", "Transporte"], cultura: ["#ff7ac6", "Cultura"],
};
const D = { hitos: [], arboles: [], grandes: [], chicos: [], listo: false };

function dentroPoligono(p, poli) {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [xi, yi] = poli[i], [xj, yj] = poli[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// Los datos salen de los mosaicos vectoriales que el mapa ya bajó (OpenMapTiles): sin servidor extra.
function categoriaPOI(pr) {
  const c = pr.class, s = pr.subclass;
  if (c === "hospital" && s === "hospital") return "salud";
  if (c === "college" || s === "university" || (c === "school" && /universi/i.test(pr.name || ""))) return "estudio";
  if ((s === "mall" || s === "marketplace" || c === "marketplace") && /mercado|mall|shopping|comercial|feria|plaza|center|centro/i.test(pr.name || "")) return "mercado";
  if (c === "stadium" || s === "stadium") return "deporte";
  if ((s === "bus_station" || c === "aerodrome" || s === "station") && /terminal|bimodal|aeropuerto|estaci[oó]n|brt/i.test(pr.name || "")) return "transporte";
  if (c === "museum" || s === "townhall" || s === "cathedral") return "cultura";
  return null;
}

let s0 = 12345;
const rnd = () => ((s0 = (s0 * 16807) % 2147483647) / 2147483647);
const vistosHitos = new Map(), vistosParques = new Set();

function arbolesEn(anillo, tipo) {
  const paso = 0.00016, out = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of anillo) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if ((x1 - x0) * (y1 - y0) > 4e-4) return out; // áreas enormes (zonas rurales): no
  const dens = tipo === "wood" ? 0.85 : 0.5;
  for (let x = x0; x <= x1; x += paso) for (let y = y0; y <= y1; y += paso) {
    if (rnd() > dens) continue;
    const p = [x + (rnd() - 0.5) * paso, y + (rnd() - 0.5) * paso];
    if (dentroPoligono(p, anillo)) out.push({ p, h: 5 + rnd() * 7, t: rnd() });
  }
  return out;
}

function refrescarDetalle() {
  if (mapa.getZoom() < 12) return;
  let nuevos = false;
  for (const f of mapa.querySourceFeatures("openmaptiles", { sourceLayer: "poi" })) {
    const pr = f.properties, c = pr.name && categoriaPOI(pr);
    if (!c || f.geometry.type !== "Point") continue;
    const p = f.geometry.coordinates, k = pr.name.toLowerCase();
    const prev = vistosHitos.get(k);
    if (prev && distM(prev.p, p) < 600) continue;
    vistosHitos.set(prev ? k + "#" + p[0].toFixed(3) : k, { n: pr.name, c, p, col: CAT[c][0], alto: c === "salud" || c === "transporte" ? 150 : 110 });
    nuevos = true;
  }
  for (const f of mapa.querySourceFeatures("openmaptiles", { sourceLayer: "landcover" })) {
    const cl = f.properties.class; if (cl !== "grass" && cl !== "wood") continue;
    if (cl === "grass" && !["park", "garden", "recreation_ground"].includes(f.properties.subclass)) continue;
    const g = f.geometry, polis = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poli of polis) {
      const r = poli[0]; if (!r || r.length < 4) continue;
      const k = cl + r[0][0].toFixed(5) + r[0][1].toFixed(5) + r.length;
      if (vistosParques.has(k)) continue;
      vistosParques.add(k);
      if (D.arboles.length < 30000) { D.arboles = D.arboles.concat(arbolesEn(r, cl)); nuevos = true; }
    }
  }
  if (nuevos) { D.hitos = [...vistosHitos.values()]; D.grandes = D.arboles.filter((t) => t.t >= 0.4); D.chicos = D.arboles.filter((t) => t.t < 0.4); D.listo = true; }
}
let esperaDetalle = 0;
const programarDetalle = () => { clearTimeout(esperaDetalle); esperaDetalle = setTimeout(refrescarDetalle, 400); };
mapa.on("moveend", programarDetalle);
mapa.on("sourcedata", (e) => { if (e.sourceId === "openmaptiles" && e.tile) programarDetalle(); });

// Etiquetas: las más cercanas al centro, sin encimarse en pantalla; se recalculan solo si la cámara se movió.
let memoEtiq = { k: "", lista: [] };
function etiquetasVisibles(z) {
  if (z < 14) return [];
  const c = mapa.getCenter(), k = [c.lng.toFixed(4), c.lat.toFixed(4), z.toFixed(1), mapa.getBearing().toFixed(0), mapa.getPitch().toFixed(0), D.hitos.length].join();
  if (k === memoEtiq.k) return memoEtiq.lista;
  const ctr = c.toArray(), ocupadas = [], lista = [];
  const orden = D.hitos.map((d) => ({ d, k: distM(d.p, ctr) })).filter((o) => o.k < 1800).sort((a, b) => a.k - b.k);
  for (const { d } of orden) {
    const xy = mapa.project(d.p), w = Math.min(34, d.n.length) * 7 + 16;
    const caja = [xy.x - w / 2, xy.y - 70, xy.x + w / 2, xy.y - 40];
    if (ocupadas.some((o) => caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) continue;
    ocupadas.push(caja); lista.push(d); if (lista.length >= 9) break;
  }
  memoEtiq = { k, lista };
  return lista;
}

function capasDetalle(L, seg) {
  if (!D.listo) return;
  const z = mapa.getZoom();
  if (S.capas.edificios && z >= 14.2 && D.arboles.length && q().arboles > 0) {
    const a = clamp((z - 14.2) / 0.8, 0, 1);
    L.push(new ColumnLayer({
      id: "troncos", data: D.arboles, getPosition: (d) => d.p, diskResolution: 6, radius: 0.45, extruded: true,
      getElevation: (d) => d.h * 0.42, getFillColor: [92, 66, 48], opacity: a,
    }));
    // copa en tres capas apiladas (ancha abajo, angosta arriba): se lee como un árbol redondeado
    const tonos = (d, k) => [18 + d.t * 26 + k * 14, 112 + d.t * 64 + k * 22, 70 + d.t * 46 + k * 10]; // la aparición va por opacidad: no se recalcula por cuadro
    [[0, 0.38, 0.28, 1], [1, 0.62, 0.26, 0.82], [2, 0.84, 0.16, 0.5]].forEach(([k, base, alto, ancho]) => {
      for (const [grupo, rad] of [[0, 3.6], [1, 2.6]]) L.push(new ColumnLayer({
        id: `copa-${k}-${grupo}`, data: grupo ? (q().arboles < 1 ? [] : D.chicos) : D.grandes, diskResolution: 10, radius: rad * ancho, extruded: true,
        getPosition: (d) => [d.p[0], d.p[1], d.h * base], getElevation: (d) => d.h * alto,
        getFillColor: (d) => tonos(d, k), opacity: a, material: { ambient: 0.5, diffuse: 0.7, shininess: 12, specularColor: [60, 90, 70] },
      }));
    });
  }
  if (S.capas.lugares && D.hitos.length) {
    const brillo = 0.75 + 0.25 * Math.sin(seg * 2.2), vis = clamp((z - 12.2) / 0.8, 0, 1);
    if (vis <= 0) return;
    const c0 = mapa.getCenter().toArray(), radio = z >= 15 ? 2200 : 9000;
    const hitos = D.hitos.filter((d) => distM(d.p, c0) < radio);
    L.push(new LineLayer({
      id: "haces-halo", data: hitos, getSourcePosition: (d) => [...d.p, 0], getTargetPosition: (d) => [...d.p, d.alto],
      getColor: (d) => hex(d.col, 60 * brillo * vis), getWidth: 12, widthUnits: "pixels", updateTriggers: { getColor: [brillo, vis] },
    }));
    L.push(new LineLayer({
      id: "haces", data: hitos, getSourcePosition: (d) => [...d.p, 0], getTargetPosition: (d) => [...d.p, d.alto],
      getColor: (d) => hex(d.col, 230 * vis), getWidth: 2.5, widthUnits: "pixels", updateTriggers: { getColor: vis },
    }));
    L.push(new ScatterplotLayer({
      id: "hitos", data: hitos, getPosition: (d) => [...d.p, d.alto], getRadius: 14, radiusMinPixels: 4, radiusMaxPixels: 8,
      getFillColor: (d) => hex(d.col, 255 * vis), stroked: true, getLineColor: [255, 255, 255, 220 * vis], lineWidthMinPixels: 1.5,
      billboard: true, pickable: true, updateTriggers: { getFillColor: vis, getLineColor: vis },
    }));
    const cerca = etiquetasVisibles(z);
    if (cerca.length && q().etiquetas) L.push(new TextLayer({
      id: "hitos-nombre", data: cerca, sizeUnits: "pixels", sizeMinPixels: 10, sizeMaxPixels: 13, getPosition: (d) => [...d.p, d.alto], getText: (d) => d.n.length > 34 ? d.n.slice(0, 33) + "…" : d.n,
      characterSet: "auto", fontFamily: "Space Grotesk, system-ui, sans-serif", fontWeight: 600, getSize: 12,
      getColor: [236, 240, 255, 255 * vis], getPixelOffset: [0, -16], getTextAnchor: "middle", getAlignmentBaseline: "bottom",
      background: true, getBackgroundColor: (d) => [...hex(d.col).slice(0, 3).map((c) => c * 0.22 + 8), 215 * vis],
      backgroundPadding: [7, 4], getBorderColor: (d) => hex(d.col, 160 * vis), getBorderWidth: 1,
      billboard: true, updateTriggers: { getColor: vis, getBackgroundColor: vis, getBorderColor: vis },
      collisionEnabled: false,
    }));
  }
}
