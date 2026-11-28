// Added to the replay OBS overlay by the site gate.
// Plays clips sent from the panel's Settings → Clips THROUGH the overlay's own replay pipeline,
// so the chosen style (Flashback intro/outro, Elite, MW2, Standard, imported designs), timer,
// speed and slow-mo ending all apply. Falls back to a plain full-screen player if that pipeline
// isn't available.
(() => {
  const TOPIC = '__TOPIC__';
  let lastLook = null, clipRun = null, seen = 0;

  // remember the style the overlay is currently set to (the panel pushes it with applyLook)
  try {
    if (typeof applyLook === 'function') {
      const realApply = applyLook;
      applyLook = function (l) { if (l) lastLook = l; return realApply.apply(this, arguments); };
    }
  } catch (_) {}

  const pipeline = (() => { try { return typeof doReplay === 'function' && player && typeof player.play === 'function' && video && hooks; } catch (_) { return false; } })();

  if (pipeline) {
    const realPlay = player.play, realStop = player.stop, realActive = player.active;
    // a clip "replay": same hooks the normal player uses, but the source is the clip MP4
    player.play = function (b, range, c) {
      if (!c || !c.__clip) return realPlay.apply(this, arguments);
      return new Promise(resolve => {
        const v = video, speed = +c.speed || 1, slowLast = +c.slowLast || 0, slowRate = +c.slowRate || 0.5;
        let started = false, slowed = false, done = false, raf = 0, t0 = 0;
        const finish = reason => {
          if (done) return; done = true; cancelAnimationFrame(raf); clipRun = null;
          try { hooks.onEnd(reason); } catch (_) {}
          setTimeout(() => { if (!clipRun) { v.pause(); v.removeAttribute('src'); v.load(); } }, hooks.teardownDelay || 500);
          resolve({ seconds: t0 ? (performance.now() - t0) / 1000 : 0, reason });
        };
        clipRun = { finish };
        const loop = () => {
          raf = requestAnimationFrame(loop);
          const d = v.duration; if (!isFinite(d) || !d) return;
          const left = d - v.currentTime;
          if (slowLast && !slowed && left <= slowLast) { slowed = true; v.playbackRate = slowRate; }
          try { hooks.onTick(Math.max(0, left / v.playbackRate)); } catch (_) {}
          if (left <= 0.04) finish('end');
        };
        v.onended = () => finish('end');
        v.onerror = () => { try { hooks.onError('clip failed to load'); } catch (_) {} finish('error'); };
        v.addEventListener('playing', () => {
          if (started) return; started = true; t0 = performance.now();
          try { hooks.onStart(); } catch (_) {}
          loop();
        }, { once: true });
        v.muted = c.sound === false || c.sound === 0 || c.sound === '0';
        v.src = c.__clip; v.playbackRate = speed;
        v.play().catch(() => { v.muted = true; v.play().catch(() => finish('error')); });
      });
    };
    player.stop = function () { if (clipRun) { clipRun.finish('stop'); return; } return realStop.apply(this, arguments); };
    player.active = function () { return !!clipRun || (realActive ? realActive.apply(this, arguments) : false); };
  }

  // plain fallback (only if the overlay's pipeline can't be used)
  let layer = null;
  function plainStop() { if (!layer) return; const l = layer; layer = null; l.remove(); }
  function plainPlay(src) {
    plainStop();
    const l = document.createElement('div');
    l.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000';
    const v = document.createElement('video'); v.src = src; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'width:100%;height:100%;object-fit:contain';
    v.onended = v.onerror = plainStop; l.appendChild(v); document.body.appendChild(l); layer = l;
    v.play().catch(() => { v.muted = true; v.play().catch(plainStop); });
  }

  function playClipMsg(m) {
    if (!pipeline) return plainPlay(m.src);
    let edge = null; try { edge = buf && typeof buf.liveEdge === 'function' ? buf.liveEdge() : null; } catch (_) {}
    const look = m.look || lastLook || undefined;
    const c = { type: 'replay', __clip: m.src, sound: m.sound, speed: m.speed, slowLast: m.slowLast, slowRate: m.slowRate,
      start: typeof edge === 'number' ? Math.max(0, edge - 1) : 0, end: typeof edge === 'number' ? edge : 1 };
    if (look) c.look = look;
    try { const p = doReplay(c); if (p && p.catch) p.catch(() => plainPlay(m.src)); } catch (_) { plainPlay(m.src); }
  }

  function connect() {
    const es = new EventSource('https://ntfy.sh/' + TOPIC + '/sse');
    es.onmessage = e => {
      try {
        const m = JSON.parse(JSON.parse(e.data).message);
        if (!m.ts || m.ts <= seen || Date.now() - m.ts > 60000) return; seen = m.ts;
        if (m.t === 'clip' && m.src) playClipMsg(m);
        else if (m.t === 'stop') { plainStop(); try { if (clipRun) player.stop(); } catch (_) {} }
      } catch (_) {}
    };
    es.onerror = () => { es.close(); setTimeout(connect, 3000); };
  }
  connect();
  window.__olClipTest = playClipMsg; // for testing from the console
})();
