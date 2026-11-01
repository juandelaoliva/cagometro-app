/* ============================================================
   Cagómetro · recap mensual — el CÁLCULO
   Sin DOM y sin Firestore: entra lo que la app ya sabe leer (las cacas del mes,
   el feed del mes, los docs de amigos y grupos) y sale un objeto con las cifras
   que pinta recap-player.js. Separado a propósito: es la pieza que se lleva tal
   cual al puerto a Expo, y la que se puede probar en Node contra un export.
   ============================================================ */

export const RECAP_V = 1;                       // súbelo si cambia el cálculo: invalida las cachés
export const UMBRAL = { cacas: 10, dias: 7 };   // por debajo, versión corta
const MIN_GEMELA = 10;                          // cacas en el mes para entrar en «alma gemela»
const SITIO_KM = 0.1;                           // dos puntos a menos de 100 m son el mismo sitio

/* ── meses ── */
export function mesDe(y, m){
  return {
    y, m, key: `${y}_${m}`,                      // mismo formato que countsByMonth (mes 0-11)
    from: new Date(y, m, 1).getTime(),
    to:   new Date(y, m + 1, 1).getTime(),
    dias: new Date(y, m + 1, 0).getDate(),
  };
}
export const mesAnterior = (mes) => mesDe(mes.m === 0 ? mes.y - 1 : mes.y, (mes.m + 11) % 12);
export const mesSiguiente = (mes) => mesDe(mes.m === 11 ? mes.y + 1 : mes.y, (mes.m + 1) % 12);
// el mes que toca enseñar: el último cerrado
export const mesDelRecap = (now = new Date()) => mesAnterior(mesDe(now.getFullYear(), now.getMonth()));

/* ── fechas en la zona de cada caca (como las estadísticas del perfil) ── */
const _fmt = {};
const DIAS_EN = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function _formato(tz){
  if (_fmt[tz]) return _fmt[tz];
  const o = { year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", hourCycle:"h23", weekday:"short" };
  try { _fmt[tz] = new Intl.DateTimeFormat("en-US", { ...o, timeZone: tz }); }
  catch { _fmt[tz] = new Intl.DateTimeFormat("en-US", o); }   // zona desconocida: la del móvil
  return _fmt[tz];
}
function partes(ts, tz, mes){
  const p = {};
  for (const x of _formato(tz || "Europe/Madrid").formatToParts(new Date(ts))) p[x.type] = x.value;
  let d = +p.day;
  // una caca de la última hora del mes hecha en otra zona puede caer, en SU zona, en el
  // mes de al lado: para el calendario manda entonces el día del móvil, que sí está dentro
  if (mes && (+p.year !== mes.y || +p.month - 1 !== mes.m)) d = new Date(ts).getDate();
  return { d, h: (+p.hour) % 24, wd: DIAS_EN.indexOf(p.weekday) };
}

/* ── utilidades ── */
const contar = (xs) => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1); return c; };
const masComun = (c) => { let k = null, n = -1; for (const [kk, v] of c) if (v > n) { k = kk; n = v; } return k === null ? null : [k, n]; };
const lista = (v) => v == null ? [] : Array.isArray(v) ? v : [v];
const argmax = (xs) => xs.reduce((best, v, i) => v > xs[best] ? i : best, 0);
function coseno(a, b){
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++){ ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}
function km(a, b){
  const R = 6371, r = Math.PI / 180;
  const s = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function mejorRacha(diasSet){
  const ds = [...diasSet].sort((a, b) => a - b);
  let mejor = ds.length ? 1 : 0, act = mejor;
  for (let i = 1; i < ds.length; i++){ act = ds[i] === ds[i - 1] + 1 ? act + 1 : 1; if (act > mejor) mejor = act; }
  return mejor;
}
const porDia = (cs, mes) => { const s = new Array(mes.dias).fill(0); for (const c of cs) s[Math.min(mes.dias, Math.max(1, c._p.d)) - 1]++; return s; };
const porHora = (cs) => { const s = new Array(24).fill(0); for (const c of cs) s[c._p.h]++; return s; };
// la caca de verdad de una entrada del feed: las olvidadas guardan su hora en forTs
const tsReal = (a) => a.late && a.forTs ? a.forTs : a.ts;
const esAdd = (a) => !a.kind || a.kind === "add";
const participantes = (s) => lista(s.participantUids).length ? lista(s.participantUids) : [s.uid, s.withUid].filter(Boolean);
function nombresDeSync(s){
  const n = {};
  for (const p of lista(s.participants)) if (p && p.uid) n[p.uid] = p.name;
  if (s.withUid && s.withName) n[s.withUid] = s.withName;   // formato 1:1 antiguo
  if (s.uid && s.name) n[s.uid] = n[s.uid] || s.name;
  return n;
}
const emojisDe = (r) => lista(r);                          // {uid: [emoji]} o, en docs viejos, {uid: emoji}
// de quién es una entrada del feed: el autor, o todos los de una conexión de tuberías
const duenos = (a) => a.kind === "sync" ? participantes(a) : [a.uid];

/* ============================================================
   Recap PERSONAL
   cacas     tus cacas del mes (users/{uid}/cacas)
   activity  el feed del mes en el que estás en la audiencia
   amigos    docs de tus amigos (para el puesto: countsByMonth)
   grupos    tus grupos, con members
   usuarios  uid → doc, para los miembros de tus grupos que no sean amigos
   anterior  tus cacas del mes anterior (countsByMonth)
   ============================================================ */
export function recapPersonal({ uid, nombre, mes, cacas, activity = [], amigos = [], grupos = [], usuarios = {}, anterior = 0 }){
  const cs = cacas.filter(c => c.ts >= mes.from && c.ts < mes.to).map(c => ({ ...c, _p: partes(c.ts, c.tz, mes) }));
  const total = cs.length;
  const dias = new Set(cs.map(c => c._p.d));
  const serieDia = porDia(cs, mes), serieHora = porHora(cs);
  const rec = argmax(serieDia);
  const finde = cs.filter(c => c._p.wd >= 5).length;

  // puesto entre tus amigos y en cada grupo (contadores denormalizados: cero lecturas)
  const cuenta = (u) => u?.countsByMonth?.[mes.key] || 0;
  const conMasQueYo = amigos.filter(a => cuenta(a) > total).length;
  const amigosActivos = amigos.filter(a => cuenta(a) > 0).length;
  const puestos = grupos.map(g => {
    const otros = lista(g.members).filter(m => m !== uid).map(m => cuenta(usuarios[m] || amigos.find(a => a.id === m)));
    return { grupo: g.name, puesto: 1 + otros.filter(n => n > total).length, de: otros.filter(n => n > 0).length + (total ? 1 : 0) };
  }).filter(p => p.de > 1).sort((a, b) => a.puesto - b.puesto || b.de - a.de);

  // conexiones de tuberías en las que estuviste
  const delMes = activity.filter(a => a.ts >= mes.from && a.ts < mes.to);
  const syncs = delMes.filter(a => a.kind === "sync" && participantes(a).includes(uid));
  const comp = new Map(), compNombre = {};
  for (const s of syncs){
    const ns = nombresDeSync(s);
    for (const o of participantes(s)) if (o !== uid){ comp.set(o, (comp.get(o) || 0) + 1); if (ns[o]) compNombre[o] = ns[o]; }
  }
  const mc = masComun(comp);

  // reacciones: dadas, las que pones en lo de otros; recibidas, las que otros ponen en lo
  // tuyo (también en tus conexiones). Tu propia reacción a una conexión tuya —se puede,
  // y se hace mucho— no cuenta ni como dada ni como recibida.
  let dadas = 0, recibidas = 0; const emos = new Map();
  for (const a of delMes){
    const r = a.reactions || {};
    if (!duenos(a).includes(uid)) { dadas += emojisDe(r[uid]).length; continue; }
    for (const [quien, e] of Object.entries(r)) if (quien !== uid) for (const x of emojisDe(e)){ recibidas++; emos.set(x, (emos.get(x) || 0) + 1); }
  }

  // alma gemela: la persona del feed con el horario más parecido al tuyo. El feed no
  // guarda zona horaria, así que se usa la del perfil de cada uno: sin eso, a quien vive
  // en Canarias se le desplazaría el horario una hora y nunca saldría como gemelo.
  let gemela = null;
  if (total >= MIN_GEMELA){
    const porUid = new Map(), nombres = {};
    const zonaDe = (u) => (usuarios[u] || amigos.find(x => x.id === u))?.tz;
    for (const a of activity){
      if (!esAdd(a) || a.uid === uid) continue;
      const ts = tsReal(a);
      if (ts < mes.from || ts >= mes.to) continue;
      if (!porUid.has(a.uid)) porUid.set(a.uid, new Array(24).fill(0));
      porUid.get(a.uid)[partes(ts, zonaDe(a.uid)).h]++;
      nombres[a.uid] = a.name;
    }
    for (const [o, h] of porUid){
      if (h.reduce((x, y) => x + y, 0) < MIN_GEMELA) continue;
      const s = coseno(serieHora, h);
      if (!gemela || s > gemela.s) gemela = { s, uid: o, nombre: nombres[o] || "?", por_hora: h };
    }
    if (gemela) gemela = { nombre: gemela.nombre, pct: Math.round(100 * gemela.s), por_hora: gemela.por_hora };
  }

  // Bristol: privado. Solo se calcula aquí, en tu móvil, y no sale de tu recap.
  const bri = cs.filter(c => c.bristol >= 1 && c.bristol <= 7);
  let bristol = null;
  if (bri.length >= 3){
    const t = new Array(7).fill(0); for (const c of bri) t[c.bristol - 1]++;
    bristol = { n: bri.length, media: Math.round(10 * bri.reduce((x, c) => x + c.bristol, 0) / bri.length) / 10, por_tipo: t, moda: argmax(t) + 1 };
  }

  // sitios: agregados inofensivos, nunca coordenadas
  const pts = cs.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map(c => [c.lat, c.lng]);
  const sitios = [];
  for (const p of pts) if (!sitios.some(s => km(p, s) < SITIO_KM)) sitios.push(p);
  let kmLejos = 0;
  if (pts.length){
    const frec = masComun(contar(pts.map(p => p.join(","))))[0].split(",").map(Number);
    kmLejos = Math.round(Math.max(...pts.map(p => km(p, frec))));
  }

  return {
    v: RECAP_V, tipo: "personal", nombre, mes: { y: mes.y, m: mes.m, dias: mes.dias },
    cumple: total >= UMBRAL.cacas && dias.size >= UMBRAL.dias,
    total, anterior, media: Math.round(10 * total / mes.dias) / 10,
    puesto: 1 + conMasQueYo, de: 1 + amigosActivos, puestos,
    dias: dias.size, por_dia: serieDia, record: { dia: rec + 1, n: serieDia[rec] },
    racha: mejorRacha(dias), por_hora: serieHora, hora: argmax(serieHora),
    finde_pct: total ? Math.round(100 * finde / total) : 0,
    madrugadas: cs.filter(c => c._p.h < 6).length,
    conexiones: syncs.length,
    companero: mc ? { nombre: compNombre[mc[0]] || "?", n: mc[1] } : null,
    rx_dadas: dadas, rx_recibidas: recibidas, emoji: masComun(emos)?.[0] || null,
    gemela, bristol,
    sitios: sitios.length, km_lejos: kmLejos,
    zonas: [...new Set(cs.map(c => c.tz).filter(Boolean))],
  };
}

/* ============================================================
   Recap de GRUPO — sin Bristol ni ubicaciones, lo ven todos sus miembros
   cacas     las cacas del mes de los miembros (con uid)
   usuarios  uid → doc de cada miembro (nombre y countsByMonth)
   activity  el feed del mes (para conexiones y reacciones entre miembros)
   ============================================================ */
export function recapGrupo({ grupo, mes, cacas, usuarios = {}, activity = [] }){
  const miembros = lista(grupo.members);
  const esMiembro = new Set(miembros);
  const cs = cacas.filter(c => esMiembro.has(c.uid) && c.ts >= mes.from && c.ts < mes.to).map(c => ({ ...c, _p: partes(c.ts, c.tz, mes) }));
  const nom = (u) => usuarios[u]?.displayName || "?";
  const prevKey = mesAnterior(mes).key;
  const antes = (u) => usuarios[u]?.countsByMonth?.[prevKey] || 0;

  const porU = new Map(miembros.map(u => [u, []]));
  for (const c of cs) porU.get(c.uid).push(c);
  const activos = miembros.filter(u => porU.get(u).length);
  const podio = activos.map(u => ({ uid: u, nombre: nom(u), n: porU.get(u).length, delta: porU.get(u).length - antes(u) }))
                       .sort((a, b) => b.n - a.n);
  const pleno = activos.filter(u => new Set(porU.get(u).map(c => c._p.d)).size === mes.dias).map(nom);
  const subidas = podio.filter(p => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3).map(p => ({ nombre: p.nombre, delta: p.delta }));

  const serieDia = porDia(cs, mes), serieHora = porHora(cs);
  const rec = argmax(serieDia);

  // conexiones con TODOS los participantes dentro del grupo
  const delMes = activity.filter(a => a.ts >= mes.from && a.ts < mes.to);
  const dentro = delMes.filter(a => a.kind === "sync" && participantes(a).length >= 2 && participantes(a).every(u => esMiembro.has(u)));
  const parejas = new Map();
  for (const s of dentro){
    const p = [...new Set(participantes(s))].sort();
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++){
      const k = p[i] + "|" + p[j]; parejas.set(k, (parejas.get(k) || 0) + 1);
    }
  }
  const topParejas = [...parejas].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => { const [a, b] = k.split("|"); return { a: nom(a), b: nom(b), n }; });

  // reacciones entre miembros, en lo que publicaron miembros. Aquí SÍ cuentan las de una
  // conexión a sí misma: en 40tena son casi la mitad, celebrar la conexión es parte del juego.
  let rx = 0; const emos = new Map();
  for (const a of delMes){
    if (!esMiembro.has(a.uid)) continue;
    for (const [quien, e] of Object.entries(a.reactions || {})){
      if (!esMiembro.has(quien)) continue;
      for (const x of emojisDe(e)){ rx++; emos.set(x, (emos.get(x) || 0) + 1); }
    }
  }

  // almas gemelas del grupo: para cada uno, su pareja más parecida (sin repetir parejas)
  const perfiles = activos.filter(u => porU.get(u).length >= MIN_GEMELA).map(u => [u, porHora(porU.get(u))]);
  const gemelas = [], vistas = new Set();
  for (const [a, ha] of perfiles){
    let best = null;
    for (const [b, hb] of perfiles) if (b !== a){ const s = coseno(ha, hb); if (!best || s > best.s) best = { b, s }; }
    if (!best) continue;
    const k = [a, best.b].sort().join("|");
    if (vistas.has(k)) continue;
    vistas.add(k); gemelas.push({ a: nom(a), b: nom(best.b), pct: Math.round(100 * best.s) });
  }
  gemelas.sort((x, y) => y.pct - x.pct);

  return {
    v: RECAP_V, tipo: "grupo", nombre: grupo.name, mes: { y: mes.y, m: mes.m, dias: mes.dias },
    miembros: miembros.length, activos: activos.length,
    total: cs.length, anterior: miembros.reduce((s, u) => s + antes(u), 0),
    media: Math.round(10 * cs.length / mes.dias) / 10,
    por_dia: serieDia, record: { dia: rec + 1, n: serieDia[rec] },
    por_hora: serieHora, hora: argmax(serieHora),
    podio: podio.map(({ nombre, n, delta }) => ({ nombre, n, delta })),
    pleno, subidas,
    conexiones: dentro.length, triples: dentro.filter(s => participantes(s).length >= 3).length, parejas: topParejas,
    reacciones: rx, emojis: [...emos].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e, n]) => ({ e, n })),
    gemelas: gemelas.slice(0, 3),
  };
}
