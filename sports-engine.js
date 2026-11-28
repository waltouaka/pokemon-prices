(function () {
  "use strict";

  /* ------------------------------------------------------------------
     CONFIG — defaults. StreamElements fields override these on load.
     Standalone testing: ?team=Steelers&league=nfl&testDrive=1
  ------------------------------------------------------------------ */
  var cfg = {
    league: "nfl",
    team: "Steelers",
    refresh: 8,               // seconds between polls while live (min 5)
    width: 700,
    scale: 1,
    layout: "minimal",           // "full" (bar + field) or "minimal" (slim bar only)
    showField: true,
    fieldOnlyLive: false,
    hideWhenNoGame: true,
    useTeamColors: true,
    enableAlerts: true,
    myTeamOnly: false,        // only alert on plays by the team you follow
    bigPlayYards: 40,         // yardage threshold for the big-play ribbon (deep pass / long run)
    showBigPlayRibbon: true,  // banner that slides over the field on big plays
    alertDuration: 7,         // seconds a scoring alert stays up
    showTimeouts: true,
    liveClock: false,         // optional approximate tick between polls (off = show exact polled value)
    testDrive: false,         // ignore ESPN and play a scripted Vikings-Packers drive (see "test drive" below)
    testDriveSpeed: 4,        // seconds per simulated play
    teamId: "",               // set by the control room (exact ESPN team id)
    eventId: "",              // set by the control room when showing one specific game
    show: true,               // Show / Hide from the control room
    showNote: false,          // playoff / series note above the bar
    skin: "block"             // overall style: tv, espn, fox, cbs, snf, nhl, block, jumbo, slant, neon, glass, stack, classic
  };
  var DEFAULTS = JSON.parse(JSON.stringify(cfg));

  var LEAGUE_PATHS = {
    "nfl": "football/nfl",
    "college-football": "football/college-football",
    "ncaaf": "football/college-football",
    "ufl": "football/ufl",
    "cfl": "football/cfl",
    "nba": "basketball/nba",
    "wnba": "basketball/wnba",
    "ncaam": "basketball/mens-college-basketball",
    "ncaaw": "basketball/womens-college-basketball",
    "nhl": "hockey/nhl",
    "mlb": "baseball/mlb",
    "mls": "soccer/usa.1",
    "epl": "soccer/eng.1",
    "ucl": "soccer/uefa.champions"
  };
  // which kind of sport the chosen league is: decides the clock, the strip under the bar and the alerts
  function sport() {
    var p = leaguePath();
    if (p.indexOf("football") === 0) return "football";
    if (p.indexOf("baseball") === 0) return "baseball";
    if (p.indexOf("hockey") === 0) return "hockey";
    if (p.indexOf("soccer") === 0) return "soccer";
    return p.indexOf("college") > -1 ? "ncaab" : "basketball";
  }

  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var started = false;

  var prev = { playId: null, away: null, home: null, primed: false };
  var queue = [], showing = false;
  var clk = { secs: null, raw: null, running: false, live: false };
  var current = null;

  /* ---------------- settings come from the Scoreboard control room ----------------
     window.SBApply(settings) restarts the overlay with new settings (any time). */
  var timers = [];
  window.SBApply = function (o) {
    o = o || {};
    var keep = { league: cfg.league, teamId: cfg.teamId, eventId: cfg.eventId };
    cfg = JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(o).forEach(function (k) { if (k in cfg && o[k] !== undefined && o[k] !== "") cfg[k] = o[k]; });
    applyTheme(o.theme || {});
    var sameGame = keep.league === cfg.league && keep.teamId === cfg.teamId && keep.eventId === cfg.eventId;
    if (!sameGame) { prev = { playId: null, away: null, home: null, primed: false }; queue = []; drive = { team: null, start: 0 }; lastPeriodText = null; }
    timers.forEach(clearInterval); timers = [];
    started = false; boot();
  };
  // standalone use with URL settings (?team=Steelers&league=nfl)
  setTimeout(function () {
    if (started || window.SB_REMOTE) return;
    new URLSearchParams(location.search).forEach(function (v, k) { if (k in cfg) cfg[k] = v; });
    boot();
  }, 1200);

  // Theme panel: every value maps to a CSS variable in :root
  var THEME_VARS = { font: "--font", panel: "--panel", panelEdge: "--panel-edge", fieldBg: "--field-bg", ink: "--ink", muted: "--muted",
    turfA: "--turf-a", turfB: "--turf-b", los: "--los", fd: "--fd", redzone: "--redzone", radius: "--radius", driveOpacity: "--drive-opacity" };
  var loadedFonts = {};
  function applyTheme(t) {
    Object.keys(THEME_VARS).forEach(function (k) { root.style.removeProperty(THEME_VARS[k]); });
    Object.keys(t).forEach(function (k) {
      var v = t[k]; if (v === undefined || v === "" || !THEME_VARS[k]) return;
      if (k === "radius") v = parseInt(v, 10) + "px";
      if (k === "font") {
        if (!loadedFonts[v] && !/arial|segoe|impact/i.test(v)) {
          loadedFonts[v] = 1;
          var l = document.createElement("link"); l.rel = "stylesheet";
          l.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(v).replace(/%20/g, "+") + ":wght@500;600;700;800;900&display=swap";
          document.head.appendChild(l);
          if (document.fonts) document.fonts.ready.then(function () { ezDirty = true; fitEndzones(); });
        }
        v = '"' + v + '", "Barlow Condensed", "Arial Narrow", sans-serif';
      }
      root.style.setProperty(THEME_VARS[k], v);
    });
  }

  function truthy(v) { return v === true || v === "true" || v === 1 || v === "1"; }

  function boot() {
    if (started) return;
    started = true;

    ["showField","fieldOnlyLive","hideWhenNoGame","useTeamColors",
     "enableAlerts","myTeamOnly","showTimeouts","liveClock","testDrive","showBigPlayRibbon","show","showNote"]
      .forEach(function (k) { cfg[k] = truthy(cfg[k]); });

    cfg.refresh        = Math.max(5, parseInt(cfg.refresh, 10) || 8);
    cfg.bigPlayYards   = parseInt(cfg.bigPlayYards, 10) || 20;
    cfg.alertDuration  = Math.max(3, parseInt(cfg.alertDuration, 10) || 7);
    cfg.testDriveSpeed = Math.max(1, parseFloat(cfg.testDriveSpeed) || 4);

    root.style.setProperty("--w", (parseInt(cfg.width, 10) || 700) + "px");
    root.style.setProperty("--scale", parseFloat(cfg.scale) || 1);
    $("testTag").classList.toggle("on", cfg.testDrive);
    cfg.minimal = String(cfg.layout).toLowerCase() === "minimal";
    $("sb").classList.toggle("sb--min", cfg.minimal);
    var sbEl = $("sb");
    sbEl.className.split(" ").forEach(function (c) { if (c.indexOf("skin-") === 0) sbEl.classList.remove(c); });
    if (cfg.skin && cfg.skin !== "classic") sbEl.classList.add("skin-" + String(cfg.skin).replace(/[^a-z]/g, ""));
    root.style.setProperty("--w-min", (parseInt(cfg.minWidth, 10) || 460) + "px");

    if (!truthy(cfg.show)) { $("sb").classList.add("sb--hidden"); return; }
    tick();
    timers.push(setInterval(tick, (cfg.testDrive ? cfg.testDriveSpeed : cfg.refresh) * 1000));
    timers.push(setInterval(localClock, 1000));
  }

  /* ---------------- data ---------------- */
  function leaguePath() {
    return LEAGUE_PATHS[String(cfg.league).toLowerCase()] || LEAGUE_PATHS.nfl;
  }

  function endpoint() {
    var path = leaguePath();
    var url = ESPN + path + "/scoreboard?limit=400";
    if (path.indexOf("college-football") > -1) url += "&groups=80";
    if (path.indexOf("college-basketball") > -1) url += "&groups=50";
    return url;
  }

  // The scoreboard endpoint's situation.lastPlay never carries athletesInvolved/
  // headshots — that only lives on the summary endpoint's scoringPlays[]. Only
  // hit this when a fresh scoring play needs a face to put on it.
  var ESPN = (location.protocol === "https:" ? "/espn/" : "https://site.api.espn.com/apis/site/v2/sports/");
  function summaryEndpoint(eventId) {
    return ESPN + leaguePath() +
           "/summary?event=" + eventId;
  }

  function fetchScoringAthletes(eventId, playId, anyPlay) {
    return fetch(summaryEndpoint(eventId), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var plays = data.scoringPlays || [];
        var same = function (p) {
          return String(p.id) === String(playId) || String(p.playId) === String(playId);
        };
        var hit = plays.find(same);
        if (!hit && anyPlay) {
          // non-scoring plays (big gains) live under the drives list instead
          var d = data.drives || {}, all = [];
          (d.previous || []).concat(d.current ? [d.current] : []).forEach(function (dr) {
            all = all.concat(dr.plays || []);
          });
          hit = all.find(same);
        } else if (!hit) {
          hit = plays[plays.length - 1];
        }

        if (!hit) {
          console.warn("[scoreboard] no matching scoring play in summary response for playId", playId);
          return [];
        }

        // ESPN uses different field names on different feeds — some give a
        // rich "athletesInvolved" array with names/photos, others give a
        // bare "players" list of {playerId, position}. Handle both.
        var raw = hit.athletesInvolved || hit.players || hit.participants || [];
        if (!raw.length) {
          console.warn("[scoreboard] scoring play matched but had no athlete list:", hit);
        }

        var seen = {}; // de-dupe repeated entries for the same player (fantasy feeds list stat-lines, not people)
        var out = [];
        raw.forEach(function (a) {
          var athlete = a.athlete || a;
          var refId = ((athlete.$ref || (a.athlete && a.athlete.$ref) || "").match(/athletes\/(\d+)/) || [])[1];
          var id = athlete.id || athlete.playerId || a.playerId || refId;
          var name = athlete.displayName || athlete.fullName || athlete.shortName
                   || athlete.name || a.displayName || a.name || "";
          if (!name && !id) return;
          var key = id || name;
          if (seen[key]) return;
          seen[key] = true;

          var hs = athlete.headshot || a.headshot;
          var cdnLeague = sport() === "soccer" ? "soccer" : (leaguePath().split("/")[1] || "nfl"); // "football/nfl" -> "nfl"
          var headshotUrl = (hs && hs.href) || (typeof hs === "string" ? hs : "")
            // fall back to ESPN's standard headshot CDN pattern when we
            // have an athlete ID but the JSON didn't include a photo URL
            || (id ? "https://a.espncdn.com/i/headshots/" + cdnLeague + "/players/full/" + id + ".png" : "");

          out.push({ name: name, headshot: headshotUrl });
        });
        return out;
      })
      .catch(function (err) {
        console.warn("[scoreboard] summary fetch failed:", err);
        return [];
      });
  }

  var testing = false;
  function tick() {
    testing = truthy(cfg.testDrive);
    if (testing) { cfg.league = "nfl"; render(simGame()); return; }
    fetch(endpoint(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var ev = pickEvent(data.events || []);
        if (!ev) { render(null); return; }

        var g = shape(ev);
        var lp = g.lastPlay;
        var isNewScoringPlay = lp && lp.scoring && lp.id !== prev.playId;

        if (isNewScoringPlay && g.state === "in") {
          fetchScoringAthletes(ev.id, lp.id).then(function (athletes) {
            if (athletes.length) g.lastPlay.athletes = athletes;
            render(g);
          });
        } else if (lp && lp.id !== prev.playId && g.state === "in" && cfg.enableAlerts &&
                   (isTurnoverPlay(lp) ||
                    (cfg.showBigPlayRibbon && (isBigPlay(lp) || isSack(lp) || isBigReturn(lp))))) {
          fetchScoringAthletes(ev.id, lp.id, true).then(function (athletes) {
            if (athletes.length) g.lastPlay.athletes = athletes;
            render(g);
          });
        } else {
          render(g);
        }
      })
      .catch(function (err) { console.warn("[scoreboard] fetch failed:", err); });
  }

  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

  function isMyTeam(c) {
    if (cfg.teamId && c.team && String(c.team.id) === String(cfg.teamId)) return true;
    if (cfg.teamId) return false;
    var q = norm(cfg.team);
    if (!q) return false;
    var t = c.team || {};
    var keys = [t.abbreviation, t.displayName, t.shortDisplayName, t.name,
                t.location, t.nickname, t.slug, t.id];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] && norm(keys[i]) === q) return true;
    }
    return q.length >= 4 && norm(t.displayName).indexOf(q) > -1;
  }

  function pickEvent(events) {
    if (cfg.eventId) {
      var one = events.find(function (ev) { return String(ev.id) === String(cfg.eventId); });
      if (one) return one;
    }
    var mine = events.filter(function (ev) {
      var c = ev.competitions && ev.competitions[0];
      return c && (c.competitors || []).some(isMyTeam);
    });
    if (!mine.length) return null;
    var st = function (ev) { return ((ev.status || {}).type || {}).state; };
    return mine.find(function (e) { return st(e) === "in"; })
        || mine.find(function (e) { return st(e) === "pre"; })
        || mine[mine.length - 1];
  }

  function shape(ev) {
    var comp = ev.competitions[0];
    var teams = comp.competitors || [];
    var home = teams.find(function (t) { return t.homeAway === "home"; }) || teams[0];
    var away = teams.find(function (t) { return t.homeAway === "away"; }) || teams[1];
    var stt = ev.status || comp.status || {};
    var type = stt.type || {};
    var sit = comp.situation || null;
    var lp = sit && sit.lastPlay ? sit.lastPlay : null;

    return {
      eventId: ev.id,
      week: ev.week && ev.week.number ? "WEEK " + ev.week.number : "",
      note: (comp.notes && comp.notes[0] && comp.notes[0].headline) || (comp.series && comp.series.summary) || "",
      state: type.state,
      halftime: type.name === "STATUS_HALFTIME",
      detail: type.shortDetail || type.detail || "",
      breakText: /END_PERIOD|INTERMISSION|STATUS_END/.test(type.name || "") ? (type.shortDetail || "") : "",
      period: stt.period || 0,
      clock: stt.displayClock || "",
      startDate: ev.date,
      myId: (teams.find(isMyTeam) || {}).id,
      myTeamId: ((teams.find(isMyTeam) || {}).team || {}).id,
      home: side(home),
      away: side(away),
      situation: sit ? {
        possessionId: sit.possession,
        text: sit.possessionText || "",
        yardLine: sit.yardLine,
        distance: sit.distance,
        down: sit.down,
        dd: sit.downDistanceText || sit.shortDownDistanceText || "",
        redZone: !!sit.isRedZone,
        homeTos: sit.homeTimeouts,
        awayTos: sit.awayTimeouts,
        balls: sit.balls, strikes: sit.strikes, outs: sit.outs,
        bases: [sit.onFirst, sit.onSecond, sit.onThird].map(function (b) { return !!b; })
      } : null,
      lastPlay: lp ? {
        id: lp.id,
        text: lp.text || "",
        scoring: !!lp.scoringPlay,
        value: Number(lp.scoreValue) || 0,
        yards: Number(lp.statYardage),
        typeText: (lp.type && (lp.type.text || lp.type.abbreviation)) || "",
        teamId: (lp.team && lp.team.id) || null,
        athletes: (lp.athletesInvolved || []).map(function (a) {
          return {
            name: a.displayName || a.fullName || a.shortName || "",
            short: a.shortName || a.displayName || "",
            pos: a.position || "",
            jersey: a.jersey || "",
            headshot: a.headshot || ""
          };
        })
      } : null
    };
  }

  function side(c) {
    var t = (c && c.team) || {};
    var nickname = t.name || (t.shortDisplayName || "").split(" ").pop() || t.abbreviation || "";
    return {
      id: t.id,
      abbr: t.abbreviation || t.shortDisplayName || "—",
      name: t.displayName || "",
      nickname: nickname,
      logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || "",
      logoDark: t.logoDark || "",
      color: "#" + (t.color || "444444"),
      alt: t.alternateColor ? "#" + t.alternateColor : "",
      record: (c.records && c.records[0] && c.records[0].summary) || "",
      rank: (c.curatedRank && c.curatedRank.current > 0 && c.curatedRank.current < 26) ? c.curatedRank.current : null,
      score: (c.score !== undefined && c.score !== null) ? String(c.score) : "0"
    };
  }

  /* ---------------- render ---------------- */
  function render(g) {
    var sb = $("sb");
    if (!g) {
      if (cfg.hideWhenNoGame) sb.classList.add("sb--hidden");
      return;
    }
    var wasHidden = sb.classList.contains("sb--hidden");
    sb.classList.remove("sb--hidden");
    if (wasHidden) playEntrance();
    current = g;

    applyTeamColors(g);

    fill($("awayLogo"), $("awayAbbr"), $("awayRec"), $("awayScore"), g.away, "away");
    fill($("homeLogo"), $("homeAbbr"), $("homeRec"), $("homeScore"), g.home, "home");
    setEndzoneText($("ezAwayTxt"), g.away.nickname || g.away.abbr);
    setEndzoneText($("ezHomeTxt"), g.home.nickname || g.home.abbr);

    var turfLogo = $("turfLogo");
    setLogo(turfLogo, g.home);

    timeouts($("awayTos"), g.situation ? g.situation.awayTos : null);
    timeouts($("homeTos"), g.situation ? g.situation.homeTos : null);

    var nt = $("gameNote");
    if (nt) { var nx = truthy(cfg.showNote) ? (g.note || "") : ""; nt.textContent = nx; nt.classList.toggle("on", !!nx); }
    drawStatus(g);
    drawField(g);
    if (sport() === "football") detectEvents(g); else detectScores(g);
    basketballExtras(g);
    drawBug(g);

    prev.away = g.away.score;
    prev.home = g.home.score;
    prev.primed = true;
  }

  // Bar drops in, then the field unrolls (see .sb.enter in the CSS).
  var enterTimer = null;
  function playEntrance() {
    var sb = $("sb");
    sb.classList.remove("enter");
    void sb.offsetWidth;
    sb.classList.add("enter");
    clearTimeout(enterTimer);
    enterTimer = setTimeout(function () { sb.classList.remove("enter"); }, 1300);
  }

  /* ---------------- team colors ----------------
     ESPN's primary color is often near-black (Steelers, Bears, Ravens),
     which vanishes against the dark panel. Anything too dark falls back
     to the team's alternate color, or a lightened version of itself. */
  var MIN_LUM = 0.03;

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    if (h.length !== 6 || isNaN(parseInt(h, 16))) return null;
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function toHex(r, g, b) {
    return "#" + [r, g, b].map(function (v) {
      var s = clamp(Math.round(v), 0, 255).toString(16);
      return s.length < 2 ? "0" + s : s;
    }).join("");
  }
  function lum(hex) {
    var c = hexToRgb(hex);
    if (!c) return 0;
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  // amt > 0 lightens toward white, amt < 0 darkens toward black
  function shade(hex, amt) {
    var c = hexToRgb(hex);
    if (!c) return hex;
    var f = function (v) { return amt < 0 ? v * (1 + amt) : v + (255 - v) * amt; };
    return toHex(f(c.r), f(c.g), f(c.b));
  }
  function inkFor(hex) { return lum(hex) > 0.3 ? "#111111" : "#ffffff"; }
  function colorDist(a, b) {
    var x = hexToRgb(a), y = hexToRgb(b);
    if (!x || !y) return 999;
    return Math.sqrt(Math.pow(x.r - y.r, 2) + Math.pow(x.g - y.g, 2) + Math.pow(x.b - y.b, 2));
  }
  function pickAccent(color, alt) {
    if (lum(color) >= MIN_LUM) return color;
    if (alt && alt !== color && lum(alt) >= MIN_LUM) return alt;
    return shade(color, 0.5);
  }

  function applyTeamColors(g) {
    var a = pickAccent(g.away.color, g.away.alt);
    var h = pickAccent(g.home.color, g.home.alt);
    if (colorDist(a, h) < 80) {   // both teams ended up nearly the same color
      var alt = (g.home.alt && g.home.alt !== g.home.color) ? g.home.alt : "";
      h = (alt && colorDist(a, alt) >= 80) ? alt : shade(h, lum(h) > 0.2 ? -0.35 : 0.4);
    }
    g.away.accent = a;
    g.home.accent = h;
    if (!cfg.useTeamColors) return;
    root.style.setProperty("--away", a);
    root.style.setProperty("--home", h);
    root.style.setProperty("--away-ink", inkFor(a));
    root.style.setProperty("--home-ink", inkFor(h));
  }

  // dark logos (Jazz, Raiders, Nets...) vanish on a dark panel: use ESPN's dark-background version there
  function panelIsDark() { return lum(getComputedStyle(root).getPropertyValue("--panel").trim() || "#111117") < 0.25; }
  function logoFor(t) { return (panelIsDark() && t.logoDark) ? t.logoDark : (t.logo || ""); }
  function setLogo(el, t) {
    var want = logoFor(t);
    if (el.getAttribute("src") === want) return;
    el.onerror = function () { if (t.logo && el.getAttribute("src") !== t.logo) el.src = t.logo; };
    el.src = want;
  }
  function fill(logoEl, abbrEl, recEl, scoreEl, t, key) {
    setLogo(logoEl, t);
    scoreEl.classList.toggle("wide", String(t.score).length >= 3);
    // college rankings sit in front of the name, like on TV ("12 OSU")
    var ab = (t.rank ? '<span class="rk">' + t.rank + "</span>" : "") + String(t.abbr).replace(/[&<>]/g, "");
    if (abbrEl.innerHTML !== ab) abbrEl.innerHTML = ab;
    recEl.textContent = t.record;
    if (scoreEl.textContent !== t.score) {
      scoreEl.textContent = t.score;
      if (prev.primed && prev[key] !== null && prev[key] !== t.score) {
        scoreEl.classList.remove("bump");
        void scoreEl.offsetWidth;
        scoreEl.classList.add("bump");
      }
    }
  }

  // The starting size comes from CSS (--ez-font-base/min/max in :root, driven
  // by the letter count set here). fitEndzones() then shrinks it further only
  // if the name still overflows the strip, whatever font ends up loading.
  var ezDirty = true;
  function setEndzoneText(el, text) {
    if (el.textContent === text) return;
    el.textContent = text;
    el.style.fontSize = "";
    el.style.setProperty("--ez-len", Math.max(text.length, 1));
    ezDirty = true;
  }
  function fitEndzones() {
    if (!ezDirty) return;
    var els = [$("ezAwayTxt"), $("ezHomeTxt")], best = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var avail = el.parentNode.clientHeight - 12;   // zone has 6px padding top and bottom
      if (avail <= 0) return;                         // field is hidden right now; retry later
      el.style.fontSize = "";
      var size = parseFloat(getComputedStyle(el).fontSize), guard = 0;
      while (el.getBoundingClientRect().height > avail && size > 8 && guard++ < 60) {
        size -= 0.5;
        el.style.fontSize = size + "px";
      }
      best = Math.min(best, size);
    }
    // both end zones share one size so the two names look like a matched pair
    els.forEach(function (e) { e.style.fontSize = best + "px"; });
    ezDirty = false;
  }
  // the web font arrives after first paint, so re-fit once it's in
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ezDirty = true; fitEndzones(); });
  }

  function timeouts(el, n, max) {
    if (!cfg.showTimeouts || n === undefined || n === null) { el.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < (max || 3); i++) html += '<b class="' + (i < n ? "on" : "") + '"></b>';
    el.innerHTML = html;
  }

  function ordinal(p) {
    if (!p) return "";
    if (p === 1) return "1ST";
    if (p === 2) return "2ND";
    if (p === 3) return "3RD";
    if (p === 4) return "4TH";
    return p === 5 ? "OT" : (p - 4) + "OT";
  }

  function kickoff(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: "short", hour: "numeric", minute: "2-digit"
      }).toUpperCase();
    } catch (e) { return ""; }
  }

  function drawStatus(g) {
    var per = $("period"), dd = $("downDistance");
    clk.live = false;

    if (g.state === "pre") {
      setPeriod(kickoff(g.startDate));
      setClockDisplay(""); dd.textContent = "";
      poss(null, g);
      return;
    }
    var sp = sport();
    if (g.state === "post") {
      var regular = sp === "hockey" ? 3 : sp === "ncaab" ? 2 : sp === "baseball" ? 9 : sp === "soccer" ? 2 : 4;
      setPeriod(g.period > regular ? (sp === "baseball" ? "FINAL / " + g.period : sp === "hockey" && /SO/.test(g.detail) ? "FINAL / SO" : "FINAL / OT") : "FINAL");
      setClockDisplay(""); dd.textContent = "";
      poss(null, g);
      return;
    }
    if (g.halftime) {
      setPeriod("HALFTIME");
      setClockDisplay(""); dd.textContent = "";
      poss(null, g);
      return;
    }

    if (g.breakText && sp !== "baseball") { setPeriod(g.breakText.toUpperCase()); setClockDisplay(""); dd.textContent = ""; poss(null, g); return; }

    if (sp === "baseball") {
      // "Top 5th" etc. No clock; count, outs and runners go in the line under it
      setPeriod(String(g.detail || "").replace(/^Bottom/i, "Bot").toUpperCase());
      setClockDisplay("");
      var s0 = g.situation;
      dd.innerHTML = s0 ? '<span class="bases">' + s0.bases.map(function (b, i) { return '<i class="b' + (i + 1) + (b ? " on" : "") + '"></i>'; }).join("") + "</span>" +
        (s0.balls != null ? s0.balls + "-" + s0.strikes + " · " : "") + (s0.outs != null ? s0.outs + " OUT" + (s0.outs === 1 ? "" : "S") : "") : "";
      poss(null, g);
      return;
    }
    if (sp === "soccer") {
      // soccer shows the match minute ("67'") instead of a countdown
      setPeriod(g.period > 2 ? "ET" : g.period === 2 ? "2ND" : "1ST");
      clk.secs = null; setClockDisplay(String(g.clock || "").replace(/'?$/, "'"));
      dd.textContent = ""; poss(null, g);
      return;
    }

    var lbl = ordinal(g.period);
    if (sp === "hockey") lbl = g.period > 3 ? (g.period === 4 ? "OT" : "SO") : ordinal(g.period);
    if (sp === "ncaab") lbl = g.period > 2 ? (g.period === 3 ? "OT" : (g.period - 2) + "OT") : (g.period === 1 ? "1ST HALF" : "2ND HALF");
    if (sp === "basketball") lbl = g.period > 4 ? (g.period === 5 ? "OT" : (g.period - 4) + "OT") : (cfg.skin === "tv" ? ordinal(g.period) : "Q" + g.period);
    setPeriod(lbl);
    syncClock(g.clock);
    // under a minute basketball/hockey send "45.6" instead of "0:45"; show that as-is
    setClockDisplay(fmtClock() || (/^\d+(\.\d+)?$/.test(String(g.clock || "")) ? String(g.clock) : ""));
    clk.live = true;

    dd.textContent = sp === "football" ? ((g.situation && g.situation.dd) || "") : "";
    poss(sp === "football" ? g.situation : null, g);
  }

  var lastPeriodText = null;
  function setPeriod(text) {
    var per = $("period");
    per.textContent = text;
    if (lastPeriodText !== null && lastPeriodText !== text) {
      per.classList.remove("pulse");
      void per.offsetWidth;
      per.classList.add("pulse");
    }
    lastPeriodText = text;
  }

  // Football icon beside the team with the ball, plus an underline
  // that grows along the bottom of that team's half of the bar.
  function poss(s, g) {
    var a = $("awayPoss"), h = $("homePoss");
    var awayBall = !!(s && s.possessionId && String(s.possessionId) === String(g.away.id));
    var homeBall = !!(s && s.possessionId && String(s.possessionId) === String(g.home.id));
    a.classList.toggle("on", awayBall);
    h.classList.toggle("on", homeBall);
    a.closest(".side").classList.toggle("has-ball", awayBall);
    h.closest(".side").classList.toggle("has-ball", homeBall);
  }

  /* ---------------- clock ----------------
     The scoreboard endpoint only tells us what the clock currently
     reads, not whether it's actually counting down right now (dead
     balls, incomplete passes, penalties etc. all stop it with no
     signal we can see). So by default this just displays the last
     polled value — accurate, if a little steppy between polls — and
     animates a flip whenever that value changes.

     cfg.liveClock is an optional, approximate local tick for a
     smoother look between polls. It's a guess and can occasionally
     correct itself with a visible jump when the real value arrives. */
  function parseClock(raw) {
    var m = String(raw || "").match(/^(\d+):(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  function fmtClock() {
    if (clk.secs === null) return "";
    var m = Math.floor(clk.secs / 60), s = clk.secs % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function syncClock(raw) {
    var s = parseClock(raw);
    if (s === null) { clk.secs = null; clk.raw = raw || null; return; }
    if (clk.raw !== null) clk.running = (clk.raw !== raw);
    clk.raw = raw;
    if (clk.secs === null || Math.abs(clk.secs - s) > 2) clk.secs = s;
  }
  function localClock() {
    if (!cfg.liveClock || !clk.live || !clk.running) return;
    if (clk.secs === null || clk.secs <= 0) return;
    clk.secs -= 1;
    setClockDisplay(fmtClock());
  }

  // Flip-clock style transition: slides the old value up and out while
  // the new one slides in from below. No-op if the value didn't change.
  var flipTimer = null;
  function setClockDisplay(text) {
    var cur = $("timeCur"), next = $("timeNext"), track = $("timeTrack");
    $("time").classList.toggle("none", !text);
    $("sb").classList.toggle("sb--noclock", !text);   // no clock (pre-game, final): let the label center itself
    if (cur.textContent === text) return;

    if (!cur.textContent) { cur.textContent = text; return; } // first paint, no animation

    next.textContent = text;
    track.classList.add("flip");
    clearTimeout(flipTimer);
    flipTimer = setTimeout(function () {
      track.classList.remove("flip");
      cur.textContent = text;
      next.textContent = "";
    }, 380);
  }

  /* ---------------- field ---------------- */
  var drive = { team: null, start: 0 };

  function drawField(g) {
    var field = $("field");
    var live = g.state === "in";

    // minimal layout: no field. The (empty) strip stays only as the anchor
    // the big-play chip hangs from, so don't draw anything into it.
    if (cfg.minimal) { field.classList.remove("off"); return; }

    if (sport() !== "football" || !cfg.showField || (cfg.fieldOnlyLive && !live)) { field.classList.add("off"); return; }
    field.classList.remove("off");
    paintNumbers();
    fitEndzones();

    var los = $("losLine"), fd = $("fdLine"), ball = $("ball"), rz = $("rzFlag");
    var band = $("driveBand");
    var s = g.situation;
    var p = (live && s) ? fieldPos(s, g) : null;

    if (p === null || isNaN(p)) {
      [los, fd, ball, rz, band].forEach(function (el) { el.classList.remove("on"); });
      drive.team = null;
      return;
    }

    // Drive shading: the scoreboard feed doesn't say where a drive began, so
    // we remember the first spot we see after possession changes. (If the
    // widget loads mid-drive, the band starts from wherever it first sees the ball.)
    var teamKey = String(s.possessionId);
    if (drive.team !== teamKey) { drive.team = teamKey; drive.start = p; }
    var from = Math.min(drive.start, p), span = Math.abs(p - drive.start);
    band.style.left = from + "%";
    band.style.width = span + "%";
    band.className = "drive " + (teamKey === String(g.away.id) ? "drive--away" : "drive--home") +
                     (span >= 0.5 ? " on" : "");

    var dir = String(s.possessionId) === String(g.away.id) ? 1 : -1;
    var dist = Number(s.distance);
    var fdPos = isNaN(dist) ? null : clamp(p + dir * dist, 0, 100);

    place(los, p); los.classList.add("on");
    place(ball, p); ball.classList.add("on");

    if (fdPos === null || !s.down) {
      fd.classList.remove("on");
    } else {
      place(fd, fdPos); fd.classList.add("on");
    }
    rz.classList.toggle("on", !!s.redZone);
  }

  // 0 = away goal line (left), 100 = home goal line (right)
  function fieldPos(s, g) {
    var m = String(s.text || "").match(/([A-Za-z&]+)?\s*(\d{1,2})\s*$/);
    if (m) {
      var yd = parseInt(m[2], 10), abbr = norm(m[1]);
      if (!abbr || yd === 50) return 50;
      if (abbr === norm(g.away.abbr)) return yd;
      if (abbr === norm(g.home.abbr)) return 100 - yd;
    }
    var y = Number(s.yardLine);
    if (isNaN(y)) return null;
    return String(s.possessionId) === String(g.away.id) ? y : 100 - y;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function place(el, p) { el.style.left = clamp(p, 0, 100) + "%"; }

  var numbersPainted = false;
  function paintNumbers() {
    if (numbersPainted) return;
    numbersPainted = true;
    var html = "";
    for (var y = 10; y <= 90; y += 10) {
      html += '<i style="left:' + y + '%">' + (y <= 50 ? y : 100 - y) + "</i>";
    }
    $("numbers").innerHTML = html;
  }

  /* ---------------- event detection ---------------- */
  function detectEvents(g) {
    var lp = g.lastPlay;
    if (!lp || !lp.id) return;
    if (lp.id === prev.playId) return;

    var first = prev.playId === null;
    prev.playId = lp.id;
    if (first || !cfg.enableAlerts || g.state !== "in") return;

    // Whose play was it?
    var team = String(lp.teamId) === String(g.home.id) ? g.home
             : String(lp.teamId) === String(g.away.id) ? g.away : null;

    if (cfg.myTeamOnly && team && String(team.id) !== String(g.myId)) return;

    var t = lp.typeText.toLowerCase() + " " + lp.text.toLowerCase();
    var missedFG = /field goal/.test(t) && /no good|missed|blocked/.test(t);
    var turnover = !lp.scoring && /interception|intercepted by|fumble recovery|fumble return/.test(t);
    var safety = !lp.scoring && /safety/.test(t);

    if (lp.scoring) {
      var category = lp.value >= 6 ? "TOUCHDOWN"
                    : lp.value === 3 ? "FIELD GOAL"
                    : lp.value === 2 ? "TWO-POINT CONVERSION"
                    : /safety/.test(t) ? "SAFETY" : "EXTRA POINT";
      if (category === "EXTRA POINT") return;   // too noisy to alert on
      enqueue({ kind: "score", category: category, made: true, play: lp, team: team });
      return;
    }
    if (missedFG) {
      enqueue({ kind: "score", category: "FIELD GOAL", made: false, play: lp, team: team });
      return;
    }
    if (turnover) {
      var isInt = /interception|intercepted by/.test(t);
      var rec = isInt ? null : parseRecoverer(lp.text);
      var who = isInt ? parseInterceptor(lp.text) : (rec && rec.name) || "";
      var defTeam = team;
      if (rec && rec.abbr) {
        defTeam = rec.abbr === String(g.home.abbr).toUpperCase() ? g.home
                : rec.abbr === String(g.away.abbr).toUpperCase() ? g.away : team;
      } else if (isInt && team) {
        defTeam = team === g.home ? g.away : g.home;   // the pick belongs to the other side
      }
      if (cfg.myTeamOnly && defTeam && String(defTeam.id) !== String(g.myId)) return;
      // small chip; interceptions get the defender's photo, fumble recoveries and sacks don't
      enqueue({
        kind: "ribbon", tag: isInt ? "INTERCEPTION" : "FUMBLE RECOVERY",
        play: lp, name: who, exact: true, noPhoto: !isInt
      });
      return;
    }
    if (isSack(lp)) {
      if (cfg.showBigPlayRibbon) {
        var sacker = parseSacker(lp.text);
        var sackTeam = team ? (team === g.home ? g.away : g.home) : null;
        if (!(cfg.myTeamOnly && sackTeam && String(sackTeam.id) !== String(g.myId))) {
          var loss = !isNaN(lp.yards) && lp.yards ? " " + "-" + Math.abs(lp.yards) + " YDS" : "";
          enqueue({ kind: "ribbon", tag: "SACK" + loss, play: lp, name: sacker, exact: true, noPhoto: true });
        }
      }
      return;
    }
    var ret = isBigReturn(lp);
    if (ret) {
      if (cfg.showBigPlayRibbon) {
        enqueue({ kind: "ribbon", tag: ret.yards + " YD RETURN", play: lp, name: ret.name, exact: true });
      }
      snapBall();
      return;
    }
    if (safety) {
      enqueue({ kind: "score", category: "SAFETY", made: true, play: lp, team: team });
      return;
    }
    // Big plays are scrimmage plays only. Kickoffs and punts report the
    // kick distance as their "yardage", which would flag every one of them.
    if (isBigPlay(lp)) {
      if (cfg.showBigPlayRibbon) {
        enqueue({ kind: "ribbon", tag: lp.yards + " YD " + playKind(t), play: lp });
      }
      snapBall();
    }
  }

  // basketball: timeouts left + team fouls this period, counted from ESPN's play-by-play
  var bball = { id: null, t: 0, data: null, busy: false };
  function basketballExtras(g) {
    var sp = sport();
    if ((sp !== "basketball" && sp !== "ncaab") || g.state !== "in") { drawBB(null, g); return; }
    drawBB(bball.id === g.eventId ? bball.data : null, g);
    if (bball.busy || (bball.id === g.eventId && Date.now() - bball.t < 7000)) return;
    bball.busy = true;
    fetch(summaryEndpoint(g.eventId), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      var plays = d.plays || [], per = g.period, out = {};
      var college = sp === "ncaab";
      var otPeriods = Math.max(0, per - (college ? 2 : 4));
      [g.away, g.home].forEach(function (t) {
        var used = 0, fouls = 0;
        plays.forEach(function (p) {
          var tid = p.team && String(p.team.id), txt = ((p.type && p.type.text) || "") + " " + (p.text || "");
          if (tid !== String(t.id)) return;
          if (/timeout/i.test(txt) && !/official|tv timeout|media/i.test(txt)) used++;
          var pp = p.period && (p.period.number || p.period);
          if (pp === per && /foul/i.test(txt) && !/offensive|technical|flagrant|delay/i.test(txt)) fouls++;
        });
        var total = college ? 0 : 7 + otPeriods * 2;
        out[t.id] = { to: total ? Math.max(0, total - used) : null, fouls: fouls, bonus: fouls >= (college ? 7 : (per > 4 ? 4 : 5)) };
      });
      bball = { id: g.eventId, t: Date.now(), data: out, busy: false };
      if (current && current.eventId === g.eventId) drawBB(out, current);
    }).catch(function () { bball.busy = false; });
  }
  function drawBB(data, g) {
    [["away", g.away], ["home", g.home]].forEach(function (x) {
      var el = $(x[0] + "Fouls"); if (!el) return;
      var d = data && data[x[1].id];
      if (!d) { el.innerHTML = ""; if (sport() === "basketball" || sport() === "ncaab") timeouts($(x[0] + "Tos"), null); return; }
      if (d.to !== null) timeouts($(x[0] + "Tos"), d.to, 7);
      el.innerHTML = d.bonus ? '<b class="bonus">BONUS</b>' : 'FOULS: <b>' + d.fouls + "</b>";
    });
  }

  // network scorebugs (CBS, FOX, NBC, Prime, ESPN, Netflix, World Feed): own HTML per network, see sports-bugs.js
  var LEAGUE_LOGO = { nfl: "nfl", "college-football": "ncaa", nba: "nba", wnba: "wnba", "mens-college-basketball": "ncaa", "womens-college-basketball": "ncaa", nhl: "nhl", mlb: "mlb", "usa.1": "mls", "eng.1": "eng.1", "uefa.champions": "uefa.champions", ufl: "ufl", cfl: "cfl" };
  function drawBug(g) {
    var sb = $("sb"), wrap = $("bugwrap");
    var on = !!(window.SBBugs && wrap && SBBugs.has(cfg.skin));
    sb.classList.toggle("sb--bug", on);
    sb.classList.toggle("sb--testing", on && testing);
    if (!on) { if (wrap) wrap.innerHTML = ""; return; }
    var s = g.situation, foot = sport() === "football";
    var team = function (t, k) {
      var c = t.accent || t.color;
      return { abbr: t.abbr, logo: logoFor(t), color: c, color2: t.alt && lum(t.alt) > 0.03 ? t.alt : c, ink: inkFor(c), score: t.score, rec: t.record, rank: t.rank,
        to: foot && s && truthy(cfg.showTimeouts) ? (k === "a" ? s.awayTos : s.homeTos) : null,
        ball: foot && g.state === "in" && !!(s && s.possessionId) && String(s.possessionId) === String(t.id) };
    };
    var clock = $("time").classList.contains("none") ? "" : ($("timeCur").textContent || "");
    var dd = foot && g.state === "in" && s && s.dd ? String(s.dd).split(/\s+at\s+/i)[0] : "";
    var lk = leaguePath().split("/")[1] || "nfl";
    SBBugs.render(wrap, cfg.skin, {
      a: team(g.away, "a"), h: team(g.home, "h"), period: $("period").textContent || "", clock: clock, dd: dd, status: "",
      net: lk === "nfl" ? "TNF" : String(cfg.league || "").toUpperCase(), week: g.week || "",
      leagueLogo: "https://a.espncdn.com/i/teamlogos/leagues/500/" + (LEAGUE_LOGO[lk] || lk) + ".png"
    });
  }

  // hockey / soccer / baseball: an alert whenever a team's score goes up
  var lastScoreAlert = 0;
  function detectScores(g) {
    if (!prev.primed || !cfg.enableAlerts || g.state !== "in" || testing) return;
    var sp = sport();
    if (sp === "basketball" || sp === "ncaab") return;   // baskets are too frequent to alert on
    ["away", "home"].forEach(function (k) {
      var d = (parseInt(g[k].score, 10) || 0) - (parseInt(prev[k], 10) || 0);
      if (d <= 0) return;
      var team = g[k];
      if (cfg.myTeamOnly && String(team.id) !== String(g.myTeamId || "")) return;
      var evId = current && current.eventId;
      fetchLastScore(evId).then(function (sc) {
        var txt = (sc && sc.text) || "";
        var cat = sp === "baseball" ? (/homer|home run/i.test(txt) ? (d >= 4 || /grand slam/i.test(txt) ? "GRAND SLAM" : "HOME RUN") : (d > 1 ? d + " RUNS SCORE" : "RUN SCORES")) : "GOAL";
        enqueue({ kind: "score", category: cat, made: true, team: team, name: (sc && sc.name) || "",
          play: { text: txt, yards: NaN, athletes: (sc && sc.athletes) || [], scoring: true } });
      });
    });
  }
  // the newest scoring play from the game summary: who scored + their photo
  function fetchLastScore(eventId) {
    if (!eventId) return Promise.resolve(null);
    return fetch(summaryEndpoint(eventId), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (data) {
      var plays = data.scoringPlays || [];
      if (!plays.length && data.plays) plays = data.plays.filter(function (p) { return p.scoringPlay; });
      var hit = plays[plays.length - 1]; if (!hit) return null;
      var raw = hit.athletesInvolved || hit.participants || [];
      var cdn = sport() === "soccer" ? "soccer" : (leaguePath().split("/")[1] || "");
      var athletes = raw.map(function (a) { var at = a.athlete || a; var id = at.id;
        return { name: at.displayName || at.fullName || at.shortName || "", headshot: (at.headshot && at.headshot.href) || (typeof at.headshot === "string" ? at.headshot : "") || (id ? "https://a.espncdn.com/i/headshots/" + cdn + "/players/full/" + id + ".png" : "") }; })
        .filter(function (a) { return a.name; });
      return { text: hit.text || (hit.type && hit.type.text) || "", athletes: athletes, name: athletes[0] ? athletes[0].name : "" };
    }).catch(function () { return null; });
  }

  function isBigPlay(lp) {
    var isScrimmage = lp.typeText
      ? /pass|rush|run|scramble|reception/i.test(lp.typeText)
      : /pass|rush|run|scramble/i.test(lp.text) && !/punt|kick/i.test(lp.text);
    return isScrimmage && !isNaN(lp.yards) && Math.abs(lp.yards) >= cfg.bigPlayYards;
  }

  function playKind(t) {
    if (/pass/.test(t)) return "PASS";
    if (/rush|run/.test(t)) return "RUN";
    return "GAIN";
  }

  // Fallback name/yardage parsing straight from ESPN's play text, used
  // whenever the richer athletesInvolved data isn't available (that data
  // only exists for plays that actually scored — see fetchScoringAthletes
  // above — so missed kicks and plain turnovers rely on this instead).
  function parsePlayName(text) {
    var m = String(text || "").match(/^([A-Za-z.'\-]+(?:\s+[A-Za-z.'\-]+){0,3}?)\s+\d{1,3}\s*Yd\b/i);
    return m ? m[1].trim() : "";
  }
  // Defensive plays are written differently from scoring plays, e.g.
  //  "...INTERCEPTED by X.McKinney at GB 45. X.McKinney return for 3 yds"
  //  "...FUMBLES ... RECOVERED by GB-J.Love at GB 20"
  //  "J.Love sacked at GB 21 for -7 Yds (J.Greenard)"
  //  "K.Nixon returns 44 yds to GB 44"
  function cleanName(n) { return String(n || "").replace(/^[A-Z]{2,4}-/, "").trim(); }
  function parseInterceptor(text) {
    var m = String(text).match(/INTERCEPTED by ([A-Za-z.'\- ]+?)(?: at | \(|,|\.\s|$)/i);
    return m ? cleanName(m[1]) : "";
  }
  function parseRecoverer(text) {
    var m = String(text).match(/RECOVERED by ([A-Za-z]{2,4}-)?([A-Za-z.'\-]+(?: [A-Za-z.'\-]+)?)(?: at | \(|,|\.\s|$)/i);
    return m ? { name: cleanName(m[2]), abbr: (m[1] || "").replace("-", "").toUpperCase() } : null;
  }
  function parseSacker(text) {
    var m = String(text).match(/sacked.*?\(([^)]+)\)/i);
    return m ? m[1].split(/[,;]/)[0].trim() : "";
  }
  function isSack(lp) { return /sack/i.test(lp.typeText + " " + lp.text) && !lp.scoring; }
  function parseReturn(text) {
    var m = String(text).match(/([A-Z][A-Za-z.'\-]*\.?[A-Za-z'\-]+)\s+returns?\s+(?:for\s+)?(-?\d{1,3})\s*(?:yds|yards)/i);
    return m ? { name: m[1], yards: parseInt(m[2], 10) } : null;
  }
  function isBigReturn(lp) {
    if (lp.scoring || !/kickoff|punt/i.test(lp.typeText + " " + lp.text)) return null;
    var r = parseReturn(lp.text);
    return r && r.yards >= cfg.bigPlayYards ? r : null;
  }
  function isTurnoverPlay(lp) {
    return !lp.scoring && /interception|fumble recovery|fumble return|recovered by|intercepted by/i.test(lp.typeText + " " + lp.text);
  }

  function parsePlayYards(text) {
    var m = String(text || "").match(/(\d{1,3})\s*Yd/i);
    return m ? parseInt(m[1], 10) : null;
  }
  // Finds the athlete-list entry whose name matches the text-parsed name
  // (by surname, since ESPN sometimes abbreviates first names differently
  // between the play text and the athlete list, e.g. "J.Moody" vs "Jake Moody").
  function matchAthlete(athletes, textName) {
    if (!textName || !athletes.length) return null;
    var surname = textName.trim().split(/[\s.]+/).pop().toLowerCase();
    if (surname.length < 3) return null;
    return athletes.find(function (a) {
      return a.name && a.name.toLowerCase().indexOf(surname) > -1;
    }) || null;
  }

  function snapBall() {
    var b = $("ball");
    b.classList.remove("snap"); void b.offsetWidth; b.classList.add("snap");
  }

  /* ---------------- alert queue ---------------- */
  function enqueue(item) {
    queue.push(item);
    if (!showing) next();
  }

  function next() {
    if (!queue.length) { showing = false; return; }
    showing = true;
    var item = queue.shift();
    (item.kind === "ribbon" ? showRibbon : showAlert)(item, function () {
      setTimeout(next, 400);
    });
  }

  function showRibbon(item, done) {
    var r = $("ribbon");
    var lp = item.play;
    var textName = item.name || parsePlayName(lp.text);
    var athlete = matchAthlete(lp.athletes || [], textName) || (item.exact ? null : (lp.athletes || [])[0]);
    $("ribbonTag").textContent = item.tag;
    $("ribbonTxt").textContent = (athlete && athlete.name) || textName || "Big play";
    var img = $("ribbonImg");
    img.classList.add("off");
    img.onerror = function () { img.classList.add("off"); };
    img.onload = function () { img.classList.remove("off"); };
    img.src = (!item.noPhoto && athlete && athlete.headshot) || "";
    r.classList.add("on");
    setTimeout(function () { r.classList.remove("on"); done(); }, 4500);
  }

  // Builds the two-line alert: player name, then "{yards} Yd {play}".
  function playLine(item, yards) {
    var y = yards ? yards + " Yd " : "";
    switch (item.category) {
      case "TOUCHDOWN":            return y + "Touchdown";
      case "FIELD GOAL":           return y + "Field Goal" + (item.made ? "" : " — No Good");
      case "SAFETY":                return "Safety";
      case "INTERCEPTION":         return y + "Interception";
      case "FUMBLE RECOVERY":      return y + "Fumble Recovery";
      case "TWO-POINT CONVERSION": return "Two-Point Conversion";
      case "GOAL":                 return "Goal";
      case "HOME RUN":             return "Home Run";
      case "GRAND SLAM":           return "Grand Slam";
      default:                     return item.category;
    }
  }

  function showAlert(item, done) {
    var a = $("alert"), lp = item.play, team = item.team;
    var base = (team && team.accent) || "#b3202f";
    root.style.setProperty("--alert", base);
    root.style.setProperty("--alert-dark", shade(base, -0.45));
    root.style.setProperty("--alert-ink", inkFor(base));

    var yards = !isNaN(lp.yards) ? lp.yards : parsePlayYards(lp.text);

    // The play text reliably names the actual scorer/kicker first (e.g.
    // "J.Moody 28 yard field goal is GOOD, Center-..., Holder-...") — so
    // that's the name shown, not whichever entry the athlete list happens
    // to list first (which can be a holder or long snapper on some plays).
    var textName = item.name || parsePlayName(lp.text);
    var athlete = matchAthlete(lp.athletes, textName) || (item.exact ? null : lp.athletes[0]);
    var name = (athlete && athlete.name) || textName || (team ? team.name : "");

    $("alertName").textContent = name;
    $("alertPlay").textContent = playLine(item, yards);

    // Headshots only exist in ESPN's data for plays that scored (see the
    // comment on fetchScoringAthletes). Missed kicks, plain turnovers, or a
    // photo that fails to load show the team logo on the backdrop instead.
    var heads = $("alertHeads"), mark = $("alertMark");
    var teamLogo = team ? logoFor(team) : "";
    $("alertLogo").src = teamLogo;

    var showLogoInstead = function () {
      heads.innerHTML = "";
      if (teamLogo) {
        var lg = document.createElement("img");
        lg.className = "logo";
        lg.alt = "";
        lg.src = teamLogo;
        heads.appendChild(lg);
      }
      mark.classList.add("off");   // logo is already on the backdrop
    };

    heads.innerHTML = "";
    if (athlete && athlete.headshot) {
      var img = document.createElement("img");
      img.alt = "";
      img.onerror = showLogoInstead;
      img.src = athlete.headshot;
      heads.appendChild(img);
      mark.classList.remove("off");
    } else {
      showLogoInstead();
      if (lp.scoring) console.warn("[scoreboard] no headshot found for scoring play:", lp);
    }

    a.classList.add("on");
    setTimeout(function () {
      a.classList.remove("on");
      done();
    }, cfg.alertDuration * 1000);
  }

  /* ---------------- test drive ----------------
     Turn on "Test drive" in the widget settings to run this instead of ESPN.
     It plays a scripted Vikings-Packers game through the exact same render()
     pipeline as live data, so everything gets exercised: field markers, drive
     shading, possession changes, the big-play banner, red zone, touchdown
     alerts with headshots, a missed field goal, and a quarter change.
     One simulated play every "testDriveSpeed" seconds, then it loops.

     Field position (pos) counts yards from the AWAY goal line, 0-100,
     so Minnesota (away) drives toward 100 and Green Bay (home) toward 0. */
  var MIN_ID = "8", GB_ID = "9";
  var SIM_TEAMS = {
    "8": { id: "8", abbr: "MIN", name: "Minnesota Vikings", nickname: "Vikings",
           logo: "https://a.espncdn.com/i/teamlogos/nfl/500/min.png",
           color: "#4f2683", alt: "#ffc62f", record: "5-2" },
    "9": { id: "9", abbr: "GB", name: "Green Bay Packers", nickname: "Packers",
           logo: "https://a.espncdn.com/i/teamlogos/nfl/500/gb.png",
           color: "#203731", alt: "#ffb612", record: "4-3" }
  };
  var JEFFERSON = { name: "Justin Jefferson",
                    headshot: "https://a.espncdn.com/i/headshots/nfl/players/full/4262921.png" };

  // one simulated play
  function sp(text, yards, type, team, o) {
    o = o || {};
    return { text: text, yards: yards, typeText: type, teamId: team,
             scoring: !!o.scoring, value: o.value || 0, athletes: o.athletes || [] };
  }

  // Each step inherits any field it leaves out from the step before it.
  var SIM_RAW = [
    // Drive 1: Vikings from their own 25. Runs, a 44-yard shot into the red zone, a touchdown.
    { t: MIN_ID, pos: 25, down: 1, dist: 10, per: 1, clk: "5:30", sc: [0, 0], to: [3, 3],
      play: sp("Kickoff touchback", 0, "Kickoff", GB_ID) },
    { pos: 29, down: 2, dist: 6,  clk: "5:08",
      play: sp("Aaron Jones 4 Yd Run", 4, "Rush", MIN_ID) },
    { pos: 37, down: 1, dist: 10, clk: "4:41",
      play: sp("Justin Jefferson 8 Yd pass from J.J. McCarthy", 8, "Pass Reception", MIN_ID) },
    { pos: 37, down: 2, dist: 10, clk: "4:35",
      play: sp("J.J. McCarthy pass incomplete intended for Jordan Addison", 0, "Pass Incompletion", MIN_ID) },
    { pos: 81, down: 1, dist: 10, clk: "4:12",
      play: sp("Jordan Addison 44 Yd pass from J.J. McCarthy", 44, "Pass Reception", MIN_ID,
               { athletes: [{ name: "Jordan Addison", headshot: "https://a.espncdn.com/i/headshots/nfl/players/full/4429205.png" }] }) },
    { pos: 84, down: 2, dist: 7,  clk: "3:44",
      play: sp("Aaron Jones 3 Yd Run", 3, "Rush", MIN_ID) },
    { pos: 96, down: 1, dist: 4,  clk: "3:19",
      play: sp("T.J. Hockenson 12 Yd pass from J.J. McCarthy", 12, "Pass Reception", MIN_ID) },
    { pos: 98, down: 2, dist: 2,  clk: "2:57",
      play: sp("Aaron Jones 2 Yd Run", 2, "Rush", MIN_ID) },
    { pos: 100, down: 0, dist: 0, clk: "2:41", sc: [7, 0],
      play: sp("Justin Jefferson 2 Yd pass from J.J. McCarthy", 2, "Receiving Touchdown", MIN_ID,
               { scoring: true, value: 6, athletes: [JEFFERSON] }) },

    // Drive 2: Packers. Possession flips and the drive shading resets. Ends in a punt;
    // that 45-yard punt must NOT trigger a big-play banner.
    { t: GB_ID, pos: 75, down: 1, dist: 10, clk: "2:35",
      play: sp("Kickoff touchback", 0, "Kickoff", MIN_ID) },
    { pos: 72, down: 2, dist: 7,  clk: "2:12",
      play: sp("Josh Jacobs 3 Yd Run", 3, "Rush", GB_ID) },
    { pos: 79, down: 3, dist: 14, clk: "1:48", to: [3, 2],
      play: sp("Jordan Love sacked at GB 21 for -7 Yds (Jonathan Greenard)", -7, "Sack", GB_ID,
               { athletes: [{ name: "Jordan Love" }, { name: "Jonathan Greenard" }] }) },
    { t: MIN_ID, pos: 38, down: 1, dist: 10, clk: "1:40",
      play: sp("Daniel Whelan punts 45 yards, returned for 5 yards", 45, "Punt", GB_ID) },

    // Drive 3: Vikings again. A 54-yard touchdown to Jefferson.
    { pos: 46, down: 2, dist: 2,  clk: "1:14",
      play: sp("Aaron Jones 8 Yd Run", 8, "Rush", MIN_ID) },
    { pos: 100, down: 0, dist: 0, clk: "1:01", sc: [14, 0],
      play: sp("Justin Jefferson 54 Yd pass from J.J. McCarthy", 54, "Receiving Touchdown", MIN_ID,
               { scoring: true, value: 6, athletes: [JEFFERSON] }) },

    // Drive 4: Packers. A missed field goal (no photo, so the alert falls back to the team logo).
    { t: GB_ID, pos: 72, down: 1, dist: 10, clk: "0:55",
      play: sp("Kickoff return to the GB 28", 0, "Kickoff", MIN_ID) },
    { pos: 50, down: 1, dist: 10, clk: "0:38",
      play: sp("Romeo Doubs 22 Yd pass from Jordan Love", 22, "Pass Reception", GB_ID) },
    { pos: 31, down: 1, dist: 10, clk: "0:21",
      play: sp("Josh Jacobs 19 Yd Run", 19, "Rush", GB_ID) },
    { pos: 31, down: 4, dist: 10, clk: "0:09", to: [2, 2],
      play: sp("Brandon McManus 48 Yd Field Goal is No Good", 48, "Field Goal", GB_ID) },

    // New quarter, ball goes back to Minnesota (shows the quarter change), then it loops.
    { t: MIN_ID, pos: 31, down: 1, dist: 10, per: 2, clk: "15:00", play: null },

    // Interception: Minnesota throws it away; the alert names the defender, not the QB.
    { t: GB_ID, pos: 55, down: 1, dist: 10, clk: "14:48",
      play: sp("J.J. McCarthy pass deep right intended for J.Jefferson INTERCEPTED by X.McKinney at GB 45. X.McKinney return for 0 yds", 0, "Pass Interception Return", MIN_ID,
               { athletes: [{ name: "J.J. McCarthy" }, { name: "Xavier McKinney" }] }) }
  ];

  var SIM_STEPS = (function () {
    var out = [], last = {};
    SIM_RAW.forEach(function (s) {
      var m = {};
      Object.keys(last).forEach(function (k) { m[k] = last[k]; });
      Object.keys(s).forEach(function (k) { m[k] = s[k]; });
      m.play = s.play || null;
      out.push(m);
      last = m;
    });
    return out;
  })();

  function simTeam(t, score) {
    var o = {};
    Object.keys(t).forEach(function (k) { o[k] = t[k]; });
    o.score = String(score);
    return o;
  }

  var simI = -1, simLoop = 0;
  function simGame() {
    simI++;
    if (simI >= SIM_STEPS.length) { simI = 0; simLoop++; }
    var s = SIM_STEPS[simI];
    var away = SIM_TEAMS[MIN_ID], home = SIM_TEAMS[GB_ID];
    var awayBall = s.t === MIN_ID;
    var toGoal = awayBall ? 100 - s.pos : s.pos;
    var spot = s.pos === 50 ? "50"
             : s.pos < 50 ? away.abbr + " " + s.pos
             : home.abbr + " " + (100 - s.pos);
    var ord = ["", "1st", "2nd", "3rd", "4th"][s.down] || "";
    var dd = (!s.down || s.pos <= 0 || s.pos >= 100) ? ""
           : ord + " & " + (s.dist >= toGoal ? "Goal" : s.dist);
    var lp = s.play;

    return {
      state: "in", halftime: false, period: s.per, clock: s.clk,
      startDate: new Date().toISOString(), myId: away.id,
      away: simTeam(away, s.sc[0]),
      home: simTeam(home, s.sc[1]),
      situation: {
        possessionId: s.t, text: spot, yardLine: awayBall ? s.pos : 100 - s.pos,
        distance: s.dist, down: s.down, dd: dd, redZone: toGoal <= 20,
        awayTos: s.to[0], homeTos: s.to[1]
      },
      lastPlay: lp ? {
        id: "sim" + simLoop + "-" + simI, text: lp.text, scoring: lp.scoring,
        value: lp.value, yards: lp.yards, typeText: lp.typeText,
        teamId: lp.teamId, athletes: lp.athletes
      } : null
    };
  }
})();