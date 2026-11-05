// Tests de las reglas de Firestore contra el emulador.
//   npm test                → prueba ../firestore.rules.draft (el borrador endurecido)
//   RULES_FILE=../firestore.rules npm test   → prueba las reglas actualmente desplegadas
// Comparar los dos resultados enseña exactamente qué agujeros cierra el borrador.
import { readFileSync } from "node:fs";
import { describe, it, before, after, beforeEach } from "node:test";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit, serverTimestamp,
} from "firebase/firestore";

const RULES_FILE = process.env.RULES_FILE || "../firestore.rules.draft";
const ADMIN = "OQxbpTTQqBbWsykiU7JKcUdZ7z32";   // uid fijo de isAdmin() en las reglas
let testEnv;

const as = (uid, token) => testEnv.authenticatedContext(uid, token).firestore();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-cagometro",
    firestore: { rules: readFileSync(RULES_FILE, "utf8"), host: "127.0.0.1", port: 8081 },
  });
  console.log(`\n▶ reglas bajo prueba: ${RULES_FILE}\n`);
});
after(async () => { await testEnv?.cleanup(); });

// alice y bob son amigos aceptados y comparten g1. dave le mandó una solicitud pendiente a
// alice. carol no tiene ninguna relación con nadie. eve está con alice en g2 (sin amistad).
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const u of ["alice", "bob", "carol", "dave", "eve"])
      await setDoc(doc(db, "users", u), { displayName: u, email: `${u}@x.com` });
    await setDoc(doc(db, "users", "alice", "cacas", "c1"), { uid: "alice", ts: 1, lat: 40.1, lng: -3.2, reactions: {} });
    await setDoc(doc(db, "friendships", "alice_bob"),  { uids: ["alice", "bob"],  status: "accepted", source: "group", gid: "g1" });
    await setDoc(doc(db, "friendships", "alice_dave"), { uids: ["alice", "dave"], status: "pending", requestedBy: "dave" });
    await setDoc(doc(db, "groups", "g1"), { name: "uno", createdBy: "alice", members: ["alice", "bob"], inviteCode: "ABC123" });
    await setDoc(doc(db, "groups", "g2"), { name: "dos", createdBy: "alice", members: ["alice", "eve"], inviteCode: "XYZ789" });
    await setDoc(doc(db, "activity", "a1"), { uid: "alice", kind: "add", audience: ["alice", "bob"], reactions: {} });
    await setDoc(doc(db, "activity", "s1"), {
      uid: "alice", kind: "sync", audience: ["alice", "bob"], reactions: {},
      participants: [{ uid: "alice" }], participantUids: ["alice"], lastTs: 1,
    });
  });
});

describe("users y cacas: lectura", () => {
  it("el dueño lee su perfil y sus cacas", async () => {
    await assertSucceeds(getDoc(doc(as("alice"), "users", "alice")));
    await assertSucceeds(getDoc(doc(as("alice"), "users", "alice", "cacas", "c1")));
  });
  it("un amigo aceptado lee perfil y cacas", async () => {
    await assertSucceeds(getDoc(doc(as("bob"), "users", "alice")));
    await assertSucceeds(getDoc(doc(as("bob"), "users", "alice", "cacas", "c1")));
    await assertSucceeds(getDocs(query(collection(as("bob"), "users", "alice", "cacas"), limit(10))));
  });
  it("un desconocido NO lee perfil ni cacas (lat/lng)", async () => {
    await assertFails(getDoc(doc(as("carol"), "users", "alice")));
    await assertFails(getDoc(doc(as("carol"), "users", "alice", "cacas", "c1")));
    await assertFails(getDocs(query(collection(as("carol"), "users", "alice", "cacas"), limit(10))));
  });
  it("quien solo tiene una solicitud PENDIENTE no lee nada", async () => {
    await assertFails(getDoc(doc(as("dave"), "users", "alice")));
    await assertFails(getDoc(doc(as("dave"), "users", "alice", "cacas", "c1")));
  });
  it("un compañero de grupo sin amistad no lee (la regla se apoya en la amistad)", async () => {
    await assertFails(getDoc(doc(as("eve"), "users", "alice")));
  });
  it("el admin lee a cualquiera", async () => {
    await assertSucceeds(getDoc(doc(as(ADMIN), "users", "alice", "cacas", "c1")));
  });
  it("no se puede listar la colección users entera", async () => {
    await assertFails(getDocs(collection(as("carol"), "users")));
  });
});

describe("users y cacas: escritura y borrado de cuenta", () => {
  it("el dueño puede borrar su propio doc de usuario (borrado de cuenta)", async () => {
    await assertSucceeds(deleteDoc(doc(as("carol"), "users", "carol")));
  });
  it("nadie más puede borrar el doc de otro", async () => {
    await assertFails(deleteDoc(doc(as("carol"), "users", "alice")));
    await assertFails(deleteDoc(doc(as("bob"), "users", "alice")));
  });
  it("un amigo solo puede tocar `reactions` en una caca", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "users", "alice", "cacas", "c1"), { reactions: { bob: ["💩"] } }));
    await assertFails(updateDoc(doc(as("bob"), "users", "alice", "cacas", "c1"), { lat: 0 }));
  });
  it("un desconocido no puede reaccionar a una caca", async () => {
    await assertFails(updateDoc(doc(as("carol"), "users", "alice", "cacas", "c1"), { reactions: { carol: ["💩"] } }));
  });
  it("el dueño sigue pudiendo crear y borrar sus cacas", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "users", "alice", "cacas", "c2"), { uid: "alice", ts: 2 }));
    await assertSucceeds(deleteDoc(doc(as("alice"), "users", "alice", "cacas", "c2")));
  });
});

describe("friendships", () => {
  it("NO se puede crear una amistad ya aceptada a escondidas (sin grupo)", async () => {
    await assertFails(setDoc(doc(as("carol"), "friendships", "alice_carol"),
      { uids: ["alice", "carol"], status: "accepted", source: "link" }));
    await assertFails(setDoc(doc(as("carol"), "friendships", "alice_carol"),
      { uids: ["alice", "carol"], status: "accepted", source: "group", gid: "g1" }));   // carol no está en g1
  });
  it("una solicitud pendiente a nombre de uno mismo sí se puede crear", async () => {
    await assertSucceeds(setDoc(doc(as("carol"), "friendships", "alice_carol"),
      { uids: ["alice", "carol"], status: "pending", requestedBy: "carol", createdAt: serverTimestamp() }));
  });
  it("no se puede suplantar `requestedBy`", async () => {
    await assertFails(setDoc(doc(as("carol"), "friendships", "alice_carol"),
      { uids: ["alice", "carol"], status: "pending", requestedBy: "alice" }));
  });
  it("el id del documento tiene que ser el par ordenado de los uids", async () => {
    await assertFails(setDoc(doc(as("carol"), "friendships", "cualquier_cosa"),
      { uids: ["alice", "carol"], status: "pending", requestedBy: "carol" }));
  });
  it("amistad automática de grupo: sí si los dos están en ese grupo", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "friendships", "alice_eve"),
      { uids: ["alice", "eve"], status: "accepted", source: "group", gid: "g2", createdAt: serverTimestamp() }));
  });
  it("amistad automática de grupo: no sin gid, ni con un grupo donde no están los dos", async () => {
    await assertFails(setDoc(doc(as("alice"), "friendships", "alice_eve"),
      { uids: ["alice", "eve"], status: "accepted", source: "group" }));
    await assertFails(setDoc(doc(as("alice"), "friendships", "alice_eve"),
      { uids: ["alice", "eve"], status: "accepted", source: "group", gid: "g1" }));
  });
  it("el solicitante NO puede aceptar su propia solicitud", async () => {
    await assertFails(updateDoc(doc(as("dave"), "friendships", "alice_dave"), { status: "accepted" }));
  });
  it("el destinatario sí puede aceptar", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "friendships", "alice_dave"), { status: "accepted" }));
  });
  it("aceptar no puede aprovecharse para cambiar otros campos", async () => {
    await assertFails(updateDoc(doc(as("alice"), "friendships", "alice_dave"),
      { status: "accepted", uids: ["alice", "carol"] }));
  });
  it("un tercero no puede tocar ni leer la amistad de otros", async () => {
    await assertFails(updateDoc(doc(as("carol"), "friendships", "alice_dave"), { status: "accepted" }));
    await assertFails(getDoc(doc(as("carol"), "friendships", "alice_bob")));
  });
  it("cualquiera de los dos puede romper la amistad", async () => {
    await assertSucceeds(deleteDoc(doc(as("bob"), "friendships", "alice_bob")));
  });
});

describe("pushQueue", () => {
  const push = (over = {}) => ({
    fromUid: "alice", toUid: "bob", type: "reaction", title: "Hola", body: "Mundo", sent: false, ts: serverTimestamp(), ...over,
  });
  const q = uid => collection(as(uid), "pushQueue");
  it("a un amigo, con un tipo válido: sí", async () => { await assertSucceeds(addDoc(q("alice"), push())); });
  it("a quien tiene una solicitud pendiente contigo: sí (así llega el aviso de solicitud)", async () => {
    await assertSucceeds(addDoc(q("alice"), push({ toUid: "dave", type: "friend_request" })));
  });
  it("a un desconocido: NO (anti-spam)", async () => { await assertFails(addDoc(q("alice"), push({ toUid: "carol" }))); });
  it("no se puede suplantar `fromUid`", async () => { await assertFails(addDoc(q("carol"), push({ fromUid: "alice" }))); });
  it("un `type` fuera de la lista cerrada: NO", async () => { await assertFails(addDoc(q("alice"), push({ type: "promo" }))); });
  it("texto demasiado largo: NO", async () => {
    await assertFails(addDoc(q("alice"), push({ body: "x".repeat(301) })));
    await assertFails(addDoc(q("alice"), push({ title: "x".repeat(121) })));
  });
  it("campos que no son de la cola: NO", async () => { await assertFails(addDoc(q("alice"), push({ extra: 1 }))); });
  it("nadie la puede leer desde el cliente", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "pushQueue", "p1"), push()); });
    await assertFails(getDoc(doc(as("alice"), "pushQueue", "p1")));
  });
});

describe("activity", () => {
  it("un miembro de la audiencia puede poner SU reacción", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "activity", "a1"), { "reactions.bob": ["💩"] }));
  });
  it("no puede escribir la entrada de otro", async () => {
    await assertFails(updateDoc(doc(as("bob"), "activity", "a1"), { "reactions.alice": ["💩"] }));
  });
  it("no puede reescribir el mapa entero (más de una clave)", async () => {
    await assertFails(updateDoc(doc(as("bob"), "activity", "a1"), { reactions: { bob: ["💩"], alice: ["💩"] } }));
  });
  it("quien no está en la audiencia no puede reaccionar", async () => {
    await assertFails(updateDoc(doc(as("carol"), "activity", "a1"), { "reactions.carol": ["💩"] }));
  });
  it("el autor sigue pudiendo editar y borrar lo suyo", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "activity", "a1"), { kind: "undo" }));
    await assertSucceeds(deleteDoc(doc(as("alice"), "activity", "a1")));
  });
  it("conexión de tuberías: otro participante puede añadirse", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "activity", "s1"),
      { participantUids: ["alice", "bob"], participants: [{ uid: "alice" }, { uid: "bob" }], lastTs: 2 }));
  });
  it("conexión de tuberías: no puede quitar a otro participante", async () => {
    await assertFails(updateDoc(doc(as("bob"), "activity", "s1"),
      { participantUids: ["bob"], participants: [{ uid: "bob" }], lastTs: 2 }));
  });
  it("el feed lo leen la audiencia y el autor, y nadie más", async () => {
    await assertSucceeds(getDoc(doc(as("bob"), "activity", "a1")));
    await assertFails(getDoc(doc(as("carol"), "activity", "a1")));
  });

  // Lo que escriben de verdad las apps (addCacaAt, syncComboUpsert, undo/reset): tiene que seguir pasando.
  const evento = (extra = {}) => ({ uid: "bob", kind: "add", name: "Bob de la Oliva Rodríguez", color: "#6E3F1C", ts: Date.now(), forTs: 1, year: 2026, n: 3,
    late: true, offline: true, audience: ["bob", "alice"], groups: ["g1"], reactions: {}, createdAt: serverTimestamp(), lat: 40.4, lng: -3.7, ...extra });
  it("tamaños: los eventos reales de las apps se crean", async () => {
    await assertSucceeds(addDoc(collection(as("bob"), "activity"), evento()));
    await assertSucceeds(addDoc(collection(as("bob"), "activity"), { uid: "bob", kind: "undo", name: "Bob", color: "#fff", ts: 1, year: 2026, audience: ["bob"], groups: [], reactions: {}, createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(as("bob"), "activity", "sesion1"), { kind: "sync", uid: "bob", name: "Bob", color: "#abc", ts: 1, startedTs: 1, lastTs: 2, year: 2026,
      participants: [{ uid: "bob", name: "Bob", color: "#abc" }], participantUids: ["bob"], km: 1.2, audience: ["bob", "alice"], reactions: {}, createdAt: serverTimestamp() }));
  });
  it("tamaños: nombre, color, audiencia, grupos o campos desmesurados, no", async () => {
    await assertFails(addDoc(collection(as("bob"), "activity"), evento({ name: "x".repeat(101) })));
    await assertFails(addDoc(collection(as("bob"), "activity"), evento({ name: 42 })));
    await assertFails(addDoc(collection(as("bob"), "activity"), evento({ color: "#".repeat(41) })));
    await assertFails(addDoc(collection(as("bob"), "activity"), evento({ audience: Array.from({ length: 1001 }, (_, i) => "u" + i) })));
    await assertFails(addDoc(collection(as("bob"), "activity"), evento({ groups: Array.from({ length: 101 }, (_, i) => "g" + i) })));
    await assertFails(addDoc(collection(as("bob"), "activity"), evento(Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["extra" + i, i])))));
  });
  it("tamaños: no se puede crear un evento con reacciones ya puestas (falsificar las de otros)", async () => {
    await assertFails(addDoc(collection(as("bob"), "activity"), evento({ reactions: { alice: ["💩"] } })));
  });
  it("tamaños: el autor tampoco puede inflar su evento después", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "activity", "a1"), { name: "Alice" }));
    await assertFails(updateDoc(doc(as("alice"), "activity", "a1"), { name: "x".repeat(101) }));
  });
  it("tamaños: hasta 20 emojis por persona en un evento", async () => {
    const doce = ["💩", "🔥", "😂", "😱", "😭", "🌶️", "👏", "🤢", "💪", "👑", "❤️", "🚽"];
    await assertSucceeds(updateDoc(doc(as("bob"), "activity", "a1"), { "reactions.bob": doce }));
    await assertFails(updateDoc(doc(as("bob"), "activity", "a1"), { "reactions.bob": [...doce, ...doce] }));
  });
});

describe("groups", () => {
  it("un miembro lee su grupo; un desconocido, no", async () => {
    await assertSucceeds(getDoc(doc(as("bob"), "groups", "g1")));
    await assertFails(getDoc(doc(as("carol"), "groups", "g1")));
  });
  it("«mis grupos» sigue funcionando (consulta array-contains)", async () => {
    await assertSucceeds(getDocs(query(collection(as("bob"), "groups"), where("members", "array-contains", "bob"))));
  });
  it("no se puede buscar un grupo por código desde fuera (se hace por inviteCodes)", async () => {
    await assertFails(getDocs(query(collection(as("carol"), "groups"), where("inviteCode", "==", "ABC123"), limit(1))));
  });
  it("un miembro puede SALIR él mismo", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "groups", "g1"), { members: ["alice"] }));
  });
  it("un miembro NO puede expulsar a otro", async () => {
    await assertFails(updateDoc(doc(as("bob"), "groups", "g1"), { members: ["bob"] }));
  });
  it("el creador sí puede expulsar", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "groups", "g1"), { members: ["alice"] }));
  });
  it("unirse: añadirse a uno mismo exige el código (antes: limitación conocida, ya cerrada)", async () => {
    await assertFails(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol"] }));
    await assertSucceeds(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol"], joinCode: "ABC123" }));
  });
  it("unirse: no se puede añadir a OTRA persona", async () => {
    await assertFails(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "dave"] }));
  });
});

describe("publicProfiles", () => {
  it("cualquiera con sesión lee un perfil público por clave, pero no se lista", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "publicProfiles", "alice"), { displayName: "Alice", color: "#fff" }); });
    await assertSucceeds(getDoc(doc(as("carol"), "publicProfiles", "alice")));
    await assertFails(getDocs(collection(as("carol"), "publicProfiles")));
  });
  it("solo el dueño lo escribe, y solo nombre/color/foto", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "publicProfiles", "alice"), { displayName: "Alice", color: "#fff", photoURL: null }));
    await assertFails(setDoc(doc(as("carol"), "publicProfiles", "alice"), { displayName: "Falsa" }));
    await assertFails(setDoc(doc(as("alice"), "publicProfiles", "alice"), { displayName: "Alice", email: "alice@x.com" }));
  });
  it("el perfil público NO abre la lectura del perfil completo", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "publicProfiles", "alice"), { displayName: "Alice" }); });
    await assertFails(getDoc(doc(as("carol"), "users", "alice")));
  });
});

describe("userLookup e inviteCodes", () => {
  it("userLookup: se lee por clave pero no se lista", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "userLookup", "bob@x.com"), { uid: "bob" }); });
    await assertSucceeds(getDoc(doc(as("carol"), "userLookup", "bob@x.com")));
    await assertFails(getDocs(collection(as("carol"), "userLookup")));
  });
  it("userLookup: cada uno escribe su entrada, con el email de su token", async () => {
    const me = as("alice", { email: "Alice@x.com", email_verified: true });
    await assertSucceeds(setDoc(doc(me, "userLookup", "alice@x.com"), { uid: "alice" }));
  });
  it("userLookup: no se puede registrar el email de otro ni suplantar el uid", async () => {
    const me = as("carol", { email: "carol@x.com", email_verified: true });
    await assertFails(setDoc(doc(me, "userLookup", "alice@x.com"), { uid: "carol" }));
    await assertFails(setDoc(doc(me, "userLookup", "carol@x.com"), { uid: "alice" }));
  });
  it("inviteCodes: lo crea el creador del grupo, no otro; y no se lista", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "inviteCodes", "ABC123"), { gid: "g1", createdBy: "alice" }));
    await assertFails(setDoc(doc(as("carol"), "inviteCodes", "HACK01"), { gid: "g1", createdBy: "carol" }));
    await assertFails(getDocs(collection(as("alice"), "inviteCodes")));
  });
  it("inviteCodes: cualquiera con sesión lo lee por clave", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "inviteCodes", "ABC123"), { gid: "g1", createdBy: "alice" }); });
    await assertSucceeds(getDoc(doc(as("carol"), "inviteCodes", "ABC123")));
  });
});

// ─── AUDITORÍA (2026-11): cada ataque que funcionaba contra la primera versión del borrador ───
// «ataque» = debe FALLAR; «legítimo» = debe seguir funcionando.
describe("auditoría: grupos (A1, A5)", () => {
  it("ataque A1: crear un grupo con otra persona dentro", async () => {
    await assertFails(setDoc(doc(as("carol"), "groups", "gX"), { name: "x", createdBy: "carol", members: ["carol", "alice"] }));
  });
  it("ataque A1: el creador de un grupo ajeno no puede añadirse gente después", async () => {
    await assertFails(updateDoc(doc(as("alice"), "groups", "g1"), { members: ["alice", "bob", "carol"] }));
  });
  it("ataque A1: sin código ni invitación no se entra a un grupo", async () => {
    await assertFails(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol"] }));
    await assertFails(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol"], joinCode: "MALO00" }));
  });
  it("ataque A1: tampoco con una invitación fabricada por alguien de fuera", async () => {
    await assertFails(setDoc(doc(as("carol"), "groupInvites", "g1_carol"), { gid: "g1", fromUid: "carol", toUid: "carol", status: "pending" }));
  });
  it("ataque A5: unirse con código expulsando a otro miembro", async () => {
    await assertFails(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "carol", "dave"], joinCode: "ABC123" }));
  });
  it("ataque A5: unirse con código añadiendo además a otra persona", async () => {
    await assertFails(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol", "dave"], joinCode: "ABC123" }));
  });
  it("legítimo: crear un grupo con uno mismo", async () => {
    await assertSucceeds(setDoc(doc(as("carol"), "groups", "gC"), { name: "mío", createdBy: "carol", members: ["carol"], inviteCode: "CAR123" }));
  });
  it("legítimo: unirse con el código correcto (solo uno mismo)", async () => {
    await assertSucceeds(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol"], joinCode: "ABC123" }));
  });
  it("legítimo: unirse con una invitación pendiente de un miembro (sin código)", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "groupInvites", "g1_carol"), { gid: "g1", fromUid: "alice", toUid: "carol", status: "pending" }));
    await assertSucceeds(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol"] }));
  });
  it("legítimo: el creador renombra y expulsa; un miembro puede salir", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "groups", "g1"), { name: "nuevo" }));
    await assertSucceeds(updateDoc(doc(as("alice"), "groups", "g1"), { members: ["alice"] }));
    await assertSucceeds(updateDoc(doc(as("eve"), "groups", "g2"), { members: ["alice"] }));
  });
});

describe("auditoría: reacciones (A2, A4)", () => {
  it("ataque A2: un amigo no puede tocar las reacciones de otros en una caca", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), "users", "alice", "cacas", "c1"), { reactions: { eve: ["👏"] } }); });
    await assertFails(updateDoc(doc(as("bob"), "users", "alice", "cacas", "c1"), { reactions: { bob: ["💩"] } }));
  });
  it("legítimo: un amigo reacciona con SU entrada (también si la caca no tenía `reactions`)", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "users", "alice", "cacas", "c1"), { "reactions.bob": ["💩"] }));
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "users", "alice", "cacas", "c2"), { uid: "alice", ts: 2 }); });
    await assertSucceeds(updateDoc(doc(as("bob"), "users", "alice", "cacas", "c2"), { "reactions.bob": ["👏"] }));
  });
  it("ataque A4: alguien de fuera no reacciona a un mensaje ajeno", async () => {
    await testEnv.withSecurityRulesDisabled(async c => {
      await setDoc(doc(c.firestore(), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] });
      await setDoc(doc(c.firestore(), "chats", "alice_bob", "messages", "m1"), { senderUid: "alice", text: "hola", reactions: {} });
    });
    await assertFails(updateDoc(doc(as("carol"), "chats", "alice_bob", "messages", "m1"), { reactions: { "🖕": ["carol"] } }));
    await assertSucceeds(updateDoc(doc(as("bob"), "chats", "alice_bob", "messages", "m1"), { "reactions.👍": ["bob"] }));
  });
});

describe("auditoría: chats (A3)", () => {
  it("ataque A3: abrir un chat privado con alguien que no es amigo", async () => {
    await assertFails(setDoc(doc(as("carol"), "chats", "alice_carol"), { type: "dm", members: ["alice", "carol"] }));
  });
  it("ataque A3: tampoco con una solicitud solo pendiente", async () => {
    await assertFails(setDoc(doc(as("dave"), "chats", "alice_dave"), { type: "dm", members: ["alice", "dave"] }));
  });
  it("ataque A3: un id de chat que no corresponde a sus miembros", async () => {
    await assertFails(setDoc(doc(as("alice"), "chats", "spam"), { type: "dm", members: ["alice", "bob"] }));
  });
  it("legítimo: DM entre amigos aceptados y mensaje", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] }, { merge: true }));
    await assertSucceeds(setDoc(doc(as("bob"), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] }, { merge: true }));   // reabrirlo
    await assertSucceeds(addDoc(collection(as("alice"), "chats", "alice_bob", "messages"), { senderUid: "alice", text: "hey" }));
  });
  it("ataque: ampliar `members` de un DM con un tercero", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] }); });
    await assertFails(updateDoc(doc(as("alice"), "chats", "alice_bob"), { members: ["alice", "bob", "carol"] }));
  });
  it("chat de grupo: lo crea un miembro, `members` no sale del grupo, y se resincroniza", async () => {
    await assertFails(setDoc(doc(as("carol"), "chats", "g1"), { type: "group", members: ["carol"] }));              // no es miembro
    await assertSucceeds(setDoc(doc(as("alice"), "chats", "g1"), { type: "group", members: ["alice", "bob"] }, { merge: true }));
    await assertFails(setDoc(doc(as("alice"), "chats", "g1"), { type: "group", members: ["alice", "bob", "carol"] }, { merge: true }));
  });
});

describe("auditoría: conexión de tuberías (A6)", () => {
  const join = (uid, extra = []) => ({ participantUids: ["alice", uid], participants: [{ uid: "alice" }, { uid }], audience: ["alice", "bob", uid, ...extra], lastTs: 2 });
  it("ataque A6: un extraño no puede colarse en la audiencia", async () => {
    await assertFails(updateDoc(doc(as("carol"), "activity", "s1"), join("carol", ["dave"])));
  });
  it("ataque A6: quitar a gente de la audiencia", async () => {
    await assertFails(updateDoc(doc(as("bob"), "activity", "s1"), { participantUids: ["alice", "bob"], participants: [{ uid: "alice" }, { uid: "bob" }], audience: ["bob"], lastTs: 2 }));
  });
  it("legítimo: alguien de la audiencia se une", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "activity", "s1"), join("bob")));
  });
  it("legítimo: un amigo del fundador que aún no estaba en la audiencia también", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "friendships", "alice_zed"), { uids: ["alice", "zed"], status: "accepted" }); });
    await assertSucceeds(updateDoc(doc(as("zed"), "activity", "s1"), join("zed")));
  });
});

describe("auditoría: email y push (A7, A8)", () => {
  it("ataque A7: reclamar un email SIN verificar", async () => {
    await assertFails(setDoc(doc(as("carol", { email: "carol@x.com", email_verified: false }), "userLookup", "carol@x.com"), { uid: "carol" }));
    await assertFails(setDoc(doc(as("carol", { email: "carol@x.com" }), "userLookup", "carol@x.com"), { uid: "carol" }));
  });
  it("legítimo: con email verificado (Google, o tras verificarlo)", async () => {
    await assertSucceeds(setDoc(doc(as("carol", { email: "carol@x.com", email_verified: true }), "userLookup", "carol@x.com"), { uid: "carol" }));
  });
  const push = (from, to, type) => ({ fromUid: from, toUid: to, type, title: "t", body: "b", sent: false, ts: 1 });
  it("ataque A8: con solicitud pendiente solo cabe el aviso de la propia solicitud", async () => {
    await assertFails(addDoc(collection(as("dave"), "pushQueue"), push("dave", "alice", "sync")));
    await assertFails(addDoc(collection(as("dave"), "pushQueue"), push("dave", "alice", "chat_message")));
  });
  it("legítimo: el aviso de la solicitud pendiente; y a amigos aceptados, cualquier tipo", async () => {
    await assertSucceeds(addDoc(collection(as("dave"), "pushQueue"), push("dave", "alice", "friend_request")));
    await assertSucceeds(addDoc(collection(as("bob"), "pushQueue"), push("bob", "alice", "reaction")));
  });
});

// ─── BORRADO DE CUENTA: lo que una cuenta puede hacer para irse sin dejar rastro ni romper a los demás ───
describe("borrado de cuenta", () => {
  const seedChat = async () => testEnv.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] });
    await setDoc(doc(db, "chats", "alice_bob", "messages", "m1"), { senderUid: "alice", senderName: "Alice", text: "hola", reactions: {} });
    await setDoc(doc(db, "chats", "alice_bob", "messages", "m2"), { senderUid: "bob", senderName: "Bob", text: "qué tal", reactions: {} });
  });
  it("quien escribió un mensaje lo anonimiza: el texto se queda, su uid y nombre no", async () => {
    await seedChat();
    await assertSucceeds(updateDoc(doc(as("alice"), "chats", "alice_bob", "messages", "m1"), { senderUid: "deleted", senderName: "" }));
  });
  it("…pero no puede cambiar el texto, ni poner otro uid, ni tocar el de otra persona", async () => {
    await seedChat();
    await assertFails(updateDoc(doc(as("alice"), "chats", "alice_bob", "messages", "m1"), { text: "editado" }));
    await assertFails(updateDoc(doc(as("alice"), "chats", "alice_bob", "messages", "m1"), { senderUid: "bob", senderName: "Bob" }));
    await assertFails(updateDoc(doc(as("alice"), "chats", "alice_bob", "messages", "m1"), { senderUid: "deleted", senderName: "x" }));
    await assertFails(updateDoc(doc(as("alice"), "chats", "alice_bob", "messages", "m2"), { senderUid: "deleted", senderName: "" }));
    await assertFails(updateDoc(doc(as("carol"), "chats", "alice_bob", "messages", "m1"), { senderUid: "deleted", senderName: "" }));
  });
  it("el creador traspasa el grupo a un miembro y se va; no puede traspasarlo a un extraño", async () => {
    await assertFails(updateDoc(doc(as("alice"), "groups", "g1"), { createdBy: "carol" }));                  // carol no es miembro
    await assertSucceeds(updateDoc(doc(as("alice"), "groups", "g1"), { createdBy: "bob" }));
    await assertSucceeds(updateDoc(doc(as("alice"), "groups", "g1"), { members: ["bob"] }));                 // salir (ya no es creador, pero es miembro)
  });
  it("quien no es el creador no puede traspasar el grupo", async () => {
    await assertFails(updateDoc(doc(as("bob"), "groups", "g1"), { createdBy: "bob" }));
  });
  it("un participante sale de una conexión de tuberías; no puede sacar a otro", async () => {
    await testEnv.withSecurityRulesDisabled(async c => {
      await setDoc(doc(c.firestore(), "activity", "s2"), {
        uid: "alice", kind: "sync", audience: ["alice", "bob", "eve"], reactions: {},
        participants: [{ uid: "alice" }, { uid: "bob" }, { uid: "eve" }], participantUids: ["alice", "bob", "eve"], lastTs: 1,
      });
    });
    await assertFails(updateDoc(doc(as("bob"), "activity", "s2"), { participants: [{ uid: "alice" }, { uid: "bob" }], participantUids: ["alice", "bob"] }));   // sacar a eve
    await assertSucceeds(updateDoc(doc(as("eve"), "activity", "s2"), { participants: [{ uid: "alice" }, { uid: "bob" }], participantUids: ["alice", "bob"] }));
    await assertFails(updateDoc(doc(as("carol"), "activity", "s2"), { participants: [], participantUids: [] }));                                         // un extraño
  });
  it("el destinatario puede quitar una invitación a un grupo; un extraño no", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "groupInvites", "g1_dave"), { gid: "g1", fromUid: "alice", toUid: "dave", status: "pending" }); });
    await assertFails(deleteDoc(doc(as("carol"), "groupInvites", "g1_dave")));
    await assertSucceeds(deleteDoc(doc(as("dave"), "groupInvites", "g1_dave")));
  });
  it("cada uno puede borrar lo suyo: perfil, cacas, perfil público y su entrada de búsqueda", async () => {
    await testEnv.withSecurityRulesDisabled(async c => {
      await setDoc(doc(c.firestore(), "publicProfiles", "alice"), { displayName: "alice" });
      await setDoc(doc(c.firestore(), "userLookup", "alice@x.com"), { uid: "alice" });
    });
    const a = as("alice");
    await assertSucceeds(deleteDoc(doc(a, "users", "alice", "cacas", "c1")));
    await assertSucceeds(deleteDoc(doc(a, "publicProfiles", "alice")));
    await assertSucceeds(deleteDoc(doc(a, "userLookup", "alice@x.com")));
    await assertSucceeds(deleteDoc(doc(a, "friendships", "alice_bob")));
    await assertSucceeds(deleteDoc(doc(a, "users", "alice")));
    await assertFails(deleteDoc(doc(as("carol"), "users", "bob")));                                           // la de otro, no
  });
});

// ─── DENUNCIAR Y BLOQUEAR (Apple, guía 1.2): denuncias que solo ve el admin; el bloqueo se cumple en el servidor ───
describe("denuncias", () => {
  const rep = (from, over = {}) => ({
    reporterUid: from, targetUid: "alice", kind: "user", refId: "alice", reason: "acoso", ts: serverTimestamp(), status: "open", ...over,
  });
  const report = (from, over) => addDoc(collection(as(from), "reports"), rep(from, over));
  const seedMsg = async () => testEnv.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] });
    await setDoc(doc(c.firestore(), "chats", "alice_bob", "messages", "m1"), { senderUid: "alice", senderName: "alice", text: "hola, idiota", reactions: {} });
  });
  const msg = { kind: "message", refId: "m1", chatId: "alice_bob", text: "hola, idiota" };

  it("denunciar a una persona: sí, también a un desconocido y con nota", async () => {
    await assertSucceeds(report("bob"));
    await assertSucceeds(report("carol", { reason: "suplantacion", note: "x".repeat(500) }));
  });
  it("denunciar un mensaje: sí, con su texto real, siendo del chat", async () => {
    await seedMsg();
    await assertSucceeds(report("bob", msg));
  });
  it("mensaje: no con un texto inventado, ni contra quien no lo escribió, ni desde fuera del chat", async () => {
    await seedMsg();
    await assertFails(report("bob", { ...msg, text: "te voy a matar" }));
    await assertFails(report("bob", { ...msg, targetUid: "carol" }));
    await assertFails(report("bob", { kind: "message", refId: "m1", chatId: "alice_bob" }));   // sin el texto copiado
    await assertFails(report("bob", { ...msg, refId: "noexiste" }));
    await assertFails(report("carol", msg));
  });
  it("grupo: sí siendo miembro y contra quien lo creó; no desde fuera ni contra otro", async () => {
    await assertSucceeds(report("bob", { kind: "group", refId: "g1" }));
    await assertFails(report("carol", { kind: "group", refId: "g1" }));
    await assertFails(report("bob", { kind: "group", refId: "g1", targetUid: "eve" }));
    await assertFails(report("bob", { kind: "group", refId: "g1", chatId: "g1" }));
  });
  it("usuario: refId tiene que ser la persona denunciada", async () => {
    await assertFails(report("bob", { refId: "eve" }));
    await assertFails(report("bob", { chatId: "alice_bob" }));
  });
  it("no: a uno mismo, a nombre de otro, campos de más, motivo o tipo inválido, nota larga, otro estado u otra hora", async () => {
    await assertFails(report("alice"));                                       // targetUid == quien denuncia
    await assertFails(addDoc(collection(as("carol"), "reports"), rep("bob")));
    await assertFails(report("bob", { extra: 1 }));
    await assertFails(report("bob", { reason: "me cae mal" }));
    await assertFails(report("bob", { kind: "caca" }));
    await assertFails(report("bob", { note: "x".repeat(501) }));
    await assertFails(report("bob", { status: "resolved" }));
    await assertFails(report("bob", { ts: 1 }));
  });
  it("solo el admin lee y gestiona las denuncias: ni el denunciante ni el denunciado", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "reports", "r1"), rep("bob", { ts: 1 })); });
    for (const u of ["bob", "alice", "carol"]) {
      await assertFails(getDoc(doc(as(u), "reports", "r1")));
      await assertFails(updateDoc(doc(as(u), "reports", "r1"), { status: "dismissed" }));
      await assertFails(deleteDoc(doc(as(u), "reports", "r1")));
    }
    await assertFails(getDocs(collection(as("bob"), "reports")));
    await assertSucceeds(getDocs(query(collection(as(ADMIN), "reports"), where("status", "==", "open"))));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "reports", "r1"), { status: "resolved" }));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "reports", "r1")));
  });
  it("el aviso de denuncia va al admin sin ser su amigo; a nadie más", async () => {
    const push = (from, to, type) => ({ fromUid: from, toUid: to, type, title: "Nueva denuncia", body: "acoso", sent: false, ts: 1 });
    await assertSucceeds(addDoc(collection(as("carol"), "pushQueue"), push("carol", ADMIN, "report")));
    await assertFails(addDoc(collection(as("bob"), "pushQueue"), push("bob", "alice", "report")));       // amigo, pero no admin
    await assertFails(addDoc(collection(as("carol"), "pushQueue"), push("carol", ADMIN, "reaction")));   // al admin, lo demás sigue pidiendo amistad
  });
});

describe("bloqueos: la lista", () => {
  const blk = (name = "x") => ({ ts: serverTimestamp(), name });
  it("cada uno bloquea, lee y desbloquea lo suyo", async () => {
    const a = as("alice");
    await assertSucceeds(setDoc(doc(a, "users", "alice", "blocked", "carol"), blk("carol")));
    await assertSucceeds(getDocs(collection(a, "users", "alice", "blocked")));
    await assertSucceeds(deleteDoc(doc(a, "users", "alice", "blocked", "carol")));
  });
  it("nadie más ve ni toca tu lista, ni siquiera un amigo (que sí lee tu perfil)", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "users", "alice", "blocked", "carol"), { ts: 1, name: "carol" }); });
    await assertFails(getDoc(doc(as("bob"), "users", "alice", "blocked", "carol")));
    await assertFails(getDocs(collection(as("bob"), "users", "alice", "blocked")));
    await assertFails(deleteDoc(doc(as("carol"), "users", "alice", "blocked", "carol")));      // el bloqueado no se desbloquea
    await assertFails(setDoc(doc(as("carol"), "users", "alice", "blocked", "bob"), blk()));
  });
  it("no: bloquearse a uno mismo, otros campos o un nombre enorme", async () => {
    const a = as("alice");
    await assertFails(setDoc(doc(a, "users", "alice", "blocked", "alice"), blk()));
    await assertFails(setDoc(doc(a, "users", "alice", "blocked", "carol"), { ...blk(), extra: 1 }));
    await assertFails(setDoc(doc(a, "users", "alice", "blocked", "carol"), blk("x".repeat(101))));
  });
  it("el admin la lee y la borra (vaciar una cuenta)", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "users", "alice", "blocked", "carol"), { ts: 1, name: "carol" }); });
    await assertSucceeds(getDocs(collection(as(ADMIN), "users", "alice", "blocked")));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), "users", "alice", "blocked", "carol")));
  });
});

// alice bloquea a bob (amigos, con DM y grupo g1) y a carol (desconocida).
describe("bloqueos: se cumplen en el servidor", () => {
  const block = (owner, other) => testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "users", owner, "blocked", other), { ts: 1, name: other }); });
  const dm = () => testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] }); });
  const say = (uid, chatId) => addDoc(collection(as(uid), "chats", chatId, "messages"), { senderUid: uid, text: "hola" });
  const pending = (from, to) => setDoc(doc(as(from), "friendships", [from, to].sort().join("_")),
    { uids: [from, to].sort(), status: "pending", requestedBy: from, createdAt: serverTimestamp() });
  const invite = (from, to, gid) => setDoc(doc(as(from), "groupInvites", `${gid}_${to}`), { gid, fromUid: from, toUid: to, status: "pending" });
  const push = (from, to) => addDoc(collection(as(from), "pushQueue"), { fromUid: from, toUid: to, type: "reaction", title: "t", body: "b", sent: false, ts: 1 });

  it("DM: el bloqueado no escribe, y quien bloquea tampoco", async () => {
    await dm(); await block("alice", "bob");
    await assertFails(say("bob", "alice_bob"));
    await assertFails(say("alice", "alice_bob"));
  });
  it("DM: tampoco se abre un chat nuevo entre los dos", async () => {
    await block("alice", "bob");
    await assertFails(setDoc(doc(as("bob"), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] }));
    await assertFails(setDoc(doc(as("alice"), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] }));
  });
  it("DM: un `type` falso no se salta el bloqueo (se reconoce por sus miembros)", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "chats", "alice_bob"), { type: "group", members: ["alice", "bob"] }); });
    await block("alice", "bob");
    await assertFails(say("bob", "alice_bob"));
  });
  it("chat de grupo: el bloqueo no impide escribir (ahí solo oculta, en el cliente)", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "chats", "g1"), { type: "group", members: ["alice", "bob"] }); });
    await block("alice", "bob");
    await assertSucceeds(say("bob", "g1"));
  });
  it("invitar a un grupo: ni el bloqueado ni quien bloquea", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "groups", "gC"), { name: "c", createdBy: "carol", members: ["carol"] }); });
    await block("alice", "carol");
    await assertFails(invite("alice", "carol", "g1"));
    await assertFails(invite("carol", "alice", "gC"));
  });
  it("pedir amistad (también por enlace): ni el bloqueado ni quien bloquea", async () => {
    await block("alice", "carol");
    await assertFails(pending("carol", "alice"));
    await assertFails(pending("alice", "carol"));
  });
  it("avisos push: el bloqueado no te manda ninguno; tú a él sí", async () => {
    await block("alice", "bob");
    await assertFails(push("bob", "alice"));
    await assertSucceeds(push("alice", "bob"));
  });
  it("sin bloqueo entre ellos, todo sigue igual (un bloqueo ajeno no estorba)", async () => {
    await dm(); await block("bob", "carol"); await block("eve", "alice");
    await assertSucceeds(say("alice", "alice_bob"));
    await assertSucceeds(say("bob", "alice_bob"));
    await assertSucceeds(push("bob", "alice"));
    await assertSucceeds(pending("carol", "alice"));
    await assertSucceeds(invite("alice", "carol", "g1"));
  });
  it("desbloquear lo devuelve todo", async () => {
    await dm(); await block("alice", "bob");
    await assertFails(say("bob", "alice_bob"));
    await assertSucceeds(deleteDoc(doc(as("alice"), "users", "alice", "blocked", "bob")));
    await assertSucceeds(say("bob", "alice_bob"));
    await assertSucceeds(push("bob", "alice"));
  });
  it("la amistad se mantiene: el bloqueado sigue siendo amigo (decisión: bloquear solo oculta)", async () => {
    await block("alice", "bob");
    await assertSucceeds(getDoc(doc(as("bob"), "users", "alice")));
  });
});

describe("panel de administración: las lecturas de adminLoadDashboard", () => {
  const seed = () => testEnv.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, "users", "alice", "private", "push"), { tokens: ["t"], expoTokens: ["e"] });
    await setDoc(doc(db, "reports", "r1"), { reporterUid: "bob", targetUid: "alice", kind: "user", refId: "alice", reason: "spam", status: "open", ts: 5 });
    await setDoc(doc(db, "activity", "a2"), { uid: "alice", kind: "add", audience: ["alice"], ts: Date.now(), reactions: {} });
  });
  const since = Date.now() - 60 * 86400000;
  const feed = db => getDocs(query(collection(db, "activity"), where("ts", ">=", since), orderBy("ts", "desc"), limit(3000)));
  it("el admin lee usuarios, grupos, amistades, denuncias, el feed por fechas y los documentos privados", async () => {
    await seed();
    const db = as(ADMIN);
    await assertSucceeds(getDocs(collection(db, "users")));
    await assertSucceeds(getDocs(collection(db, "groups")));
    await assertSucceeds(getDocs(collection(db, "friendships")));
    await assertSucceeds(getDocs(query(collection(db, "reports"), orderBy("ts", "desc"), limit(200))));
    await assertSucceeds(feed(db));
    await assertSucceeds(getDoc(doc(db, "users", "alice", "private", "push")));
    await assertSucceeds(updateDoc(doc(db, "reports", "r1"), { status: "resolved" }));
  });
  it("un usuario normal no puede leer nada de eso (denuncias, documentos privados ajenos, el feed de todos)", async () => {
    await seed();
    const db = as("bob");
    await assertFails(getDocs(query(collection(db, "reports"), orderBy("ts", "desc"), limit(200))));
    await assertFails(getDoc(doc(db, "users", "alice", "private", "push")));
    await assertFails(feed(db));
    await assertFails(updateDoc(doc(db, "reports", "r1"), { status: "resolved" }));
  });
});

describe("cuentas suspendidas", () => {
  const suspend = who => testEnv.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), "users", who), { suspended: true, suspendedAt: 1, suspendedReason: "acoso" }); });
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async c => {
      await setDoc(doc(c.firestore(), "chats", "alice_bob"), { type: "dm", members: ["alice", "bob"] });
      await setDoc(doc(c.firestore(), "chats", "g1"), { type: "group", members: ["alice", "bob"] });
    });
  });
  it("el admin suspende y reactiva; nadie más toca esos campos (ni el propio suspendido)", async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), "users", "bob"), { suspended: true, suspendedAt: 1, suspendedReason: "x" }));
    await assertFails(updateDoc(doc(as("bob"), "users", "bob"), { suspended: false }));                  // no se levanta la suspensión
    await assertFails(updateDoc(doc(as("carol"), "users", "carol"), { suspended: true }));             // ni se suspende a sí misma ni a otro
    await assertFails(updateDoc(doc(as("carol"), "users", "bob"), { suspended: false }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), "users", "bob"), { suspended: false }));
  });
  it("sin suspender, lo normal sigue igual (cambiar su nombre, escribir un mensaje, crear actividad)", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "users", "bob"), { displayName: "Roberto" }));
    await assertSucceeds(addDoc(collection(as("bob"), "chats", "alice_bob", "messages"), { senderUid: "bob", senderName: "bob", text: "hola" }));
    await assertSucceeds(addDoc(collection(as("bob"), "activity"), { uid: "bob", kind: "add", audience: ["bob"] }));
  });
  it("suspendido: no escribe mensajes, actividad, avisos, amistades, invitaciones, chats ni grupos", async () => {
    await suspend("bob");
    const db = as("bob");
    await assertFails(addDoc(collection(db, "chats", "alice_bob", "messages"), { senderUid: "bob", senderName: "bob", text: "hola" }));
    await assertFails(addDoc(collection(db, "chats", "g1", "messages"), { senderUid: "bob", senderName: "bob", text: "hola" }));
    await assertFails(addDoc(collection(db, "activity"), { uid: "bob", kind: "add", audience: ["bob"] }));
    await assertFails(addDoc(collection(db, "pushQueue"), { fromUid: "bob", toUid: "bob", type: "reaction", title: "t", body: "b", sent: false, ts: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "friendships", "bob_carol"), { uids: ["bob", "carol"], status: "pending", requestedBy: "bob" }));
    await assertFails(setDoc(doc(db, "groupInvites", "g1_carol"), { fromUid: "bob", toUid: "carol", gid: "g1", status: "pending" }));
    await assertFails(setDoc(doc(db, "groups", "g9"), { name: "nuevo", createdBy: "bob", members: ["bob"], inviteCode: "ZZZ111" }));
  });
  it("suspendido: sigue leyendo lo suyo y puede borrar su cuenta; el resto sigue escribiendo con normalidad", async () => {
    await suspend("bob");
    await assertSucceeds(getDoc(doc(as("bob"), "users", "bob")));
    await assertSucceeds(deleteDoc(doc(as("bob"), "users", "bob")));
    await assertSucceeds(addDoc(collection(as("alice"), "chats", "alice_bob", "messages"), { senderUid: "alice", senderName: "alice", text: "hola" }));
  });
  it("los reportes los puede seguir enviando (denunciar a quien le suspende no es escribir hacia nadie)", async () => {
    await suspend("bob");
    await assertSucceeds(addDoc(collection(as("bob"), "reports"), { reporterUid: "bob", targetUid: "alice", kind: "user", refId: "alice", reason: "spam", ts: serverTimestamp(), status: "open" }));
  });
});

describe("cola de avisos: salud para el panel", () => {
  it("el admin lee pushQueue; nadie más, y nadie puede editarla ni borrarla desde un cliente", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "pushQueue", "p1"), { fromUid: "alice", toUid: "bob", type: "reaction", title: "t", body: "b", sent: false, ts: 1 }); });
    await assertSucceeds(getDocs(query(collection(as(ADMIN), "pushQueue"), orderBy("ts", "desc"), limit(300))));
    await assertFails(getDocs(query(collection(as("alice"), "pushQueue"), orderBy("ts", "desc"), limit(300))));
    await assertFails(updateDoc(doc(as(ADMIN), "pushQueue", "p1"), { sent: true }));
    await assertFails(deleteDoc(doc(as(ADMIN), "pushQueue", "p1")));
  });
});

describe("bloquear quita la amistad y no se puede recrear por un grupo", () => {
  const blockDoc = (owner, other) => setDoc(doc(as(owner), "users", owner, "blocked", other), { ts: serverTimestamp(), name: other });
  it("antes de bloquear, un amigo lee las cacas con ubicación; tras bloquear y borrar la amistad, ya no", async () => {
    await assertSucceeds(getDoc(doc(as("bob"), "users", "alice", "cacas", "c1")));
    await assertSucceeds(blockDoc("alice", "bob"));
    await assertSucceeds(deleteDoc(doc(as("alice"), "friendships", "alice_bob")));
    await assertFails(getDoc(doc(as("bob"), "users", "alice", "cacas", "c1")));
    await assertFails(getDoc(doc(as("bob"), "users", "alice")));
  });
  it("la amistad automática de grupo NO se recrea entre quien bloquea y el bloqueado (en ningún sentido)", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "users", "alice", "blocked", "bob"), { ts: 1, name: "bob" }); await deleteDoc(doc(c.firestore(), "friendships", "alice_bob")); });
    const f = { uids: ["alice", "bob"], status: "accepted", source: "group", gid: "g1", createdAt: serverTimestamp() };
    await assertFails(setDoc(doc(as("alice"), "friendships", "alice_bob"), f));      // la crea quien bloqueó
    await assertFails(setDoc(doc(as("bob"), "friendships", "alice_bob"), f));        // la crea el bloqueado
  });
  it("sin bloqueo, la amistad automática de grupo sigue funcionando", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(), "friendships", "alice_bob")); });
    await assertSucceeds(setDoc(doc(as("bob"), "friendships", "alice_bob"), { uids: ["alice", "bob"], status: "accepted", source: "group", gid: "g1", createdAt: serverTimestamp() }));
  });
  it("el bloqueo de otra pareja no estorba", async () => {
    await testEnv.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), "users", "carol", "blocked", "dave"), { ts: 1, name: "dave" }); });
    await assertSucceeds(setDoc(doc(as("eve"), "friendships", "alice_eve"), { uids: ["alice", "eve"], status: "accepted", source: "group", gid: "g2", createdAt: serverTimestamp() }));
  });
});
