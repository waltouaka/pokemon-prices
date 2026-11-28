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
// private relay channel between the panel and the OBS overlay (derived from the site password, never in the code)
const clipTopic = async env => 'akaoutlaw-rclip-' + (await tokenFor('clip:' + (env.SITE_PASSWORD || 'none'))).slice(0, 24);
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
  // Clips add-on: Settings → Clips in the panel, and a clip player in the OBS overlay
  const p = new URL(request.url).pathname.toLowerCase();
  const which = /^\/panel(\.html|\/)?$/.test(p) ? 'clip-panel' : (p.startsWith('/killcam') ? 'clip-overlay' : null);
  if (which && env.ASSETS) {
    try {
      const r = await env.ASSETS.fetch(new Request(`https://assets.local/replay/${which}.js`));
      if (r.ok) {
        let js = (await r.text()).replace('__TOPIC__', await clipTopic(env));
        if (which === 'clip-panel') { const b = await env.ASSETS.fetch(new Request('https://assets.local/replay/back-button.js')); if (b.ok) js += '\n' + await b.text(); }
        const tag = `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`;
        html = html.includes('</body>') ? html.replace('</body>', tag + '</body>') : html + tag;
      }
    } catch (_) {}
  }
  const headers = new Headers(res.headers); headers.delete('content-length');
  return new Response(html, { status: res.status, statusText: res.statusText, headers });
}

// ---------- image host (KV binding IMAGES) ----------
// Public:  /i/<id>.<ext>        anyone with the link can view (so you can use it in OBS, Discord, etc.)
// Locked:  /api/upload  POST    body = the image, header x-filename
//          /api/list    GET
//          /api/img/<id> DELETE
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_BYTES = 24 * 1024 * 1024; // KV values max out at 25 MiB
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const newId = () => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint8Array(8)); return [...r].map(b => a[b % a.length]).join(''); };
const publicUrl = (id) => `https://${ROOT}/i/${id}`;

async function serveImage(request, url, env) {
  if (!env.IMAGES) return new Response('Image host not connected', { status: 502 });
  const id = url.pathname.slice(3);
  if (!/^[a-z0-9]{8}\.[a-z]{3,4}$/.test(id)) return new Response('Not found', { status: 404 });
  const isVideo = /\.(mp4|webm|mov)$/.test(id);
  const { value, metadata } = await env.IMAGES.getWithMetadata('img:' + id, { type: isVideo ? 'arrayBuffer' : 'stream', cacheTtl: 300 });
  if (!value) return new Response('Not found', { status: 404 });
  if (isVideo) { // videos need byte ranges so players can seek
    const total = value.byteLength, base = { 'content-type': metadata?.type || 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' };
    const m = (request.headers.get('range') || '').match(/bytes=(\d*)-(\d*)/);
    if (m && (m[1] || m[2])) {
      let a = m[1] ? +m[1] : total - +m[2], b = m[1] && m[2] ? Math.min(+m[2], total - 1) : total - 1;
      if (a >= total || a > b) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
      return new Response(value.slice(a, b + 1), { status: 206, headers: { ...base, 'content-range': `bytes ${a}-${b}/${total}`, 'content-length': String(b - a + 1) } });
    }
    return new Response(value, { headers: { ...base, 'content-length': String(total) } });
  }
  const h = { 'content-type': metadata?.type || 'application/octet-stream', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
  if (metadata?.type === 'image/svg+xml') h['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'"; // no scripts inside SVGs
  return new Response(value, { headers: h });
}

async function imageApi(request, url, env, path) {
  if (!env.IMAGES) return json({ error: 'Image storage is not connected yet (missing IMAGES binding)' }, 502);
  if (path === '/api/upload' && request.method === 'POST') {
    const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type]; if (!ext) return json({ error: 'Only images (PNG, JPG, WebP, GIF, AVIF, SVG) or clips (MP4, WebM, MOV)' }, 415);
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

// ---------- Twitch clips (link → playable MP4) ----------
// Uses the same public endpoint twitch.tv's own player uses. Only public clips work.
const TW_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
function clipSlug(input) {
  const s = String(input || '').trim();
  let m = s.match(/clips\.twitch\.tv\/(?:embed\?clip=)?([A-Za-z0-9_-]+)/) || s.match(/twitch\.tv\/[^/]+\/clip\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{4,100}$/.test(s) ? s : null;
}
async function clipInfo(slug) {
  const gql = body => fetch('https://gql.twitch.tv/gql', { method: 'POST', headers: { 'Client-ID': TW_CLIENT, 'content-type': 'text/plain' }, body: JSON.stringify(body) }).then(r => r.json());
  const [tok, meta] = await Promise.all([
    gql({ operationName: 'VideoAccessToken_Clip', variables: { slug }, extensions: { persistedQuery: { version: 1, sha256Hash: '36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11' } } }),
    gql({ query: `query($slug:ID!){clip(slug:$slug){title durationSeconds thumbnailURL broadcaster{displayName}}}`, variables: { slug } }).catch(() => null),
  ]);
  const c = tok?.data?.clip; if (!c) return null;
  const quals = (c.videoQualities && c.videoQualities.length ? c.videoQualities : (c.assets || []).flatMap(a => a.videoQualities || []))
    .filter(q => q.sourceURL).sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
  if (!quals.length || !c.playbackAccessToken) return null;
  const t = c.playbackAccessToken;
  const src = `${quals[0].sourceURL}?sig=${t.signature}&token=${encodeURIComponent(t.value)}`;
  const m = meta?.data?.clip || {};
  return { slug, src, quality: quals[0].quality, title: m.title || slug, streamer: m.broadcaster?.displayName || '', seconds: m.durationSeconds || null, thumb: m.thumbnailURL || '' };
}
async function clipVideo(request, url) {
  let slug = ''; try { slug = decodeURIComponent(url.pathname.slice('/__clipvid/'.length)); } catch (_) {}
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(slug)) return new Response('Not found', { status: 404 });
  const info = await clipInfo(slug); if (!info) return new Response('Clip not found', { status: 404 });
  const range = request.headers.get('range');
  const vid = await fetch(info.src, range ? { headers: { range } } : {});
  const h = new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  for (const k of ['content-length', 'content-range']) { const v = vid.headers.get(k); if (v) h.set(k, v); }
  return new Response(vid.body, { status: vid.status, headers: h });
}
const fileSafe = s => String(s).replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'clip';
async function clipApi(request, url, env, path) {
  const slug = clipSlug(url.searchParams.get('url'));
  if (!slug) return json({ error: "That doesn't look like a Twitch clip link" }, 400);
  const info = await clipInfo(slug);
  if (!info) return json({ error: "Couldn't get that clip (deleted, private, or Twitch changed something)" }, 404);
  if (path === '/api/clip') { const { src, ...pub } = info; return json(pub); }
  const vid = await fetch(info.src);
  if (!vid.ok) return json({ error: 'Twitch refused the download (' + vid.status + ')' }, 502);
  const name = `${fileSafe(info.streamer ? info.streamer + ' - ' + info.title : info.title)}.mp4`;
  if (path === '/api/clip/download') {
    const h = new Headers({ 'content-type': 'video/mp4', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' });
    const len = vid.headers.get('content-length'); if (len) h.set('content-length', len);
    return new Response(vid.body, { headers: h });
  }
  if (path === '/api/clip/save' && request.method === 'POST') {
    if (!env.IMAGES) return json({ error: 'Storage not connected' }, 502);
    if (+vid.headers.get('content-length') > MAX_BYTES) return json({ error: 'Clip is over 24 MB, too big for free storage. Use Download instead' }, 413);
    const buf = await vid.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return json({ error: 'Clip is over 24 MB, too big for free storage. Use Download instead' }, 413);
    const id = `${newId()}.mp4`; const meta = { type: 'video/mp4', name, size: buf.byteLength, ts: Date.now() };
    await env.IMAGES.put('img:' + id, buf, { metadata: meta });
    return json({ id, url: publicUrl(id), ...meta });
  }
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
    if (path === '/api/clip' || path.startsWith('/api/clip/')) return clipApi(request, url, env, path);
    if (isReplay && path !== '/api/upload') return toReplay(request, env);
    if (path.startsWith('/api/')) return imageApi(request, url, env, path);
    if (isHome && (path === '/' || path === '/index.html')) return env.ASSETS.fetch(new Request(new URL('/home', url), request));
    return next();
  };

  // hosted image links are public on the main site and cards site
  if (!isReplay && path.startsWith('/i/') && request.method === 'GET') return serveImage(request, url, env);

  // always open (OBS needs these)
  if (isReplay) {
    // the Worker's built-in proxy lives on "/" (/?url=… and /?channel=…), which OBS calls without logging in
    const isProxy = path === '/' && (url.searchParams.has('url') || url.searchParams.has('channel'));
    if (path.startsWith('/__clipvid/') && request.method === 'GET') return clipVideo(request, url);
    // your SpongeBob Flashback title cards (replace the Worker's placeholder videos)
    if ((path === '/fb-intro.mp4' || path === '/fb-outro.mp4') && env.ASSETS) {
      const r = await env.ASSETS.fetch(new Request('https://assets.local/replay' + path, { headers: request.headers }));
      if (r.ok || r.status === 206) { const h = new Headers(r.headers); h.set('content-type', 'video/mp4'); h.set('access-control-allow-origin', '*'); h.set('cache-control', 'public, max-age=300'); return new Response(r.body, { status: r.status, headers: h }); }
    }
    const ours_ = path === '/api/clip' || path.startsWith('/api/clip/') || path === '/api/upload';
    const locked = ours_ || (!isProxy && (path === '/' || path === '/panel' || path === '/panel/' || path === '/panel.html'));
    if (!locked) return toReplay(request, env);
  } else if (path === '/overlay' || path === '/overlay.html' || path.startsWith('/logos/')) {
    return next();
  }

  if (!pw) return pass();
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)cp_auth=([a-f0-9]{64})/);
  if (m && same(m[1], await tokenFor(pw))) return pass();
  return html(loginPage(false, url.pathname + url.search), 401);
}
