# El Cagómetro · Notificaciones

Documento de referencia de todas las notificaciones del sistema: qué las dispara,
quién las recibe, por qué canal y cómo se evita el spam.

_Actualizado: 2026-06-25_

---

## Canales

| Canal | Cuándo | Necesita | Estado |
|---|---|---|---|
| **Campanita 🔔 (in-app)** | App abierta | Nada (listeners en tiempo real) | ✅ |
| **Banner local del sistema** | App abierta / en primer plano | Permiso del navegador | ✅ |
| **Push (FCM)** | App cerrada o en segundo plano | Permiso + token + **emisor en la Pi encendido** | ✅ (requiere Pi) |

- **FCM (el envío)** es gratis e ilimitado. El cuello de botella es **Firestore** (lecturas/escrituras), no las notificaciones.
- El **push real con app cerrada** depende de que la **Raspberry esté encendida** (corre `cagometro-push.service`).

---

## Tipos de evento

Campo `type` en la colección `pushQueue` (lo lee la Pi para decidir cómo entregar).

| type | Disparador | Lo genera | Lo recibe | Canales | Anti-spam |
|---|---|---|---|---|---|
| `reaction` | Alguien reacciona a tu caca | quien reacciona | dueño de la caca | campanita + banner + push | **Agrupadas** por la Pi (ventana 20 s): varias → "N reacciones nuevas" |
| `friend_request` | Te envían solicitud de amistad | quien la envía | destinatario | campanita + banner + push | inmediato |
| `friend_accepted` | Aceptan tu solicitud o tu invitación por enlace | quien acepta | quien la pidió/invitó | push | inmediato |
| `milestone` | Un amigo cruza un hito (10/25/50/75 y luego **cada 50 sin tope**: 100,150,200…550,600…) | quien cruza el hito | sus amigos | push | solo en hitos exactos |
| `overtake` | Te adelantan en el ranking de un **grupo** (rompen empate en tu nº) | quien adelanta | el adelantado | push | cliente ignora < 3 cacas · la Pi limita a **1/persona/día** |
| `sync` | "Conexión de tuberías": un amigo cagó hace **< 5 min** cuando registras la tuya | el que registra después | el otro implicado | overlay + evento en feed + push | no repite con la misma caca del amigo |
| `reminder` | **Recordatorio inteligente** (proactivo): no has cagado hoy y tu media ≥ 1/día | la **Pi** (cron) | el propio usuario | push | 1/día · franja local 10–22 · hora personalizada |

---

## Detalle por evento

### reaction — reacción a tu caca
- **Disparo:** `applyReaction()` al añadir (no quitar) una reacción.
- **In-app:** el listener del feed (`detectReactionNotifs`) detecta reacciones nuevas en TUS eventos → campanita + banner.
- **Push:** se encola a `pushQueue`; la Pi **agrupa** las que van al mismo destinatario en 20 s.
- **Nombre:** se resuelve el del que reacciona (en tu propia caca puedes ver siempre quién).

### friend_request — solicitud de amistad
- **Disparo:** `sendFriendRequest()`.
- **In-app:** `watchFriendships` (tiempo real) → aparece en la campanita (sección Solicitudes, con Aceptar/✕) + banner.

### friend_accepted — amistad aceptada
- **Disparo:** `acceptFriend()` y `addFriendDirect()` (enlace de invitación).
- Avisa **a quien pidió/invitó** que ya sois amigos.

### milestone — hito de un amigo
- **Disparo:** en `watchMe`, al detectar que tu contador cruza un hito → `notifyFriendsMilestone()` avisa a **todos tus amigos**.
- **Hitos:** `isMilestone(n)` = 10/25/50/75 o (n≥100 y múltiplo de 50). Sin tope superior.

### overtake — adelantamiento en ranking de grupo
- **Disparo:** al subir tu contador (`checkGroupOvertakes`), en cada grupo común avisas a quien tenías empatado (le quitas el puesto).
- **Anti-ruido:** nada por debajo de 3 cacas; la Pi manda **máx. 1 por persona y día**.
- **Ámbito:** solo grupos (no la clasificación global de amigos).

### sync — conexión de tuberías 🔗
- **Disparo:** `checkSyncPoop()` tras registrar caca; busca un amigo con caca en los últimos 5 min.
- **Overlay** de celebración + confeti al que registra después.
- **Feed:** crea un evento `kind:"sync"` reaccionable. **Privacidad:** solo lo ven los dos implicados o quien sea **amigo de ambos** (filtro al mostrar, `canSeeSync`).
- **Push:** avisa al otro implicado.

### reminder — recordatorio inteligente ⏰ (proactivo, lo inicia la Pi)
- **Servicio:** `cagometro-reminders.service` en la Pi (`reminders.js`), ticker cada 30 min.
- **A quién:** usuarios con **media ≥ 1/día** (últimos 14 días) que **no han cagado hoy** (en su tz), con notificaciones activadas y token.
- **Cuándo:** a una **hora personalizada** = su hora típica de cagar + ~3 h + jitter determinista (0–1.5 h por uid+fecha), siempre dentro de la franja local **10:00–22:00**. Máx **1/día** (`lastReminderYmd`).
- **Datos denormalizados** (en `users/{uid}`, los escribe el cliente): `tz`, `lastCacaTs`, `lastReminderYmd`.
- **Sin coste de reglas:** la Pi usa Admin SDK; el cliente escribe `tz`/`lastCacaTs` en su propio doc (isOwner).
- **Pruebas:** `DRY_RUN=1 node reminders.js` (no envía, solo log).

---

## Arquitectura

```
Acción en la app
   ├── in-app (tiempo real, sin servidor)
   │     watchFriendships  → solicitudes
   │     watchActivity     → reacciones a mis eventos (detectReactionNotifs)
   │     Notifications API → banner local (si la app está en marcha)
   │
   └── push (app cerrada)
         cliente escribe en  pushQueue { fromUid, toUid, type, title, body }
                 │
         Raspberry (cagometro-push.service, firebase-admin)
                 │   - respeta users/{toUid}.notifications (si false, no envía)
                 │   - agrupa 'reaction' (20 s) · dedup 'overtake' (1/día)
                 │   - lee tokens en users/{toUid}/private/push
                 ▼
         FCM  →  firebase-messaging-sw.js  →  banner del sistema

   └── proactivo (sin acción del usuario) — recordatorios
         Raspberry (cagometro-reminders.service)  →  FCM directo (no usa pushQueue)
```

- **Dos servicios en la Pi** (`~/projects/cagometro-push/`, node nvm v18.20.8, systemd, Restart=always):
  - `cagometro-push.service` (`index.js`) — entrega lo de `pushQueue`.
  - `cagometro-reminders.service` (`reminders.js`) — recordatorios inteligentes (envía a FCM directamente, no pasa por la cola).
- **Tokens:** se guardan en `users/{uid}/private/push.tokens` (privado). El interruptor de Ajustes pide permiso y registra el token; al desactivar, borra el token.
- **Reglas:** `pushQueue` solo la crean los clientes (con su `fromUid`); solo la Pi (Admin SDK) la lee/borra.

---

## Ajustes del usuario
- **Ajustes → Notificaciones** (interruptor): pide permiso del navegador y registra el dispositivo. Al apagarlo, deja de recibir push (borra token) y la Pi también lo respeta vía `users/{uid}.notifications`.
- **iOS:** el push requiere la PWA **instalada** en pantalla de inicio (iOS 16.4+).

---

## Límites y futuro
- **Depende de la Pi** para el push con app cerrada. Si se apaga, las tareas quedan en `pushQueue` (ojo: FCM tiene TTL; pushes muy viejos pueden caducar).
- **Privacidad de `sync`:** filtrada al mostrar, no a nivel de datos (el cliente no puede calcular la audiencia mutua exacta).
- **Ideas pendientes:** notificación de "te uniste/te añadieron a un grupo", resúmenes semanales/Wrapped (cron en la Pi), push al reaccionar a eventos `sync`/`milestone`, recordatorio de "racha en peligro".
- **Icono del banner:** `firebase-messaging-sw.js` usa `icon.svg`; pendiente cambiarlo a la mascota (`icon-192.png`).
