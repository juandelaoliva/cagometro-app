/* ============================================================
   Cagómetro · UI (Firebase) — Phases A + A+ + B
   ============================================================ */
import {
  onUser, signOutUser, signUp, signIn, googleSignIn, ensureProfile,
  watchMe, addCaca, addCacaAt, removeCaca, setCount, setLocationMode, updateMe, myActivity,
  sendFriendRequest, myFriendships, acceptFriend, removeFriend, addFriendDirect, getFriends,
  setReaction, watchFriendships, watchMyCacas, saveToken, removeToken, enqueuePush,
  createGroup, joinGroup, leaveGroup, myGroups, groupLeaderboard, homeFeed, groupYearCacas,
  getUser, colorForUid
} from "./store.js";
import { IS_LOCAL, VAPID_KEY, getMessagingIfSupported, getToken, onMessage } from "./firebase.js";

const $ = id => document.getElementById(id);
window.__appBooted = true;   // el bundle (Firebase + app) cargó: desactiva el failsafe del index
const MILESTONES = [10,25,50,75,100,150,200,250,300,400,500];
const nextMilestone = n => MILESTONES.find(m => m > n) || (Math.floor(n/100)*100 + 100);
const prevMilestone = n => [...MILESTONES].reverse().find(m => m <= n) || 0;
const initial = s => (s||"?").trim().charAt(0).toUpperCase();
const DAY = 86400000;
const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
// Inicio de la semana natural (lunes 00:00 local)
const startOfWeek = () => { const d=new Date(); d.setHours(0,0,0,0); const dow=(d.getDay()+6)%7; d.setDate(d.getDate()-dow); return d.getTime(); };
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

/* ---------- enlaces de invitación ---------- */
const inviteUrl = q => `${location.origin}${location.pathname}?${q}`;
async function shareInvite(url, text){
  try{ if(navigator.share){ await navigator.share({ title:"El Cagómetro", text, url }); return; } }
  catch(e){ if(e.name==="AbortError") return; }
  try{ await navigator.clipboard.writeText(url); toast("Enlace copiado 📋"); }
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
    if(!confirm("Al unirte a este grupo, todos sus miembros se añadirán automáticamente como amigos. ¿Continuar?")) return;
    try{ const g=await joinGroup(uid, inv.code); toast(`Te uniste a ${g.name} 🎉`); setView("grupos"); await renderGrupos(); openGroup(g); }
    catch(err){ toast(err.message==="no-group" ? "Ese enlace de grupo no es válido" : "No se pudo unir"); console.error(err); }
  } else if(inv.type==="friend"){
    openFriendInvite(inv.uid);
  }
}

/* ---------- auth gate ---------- */
let mode="signup";
function applyMode(){
  const s=mode==="signup";
  $("primaryBtn").textContent=s?"Crear cuenta":"Entrar";
  $("gateSub").textContent=s?"Crea tu cuenta y empieza a contar.":"Bienvenido de nuevo.";
  $("toggleText").textContent=s?"¿Ya tienes cuenta?":"¿Nueva por aquí?";
  $("toggleMode").textContent=s?"Inicia sesión":"Crea una cuenta";
  $("fName").style.display=s?"":"none";
}
$("toggleMode").addEventListener("click",()=>{mode=mode==="signup"?"signin":"signup";clearErr();applyMode();});
const ERR={"auth/email-already-in-use":"Ese email ya está registrado. Inicia sesión.","auth/invalid-credential":"Email o contraseña incorrectos.","auth/invalid-email":"Email no válido.","auth/weak-password":"La contraseña debe tener al menos 6 caracteres.","auth/popup-closed-by-user":"Has cerrado la ventana de Google."};
const showErr=e=>{const el=$("formErr");el.textContent=ERR[e?.code]||e?.message||"Algo salió mal.";el.hidden=false;};
const clearErr=()=>$("formErr").hidden=true;
$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();clearErr();
  const name=$("fName").value.trim(),email=$("fEmail").value.trim(),pass=$("fPass").value;
  const b=$("primaryBtn");b.disabled=true;const t=b.textContent;b.textContent="…";
  try{ mode==="signup"?await signUp(email,pass,name):await signIn(email,pass); }catch(err){showErr(err);}
  finally{b.disabled=false;b.textContent=t;}
});
$("googleBtn").addEventListener("click",async()=>{clearErr();try{await googleSignIn();}catch(err){showErr(err);}});
$("logoutBtn").addEventListener("click",()=>signOutUser());

/* ---------- session ---------- */
let _authResolved=false;
onUser(async user=>{
  _authResolved=true;
  $("splash").hidden = true;                 // auth resolved → hide the loading screen
  if(!user){ showGate(); return; }
  uid=user.uid; await ensureProfile(user); showApp();
});
// Failsafe: si la sesión no resuelve en 9s (red/CDN lento en la PWA instalada),
// no dejamos el splash colgado: mostramos el acceso para que el usuario pueda actuar.
setTimeout(()=>{ if(!_authResolved){ $("splash").hidden=true; if(!uid) showGate(); } }, 9000);
function showGate(){ if(unsub){unsub();unsub=null;} stopNotifications(); $("app").hidden=true; $("gate").hidden=false; uid=null; me=null; lastTotal=null; }

function showApp(){
  $("gate").hidden=true; $("app").hidden=false;
  if(unsub)unsub();
  unsub=watchMe(uid, m=>{
    if(!m)return; me=m; const total=m.totalCount||0;
    $("meCount").textContent=total; $("meName").textContent=m.displayName||"";
    $("hdrAvatar").textContent=initial(m.displayName); $("hdrAvatar").style.background=m.color||colorForUid(uid);
    $("pName").textContent=m.displayName||""; $("pEmail").textContent=m.email||"—";
    $("pAvatar").textContent=initial(m.displayName); $("pAvatar").style.background=m.color||colorForUid(uid);
    $("pTotal").textContent=total; $("pLifetime").textContent=`${m.lifetimeCount||total} en total (todos los años)`;
    paintProgress(total); renderLocSel(m.locationMode);
    if(lastTotal!==null && total>lastTotal){ const hit=MILESTONES.find(x=>x>lastTotal&&x<=total); if(hit){ celebrate(hit); notifyFriendsMilestone(hit); } checkGroupOvertakes(lastTotal); }
    lastTotal=total;
  });
  $("pMode").textContent=IS_LOCAL?"modo local (emulador) · datos de prueba":"";
  loadActivity();
  processInvite();
  startNotifications();
  enablePush();                       // si ya hay permiso, refresca el token FCM
}

/* ---------- hoja: aceptar invitación de amigo ---------- */
let _fiUid=null;
async function openFriendInvite(otherUid){
  if(otherUid===uid){ toast("Ese enlace es tuyo 😄"); return; }
  _fiUid=otherUid;
  const u=await getUser(otherUid);
  if(!u){ toast("No se encontró a esa persona"); return; }
  $("fiAvatar").textContent=initial(u.displayName); $("fiAvatar").style.background=u.color||colorForUid(otherUid);
  $("fiName").textContent=u.displayName||"Alguien";
  $("friendInviteSheet").hidden=false;
}
$("fiCancel").addEventListener("click",()=>$("friendInviteSheet").hidden=true);
$("friendInviteSheet").addEventListener("click",e=>{ if(e.target===$("friendInviteSheet")) $("friendInviteSheet").hidden=true; });
$("fiAccept").addEventListener("click", async ()=>{
  if(!_fiUid)return; $("friendInviteSheet").hidden=true;
  try{ await addFriendDirect(uid,_fiUid); toast("¡Nuevo amigo! 🎉");
    if(document.querySelector(".view.is-active")?.dataset.view==="amigos") renderAmigos(); }
  catch(err){ toast("No se pudo"); console.error(err); }
});
$("inviteFriendBtn").addEventListener("click",()=> shareInvite(inviteUrl("friend="+encodeURIComponent(uid)), "¿Te unes a mi red en El Cagómetro? 💩"));

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
  $("settingsSheet").hidden=false;
}
$("settingsBtn").addEventListener("click", openSettings);
$("setClose").addEventListener("click", ()=>$("settingsSheet").hidden=true);
$("settingsSheet").addEventListener("click", e=>{ if(e.target===$("settingsSheet")) $("settingsSheet").hidden=true; });
$("setNameSave").addEventListener("click", async ()=>{
  const n=$("setName").value.trim(); if(!n) return toast("Pon un nombre");
  if(n===me?.displayName) return toast("Sin cambios");
  try{ await updateMe(uid,{displayName:n}); $("setNamePreview").textContent=n; $("setAvatar").textContent=initial(n); toast("Nombre actualizado ✅"); refreshActiveView(); }
  catch(err){ toast("No se pudo"); console.error(err); }
});
$("setColors").addEventListener("click", async e=>{
  const b=e.target.closest("[data-color]"); if(!b)return;
  const c=b.dataset.color; renderSetColors(c); $("setAvatar").style.background=c;
  try{ await updateMe(uid,{color:c}); toast("Color actualizado 🎨"); refreshActiveView(); }
  catch(err){ toast("No se pudo"); console.error(err); }
});
$("setNotif").addEventListener("change", async e=>{
  const on=e.target.checked;
  if(on){
    const perm=await requestNotifPermission();
    if(perm!=="granted"){
      e.target.checked=false;
      toast(perm==="denied" ? "Permiso bloqueado: actívalo en los ajustes del navegador" : "Permiso de notificaciones no concedido");
      try{ await updateMe(uid,{notifications:false}); }catch(_){}
      return;
    }
  }
  try{
    await updateMe(uid,{notifications:on});
    toast(on?"Notificaciones activadas 🔔":"Notificaciones desactivadas");
    if(on) enablePush();
    else if(_fcmToken) removeToken(uid,_fcmToken).catch(()=>{});   // al desactivar, deja de recibir push
  }
  catch(err){ e.target.checked=!on; toast("No se pudo"); console.error(err); }
});
function paintProgress(total){ const lo=prevMilestone(total),hi=nextMilestone(total);
  $("meProgressFill").style.width=Math.min(100,Math.round(((total-lo)/(hi-lo||1))*100))+"%";
  $("meProgressLabel").textContent=`Te faltan ${hi-total} para las ${hi} 💩`; }

let homeFeedData=[], feedShown=0; const FEED_PAGE=20;
async function loadActivity(){
  // en paralelo: mis cacas (para los chips) + grafo social (amigos + grupos)
  const [mine, friends, groups] = await Promise.all([ myActivity(uid,150), getFriends(uid), myGroups(uid) ]);
  // chips (hoy / semana natural / racha)
  const t0=startOfToday(),wk=startOfWeek(); let today=0,week=0; const days=new Set();
  for(const c of mine){ if(c.ts>=t0)today++; if(c.ts>=wk)week++; const d=new Date(c.ts);d.setHours(0,0,0,0);days.add(d.getTime()); }
  let streak=0,cur=startOfToday(); if(!days.has(cur))cur-=DAY; while(days.has(cur)){streak++;cur-=DAY;}
  $("statToday").textContent=today; $("statWeek").textContent=week; $("statStreak").textContent=streak;
  // nombres de MIS amigos (para revelar quién reaccionó; el resto, anónimo)
  friendNames={}; friends.forEach(f=>{ friendNames[f.id]=f.displayName; });
  // feed combinado reutilizando el grafo ya cargado (sin re-leer amigos/grupos)
  homeFeedData=await homeFeed(uid, 12, [friends, groups]);
  feedShown=FEED_PAGE;
  renderFeedChips(); renderFeed();
}
// ── filtros del feed (chips + búsqueda) ──
let feedScope="all", feedQ="";
function feedGroups(){
  const m=new Map();
  for(const c of homeFeedData) for(const x of (c.contexts||[])) if(x.type==="group" && x.gid) m.set(x.gid, x.name);
  return [...m].map(([gid,name])=>({gid,name}));
}
function renderFeedChips(){
  const base=[["all","Todo"],["me","Yo"],["friends","Amigos"]];
  const chips=base.map(([k,l])=>`<button class="ychip ${feedScope===k?'on':''}" data-fscope="${k}">${l}</button>`)
    .concat(feedGroups().map(g=>`<button class="ychip ${feedScope===g.gid?'on':''}" data-fscope="${g.gid}">🏆 ${g.name}</button>`));
  $("feedChips").innerHTML=chips.join("");
}
function filteredFeed(){
  let arr=homeFeedData;
  if(feedScope==="me") arr=arr.filter(c=>c.uid===uid);
  else if(feedScope==="friends") arr=arr.filter(c=>c.uid!==uid);
  else if(feedScope!=="all") arr=arr.filter(c=>(c.contexts||[]).some(x=>x.gid===feedScope));
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
  const add = c.uid===uid ? "" : `<button class="rx rx--add" data-rxadd aria-label="Reaccionar">🙂</button>`;
  return (chips||add) ? `<div class="feed__rx">${chips}${add}</div>` : "";
}
function _feedItem(c,i){
  const chips=(c.contexts||[]).filter(x=>x.type!=="tú").map(_ctxChip).join("");
  const hito = MILESTONES.includes(c.n);
  const head = hito
    ? (c.uid===uid ? `🎉 ¡Llegaste a <b>${c.n}</b> 💩!` : `🎉 <b>${c.name}</b> llegó a <b>${c.n}</b> 💩`)
    : (c.uid===uid ? "Sumaste una caca" : `<b>${c.name}</b> sumó una caca`);
  const nBadge = hito ? "" : `<b class="feed__n">${c.n}</b>`;
  return `<li class="feed__item ${hito?'feed__item--hito':''}" data-i="${i}">
    <span class="av" style="background:${c.color}">${initial(c.name)}</span>
    <div class="feed__body">
      <div class="feed__line">${head} ${nBadge}</div>
      ${chips?`<div class="feed__ctx">${chips}</div>`:""}
      ${reactionsRow(c)}
    </div>
    <span class="feed__time">${fmtWhen(c.ts)}</span>
  </li>`;
}
function renderFeed(){
  const all=filteredFeed();
  const items=all.slice(0,feedShown);
  const empty = feedQ||feedScope!=="all" ? "Nada por aquí con este filtro." : "Aún no hay actividad. ¡Suma la primera! 👆";
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
          applyReaction(entry, rx.dataset.rx); return; }   // chip → alterna mi reacción
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
    await setReaction(entry.uid, entry.id, uid, emoji, !has);
    if(!has) enqueuePush(uid, entry.uid, "reaction", "Nueva reacción 💩", `${me?.displayName||"Alguien"} reaccionó ${emoji} a tu caca`).catch(()=>{});
  }
  catch(err){ toast("No se pudo reaccionar"); console.error(err); loadActivity(); }
}
function openReactPicker(entry){ _rxTarget=entry; $("reactSheet").hidden=false; }
$("rxCancel").addEventListener("click", ()=>$("reactSheet").hidden=true);
$("reactSheet").addEventListener("click", e=>{ if(e.target===$("reactSheet")) $("reactSheet").hidden=true; });
$("rxPick").addEventListener("click", e=>{
  const b=e.target.closest("[data-rxpick]"); if(!b||!_rxTarget)return;
  $("reactSheet").hidden=true; applyReaction(_rxTarget, b.dataset.rxpick); _rxTarget=null;
});

// ── long-press en un chip → tooltip con quién ha reaccionado (privacidad estilo Telegram) ──
let friendNames={};               // uid -> nombre, solo de MIS amigos (para revelar identidades)
function reactorNames(entry, emoji){
  const r=entry.reactions||{}; const names=[]; let anon=0;
  for(const ruid in r){
    if(!asArr(r[ruid]).includes(emoji)) continue;
    if(ruid===uid) names.unshift("Tú");
    else if(friendNames[ruid]) names.push(friendNames[ruid]);   // amigo en común → nombre
    else anon++;                                                // no amigo → anónimo
  }
  return { names, anon };
}
let _rxTip=null, _lpTimer=null, _lpFired=false;
const _clearLP=()=>{ if(_lpTimer){ clearTimeout(_lpTimer); _lpTimer=null; } };
function hideReactors(){ if(_rxTip){ _rxTip.remove(); _rxTip=null; } }
function showReactors(chip){
  hideReactors();
  const li=chip.closest(".feed__item[data-i]"); if(!li)return;
  const entry=homeFeedData[+li.dataset.i]; if(!entry)return;
  const emoji=chip.dataset.rx; const {names,anon}=reactorNames(entry,emoji);
  let txt=names.join(", ");
  if(anon>0) txt += (txt?" y ":"") + (anon===1?"1 más":`${anon} más`);
  if(!txt) txt="Nadie";
  const tip=document.createElement("div"); tip.className="rxtip";
  tip.innerHTML=`<span class="rxtip__e">${emoji}</span> ${txt}`;
  document.body.appendChild(tip);
  const r=chip.getBoundingClientRect();
  tip.style.left = Math.max(10, Math.min(window.innerWidth-10-tip.offsetWidth, r.left)) + "px";
  tip.style.top  = Math.max(8, r.top - tip.offsetHeight - 8) + "px";
  _rxTip=tip; navigator.vibrate?.(12);
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
let notifReqs=[], notifRx=[], rxBaseline=null, reqBaseline=null, unseenRx=0, notifUnsub=[], notifFriends={};
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
          enqueuePush(uid, r.id, "overtake", "¡Te han superado! 🏃", `${name} te ha superado en ${g.name}`).catch(()=>{});
        }
      }
    }
  }catch(e){ console.error(e); }
}
// Al cruzar un hito, avisa a mis amigos (push tipo "milestone", inmediato).
async function notifyFriendsMilestone(n){
  try{
    const fr=await getFriends(uid); const name=me?.displayName||"Alguien";
    fr.forEach(f=> enqueuePush(uid, f.id, "milestone", "¡Hito de un amigo! 🎉", `${name} llegó a ${n} 💩`).catch(()=>{}) );
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
  const opts={ body, icon:"icon.svg", badge:"icon.svg", tag:"cagometro-"+Date.now() };
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
    const pend=fships.filter(f=>f.status==="pending" && f.requestedBy!==uid);
    const enriched=await Promise.all(pend.map(async f=>{
      const o=await getUser(f.uids.find(u=>u!==uid));
      return { id:f.id, name:o?.displayName||"Alguien", color:o?.color };
    }));
    if(reqBaseline===null){ reqBaseline=new Set(enriched.map(r=>r.id)); }   // base: no notifica las ya existentes
    else {
      for(const r of enriched) if(!reqBaseline.has(r.id)){ reqBaseline.add(r.id); showLocalNotif("Nueva solicitud de amistad 👋", `${r.name} quiere ser tu amigo/a`); }
      const ids=new Set(enriched.map(r=>r.id)); for(const id of [...reqBaseline]) if(!ids.has(id)) reqBaseline.delete(id);
    }
    notifReqs=enriched; refreshNotif();
  }));
  // reacciones a MIS cacas (diff en vivo)
  notifUnsub.push(watchMyCacas(uid, cacas=>{
    const cur=new Map();
    for(const c of cacas){ const r=c.reactions||{}; for(const ru in r){ if(ru===uid) continue; for(const e of asArr(r[ru])) cur.set(`${c.id}|${ru}|${e}`, {reactorUid:ru,emoji:e,ts:c.ts,cacaId:c.id}); } }
    if(rxBaseline===null){                              // 1er snapshot = línea base (no notifica)
      rxBaseline=new Set(cur.keys());
    } else {
      let added=0, last=null;
      for(const [k,v] of cur) if(!rxBaseline.has(k)){ rxBaseline.add(k); added++; last=v; }
      for(const k of [...rxBaseline]) if(!cur.has(k)) rxBaseline.delete(k);
      if(added){
        unseenRx+=added;
        if(added===1 && last) resolveName(last.reactorUid).then(n=> showLocalNotif("Nueva reacción 💩", `${n} reaccionó ${last.emoji} a tu caca`));
        else showLocalNotif("Nuevas reacciones 💩", `Tienes ${added} reacciones nuevas en tus cacas`);
      }
    }
    notifRx=[...cur.values()].sort((a,b)=>b.ts-a.ts);
    // resuelve nombres desconocidos para la lista de la campanita y vuelve a pintar
    const unknown=[...new Set(notifRx.map(v=>v.reactorUid))].filter(ru=>ru!==uid && !notifFriends[ru]);
    if(unknown.length) Promise.all(unknown.map(getUser)).then(us=>{ us.forEach((u,i)=>{ if(u) notifFriends[unknown[i]]=u.displayName||"Alguien"; }); refreshNotif(); });
    refreshNotif();
  }));
}
function stopNotifications(){ notifUnsub.forEach(u=>{try{u()}catch(e){}}); notifUnsub=[]; rxBaseline=null; reqBaseline=null; notifReqs=[]; notifRx=[]; unseenRx=0; renderNotifBadge(); }
function refreshNotif(){ renderNotifBadge(); if(!$("notifSheet").hidden) renderNotifSheet(); }
function renderNotifBadge(){ const n=notifReqs.length+unseenRx; const b=$("notifBadge"); if(n>0){ b.textContent=n>9?"9+":String(n); b.hidden=false; } else b.hidden=true; }
const _notifName=ru=> ru===uid?"Tú":(notifFriends[ru]||"Alguien");
// Resuelve el nombre de quien reacciona (es TU caca → puedes ver quién). Cachea en notifFriends.
async function resolveName(ru){
  if(ru===uid) return "Tú";
  if(notifFriends[ru]) return notifFriends[ru];
  try{ const u=await getUser(ru); const n=u?.displayName||"Alguien"; notifFriends[ru]=n; return n; }
  catch{ return "Alguien"; }
}
function renderNotifSheet(){
  const reqs=notifReqs.map(r=>`<li>${av(r.name,r.color)}<span class="nm">${r.name}<small>quiere ser tu amigo/a</small></span><button class="btn-accept" data-accept="${r.id}">Aceptar</button><button class="btn-decline" data-decline="${r.id}">✕</button></li>`).join("");
  const rx=notifRx.slice(0,30).map(v=>`<li class="notif-rx"><span class="notif-rx__e">${v.emoji}</span><span class="feed__txt"><b>${_notifName(v.reactorUid)}</b> reaccionó a tu caca</span><span class="feed__time">${fmtWhen(v.ts)}</span></li>`).join("");
  let html="";
  if(reqs) html+=`<div class="notif-sec"><h4 class="notif-h">Solicitudes</h4><ul class="reqlist">${reqs}</ul></div>`;
  if(rx)   html+=`<div class="notif-sec"><h4 class="notif-h">Reacciones a tus cacas</h4><ul class="notif-list">${rx}</ul></div>`;
  $("notifBody").innerHTML = html || `<p class="notif-empty">Sin notificaciones todavía.<br/><small>Aquí verás reacciones a tus cacas y solicitudes de amistad.</small></p>`;
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
async function openPersonSheet(entry){
  if(entry.uid===uid){ setView("perfil"); return; }    // tu propia caca → tu perfil
  $("psAvatar").textContent=initial(entry.name); $("psAvatar").style.background=entry.color;
  $("psName").textContent=entry.name; $("psTotal").textContent="…";
  $("psStats").innerHTML=""; $("psRecords").hidden=true; $("psChart").innerHTML=""; $("psGroups").innerHTML=""; $("psActions").innerHTML="";
  $("psSheet").hidden=false;
  const [u,cacas,fships]=await Promise.all([getUser(entry.uid), myActivity(entry.uid,5000), myFriendships(uid)]);
  const st=personStats(cacas);
  const year = u?.totalCount ?? st.total;
  const life = u?.lifetimeCount || cacas.length;
  $("psTotal").textContent=`${year} este año · ${life} en total`;
  $("psStats").innerHTML=`
    <div class="stat stat--accent"><b>${year}</b><span>este año</span></div>
    <div class="stat"><b>${st.streak}</b><span>racha (días)</span></div>
    <div class="stat"><b>${st.avg}</b><span>media/día activo</span></div>
    <div class="stat"><b>${st.bestDay}</b><span>mejor día</span></div>`;
  if(st.activeDays){ $("psRecords").textContent=`${st.activeDays} días con caca este año`; $("psRecords").hidden=false; }
  $("psChart").innerHTML=barsHTML(st.monthly, PM);
  const gs=(entry.contexts||[]).filter(c=>c.type==="group");
  $("psGroupsWrap").hidden = !gs.length;
  $("psGroups").innerHTML=gs.map(g=>`<button class="btn-solid psg" data-gid="${g.gid}">🏆 ${g.name}</button>`).join("");
  const fr=fships.find(f=>f.status==="accepted" && f.uids.includes(entry.uid));
  $("psActions").innerHTML = fr ? `<button class="btn-ghost btn-ghost--danger" data-rmfriend="${fr.id}">Eliminar amigo</button>` : "";
}
$("psClose").addEventListener("click",()=>$("psSheet").hidden=true);
$("psSheet").addEventListener("click",e=>{ if(e.target===$("psSheet")) $("psSheet").hidden=true; });
$("psActions").addEventListener("click", async e=>{
  const b=e.target.closest("[data-rmfriend]"); if(!b)return;
  if(!confirm("¿Eliminar a esta persona de tus amigos?")) return;
  try{ await removeFriend(b.dataset.rmfriend); toast("Amigo eliminado"); $("psSheet").hidden=true; if(document.querySelector(".view.is-active")?.dataset.view==="amigos") renderAmigos(); }
  catch(err){ toast("No se pudo"); console.error(err); }
});
$("psGroups").addEventListener("click", async e=>{
  const b=e.target.closest("[data-gid]"); if(!b)return;
  $("psSheet").hidden=true; setView("grupos");
  const gs=await myGroups(uid); myGroupsCache=gs; const g=gs.find(x=>x.id===b.dataset.gid); if(g) openGroup(g);
});

/* ---------- +1 / −1 / corregir ---------- */
let busy=false;
$("addBtn").addEventListener("click",async e=>{
  if(busy||!uid)return; busy=true;
  const btn=$("addBtn"),r=btn.getBoundingClientRect();
  btn.classList.add("flash");setTimeout(()=>btn.classList.remove("flash"),350);navigator.vibrate?.(18);
  const num=$("meCount");num.textContent=(parseInt(num.textContent,10)||0)+1;
  num.classList.remove("pop");void num.offsetWidth;num.classList.add("pop");floatPoo(r.left+r.width/2,r.top);
  try{
    const loc = me?.locationMode==="always" ? await getGeo() : null;
    await addCaca(uid, loc); toast(loc?"¡Caca + ubicación! 📍":"¡Caca registrada! 💩");
    // entrada optimista: se ve al instante; loadActivity la sustituye con datos reales
    homeFeedData.unshift({ ts:Date.now(), uid, id:"local-"+Date.now(), name:me?.displayName||"", color:me?.color||colorForUid(uid), contexts:[{type:"tú"}], n:(me?.totalCount||0)+1, reactions:{} });
    if(document.querySelector(".view.is-active")?.dataset.view==="inicio"){ feedShown=Math.min(feedShown+1,homeFeedData.length); renderFeed(); }
    loadActivity();
  }
  catch(err){ toast("No se pudo guardar 😬"); console.error(err); }
  finally{ setTimeout(()=>busy=false,250); }
});
async function undoCaca(){
  if(busy||!uid)return; busy=true;
  try{ const ok=await removeCaca(uid); toast(ok?"Caca eliminada":"No hay cacas que quitar"); loadActivity(); }
  catch(err){ toast("No se pudo deshacer"); console.error(err); }
  finally{ setTimeout(()=>busy=false,250); }
}
$("fixBtn").addEventListener("click",async()=>{
  const cur=me?.totalCount||0;
  const v=prompt("¿A cuántas cacas quieres ajustar tu contador de este año?",cur);
  if(v===null)return; const n=parseInt(v,10); if(isNaN(n)||n<0)return toast("Número no válido");
  try{ await setCount(uid,n); loadActivity(); toast("Contador ajustado ✅"); }
  catch(err){ toast("No se pudo ajustar"); console.error(err); }
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
  if(busy||!uid)return; busy=true; toast("Obteniendo ubicación… 📍");
  try{ const loc=await getGeo(); await addCaca(uid,loc); toast(loc?"¡Caca + ubicación! 📍":"Caca añadida (sin ubicación)"); loadActivity(); }
  catch(err){ toast("No se pudo guardar"); console.error(err); }
  finally{ setTimeout(()=>busy=false,250); }
});
$("lateCancel").addEventListener("click",()=>$("lateSheet").hidden=true);
$("lateSheet").addEventListener("click",e=>{ if(e.target===$("lateSheet")) $("lateSheet").hidden=true; });
$("lateConfirm").addEventListener("click",async()=>{
  const v=$("lateWhen").value; if(!v)return;
  const ts=new Date(v).getTime();
  if(isNaN(ts)) return toast("Fecha no válida");
  if(ts>Date.now()+60000) return toast("No puedes añadir cacas del futuro 😅");
  $("lateSheet").hidden=true;
  try{ await addCacaAt(uid,ts); navigator.vibrate?.(18); toast("Caca añadida ✅"); loadActivity(); }
  catch(err){ toast("No se pudo añadir"); console.error(err); }
});

/* ---------- amigos ---------- */
$("addFriendBtn").addEventListener("click",async()=>{
  const email=$("friendEmail").value.trim(); const msg=$("friendMsg");
  if(!email)return; msg.hidden=true;
  try{ const o=await sendFriendRequest(uid,email); $("friendEmail").value="";
    msg.textContent=`Solicitud enviada a ${o.displayName} ✅`; msg.style.color="var(--mint)"; msg.hidden=false; renderAmigos(); }
  catch(err){ msg.style.color="var(--rose)";
    msg.textContent=err.message==="no-user"?"No hay ningún usuario con ese email.":err.message==="self"?"Ese eres tú 😄":"No se pudo enviar."; msg.hidden=false; }
});
async function renderAmigos(){
  const [fships, friends] = await Promise.all([ myFriendships(uid), getFriends(uid) ]);
  // requests
  const pending=fships.filter(f=>f.status==="pending");
  const incoming=pending.filter(f=>f.requestedBy!==uid);
  const outgoing=pending.filter(f=>f.requestedBy===uid);
  $("reqBlock").hidden = !pending.length;
  const incHtml=await Promise.all(incoming.map(async f=>{
    const other=await getUser(f.uids.find(u=>u!==uid));
    return `<li>${av(other?.displayName,other?.color)}<span class="nm">${other?.displayName||"?"}<small>quiere ser tu amigo/a</small></span>
      <button class="btn-accept" data-accept="${f.id}">Aceptar</button><button class="btn-decline" data-decline="${f.id}">✕</button></li>`;
  }));
  const outHtml=await Promise.all(outgoing.map(async f=>{
    const other=await getUser(f.uids.find(u=>u!==uid));
    return `<li>${av(other?.displayName,other?.color)}<span class="nm">${other?.displayName||"?"}<small>solicitud pendiente…</small></span></li>`;
  }));
  $("reqList").innerHTML=[...incHtml,...outHtml].join("");
  // leaderboard (me + friends, this year)
  const board=[{id:uid,displayName:me?.displayName,color:me?.color,totalCount:me?.totalCount||0}, ...friends]
    .sort((a,b)=>(b.totalCount||0)-(a.totalCount||0));
  $("friendsRank").innerHTML=board.map((r,i)=>`<li class="${r.id===uid?'me':''}"><span class="pos">${i+1}</span>${av(r.displayName,r.color)}<span class="nm">${r.displayName||"?"}${r.id===uid?' <small>tú</small>':''}</span><span class="ct">${r.totalCount||0}</span></li>`).join("")
    ||`<li><span class="nm" style="color:var(--ink-faint)">Añade amigos para competir 👇</span></li>`;
}
document.addEventListener("click",async e=>{
  const a=e.target.closest("[data-accept]"); const d=e.target.closest("[data-decline]");
  const gli=e.target.closest("#groupList li[data-gid]");
  if(a){ await acceptFriend(a.dataset.accept, uid); toast("¡Nuevo amigo! 🎉"); renderAmigos(); }
  if(d){ await removeFriend(d.dataset.decline); renderAmigos(); }
  if(gli){ openGroupById(gli.dataset.gid); }
});

/* ---------- grupos ---------- */
let activeGroup=null, myGroupsCache=[];
$("createGroupBtn").addEventListener("click", async ()=>{
  const name=$("newGroupName").value.trim(); const msg=$("groupMsg"); msg.hidden=true;
  if(!name)return;
  try{ const g=await createGroup(uid,name); $("newGroupName").value=""; toast("Grupo creado 🎉"); await renderGrupos(); openGroup(g); }
  catch(err){ msg.style.color="var(--rose)"; msg.textContent="No se pudo crear el grupo."; msg.hidden=false; console.error(err); }
});
$("joinGroupBtn").addEventListener("click", async ()=>{
  const code=$("joinCode").value.trim(); const msg=$("groupMsg"); msg.hidden=true;
  if(!code)return;
  if(!confirm("Al unirte a este grupo, todos sus miembros se añadirán automáticamente como amigos. ¿Continuar?")) return;
  try{ const g=await joinGroup(uid,code); $("joinCode").value=""; toast(`Te uniste a ${g.name} 🎉`); await renderGrupos(); openGroup(g); }
  catch(err){ msg.style.color="var(--rose)"; msg.textContent=err.message==="no-group"?"No existe ningún grupo con ese código.":"No se pudo unir."; msg.hidden=false; }
});
$("shareCode").addEventListener("click", ()=>{ if(activeGroup) shareInvite(inviteUrl("join="+encodeURIComponent(activeGroup.inviteCode)), `Únete a "${activeGroup.name}" en El Cagómetro 💩`); });
$("leaveGroupBtn").addEventListener("click", async ()=>{
  if(!activeGroup)return; if(!confirm(`¿Salir de "${activeGroup.name}"?`))return;
  try{ await leaveGroup(activeGroup.id, uid); activeGroup=null; $("groupDetail").hidden=true; toast("Has salido del grupo"); renderGrupos(); }
  catch(err){ toast("No se pudo salir"); console.error(err); }
});
async function renderGrupos(){
  myGroupsCache = await myGroups(uid);
  $("groupList").innerHTML = myGroupsCache.length ? myGroupsCache.map(g=>`
    <li data-gid="${g.id}"><span class="gname">${g.name}</span><span class="gmeta">${(g.members||[]).length} 👤</span></li>`).join("")
    : `<li class="gempty">Aún no estás en ningún grupo. Crea uno o únete con un código 👆</li>`;
  if(activeGroup){ const still=myGroupsCache.find(g=>g.id===activeGroup.id); if(still) openGroup(still); else { activeGroup=null; $("groupDetail").hidden=true; } }
}
function openGroupById(gid){ const g=myGroupsCache.find(x=>x.id===gid); if(g) openGroup(g); }
const MF=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
async function openGroup(group){
  activeGroup=group; $("groupDetail").hidden=false;
  $("gdName").textContent=group.name; $("shareCode").textContent=`🔗 Invitar · ${group.inviteCode}`;
  const [board,yc]=await Promise.all([groupLeaderboard(group), groupYearCacas(group)]);
  $("groupRank").innerHTML=board.map((r,i)=>`<li class="${r.id===uid?'me':''}"><span class="pos">${i+1}</span>${av(r.displayName,r.color)}<span class="nm">${r.displayName||"?"}${r.id===uid?' <small>tú</small>':''}</span><span class="ct">${r.totalCount||0}</span></li>`).join("");
  // estadísticas del grupo (este año)
  const byMonth=new Array(12).fill(0); for(const c of yc){ byMonth[tzParts(c.ts,c.tz).month-1]++; }
  const total=yc.length, members=(group.members||[]).length, bestIdx=byMonth.indexOf(Math.max(...byMonth,0));
  $("gStatGrid").innerHTML=`
    <div class="stat stat--accent"><b>${total}</b><span>total del grupo</span></div>
    <div class="stat"><b>${members}</b><span>miembros</span></div>
    <div class="stat"><b>${total?MF[bestIdx]:"—"}</b><span>mejor mes</span></div>
    <div class="stat"><b>${members?(total/members).toFixed(1):0}</b><span>media/persona</span></div>`;
  $("gChartMonth").innerHTML=barsHTML(byMonth, PM);
}

/* ---------- nav ---------- */
document.querySelectorAll("[data-view]").forEach(b=>{ if(b.classList.contains("view"))return;
  b.addEventListener("click",()=>setView(b.dataset.view)); });
function setView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("is-active",v.dataset.view===name));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("is-active",t.dataset.view===name));
  window.scrollTo({top:0,behavior:"smooth"});
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
  const gs=await myGroups(uid); myGroupsCache=gs;
  $("pGroups").innerHTML=gs.map(g=>`<button class="btn-solid psg psg--chip" data-pgid="${g.id}">🏆 ${g.name}</button>`).join("");
}
$("pGroups").addEventListener("click", e=>{
  const b=e.target.closest("[data-pgid]"); if(!b)return;
  setView("grupos"); openGroupById(b.dataset.pgid);
});

let statsCacas=[], statsYears=[], statsScope=new Date().getFullYear();
async function loadStats(){
  renderProfileGroups();
  statsCacas = await myActivity(uid, 5000);
  statsYears = [...new Set(statsCacas.map(c=>tzParts(c.ts,c.tz).year))].sort((a,b)=>b-a);
  if(!(statsScope==="all" || statsYears.includes(statsScope))) statsScope = statsYears[0] || new Date().getFullYear();
  renderYearSel(); renderStats();
}
function renderYearSel(){
  $("yearSel").innerHTML = statsYears.map(y=>`<button class="ychip ${statsScope===y?'on':''}" data-year="${y}">${y}</button>`).join("")
    + `<button class="ychip ${statsScope==='all'?'on':''}" data-year="all">Todos</button>`;
}
$("yearSel").addEventListener("click", e=>{ const b=e.target.closest("[data-year]"); if(!b)return;
  statsScope = b.dataset.year==="all" ? "all" : +b.dataset.year; renderYearSel(); renderStats(); });
function renderStats(){
  const items = statsScope==="all" ? statsCacas : statsCacas.filter(c=>tzParts(c.ts,c.tz).year===statsScope);
  const total=items.length;
  const dayCount={}; for(const c of items){ const p=tzParts(c.ts,c.tz); const k=`${p.year}-${p.month}-${p.day}`; dayCount[k]=(dayCount[k]||0)+1; }
  const bestDay=Math.max(0,...Object.values(dayCount),0);
  const activeDays=Object.keys(dayCount).length;
  const avg=activeDays?(total/activeDays).toFixed(1):"0";
  $("statGrid").innerHTML=`
    <div class="stat stat--accent"><b>${total}</b><span>${statsScope==="all"?"total histórico":statsScope}</span></div>
    <div class="stat"><b>${bestDay}</b><span>mejor día</span></div>
    <div class="stat"><b>${avg}</b><span>media/día activo</span></div>
    <div class="stat"><b>${activeDays}</b><span>días con caca</span></div>`;
  if(statsScope==="all"){
    $("chartTitle").textContent="Por año";
    const by={}; for(const c of items){ const y=tzParts(c.ts,c.tz).year; by[y]=(by[y]||0)+1; }
    const ys=Object.keys(by).sort();
    $("chartPrimary").innerHTML=barsHTML(ys.map(y=>by[y]), ys.map(y=>String(y).slice(2))) || `<div class="bar"><span class="barlbl">—</span></div>`;
  } else {
    $("chartTitle").textContent="Por mes";
    const m=new Array(12).fill(0); for(const c of items) m[tzParts(c.ts,c.tz).month-1]++;
    const M=["E","F","M","A","M","J","J","A","S","O","N","D"];
    $("chartPrimary").innerHTML=barsHTML(m, M);
  }
  const h=new Array(24).fill(0); for(const c of items) h[tzParts(c.ts,c.tz).hour]++;
  const peak=total?h.indexOf(Math.max(...h)):-1;
  $("peakHour").textContent = peak>=0?`punta: ${String(peak).padStart(2,"0")}:00 · ${h[peak]}`:"—";
  $("chartHours").innerHTML=barsHTML(h, h.map((_,i)=>i%6===0?i:""), {showVal:false});
  const w=new Array(7).fill(0); for(const c of items) w[tzParts(c.ts,c.tz).weekday]++;
  const WD=["L","M","X","J","V","S","D"];
  $("chartWeek").innerHTML=barsHTML(w, WD);
}

/* ---------- refrescar al volver a primer plano ---------- */
// La PWA se "reanuda" en la misma pestaña sin navegar; recargamos sus datos.
function refreshActiveView(){
  if(!uid) return;
  const active = document.querySelector(".view.is-active")?.dataset.view;
  if(active==="inicio") loadActivity();
  else if(active==="amigos") renderAmigos();
  else if(active==="grupos") renderGrupos();
  else if(active==="perfil") loadStats();
}
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") refreshActiveView(); });
window.addEventListener("focus", refreshActiveView);

/* ---------- ubicación + mapa ---------- */
const LOC_LABELS={never:"Nunca",choose:"Elegir",always:"Siempre"};
function renderLocSel(mode){
  mode=mode||"never";
  $("locSel").innerHTML=Object.keys(LOC_LABELS).map(k=>`<button class="ychip ${mode===k?'on':''}" data-loc="${k}">${LOC_LABELS[k]}</button>`).join("");
}
$("locSel").addEventListener("click", async e=>{
  const b=e.target.closest("[data-loc]"); if(!b||!uid)return;
  renderLocSel(b.dataset.loc);
  try{ await setLocationMode(uid,b.dataset.loc); toast("Ubicación: "+LOC_LABELS[b.dataset.loc]); }catch(err){ console.error(err); }
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
let _map=null,_markers=[];
$("openMapBtn").addEventListener("click", openMap);
$("mapClose").addEventListener("click", ()=>$("mapSheet").hidden=true);
async function openMap(){
  $("mapSheet").hidden=false; $("mapEmpty").hidden=true;
  if(typeof L==="undefined"){ toast("No se pudo cargar el mapa"); return; }
  if(!_map){
    _map=L.map("map",{zoomControl:true});
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(_map);
  }
  setTimeout(()=>_map.invalidateSize(),120);
  _markers.forEach(m=>_map.removeLayer(m)); _markers=[];
  const cacas=await myActivity(uid,3000);
  const pts=cacas.filter(c=>isFinite(c.lat)&&isFinite(c.lng));
  const icon=L.divIcon({className:"",html:'<div style="font-size:24px;line-height:24px">💩</div>',iconSize:[24,24],iconAnchor:[12,12]});
  _markers=pts.map(c=>L.marker([c.lat,c.lng],{icon}).addTo(_map));
  if(_markers.length) setTimeout(()=>_map.fitBounds(L.featureGroup(_markers).getBounds().pad(0.3)),160);
  else { _map.setView([40.4168,-3.7038],5); $("mapEmpty").hidden=false; }
}

/* ---------- delight ---------- */
function floatPoo(cx,cy){ for(let i=0;i<3;i++){ const p=document.createElement("div");p.className="poo-fly";p.textContent="💩";
  p.style.left=(cx+(Math.random()*60-30))+"px";p.style.top=(cy-6)+"px";p.style.setProperty("--rot",(Math.random()*60-30)+"deg");
  p.style.animationDelay=(i*70)+"ms";document.body.appendChild(p);setTimeout(()=>p.remove(),1200);} }
const HYPE=["¡Nuevo hito!","¡Máquina!","¡Imparable!","¡Leyenda del trono! 👑","¡A por más!"];
function celebrate(num){ $("celebrateNum").textContent=num; $("celebrateText").textContent=num>=200?"¡Leyenda del trono! 👑":HYPE[Math.floor(Math.random()*HYPE.length)];
  const c=$("celebrate");c.hidden=false;confetti();navigator.vibrate?.([30,40,30,40,60]);setTimeout(()=>c.hidden=true,2600); }
function confetti(){ const cols=["#E59A2E","#6E3F1C","#2E9E68","#9A5A2A","#F7DCA8","#D8573F"];
  for(let i=0;i<90;i++){ const d=document.createElement("div");d.className="confetti";d.style.left=Math.random()*100+"vw";
    d.style.background=cols[i%cols.length];d.style.animationDuration=(1.4+Math.random()*1.4)+"s";d.style.animationDelay=(Math.random()*.3)+"s";
    d.style.transform=`rotate(${Math.random()*360}deg)`;document.body.appendChild(d);setTimeout(()=>d.remove(),3200);} }
let toastT; function toast(m){ const t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),1800); }

applyMode();
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
      _swReg=await navigator.serviceWorker.register("sw.js");
      _activate(_swReg);
      _swReg.addEventListener("updatefound", ()=>_activate(_swReg));
      setInterval(()=>_swReg.update().catch(()=>{}), 60000);
    }catch(e){}
  });
  // al volver a primer plano (típico en iOS standalone), buscar versión nueva
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible" && _swReg) _swReg.update().catch(()=>{}); });
}
