// A* по сетке с очередью запросов.
// Ключевой момент для мобилки: за один тик считаем не больше CONFIG.PATHS_PER_TICK путей.
// Иначе 300 рабочих одновременно попросят маршрут и игра встанет колом.

import { CONFIG } from '../config.js';

const DIRS = [
  [ 1, 0, 1.0], [-1, 0, 1.0], [0,  1, 1.0], [0, -1, 1.0],
  [ 1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

// --- Минимальная двоичная куча ---
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

let statPaths = 0;          // сколько путей посчитано (для диагностики)
export function takePathStat() { const n = statPaths; statPaths = 0; return n; }

/**
 * Синхронный A*. Возвращает массив клеток [{x,y}, ...] без стартовой, либо null.
 * maxNodes страхует от зависания на заведомо недостижимой цели.
 */
export function findPath(map, sx, sy, tx, ty, maxNodes = 2500) {
  if (!map.inBounds(tx, ty) || !map.walkable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];

  const w = map.w;
  const g = new Float32Array(w * map.h).fill(Infinity);
  const from = new Int32Array(w * map.h).fill(-1);
  const closed = new Uint8Array(w * map.h);
  const open = new Heap();

  const h = (x, y) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return (dx + dy) + (1.414 - 2) * Math.min(dx, dy);   // октильная эвристика
  };

  const si = sy * w + sx;
  g[si] = 0;
  open.push({ x: sx, y: sy, i: si, f: h(sx, sy) });

  let processed = 0;

  while (open.size) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;

    if (cur.x === tx && cur.y === ty) {
      statPaths++;
      const path = [];
      let i = cur.i;
      while (i !== si && i !== -1) {
        path.push({ x: i % w, y: (i / w) | 0 });
        i = from[i];
      }
      return path.reverse();
    }

    if (++processed > maxNodes) break;

    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!map.walkable(nx, ny)) continue;
      // по диагонали не срезаем углы сквозь стены
      if (dx && dy && (!map.walkable(cur.x + dx, cur.y) || !map.walkable(cur.x, cur.y + dy))) continue;

      const ni = ny * w + nx;
      if (closed[ni]) continue;

      const ng = g[cur.i] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur.i;
        open.push({ x: nx, y: ny, i: ni, f: ng + h(nx, ny) });
      }
    }
  }

  statPaths++;
  return null;
}

/**
 * A* сразу к нескольким целям. Нужен, когда у здания несколько входов:
 * идти к ближайшему по прямой нельзя — он может оказаться в тупике за лесом.
 */
export function findPathAny(map, sx, sy, goals, maxNodes = 4000) {
  if (!goals || !goals.length) return null;
  const goalSet = new Set(goals.map((g) => g.y * map.w + g.x));
  const si = sy * map.w + sx;
  if (goalSet.has(si)) return [];

  const w = map.w;
  const g = new Float32Array(w * map.h).fill(Infinity);
  const from = new Int32Array(w * map.h).fill(-1);
  const closed = new Uint8Array(w * map.h);
  const open = new Heap();

  const h = (x, y) => {
    let best = Infinity;
    for (const t of goals) {
      const dx = Math.abs(x - t.x), dy = Math.abs(y - t.y);
      const v = (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
      if (v < best) best = v;
    }
    return best;
  };

  g[si] = 0;
  open.push({ x: sx, y: sy, i: si, f: h(sx, sy) });
  let processed = 0;

  while (open.size) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;

    if (goalSet.has(cur.i)) {
      statPaths++;
      const path = [];
      let i = cur.i;
      while (i !== si && i !== -1) {
        path.push({ x: i % w, y: (i / w) | 0 });
        i = from[i];
      }
      return path.reverse();
    }

    if (++processed > maxNodes) break;

    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!map.walkable(nx, ny)) continue;
      if (dx && dy && (!map.walkable(cur.x + dx, cur.y) || !map.walkable(cur.x, cur.y + dy))) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = g[cur.i] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur.i;
        open.push({ x: nx, y: ny, i: ni, f: ng + h(nx, ny) });
      }
    }
  }

  statPaths++;
  return null;
}

// --- Очередь запросов ---
const queue = [];

export function requestPath(entity, tx, ty) {
  entity.pathPending = true;
  queue.push({ entity, tx, ty });
}

/** Маршрут к любой из целей; какая именно вышла — видно по последнему шагу */
export function requestPathAny(entity, goals) {
  entity.pathPending = true;
  queue.push({ entity, goals });
}

export function processPathQueue(map) {
  let n = Math.min(CONFIG.PATHS_PER_TICK, queue.length);
  while (n-- > 0) {
    const req = queue.shift();
    const e = req.entity;
    if (!e || e.dead) continue;
    const sx = Math.round(e.x), sy = Math.round(e.y);

    if (req.goals) {
      e.path = findPathAny(map, sx, sy, req.goals);
      // цель — та клетка, куда маршрут реально привёл
      e.target = e.path ? (e.path.length ? e.path[e.path.length - 1] : { x: sx, y: sy }) : null;
    } else {
      e.path = findPath(map, sx, sy, req.tx, req.ty);
      e.target = e.path ? { x: req.tx, y: req.ty } : null;
    }
    e.pathStep = 0;
    e.pathPending = false;
  }
}

export function queueLength() { return queue.length; }
export function clearQueue() { queue.length = 0; }
