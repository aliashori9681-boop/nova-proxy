// Nova Central Management Worker — a SEPARATE Cloudflare Worker (own front + back end).
//
// This is the "central API" the Nova proxy workers already talk to. Each proxy worker is
// pointed at this worker's URL via its CENTRAL_API env / panel "Central API" field, and then:
//   - reports a privacy-safe hourly heartbeat (so you can count instances + total traffic),
//   - pulls the current broadcast announcement (shown as a banner/bell in each client panel).
//
// You manage everything from THIS worker's own page (served at "/"), gated by ADMIN_TOKEN.
// The proxy panels only store the API URL — management lives here, not in the client panels.
//
// Endpoints (contract matches nova-proxy-worker's hooks — see CENTRAL_SERVER.md):
//   POST /heartbeat            { id, host, version, monthTraffic, ts }     -> { ok }
//   GET  /announcement         -> { title, text, url } | null
//   GET  /stats   (Bearer)     -> { instances, activeInstances, totalTrafficHuman, list }
//   POST /admin/announcement (Bearer) { title, text, url }  (empty text clears) -> { ok }
//   GET  /                     -> admin UI (HTML)
//
// Storage: one KV namespace bound as MGMT_KV. Instance rows auto-expire after INSTANCE_TTL
// so "active" simply means "still present". Heartbeats are hourly, so KV writes stay well
// within the free tier for a personal fleet.

const INSTANCE_TTL = 2 * 60 * 60; // seconds; an instance is "active" if seen within this window
const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(obj, status = 200, extra = {}) {
	return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json;charset=utf-8', ...CORS, ...extra } });
}

function formatBytes(bytes) {
	bytes = Number(bytes) || 0;
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	let i = 0;
	while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
	return bytes.toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
}

// Constant-time compare so the token isn't guessable byte-by-byte via response timing.
function timingSafeStrEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
	let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
function authed(request, env) {
	const tok = (env.ADMIN_TOKEN || '').trim();
	if (!tok) return false;
	const h = request.headers.get('Authorization') || '';
	return timingSafeStrEqual(h, 'Bearer ' + tok);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, '') || '/';
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
		if (!env.MGMT_KV) return json({ ok: false, error: 'MGMT_KV not bound' }, 500);

		try {
			// --- proxy worker -> central: hourly heartbeat ---
			if (path === '/heartbeat' && request.method === 'POST') {
				let b = {}; try { b = await request.json(); } catch (e) {}
				const id = String(b.id || '').slice(0, 64);
				if (!id) return json({ ok: false, error: 'missing id' }, 400);
				const row = {
					id,
					host: String(b.host || '').slice(0, 128),
					version: String(b.version || '').slice(0, 32),
					monthTraffic: Number(b.monthTraffic) || 0,
					lastSeen: Date.now(),
				};
				await env.MGMT_KV.put('inst:' + id, JSON.stringify(row), { expirationTtl: INSTANCE_TTL });
				return json({ ok: true });
			}

			// --- proxy worker -> central: current broadcast ---
			if (path === '/announcement' && request.method === 'GET') {
				const a = await env.MGMT_KV.get('announcement');
				return new Response(a || 'null', { status: 200, headers: { 'Content-Type': 'application/json;charset=utf-8', ...CORS } });
			}

			// --- admin: fleet stats ---
			if (path === '/stats' && request.method === 'GET') {
				if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
				let cursor, names = [];
				do {
					const list = await env.MGMT_KV.list({ prefix: 'inst:', cursor });
					for (const k of list.keys) names.push(k.name);
					cursor = list.list_complete ? null : list.cursor;
				} while (cursor);
				const now = Date.now();
				let total = 0, active = 0, rows = [];
				for (const name of names) {
					let r; try { r = JSON.parse(await env.MGMT_KV.get(name) || 'null'); } catch (e) { r = null; }
					if (!r) continue;
					total += Number(r.monthTraffic) || 0;
					const isActive = (now - (r.lastSeen || 0)) < INSTANCE_TTL * 1000;
					if (isActive) active++;
					rows.push({ host: r.host, version: r.version, monthTraffic: r.monthTraffic, monthTrafficHuman: formatBytes(r.monthTraffic), lastSeen: r.lastSeen, active: isActive });
				}
				rows.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
				return json({ instances: rows.length, activeInstances: active, totalTraffic: total, totalTrafficHuman: formatBytes(total), list: rows });
			}

			// --- admin: set/clear the broadcast ---
			if (path === '/admin/announcement' && request.method === 'POST') {
				if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
				let b = {}; try { b = await request.json(); } catch (e) {}
				const text = String(b.text || '').slice(0, 2000).trim();
				if (!text) { await env.MGMT_KV.delete('announcement'); return json({ ok: true, cleared: true }); }
				const ann = { title: String(b.title || '').slice(0, 200), text, url: String(b.url || '').slice(0, 500), ts: Date.now() };
				await env.MGMT_KV.put('announcement', JSON.stringify(ann));
				return json({ ok: true, announcement: ann });
			}

			// --- admin UI ---
			if (path === '/' && request.method === 'GET') {
				return new Response(ADMIN_HTML, { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
			}

			return json({ ok: false, error: 'not found' }, 404);
		} catch (e) {
			return json({ ok: false, error: e && e.message ? e.message : String(e) }, 500);
		}
	},
};

const ADMIN_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nova Central Management</title>
<style>
:root{--bg:#0f1220;--card:#1a1f33;--bd:#2a3150;--mu:#8b93b8;--fg:#e8ecfb;--pri:#6d8cff;--ok:#22c55e}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg);padding:24px}
.wrap{max-width:880px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mu);font-size:13px;margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px;margin-bottom:16px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
input,textarea{background:#0d1020;border:1px solid var(--bd);color:var(--fg);border-radius:9px;padding:10px 12px;font:inherit;width:100%}
textarea{min-height:70px;resize:vertical}label{font-size:12px;color:var(--mu);display:block;margin:10px 0 4px}
button{background:var(--pri);color:#fff;border:0;border-radius:9px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;border:1px solid var(--bd);color:var(--fg)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.stat{background:#0d1020;border:1px solid var(--bd);border-radius:11px;padding:14px}
.stat .v{font-size:24px;font-weight:800}.stat .l{color:var(--mu);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--bd)}
th{color:var(--mu);font-weight:600}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#555;margin-right:6px}.dot.on{background:var(--ok)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:9px 18px;border-radius:9px;opacity:0;transition:.3s;font-size:13px}.toast.show{opacity:1}
.mu{color:var(--mu);font-size:12px}
</style></head><body><div class="wrap">
<h1>Nova Central Management</h1>
<p class="sub">Fleet overview + broadcast for all Nova proxy workers pointed at this API.</p>

<div class="card" id="auth-card">
<label>Admin token</label>
<div class="row"><input id="tok" type="password" placeholder="ADMIN_TOKEN" autocomplete="off" style="flex:1;min-width:200px"/><button id="login">Connect</button></div>
<p class="mu" style="margin-top:8px">Stored only in this browser (localStorage). Set ADMIN_TOKEN as a secret on this worker.</p>
</div>

<div id="app" style="display:none">
<div class="card">
<div class="stats">
<div class="stat"><div class="v" id="s-active">–</div><div class="l">Active instances (&lt; 2h)</div></div>
<div class="stat"><div class="v" id="s-total">–</div><div class="l">Known instances</div></div>
<div class="stat"><div class="v" id="s-traffic">–</div><div class="l">Total traffic (this month)</div></div>
</div>
<div class="row" style="margin-top:12px"><button class="ghost" id="refresh">Refresh</button> <span class="mu" id="updated"></span></div>
<table id="tbl"><thead><tr><th>Host</th><th>Version</th><th>Traffic (mo)</th><th>Last seen</th></tr></thead><tbody></tbody></table>
</div>

<div class="card">
<h3 style="margin:0 0 4px;font-size:15px">Broadcast announcement</h3>
<p class="mu" style="margin:0 0 8px">Shown as a banner/bell in every client panel. Leave text empty and Save to clear.</p>
<label>Title (optional)</label><input id="a-title" placeholder="Maintenance notice"/>
<label>Text</label><textarea id="a-text" placeholder="Message shown to all users…"></textarea>
<label>Link (optional)</label><input id="a-url" placeholder="https://novaproxy.online"/>
<div class="row" style="margin-top:12px"><button id="a-save">Save broadcast</button><button class="ghost" id="a-clear">Clear</button></div>
</div>
</div>
</div>
<div class="toast" id="toast"></div>
<script>
var $=function(id){return document.getElementById(id)};
var TOK='';
function toast(m){var t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2200);}
function hdr(){return {'Authorization':'Bearer '+TOK,'Content-Type':'application/json'};}
async function loadStats(){
  try{
    var r=await fetch('/stats',{headers:hdr()});
    if(r.status===401){toast('Bad token');return false;}
    var d=await r.json();
    $('s-active').textContent=d.activeInstances;$('s-total').textContent=d.instances;$('s-traffic').textContent=d.totalTrafficHuman;
    var tb=$('tbl').querySelector('tbody');tb.innerHTML='';
    (d.list||[]).forEach(function(x){
      var tr=document.createElement('tr');
      var seen=x.lastSeen?new Date(x.lastSeen).toLocaleString():'-';
      tr.innerHTML='<td><span class="dot'+(x.active?' on':'')+'"></span>'+(x.host||'?')+'</td><td>'+(x.version||'-')+'</td><td>'+x.monthTrafficHuman+'</td><td>'+seen+'</td>';
      tb.appendChild(tr);
    });
    $('updated').textContent='Updated '+new Date().toLocaleTimeString();
    return true;
  }catch(e){toast('Error: '+e.message);return false;}
}
async function loadAnnouncement(){
  try{var r=await fetch('/announcement');var a=await r.json();if(a){$('a-title').value=a.title||'';$('a-text').value=a.text||'';$('a-url').value=a.url||'';}}catch(e){}
}
$('login').onclick=async function(){
  TOK=$('tok').value.trim();if(!TOK)return;
  var ok=await loadStats();
  if(ok){localStorage.setItem('nova_mgmt_tok',TOK);$('auth-card').style.display='none';$('app').style.display='block';loadAnnouncement();}
};
$('refresh').onclick=loadStats;
$('a-save').onclick=async function(){
  var body={title:$('a-title').value,text:$('a-text').value,url:$('a-url').value};
  var r=await fetch('/admin/announcement',{method:'POST',headers:hdr(),body:JSON.stringify(body)});
  toast(r.ok?(body.text.trim()?'Broadcast saved':'Broadcast cleared'):'Failed');
};
$('a-clear').onclick=async function(){
  $('a-text').value='';
  var r=await fetch('/admin/announcement',{method:'POST',headers:hdr(),body:JSON.stringify({text:''})});
  toast(r.ok?'Cleared':'Failed');$('a-title').value='';$('a-url').value='';
};
(function(){var t=localStorage.getItem('nova_mgmt_tok');if(t){TOK=t;loadStats().then(function(ok){if(ok){$('auth-card').style.display='none';$('app').style.display='block';loadAnnouncement();}});}})();
</script>
</body></html>`;
