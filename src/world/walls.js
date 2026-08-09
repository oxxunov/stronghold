// Стены. Не здания, а отдельный слой сетки: одна стена — одна клетка.
// Так дешевле по памяти и проще считать стыковку соседей.
//
// Значения в map.walls: 0 — пусто, 1 — частокол, 2 — каменная стена.

import { state } from '../core/state.js';
import { events } from '../core/events.js';

export const WALL_NONE = 0;
export const WALL_WOOD = 1;
export const WALL_STONE = 2;

export const WALL_TYPES = {
  [WALL_WOOD]:  { id: 'palisade', name: 'Частокол',       cost: { wood: 4 },  row: 1, hp: 120 },
  [WALL_STONE]: { id: 'wall',     name: 'Каменная стена', cost: { stone: 6 }, row: 0, hp: 400 },
};

export const wallAt = (map, x, y) =>
  map.inBounds(x, y) ? map.walls[map.idx(x, y)] : WALL_NONE;

/** Маска соседей для выбора спрайта: N=1 E=2 S=4 W=8 */
export function wallMask(map, x, y) {
  let m = 0;
  if (wallAt(map, x, y - 1)) m |= 1;
  if (wallAt(map, x + 1, y)) m |= 2;
  if (wallAt(map, x, y + 1)) m |= 4;
  if (wallAt(map, x - 1, y)) m |= 8;
  return m;
}

export function canPlaceWall(map, x, y) {
  if (!map.inBounds(x, y)) return { ok: false, reason: 'За краем карты' };
  const i = map.idx(x, y);
  if (map.walls[i]) return { ok: false, reason: 'Здесь уже стена' };
  if (map.occupied[i]) return { ok: false, reason: 'Место занято' };
  // стена ставится только на проходимую местность: не на воду и не на скалу
  if (!map.walkableTerrain(x, y)) return { ok: false, reason: 'Негодная местность' };
  return { ok: true };
}

/** Клетки прямой линии от точки к точке — стены строят полосами, а не по одной */
export function lineTiles(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const out = [];
  if (dx >= dy) {                       // ведём по горизонтали, потом по вертикали
    const step = x1 >= x0 ? 1 : -1;
    for (let x = x0; x !== x1 + step; x += step) out.push({ x, y: y0 });
    const vs = y1 >= y0 ? 1 : -1;
    for (let y = y0 + vs; y !== y1 + vs; y += vs) out.push({ x: x1, y });
  } else {
    const step = y1 >= y0 ? 1 : -1;
    for (let y = y0; y !== y1 + step; y += step) out.push({ x: x0, y });
    const hs = x1 >= x0 ? 1 : -1;
    for (let x = x0 + hs; x !== x1 + hs; x += hs) out.push({ x, y: y1 });
  }
  return out;
}

/** Хватит ли ресурсов на n клеток стены */
export function affordableCount(type, n) {
  const cost = WALL_TYPES[type].cost;
  let max = n;
  for (const [res, amount] of Object.entries(cost)) {
    max = Math.min(max, Math.floor((state.resources[res] || 0) / amount));
  }
  return Math.max(0, max);
}

/** Поставить стены по списку клеток. Ставит столько, на сколько хватит денег. */
export function placeWalls(map, type, tiles) {
  const cost = WALL_TYPES[type].cost;
  let placed = 0;

  for (const t of tiles) {
    if (!canPlaceWall(map, t.x, t.y).ok) continue;
    let can = true;
    for (const [res, amount] of Object.entries(cost))
      if ((state.resources[res] || 0) < amount) can = false;
    if (!can) break;

    for (const [res, amount] of Object.entries(cost)) state.resources[res] -= amount;
    const i = map.idx(t.x, t.y);
    map.walls[i] = type;
    map.wallHp[i] = WALL_TYPES[type].hp;
    placed++;
  }

  if (placed) events.emit('wallsBuilt', { type, count: placed });
  return placed;
}

/** Урон по стене. Пробили — клетка становится проходимой. */
export function damageWall(map, x, y, amount) {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (!map.walls[i]) return false;
  map.wallHp[i] = Math.max(0, map.wallHp[i] - amount);
  if (map.wallHp[i] > 0) return false;
  map.walls[i] = WALL_NONE;
  map.crossing[i] = 0;
  events.emit('wallBroken', { x, y });
  return true;
}

export function removeWall(map, x, y) {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (!map.walls[i]) return false;
  map.walls[i] = WALL_NONE;
  map.wallHp[i] = 0;
  events.emit('wallRemoved', { x, y });
  return true;
}
