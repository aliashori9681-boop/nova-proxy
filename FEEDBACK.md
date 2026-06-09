# Iran tester feedback — coverage tracker

Status of every point. ✅ done · 🟡 partial · ⛔ not feasible (with reason) · 🔜 follow-up.
Backend = `worker.js` · Frontend = `panel/` (dashboard).

## Dashboard
| # | Item | Status | Where |
|---|---|---|---|
| 1 | Workers/Pages stat always 0 → remove | ✅ replaced with **App** + **Traffic today** | Frontend |
| 2 | sing-box link should be sing-box format (was Auto) | ✅ per-format cards + `?target=` normalize | Both |
| 3 | FlClash should be Clash format | ✅ per-format cards | Both |
| 4 | Hiddify "unable to determine config format" / Base64 | ✅ `target=base64` fixed | Backend |
| 5 | Network section should show the connecting app | ✅ `/admin/system.json` UA + App stat | Both |

## Subscriptions
| # | Item | Status | Where |
|---|---|---|---|
| 6 | Free-service notice always-on, resellers can't strip | ✅ baked-in info node, FORCED always-on (no off-switch) | Backend |
| 6b | …shown as an auto web popup | ⛔ can't inject a popup into proxied HTTPS; baked node is the feasible form | — |

## Clean IPs
| # | Item | Status | Where |
|---|---|---|---|
| 7 | Scanner only visible in Custom mode; results → confirm → apply | ✅ scanner hidden unless Custom; results table + "Use these" already confirm | Frontend |
| 8 | Smart IP API configurable | ✅ set your pool endpoint in Settings → Clean IPs | Frontend |

## Per-ISP pools
| # | Item | Status | Where |
|---|---|---|---|
| 9 | 15-min refresh from server + extraction time list | 🟡 panel shows live per-ISP counts; **15-min refresh + timestamps live in `nova-deploy`/`nova-ip-bot`** | Server |

## Network & DNS
| # | Item | Status | Where |
|---|---|---|---|
| 10 | WARP license fails / no way to connect | ✅ `/admin/warp.json` register + WARP+ license + inject WARP node | Backend |
| 11 | Adult-block → bilingual redirect page | ⛔ HTTPS can't be redirected client-side (TLS); block (REJECT) works | — |
| 12 | Iranian-direct sites leak the proxy IP | ✅ `DOMAIN-SUFFIX,ir,DIRECT` (Clash) + `domain_suffix:['.ir']` (sing-box); removed broken rule-sets | Backend |
| 13 | GeoIP routing should have country picker (CN/RU/IR) | ✅ Preset card: bypass China/Russia (Iran via domestic toggle) | Both |
| 14 | Custom routing rules more complete | ✅ rules now **applied** to Clash (were only saved) | Backend |
| 15 | DoH not working | ✅ route `/dns-query/@token` + JSON `?name=` | Backend |

## Settings
| # | Item | Status | Where |
|---|---|---|---|
| 16 | gRPC/XHTTP need custom domain → warn on select | ✅ warning toast on select | Frontend |
| 17 | Label TLS `random` "(suitable for Iran now)" + help | ✅ relabeled + hint | Frontend |
| 18 | HOST: note to connect domain to Worker first + guide | ✅ warning note added | Frontend |

## Notifications
| # | Item | Status | Where |
|---|---|---|---|
| 19 | Account ID/API Token blank on return; lock/edit | ✅ fields repopulate + kept in memory (lock/edit toggle 🔜) | Frontend |
| 20 | Telegram toggle/save/webhook broken | ✅ toggle fixed + webhook auto-set on save | Both |
| 21 | Usage chart: commas (24,345/100,000) + gradient | ✅ comma-format + green→yellow→orange→red bar | Frontend |
| 22 | Traffic volume (day/month/year/all) in sub + dashboard | ✅ `/admin/usage` + bot `/status` + dashboard stat | Both |

## Advanced
| # | Item | Status | Where |
|---|---|---|---|
| 23 | Multiple sub links with expiry + quota | ⛔ public configs stay usable after a link dies (you noted this); not enforceable | — |
| 24 | ECH frontend (auto + custom sources) | ✅ ECH toggle + SNI/DoH source fields (Advanced card) | Both |
| 25 | Custom CDN (Address/Host/SNI) editable | ✅ Custom CDN Host/SNI override (Advanced card) | Both |
| 26 | Xray Fragment (mode/length/interval/maxsplit/packets) | ✅ Custom fragment params (length/interval/packets) | Both |
| 27 | Warp PRO (MahsaNG noise params) | 🟡 AmneziaWG toggle + noise param fields (saved; applied where client supports) | Both |
| 28 | Preset routing rules + country block/bypass | ✅ Preset card: QUIC block + best-effort malware/phishing/cryptominers + country bypass | Both |
| 29 | Correct DoH `…/dns-query/@TOKEN` format | ✅ routed (see #15) | Backend |
| 30 | NAT64 prefixes from GitHub for IP substitution | ✅ `NAT64` env (prefix list or GitHub URL); used as connect fallback | Backend |
| 31 | Generate vmess/hysteria/hy2/tuic/wireguard/nekoray | 🟡 WARP→wireguard/nekoray ✅; **vmess feasible (deferred); hysteria2/tuic ⛔ — a Worker can't serve inbound UDP/QUIC** | Backend |
| 32 | Central management server (user count, broadcast, public-resource mgmt) | 🟡 panel Management page + worker hooks + banner done; Go server on `nova-ip-bot` (see CENTRAL_SERVER.md) | Server |

## Platform limits to remember
- A Cloudflare Worker can serve **VLESS / VMess / Trojan / Shadowsocks** (TCP/WS) only — **not Hysteria2 / TUIC / WireGuard** (no inbound UDP/QUIC). WARP works because configs target Cloudflare's WARP service, not the Worker.
- Everything here stays within the **free Worker + KV** model.

## 2026-06 re-fix pass (items marked ✅ above but still broken in the field)
The tester re-reported #2/3/4, #10, #12, #15, #20 as not working. Root causes found & fixed:

- **#2/3/4 Sub format / Hiddify "unable to determine config format"** — Two bugs:
  (a) sing-box/clash links go through the **external** subconverter (`SUBAPI.cmliussss.net`);
  when it's down/blocked the worker returned an *error string*, which Hiddify reports as
  "unable to determine config format". Now it **falls back to the local base64 list** so the
  client always imports a working config. (b) `btoa()` on the sub could throw on non-Latin1
  (Persian SUBNAME / emoji notice) → now `utf8ToBase64()`. (c) Panel now hands each app its
  real format: **Hiddify/sing-box → sing-box, FlClash → Clash, v2rayNG → Base64** (the buttons
  used the rule-less `Auto`/base64 link before).
- **#12 Iranian-direct leaks the proxy IP** — same root cause: the `Auto`/base64 link carries
  **no routing rules**, so `.ir` was proxied. The `.ir`→DIRECT rules only live in Clash/sing-box
  configs; giving Hiddify a sing-box link (above) makes them apply. Also fixed a sing-box
  config-breaker: the adult-block rule referenced an **undefined** `rule_set:['geosite-porn']`
  (invalidated the whole config) — replaced with a self-contained `action:'reject'` rule.
- **#15/#29 DoH not working** — DoH **POST** wireformat (Firefox/OS resolvers) was swallowed by
  the gRPC/XHTTP POST proxy branch and never reached `handleDoHRequest`. Excluded `dns-query`/
  `doh` paths from that branch; DoH POST now resolves. Wireformat + JSON now also honor the
  panel's configured provider instead of always-random.
- **#10 WARP+ license fails / nowhere to connect** — `warpApplyLicense` now confirms `warp_plus`
  with a follow-up account GET and surfaces the real API error. `/admin/warp.json` (admin-gated)
  now returns a **connectable WireGuard config** (`node` link + `.conf`); the panel shows
  Copy-link / Copy-.conf so a registered account is actually usable.
- **#20 Telegram: admin /start gives no menu / no response** — most likely the configured
  `ChatID` ≠ the admin's DM (e.g. a channel), so messages were silently dropped. Now the bot
  **replies with the sender's Chat ID + a hint** instead of going silent, registers a command
  **menu** (`setMyCommands`), and `/start` shows **working inline management buttons**
  (Status / Link / Config / Hosts / Announce) via `callback_query`.

### Still open (not in this pass)
- #11 adult-block → redirect page: still ⛔ for HTTPS (TLS can't be redirected from a TCP tunnel).
- Clean-IP online-scan source picker, custom-routing-rules two-box UI, per-user usage node,
  and the standalone management worker remain as documented follow-ups.

## 2026-06 second pass — remaining items + full code audit (don't trust the rows above)
Verified against the code, not the checkmarks. Done this pass:

- **Usage accounting (P0 fix)** — `recordUsage` was doing read+write to 2 KV keys on EVERY
  connection close: free-tier-breaking AND racy (concurrent closes lost updates). Rewrote to
  batch in-isolate and flush at most ~once/5 min (or 200 MB). Day/month buckets now keyed in
  Asia/Tehran. Usage also recorded on the WS error teardown.
- **#22 / usage UI** — home dashboard now shows Today / Month / Year / All-time; the sub's
  `Subscription-Userinfo` header reports real monthly traffic so Hiddify/Clash show used volume.
- **#14 / custom rules** — added a builder (TYPE + value + OUTBOUND + Add) above the textarea;
  rules are now also applied to **sing-box** configs (Clash already had them).
- **#7 / clean-IP scan sources** — scanner gained a Source selector (Random CF, Cloudflare
  official, AS13335, CF-CIDR, ProxyIP) pulling candidates from `/admin/bestip?loadIPs=…`,
  then latency-testing them; results table + "Use these" remain the confirm/apply step.
- **#11 / adult block** — block page is now bilingual (FA+EN). A true *redirect* for HTTPS
  remains ⛔ impossible (the proxy tunnels TLS; it can't inject an HTTP redirect or serve a
  page for an https:// target). The page shows where it technically can (HTTP / `/nova-block`).
- **#32 / management** — built a SEPARATE deployable worker in `management-worker/` (own UI +
  backend: `/heartbeat`, `/announcement`, `/stats`, `/admin/announcement`). Removed the
  Management *page* from the client panel (per the request) — the client panel now only keeps
  the **Central API** field in Settings. Point each proxy at the new worker's URL.

### Audit fixes (worker.js)
- Efficient `log.json` trim (no per-entry re-serialize); network-settings cached in-isolate
  (~30s) to keep a KV read off the proxy hot path.
- Noted but NOT changed (benign / risky): cross-request module globals (`proxyIP`,
  `networkSettings`) hold effectively-equal values so the race is harmless here; the two
  inert "this file is safe" comment blocks are provenance for a human to review.
