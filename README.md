<div align="center">

# 🌟 Nova Proxy

**A personal, censorship-resistant proxy + dashboard on a single Cloudflare Worker.**
**یک پروکسی شخصی و ضدسانسور به‌همراه پنل، روی یک Cloudflare Worker.**

VLESS · Trojan · Shadowsocks over WebSocket + TLS — with a self-contained
bilingual (English + فارسی) dashboard, per-ISP clean-IP optimization, multi-user
links, a Telegram bot, WARP, and one-click deploy. Runs on Cloudflare's **free** tier.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/IRNova/Nova-Proxy)
&nbsp;
![GitHub Repo stars](https://img.shields.io/github/stars/IRNova/Nova-Proxy?style=social)
![License](https://img.shields.io/badge/license-MIT-purple)
![Version](https://img.shields.io/badge/version-3.0-blueviolet)

🌐 [novaproxy.online](https://novaproxy.online) · ✈️ [Telegram](https://t.me/irnova_proxy) · 𝕏 [@irNovaProxy](https://x.com/irNovaProxy)

</div>

---

## ⚡ One-click deploy (no API token, no CLI)

> **No GitHub account?** Use the **token installer** — paste a Cloudflare API
> token and it creates the KV namespace, uploads Nova, and gives you the setup
> link (no GitHub, no CLI): **[install.novaproxy.online](https://install.novaproxy.online)**.

1. Click **Deploy to Cloudflare** above → log in / authorize.
2. Cloudflare forks the repo, **creates the Worker, auto-creates the KV namespace,
   and bundles the dashboard** — all automatically.
3. Open your Worker URL → a short **`/install`** wizard asks for an admin password. Done.
4. Sign in at **`/login`**. The dashboard shows your **subscription link + QR**.

> **🇮🇷 For Iran:** `*.workers.dev` is filtered. After deploying, add a **custom
> domain** (Workers → Settings → Domains & Routes → Add Custom Domain, e.g.
> `cdn.yourdomain.com`). Configs then use that domain's SNI — far more reliable.

---

## 🧬 Section 1 — Feature evolution (v1 → v2 → v3)

Everything from earlier versions is carried forward. ✅ = included · ➖ = not yet.

| Feature | v1 | v2 | v3 |
|---|:--:|:--:|:--:|
| **Subscription formats** (Auto · Base64 · Clash/Mihomo · sing-box) | ✅ | ✅ | ✅ |
| **Config management** (load-balancing, health check) | ✅ | ✅ | ✅ |
| **DoH proxy** (`/dns-query`, `/doh`) | ✅ | ✅ | ✅ |
| **Smart routing** + GeoIP / GeoSite | ✅ | ✅ | ✅ |
| **Ad / adult / malware blocking** | ✅ | ✅ | ✅ |
| **IPv4 / IPv6 control** | ✅ | ✅ | ✅ |
| **Multi-protocol** — VLESS + Trojan + Shadowsocks | ➖ | ✅ | ✅ |
| **gRPC + XHTTP transport** | ➖ | ✅ | ✅ |
| **Proxy chaining** (SOCKS5 / HTTP / HTTPS) | ➖ | ✅ | ✅ |
| **Advanced TLS** — fragment + fingerprint | ➖ | ✅ | ✅ |
| **Local subscription generation** (no external subconverter) | ➖ | ✅ | ✅ |
| **Telegram bot** (manage hosts, sub, announce) | ➖ | ✅ | ✅ |
| **Best-IP / scanner tools** + Cloudflare usage stats | ➖ | ✅ | ✅ |
| **Admin dashboard** (dark mode) | ➖ | ✅ | ✅ |
| **One-click "Deploy to Cloudflare"** + `/install` wizard | ➖ | ➖ | ✅ |
| **Bundled dashboard** (Static Assets — no separate site) | ➖ | ➖ | ✅ |
| **Bilingual EN + فارسی UI** + guided tour | ➖ | ≈ | ✅ |
| **Per-ISP clean-IP optimization** (auto by `request.cf.asn`) | ➖ | ✅ | ✅ |
| **Multi-user** — per-user link, quota (GB) + expiry, on/off | ➖ | ➖ | ✅ |
| **Panel password change + 2FA (TOTP)** + recovery | ➖ | ➖ | ✅ |
| **WARP account register + WARP+ license + WoW** | ➖ | ➖ | ✅ |
| **WARP endpoint switcher** (Iran-friendly, anycast) | ➖ | ➖ | ✅ |
| **🇮🇷 Iran mode (one tap)** + live config report | ➖ | ➖ | ✅ |
| **ECH** (encrypted SNI) + port-spread + multi-transport | ➖ | ➖ | ✅ |
| **Tokenless format-named sub links** (`/sub/mihomo.yaml`, …) | ➖ | ➖ | ✅ |
| **Permanent GitHub sub-mirror** (survives domain filtering) | ➖ | ➖ | ✅ |
| **Cross-infra fallback** (blend non-Cloudflare nodes) | ➖ | ➖ | ✅ |
| **Self-healing domain pool** + Telegram auto-announce | ➖ | ➖ | ✅ |
| **Daily traffic chart** + upload/download split | ➖ | ➖ | ✅ |
| **Backup & restore** (export/import all settings) | ➖ | ➖ | ✅ |
| **Central management API** (fleet stats / broadcast) | ➖ | ➖ | ✅ |

> `≈` = partial. **v3 is the current release.**

---

## 📊 Section 2 — How Nova compares

A general capability comparison with two popular Cloudflare-Worker proxy panels.
✅ = has it · ➖ = doesn't · `?` = unverified.

> _Based on publicly available information (mid-2026). Nova is not affiliated with
> these projects; this reflects general capabilities and may be out of date —
> corrections via PR are welcome._

| Capability | 🟣 **Nova** | 🔵 BPB Panel | 🟢 H-Tunnel |
|---|:--:|:--:|:--:|
| Runs free on Cloudflare Workers | ✅ | ✅ | ✅ |
| VLESS / Trojan / Shadowsocks | ✅ | ✅ | `?` |
| gRPC / XHTTP transport | ✅ | ➖ | `?` |
| One-click "Deploy to Cloudflare" | ✅ | ✅ | `?` |
| Bundled dashboard (no separate site) | ✅ | ✅ | `?` |
| Bilingual **English + فارسی** UI | ✅ | ➖ | `?` |
| **Per-ISP clean-IP optimization** | ✅ | ➖ | ➖ |
| **Multi-user** (per-link quota + expiry) | ✅ | ➖ | `?` |
| Panel **password change + 2FA (TOTP)** | ✅ | ➖ | `?` |
| **Telegram bot** management | ✅ | ➖ | `?` |
| WARP / WARP+ / WoW | ✅ | ✅ | `?` |
| TLS fragment / fingerprint evasion | ✅ | ✅ | `?` |
| ECH (encrypted SNI) | ✅ | ➖ | `?` |
| Smart routing rules | ✅ | ✅ | `?` |
| 🇮🇷 Iran-tuned defaults (domestic-direct, anti-sanction DNS) | ✅ | ➖ | ✅ |
| Ad / adult / malware blocking | ✅ | ✅ | `?` |
| Permanent **GitHub sub-mirror** | ✅ | ➖ | ➖ |
| Cross-infra fallback (blend non-CF nodes) | ✅ | ➖ | `?` |
| Backup & restore | ✅ | ➖ | `?` |
| Self-healing domain pool + auto-announce | ✅ | ➖ | ➖ |

**Where Nova stands out:** per-ISP clean-IP delivery, true multi-user with quota
& expiry, a bilingual dashboard with 2FA, a Telegram bot, a permanent GitHub
anchor, and Iran-tuned defaults — all on the **free** Worker tier, one click away.

---

## 📚 Quick reference

**Public sub links** (tokenless, share-anywhere — same content on every domain):

```
https://<your-domain>/sub/mihomo.yaml     # Clash / Mihomo / FLClash
https://<your-domain>/sub/base64.txt      # v2rayNG / NekoBox / Streisand
https://<your-domain>/sub/singbox.json    # sing-box / NekoBox
```

**WARP / WireGuard configs:** `/warp?target=wireguard|nekoray&count=50`
**Telegram bot (admin):** `/hosts`, `/addhost`, `/delhost`, `/sub`, `/announce`
**DoH:** `/dns-query` · `/doh`

> A Cloudflare Worker terminates **TCP-over-WebSocket**, so it serves **VLESS /
> Trojan / Shadowsocks**. Hysteria2 / TUIC / WireGuard need inbound UDP/QUIC and
> can't be served by a Worker — WARP works only because those configs target
> Cloudflare's WARP service directly.

---

## 🙏 Section 3 — Credits & Team / تشکر و اعضای تیم

Built with ❤️ for a free and open internet.

- **vahid** — creator & maintainer · [@iiviirv](https://github.com/iiviirv)
- [Cloudflare Workers](https://workers.cloudflare.com/) — the platform Nova runs on
- [Xray-core](https://github.com/XTLS/xray-core) — protocol reference & inspiration

> Want to help? Issues and PRs are welcome — translations, clean-IP data, docs,
> and testing from inside Iran are especially valuable.

---

## 💜 Section 4 — Support us / حمایت از پروژه

اگر Nova برایتان مفید بود، با یک **⭐ ستاره** و یک دونیت کوچک از ادامه‌ی کار حمایت کنید.
If Nova helps you, please **⭐ star the repo** and consider a small donation — it
keeps the project alive and free for everyone.

<div align="center">

### ⭐ [Star Nova on GitHub](https://github.com/IRNova/Nova-Proxy) ⭐

[![Star on GitHub](https://img.shields.io/github/stars/IRNova/Nova-Proxy?style=for-the-badge&logo=github&label=Star%20Nova&color=8957e5)](https://github.com/IRNova/Nova-Proxy)

</div>

**☕ دونیت / Donate:** [daramet.com/NovaPr](https://daramet.com/NovaPr)

**Crypto wallets / کیف پول‌ها:**

| Coin | Address |
|---|---|
| **BTC** | `bc1qc54su3gz20ulq8df7k0pcskk4zz4sy0e7z7hws` |
| **TON** | `UQD51lGC35rP_SbVYgbFA7CEEii4GVMFgqj4N8fiGi6m425w` |

---

<div align="center">

Made for Iran 🇮🇷 — and anyone who needs a free, open internet.
**Nothing about your traffic is logged to us. The proxy is yours.**

🌐 [novaproxy.online](https://novaproxy.online) · ✈️ [t.me/irnova_proxy](https://t.me/irnova_proxy) · 𝕏 [@irNovaProxy](https://x.com/irNovaProxy)

</div>
