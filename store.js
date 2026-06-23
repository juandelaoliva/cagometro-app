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
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, writeBatch,
  serverTimestamp, query, where, orderBy, limit, onSnapshot, increment, getDocs,
  arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
const yearNow = () => new Date().getFullYear();
export const colorForUid = uid => `hsl(${[...(uid||"x")].reduce((a,c)=>a+c.charCodeAt(0),0)*47 % 360} 45% 38%)`;

/* ---------- auth ---------- */
export const onUser = cb => onAuthStateChanged(auth, cb);
export const signOutUser = () => signOut(auth);

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
      privacy: "friends_groups",
      locationMode: "never",    // never | choose | always
      telegramUserId: null,
      telegramUsername: null,
      createdAt: serverTimestamp(),
    });
  }
  return ref;
}
export const watchMe = (uid, cb) =>
  onSnapshot(doc(db, "users", uid), s => cb(s.exists() ? { id:s.id, ...s.data() } : null));
export const getUser = async uid => { const s = await getDoc(doc(db,"users",uid)); return s.exists()?{id:s.id,...s.data()}:null; };

/* ---------- counters (per-year) ---------- */
export async function addCaca(uid, loc){
  const y = yearNow();
  const data = { uid, ts:Date.now(), tz:tz(), source:"app", year:y, createdAt:serverTimestamp() };
  if (loc && isFinite(loc.lat) && isFinite(loc.lng)) { data.lat = loc.lat; data.lng = loc.lng; }
  await addDoc(collection(db, "users", uid, "cacas"), data);
  await updateDoc(doc(db, "users", uid), { totalCount:increment(1), lifetimeCount:increment(1), [`countsByYear.${y}`]:increment(1) });
}
export const setLocationMode = (uid, mode) => updateDoc(doc(db, "users", uid), { locationMode: mode });

// ── Feed de actividad (fan-out en escritura) ────────────────────────────
// Un evento por caca; `audience` = uids que pueden verlo (amigos + miembros de
// grupo + el propio autor). El feed se lee con UNA consulta (array-contains),
// en vez de leer las cacas de cada persona. `groups` = grupos del autor (para
// que el lector pinte el chip si comparte grupo).
export const writeActivity = (author, data) =>
  addDoc(collection(db, "activity"), { uid: author, reactions: {}, createdAt: serverTimestamp(), ...data });
// Feed en tiempo real con UNA sola consulta (en vez de leer las cacas de cada persona).
export const watchActivity = (uid, cb, n = 60, onError) =>
  onSnapshot(query(collection(db, "activity"), where("audience", "array-contains", uid), orderBy("ts", "desc"), limit(n)),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => { if (onError) onError(e); });
// Ajustes del perfil (nickname, color, notificaciones…)
export const updateMe = (uid, patch) => updateDoc(doc(db, "users", uid), patch);

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
export async function addCacaAt(uid, ts){
  const y = new Date(ts).getFullYear();
  await addDoc(collection(db, "users", uid, "cacas"), { uid, ts, tz: tz(), source: "app", year: y, late: true, createdAt: serverTimestamp() });
  const upd = { lifetimeCount: increment(1), [`countsByYear.${y}`]: increment(1) };
  if (y === new Date().getFullYear()) upd.totalCount = increment(1);
  await updateDoc(doc(db, "users", uid), upd);
}

// undo: delete most recent caca, decrement (never below 0)
export async function removeCaca(uid){
  const me = await getUser(uid);
  if (!me || (me.totalCount||0) <= 0) return false;
  const snap = await getDocs(query(collection(db,"users",uid,"cacas"), orderBy("ts","desc"), limit(1)));
  if (snap.empty) return false;
  const last = snap.docs[0];
  const y = new Date(last.data().ts).getFullYear();
  await deleteDoc(last.ref);
  const upd = { lifetimeCount:increment(-1), [`countsByYear.${y}`]:increment(-1) };
  if (y === yearNow()) upd.totalCount = increment(-1);
  await updateDoc(doc(db,"users",uid), upd);
  return true;
}

// correct the current-year count to N (reconciles events; capped for safety)
export async function setCount(uid, n){
  n = Math.max(0, Math.min(2000, Math.floor(n)));
  const me = await getUser(uid);
  const cur = me?.totalCount || 0;
  let delta = n - cur;
  const y = yearNow();
  delta = Math.max(-300, Math.min(300, delta));   // batch-safe cap
  if (delta === 0) return 0;
  const batch = writeBatch(db);
  if (delta > 0){
    for (let i=0;i<delta;i++)
      batch.set(doc(collection(db,"users",uid,"cacas")), { uid, ts:Date.now()-i*1000, tz:tz(), source:"app", year:y, createdAt:serverTimestamp() });
  } else {
    const snap = await getDocs(query(collection(db,"users",uid,"cacas"), orderBy("ts","desc"), limit(-delta)));
    snap.docs.forEach(d => batch.delete(d.ref));
  }
  batch.update(doc(db,"users",uid), { totalCount:increment(delta), lifetimeCount:increment(delta), [`countsByYear.${y}`]:increment(delta) });
  await batch.commit();
  return delta;
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
