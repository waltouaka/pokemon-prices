// Broadcast scorebugs: each network's bug is built from its own HTML, filled with the live game.
// The engine calls SBBugs.render(view) on every update when the chosen style is one of these.
window.SBBugs = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  // "1ST & 10" → 1<small>ST</small> & 10 (letters right after a number get small caps, like on TV)
  const sc = t => esc(t).replace(/(\d)(ST|ND|RD|TH)\b/gi, (m, d, s) => `${d}<small>${s.toUpperCase()}</small>`);
  const fx = t => t.fx ? `<div class="fx">${esc(t.fx).replace('BONUS', '<b class="bonus">BONUS</b>')}</div>` : '';
  const tos = (n, max = 3, cls = 'to') => n == null ? '' : `<div class="${cls}">${Array.from({ length: max }, (_, i) => `<b class="${i < n ? 'on' : ''}"></b>`).join('')}</div>`;
  const img = (src, cls = 'lg') => `<img class="${cls}" src="${esc(src)}" alt="" onerror="this.style.visibility='hidden'">`;
  const tm = (t, side, inner) => `<div class="tm ${side}${t.ball ? ' hb' : ''}" style="--c:${t.color};--ink:${t.ink};--c2:${t.color2}">${inner}</div>`;
  const rank = t => t.rank ? `<sup class="rk">${t.rank}</sup>` : '';
  const sco = (t, k) => `<div class="sc${t.bump ? ' bump' : ''}" data-k="${k}">${esc(t.score)}</div>`;

  const B = {
    cbs: v => `<div class="bug b-cbs">
      ${tm(v.a, 'a', `${img(v.a.logo)}<div class="col">${sco(v.a, 'a')}<div class="tofx">${tos(v.a.to, v.a.toMax)}${fx(v.a)}</div></div>`)}
      <div class="mid${v.dd ? '' : ' nodd'}"><div class="bdd">${sc(v.dd)}</div><div class="row"><span class="pd">${sc(v.period)}</span>${v.clock ? `<i class="sep"></i><span class="ck">${esc(v.clock)}</span>` : ''}</div></div>
      ${tm(v.h, 'h', `<div class="col">${sco(v.h, 'h')}<div class="tofx">${tos(v.h.to, v.h.toMax)}${fx(v.h)}</div></div>${img(v.h.logo)}`)}
    </div>`,

    fox: v => `<div class="bug b-fox">
      ${v.dd ? `<div class="bdd">${sc(v.dd)}</div>` : ''}
      ${img(v.a.logo, 'lg la')}<div class="sc-wrap sca">${sco(v.a, 'a')}<div class="tofx">${tos(v.a.to, v.a.toMax)}${fx(v.a)}</div></div>
      <div class="ck">${v.clock ? `<b>${esc(v.clock)}</b>` : ''}<span>${sc(v.period)}</span></div>
      <div class="sc-wrap scb">${sco(v.h, 'h')}<div class="tofx">${tos(v.h.to, v.h.toMax)}${fx(v.h)}</div></div>${img(v.h.logo, 'lg lb')}
    </div>`,

    espn: v => `<div class="bug b-espn">
      ${tm(v.a, 'a', `${img(v.a.logo)}<div class="col">${sco(v.a, 'a')}<div class="tofx">${tos(v.a.to, v.a.toMax)}${fx(v.a)}</div></div>`)}
      <div class="mid">${v.dd ? `<div class="bdd">${esc(v.dd)}</div>` : '<div class="bdd empty"></div>'}
        <div class="pill"><span class="pd">${sc(v.period)}</span>${v.clock ? `<span class="ck">${esc(v.clock)}</span>` : ''}</div></div>
      ${tm(v.h, 'h', `<div class="col">${sco(v.h, 'h')}<div class="tofx">${tos(v.h.to, v.h.toMax)}${fx(v.h)}</div></div>${img(v.h.logo)}`)}
    </div>`,

    netflix: v => `<div class="bug b-netflix">
      ${tm(v.a, 'a', `${img(v.a.logo)}<div class="nums"><span class="rc">${esc(v.a.rec)}</span>${sco(v.a, 'a')}<div class="tofx">${tos(v.a.to, v.a.toMax)}${fx(v.a)}</div></div>`)}
      <div class="mid${v.dd ? '' : ' nodd'}">${v.dd ? `<div class="top"><span class="bdd">${sc(v.dd)}</span></div>` : ''}
        <div class="row"><span class="pd">${sc(v.period)}</span><span class="ck">${esc(v.clock)}</span></div></div>
      ${tm(v.h, 'h', `<div class="nums">${sco(v.h, 'h')}<span class="rc">${esc(v.h.rec)}</span><div class="tofx">${tos(v.h.to, v.h.toMax)}${fx(v.h)}</div></div>${img(v.h.logo)}`)}
    </div>`,

  };

  let last = { a: null, h: null };
  return {
    has: k => !!B[k],
    render(el, k, v) {
      // score bump only when the number actually changed
      v.a.bump = last.a !== null && last.a !== v.a.score; v.h.bump = last.h !== null && last.h !== v.h.score;
      last = { a: v.a.score, h: v.h.score };
      el.innerHTML = B[k](v);
    },
    reset() { last = { a: null, h: null }; },
  };
})();
