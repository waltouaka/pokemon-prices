// One password for the whole site (runs on Cloudflare Pages).
//  - outlawswitchmyshit.com      → homepage   (password)
//  - cards.outlawswitchmyshit.com → card room  (password)   /overlay + /logos stay open for OBS
//  - replay.outlawswitchmyshit.com → replay Worker via the REPLAY service binding;
//        only the panel needs the password, the replay overlay + its proxy stay open for OBS
// The password is the Cloudflare secret SITE_PASSWORD (never in this code). Log in once and the
// cookie works on every *.outlawswitchmyshit.com address for 30 days.
const ROOT = 'outlawswitchmyshit.com';
const COOKIE = 'cp_auth';
const MONTH = 60 * 60 * 24 * 30;
const ours = h => h === ROOT || h.endsWith('.' + ROOT);

async function tokenFor(pw) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('outlaw-cards:' + pw));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {               // constant-time compare
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const cookieAttrs = (host, age) => `Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax` + (ours(host) ? `; Domain=.${ROOT}` : '');
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) ? n : '/';
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const loginPage = (wrong, next) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>akaoutlaw</title>
<link rel="icon" href="https://unavatar.io/twitch/akaoutlaw">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,500..900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:Archivo,system-ui,sans-serif;font-weight:700;color:#fff;display:grid;place-items:center;
  background:linear-gradient(125deg,#1E1A34,#2b1f5c 30%,#1E1A34 60%,#3a1d63 85%,#15122a);background-size:300% 300%;animation:b 22s ease-in-out infinite}
@keyframes b{0%{background-position:0% 30%}50%{background-position:100% 70%}100%{background-position:0% 30%}}
form{width:min(380px,90vw);display:flex;flex-direction:column;align-items:center;gap:14px}
img{width:84px;height:84px;border-radius:50%;border:2px solid #fff;object-fit:cover;background:#1a1426}
h1{margin:6px 0 0;font-weight:900;font-size:38px;font-stretch:125%;letter-spacing:-1.2px}
p{margin:0 0 6px;color:#a99cc0;font-size:14px}
input{width:100%;background:rgba(0,0,0,.45);color:#fff;border:0;border-radius:12px;padding:15px 16px;font:inherit;font-size:16px;outline:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
input:focus{box-shadow:inset 0 0 0 2px #fff}
button{width:100%;border:0;border-radius:12px;padding:15px;background:#fff;color:#000;font:inherit;font-weight:900;font-size:16px;cursor:pointer}
.err{color:#ff8a8a;font-size:14px;min-height:18px}
</style></head><body>
<form method="POST" action="/__login?next=${encodeURIComponent(next)}">
  <img src="https://unavatar.io/twitch/akaoutlaw" alt="">
  <h1>akaoutlaw</h1><p>Enter password</p>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
  <button type="submit">Enter</button>
  <div class="err">${wrong ? 'Wrong password, try again.' : ''}</div>
</form></body></html>`;

const ICON = '<link rel="icon" href="https://unavatar.io/twitch/akaoutlaw">';
async function toReplay(request, env) {
  if (!env.REPLAY) return new Response('Replay is not connected yet (missing REPLAY service binding).', { status: 502 });
  // The replay panel was written to run on *.workers.dev: off that address it points OBS at an old
  // "killcam-v4.html" page the Worker doesn't have. Send those links to the real overlay (/killcam).
  const u = new URL(request.url);
  if (u.pathname.toLowerCase() === '/killcam-v4.html') { u.pathname = '/killcam'; request = new Request(u, request); }
  const res = await env.REPLAY.fetch(request);
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  // In replay pages: treat this domain like workers.dev (fixes the OBS link + proxy auto-fill) and add the tab icon.
  let html = await res.text();
  html = html.replace(/location\.hostname\.endsWith\((['"])workers\.dev\1\)/g, 'true');
  html = html.includes('</head>') ? html.replace('</head>', ICON + '</head>') : ICON + html;
  const headers = new Headers(res.headers); headers.delete('content-length');
  return new Response(html, { status: res.status, statusText: res.statusText, headers });
}

// ---------- image host (KV binding IMAGES) ----------
// Public:  /i/<id>.<ext>        anyone with the link can view (so you can use it in OBS, Discord, etc.)
// Locked:  /api/upload  POST    body = the image, header x-filename
//          /api/list    GET
//          /api/img/<id> DELETE
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
const MAX_BYTES = 24 * 1024 * 1024; // KV values max out at 25 MiB
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const newId = () => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint8Array(8)); return [...r].map(b => a[b % a.length]).join(''); };
const publicUrl = (id) => `https://${ROOT}/i/${id}`;

async function serveImage(url, env) {
  if (!env.IMAGES) return new Response('Image host not connected', { status: 502 });
  const id = url.pathname.slice(3);
  if (!/^[a-z0-9]{8}\.[a-z]{3,4}$/.test(id)) return new Response('Not found', { status: 404 });
  const { value, metadata } = await env.IMAGES.getWithMetadata('img:' + id, { type: 'stream', cacheTtl: 300 });
  if (!value) return new Response('Not found', { status: 404 });
  const h = { 'content-type': metadata?.type || 'application/octet-stream', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
  if (metadata?.type === 'image/svg+xml') h['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'"; // no scripts inside SVGs
  return new Response(value, { headers: h });
}

async function imageApi(request, url, env, path) {
  if (!env.IMAGES) return json({ error: 'Image storage is not connected yet (missing IMAGES binding)' }, 502);
  if (path === '/api/upload' && request.method === 'POST') {
    const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type]; if (!ext) return json({ error: 'Only PNG, JPG, WebP, GIF, AVIF or SVG' }, 415);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return json({ error: 'Empty file' }, 400);
    if (buf.byteLength > MAX_BYTES) return json({ error: 'Too big (max 24 MB)' }, 413);
    let name = 'image'; try { name = decodeURIComponent(request.headers.get('x-filename') || 'image'); } catch (_) {}
    name = name.slice(0, 120);
    const id = `${newId()}.${ext}`;
    const meta = { type, name, size: buf.byteLength, ts: Date.now() };
    await env.IMAGES.put('img:' + id, buf, { metadata: meta });
    return json({ id, url: publicUrl(id), ...meta });
  }
  if (path === '/api/list' && request.method === 'GET') {
    const items = []; let cursor;
    do {
      const r = await env.IMAGES.list({ prefix: 'img:', cursor, limit: 1000 });
      for (const k of r.keys) { const id = k.name.slice(4); items.push({ id, url: publicUrl(id), ...(k.metadata || {}) }); }
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor && items.length < 5000);
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return json({ items, total: items.reduce((s, i) => s + (i.size || 0), 0) });
  }
  const del = path.match(/^\/api\/img\/([a-z0-9]{8}\.[a-z]{3,4})$/);
  if (del && request.method === 'DELETE') { await env.IMAGES.delete('img:' + del[1]); return json({ ok: true }); }
  return json({ error: 'Not found' }, 404);
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const host = url.hostname;
  const path = url.pathname.toLowerCase();
  const isReplay = host === 'replay.' + ROOT;
  const isHome = host === ROOT || host === 'www.' + ROOT;
  const html = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  const pw = env.SITE_PASSWORD;

  // log in / log out (same on every address)
  if (path === '/__login' && request.method === 'POST' && pw) {
    const nxt = safeNext(url.searchParams.get('next'));
    const form = await request.formData();
    const good = await tokenFor(pw);
    if (same(await tokenFor(String(form.get('password') || '')), good)) {
      return new Response(null, { status: 303, headers: { Location: nxt, 'Set-Cookie': `${COOKIE}=${good}; ${cookieAttrs(host, MONTH)}` } });
    }
    return html(loginPage(true, nxt), 401);
  }
  if (path === '/__logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; ${cookieAttrs(host, 0)}` } });
  }

  // what runs once someone is allowed in
  const pass = () => {
    if (isReplay) return toReplay(request, env);
    if (path.startsWith('/api/')) return imageApi(request, url, env, path);
    if (isHome && (path === '/' || path === '/index.html')) return env.ASSETS.fetch(new Request(new URL('/home', url), request));
    return next();
  };

  // hosted image links are public on the main site and cards site
  if (!isReplay && path.startsWith('/i/') && request.method === 'GET') return serveImage(url, env);

  // always open (OBS needs these)
  if (isReplay) {
    // the Worker's built-in proxy lives on "/" (/?url=… and /?channel=…), which OBS calls without logging in
    const isProxy = path === '/' && (url.searchParams.has('url') || url.searchParams.has('channel'));
    const locked = !isProxy && (path === '/' || path === '/panel' || path === '/panel/' || path === '/panel.html');
    if (!locked) return toReplay(request, env);
  } else if (path === '/overlay' || path === '/overlay.html' || path.startsWith('/logos/')) {
    return next();
  }

  if (!pw) return pass();
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)cp_auth=([a-f0-9]{64})/);
  if (m && same(m[1], await tokenFor(pw))) return pass();
  return html(loginPage(false, url.pathname + url.search), 401);
}
