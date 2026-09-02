#!/usr/bin/env node
/*
 * IMPORT PUNTUAL Y EXCEPCIONAL — histórico de cacas de Lorena Terán (registro
 * manual en Telegram durante 2026). ESTO NO ES PARTE DE LA APP: es un backfill
 * de una sola vez. Bórralo del repo cuando termines.
 *
 * Requisitos:
 *   - Node 18+
 *   - Una clave de cuenta de servicio del proyecto Firebase:
 *       Firebase Console → Configuración del proyecto → Cuentas de servicio →
 *       "Generar nueva clave privada" → guarda el JSON (NO lo subas al repo).
 *
 * Uso:
 *   npm i firebase-admin
 *   node tools/import-lorena.cjs ./serviceAccount.json --dry-run   # solo muestra, NO escribe
 *   node tools/import-lorena.cjs ./serviceAccount.json             # ejecuta (idempotente)
 *
 * Qué hace:
 *   1) Busca a la usuaria por email → uid.
 *   2) Inserta 207 cacas en users/{uid}/cacas con su ts histórico, source:"import"
 *      e id determinista ("import_<ts>") → re-ejecutar NO duplica. Sin lat/lng ni
 *      bristol. NO crea eventos en `activity` (no inunda el feed de sus amigos).
 *   3) Recalcula los contadores del doc de usuario a partir de TODAS sus cacas
 *      (históricas + las que ya tenga en la app), en zona horaria Europe/Madrid,
 *      igual que hace la app. No toca sus cacas nuevas ni otros campos del perfil.
 *
 * Idempotente: puedes correrlo las veces que quieras; el resultado es el mismo.
 */
"use strict";
const admin = require("firebase-admin");
const path = require("path");

const EMAIL   = "lorenaiish.lt@gmail.com";
const TZ      = "Europe/Madrid";
const STATS_V = 2;               // debe coincidir con store.js (STATS_V)

// 207 timestamps (epoch ms) extraídos del export de Telegram (1 ene → 27 ago 2026),
// contando los dos 💩 iniciales + los 205 mensajes numerados (respeta su número: 207).
const TS = [1767271902000,1767358257000,1767376303000,1767439118000,1767523235000,1767621092000,1767699213000,1767788289000,1767863455000,1767952272000,1768038914000,1768131110000,1768205557000,1768208046000,1768295059000,1768384047000,1768466480000,1768492794000,1768497271000,1768552974000,1768633219000,1768742683000,1768811002000,1768893252000,1768985742000,1769069862000,1769073124000,1769153889000,1769246381000,1769340602000,1769415600000,1769590588000,1769669945000,1769764336000,1769771682000,1769855888000,1769942705000,1770022172000,1770104364000,1770196889000,1770281860000,1770368846000,1770885733000,1770975582000,1771057036000,1771063697000,1771153115000,1771234948000,1771405198000,1771492072000,1771580380000,1771674519000,1771838862000,1772008210000,1772096693000,1772183990000,1772266981000,1772701608000,1772701610000,1772701615000,1772701618000,1772787995000,1772873850000,1772972784000,1772972924000,1772998407000,1773216579000,1773267721000,1773387120000,1773507884000,1773654324000,1773915467000,1773915469000,1773997314000,1774255012000,1774268997000,1774269003000,1774428605000,1774516040000,1775214579000,1775303061000,1775466185000,1775466187000,1775553701000,1775639712000,1775658745000,1775720857000,1775814133000,1775907389000,1775907394000,1776150700000,1776241033000,1776244384000,1776329030000,1776357368000,1776412712000,1776505242000,1776673464000,1776755324000,1777041206000,1777287110000,1777287113000,1777455002000,1777628982000,1777628984000,1777724449000,1777801884000,1777887644000,1778054655000,1778054656000,1778141141000,1778233398000,1778348450000,1778578194000,1778662897000,1778748288000,1778751536000,1778834040000,1779092924000,1779356298000,1779376219000,1779439256000,1779697008000,1779783800000,1779788349000,1780042487000,1780132166000,1780138486000,1780302543000,1780307129000,1780392864000,1780476047000,1780561461000,1780651066000,1780659522000,1780683330000,1780737658000,1780829886000,1780847588000,1780909485000,1780998739000,1781081743000,1781168799000,1781257887000,1781517646000,1781685619000,1781685622000,1782036802000,1782121548000,1782382897000,1782382901000,1782382908000,1782382910000,1782461129000,1782461130000,1782488359000,1782662410000,1782741169000,1782741171000,1783007411000,1783075665000,1783099882000,1783242992000,1783512457000,1783670694000,1784196279000,1784196281000,1784196283000,1784196285000,1784196287000,1784280459000,1784374281000,1784476224000,1784544483000,1784660194000,1784712784000,1784712786000,1784803946000,1784978906000,1784978908000,1785318997000,1785319000000,1785319001000,1785319003000,1785496622000,1785496624000,1785585963000,1785684629000,1785920923000,1786014972000,1786101022000,1786187094000,1786273644000,1786492104000,1786492107000,1786531205000,1786784335000,1786784336000,1787134043000,1787134046000,1787134048000,1787139453000,1787252361000,1787252362000,1787734437000,1787823497000,1787864149000];

// ── args ────────────────────────────────────────────────────────────────────
//   node tools/import-lorena.cjs ./serviceAccount.json [--dry-run]
//     → autenticación con clave de cuenta de servicio (máquina propia / Docker).
//   node tools/import-lorena.cjs --project=<projectId> [--uid=<uid>] [--dry-run]
//     → autenticación con tu identidad de Google (Google Cloud Shell, SIN clave).
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const projectArg = (args.find(a => a.startsWith("--project=")) || "").split("=")[1];
const uidArg = (args.find(a => a.startsWith("--uid=")) || "").split("=")[1];
const saPath = args.find(a => !a.startsWith("--"));

if (saPath) {
  // Opción A: fichero de clave de cuenta de servicio.
  admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(saPath))) });
} else {
  // Opción B: Application Default Credentials (p.ej. Google Cloud Shell) — sin clave.
  const projectId = projectArg || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) {
    console.error("Sin credenciales. Usa una de estas dos formas:\n" +
      "  node tools/import-lorena.cjs ./serviceAccount.json [--dry-run]\n" +
      "  node tools/import-lorena.cjs --project=<projectId> [--uid=<uid>] [--dry-run]   (Cloud Shell)");
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
}
const db = admin.firestore();

// ── fecha en Europe/Madrid (equivale a lo que graba su móvil: getHours/getDay locales) ──
const _fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
});
const _WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };  // (getDay()+6)%7 → lunes=0
function parts(ts) {
  const p = {};
  for (const x of _fmt.formatToParts(new Date(ts))) p[x.type] = x.value;
  const year = +p.year, month0 = (+p.month) - 1, day = +p.day, hour = +p.hour, weekday = _WD[p.weekday];
  return { year, month0, day, hour, weekday, dayNum: Math.floor(Date.UTC(year, month0, day) / 86400000) };
}
const yearNow = () => new Date().getFullYear();

(async () => {
  // 1) uid: por --uid=... (del panel de admin) o buscándolo por email
  let uid = uidArg;
  if (!uid) {
    try { uid = (await admin.auth().getUserByEmail(EMAIL)).uid; }
    catch (e) { console.error("No pude resolver el uid por email (" + EMAIL + "):", e.message,
      "\nPásalo a mano con --uid=<uid> (lo tienes en el panel de admin de la app)."); process.exit(1); }
  }
  console.log("Usuaria:", EMAIL, "→ uid", uid, dryRun ? "  (DRY-RUN, no se escribe nada)" : "");

  const cacasCol = db.collection("users").doc(uid).collection("cacas");

  // Lee lo que ya tiene (para no perder sus cacas de la app y para el recompute).
  const snap = await cacasCol.get();
  const existing = snap.docs.map(d => d.data()).filter(c => c && Number.isFinite(c.ts));
  const appTs = existing.filter(c => !c.imported && c.source !== "import").map(c => c.ts);
  console.log(`Cacas actuales en BD: ${existing.length}  (de la app: ${appTs.length}, importadas previas: ${existing.length - appTs.length})`);

  // 2) insertar las 207 históricas (id determinista → idempotente)
  if (dryRun) {
    console.log(`[dry-run] Se insertarían/actualizarían ${TS.length} cacas históricas (ids import_<ts>).`);
  } else {
    const CHUNK = 400;
    for (let i = 0; i < TS.length; i += CHUNK) {
      const batch = db.batch();
      for (const ts of TS.slice(i, i + CHUNK)) {
        batch.set(cacasCol.doc("import_" + ts), {
          uid, ts, tz: TZ, source: "import", imported: true, year: parts(ts).year,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
    }
    console.log(`Insertadas/actualizadas ${TS.length} cacas históricas.`);
  }

  // 3) recompute de contadores desde (cacas de la app) + (histórico). Estable e idempotente.
  const allTs = [...appTs, ...TS];
  const countsByYear = {}, countsByMonth = {}, byHour = {}, byWeekday = {};
  const daySet = new Set();
  let lifetime = 0, totalCurYear = 0, first = Infinity, last = 0;
  const Y = yearNow();
  for (const ts of allTs) {
    const p = parts(ts);
    lifetime++;
    countsByYear[p.year] = (countsByYear[p.year] || 0) + 1;
    if (p.year === Y) totalCurYear++;
    const mk = `${p.year}_${p.month0}`;
    countsByMonth[mk] = (countsByMonth[mk] || 0) + 1;
    byHour[p.hour] = (byHour[p.hour] || 0) + 1;
    byWeekday[p.weekday] = (byWeekday[p.weekday] || 0) + 1;
    daySet.add(p.dayNum);
    if (ts < first) first = ts;
    if (ts > last) last = ts;
  }
  const days = [...daySet].sort((a, b) => a - b);
  let longest = days.length ? 1 : 0, run = days.length ? 1 : 0;
  for (let i = 1; i < days.length; i++) { if (days[i] - days[i - 1] === 1) { run++; if (run > longest) longest = run; } else run = 1; }
  let current = days.length ? 1 : 0;
  for (let i = days.length - 1; i > 0; i--) { if (days[i] - days[i - 1] === 1) current++; else break; }

  const update = {
    totalCount: totalCurYear, lifetimeCount: lifetime,
    countsByYear, countsByMonth, byHour, byWeekday,
    statsV: STATS_V,
    firstCacaTs: first === Infinity ? 0 : first, lastCacaTs: last,
    currentStreak: current, longestStreak: longest,
  };

  console.log("\n── Contadores recalculados ──");
  console.log("  lifetimeCount :", update.lifetimeCount, "  (app:", appTs.length, "+ histórico:", TS.length, ")");
  console.log("  totalCount(", Y, "):", update.totalCount);
  console.log("  longestStreak :", update.longestStreak, " currentStreak:", update.currentStreak);
  console.log("  firstCacaTs   :", new Date(update.firstCacaTs).toISOString());
  console.log("  lastCacaTs    :", new Date(update.lastCacaTs).toISOString());
  console.log("  countsByYear  :", JSON.stringify(update.countsByYear));
  console.log("  countsByMonth :", JSON.stringify(update.countsByMonth));

  if (dryRun) {
    console.log("\n[dry-run] NO se ha escrito nada. Quita --dry-run para aplicar.");
  } else {
    await db.collection("users").doc(uid).update(update);
    console.log("\nDoc de usuaria actualizado ✅");
  }
  console.log("Hecho.");
  process.exit(0);
})().catch(e => { console.error("ERROR:", e); process.exit(1); });
