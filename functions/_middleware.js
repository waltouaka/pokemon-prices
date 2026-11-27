// Password screen for the card control room (runs on Cloudflare Pages).
// - The password lives in the Cloudflare project as the secret SITE_PASSWORD (never in this code).
// - The overlay is its own page (/overlay) and is never behind the password, so OBS never hits the login screen.
// - The main domain (outlawswitchmyshit.com) shows the public homepage.
// - If SITE_PASSWORD isn't set, the site stays open.
const COOKIE = 'cp_auth';
const MONTH = 60 * 60 * 24 * 30;

async function tokenFor(pw) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('outlaw-cards:' + pw));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {               // constant-time compare
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const loginPage = (wrong) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>akaoutlaw · Card Prices</title>
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
<form method="POST" action="/__login">
  <img src="https://unavatar.io/twitch/akaoutlaw" alt="">
  <h1>akaoutlaw</h1><p>Card Prices · enter password</p>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
  <button type="submit">Enter</button>
  <div class="err">${wrong ? 'Wrong password, try again.' : ''}</div>
</form></body></html>`;

const HOME_HOSTS = ['outlawswitchmyshit.com', 'www.outlawswitchmyshit.com'];

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (HOME_HOSTS.includes(url.hostname) && (url.pathname === '/' || url.pathname === '/index.html')) {
    return env.ASSETS.fetch(new Request(new URL('/home', url), request));   // public homepage
  }
  const pw = env.SITE_PASSWORD;
  if (!pw) return next();

  const good = await tokenFor(pw);
  const html = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData();
    if (same(await tokenFor(String(form.get('password') || '')), good)) {
      return new Response(null, { status: 303, headers: {
        Location: '/', 'Set-Cookie': `${COOKIE}=${good}; Path=/; Max-Age=${MONTH}; HttpOnly; Secure; SameSite=Lax` } });
    }
    return html(loginPage(true), 401);
  }
  if (url.pathname === '/__logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)cp_auth=([a-f0-9]{64})/);
  if (m && same(m[1], good)) return next();
  return html(loginPage(false), 401);
}
