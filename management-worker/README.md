# Nova Central Management Worker

A **separate** Cloudflare Worker (its own front end + back end) that acts as the control plane
for a fleet of Nova proxy workers. The proxy panels keep **only the API URL** — all management
(fleet count, total traffic, broadcasts) happens here, not inside the client panels.

This implements exactly the contract the main `worker.js` already calls
(see `../CENTRAL_SERVER.md`), so once it's deployed and pointed at, the existing hooks light up.

## Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/heartbeat` | none | Proxy workers report `{ id, host, version, monthTraffic, ts }` hourly. |
| GET | `/announcement` | none | Proxy workers fetch the current broadcast (`{title,text,url}` or `null`). |
| GET | `/stats` | Bearer | `{ instances, activeInstances, totalTrafficHuman, list }` for the admin UI. |
| POST | `/admin/announcement` | Bearer | Set/clear the broadcast (`{title,text,url}`; empty text clears). |
| GET | `/` | token in UI | The management dashboard (fleet table + broadcast form). |

`id` is `MD5(MD5("nova-instance:"+host))` computed by each proxy worker — privacy-safe, no secrets.
Instance rows auto-expire after 2h, so "active" = seen within the last 2h. Heartbeats are hourly,
keeping KV writes within the free tier for a personal fleet.

## Deploy
```sh
cd management-worker
npx wrangler kv namespace create MGMT_KV     # paste the id into wrangler.jsonc
npx wrangler secret put ADMIN_TOKEN          # choose a strong token
npx wrangler deploy
```

## Wire up each proxy worker
In every Nova proxy panel → **Settings → Central API**, paste this worker's URL
(e.g. `https://nova-central.<you>.workers.dev`). On the proxy worker, also set
`CENTRAL_TOKEN` = the same `ADMIN_TOKEN` so the proxy panel's Management page can read `/stats`
and push broadcasts. (Plain heartbeat + announcement need no token.)

Open this worker's URL, enter the `ADMIN_TOKEN`, and you'll see connected instances and a
broadcast form. Broadcasts appear in every client panel.
