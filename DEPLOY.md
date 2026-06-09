# Deploy

## Worker (`irnova`)
- Connect to Git: **Workers & Pages → your Worker → Settings → Build** (your repo,
  branch `main`, deploy command `npx wrangler deploy`).
- `wrangler.jsonc` targets it: `name: "irnova"`, KV binding `KV`. Create a KV
  namespace (`npx wrangler kv namespace create KV`) and paste its id into
  `wrangler.jsonc`.
- **Every push to `main` auto-deploys the Worker.**
- Secrets (`ADMIN`, `GH_TOKEN`) and KV data persist across deploys.
- Set `PAGES_URL` (Settings → Variables) to your dashboard Pages URL.

### Other Nova worker instances (optional)
Each is a separate Worker with its own KV, set up as wrangler **environments** in
`wrangler.jsonc` (see the commented `env` example there). **⚠️ Verify each Worker's
KV binding (Settings → Bindings) matches the id before deploying** — a wrong id
breaks that worker's login.

Two ways to keep each in sync with `main`:
- **Git (auto):** Workers & Pages → that Worker → Settings → Build → Connect to Git
  → your repo / `main`, and set the **deploy command** to
  `npx wrangler deploy --env irv` (or `--env ca` / `--env edge`).
- **Manual:** `npx wrangler deploy --env irv` from a clone.

## Dashboard (`nova-panel` Pages)
- Connect to Git: Pages project, root directory `panel`, output `public`
  (`panel/wrangler.toml`).
- **Every push to `main` auto-deploys the dashboard.**
- Put the resulting Pages URL into the Worker's `PAGES_URL` var.

## Manual deploy (fallback)
```bash
npx wrangler deploy                 # worker (irnova)
npx wrangler pages deploy panel/public --project-name nova-panel   # dashboard
```
