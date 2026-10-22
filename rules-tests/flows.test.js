// Ejecuta el store.js REAL (el de la app) contra los emuladores de Auth y Firestore.
//   npm test                                  → con ../firestore.rules.draft (reglas nuevas)
//   RULES_FILE=../firestore.rules npm test    → con las reglas actuales (compatibilidad)
// Cada flujo tiene que funcionar con las dos: el cliente se despliega por un lado y las
// reglas por otro, y no puede haber una ventana en la que la app deje de funcionar. Lo que
// solo existe con las reglas nuevas va con `itNew` y se omite con las actuales.
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection } from "firebase/firestore";

register("./loader.mjs", import.meta.url);
globalThis.location = { search: "", hostname: "localhost" };   // firebase.js lo lee al cargarse
const { auth } = await import("../firebase.js");
const S = await import("../store.js");

const RULES_FILE = process.env.RULES_FILE || "../firestore.rules.draft";
const NEW = RULES_FILE.endsWith(".draft");
const itNew = NEW ? it : it.skip;
const PW = "secret12";
let testEnv;
const uid = {};   // nombre → uid de Auth

// withSecurityRulesDisabled NO devuelve lo que devuelve su callback: hay que sacarlo por cierre.
const peek = async fn => { let out; await testEnv.withSecurityRulesDisabled(async c => { out = await fn(c.firestore()); }); return out; };
const exists = (...path) => peek(async db => (await getDoc(doc(db, ...path))).exists());
const data = (...path) => peek(async db => (await getDoc(doc(db, ...path))).data());
async function login(name) {
  await S.signOutUser();
  const email = `${name}@x.com`;
  try { await S.signIn(email, PW); } catch { await S.signUp(email, PW, name); }
  uid[name] = auth.currentUser.uid;
  return uid[name];
}
const rejects = (p, re) => assert.rejects(p, re);

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-cagometro",
    firestore: { rules: readFileSync(RULES_FILE, "utf8"), host: "127.0.0.1", port: 8081 },
  });
  console.log(`\n▶ flujos del cliente con: ${RULES_FILE}\n`);
});
after(async () => { await S.signOutUser(); await testEnv?.cleanup(); });
beforeEach(async () => {
  await S.signOutUser();
  await testEnv.clearFirestore();
  await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-cagometro/accounts", { method: "DELETE" });
  for (const k of Object.keys(uid)) delete uid[k];
});

describe("alta y perfil", () => {
  it("el alta crea el perfil y deja entrar", async () => {
    await login("alice");
    assert.equal((await data("users", uid.alice)).displayName, "alice");
  });
  itNew("el alta sincroniza el perfil público y la búsqueda por email", async () => {
    await login("alice");
    assert.equal((await data("publicProfiles", uid.alice)).displayName, "alice");
    assert.equal((await data("userLookup", "alice@x.com")).uid, uid.alice);
  });
  itNew("cambiar el nombre actualiza también el perfil público", async () => {
    await login("alice");
    await S.updateMe(uid.alice, { displayName: "Alicia" });
    await new Promise(r => setTimeout(r, 300));   // la escritura pública no se espera
    assert.equal((await data("publicProfiles", uid.alice)).displayName, "Alicia");
  });
  it("sumar una caca sigue funcionando", async () => {
    await login("alice");
    await S.addCaca(uid.alice, null, { name: "alice", color: "#000", audience: [uid.alice], groups: [] });
    assert.equal(S.yearCountOf(await S.getUser(uid.alice)), 1);
  });
});

describe("solicitudes de amistad", () => {
  it("buscar por email encuentra al usuario, y a nadie si no existe", async () => {
    await login("bob"); await login("alice");
    const f = await S.findUserByEmail("Bob@x.com");
    assert.equal(f.uid, uid.bob);
    assert.equal(f.displayName, "bob");
    assert.equal(await S.findUserByEmail("nadie@x.com"), null);
  });
  it("mandar una solicitud la deja pendiente, y repetirla avisa de que ya existe", async () => {
    await login("bob"); await login("alice");
    await S.sendFriendRequest(uid.alice, "bob@x.com");
    assert.equal((await data("friendships", [uid.alice, uid.bob].sort().join("_"))).status, "pending");
    await rejects(S.sendFriendRequest(uid.alice, "bob@x.com"), /exists/);
  });
  it("mandarse una solicitud a uno mismo se rechaza", async () => {
    await login("alice");
    await rejects(S.sendFriendRequest(uid.alice, "alice@x.com"), /self/);
  });
  it("quien recibe la solicitud puede ver el nombre de quien la manda", async () => {
    await login("bob"); await login("alice");
    await S.sendFriendRequest(uid.alice, "bob@x.com");
    await login("bob");
    const pend = (await S.myFriendships(uid.bob)).filter(f => f.status === "pending" && f.requestedBy !== uid.bob);
    assert.equal(pend.length, 1);
    assert.equal((await S.getUserLite(uid.alice)).displayName, "alice");
  });
  itNew("hasta aceptarla, no se ve el perfil completo; después sí", async () => {
    await login("bob"); await login("alice");
    await S.sendFriendRequest(uid.alice, "bob@x.com");
    await login("bob");
    await rejects(S.getUser(uid.alice), /permission|PERMISSION/i);
    await S.acceptFriend([uid.alice, uid.bob].sort().join("_"), uid.bob);
    assert.equal((await S.getUser(uid.alice)).displayName, "alice");
  });
  itNew("el solicitante no puede aceptar su propia solicitud", async () => {
    await login("bob"); await login("alice");
    await S.sendFriendRequest(uid.alice, "bob@x.com");
    await rejects(S.acceptFriend([uid.alice, uid.bob].sort().join("_"), uid.alice), /permission|PERMISSION/i);
  });
});

describe("enlace de amistad (?friend=)", () => {
  it("crea una solicitud pendiente, no una amistad", async () => {
    await login("bob"); await login("alice");
    assert.equal(await S.addFriendDirect(uid.alice, uid.bob), "requested");
    const f = await data("friendships", [uid.alice, uid.bob].sort().join("_"));
    assert.equal(f.status, "pending"); assert.equal(f.requestedBy, uid.alice); assert.equal(f.source, "link");
  });
  it("abrirlo dos veces no duplica nada", async () => {
    await login("bob"); await login("alice");
    await S.addFriendDirect(uid.alice, uid.bob);
    assert.equal(await S.addFriendDirect(uid.alice, uid.bob), "requested");
  });
  it("si él ya te había mandado solicitud, se cruzan y quedáis amigos", async () => {
    await login("alice"); await login("bob");
    await S.sendFriendRequest(uid.bob, "alice@x.com");   // bob → alice, pendiente
    await login("alice");                                // alice abre el enlace de bob
    assert.equal(await S.addFriendDirect(uid.alice, uid.bob), "accepted");
    assert.equal((await data("friendships", [uid.alice, uid.bob].sort().join("_"))).status, "accepted");
  });
  it("quien ya es amigo recibe «already»", async () => {
    await login("bob"); await login("alice");
    await S.sendFriendRequest(uid.alice, "bob@x.com");
    await login("bob"); await S.acceptFriend([uid.alice, uid.bob].sort().join("_"), uid.bob);
    assert.equal(await S.addFriendDirect(uid.bob, uid.alice), "already");
  });
  it("no se puede uno invitar a sí mismo", async () => {
    await login("alice");
    await rejects(S.addFriendDirect(uid.alice, uid.alice), /self/);
  });
});

describe("grupos", () => {
  it("crear un grupo y unirse con su código, y hacerse amigos de los miembros", async () => {
    await login("alice"); const g = await S.createGroup(uid.alice, "Los de siempre");
    await login("bob");
    const joined = await S.joinGroup(uid.bob, g.inviteCode.toLowerCase());   // el código no distingue mayúsculas
    assert.equal(joined.id, g.id);
    assert.deepEqual([...joined.members].sort(), [uid.alice, uid.bob].sort());
    const f = await data("friendships", [uid.alice, uid.bob].sort().join("_"));
    assert.equal(f.status, "accepted"); assert.equal(f.source, "group"); assert.equal(f.gid, g.id);
    assert.equal((await S.getUser(uid.alice)).displayName, "alice");   // ya amigos: se ve el perfil
  });
  itNew("crear un grupo registra su código de invitación", async () => {
    await login("alice"); const g = await S.createGroup(uid.alice, "G");
    assert.equal((await data("inviteCodes", g.inviteCode)).gid, g.id);
  });
  it("un código que no existe se rechaza", async () => {
    await login("alice");
    await rejects(S.joinGroup(uid.alice, "NOPE00"), /no-group/);
    await rejects(S.joinGroup(uid.alice, "  "), /no-group/);
  });
  it("unirse a un grupo del que ya eres miembro no falla", async () => {
    await login("alice"); const g = await S.createGroup(uid.alice, "G");
    await login("bob"); await S.joinGroup(uid.bob, g.inviteCode);
    const again = await S.joinGroup(uid.bob, g.inviteCode);
    assert.equal(again.members.filter(m => m === uid.bob).length, 1);
  });
  it("unirse con amigos que ya lo eran no rompe el lote", async () => {
    await login("bob"); await login("alice");
    await S.sendFriendRequest(uid.alice, "bob@x.com");
    await login("bob"); await S.acceptFriend([uid.alice, uid.bob].sort().join("_"), uid.bob);
    await login("alice"); const g = await S.createGroup(uid.alice, "G");
    await login("bob");
    const joined = await S.joinGroup(uid.bob, g.inviteCode);
    assert.ok(joined.members.includes(uid.bob));
  });
  it("una solicitud pendiente que mandaste al unirte al mismo grupo se resuelve sola", async () => {
    await login("alice"); const g = await S.createGroup(uid.alice, "G");
    await login("carol");
    await S.sendFriendRequest(uid.carol, "alice@x.com");        // carol → alice, pendiente
    await S.joinGroup(uid.carol, g.inviteCode);                 // ahora comparten grupo
    const f = await data("friendships", [uid.alice, uid.carol].sort().join("_"));
    assert.equal(f.status, "accepted"); assert.equal(f.source, "group");
  });
  it("una solicitud que te mandó el otro se acepta al unirte al grupo", async () => {
    await login("carol"); await login("alice"); const g = await S.createGroup(uid.alice, "G");
    await S.sendFriendRequest(uid.alice, "carol@x.com");        // alice → carol, pendiente
    await login("carol");
    await S.joinGroup(uid.carol, g.inviteCode);
    assert.equal((await data("friendships", [uid.alice, uid.carol].sort().join("_"))).status, "accepted");
  });
  it("aceptar una invitación a un grupo mete al grupo y hace amigos con los miembros", async () => {
    await login("alice"); const g = await S.createGroup(uid.alice, "G");
    await login("bob"); await S.joinGroup(uid.bob, g.inviteCode);
    await login("dave");
    await login("alice");
    await S.sendFriendRequest(uid.alice, "dave@x.com");
    await login("dave"); await S.acceptFriend([uid.alice, uid.dave].sort().join("_"), uid.dave);
    await login("alice"); await S.sendGroupInvite(uid.alice, uid.dave, g);
    await login("dave");
    const joined = await S.acceptGroupInvite({ id: `${g.id}_${uid.dave}`, gid: g.id }, uid.dave);
    assert.ok(joined.members.includes(uid.dave));
    assert.equal((await data("friendships", [uid.bob, uid.dave].sort().join("_"))).status, "accepted");
    assert.equal((await data("groupInvites", `${g.id}_${uid.dave}`)).status, "accepted");
  });
  it("aceptar la invitación de un grupo que ya no existe avisa con «group-gone»", async () => {
    await login("alice"); const g = await S.createGroup(uid.alice, "G");
    await login("dave");
    await login("alice"); await S.deleteGroup(g.id);
    await login("dave");
    await rejects(S.acceptGroupInvite({ id: "x_y", gid: g.id }, uid.dave), /group-gone/);
  });
  itNew("un desconocido no puede listar grupos para ver códigos", async () => {
    await login("alice"); await S.createGroup(uid.alice, "G");
    await login("carol");
    await rejects(getDocs(collection((await import("../firebase.js")).db, "groups")), /permission|PERMISSION/i);
  });
});
