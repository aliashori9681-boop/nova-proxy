// ===================================================================
// Nova Installer — one-click deploy WITHOUT a GitHub account.
//
// Deploy THIS worker once (you, the maintainer), e.g. at install.novaproxy.online.
// Then a user with no GitHub just:
//   1) creates a scoped Cloudflare API token (link + exact scopes shown on the page),
//   2) pastes it here, picks a worker name, clicks Install.
// The installer then, via the Cloudflare API, creates a KV namespace, uploads the
// self-contained Nova worker (dist/worker.single.js) with the KV binding, enables
// the *.workers.dev URL, and hands back the link to finish at /install.
//
// The token is used transiently to make the API calls and is NEVER stored or logged.
// env (optional):
//   SOURCE_URL  - raw URL of the single-file worker to install
//                 (default: iiviirv main dist/worker.single.js)
// ===================================================================
const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/iiviirv/nova-proxy-worker/main/dist/worker.single.js';
const CF = 'https://api.cloudflare.com/client/v4';

function json(obj, status = 200) {
	return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function cf(token, method, path, body, isForm) {
	const headers = { 'Authorization': 'Bearer ' + token };
	if (body && !isForm) headers['Content-Type'] = 'application/json';
	const r = await fetch(CF + path, { method, headers, body: isForm ? body : (body ? JSON.stringify(body) : undefined) });
	let j = {}; try { j = await r.json(); } catch (e) {}
	return { ok: r.ok && j && j.success !== false, status: r.status, j };
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, '') || '/';

		if (path === '/api/install' && request.method === 'POST') {
			const steps = [];
			try {
				const body = await request.json().catch(() => ({}));
				const token = String(body.token || '').trim();
				let account = String(body.account || '').trim();
				const name = (String(body.name || 'nova').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'nova').slice(0, 50);
				if (!token) return json({ ok: false, error: 'Paste your Cloudflare API token first.' }, 400);

				// 1) Resolve the account id (auto if the token can read accounts).
				if (!account) {
					const a = await cf(token, 'GET', '/accounts?per_page=50');
					if (!a.ok) return json({ ok: false, error: 'Could not read your accounts — check the token, or paste your Account ID manually. (' + (a.j?.errors?.[0]?.message || ('HTTP ' + a.status)) + ')' }, 400);
					const list = a.j.result || [];
					if (!list.length) return json({ ok: false, error: 'No Cloudflare account found for this token.' }, 400);
					if (list.length > 1 && !account) { account = list[0].id; steps.push('Multiple accounts — using the first: ' + (list[0].name || account)); }
					else account = list[0].id;
				}
				steps.push('Account: ' + account);

				// 2) Fetch the latest self-contained Nova worker.
				const srcRes = await fetch(env.SOURCE_URL || DEFAULT_SOURCE, { headers: { 'User-Agent': 'NovaInstaller' } });
				if (!srcRes.ok) return json({ ok: false, error: 'Could not fetch the Nova worker source (HTTP ' + srcRes.status + ').' }, 502);
				const scriptText = await srcRes.text();
				if (scriptText.length < 50000) return json({ ok: false, error: 'Fetched source looks wrong/empty.' }, 502);
				steps.push('Fetched Nova worker (' + Math.round(scriptText.length / 1024) + ' KB)');

				// 3) Create (or reuse) a KV namespace.
				const title = ('nova-' + name + '-KV').slice(0, 64);
				let kvId = '';
				const mk = await cf(token, 'POST', `/accounts/${account}/storage/kv/namespaces`, { title });
				if (mk.ok) { kvId = mk.j.result.id; steps.push('Created KV namespace ' + title); }
				else {
					// maybe it already exists — find it
					const ls = await cf(token, 'GET', `/accounts/${account}/storage/kv/namespaces?per_page=100`);
					const found = ls.ok && (ls.j.result || []).find(n => n.title === title);
					if (found) { kvId = found.id; steps.push('Reusing existing KV namespace ' + title); }
					else return json({ ok: false, error: 'KV create failed — token needs "Workers KV Storage:Edit". (' + (mk.j?.errors?.[0]?.message || ('HTTP ' + mk.status)) + ')', steps }, 400);
				}

				// 4) Upload the worker (modules format) with the KV binding.
				const metadata = {
					main_module: 'worker.js',
					compatibility_date: '2024-11-01',
					bindings: [{ type: 'kv_namespace', name: 'KV', namespace_id: kvId }],
					observability: { enabled: true },
				};
				const form = new FormData();
				form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
				form.append('worker.js', new Blob([scriptText], { type: 'application/javascript+module' }), 'worker.js');
				const up = await cf(token, 'PUT', `/accounts/${account}/workers/scripts/${name}`, form, true);
				if (!up.ok) return json({ ok: false, error: 'Worker upload failed — token needs "Workers Scripts:Edit". (' + (up.j?.errors?.[0]?.message || ('HTTP ' + up.status)) + ')', steps }, 400);
				steps.push('Uploaded worker "' + name + '" with KV binding');

				// 5) Enable the *.workers.dev URL. Deliberately NO cron: a free workers.dev deploy
				// stays passive (no automatic outbound) so it doesn't trip Cloudflare's "Network
				// abuse" detection. Maintenance can be enabled later on a custom domain via ENABLE_CRON=1.
				await cf(token, 'POST', `/accounts/${account}/workers/scripts/${name}/subdomain`, { enabled: true });
				let workerUrl = '';
				const sub = await cf(token, 'GET', `/accounts/${account}/workers/subdomain`);
				if (sub.ok && sub.j.result && sub.j.result.subdomain) workerUrl = `https://${name}.${sub.j.result.subdomain}.workers.dev`;
				steps.push('Enabled workers.dev URL');

				return json({ ok: true, name, workerUrl, installUrl: workerUrl ? workerUrl + '/install' : '', steps });
			} catch (e) {
				return json({ ok: false, error: String(e && e.message || e), steps }, 500);
			}
		}

		return new Response(PAGE, { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } });
	}
};

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Install Nova Proxy — no GitHub needed</title>
<style>
:root{--bg:#0b0d11;--card:#11151c;--bd:#222833;--tx:#e9edf4;--mu:#9aa4b2;--ac:#7c5cff}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Tahoma,sans-serif;background:var(--bg);color:var(--tx);display:flex;min-height:100vh;align-items:flex-start;justify-content:center;padding:24px}
.c{width:100%;max-width:560px}
h1{font-size:22px;margin:6px 0 4px}.sub{color:var(--mu);font-size:14px;margin:0 0 18px;line-height:1.6}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:18px;margin-bottom:14px}
label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--mu);margin:12px 0 6px}
input{width:100%;background:#0b0d11;border:1px solid var(--bd);border-radius:9px;padding:12px;color:var(--tx);font-size:16px;font-family:inherit}
.b{width:100%;margin-top:18px;background:linear-gradient(120deg,#22d3ee,#7c5cff);color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer}
.b:disabled{opacity:.6}
.hint{font-size:12.5px;color:var(--mu);line-height:1.7;margin-top:8px}
.hint b{color:var(--tx)}.hint code{background:#0b0d11;border:1px solid var(--bd);border-radius:5px;padding:1px 6px;color:#22d3ee}
ol{margin:8px 0 0;padding-inline-start:18px;font-size:13px;color:var(--mu);line-height:1.8}
a{color:#22d3ee}
#log{margin-top:14px;font-size:13px;white-space:pre-wrap;line-height:1.7}
.ok{color:#22c55e}.err{color:#ef4444}
.done{background:#0e1b12;border:1px solid #1f5132;border-radius:10px;padding:14px;margin-top:14px;display:none}
.done a{font-weight:700}
</style></head><body><div class="c">
<h1>🌟 Install Nova Proxy</h1>
<p class="sub">No GitHub needed. This sets up your own Nova worker on <b>your</b> Cloudflare account (free tier) in one step. Your API token is used only to do the install — it is never stored.</p>

<div class="card">
<details><summary style="cursor:pointer;font-weight:600">① How to get a Cloudflare API token (1 min)</summary>
<ol>
<li>Open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">dash.cloudflare.com/profile/api-tokens</a> → <b>Create Token</b> → <b>Create Custom Token</b>.</li>
<li>Add permissions: <b>Account › Workers Scripts › Edit</b>, <b>Account › Workers KV Storage › Edit</b>, and <b>Account › Account Settings › Read</b>.</li>
<li>Create it, copy the token, paste below. (You can delete it afterwards.)</li>
</ol></details>

<label for="tok">Cloudflare API token</label>
<input id="tok" type="password" placeholder="paste token" autocomplete="off"/>
<label for="acc">Account ID (optional — auto-detected)</label>
<input id="acc" placeholder="leave blank to auto-detect" autocomplete="off"/>
<label for="name">Worker name</label>
<input id="name" value="nova" autocomplete="off"/>
<button class="b" id="go">⚡ Install Nova</button>
<div id="log"></div>
<div class="done" id="done"></div>
</div>

<p class="hint">After it finishes, open the install link and set your admin password. For Iran, add a custom domain to the worker afterwards (<code>*.workers.dev</code> is filtered there).</p>

<script>
const $=id=>document.getElementById(id);
$('go').onclick=async()=>{
  const log=$('log'), done=$('done'); done.style.display='none'; log.innerHTML='';
  const add=(t,c)=>{ log.innerHTML+='<div class="'+(c||'')+'">'+t+'</div>'; };
  const token=$('tok').value.trim(); if(!token){ add('Paste your API token first.','err'); return; }
  $('go').disabled=true; add('Installing…');
  try{
    const r=await fetch('/api/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,account:$('acc').value.trim(),name:$('name').value.trim()})});
    const j=await r.json();
    (j.steps||[]).forEach(s=>add('✓ '+s,'ok'));
    if(j.ok){
      done.style.display='block';
      done.innerHTML='<div class="ok" style="font-weight:700;margin-bottom:8px">✅ Installed!</div>'
        +(j.installUrl?('<div>Finish setup → <a href="'+j.installUrl+'" target="_blank" rel="noopener">'+j.installUrl+'</a></div>'):'')
        +(j.workerUrl?('<div style="margin-top:6px">Your panel: <a href="'+j.workerUrl+'/login" target="_blank" rel="noopener">'+j.workerUrl+'/login</a></div>'):'<div style="margin-top:6px">Open your worker in the Cloudflare dashboard to find its URL.</div>');
    } else { add('✗ '+(j.error||'failed'),'err'); }
  }catch(e){ add('✗ '+e.message,'err'); }
  $('go').disabled=false;
};
</script>
</div></body></html>`;
