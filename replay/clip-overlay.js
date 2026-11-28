// Added to the replay OBS overlay by the site gate: plays clips sent from the panel's Clips section.
(() => {
  const TOPIC = '__TOPIC__';
  const st = document.createElement('style');
  st.textContent = `#olClipLayer{position:fixed;inset:0;z-index:2147483000;background:#000;opacity:0;transition:opacity .35s;pointer-events:none}
  #olClipLayer.show{opacity:1}#olClipLayer video{width:100%;height:100%;object-fit:contain;display:block}`;
  document.head.appendChild(st);
  let layer = null, seen = 0;
  function stop() {
    if (!layer) return; const l = layer; layer = null; l.classList.remove('show');
    setTimeout(() => { const v = l.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } l.remove(); }, 400);
  }
  function play(src) {
    stop();
    const l = document.createElement('div'); l.id = 'olClipLayer';
    const v = document.createElement('video'); v.src = src; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
    l.appendChild(v); document.body.appendChild(l); layer = l;
    v.addEventListener('playing', () => l.classList.add('show'), { once: true });
    v.addEventListener('ended', () => { if (layer === l) stop(); });
    v.addEventListener('error', () => { if (layer === l) stop(); });
    v.play().catch(() => { v.muted = true; v.play().catch(stop); });
  }
  function connect() {
    const es = new EventSource('https://ntfy.sh/' + TOPIC + '/sse');
    es.onmessage = e => {
      try {
        const m = JSON.parse(JSON.parse(e.data).message);
        if (!m.ts || m.ts <= seen || Date.now() - m.ts > 60000) return; seen = m.ts;
        if (m.t === 'clip' && m.src) play(m.src); else if (m.t === 'stop') stop();
      } catch (_) {}
    };
    es.onerror = () => { es.close(); setTimeout(connect, 3000); };
  }
  connect();
})();
