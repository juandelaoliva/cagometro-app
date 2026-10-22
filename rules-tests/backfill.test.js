// Prueba tools/backfill-public-docs.cjs contra el emulador (con Admin SDK, sin reglas).
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, collection } from "firebase/firestore";

const SCRIPT = fileURLToPath(new URL("../tools/backfill-public-docs.cjs", import.meta.url));
const NODE_PATH = fileURLToPath(new URL("./node_modules", import.meta.url));
let testEnv;

const peek = async fn => { let out; await testEnv.withSecurityRulesDisabled(async c => { out = await fn(c.firestore()); }); return out; };
const ids = name => peek(async db => (await getDocs(collection(db, name))).docs.map(d => d.id).sort());
const get = (...p) => peek(async db => { const s = await getDoc(doc(db, ...p)); return s.exists() ? s.data() : null; });
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: "utf8",
  env: { ...process.env, NODE_PATH, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8081", GCLOUD_PROJECT: "demo-cagometro" },
});

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: "demo-cagometro", firestore: { host: "127.0.0.1", port: 8081 } });
});
after(async () => { await testEnv?.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await peek(async db => {
    await setDoc(doc(db, "users", "u1"), { displayName: "Uno", email: "U1@X.com", color: "#111" });
    await setDoc(doc(db, "users", "u2"), { displayName: "Dos", email: "u2@x.com" });
    await setDoc(doc(db, "users", "u3"), { displayName: "Tres" });                                  // sin email
    await setDoc(doc(db, "groups", "gA"), { name: "A", createdBy: "u1", members: ["u1", "u2"], inviteCode: "AAA111" });
    await setDoc(doc(db, "groups", "gB"), { name: "B", createdBy: "u2", members: ["u2", "u3"], inviteCode: "BBB222" });
    await setDoc(doc(db, "friendships", "u1_u2"), { uids: ["u1", "u2"], status: "accepted" });     // u2↔u3: falta
  });
});

describe("backfill-public-docs", () => {
  it("por defecto no escribe nada y lo cuenta", async () => {
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ensayo en seco/);
    assert.match(r.stdout, /perfiles públicos por crear \.+ 3/);
    assert.match(r.stdout, /códigos de invitación por crear \.+ 2/);
    assert.deepEqual(await ids("publicProfiles"), []);
    assert.deepEqual(await ids("userLookup"), []);
    assert.deepEqual(await ids("inviteCodes"), []);
  });
  it("--apply crea perfiles, búsquedas (email en minúsculas) y códigos, y marca a los usuarios", async () => {
    const r = run("--apply");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(await ids("publicProfiles"), ["u1", "u2", "u3"]);
    assert.deepEqual(await ids("userLookup"), ["u1@x.com", "u2@x.com"]);          // u3 no tiene email
    assert.deepEqual(await get("userLookup", "u1@x.com"), { uid: "u1" });
    assert.deepEqual(await get("inviteCodes", "AAA111"), { gid: "gA", createdBy: "u1" });
    assert.deepEqual(await get("publicProfiles", "u1"), { displayName: "Uno", color: "#111", photoURL: null });
    assert.equal((await get("users", "u1")).publicV, 1);
  });
  it("es idempotente: repetirlo no tiene nada que hacer", async () => {
    run("--apply");
    const r = run("--apply");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /perfiles públicos por crear \.+ 0/);
    assert.match(r.stdout, /búsquedas por email por crear \.+ 0/);
    assert.match(r.stdout, /códigos de invitación por crear \.+ 0/);
    assert.match(r.stdout, /usuarios por marcar \(publicV\) \.+ 0/);
  });
  it("audita las parejas de grupo sin amistad, sin crearlas por defecto", async () => {
    const r = run("--apply");
    assert.match(r.stdout, /SIN amistad aceptada: 1/);
    assert.match(r.stdout, /u2 ↔ u3 → inexistente/);
    assert.equal(await get("friendships", "u2_u3"), null);
  });
  it("--fix-friendships crea la amistad de grupo que falta, con su gid", async () => {
    const r = run("--apply", "--fix-friendships");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const f = await get("friendships", "u2_u3");
    assert.equal(f.status, "accepted"); assert.equal(f.source, "group"); assert.equal(f.gid, "gB");
    assert.deepEqual(f.uids, ["u2", "u3"]);
  });
  it("--fix-friendships acepta una solicitud pendiente entre dos miembros", async () => {
    await peek(db => setDoc(doc(db, "friendships", "u2_u3"), { uids: ["u2", "u3"], status: "pending", requestedBy: "u2" }));
    const r = run("--apply", "--fix-friendships");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const f = await get("friendships", "u2_u3");
    assert.equal(f.status, "accepted"); assert.equal(f.requestedBy, "u2");        // no pierde lo que tenía
  });
  it("un código duplicado entre grupos es un conflicto: sale con 1 y no lo pisa", async () => {
    await peek(db => setDoc(doc(db, "groups", "gC"), { name: "C", createdBy: "u3", members: ["u3"], inviteCode: "AAA111" }));
    const r = run("--apply");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /código «AAA111»: lo usan los grupos/);
    assert.equal((await get("inviteCodes", "AAA111")).gid, "gA");                  // el primero se queda
  });
  it("un email repetido entre dos usuarios es un conflicto", async () => {
    await peek(db => setDoc(doc(db, "users", "u4"), { displayName: "Cuatro", email: "u1@x.com" }));
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /email «u1@x\.com»: lo usan/);
  });
  it("contra un proyecto REAL se niega a escribir sin --yes", async () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--apply"], {
      encoding: "utf8", env: { ...process.env, NODE_PATH, FIRESTORE_EMULATOR_HOST: "", GCLOUD_PROJECT: "cagometro-app" },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /proyecto REAL/);
  });
});
