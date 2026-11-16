/* Ciudad Viva SCZ — ambiente: día y noche, faroles, lluvia y humo 3D, pantalla de entrada y calidad automática. */

/* ===================== Calidad automática ===================== */
const NIVELES_Q = {
  alta: { arboles: 1, particulas: 1, etiquetas: true, faroles: true, gotas: 2200, humo: 6 },
  media: { arboles: 0.5, particulas: 0.5, etiquetas: true, faroles: true, gotas: 1200, humo: 4 },
  baja: { arboles: 0, particulas: 0, etiquetas: false, faroles: false, gotas: 500, humo: 2 },
};
const Q = { modo: "auto", nivel: matchMedia("(pointer: coarse)").matches ? "media" : "alta", fps: 60, cuadros: 0, t0: 0, malos: 0 };
const q = () => NIVELES_Q[Q.nivel];

function medirFPS(t) {
  if (!Q.inicio) Q.inicio = t;
  if (t - Q.inicio < 6000) return; // calentamiento: la carga inicial no cuenta
  if (!Q.t0) Q.t0 = t;
  Q.cuadros++;
  if (t - Q.t0 < 3000) return;
  Q.fps = Q.cuadros * 1000 / (t - Q.t0); Q.cuadros = 0; Q.t0 = t;
  if (Q.modo !== "auto" || document.hidden) return;
  Q.malos = Q.fps < 26 ? Q.malos + 1 : 0;
  if (Q.malos >= 2 && Q.nivel !== "baja") { Q.nivel = Q.nivel === "alta" ? "media" : "baja"; Q.malos = 0; aviso(`Bajé la calidad a <b>${Q.nivel}</b> para que vaya fluido (${Math.round(Q.fps)} cuadros/s).`); }
  pintarCalidad();
}
function pintarCalidad() { const b = $("#calidad"); if (b) b.textContent = `◐ Calidad: ${Q.modo === "auto" ? "auto · " : ""}${Q.nivel}`; }
function cambiarCalidad() {
  const orden = ["auto", "alta", "media", "baja"], i = orden.indexOf(Q.modo === "auto" ? "auto" : Q.nivel), sig = orden[(i + 1) % 4];
  if (sig === "auto") { Q.modo = "auto"; } else { Q.modo = "fija"; Q.nivel = sig; }
  pintarCalidad();
}

/* ===================== Día y noche ===================== */
const AMB = { clave: "", dia: 0, faroles: [], gotas: [], dPatron: null };
const mezcla = (a, b, f) => "#" + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - f) + parseInt(b.slice(1 + i, 3 + i), 16) * f).toString(16).padStart(2, "0")).join("");
// Santa Cruz en noviembre: sale el sol ~5:40 y se pone ~18:40
function sol(h) { const e = Math.sin(Math.PI * (h - 5.67) / 13); return { e, dia: clamp((e + 0.08) / 0.3, 0, 1), ocaso: clamp(1 - Math.abs(e) / 0.18, 0, 1) }; }

function actualizarCielo(h) {
  const s = sol(h), k = `${s.dia.toFixed(2)}|${s.ocaso.toFixed(2)}|${Math.round(h * 4)}`; if (k === AMB.clave) return; AMB.clave = k; AMB.dia = s.dia;
  const horizonte = mezcla(mezcla("#3a2672", "#8fc0ec", s.dia), "#ff9a5c", s.ocaso * 0.8);
  try {
    mapa.setSky({ "sky-color": mezcla("#070b1f", "#2d64b3", s.dia), "horizon-color": horizonte, "fog-color": mezcla("#0a0f22", "#2a3d66", s.dia),
      "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.82, "atmosphere-blend": 0.9 });
    const az = 90 + (h - 12.15) * 15; // el sol va de este (90°) a oeste (270°)
    mapa.setLight({ anchor: "map", color: mezcla(mezcla("#9fb0ff", "#fff1d6", s.dia), "#ffb27a", s.ocaso * 0.6), intensity: 0.28 + 0.3 * s.dia,
      position: [1.5, ((az % 360) + 360) % 360, 90 - Math.max(0, s.e) * 65] });
    const pinta = (id, p, v) => { if (mapa.getLayer(id)) mapa.setPaintProperty(id, p, v); };
    pinta("background", "background-color", mezcla("#080c1d", "#141d38", s.dia));
    pinta("landuse_residential", "fill-color", mezcla("#0f1430", "#1a2448", s.dia));
    pinta("water", "fill-color", mezcla("#0b2342", "#134a7c", s.dia));
    pinta("edificios-3d", "fill-extrusion-color", ["interpolate", ["linear"], ALTURA, 0, mezcla("#151b36", "#28345f", s.dia), 4, mezcla("#1c2449", "#34437a", s.dia), 8.9, mezcla("#2a3470", "#4a5ca3", s.dia)]);
    const patron = s.dia > 0.5 ? "dia" : "noche";
    if (patron !== AMB.dPatron && mapa.getLayer("edificios-altos")) {
      AMB.dPatron = patron;
      pinta("edificios-altos", "fill-extrusion-pattern", patron === "dia" ? ["case", [">", ALTURA, 40], "vidrio-frio", "vidrio"] : ["case", [">", ALTURA, 40], "ventanas-frio", "ventanas"]);
    }
  } catch (e) { console.warn("cielo", e); }
}

function prepararAmbiente() {
  if (!mapa.hasImage("vidrio")) {
    mapa.addImage("vidrio", texturaVentanas("#2c3a68", ["#5d7fbf", "#7a9ad6", "#4a68a6"], 31), { pixelRatio: 2 });
    mapa.addImage("vidrio-frio", texturaVentanas("#26406e", ["#79b8e8", "#9fd0f2", "#5a8fc4"], 37), { pixelRatio: 2 });
  }
  // faroles cada ~90 m en troncales y primarias
  for (const v of T.vias) {
    if (v.c < 2) continue;
    for (let s = 45; s < v.L; s += 90) AMB.faroles.push(enDistancia(v, s).p);
  }
}

/* ===================== Lluvia y humo ===================== */
function lluviaEn(p, h) { return T.sim?.lluvia ? 12 : S.clima ? campo("lluvia", h, ...p) : 0; }

function capasAmbiente(L, seg) {
  const z = mapa.getZoom(), prof = { depthCompare: "always", depthWriteEnabled: false };
  // faroles: de noche, de cerca
  if (q().faroles && AMB.dia < 0.5 && z >= 13 && AMB.faroles.length && S.capas.edificios) {
    const a = (1 - AMB.dia * 2) * clamp((z - 13) / 0.7, 0, 1);
    L.push(new ScatterplotLayer({ id: "faroles-halo", data: AMB.faroles, getPosition: (d) => d, getRadius: 22, radiusMinPixels: 2, radiusMaxPixels: 14,
      getFillColor: [255, 196, 110, 38 * a], updateTriggers: { getFillColor: a } }));
    L.push(new ScatterplotLayer({ id: "faroles", data: AMB.faroles, getPosition: (d) => d, getRadius: 4, radiusMinPixels: 0.8, radiusMaxPixels: 3.5,
      getFillColor: [255, 226, 160, 230 * a], updateTriggers: { getFillColor: a } }));
  }
  // lluvia: gotas que caen solo donde llueve según Open-Meteo (o en el aguacero simulado)
  if (S.capas.lluvia && S.clima && z >= 10.5) {
    const c = mapa.getCenter().toArray(), radio = clamp(2600 * 2 ** (13.5 - z), 600, 30000);
    const mmC = Math.max(lluviaEn(c, S.hora), 0);
    if (mmC > 0.15 || T.sim?.lluvia) {
      const n = Math.round(q().gotas * clamp(mmC / 4, 0.25, 1)), alto = radio * 0.18, gotas = [];
      for (let i = 0; i < n; i++) {
        const fx = ((i * 0.618034) % 1) * 2 - 1, fy = ((i * 0.754877) % 1) * 2 - 1;
        const p = [c[0] + fx * radio / (R * RAD * Math.cos(c[1] * RAD)), c[1] + fy * radio / (R * RAD)];
        const zz = alto * (1 - ((seg * 0.9 + (i * 0.381966) % 1) % 1));
        gotas.push([[p[0], p[1], zz], [p[0] + 0.00002, p[1], zz + alto * 0.06]]);
      }
      L.push(new LineLayer({ id: "lluvia3d", data: gotas, getSourcePosition: (d) => d[0], getTargetPosition: (d) => d[1],
        getColor: [150, 200, 255, 150], getWidth: 1.3, widthUnits: "pixels", parameters: prof }));
    }
  }
  // humo: columnas sobre los focos recientes, empujadas por el viento real
  if (S.capas.focos && S.focos && z < 12.5) {
    const dir = campo("dir", S.hora, -63.17, -17.79), vel = campo("viento", S.hora, -63.17, -17.79);
    const hacia = (dir + 180) * RAD, dx = Math.sin(hacia), dy = Math.cos(hacia), lejos = 2500 + vel * 600;
    const focos = S.focos.recientes.slice().sort((a, b) => b.frp - a.frp).slice(0, 350), puffs = [], n = q().humo;
    for (const f of focos) for (let k = 0; k < n; k++) {
      const edad = ((seg * 0.08 + k / n + (f.p[0] * 13.7) % 1) % 1), m = edad * lejos;
      puffs.push({ p: [f.p[0] + dx * m / (R * RAD * Math.cos(f.p[1] * RAD)), f.p[1] + dy * m / (R * RAD), 200 + edad * 2600], r: 900 + edad * 5200 + f.frp * 10, a: Math.sin(Math.PI * edad) });
    }
    L.push(new ScatterplotLayer({ id: "humo", data: puffs, getPosition: (d) => d.p, getRadius: (d) => d.r, radiusMinPixels: 1.5, billboard: true,
      getFillColor: (d) => [175, 150, 135, 95 * d.a], parameters: prof }));
  }
}

/* ===================== Pantalla de entrada ===================== */
function intro() {
  if (location.hash.length > 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const el = $("#intro"); el.hidden = false;
  mapa.jumpTo({ center: [-63.2, -17.86], zoom: 9.2, pitch: 10, bearing: -70 });
  const saltar = () => { mapa.stop(); mapa.jumpTo(CIUDAD); terminar(); };
  const terminar = () => { el.classList.add("sale"); setTimeout(() => (el.hidden = true), 700); removeEventListener("keydown", saltar); el.onclick = null; };
  el.onclick = saltar; addEventListener("keydown", saltar, { once: true });
  setTimeout(() => mapa.flyTo({ ...CIUDAD, duration: 5200, curve: 1.3, essential: true }), 600);
  setTimeout(terminar, 3600);
}

/* ===================== Bucle ===================== */
function tickAmbiente(t) {
  medirFPS(t);
  actualizarCielo(S.hora);
}
