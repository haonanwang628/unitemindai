// Live dispatch demo: draws the map and timeline, and re-plans with planner.js whenever something changes.
(function () {
  const P = window.Planner;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const NAMES = ['A', 'B', 'C', 'D'];
  const SPEED = 1.7;   // simulated minutes per second
  const WINDOW = 50;   // minutes shown on the timeline
  const OPEN = 11;     // jobs kept on the board
  const OFFLINE = 26, CLOSED = 34;

  window.createDemo = function (host, opts) {
    const state = { now: 0, jobs: [], vehicles: [], closed: new Map(), log: [], served: 0, onTime: 0, nextId: 101, nextJobAt: 2 };
    let net = P.routes(new Set());
    let text = opts.text, paused = opts.reduced, visible = true, lastTouch = -99, autoAt = 9, autoStep = 0;
    const rnd = Math.random;

    host.innerHTML =
      '<div class="c-top"><strong data-t="label"></strong><button type="button" class="c-pause" data-act="pause"></button></div>' +
      '<div class="c-map"><svg viewBox="0 0 740 416" role="img"></svg></div>' +
      '<div class="c-side"><div class="c-time"><p data-t="timeline"></p><svg viewBox="0 0 420 208" role="img"></svg></div>' +
      '<dl class="c-read"><div><dt data-t="open"></dt><dd data-v="open"></dd></div><div><dt data-t="late"></dt><dd data-v="late"></dd></div><div><dt data-t="served"></dt><dd data-v="served"></dd></div></dl>' +
      '<ol class="c-log"></ol></div>' +
      '<div class="c-bar"><button type="button" data-act="rush"></button><button type="button" data-act="offline"></button><button type="button" data-act="close"></button><p data-t="note"></p></div>';
    const $ = (q) => host.querySelector(q);
    const map = $('.c-map svg'), time = $('.c-time svg');

    // ---- static map layers
    const roads = el('g', { class: 'm-roads' }, map);
    const roadEls = P.edges.map((e) => el('line', { x1: P.nodes[e.a].x, y1: P.nodes[e.a].y, x2: P.nodes[e.b].x, y2: P.nodes[e.b].y }, roads));
    const dots = el('g', { class: 'm-dots' }, map);
    P.nodes.forEach((n) => el('circle', { cx: n.x, cy: n.y, r: 2.5 }, dots));
    const routeLayer = el('g', { class: 'm-routes' }, map);
    const closedLayer = el('g', { class: 'm-closed' }, map);
    const jobLayer = el('g', {}, map);
    const carLayer = el('g', {}, map);
    // ---- static timeline layers
    const LEFT = 34, WIDE = 376, ROW = 46, TOP = 20;
    const px = (min) => LEFT + (min / WINDOW) * WIDE;
    for (let m = 0; m <= WINDOW; m += 10) {
      el('line', { class: 't-grid', x1: px(m), x2: px(m), y1: TOP - 4, y2: TOP + ROW * 4 }, time);
      el('text', { class: 't-tick', x: px(m), y: 11, 'text-anchor': m === WINDOW ? 'end' : 'middle' }, time).textContent = m ? '+' + m : '0';
    }
    const defs = el('defs', {}, time);
    const clip = el('clipPath', { id: 'lanes' }, defs);
    el('rect', { x: LEFT, y: 0, width: WIDE, height: 220 }, clip);
    const lanes = NAMES.map((name, k) => {
      const y = TOP + k * ROW;
      const t = el('text', { class: 't-name v' + k, x: 8, y: y + 25 }, time); t.textContent = name;
      const drive = el('path', { class: 't-drive v' + k, 'clip-path': 'url(#lanes)' }, time);
      const off = el('text', { class: 't-off', x: LEFT + 10, y: y + 24 }, time);
      return { y, drive, off };
    });
    const blockLayer = el('g', { 'clip-path': 'url(#lanes)' }, time);

    // ---- vehicles
    [0, 6, 22, 30].forEach((node, k) => {
      const g = el('g', { class: 'm-car v' + k }, carLayer);
      el('circle', { r: 12 }, g);
      el('text', { y: 4.6, 'text-anchor': 'middle' }, g).textContent = NAMES[k];
      state.vehicles.push({ k, node, to: -1, f: 0, queue: [], work: null, offUntil: 0, g, lines: [] });
    });

    const isOff = (v) => v.offUntil > state.now;
    const startOf = (v) => {
      if (v.work) return { node: v.node, time: v.work.end };
      if (v.to >= 0) return { node: v.to, time: state.now + (1 - v.f) * P.findEdge(v.node, v.to).len };
      return { node: v.node, time: state.now };
    };
    const projected = (v) => {
      const s = startOf(v);
      return { start: isOff(v) ? { node: s.node, time: Math.max(s.time, v.offUntil) } : s, heading: v.queue[0] ? v.queue[0].id : null };
    };
    const currentLate = () => P.lateJobs(state.vehicles.map(projected), state.vehicles.map((v) => v.queue), net.dist);

    function addJob(rush) {
      const used = new Set(state.jobs.map((j) => j.node));
      state.vehicles.forEach((v) => { if (v.work) used.add(v.work.job.node); });
      const free = P.nodes.map((_, i) => i).filter((i) => !used.has(i));
      const job = {
        id: state.nextId++, node: free[Math.floor(rnd() * free.length)], service: 3.2 + rnd() * 2.4,
        due: state.now + (rush ? 11 + rnd() * 3 : 24 + rnd() * 26), rush: !!rush, show: 0,
      };
      state.jobs.push(job);
      return job;
    }
    function replan() {
      const all = state.vehicles; // an offline vehicle can still be given work for when it is back
      const pool = state.jobs.filter((j) => !j.taken);
      const before = new Map();
      state.vehicles.forEach((v) => v.queue.forEach((j) => before.set(j.id, v.k)));
      const t0 = performance.now();
      // Seed with the current plan; new jobs go to the end of the shortest queue.
      const seed = all.map((v) => v.queue.slice()), placed = new Set(seed.flat().map((j) => j.id));
      pool.forEach((j) => { if (!placed.has(j.id)) seed.reduce((m, q) => (q.length < m.length ? q : m)).push(j); });
      const queues = P.plan(all.map(projected), pool, net.dist, seed);
      const ms = performance.now() - t0;
      all.forEach((v, i) => { v.queue = queues[i]; });
      let moved = 0;
      all.forEach((v) => v.queue.forEach((j) => { if (before.has(j.id) && before.get(j.id) !== v.k) moved++; }));
      return { ms, moved, late: currentLate() };
    }
    function report(key, vars, oldLate, r) {
      state.log.unshift({ key, vars, result: { a: oldLate, b: r.late, m: r.moved }, ms: r.ms });
      state.log.length = Math.min(state.log.length, 2);
      drawLog();
    }

    const act = {
      rush() {
        if (state.jobs.length >= 20) return false;
        const job = addJob(true);
        // "Old plan" = leave every queue alone and append the job to whoever finishes first.
        const ends = state.vehicles.filter((v) => !isOff(v)).map((v) => ({ v, end: P.simulate(startOf(v), v.queue, net.dist).end }));
        const last = ends.sort((a, b) => a.end - b.end)[0].v;
        last.queue = last.queue.concat(job);
        const oldLate = currentLate();
        const r = replan();
        report('logRush', { job: job.id }, oldLate, r);
      },
      offline() {
        const on = state.vehicles.filter((v) => !isOff(v));
        if (on.length < 3) return false;
        const v = on.sort((a, b) => b.queue.length - a.queue.length)[0];
        v.offUntil = state.now + OFFLINE;
        if (v.work) { const job = v.work.job; job.taken = false; state.jobs.push(job); v.queue = [job].concat(v.queue); v.work = null; }
        const oldLate = currentLate();
        const r = replan();
        report('logOffline', { v: NAMES[v.k] }, oldLate, r);
      },
      close() {
        if (state.closed.size > 2) return false;
        const use = new Map();
        state.vehicles.forEach((v) => pathOf(v).forEach((leg) => {
          const e = P.findEdge(leg.a, leg.b);
          if (!(v.to >= 0 && e === P.findEdge(v.node, v.to))) use.set(e.id, (use.get(e.id) || 0) + 1);
        }));
        const options = [...use.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])
          .filter((id) => !state.closed.has(id) && P.connected(P.routes(new Set([...state.closed.keys(), id]))));
        if (!options.length) return false;
        state.closed.set(options[Math.floor(rnd() * Math.min(3, options.length))], state.now + CLOSED);
        net = P.routes(new Set(state.closed.keys()));
        const oldLate = currentLate();
        const r = replan();
        drawClosed();
        report('logClose', {}, oldLate, r);
      },
    };

    // Legs a vehicle will still drive: [{a, b, job index}].
    function pathOf(v) {
      const legs = [];
      let at = v.node;
      if (v.to >= 0) { legs.push({ a: v.node, b: v.to, i: 0, f: v.f }); at = v.to; }
      v.queue.forEach((job, i) => {
        let guard = 0;
        while (at !== job.node && guard++ < 40) { const n = net.next[at][job.node]; legs.push({ a: at, b: n, i, f: 0 }); at = n; }
      });
      return legs;
    }

    function step(dt) {
      state.now += dt;
      let changed = false;
      for (const [id, until] of state.closed) if (until <= state.now) {
        state.closed.delete(id); net = P.routes(new Set(state.closed.keys())); drawClosed();
        const a = currentLate(); report('logReopen', {}, a, replan());
      }
      for (const v of state.vehicles) {
        if (v.offUntil && v.offUntil <= state.now) { v.offUntil = 0; const a = currentLate(); report('logOnline', { v: NAMES[v.k] }, a, replan()); }
        if (isOff(v)) continue;
        if (v.work) {
          if (state.now >= v.work.end) { state.served++; if (!v.work.late) state.onTime++; v.work = null; }
        } else if (v.to >= 0) {
          v.f += dt / P.findEdge(v.node, v.to).len;
          if (v.f >= 1) { v.node = v.to; v.to = -1; v.f = 0; }
        }
        if (!v.work && v.to < 0 && v.queue.length) {
          const job = v.queue[0];
          if (job.node === v.node) {
            v.queue = v.queue.slice(1); job.taken = true;
            state.jobs = state.jobs.filter((j) => j !== job);
            v.work = { job, end: state.now + job.service, late: state.now > job.due + 0.2 };
          } else { v.to = net.next[v.node][job.node]; v.f = 0; }
        }
      }
      if (state.jobs.length < OPEN && state.now >= state.nextJobAt) { addJob(); state.nextJobAt = state.now + 1.5 + rnd() * 2; changed = true; }
      if (changed) replan();
    }

    // ---- drawing
    function drawClosed() {
      roadEls.forEach((r, i) => r.classList.toggle('shut', state.closed.has(i)));
      closedLayer.textContent = '';
      for (const id of state.closed.keys()) {
        const e = P.edges[id], x = (P.nodes[e.a].x + P.nodes[e.b].x) / 2, y = (P.nodes[e.a].y + P.nodes[e.b].y) / 2;
        const g = el('g', { transform: `translate(${x} ${y})` }, closedLayer);
        el('circle', { r: 9 }, g); el('path', { d: 'M-3.6 -3.6 3.6 3.6M3.6 -3.6 -3.6 3.6' }, g);
      }
    }
    const jobEls = new Map();
    function jobEl(job) {
      let j = jobEls.get(job.id);
      if (!j) {
        const g = el('g', { class: 'm-job', transform: `translate(${P.nodes[job.node].x} ${P.nodes[job.node].y})` }, jobLayer);
        el('rect', { class: 'ring', x: -11, y: -11, width: 22, height: 22, rx: 5 }, g);
        el('rect', { class: 'body', x: -7, y: -7, width: 14, height: 14, rx: 2 }, g);
        const label = el('text', { x: 0, y: -14, 'text-anchor': 'middle' }, g); label.textContent = job.id;
        const b = el('g', { class: 't-job' }, blockLayer);
        const rect = el('rect', { height: 26, rx: 3 }, b);
        const id = el('text', { y: 17.5 }, b); id.textContent = job.id;
        j = { g, b, rect, x: null, y: null }; jobEls.set(job.id, j);
      }
      return j;
    }
    function placeBlock(job, k, start, width, late, smooth) {
      const j = jobEl(job), x = px(start), y = lanes[k].y + 6;
      if (j.x === null || !smooth) { j.x = x; j.y = y; } else { j.x += (x - j.x) * 0.16; j.y += (y - j.y) * 0.16; }
      const w = (width / WINDOW) * WIDE - 2;
      j.rect.setAttribute('width', Math.max(6, w));
      j.b.setAttribute('transform', `translate(${j.x.toFixed(1)} ${j.y.toFixed(1)})`);
      j.b.setAttribute('class', `t-job v${k}${late ? ' late' : ''}${job.rush ? ' rush' : ''}`);
      j.b.lastChild.setAttribute('x', Math.max(6, w) / 2);
      j.b.lastChild.setAttribute('display', w < 20 ? 'none' : 'inline');
    }
    function draw(smooth) {
      const seen = new Set();
      let lateNow = 0;
      for (const v of state.vehicles) {
        const a = P.nodes[v.node], b = v.to >= 0 ? P.nodes[v.to] : a;
        const x = a.x + (b.x - a.x) * v.f, y = a.y + (b.y - a.y) * v.f, off = isOff(v);
        v.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        v.g.setAttribute('class', `m-car v${v.k}${off ? ' off' : ''}${v.work ? ' busy' : ''}`);
        // routes, shifted sideways per vehicle so shared roads show every line
        const legs = off ? [] : pathOf(v), shift = (v.k - 1.5) * 4.2;
        legs.forEach((leg, i) => {
          const line = v.lines[i] || (v.lines[i] = el('line', {}, routeLayer));
          const p = P.nodes[leg.a], q = P.nodes[leg.b], s = leg.a < leg.b ? 1 : -1;
          const len = Math.hypot(q.x - p.x, q.y - p.y), ox = (-(q.y - p.y) / len) * shift * s, oy = ((q.x - p.x) / len) * shift * s;
          const sx = p.x + (q.x - p.x) * leg.f, sy = p.y + (q.y - p.y) * leg.f;
          line.setAttribute('x1', (sx + ox).toFixed(1)); line.setAttribute('y1', (sy + oy).toFixed(1));
          line.setAttribute('x2', (q.x + ox).toFixed(1)); line.setAttribute('y2', (q.y + oy).toFixed(1));
          line.setAttribute('class', `v${v.k}${leg.i ? ' later' : ''}`);
        });
        while (v.lines.length > legs.length) v.lines.pop().remove();
        // timeline
        const lane = lanes[v.k], mid = lane.y + 19;
        lane.off.textContent = off ? text.offMark : '';
        let d = '';
        if (v.work) {
          seen.add(v.work.job.id);
          placeBlock(v.work.job, v.k, v.work.end - v.work.job.service - state.now, v.work.job.service, v.work.late, smooth);
          jobEl(v.work.job).g.setAttribute('class', `m-job v${v.k} now`);
        }
        const sim = P.simulate(projected(v).start, v.queue, net.dist);
        sim.visits.forEach((visit, i) => {
          seen.add(visit.job.id);
          const from = i ? sim.visits[i - 1].arrive + sim.visits[i - 1].job.service : (v.work ? v.work.end : Math.max(state.now, v.offUntil));
          d += `M${px(from - state.now).toFixed(1)} ${mid}H${px(visit.arrive - state.now).toFixed(1)}`;
          placeBlock(visit.job, v.k, visit.arrive - state.now, visit.job.service, visit.late, smooth);
          if (visit.late) lateNow++;
          jobEl(visit.job).g.setAttribute('class', `m-job v${v.k}${visit.late ? ' late' : ''}${visit.job.rush ? ' rush' : ''}`);
        });
        lane.drive.setAttribute('d', d || 'M0 0');
      }
      for (const [id, j] of jobEls) if (!seen.has(id)) { j.g.remove(); j.b.remove(); jobEls.delete(id); }
      $('[data-v=open]').textContent = state.jobs.length;
      $('[data-v=late]').textContent = lateNow;
      $('[data-v=served]').textContent = state.served ? `${state.onTime}/${state.served}` : '0';
    }
    const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
    function drawLog() {
      const list = $('.c-log');
      list.textContent = '';
      const items = state.log.length ? state.log : [{ key: 'logStart', vars: {} }];
      items.forEach((it) => {
        const li = document.createElement('li');
        const head = document.createElement('strong'); head.textContent = fill(text[it.key], it.vars); li.append(head);
        if (it.result) {
          const p = document.createElement('span');
          p.textContent = fill(text.logResult, it.result); li.append(p);
          const t = document.createElement('em');
          t.textContent = fill(text.logTime, { ms: it.ms < 1 ? '<1' : Math.round(it.ms) }); li.append(t);
        }
        list.append(li);
      });
    }
    function drawText() {
      host.querySelectorAll('[data-t]').forEach((n) => { n.textContent = text[n.dataset.t]; });
      ['rush', 'offline', 'close'].forEach((k) => { $(`[data-act=${k}]`).textContent = text[k]; });
      $('[data-act=pause]').textContent = paused ? text.play : text.pause;
      map.setAttribute('aria-label', text.mapAlt); time.setAttribute('aria-label', text.timelineAlt);
      drawLog();
    }

    // ---- start
    for (let i = 0; i < OPEN; i++) addJob();
    replan(); drawText(); draw(false);
    // begin mid-shift so the first view already shows vehicles on the road
    for (let i = 0; i < 60; i++) step(0.1);
    draw(false);

    const now = () => performance.now() / 1000;
    function run(kind) { if (act[kind]() !== false) draw(false === opts.reduced); }
    host.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'pause') { paused = !paused; drawText(); return; }
      lastTouch = now(); run(b.dataset.act);
    });
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(host);
    let prev = now();
    const first = prev;
    (function frame() {
      const t = now(), dt = Math.min(0.06, t - prev); prev = t;
      if (visible && !document.hidden) {
        if (!paused) {
          step(dt * SPEED);
          if (t - first > autoAt && t - lastTouch > 14) { run(['close', 'rush', 'offline'][autoStep++ % 3]); autoAt = t - first + 12; }
        }
        draw(!opts.reduced);
      }
      requestAnimationFrame(frame);
    })();
    return {
      state,
      setText(t) { text = t; drawText(); draw(false); },
      breakPlan() { lastTouch = now(); run('close'); },
    };
  };
})();
