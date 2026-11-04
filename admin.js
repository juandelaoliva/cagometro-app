/* ============================================================
   Cagómetro · panel de administración (pantalla completa, móvil primero, aprovecha el escritorio).
   Solo lo abre ADMIN_UID (la barrera real son las reglas de Firestore). Se carga bajo demanda desde app.js (import()),
   así que el resto de usuarios no descarga ni una línea de esto.
   Las cuentas salen de admin-stats.js (puro y probado); aquí solo se pinta y se reacciona a los toques.
   TODO lo que viene de la base de datos se escapa con `esc`: lo escribe cualquiera (nombres, notas de denuncia…).
   ============================================================ */
import { computeStats, filterUsers, usersCsv, tsMs, DAY } from "./admin-stats.js";

const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const num = n => (n ?? 0).toLocaleString("es-ES");
const fdate = ms => ms ? new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fdt = ms => ms ? new Date(ms).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const ago = ms => {
  if (!ms) return "nunca";
  const d = Math.floor((Date.now() - ms) / DAY), h = Math.floor((Date.now() - ms) / 3600000);
  return d >= 1 ? `hace ${d} d` : h >= 1 ? `hace ${h} h` : "hace un momento";
};
const initial = s => (s || "?").trim().charAt(0).toUpperCase();
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const CAT_NAME = { chats: "chat", sync: "tuberías", milestones: "hitos", reactions: "reacciones", overtake: "adelantamientos" };

const QUEUE_LABEL = { ok: "OK", late: "Atrasada", down: "PARADA", unknown: "—" }, QUEUE_TONE = { ok: "good", late: "warn", down: "bad", unknown: "" };
const NAV = [["overview", "📊", "Resumen"], ["users", "👤", "Usuarios"], ["groups", "🏆", "Grupos"], ["reports", "🚩", "Denuncias"], ["system", "⚙️", "Sistema"]];

/* ---------- piezas de gráfico (HTML/SVG a mano, sin librerías) ---------- */
const kpi = (label, value, sub = "", tone = "") => `<div class="ad-kpi ${tone}"><span class="ad-kpi__v">${value}</span><span class="ad-kpi__l">${esc(label)}</span>${sub ? `<span class="ad-kpi__s">${sub}</span>` : ""}</div>`;
const card = (title, body, cls = "", sub = "") => `<section class="ad-card ${cls}"><header><h3>${esc(title)}</h3>${sub ? `<span>${sub}</span>` : ""}</header>${body}</section>`;

/** Barras verticales (HTML + CSS: nítidas a cualquier tamaño). values: números; labels: textos (se enseña uno de cada `every`); hl: índice resaltado. */
function bars(values, labels, { h = 120, every = 1, hl = -1 } = {}) {
  const max = Math.max(1, ...values);
  return `<div class="ad-bars" style="--h:${h}px">${values.map((v, i) =>
    `<div class="ad-bars__col${i === hl ? " hl" : ""}" title="${esc(labels[i] ?? "")}: ${num(v)}"><i style="height:${v ? Math.max(3, (v / max) * 100) : 0}%"></i><em>${i % every === 0 ? esc(labels[i] ?? "") : ""}</em></div>`).join("")}</div>
    <div class="ad-bars__max">máx. ${num(max)}</div>`;
}

/** Barras horizontales con etiqueta y valor (ranking). items: [{label, value, sub?, onclick-id?}] */
function hbars(items, { unit = "" } = {}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<ul class="ad-hbars">${items.map(i => `<li ${i.user ? `data-user="${esc(i.user)}"` : ""} ${i.user ? 'class="is-link"' : ""}>
    <span class="ad-hbars__l">${esc(i.label)}${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span>
    <span class="ad-hbars__t"><i style="width:${Math.max(2, (i.value / max) * 100)}%"></i></span><b>${num(i.value)}${unit}</b></li>`).join("") || '<li class="ad-empty">Sin datos todavía</li>'}</ul>`;
}

/** Anillo con leyenda. parts: [{label, value, color}] */
function donut(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1; let acc = 0;
  const stops = parts.map(p => { const a = (acc / total) * 100; acc += p.value; return `${p.color} ${a.toFixed(2)}% ${((acc / total) * 100).toFixed(2)}%`; }).join(",");
  return `<div class="ad-donut"><div class="ad-donut__ring" style="background:conic-gradient(${stops || "var(--line) 0 100%"})"><span>${num(parts.reduce((a, p) => a + p.value, 0))}</span></div>
    <ul>${parts.map(p => `<li><i style="background:${p.color}"></i>${esc(p.label)}<b>${num(p.value)}</b></li>`).join("")}</ul></div>`;
}

/** Porcentaje con barra (adopción de funciones). */
const meter = (label, n, of) => { const p = of ? Math.round((100 * n) / of) : 0; return `<li><span>${esc(label)}</span><span class="ad-meter"><i style="width:${p}%"></i></span><b>${p}%</b><small>${num(n)}</small></li>`; };

const flags = r => [[r.notifOn, "🔔", "Avisos activados"], [r.geo, "📍", "Ubicación activada"], [r.bristol, "🧻", "Escala de Bristol"], [!r.shareMap, "🔒", "Mapa privado"], [!r.termsOk, "📄", "Aún no ha aceptado las condiciones"], [r.suspended, "🚫", "Cuenta suspendida"]]
  .filter(f => f[0]).map(f => `<span title="${f[2]}">${f[1]}</span>`).join("");
const avatar = (name, color, size = "") => `<span class="ad-av ${size}" style="background:${esc(color || "var(--brand)")}">${esc(initial(name))}</span>`;
const chip = (t, cls = "") => `<span class="ad-chip ${cls}">${esc(t)}</span>`;
const deviceLabel = r => ({ both: "Nativa + web", native: "App nativa", web: "Web / PWA", none: "Sin avisos" }[r.device.kind]) + (r.device.platform ? ` · ${r.device.platform}` : "");

/* ============================================================ */
export function openAdminDashboard(ctx) {
  if (document.getElementById("adminDash")) return;                // ya abierto
  // hoja de estilos bajo demanda
  if (!document.getElementById("adminCss")) {
    const l = document.createElement("link"); l.id = "adminCss"; l.rel = "stylesheet"; l.href = "admin.css"; document.head.appendChild(l);
  }
  const root = document.createElement("div");
  root.id = "adminDash"; root.className = "ad"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Panel de administración");
  document.body.appendChild(root); document.body.classList.add("ad-open");

  let data = null, S = null, view = "overview", sel = null, rfilter = "open", loading = true, failed = null;
  const U = { q: "", filter: "all", sort: "recent", dir: -1 };
  const G = { q: "", sort: "year", dir: -1 };

  const nameOf = id => S?.rows.find(r => r.id === id)?.name || (id || "?").slice(0, 6);
  const close = () => { document.removeEventListener("keydown", onKey); root.remove(); document.body.classList.remove("ad-open"); ctx.onClose?.(); };
  const onKey = e => { if (e.key === "Escape") { if (sel) { sel = null; paint(); } else close(); } };
  document.addEventListener("keydown", onKey);

  async function load() {
    loading = true; failed = null; paint();
    try { data = await ctx.load(); S = computeStats(data, Date.now()); }
    catch (e) { console.error("admin:", e); failed = e; }
    loading = false; paint();
  }

  /* ---------- vistas ---------- */
  function vOverview() {
    const u = S.users, c = S.cacas, so = S.social, a = S.adoption;
    const retention = u.retention.base ? `${u.retention.pct}%` : "—";
    return `
    <div class="ad-grid ad-grid--kpi">
      ${kpi("Usuarios", num(u.n), `${num(u.new7)} nuevos esta semana`)}
      ${kpi("Activos hoy", num(u.today), `${S.pct(u.today, u.n)}% de la base`)}
      ${kpi("Activos 7 días", num(u.d7), `${S.pct(u.d7, u.n)}% de la base`)}
      ${kpi("Activos 30 días", num(u.d30), `${S.pct(u.d30, u.n)}% de la base`)}
      ${kpi("Retención 7 d", retention, `${num(u.retention.kept)} de ${num(u.retention.base)} con ≥ 7 días`, u.retention.pct >= 50 ? "good" : "")}
      ${kpi("Cacas hoy", num(c.today), "según el feed")}
      ${kpi("Cacas este mes", num(c.month))}
      ${kpi(`Cacas ${S.year}`, num(c.year), `${num(c.total)} en total`)}
      ${kpi("Amistades", num(so.friendships), `${so.avgFriends} por persona · ${num(so.pending)} pendientes`)}
      ${kpi("Grupos", num(so.groups), `${so.avgGroupSize} miembros de media`)}
      ${kpi("Denuncias abiertas", num(S.reports.open), `${num(S.reports.total)} en total`, S.reports.open ? "bad" : "good")}
      ${kpi("Cola de avisos", QUEUE_LABEL[S.queue.status], S.queue.status === "unknown" ? "no se pudo leer" : `${num(S.queue.pending)} en espera${S.queue.waitMin ? ` · ${S.queue.waitMin >= 120 ? Math.round(S.queue.waitMin / 60) + " h" : S.queue.waitMin + " min"} la más antigua` : ""}`, QUEUE_TONE[S.queue.status])}
      ${S.users.suspended ? kpi("Suspendidas", num(S.users.suspended), "cuentas", "warn") : ""}
      ${kpi("Dormidos", num(u.dormant), "14+ días sin sumar", u.dormant ? "warn" : "")}
    </div>
    <div class="ad-grid ad-grid--cards">
      ${card("Actividad diaria · 30 días", bars(S.daily.map(d => d.adds), S.daily.map(d => new Date(d.start).getDate()), { every: 3, hl: S.daily.length - 1 }), "ad-span2",
        `${num(S.daily.reduce((x, d) => x + d.adds, 0))} cacas · ${num(S.daily.reduce((x, d) => x + d.reactions, 0))} reacciones · ${num(S.daily.reduce((x, d) => x + d.syncs, 0))} conexiones`)}
      ${card("Cacas por mes", bars(c.months.map(m => m.n), c.months.map(m => MONTHS[m.m]), { hl: c.months.length - 1 }), "", "últimos 12 meses")}
      ${card("Altas por semana", bars(u.weekly.map(w => w.n), u.weekly.map(w => { const d = new Date(w.start); return `${d.getDate()}/${d.getMonth() + 1}`; }), { every: 2, hl: u.weekly.length - 1 }), "", "últimas 12 semanas")}
      ${card("¿A qué hora?", bars(c.hours, c.hours.map((_, h) => h), { every: 3 }), "", "todas las cacas, por hora")}
      ${card("¿Qué día?", bars(c.weekdays, WEEKDAYS), "")}
      ${card("Dispositivos", donut([
        { label: "App nativa", value: S.devices.native, color: "var(--brand)" }, { label: "Web / PWA", value: S.devices.web, color: "var(--gold)" },
        { label: "Nativa + web", value: S.devices.both, color: "var(--mint)" }, { label: "Sin avisos", value: S.devices.none, color: "var(--ink-faint)" }]), "", "por token de notificaciones")}
      ${card("Adopción de funciones", `<ul class="ad-meters">${meter("Avisos activados", a.notif, u.n)}${meter("Ubicación (pregunta o siempre)", a.geo, u.n)}${meter("Mapa compartido", a.shareMap, u.n)}${meter("Escala de Bristol", a.bristol, u.n)}${meter("PWA instalada", a.installed, u.n)}${meter("Condiciones aceptadas", a.terms, u.n)}${meter("Con amigos", u.n - so.noFriends, u.n)}${meter("En algún grupo", u.n - so.noGroup, u.n)}</ul>`, "")}
      ${card("Top del año", hbars(S.tops.year.map(r => ({ label: r.name, value: r.year, user: r.id }))), "")}
      ${card("Rachas actuales", hbars(S.tops.streak.map(r => ({ label: r.name, value: r.streak, sub: `récord ${r.best}`, user: r.id })), { unit: " d" }), "")}
      ${card("Grupos más activos", hbars(S.tops.groups.map(g => ({ label: g.name, value: g.year, sub: `${g.size} miembros` }))), "")}
      ${card("Tamaño de los grupos", bars(so.sizes.map(s => s.n), so.sizes.map(s => s.label)), "", `${num(so.groups)} grupos`)}
    </div>`;
  }

  const FILTERS = [["all", "Todos"], ["active7", "Activos 7 d"], ["dormant", "Dormidos"], ["never", "Sin cacas"], ["notif", "Con avisos"], ["native", "App nativa"], ["web", "Web"], ["nofriends", "Sin amigos"], ["suspended", "Suspendidos"]];
  const COLS = [["name", "Usuario"], ["joined", "Alta"], ["recent", "Última caca"], ["year", "Año"], ["total", "Total"], ["streak", "Racha"], ["friends", "Amigos"], ["groups", "Grupos"]];
  function vUsers() {
    const list = filterUsers(S.rows, U);
    const arrow = k => U.sort === k ? (U.dir > 0 ? " ▲" : " ▼") : "";
    return `
    <div class="ad-toolbar">
      <input class="ad-search" id="adUq" type="search" placeholder="Buscar por nombre o email…" value="${esc(U.q)}" autocomplete="off" />
      <div class="ad-pills">${FILTERS.map(([k, l]) => `<button data-ufilter="${k}" class="${U.filter === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select id="adUsort" class="ad-select">${COLS.map(([k, l]) => `<option value="${k}" ${U.sort === k ? "selected" : ""}>Ordenar: ${l}</option>`).join("")}</select>
      <button class="ad-btn" data-act="udir">${U.dir > 0 ? "▲ Asc." : "▼ Desc."}</button>
      <button class="ad-btn" data-act="csv">⬇ CSV</button>
    </div>
    <p class="ad-count">${num(list.length)} de ${num(S.rows.length)} usuarios</p>
    <div class="ad-tablewrap"><table class="ad-table"><thead><tr>${COLS.map(([k, l]) => `<th data-usort="${k}" class="${k === "name" ? "" : "n"}">${l}${arrow(k)}</th>`).join("")}<th>Dispositivo</th><th>Funciones</th></tr></thead><tbody>
      ${list.map(r => `<tr data-user="${esc(r.id)}">
        <td><div class="ad-u">${avatar(r.name, r.color)}<div><b>${esc(r.name)}</b><small>${esc(r.email || "—")}</small></div></div></td>
        <td class="n">${fdate(r.created)}</td><td class="n" title="${esc(fdt(r.last))}">${ago(r.last)}</td>
        <td class="n">${num(r.year)}</td><td class="n">${num(r.total)}</td><td class="n">${r.streak ? `${r.streak} 🔥` : "—"}</td>
        <td class="n">${r.friends.length}</td><td class="n">${r.groups.length}</td><td>${esc(deviceLabel(r))}</td>
        <td class="ad-flags">${flags(r)}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="ad-ucards">${list.map(r => `<button class="ad-ucard" data-user="${esc(r.id)}">
      ${avatar(r.name, r.color, "lg")}<div class="ad-ucard__t"><b>${esc(r.name)}</b><small>${esc(r.email || "—")}</small>
      <span>${num(r.year)} este año · ${num(r.total)} total${r.streak ? ` · ${r.streak} 🔥` : ""}</span>
      <span>Última: ${ago(r.last)} · alta ${fdate(r.created)}</span></div>
      <span class="ad-flags">${flags(r)}</span></button>`).join("")}</div>
    ${list.length ? "" : '<p class="ad-empty">Ningún usuario con ese filtro.</p>'}`;
  }

  function vGroups() {
    const q = G.q.trim().toLowerCase();
    const val = { name: g => g.name.toLowerCase(), size: g => g.size, year: g => g.year, lastActive: g => g.lastActive, active: g => g.activeMembers }[G.sort] || (g => g.year);
    const list = S.groupRows.filter(g => !q || g.name.toLowerCase().includes(q)).sort((a, b) => ((val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0)) * G.dir);
    return `
    <div class="ad-toolbar">
      <input class="ad-search" id="adGq" type="search" placeholder="Buscar grupo…" value="${esc(G.q)}" autocomplete="off" />
      <select id="adGsort" class="ad-select">${[["year", "Cacas este año"], ["size", "Miembros"], ["active", "Activos 7 d"], ["lastActive", "Última actividad"], ["name", "Nombre"]].map(([k, l]) => `<option value="${k}" ${G.sort === k ? "selected" : ""}>Ordenar: ${l}</option>`).join("")}</select>
      <button class="ad-btn" data-act="gdir">${G.dir > 0 ? "▲ Asc." : "▼ Desc."}</button>
    </div>
    <p class="ad-count">${num(list.length)} grupos</p>
    <div class="ad-grid ad-grid--groups">${list.map(g => `<section class="ad-card">
      <header><h3>🏆 ${esc(g.name)}</h3><span>${g.size} miembros · código ${esc(g.code || "—")}</span></header>
      <div class="ad-kv"><span>Cacas ${S.year}</span><b>${num(g.year)}</b></div>
      <div class="ad-kv"><span>Cacas totales</span><b>${num(g.total)}</b></div>
      <div class="ad-kv"><span>Activos esta semana</span><b>${g.activeMembers} de ${g.size}</b></div>
      <div class="ad-kv"><span>Última actividad</span><b>${ago(g.lastActive)}</b></div>
      <div class="ad-kv"><span>Creado por</span><b>${esc(nameOf(g.createdBy))}</b></div>
      <div class="ad-chips">${g.members.map(m => `<button class="ad-chip is-link" data-user="${esc(m)}">${esc(nameOf(m))}</button>`).join("")}</div></section>`).join("")}</div>
    ${list.length ? "" : '<p class="ad-empty">Sin grupos.</p>'}`;
  }

  const REASON = { spam: "Spam o publicidad", acoso: "Acoso o insultos", ofensivo: "Contenido ofensivo", suplantacion: "Suplantación", otro: "Otro motivo" };
  const KIND = { user: "👤 Usuario", message: "💬 Mensaje", group: "🏆 Grupo" };
  function vReports() {
    const all = data.reports;
    if (all === null) return '<p class="ad-empty">No se pudieron cargar las denuncias.</p>';
    const count = s => all.filter(r => s === "all" || r.status === s).length;
    const list = all.filter(r => rfilter === "all" || r.status === rfilter);
    return `
    <div class="ad-pills ad-pills--solo">${[["open", "Abiertas"], ["resolved", "Resueltas"], ["dismissed", "Descartadas"], ["all", "Todas"]].map(([k, l]) => `<button data-rfilter="${k}" class="${rfilter === k ? "on" : ""}">${l} <b>${count(k)}</b></button>`).join("")}</div>
    <div class="ad-grid ad-grid--groups">${list.map(r => `<section class="ad-card ad-report ${r.status}" data-rid="${esc(r.id)}">
      <header><h3>${esc(KIND[r.kind] || r.kind)} · ${esc(REASON[r.reason] || r.reason)}</h3><span>${fdt(tsMs(r.ts))}${r.status !== "open" ? ` · ${r.status === "resolved" ? "resuelta" : "descartada"}` : ""}</span></header>
      <div class="ad-kv"><span>Denunciante</span><b>${r.reporterUid ? `<button class="ad-link" data-user="${esc(r.reporterUid)}">${esc(nameOf(r.reporterUid))}</button>` : "—"}</b></div>
      <div class="ad-kv"><span>Denunciado</span><b>${r.targetUid ? `<button class="ad-link" data-user="${esc(r.targetUid)}">${esc(nameOf(r.targetUid))}</button>` : "—"}</b></div>
      ${r.text ? `<blockquote>«${esc(r.text)}»</blockquote>` : ""}${r.note ? `<p class="ad-note">${esc(r.note)}</p>` : ""}
      ${r.status === "open" ? `<div class="ad-actions"><button class="ad-btn" data-rstatus="dismissed">Descartar</button><button class="ad-btn ad-btn--solid" data-rstatus="resolved">Resuelta</button></div>`
        : `<div class="ad-actions"><button class="ad-btn" data-rstatus="open">Reabrir</button></div>`}</section>`).join("")}</div>
    ${list.length ? "" : '<p class="ad-empty">No hay denuncias en esta lista. 🎉</p>'}`;
  }

  function queueCard() {
    const q = S.queue;
    if (q.status === "unknown") return '<p class="ad-note">No se pudo leer la cola (¿reglas sin actualizar o sin conexión?).</p>';
    const hint = q.status === "down" ? "El emisor de avisos parece PARADO. Si es la Raspberry: ¿está encendida? En ella, <code>systemctl status cagometro-push</code>."
      : q.status === "late" ? "Hay avisos esperando más de lo normal: el emisor va lento o se ha parado hace poco." : "Los avisos se están entregando.";
    return `<div class="ad-kv"><span>Estado</span><b class="ad-state ${q.status}">${QUEUE_LABEL[q.status]}</b></div>
      <div class="ad-kv"><span>En espera</span><b>${num(q.pending)}${q.waitMin ? ` <small>(el más antiguo, hace ${q.waitMin >= 120 ? Math.round(q.waitMin / 60) + " h" : q.waitMin + " min"})</small>` : ""}</b></div>
      <div class="ad-kv"><span>Entregados (últimas 24 h)</span><b>${num(q.sent24h)}</b></div>
      <div class="ad-kv"><span>Último entregado</span><b>${q.lastSentCreated ? fdt(q.lastSentCreated) : "—"} <small>(hora de creación)</small></b></div>
      ${Object.keys(q.byType).length ? `<div class="ad-chips">${Object.entries(q.byType).map(([k, n]) => chip(`${k} · ${n}`)).join("")}</div>` : ""}
      <p class="ad-note">${hint} Se leen los últimos 300 avisos.</p>`;
  }

  function vSystem() {
    const cfg = data.config || {};
    return `<div class="ad-grid ad-grid--cards">
      ${card("Modo mantenimiento", `<label class="ad-switch"><input type="checkbox" id="adMaint" ${cfg.maintenance ? "checked" : ""}/><span></span>Muestra el aviso y desactiva el +1 para todos</label>
        <p class="ad-note">Mensaje: «${esc(cfg.message || "el predeterminado")}»</p>`)}
      ${card("Cola de avisos (notificaciones)", queueCard())}
      ${card("Esta carga", `<div class="ad-kv"><span>Hora</span><b>${fdt(data.loadedAt)}</b></div>
        <div class="ad-kv"><span>Usuarios leídos</span><b>${num(data.users.length)}</b></div><div class="ad-kv"><span>Grupos</span><b>${num(data.groups.length)}</b></div>
        <div class="ad-kv"><span>Amistades</span><b>${num(data.friendships.length)}</b></div><div class="ad-kv"><span>Eventos del feed (60 d)</span><b>${num(data.activity.length)}</b></div>
        <div class="ad-kv"><span>Documentos privados (dispositivos)</span><b>${num(Object.keys(data.privateById).length)}</b></div>
        <p class="ad-note">Cada vez que abres o actualizas el panel se leen todos estos documentos. Con muchos usuarios habrá que agregarlos en el servidor.</p>`)}
      ${card("Versión y enlaces", `<div class="ad-kv"><span>Versión de la PWA</span><b>${esc(ctx.version || "—")}</b></div>
        <div class="ad-links"><a href="https://console.firebase.google.com/project/cagometro-app/firestore" target="_blank" rel="noopener">Firestore ↗</a>
        <a href="https://console.firebase.google.com/project/cagometro-app/authentication/users" target="_blank" rel="noopener">Usuarios (Auth) ↗</a>
        <a href="https://console.firebase.google.com/project/cagometro-app/usage" target="_blank" rel="noopener">Uso y cuotas ↗</a></div>
        ${ctx.legacy ? '<button class="ad-btn" data-act="legacy">Abrir el panel anterior</button>' : ""}`)}
      ${card("Qué NO ve este panel (a propósito)", `<p class="ad-note">Los mensajes de los chats no son legibles para el administrador. Las denuncias de un mensaje llevan copiado su texto. Las cacas se agregan desde los contadores de cada usuario: no se leen una a una.</p>`)}
    </div>`;
  }

  /* ---------- detalle de un usuario ---------- */
  function drawer(id) {
    const r = S.rows.find(x => x.id === id); if (!r) return "";
    const u = r.u, byMonth = Object.entries(u.countsByMonth || {}).sort();
    const off = Object.keys(CAT_NAME).filter(c => (u.notifPrefs || {})[c] === false).map(c => CAT_NAME[c]);
    const about = (data.reports || []).filter(x => x.targetUid === id), by = (data.reports || []).filter(x => x.reporterUid === id);
    const names = ids => ids.length ? ids.map(i => `<button class="ad-chip is-link" data-user="${esc(i)}">${esc(nameOf(i))}</button>`).join("") : '<span class="ad-muted">—</span>';
    const kv = (k, v) => `<div class="ad-kv"><span>${k}</span><b>${v}</b></div>`;
    const yes = v => v ? "Sí" : "No";
    const hours = Array.from({ length: 24 }, (_, h) => u.byHour?.[h] || 0), wd = Array.from({ length: 7 }, (_, d) => u.byWeekday?.[d] || 0);
    return `<aside class="ad-drawer" role="dialog" aria-label="Usuario ${esc(r.name)}">
      <header class="ad-drawer__head"><button class="ad-x" data-act="closeuser" aria-label="Cerrar">✕</button>
        ${avatar(r.name, r.color, "xl")}<div><h2>${esc(r.name)}${r.suspended ? ' <span class="ad-tag ad-tag--bad">SUSPENDIDA</span>' : ""}</h2><p>${esc(r.email || "sin email")}</p><code data-copy="${esc(r.id)}" title="Copiar">${esc(r.id)}</code></div></header>
      <div class="ad-drawer__body">
        <div class="ad-grid ad-grid--kpi ad-grid--tight">${kpi(`Cacas ${S.year}`, num(r.year))}${kpi("Total", num(r.total))}${kpi("Racha", `${r.streak} 🔥`, `récord ${r.best}`)}${kpi("Amigos / grupos", `${r.friends.length} / ${r.groups.length}`)}</div>
        ${card("Cuenta", kv("Alta", fdate(r.created)) + kv("Primera caca", fdate(r.first)) + kv("Última caca", `${fdt(r.last)} <small>(${ago(r.last)})</small>`) + kv("Zona horaria", esc(u.tz || "—")) +
          kv("Condiciones aceptadas", r.termsOk ? `v${u.termsVersion} · ${fdate(tsMs(u.termsAcceptedAt))}` : "No"))}
        ${card("Ajustes", kv("Avisos", yes(r.notifOn) + (off.length ? ` <small>(silenciados: ${esc(off.join(", "))})</small>` : "")) + kv("Ubicación", esc(u.locationMode || "never")) +
          kv("Mapa compartido", yes(r.shareMap)) + kv("Escala de Bristol", yes(r.bristol)))}
        ${card("Dispositivo", kv("Tipo", esc(deviceLabel(r))) + kv("Navegador", esc(u.browser || "—")) + kv("PWA instalada", yes(u.standalone)) + kv("Permiso de avisos", esc(u.notifPerm || "—")) +
          kv("Aviso «no te pierdas nada»", u.notifPromptSeenCount ? `visto ${u.notifPromptSeenCount}× · ${esc(u.notifPromptAction || "sin acción")}` : "no visto"))}
        ${card("Cacas por mes", byMonth.length ? bars(byMonth.slice(-12).map(([, n]) => n), byMonth.slice(-12).map(([k]) => MONTHS[+k.split("_")[1]]), { h: 100 }) : '<p class="ad-empty">Sin datos</p>')}
        <div class="ad-grid ad-grid--two">${card("Por hora", bars(hours, hours.map((_, h) => h), { h: 90, every: 6 }))}${card("Por día", bars(wd, WEEKDAYS, { h: 90 }))}</div>
        ${card(`Amigos (${r.friends.length})`, `<div class="ad-chips">${names(r.friends)}</div>`)}
        ${card(`Grupos (${r.groups.length})`, `<div class="ad-chips">${r.groups.length ? r.groups.map(g => `<span class="ad-chip">${esc(S.groupRows.find(x => x.id === g)?.name || g)}</span>`).join("") : '<span class="ad-muted">—</span>'}</div>`)}
        ${card("Moderación", kv("Denuncias contra esta persona", `${about.length}${about.filter(x => x.status === "open").length ? ` <small>(${about.filter(x => x.status === "open").length} abiertas)</small>` : ""}`) + kv("Denuncias hechas por ella", String(by.length)))}
        ${r.suspended ? card("Suspensión", kv("Desde", fdt(r.suspendedAt)) + kv("Motivo", esc(r.suspendedReason || "—")) + '<p class="ad-note">No puede escribir, reaccionar, invitar ni crear grupos. Sigue viendo lo suyo y puede borrar su cuenta.</p>', "ad-card--warn") : ""}
        <div class="ad-actions ad-actions--end">${r.id === ctx.myUid ? "" : r.suspended ? `<button class="ad-btn" data-unsuspend="${esc(r.id)}">Reactivar cuenta</button>` : `<button class="ad-btn ad-btn--danger" data-suspend="${esc(r.id)}" data-name="${esc(r.name)}">Suspender cuenta…</button>`}${r.id === ctx.myUid ? '<span class="ad-muted">Eres tú</span>' : `<button class="ad-btn ad-btn--danger" data-wipe="${esc(r.id)}" data-name="${esc(r.name)}">Vaciar sus datos…</button>`}</div>
      </div></aside>`;
  }

  /* ---------- pintar ---------- */
  const TITLES = Object.fromEntries(NAV.map(([k, , l]) => [k, l]));
  function paint() {
    const keepScroll = root.querySelector(".ad-view")?.scrollTop || 0;
    const body = loading && !S ? '<div class="ad-loading"><span>💩</span><p>Cargando datos…</p></div>'
      : failed ? `<div class="ad-loading"><p>No se pudieron cargar los datos.</p><small>${esc(failed.code || failed.message || failed)}</small><button class="ad-btn" data-act="refresh">Reintentar</button></div>`
      : view === "overview" ? vOverview() : view === "users" ? vUsers() : view === "groups" ? vGroups() : view === "reports" ? vReports() : vSystem();
    const badge = S?.reports.open ? `<b class="ad-badge">${S.reports.open}</b>` : "";
    root.innerHTML = `
      <aside class="ad-nav"><div class="ad-brand">🛠️ <span>Administración</span></div>
        <nav>${NAV.map(([k, ic, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}"><span>${ic}</span>${l}${k === "reports" ? badge : ""}</button>`).join("")}</nav>
        <div class="ad-nav__foot"><button data-act="refresh">↻ Actualizar</button><button data-act="close">✕ Cerrar</button></div></aside>
      <main class="ad-main"><header class="ad-top"><h1>${TITLES[view]}</h1>
        <span class="ad-sub">${loading ? "actualizando…" : data ? `actualizado ${ago(data.loadedAt)}` : ""}</span>
        <button class="ad-iconbtn" data-act="refresh" aria-label="Actualizar" ${loading ? "disabled" : ""}>↻</button>
        <button class="ad-iconbtn ad-iconbtn--close" data-act="close" aria-label="Cerrar el panel">✕</button></header>
        <div class="ad-view">${body}</div></main>
      <nav class="ad-tabbar">${NAV.map(([k, ic, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}"><span>${ic}${k === "reports" ? badge : ""}</span>${l}</button>`).join("")}</nav>
      ${sel && S ? `<div class="ad-scrim" data-act="closeuser"></div>${drawer(sel)}` : ""}`;
    const v = root.querySelector(".ad-view"); if (v) v.scrollTop = keepScroll;
  }

  // Refleja la suspensión en los datos que ya tenemos (sin volver a leerlo todo) y recalcula.
  function markSuspended(id, on, reason) {
    const u = data.users.find(x => x.id === id); if (!u) return;
    u.suspended = on; u.suspendedReason = reason; u.suspendedAt = on ? Date.now() : 0;
    S = computeStats(data, Date.now()); paint();
  }

  /* ---------- eventos (delegación) ---------- */
  root.addEventListener("click", async e => {
    const t = e.target;
    const go = t.closest("[data-view]"); if (go) { view = go.dataset.view; sel = null; paint(); return; }
    const user = t.closest("[data-user]"); if (user && !t.closest("[data-act]")) { sel = user.dataset.user; paint(); return; }
    const act = t.closest("[data-act]")?.dataset.act;
    if (act === "close") return close();
    if (act === "closeuser") { sel = null; paint(); return; }
    if (act === "refresh") { load(); return; }
    if (act === "udir") { U.dir = -U.dir; paint(); return; }
    if (act === "gdir") { G.dir = -G.dir; paint(); return; }
    if (act === "legacy") { close(); ctx.legacy?.(); return; }
    if (act === "csv") {
      const blob = new Blob(["﻿" + usersCsv(filterUsers(S.rows, U))], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `cagometro-usuarios-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href); return;
    }
    const uf = t.closest("[data-ufilter]"); if (uf) { U.filter = uf.dataset.ufilter; paint(); return; }
    const us = t.closest("[data-usort]"); if (us) { const k = us.dataset.usort; if (U.sort === k) U.dir = -U.dir; else { U.sort = k; U.dir = k === "name" ? 1 : -1; } paint(); return; }
    const rf = t.closest("[data-rfilter]"); if (rf) { rfilter = rf.dataset.rfilter; paint(); return; }
    const copy = t.closest("[data-copy]"); if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); ctx.toast?.("ID copiado"); } catch { /* sin portapapeles */ } return; }
    const rs = t.closest("[data-rstatus]");
    if (rs) {
      const rid = rs.closest("[data-rid]")?.dataset.rid; if (!rid) return;
      rs.disabled = true;
      try { await ctx.actions.setReportStatus(rid, rs.dataset.rstatus); const r = data.reports.find(x => x.id === rid); if (r) r.status = rs.dataset.rstatus; S = computeStats(data, Date.now()); paint(); }
      catch (err) { console.error(err); rs.disabled = false; ctx.toast?.("No se pudo guardar"); }
      return;
    }
    const susp = t.closest("[data-suspend]");
    if (susp) {
      const id = susp.dataset.suspend, name = susp.dataset.name || "esta persona";
      const reason = prompt(`Suspender la cuenta de ${name}.\n\nMotivo (solo lo ves tú):`, "");
      if (reason === null) return;                                        // canceló
      susp.disabled = true;
      try { await ctx.actions.setSuspended(id, true, reason.trim()); markSuspended(id, true, reason.trim()); ctx.toast?.("Cuenta suspendida"); }
      catch (err) { console.error(err); susp.disabled = false; ctx.toast?.("No se pudo suspender"); }
      return;
    }
    const unsusp = t.closest("[data-unsuspend]");
    if (unsusp) {
      unsusp.disabled = true;
      try { await ctx.actions.setSuspended(unsusp.dataset.unsuspend, false, ""); markSuspended(unsusp.dataset.unsuspend, false, ""); ctx.toast?.("Cuenta reactivada"); }
      catch (err) { console.error(err); unsusp.disabled = false; ctx.toast?.("No se pudo reactivar"); }
      return;
    }
    const wipe = t.closest("[data-wipe]");
    if (wipe) {
      const name = wipe.dataset.name || "esta persona";
      if (!confirm(`¿Vaciar TODOS los datos de ${name}? Se borran sus cacas, amistades y su sitio en los grupos (no su cuenta). No se puede deshacer.`)) return;
      wipe.disabled = true; wipe.textContent = "Vaciando…";
      try { await ctx.actions.wipeUser(wipe.dataset.wipe); ctx.toast?.("Datos vaciados"); sel = null; await load(); }
      catch (err) { console.error(err); ctx.toast?.("No se pudo vaciar"); wipe.disabled = false; wipe.textContent = "Vaciar sus datos…"; }
    }
  });
  root.addEventListener("input", e => {
    if (e.target.id === "adUq") { U.q = e.target.value; const pos = e.target.selectionStart; paint(); const el = root.querySelector("#adUq"); el?.focus(); el?.setSelectionRange(pos, pos); }
    if (e.target.id === "adGq") { G.q = e.target.value; const pos = e.target.selectionStart; paint(); const el = root.querySelector("#adGq"); el?.focus(); el?.setSelectionRange(pos, pos); }
  });
  root.addEventListener("change", async e => {
    if (e.target.id === "adUsort") { U.sort = e.target.value; U.dir = U.sort === "name" ? 1 : -1; paint(); }
    if (e.target.id === "adGsort") { G.sort = e.target.value; G.dir = G.sort === "name" ? 1 : -1; paint(); }
    if (e.target.id === "adMaint") {
      const on = e.target.checked;
      try { await ctx.actions.setMaintenance(on); data.config = { ...(data.config || {}), maintenance: on }; ctx.toast?.(on ? "Modo mantenimiento ACTIVADO" : "Modo mantenimiento desactivado"); }
      catch (err) { console.error(err); e.target.checked = !on; ctx.toast?.("No se pudo cambiar"); }
    }
  });

  paint(); load();
  return { close };
}
