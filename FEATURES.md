# Cagómetro · feature parity checklist (bot → app)

Goal: make sure the web app eventually covers everything the Telegram bot does
(or we consciously decide to drop it). Status legend:
✅ done in app · 🟡 planned (phase) · 🆕 to add · ❓ needs a decision · ⚙️ admin/ops · 💬 flavor (optional)

## 1. Core counting
| Bot | What it does | App |
|---|---|---|
| `/SumaCaca` | +1 to your counter | ✅ Phase A |
| `/quitacaca` | −1 (undo) | 🆕 add (easy) |
| `/latecaca HH:MM [dd/mm/yyyy]` | add a caca at a past time | 🆕 add (backdated log) |
| `/modificar` | set your count to a specific number | 🆕 add (correction) |
| `/adminlatecaca` | admin adds a late caca for a user | ⚙️ moderation (later) |

## 2. Stats & analytics
| Bot | What it does | App |
|---|---|---|
| `/Stats` | personal stats | 🟡 partial (A: hoy/semana/racha) → Phase D full |
| `/Graph [propio]` | annual chart of cacas over the year | 🟡 Phase D |
| `/Hours` | histogram of *what hours* you go + top-3 hours | 🟡 Phase D |
| (history, group histories) | underlying time-series per user/group | 🟡 Phase D |

## 3. Ranking / social
| Bot | What it does | App |
|---|---|---|
| `/Ranking` | everyone's counts | 🟡 per-group (C) + friends (B) leaderboards |
| friends | — (bot has no friends concept) | 🟡 Phase B (new) |
| groups | (Telegram groups today) | 🟡 Phase C |

## 4. Maps & location  ← whole subsystem
| Bot | What it does | App |
|---|---|---|
| send a 📍 in private chat | saves the location to your caca map | 🆕 capture device GPS when logging (optional per caca) |
| `/Mapa` | static map image with 💩 markers | 🆕 (we already rebuilt this w/ Geoapify) |
| `/mapadinamico` | interactive map | 🆕 (we already built the Leaflet page) |
| `/zonas`, `/zonamanual`, `/verzona`, geocode→tz | pick/inspect timezone | ❌ **DROP** — only existed because Telegram timestamps are server-time (UTC). The phone logs local time, so no picker/geocoding needed. |
| timezone per user | so hour-stats are in local time | ✅ auto-stamp the phone's `tz` on each caca (free, no UI) → by-hour stats stay correct even when traveling / for bot-imported cacas |
| **exact date+time per caca** | the critical thing for all stats | ✅ stored as `ts` on every caca event |

## 5. Year-in-review ("Wrapped")  ← big visual feature
| Bot | What it does | App |
|---|---|---|
| `/wrapped2025` | personal Spotify-Wrapped recap: portada, resumen, horas, meses, racha, competición, ubicaciones, collage + text | 🟡 Phase "W" (keep? ❓) |
| `/wrappedGrupo2025` | group version | 🟡 Phase "W" |

## 6. Engagement / onboarding
| Bot | What it does | App |
|---|---|---|
| `/start`, `/menuprincipal`, `/ayuda` | onboarding, menu, help | 🟡 Phase D |
| `/compartir` | share/invite the bot | 🟡 invite friends/groups (B/C) |
| `/donar` | donations link | 🟡 Phase D |
| `/about`, `/novedades` | about + changelog (now with infographic) | 🟡 Phase D |
| `hears` caga/cago/mierda/peste/gif | fun auto-replies + random gifs/phrases | 💬 optional easter eggs |

## 7. Admin / ops
| Bot | What it does | App |
|---|---|---|
| daily backup cron (00:00 & 12:00) | sends DB JSON to admin Telegram | ⚙️ Firestore is durable; add scheduled export |
| `/reseteoAnual` + Jan-1 cron (disabled) | annual reset + new-year structure | ❓ depends on per-year decision |
| `/broadcast` | message all users | ⚙️ admin announcements / push |
| `/forcebackup`, `/limpiarchats`, `/modoImport`, `/migrarUbicaciones` | backup/cleanup/import/migrate | ⚙️ ops (some only needed for the bot bridge) |

## ✅ Decisions (resolved)
1. **Counter period = PER-YEAR** (resets Jan 1, like the bot). We're event-sourced so all cacas are kept forever; the displayed total + leaderboards are **current-year**; year-end = archive the year + reset live counter to 0.
2. **Wrapped = DEFERRED** to a future phase (not needed now).
3. **Location = 3-mode user setting**: `never` · `choose` (opt-in per caca) · `always` (auto-capture device GPS each caca). Cacas carry `lat/lng`; built in the Maps phase.
4. **Backups** — Firestore is durable; still add a scheduled JSON export (replicates the bot's twice-daily backup).

## Refined phase plan
- **A (done)** auth + per-year counter + add caca
- **A+** quick wins: `/quitacaca` (−1/undo), `/modificar` (set/correct), per-year framing
- **B** friends + friends feed + friends leaderboard (current-year)
- **C** groups + group feed + group leaderboard (current-year)
- **D** stats (`/Graph` annual chart, `/Hours` + top-3), onboarding (help/about/share/donate), settings (privacy + `locationMode`)
- **Maps** static + interactive map + location capture (3 modes) + `/latecaca` backdated logs
- **Year-end** archive + reset + scheduled backup
- **Wrapped** (later) · **E** Telegram bot bridge
