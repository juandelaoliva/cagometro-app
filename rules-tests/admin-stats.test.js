// Pruebas de la lógica del panel de administración (admin-stats.js): pura, no necesita emuladores.
//   node --test admin-stats.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeStats, userRows, filterUsers, usersCsv, dailyEvents, lastMonths, monthKey, tsMs, deviceOf, DAY } from "../admin-stats.js";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();            // miércoles 4 de noviembre de 2026
const at = (daysAgo, h = 12) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); d.setHours(h, 0, 0, 0); return d.getTime(); };
const ts = ms => ({ toMillis: () => ms });                      // como un Timestamp de Firestore

const users = [
  { id: "a", displayName: "Ana", email: "ana@x.com", createdAt: ts(at(40)), lastCacaTs: ts(at(0)), lifetimeCount: 120, countsByYear: { 2026: 100, 2025: 20 },
    countsByMonth: { "2026_10": 9, "2026_9": 40 }, byHour: { 8: 60, 9: 60 }, byWeekday: { 0: 70, 1: 50 }, currentStreak: 12, longestStreak: 30,
    notifications: true, locationMode: "choose", bristolMode: true, platform: "iOS", standalone: true, termsVersion: 1 },
  { id: "b", displayName: "Beto", email: "beto@x.com", createdAt: ts(at(20)), lastCacaTs: ts(at(3)), lifetimeCount: 30, countsByYear: { 2026: 30 },
    countsByMonth: { "2026_10": 3, "2026_9": 20 }, byHour: { 8: 10 }, byWeekday: { 2: 30 }, currentStreak: 0, longestStreak: 5, shareMap: false },
  { id: "c", displayName: "Cris", email: "cris@x.com", createdAt: ts(at(30)), lastCacaTs: ts(at(20)), lifetimeCount: 5, countsByYear: { 2026: 5 }, countsByMonth: { "2026_9": 5 }, byHour: {}, byWeekday: {} },
  { id: "d", displayName: "Dani", email: "dani@x.com", createdAt: ts(at(2)), lifetimeCount: 0 },
];
const groups = [
  { id: "g1", name: "Oficina", members: ["a", "b", "c"], inviteCode: "ABC", createdBy: "a" },
  { id: "g2", name: "Dúo", members: ["a", "b"], inviteCode: "XYZ", createdBy: "b" },
];
const friendships = [
  { id: "a_b", uids: ["a", "b"], status: "accepted" }, { id: "a_c", uids: ["a", "c"], status: "accepted" }, { id: "a_d", uids: ["a", "d"], status: "pending" },
];
const privateById = { a: { expoTokens: ["ExponentPushToken[x]"], tokens: ["web"] }, b: { tokens: ["w"] }, c: {} };
const activity = [
  { kind: "add", ts: ts(at(0)), reactions: { x: ["👍", "❤️"] } }, { kind: "add", ts: ts(at(0, 9)), reactions: {} }, { kind: "sync", ts: ts(at(1)), reactions: {} },
  { kind: "undo", ts: ts(at(1)) }, { kind: "add", ts: ts(at(45)) },                                    // fuera de los 30 días
];
const reports = [{ id: "r1", status: "open" }, { id: "r2", status: "dismissed" }, { id: "r3", status: "resolved" }];
const S = computeStats({ users, groups, friendships, reports, activity, privateById }, NOW);

describe("tiempos", () => {
  it("tsMs entiende Timestamps, números y {seconds}", () => {
    assert.equal(tsMs(ts(5)), 5); assert.equal(tsMs(7), 7); assert.equal(tsMs({ seconds: 2 }), 2000); assert.equal(tsMs(null), 0); assert.equal(tsMs(undefined), 0);
  });
  it("lastMonths termina en el mes actual y las claves son las de store.js", () => {
    const m = lastMonths(NOW); assert.equal(m.length, 12); assert.equal(m.at(-1).key, "2026_10"); assert.equal(m[0].key, "2025_11"); assert.equal(monthKey(NOW), "2026_10");
  });
});

describe("usuarios", () => {
  it("cuenta personas por tramo de actividad", () => {
    assert.equal(S.users.n, 4);
    assert.equal(S.users.today, 1);          // Ana
    assert.equal(S.users.d7, 2);             // Ana y Beto
    assert.equal(S.users.d30, 3);            // + Cris (hace 20 días)
    assert.equal(S.users.dormant, 1);        // Cris: ≥ 14 días sin sumar
    assert.equal(S.users.never, 1);          // Dani
  });
  it("altas de los últimos 7 y 30 días", () => { assert.equal(S.users.new7, 1); assert.equal(S.users.new30, 2); });   // Cris (hace 30 días) queda fuera: son 30 días naturales contando hoy
  it("altas por semana: 12 semanas y la suma cuadra con las altas dentro de la ventana", () => {
    assert.equal(S.users.weekly.length, 12);
    assert.equal(S.users.weekly.reduce((a, w) => a + w.n, 0), 4);
    assert.equal(S.users.weekly.at(-1).n, 1);       // Dani esta semana
  });
  it("retención: de los que llevan ≥ 7 días, cuántos siguen activos esta semana", () => {
    assert.deepEqual(S.users.retention, { base: 3, kept: 2, pct: 67 });
  });
});

describe("cacas", () => {
  it("totales, del año y del mes salen de los contadores", () => {
    assert.equal(S.cacas.total, 155); assert.equal(S.cacas.year, 135); assert.equal(S.cacas.month, 12);
  });
  it("serie mensual, por hora y por día de la semana", () => {
    assert.equal(S.cacas.months.at(-1).n, 12); assert.equal(S.cacas.months.at(-2).n, 65);
    assert.equal(S.cacas.hours[8], 70); assert.equal(S.cacas.hours[9], 60); assert.equal(S.cacas.hours.length, 24);
    assert.deepEqual(S.cacas.weekdays, [70, 50, 30, 0, 0, 0, 0]);
  });
  it("eventos diarios: 30 días, solo los de la ventana, con reacciones", () => {
    const d = dailyEvents(activity, NOW, 30);
    assert.equal(d.length, 30);
    assert.deepEqual([d.at(-1).adds, d.at(-1).reactions], [2, 2]);
    assert.deepEqual([d.at(-2).syncs, d.at(-2).undos], [1, 1]);
    assert.equal(d.reduce((a, x) => a + x.adds, 0), 2);                  // la de hace 45 días no entra
    assert.equal(S.cacas.today, 2);
  });
});

describe("social, dispositivos y adopción", () => {
  it("amistades y grupos", () => {
    assert.equal(S.social.friendships, 2); assert.equal(S.social.pending, 1); assert.equal(S.social.avgFriends, 1);
    assert.equal(S.social.groups, 2); assert.equal(S.social.avgGroupSize, 2.5);
    assert.deepEqual(S.social.sizes.map(x => x.n), [1, 1, 0, 0, 0]);
    assert.equal(S.social.noFriends, 1); assert.equal(S.social.noGroup, 1);
  });
  it("filas de grupo: cacas del año y miembros activos esta semana", () => {
    const g = S.groupRows.find(x => x.id === "g1");
    assert.equal(g.year, 135); assert.equal(g.activeMembers, 2); assert.equal(g.size, 3);
  });
  it("dispositivos: nativa, web, ambos y ninguno", () => {
    assert.deepEqual(S.devices, { native: 0, web: 1, both: 1, none: 2 });
    assert.deepEqual(deviceOf({ platform: "iOS" }, { expoTokens: ["x"] }), { native: true, web: false, kind: "native", platform: "iOS", standalone: false });
  });
  it("adopción de funciones", () => {
    assert.deepEqual([S.adoption.notif, S.adoption.geo, S.adoption.shareMap, S.adoption.bristol, S.adoption.installed, S.adoption.terms], [1, 1, 3, 1, 1, 1]);
  });
  it("clasificaciones", () => {
    assert.equal(S.tops.year[0].name, "Ana"); assert.equal(S.tops.streak[0].streak, 12); assert.equal(S.tops.best[0].best, 30); assert.equal(S.tops.groups[0].name, "Oficina");
  });
  it("denuncias", () => { assert.deepEqual(S.reports, { open: 1, total: 3, dismissed: 1, resolved: 1 }); });
});

describe("listado de usuarios", () => {
  const rows = userRows({ users, groups, friendships, privateById }, NOW);
  it("deriva amigos, grupos y días sin actividad", () => {
    const a = rows.find(r => r.id === "a");
    assert.equal(a.friends.length, 2); assert.equal(a.groups.length, 2); assert.equal(a.daysSinceLast, 0); assert.equal(rows.find(r => r.id === "d").daysSinceLast, null);
  });
  it("filtra por búsqueda y por tramo", () => {
    assert.deepEqual(filterUsers(rows, { q: "BETO" }, NOW).map(r => r.id), ["b"]);
    assert.deepEqual(filterUsers(rows, { filter: "dormant" }, NOW).map(r => r.id), ["c"]);
    assert.deepEqual(filterUsers(rows, { filter: "never" }, NOW).map(r => r.id), ["d"]);
    assert.deepEqual(filterUsers(rows, { filter: "native" }, NOW).map(r => r.id), ["a"]);
    assert.deepEqual(filterUsers(rows, { filter: "nofriends" }, NOW).map(r => r.id), ["d"]);
  });
  it("ordena en los dos sentidos", () => {
    assert.deepEqual(filterUsers(rows, { sort: "total", dir: -1 }, NOW).map(r => r.id), ["a", "b", "c", "d"]);
    assert.deepEqual(filterUsers(rows, { sort: "name", dir: 1 }, NOW).map(r => r.id), ["a", "b", "c", "d"]);
    assert.deepEqual(filterUsers(rows, { sort: "joined", dir: 1 }, NOW).map(r => r.id), ["a", "c", "b", "d"]);
  });
  it("el CSV escapa comas y comillas y lleva cabecera", () => {
    const r2 = userRows({ users: [{ id: "x", displayName: 'Ana, "la" 1', email: "x@x.com" }], privateById: {} }, NOW);
    const csv = usersCsv(r2).split("\n");
    assert.equal(csv.length, 2); assert.match(csv[0], /^id,nombre,email/); assert.ok(csv[1].includes('"Ana, ""la"" 1"'));
  });
  it("con datos vacíos no revienta", () => {
    const E = computeStats({}, NOW);
    assert.equal(E.n, 0); assert.equal(E.users.retention.pct, 0); assert.equal(E.social.avgGroupSize, 0); assert.equal(E.cacas.hours.length, 24);
  });
});
void DAY;
