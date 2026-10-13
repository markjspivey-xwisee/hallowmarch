// [net] Players that are not pages: each speaks the stand-in room's own messages (src/00n_netstub.js) on its
// BroadcastChannel from inside a page, with a profile and a fast state ten times a second, walking where it is told
// (a circle, a line, standing), answering a party's invite when asked to, and keeping what the page says to it.
// Used by tools/tests/touch_flows.py (only=net: party and chat by touch) and tools/tests/net.py (perf: ten players drawn).
window.NF = {
  list: [],
  add(o) {
    const room = (window.__HM_NET && window.__HM_NET.room) || 'default';
    const ch = new BroadcastChannel('hm-net-' + room);
    const peer = 'fake' + Math.random().toString(36).slice(2, 10);
    const F = { ch, peer, by: 'u' + peer, o, seq: 0, ev: [], evSeq: 0, seen: new Set(), heard: [], t0: performance.now(), ang: o.ang || 0 };
    const H = window.__hm;
    F.slow = { v: 1, on: 1, since: o.since ?? 1, n: o.name, dn: o.name, r: o.realm ?? 0, c: o.cls || 'warrior', l: o.level || 30, rr: 1, pt: o.party || '' };
    F.state = () => {
      const x = F.o.x, z = F.o.z, y = H.fn.heightAt(x, z);
      return { s: ++F.seq, t: Math.round(performance.now()), p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], y: +(F.o.yaw || 0).toFixed(3), v: [+(F.o.vx || 0).toFixed(2), +(F.o.vz || 0).toFixed(2)], a: F.o.a || 0, h: F.o.h ?? 1, m: 2000, d: 0, mo: 0, ph: 0, sw: 0, st: 0, cs: 0, fl: 0, tg: '', ev: F.ev.slice(-20) };
    };
    F.send = () => {
      ch.postMessage(JSON.stringify({ type: 'pres', from: peer, by: F.by, room: '', p: { hm: F.slow } }));
      ch.postMessage(JSON.stringify({ type: 'pres', from: peer, by: F.by, room: 'march', p: { f: F.state() } }));
    };
    F.say = (kind, to, data) => { F.ev.push([++F.evSeq, kind, to || 0, data]); F.send(); };
    ch.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch (e) { return; }
      if (d.type === 'hello') { F.send(); return; }
      if (d.type !== 'pres' || d.room !== 'march' || !d.p || !d.p.f || !Array.isArray(d.p.f.ev)) return;
      for (const e of d.p.f.ev) {
        const k = d.from + ':' + e[0];
        if (F.seen.has(k)) continue;
        F.seen.add(k);
        if (e[2] && e[2] !== peer) continue;
        F.heard.push([d.from, e]);
        if (e[1] === 'inv' && F.o.accept) { F.slow.pt = e[3]; F.say('pa', d.from, 1); }
      }
    };
    F.timer = setInterval(() => {
      const dt = 0.1;
      if (F.o.walk === 'circle') {
        const sp = F.o.speed || 4, r = F.o.r || 12;
        F.ang += (sp / r) * dt;
        const cx = F.o.cx, cz = F.o.cz;
        const nx = cx + Math.cos(F.ang) * r, nz = cz + Math.sin(F.ang) * r;
        F.o.vx = (nx - F.o.x) / dt; F.o.vz = (nz - F.o.z) / dt; F.o.x = nx; F.o.z = nz; F.o.yaw = Math.atan2(F.o.vx, F.o.vz);
      }
      F.send();
    }, 100);
    F.hb = setInterval(() => ch.postMessage(JSON.stringify({ type: 'hb', from: peer })), 1000);
    F.send();
    this.list.push(F);
    return peer;
  },
  find(name) { return this.list.find((F) => F.o.name === name) || null; },
  heard(name, kind) { const F = this.find(name); return F ? F.heard.filter((h) => !kind || h[1][1] === kind).map((h) => h[1]) : []; },
  stop() { for (const F of this.list) { clearInterval(F.timer); clearInterval(F.hb); F.ch.postMessage(JSON.stringify({ type: 'bye', from: F.peer })); F.ch.close(); } this.list = []; return 0; },
};
0;
