// Live relay between control rooms and OBS overlays.
// Uses a public MQTT broker over secure websockets (no daily message cap) and remembers the
// last message per topic ("retained"), so an overlay that reloads gets the current state right away.
// Usage: Relay.pub(topic, obj, { retain: true }) · Relay.sub(topic, obj => ...)
window.Relay = window.Relay || (() => {
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  const LIB = 'https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js';
  const subs = new Map();   // topic -> [callbacks]
  let client = null, ready = null, bi = 0;

  const loadLib = () => window.mqtt ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = LIB; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
  function connect() {
    if (ready) return ready;
    ready = loadLib().then(() => new Promise(res => {
      const url = BROKERS[bi % BROKERS.length];
      client = window.mqtt.connect(url, { clientId: 'outlaw_' + Math.random().toString(36).slice(2, 10), clean: true, reconnectPeriod: 3000, connectTimeout: 8000, keepalive: 30 });
      let opened = false;
      client.on('connect', () => { opened = true; for (const t of subs.keys()) client.subscribe(t, { qos: 0 }); res(client); });
      client.on('message', (t, buf) => { let m; try { m = JSON.parse(buf.toString()); } catch (_) { return; } (subs.get(t) || []).forEach(cb => { try { cb(m); } catch (_) {} }); });
      // first broker unreachable: try the next one
      setTimeout(() => { if (!opened) { try { client.end(true); } catch (_) {} bi++; ready = null; res(connect()); } }, 9000);
    })).catch(() => { ready = null; return null; });
    return ready;
  }
  return {
    sub(topic, cb) {
      if (!subs.has(topic)) subs.set(topic, []);
      subs.get(topic).push(cb);
      connect().then(c => c && c.connected && c.subscribe(topic, { qos: 0 }));
    },
    pub(topic, obj, opts = {}) {
      return connect().then(c => new Promise((res, rej) => {
        if (!c) return rej(new Error('relay offline'));
        c.publish(topic, JSON.stringify(obj), { qos: 0, retain: !!opts.retain }, err => err ? rej(err) : res(true));
      }));
    },
  };
})();
