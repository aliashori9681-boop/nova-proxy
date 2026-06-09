# Nova Central — control plane

A **separate** Cloudflare Worker that your Nova Proxy instances connect to. It serves:

- `POST /heartbeat` — instances report (host, version, monthly traffic) → fleet stats
- `GET /announcement` — broadcast message (shows in every connected panel's bell)
- `GET /api/pool?asn=<asn>` — per-ISP clean IPs (set this as **POOL_API** on instances)
- `GET /api/warp` — shared WARP+ license pool (instances rotate/apply)

…and a password-protected **management panel** (`/login` → `/admin`) to control all of it:
Dashboard (real stats of instances using the API), IP sources per operator (ASN), WARP+ key
pool, broadcast messages, and API token management.

## One-click install (wizard)
```bash
bash central/install.sh
```
It logs you into Cloudflare, creates the KV namespace, deploys the worker, and sets your
admin password — then prints the URL. (macOS / Linux / WSL / Termux.)

## Manual deploy
1. Create a **KV namespace** and put its id in `wrangler.jsonc` (`kv_namespaces[0].id`).
2. `npx wrangler deploy` (from this `central/` folder).
3. Set the admin password: `npx wrangler secret put ADMIN`.
4. Open `https://nova-central.<you>.workers.dev/login`.

## Point your Nova instances at it
In each Nova panel → Settings:
- **POOL_API** = `https://nova-central.<you>.workers.dev/api/pool`
- **Central API** = `https://nova-central.<you>.workers.dev`

Then instances send heartbeats, pull broadcasts, and get per-ISP IPs + WARP keys from here.

## Automatic deploy on every push (GitHub Actions)
A workflow at `.github/workflows/deploy-central.yml` deploys `central/` to Cloudflare on every
push to `main`. One-time setup (GitHub → repo → **Settings → Secrets and variables → Actions**):

1. **Create the KV namespace once** and copy its id:
   ```bash
   cd central && npx wrangler kv namespace create KV   # prints an id
   ```
2. Add a **Variable** `CENTRAL_KV_ID` = that id.
3. Add **Secrets** `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit + Workers KV: Edit) and
   `CLOUDFLARE_ACCOUNT_ID`. Optionally `CENTRAL_ADMIN` = your management password (set once).

After that, pushing any change under `central/` auto-deploys `nova-central` — same idea as the
main worker's Git build. (You can also trigger it manually from the Actions tab.)

> Prefer no CI? In the Cloudflare dashboard add a second **Workers Build** for this repo with
> **Root directory = `central`** — it then deploys on push too.
