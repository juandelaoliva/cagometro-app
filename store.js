/* ============================================================
   Cagómetro · data layer (Firebase Auth + Firestore)
   Phase A+B: auth, per-year counter, +1/-1/set, friends.
   Counters are PER YEAR (totalCount = current year) but we also
   keep countsByYear{} and lifetimeCount so the profile can show
   per-year + all-time. Every caca is an event (history/stats).
   ============================================================ */
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, updateProfile,
  sendEmailVerification, sendPasswordResetEmail,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, writeBatch,
  serverTimestamp, query, where, orderBy, limit, onSnapshot, increment, getDocs,
  arrayUnion, arrayRemove, runTransaction,
} from "./firebase-bundle.js";

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
const yearNow = () => new Date().getFullYear();
// clave del contador mensual denormalizado: "AÑO_MESINDEX" (mes 0–11), p.ej. "2026_5" = junio 2026.
// Permite pintar la gráfica/ranking del grupo SIN leer las cacas de cada miembro (ahorro de cuota).
const monthKey = ts => { const d = new Date(ts); return `${d.getFullYear()}_${d.getMonth()}`; };
// rollups denormalizados por hora (0–23) y día de la semana (lunes=0 … domingo=6,
// igual que la UI). Guardados como mapas en el doc de usuario y mantenidos con
// increment() al sumar/deshacer → permiten pintar horas/día-semana de un amigo
// SIN leer sus cacas (paridad con tu perfil, coste 0 lecturas extra).
export const STATS_V = 2;
const hourOf = ts => new Date(ts).getHours();
const weekdayOf = ts => (new Date(ts).getDay()+6)%7;
export const colorForUid = uid => `hsl(${[...(uid||"x")].reduce((a,c)=>a+c.charCodeAt(0),0)*47 % 360} 45% 38%)`;

/* ---------- auth ---------- */
export const onUser = cb => onAuthStateChanged(auth, cb);
export const signOutUser = () => signOut(auth);
export const sendVerifEmail = user => sendEmailVerification(user);
export const resetPassword = email => sendPasswordResetEmail(auth, email);

export async function signUp(email, password, displayName){
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(user, { displayName });
  await ensureProfile(user, displayName);
  return user;
}
export async function signIn(email, password){
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  await ensureProfile(user);
  return user;
}
export async function googleSignIn(){
  const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
  await ensureProfile(user);
  return user;
}

/* ---------- profile ---------- */
export async function ensureProfile(user, displayName){
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    await setDoc(ref, {
      displayName: displayName || user.displayName || (user.email || "anónimo").split("@")[0],
      email: (user.email || "").toLowerCase() || null,
      photoURL: user.photoURL || null,
      color: colorForUid(user.uid),
      totalCount: 0,            // current year
      lifetimeCount: 0,
      countsByYear: {},
      countsByMonth: {},        // denormalizado por mes ("AÑO_MES") para stats de grupo sin leer cacas
      byHour: {},               // rollup por hora (0–23) — paridad de stats del amigo sin leer sus cacas
      byWeekday: {},            // rollup por día de la semana (lunes=0 … domingo=6)
      statsV: STATS_V,          // versión del esquema de stats (usuarios nuevos ya nacen al día)
      currentStreak: 0,         // días consecutivos con caca (actualizado en addCaca)
      longestStreak: 0,         // récord histórico de racha
      firstCacaTs: 0,           // ts de la primera caca (para media/día histórica)
      shareMap: true,           // comparte el mapa de cacas con amigos (activado por defecto)
      privacy: "friends_groups",
      locationMode: "never",    // never | choose | always
      tz: tz(),                 // zona horaria (para recordatorios inteligentes)
      lastCacaTs: 0,            // ts de la última caca (denormalizado)
      telegramUserId: null,
      telegramUsername: null,
      createdAt: serverTimestamp(),
    });
  } else if (snap.data().tz !== tz()) {
    updateDoc(ref, { tz: tz() }).catch(()=>{});   // mantener tz al día (viaje/nuevo dispositivo)
  }
  return ref;
}
export const watchMe = (uid, cb) =>
  onSnapshot(doc(db, "users", uid), s => cb(s.exists() ? { id:s.id, ...s.data() } : null));
export const getUser = async uid => { const s = await getDoc(doc(db,"users",uid)); return s.exists()?{id:s.id,...s.data()}:null; };
export const getGroup = async gid => { const s = await getDoc(doc(db,"groups",gid)); return s.exists()?{id:s.id,...s.data()}:null; };

/* ---------- counters (per-year) ---------- */
// Suma una caca. En una transacción: lee el total real, escribe la caca, sube los
// contadores y crea el evento de actividad con el `n` EXACTO (sin desfases).
export async function addCaca(uid, loc, act){
  const ts = Date.now(), y = yearNow();
  await runTransaction(db, async tx => {
    const uref = doc(db, "users", uid);
    const us = await tx.get(uref);
    const data = us.data() || {};
    const n = (data.totalCount || 0) + 1;
    const cdata = { uid, ts, tz:tz(), source:"app", year:y, createdAt:serverTimestamp() };
    if (loc && isFinite(loc.lat) && isFinite(loc.lng)) { cdata.lat = loc.lat; cdata.lng = loc.lng; }
    tx.set(doc(collection(db,"users",uid,"cacas")), cdata);
    // streak: consecutive-day logic
    const lastTs = data.lastCacaTs || 0;
    const d0 = new Date(ts); d0.setHours(0,0,0,0); const today0 = d0.getTime();
    const lastDay = new Date(lastTs); lastDay.setHours(0,0,0,0); const lastDay0 = lastDay.getTime();
    const cur = data.currentStreak || 0;
    const newStreak = lastTs === 0 ? 1 : lastDay0 === today0 ? cur : lastDay0 === today0 - 86400000 ? cur + 1 : 1;
    tx.update(uref, {
      totalCount: increment(1), lifetimeCount: increment(1),
      [`countsByYear.${y}`]: increment(1), [`countsByMonth.${monthKey(ts)}`]: increment(1),
      [`byHour.${hourOf(ts)}`]: increment(1), [`byWeekday.${weekdayOf(ts)}`]: increment(1),
      lastCacaTs: ts, tz: tz(),
      currentStreak: newStreak,
      longestStreak: Math.max(data.longestStreak || 0, newStreak),
      ...(data.firstCacaTs ? {} : { firstCacaTs: ts }),
    });
    if (act) tx.set(doc(collection(db,"activity")), {
      uid, kind:"add", name:act.name||"", color:act.color||"", ts, year:y, n,
      audience: act.audience?.length ? act.audience : [uid], groups: act.groups||[], reactions:{}, createdAt:serverTimestamp(),
      ...(cdata.lat!=null ? { lat:cdata.lat, lng:cdata.lng } : {}),
    });
  });
}
export const setLocationMode = (uid, mode) => updateDoc(doc(db, "users", uid), { locationMode: mode });

// ── Feed de actividad (fan-out en escritura) ────────────────────────────
// Un evento por caca; `audience` = uids que pueden verlo (amigos + miembros de
// grupo + el propio autor). El feed se lee con UNA consulta (array-contains),
// en vez de leer las cacas de cada persona. `groups` = grupos del autor (para
// que el lector pinte el chip si comparte grupo).
export const writeActivity = (author, data) =>
  addDoc(collection(db, "activity"), { uid: author, reactions: {}, createdAt: serverTimestamp(), ...data });
// Lectura puntual del feed (para pintarlo al instante al abrir/resume, sin depender
// de que el listener haya entregado todavía).
export async function getActivity(uid, n = 60){
  const s = await getDocs(query(collection(db, "activity"), where("audience", "array-contains", uid), orderBy("ts", "desc"), limit(n)));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
// Feed en tiempo real con UNA sola consulta (en vez de leer las cacas de cada persona).
export const watchActivity = (uid, cb, n = 60, onError) =>
  onSnapshot(query(collection(db, "activity"), where("audience", "array-contains", uid), orderBy("ts", "desc"), limit(n)),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => { if (onError) onError(e); });
// Ajustes del perfil (nickname, color, notificaciones…)
export const updateMe = (uid, patch) => updateDoc(doc(db, "users", uid), patch);

// ── Config global de la app (banner de mantenimiento) ─────────────────────
// Doc único `config/app`. Lo lee cualquiera autenticado; solo el admin lo escribe.
export const getAppConfig = async () => { try{ const s = await getDoc(doc(db,"config","app")); return s.exists() ? s.data() : null; }catch(e){ return null; } };
export const setMaintenance = (on, message) => setDoc(doc(db,"config","app"),
  { maintenance: !!on, ...(message != null ? { message } : {}), updatedAt: serverTimestamp() }, { merge:true });

// ── Push (FCM) ──────────────────────────────────────────────────────────
// Tokens del dispositivo en una subcolección PRIVADA (solo el dueño / el emisor admin).
export const saveToken   = (uid, token) => setDoc(doc(db,"users",uid,"private","push"), { tokens: arrayUnion(token) }, { merge:true });
export const removeToken = (uid, token) => updateDoc(doc(db,"users",uid,"private","push"), { tokens: arrayRemove(token) });
// Cola de envíos: el emisor (Raspberry, firebase-admin) la vigila y manda los push.
// `type` permite a la Pi decidir qué agrupar (p.ej. coalescer reacciones).
export const enqueuePush = (fromUid, toUid, type, title, body) =>
  addDoc(collection(db,"pushQueue"), { fromUid, toUid, type, title, body, sent:false, ts: serverTimestamp() });

// "late caca": add one at a chosen past time (/latecaca). Counts toward the YEAR
// of that timestamp; totalCount (current year) only bumps if it's this year.
export async function addCacaAt(uid, ts, act){
  const y = new Date(ts).getFullYear();
  await runTransaction(db, async tx => {
    const uref = doc(db, "users", uid);
    const us = await tx.get(uref);
    const data = us.data() || {};
    const cur = (y === yearNow()) ? (data.totalCount || 0) : (data.countsByYear?.[y] || 0);
    const n = cur + 1;
    tx.set(doc(collection(db,"users",uid,"cacas")), { uid, ts, tz:tz(), source:"app", year:y, late:true, createdAt:serverTimestamp() });
    const upd = { lifetimeCount:increment(1), [`countsByYear.${y}`]:increment(1), [`countsByMonth.${monthKey(ts)}`]:increment(1),
      [`byHour.${hourOf(ts)}`]:increment(1), [`byWeekday.${weekdayOf(ts)}`]:increment(1), tz:tz() };
    if (y === yearNow()) upd.totalCount = increment(1);
    upd.lastCacaTs = Math.max(data.lastCacaTs||0, ts);   // la más reciente (una olvidada pasada no la pisa)
    // firstCacaTs: apunta a la caca más antigua conocida
    if (!data.firstCacaTs || ts < data.firstCacaTs) upd.firstCacaTs = ts;
    tx.update(uref, upd);
    // El evento del feed se ordena por AHORA (sale arriba), pero recuerda la hora
    // indicada en `forTs` para mostrarla. La caca sí conserva su `ts` pasado.
    if (act) tx.set(doc(collection(db,"activity")), {
      uid, kind:"add", name:act.name||"", color:act.color||"", ts: Date.now(), forTs: ts, year:y, n, late:true,
      audience: act.audience?.length ? act.audience : [uid], groups: act.groups||[], reactions:{}, createdAt:serverTimestamp(),
    });
  });
}

// undo: borra la última caca, baja contadores y deja constancia en el feed (kind:"undo")
export async function removeCaca(uid, act){
  const me = await getUser(uid);
  if (!me || (me.totalCount||0) <= 0) return false;
  const snap = await getDocs(query(collection(db,"users",uid,"cacas"), orderBy("ts","desc"), limit(1)));
  if (snap.empty) return false;
  const last = snap.docs[0];
  const lastTs = last.data().ts;
  const y = new Date(lastTs).getFullYear();
  await deleteDoc(last.ref);
  const upd = { lifetimeCount:increment(-1), [`countsByYear.${y}`]:increment(-1), [`countsByMonth.${monthKey(lastTs)}`]:increment(-1) };
  if (y === yearNow()) upd.totalCount = increment(-1);
  // solo bajamos los rollups si el usuario ya está backfilleado (si no, tendrían huecos → negativos)
  if (me.statsV === STATS_V){ upd[`byHour.${hourOf(lastTs)}`]=increment(-1); upd[`byWeekday.${weekdayOf(lastTs)}`]=increment(-1); }
  await updateDoc(doc(db,"users",uid), upd);
  if (act) writeActivity(uid, { kind:"undo", name:act.name||"", color:act.color||"", ts:Date.now(), year:yearNow(),
    audience: act.audience?.length ? act.audience : [uid], groups: act.groups||[] }).catch(()=>{});
  return true;
}

// RESET total: borra TODAS las cacas del usuario, sus eventos de actividad y pone
// los contadores a 0. Deja constancia en el feed (kind:"reset"). Sin edición arbitraria.
export async function resetCacas(uid, act){
  // borra todas las cacas en lotes
  for(;;){
    const snap = await getDocs(query(collection(db,"users",uid,"cacas"), limit(400)));
    if (snap.empty) break;
    const b = writeBatch(db); snap.docs.forEach(d => b.delete(d.ref)); await b.commit();
    if (snap.size < 400) break;
  }
  // borra mis eventos de actividad antiguos (para no dejar el feed inconsistente)
  for(;;){
    const snap = await getDocs(query(collection(db,"activity"), where("uid","==",uid), limit(400)));
    if (snap.empty) break;
    const b = writeBatch(db); snap.docs.forEach(d => b.delete(d.ref)); await b.commit();
    if (snap.size < 400) break;
  }
  await updateDoc(doc(db,"users",uid), { totalCount:0, lifetimeCount:0, countsByYear:{}, countsByMonth:{}, byHour:{}, byWeekday:{}, statsV:STATS_V, lastCacaTs:0, currentStreak:0, longestStreak:0, firstCacaTs:0 });
  if (act) writeActivity(uid, { kind:"reset", name:act.name||"", color:act.color||"", ts:Date.now(), year:yearNow(),
    audience: act.audience?.length ? act.audience : [uid], groups: act.groups||[] }).catch(()=>{});
}

// Reacciones tipo Telegram: cada usuario puede poner varios emojis.
// Se guarda como mapa reactions:{ reactorUid: [emoji, …] } en el doc de la caca.
// add=true añade el emoji; add=false lo quita (arrayUnion/Remove → seguro ante concurrencia).
export const setReaction = (activityId, myUid, emoji, add) =>
  updateDoc(doc(db, "activity", activityId),
    { [`reactions.${myUid}`]: add ? arrayUnion(emoji) : arrayRemove(emoji) });

export async function myActivity(uid, n = 200){
  const snap = await getDocs(query(collection(db,"users",uid,"cacas"), orderBy("ts","desc"), limit(n)));
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

/* ---------- admin (gateado por uid en reglas) ---------- */
export async function adminListUsers(){
  const s = await getDocs(collection(db,"users"));
  return s.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function _delAll(q){   // borra en lotes los docs de una consulta
  for(;;){ const s = await getDocs(q); if(s.empty) break; const b=writeBatch(db); s.docs.forEach(d=>b.delete(d.ref)); await b.commit(); if(s.size<300) break; }
}
// Vacía por completo los datos de un usuario (NO borra su cuenta de Auth: eso es Admin SDK).
export async function adminWipeUser(targetUid){
  await _delAll(query(collection(db,"users",targetUid,"cacas"), limit(300)));
  await _delAll(query(collection(db,"activity"), where("uid","==",targetUid), limit(300)));
  await _delAll(query(collection(db,"friendships"), where("uids","array-contains",targetUid), limit(300)));
  // sacarlo de todos los grupos
  for(;;){ const s=await getDocs(query(collection(db,"groups"), where("members","array-contains",targetUid), limit(300))); if(s.empty)break; const b=writeBatch(db); s.docs.forEach(d=>b.update(d.ref,{members:arrayRemove(targetUid)})); await b.commit(); if(s.size<300)break; }
  try{ await deleteDoc(doc(db,"users",targetUid,"private","push")); }catch(e){}
  await deleteDoc(doc(db,"users",targetUid));
}

/* ---------- friends ---------- */
const pairId = (a,b) => [a,b].sort().join("_");

export async function findUserByEmail(email){
  const snap = await getDocs(query(collection(db,"users"), where("email","==",(email||"").toLowerCase().trim()), limit(1)));
  return snap.empty ? null : { uid:snap.docs[0].id, ...snap.docs[0].data() };
}
export async function sendFriendRequest(myUid, email){
  const other = await findUserByEmail(email);
  if (!other) throw new Error("no-user");
  if (other.uid === myUid) throw new Error("self");
  await setDoc(doc(db,"friendships", pairId(myUid, other.uid)),
    { uids:[myUid, other.uid], status:"pending", requestedBy:myUid, createdAt:serverTimestamp() }, { merge:true });
  const me = await getUser(myUid);
  enqueuePush(myUid, other.uid, "friend_request", "Nueva solicitud de amistad 👋", `${me?.displayName||"Alguien"} quiere ser tu amigo/a`).catch(()=>{});
  return other;
}
export async function acceptFriend(id, myUid){
  const ref = doc(db,"friendships",id);
  const snap = await getDoc(ref);
  await updateDoc(ref, { status:"accepted" });
  const requester = snap.exists() ? snap.data().requestedBy : null;
  if(requester && requester!==myUid){
    const me = await getUser(myUid);
    enqueuePush(myUid, requester, "friend_accepted", "¡Nueva amistad! 🤝", `${me?.displayName||"Alguien"} aceptó tu solicitud`).catch(()=>{});
  }
}
export const removeFriend = id => deleteDoc(doc(db,"friendships",id));

// Amistad directa (desde un enlace de invitación): el que abre el enlace acepta
// y quedáis amigos al instante, sin solicitud pendiente.
export async function addFriendDirect(myUid, otherUid){
  if (otherUid === myUid) throw new Error("self");
  await setDoc(doc(db,"friendships", pairId(myUid, otherUid)),
    { uids:[myUid, otherUid].sort(), status:"accepted", source:"link", createdAt:serverTimestamp() }, { merge:true });
  const me = await getUser(myUid);
  enqueuePush(myUid, otherUid, "friend_accepted", "¡Nueva amistad! 🤝", `${me?.displayName||"Alguien"} aceptó tu invitación`).catch(()=>{});
}

// Listeners en tiempo real para el centro de notificaciones in-app
export const watchFriendships = (myUid, cb) =>
  onSnapshot(query(collection(db,"friendships"), where("uids","array-contains",myUid)),
    s => cb(s.docs.map(d => ({ id:d.id, ...d.data() }))));
export const watchMyCacas = (myUid, cb, n = 40) =>
  onSnapshot(query(collection(db,"users",myUid,"cacas"), orderBy("ts","desc"), limit(n)),
    s => cb(s.docs.map(d => ({ id:d.id, ...d.data() }))));

export async function myFriendships(myUid){
  const snap = await getDocs(query(collection(db,"friendships"), where("uids","array-contains",myUid)));
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

// accepted friends' profiles (for leaderboard); other = the non-me uid
export async function getFriends(myUid){
  const fs = (await myFriendships(myUid)).filter(f => f.status === "accepted");
  const others = fs.map(f => f.uids.find(u => u !== myUid));
  const users = await Promise.all(others.map(getUser));
  return users.filter(Boolean);
}

// merged recent activity of accepted friends
export async function friendsFeed(myUid, perFriend = 5){
  const friends = await getFriends(myUid);
  const chunks = await Promise.all(friends.map(async f => {
    const snap = await getDocs(query(collection(db,"users",f.id,"cacas"), orderBy("ts","desc"), limit(perFriend)));
    return snap.docs.map(d => ({ ...d.data(), name:f.displayName, color:f.color || colorForUid(f.id) }));
  }));
  return chunks.flat().sort((a,b)=>b.ts-a.ts).slice(0,25);
}

/* ---------- groups ---------- */
const genCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export async function createGroup(uid, name){
  const ref = await addDoc(collection(db,"groups"), {
    name: (name||"").trim() || "Mi grupo", createdBy: uid, members: [uid],
    inviteCode: genCode(), createdAt: serverTimestamp(),
  });
  return { id: ref.id, ...(await getDoc(ref)).data() };
}
export async function joinGroup(uid, code){
  const snap = await getDocs(query(collection(db,"groups"), where("inviteCode","==",(code||"").toUpperCase().trim()), limit(1)));
  if (snap.empty) throw new Error("no-group");
  const g = snap.docs[0];
  const others = (g.data().members||[]).filter(m => m !== uid);
  if (!(g.data().members||[]).includes(uid)) await updateDoc(g.ref, { members: arrayUnion(uid) });
  // auto-amigos: te haces amigo (aceptado) de todos los miembros actuales
  if (others.length){
    const batch = writeBatch(db);
    for (const m of others)
      batch.set(doc(db,"friendships",pairId(uid,m)), { uids:[uid,m].sort(), status:"accepted", source:"group", createdAt:serverTimestamp() }, { merge:true });
    await batch.commit();
  }
  return { id: g.id, ...(await getDoc(g.ref)).data() };
}
export const leaveGroup = (gid, uid) => updateDoc(doc(db,"groups",gid), { members: arrayRemove(uid) });
export const renameGroup = (gid, name) => updateDoc(doc(db,"groups",gid), { name: name.trim() });
export const kickFromGroup = (gid, uid) => updateDoc(doc(db,"groups",gid), { members: arrayRemove(uid) });
export const deleteGroup = (gid) => deleteDoc(doc(db,"groups",gid));

export async function myGroups(uid){
  const snap = await getDocs(query(collection(db,"groups"), where("members","array-contains",uid)));
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

// leaderboard (members' current-year totals, desc)
export async function groupLeaderboard(group){
  const users = await Promise.all((group.members||[]).map(getUser));
  return users.filter(Boolean).sort((a,b)=>(b.totalCount||0)-(a.totalCount||0));
}
// merged recent activity of group members
export async function groupFeed(group, perMember = 4){
  const chunks = await Promise.all((group.members||[]).map(async m => {
    const u = await getUser(m); if (!u) return [];
    const snap = await getDocs(query(collection(db,"users",m,"cacas"), orderBy("ts","desc"), limit(perMember)));
    return snap.docs.map(d => ({ ...d.data(), name:u.displayName, color:u.color || colorForUid(m) }));
  }));
  return chunks.flat().sort((a,b)=>b.ts-a.ts).slice(0,25);
}
// cacas recientes de cada miembro desde `sinceTs` (para el ranking "Semana", bajo demanda).
// Acotado con limit() para no quemar cuota: leemos como mucho las N últimas por miembro.
export async function groupCacasSince(group, sinceTs, perMember = 60){
  const chunks = await Promise.all((group.members||[]).map(async m => {
    const snap = await getDocs(query(collection(db,"users",m,"cacas"), orderBy("ts","desc"), limit(perMember)));
    return snap.docs.map(d => ({ uid:m, ts:d.data().ts })).filter(c => c.ts >= sinceTs);
  }));
  return chunks.flat();
}

/* ---------- combined home feed (you + friends + groups) ---------- */
// Each entry is tagged with its context(s) relative to you: "tú" / "amigo" /
// group name(s). Someone who's both your friend AND in your group gets several.
// `n` = the counter number that caca reached (most recent = current total).
// `pre` = [friendsArr, groups] ya cargados (evita re-leerlos desde loadActivity).
export async function homeFeed(uid, perPerson = 12, pre){
  const [friendsArr, groups] = pre || await Promise.all([ getFriends(uid), myGroups(uid) ]);
  const ctx = {};                              // personUid -> [{type,name?,gid?}]
  const push = (u, c) => { (ctx[u] = ctx[u] || []).push(c); };
  push(uid, { type: "tú" });
  friendsArr.forEach(f => push(f.id, { type: "amigo" }));
  groups.forEach(g => (g.members||[]).forEach(m => { if (m !== uid) push(m, { type: "group", gid: g.id, name: g.name }); }));

  // mapa de perfiles: reutiliza los de amigos; solo lee los que falten (yo + miembros de grupo no-amigos)
  const usersMap = {};
  friendsArr.forEach(u => { usersMap[u.id] = u; });
  const missing = Object.keys(ctx).filter(p => !usersMap[p]);
  (await Promise.all(missing.map(getUser))).forEach((u, i) => { if (u) usersMap[missing[i]] = u; });

  const chunks = await Promise.all(Object.keys(ctx).map(async p => {
    const u = usersMap[p]; if (!u) return [];
    const snap = await getDocs(query(collection(db,"users",p,"cacas"), orderBy("ts","desc"), limit(perPerson)));
    const total = u.totalCount || 0;
    return snap.docs.map((d, i) => ({
      ...d.data(), id: d.id, uid: p, name: u.displayName, color: u.color || colorForUid(p),
      contexts: ctx[p], n: Math.max(1, total - i),
    }));
  }));
  return chunks.flat().sort((a,b) => b.ts - a.ts);
}

// all current-year cacas of a group's members (for group stats / combined chart)
export async function groupYearCacas(group){
  const year = new Date().getFullYear();
  const chunks = await Promise.all((group.members||[]).map(async m => {
    const u = await getUser(m);
    const snap = await getDocs(query(collection(db,"users",m,"cacas"), where("year","==",year), limit(3000)));
    return snap.docs.map(d => ({ ...d.data(), uid:m, name:u?.displayName||"?" }));
  }));
  return chunks.flat();
}

// Cacas CON UBICACIÓN de los miembros del grupo, para el mapa del grupo.
// Respeta la privacidad: omite a quien tenga shareMap desactivado. Cada punto lleva
// el uid/nombre/color de su dueño para pintar el marcador y la leyenda.
//
// DECISIÓN (2026-07): el mapa del grupo muestra TODOS LOS AÑOS (no solo el actual),
// para que coincida con el mapa personal de cada uno, AUNQUE cueste más lecturas.
// COSTE / MEJORA FUTURA: hoy leemos hasta 3000 cacas por miembro y filtramos en el
// cliente las que llevan lat/lng → es caro (leemos el histórico entero) y no está
// denormalizado. Idea a futuro: guardar las ubicaciones aparte y escribirlas al sumar
// una caca con ubicación (p.ej. una subcolección `users/{uid}/locations` con
// {lat,lng,ts}, o un array denormalizado en el doc), y leer SOLO esos puntos en vez
// de recorrer todas las cacas. Ver FEATURES.md · Decisiones.
export async function groupLocatedCacas(group){
  const chunks = await Promise.all((group.members||[]).map(async m => {
    const u = await getUser(m);
    if (!u || u.shareMap === false) return [];              // respeta "compartir mapa"
    const snap = await getDocs(query(collection(db,"users",m,"cacas"), orderBy("ts","desc"), limit(3000)));
    return snap.docs
      .map(d => d.data())
      .filter(c => isFinite(c.lat) && isFinite(c.lng))
      .map(c => ({ uid:m, name:u.displayName||"?", color:u.color||colorForUid(m), lat:c.lat, lng:c.lng, ts:c.ts }));
  }));
  return chunks.flat();
}

// ── Offline outbox ────────────────────────────────────────────────────────────
// Cola local (localStorage) para cacas añadidas sin conexión.
// Cada entrada: { ts, tz, loc: {lat,lng}|null }
const OUTBOX_KEY = "cago_outbox";
export const outboxGet = () => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)||"[]"); } catch{ return []; } };
const outboxSave = q => localStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
export const outboxAdd  = entry => { const q=outboxGet(); q.push(entry); outboxSave(q); };
export const outboxClear = () => localStorage.removeItem(OUTBOX_KEY);

export async function outboxFlush(uid, actFn) {
  const queue = outboxGet();
  if (!queue.length) return 0;
  let flushed = 0;
  for (const entry of queue) {
    try {
      await addCacaAt(uid, entry.ts, actFn ? actFn(entry) : null);
      flushed++;
    } catch(e) { console.warn("outboxFlush: error en entrada", entry, e); break; }
  }
  if (flushed === queue.length) outboxClear();
  else outboxSave(queue.slice(flushed));
  return flushed;
}

// ── Invitaciones a grupos ─────────────────────────────────────────────────────
// ID determinista para evitar duplicados: un usuario solo puede tener una invitación
// pendiente por grupo al mismo tiempo.
const groupInviteId = (gid, toUid) => `${gid}_${toUid}`;

export async function sendGroupInvite(fromUid, toUid, group){
  const me = await getUser(fromUid);
  const invitee = await getUser(toUid);
  const inviteRef = doc(db, "groupInvites", groupInviteId(group.id, toUid));
  const existing = await getDoc(inviteRef);
  if (existing.exists() && existing.data().status === "pending") return; // ya hay una pendiente
  if (existing.exists()) await deleteDoc(inviteRef); // recrea si era declined/accepted
  await setDoc(inviteRef, {
    gid: group.id,
    groupName: group.name,
    fromUid,
    fromName: me?.displayName || "Alguien",
    toUid,
    status: "pending",
    members: group.members || [],
    memberNames: await Promise.all((group.members||[]).filter(m=>m!==toUid).map(async m => {
      const u = await getUser(m); return u?.displayName || "?";
    })),
    createdAt: serverTimestamp(),
  });
  enqueuePush(fromUid, toUid, "group_invite",
    "Invitación a grupo 💩",
    `${me?.displayName||"Alguien"} te ha invitado al grupo "${group.name}"`
  ).catch(()=>{});
}

export const watchGroupInvites = (uid, cb) =>
  onSnapshot(query(collection(db,"groupInvites"), where("toUid","==",uid), where("status","==","pending")), s =>
    cb(s.docs.map(d => ({ id: d.id, ...d.data() })))
  );

export async function acceptGroupInvite(invite, uid){
  // Reutilizamos la lógica de joinGroup: añade al grupo y auto-amiga a todos los miembros actuales
  const groupRef = doc(db, "groups", invite.gid);
  const gsnap = await getDoc(groupRef);
  if (!gsnap.exists()) throw new Error("group-gone");
  const currentMembers = gsnap.data().members || [];
  const others = currentMembers.filter(m => m !== uid);
  if (!currentMembers.includes(uid)) await updateDoc(groupRef, { members: arrayUnion(uid) });
  if (others.length){
    const batch = writeBatch(db);
    for (const m of others)
      batch.set(doc(db,"friendships",pairId(uid,m)), { uids:[uid,m].sort(), status:"accepted", source:"group", createdAt:serverTimestamp() }, { merge:true });
    await batch.commit();
  }
  await updateDoc(doc(db,"groupInvites",invite.id), { status: "accepted" });
  return { id: gsnap.id, ...gsnap.data(), members: [...new Set([...currentMembers, uid])] };
}

export const declineGroupInvite = (inviteId) =>
  updateDoc(doc(db,"groupInvites",inviteId), { status: "declined" });

// ── Chat ─────────────────────────────────────────────────────────────────────

// Garantiza que el doc /chats/{chatId} existe. Idempotente (merge:true).
async function ensureChatDoc(chatId, type, members){
  await setDoc(doc(db,"chats",chatId), { type, members, lastTs: null }, { merge: true });
}

// DM: chatId = pairId. Crea el doc si no existe.
export async function getOrCreateDM(uid1, uid2){
  const chatId = pairId(uid1, uid2);
  await ensureChatDoc(chatId, "dm", [uid1, uid2].sort());
  return chatId;
}

// Grupo: chatId = gid. Crea el doc si no existe.
export async function ensureGroupChat(gid, members){
  await ensureChatDoc(gid, "group", members);
  return gid;
}

// Envía un mensaje. Actualiza lastMessage y lastTs en el chat doc.
export async function sendMessage(chatId, senderUid, senderName, text){
  const clientTs = Date.now();
  await addDoc(collection(db,"chats",chatId,"messages"), {
    senderUid, senderName,
    text: text.trim(),
    ts: serverTimestamp(),
    clientTs,
    reactions: {},
  });
  await updateDoc(doc(db,"chats",chatId), {
    lastMessage: { text: text.trim(), senderName, ts: clientTs },
    lastTs: serverTimestamp(),
  });
}

// Marca el chat como leído actualizando lastReadTs del usuario.
export const markChatRead = (chatId, uid) =>
  updateDoc(doc(db,"chats",chatId), { [`lastReadTs.${uid}`]: serverTimestamp() });

// Listener de todos los chats del usuario, ordenados por lastTs desc.
export const watchChats = (uid, cb) =>
  onSnapshot(
    query(collection(db,"chats"), where("members","array-contains",uid)),
    snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a,b) => (b.lastTs?.toMillis?.()??0) - (a.lastTs?.toMillis?.()??0));
      cb(docs);
    }
  );

// Listener de mensajes (últimos N), más recientes primero → se invierten al renderizar.
export const watchMessages = (chatId, cb, n=30) =>
  onSnapshot(
    query(collection(db,"chats",chatId,"messages"), orderBy("ts","desc"), limit(n)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse())
  );

// Carga mensajes anteriores al más antiguo cargado.
export const loadOlderMessages = async (chatId, beforeClientTs, n=30) => {
  const snap = await getDocs(
    query(collection(db,"chats",chatId,"messages"), orderBy("clientTs","desc"), where("clientTs","<",beforeClientTs), limit(n))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
};

// Reaccionar a un mensaje (toggle).
export async function reactToMessage(chatId, msgId, uid, emoji){
  const ref = doc(db,"chats",chatId,"messages",msgId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return;
  const reactions = snap.data().reactions || {};
  const uids = reactions[emoji] || [];
  const next = uids.includes(uid) ? uids.filter(u=>u!==uid) : [...uids, uid];
  await updateDoc(ref, { [`reactions.${emoji}`]: next });
}

// Push de nuevo mensaje a todos los miembros excepto el sender.
export async function notifyNewMessage(chatId, senderUid, senderName, text, members){
  const targets = members.filter(m => m !== senderUid);
  await Promise.all(targets.map(toUid =>
    enqueuePush(senderUid, toUid, "chat_message",
      senderName,
      text.length > 80 ? text.slice(0,77)+"…" : text
    ).catch(()=>{})
  ));
}
