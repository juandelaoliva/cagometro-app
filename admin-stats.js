/* ============================================================
   Cagómetro · estadísticas del panel de administración (LÓGICA PURA, sin DOM ni Firebase).
   Se prueba en rules-tests/admin-stats.test.js. Todo sale de los documentos que el admin ya puede leer:
   `users` (contadores que mantiene la propia app: countsByYear/Month, byHour, byWeekday, lastCacaTs…), `groups`,
   `friendships`, `reports` y los últimos días de `activity`. NO se leen las cacas una a una (costaría miles de lecturas)
   ni los chats (el admin no puede leerlos, a propósito).
   ============================================================ */

export const DAY = 86400000;

/** Un instante desde un Timestamp de Firestore, un número o `{seconds}`. 0 si no hay. */
export const tsMs = v => v == null ? 0
  : typeof v === "number" ? v
  : typeof v.toMillis === "function" ? v.toMillis()
  : v.seconds != null ? v.seconds * 1000 : 0;

const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Inicio del día `n` días antes, por calendario (setDate), NO restando 86 400 000 ms: el cambio de hora dura 23 o 25 h.
const dayBack = (ms, n) => { const d = new Date(startOfDay(ms)); d.setDate(d.getDate() - n); return d.getTime(); };
const monday = ms => { const d = new Date(startOfDay(ms)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const sum = xs => xs.reduce((a, b) => a + b, 0);
const pct = (n, d) => d ? Math.round((100 * n) / d) : 0;
/** Mismo formato que `monthKey` de store.js: año_mes(0-11). */
export const monthKey = ms => { const d = new Date(ms); return `${d.getFullYear()}_${d.getMonth()}`; };

export const yearCountOf = (u, year) => u.countsByYear?.[year] || 0;

/** Series de 12 meses terminando en el actual: [{ key, y, m, label }] (más antiguo primero). */
export function lastMonths(now, n = 12) {
  const out = [], d = new Date(now); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${x.getFullYear()}_${x.getMonth()}`, y: x.getFullYear(), m: x.getMonth() });
  }
  return out;
}

/** Qué se sabe del dispositivo de cada persona: tokens de la app nativa (Expo) y de la web (FCM) + lo que anota la PWA de su navegador. */
export function deviceOf(u, priv) {
  // app nativa: tiene token de avisos de Expo, o la app apuntó su versión en `private/app` (desde la 1.0.2, con o sin avisos)
  const native = (priv?.expoTokens || []).length > 0 || !!priv?.app;
  const web = (priv?.tokens || []).length > 0;
  const kind = native && web ? "both" : native ? "native" : web ? "web" : "none";
  const app = priv?.app ? { version: priv.app.version || "?", build: priv.app.build || "?", platform: priv.app.platform || "?", os: priv.app.os || "" } : null;
  return { native, web, kind, app, platform: u.platform || null, standalone: !!u.standalone };
}

/** Las filas del listado de usuarios, con lo derivado (amigos, grupos, días sin actividad…). */
export function userRows(data, now = Date.now()) {
  const { users = [], groups = [], friendships = [], privateById = {} } = data;
  const friends = new Map(), inGroups = new Map();
  for (const f of friendships) {
    if (f.status !== "accepted") continue;
    const [a, b] = f.uids || []; if (!a || !b) continue;
    (friends.get(a) || friends.set(a, []).get(a)).push(b);
    (friends.get(b) || friends.set(b, []).get(b)).push(a);
  }
  for (const g of groups) for (const m of g.members || []) (inGroups.get(m) || inGroups.set(m, []).get(m)).push(g.id);
  const year = new Date(now).getFullYear();
  return users.map(u => {
    const last = tsMs(u.lastCacaTs), created = tsMs(u.createdAt), first = tsMs(u.firstCacaTs);
    const dev = deviceOf(u, privateById[u.id]);
    return {
      id: u.id, u, name: u.displayName || "?", email: u.email || "", color: u.color || "",
      created, first, last,
      daysSinceLast: last ? Math.floor((startOfDay(now) - startOfDay(last)) / DAY) : null,
      daysSinceJoin: created ? Math.floor((startOfDay(now) - startOfDay(created)) / DAY) : null,
      year: yearCountOf(u, year), total: u.lifetimeCount || 0,
      streak: u.currentStreak || 0, best: u.longestStreak || 0,
      friends: friends.get(u.id) || [], groups: inGroups.get(u.id) || [],
      device: dev,
      webCaca: tsMs(u.webCacaAt),                                  // última caca sumada DESDE LA WEB (la web lo apunta desde 2026-11-18)
      webSeen: tsMs(u.webSeenAt),                                  // última vez que ENTRÓ en la web (desde 2026-11-18)
      notifOn: !!u.notifications,                                  // igual que quiereAviso: sin el campo, apagado
      geo: !!u.locationMode && u.locationMode !== "never", shareMap: u.shareMap !== false, bristol: !!u.bristolMode,
      termsOk: (u.termsVersion || 0) > 0,
      suspended: u.suspended === true, suspendedReason: u.suspendedReason || "", suspendedAt: tsMs(u.suspendedAt),
    };
  });
}

/** Cuenta de personas por tramo de «última caca». */
function activityBuckets(rows, now) {
  const within = n => rows.filter(r => r.last && r.last >= dayBack(now, n - 1)).length;   // n=1 → hoy
  return {
    today: within(1), d7: within(7), d30: within(30),
    dormant: rows.filter(r => r.last && r.last < dayBack(now, 13)).length,           // llevan 14 días o más sin sumar
    never: rows.filter(r => !r.total).length,                                         // sin ninguna caca
  };
}

/** Salud de la cola de avisos (`pushQueue`): ¿el emisor (la Pi, o lo que venga después) los está entregando?
    `sent:false` = esperando. Un aviso normal se entrega en segundos: si el más antiguo lleva > 10 min la cola va «atrasada» y, a partir de 1 hora, «parada».
    `queue === null` = el panel no pudo leerla (sin permiso o sin red) → «sin datos». La hora de un aviso es la de su CREACIÓN: no sabemos cuándo se entregó. */
export function queueHealth(queue, now = Date.now()) {
  if (queue == null) return { status: "unknown", total: 0, pending: 0, sent: 0, oldestPending: 0, waitMin: 0, lastSentCreated: 0, sent24h: 0, byType: {} };
  const pend = queue.filter(q => q.sent !== true), done = queue.filter(q => q.sent === true);
  const oldest = pend.length ? Math.min(...pend.map(q => tsMs(q.ts)).filter(Boolean), Infinity) : 0;
  const oldestPending = Number.isFinite(oldest) ? oldest : 0;
  const waitMin = oldestPending ? Math.floor((now - oldestPending) / 60000) : 0;
  const byType = {}; for (const q of pend) byType[q.type || "?"] = (byType[q.type || "?"] || 0) + 1;
  return {
    status: !pend.length ? "ok" : waitMin >= 60 ? "down" : waitMin >= 10 ? "late" : "ok",
    total: queue.length, pending: pend.length, sent: done.length, oldestPending, waitMin, byType,
    lastSentCreated: Math.max(0, ...done.map(q => tsMs(q.ts))),
    sent24h: done.filter(q => tsMs(q.ts) >= now - DAY).length,
  };
}

/** Altas por semana (lunes a domingo), las últimas `n`. */
function weeklySignups(rows, now, n = 12) {
  const out = []; let w = monday(now);
  for (let i = 0; i < n; i++) { out.unshift({ start: w, n: 0 }); const d = new Date(w); d.setDate(d.getDate() - 7); w = d.getTime(); }
  for (const r of rows) {
    if (!r.created) continue;
    const m = monday(r.created), slot = out.find(s => s.start === m);
    if (slot) slot.n++;
  }
  return out;
}

/** Eventos por día en los últimos `n` días a partir de `activity` (sumas, conexiones, reacciones). */
export function dailyEvents(activity, now, n = 30) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push({ start: dayBack(now, i), adds: 0, syncs: 0, reactions: 0, undos: 0 });
  const index = new Map(days.map((d, i) => [d.start, i]));
  for (const a of activity) {
    const ts = tsMs(a.ts); if (!ts) continue;
    const i = index.get(startOfDay(ts)); if (i == null) continue;
    const d = days[i];
    if (a.kind === "sync") d.syncs++; else if (a.kind === "undo") d.undos++; else if (a.kind === "add" || !a.kind) d.adds++;
    d.reactions += sum(Object.values(a.reactions || {}).map(v => Array.isArray(v) ? v.length : 0));
  }
  return days;
}

const SIZE_BUCKETS = [["2", 2, 2], ["3", 3, 3], ["4-5", 4, 5], ["6-10", 6, 10], ["11+", 11, Infinity]];

/** TODAS las estadísticas del Resumen. `data` = { users, groups, friendships, reports, activity, privateById }. */
export function computeStats(data, now = Date.now()) {
  const { groups = [], friendships = [], reports = [], activity = [] } = data;
  const rows = userRows(data, now);
  const n = rows.length;
  const year = new Date(now).getFullYear(), curMonth = monthKey(now);
  const act = activityBuckets(rows, now);

  // cacas (de los contadores de cada usuario)
  const months = lastMonths(now).map(m => ({ ...m, n: sum(rows.map(r => r.u.countsByMonth?.[m.key] || 0)) }));
  const hours = Array.from({ length: 24 }, (_, h) => sum(rows.map(r => r.u.byHour?.[h] || 0)));
  const weekdays = Array.from({ length: 7 }, (_, d) => sum(rows.map(r => r.u.byWeekday?.[d] || 0)));
  const cacas = {
    total: sum(rows.map(r => r.total)), year: sum(rows.map(r => r.year)),
    month: months[months.length - 1]?.n ?? sum(rows.map(r => r.u.countsByMonth?.[curMonth] || 0)),
    months, hours, weekdays,
  };
  const daily = dailyEvents(activity, now, 30);
  cacas.today = daily[daily.length - 1]?.adds ?? 0;

  // amistades y grupos
  const accepted = friendships.filter(f => f.status === "accepted"), pending = friendships.filter(f => f.status !== "accepted");
  const sizes = SIZE_BUCKETS.map(([label, lo, hi]) => ({ label, n: groups.filter(g => (g.members || []).length >= lo && (g.members || []).length <= hi).length }));
  const memberSum = sum(groups.map(g => (g.members || []).length));
  const byId = new Map(rows.map(r => [r.id, r]));
  const groupRows = groups.map(g => {
    const mem = (g.members || []).map(id => byId.get(id)).filter(Boolean);
    return {
      id: g.id, g, name: g.name || "?", members: g.members || [], size: (g.members || []).length, code: g.inviteCode || "",
      createdBy: g.createdBy || "", created: tsMs(g.createdAt),
      year: sum(mem.map(r => r.year)), total: sum(mem.map(r => r.total)),
      lastActive: Math.max(0, ...mem.map(r => r.last)),
      activeMembers: mem.filter(r => r.last && r.last >= dayBack(now, 6)).length,
    };
  });

  // dispositivos y adopción
  const dev = { native: 0, web: 0, both: 0, none: 0 };
  for (const r of rows) dev[r.device.kind]++;
  const platforms = {};
  for (const r of rows) { const p = r.device.platform || "—"; platforms[p] = (platforms[p] || 0) + 1; }
  const adoption = {
    notif: rows.filter(r => r.notifOn).length, geo: rows.filter(r => r.geo).length, shareMap: rows.filter(r => r.shareMap).length,
    bristol: rows.filter(r => r.bristol).length, installed: rows.filter(r => r.device.standalone).length, terms: rows.filter(r => r.termsOk).length,
    withTokens: rows.filter(r => r.device.kind !== "none").length,
  };

  // retención aproximada: de quienes se registraron hace 7 días o más, cuántos siguen activos en la última semana
  const old = rows.filter(r => r.daysSinceJoin != null && r.daysSinceJoin >= 7);
  const retained = old.filter(r => r.last && r.last >= dayBack(now, 6)).length;

  const open = reports.filter(r => r.status === "open");
  return {
    now, n, rows, groupRows,
    users: { n, suspended: rows.filter(r => r.suspended).length, ...act, new7: rows.filter(r => r.created && r.created >= dayBack(now, 6)).length, new30: rows.filter(r => r.created && r.created >= dayBack(now, 29)).length,
      weekly: weeklySignups(rows, now), retention: { base: old.length, kept: retained, pct: pct(retained, old.length) } },
    cacas, daily,
    social: { friendships: accepted.length, pending: pending.length, avgFriends: n ? +(2 * accepted.length / n).toFixed(1) : 0,
      noFriends: rows.filter(r => !r.friends.length).length, groups: groups.length, avgGroupSize: groups.length ? +(memberSum / groups.length).toFixed(1) : 0, sizes,
      noGroup: rows.filter(r => !r.groups.length).length },
    devices: dev, platforms, adoption,
    tops: {
      year: [...rows].sort((a, b) => b.year - a.year).slice(0, 10).filter(r => r.year > 0),
      streak: [...rows].sort((a, b) => b.streak - a.streak).slice(0, 5).filter(r => r.streak > 0),
      best: [...rows].sort((a, b) => b.best - a.best).slice(0, 5).filter(r => r.best > 0),
      groups: [...groupRows].sort((a, b) => b.year - a.year).slice(0, 5).filter(g => g.year > 0),
    },
    queue: queueHealth(data.queue, now),
    reports: { open: open.length, total: reports.length, dismissed: reports.filter(r => r.status === "dismissed").length, resolved: reports.filter(r => r.status === "resolved").length },
    year, pct,
  };
}

/** El listado de usuarios, filtrado y ordenado. filters: all | active7 | dormant | never | notif | native | web | webcaca | webseen | iosnoapp | nofriends | suspended. */
export function filterUsers(rows, { q = "", filter = "all", sort = "recent", dir = -1 } = {}, now = Date.now()) {
  const s = q.trim().toLowerCase();
  const keep = {
    all: () => true,
    active7: r => r.last && r.last >= dayBack(now, 6),
    dormant: r => r.last && r.last < dayBack(now, 13),
    never: r => !r.total,
    notif: r => r.notifOn,
    native: r => r.device.native,
    web: r => r.device.web,
    webcaca: r => r.webCaca && r.webCaca >= dayBack(now, 29),     // ha sumado desde la web en los últimos 30 días
    webseen: r => r.webSeen && r.webSeen >= dayBack(now, 29),     // ha entrado en la web en los últimos 30 días
    iosnoapp: r => r.device.platform === "iOS" && !r.device.native, // usó la web en iPhone y no hay señal de la app nativa (avisos o versión)
    nofriends: r => !r.friends.length,
    suspended: r => r.suspended,
  }[filter] || (() => true);
  const val = {
    name: r => r.name.toLowerCase(), joined: r => r.created, recent: r => r.last, year: r => r.year, total: r => r.total,
    streak: r => r.streak, friends: r => r.friends.length, groups: r => r.groups.length,
  }[sort] || (r => r.last);
  return rows
    .filter(r => keep(r) && (!s || r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s)))
    .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}

/** CSV de los usuarios (para abrir en una hoja de cálculo). */
export function usersCsv(rows) {
  const esc = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const d = ms => ms ? new Date(ms).toISOString().slice(0, 10) : "";
  const head = ["id", "nombre", "email", "alta", "ultima_caca", "cacas_año", "cacas_total", "racha", "record", "amigos", "grupos", "dispositivo", "plataforma", "avisos", "ubicacion", "mapa_compartido", "bristol", "condiciones", "suspendida"];
  const lines = rows.map(r => [r.id, r.name, r.email, d(r.created), d(r.last), r.year, r.total, r.streak, r.best, r.friends.length, r.groups.length,
    r.device.kind, r.device.platform || "", r.notifOn ? 1 : 0, r.geo ? 1 : 0, r.shareMap ? 1 : 0, r.bristol ? 1 : 0, r.termsOk ? 1 : 0, r.suspended ? 1 : 0].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

/* ============================================================
   Crecimiento (resumen del panel): sale SOLO de la foto diaria `statsDaily` (cifras, sin nombres). Puro: se prueba en
   rules-tests/admin-stats.test.js.
   ============================================================ */
const WD_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const keyDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
/** 0 = lunes … 6 = domingo, del día AAAA-MM-DD. */
export const weekdayOfKey = k => (keyDate(k).getUTCDay() + 6) % 7;
const short = k => { const d = keyDate(k); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
const long = k => { const d = keyDate(k); return `${WD_SHORT[weekdayOfKey(k)]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const mondayOf = k => { const d = keyDate(k); d.setUTCDate(d.getUTCDate() - weekdayOfKey(k)); return d.toISOString().slice(0, 10); };
const pctOf = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const sumOf = a => a.reduce((x, y) => x + (y || 0), 0);

/** Agrupa días en cubos (día o semana). Para flujos se suma; para existencias, el último valor; para medias, la media. */
function bucketize(days, by) {
  if (by === "day") return days.map(d => ({ key: d.day, x: short(d.day), xFull: long(d.day) + (d.parcial ? " (hoy, en curso)" : ""), days: [d] }));
  const m = new Map();
  for (const d of days) { const k = mondayOf(d.day); (m.get(k) || m.set(k, []).get(k)).push(d); }
  return [...m].map(([k, ds]) => ({ key: k, x: short(k), xFull: `semana del ${long(k)}`, days: ds }));
}

/** Todo lo que pinta el resumen para un rango (`range` en días, o 0 = todo). */
export function growth(all, { range = 90 } = {}) {
  const days = (all || []).filter(d => d && d.day).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!days.length) return null;
  const cur = range ? days.slice(-range) : days;
  const prev = range ? days.slice(-2 * range, -range) : [];
  const by = cur.length > 120 ? "week" : "day";
  // el día de hoy va por la mitad: fuera de las gráficas (hundiría el final de las líneas); sí cuenta en las cifras de arriba
  const B = bucketize(cur.filter(d => !d.parcial), by);
  const last = arr => arr[arr.length - 1];
  const flow = f => B.map(b => sumOf(b.days.map(f)));
  const stock = f => B.map(b => { const v = last(b.days.filter(d => f(d) != null)); return v ? f(v) : null; });
  const avg = f => B.map(b => { const vs = b.days.map(f).filter(v => v != null); return vs.length ? sumOf(vs) / vs.length : null; });
  const x = B.map(b => b.x), xFull = B.map(b => b.xFull);

  const cacas = flow(d => d.cacas?.total);
  const ma = cacas.map((_, i) => (i >= 6 ? sumOf(cacas.slice(i - 6, i + 1)) / 7 : null));
  const dau = avg(d => d.activos?.dia);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0)), hours = Array(24).fill(0), wdN = Array(7).fill(0), wdSum = Array(7).fill(0);
  for (const d of cur) {
    const w = weekdayOfKey(d.day); wdN[w]++; wdSum[w] += d.cacas?.total || 0;
    (d.cacas?.porHora || []).forEach((v, h) => { heat[w][h] += v || 0; hours[h] += v || 0; });
  }
  // avisos por tipo: los 6 con más envíos y el resto en «otros» (nunca un color generado)
  const tipos = {}; cur.forEach(d => Object.entries(d.avisos || {}).forEach(([t, n]) => { tipos[t] = (tipos[t] || 0) + n; }));
  const top = Object.entries(tipos).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const shown = top.slice(0, 6), rest = top.slice(6);
  const avisos = [...shown.map(t => ({ name: t, values: flow(d => d.avisos?.[t]) })), ...(rest.length ? [{ name: "otros", values: flow(d => sumOf(rest.map(t => d.avisos?.[t]))) }] : [])];
  const recs = {}; cur.forEach(d => Object.entries(d.recordatorios || {}).forEach(([t, r]) => { const a = (recs[t] ??= { enviados: 0, apuntaronDespues: 0 }); a.enviados += r.enviados || 0; a.apuntaronDespues += r.apuntaronDespues || 0; }));

  const lastDay = last(days), firstReal = days.find(d => !d.estimado);
  const nuevos = sumOf(cur.map(d => d.usuarios?.nuevos)), nuevosPrev = sumOf(prev.map(d => d.usuarios?.nuevos));
  const cacasCur = sumOf(cur.map(d => d.cacas?.total)), cacasPrev = sumOf(prev.map(d => d.cacas?.total));
  const dauAvg = cur.length ? sumOf(cur.map(d => d.activos?.dia)) / cur.length : 0, dauPrev = prev.length ? sumOf(prev.map(d => d.activos?.dia)) / prev.length : null;
  const change = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  return {
    by, x, xFull, range, desde: cur[0].day, hasta: lastDay.day, parcialHoy: !!lastDay.parcial, datosReales: firstReal?.day || null,
    tiles: {
      usuarios: lastDay.usuarios?.total ?? null, nuevos, nuevosCambio: prev.length ? change(nuevos, nuevosPrev) : null,
      bajas: sumOf(cur.map(d => d.usuarios?.bajas)), hayBajas: cur.some(d => d.usuarios?.bajas != null),
      activosHoy: lastDay.activos?.dia ?? null, activosSemana: last(days.filter(d => d.activos?.semana != null))?.activos.semana ?? null,
      activosMes: last(days.filter(d => d.activos?.mes != null))?.activos.mes ?? null,
      dauMedia: Math.round(dauAvg * 10) / 10, dauCambio: dauPrev != null ? change(dauAvg, dauPrev) : null,
      cacas: cacasCur, cacasCambio: prev.length ? change(cacasCur, cacasPrev) : null, cacasHoy: lastDay.cacas?.total ?? 0,
      porActivo: lastDay.cacas?.porActivo ?? null, sinCacas: last(days.filter(d => d.usuarios?.sinCacas != null))?.usuarios.sinCacas ?? null,
    },
    usuarios: stock(d => d.usuarios?.total), nuevosSerie: flow(d => d.usuarios?.nuevos), bajasSerie: flow(d => d.usuarios?.bajas),
    activos: { dia: dau, semana: stock(d => d.activos?.semana), mes: stock(d => d.activos?.mes) },
    fidelidad: B.map(b => { const v = last(b.days.filter(d => d.activos?.mes)); return v ? pctOf(v.activos.dia, v.activos.mes) : null; }),
    cacas, ma, porActivo: avg(d => d.cacas?.porActivo),
    olvidadas: B.map(b => pctOf(sumOf(b.days.map(d => d.cacas?.olvidadas)), sumOf(b.days.map(d => d.cacas?.total)))),
    ubicacion: B.map(b => pctOf(sumOf(b.days.map(d => d.cacas?.conUbicacion)), sumOf(b.days.map(d => d.cacas?.total)))),
    origen: { app: flow(d => d.cacas?.app), web: flow(d => d.cacas?.web) },
    plataformas: ["iphone", "android", "nativaSinVersion", "webConAvisos", "webAbierta30d"].map(k => ({ key: k, values: stock(d => d.plataformas?.[k]) })),
    amistades: stock(d => d.social?.amistades), grupos: stock(d => d.social?.grupos), mensajes: flow(d => d.social?.mensajes),
    avisos, recordatorios: recs,
    heat, hours, weekdays: wdSum.map((s, i) => (wdN[i] ? Math.round((s / wdN[i]) * 10) / 10 : 0)),
  };
}

/** CSV de la foto diaria (una fila por día; para hojas de cálculo). */
export function statsCsv(all) {
  const cols = [["día", d => d.day], ["estimado", d => (d.estimado ? "sí" : "")], ["usuarios", d => d.usuarios?.total], ["altas", d => d.usuarios?.nuevos], ["bajas", d => d.usuarios?.bajas],
    ["activos día", d => d.activos?.dia], ["activos semana", d => d.activos?.semana], ["activos mes", d => d.activos?.mes], ["cacas", d => d.cacas?.total],
    ["olvidadas", d => d.cacas?.olvidadas], ["con ubicación", d => d.cacas?.conUbicacion], ["desde la web", d => d.cacas?.web], ["amistades", d => d.social?.amistades],
    ["grupos", d => d.social?.grupos], ["mensajes", d => d.social?.mensajes]];
  return [cols.map(c => c[0]).join(";"), ...(all || []).map(d => cols.map(c => c[1](d) ?? "").join(";"))].join("\n");
}
