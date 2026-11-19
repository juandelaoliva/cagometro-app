// ── Modo grabación (solo el administrador) ───────────────────────────────────
// Para grabar vídeos de promoción sin que se sepa quién es quién: en ESTA pantalla, cada persona y cada grupo se ven con un nombre
// inventado. Nunca se escribe un alias en los datos de nadie: los alias se aplican SOLO al pintar (N y G), y los objetos que se guardan
// (cacas, mensajes, eventos del feed) siguen llevando los nombres reales. Por eso, mientras está activo, la web no deja cambiar el
// nombre propio ni el de un grupo (se guardaría el alias).
//
// · Interruptor: por dispositivo (localStorage), para activarlo solo donde se graba.
// · Alias: estables (el mismo para la misma persona en el feed, el chat, el ranking…) y sin repetirse; se guardan en el documento
//   privado del administrador (`users/{uid}/private/rec`), así que son los mismos en la web y, más adelante, en la app.
// · Se pueden cambiar a mano (Ajustes → Modo grabación → Editar nombres) o regenerar todos.

const KEY = "cago_rec_on";
const PEOPLE = ["Lucía","Marcos","Sofía","Hugo","Martina","Pablo","Valeria","Daniel","Paula","Álvaro","Carla","Adrián","Elena","Diego","Irene",
  "Javier","Noa","Sergio","Claudia","Mario","Alba","Iván","Lola","Rubén","Nerea","Óscar","Vega","Gonzalo","Aitana","Bruno","Julia","Raúl",
  "Marta","Tomás","Inés","Víctor","Laura","Nico","Sara","Jaime","Carmen","Andrés","Ainhoa","Rodrigo","Lara","Fernando","Olivia","Samuel",
  "Blanca","Leo","Candela","Íñigo","Mía","Gabriel","Ana","Alejandro","Rocío","Manuel","Celia","Pedro","Eva","Jorge","Clara","Luis","Nuria",
  "Héctor","Lorena","Ismael","Alicia","Enzo","Patricia","Unai","Cristina","Marc","Teresa","Eric","Gema","Joel","Natalia","Aarón","Silvia",
  "Rafa","Mónica","Abel","Beatriz","Asier","Miriam","Saúl","Esther","Dani","Pilar","Kevin","Rosa","Iker","Judith","Mateo","Sonia","Lucas"];
const GROUPS = ["Los del curro","Familia","Pádel del jueves","Piso compartido","Los de siempre","Equipo B","Cuñados","Primos","Oficina 3ª planta",
  "Erasmus 2019","Amigos del pueblo","Running club","Despedida de Dani","Los del gym","Clase de 2º","Viaje a Lisboa","Turno de noche",
  "Vecinos del 4º","Fútbol 7","Grupo de estudio","Los de la uni","Cena de los viernes","Club de lectura","Camping 2024","Brunch dominguero"];

let enabled = false;          // ¿es el administrador? (si no, nada de esto existe)
let on = false;               // ¿modo activo en este dispositivo?
let people = {}, groups = {}; // uid → alias, gid → alias
let saveFn = null, saveTimer = 0;
const listeners = new Set();

try { on = localStorage.getItem(KEY) === "1"; } catch {}

/** Al entrar el administrador: qué alias hay guardados y cómo guardar los nuevos. */
export function initRec({ admin, aliases, save }) {
  enabled = !!admin;
  people = { ...(aliases?.people || {}) };
  groups = { ...(aliases?.groups || {}) };
  saveFn = save || null;
  emit();
}
export const recEnabled = () => enabled;
export const recOn = () => enabled && on;
export function setRecOn(v) { on = !!v; try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} emit(); }
export const onRecChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.warn("rec:", e); } }); }

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
/** El nombre que le toca a `key` de `pool`, sin repetir ninguno ya usado (si se acaban, con número). */
function pick(pool, used, key) {
  const i = hash(key) % pool.length;
  for (let k = 0; k < pool.length; k++) { const n = pool[(i + k) % pool.length]; if (!used.has(n)) return n; }
  let n = 2; while (used.has(`${pool[i]} ${n}`)) n++; return `${pool[i]} ${n}`;
}
function queueSave() {
  if (!saveFn) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveFn({ people, groups }).catch(e => console.warn("rec: guardar alias", e)); }, 1500);
}

/** El alias de una persona ("person") o un grupo ("group"), esté o no activo el modo (para editarlos antes de grabar). Lo asigna si no tiene. */
export function aliasOf(kind, id) {
  if (!enabled || !id) return "";
  const map = kind === "group" ? groups : people, pool = kind === "group" ? GROUPS : PEOPLE;
  if (!map[id]) { map[id] = pick(pool, new Set(Object.values(map)), id); queueSave(); }
  return map[id];
}
/** Nombre VISIBLE de una persona: su alias en modo grabación, el real si no. Sin uid no se puede (devuelve el real). */
export const N = (uid, real) => (!recOn() || !uid) ? real : aliasOf("person", uid);
/** Nombre VISIBLE de un grupo. */
export const G = (gid, real) => (!recOn() || !gid) ? real : aliasOf("group", gid);
/** Código de invitación de un grupo, inventado (6 caracteres estables) en modo grabación. */
export function C(gid, real) {
  if (!recOn() || !gid) return real;
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let h = hash("code:" + gid), s = "";
  for (let i = 0; i < 6; i++) { s += A[h % A.length]; h = Math.floor(h / A.length) || hash(s + gid); }
  return s;
}
/** Email visible: oculto en modo grabación. */
export const E = real => (recOn() ? "•••@•••" : real);

/** Para editar a mano: los alias asignados hasta ahora. */
export const recAliases = () => ({ people: { ...people }, groups: { ...groups } });
export function setAlias(kind, id, value) {
  const map = kind === "group" ? groups : people, v = String(value || "").trim().slice(0, 40);
  if (v) map[id] = v; else delete map[id];
  queueSave(); emit();
}
/** Nombres nuevos para todos (se vuelven a asignar según se vayan viendo). */
export function regenerateAliases() { people = {}; groups = {}; queueSave(); emit(); }
