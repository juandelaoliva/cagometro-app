// Tests de las reglas de Firestore contra el emulador.
//   npm test                → prueba ../firestore.rules.draft (el borrador endurecido)
//   RULES_FILE=../firestore.rules npm test   → prueba las reglas actualmente desplegadas
// Comparar los dos resultados enseña exactamente qué agujeros cierra el borrador.
import { readFileSync } from "node:fs";
import { describe, it, before, after, beforeEach } from "node:test";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, limit, serverTimestamp,
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
  it("unirse: se permite añadirse a uno mismo (limitación conocida: no comprueba el código)", async () => {
    await assertSucceeds(updateDoc(doc(as("carol"), "groups", "g1"), { members: ["alice", "bob", "carol"] }));
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
    const me = as("alice", { email: "Alice@x.com" });
    await assertSucceeds(setDoc(doc(me, "userLookup", "alice@x.com"), { uid: "alice" }));
  });
  it("userLookup: no se puede registrar el email de otro ni suplantar el uid", async () => {
    const me = as("carol", { email: "carol@x.com" });
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
