# Nova Installer — one-click deploy without GitHub

A tiny Cloudflare Worker that installs Nova onto a user's own Cloudflare account
**without needing a GitHub account**. The user pastes a scoped Cloudflare API
token and clicks Install; the worker creates a KV namespace, uploads the
self-contained Nova worker (`dist/worker.single.js`), binds KV, and enables the
`*.workers.dev` URL.

## Deploy it (you, once)

**Easiest — Cloudflare dashboard (no CLI, works on a phone):** the installer is
tiny (~10 KB), so you can paste it:
1. Cloudflare dashboard → **Workers & Pages → Create → Create Worker** → name it
   `nova-installer` → **Deploy** → **Edit code**.
2. Delete the placeholder, **paste the whole `worker.js`** from this folder → **Deploy**.
3. (Optional) **Settings → Domains & Routes → Add Custom Domain** → `install.novaproxy.online`.

No KV and no secrets needed for the installer itself.

**Or CLI:**

```bash
cd installer
npx wrangler deploy
```

Either way you get `nova-installer.<you>.workers.dev` (or your custom domain).
Share that link with non-GitHub users.

- To install **your** build instead of the default (`iiviirv` main), set a var
  `SOURCE_URL` to your raw `dist/worker.single.js` URL (in `wrangler.jsonc`, or
  in the dashboard under **Settings → Variables and Secrets**).

## What the user does

1. Create a scoped Cloudflare API token (the page links to it) with:
   **Workers Scripts: Edit**, **Workers KV Storage: Edit**, **Account Settings: Read**.
2. Open the installer link, paste the token, pick a worker name, click **Install**.
3. Open the returned `/install` link, set an admin password. Done.

## After install — for Iran (important)

- The installed worker is **passive by default** (no cron, no automatic outbound),
  so a fresh `*.workers.dev` deploy doesn't trip Cloudflare's "Network abuse"
  detection. Don't change that on `workers.dev`.
- `*.workers.dev` is filtered/abuse-flagged in Iran — tell users to **add a custom
  domain** to their worker (**Settings → Domains & Routes → Add Custom Domain**).
  Custom domains work on the **free** Workers plan; users only need to own a domain.
- Only on a custom domain (or paid plan) is it safe to turn on maintenance: set the
  var `ENABLE_CRON=1` and add a cron trigger.
- Never post the `workers.dev` URL publicly — hand out only the subscription link.

## Put it on novaproxy.online

Offer two buttons:
- **Deploy (no GitHub)** → your installer (`install.novaproxy.online`) — the default.
- **Deploy via GitHub** → the repo's Deploy button — secondary, power users only
  (it forks the repo per user).

## Security

- The token is used **only** to perform the install API calls and is **never
  stored or logged** by the worker.
- Tell users to create a **scoped** token (not the Global API Key) and delete it
  after installing.
- The installer source is here for audit — it only calls `api.cloudflare.com`.
