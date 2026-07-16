/* ============================================================
   Cagómetro · UI (Firebase) — Phases A + A+ + B
   ============================================================ */
import {
  onUser, signOutUser, signUp, signIn, googleSignIn, ensureProfile, sendVerifEmail, resetPassword,
  watchMe, addCaca, addCacaAt, removeCaca, resetCacas, setLocationMode, updateMe, myActivity,
  sendFriendRequest, myFriendships, acceptFriend, removeFriend, addFriendDirect, getFriends,
  setReaction, watchFriendships, watchActivity, getActivity, saveToken, removeToken, enqueuePush, writeActivity,
  adminListUsers, adminWipeUser, getAppConfig, setMaintenance,
  createGroup, joinGroup, leaveGroup, myGroups, groupLeaderboard, groupYearCacas, groupCacasSince, groupLocatedCacas,
  getUser, colorForUid, outboxAdd, outboxGet, outboxFlush,
  sendGroupInvite, watchGroupInvites, acceptGroupInvite, declineGroupInvite,
  renameGroup, kickFromGroup, deleteGroup,
  getOrCreateDM, ensureGroupChat, sendMessage, markChatRead,
  watchChats, watchMessages, loadOlderMessages, reactToMessage, notifyNewMessage,
  getGroup, STATS_V
} from "./store.js";
import { IS_LOCAL, VAPID_KEY, auth, getMessagingIfSupported, getToken, onMessage } from "./firebase.js";
import { t, getLang, setLang, mapLoadingPhrase } from "./i18n.js";
import { FUN_FACTS } from "./funfacts.js";

const $ = id => document.getElementById(id);
window.__appBooted = true;   // el bundle (Firebase + app) cargó: desactiva el failsafe del index

// ── Modo mantenimiento ─────────────────────────────────────────────────────
// MAINT_FORCE: aviso forzado desde el CÓDIGO, para cortes en los que ni siquiera
// se puede leer Firestore (p.ej. cuota de lecturas agotada). Mientras esté en true,
// el banner se muestra siempre. Cuando esté en false, manda el toggle del panel
// admin (config/app.maintenance), que se lee al arrancar.
const MAINT_FORCE = false;
let maintOn = false;
function applyMaintenance(on, msg){
  maintOn = !!on;
  const bar = $("maintBar");
  if(bar){ bar.innerHTML = (msg && String(msg).trim()) ? msg : MAINT_MSG_DEFAULT; bar.hidden = !maintOn; }
  const t = $("maintToggle"); if(t) t.checked = maintOn;
}
applyMaintenance(MAINT_FORCE, t('maint.default'));   // inmediato: no depende de Firestore
if(!MAINT_FORCE){ getAppConfig().then(c=>{ if(c) applyMaintenance(!!c.maintenance, c.message); }).catch(()=>{}); }

// ── háptica (preferencia por dispositivo, en localStorage; por defecto ON) ──
let hapticsOn = localStorage.getItem("cago_haptics") !== "0";
// Android: navigator.vibrate. iOS no lo soporta, pero togglear un <input switch>
// oculto dispara la háptica nativa del sistema (Safari/PWA, iOS 17.4+).
let _iosSwitch=null;
function _iosHaptic(){
  try{
    if(!_iosSwitch){
      const l=document.createElement("label"); l.setAttribute("aria-hidden","true");
      l.style.cssText="position:absolute;left:-9999px;width:0;height:0;opacity:0;pointer-events:none";
      const i=document.createElement("input"); i.type="checkbox"; i.setAttribute("switch","");
      l.appendChild(i); document.body.appendChild(l); _iosSwitch=l;
    }
    _iosSwitch.click();
  }catch(e){}
}
const haptic = ms => { if(!hapticsOn) return; if(navigator.vibrate) navigator.vibrate(ms); else _iosHaptic(); };
// tap suave global en controles interactivos (el +1 lleva el suyo, más fuerte)
document.addEventListener("click", e=>{
  if(e.target.closest("button:not(#addBtn), .tab, .ychip, .rx, .swatch, .psg, .menu-item, .grouplist .ghead, .feed__item, .iconbtn, .brand, .profile, .addchip")) haptic(8);
}, true);
const ADMIN_UID = "OQxbpTTQqBbWsykiU7JKcUdZ7z32";   // admin único (la barrera real está en las reglas)
// Hitos: pequeños al principio y, de 100 en adelante, SIEMPRE cada 50 (sin tope).
const SMALL_MS = [10,25,50,75];
const isMilestone = n => SMALL_MS.includes(n) || (n>=100 && n%50===0);
const nextMilestone = n => { for(const m of SMALL_MS) if(m>n) return m; return n<100 ? 100 : (Math.floor(n/50)+1)*50; };
const prevMilestone = n => { let p=0; for(const m of SMALL_MS) if(m<=n) p=m; if(n>=100) p=Math.max(p, Math.floor(n/50)*50); return p; };
const initial = s => (s||"?").trim().charAt(0).toUpperCase();
const DAY = 86400000;
const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
// Inicio de la semana natural (lunes 00:00 local)
const startOfWeek = () => { const d=new Date(); d.setHours(0,0,0,0); const dow=(d.getDay()+6)%7; d.setDate(d.getDate()-dow); return d.getTime(); };
// Racha VIVA: `currentStreak` se guarda al sumar y nunca "caduca" sola, así que
// puede quedar inflada tras romperla. La racha real solo sigue viva si la última
// caca fue hoy o ayer; si pasó más de un día, está rota → 0. Sin lecturas extra.
function liveStreak(streak, lastCacaTs){
  if(!streak || !lastCacaTs) return 0;
  const d=new Date(lastCacaTs); d.setHours(0,0,0,0);
  const diffDays = Math.round((startOfToday()-d.getTime())/DAY);
  return diffDays<=1 ? streak : 0;
}
const av = (name,color) => `<span class="av" style="background:${color||'#6E3F1C'}">${initial(name)}</span>`;
const _meses=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function fmtWhen(ts){
  const diff=Date.now()-ts;
  if(diff<3600000){ const m=Math.max(1,Math.round(diff/60000)); return m<2?"ahora":`hace ${m} min`; }
  const d=new Date(ts), n=new Date();
  const hh=String(d.getHours()).padStart(2,"0"), mm=String(d.getMinutes()).padStart(2,"0");
  const sameDay = d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth() && d.getDate()===n.getDate();
  return sameDay ? `${hh}:${mm}` : `${d.getDate()} ${_meses[d.getMonth()]} ${hh}:${mm}`;
}
// fecha+hora completa (para la hora INDICADA de una caca olvidada). Año solo si no es el actual.
function fmtFull(ts){
  const d=new Date(ts), n=new Date();
  const hh=String(d.getHours()).padStart(2,"0"), mm=String(d.getMinutes()).padStart(2,"0");
  const yr = d.getFullYear()===n.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${_meses[d.getMonth()]}${yr}, ${hh}:${mm}`;
}

// Helper único de gráficos de barras. Maquetación en grid (valor · barra · etiqueta)
// que reserva el espacio de cada fila → mismas posiciones siempre (sin saltos).
function barsHTML(values, labels, {showVal=true}={}){
  const max=Math.max(1,...values);
  let peak=-1, pv=0; values.forEach((v,i)=>{ if(v>pv){ pv=v; peak=i; } });
  return values.map((v,i)=>{
    const h = v>0 ? Math.max(6, Math.round(v/max*100)) : 0;
    const isPeak = v>0 && i===peak;
    return `<div class="bar ${isPeak?'peak':''}">`
      + `<span class="barval">${showVal&&v>0?v:''}</span>`
      + `<i style="height:${h}%"></i>`
      + `<span class="barlbl">${labels[i]??''}</span></div>`;
  }).join("");
}

let uid=null, me=null, unsub=null, lastTotal=null;

// ── Fun fact del día (arriba del feed) ──────────────────────────────────────
// 3 facts por día (mismo bloque para todos, determinista por fecha).
// Card siempre visible pero colapsable. "otra 🔀" anima el texto al cambiar.
// Al agotar los 3: botón cambia a mensaje gracioso; el card se puede colapsar/expandir.
const FUNFACT_FOR_ALL = true;
const FACTS_PER_DAY = 3;
const _factDay = () => Math.floor(startOfToday()/DAY);
const _factBaseIdx = () => (_factDay() * FACTS_PER_DAY) % FUN_FACTS.length;

function _factCurrentIdx(){
  const dayKey = String(_factDay());
  const idxDay = localStorage.getItem("cago_fact_idx_day");
  return idxDay === dayKey ? parseInt(localStorage.getItem("cago_fact_idx")||"0", 10) : 0;
}

function _setFactCollapsed(collapsed){
  $("funFact").classList.toggle("funfact--collapsed", collapsed);
  $("funFactChevron").textContent = collapsed ? "" : "✕";
}

function _renderFact(offset, animate=false){
  const f = FUN_FACTS[(_factBaseIdx() + offset) % FUN_FACTS.length];
  const textEl = $("funFactText");
  if(animate){
    textEl.classList.remove("funfact__text--anim");
    void textEl.offsetWidth;
    textEl.classList.add("funfact__text--anim");
  }
  textEl.textContent = getLang()==="en" ? f.en : f.es;
  $("funFactSrc").href = f.url;
  const exhausted = offset >= FACTS_PER_DAY - 1;
  // dots: solo cuando no agotado
  const dotsEl = $("funFactDots");
  dotsEl.hidden = exhausted;
  if(!exhausted){
    dotsEl.innerHTML = Array.from({length: FACTS_PER_DAY}, (_,i) =>
      `<span class="funfact__dot${i===offset?" funfact__dot--active":""}"></span>`
    ).join("");
  }
  // botón "otra" vs bloque "mañana"
  $("funFactShuffle").hidden = exhausted;
  const tomorrow = $("funFactTomorrow");
  tomorrow.hidden = !exhausted;
  if(exhausted){
    $("funFactTomorrowMsg").textContent = getLang()==="en"
      ? "More tomorrow 💩"
      : "Mañana habrá más datos de mierda 💩";
  }
}

function maybeShowFunFact(){
  if(!(FUNFACT_FOR_ALL || uid===ADMIN_UID)) return;
  const wasHidden = $("funFact").hidden;
  $("funFact").hidden = false;
  const collapsed = localStorage.getItem("cago_fact_collapsed") === "1";
  _setFactCollapsed(collapsed);
  _renderFact(_factCurrentIdx());
  // Si es nuevo día, expandir automáticamente
  const dayKey = String(_factDay());
  const idxDay = localStorage.getItem("cago_fact_idx_day");
  if(wasHidden || idxDay !== dayKey) _setFactCollapsed(false);
}

$("funFactToggle")?.addEventListener("click", ()=>{
  const isCollapsed = $("funFact").classList.contains("funfact--collapsed");
  _setFactCollapsed(!isCollapsed);
  localStorage.setItem("cago_fact_collapsed", isCollapsed ? "0" : "1");
});

$("funFactShuffle")?.addEventListener("click", ()=>{
  const dayKey = String(_factDay());
  const prev = _factCurrentIdx();
  const next = Math.min(prev + 1, FACTS_PER_DAY - 1);
  localStorage.setItem("cago_fact_idx", String(next));
  localStorage.setItem("cago_fact_idx_day", dayKey);
  _renderFact(next, true);
});

$("funFactReread")?.addEventListener("click", ()=>{
  const dayKey = String(_factDay());
  localStorage.setItem("cago_fact_idx", "0");
  localStorage.setItem("cago_fact_idx_day", dayKey);
  _renderFact(0, true);
});

// Fix: re-check al volver a primer plano (ej. app en background toda la noche)
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "visible" && uid) maybeShowFunFact();
});

/* ---------- enlaces de invitación ---------- */
const inviteUrl = q => `${location.origin}${location.pathname}?${q}`;
async function shareInvite(url, text){
  try{ if(navigator.share){ await navigator.share({ title:"El Cagómetro", text, url }); return; } }
  catch(e){ if(e.name==="AbortError") return; }
  try{ await navigator.clipboard.writeText(url); toast(t('toast.link.copied')); }
  catch(e){ prompt("Copia el enlace:", url); }
}
function parsePendingInvite(){
  const p=new URLSearchParams(location.search);
  const join=p.get("join"), friend=p.get("friend");
  if(join)   return { type:"join",   code:join };
  if(friend) return { type:"friend", uid:friend };
  return null;
}
let _pendingInvite = parsePendingInvite();
const clearInviteUrl = () => history.replaceState(null, "", location.pathname);
async function processInvite(){
  if(!_pendingInvite || !uid) return;
  const inv=_pendingInvite; _pendingInvite=null; clearInviteUrl();
  if(inv.type==="join"){
    if(!confirm(t('confirm.group.join'))) return;
    try{ const g=await joinGroup(uid, inv.code); toast(t('toast.group.joined',{name:g.name})); setView("grupos"); await renderGrupos(); openGroup(g); }
    catch(err){ toast(err.message==="no-group" ? t('toast.group.join.invalid') : t('toast.group.join.fail')); console.error(err); }
  } else if(inv.type==="friend"){
    openFriendInvite(inv.uid);
  }
}

/* ---------- auth gate ---------- */
let mode="signin";
function applyMode(){
  const s=mode==="signup";
  $("primaryBtn").textContent=s?t('gate.btn.signup'):t('gate.btn.signin');
  $("gateSub").textContent=s?t('gate.sub.signup'):t('gate.sub.signin');
  $("toggleText").textContent=s?t('gate.toggle.has'):t('gate.toggle.new');
  $("toggleMode").textContent=s?t('gate.togglebtn.signin'):t('gate.togglebtn.signup');
  $("fName").style.display=s?"":"none";
  $("forgotBtn").hidden=s;
}
$("toggleMode").addEventListener("click",()=>{mode=mode==="signup"?"signin":"signup";clearErr();applyMode();});

// toggle mostrar/ocultar contraseña
$("eyeBtn").addEventListener("click",()=>{
  const p=$("fPass"); const show=p.type==="password";
  p.type=show?"text":"password";
  $("eyeBtn").textContent=show?"🙈":"👁";
});

// forgot password
$("forgotBtn").addEventListener("click", async ()=>{
  const email=$("fEmail").value.trim();
  const el=$("formErr");
  if(!email){ el.style.color="var(--rose)"; el.textContent=t('err.forgot.required'); el.hidden=false; return; }
  try{
    await resetPassword(email);
    el.style.color="var(--mint)"; el.textContent=t('err.forgot.sent'); el.hidden=false;
  } catch(err){
    const msg=err.code==="auth/invalid-email"?t('err.forgot.invalid'):t('err.forgot.fail');
    el.style.color="var(--rose)"; el.textContent=msg; el.hidden=false;
  }
});
const ERR_CODES={"auth/email-already-in-use":"err.email_in_use","auth/invalid-credential":"err.invalid_credential","auth/invalid-email":"err.invalid_email","auth/weak-password":"err.weak_password","auth/popup-closed-by-user":"err.popup_closed"};
const showErr=e=>{const el=$("formErr");el.textContent=ERR_CODES[e?.code]?t(ERR_CODES[e.code]):(e?.message||t('err.generic'));el.hidden=false;};
const clearErr=()=>$("formErr").hidden=true;
$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();clearErr();
  const name=$("fName").value.trim(),email=$("fEmail").value.trim(),pass=$("fPass").value;
  const b=$("primaryBtn");b.disabled=true;const t=b.textContent;b.textContent="…";
  try{
    const u = mode==="signup" ? await signUp(email,pass,name) : await signIn(email,pass);
    if(mode==="signup" && u && !u.emailVerified) sendVerifEmail(u).catch(()=>{});
  }catch(err){showErr(err);}
  finally{b.disabled=false;b.textContent=t;}
});
$("googleBtn").addEventListener("click",async()=>{clearErr();try{await googleSignIn();}catch(err){showErr(err);}});
$("verifResend").addEventListener("click", async ()=>{
  const u=auth.currentUser; if(!u)return;
  try{ await sendVerifEmail(u); toast(t('toast.verif.resent')); }
  catch(e){ toast(t('toast.verif.fail')); }
});
$("logoutBtn").addEventListener("click",()=>signOutUser());

/* ---------- session ---------- */
let _authResolved=false;
// Asegura que siempre haya un estado base en el history para que history.back()
// dentro del chat nunca abandone la PWA
if(!history.state?._app) history.replaceState({_app:true}, "");

onUser(async user=>{
  _authResolved=true;
  $("splash").hidden = true;                 // auth resolved → hide the loading screen
  if(!user){ showGate(); return; }
  uid=user.uid; await ensureProfile(user); showApp();
});
// Failsafe: si la sesión no resuelve en 9s (red/CDN lento en la PWA instalada),
// no dejamos el splash colgado: mostramos el acceso para que el usuario pueda actuar.
setTimeout(()=>{ if(!_authResolved){ $("splash").hidden=true; if(!uid) showGate(); } }, 9000);
function showGate(){ if(unsub){unsub();unsub=null;} stopNotifications(); stopFeed(); closeOverlays(); $("app").hidden=true; $("gate").hidden=false; uid=null; me=null; lastTotal=null; }

// ── Offline detection ─────────────────────────────────────────────────────────
function syncOfflineBar(){
  const offline = !navigator.onLine;
  $("offlineBar").hidden = !offline;
}
syncOfflineBar();
window.addEventListener("online",  () => { syncOfflineBar(); if(uid) _flushOutbox(); });
window.addEventListener("offline", () => syncOfflineBar());

async function _flushOutbox(){
  if(!outboxGet().length) return;
  try{
    const n = await outboxFlush(uid, entry => entry.act || null);
    if(n>0){ toast(`✅ ${n} caca${n>1?"s":""} sincronizada${n>1?"s":""}`); _statsLoadedAt=0; loadActivity("force"); }
  } catch(e){ console.warn("flush outbox:", e); }
}

function showApp(){
  $("gate").hidden=true; $("app").hidden=false;
  // banner de verificación: solo usuarios email/pass con email sin verificar
  const fbUser = auth.currentUser;
  const needsVerif = fbUser && !fbUser.emailVerified && fbUser.providerData?.some(p=>p.providerId==="password");
  $("verifBar").hidden = !needsVerif;
  if(unsub)unsub();
  unsub=watchMe(uid, m=>{
    if(!m)return; me=m; const total=m.totalCount||0;
    _myDisplayName = m.displayName||"";
    $("meCount").textContent=total; $("meName").textContent=m.displayName||"";
    $("hdrAvatar").textContent=initial(m.displayName); $("hdrAvatar").style.background=m.color||colorForUid(uid);
    $("pName").textContent=m.displayName||""; $("pEmail").textContent=m.email||"—";
    $("pAvatar").textContent=initial(m.displayName); $("pAvatar").style.background=m.color||colorForUid(uid);
    $("pTotal").textContent=total; $("pLifetime").textContent=t('perfil.lifetime',{n:m.lifetimeCount||total});
    paintProgress(total); renderLocSel(m.locationMode);
    if(lastTotal!==null && total>lastTotal){ if(isMilestone(total)){ celebrate(total); notifyFriendsMilestone(total); } checkGroupOvertakes(lastTotal); }
    lastTotal=total;
  });
  $("pMode").textContent=IS_LOCAL?"modo local (emulador) · datos de prueba":"";
  loadActivity();
  processInvite();
  if(navigator.onLine && outboxGet().length) _flushOutbox();
  startNotifications();
  enablePush();                       // si ya hay permiso, refresca el token FCM
  startChatListener(uid, "");
  maybeShowFunFact();

}

/* ---------- hoja: aceptar invitación de amigo ---------- */
let _fiUid=null;
async function openFriendInvite(otherUid){
  if(otherUid===uid){ toast(t('toast.self')); return; }
  _fiUid=otherUid;
  const u=await getUser(otherUid);
  if(!u){ toast(t('toast.notfound')); return; }
  $("fiAvatar").textContent=initial(u.displayName); $("fiAvatar").style.background=u.color||colorForUid(otherUid);
  $("fiName").textContent=u.displayName||t('fallback.someone');
  $("friendInviteSheet").hidden=false;
}
$("fiCancel").addEventListener("click",()=>$("friendInviteSheet").hidden=true);
$("friendInviteSheet").addEventListener("click",e=>{ if(e.target===$("friendInviteSheet")) $("friendInviteSheet").hidden=true; });
$("fiAccept").addEventListener("click", async ()=>{
  if(!_fiUid)return; $("friendInviteSheet").hidden=true;
  try{ await addFriendDirect(uid,_fiUid); toast(t('toast.friend.accepted'));
    if(document.querySelector(".view.is-active")?.dataset.view==="amigos") renderAmigos(); }
  catch(err){ toast(t('toast.friend.fail')); console.error(err); }
});
$("inviteFriendBtn").addEventListener("click",()=> shareInvite(inviteUrl("friend="+encodeURIComponent(uid)), t('amigos.invite.text')));

/* ---------- ajustes (desde el avatar de la cabecera) ---------- */
const SET_COLORS=["#6E3F1C","#E59A2E","#2E9E68","#9A5A2A","#D8573F","#3F6EA5","#8E5BA6","#C2406E"];
function renderSetColors(cur){
  const c=(cur||"").toLowerCase();
  $("setColors").innerHTML=SET_COLORS.map(x=>`<button class="swatch ${x.toLowerCase()===c?'on':''}" data-color="${x}" style="background:${x}" aria-label="color ${x}"></button>`).join("");
}
function openSettings(){
  if(!me)return;
  const col=me.color||colorForUid(uid);
  $("setName").value=me.displayName||"";
  $("setNamePreview").textContent=me.displayName||"—";
  $("setEmail").textContent=me.email||"—";
  $("setAvatar").textContent=initial(me.displayName); $("setAvatar").style.background=col;
  renderSetColors(col); renderLocSel(me.locationMode); $("setNotif").checked=!!me.notifications;
  $("setHaptics").checked = hapticsOn;
  $("setShareMap").checked = me.shareMap !== false;
  $("adminBtn").hidden = uid!==ADMIN_UID;
  _syncLangBtns(getLang());
  $("settingsSheet").hidden=false;
}
$("settingsBtn").addEventListener("click", openSettings);
$("pcardSettingsBtn").addEventListener("click", openSettings);
$("setClose").addEventListener("click", ()=>$("settingsSheet").hidden=true);
function _syncLangBtns(lang){
  $("langSel").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x.dataset.lang===lang));
  $("gateLangSel").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x.dataset.lang===lang));
}
function _onLangClick(e){
  const b=e.target.closest("[data-lang]"); if(!b)return;
  const lang=b.dataset.lang;
  setLang(lang);
  _syncLangBtns(lang);
  applyLang(); applyMode();
  toast(t('toast.lang',{lang:lang.toUpperCase()}));
}
$("langSel").addEventListener("click", _onLangClick);
$("gateLangSel").addEventListener("click", _onLangClick);

/* ---------- panel admin (solo ADMIN_UID; reglas lo respaldan) ---------- */
async function renderAdminUsers(){
  $("adminUsers").innerHTML=`<p class="notif-empty">${t('admin.users.loading')}</p>`;
  try{
    const users=(await adminListUsers()).sort((a,b)=>(b.totalCount||0)-(a.totalCount||0));
    $("adminUsers").innerHTML = users.map(u=>`
      <div class="adminrow">
        <span class="av" style="background:${u.color||colorForUid(u.id)}">${initial(u.displayName)}</span>
        <div class="adminrow__txt"><b>${u.displayName||"?"}</b><small>${u.email||""} · ${u.totalCount||0} 💩</small></div>
        ${u.id===uid?`<span class="adminrow__you">${t('admin.users.you')}</span>`:`<button class="btn-decline" data-wipe="${u.id}" data-name="${(u.displayName||"").replace(/"/g,"")}"> ${t('admin.users.wipe')}</button>`}
      </div>`).join("") || `<p class="notif-empty">${t('admin.users.empty')}</p>`;
  }catch(err){ $("adminUsers").innerHTML=`<p class="notif-empty">${t('admin.users.loadfail')}</p>`; console.error(err); }
}
function openAdmin(){ if(uid!==ADMIN_UID) return; $("settingsSheet").hidden=true; $("adminSheet").hidden=false; $("maintToggle").checked=maintOn; renderAdminUsers(); }
$("adminBtn").addEventListener("click", openAdmin);
$("adminClose").addEventListener("click", ()=>$("adminSheet").hidden=true);
$("adminResetFunFact").addEventListener("click", ()=>{
  localStorage.removeItem("cago_fact_idx");
  localStorage.removeItem("cago_fact_idx_day");
  localStorage.removeItem("cago_fact_collapsed");
  $("adminSheet").hidden = true;
  _setFactCollapsed(false);
  _renderFact(0);
  toast("Fun fact reseteado ✓");
});
$("adminSheet").addEventListener("click", e=>{ if(e.target===$("adminSheet")) $("adminSheet").hidden=true; });
$("maintToggle").addEventListener("change", async e=>{
  if(uid!==ADMIN_UID){ e.target.checked=maintOn; return; }
  const on=e.target.checked;
  applyMaintenance(on, MAINT_MSG_DEFAULT);                 // efecto inmediato en este dispositivo
  try{ await setMaintenance(on, t('maint.default')); toast(on?t('toast.maint.on'):t('toast.maint.off')); }
  catch(err){ toast(t('toast.maint.fail')); console.error(err); }
});
$("adminUsers").addEventListener("click", async e=>{
  const b=e.target.closest("[data-wipe]"); if(!b)return;
  const tid=b.dataset.wipe, name=b.dataset.name||"ese usuario";
  if(tid===uid){ toast(t('toast.admin.self')); return; }
  if(!confirm(t('confirm.admin.wipe',{name}))) return;
  b.disabled=true; b.textContent=t('admin.users.wiping');
  try{ await adminWipeUser(tid); toast(t('toast.admin.wiped')); renderAdminUsers(); }
  catch(err){ toast(t('toast.admin.wipe.fail')); console.error(err); b.disabled=false; b.textContent=t('admin.users.wipe'); }
});
$("settingsSheet").addEventListener("click", e=>{ if(e.target===$("settingsSheet")) $("settingsSheet").hidden=true; });
$("setNameSave").addEventListener("click", async ()=>{
  const n=$("setName").value.trim(); if(!n) return toast(t('toast.name.empty'));
  if(n===me?.displayName) return toast(t('toast.name.unchanged'));
  try{ await updateMe(uid,{displayName:n}); $("setNamePreview").textContent=n; $("setAvatar").textContent=initial(n); toast(t('toast.name.ok')); refreshActiveView(); }
  catch(err){ toast(t('toast.name.fail')); console.error(err); }
});
$("setColors").addEventListener("click", async e=>{
  const b=e.target.closest("[data-color]"); if(!b)return;
  const c=b.dataset.color; renderSetColors(c); $("setAvatar").style.background=c;
  try{ await updateMe(uid,{color:c}); toast(t('toast.color.ok')); refreshActiveView(); }
  catch(err){ toast(t('toast.color.fail')); console.error(err); }
});
$("setShareMap").addEventListener("change", async e=>{
  try{ await updateMe(uid,{shareMap:e.target.checked}); toast(e.target.checked?t('toast.sharemap.on'):t('toast.sharemap.off')); }
  catch(err){ e.target.checked=!e.target.checked; toast(t('toast.sharemap.fail')); }
});
$("setHaptics").addEventListener("change", e=>{
  hapticsOn = e.target.checked;
  localStorage.setItem("cago_haptics", hapticsOn ? "1" : "0");
  if(hapticsOn) haptic(20);   // confirmación al activar (Android vibra, iOS háptica nativa)
});
$("setNotif").addEventListener("change", async e=>{
  const on=e.target.checked;
  if(on){
    const perm=await requestNotifPermission();
    if(perm!=="granted"){
      e.target.checked=false;
      toast(perm==="denied" ? t('toast.notif.blocked') : t('toast.notif.denied'));
      try{ await updateMe(uid,{notifications:false}); }catch(_){}
      return;
    }
  }
  try{
    await updateMe(uid,{notifications:on});
    toast(on?t('toast.notif.on'):t('toast.notif.off'));
    if(on) enablePush();
    else if(_fcmToken) removeToken(uid,_fcmToken).catch(()=>{});
  }
  catch(err){ e.target.checked=!on; toast(t('toast.notif.fail')); console.error(err); }
});
function paintProgress(total){ const lo=prevMilestone(total),hi=nextMilestone(total);
  $("meProgressFill").style.width=Math.min(100,Math.round(((total-lo)/(hi-lo||1))*100))+"%";
  $("meProgressLabel").textContent=t('progress.label',{n:hi-total,milestone:hi}); }

let homeFeedData=[], feedShown=0; const FEED_PAGE=20;
let _graph={ audience:[], groups:[] };   // grafo social cacheado para escribir eventos de actividad
// metadatos para el evento de actividad (lo escribe el store de forma transaccional)
const actMeta = () => ({
  name: me?.displayName||"", color: me?.color||colorForUid(uid),
  audience: _graph.audience.length ? _graph.audience : [uid],
  groups: _graph.groups || [],
});
// El FEED ya no hace fan-out: lo provee un único listener en tiempo real sobre `activity`.
let _feedUnsub=null, _myGroupIds=new Set();
function startFeed(){
  if(_feedUnsub) return;
  _showFeedSkeleton();
  _feedUnsub = watchActivity(uid, acts=>{
    homeFeedData = acts;                       // entradas crudas; los chips de grupo se calculan al pintar
    if(!feedShown) feedShown=FEED_PAGE;
    renderFeedChips(); renderFeed();           // pinta SIEMPRE primero (lo importante)
    try{ detectReactionNotifs(acts); }catch(e){ console.error("notif:", e); }   // que un fallo aquí no rompa el feed
  }, 60, err=>{                                 // p.ej. índice construyéndose → reintenta solo
    console.warn("feed listener:", err?.code||err);
    stopFeed();
    setTimeout(()=>{ if(uid) startFeed(); }, 4000);
  });
}
function stopFeed(){ if(_feedUnsub){ try{_feedUnsub()}catch(e){} _feedUnsub=null; } }

// loadActivity ya solo refresca los chips (hoy/semana/racha) y el grafo (audiencia/grupos);
// el feed en sí es en tiempo real vía startFeed().
let _feedLoadedAt=0, _feedLoading=false, _graphAt=0;
let _graphPromise=Promise.resolve();   // promesa del rebuild en curso; resolved si el grafo ya está listo
let _chips={today:0,week:0,streak:0,days:null};   // chips en memoria (para actualizarlos sin leer)
function _showFeedSkeleton(){
  $("feed").innerHTML = Array.from({length:4}, ()=>
    `<li class="skeleton--item"><div class="skeleton skeleton--avatar"></div><div style="flex:1"><div class="skeleton skeleton--line w80"></div><div class="skeleton skeleton--line w40"></div></div></li>`
  ).join("");
}

async function loadActivity(mode){
  startFeed();   // el FEED en sí es en tiempo real (listener) → aquí NO se relee
  const force = mode==="force";
  if(_feedLoading) return;
  const graphStale = !_graph.audience.length || Date.now()-_graphAt > 300000;
  // throttle de 30s para los chips; el grafo se reconstruye siempre que esté invalidado
  // (_graphAt=0 lo marca watchFriendships cuando cambia la red social)
  if(!force && !graphStale && Date.now()-_feedLoadedAt < 30000) return;
  _feedLoading=true;
  try{
    // chips (hoy/semana/racha): ventana corta de cacas propias — solo si hace falta
    if(force || Date.now()-_feedLoadedAt >= 30000){
      const mine = await myActivity(uid,120);
      const t0=startOfToday(),wk=startOfWeek(); let today=0,week=0; const days=new Set();
      for(const c of mine){ if(c.ts>=t0)today++; if(c.ts>=wk)week++; const d=new Date(c.ts);d.setHours(0,0,0,0);days.add(d.getTime()); }
      const streak = liveStreak(me?.currentStreak, me?.lastCacaTs);
      _chips={today,week,streak,days};
      $("statToday").textContent=today; $("statWeek").textContent=week; $("statStreak").textContent=streak;
      _feedLoadedAt=Date.now();
    }
    // grafo de audiencia (amigos+grupos): se relee si está invalidado o lleva >5 min
    if(graphStale){
      // expone la promesa para que addCaca pueda esperarla si llega antes de que termine
      let resolveGraph;
      _graphPromise = new Promise(r => { resolveGraph = r; });
      try{
        const [friends, groups] = await Promise.all([ getFriends(uid), myGroups(uid) ]);
        friendNames={}; friends.forEach(f=>{ friendNames[f.id]=f.displayName; });
        _myGroupIds = new Set(groups.map(g=>g.id)); myGroupsCache=groups;
        _graph = {
          audience: [...new Set([uid, ...friends.map(f=>f.id), ...groups.flatMap(g=>(g.members||[]).filter(m=>m!==uid))])],
          groups: groups.map(g=>({ gid:g.id, name:g.name })),
        };
        _graphAt=Date.now();
      } finally { resolveGraph(); }   // siempre resuelve (aunque falle, mejor audience vieja que colgar)
    }
    renderFeedChips(); renderFeed();
  } catch(e){ console.error("loadActivity:",e); }
  finally { _feedLoading=false; }
}
// actualiza los chips en memoria tras una caca normal, sin releer Firestore
function bumpChipsLocal(){
  if(!_chips.days){ loadActivity("force"); return; }
  const d0=startOfToday(); const first=!_chips.days.has(d0);
  _chips.today++; _chips.week++; _chips.days.add(d0);
  if(first){ let s=0,c=startOfToday(); if(!_chips.days.has(c))c-=DAY; while(_chips.days.has(c)){s++;c-=DAY;} _chips.streak=s; }
  $("statToday").textContent=_chips.today; $("statWeek").textContent=_chips.week; $("statStreak").textContent=_chips.streak;
}
// reacciones a MIS eventos (desde el listener del feed) → campanita + banner local
function detectReactionNotifs(acts){
  const mineActs = acts.filter(a=>a.uid===uid);
  const cur=new Map();
  for(const a of mineActs){ const r=a.reactions||{}; for(const ru in r){ if(ru===uid) continue; for(const e of asArr(r[ru])) cur.set(`${a.id}|${ru}|${e}`, {reactorUid:ru,emoji:e,ts:a.ts,cacaId:a.id}); } }
  if(rxBaseline===null){ rxBaseline=new Set(cur.keys()); }
  else {
    let added=0,last=null;
    for(const [k,v] of cur) if(!rxBaseline.has(k)){ rxBaseline.add(k); added++; last=v; }
    for(const k of [...rxBaseline]) if(!cur.has(k)) rxBaseline.delete(k);
    if(added){ unseenRx+=added;
      if(added===1 && last) resolveName(last.reactorUid).then(n=> showLocalNotif(t('push.reaction.title'), t('push.localrx.one',{name:n,emoji:last.emoji})));
      else showLocalNotif(t('push.reaction.title'), t('push.localrx.many',{n:added}));
    }
  }
  notifRx=[...cur.values()].sort((a,b)=>b.ts-a.ts);
  const unknown=[...new Set(notifRx.map(v=>v.reactorUid))].filter(ru=>ru!==uid && !notifFriends[ru]);
  if(unknown.length) Promise.all(unknown.map(getUser)).then(us=>{ us.forEach((u,i)=>{ if(u) notifFriends[unknown[i]]=u.displayName||"Alguien"; }); refreshNotif(); });
  refreshNotif();
}
// ── filtros del feed (chips + búsqueda) ──
let feedScope="all", feedQ="";
// chips de grupo visibles para MÍ = grupos del autor ∩ mis grupos
const entryContexts = c => (c.groups||[]).filter(g=>_myGroupIds.has(g.gid)).map(g=>({type:"group", gid:g.gid, name:g.name}));
function feedGroups(){
  const m=new Map();
  for(const c of homeFeedData) for(const g of (c.groups||[])) if(_myGroupIds.has(g.gid)) m.set(g.gid, g.name);
  return [...m].map(([gid,name])=>({gid,name}));
}
function renderFeedChips(){
  const base=[["all",t('feedchip.all')],["me",t('feedchip.me')],["friends",t('feedchip.friends')]];
  const chips=base.map(([k,l])=>`<button class="ychip ${feedScope===k?'on':''}" data-fscope="${k}">${l}</button>`)
    .concat(feedGroups().map(g=>`<button class="ychip ${feedScope===g.gid?'on':''}" data-fscope="${g.gid}">🏆 ${g.name}</button>`));
  $("feedChips").innerHTML=chips.join("");
}
// una "conexión de tuberías" solo la ves si eres uno de los dos o amigo de AMBOS
function canSeeSync(c){
  if(c.kind!=="sync") return true;
  if(c.uid===uid || c.withUid===uid) return true;
  return !!(friendNames[c.uid] && friendNames[c.withUid]);
}
function filteredFeed(){
  let arr=homeFeedData.filter(canSeeSync);     // oculta syncs en los que no eres amigo de los dos
  if(feedScope==="me") arr=arr.filter(c=>c.uid===uid);
  else if(feedScope==="friends") arr=arr.filter(c=>c.uid!==uid);
  else if(feedScope!=="all") arr=arr.filter(c=>(c.groups||[]).some(g=>g.gid===feedScope));
  if(feedQ){ const q=feedQ.toLowerCase(); arr=arr.filter(c=>(c.name||"").toLowerCase().includes(q)); }
  return arr;
}
$("feedChips").addEventListener("click", e=>{ const b=e.target.closest("[data-fscope]"); if(!b)return;
  feedScope=b.dataset.fscope; feedShown=FEED_PAGE; renderFeedChips(); renderFeed(); });
$("feedSearch").addEventListener("input", e=>{ feedQ=e.target.value.trim(); feedShown=FEED_PAGE; renderFeed(); });
$("feedSearchBtn").addEventListener("click", ()=>{
  const inp=$("feedSearch"); const show=inp.hidden;
  inp.hidden=!show; $("feedSearchBtn").classList.toggle("on", show);
  if(show){ inp.focus(); }
  else if(feedQ){ feedQ=""; inp.value=""; feedShown=FEED_PAGE; renderFeed(); }   // al cerrar, limpia el filtro
});
// Solo etiqueta de grupo (todo el que aparece en tu actividad ya es amigo)
const _ctxChip=c=> c.type==="group" ? `<span class="cc cc--group">${c.name}</span>` : "";
// normaliza el valor de reacción de un usuario (compat: datos antiguos eran string)
const asArr = v => Array.isArray(v) ? v : (v ? [v] : []);
// fila de reacciones (chips agregados por emoji + botón para reaccionar)
function reactionsRow(c){
  const r=c.reactions||{}; const counts={};
  for(const k in r) for(const e of asArr(r[k])) counts[e]=(counts[e]||0)+1;
  const mine=new Set(asArr(r[uid]));
  const chips=Object.keys(counts).map(e=>`<button class="rx ${mine.has(e)?'rx--mine':''}" data-rx="${e}">${e}&nbsp;${counts[e]}</button>`).join("");
  const add = c.uid===uid ? "" : `<button class="rx rx--add" data-rxadd aria-label="Añadir reacción"><span class="rx-plus">+</span>🙂</button>`;
  return (chips||add) ? `<div class="feed__rx">${chips}${add}</div>` : "";
}
function _feedItem(c,i){
  const chips=entryContexts(c).map(_ctxChip).join("");
  const mine=c.uid===uid;
  let head, nBadge="", sys=false, reactable=true, syncHi=false;
  const _n=`<b>${c.name}</b>`, _wn=`<b>${c.withName}</b>`;
  if(c.kind==="undo"){
    head = mine ? t('feed.undo.mine') : t('feed.undo.other',{name:_n}); sys=true; reactable=false;
  } else if(c.kind==="reset"){
    head = mine ? t('feed.reset.mine') : t('feed.reset.other',{name:_n}); sys=true; reactable=false;
  } else if(c.kind==="sync"){
    head = mine ? t('feed.sync.mine',{name:_wn})
         : c.withUid===uid ? t('feed.sync.withme',{name:_n})
         : t('feed.sync.other',{name:_n,other:_wn});
    syncHi=true;
  } else if(c.late){
    head = mine ? t('feed.late.mine') : t('feed.late.other',{name:_n});
    nBadge = `<b class="feed__n">${c.n}</b>`;
  } else {
    const hito = isMilestone(c.n);
    head = hito ? (mine ? t('feed.milestone.mine',{n:`<b>${c.n}</b>`}) : t('feed.milestone.other',{name:_n,n:`<b>${c.n}</b>`}))
                : (mine ? t('feed.add.mine') : t('feed.add.other',{name:_n}));
    nBadge = hito ? "" : `<b class="feed__n">${c.n}</b>`;
  }
  const isHito = c.kind!=="undo"&&c.kind!=="reset"&&c.kind!=="sync"&&!c.late&&isMilestone(c.n);
  const cls = `feed__item${isHito?' feed__item--hito':''}${syncHi?' feed__item--sync':''}${sys?' feed__item--sys':''}`;
  return `<li class="${cls}" data-i="${i}">
    <span class="av" style="background:${c.color}">${initial(c.name)}</span>
    <div class="feed__body">
      <div class="feed__line">${head} ${nBadge}</div>
      ${c.late?`<div class="feed__sub">📅 ${fmtFull(c.forTs ?? c.ts)}</div>`:""}
      ${chips?`<div class="feed__ctx">${chips}</div>`:""}
      ${reactable?reactionsRow(c):""}
    </div>
    <span class="feed__time">${fmtWhen(c.ts)}</span>
  </li>`;
}
function renderFeed(){
  const all=filteredFeed();
  const items=all.slice(0,feedShown);
  const empty = feedQ||feedScope!=="all" ? t('feed.empty.filter') : t('feed.empty.default');
  $("feed").innerHTML = items.length ? items.map(c=>_feedItem(c, homeFeedData.indexOf(c))).join("")
    : `<li class="feed__item"><span class="feed__txt" style="color:var(--ink-faint)">${empty}</span></li>`;
  $("loadMore").hidden = feedShown>=all.length;
}
$("loadMore").addEventListener("click",()=>{ feedShown=feedShown+FEED_PAGE; renderFeed(); });

// ── click en una caja de actividad → ficha de la persona ──
const PM=["E","F","M","A","M","J","J","A","S","O","N","D"];
$("feed").addEventListener("click", e=>{
  const li=e.target.closest(".feed__item[data-i]"); if(!li)return;
  const entry=homeFeedData[+li.dataset.i]; if(!entry)return;
  const rx=e.target.closest("[data-rx]"), add=e.target.closest("[data-rxadd]");
  if(add){ openReactPicker(entry); return; }       // botón 🙂 → selector
  if(rx){ if(_lpFired){ _lpFired=false; return; }   // venía de un long-press → no alternar
          if(entry.uid===uid){ showReactors(rx); return; }   // en TU actividad → muestra quién reaccionó
          applyReaction(entry, rx.dataset.rx); return; }      // en la de otros → alterna mi reacción
  openPersonSheet(entry);
});
// reacciones (varias por persona)
let _rxTarget=null;
async function applyReaction(entry, emoji){
  if(entry.uid===uid) return;                      // no reaccionas a tus propias cacas
  const r=entry.reactions={...(entry.reactions||{})};
  const mine=asArr(r[uid]); const has=mine.includes(emoji);
  const next = has ? mine.filter(e=>e!==emoji) : [...mine, emoji];   // alterna ese emoji
  if(next.length) r[uid]=next; else delete r[uid];                   // optimista
  renderFeed();
  try{
    await setReaction(entry.id, uid, emoji, !has);
    if(!has) enqueuePush(uid, entry.uid, "reaction", t('push.reaction.title'), t('push.reaction.body',{name:me?.displayName||t('fallback.someone'),emoji})).catch(()=>{});
  }
  catch(err){ toast(t('toast.caca.react.fail')); console.error(err); loadActivity(); }
}
function openReactPicker(entry){
  _rxTarget=entry;
  const mine=new Set(asArr((entry.reactions||{})[uid]));
  $("rxPick").querySelectorAll("[data-rxpick]").forEach(b=>{
    b.classList.toggle("rxpick--on", mine.has(b.dataset.rxpick));
  });
  $("reactSheet").hidden=false;
}
$("rxCancel").addEventListener("click", ()=>$("reactSheet").hidden=true);
$("reactSheet").addEventListener("click", e=>{ if(e.target===$("reactSheet")) $("reactSheet").hidden=true; });
$("rxPick").addEventListener("click", e=>{
  const b=e.target.closest("[data-rxpick]"); if(!b||!_rxTarget)return;
  $("reactSheet").hidden=true; applyReaction(_rxTarget, b.dataset.rxpick); _rxTarget=null;
});

// ── long-press en un chip → tooltip con quién ha reaccionado (privacidad estilo Telegram) ──
let friendNames={};               // uid -> nombre, solo de MIS amigos (para revelar identidades)
let _rxTip=null, _lpTimer=null, _lpFired=false;
const _clearLP=()=>{ if(_lpTimer){ clearTimeout(_lpTimer); _lpTimer=null; } };
function hideReactors(){ if(_rxTip){ _rxTip.remove(); _rxTip=null; } }
async function showReactors(chip){
  hideReactors();
  const li=chip.closest(".feed__item[data-i]"); if(!li)return;
  const entry=homeFeedData[+li.dataset.i]; if(!entry)return;
  const emoji=chip.dataset.rx; const r=entry.reactions||{};
  const ruids=Object.keys(r).filter(ru=>asArr(r[ru]).includes(emoji));
  let names=[], anon=0;
  if(entry.uid===uid){                                  // tu propia caca → revela todos
    names = await Promise.all(ruids.map(ru=> ru===uid ? t('rx.me') : resolveName(ru)));
  } else {                                              // de otros → solo amigos en común; el resto, anónimo
    for(const ru of ruids){ if(ru===uid) names.unshift(t('rx.me')); else if(friendNames[ru]) names.push(friendNames[ru]); else anon++; }
  }
  let txt=names.join(", ");
  if(anon>0) txt += (txt?" y ":"") + (anon===1?t('rx.anon.one'):t('rx.anon.many',{n:anon}));
  if(!txt) txt=t('rx.nobody');
  const tip=document.createElement("div"); tip.className="rxtip";
  tip.innerHTML=`<span class="rxtip__e">${emoji}</span> ${txt}`;
  document.body.appendChild(tip);
  const rect=chip.getBoundingClientRect();
  tip.style.left = Math.max(10, Math.min(window.innerWidth-10-tip.offsetWidth, rect.left)) + "px";
  tip.style.top  = Math.max(8, rect.top - tip.offsetHeight - 8) + "px";
  _rxTip=tip; haptic(12);
}
$("feed").addEventListener("pointerdown", e=>{
  const chip=e.target.closest("[data-rx]"); if(!chip)return;
  _lpFired=false; _clearLP();
  _lpTimer=setTimeout(()=>{ _lpFired=true; showReactors(chip); }, 450);
});
$("feed").addEventListener("pointerup", _clearLP);
$("feed").addEventListener("pointermove", _clearLP);
$("feed").addEventListener("pointercancel", _clearLP);
document.addEventListener("pointerdown", e=>{ if(_rxTip && !e.target.closest(".rxtip")) hideReactors(); }, true);
window.addEventListener("scroll", hideReactors, true);

/* ---------- centro de notificaciones (in-app, tiempo real) ---------- */
let notifReqs=[], notifRx=[], notifGroupInvites=[], rxBaseline=null, reqBaseline=null, unseenRx=0, notifUnsub=[], notifFriends={};
// permiso del navegador para notificaciones locales del sistema (no necesita VAPID/servidor)
async function requestNotifPermission(){
  if(!("Notification" in window)) return "denied";
  if(Notification.permission==="granted") return "granted";
  try{ return await Notification.requestPermission(); }catch(e){ return Notification.permission; }
}
// banner del sistema disparado por la propia app (funciona con la app abierta/en marcha)
// Al subir mi contador, aviso en grupos a quien acabo de superar (rompo empate
// en su mismo número → le quito el puesto). Anti-ruido: nada por debajo de 3.
async function checkGroupOvertakes(oldTotal){
  if(oldTotal<3) return;
  try{
    const groups=await myGroups(uid); if(!groups.length) return;
    const name=me?.displayName||"Alguien"; const sentTo=new Set();
    for(const g of groups){
      const board=await groupLeaderboard(g);
      for(const r of board){
        if(r.id===uid || sentTo.has(r.id)) continue;
        if((r.totalCount||0)===oldTotal){          // estábamos empatados → ahora le supero
          sentTo.add(r.id);
          enqueuePush(uid, r.id, "overtake", t('push.overtake.title'), t('push.overtake.body',{name,group:g.name})).catch(()=>{});
        }
      }
    }
  }catch(e){ console.error(e); }
}
// Al cruzar un hito, avisa a mis amigos (push tipo "milestone", inmediato).
async function notifyFriendsMilestone(n){
  try{
    const fr=await getFriends(uid); const name=me?.displayName||"Alguien";
    fr.forEach(f=> enqueuePush(uid, f.id, "milestone", t('push.milestone.title'), t('push.milestone.body',{name,n})).catch(()=>{}) );
  }catch(e){ console.error(e); }
}
// Registra el dispositivo en FCM para recibir push con la app cerrada (vía la Pi).
let _fcmToken=null;
async function enablePush(){
  if(IS_LOCAL) return;
  if(typeof Notification==="undefined" || Notification.permission!=="granted") return;
  const messaging=await getMessagingIfSupported(); if(!messaging) return;
  try{
    const reg=await navigator.serviceWorker.register("firebase-messaging-sw.js", { scope:"firebase-cloud-messaging-push-scope" });
    const token=await getToken(messaging, { vapidKey:VAPID_KEY, serviceWorkerRegistration:reg });
    if(token){ _fcmToken=token; await saveToken(uid, token); }
    onMessage(messaging, ()=>{ refreshNotif(); });   // primer plano: el listener local ya muestra el banner
  }catch(e){ console.warn("push:", e?.message||e); }
}
function showLocalNotif(title, body){
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  if(me && me.notifications===false) return;                 // respeta el interruptor de Ajustes
  const opts={ body, icon:"icon-192.png", badge:"badge.png", tag:"cagometro-"+Date.now() };
  try{
    if(navigator.serviceWorker?.ready) navigator.serviceWorker.ready.then(reg=>reg.showNotification(title,opts)).catch(()=>{ try{ new Notification(title,opts); }catch(_){} });
    else new Notification(title,opts);
  }catch(e){ /* sin soporte */ }
}
function startNotifications(){
  stopNotifications();
  getFriends(uid).then(fr=>{ notifFriends={}; fr.forEach(f=>{ notifFriends[f.id]=f.displayName; }); }).catch(()=>{});
  // solicitudes de amistad entrantes
  notifUnsub.push(watchFriendships(uid, async fships=>{
    _graphAt=0;   // cambió la red de amistades → refresca la audiencia en la próxima carga
    const pend=fships.filter(f=>f.status==="pending" && f.requestedBy!==uid);
    const enriched=await Promise.all(pend.map(async f=>{
      const o=await getUser(f.uids.find(u=>u!==uid));
      return { id:f.id, name:o?.displayName||t('fallback.someone'), color:o?.color };
    }));
    if(reqBaseline===null){ reqBaseline=new Set(enriched.map(r=>r.id)); }   // base: no notifica las ya existentes
    else {
      for(const r of enriched) if(!reqBaseline.has(r.id)){ reqBaseline.add(r.id); showLocalNotif(t('push.friendreq.title'), t('push.friendreq.body',{name:r.name})); }
      const ids=new Set(enriched.map(r=>r.id)); for(const id of [...reqBaseline]) if(!ids.has(id)) reqBaseline.delete(id);
    }
    notifReqs=enriched; refreshNotif();
  }));
  // invitaciones a grupos entrantes
  notifUnsub.push(watchGroupInvites(uid, invites => {
    notifGroupInvites = invites;
    refreshNotif();
  }));
  // (las reacciones a MIS cacas se detectan en el listener del feed → detectReactionNotifs)
}
function stopNotifications(){ notifUnsub.forEach(u=>{try{u()}catch(e){}}); notifUnsub=[]; rxBaseline=null; reqBaseline=null; notifReqs=[]; notifRx=[]; notifGroupInvites=[]; unseenRx=0; _feedLoadedAt=0; renderNotifBadge(); }
function refreshNotif(){ renderNotifBadge(); if(!$("notifSheet").hidden) renderNotifSheet(); }
function renderNotifBadge(){ const n=notifReqs.length+notifGroupInvites.length+unseenRx; const b=$("notifBadge"); if(n>0){ b.textContent=n>9?"9+":String(n); b.hidden=false; } else b.hidden=true; }
const _notifName=ru=> ru===uid?t('rx.me'):(notifFriends[ru]||t('fallback.someone'));
// Resuelve el nombre de quien reacciona (es TU caca → puedes ver quién). Cachea en notifFriends.
async function resolveName(ru){
  if(ru===uid) return "Tú";
  if(notifFriends[ru]) return notifFriends[ru];
  try{ const u=await getUser(ru); const n=u?.displayName||t('fallback.someone'); notifFriends[ru]=n; return n; }
  catch{ return t('fallback.someone'); }
}
function renderNotifSheet(){
  const reqs=notifReqs.map(r=>`<li>${av(r.name,r.color)}<span class="nm">${r.name}<small>${t('notif.req.wantsyou')}</small></span><button class="btn-accept" data-accept="${r.id}">${t('amigos.req.accept')}</button><button class="btn-decline" data-decline="${r.id}">✕</button></li>`).join("");
  const ginvites=notifGroupInvites.map(inv=>`<li><span style="font-size:1.4rem;flex:none">💬</span><span class="nm"><b>${inv.groupName}</b><small>${t('notif.groupinvite.from',{name:inv.fromName})}</small></span><button class="btn-accept" data-ginvite="${inv.id}">${t('notif.groupinvite.accept')}</button><button class="btn-decline" data-gdecline="${inv.id}">✕</button></li>`).join("");
  const rx=notifRx.slice(0,30).map(v=>`<li class="notif-rx"><span class="notif-rx__e">${v.emoji}</span><span class="feed__txt"><b>${_notifName(v.reactorUid)}</b> ${t('notif.rx.reacted',{name:''}).trim()}</span><span class="feed__time">${fmtWhen(v.ts)}</span></li>`).join("");
  let html="";
  if(reqs)    html+=`<div class="notif-sec"><h4 class="notif-h">${t('notif.section.requests')}</h4><ul class="reqlist">${reqs}</ul></div>`;
  if(ginvites)html+=`<div class="notif-sec"><h4 class="notif-h">${t('notif.section.groupinvites')}</h4><ul class="reqlist">${ginvites}</ul></div>`;
  if(rx)      html+=`<div class="notif-sec"><h4 class="notif-h">${t('notif.section.rx')}</h4><ul class="notif-list">${rx}</ul></div>`;
  $("notifBody").innerHTML = html || `<p class="notif-empty">${t('notif.empty')}<br/><small>${t('notif.empty.sub')}</small></p>`;
}
function openNotif(){ unseenRx=0; renderNotifBadge(); renderNotifSheet(); $("notifSheet").hidden=false; }
$("notifBtn").addEventListener("click", openNotif);
$("notifClose").addEventListener("click", ()=>$("notifSheet").hidden=true);
$("notifSheet").addEventListener("click", e=>{ if(e.target===$("notifSheet")) $("notifSheet").hidden=true; });
// Estadísticas de una persona a partir de sus cacas (año actual + racha global)
function personStats(cacas){
  const yr=new Date().getFullYear();
  const yc=cacas.filter(c=>tzParts(c.ts,c.tz).year===yr);
  const allDays=new Set(); for(const c of cacas){ const d=new Date(c.ts); d.setHours(0,0,0,0); allDays.add(d.getTime()); }
  let streak=0,cur=startOfToday(); if(!allDays.has(cur))cur-=DAY; while(allDays.has(cur)){streak++;cur-=DAY;}
  const dayCount={}; for(const c of yc){ const p=tzParts(c.ts,c.tz); const k=`${p.year}-${p.month}-${p.day}`; dayCount[k]=(dayCount[k]||0)+1; }
  const activeDays=Object.keys(dayCount).length, total=yc.length;
  const bestDay=Math.max(0,...Object.values(dayCount));
  const avg=activeDays?(total/activeDays).toFixed(1):"0";
  const m=new Array(12).fill(0); for(const c of yc) m[tzParts(c.ts,c.tz).month-1]++;
  return { total, streak, activeDays, bestDay, avg, monthly:m };
}
async function openPersonSheet(entry, opts={}){
  if(entry.uid===uid){ setView("perfil"); return; }    // tú → tu perfil
  _psCurrentEntry = entry;
  $("psAvatar").textContent=initial(entry.name); $("psAvatar").style.background=entry.color;
  $("psName").textContent=entry.name; $("psTotal").textContent="…";
  $("psStats").innerHTML=""; $("psRecords").hidden=true; $("psChart").innerHTML=""; $("psGroups").innerHTML=""; $("psActions").innerHTML="";
  $("psSheet").hidden=false;
  // solo el doc del usuario (1 lectura). Stats desde contadores denormalizados, sin leer sus cacas.
  const u = await getUser(entry.uid);
  const year = u?.totalCount||0, life = u?.lifetimeCount||0;
  const cy=new Date().getFullYear(), cm=new Date().getMonth(), cbm=u?.countsByMonth||{};
  const monthly=new Array(12).fill(0); for(let i=0;i<12;i++) monthly[i]=cbm[`${cy}_${i}`]||0;
  const bestIdx = monthly.indexOf(Math.max(...monthly,0));
  $("psTotal").textContent=t('person.total',{year,life});
  $("psStats").innerHTML=`
    <div class="stat stat--accent"><b>${year}</b><span>${t('person.stat.year')}</span></div>
    <div class="stat"><b>${monthly[cm]}</b><span>${t('person.stat.month')}</span></div>
    <div class="stat"><b>${year?PM[bestIdx]:"—"}</b><span>${t('person.stat.bestmonth')}</span></div>
    <div class="stat"><b>${life}</b><span>${t('person.stat.total')}</span></div>`;
  // bloque de comparación yo vs este usuario (0 lecturas extra: todo en memoria / ya leído)
  const cmpEl = $("psCompare");
  if(me && cmpEl){
    const myMon = (me.countsByMonth||{})[`${cy}_${cm}`]||0;
    const myYear = me.totalCount||0;
    const myStreak = liveStreak(me.currentStreak, me.lastCacaTs);
    const theirStreak = liveStreak(u?.currentStreak, u?.lastCacaTs);
    // media/día: días naturales (medianoche a medianoche) desde la primera caca hasta hoy, ambos inclusive
    const _sinceFirst = firstTs => {
      if(!firstTs) return 1;
      const d0=new Date(firstTs); d0.setHours(0,0,0,0);
      const d1=new Date(); d1.setHours(0,0,0,0);
      return Math.max(1, Math.round((d1-d0)/86400000)+1);
    };
    const myAvg = ((me.lifetimeCount||myYear) / _sinceFirst(me.firstCacaTs||0)).toFixed(1);
    const theirAvg = ((u?.lifetimeCount||year) / _sinceFirst(u?.firstCacaTs||0)).toFixed(1);
    const myName = (me.displayName||"Tú").split(" ")[0], theirName = (entry.name||"?").split(" ")[0];
    const w=(a,b)=>a>b?"cmp-win":"", wt=(a,b)=>a>b?"cmp-win":"";
    cmpEl.hidden=false;
    cmpEl.innerHTML=`
      <div class="cmp-names"><span>${myName}</span><span>${theirName}</span></div>
      <div class="cmp-row"><span class="cmp-val ${w(myMon,monthly[cm])}">${myMon}<span class="cmp-meta">${t('person.cmp.month')}</span></span><span class="cmp-sep">vs</span><span class="cmp-val ${w(monthly[cm],myMon)}">${monthly[cm]}<span class="cmp-meta">${t('person.cmp.month')}</span></span></div>
      <div class="cmp-row"><span class="cmp-val ${w(myYear,year)}">${myYear}<span class="cmp-meta">${t('person.cmp.year')}</span></span><span class="cmp-sep">vs</span><span class="cmp-val ${w(year,myYear)}">${year}<span class="cmp-meta">${t('person.cmp.year')}</span></span></div>
      <div class="cmp-row"><span class="cmp-val ${w(+myAvg,+theirAvg)}">${myAvg}<span class="cmp-meta">${t('person.cmp.avg')}</span></span><span class="cmp-sep">vs</span><span class="cmp-val ${w(+theirAvg,+myAvg)}">${theirAvg}<span class="cmp-meta">${t('person.cmp.avg')}</span></span></div>
      <div class="cmp-row"><span class="cmp-val ${w(myStreak,theirStreak)}">${myStreak} 🔥<span class="cmp-meta">${t('person.cmp.streak')}</span></span><span class="cmp-sep">vs</span><span class="cmp-val ${w(theirStreak,myStreak)}">${theirStreak} 🔥<span class="cmp-meta">${t('person.cmp.streak')}</span></span></div>`;
  } else if(cmpEl){ cmpEl.hidden=true; }
  $("psChart").innerHTML=barsHTML(monthly, PM);
  // horas y día de la semana: desde los rollups del amigo (byHour/byWeekday), SIN leer
  // sus cacas. Solo si ya los tiene (usuario nuevo o que ha abierto su perfil tras el backfill).
  const bh=u?.byHour||{}, bw=u?.byWeekday||{};
  if(Object.keys(bh).length){
    const h=Array.from({length:24},(_,i)=>bh[i]||0), peak=h.indexOf(Math.max(...h));
    $("psPeakHour").textContent=t('perfil.chart.peak',{h:String(peak).padStart(2,"0"),n:h[peak]});
    $("psChartHours").innerHTML=barsHTML(h, h.map((_,i)=>i%6===0?i:""), {showVal:false});
    $("psHoursWrap").hidden=false;
  } else $("psHoursWrap").hidden=true;
  if(Object.keys(bw).length){
    const wk=Array.from({length:7},(_,i)=>bw[i]||0), WD=["L","M","X","J","V","S","D"];
    $("psChartWeek").innerHTML=barsHTML(wk, WD);
    $("psWeekWrap").hidden=false;
  } else $("psWeekWrap").hidden=true;
  // grupos en común: caché del viewer (sin leer)
  const groups = myGroupsCache.length ? myGroupsCache : (myGroupsCache = await myGroups(uid));
  const shared = groups.filter(g=>(g.members||[]).includes(entry.uid));
  $("psGroupsWrap").hidden = !shared.length;
  $("psGroups").innerHTML=shared.map(g=>`<button class="btn-solid psg" data-gid="${g.id}">🏆 ${g.name}</button>`).join("");
  // Mapa + Chat: dos tarjetas lado a lado (como en grupos). El mapa se atenúa si el
  // amigo no comparte su mapa (shareMap off).
  const mapCard = u?.shareMap !== false
    ? `<button class="gact" id="psFriendMap" data-uid="${entry.uid}" data-name="${(entry.name||"").replace(/"/g,"")}"><span class="gact__ico">🗺️</span><span>${t('grupos.map.short')}</span></button>`
    : `<button class="gact gact--off" disabled><span class="gact__ico">🔒</span><span>${t('person.map.privshort')}</span></button>`;
  const chatCard = `<button class="gact" data-pschat="1"><span class="gact__ico">💬</span><span>${t('chat.open.short')}</span></button>`;
  $("psActions").innerHTML = mapCard + chatCard;

  // gestión de amistad, ABAJO del todo: solo desde Amigos (canManage). Si compartís
  // grupo no se puede eliminar → nota sutil en vez de botón.
  let mgmt = "";
  if(opts.canManage){
    const fr=(await myFriendships(uid)).find(f=>f.status==="accepted" && f.uids.includes(entry.uid));
    if(fr) mgmt = shared.length
      ? `<p class="ps-note">${t('person.friend.shared')}</p>`
      : `<button class="btn-ghost btn-ghost--danger" data-rmfriend="${fr.id}">${t('person.friend.remove')}</button>`;
  }
  $("psFriendMgmt").innerHTML = mgmt;
}
$("psClose").addEventListener("click",()=>$("psSheet").hidden=true);
$("psSheet").addEventListener("click",e=>{ if(e.target===$("psSheet")) $("psSheet").hidden=true; });
let _psCurrentEntry = null;
$("psActions").addEventListener("click", async e=>{
  const mb=e.target.closest("#psFriendMap");
  if(mb){ $("psSheet").hidden=true; openMap({uid:mb.dataset.uid, name:mb.dataset.name}); return; }
  if(e.target.closest("[data-pschat]")){ if(!_psCurrentEntry) return; $("psSheet").hidden=true; await openDMChat(_psCurrentEntry.uid, _psCurrentEntry.name); return; }
});
$("psFriendMgmt").addEventListener("click", async e=>{
  const b=e.target.closest("[data-rmfriend]"); if(!b)return;
  if(!confirm(t('confirm.friend.remove'))) return;
  try{ await removeFriend(b.dataset.rmfriend); toast(t('toast.friend.removed')); $("psSheet").hidden=true; if(document.querySelector(".view.is-active")?.dataset.view==="amigos") renderAmigos(); }
  catch(err){ toast(t('toast.friend.fail')); console.error(err); }
});
$("psGroups").addEventListener("click", async e=>{
  const b=e.target.closest("[data-gid]"); if(!b)return;
  $("psSheet").hidden=true; setView("grupos");
  const gs=await myGroups(uid); myGroupsCache=gs; const g=gs.find(x=>x.id===b.dataset.gid); if(g) openGroup(g);
});

/* ---------- +1 / −1 / corregir ---------- */
let busy=false; const ADD_COOLDOWN=1500;   // bloqueo anti-spam del +1
$("addBtn").addEventListener("click",async e=>{
  if(maintOn){ haptic(8); toast(t('toast.maint.block')); return; }
  if(busy||!uid)return; busy=true;
  const btn=$("addBtn"),r=btn.getBoundingClientRect(); const t0=Date.now();
  btn.classList.add("flash","addbtn--cooldown");setTimeout(()=>btn.classList.remove("flash"),350);haptic(18);
  const num=$("meCount");num.textContent=(parseInt(num.textContent,10)||0)+1;
  num.classList.remove("pop");void num.offsetWidth;num.classList.add("pop");floatPoo(r.left+r.width/2,r.top);
  try{
    await _graphPromise;   // si el grafo aún se está cargando, esperamos; si ya está listo es un no-op
    const loc = me?.locationMode==="always" ? await getGeo() : null;
    await addCaca(uid, loc, actMeta()); toast(loc?t('toast.caca.geo'):t('toast.caca.ok'));
    bumpChipsLocal(); _statsLoadedAt=0;   // chips al instante (sin leer); el listener pinta el feed
    checkSyncPoop();         // ¿algún amigo ha cagado hace <5 min? → conexión de tuberías
  }
  catch(err){
    if(!navigator.onLine){
      outboxAdd({ ts: Date.now(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      $("meCount").textContent = (parseInt($("meCount").textContent)||0) + 1;
      toast("💾 Sin conexión — caca guardada, se sincronizará después");
    } else {
      toast(t('toast.caca.fail')); console.error(err);
    }
  }
  finally{ const wait=Math.max(0, ADD_COOLDOWN-(Date.now()-t0)); setTimeout(()=>{ busy=false; btn.classList.remove("addbtn--cooldown"); }, wait); }
});
async function undoCaca(){
  if(busy||!uid)return; busy=true;
  try{ const ok=await removeCaca(uid, actMeta()); toast(ok?t('toast.caca.undo.ok'):t('toast.caca.undo.empty')); _statsLoadedAt=0; loadActivity("force"); }
  catch(err){ toast(t('toast.caca.undo.fail')); console.error(err); }
  finally{ setTimeout(()=>busy=false,250); }
}
$("fixBtn").addEventListener("click",async()=>{
  if(!confirm(t('confirm.reset.1'))) return;
  if(!confirm(t('confirm.reset.2'))) return;
  try{ $("settingsSheet").hidden=true; toast(t('toast.reset.loading')); await resetCacas(uid, actMeta()); statsCacas=[]; _statsLoadedAt=0; loadActivity("force"); toast(t('toast.reset.ok')); }
  catch(err){ toast(t('toast.reset.fail')); console.error(err); }
});

/* ---------- caca olvidada (late) ---------- */
const _pad=n=>String(n).padStart(2,"0");
const localDT=(d=new Date())=>`${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
function openLateSheet(){ const now=new Date(); $("lateWhen").value=localDT(now); $("lateWhen").max=localDT(now); $("lateSheet").hidden=false; }
$("menuBtn").addEventListener("click",()=>{ $("menuSheet").hidden=false; });
$("menuSheet").addEventListener("click",e=>{ if(e.target===$("menuSheet")) $("menuSheet").hidden=true; });
$("miCancel").addEventListener("click",()=>$("menuSheet").hidden=true);
$("miLate").addEventListener("click",()=>{ $("menuSheet").hidden=true; openLateSheet(); });
$("miStats").addEventListener("click",()=>{ $("menuSheet").hidden=true; setView("perfil"); });
$("miUndo").addEventListener("click",()=>{ $("menuSheet").hidden=true; undoCaca(); });
$("miGeo").addEventListener("click", async ()=>{
  $("menuSheet").hidden=true;
  if(busy||!uid)return; busy=true; toast(t('toast.geo.loading'));
  try{ await _graphPromise; const loc=await getGeo(); await addCaca(uid,loc, actMeta()); toast(loc?t('toast.caca.geo'):t('toast.caca.nogeo')); bumpChipsLocal(); _statsLoadedAt=0; checkSyncPoop(); }
  catch(err){ toast(t('toast.caca.fail')); console.error(err); }
  finally{ setTimeout(()=>busy=false,250); }
});
$("lateCancel").addEventListener("click",()=>$("lateSheet").hidden=true);
$("lateSheet").addEventListener("click",e=>{ if(e.target===$("lateSheet")) $("lateSheet").hidden=true; });
$("lateConfirm").addEventListener("click",async()=>{
  const v=$("lateWhen").value; if(!v)return;
  const ts=new Date(v).getTime();
  if(isNaN(ts)) return toast(t('toast.caca.late.invalid'));
  if(ts>Date.now()+60000) return toast(t('toast.caca.late.future'));
  $("lateSheet").hidden=true;
  try{ await _graphPromise; await addCacaAt(uid,ts, actMeta()); haptic(18); toast(t('toast.caca.late.ok')); _statsLoadedAt=0; loadActivity("force"); }
  catch(err){ toast(t('toast.caca.late.fail')); console.error(err); }
});

/* ---------- amigos ---------- */
function setFriendForm(show){
  $("friendForm").hidden=!show; $("toggleFriendForm").classList.toggle("on",show);
  if(show) setTimeout(()=>$("friendEmail")?.focus(),60);
}
$("toggleFriendForm").addEventListener("click", ()=> setFriendForm($("friendForm").hidden));
$("addFriendBtn").addEventListener("click",async()=>{
  const email=$("friendEmail").value.trim(); const msg=$("friendMsg");
  if(!email)return; msg.hidden=true;
  try{ const o=await sendFriendRequest(uid,email); $("friendEmail").value="";
    msg.textContent=t('amigos.req.sent',{name:o.displayName}); msg.style.color="var(--mint)"; msg.hidden=false; renderAmigos(); }
  catch(err){ msg.style.color="var(--rose)";
    msg.textContent=err.message==="no-user"?t('amigos.req.nouser'):err.message==="self"?t('amigos.req.self'):t('amigos.req.fail'); msg.hidden=false; }
});
let friendSort="rank", _friends=[];
document.querySelector(".sortbar").addEventListener("click", e=>{
  const b=e.target.closest("[data-sort]"); if(!b)return;
  friendSort=b.dataset.sort;
  document.querySelectorAll(".sortbar [data-sort]").forEach(x=>x.classList.toggle("on",x.dataset.sort===friendSort));
  renderFriendsList();
});
function renderFriendsList(){
  const board=[{id:uid,displayName:me?.displayName,color:me?.color,totalCount:me?.totalCount||0}, ..._friends];
  if(friendSort==="alpha") board.sort((a,b)=>(a.displayName||"").localeCompare(b.displayName||"","es",{sensitivity:"base"}));
  else board.sort((a,b)=>(b.totalCount||0)-(a.totalCount||0));
  $("friendsRank").innerHTML = board.length>1 ? board.map((r,i)=>`<li class="${r.id===uid?'me':''}" ${r.id!==uid?`data-uid="${r.id}"`:""}><span class="pos">${friendSort==="rank"?i+1:"·"}</span>${av(r.displayName,r.color)}<span class="nm">${r.displayName||"?"}${r.id===uid?` <small>${t('label.you')}</small>`:''}</span><span class="ct">${r.totalCount||0}</span></li>`).join("")
    : `<li class="gempty">${t('amigos.empty')}</li>`;
}
async function renderAmigos(){
  const [fships, friends] = await Promise.all([ myFriendships(uid), getFriends(uid) ]);
  _friends=friends;
  // requests
  const pending=fships.filter(f=>f.status==="pending");
  const incoming=pending.filter(f=>f.requestedBy!==uid);
  const outgoing=pending.filter(f=>f.requestedBy===uid);
  $("reqBlock").hidden = !pending.length;
  const incHtml=await Promise.all(incoming.map(async f=>{
    const other=await getUser(f.uids.find(u=>u!==uid));
    return `<li>${av(other?.displayName,other?.color)}<span class="nm">${other?.displayName||"?"}<small>${t('amigos.req.wantsyou')}</small></span>
      <button class="btn-accept" data-accept="${f.id}">${t('amigos.req.accept')}</button><button class="btn-decline" data-decline="${f.id}">✕</button></li>`;
  }));
  const outHtml=await Promise.all(outgoing.map(async f=>{
    const other=await getUser(f.uids.find(u=>u!==uid));
    return `<li>${av(other?.displayName,other?.color)}<span class="nm">${other?.displayName||"?"}<small>${t('amigos.req.pending')}</small></span></li>`;
  }));
  $("reqList").innerHTML=[...incHtml,...outHtml].join("");
  setFriendForm(false);            // empezamos con el form oculto tras ＋
  renderFriendsList();
}
// clic en un amigo de la lista → su ficha (con gestión: eliminar)
$("friendsRank").addEventListener("click", e=>{
  const li=e.target.closest("li[data-uid]"); if(!li)return;
  const f=_friends.find(x=>x.id===li.dataset.uid);
  if(f) openPersonSheet({ uid:f.id, name:f.displayName, color:f.color||colorForUid(f.id) }, { canManage:true });
});
document.addEventListener("click",async e=>{
  const a=e.target.closest("[data-accept]"); const d=e.target.closest("[data-decline]");
  const gi=e.target.closest("[data-ginvite]"); const gd=e.target.closest("[data-gdecline]");
  if(a){ await acceptFriend(a.dataset.accept, uid); _graphAt=0; toast(t('toast.friend.accepted')); renderAmigos(); loadActivity("force"); }
  if(d){ await removeFriend(d.dataset.decline); renderAmigos(); }
  if(gi){ openGroupInviteSheet(notifGroupInvites.find(x=>x.id===gi.dataset.ginvite)); }
  if(gd){ try{ await declineGroupInvite(gd.dataset.gdecline); toast(t('notif.groupinvite.declined')); }catch(e){ console.error(e); } }
});
// acordeón de grupos: la cabecera despliega/colapsa el grupo
$("groupList").addEventListener("click", e=>{
  const h=e.target.closest("[data-gtoggle]"); if(!h)return;
  const gid=h.dataset.gtoggle;
  if(activeGroup && activeGroup.id===gid) collapseGroup();
  else openGroupById(gid);
});

/* ---------- grupos ---------- */
let activeGroup=null, myGroupsCache=[];
$("createGroupBtn").addEventListener("click", async ()=>{
  const name=$("newGroupName").value.trim(); const msg=$("groupMsg"); msg.hidden=true;
  if(!name)return;
  try{ const g=await createGroup(uid,name); $("newGroupName").value=""; toast(t('toast.group.created')); await renderGrupos(); openGroup(g); }
  catch(err){ msg.style.color="var(--rose)"; msg.textContent=t('grupos.create.fail'); msg.hidden=false; console.error(err); }
});
$("joinGroupBtn").addEventListener("click", async ()=>{
  const code=$("joinCode").value.trim(); const msg=$("groupMsg"); msg.hidden=true;
  if(!code)return;
  if(!confirm(t('confirm.group.join'))) return;
  try{ const g=await joinGroup(uid,code); $("joinCode").value=""; toast(t('toast.group.joined',{name:g.name})); await renderGrupos(); openGroup(g); }
  catch(err){ msg.style.color="var(--rose)"; msg.textContent=err.message==="no-group"?t('grupos.join.invalid'):t('grupos.join.fail'); msg.hidden=false; }
});
$("shareCode").addEventListener("click", ()=>{ if(activeGroup) shareInvite(inviteUrl("join="+encodeURIComponent(activeGroup.inviteCode)), t('grupos.invite.text',{name:activeGroup.name})); });
$("inviteToGroupBtn").addEventListener("click", ()=>{ if(activeGroup) openGroupInvitePicker(activeGroup); });
$("groupMapBtn").addEventListener("click", ()=>{ if(activeGroup) openGroupMap(activeGroup); });
$("groupChatBtn").addEventListener("click", ()=>{ if(activeGroup) openGroupChat(activeGroup); });
$("leaveGroupBtn").addEventListener("click", async ()=>{
  if(!activeGroup)return; if(!confirm(t('confirm.group.leave',{name:activeGroup.name})))return;
  try{ await leaveGroup(activeGroup.id, uid); activeGroup=null; $("groupDetail").hidden=true; toast(t('toast.group.left')); renderGrupos(); }
  catch(err){ toast(t('toast.group.leave.fail')); console.error(err); }
});
function setGroupForms(show){
  $("groupForms").hidden = !show;
  $("toggleGroupForms").classList.toggle("on", show);
  if(show) setTimeout(()=>$("newGroupName")?.focus(), 60);
}
$("toggleGroupForms").addEventListener("click", ()=> setGroupForms($("groupForms").hidden));
// aparca el detalle FUERA de la lista (para que innerHTML no lo destruya). Sync, sin await.
function parkDetail(){ const det=$("groupDetail"); if(det){ det.hidden=true; $("view-grupos").appendChild(det); } }
function collapseGroup(){
  parkDetail();
  document.querySelectorAll("#groupList li").forEach(x=>x.classList.remove("is-open"));
  activeGroup=null;
}
let _gruposBusy=false;
async function renderGrupos(){
  if(_gruposBusy) return;                       // evita renders solapados (race que destruía #groupDetail)
  _gruposBusy=true;
  try{
    const groups = await myGroups(uid);         // 1) traer datos ANTES de tocar el DOM
    myGroupsCache = groups; _graphAt=0;          // refresca la audiencia (pudo cambiar la pertenencia a grupos)
    parkDetail();                               // 2) aparcar detalle y reescribir lista SIN await en medio
    const n = groups.length;
    $("groupList").innerHTML = n ? groups.map(g=>`
      <li data-gid="${g.id}">
        <div class="ghead" data-gtoggle="${g.id}">
          <span class="gname">${g.name}</span>
          <span class="gmeta">${(g.members||[]).length} 👤</span>
          <span class="gchev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>
        </div>
      </li>`).join("")
      : `<li class="gempty">${t('grupos.empty')}</li>`;
    setGroupForms(n===0);
    const still = activeGroup && groups.find(g=>g.id===activeGroup.id);
    activeGroup=null;
    if(still) await openGroup(still);
    else if(n===1) await openGroup(groups[0]);
  } finally { _gruposBusy=false; }
}
function openGroupById(gid){ const g=myGroupsCache.find(x=>x.id===gid); if(g) openGroup(g); }
const MF=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
async function openGroup(group){
  const det=$("groupDetail"); if(!det) return;  // protección: si no existe, no reventamos
  activeGroup=group;
  const li=document.querySelector(`#groupList li[data-gid="${group.id}"]`);
  if(li) li.appendChild(det);                   // mete el detalle bajo la cabecera (acordeón)
  det.hidden=false;
  document.querySelectorAll("#groupList li[data-gid]").forEach(x=>x.classList.toggle("is-open", x.dataset.gid===group.id));
  $("shareCode").textContent=`🔗 Invitar · ${group.inviteCode}`;
  $("groupDetailName").textContent=group.name;
  $("groupAdminBtn").hidden = (group.createdBy !== uid);
  const board=await groupLeaderboard(group);
  const year=new Date().getFullYear(), curMonth=new Date().getMonth();
  const ws=new Date(); ws.setHours(0,0,0,0); ws.setDate(ws.getDate()-((ws.getDay()+6)%7)); const weekStart=ws.getTime();

  // meses por miembro: desde el contador denormalizado `countsByMonth` (sin leer cacas).
  // Fallback: si algún miembro todavía no está backfilleado, leemos las cacas del año una vez.
  const perU={}; board.forEach(r=>perU[r.id]={ name:r.displayName||"?", months:new Array(12).fill(0), total:0 });
  const allBackfilled=board.every(r=>r.countsByMonth);
  if(allBackfilled){
    board.forEach(r=>{ for(let i=0;i<12;i++){ const v=r.countsByMonth?.[`${year}_${i}`]||0; perU[r.id].months[i]=v; perU[r.id].total+=v; } });
  }else{
    const yc=await groupYearCacas(group);   // solo hasta que el backfill rellene countsByMonth
    for(const c of yc){ const u=perU[c.uid]; if(!u)continue; u.months[tzParts(c.ts,c.tz).month-1]++; u.total++; }
  }

  // ranking por periodo. Mes/Año salen de perU/board (cero lecturas extra). Semana se carga bajo demanda.
  let weekByU=null;
  const metricOf=p => p==='year'?(r=>r.totalCount||0) : p==='month'?(r=>perU[r.id]?.months[curMonth]||0) : (r=>weekByU?.[r.id]||0);
  function renderRank(period){
    const m=metricOf(period);
    const ranked=[...board].sort((a,b)=>m(b)-m(a));
    const yr=period!=='year';
    $("groupRank").innerHTML=ranked.map((r,i)=>`<li class="${r.id===uid?'me':''}"><span class="pos">${i+1}</span>${av(r.displayName,r.color)}<span class="nm">${r.displayName||"?"}${r.id===uid?` <small>${t('label.you')}</small>`:''}</span><span class="ct">${m(r)}${yr?`<small class="rank__yr">${r.totalCount||0} ${t('grupos.rank.year')}</small>`:""}</span></li>`).join("")
      || `<p class="notif-empty">${t('grupos.rank.empty')}</p>`;
  }
  const seg=$("rankPeriod");
  async function selectPeriod(period, btn){
    seg.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===btn));
    if(period==="week" && !weekByU){
      $("groupRank").innerHTML=`<p class="notif-empty">${t('grupos.rank.loading')}</p>`;
      try{ weekByU={}; const cs=await groupCacasSince(group, weekStart); for(const c of cs) weekByU[c.uid]=(weekByU[c.uid]||0)+1; }
      catch(e){ weekByU={}; console.error("week:",e); }
    }
    renderRank(period);
  }
  seg.querySelectorAll("button").forEach(b=>{ b.onclick=()=>selectPeriod(b.dataset.period,b); });
  selectPeriod("month", seg.querySelector('[data-period="month"]'));

  // estadísticas del grupo (este año) — desde perU, sin lecturas extra.
  const byMonth=new Array(12).fill(0); let total=0;
  for(const id in perU){ perU[id].months.forEach((v,i)=>byMonth[i]+=v); total+=perU[id].total; }
  const members=(group.members||[]).length, bestIdx=byMonth.indexOf(Math.max(...byMonth,0));
  $("gStatGrid").innerHTML=`
    <div class="stat stat--accent"><b>${total}</b><span>${t('grupos.stat.total')}</span></div>
    <div class="stat"><b>${members}</b><span>${t('grupos.stat.members')}</span></div>
    <div class="stat"><b>${total?MF[bestIdx]:"—"}</b><span>${t('grupos.stat.bestmonth')}</span></div>
    <div class="stat"><b>${members?(total/members).toFixed(1):0}</b><span>${t('grupos.stat.avg')}</span></div>`;
  renderGroupStack(board.map(r=>({ uid:r.id, ...perU[r.id] })));
}
// barra apilada por persona, segmentada por mes (este año)
const MONTHS_FULL=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MONTH_COLORS=["#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F","#EDC948","#B07AA1","#FF9DA7","#9C755F","#9D7660","#86BCB6","#D37295"];
function renderGroupStack(arr){
  const max=Math.max(1,...arr.map(m=>m.total)), H=200;
  $("gStack").innerHTML = arr.map(m=>{
    let segs="";
    for(let i=11;i>=0;i--){ const v=m.months[i]; if(!v)continue; const h=Math.round(v/max*H);
      segs += `<div class="seg" style="height:${h}px;background:${MONTH_COLORS[i]}">${h>=15?`<span>${v}</span>`:""}</div>`; }
    return `<div class="stackcol"><div class="stackbar">${segs}</div><div class="stacklbl">${m.name}<small>${m.total}</small></div></div>`;
  }).join("") || `<p class="notif-empty">${t('grupos.stack.empty')}</p>`;
  // leyenda: solo meses con datos en el grupo
  const used=new Set(); arr.forEach(m=>m.months.forEach((v,i)=>{ if(v)used.add(i); }));
  $("gStackLegend").innerHTML=[...used].sort((a,b)=>a-b).map(i=>`<span class="lg"><i style="background:${MONTH_COLORS[i]}"></i>${MONTHS_FULL[i]}</span>`).join("");
}

/* ---------- nav ---------- */
document.querySelectorAll("[data-view]").forEach(b=>{ if(b.classList.contains("view"))return;
  b.addEventListener("click",()=>setView(b.dataset.view)); });
function setView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("is-active",v.dataset.view===name));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("is-active",t.dataset.view===name));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="inicio") loadActivity();
  if(name==="amigos") renderAmigos();
  if(name==="grupos") renderGrupos();
  if(name==="perfil") loadStats();
}

/* ---------- estadísticas (perfil) ---------- */
const _fmtCache={};
function tzFmt(tz){ tz=tz||"Europe/Madrid"; if(!_fmtCache[tz]) _fmtCache[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",hourCycle:"h23",weekday:"short"}); return _fmtCache[tz]; }
const _wd={Sun:6,Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5};
function tzParts(ts,tz){ const p=tzFmt(tz).formatToParts(new Date(ts)); const g=t=>p.find(x=>x.type===t)?.value;
  return { year:+g("year"), month:+g("month"), day:+g("day"), hour:(+g("hour"))%24, weekday:_wd[g("weekday")]??0 }; }

async function renderProfileGroups(){
  const gs = myGroupsCache.length ? myGroupsCache : (myGroupsCache = await myGroups(uid));
  $("pGroups").innerHTML=gs.map(g=>`<button class="btn-solid psg psg--chip" data-pgid="${g.id}">🏆 ${g.name}</button>`).join("");
}
$("pGroups").addEventListener("click", e=>{
  const b=e.target.closest("[data-pgid]"); if(!b)return;
  setView("grupos"); openGroupById(b.dataset.pgid);
});

let statsCacas=[], statsYears=[], statsScope=new Date().getFullYear(), _statsLoadedAt=0;
// Backfill perezoso de los rollups por hora/día-semana: la 1ª vez (usuario aún en
// statsV<2), los calcula desde las cacas YA cargadas y los guarda. Idempotente: al
// escribir, watchMe actualiza me.statsV y no vuelve a entrar. Un flag de sesión evita
// dobles escrituras mientras llega ese update.
let _backfilling=false;
function backfillRollups(){
  if(_backfilling || !me || me.statsV===STATS_V || !statsCacas.length) return;
  _backfilling=true;
  const byHour={}, byWeekday={};
  for(const c of statsCacas){ const p=tzParts(c.ts,c.tz); byHour[p.hour]=(byHour[p.hour]||0)+1; byWeekday[p.weekday]=(byWeekday[p.weekday]||0)+1; }
  updateMe(uid, { byHour, byWeekday, statsV:STATS_V })
    .catch(e=>{ console.warn("backfill rollups:", e); _backfilling=false; });
}
async function loadStats(){
  renderProfileGroups();
  // caché por sesión: solo releemos si caducó (2 min) o se invalidó tras añadir/quitar caca
  if(!(statsCacas.length && Date.now()-_statsLoadedAt < 120000)){
    statsCacas = await myActivity(uid, 2000);
    _statsLoadedAt = Date.now();
  }
  statsYears = [...new Set(statsCacas.map(c=>tzParts(c.ts,c.tz).year))].sort((a,b)=>b-a);
  if(!(statsScope==="all" || statsYears.includes(statsScope))) statsScope = statsYears[0] || new Date().getFullYear();
  backfillRollups();
  renderYearSel(); renderStats();
}
function renderYearSel(){
  $("yearSel").innerHTML = statsYears.map(y=>`<button class="ychip ${statsScope===y?'on':''}" data-year="${y}">${y}</button>`).join("")
    + `<button class="ychip ${statsScope==='all'?'on':''}" data-year="all">${t('perfil.year.all')}</button>`;
}
$("yearSel").addEventListener("click", e=>{ const b=e.target.closest("[data-year]"); if(!b)return;
  statsScope = b.dataset.year==="all" ? "all" : +b.dataset.year; renderYearSel(); renderStats(); });
function renderStats(){
  const items = statsScope==="all" ? statsCacas : statsCacas.filter(c=>tzParts(c.ts,c.tz).year===statsScope);
  const total=items.length;
  const dayCount={}; for(const c of items){ const p=tzParts(c.ts,c.tz); const k=`${p.year}-${p.month}-${p.day}`; dayCount[k]=(dayCount[k]||0)+1; }
  const bestDay=Math.max(0,...Object.values(dayCount),0);
  const curStreak = liveStreak(me?.currentStreak, me?.lastCacaTs);
  const bestStreak = me?.longestStreak || 0;
  const _now=new Date(), _cm=_now.getMonth(), _cy=_now.getFullYear();
  // media este año: cacas del año actual ÷ días transcurridos desde el 1 ene (o desde la primera caca si fue este año)
  const firstTs = me?.firstCacaTs || 0;
  const jan1 = new Date(_cy, 0, 1);
  const yearStartRaw = firstTs ? new Date(Math.max(firstTs, jan1.getTime())) : jan1;
  const yearStartDay = new Date(yearStartRaw); yearStartDay.setHours(0,0,0,0);
  const todayMid = new Date(); todayMid.setHours(0,0,0,0);
  const thisYearCount = statsCacas.filter(c=>tzParts(c.ts,c.tz).year===_cy).length;
  const daysElapsedYear = Math.max(1, Math.round((todayMid-yearStartDay)/86400000)+1);
  const yearAvg = thisYearCount ? (thisYearCount/daysElapsedYear).toFixed(2) : "—";
  // media histórica: solo si hay datos de años anteriores
  const hasMultiYear = firstTs && new Date(firstTs).getFullYear() < _cy;
  const daysSinceStart = firstTs ? (()=>{ const d0=new Date(firstTs); d0.setHours(0,0,0,0); const d1=new Date(); d1.setHours(0,0,0,0); return Math.max(1,Math.round((d1-d0)/86400000)+1); })() : 0;
  const lifeAvg = (hasMultiYear && (me?.lifetimeCount||0)) ? ((me.lifetimeCount/daysSinceStart).toFixed(2)) : null;
  // media este mes: cacas del mes actual ÷ días transcurridos del mes
  const thisMonthCount=(me?.countsByMonth||{})[`${_cy}_${_cm}`]||0;
  const daysElapsedMonth=_now.getDate();
  const monthAvg=(thisMonthCount/daysElapsedMonth).toFixed(2);
  // Opción 3 (mixta): en un AÑO PASADO no tienen sentido "media/mes", "racha actual"
  // ni "media este año" → mostramos solo lo propio del año (total, mejor día,
  // media/día del año) + gráficas. El año en curso y el histórico se quedan igual.
  const isPastYear = statsScope!=="all" && statsScope!==_cy;
  let extraTiles;
  if(isPastYear){
    // media/día del año: cacas del año ÷ días activos (desde tu 1ª caca o el 1-ene, hasta el 31-dic)
    const jan1Y=new Date(statsScope,0,1).getTime(), dec31Y=new Date(statsScope,11,31).getTime();
    const startY=firstTs?Math.max(firstTs,jan1Y):jan1Y;
    const d0=new Date(startY);d0.setHours(0,0,0,0); const d1=new Date(dec31Y);d1.setHours(0,0,0,0);
    const daysY=Math.max(1,Math.round((d1-d0)/DAY)+1);
    const pastAvg=total?(total/daysY).toFixed(2):"—";
    extraTiles=`<div class="stat"><b>${pastAvg}</b><span>${t('perfil.stat.avg')}</span></div>`;
  } else {
    extraTiles=`
      <div class="stat"><b>${yearAvg}</b><span>${t('perfil.stat.avg_year')}</span></div>
      ${lifeAvg!==null?`<div class="stat"><b>${lifeAvg}</b><span>${t('perfil.stat.avg_total')}</span></div>`:''}
      <div class="stat"><b>${monthAvg}</b><span>${t('perfil.stat.avg_month')}</span></div>
      <div class="stat stat--streak">
        <div class="half"><b>${curStreak} 🔥</b><span>${t('perfil.stat.streak')}</span></div>
        <div class="half"><b>${bestStreak}</b><span>${t('perfil.stat.beststreak')}</span></div>
      </div>`;
  }
  $("statGrid").innerHTML=`
    <div class="stat stat--accent"><b>${total}</b><span>${statsScope==="all"?t('perfil.stat.total_historical'):statsScope}</span></div>
    <div class="stat"><b>${bestDay}</b><span>${t('perfil.stat.bestday')}</span></div>
    ${extraTiles}`;
  if(statsScope==="all"){
    $("chartTitle").textContent=t('perfil.chart.byyear');
    const by={}; for(const c of items){ const y=tzParts(c.ts,c.tz).year; by[y]=(by[y]||0)+1; }
    const ys=Object.keys(by).sort();
    $("chartPrimary").innerHTML=barsHTML(ys.map(y=>by[y]), ys.map(y=>String(y).slice(2))) || `<div class="bar"><span class="barlbl">—</span></div>`;
  } else {
    $("chartTitle").textContent=t('perfil.chart.bymonth');
    const m=new Array(12).fill(0); for(const c of items) m[tzParts(c.ts,c.tz).month-1]++;
    const M=["E","F","M","A","M","J","J","A","S","O","N","D"];
    $("chartPrimary").innerHTML=barsHTML(m, M);
  }
  const h=new Array(24).fill(0); for(const c of items) h[tzParts(c.ts,c.tz).hour]++;
  const peak=total?h.indexOf(Math.max(...h)):-1;
  $("peakHour").textContent = peak>=0?t('perfil.chart.peak',{h:String(peak).padStart(2,"0"),n:h[peak]}):"—";
  $("chartHours").innerHTML=barsHTML(h, h.map((_,i)=>i%6===0?i:""), {showVal:false});
  const w=new Array(7).fill(0); for(const c of items) w[tzParts(c.ts,c.tz).weekday]++;
  const WD=["L","M","X","J","V","S","D"];
  $("chartWeek").innerHTML=barsHTML(w, WD);
}

/* ---------- refrescar al volver a primer plano ---------- */
// La PWA se "reanuda" en la misma pestaña sin navegar; recargamos sus datos.
let _lastResume=0;
function refreshActiveView(force){
  if(!uid) return Promise.resolve();
  // anti-rebote: volver a la app (focus+visibility se disparan juntos) no relee si fue hace <60s
  if(!force && Date.now()-_lastResume < 60000) return Promise.resolve();
  _lastResume=Date.now();
  const active = document.querySelector(".view.is-active")?.dataset.view;
  if(active==="inicio") return loadActivity(force?"force":undefined);
  if(active==="amigos") return renderAmigos();
  if(active==="grupos") return renderGrupos();
  if(active==="perfil") return loadStats();
  return Promise.resolve();
}
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") refreshActiveView(); });
window.addEventListener("focus", refreshActiveView);

/* ---------- botón atrás (Android/web): cierra capas → va a Inicio ---------- */
const OVERLAY_IDS=["settingsSheet","adminSheet","notifSheet","psSheet","reactSheet","lateSheet","menuSheet","mapSheet","friendInviteSheet"];
function closeOverlays(){ let any=false; for(const id of OVERLAY_IDS){ const e=$(id); if(e && !e.hidden){ e.hidden=true; any=true; } } return any; }
const curView = () => document.querySelector(".view.is-active")?.dataset.view;
// "trap": una entrada extra en el historial para capturar el back y no salir de la PWA
history.replaceState({ cago:1 }, "");
history.pushState({ cago:1 }, "");
window.addEventListener("popstate", e=>{
  // Si estamos en chat, delegar al handler del chat (definido más abajo)
  if(_chatNavDepth > 0){ _handleChatPopstate(e); return; }
  if($("gate") && !$("gate").hidden){ history.pushState({cago:1},""); return; }
  if(!closeOverlays()){
    if(curView() && curView()!=="inicio") setView("inicio");
  }
  history.pushState({ cago:1 }, "");
});

// ── botón ✕ de cierre en la esquina superior de cada hoja ──
document.querySelectorAll(".sheet .sheet__panel").forEach(p=>{
  if(p.querySelector(".sheet__x")) return;
  const b=document.createElement("button");
  b.className="sheet__x"; b.type="button"; b.setAttribute("aria-label","Cerrar"); b.textContent="✕";
  p.insertBefore(b, p.firstChild);
});
document.addEventListener("click", e=>{
  const x=e.target.closest(".sheet__x"); if(!x) return;
  const sheet=x.closest(".sheet"); if(sheet) sheet.hidden=true;
});

/* ---------- bottom sheets: bloquear scroll del fondo + arrastrar para cerrar ---------- */
(function initSheetGestures(){
  const lockEls=[...document.querySelectorAll(".sheet"), document.getElementById("mapSheet")].filter(Boolean);
  const syncLock=()=>document.body.classList.toggle("sheet-open", lockEls.some(s=>!s.hidden));
  const mo=new MutationObserver(syncLock);
  lockEls.forEach(s=>mo.observe(s,{attributes:true,attributeFilter:["hidden"]}));
  syncLock();

  const CLOSE_DY=90, FLICK_V=0.55;   // px y px/ms para cerrar
  document.querySelectorAll(".sheet").forEach(sheet=>{
    const panel=sheet.querySelector(".sheet__panel"); if(!panel) return;
    let startY=0, prevY=0, prevT=0, dy=0, vy=0, dragging=false, canDrag=false;
    panel.addEventListener("touchstart", e=>{
      if(e.touches.length!==1 || e.target.closest("input,textarea,select,.leaflet-container")){ canDrag=false; return; }
      startY=prevY=e.touches[0].clientY; prevT=Date.now(); dy=0; vy=0; dragging=false;
      canDrag = panel.scrollTop<=0;   // solo si el contenido ya está arriba del todo
    }, {passive:true});
    panel.addEventListener("touchmove", e=>{
      if(!canDrag || e.touches.length!==1) return;
      const y=e.touches[0].clientY, t=Date.now();
      dy=y-startY; if(t>prevT) vy=(y-prevY)/(t-prevT); prevY=y; prevT=t;
      if(dy>0){
        if(!dragging && dy>8){ dragging=true; panel.style.transition="none"; }
        if(dragging){ e.preventDefault(); panel.style.transform=`translateY(${dy}px)`; panel.style.opacity=String(Math.max(.4,1-dy/600)); }
      } else if(dragging){ panel.style.transform="translateY(0)"; panel.style.opacity="1"; }
    }, {passive:false});
    const end=()=>{
      if(!dragging){ canDrag=false; return; }
      dragging=false; canDrag=false;
      const shouldClose = dy>CLOSE_DY || (dy>30 && vy>FLICK_V);
      panel.style.transition="transform .25s cubic-bezier(.2,.7,.2,1), opacity .25s";
      if(shouldClose){
        panel.style.transform="translateY(100%)"; panel.style.opacity="0";
        const done=()=>{ panel.removeEventListener("transitionend",done); sheet.hidden=true; panel.style.transition=panel.style.transform=panel.style.opacity=""; };
        panel.addEventListener("transitionend",done); setTimeout(done,320);
      } else {
        panel.style.transform=""; panel.style.opacity="";
        setTimeout(()=>{ panel.style.transition=""; }, 260);
      }
    };
    panel.addEventListener("touchend", end, {passive:true});
    panel.addEventListener("touchcancel", end, {passive:true});
  });
})();

/* ---------- pull-to-refresh (solo PWA instalada; en web ya lo hace el navegador) ---------- */
const _standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
if(_standalone){
  const ptr=$("ptr"), TH=72, DAMP=0.5;
  let sy=0, sx=0, active=false, dist=0;
  const atTop=()=> (window.scrollY||document.documentElement.scrollTop||0) <= 0;
  const overlayOpen=()=> !!document.querySelector(".sheet:not([hidden]),.mapsheet:not([hidden]),.gate:not([hidden])");
  const reset=()=>{ ptr.classList.remove("refreshing"); ptr.style.transition="transform .25s,opacity .25s"; ptr.style.transform="translateY(-54px)"; ptr.style.opacity="0"; };
  document.addEventListener("touchstart", e=>{
    if(e.touches.length!==1 || !uid || !atTop() || overlayOpen()){ active=false; return; }
    sy=e.touches[0].clientY; sx=e.touches[0].clientX; active=true; dist=0; ptr.style.transition="none";
  }, {passive:true});
  document.addEventListener("touchmove", e=>{
    if(!active) return;
    const dy=e.touches[0].clientY-sy, dx=e.touches[0].clientX-sx;
    if(dy<=0 || Math.abs(dx)>Math.abs(dy) || !atTop()){ active=false; reset(); return; }   // arriba / horizontal / ya no en el tope
    e.preventDefault();                                   // evita el rubber-band del sistema
    dist=dy;
    const pull=Math.min(dy*DAMP,100);
    ptr.style.transform=`translateY(${pull-54}px)`;
    ptr.style.opacity=String(Math.min(1,pull/TH));
    ptr.style.setProperty("--p", String(Math.min(1, pull/TH)));   // llena el anillo
    ptr.classList.toggle("ready", pull>=TH);
  }, {passive:false});
  document.addEventListener("touchend", async ()=>{
    if(!active) return; active=false;
    if(dist*DAMP>=TH){
      ptr.style.transition="transform .2s"; ptr.style.transform="translateY(14px)"; ptr.style.opacity="1"; ptr.classList.add("refreshing");
      const t0=Date.now();
      try{ await refreshActiveView(true); }catch(_){}   // PTR siempre fuerza datos frescos
      setTimeout(reset, Math.max(0, 450-(Date.now()-t0)));   // deja ver el spin un mínimo
    } else reset();
  });
}

/* ---------- ubicación + mapa ---------- */
const LOC_KEYS=["choose","always"];
function locLabel(k){ return k==="always"?t('settings.loc.always'):t('settings.loc.choose'); }
function renderLocSel(mode){
  // migrate legacy "never" → "choose"
  if(!mode||mode==="never") mode="choose";
  $("locSel").innerHTML=LOC_KEYS.map(k=>`<button class="ychip ${mode===k?'on':''}" data-loc="${k}">${locLabel(k)}</button>`).join("");
  // "Sumar con ubicación" en el menú solo tiene sentido cuando el usuario elige cada vez
  $("miGeo").hidden = mode==="always";
}
$("locSel").addEventListener("click", async e=>{
  const b=e.target.closest("[data-loc]"); if(!b||!uid)return;
  renderLocSel(b.dataset.loc);
  try{ await setLocationMode(uid,b.dataset.loc); toast(t('toast.location',{mode:locLabel(b.dataset.loc)})); }catch(err){ console.error(err); }
});
function getGeo(){
  return new Promise(res=>{
    if(!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p=>res({lat:p.coords.latitude,lng:p.coords.longitude}),
      ()=>res(null),
      {enableHighAccuracy:false,timeout:8000,maximumAge:60000});
  });
}
let _map=null,_markers=[],_groupMarkers={},_legendHidden=new Set();
$("openMapBtn").addEventListener("click", ()=>openMap());
$("mapClose").addEventListener("click", ()=>{ $("mapSheet").hidden=true; hideMapLoading(); });
function _ensureMap(){
  if(!_map){
    _map=L.map("map",{zoomControl:true});
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(_map);
  }
  setTimeout(()=>_map.invalidateSize(),120);
}
// Loader del mapa: solo aparece si la carga tarda un poco (delay), con una frase graciosa,
// para no parpadear en las cargas rápidas.
let _mapLoadTimer=null;
function showMapLoadingDelayed(delay=450){
  clearTimeout(_mapLoadTimer);
  _mapLoadTimer=setTimeout(()=>{ $("mapLoadingTxt").textContent=mapLoadingPhrase(); $("mapLoading").hidden=false; }, delay);
}
function hideMapLoading(){ clearTimeout(_mapLoadTimer); $("mapLoading").hidden=true; }
// friend = { uid, name } para ver el mapa de un amigo; omitir para el propio.
async function openMap(friend){
  $("mapSheet").hidden=false; $("mapEmpty").hidden=true; $("mapLegend").hidden=true;
  $("mapEmpty").textContent=t('map.empty');
  const titleEl=$("mapTitle");
  titleEl.classList.remove("map-title--top");
  if(friend){ titleEl.textContent=`🗺️ ${friend.name}`; titleEl.hidden=false; }
  else { titleEl.hidden=true; }
  if(typeof L==="undefined"){ toast(t('toast.map.fail')); return; }
  _ensureMap();
  _markers.forEach(m=>_map.removeLayer(m)); _markers=[]; _groupMarkers={};
  showMapLoadingDelayed();
  const targetUid = friend ? friend.uid : uid;
  const cacas = (!friend && statsCacas.length && Date.now()-_statsLoadedAt < 120000)
    ? statsCacas : await myActivity(targetUid, 2000);
  const pts=cacas.filter(c=>isFinite(c.lat)&&isFinite(c.lng));
  const icon=L.divIcon({className:"",html:'<div style="font-size:24px;line-height:24px">💩</div>',iconSize:[24,24],iconAnchor:[12,12]});
  _markers=pts.map(c=>L.marker([c.lat,c.lng],{icon}).addTo(_map));
  hideMapLoading();
  if(_markers.length) setTimeout(()=>_map.fitBounds(L.featureGroup(_markers).getBounds().pad(0.3)),160);
  else { _map.setView([40.4168,-3.7038],5); $("mapEmpty").hidden=false; }
}

// Mapa del grupo: cacas de todos los miembros (año actual), un color por persona,
// leyenda con filtro (tocar un nombre = mostrar/ocultar sus cacas). Respeta shareMap.
// Paleta de tonos bien separados para distinguir a cada miembro EN EL MAPA. No usamos
// el color propio del usuario (colorForUid/el elegido en Ajustes) porque dos miembros
// pueden tener el mismo o parecido → aquí se asigna por orden de uid, garantizando que
// sean distintos dentro del grupo (la leyenda hace de referencia color→persona).
const GROUP_PALETTE = ["#E4572E","#2E9E68","#3E7CB1","#B5179E","#E5A50A","#6A4C93","#158A8A","#C1272D","#5B7B1F","#9B5DE5","#8B5E3C","#00A6A6"];
function pinIcon(color){
  return L.divIcon({ className:"",
    html:`<div class="mappin" style="--c:${color}"><span class="mappin__emo">💩</span></div>`,
    iconSize:[34,34], iconAnchor:[17,34], popupAnchor:[0,-30] });
}
async function openGroupMap(group){
  $("mapSheet").hidden=false; $("mapEmpty").hidden=true;
  $("mapTitle").textContent=`🗺️ ${group.name}`; $("mapTitle").hidden=false; $("mapTitle").classList.add("map-title--top");
  if(typeof L==="undefined"){ toast(t('toast.map.fail')); return; }
  _ensureMap();
  _markers.forEach(m=>_map.removeLayer(m)); _markers=[]; _groupMarkers={}; _legendHidden=new Set();
  showMapLoadingDelayed();
  const pts = await groupLocatedCacas(group);
  hideMapLoading();
  if(!pts.length){ $("mapLegend").hidden=true; _map.setView([40.4168,-3.7038],5);
    $("mapEmpty").textContent=t('grupos.map.empty'); $("mapEmpty").hidden=false; return; }
  // agrupar por persona
  const byUid={};
  for(const p of pts){ (byUid[p.uid]=byUid[p.uid]||{name:p.name,pts:[]}).pts.push(p); }
  // color distinto por miembro desde la paleta (por orden de uid → estable y sin choques)
  Object.keys(byUid).sort().forEach((u2,i)=>{ byUid[u2].color = GROUP_PALETTE[i % GROUP_PALETTE.length]; });
  for(const [u2,info] of Object.entries(byUid)){
    const icon=pinIcon(info.color);
    _groupMarkers[u2]=info.pts.map(p=>{
      const m=L.marker([p.lat,p.lng],{icon}).addTo(_map);
      m.bindPopup(`<b>${info.name}</b><br>${fmtFull(p.ts)}`);
      _markers.push(m); return m;
    });
  }
  setTimeout(()=>{ if(_markers.length) _map.fitBounds(L.featureGroup(_markers).getBounds().pad(0.3)); },160);
  renderMapLegend(byUid);
}
function renderMapLegend(byUid){
  const el=$("mapLegend");
  const members=Object.entries(byUid).sort((a,b)=>b[1].pts.length-a[1].pts.length);
  el.innerHTML=members.map(([u,info])=>
    `<span class="leg-chip ${_legendHidden.has(u)?'off':''}" data-leguid="${u}"><span class="leg-chip__dot" style="background:${info.color}"></span>${info.name} · ${info.pts.length}</span>`
  ).join("");
  el.hidden=false;
}
$("mapLegend").addEventListener("click", e=>{
  const chip=e.target.closest("[data-leguid]"); if(!chip) return;
  const u=chip.dataset.leguid, markers=_groupMarkers[u]||[];
  if(_legendHidden.has(u)){ _legendHidden.delete(u); markers.forEach(m=>m.addTo(_map)); chip.classList.remove("off"); }
  else { _legendHidden.add(u); markers.forEach(m=>_map.removeLayer(m)); chip.classList.add("off"); }
});

/* ---------- delight ---------- */
function floatPoo(cx,cy){ for(let i=0;i<3;i++){ const p=document.createElement("div");p.className="poo-fly";p.textContent="💩";
  p.style.left=(cx+(Math.random()*60-30))+"px";p.style.top=(cy-6)+"px";p.style.setProperty("--rot",(Math.random()*60-30)+"deg");
  p.style.animationDelay=(i*70)+"ms";document.body.appendChild(p);setTimeout(()=>p.remove(),1200);} }
function celebrate(num){ $("celebrateNum").textContent=num;
  const hype=[t('celebrate.hype.0'),t('celebrate.hype.1'),t('celebrate.hype.2'),t('celebrate.hype.3'),t('celebrate.hype.4')];
  $("celebrateText").textContent=num>=200?t('celebrate.hype.3'):hype[Math.floor(Math.random()*hype.length)];
  const c=$("celebrate");c.hidden=false;confetti();haptic([30,40,30,40,60]);setTimeout(()=>c.hidden=true,2600); }
// ── conexión de tuberías: tú + un amigo cagáis con < 5 min de diferencia ──
const SYNC_WINDOW=5*60*1000;
let _lastSyncEvt=null;   // id del evento de amigo con el que ya celebramos (evita repetir)
function syncCelebrate(name){
  $("syncSub").textContent=t('sync.sub',{name});
  const c=$("syncOverlay"); c.hidden=false; confetti(); haptic([20,40,20,40,20,40,80]);
  setTimeout(()=>c.hidden=true,2800);
}
function checkSyncPoop(){
  const now=Date.now();
  // evento de caca de un AMIGO en los últimos 5 min (no tú, no eventos de sistema/sync)
  const evt=homeFeedData.find(c =>
    c.uid!==uid && (c.kind===undefined||c.kind==="add") && friendNames[c.uid]
    && (now-c.ts)>=0 && (now-c.ts)<=SYNC_WINDOW);
  if(!evt || _lastSyncEvt===evt.id) return;
  _lastSyncEvt=evt.id;
  const name=friendNames[evt.uid]||evt.name||"un amigo";
  syncCelebrate(name);
  // evento en el feed (visible a tu círculo + el amigo), reaccionable
  writeActivity(uid, {
    kind:"sync", name:me?.displayName||"", color:me?.color||colorForUid(uid),
    withUid:evt.uid, withName:name, ts:now, year:new Date().getFullYear(),
    audience:[...new Set([...(_graph.audience||[uid]), evt.uid])], groups:_graph.groups||[], reactions:{},
  }).catch(e=>console.error("sync:",e));
  // aviso al amigo
  enqueuePush(uid, evt.uid, "sync", t('push.sync.title'), t('push.sync.body',{name:me?.displayName||t('fallback.someone')})).catch(()=>{});
}
function confetti(){ const cols=["#E59A2E","#6E3F1C","#2E9E68","#9A5A2A","#F7DCA8","#D8573F"];
  for(let i=0;i<90;i++){ const d=document.createElement("div");d.className="confetti";d.style.left=Math.random()*100+"vw";
    d.style.background=cols[i%cols.length];d.style.animationDuration=(1.4+Math.random()*1.4)+"s";d.style.animationDelay=(Math.random()*.3)+"s";
    d.style.transform=`rotate(${Math.random()*360}deg)`;document.body.appendChild(d);setTimeout(()=>d.remove(),3200);} }
let toastT; function toast(m){ const el=$("toast");el.textContent=m;el.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove("show"),1800); }

function applyLang(){
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key=el.dataset.i18n, attr=el.dataset.i18nAttr, val=t(key);
    if(attr) el.setAttribute(attr,val); else el.textContent=val;
  });
  // elementos con estructura HTML interna (no pueden usar textContent)
  const cu=$("counterUnit");
  if(cu) cu.innerHTML=`${t('hero.unit')}<br/><span>${t('hero.unit.sub')}</span>`;
  // fun fact: si está visible, re-renderiza el del día en el nuevo idioma
  if($("funFact") && !$("funFact").hidden) _renderFact(_factCurrentIdx());
  const ey=document.querySelector(".hero__eyebrow");
  if(ey) ey.textContent=t('hero.eyebrow');
  // settings labels with <small> children (textContent would strip the tag)
  const snl=$("setNameLabel");
  if(snl){ const r=t('settings.name.label'), i=r.indexOf('('); snl.innerHTML=i>=0?`${r.slice(0,i)}<small>(${r.slice(i+1)}</small>`:r; }
  const scl=$("setColorLabel");
  if(scl) scl.textContent=t('settings.color.label');
  const sll=$("setLocLabel");
  if(sll) sll.innerHTML=`${t('settings.location.label')} <small>${t('settings.location.sublabel')}</small>`;
  const shl=$("setHapticsLabel");
  if(shl) shl.innerHTML=`${t('settings.haptics.label')} <small>(${t('settings.haptics.sublabel')})</small>`;
  document.documentElement.lang=getLang();
  // sync flag buttons in both selectors
  const _l=getLang();
  document.querySelectorAll("#langSel button,#gateLangSel button").forEach(x=>x.classList.toggle("on",x.dataset.lang===_l));
  // re-run dynamic painters if already mounted
  if(uid){ paintProgress(me?.totalCount||0); renderFeedChips(); renderFeed(); renderLocSel(me?.locationMode); }
}

applyMode();
applyLang();

// Service worker + auto-update: cuando se despliega una versión nueva, el SW
// nuevo toma control y la app se recarga sola (no más caché vieja en el móvil).
if("serviceWorker"in navigator){
  let _reloading=false, _swReg=null;
  // Cuando el SW nuevo toma el control, recargamos UNA vez. El flag _reloading evita
  // recargas múltiples; como el SW nuevo solo se activa cuando NOSOTROS se lo pedimos
  // (mensaje SKIP_WAITING al detectar una versión nueva), no hay bucle.
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(_reloading)return; _reloading=true; location.reload(); });
  // Si hay un SW nuevo esperando/instalándose, lo activamos para que entre la versión nueva.
  function _activate(reg){
    if(reg.waiting) reg.waiting.postMessage({type:"SKIP_WAITING"});
    if(reg.installing) reg.installing.addEventListener("statechange", function(){
      if(this.state==="installed" && navigator.serviceWorker.controller) this.postMessage({type:"SKIP_WAITING"});
    });
  }
  window.addEventListener("load", async ()=>{
    try{
      // updateViaCache:"none" → el chequeo de sw.js IGNORA la caché HTTP (GitHub Pages
      // la sirve ~10min); así detecta la versión nueva al instante, no con retraso.
      _swReg=await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
      _activate(_swReg);
      _swReg.addEventListener("updatefound", ()=>_activate(_swReg));
      _swReg.update().catch(()=>{});                       // chequea ya al abrir
      setInterval(()=>_swReg.update().catch(()=>{}), 30000);
    }catch(e){}
  });
  // al volver a primer plano (típico en iOS standalone), buscar versión nueva
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible" && _swReg) _swReg.update().catch(()=>{}); });
}

// ── Picker: invitar amigo a grupo ────────────────────────────────────────────
let _pickerEligible=[];
function _renderPickerList(filter=""){
  const list=$("groupInvitePickerList");
  const q=filter.toLowerCase().trim();
  const shown=q ? _pickerEligible.filter(f=>(f.displayName||"").toLowerCase().includes(q)||(f.email||"").toLowerCase().includes(q)) : _pickerEligible;
  if(!shown.length){
    list.innerHTML=`<li class="notif-empty" style="padding:16px">${q ? "Sin resultados" : t('grupos.invite.friend.empty')}</li>`;
    return;
  }
  list.innerHTML=shown.map(f=>`<li>${av(f.displayName,f.color)}<span class="nm">${f.displayName}</span><button class="btn-solid" style="font-size:13px;padding:6px 14px" data-invite-friend="${f.id}" data-invite-name="${(f.displayName||"").replace(/"/g,"")}">${"Invitar"}</button></li>`).join("");
}
async function openGroupInvitePicker(group){
  const sheet=$("groupInvitePickerSheet");
  const list=$("groupInvitePickerList");
  const search=$("groupInviteSearch");
  search.value="";
  list.innerHTML=`<li class="notif-empty" style="padding:16px">${t('grupos.rank.loading')}</li>`;
  sheet.hidden=false;
  search.focus();
  try{
    const friends=await getFriends(uid);
    const memberSet=new Set(group.members||[]);
    _pickerEligible=friends.filter(f=>!memberSet.has(f.id));
    _renderPickerList();
  }catch(e){ list.innerHTML=`<li class="notif-empty" style="padding:16px">${t('grupos.invite.friend.fail')}</li>`; console.error(e); }
}
$("groupInviteSearch").addEventListener("input", e=>_renderPickerList(e.target.value));
$("groupInvitePickerSheet").addEventListener("click",async e=>{
  if(e.target===$("groupInvitePickerSheet")){ $("groupInvitePickerSheet").hidden=true; return; }
  const btn=e.target.closest("[data-invite-friend]"); if(!btn||!activeGroup)return;
  const toUid=btn.dataset.inviteFriend, name=btn.dataset.inviteName;
  btn.disabled=true; btn.textContent="…";
  try{
    await sendGroupInvite(uid, toUid, activeGroup);
    toast(t('grupos.invite.friend.sent',{name}));
    btn.textContent="✓"; setTimeout(()=>$("groupInvitePickerSheet").hidden=true, 800);
  }catch(e){
    toast("Error: " + (e?.message||e)); btn.disabled=false; btn.textContent="Invitar"; console.error(e);
  }
});

// ── Sheet: administrar grupo (solo admin/creador) ─────────────────────────────
$("groupAdminBtn").addEventListener("click", ()=> openGroupAdminSheet());
$("groupAdminSheet").addEventListener("click", e=>{ if(e.target===$("groupAdminSheet")){ $("groupAdminSheet").hidden=true; } });

async function openGroupAdminSheet(){
  if(!activeGroup) return;
  $("groupAdminNameInput").value = activeGroup.name;
  const memberList = $("groupAdminMemberList");
  memberList.innerHTML = `<li class="notif-empty" style="padding:12px">Cargando…</li>`;
  $("groupAdminSheet").hidden = false;
  try{
    const members = await Promise.all((activeGroup.members||[]).map(getUser));
    memberList.innerHTML = members.filter(Boolean).map(m => `
      <li style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">
        ${av(m.displayName, m.color)}
        <span class="nm" style="flex:1">${m.displayName||"—"}</span>
        ${m.id === uid ? `<span style="font-size:12px;color:var(--ink-soft);font-weight:600">Tú${m.id===activeGroup.createdBy?" · Admin":""}</span>`
          : m.id === activeGroup.createdBy ? `<span style="font-size:12px;color:var(--ink-soft);font-weight:600">Admin</span>`
          : `<button class="btn-ghost btn-ghost--danger" style="font-size:13px;padding:5px 12px" data-kick="${m.id}" data-kick-name="${(m.displayName||"").replace(/"/g,"")}">Expulsar</button>`}
      </li>`).join("");
  } catch(e){ memberList.innerHTML=`<li class="notif-empty" style="padding:12px">Error cargando miembros</li>`; }
}

$("groupAdminSaveName").addEventListener("click", async ()=>{
  const name = $("groupAdminNameInput").value.trim();
  if(!name || !activeGroup) return;
  $("groupAdminSaveName").disabled=true;
  try{
    await renameGroup(activeGroup.id, name);
    activeGroup.name = name;
    $("groupDetailName").textContent = name;
    document.querySelector(`#groupList li[data-gid="${activeGroup.id}"] .gname`).textContent = name;
    toast("Nombre actualizado");
    $("groupAdminSheet").hidden=true;
  } catch(e){ toast("Error: "+(e?.message||e)); }
  finally{ $("groupAdminSaveName").disabled=false; }
});

$("groupAdminMemberList").addEventListener("click", async e=>{
  const btn = e.target.closest("[data-kick]"); if(!btn||!activeGroup) return;
  const kickUid = btn.dataset.kick, kickName = btn.dataset.kickName;
  if(!confirm(`¿Expulsar a ${kickName} del grupo?`)) return;
  btn.disabled=true; btn.textContent="…";
  try{
    await kickFromGroup(activeGroup.id, kickUid);
    activeGroup.members = activeGroup.members.filter(m=>m!==kickUid);
    toast(`${kickName} ha salido del grupo`);
    openGroupAdminSheet();
  } catch(e){ toast("Error: "+(e?.message||e)); btn.disabled=false; btn.textContent="Expulsar"; }
});

$("groupAdminDelete").addEventListener("click", async ()=>{
  if(!activeGroup) return;
  if(!confirm(`¿Eliminar el grupo "${activeGroup.name}"? Esta acción no se puede deshacer.`)) return;
  $("groupAdminDelete").disabled=true;
  try{
    await deleteGroup(activeGroup.id);
    $("groupAdminSheet").hidden=true;
    activeGroup=null;
    $("groupDetail").hidden=true;
    toast("Grupo eliminado");
    renderGrupos();
  } catch(e){ toast("Error: "+(e?.message||e)); $("groupAdminDelete").disabled=false; }
});

// ── Sheet: recibir invitación a grupo ────────────────────────────────────────
let _activeGroupInvite=null;
function openGroupInviteSheet(invite){
  if(!invite)return;
  _activeGroupInvite=invite;
  $("giGroupName").textContent=invite.groupName;
  $("giFromName").textContent=t('notif.groupinvite.from',{name:invite.fromName});
  const names=(invite.memberNames||[]).join(", ")||"—";
  $("giMembers").textContent=t('notif.groupinvite.members',{names});
  $("groupInviteSheet").hidden=false;
}
$("giAccept").addEventListener("click",async()=>{
  if(!_activeGroupInvite)return;
  $("giAccept").disabled=true; $("giAccept").textContent="…";
  try{
    const g=await acceptGroupInvite(_activeGroupInvite, uid);
    _graphAt=0;
    toast(t('notif.groupinvite.accepted',{name:_activeGroupInvite.groupName}));
    $("groupInviteSheet").hidden=true;
    await renderGrupos(); openGroup(g); setView("grupos");
    loadActivity("force");
  }catch(e){
    const msg=e.message==="group-gone"?t('notif.groupinvite.gone'):t('notif.groupinvite.fail');
    toast(msg); console.error(e);
  }finally{ $("giAccept").disabled=false; $("giAccept").textContent=t('notif.groupinvite.accept'); }
});
$("giDecline").addEventListener("click",async()=>{
  if(!_activeGroupInvite)return;
  try{ await declineGroupInvite(_activeGroupInvite.id); toast(t('notif.groupinvite.declined')); }
  catch(e){ console.error(e); }
  $("groupInviteSheet").hidden=true; _activeGroupInvite=null;
});
$("groupInviteSheet").addEventListener("click",e=>{ if(e.target===$("groupInviteSheet")){ $("groupInviteSheet").hidden=true; _activeGroupInvite=null; } });

// ═══════════════════════════════════════════════════════════════════
//  CHAT
// ═══════════════════════════════════════════════════════════════════
const CHAT_REACTIONS = ["💩","😂","❤️","🔥","👀","😮"];
let _chatsUnsub = null;
let _chatMsgUnsub = null;
let _activeChatId = null;
let _activeChatData = null;
let _oldestMsgClientTs = null;

// ── helpers de tiempo ────────────────────────────────────────────
function _chatTime(ts){
  if(!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = (now - d) / 1000;
  if(diff < 60) return "ahora";
  if(diff < 3600) return `${Math.floor(diff/60)}m`;
  if(diff < 86400) return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
  return `${d.getDate()}/${d.getMonth()+1}`;
}

// ── unread badge global ──────────────────────────────────────────
function _updateChatBadge(chats){
  const total = chats.reduce((acc, c) => {
    const myLastRead = c.lastReadTs?.[uid]?.toMillis?.() ?? 0;
    const lastTs = c.lastTs?.toMillis?.() ?? (c.lastTs || 0);
    return acc + (lastTs > myLastRead && c.lastMessage?.senderUid !== uid ? 1 : 0);
  }, 0);
  $("chatBadge").hidden = total === 0;
  $("chatBadge").textContent = total > 9 ? "9+" : total;
}

// ── renderizar lista de chats ────────────────────────────────────
function _renderChatList(chats){
  const list = $("chatList");
  if(!chats.length){
    list.innerHTML = `<li class="chat-empty">${t('chat.empty')}</li>`;
    return;
  }
  list.innerHTML = chats.map(c => {
    const myLastRead = c.lastReadTs?.[uid]?.toMillis?.() ?? 0;
    const lastTs = c.lastTs?.toMillis?.() ?? (c.lastTs || 0);
    const hasUnread = lastTs > myLastRead && c.lastMessage?.senderUid !== uid;
    const name = c.type === "group" ? (c.name || "Grupo") : (c.otherName || "Chat");
    const preview = c.lastMessage ? `${c.lastMessage.senderUid===uid?"Tú: ":""}${c.lastMessage.text}` : t('chat.nomessages');
    return `<li class="chat-item" data-chat="${c.id}">
      ${av(name, c.color||"#888")}
      <div class="chat-item__body">
        <div class="chat-item__name">${name}</div>
        <div class="chat-item__preview">${preview}</div>
      </div>
      <div class="chat-item__meta">
        <span class="chat-item__time">${_chatTime(c.lastTs)}</span>
        ${hasUnread ? `<span class="chat-item__unread">•</span>` : ""}
      </div>
    </li>`;
  }).join("");
}

// ── renderizar mensajes ──────────────────────────────────────────
function _renderMessages(msgs, prepend=false){
  const list = $("msgList");
  const prevScrollTop = list.scrollTop;
  const prevScrollHeight = list.scrollHeight;
  const isAtBottom = prevScrollHeight - prevScrollTop - list.clientHeight < 60;
  const html = msgs.map(m => _msgHtml(m, uid)).join("");
  if(prepend){
    list.insertAdjacentHTML("afterbegin", html);
    list.scrollTop = prevScrollTop + (list.scrollHeight - prevScrollHeight);
  } else {
    list.innerHTML = html;
    if(isAtBottom) list.scrollTop = list.scrollHeight;
    // si no estaba al fondo, mantener posición relativa
    else list.scrollTop = prevScrollTop;
  }
}

function _msgHtml(m, myUid){
  const isMe = m.senderUid === myUid;
  const ts = m.ts?.toDate ? m.ts.toDate() : (m.clientTs ? new Date(m.clientTs) : null);
  const timeStr = ts ? `${ts.getHours().toString().padStart(2,"0")}:${ts.getMinutes().toString().padStart(2,"0")}` : "";
  const reactions = Object.entries(m.reactions||{}).filter(([,uids])=>uids.length>0).map(([emoji,uids])=>{
    const mine = uids.includes(myUid);
    return `<button class="msg__reaction${mine?" mine":""}" data-msg-react="${m.id}" data-emoji="${emoji}">
      ${emoji}<span>${uids.length}</span></button>`;
  }).join("");
  const addBtn = `<button class="msg__reaction-add" data-msg-react-add="${m.id}" title="Reaccionar">＋</button>`;
  return `<li class="msg ${isMe?"msg--me":"msg--them"}" data-msg-id="${m.id}">
    ${!isMe && _activeChatData?.type==="group" ? `<div class="msg__sender">${m.senderName||""}</div>` : ""}
    <div class="msg__bubble">${m.text.replace(/</g,"&lt;")}</div>
    <div class="msg__time">${timeStr}</div>
    ${reactions||addBtn ? `<div class="msg__reactions">${reactions}${addBtn}</div>` : ""}
  </li>`;
}

// ── chat navigation ──────────────────────────────────────────────
// History states: {_c:1} = lista de chats abierta, {_c:2} = conversación abierta
// Invariante: _chatNavDepth siempre refleja el estado real de la UI
//   0 = chat cerrado, 1 = en lista, 2 = en conversación

function _onVVResize(){
  const vv = window.visualViewport; if(!vv) return;
  const cv = $("chatView");
  cv.style.height = vv.height + "px";
  cv.style.top    = vv.offsetTop + "px";
  if(_activeChatId){ const ml=$("msgList"); ml.scrollTop=ml.scrollHeight; }
}

let _scrollYBeforeChat = 0;
let _chatNavDepth = 0;

// Solo cierra la UI — nunca toca el history
function _doCloseChatUI(){
  if($("chatView").hidden) return;
  _hideReactionPicker();
  $("chatView").hidden = true;
  document.body.classList.remove("chat-mode");
  document.body.style.top = "";
  $("chatView").style.height = $("chatView").style.top = "";
  window.scrollTo(0, _scrollYBeforeChat);
  window.visualViewport?.removeEventListener("resize", _onVVResize);
  window.visualViewport?.removeEventListener("scroll", _onVVResize);
  _chatMsgUnsub?.(); _chatMsgUnsub = null;
  _activeChatId = null; _activeChatData = null;
  _chatNavDepth = 0;
}

// Solo cierra la conversación y vuelve a lista — nunca toca el history
function _doCloseConvUI(){
  _hideReactionPicker();
  $("chatLayer2").classList.remove("is-open");
  setTimeout(()=>{ $("chatLayer2").hidden = true; }, 260);
  _chatMsgUnsub?.(); _chatMsgUnsub = null;
  _activeChatId = null; _activeChatData = null;
  _chatNavDepth = 1;
}

// Abre la vista de chat (lista). Pushea UN estado.
function openChatView(){
  if(!$("chatView").hidden) return; // ya abierto, no pushear de nuevo
  _scrollYBeforeChat = window.scrollY;
  document.body.style.top = `-${_scrollYBeforeChat}px`;
  $("chatView").hidden = false;
  document.body.classList.add("chat-mode");
  $("chatLayer2").classList.remove("is-open");
  $("chatLayer2").hidden = true;
  window.visualViewport?.addEventListener("resize", _onVVResize);
  window.visualViewport?.addEventListener("scroll", _onVVResize);
  _onVVResize();
  history.pushState({_c:1}, "");
  _chatNavDepth = 1;
}

// Manejador de navegación hacia atrás del chat — llamado desde el popstate global
function _handleChatPopstate(e){
  const depth = e.state?._c ?? 0;
  if(depth >= 2) return; // forward navigation, ignorar
  if(depth === 1){
    if(_chatNavDepth === 2) _doCloseConvUI();
    // Si _chatNavDepth ya es 1, no hacemos nada (ya estamos en lista)
  } else {
    // depth === 0: volvemos a la app desde lista
    _doCloseChatUI();
    // Re-armar el trap de la app
    history.pushState({ cago:1 }, "");
  }
}

// ── abrir conversación ──────────────────────────────────────────
async function openConversation(chatId, chatData){
  _chatMsgUnsub?.();
  _hideReactionPicker();
  _activeChatId = chatId;
  _activeChatData = chatData;
  $("convName").textContent = chatData.type==="group" ? (chatData.name||"Grupo") : (chatData.otherName||"Chat");
  $("msgList").innerHTML = `<li class="chat-empty" style="margin:auto">${t('chat.loading')}</li>`;
  $("chatLayer2").hidden = false;
  requestAnimationFrame(()=>$("chatLayer2").classList.add("is-open"));
  $("loadOlderBtn").hidden = true;
  // Push solo si venimos de lista; replace si ya estamos en otra conv
  if(_chatNavDepth === 1){ history.pushState({_c:2}, ""); _chatNavDepth = 2; }
  else if(_chatNavDepth === 2){ history.replaceState({_c:2}, ""); }
  _oldestMsgClientTs = null;
  markChatRead(chatId, uid).catch(()=>{});
  _chatMsgUnsub = watchMessages(chatId, msgs => {
    if(msgs.length) _oldestMsgClientTs = msgs[0].clientTs;
    $("loadOlderBtn").hidden = msgs.length < 30;
    _renderMessages(msgs);
    if(_activeChatId === chatId) markChatRead(chatId, uid).catch(()=>{});
  });
  $("chatInput").focus();
}

// ── botón chat en topbar ─────────────────────────────────────────
$("chatBtn").addEventListener("click", ()=>{ openChatView(); });
$("chatClose").addEventListener("click", ()=> history.back()); // lista → app

// ── nueva conversación ───────────────────────────────────────────
let _newConvItems = [];
function _renderNewList(filter=""){
  const q = filter.toLowerCase().trim();
  const shown = q ? _newConvItems.filter(x=>(x.name||"").toLowerCase().includes(q)) : _newConvItems;
  const list = $("chatNewList");
  if(!shown.length){ list.innerHTML=`<li class="chat-empty">Sin resultados</li>`; return; }
  let html="", lastType="";
  for(const x of shown){
    if(x.type!==lastType){
      html+=`<li class="chat-section-label">${x.type==="group"?"Grupos":"Amigos"}</li>`;
      lastType=x.type;
    }
    html+=`<li class="chat-item" data-new-chat-uid="${x.uid||""}" data-new-chat-gid="${x.gid||""}" data-new-chat-name="${x.name}">
      ${av(x.name,x.color||"#888")}
      <div class="chat-item__body"><div class="chat-item__name">${x.name}</div></div>
    </li>`;
  }
  list.innerHTML=html;
}
$("chatNewBtn").addEventListener("click", async ()=>{
  $("chatNewSearch").value="";
  $("chatNewList").innerHTML=`<li class="chat-empty">Cargando…</li>`;
  $("chatNewSheet").hidden=false;
  const [friends, groups] = await Promise.all([getFriends(uid), myGroups(uid)]);
  _newConvItems=[
    ...groups.map(g=>({type:"group",gid:g.id,name:g.name,color:"#888",group:g})),
    ...friends.map(f=>({type:"dm",uid:f.id,name:f.displayName,color:f.color})),
  ];
  _renderNewList();
  $("chatNewSearch").focus();
});
$("chatNewSearch").addEventListener("input", e=>_renderNewList(e.target.value));
$("chatNewSheet").addEventListener("click", e=>{
  if(e.target===$("chatNewSheet")){ $("chatNewSheet").hidden=true; return; }
  const item=e.target.closest("[data-new-chat-name]"); if(!item) return;
  $("chatNewSheet").hidden=true;
  const name=item.dataset.newChatName;
  if(item.dataset.newChatGid){
    const g=_newConvItems.find(x=>x.gid===item.dataset.newChatGid)?.group;
    if(g) openGroupChat(g);
  } else if(item.dataset.newChatUid){
    openDMChat(item.dataset.newChatUid, name);
  }
});

$("convBack").addEventListener("click", ()=> history.back()); // conv → lista

// ── tap en item de lista ─────────────────────────────────────────
$("chatList").addEventListener("click", async e=>{
  const item = e.target.closest("[data-chat]"); if(!item) return;
  const chatId = item.dataset.chat;
  const chats = _lastChats || [];
  const chatData = chats.find(c=>c.id===chatId);
  if(chatData) openConversation(chatId, chatData);
});

// ── enviar mensaje ───────────────────────────────────────────────
let _lastChats = [];
async function _doSend(){
  if(!_activeChatId) return;
  const text = $("chatInput").value.trim();
  if(!text) return;
  $("chatInput").value = "";
  $("chatInput").style.height = "";
  $("chatSend").disabled = true;
  try{
    await sendMessage(_activeChatId, uid, _myDisplayName, text);
    const members = _activeChatData?.members || [];
    notifyNewMessage(_activeChatId, uid, _myDisplayName, text, members).catch(()=>{});
  } catch(e){ toast("Error: "+(e?.message||e)); $("chatInput").value=text; }
  finally{ $("chatSend").disabled=false; }
}
let _myDisplayName = "";
$("chatSend").addEventListener("click", _doSend);
$("chatInput").addEventListener("keydown", e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); _doSend(); } });
$("chatInput").addEventListener("input", ()=>{
  $("chatInput").style.height="auto";
  $("chatInput").style.height = Math.min($("chatInput").scrollHeight, 120)+"px";
});

// ── cargar mensajes anteriores ───────────────────────────────────
$("loadOlderBtn").addEventListener("click", async ()=>{
  if(!_activeChatId||!_oldestMsgClientTs) return;
  $("loadOlderBtn").disabled=true;
  try{
    const older = await loadOlderMessages(_activeChatId, _oldestMsgClientTs);
    if(older.length){
      _oldestMsgClientTs = older[0].clientTs;
      _renderMessages(older, true);
    }
    $("loadOlderBtn").hidden = older.length < 30;
  } catch(e){ toast("Error cargando mensajes"); }
  finally{ $("loadOlderBtn").disabled=false; }
});

// ── reaccionar a mensajes ────────────────────────────────────────
// ── reaction picker ──────────────────────────────────────────────
let _rpMsgId = null;
const _rp = $("msgReactionPicker");

function _showReactionPicker(msgId, anchorEl){
  _rpMsgId = msgId;
  _rp.hidden = false;
  // posicionamos después de que el browser haya pintado el picker
  requestAnimationFrame(()=>{
    const cv = $("chatView").getBoundingClientRect();
    const ar = anchorEl.getBoundingClientRect();
    const pw = _rp.offsetWidth, ph = _rp.offsetHeight;
    let left = ar.left - cv.left + ar.width/2 - pw/2;
    left = Math.max(8, Math.min(left, cv.width - pw - 8));
    const top = ar.top - cv.top - ph - 8;
    _rp.style.left = left + "px";
    _rp.style.top  = Math.max(8, top) + "px";
  });
}
function _hideReactionPicker(){ _rp.hidden = true; _rpMsgId = null; }

_rp.addEventListener("click", async e=>{
  const emoji = e.target.closest("[data-react]")?.dataset.react; if(!emoji) return;
  const msgId = _rpMsgId, chatId = _activeChatId; // guardar antes de hide
  _hideReactionPicker();
  if(!msgId||!chatId) return;
  try{ await reactToMessage(chatId, msgId, uid, emoji); }
  catch(err){ toast("Error: "+(err?.message||err)); console.error(err); }
});

// cerrar picker al tocar fuera
$("chatView").addEventListener("click", e=>{
  if(!_rp.hidden && !_rp.contains(e.target)) _hideReactionPicker();
}, true);

// long press en burbuja → picker; tap en reacción existente → toggle; tap en ➕ → picker
let _chatLpTimer = null;
$("msgList").addEventListener("touchstart", e=>{
  const bubble = e.target.closest(".msg__bubble");
  if(!bubble) return;
  const li = bubble.closest("[data-msg-id]");
  if(!li) return;
  _chatLpTimer = setTimeout(()=>{ navigator.vibrate?.(30); _showReactionPicker(li.dataset.msgId, bubble); }, 500);
}, {passive:true});
$("msgList").addEventListener("touchend",  ()=>clearTimeout(_chatLpTimer), {passive:true});
$("msgList").addEventListener("touchmove", ()=>clearTimeout(_chatLpTimer), {passive:true});

$("msgList").addEventListener("click", async e=>{
  const reactBtn = e.target.closest("[data-msg-react]");
  const addBtn   = e.target.closest("[data-msg-react-add]");
  if(reactBtn){
    const msgId=reactBtn.dataset.msgReact, emoji=reactBtn.dataset.emoji;
    try{ await reactToMessage(_activeChatId, msgId, uid, emoji); } catch(err){ console.error(err); }
  } else if(addBtn){
    _showReactionPicker(addBtn.dataset.msgReactAdd, addBtn);
  }
});

// ── abrir chat desde perfil de amigo ────────────────────────────
async function openDMChat(friendUid, friendName){
  openChatView();
  const chatId = await getOrCreateDM(uid, friendUid);
  const chatData = { id:chatId, type:"dm", members:[uid,friendUid], otherName:friendName };
  openConversation(chatId, chatData);
}

// ── abrir chat desde grupo ───────────────────────────────────────
async function openGroupChat(group){
  openChatView();
  const chatId = await ensureGroupChat(group.id, group.members);
  const chatData = { id:chatId, type:"group", name:group.name, members:group.members, color:group.color };
  openConversation(chatId, chatData);
}

// ── iniciar listener de chats (llamado al hacer login) ──────────
function startChatListener(myUid, myDisplayName){
  _myDisplayName = myDisplayName;
  _chatsUnsub?.();
  _chatsUnsub = watchChats(myUid, async chats => {
    // Enriquecer DMs con nombre del otro usuario
    const enriched = await Promise.all(chats.map(async c => {
      if(c.type==="dm"){
        const otherUid = c.members.find(m=>m!==myUid);
        const other = await getUser(otherUid);
        return { ...c, otherName: other?.displayName||"—", color: other?.color };
      }
      if(c.type==="group"){
        const g = await getGroup(c.id).catch(()=>null);
        return { ...c, name: g?.name||"Grupo", color: g?.color };
      }
      return c;
    }));
    _lastChats = enriched;
    _renderChatList(enriched);
    _updateChatBadge(enriched);
  });
}
