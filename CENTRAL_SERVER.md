# Nova central management server — plan & handoff

A control plane for the whole Nova ecosystem: instance/user counts, centrally-managed
public resources (clean IPs, WARP, sub-converter, NAT64), and broadcast announcements —
served behind one stable API that each Worker/panel points to. Lives best on
**`iiviirv/nova-ip-bot`** (Go) — it already aggregates per-ISP clean IPs.

## Worker-side hooks (already implemented in this repo)
Set on each Worker via env **`CENTRAL_API`** (+ optional admin secret **`CENTRAL_TOKEN`**)
or per-panel **`centralApi`** (Settings → Advanced). Endpoints the Worker calls:
- **POST `{CENTRAL_API}/heartbeat`** — `{ id, host, version, monthTraffic, ts }`
  (`id` = `MD5MD5("nova-instance:"+host)`, privacy-safe; no secrets). Hourly cron.
- **GET `{CENTRAL_API}/announcement`** — `{ title?, text, url? }` or `null`. Cached to KV;
  the panel shows it as a banner (`GET /admin/announcement`). Hourly cron.
- **GET `{CENTRAL_API}/stats`** *(Bearer `CENTRAL_TOKEN`)* — `{ instances, activeInstances,
  totalTrafficHuman }` for the panel's **Management** page (`GET /admin/central/stats`).
- **POST `{CENTRAL_API}/admin/announcement`** *(Bearer `CENTRAL_TOKEN`)* — set the broadcast
  `{ title, text, url }` from the panel's Management page (`POST /admin/central/announcement`).

All no-ops until `CENTRAL_API` is set. The panel's **Management** page is live and calls
these via the Worker; it shows "set Central API + run the server" until the server exists.

## To build on `nova-ip-bot` (the server)
1. **`POST /heartbeat`** — upsert instance by `id` with `{host, version, monthTraffic, lastSeen}`.
   "Active instances" = rows seen in the last ~2h; sum `monthTraffic` for total usage.
2. **`GET /announcement`** — return the current broadcast `{title,text,url}` (or `null`).
3. **Admin view** (token-gated): list active instances + counts + total traffic; a form to
   set/clear the announcement; manage shared resources below.
4. **Shared public resources** (so Workers stop depending on third-party GitHub) — serve and
   let `nova-proxy-worker` read from `CENTRAL_API`:
   - `GET /pool?asn=` (already `POOL_API`), `/warp/keys`, `/subconverter`, `/nat64`.
5. Storage: KV/SQLite/Postgres — whatever fits free hosting. Keep it on the free tier.
6. Hide the origin: the panel only ever stores the `CENTRAL_API` URL (set once); the central
   domain isn't exposed in configs.

## Handoff prompt for a `iiviirv/nova-ip-bot` session (paste this)
> This Go repo is the Nova per-ISP clean-IP server (feeds `POOL_API`). Extend it into the
> **Nova central management server**. The Nova Worker (`iiviirv/nova-proxy-worker`) already
> calls these (gated on `CENTRAL_API`; admin calls send `Authorization: Bearer CENTRAL_TOKEN`):
> - `POST /heartbeat` `{id,host,version,monthTraffic,ts}` — upsert instance by `id`.
> - `GET /announcement` → `{title,text,url}` or `null`.
> - `GET /stats` (Bearer) → `{instances, activeInstances, totalTrafficHuman}` (active = seen <2h).
> - `POST /admin/announcement` (Bearer) `{title,text,url}` — set the current broadcast.
>
> The Nova dashboard already has a **Management** page that calls `/stats` + `/admin/announcement`
> via the Worker, so once these exist the fleet view + broadcast light up automatically. Build
> those four endpoints + storage; optionally serve shared resources (`/pool`, `/warp/keys`,
> `/subconverter`, `/nat64`) so Workers stop depending on third-party GitHub. Keep it deployable
> on free infra; don't expose the origin to end users. Develop on a branch and open a PR.
