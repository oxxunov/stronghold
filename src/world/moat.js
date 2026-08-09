// Ров. Такой же слой сетки, как стены, но работает иначе: по рву можно
// пройти, просто очень медленно. Именно поэтому он и полезен — атакующие
// вязнут под обстрелом со стен, а не упираются в глухую преграду.
//
// map.moat: 0 — нет, 1 — сухой ров, 2 — смоляной.

import { state } from '../core/state.js';
import { events } from '../core/events.js';

export const MOAT_NONE = 0;
export const MOAT_DRY = 1;
export const MOAT_PITCH = 2;

export const MOAT_TYPES = {
  [MOAT_DRY]:   { name: 'Ров',          cost: {},              row: 0, move: 4 },
  [MOAT_PITCH]: { name: 'Смоляной ров', cost: { pitch: 1 },    row: 1, move: 3 },
};

export const moatAt = (map, x, y) =>
  map.inBounds(x, y) ? map.moat[map.idx(x, y)] : MOAT_NONE;

/** Маска соседей для выбора спрайта: N=1 E=2 S=4 W=8 */
export function moatMask(map, x, y) {
  let m = 0;
  if (moatAt(map, x, y - 1)) m |= 1;
  if (moatAt(map, x + 1, y)) m |= 2;
  if (moatAt(map, x, y + 1)) m |= 4;
  if (moatAt(map, x - 1, y)) m |= 8;
  return m;
}

export function canDig(map, x, y) {
  if (!map.inBounds(x, y)) return { ok: false, reason: 'За краем карты' };
  const i = map.idx(x, y);
  if (map.moat[i]) return { ok: false, reason: 'Здесь уже ров' };
  if (map.occupied[i]) return { ok: false, reason: 'Место занято' };
  if (map.walls[i]) return { ok: false, reason: 'Здесь стена' };
  if (!map.walkableTerrain(x, y)) return { ok: false, reason: 'Негодная местность' };
  return { ok: true };
}

/** Выкопать ров по списку клеток. Смоляной требует смолы. */
export function digMoat(map, type, tiles) {
  const cost = MOAT_TYPES[type].cost;
  let dug = 0;

  for (const t of tiles) {
    if (!canDig(map, t.x, t.y).ok) continue;
    let can = true;
    for (const [res, amount] of Object.entries(cost))
      if ((state.resources[res] || 0) < amount) can = false;
    if (!can) break;

    for (const [res, amount] of Object.entries(cost)) state.resources[res] -= amount;
    map.moat[map.idx(t.x, t.y)] = type;
    dug++;
  }

  if (dug) events.emit('moatDug', { type, count: dug });
  return dug;
}

export function fillMoat(map, x, y) {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (!map.moat[i]) return false;
  map.moat[i] = MOAT_NONE;
  return true;
}

/**
 * Поджечь смоляной ров. Горит связная область смолы — этап 9 будет
 * наносить урон тем, кто в ней стоит.
 */
export function ignitePitch(map, x, y) {
  if (moatAt(map, x, y) !== MOAT_PITCH) return 0;
  const seen = new Set();
  const queue = [{ x, y }];
  const burning = [];

  while (queue.length) {
    const c = queue.pop();
    const key = c.y * map.w + c.x;
    if (seen.has(key)) continue;
    seen.add(key);
    if (moatAt(map, c.x, c.y) !== MOAT_PITCH) continue;
    burning.push(c);
    queue.push({ x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y },
               { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 });
  }

  for (const c of burning) {
    map.moat[map.idx(c.x, c.y)] = MOAT_DRY;      // смола выгорает, яма остаётся
    state.fires.push({ x: c.x, y: c.y, left: 6 });
  }
  events.emit('pitchIgnited', { count: burning.length });
  return burning.length;
}

/** Горение затухает со временем */
export function updateFires(dt) {
  for (let i = state.fires.length - 1; i >= 0; i--) {
    const f = state.fires[i];
    f.left -= dt;
    if (f.left <= 0) state.fires.splice(i, 1);
  }
}
