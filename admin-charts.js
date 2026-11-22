/* ============================================================
   Cagómetro · gráficas del panel de administración (SVG a mano, sin librerías).
   Se pintan en dos pasos: `chart(id, spec)` deja un hueco con su especificación y `hydrate(root)` dibuja cada hueco al ancho real
   de su caja (así el texto no se deforma) y vuelve a dibujar si cambia de tamaño. Pasar el dedo o el ratón enseña los valores.
   Reglas (guía de visualización): una sola escala por gráfica; marcas finas (líneas de 2 px, barras con extremo redondeado de
   4 px); rejilla tenue; leyenda si hay 2 o más series; colores categóricos en orden fijo (paleta validada para daltonismo).
   ============================================================ */

/** Paleta categórica validada (orden fijo, nunca rotar) y color de una sola serie. */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const SINGLE = "#6E3F1C";          // marrón de la marca: una sola serie
const SEQ = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];

const specs = new Map();
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, unit = "") => v == null || Number.isNaN(v) ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("es-ES")}${unit}`;

/** Un hueco para una gráfica. spec: { type: "line"|"bars"|"stack"|"heat", ... } (ver draw*). */
export function chart(id, spec, h = 180) {
  specs.set(id, spec);
  const legend = (spec.series || []).length >= 2
    ? `<div class="adc-legend">${spec.series.map((s, i) => `<span><i style="background:${s.color || SERIES[i]}${s.dash ? ";opacity:.6" : ""}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
  return `${legend}<div class="adc" data-chart="${esc(id)}" style="height:${h}px" role="img" aria-label="${esc(spec.label || "")}"></div>`;
}

/** Escala «bonita» para el eje Y: máximo redondeado y 3–4 marcas. */
function niceMax(max) {
  if (max <= 0) return { top: 1, step: 1 };
  const exp = Math.pow(10, Math.floor(Math.log10(max))), f = max / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const top = nice * exp, step = top / (nice === 2.5 ? 5 : nice === 1 || nice === 2 ? 4 : 5);
  return { top: Math.max(top, step), step };
}

const PAD = { l: 38, r: 10, t: 8, b: 22 };

function frame(w, h, spec, top, step) {
  if (!spec.decimal && spec.unit !== "%" && step < 1) { step = 1; top = Math.max(1, Math.ceil(top)); }   // recuentos: de 1 en 1, nunca «0,3 mensajes»
  const ih = h - PAD.t - PAD.b, iw = w - PAD.l - PAD.r;
  let g = "";
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = PAD.t + ih - (v / top) * ih;
    g += `<line class="adc-grid" x1="${PAD.l}" x2="${w - PAD.r}" y1="${y}" y2="${y}"/><text class="adc-yt" x="${PAD.l - 6}" y="${y + 3.5}">${fmt(v, spec.unit === "%" ? "%" : "")}</text>`;
  }
  const n = spec.x.length, every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 58))));
  for (let i = 0; i < n; i += every) {
    const x = PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    g += `<text class="adc-xt" x="${x}" y="${h - 6}">${esc(spec.x[i])}</text>`;
  }
  return { g, ih, iw };
}

function drawLine(el, spec, w, h) {
  const all = spec.series.flatMap(s => s.values).filter(v => v != null);
  const { top, step } = niceMax(Math.max(0, ...all));
  const { g, ih, iw } = frame(w, h, spec, top, step);
  const n = spec.x.length, X = i => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw), Y = v => PAD.t + ih - (v / top) * ih;
  let paths = "";
  spec.series.forEach((s, si) => {
    const col = s.color || SERIES[si];
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    if (spec.area && spec.series.length === 1 && d) {
      const first = s.values.findIndex(v => v != null), last = s.values.length - 1 - [...s.values].reverse().findIndex(v => v != null);
      paths += `<path d="${d}L${X(last)},${PAD.t + ih}L${X(first)},${PAD.t + ih}Z" fill="${col}" opacity=".10"/>`;
    }
    paths += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="4 4" opacity=".7"' : ""}/>`;
    const li = s.values.length - 1 - [...s.values].reverse().findIndex(v => v != null);      // último punto: marcador
    if (li >= 0 && li < s.values.length && s.values[li] != null) paths += `<circle cx="${X(li)}" cy="${Y(s.values[li])}" r="4" fill="${col}" stroke="var(--card)" stroke-width="2"/>`;
  });
  el.innerHTML = `<svg width="${w}" height="${h}">${g}${paths}<line class="adc-cross" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" style="display:none"/></svg>`;
  el._geo = { n, X, kind: "x" };
}

function drawBars(el, spec, w, h, stacked) {
  const series = stacked ? spec.series : [{ name: spec.name || "", values: spec.values, color: spec.color || SINGLE }];
  const n = spec.x.length, totals = spec.x.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const maxV = Math.max(0, ...(stacked ? totals : series[0].values.map(v => v || 0)), ...(spec.line ? spec.line.values.filter(v => v != null) : []));
  const { top, step } = niceMax(maxV);
  const { g, ih, iw } = frame(w, h, spec, top, step);
  const slot = iw / n, bw = Math.max(1, Math.min(28, slot - (slot > 6 ? 2 : 0.5)));
  const X = i => PAD.l + slot * i + slot / 2, Y = v => PAD.t + ih - (v / top) * ih;
  let marks = "";
  for (let i = 0; i < n; i++) {
    let base = 0;
    series.forEach((s, si) => {
      const v = s.values[i] || 0; if (!v) return;
      const y0 = Y(base), y1 = Y(base + v), hh = Math.max(1, y0 - y1);
      const isTop = !stacked || series.slice(si + 1).every(t => !(t.values[i] > 0));
      const r = isTop ? Math.min(4, bw / 2, hh) : 0;
      // extremo de datos redondeado (4 px), base recta; 2 px de hueco entre segmentos apilados
      const gap = stacked && base > 0 ? 1 : 0;
      marks += r ? `<path d="M${X(i) - bw / 2},${y0 - gap}V${y1 + r}Q${X(i) - bw / 2},${y1} ${X(i) - bw / 2 + r},${y1}H${X(i) + bw / 2 - r}Q${X(i) + bw / 2},${y1} ${X(i) + bw / 2},${y1 + r}V${y0 - gap}Z" fill="${s.color || SERIES[si]}"/>`
        : `<rect x="${X(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0.5, hh - gap)}" fill="${s.color || SERIES[si]}"/>`;
      base += v;
    });
  }
  if (spec.line) {
    let d = "", pen = false;
    spec.line.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    marks += `<path d="${d}" fill="none" stroke="${spec.line.color || SERIES[1]}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  el.innerHTML = `<svg width="${w}" height="${h}">${g}${marks}<line class="adc-cross" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" style="display:none"/></svg>`;
  el._geo = { n, X, kind: "x" };
}

function drawHeat(el, spec, w, h) {
  // spec.rows (etiquetas), spec.cols (etiquetas), spec.values[r][c]
  const R = spec.rows.length, Cn = spec.cols.length, lw = 22, th = 16;
  const cw = (w - lw) / Cn, ch = (h - th) / R;
  const max = Math.max(1, ...spec.values.flat());
  let g = "";
  spec.values.forEach((row, r) => row.forEach((v, c) => {
    const col = v ? SEQ[Math.min(SEQ.length - 1, Math.floor((v / max) * (SEQ.length - 1)))] : "var(--paper-2)";
    g += `<rect x="${lw + c * cw + 1}" y="${r * ch + 1}" width="${Math.max(1, cw - 2)}" height="${Math.max(1, ch - 2)}" rx="3" fill="${col}"/>`;
  }));
  spec.rows.forEach((l, r) => { g += `<text class="adc-yt" x="${lw - 5}" y="${r * ch + ch / 2 + 4}">${esc(l)}</text>`; });
  spec.cols.forEach((l, c) => { if (c % 3 === 0) g += `<text class="adc-xt" x="${lw + c * cw + cw / 2}" y="${h - 3}">${esc(l)}</text>`; });
  el.innerHTML = `<svg width="${w}" height="${h}">${g}<rect class="adc-cell" x="0" y="0" width="0" height="0" style="display:none"/></svg>`;
  el._geo = { kind: "cell", lw, cw, ch, R, Cn };
}

function draw(el) {
  const spec = specs.get(el.dataset.chart); if (!spec) return;
  const w = Math.max(120, Math.floor(el.clientWidth)), h = Math.floor(el.clientHeight);
  if (el._w === w && el._spec === spec) return;
  el._w = w; el._spec = spec;
  if (!spec.x?.length && spec.type !== "heat") { el.innerHTML = '<p class="adc-empty">Aún no hay datos</p>'; return; }
  if (spec.type === "line") drawLine(el, spec, w, h);
  else if (spec.type === "bars") drawBars(el, spec, w, h, false);
  else if (spec.type === "stack") drawBars(el, spec, w, h, true);
  else if (spec.type === "heat") drawHeat(el, spec, w, h);
}

let ro = null;
/** Dibuja todos los huecos de `root` al ancho real y los redibuja si cambia el tamaño. */
export function hydrate(root) {
  ro?.disconnect();
  ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(es => es.forEach(e => { e.target._w = 0; draw(e.target); })) : null;
  root.querySelectorAll(".adc").forEach(el => { draw(el); ro?.observe(el); });
}

/** Tooltip al pasar el dedo o el ratón (delegado: un solo escuchador para todo el panel). */
export function bindTooltips(root) {
  // el panel se repinta entero (innerHTML): el cuadro se busca o se crea en cada movimiento
  const getTip = () => root.querySelector(".adc-tip") || root.appendChild(Object.assign(document.createElement("div"), { className: "adc-tip", hidden: true }));
  const hide = () => { const t = root.querySelector(".adc-tip"); if (t) t.hidden = true; root.querySelectorAll(".adc-cross,.adc-cell").forEach(l => { l.style.display = "none"; }); };
  const move = ev => {
    const tip = getTip();
    const el = ev.target.closest?.(".adc"); if (!el || !el._geo) { hide(); return; }
    const spec = specs.get(el.dataset.chart), geo = el._geo, box = el.getBoundingClientRect();
    const px = (ev.touches?.[0]?.clientX ?? ev.clientX) - box.left, py = (ev.touches?.[0]?.clientY ?? ev.clientY) - box.top;
    let html = "";
    if (geo.kind === "x") {
      let best = 0, bd = Infinity;
      for (let i = 0; i < geo.n; i++) { const d = Math.abs(geo.X(i) - px); if (d < bd) { bd = d; best = i; } }
      const line = el.querySelector(".adc-cross"); line.setAttribute("x1", geo.X(best)); line.setAttribute("x2", geo.X(best)); line.style.display = "";
      const rows = spec.type === "bars" ? [{ name: spec.name || "Valor", v: spec.values[best], color: spec.color || SINGLE }, ...(spec.line ? [{ name: spec.line.name, v: spec.line.values[best], color: spec.line.color || SERIES[1] }] : [])]
        : spec.series.map((s, i) => ({ name: s.name, v: s.values[best], color: s.color || SERIES[i] }));
      html = `<b>${esc(spec.xFull?.[best] ?? spec.x[best])}</b>${rows.map(r => `<span><i style="background:${r.color}"></i>${esc(r.name)}<em>${fmt(r.v, spec.unit)}</em></span>`).join("")}`;
    } else {
      const c = Math.floor((px - geo.lw) / geo.cw), r = Math.floor(py / geo.ch);
      if (c < 0 || r < 0 || c >= geo.Cn || r >= geo.R) { hide(); return; }
      const cell = el.querySelector(".adc-cell");
      Object.entries({ x: geo.lw + c * geo.cw, y: r * geo.ch, width: geo.cw, height: geo.ch }).forEach(([k, v]) => cell.setAttribute(k, v)); cell.style.display = "";
      html = `<b>${esc(spec.rowsFull?.[r] ?? spec.rows[r])} · ${esc(spec.cols[c])}:00</b><span>${esc(spec.name || "Valor")}<em>${fmt(spec.values[r][c], spec.unit)}</em></span>`;
    }
    tip.innerHTML = html; tip.hidden = false;
    const rb = root.getBoundingClientRect(), tw = tip.offsetWidth;
    const x = Math.min(rb.width - tw - 8, Math.max(8, box.left - rb.left + px + 14)), y = box.top - rb.top + Math.max(0, py - 40);
    tip.style.transform = `translate(${x}px,${y}px)`;
  };
  root.addEventListener("pointermove", move);
  root.addEventListener("touchmove", move, { passive: true });
  root.addEventListener("pointerleave", hide);
  root.addEventListener("scroll", hide, true);
}
