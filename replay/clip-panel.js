// Added to the replay panel by the site gate: a "Clips" section in Settings (on/off toggle).
(() => {
  // private channel between your panel and your overlay, made from your replay key
  let TOPIC = null;
  const topicReady = (async () => { const key = localStorage.getItem('aor_key') || ''; if (!key) return null;
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('clip:' + key));
    TOPIC = 'aorclip-' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); return TOPIC; })();
  const $ = id => document.getElementById(id);
  const css = `
  #olClips .ol-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  #olClips .ol-btn{flex:1;border:0;border-radius:10px;padding:10px 12px;background:rgba(255,255,255,.09);color:#fff;font:inherit;font-weight:800;cursor:pointer;text-align:center;text-decoration:none;font-size:13px}
  #olClips .ol-btn:hover{background:rgba(255,255,255,.16)}
  #olClips .ol-btn.go{background:#ff2a2a}
  #olClips .ol-btn:disabled,#olClips .ol-btn.off{opacity:.4;pointer-events:none}
  #olClips video{width:100%;border-radius:10px;margin-top:10px;background:#000;max-height:220px}
  #olClips .ol-info{margin-top:8px;font-size:12px;opacity:.8;min-height:16px}
  #olClips .ol-file{display:block;margin-top:12px;font-size:12px;opacity:.85}
  #olClips .ol-file input{display:block;margin-top:6px;width:100%;font-size:12px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const sec = document.createElement('details'); sec.id = 'olClips';
  sec.innerHTML = `<summary>Clips</summary><div class="inner">
    <div><label>Clip tools</label><div class="seg" id="olClipToggle"><button data-v="1">On</button><button data-v="0">Off</button></div></div>
    <div id="olClipBody" hidden>
      <div style="margin-top:12px"><label>Replay style for clips</label><div class="seg" id="olClipStyle"></div></div>
      <div class="field"><span>Twitch clip link</span><input type="text" id="olClipUrl" placeholder="https://clips.twitch.tv/…  or  twitch.tv/name/clip/…"></div>
      <div class="ol-row"><button class="ol-btn" id="olClipLoad">Load clip</button></div>
      <label class="ol-file">…or upload a clip (MP4 / WebM / MOV, up to 24 MB)<input type="file" id="olClipFile" accept="video/mp4,video/webm,video/quicktime"></label>
      <div class="ol-info" id="olClipInfo"></div>
      <video id="olClipPrev" controls playsinline hidden></video>
      <div class="ol-row">
        <button class="ol-btn go" id="olClipSend" disabled>Send clip to stream</button>
        <button class="ol-btn" id="olClipStop">Stop</button>
        <a class="ol-btn off" id="olClipDl" href="#" download>Download</a>
      </div>
    </div></div>`;
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  const log = [...sheet.querySelectorAll(':scope > details')].find(d => /^\s*Log/.test(d.querySelector('summary')?.textContent || ''));
  sheet.insertBefore(sec, log || null);

  let clipSrc = null;
  // --- style: mirror the panel's own Theme buttons, so picking here = picking in the panel
  const THEMES = ['Elite', 'MW2', 'Flashback', 'Standard'];
  const themeBtns = () => [...document.querySelectorAll('button')].filter(b => THEMES.includes(b.textContent.trim()) && !b.closest('#olClips'));
  function buildStyles() {
    const box = $('olClipStyle'); box.innerHTML = '';
    themeBtns().forEach(src => {
      const b = document.createElement('button'); b.textContent = src.textContent.trim();
      b.classList.toggle('on', src.classList.contains('on') || src.getAttribute('aria-pressed') === 'true');
      b.onclick = () => { src.click(); setTimeout(syncStyles, 50); };
      box.appendChild(b);
    });
  }
  function syncStyles() {
    const srcs = themeBtns(); const mine = [...$('olClipStyle').children];
    mine.forEach(b => { const s = srcs.find(x => x.textContent.trim() === b.textContent); b.classList.toggle('on', !!s && (s.classList.contains('on') || s.getAttribute('aria-pressed') === 'true')); });
  }
  // --- the panel's current Speed / Sound / Slow-mo ending, so clips play the same way replays do
  function replayOpts() {
    const o = {};
    const snd = document.querySelector('#sounds button.on'); if (snd) o.sound = snd.dataset.s !== '0';
    const sp = [...document.querySelectorAll('.seg button.on')].map(b => b.textContent.trim()).find(t => /^\.?\d*\.?\d+x$/.test(t));
    if (sp) o.speed = parseFloat(sp.replace('x', ''));
    const lab = [...document.querySelectorAll('label,span,div')].find(e => e.children.length <= 2 && /^Slow-mo ending/i.test(e.textContent.trim()));
    const rng = lab && (lab.parentElement.querySelector('input[type=range]') || lab.parentElement.parentElement.querySelector('input[type=range]'));
    if (rng) o.slowLast = parseFloat(rng.value) || 0;
    return o;
  }
  const info = t => { $('olClipInfo').textContent = t; };
  function setOn(on) {
    try { localStorage.setItem('ol_clips', on ? '1' : '0'); } catch (_) {}
    $('olClipBody').hidden = !on;
    $('olClipToggle').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === on));
  }
  let saved = '0'; try { saved = localStorage.getItem('ol_clips') || '0'; } catch (_) {}
  setOn(saved === '1');
  buildStyles();
  document.addEventListener('click', e => { if (themeBtns().includes(e.target.closest('button'))) setTimeout(syncStyles, 50); }, true);
  $('olClipToggle').onclick = e => { const b = e.target.closest('button'); if (b) setOn(b.dataset.v === '1'); };

  function ready(src, dl, label) {
    clipSrc = src; const v = $('olClipPrev'); v.src = src; v.hidden = false;
    $('olClipSend').disabled = false;
    const a = $('olClipDl'); a.href = dl; a.classList.remove('off');
    info(label);
  }
  $('olClipLoad').onclick = async () => {
    const link = $('olClipUrl').value.trim(); if (!link) return info('Paste a clip link first');
    info('Loading…'); $('olClipSend').disabled = true;
    try {
      const r = await fetch('/api/clip?url=' + encodeURIComponent(link), { cache: 'no-store' });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
      ready(location.origin + '/__clipvid/' + encodeURIComponent(j.slug), '/api/clip/download?url=' + encodeURIComponent(link),
        `${j.streamer ? j.streamer + ' · ' : ''}${j.title}${j.seconds ? ' · ' + Math.round(j.seconds) + 's' : ''} · ${j.quality}p`);
    } catch (e) { info("Couldn't load: " + e.message); }
  };
  $('olClipUrl').addEventListener('keydown', e => { if (e.key === 'Enter') $('olClipLoad').click(); });
  $('olClipFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 24 * 1024 * 1024) { info('Too big (max 24 MB)'); return; }
    info('Uploading… ' + Math.round(f.size / 1048576 * 10) / 10 + ' MB'); $('olClipSend').disabled = true;
    try {
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': f.type || 'video/mp4', 'x-filename': encodeURIComponent(f.name) }, body: f });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
      ready(j.url, j.url, `Uploaded: ${f.name} (also in your Image Host)`);
    } catch (err) { info('Upload failed: ' + err.message); }
    e.target.value = '';
  };
  const send = async msg => { if (!(await topicReady)) throw new Error('no replay key yet'); return fetch('https://ntfy.sh/' + TOPIC, { method: 'POST', body: JSON.stringify({ ...msg, ts: Date.now() }) }); };
  $('olClipSend').onclick = async () => {
    if (!clipSrc) return;
    try { await send({ t: 'clip', src: clipSrc, ...replayOpts() }); info('Sent to stream ✓'); } catch (_) { info("Couldn't reach the overlay"); }
  };
  $('olClipStop').onclick = () => send({ t: 'stop' }).then(() => info('Stopped'), () => info("Couldn't reach the overlay"));
})();
