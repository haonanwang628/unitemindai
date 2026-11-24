// Road network and planner. No DOM here, so it can be tested on its own.
(function (root) {
  const UNIT = 64, OX = 50, OY = 48;
  const CELLS = [
    [0, 1], [1, 0], [3, 0], [5, 0], [7, 0], [9, 0], [10, 1],
    [2, 1], [4, 1], [6, 1], [8, 1],
    [0, 3], [1, 2], [3, 2], [5, 2], [7, 2], [9, 2], [10, 3],
    [2, 3], [4, 3], [6, 3], [8, 3],
    [1, 4], [3, 4], [5, 4], [7, 4], [9, 4],
    [2, 5], [4, 5], [6, 5], [8, 5],
  ];
  const EDGES = [
    [0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [1, 7], [2, 8], [3, 9], [4, 10], [3, 4],
    [6, 16], [0, 12], [7, 13], [7, 8], [8, 13], [8, 14], [9, 14], [9, 10], [10, 15], [10, 16],
    [12, 13], [14, 15], [11, 12], [12, 18], [13, 19], [14, 19], [14, 20], [15, 20], [15, 21],
    [16, 17], [16, 21], [11, 22], [18, 22], [18, 19], [19, 24], [20, 24], [20, 21], [21, 26],
    [17, 26], [22, 27], [18, 23], [23, 27], [23, 28], [24, 28], [24, 25], [25, 29], [25, 30],
    [26, 30], [28, 29], [20, 25],
  ];
  const MIN_PER_UNIT = 2.6; // simulated minutes to drive one grid unit
  const nodes = CELLS.map(([c, r]) => ({ x: OX + c * UNIT, y: OY + r * UNIT }));
  const edges = EDGES.map(([a, b], id) => ({
    id, a: Math.min(a, b), b: Math.max(a, b),
    len: Math.hypot(CELLS[a][0] - CELLS[b][0], CELLS[a][1] - CELLS[b][1]) * MIN_PER_UNIT,
  }));
  const edgeBetween = new Map();
  edges.forEach((e) => { edgeBetween.set(e.a * 100 + e.b, e); });
  const findEdge = (a, b) => edgeBetween.get(Math.min(a, b) * 100 + Math.max(a, b));

  // All-pairs shortest paths, skipping closed edges.
  function routes(closed) {
    const n = nodes.length;
    const dist = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
    const next = Array.from({ length: n }, () => new Int16Array(n).fill(-1));
    for (let i = 0; i < n; i++) { dist[i][i] = 0; next[i][i] = i; }
    for (const e of edges) {
      if (closed.has(e.id)) continue;
      dist[e.a][e.b] = dist[e.b][e.a] = e.len; next[e.a][e.b] = e.b; next[e.b][e.a] = e.a;
    }
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const d = dist[i][k] + dist[k][j];
      if (d < dist[i][j] - 1e-9) { dist[i][j] = d; next[i][j] = next[i][k]; }
    }
    return { dist, next };
  }
  const connected = (r) => r.dist[0].every((d) => d < Infinity);

  // start = { node, time }: where and when a vehicle is next free.
  function simulate(start, order, dist) {
    let t = start.time, at = start.node, travel = 0, late = 0, lateCount = 0;
    const visits = [];
    for (const job of order) {
      const d = dist[at][job.node];
      travel += d; t += d;
      const over = Math.max(0, t - job.due);
      late += over; if (over > 0.01) lateCount++;
      visits.push({ job, arrive: t, travel: d, late: over > 0.01 });
      t += job.service; at = job.node;
    }
    return { visits, travel, late, lateCount, end: t };
  }
  // heading = id of the job the vehicle is already driving to; leaving it costs a little, so plans stay steady.
  function cost(v, order, dist) {
    const s = simulate(v.start, order, dist);
    const left = v.heading && !(order[0] && order[0].id === v.heading) ? 4 : 0;
    return s.travel + s.late * 4 + s.lateCount * 18 + s.end * 0.12 + left;
  }

  // Improve a plan by moving or swapping single jobs while that helps.
  function improve(vehicles, queues, dist) {
    queues = queues.map((q) => q.slice());
    const costs = vehicles.map((v, k) => cost(v, queues[k], dist));
    const insertAt = (q, i, job) => q.slice(0, i).concat([job], q.slice(i));
    for (let round = 0, moved = true; moved && round < 60; round++) {
      moved = false;
      for (let k = 0; k < vehicles.length && !moved; k++) for (let i = 0; i < queues[k].length && !moved; i++) {
        const job = queues[k][i], rest = queues[k].filter((_, x) => x !== i), restCost = cost(vehicles[k], rest, dist);
        for (let m = 0; m < vehicles.length && !moved; m++) {
          const base = m === k ? rest : queues[m], baseCost = m === k ? restCost : costs[m];
          const gone = costs[k] - restCost;
          for (let j = 0; j <= base.length && !moved; j++) {
            const c = cost(vehicles[m], insertAt(base, j, job), dist);
            if (c - baseCost < gone - 0.05) {
              queues[k] = rest; costs[k] = restCost;
              queues[m] = insertAt(base, j, job); costs[m] = c; moved = true;
            }
          }
          for (let j = 0; m > k && j < queues[m].length && !moved; j++) {
            const one = queues[k].slice(), two = queues[m].slice();
            one[i] = queues[m][j]; two[j] = job;
            const c1 = cost(vehicles[k], one, dist), c2 = cost(vehicles[m], two, dist);
            if (c1 + c2 < costs[k] + costs[m] - 0.05) { queues[k] = one; queues[m] = two; costs[k] = c1; costs[m] = c2; moved = true; }
          }
        }
      }
    }
    return queues;
  }
  function greedy(vehicles, jobs, dist) {
    const queues = vehicles.map(() => []), costs = vehicles.map((v) => cost(v, [], dist));
    for (const job of jobs.slice().sort((a, b) => a.due - b.due || a.id - b.id)) {
      let pick = null;
      for (let k = 0; k < vehicles.length; k++) for (let i = 0; i <= queues[k].length; i++) {
        const q = queues[k].slice(0, i).concat([job], queues[k].slice(i)), c = cost(vehicles[k], q, dist);
        if (!pick || c - costs[k] < pick.extra - 1e-9) pick = { k, q, c, extra: c - costs[k] };
      }
      queues[pick.k] = pick.q; costs[pick.k] = pick.c;
    }
    return queues;
  }
  // Candidates: a fresh plan and the current plan (seed), each improved, plus the seed itself.
  // Fewest late jobs wins, then lowest cost, so a new plan is never later than the one it replaces.
  function plan(vehicles, jobs, dist, seed) {
    const options = [improve(vehicles, greedy(vehicles, jobs, dist), dist)];
    const ids = (q) => q.flat().map((j) => j.id).sort((a, b) => a - b).join();
    if (seed && ids(seed) === jobs.map((j) => j.id).sort((a, b) => a - b).join()) options.push(improve(vehicles, seed, dist), seed);
    const score = (q) => ({ q, late: lateJobs(vehicles, q, dist), cost: vehicles.reduce((n, v, k) => n + cost(v, q[k], dist), 0) });
    return options.map(score).sort((a, b) => a.late - b.late || a.cost - b.cost)[0].q;
  }
  const lateJobs = (vehicles, queues, dist) =>
    vehicles.reduce((n, v, k) => n + simulate(v.start, queues[k], dist).lateCount, 0);

  const api = { nodes, edges, findEdge, routes, connected, simulate, plan, lateJobs };
  if (typeof module !== 'undefined') module.exports = api; else root.Planner = api;
})(typeof window !== 'undefined' ? window : globalThis);
