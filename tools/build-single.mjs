// Builds a self-contained single-file worker: worker.js + the dashboard assets inlined,
// so it runs with NO ASSETS binding (paste-and-go). Repo deploys still use panel/ + the
// binding; this is the standalone artifact. Re-run after editing worker.js or panel/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const A = [
  ['/admin/index.html',   'panel/public/admin/index.html',   'text/html;charset=utf-8'],
  ['/login/index.html',   'panel/public/login/index.html',   'text/html;charset=utf-8'],
  ['/install/index.html', 'panel/public/install/index.html', 'text/html;charset=utf-8'],
  ['/nova-admin.js',      'panel/public/nova-admin.js',       'text/javascript;charset=utf-8'],
  ['/qrcode.min.js',      'panel/public/qrcode.min.js',       'text/javascript;charset=utf-8'],
];
const map = {};
for (const [key, file, ct] of A) map[key] = { ct, t: readFileSync(file, 'utf8') };
// logo.png is binary -> base64
map['/logo.png'] = { ct: 'image/png', b64: readFileSync('panel/public/logo.png').toString('base64') };

let worker = readFileSync('worker.js', 'utf8');

// 1) inject the asset map right after the first line (the sockets import)
const firstNl = worker.indexOf('\n');
const inject = '\nconst __NOVA_ASSETS = ' + JSON.stringify(map) + ';\n';
worker = worker.slice(0, firstNl + 1) + inject + worker.slice(firstNl + 1);

// 2) patch panelFetch to serve from __NOVA_ASSETS when there is no ASSETS binding
const anchor = "\t// Legacy mode: proxy an external Pages site. Never fetch the unset/placeholder URL";
const embedBranch =
  "\t// Embedded single-file assets: serve inline when no ASSETS binding (paste-and-go build).\r\n" +
  "\t{ let pn = p.split('?')[0]; if (!/\\.[a-z0-9]{2,5}$/i.test(pn) && !pn.endsWith('/')) pn += '/'; if (pn.endsWith('/')) pn += 'index.html';\r\n" +
  "\t  const a = (typeof __NOVA_ASSETS !== 'undefined') && __NOVA_ASSETS[pn];\r\n" +
  "\t  if (a) { const body = a.b64 ? Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)) : a.t;\r\n" +
  "\t    return new Response(body, { status: 200, headers: { 'Content-Type': a.ct, 'Cache-Control': 'no-store' } }); } }\r\n";
if (!worker.includes(anchor)) { console.error('panelFetch anchor not found'); process.exit(1); }
worker = worker.replace(anchor, embedBranch + anchor);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/worker.single.js', worker);
console.log('wrote dist/worker.single.js', (worker.length/1024).toFixed(0)+'KB', 'assets:', Object.keys(map).join(' '));
