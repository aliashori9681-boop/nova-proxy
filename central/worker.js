// ===================================================================
// Nova Central — control plane for Nova Proxy instances
// A separate Cloudflare Worker (its own KV + ADMIN secret). Deployed Nova
// instances point CENTRAL_API + POOL_API at this server and:
//   • POST /heartbeat        -> fleet stats (who uses the API)
//   • GET  /announcement     -> broadcast message (shows in every panel bell)
//   • GET  /api/pool?asn=N   -> per-ISP clean IPs (the POOL_API)
//   • GET  /api/warp         -> shared WARP+ license pool (instances rotate/apply)
// The management panel (password + KV) controls all of the above.
// ===================================================================

const VERSION = '1.0.0';

async function sha256hex(str) {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
	return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function json(obj, status = 200, extra = {}) {
	return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
function readCookie(request, name) {
	const c = request.headers.get('Cookie') || '';
	const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
	return m ? m[1] : '';
}
// --- Auth hardening: timing-safe compare + HMAC-signed session tokens with real expiry ---
function timingSafeStrEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
	let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
async function hmacHex(keyStr, dataStr) {
	const enc = new TextEncoder();
	const k = await crypto.subtle.importKey('raw', enc.encode(String(keyStr)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(String(dataStr))));
	return [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
}
const NC_SESSION_MAX_AGE_MS = 7 * 86400000; // 7 days, matches the cookie Max-Age
// Token = "<issuedAt>.<HMAC(admin, 'nova-central|'+issuedAt)>": bound to the admin password
// (changing it invalidates all sessions) with a server-side expiry the cookie alone can't give.
async function makeSessionToken(admin, issuedAt = Date.now()) {
	return `${issuedAt}.${await hmacHex(admin, 'nova-central|' + issuedAt)}`;
}
async function verifySessionToken(token, admin) {
	if (!admin || !token || typeof token !== 'string') return false;
	const dot = token.indexOf('.'); if (dot <= 0) return false;
	const issuedAt = Number(token.slice(0, dot)); if (!Number.isFinite(issuedAt)) return false;
	const age = Date.now() - issuedAt; if (age > NC_SESSION_MAX_AGE_MS || age < -60000) return false;
	return timingSafeStrEqual(token, await makeSessionToken(admin, issuedAt));
}
async function isAuthed(request, admin) {
	if (!admin) return false;
	return await verifySessionToken(readCookie(request, 'nc_auth'), admin);
}
// Per-isolate login throttle (KV-free, to avoid a write-quota DoS). Best-effort; pair with a
// Cloudflare WAF rate-limit rule on /login for a hard fleet-wide guarantee.
const __ncLogin = new Map();
const NC_LOGIN_MAX = 8, NC_LOGIN_WIN = 600000, NC_LOGIN_BLOCK = 900000;
function loginRateCheck(ip) { const now = Date.now(); const r = __ncLogin.get(ip); if (r && r.blockedUntil && now < r.blockedUntil) return { allowed: false, retryAfter: Math.ceil((r.blockedUntil - now) / 1000) }; return { allowed: true }; }
function loginRecordFailure(ip) { const now = Date.now(); let r = __ncLogin.get(ip); if (!r || now - r.windowStart > NC_LOGIN_WIN) r = { count: 0, windowStart: now, blockedUntil: 0 }; r.count++; if (r.count >= NC_LOGIN_MAX) r.blockedUntil = now + NC_LOGIN_BLOCK; __ncLogin.set(ip, r); if (__ncLogin.size > 5000) { for (const [k, v] of __ncLogin) { if (!v.blockedUntil || now > v.blockedUntil) __ncLogin.delete(k); if (__ncLogin.size <= 4000) break; } } }
function loginRecordSuccess(ip) { __ncLogin.delete(ip); }
async function bearerOk(request, env) {
	const h = request.headers.get('Authorization') || '';
	if (!/^Bearer\s+/i.test(h)) return false;
	const tok = h.replace(/^Bearer\s+/i, '').trim();
	let cfg = {}; try { cfg = JSON.parse(await env.KV.get('central-config.json') || '{}'); } catch (e) {}
	const want = cfg.apiToken || env.CENTRAL_TOKEN || '';
	return !!want && timingSafeStrEqual(tok, want);
}
const kvGet = async (env, k, def) => { try { const v = await env.KV.get(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
const kvPut = (env, k, v) => env.KV.put(k, JSON.stringify(v));
function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function lineToIp(line) {
	const m = String(line || '').trim().replace(/^[a-z0-9]+:\/\//i, '').split('#')[0].split(/\s/)[0].trim();
	if (!m) return null;
	const mm = m.match(/^\[?([0-9a-fA-F:.]+)\]?(?::(\d+))?$/);
	if (mm && /[.:]/.test(mm[1])) return { ip: mm[1], port: Number(mm[2]) || 443 };
	return null;
}
function parseIpList(text) {
	let t = String(text || '').trim();
	if (/^[\[{]/.test(t)) { try { const j = JSON.parse(t); const arr = Array.isArray(j) ? j : (Array.isArray(j.results) ? j.results : (Array.isArray(j.ips) ? j.ips : [])); const out = arr.map(x => typeof x === 'string' ? lineToIp(x) : (x && x.ip ? { ip: x.ip, port: Number(x.port) || 443 } : null)).filter(Boolean); if (out.length) return out.slice(0, 500); } catch (e) {} }
	if (t && !/\n/.test(t) && /^[A-Za-z0-9+/=]+$/.test(t) && t.length > 24) { try { t = atob(t); } catch (e) {} }
	const out = []; for (const line of t.split(/\r?\n/)) { const v = lineToIp(line); if (v) out.push(v); }
	return out.slice(0, 500);
}
async function refreshPoolSources(env) {
	const sources = await kvGet(env, 'sources.json', {}); const pool = await kvGet(env, 'pool.json', {}); let changed = false;
	for (const asn of Object.keys(sources)) { try { const r = await fetch(sources[asn], { headers: { 'User-Agent': 'NovaCentral' } }); if (!r.ok) continue; const ips = parseIpList(await r.text()); if (ips.length) { pool[asn] = ips; changed = true; } } catch (e) {} }
	if (changed) await kvPut(env, 'pool.json', pool);
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, '') || '/';
		const admin = env.ADMIN || env.admin || env.PASSWORD || env.password;
		if (!env.KV) return new Response('KV not bound', { status: 500 });
		if (!admin) return new Response('Set the ADMIN secret first.', { status: 500 });

		// ---------- Public API (consumed by Nova instances) ----------
		if (path === '/heartbeat' && request.method === 'POST') {
			try {
				const b = await request.json();
				if (b && b.id) await env.KV.put('hb:' + String(b.id).slice(0, 64), JSON.stringify({ host: b.host || '', version: b.version || '', monthTraffic: Number(b.monthTraffic) || 0, ts: Date.now() }), { expirationTtl: 7 * 86400 });
				return json({ ok: true });
			} catch (e) { return json({ ok: false }, 400); }
		}
		if (path === '/announcement') {
			const a = await env.KV.get('announcement.json');
			return new Response(a || 'null', { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' } });
		}
		if (path === '/api/pool') {
			const asn = String(url.searchParams.get('asn') || '').trim();
			const pool = await kvGet(env, 'pool.json', {});
			const results = (asn && Array.isArray(pool[asn]) ? pool[asn] : (Array.isArray(pool['default']) ? pool['default'] : [])).map(x => ({ ip: x.ip, port: x.port || 443 }));
			return json({ asn, count: results.length, results });
		}
		if (path === '/api/warp') {
			const keys = await kvGet(env, 'warp-keys.json', []);
			return json({ count: keys.length, keys });
		}

		// ---------- Auth ----------
		if (path === '/login') {
			if (request.method === 'POST') {
				const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
				const rl = loginRateCheck(ip);
				if (!rl.allowed) return json({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfter) });
				let pw = '';
				try { const ct = request.headers.get('Content-Type') || ''; if (ct.includes('application/json')) pw = (await request.json()).password || ''; else { const f = await request.formData(); pw = f.get('password') || ''; } } catch (e) {}
				if (pw && timingSafeStrEqual(String(pw), String(admin))) {
					loginRecordSuccess(ip);
					return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': `nc_auth=${await makeSessionToken(admin)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` } });
				}
				loginRecordFailure(ip);
				return json({ ok: false, error: 'wrong password' }, 401);
			}
			return new Response(LOGIN_HTML, { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } });
		}
		if (path === '/logout') {
			return new Response('', { status: 302, headers: { 'Location': '/login', 'Set-Cookie': 'nc_auth=; Path=/; Max-Age=0' } });
		}

		// ---------- Admin (cookie or Bearer token) ----------
		if (path.startsWith('/admin/')) {
			const ok = (await isAuthed(request, admin)) || (await bearerOk(request, env));
			if (!ok) return json({ error: 'unauthorized' }, 401);

			if (path === '/admin/stats') {
				const list = await env.KV.list({ prefix: 'hb:' });
				let instances = [], totalTraffic = 0; const versions = {};
				for (const k of list.keys) {
					const v = await kvGet(env, k.name, null); if (!v) continue;
					instances.push({ host: v.host, version: v.version, monthTraffic: v.monthTraffic, ts: v.ts });
					totalTraffic += v.monthTraffic || 0; versions[v.version || '?'] = (versions[v.version || '?'] || 0) + 1;
				}
				instances.sort((a, b) => b.ts - a.ts);
				const active = instances.filter(i => Date.now() - i.ts < 86400000).length;
				const pool = await kvGet(env, 'pool.json', {}); const warp = await kvGet(env, 'warp-keys.json', []);
				const poolCount = Object.values(pool).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
				return json({ total: instances.length, active, totalTraffic, versions, poolCount, poolGroups: Object.keys(pool).length, warpCount: warp.length, instances: instances.slice(0, 200) });
			}
			if (path === '/admin/pool') {
				if (request.method === 'POST') { const b = await request.json().catch(() => ({})); await kvPut(env, 'pool.json', (b && b.pool && typeof b.pool === 'object') ? b.pool : {}); return json({ ok: true }); }
				return json({ pool: await kvGet(env, 'pool.json', {}) });
			}
			if (path === '/admin/sources') {
				if (request.method === 'POST') { const b = await request.json().catch(() => ({})); await kvPut(env, 'sources.json', (b && b.sources && typeof b.sources === 'object') ? b.sources : {}); return json({ ok: true }); }
				return json({ sources: await kvGet(env, 'sources.json', {}) });
			}
			if (path === '/admin/pool-import' && request.method === 'POST') {
				const b = await request.json().catch(() => ({}));
				const asn = String(b.asn || '').trim().replace(/^AS/i, ''); const src = String(b.url || '').trim();
				if (!asn || !src) return json({ error: 'asn and url required' }, 400);
				let txt = ''; try { const r = await fetch(src, { headers: { 'User-Agent': 'NovaCentral' } }); if (!r.ok) throw new Error('HTTP ' + r.status); txt = await r.text(); } catch (e) { return json({ error: String(e.message || e) }, 502); }
				const ips = parseIpList(txt); if (!ips.length) return json({ error: 'no IPs parsed from source' }, 422);
				const pool = await kvGet(env, 'pool.json', {}); pool[asn] = ips; await kvPut(env, 'pool.json', pool);
				const sources = await kvGet(env, 'sources.json', {}); sources[asn] = src; await kvPut(env, 'sources.json', sources);
				return json({ ok: true, count: ips.length });
			}
			if (path === '/admin/warp') {
				if (request.method === 'POST') { const b = await request.json().catch(() => ({})); await kvPut(env, 'warp-keys.json', Array.isArray(b.keys) ? b.keys.filter(Boolean) : []); return json({ ok: true }); }
				return json({ keys: await kvGet(env, 'warp-keys.json', []) });
			}
			if (path === '/admin/announcement' || path === '/admin/broadcast') {
				if (request.method === 'POST') {
					const b = await request.text(); await env.KV.put('announcement.json', b || 'null');
					let telegram = false;
					try {
						const ann = JSON.parse(b || 'null');
						if (ann && (ann.text || ann.title)) {
							const cfg = await kvGet(env, 'central-config.json', {});
							const tok = cfg.tgBotToken || env.TG_BOT_TOKEN || '';
							const chan = cfg.tgChannel || env.TG_CHANNEL || '';
							if (tok && chan) {
								const msg = (ann.title ? '<b>' + esc(ann.title) + '</b>\n\n' : '') + esc(ann.text || '') + (ann.url ? '\n\n' + esc(ann.url) : '');
								const tr = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chan, parse_mode: 'HTML', text: msg }) });
								telegram = tr.ok;
							}
						}
					} catch (e) {}
					return json({ ok: true, telegram });
				}
				return new Response(await env.KV.get('announcement.json') || 'null', { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
			}
			if (path === '/admin/tg') {
				let cfg = await kvGet(env, 'central-config.json', {});
				if (request.method === 'POST') { const b = await request.json().catch(() => ({})); if (b.botToken !== undefined) cfg.tgBotToken = String(b.botToken || '').trim(); if (b.channel !== undefined) cfg.tgChannel = String(b.channel || '').trim(); await kvPut(env, 'central-config.json', cfg); return json({ ok: true }); }
				return json({ channel: cfg.tgChannel || '', botSet: !!cfg.tgBotToken });
			}
			if (path === '/admin/token') {
				let cfg = await kvGet(env, 'central-config.json', {});
				if (request.method === 'POST') { cfg.apiToken = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ''); await kvPut(env, 'central-config.json', cfg); }
				return json({ apiToken: cfg.apiToken || '', poolApi: url.origin + '/api/pool', centralApi: url.origin });
			}
			return json({ error: 'not found' }, 404);
		}

		// ---------- Panel ----------
		if (path === '/' || path === '/admin') {
			if (!(await isAuthed(request, admin))) return new Response('', { status: 302, headers: { 'Location': '/login' } });
			return new Response(PANEL_HTML, { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } });
		}
		return new Response('Nova Central ' + VERSION, { status: 404 });
	},
	async scheduled(event, env, ctx) {
		ctx.waitUntil(refreshPoolSources(env).catch(e => console.error('refreshPoolSources:', e && e.message)));
	}
};

const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Inter,Vazirmatn,system-ui,Tahoma,sans-serif;background:#070809;color:#e9edf4;font-size:14px;min-height:100vh}
a{color:#22d3ee}.wrap{max-width:1040px;margin:0 auto;padding:20px}
.top{display:flex;align-items:center;gap:12px;padding:14px 0 20px;border-bottom:1px solid #1c2027;margin-bottom:20px}
.lg{width:34px;height:34px;border-radius:9px;background:linear-gradient(120deg,#22d3ee,#7c5cff);display:flex;align-items:center;justify-content:center;font-weight:800}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.tab{padding:8px 14px;border-radius:9px;background:#0c0e12;border:1px solid #1c2027;color:#aeb6c4;cursor:pointer;font-weight:600;font-size:13px}
.tab.on{background:#101319;color:#e9edf4;border-color:#22d3ee}
.card{background:#101319;border:1px solid #1c2027;border-radius:12px;padding:18px 20px;margin-bottom:16px}
.card h3{font-size:11px;color:#6f7888;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px}
.kv{background:#0b0d11;border:1px solid #1c2027;border-radius:10px;padding:13px 14px}.kv .k{font-size:10.5px;color:#6f7888;text-transform:uppercase}.kv .v{font-size:20px;font-weight:700;margin-top:5px}
input,textarea,select{width:100%;background:#0b0d11;border:1px solid #262b34;border-radius:9px;color:#e9edf4;padding:10px 12px;font:inherit;margin-bottom:10px}
textarea{min-height:120px;font-family:ui-monospace,monospace;font-size:12px}
.b{background:linear-gradient(120deg,#22d3ee,#7c5cff);color:#fff;border:none;border-radius:9px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer}
.b.g{background:#0c0e12;border:1px solid #262b34;color:#e9edf4}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{text-align:start;padding:8px;border-bottom:1px solid #1c2027}th{color:#6f7888;font-weight:700}
.hint{color:#6f7888;font-size:12px;margin:6px 0}.ok{color:#34d399}.warn{color:#f5b042}code{background:#0b0d11;padding:2px 6px;border-radius:6px;font-family:ui-monospace,monospace}`;

const LOGIN_HTML = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova Central — ورود</title><style>${BASE_CSS}.box{max-width:380px;margin:12vh auto}</style></head><body><div class="wrap"><div class="box"><div class="top"><div class="lg">N</div><div><b>Nova Central</b><div class="hint">پنل مدیریت مرکزی</div></div></div><div class="card"><h3>ورود</h3><input id="pw" type="password" placeholder="رمز عبور مدیر" /><button class="b" style="width:100%" id="go">ورود</button><div class="hint" id="msg"></div></div></div></div>
<script>const $=s=>document.querySelector(s);async function login(){const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#pw').value})});if(r.ok)location.href='/admin';else $('#msg').textContent='رمز اشتباه است';}
$('#go').onclick=login;$('#pw').addEventListener('keydown',e=>{if(e.key==='Enter')login();});</script></body></html>`;

const PANEL_HTML = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova Central</title><style>${BASE_CSS}</style></head><body><div class="wrap">
<div class="top"><div class="lg">N</div><div style="flex:1"><b>Nova Central — کنترل مرکزی</b><div class="hint">مدیریت آی‌پی‌ها، WARP، اعلان همگانی و آمار نمونه‌ها</div></div><a class="b g" href="/logout" style="text-decoration:none">خروج</a></div>
<div class="tabs"><div class="tab on" data-t="dash">📊 داشبورد</div><div class="tab" data-t="src">🌐 منابع آی‌پی</div><div class="tab" data-t="warp">🛡 کلیدهای WARP+</div><div class="tab" data-t="bc">📣 اعلان همگانی</div><div class="tab" data-t="api">🔑 API</div></div>

<div class="page" id="p-dash">
<div class="grid" style="margin-bottom:16px">
<div class="kv"><div class="k">نمونه‌های فعال (۲۴ساعت)</div><div class="v" id="s-active">…</div></div>
<div class="kv"><div class="k">کل نمونه‌ها</div><div class="v" id="s-total">…</div></div>
<div class="kv"><div class="k">ترافیک ماه (مجموع)</div><div class="v" id="s-traffic">…</div></div>
<div class="kv"><div class="k">آی‌پی‌ها / کلیدهای WARP</div><div class="v" id="s-pw">…</div></div>
</div>
<div class="card"><h3>نمونه‌هایی که از API استفاده می‌کنند</h3><div style="overflow-x:auto"><table id="inst"><tr><th>میزبان</th><th>نسخه</th><th>ترافیک ماه</th><th>آخرین فعالیت</th></tr></table></div></div>
</div>

<div class="page" id="p-src" style="display:none">
<div class="card"><h3>منابع آی‌پی هر اپراتور (ASN)</h3>
<div class="hint">هر بخش با شمارهٔ ASN. این‌ها از طریق <code>/api/pool?asn=…</code> در دسترس عموم نمونه‌ها قرار می‌گیرند. فرمت هر خط: <code>ip:port</code></div>
<div id="pool-groups"></div>
<div class="row" style="margin-top:8px"><input id="new-asn" placeholder="ASN جدید (مثلا 44244) یا default" style="max-width:220px;margin:0" /><button class="b g" id="add-asn">+ افزودن بخش</button></div>
<button class="b" id="save-pool" style="margin-top:12px">ذخیره منابع</button> <span class="hint" id="pool-msg"></span></div><div class="card"><h3>دریافت خودکار از URL</h3><div class="hint">آی‌پی‌های یک بخش را از یک لینک (GitHub/هاست) بگیر؛ هر ساعت هم خودکار به‌روز می‌شود. فرمت‌ها: لیست ip:port، base64، یا JSON.</div><div class="row"><input id="imp-asn" placeholder="ASN (مثلا 44244) یا default" style="max-width:220px;margin:0"/><input id="imp-url" placeholder="https://…/ips.txt" style="flex:1;margin:0"/><button class="b" id="imp-go">دریافت</button></div><div id="imp-list" class="hint" style="margin-top:8px"></div></div>
</div>

<div class="page" id="p-warp" style="display:none">
<div class="card"><h3>استخر کلیدهای WARP+</h3>
<div class="hint">هر خط یک کلید WARP+. نمونه‌های متصل از <code>/api/warp</code> این‌ها را می‌خوانند و بینشان می‌چرخند تا یکی که کار می‌کند اعمال شود.</div>
<textarea id="warp-keys" placeholder="xxxxxxxx-xxxxxxxx-xxxxxxxx&#10;yyyyyyyy-yyyyyyyy-yyyyyyyy"></textarea>
<button class="b" id="save-warp">ذخیره کلیدها</button> <span class="hint" id="warp-msg"></span></div>
</div>

<div class="page" id="p-bc" style="display:none">
<div class="card"><h3>ارسال پیام همگانی</h3>
<div class="hint">این پیام به‌صورت بنر در زنگولهٔ همهٔ پنل‌های متصل نمایش داده می‌شود.</div>
<input id="bc-title" placeholder="عنوان (مثلا: بروزرسانی نوا)" />
<textarea id="bc-text" placeholder="متن پیام… مثلا: نسخهٔ جدید نوا منتشر شد، لطفاً از وب‌سایت و گیت‌هاب دانلود کنید."></textarea>
<input id="bc-link" placeholder="لینک (اختیاری) https://novaproxy.online" />
<div class="row"><button class="b" id="send-bc">ارسال به همه</button><button class="b g" id="clear-bc">حذف اعلان</button><span class="hint" id="bc-msg"></span></div></div><div class="card"><h3>اتصال تلگرام (اختیاری)</h3><div class="hint">اگر تنظیم شود، هر اعلان همگانی به این کانال هم ارسال می‌شود (ربات باید ادمین کانال باشد).</div><input id="tg-token" type="password" placeholder="توکن ربات تلگرام" /><input id="tg-chan" placeholder="آیدی کانال (مثلا @irnova_proxy یا -100…)" /><button class="b g" id="tg-save">ذخیره</button> <span class="hint" id="tg-msg"></span></div>
</div>

<div class="page" id="p-api" style="display:none">
<div class="card"><h3>مدیریت API</h3>
<div class="hint">این آدرس‌ها را در نمونه‌های نوا ست کنید (پنل ← تنظیمات/پیشرفته).</div>
<p class="hint">POOL_API: <code id="a-pool">…</code></p>
<p class="hint">CENTRAL_API: <code id="a-central">…</code></p>
<p class="hint">توکن مدیریت (برای نوشتن از نمونه‌ها): <code id="a-token">…</code></p>
<button class="b g" id="reset-token">🔄 ریست/تغییر توکن API</button> <span class="hint" id="api-msg"></span></div>
</div>

</div>
<script>
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
function fmt(b){b=Number(b)||0;const u=['B','KB','MB','GB','TB'];let i=0;while(b>=1024&&i<u.length-1){b/=1024;i++;}return (i?b.toFixed(2):b)+' '+u[i];}
function ago(ts){const s=(Date.now()-ts)/1000;if(s<60)return 'الان';if(s<3600)return Math.floor(s/60)+'د پیش';if(s<86400)return Math.floor(s/3600)+'س پیش';return Math.floor(s/86400)+'ر پیش';}
$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('on',x===t));$$('.page').forEach(p=>p.style.display='none');$('#p-'+t.dataset.t).style.display='block';if(t.dataset.t==='dash')loadDash();});
async function loadDash(){const d=await fetch('/admin/stats').then(r=>r.json());$('#s-active').textContent=d.active;$('#s-total').textContent=d.total;$('#s-traffic').textContent=fmt(d.totalTraffic);$('#s-pw').textContent=d.poolCount+' / '+d.warpCount;
$('#inst').innerHTML='<tr><th>میزبان</th><th>نسخه</th><th>ترافیک ماه</th><th>آخرین فعالیت</th></tr>'+(d.instances||[]).map(i=>'<tr><td><code>'+(i.host||'-')+'</code></td><td>'+(i.version||'-')+'</td><td>'+fmt(i.monthTraffic)+'</td><td>'+ago(i.ts)+'</td></tr>').join('');}
// pool
let pool={};
function renderPool(){const box=$('#pool-groups');box.innerHTML=Object.keys(pool).map(asn=>'<div class="card" style="background:#0b0d11"><div class="row" style="justify-content:space-between"><b>'+(asn==='default'?'پیش‌فرض (همه)':'AS'+asn)+'</b><button class="b g" data-del="'+asn+'" style="padding:6px 12px">حذف</button></div><textarea data-asn="'+asn+'" placeholder="1.2.3.4:443">'+(pool[asn]||[]).map(x=>x.ip+':'+(x.port||443)).join('\\n')+'</textarea></div>').join('')||'<div class="hint">هنوز بخشی نیست.</div>';
box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{collectPool();delete pool[b.dataset.del];renderPool();});}
function collectPool(){$$('#pool-groups [data-asn]').forEach(t=>{pool[t.dataset.asn]=t.value.split('\\n').map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.replace(/^https?:\\/\\//,'').split('#')[0].trim();const i=m.lastIndexOf(':');return i>0?{ip:m.slice(0,i),port:Number(m.slice(i+1))||443}:{ip:m,port:443};});});}
async function loadPool(){pool=(await fetch('/admin/pool').then(r=>r.json())).pool||{};renderPool();}
$('#add-asn').onclick=()=>{collectPool();const a=$('#new-asn').value.trim().replace(/^AS/i,'');if(a&&!pool[a]){pool[a]=[];$('#new-asn').value='';renderPool();}};
$('#save-pool').onclick=async()=>{collectPool();const r=await fetch('/admin/pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pool})});$('#pool-msg').textContent=r.ok?'✅ ذخیره شد':'⚠️ خطا';};async function loadSources(){try{const sc=(await fetch('/admin/sources').then(r=>r.json())).sources||{};const ks=Object.keys(sc);$('#imp-list').innerHTML=ks.length?('منابع خودکار فعال: '+ks.map(a=>(a==='default'?'پیش‌فرض':'AS'+a)).join('، ')):'';}catch(e){}}if($('#imp-go'))$('#imp-go').onclick=async()=>{const asn=$('#imp-asn').value.trim().replace(/^AS/i,'');const url=$('#imp-url').value.trim();if(!asn||!url){$('#imp-list').textContent='ASN و URL لازم است';return;}$('#imp-go').disabled=true;$('#imp-list').textContent='در حال دریافت…';try{const r=await fetch('/admin/pool-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asn,url})});const j=await r.json();if(r.ok){$('#imp-list').textContent='✅ '+j.count+' آی‌پی برای '+(asn==='default'?'پیش‌فرض':'AS'+asn)+' ذخیره شد';$('#imp-url').value='';await loadPool();loadSources();}else{$('#imp-list').textContent='⚠️ '+(j.error||r.status);}}catch(e){$('#imp-list').textContent='⚠️ '+e.message;}finally{$('#imp-go').disabled=false;}};
// warp
async function loadWarp(){const k=(await fetch('/admin/warp').then(r=>r.json())).keys||[];$('#warp-keys').value=k.join('\\n');}
$('#save-warp').onclick=async()=>{const keys=$('#warp-keys').value.split('\\n').map(s=>s.trim()).filter(Boolean);const r=await fetch('/admin/warp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys})});$('#warp-msg').textContent=r.ok?('✅ '+keys.length+' کلید ذخیره شد'):'⚠️ خطا';};
// broadcast
async function loadBc(){try{const a=await fetch('/admin/announcement').then(r=>r.json());if(a){$('#bc-title').value=a.title||'';$('#bc-text').value=a.text||'';$('#bc-link').value=a.url||'';}}catch(e){}}
$('#send-bc').onclick=async()=>{const body={title:$('#bc-title').value.trim(),text:$('#bc-text').value.trim(),url:$('#bc-link').value.trim(),ts:Date.now()};const r=await fetch('/admin/broadcast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));$('#bc-msg').textContent=r.ok?('✅ ارسال شد'+(j.telegram?' + به تلگرام':'')):'⚠️ خطا';};async function loadTg(){try{const d=await fetch('/admin/tg').then(r=>r.json());$('#tg-chan').value=d.channel||'';$('#tg-token').placeholder=d.botSet?'•••••• (تنظیم شده)':'توکن ربات تلگرام';}catch(e){}}if($('#tg-save'))$('#tg-save').onclick=async()=>{const body={channel:$('#tg-chan').value.trim()};if($('#tg-token').value.trim())body.botToken=$('#tg-token').value.trim();const r=await fetch('/admin/tg',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});$('#tg-msg').textContent=r.ok?'✅ ذخیره شد':'⚠️ خطا';$('#tg-token').value='';loadTg();};
$('#clear-bc').onclick=async()=>{const r=await fetch('/admin/broadcast',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});$('#bc-msg').textContent=r.ok?'✅ حذف شد':'⚠️ خطا';$('#bc-title').value='';$('#bc-text').value='';$('#bc-link').value='';};
// api
async function loadApi(){const d=await fetch('/admin/token').then(r=>r.json());$('#a-pool').textContent=d.poolApi;$('#a-central').textContent=d.centralApi;$('#a-token').textContent=d.apiToken||'(تنظیم نشده)';}
$('#reset-token').onclick=async()=>{if(!confirm('توکن جدید ساخته شود؟ نمونه‌هایی که توکن قدیم دارند باید بروز شوند.'))return;const d=await fetch('/admin/token',{method:'POST'}).then(r=>r.json());$('#a-token').textContent=d.apiToken;$('#api-msg').textContent='✅ توکن جدید ساخته شد';};
loadDash();loadPool();loadSources();loadWarp();loadBc();loadTg();loadApi();
</script></body></html>`;
