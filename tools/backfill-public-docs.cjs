#!/usr/bin/env node
/* Prepara los datos EXISTENTES para las reglas endurecidas (firestore.rules.draft).
 *
 *   publicProfiles/{uid}   ← users/{uid}        (nombre, color, foto)
 *   userLookup/{email}     ← users/{uid}.email  (búsqueda de amigos por email)
 *   inviteCodes/{código}   ← groups/{gid}.inviteCode
 *   + AUDITORÍA: las reglas dan por hecho que los miembros de un grupo son amigos entre
 *     sí. Los grupos anteriores al auto-amistar podrían no cumplirlo.
 *
 * Por defecto NO escribe nada: cuenta y cuenta lo que haría. Es idempotente (no pisa nada
 * que ya exista) y se puede repetir.
 *
 *   node tools/backfill-public-docs.cjs                       ensayo en seco
 *   node tools/backfill-public-docs.cjs --apply --yes         escribe
 *   node tools/backfill-public-docs.cjs --apply --yes --fix-friendships
 *                                    además crea/acepta las amistades de grupo que falten
 *
 * Necesita `firebase-admin` (v10 o posterior: usa los imports modulares) y credenciales (GOOGLE_APPLICATION_CREDENTIALS). Pensado para
 * correr donde ya está firebase-admin (la Raspberry). Contra el emulador:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GCLOUD_PROJECT=demo-cagometro node tools/...
 *
 * Orden de despliegue: 1) cliente nuevo  2) este script  3) reglas nuevas.
 * Sale con código 1 si hay conflictos que revisar a mano.
 */
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply"), YES = argv.has("--yes"), FIX = argv.has("--fix-friendships");
const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT || "cagometro-app";

if (APPLY && !EMULATOR && !YES){
  console.error(`⚠️  Vas a ESCRIBIR en el proyecto REAL «${PROJECT}». Repite con --yes si es lo que quieres.`);
  process.exit(2);
}
initializeApp({ projectId: PROJECT });
const db = getFirestore();

const emailKey = e => (e || "").toLowerCase().trim();
const pairId = (a, b) => [a, b].sort().join("_");

async function main(){
  console.log(`Proyecto: ${PROJECT}${EMULATOR ? " (EMULADOR)" : ""} · modo: ${APPLY ? "ESCRIBIR" : "ensayo en seco"}${FIX ? " + arreglar amistades" : ""}\n`);

  const [users, groups, friendships, profileIds, lookups, codes] = await Promise.all([
    db.collection("users").get(),
    db.collection("groups").get(),
    db.collection("friendships").get(),
    db.collection("publicProfiles").listDocuments(),
    db.collection("userLookup").get(),
    db.collection("inviteCodes").get(),
  ]);
  const haveProfile = new Set(profileIds.map(d => d.id));
  const lookupOwner = new Map(lookups.docs.map(d => [d.id, d.data().uid]));
  const codeOwner = new Map(codes.docs.map(d => [d.id, d.data().gid]));
  const friendStatus = new Map(friendships.docs.map(d => [d.id, d.data().status]));

  const ops = [];                 // { ref, data, merge }
  const conflicts = [];           // cosas que hay que mirar a mano
  const count = { profiles: 0, lookups: 0, codes: 0, flagged: 0, friendships: 0 };

  // ── usuarios ──
  const userIds = new Set();
  for (const u of users.docs){
    const d = u.data(); userIds.add(u.id);
    let touched = false;
    if (!haveProfile.has(u.id)){
      ops.push({ ref: db.doc(`publicProfiles/${u.id}`), data: { displayName: d.displayName || "", color: d.color || null, photoURL: d.photoURL || null } });
      count.profiles++; touched = true;
    }
    const k = emailKey(d.email);
    if (k){
      const owner = lookupOwner.get(k);
      if (!owner){ ops.push({ ref: db.doc(`userLookup/${k}`), data: { uid: u.id } }); lookupOwner.set(k, u.id); count.lookups++; touched = true; }
      else if (owner !== u.id) conflicts.push(`email «${k}»: lo usan ${owner} y ${u.id}`);
    }
    if (touched || !d.publicV){ ops.push({ ref: u.ref, data: { publicV: 1 }, merge: true }); if (!d.publicV) count.flagged++; }
  }

  // ── grupos: códigos de invitación + auditoría de amistades ──
  const missing = [];             // { gid, a, b, status }
  for (const g of groups.docs){
    const d = g.data();
    if (d.inviteCode){
      const owner = codeOwner.get(d.inviteCode);
      if (!owner){ ops.push({ ref: db.doc(`inviteCodes/${d.inviteCode}`), data: { gid: g.id, createdBy: d.createdBy || null } }); codeOwner.set(d.inviteCode, g.id); count.codes++; }
      else if (owner !== g.id) conflicts.push(`código «${d.inviteCode}»: lo usan los grupos ${owner} y ${g.id}`);
    } else conflicts.push(`grupo ${g.id} («${d.name}») no tiene inviteCode`);

    const members = d.members || [];
    for (const m of members) if (!userIds.has(m)) conflicts.push(`grupo ${g.id}: el miembro ${m} no tiene doc de usuario`);
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++){
      const id = pairId(members[i], members[j]), st = friendStatus.get(id);
      if (st !== "accepted") missing.push({ gid: g.id, name: d.name, a: members[i], b: members[j], status: st || "inexistente" });
    }
  }
  if (FIX) for (const m of missing){
    const id = pairId(m.a, m.b);
    ops.push({ ref: db.doc(`friendships/${id}`), merge: true,
      data: { uids: [m.a, m.b].sort(), status: "accepted", source: "group", gid: m.gid, createdAt: FieldValue.serverTimestamp() } });
    count.friendships++;
  }

  // ── informe ──
  console.log(`Usuarios: ${users.size} · Grupos: ${groups.size}`);
  console.log(`  perfiles públicos por crear ........ ${count.profiles}`);
  console.log(`  búsquedas por email por crear ...... ${count.lookups}`);
  console.log(`  códigos de invitación por crear .... ${count.codes}`);
  console.log(`  usuarios por marcar (publicV) ...... ${count.flagged}`);
  console.log(`  parejas de grupo SIN amistad aceptada: ${missing.length}${FIX ? ` (se arreglan ${count.friendships})` : ""}`);
  for (const m of missing.slice(0, 20)) console.log(`     · grupo «${m.name}» (${m.gid}): ${m.a} ↔ ${m.b} → ${m.status}`);
  if (missing.length > 20) console.log(`     … y ${missing.length - 20} más`);
  if (missing.length && !FIX) console.log("     (con --fix-friendships se crean/aceptan; sin eso, las reglas nuevas ocultarían a esas personas entre sí)");
  if (conflicts.length){ console.log(`\n⚠️  Conflictos a revisar a mano (${conflicts.length}):`); conflicts.forEach(c => console.log("   · " + c)); }

  if (!APPLY){ console.log(`\nEnsayo en seco: no se ha escrito nada (${ops.length} operaciones pendientes).`); }
  else {
    for (let i = 0; i < ops.length; i += 400){
      const b = db.batch();
      for (const o of ops.slice(i, i + 400)) o.merge ? b.set(o.ref, o.data, { merge: true }) : b.set(o.ref, o.data);
      await b.commit();
    }
    console.log(`\n✅ Escritas ${ops.length} operaciones.`);
  }
  process.exit(conflicts.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
