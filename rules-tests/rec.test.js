// Modo grabación (rec.js): alias solo para el administrador, estables, sin repetirse, y nunca activos para nadie más.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const R = await import("../rec.js");

describe("modo grabación", () => {
  it("para quien NO es administrador no cambia nada, aunque el interruptor esté encendido", () => {
    R.initRec({ admin: false });
    R.setRecOn(true);
    assert.equal(R.recOn(), false);
    assert.equal(R.N("u1", "Juan"), "Juan");
    assert.equal(R.G("g1", "Familia real"), "Familia real");
    assert.equal(R.C("g1", "ABC123"), "ABC123");
    assert.equal(R.E("juan@x.com"), "juan@x.com");
    assert.equal(R.aliasOf("person", "u1"), "");
  });

  it("administrador con el modo apagado: nombres reales", () => {
    R.initRec({ admin: true, aliases: null });
    R.setRecOn(false);
    assert.equal(R.N("u1", "Juan"), "Juan");
  });

  it("administrador con el modo encendido: alias estables, distintos y que se guardan", async () => {
    const saved = [];
    R.initRec({ admin: true, aliases: null, save: async d => { saved.push(JSON.parse(JSON.stringify(d))); } });
    R.setRecOn(true);
    const a = R.N("u1", "Juan"), b = R.N("u2", "Pepe");
    assert.notEqual(a, "Juan"); assert.notEqual(b, "Pepe"); assert.notEqual(a, b);
    assert.equal(R.N("u1", "Juan"), a, "la misma persona, el mismo alias");
    const names = new Set(Array.from({ length: 150 }, (_, i) => R.N("x" + i, "?")));
    assert.equal(names.size, 150, "150 personas, 150 alias distintos (se numeran si se acaba la lista)");
    assert.notEqual(R.G("g1", "Familia real"), "Familia real");
    assert.equal(R.E("juan@x.com"), "•••@•••");
    assert.match(R.C("g1", "ABC123"), /^[A-Z2-9]{6}$/);
    assert.equal(R.C("g1", "ABC123"), R.C("g1", "ABC123"));
    assert.equal(R.N(undefined, "Sin uid"), "Sin uid", "sin uid no se puede: el real");
    await new Promise(r => setTimeout(r, 1600));
    assert.ok(saved.length >= 1 && saved.at(-1).people.u1 === a, "los alias asignados se guardan");
  });

  it("a mano, vacío vuelve a automático, y regenerar los cambia", () => {
    R.initRec({ admin: true, aliases: { people: { u1: "Carlos" }, groups: {} } });
    R.setRecOn(true);
    assert.equal(R.N("u1", "Juan"), "Carlos", "respeta los guardados");
    R.setAlias("person", "u1", "Paco");
    assert.equal(R.N("u1", "Juan"), "Paco");
    R.setAlias("person", "u1", "  ");
    assert.notEqual(R.N("u1", "Juan"), "Paco");
    R.regenerateAliases();
    assert.deepEqual(R.recAliases().people, {});
  });
});
