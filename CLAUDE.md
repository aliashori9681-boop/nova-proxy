# Nova Proxy — project memory

## What this repo is
`nova-proxy-worker` is the **backend**: a single Cloudflare Worker (`worker.js`,
~7k lines) that serves a personal proxy (VLESS / VMess-capable / Trojan / Shadowsocks
over WebSocket+TLS, plus gRPC/XHTTP), a subscription generator, DoH, a Telegram bot,
and a WARP config generator. Runs on the **free Cloudflare Worker + KV** tier — keep
it that way (no per-connection extra KV writes, no paid-only APIs required).

## The pieces (NOT a monorepo — they sync over URLs). Verified 2026-06.
| Component | Role | Where it lives | Git repo? |
|---|---|---|---|
| `iiviirv/nova-proxy-worker` (this) | Backend Worker (proxy + sub + DoH + bot + WARP) | a Cloudflare Worker / custom domain | ✅ this repo |
| **`nova-panel`** Pages project | **The dashboard / admin panel SPA** (`/login`, `/admin`, bestip.html) | a Cloudflare Pages site (set via the `PAGES_URL` var / `PagesstaticPages` in worker.js) | source in `panel/public` |
| **`nova-deploy`** Pages project | Serves `POOL_API` = `/api/pool` (per-ISP clean IPs); binds `CROWD_KV` | your pool Pages site (set via the `POOL_API` var) | optional |
| `iiviirv/nova-ip-bot` | **Go server**: per-ISP clean-IP extractor that feeds the CROWD/POOL data | (private repo) | ✅ |
| `iiviirv/irnova-site` | **Marketing/landing site** (project cards, setup guide, IPTools.jsx) — **NOT the panel** | (private repo) | ✅ |

How they connect:
- Worker serves the dashboard by **proxying `PagesstaticPages`** (= the `nova-panel`
  Pages site) for `/login`, `/admin`, `/admin/bestip.html`, `logo.png`, `/noKV`, `/noADMIN`.
- Worker reads `POOL_API` (var, = your pool site's `/api/pool`) on every `/sub` to
  hand each subscriber IPs tuned to their ISP via `request.cf.asn`. That pool ultimately
  comes from `nova-ip-bot` → `CROWD_KV`.
- All deployed independently; they talk over URLs, not a shared codebase.

## Cross-repo workflow (Claude Code on the web)
Each web session is scoped to **one** repo (GitHub tools only reach that repo).
- Backend → session on `nova-proxy-worker` (this repo).
- Go server → session on `iiviirv/nova-ip-bot`.
- **Dashboard → BLOCKED: `nova-panel` is a Direct-Upload Pages project with NO Git
  repo.** Before Claude can edit it, the source must be located and pushed to a new
  GitHub repo (e.g. `iiviirv/nova-panel`), then a session run on that. The deployed
  the deployed Pages output is built/minified — recover the original source.
- `irnova-site` is the marketing site; do **not** build the dashboard there.
Starting a session and merging PRs are **UI actions the human does** — a session
cannot reach repos outside its scope or spawn other sessions.

## Hard platform constraints (don't forget)
- A Worker can **serve** VLESS / VMess / Trojan / Shadowsocks (TCP over WebSocket).
- A Worker **cannot serve** Hysteria2 / TUIC / WireGuard (no inbound UDP/QUIC).
  WARP works only because configs target Cloudflare's WARP service, not the Worker.
- DNS tunneling (MasterDNS/WhiteDNS) cannot live inside a clash/v2ray sub — no client
  protocol for it. Keep it as a separate app / use `FALLBACK_SUB` for non-CF proxy nodes.

## Endpoints / env added in worker.js (so future sessions know what's wired)
Public:
- `GET /sub/mihomo.yaml`, `/sub/base64.txt`, `/sub/singbox.json` — tokenless format-named sub links.
- `GET /sub?token=...&target=singbox|clash|base64` — `target` is normalized (`auto`/unknown → UA detection).
- `GET /dns-query[/...]`, `/doh[/...]` — DoH proxy (wireformat `?dns=`/POST **and** JSON `?name=`).
- `GET /warp?target=wireguard|nekoray&count=N[&mtu]` — WARP/WireGuard config generator (base64 list).
- `/bot` — Telegram webhook. Bot cmds: `/sub /status /config /hosts /addhost /delhost /announce /sethost /setpath /setname /setwebhook /myid`.

Admin (cookie-gated under `/admin/...`):
- `/admin/usage` (traffic today/month/year/all), `/admin/domains` (`?check=1`), `/admin/announce`,
  `/admin/publish-mirror`, `/admin/fallback` (`?refresh=1`).

Cron: hourly `scheduled` → health-check pool, refresh GitHub mirror, announce on change.

Env / vars:
- `ADMIN` (secret password), `POOL_API` (per-ISP IP source = nova-ip-bot).
- GitHub mirror: `GH_TOKEN` (secret), `GH_REPO`, `GH_BRANCH` (default `main`; we use `sub`), `GH_PATH`.
- `ANNOUNCE_CHAT` (Telegram announce target), `FALLBACK_SUB` (non-CF failover nodes).

## Known follow-ups (not yet implemented)
- WARP+ license / registration (X25519 keygen + Cloudflare reg API).
- VMess **inbound** (feasible; touches the perf-critical auth path — do carefully).
- Adult-block → bilingual redirect page (instead of silent REJECT).
- Per-link expiry + quota (note: public configs stay usable after a link dies).
- Central management server (user count, public-resource management, broadcast) — likely on `nova-ip-bot`.
- Frontend items live in the **`nova-panel`** dashboard (Direct-Upload Pages, no repo yet —
  must be recovered/pushed to GitHub before editing). Backends for most already exist here.

## House rules
- Backend changes must work on the **free** Worker plan.
- The Iranian domestic-bypass / DNS / routing defaults are tuned for **Iran**, not China
  (the upstream subconverter template is China-centric — watch for `geoip-code: CN`, CN DNS).
- File uses CRLF line endings.
