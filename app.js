/* ============================================================
   Cagómetro · UI (Firebase) — Phases A + A+ + B
   ============================================================ */
import {
  onUser, signOutUser, signUp, signIn, googleSignIn, ensureProfile,
  watchMe, addCaca, addCacaAt, removeCaca, setCount, myActivity,
  sendFriendRequest, myFriendships, acceptFriend, removeFriend, getFriends, friendsFeed,
  createGroup, joinGroup, leaveGroup, myGroups, groupLeaderboard, groupFeed,
  getUser, colorForUid
} from "./store.js";
import { IS_LOCAL } from "./firebase.js";

const $ = id => document.getElementById(id);
const MILESTONES = [10,25,50,75,100,150,200,250,300,400,500];
const nextMilestone = n => MILESTONES.find(m => m > n) || (Math.floor(n/100)*100 + 100);
const prevMilestone = n => [...MILESTONES].reverse().find(m => m <= n) || 0;
const initial = s => (s||"?").trim().charAt(0).toUpperCase();
const DAY = 86400000;
const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
const av = (name,color) => `<span class="av" style="background:${color||'#6E3F1C'}">${initial(name)}</span>`;
function timeAgo(ts){ const s=Math.max(1,Math.round((Date.now()-ts)/1000));
  if(s<60)return"ahora"; const m=Math.round(s/60); if(m<60)return`hace ${m} min`;
  const h=Math.round(m/60); if(h<24)return`hace ${h} h`; return`hace ${Math.round(h/24)} d`; }

let uid=null, me=null, unsub=null, lastTotal=null;

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
onUser(async user=>{
  $("splash").hidden = true;                 // auth resolved → hide the loading screen
  if(!user){ showGate(); return; }
  uid=user.uid; await ensureProfile(user); showApp();
});
function showGate(){ if(unsub){unsub();unsub=null;} $("app").hidden=true; $("gate").hidden=false; uid=null; me=null; lastTotal=null; }

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
    paintProgress(total);
    if(lastTotal!==null && total>lastTotal){ const hit=MILESTONES.find(x=>x>lastTotal&&x<=total); if(hit)celebrate(hit); }
    lastTotal=total;
  });
  $("pMode").textContent=IS_LOCAL?"modo local (emulador) · datos de prueba":"";
  loadActivity();
}
function paintProgress(total){ const lo=prevMilestone(total),hi=nextMilestone(total);
  $("meProgressFill").style.width=Math.min(100,Math.round(((total-lo)/(hi-lo||1))*100))+"%";
  $("meProgressLabel").textContent=`Te faltan ${hi-total} para las ${hi} 💩`; }

async function loadActivity(){
  const cacas=await myActivity(uid,200);
  const t0=startOfToday(),wk=Date.now()-7*DAY; let today=0,week=0; const days=new Set();
  for(const c of cacas){ if(c.ts>=t0)today++; if(c.ts>=wk)week++; const d=new Date(c.ts);d.setHours(0,0,0,0);days.add(d.getTime()); }
  let streak=0,cur=startOfToday(); if(!days.has(cur))cur-=DAY; while(days.has(cur)){streak++;cur-=DAY;}
  $("statToday").textContent=today; $("statWeek").textContent=week; $("statStreak").textContent=streak;
  $("feed").innerHTML=cacas.slice(0,20).map((c,i)=>`<li class="feed__item" style="animation-delay:${i*45}ms"><span class="feed__badge">💩</span><span class="feed__txt">Sumaste una caca</span><span class="feed__time">${timeAgo(c.ts)}</span></li>`).join("")
    ||`<li class="feed__item"><span class="feed__txt" style="color:var(--ink-faint)">Aún no hay cacas. ¡Suma la primera! 👆</span></li>`;
}

/* ---------- +1 / −1 / corregir ---------- */
let busy=false;
$("addBtn").addEventListener("click",async e=>{
  if(busy||!uid)return; busy=true;
  const btn=$("addBtn"),r=btn.getBoundingClientRect();
  btn.classList.add("flash");setTimeout(()=>btn.classList.remove("flash"),350);navigator.vibrate?.(18);
  const num=$("meCount");num.textContent=(parseInt(num.textContent,10)||0)+1;
  num.classList.remove("pop");void num.offsetWidth;num.classList.add("pop");floatPoo(r.left+r.width/2,r.top);
  try{ await addCaca(uid); toast("¡Caca registrada! 💩"); loadActivity(); }
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
  const [fships, friends, feed] = await Promise.all([ myFriendships(uid), getFriends(uid), friendsFeed(uid) ]);
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
  // feed
  $("friendsFeed").innerHTML=feed.map(c=>`<li class="feed__item">${av(c.name,c.color)}<span class="feed__txt"><b>${c.name}</b> sumó una caca</span><span class="feed__time">${timeAgo(c.ts)}</span></li>`).join("")
    ||`<li class="feed__item"><span class="feed__txt" style="color:var(--ink-faint)">Sin actividad de amigos todavía.</span></li>`;
}
document.addEventListener("click",async e=>{
  const a=e.target.closest("[data-accept]"); const d=e.target.closest("[data-decline]");
  const gli=e.target.closest("#groupList li[data-gid]");
  if(a){ await acceptFriend(a.dataset.accept); toast("¡Nuevo amigo! 🎉"); renderAmigos(); }
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
  try{ const g=await joinGroup(uid,code); $("joinCode").value=""; toast(`Te uniste a ${g.name} 🎉`); await renderGrupos(); openGroup(g); }
  catch(err){ msg.style.color="var(--rose)"; msg.textContent=err.message==="no-group"?"No existe ningún grupo con ese código.":"No se pudo unir."; msg.hidden=false; }
});
$("shareCode").addEventListener("click", ()=>{ if(activeGroup) navigator.clipboard?.writeText(activeGroup.inviteCode).then(()=>toast("Código copiado 📋")).catch(()=>{}); });
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
async function openGroup(group){
  activeGroup=group; $("groupDetail").hidden=false;
  $("gdName").textContent=group.name; $("shareCode").textContent=`Código: ${group.inviteCode}`;
  const [board,feed]=await Promise.all([groupLeaderboard(group), groupFeed(group)]);
  $("groupRank").innerHTML=board.map((r,i)=>`<li class="${r.id===uid?'me':''}"><span class="pos">${i+1}</span>${av(r.displayName,r.color)}<span class="nm">${r.displayName||"?"}${r.id===uid?' <small>tú</small>':''}</span><span class="ct">${r.totalCount||0}</span></li>`).join("");
  $("groupFeed").innerHTML=feed.map(c=>`<li class="feed__item">${av(c.name,c.color)}<span class="feed__txt"><b>${c.name}</b> sumó una caca</span><span class="feed__time">${timeAgo(c.ts)}</span></li>`).join("")
    ||`<li class="feed__item"><span class="feed__txt" style="color:var(--ink-faint)">Sin actividad todavía.</span></li>`;
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

let statsCacas=[], statsYears=[], statsScope=new Date().getFullYear();
async function loadStats(){
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
    const ys=Object.keys(by).sort(); const max=Math.max(1,...Object.values(by));
    $("chartPrimary").innerHTML=ys.map(y=>`<div class="bar"><i style="height:${Math.round(by[y]/max*100)}%"></i><span>${String(y).slice(2)}</span></div>`).join("")||'<div class="bar"><span>—</span></div>';
  } else {
    $("chartTitle").textContent="Por mes";
    const m=new Array(12).fill(0); for(const c of items) m[tzParts(c.ts,c.tz).month-1]++;
    const max=Math.max(1,...m); const M=["E","F","M","A","M","J","J","A","S","O","N","D"];
    $("chartPrimary").innerHTML=m.map((v,i)=>`<div class="bar ${v===max&&v>0?'peak':''}"><i style="height:${Math.round(v/max*100)}%"></i><span>${M[i]}</span></div>`).join("");
  }
  const h=new Array(24).fill(0); for(const c of items) h[tzParts(c.ts,c.tz).hour]++;
  const hMax=Math.max(1,...h); const peak=total?h.indexOf(Math.max(...h)):-1;
  $("peakHour").textContent = peak>=0?`punta: ${String(peak).padStart(2,"0")}:00`:"—";
  $("chartHours").innerHTML=h.map((v,i)=>`<div class="bar ${i===peak&&v>0?'peak':''}"><i style="height:${Math.round(v/hMax*100)}%"></i><span>${i%6===0?i:''}</span></div>`).join("");
  const w=new Array(7).fill(0); for(const c of items) w[tzParts(c.ts,c.tz).weekday]++;
  const wMax=Math.max(1,...w); const WD=["L","M","X","J","V","S","D"];
  $("chartWeek").innerHTML=w.map((v,i)=>`<div class="bar ${v===wMax&&v>0?'peak':''}"><i style="height:${Math.round(v/wMax*100)}%"></i><span>${WD[i]}</span></div>`).join("");
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
  let _reloading=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(_reloading)return; _reloading=true; location.reload(); });
  window.addEventListener("load", async ()=>{
    try{ const reg=await navigator.serviceWorker.register("sw.js"); reg.update(); setInterval(()=>reg.update().catch(()=>{}), 60000); }catch(e){}
  });
}
