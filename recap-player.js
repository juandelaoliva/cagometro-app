/* ============================================================
   Cagómetro · recap mensual — el REPRODUCTOR
   Pinta en formato historia lo que calcula recap.js. Es el prototipo de octubre
   pasado a la app tal cual: mismos planos, gestos y colores. Las clases llevan
   prefijo rc- porque la app ya usa .chip, .hero, .chart, .podium y .toast.
   ============================================================ */
import { t, getLang } from "./i18n.js";
import { UMBRAL } from "./recap.js";

const $ = id => document.getElementById(id);
const C = { paper:"#FBF6EC", ink:"#241B12", brand:"#6E3F1C", brand2:"#9A5A2A", gold:"#E59A2E", mint:"#2E9E68", rose:"#D8573F" };

/* ── utilidades ── */
const _loc = () => getLang() === "en" ? "en-GB" : "es-ES";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const num = n => Number(n).toLocaleString(_loc());
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const nombreMes = (y, m) => new Date(y, m, 1).toLocaleDateString(_loc(), { month: "long" });
const mesRel = (mes, k) => { const d = new Date(mes.y, mes.m + k, 1); return nombreMes(d.getFullYear(), d.getMonth()); };
const pl = (n, key) => t(`${key}.${n === 1 ? "one" : "many"}`, { n: num(n) });
const primero = s => esc(String(s).split(" ")[0]);
const delta = (n, prev) => n > 0 ? t("recap.vs", { d: `+${num(n)}`, prev }) : n < 0 ? t("recap.vs", { d: `−${num(-n)}`, prev }) : t("recap.vs.same", { prev });
const arquetipo = h =>
  h < 5  ? ["🦉", t("recap.arq.night")] :
  h < 10 ? ["🌅", t("recap.arq.early")] :
  h < 14 ? ["☕", t("recap.arq.morning")] :
  h < 17 ? ["🍽️", t("recap.arq.lunch")] :
  h < 21 ? ["🌇", t("recap.arq.evening")] : ["🌙", t("recap.arq.late")];

// zona horaria → país, en el idioma de la app. Si no está en la tabla, la ciudad.
const TZ_PAIS = {
  "Europe/Madrid":"ES","Africa/Ceuta":"ES","Atlantic/Canary":"ES","Europe/Lisbon":"PT","Atlantic/Madeira":"PT","Atlantic/Azores":"PT",
  "Europe/London":"GB","Europe/Dublin":"IE","Europe/Paris":"FR","Europe/Berlin":"DE","Europe/Rome":"IT","Europe/Amsterdam":"NL",
  "Europe/Brussels":"BE","Europe/Zurich":"CH","Europe/Vienna":"AT","Europe/Stockholm":"SE","Europe/Oslo":"NO","Europe/Copenhagen":"DK",
  "Europe/Helsinki":"FI","Europe/Warsaw":"PL","Europe/Prague":"CZ","Europe/Budapest":"HU","Europe/Athens":"GR","Europe/Istanbul":"TR",
  "Europe/Luxembourg":"LU","Europe/Andorra":"AD","Europe/Malta":"MT","Europe/Bucharest":"RO","Europe/Sofia":"BG","Europe/Zagreb":"HR",
  "Europe/Ljubljana":"SI","Europe/Belgrade":"RS","Europe/Kiev":"UA","Europe/Kyiv":"UA","Europe/Moscow":"RU","Africa/Casablanca":"MA",
  "Africa/Cairo":"EG","Asia/Tokyo":"JP","Asia/Seoul":"KR","Asia/Shanghai":"CN","Asia/Hong_Kong":"HK","Asia/Singapore":"SG",
  "Asia/Bangkok":"TH","Asia/Dubai":"AE","Asia/Kolkata":"IN","Asia/Jakarta":"ID","Asia/Manila":"PH","Asia/Ho_Chi_Minh":"VN",
  "Indian/Maldives":"MV","Australia/Sydney":"AU","Australia/Melbourne":"AU","Pacific/Auckland":"NZ",
  "America/New_York":"US","America/Chicago":"US","America/Denver":"US","America/Los_Angeles":"US","America/Toronto":"CA",
  "America/Mexico_City":"MX","America/Cancun":"MX","America/Guatemala":"GT","America/Bogota":"CO","America/Lima":"PE",
  "America/Santiago":"CL","America/Argentina/Buenos_Aires":"AR","America/Sao_Paulo":"BR","America/Caracas":"VE",
  "America/Havana":"CU","America/Santo_Domingo":"DO","America/Puerto_Rico":"PR","America/Panama":"PA","America/Costa_Rica":"CR",
  "America/Montevideo":"UY","America/La_Paz":"BO","America/Asuncion":"PY","America/Guayaquil":"EC",
};
function pais(tz){
  const cc = TZ_PAIS[tz];
  if (cc) { try { return new Intl.DisplayNames([_loc()], { type: "region" }).of(cc); } catch {} }
  return (String(tz).split("/").pop() || tz).replace(/_/g, " ");
}

/* ── piezas de los planos ── */
function barras(serie, pico){
  const mx = Math.max(...serie) || 1;
  return `<div class="rc-chart">${serie.map((v, i) =>
    `<span class="rc-b${i === pico ? " rc-peak" : ""}" style="--h:${(100 * v / mx).toFixed(1)}%;--i:${i}"></span>`).join("")}</div>`;
}
function calendario(d){
  const mx = Math.max(...d.por_dia) || 1;
  const nivel = v => v === 0 ? 0 : Math.min(4, Math.ceil(4 * v / mx));
  const hueco = (new Date(d.mes.y, d.mes.m, 1).getDay() + 6) % 7;      // lunes = 0
  let h = t("recap.weekdays").split(",").map(x => `<span class="rc-h">${x}</span>`).join("");
  h += `<span class="rc-c rc-e"></span>`.repeat(hueco);
  d.por_dia.forEach((v, i) => {
    h += `<span class="rc-c rc-l${nivel(v)}${i + 1 === d.record.dia ? " rc-rec" : ""}" style="--i:${i}">${i + 1}</span>`;
  });
  return `<div class="rc-cal">${h}</div>`;
}
function linea(serie){
  const W = 240, H = 92, mx = Math.max(...serie) || 1;
  return "M" + serie.map((v, i) => `${(i * W / 23).toFixed(1)} ${(H - 6 - (H - 12) * v / mx).toFixed(1)}`).join(" L");
}
function lluvia(emojis, n){
  let h = "";
  for (let i = 0; i < n; i++){
    h += `<span style="--x:${(4 + Math.random() * 86).toFixed(0)}%;--s:${(18 + Math.random() * 16).toFixed(0)}px;` +
         `--t:${(2.6 + Math.random() * 2).toFixed(2)}s;--d:${(0.2 + Math.random() * 3.2).toFixed(2)}s;` +
         `--r:${(-40 + Math.random() * 80).toFixed(0)}deg">${emojis[i % emojis.length]}</span>`;
  }
  return `<div class="rc-rain">${h}</div>`;
}
const tuberias = `<div class="rc-pipes"><span class="rc-pipe rc-pipe--l"></span><span class="rc-pipe rc-pipe--r"></span><span class="rc-nut"></span><span class="rc-splash"></span></div>`;
const S = (bg, fg, dur, html, extra = {}) => ({ bg, fg, dur, html, ...extra });

/* ── tu mes ── */
function planosPersonal(d, opts){
  const mes = nombreMes(d.mes.y, d.mes.m), prev = mesRel(d.mes, -1);
  const [emo, arq] = arquetipo(d.hora);
  const todos1 = d.puestos.length > 1 && d.puestos.every(p => p.puesto === 1);
  const zonas = [...new Set(d.zonas.map(pais))];
  const out = [
    S(C.ink, C.paper, 4500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.brand", { month: cap(mes), year: d.mes.y })}</span>
      <div class="rc-hero rc-a rc-a-pop" style="--d:.35s">${t("recap.p.hero", { month: mes })}</div>
      <p class="rc-sub rc-a" style="--d:1s">${t("recap.p.intro", { name: esc(d.nombre) })}</p>
      <span class="rc-hint rc-a" style="--d:1.7s">${t("recap.hint")}</span>`),

    S(C.brand, C.paper, 5500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.p.total.k")}</span>
      <div class="rc-big rc-a rc-a-fade" style="--d:.2s" data-count="${d.total}">0</div>
      <p class="rc-label rc-a" style="--d:.5s">${t(d.total === 1 ? "recap.unit.one" : "recap.unit.many")}</p>
      <span class="rc-pill rc-a rc-a-pop" style="--d:1.7s">${delta(d.total - d.anterior, prev)}</span>
      <p class="rc-foot rc-a" style="--d:2.1s">${t("recap.p.perday", { n: num(d.media) })}</p>`),

    S(C.ink, C.paper, 6000, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.p.cal.k")}</span>
      <div class="rc-title rc-a" style="--d:.25s">${d.dias === d.mes.dias ? t("recap.p.cal.full") : t("recap.p.cal.some", { n: d.dias, total: d.mes.dias })}</div>
      ${calendario(d)}
      <p class="rc-foot rc-a" style="--d:1.7s">${t("recap.p.cal.foot", { streak: pl(d.racha, "recap.streak"), month: mes, day: d.record.dia, n: d.record.n })}</p>`),

    S(C.gold, C.ink, 6000, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.p.hour.k")}</span>
      <div class="rc-big rc-a rc-a-pop" style="--d:.25s;font-size:clamp(84px,30cqw,150px)">${d.hora}:00</div>
      <span class="rc-pill rc-a" style="--d:.8s">${emo} ${arq}</span>
      ${barras(d.por_hora, d.hora)}
      <div class="rc-axis rc-a rc-a-fade" style="--d:1.2s"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      <p class="rc-foot rc-a" style="--d:1.6s">${t("recap.p.hour.foot", { pct: d.finde_pct, n: d.madrugadas })}</p>`,
      { accent: C.brand }),
  ];

  if (d.de > 1 || d.puestos.length) out.push(S(C.mint, C.paper, 5500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.p.rank.k")}</span>
      <div class="rc-big rc-a rc-a-pop" style="--d:.25s">#${d.puesto}</div>
      <p class="rc-label rc-a" style="--d:.6s">${t("recap.p.rank.of", { n: d.de })}</p>
      ${!d.puestos.length ? "" : todos1
        ? `<p class="rc-foot rc-a" style="--d:1.1s;font-size:19px">${t("recap.p.rank.allfirst", { n: d.puestos.length })}</p>`
        : `<p class="rc-foot rc-a" style="--d:1.1s">${t("recap.p.rank.groups")}</p>`}
      <div class="rc-row">${d.puestos.map((p, i) =>
        `<span class="rc-chip rc-a rc-a-pop" style="--d:${(1.4 + i * .09).toFixed(2)}s">${p.puesto === 1 ? "👑 " : `${t("recap.pos", { n: p.puesto })} · `}${esc(p.grupo)}</span>`).join("")}</div>`));

  if (d.conexiones) out.push(S(C.brand2, C.paper, 5500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.pipes.k")}</span>
      ${tuberias}
      <div class="rc-big rc-a rc-a-pop" style="--d:1.3s" data-count="${d.conexiones}" data-delay="1300">0</div>
      <p class="rc-label rc-a" style="--d:1.5s">${t(d.conexiones === 1 ? "recap.p.pipes.one" : "recap.p.pipes.many")}</p>
      ${d.companero ? `<p class="rc-foot rc-a" style="--d:2s">${t("recap.p.pipes.mate", { name: esc(d.companero.nombre), times: pl(d.companero.n, "recap.times") })}</p>` : ""}`));

  if (d.rx_dadas || d.rx_recibidas) out.push(S(C.rose, C.paper, 5500, `
      ${lluvia(d.emoji ? [d.emoji, d.emoji, "❤️", "👑", d.emoji, "👏"] : ["🔥", "❤️", "👑", "👏"], 22)}
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.rx.k")}</span>
      <div class="rc-duo">
        <div class="rc-a" style="--d:.3s"><div class="rc-n" data-count="${d.rx_dadas}" data-delay="300">0</div><div class="rc-l">${t("recap.p.rx.given")}</div></div>
        <div class="rc-a" style="--d:.55s"><div class="rc-n" data-count="${d.rx_recibidas}" data-delay="550">0</div><div class="rc-l">${t("recap.p.rx.got")}</div></div>
      </div>
      ${d.emoji ? `<p class="rc-foot rc-a" style="--d:1.4s;font-size:19px">${t("recap.p.rx.emoji")}</p>
      <div class="rc-a rc-a-pop" style="--d:1.7s;font-size:96px;line-height:1.1">${d.emoji}</div>` : ""}`));

  if (d.gemela) out.push(S(C.ink, C.paper, 6500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.p.twin.k")}</span>
      <div class="rc-title rc-a" style="--d:.25s">${esc(d.gemela.nombre)}</div>
      <svg class="rc-twin" viewBox="-4 -4 248 100" aria-hidden="true">
        <path class="rc-ot" pathLength="1" d="${linea(d.gemela.por_hora)}"/>
        <path class="rc-me" pathLength="1" d="${linea(d.por_hora)}"/>
      </svg>
      <div class="rc-legend rc-a rc-a-fade" style="--d:1.2s"><span><i style="background:${C.gold}"></i>${t("recap.p.twin.you")}</span><span><i style="background:${C.paper}"></i>${primero(d.gemela.nombre)}</span></div>
      <div class="rc-big rc-a rc-a-pop" style="--d:2.1s;font-size:clamp(72px,26cqw,130px);margin-top:18px">${d.gemela.pct}%</div>
      <p class="rc-label rc-a" style="--d:2.4s">${t("recap.p.twin.label")}</p>`));

  if (d.bristol){
    const b = d.bristol, mxB = Math.max(...b.por_tipo) || 1;
    const ideal = b.por_tipo.slice(2, 5).reduce((x, y) => x + y, 0);
    out.push(S(C.paper, C.ink, 6500, `
      <span class="rc-lock rc-a" style="--d:.05s">${t("recap.p.bri.lock")}</span>
      <span class="rc-kicker rc-a" style="--d:.15s">${t("recap.p.bri.k")}</span>
      <div class="rc-title rc-a" style="--d:.3s">${t("recap.p.bri.avg", { n: num(b.media) })}</div>
      <div class="rc-bri">${b.por_tipo.map((v, i) => {
        const z = i < 2 ? "rc-z-bad" : i < 5 ? "rc-z-ok" : "rc-z-warn";
        return `<div><span class="rc-v" style="--i:${i}">${v || ""}</span><span class="rc-b ${z}" style="--h:${(100 * v / mxB).toFixed(1)}%;--i:${i}"></span><span class="rc-t">${i + 1}</span></div>`;
      }).join("")}</div>
      <p class="rc-foot rc-a" style="--d:1.7s">${t("recap.p.bri.foot", { ok: ideal, n: b.n, mode: b.moda })}</p>
      <p class="rc-note rc-a" style="--d:2.1s">${t("recap.p.bri.note")}</p>`));
  }

  if (d.sitios >= 2) out.push(S(C.brand, C.paper, 5000, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.p.places.k")}</span>
      <div class="rc-big rc-a rc-a-pop" style="--d:.25s" data-count="${d.sitios}" data-delay="250">0</div>
      <p class="rc-label rc-a" style="--d:.6s">${t("recap.p.places.label")}</p>
      ${d.km_lejos > 5 ? `<p class="rc-foot rc-a" style="--d:1.1s;font-size:18px">${t("recap.p.places.far", { km: num(d.km_lejos) })}</p>` : ""}
      <div class="rc-row">${zonas.map((z, i) => `<span class="rc-chip rc-a rc-a-pop" style="--d:${(1.5 + i * .12).toFixed(2)}s">📍 ${esc(z)}</span>`).join("")}</div>`));

  out.push(S(C.ink, C.paper, 0, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.p.share.k")}</span>
      <div class="rc-title rc-a" style="--d:.2s;font-size:clamp(30px,9.5cqw,44px)">${t("recap.p.share.title", { month: mes })}</div>
      <div class="rc-share rc-a rc-a-pop" style="--d:.5s">
        <div class="rc-share__top"><span class="rc-share__n">${esc(d.nombre)}</span><span class="rc-share__m">${cap(mes)} ${d.mes.y}</span></div>
        <div class="rc-share__g">
          <div><b>${num(d.total)}</b><span>${t(d.total === 1 ? "recap.unit.one" : "recap.unit.many")}</span></div>
          <div><b>${d.dias}/${d.mes.dias}</b><span>${t("recap.share.days")}</span></div>
          <div><b>${d.hora}:00</b><span>${arq.toLowerCase()}</span></div>
          ${d.emoji ? `<div><b>${d.emoji}</b><span>${t("recap.share.emoji")}</span></div>` : `<div><b>${d.racha}</b><span>${t("recap.share.streak")}</span></div>`}
        </div>
        <div class="rc-share__brand">💩 El Cagómetro</div>
      </div>
      <div class="rc-actions rc-a" style="--d:1s">
        <button class="rc-btn" data-act="share">${t("recap.share.btn")}</button>
        ${opts.hayGrupos ? `<button class="rc-btn rc-btn--ghost" data-act="grupos">${t("recap.go.groups")}</button>` : `<button class="rc-btn rc-btn--ghost" data-act="close">${t("recap.close")}</button>`}
      </div>
      <p class="rc-note rc-a" style="--d:1.2s">${t("recap.p.share.note")}</p>`, { share: true }));
  return out;
}

/* ── versión corta, para quien no llega al umbral ── */
function planosCorto(d, opts){
  const mes = nombreMes(d.mes.y, d.mes.m);
  return [
    S(C.paper, C.ink, 6000, `
      <span class="rc-kicker rc-a" style="--d:.15s">${t("recap.s.k", { month: mes })}</span>
      <div class="rc-title rc-a" style="--d:.3s">${t("recap.s.title")}</div>
      <div class="rc-big rc-a rc-a-pop" style="--d:.8s;color:${C.brand}">${num(d.total)}</div>
      <p class="rc-label rc-a" style="--d:1.1s">${t("recap.s.label", { unit: t(d.total === 1 ? "recap.unit.one" : "recap.unit.many"), days: pl(d.dias, "recap.days") })}</p>
      <p class="rc-foot rc-a" style="--d:1.6s">${t("recap.s.foot")}</p>`),
    S(C.mint, C.paper, 0, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.s2.k", { month: mesRel(d.mes, 1) })}</span>
      <div class="rc-title rc-a" style="--d:.25s">${t("recap.s2.title", { c: UMBRAL.cacas, d: UMBRAL.dias })}</div>
      <p class="rc-sub rc-a" style="--d:.7s">${t("recap.s2.sub", { month: mesRel(d.mes, 2) })}</p>
      <div class="rc-actions rc-a" style="--d:1.2s">
        ${opts.hayGrupos ? `<button class="rc-btn" data-act="grupos">${t("recap.go.groups")}</button>` : ""}
        <button class="rc-btn ${opts.hayGrupos ? "rc-btn--ghost" : ""}" data-act="close">${t("recap.close")}</button>
      </div>`),
  ];
}

/* ── el mes del grupo: sin Bristol ni ubicaciones ── */
function planosGrupo(g){
  const mes = nombreMes(g.mes.y, g.mes.m), prev = mesRel(g.mes, -1);
  const [emo, arq] = arquetipo(g.hora);
  const top = g.podio.slice(0, 3), resto = g.podio.slice(3, 6);
  const mxE = Math.max(...g.emojis.map(e => e.n), 1);
  const orden = [1, 0, 2], alturas = ["70%", "54%", "40%"], medalla = ["🥇", "🥈", "🥉"];   // el nombre va encima del escalón
  const out = [
    S(C.mint, C.paper, 4500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.brand", { month: cap(mes), year: g.mes.y })}</span>
      <div class="rc-hero rc-a rc-a-pop" style="--d:.35s;font-size:clamp(52px,18cqw,96px)">${t("recap.g.hero", { month: mes, group: esc(g.nombre) })}</div>
      <p class="rc-sub rc-a" style="--d:1s">${t("recap.g.intro", { a: g.activos, m: g.miembros })}</p>
      <span class="rc-hint rc-a" style="--d:1.7s">${t("recap.hint")}</span>`),

    S(C.ink, C.paper, 5500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.g.total.k")}</span>
      <div class="rc-big rc-a rc-a-fade" style="--d:.2s" data-count="${g.total}">0</div>
      <p class="rc-label rc-a" style="--d:.5s">${t(g.total === 1 ? "recap.unit.one" : "recap.unit.many")}</p>
      <span class="rc-pill rc-a rc-a-pop" style="--d:1.7s">${delta(g.total - g.anterior, prev)}</span>
      <p class="rc-foot rc-a" style="--d:2.1s">${t("recap.g.perday", { n: num(g.media) })}</p>`),

    S(C.brand, C.paper, 6000, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.g.rhythm.k")}</span>
      <div class="rc-title rc-a" style="--d:.25s">${t("recap.g.rhythm.title")}</div>
      ${barras(g.por_dia, g.record.dia - 1)}
      <div class="rc-axis rc-a rc-a-fade" style="--d:1.4s"><span>1</span><span>8</span><span>15</span><span>22</span><span>${g.mes.dias}</span></div>
      <p class="rc-foot rc-a" style="--d:1.7s">${t("recap.g.rhythm.foot", { month: mes, day: g.record.dia, n: g.record.n })}</p>`),

    S(C.gold, C.ink, 5500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.g.hour.k")}</span>
      <div class="rc-big rc-a rc-a-pop" style="--d:.25s;font-size:clamp(84px,30cqw,150px)">${g.hora}:00</div>
      <span class="rc-pill rc-a" style="--d:.8s">${emo} ${t("recap.g.arq", { arq: arq.toLowerCase() })}</span>
      ${barras(g.por_hora, g.hora)}
      <div class="rc-axis rc-a rc-a-fade" style="--d:1.2s"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>`,
      { accent: C.brand }),

    S(C.ink, C.paper, 7000, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.g.podium.k")}</span>
      <div class="rc-podium">${orden.map(k => {
        const p = top[k]; if (!p) return "<div></div>";
        const dl = [.95, .6, .25][k];                    // sale primero el bronce y el oro el último
        return `<div class="rc-col"><div class="rc-who" style="--d:${dl}s">${esc(p.nombre)}<em>${num(p.n)}</em></div>` +
               `<div class="rc-step" style="--h:${alturas[k]};--d:${dl}s">${medalla[k]}</div></div>`;
      }).join("")}</div>
      <div class="rc-list">${resto.map((p, i) =>
        `<div class="rc-it rc-a" style="--d:${(1.9 + i * .15).toFixed(2)}s"><span class="rc-k">${i + 4}</span>${esc(p.nombre)}<span class="rc-val">${num(p.n)}</span></div>`).join("")}</div>`),
  ];

  if (g.pleno.length || g.subidas.length) out.push(S(C.rose, C.paper, 6500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.g.special.k")}</span>
      ${g.pleno.length ? `<div class="rc-title rc-a" style="--d:.25s">${t("recap.g.full", { n: g.mes.dias })}</div>
      <div class="rc-row">${g.pleno.map((n, i) => `<span class="rc-chip rc-a rc-a-pop" style="--d:${(.6 + i * .15).toFixed(2)}s">✅ ${esc(n)}</span>`).join("")}</div>` : ""}
      ${g.subidas.length ? `<div class="rc-title rc-a" style="--d:1.4s;font-size:clamp(28px,9cqw,40px);margin-top:${g.pleno.length ? 34 : 10}px">${t("recap.g.up.title")}</div>
      <div class="rc-list">${g.subidas.map((s, i) =>
        `<div class="rc-it rc-a rc-a-left" style="--d:${(1.7 + i * .15).toFixed(2)}s"><span class="rc-k">↑</span>${esc(s.nombre)}<span class="rc-val">+${num(s.delta)}</span></div>`).join("")}</div>
      <p class="rc-note rc-a" style="--d:2.4s">${t("recap.g.up.note", { prev })}</p>` : ""}`));

  if (g.conexiones) out.push(S(C.brand2, C.paper, 6500, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.pipes.k")}</span>
      ${tuberias}
      <div class="rc-big rc-a rc-a-pop" style="--d:1.3s" data-count="${g.conexiones}" data-delay="1300">0</div>
      <p class="rc-label rc-a" style="--d:1.5s">${t("recap.g.pipes.label")}</p>
      ${g.parejas.length ? `<p class="rc-foot rc-a" style="--d:1.9s">${g.triples ? t("recap.g.pipes.triples", { n: g.triples }) + " " : ""}${t("recap.g.pipes.pairs")}</p>
      <div class="rc-list">${g.parejas.map((p, i) =>
        `<div class="rc-it rc-a rc-a-left" style="--d:${(2.2 + i * .15).toFixed(2)}s">${t("recap.g.pair", { a: esc(p.a), b: esc(p.b) })}<span class="rc-val">${p.n}</span></div>`).join("")}</div>` : ""}`));

  if (g.reacciones) out.push(S(C.rose, C.paper, 6000, `
      ${lluvia(g.emojis.flatMap(e => Array(Math.max(1, Math.round(6 * e.n / mxE))).fill(e.e)), 24)}
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.rx.k")}</span>
      <div class="rc-big rc-a rc-a-fade" style="--d:.2s" data-count="${g.reacciones}">0</div>
      <p class="rc-label rc-a" style="--d:.5s">${t("recap.g.rx.label")}</p>
      <div class="rc-list" style="margin-top:22px">${g.emojis.map((e, i) =>
        `<div class="rc-a" style="--d:${(1 + i * .12).toFixed(2)}s"><div class="rc-it"><span style="font-size:24px">${e.e}</span><span class="rc-val">${num(e.n)}</span></div>` +
        `<div class="rc-meter"><b style="--w:${(100 * e.n / mxE).toFixed(0)}%;--d:${(1.2 + i * .12).toFixed(2)}s"></b></div></div>`).join("")}</div>`));

  if (g.gemelas.length) out.push(S(C.ink, C.paper, 6000, `
      <span class="rc-kicker rc-a" style="--d:.1s">${t("recap.g.twins.k")}</span>
      <div class="rc-title rc-a" style="--d:.25s">${t("recap.g.twins.title")}</div>
      <div class="rc-list" style="margin-top:26px;gap:18px">${g.gemelas.map((x, i) =>
        `<div class="rc-a" style="--d:${(.8 + i * .3).toFixed(2)}s"><div class="rc-it">${esc(x.a)} <span style="opacity:.6">&amp;</span> ${esc(x.b)}<span class="rc-val">${x.pct}%</span></div>` +
        `<div class="rc-meter"><b style="--w:${x.pct}%;--d:${(1 + i * .3).toFixed(2)}s"></b></div></div>`).join("")}</div>`));

  out.push(S(C.mint, C.paper, 0, `
      <span class="rc-kicker rc-a" style="--d:.1s">${esc(g.nombre)} · ${cap(mes)} ${g.mes.y}</span>
      <div class="rc-hero rc-a rc-a-pop" style="--d:.3s;font-size:clamp(50px,17cqw,92px)">${t("recap.g.end", { month: cap(mesRel(g.mes, 1)) })}</div>
      <p class="rc-sub rc-a" style="--d:.9s">${t("recap.g.end.sub", { month: mesRel(g.mes, 2) })}</p>
      <div class="rc-actions rc-a" style="--d:1.3s">
        <button class="rc-btn" data-act="close">${t("recap.close")}</button>
      </div>`));
  return out;
}

/* ── la imagen para compartir (sin Bristol ni ubicaciones) ── */
function _rect(ctx, x, y, w, h, r){
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function _ajusta(ctx, txt, peso, tam, familia, maxW){
  let s = tam;
  do { ctx.font = `${peso} ${s}px ${familia}`; s -= 4; } while (ctx.measureText(txt).width > maxW && s > 24);
}
async function tarjetaPNG(d){
  const SERIF = 'Fraunces, Georgia, serif', SANS = '"Hanken Grotesk", system-ui, sans-serif';
  const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  try { await Promise.all([document.fonts.load(`900 120px Fraunces`), document.fonts.load(`700 36px "Hanken Grotesk"`), document.fonts.load(`800 32px "Hanken Grotesk"`)]); } catch {}
  const W = 1080, H = 1350, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const mes = nombreMes(d.mes.y, d.mes.m), [, arq] = arquetipo(d.hora);
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.paper; ctx.textBaseline = "alphabetic";
  ctx.font = `800 34px ${SANS}`; ctx.globalAlpha = .75; ctx.fillText("EL CAGÓMETRO", 90, 150); ctx.globalAlpha = 1;
  _ajusta(ctx, t("recap.share.img", { month: mes }), 900, 116, SERIF, 900);
  ctx.fillText(t("recap.share.img", { month: mes }), 90, 280);
  ctx.fillStyle = C.paper; _rect(ctx, 90, 360, 900, 840, 56); ctx.fill();
  ctx.fillStyle = C.brand; _ajusta(ctx, d.nombre, 900, 68, SERIF, 520); ctx.fillText(d.nombre, 150, 478);
  ctx.fillStyle = "#7A6A58"; ctx.font = `800 30px ${SANS}`; ctx.textAlign = "right";
  ctx.fillText(`${cap(mes)} ${d.mes.y}`.toUpperCase(), 930, 474); ctx.textAlign = "left";
  const celdas = [
    [num(d.total), t(d.total === 1 ? "recap.unit.one" : "recap.unit.many"), SERIF],
    [`${d.dias}/${d.mes.dias}`, t("recap.share.days"), SERIF],
    [`${d.hora}:00`, arq.toLowerCase(), SERIF],
    d.emoji ? [d.emoji, t("recap.share.emoji"), EMOJI] : [String(d.racha), t("recap.share.streak"), SERIF],
  ];
  celdas.forEach(([v, l, fam], i) => {
    const x = 150 + (i % 2) * 420, y = 690 + Math.floor(i / 2) * 270;
    ctx.fillStyle = C.ink; ctx.font = `${fam === SERIF ? "900 " : ""}132px ${fam}`; ctx.fillText(v, x, y);
    ctx.fillStyle = "#7A6A58"; ctx.font = `700 36px ${SANS}`; ctx.fillText(l, x, y + 62);
  });
  ctx.fillStyle = "#AC9C88"; ctx.font = `800 30px ${SANS}`; ctx.fillText("💩 EL CAGÓMETRO", 150, 1140);
  return new Promise((ok, ko) => cv.toBlob(b => b ? ok(b) : ko(new Error("toBlob")), "image/png"));
}

/* ── el reproductor ── */
let _ok = false, slides = [], els = [], fills = [], idx = 0, elapsed = 0, last = 0, raf = 0, paused = false, countTok = 0;
let _datos = null, _opts = {}, _png = null, _pngBlob = null, _themeAntes = null;
let root, frame, stage, barsEl;

function _init(){
  if (_ok) return; _ok = true;
  root = $("recapStory"); frame = $("rcFrame"); stage = $("rcStage"); barsEl = $("rcBars");
  // mantener pulsado pausa; un toque avanza (derecha) o vuelve (izquierda)
  let holdT = 0, held = false, downX = 0;
  const reanuda = () => { paused = false; frame.classList.remove("rc-is-paused"); last = performance.now(); };
  frame.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    downX = e.clientX; held = false;
    holdT = setTimeout(() => { held = true; paused = true; frame.classList.add("rc-is-paused"); }, 220);
  });
  frame.addEventListener("pointerup", e => {
    if (e.target.closest("button")) return;
    clearTimeout(holdT);
    if (held) { reanuda(); return; }
    const r = frame.getBoundingClientRect();
    (downX - r.left < r.width * 0.33) ? go(idx - 1) : go(idx + 1);
  });
  frame.addEventListener("pointercancel", () => { clearTimeout(holdT); if (held) reanuda(); });
  frame.addEventListener("contextmenu", e => e.preventDefault());
  frame.addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act;
    if (a === "share") compartir();
    else if (a === "close") cerrar();
    else { cerrar(); _opts.onAccion?.(a); }
  });
  $("rcClose").addEventListener("click", cerrar);
  document.addEventListener("keydown", e => {
    if (root.hidden) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(idx + 1); }
    else if (e.key === "ArrowLeft") go(idx - 1);
    else if (e.key === "Escape") cerrar();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) last = performance.now(); });
  // lo puede cerrar cualquiera poniendo hidden (el botón atrás de la app lo hace así):
  // al cerrarse por donde sea, se para el reloj y se devuelve el color de la barra
  new MutationObserver(() => { if (root.hidden) _limpia(); }).observe(root, { attributes: true, attributeFilter: ["hidden"] });
}
function _limpia(){
  cancelAnimationFrame(raf); countTok++;
  stage.innerHTML = ""; slides = []; els = [];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && _themeAntes != null) meta.content = _themeAntes;
  _themeAntes = null;
}
function _monta(lista){
  slides = lista;
  stage.innerHTML = slides.map(s =>
    `<section class="rc-slide" style="--bg:${s.bg};--fg:${s.fg};--accent:${s.accent || C.gold}">${s.html}</section>`).join("");
  els = [...stage.children];
  barsEl.innerHTML = slides.map(() => "<i><b></b></i>").join("");
  fills = [...barsEl.querySelectorAll("b")];
  $("rcPaused").textContent = t("recap.paused");
  $("rcClose").setAttribute("aria-label", t("recap.close"));
  if (root.hidden){
    const meta = document.querySelector('meta[name="theme-color"]');
    _themeAntes = meta ? meta.content : null;
    root.hidden = false;
  }
}

// mientras se calcula: un plano de espera, sin barras de progreso
export function abrirCargando(texto){
  _init();
  _monta([S(C.ink, C.paper, 0, `<div class="rc-loading"><span class="rc-loading__e">💩</span><p class="rc-sub">${esc(texto)}</p></div>`)]);
  barsEl.innerHTML = "";
  go(0);
}
export function abrirError(texto){
  _init();
  _monta([S(C.ink, C.paper, 0, `<div class="rc-loading"><span class="rc-loading__e" style="animation:none">😵</span><p class="rc-sub">${esc(texto)}</p>
    <div class="rc-actions"><button class="rc-btn" data-act="close">${t("recap.close")}</button></div></div>`)]);
  barsEl.innerHTML = "";
  go(0);
}
export const estaAbierto = () => !!root && !root.hidden;

// data: lo que devuelve recapPersonal o recapGrupo. opts: { hayGrupos, onAccion(accion) }
export function abrir(data, opts = {}){
  _init();
  _datos = data; _opts = opts; _png = null; _pngBlob = null;
  const lista = data.tipo === "grupo" ? planosGrupo(data)
              : data.cumple ? planosPersonal(data, opts) : planosCorto(data, opts);
  _monta(lista);
  go(0);
}
export function cerrar(){ if (root && !root.hidden) root.hidden = true; }   // el observer limpia

function go(i){
  if (i < 0) i = 0;
  if (i >= slides.length) return;
  idx = i; elapsed = 0; last = performance.now(); paused = false;
  frame.classList.remove("rc-is-paused");
  const s = slides[i];
  frame.style.setProperty("--bg", s.bg); frame.style.setProperty("--fg", s.fg);
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = s.bg;
  fills.forEach((f, k) => f.style.transform = `scaleX(${k < i ? 1 : 0})`);
  els.forEach(e => e.classList.remove("rc-on"));
  void els[i].offsetWidth;                         // reinicia las animaciones CSS al volver a un plano
  els[i].classList.add("rc-on");
  contar(els[i]);
  // la imagen se prepara al llegar al último plano, ANTES del toque: iOS solo deja abrir
  // el menú de compartir dentro del propio toque, y dibujarla después lo rompería
  if (s.share && !_png) _png = tarjetaPNG(_datos).then(b => (_pngBlob = b)).catch(() => null);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}
function tick(now){
  const s = slides[idx];
  if (!s) return;
  if (!paused) elapsed += now - last;
  last = now;
  if (!s.dur){ if (fills[idx]) fills[idx].style.transform = "scaleX(1)"; return; }   // último plano: se queda
  const p = Math.min(1, elapsed / s.dur);
  fills[idx].style.transform = `scaleX(${p})`;
  if (p >= 1) { go(idx + 1); return; }
  raf = requestAnimationFrame(tick);
}
function contar(slide){
  const tok = ++countTok;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  slide.querySelectorAll("[data-count]").forEach(el => {
    const fin = +el.dataset.count, espera = +(el.dataset.delay || 250), dur = 1300;
    if (reduce){ el.textContent = num(fin); return; }
    el.textContent = "0";
    const t0 = performance.now() + espera;
    const paso = now => {
      if (tok !== countTok) return;
      const p = Math.max(0, Math.min(1, (now - t0) / dur));
      el.textContent = num(Math.round(fin * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  });
}
function toast(msg){
  const el = $("rcToast"); el.textContent = msg; el.classList.add("rc-on");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("rc-on"), 2800);
}
async function compartir(){
  const d = _datos;
  const nombre = `cagometro-${d.mes.y}-${String(d.mes.m + 1).padStart(2, "0")}.png`;
  try {
    const blob = _pngBlob || await (_png || tarjetaPNG(d));
    if (!blob) throw new Error("sin imagen");
    const file = new File([blob], nombre, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(t("recap.share.saved"));
  } catch (e) {
    if (e?.name === "AbortError") return;           // cerró el menú de compartir: no es un error
    toast(t("recap.share.error"));
  }
}
// para las pruebas: tarjetaPNG sin pasar por el menú de compartir
export const _tarjetaPNG = tarjetaPNG;
