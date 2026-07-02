/**
 * migrate_antonio.js — Importa los 638 timestamps de pappalardo95
 * a Firestore (la app PWA), borrando primero todos sus datos actuales.
 *
 * Uso (dentro del contenedor docker node):
 *   node migrate_antonio.js --dry       # solo muestra lo que haría
 *   node migrate_antonio.js             # ejecuta la migración real
 *
 * Requiere: serviceAccount.json en /work (raíz del proyecto)
 */

"use strict";

const admin = require("firebase-admin");
const path  = require("path");
const fs    = require("fs");

// ── Config ────────────────────────────────────────────────────────────────────
const ANTONIO_EMAIL  = "antonio95pappalardo@gmail.com";
const FIXED_JSON     = path.join(__dirname, "fixed_antonio.json");
const SERVICE_ACCT   = path.join("/work", "push-sender", "serviceAccount.json");
const TZ             = "Europe/Madrid";
const DRY            = process.argv.includes("--dry");
const BATCH_SIZE     = 490;  // Firestore max 500 ops/batch, dejamos margen
const YEAR_NOW       = new Date().getFullYear();

// ── Init Firebase ─────────────────────────────────────────────────────────────
if (!fs.existsSync(SERVICE_ACCT)) {
  console.error(`ERROR: no se encuentra ${SERVICE_ACCT}`);
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCT)),
});
const db   = admin.firestore();
const auth = admin.auth();

// ── Helpers ───────────────────────────────────────────────────────────────────
const monthKey = ts => {
  const d = new Date(ts);
  return `${d.getFullYear()}_${d.getMonth()}`;   // igual que store.js (getMonth = 0-based)
};
const dayFloor = ts => {
  const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime();
};
const DAY_MS = 86_400_000;

function computeStats(timestamps) {
  // timestamps: array de números ms, YA ORDENADOS asc
  const sorted = [...timestamps].sort((a,b) => a-b);

  let totalCount    = 0;
  let lifetimeCount = sorted.length;
  const countsByYear  = {};
  const countsByMonth = {};

  for (const ts of sorted) {
    const y = new Date(ts).getFullYear();
    countsByYear[y]  = (countsByYear[y]  || 0) + 1;
    const mk = monthKey(ts);
    countsByMonth[mk] = (countsByMonth[mk] || 0) + 1;
    if (y === YEAR_NOW) totalCount++;
  }

  // Streak: días consecutivos con al menos 1 caca (calendario local JS)
  const days = [...new Set(sorted.map(dayFloor))].sort((a,b)=>a-b);
  let currentStreak = 0, longestStreak = 0, streak = 0;
  for (let i = 0; i < days.length; i++) {
    if (i === 0 || days[i] - days[i-1] === DAY_MS) {
      streak++;
    } else {
      streak = 1;
    }
    longestStreak = Math.max(longestStreak, streak);
  }
  // currentStreak: ¿llegó hasta hoy o ayer?
  const todayFloor = dayFloor(Date.now());
  const lastDay    = days[days.length - 1];
  if (lastDay === todayFloor || lastDay === todayFloor - DAY_MS) {
    currentStreak = streak;
  } else {
    currentStreak = 0;
  }

  return {
    totalCount,
    lifetimeCount,
    countsByYear,
    countsByMonth,
    firstCacaTs: sorted[0],
    lastCacaTs:  sorted[sorted.length - 1],
    currentStreak,
    longestStreak,
    tz: TZ,
  };
}

async function deleteCollection(ref, batchSize = BATCH_SIZE) {
  let deleted = 0;
  for (;;) {
    const snap = await ref.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (!DRY) await batch.commit();
    deleted += snap.size;
    console.log(`  borrados ${deleted} docs…`);
    if (snap.size < batchSize) break;
  }
  return deleted;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (DRY) console.log("═══ MODO DRY-RUN (no se escribe nada) ═══\n");

  // 1. Encontrar UID por email
  console.log(`Buscando usuario: ${ANTONIO_EMAIL}`);
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(ANTONIO_EMAIL);
  } catch (e) {
    console.error("ERROR: usuario no encontrado en Firebase Auth:", e.message);
    process.exit(1);
  }
  const uid = userRecord.uid;
  console.log(`✓ UID encontrado: ${uid}\n`);

  // 2. Cargar timestamps del fixed_antonio.json
  const botDb   = JSON.parse(fs.readFileSync(FIXED_JSON, "utf8"));
  const antStats = botDb.users["-353783471"].stats["pappalardo95"];
  const timestamps = antStats.dates;   // 638 números ms
  console.log(`Timestamps a importar: ${timestamps.length}`);

  // 3. Mostrar resumen de stats calculados
  const stats = computeStats(timestamps);
  console.log("\n── Stats calculados ───────────────────────────────────────────");
  console.log(`  lifetimeCount : ${stats.lifetimeCount}`);
  console.log(`  totalCount    : ${stats.totalCount}  (${YEAR_NOW})`);
  console.log(`  countsByYear  : ${JSON.stringify(stats.countsByYear)}`);
  console.log(`  firstCacaTs   : ${new Date(stats.firstCacaTs).toISOString()}`);
  console.log(`  lastCacaTs    : ${new Date(stats.lastCacaTs).toISOString()}`);
  console.log(`  currentStreak : ${stats.currentStreak}`);
  console.log(`  longestStreak : ${stats.longestStreak}`);
  console.log(`  countsByMonth entries: ${Object.keys(stats.countsByMonth).length}`);
  console.log("───────────────────────────────────────────────────────────────\n");

  if (DRY) {
    console.log("[dry] Se borrarían cacas y actividad de", uid);
    console.log(`[dry] Se insertarían ${timestamps.length} docs en users/${uid}/cacas`);
    console.log("[dry] Se actualizaría users/${uid} con los stats de arriba");
    return;
  }

  // 4. Borrar cacas existentes
  console.log("Borrando cacas existentes…");
  const nCacas = await deleteCollection(db.collection("users").doc(uid).collection("cacas"));
  console.log(`  ✓ ${nCacas} cacas borradas`);

  // 5. Borrar actividad existente del usuario
  console.log("Borrando actividad existente…");
  const nAct = await deleteCollection(
    db.collection("activity").where("uid", "==", uid)
  );
  console.log(`  ✓ ${nAct} docs de actividad borrados`);

  // 6. Resetear stats del usuario
  console.log("Reseteando stats del usuario…");
  await db.collection("users").doc(uid).update({
    totalCount: 0, lifetimeCount: 0, countsByYear: {}, countsByMonth: {},
    lastCacaTs: 0, currentStreak: 0, longestStreak: 0, firstCacaTs: 0,
  });
  console.log("  ✓ stats reseteados");

  // 7. Insertar todos los timestamps en lotes
  console.log(`\nInsertando ${timestamps.length} cacas en lotes de ${BATCH_SIZE}…`);
  const sorted = [...timestamps].sort((a,b) => a-b);
  let inserted = 0;
  for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
    const chunk = sorted.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const ts of chunk) {
      const y = new Date(ts).getFullYear();
      const ref = db.collection("users").doc(uid).collection("cacas").doc();
      batch.set(ref, {
        uid,
        ts,
        tz: TZ,
        source: "import",
        year: y,
        late: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    inserted += chunk.length;
    console.log(`  ${inserted}/${sorted.length} cacas insertadas`);
  }
  console.log("  ✓ todas las cacas insertadas");

  // 8. Actualizar stats finales del usuario
  console.log("\nActualizando stats del usuario…");
  await db.collection("users").doc(uid).update({
    totalCount:    stats.totalCount,
    lifetimeCount: stats.lifetimeCount,
    countsByYear:  stats.countsByYear,
    countsByMonth: stats.countsByMonth,
    firstCacaTs:   stats.firstCacaTs,
    lastCacaTs:    stats.lastCacaTs,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    tz: TZ,
  });
  console.log("  ✓ stats actualizados");

  console.log("\n✅ MIGRACIÓN COMPLETADA");
  console.log(`   ${timestamps.length} cacas importadas para ${ANTONIO_EMAIL} (${uid})`);
})().catch(e => { console.error("ERROR:", e); process.exit(1); });
