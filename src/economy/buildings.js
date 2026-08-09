// Здания: определения, проверка места, постановка, снос.
// Логика не знает ничего про рисование — рендер сам берёт state.buildings.

import { CONFIG } from '../config.js';
import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { TERRAIN, terrainById } from '../world/map.js';

export const CATEGORIES = [
  { id: 'castle',   name: 'Замок' },
  { id: 'town',     name: 'Город' },
  { id: 'industry', name: 'Промысел' },
  { id: 'farm',     name: 'Поля' },
  { id: 'food',     name: 'Еда' },
  { id: 'military', name: 'Война' },
];

export let DEFS = {};

export async function loadBuildings(url = './data/buildings.json') {
  const res = await fetch(url);
  DEFS = await res.json();
  for (const [id, d] of Object.entries(DEFS)) d.id = id;
  events.emit('buildingsLoaded', DEFS);
  return DEFS;
}

const TERRAIN_BY_NAME = {
  grass: TERRAIN.GRASS.id, dirt: TERRAIN.DIRT.id, rock: TERRAIN.ROCK.id,
  water: TERRAIN.WATER.id, marsh: TERRAIN.MARSH.id, forest: TERRAIN.FOREST.id,
  ore: TERRAIN.ORE.id,
};

/** Хватает ли ресурсов */
export function canAfford(def) {
  for (const [res, amount] of Object.entries(def.cost || {})) {
    if ((state.resources[res] || 0) < amount) return false;
  }
  return true;
}

/**
 * Можно ли поставить здание левым верхним углом в клетку (tx, ty).
 * Возвращает { ok, reason }.
 */
export function checkPlace(map, def, tx, ty, side = 'player') {
  const [w, h] = def.size;

  // уникальность считается по стороне: у врага свой донжон, у нас свой
  if (def.unique && state.buildings.some((b) => b.def.id === def.id && b.side === side))
    return { ok: false, reason: 'Уже построено' };

  const allowed = (def.terrain || []).map((n) => TERRAIN_BY_NAME[n]);

  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      if (!map.inBounds(x, y)) return { ok: false, reason: 'За краем карты' };
      const i = map.idx(x, y);
      if (map.occupied[i]) return { ok: false, reason: 'Место занято' };
      if (map.walls[i] && !def.passable) return { ok: false, reason: 'Здесь стена' };
      if (allowed.length && !allowed.includes(map.tiles[i]))
        return { ok: false, reason: `Нужна местность: ${def.terrain.join(', ')}` };
    }
  }

  if (def.nearForest) {
    let found = false;
    for (let y = ty - 3; y <= ty + h + 2 && !found; y++)
      for (let x = tx - 3; x <= tx + w + 2 && !found; x++)
        if (map.inBounds(x, y) && map.tiles[map.idx(x, y)] === TERRAIN.FOREST.id) found = true;
    if (!found) return { ok: false, reason: 'Нужен лес рядом' };
  }

  // к зданию должен быть подход, иначе рабочие не смогут в него попасть
  if (!hasApproach(map, tx, ty, w, h))
    return { ok: false, reason: 'Нет подхода' };

  // и новая постройка не должна отрезать подход соседям
  const blocked = blocksNeighbour(map, tx, ty, w, h);
  if (blocked) return { ok: false, reason: `Перекроет вход: ${blocked.def.name}` };

  // и не должна отрезать часть замка от донжона
  const cut = cutsOff(map, tx, ty, w, h);
  if (cut) return { ok: false, reason: `Отрежет путь: ${cut.def.name}` };

  if (def.needsBuilding
      && !state.buildings.some((b) => b.def.id === def.needsBuilding && b.side === side)) {
    const need = DEFS[def.needsBuilding]?.name || def.needsBuilding;
    return { ok: false, reason: `Сначала нужна: ${need}` };
  }

  if (!canAfford(def)) return { ok: false, reason: 'Не хватает ресурсов' };

  return { ok: true };
}

/** Есть ли хоть одна проходимая клетка вплотную к пятну застройки */
export function hasApproach(map, tx, ty, w, h) {
  for (let x = tx - 1; x <= tx + w; x++) {
    if (map.walkable(x, ty - 1) || map.walkable(x, ty + h)) return true;
  }
  for (let y = ty - 1; y <= ty + h; y++) {
    if (map.walkable(tx - 1, y) || map.walkable(tx + w, y)) return true;
  }
  return false;
}

/**
 * Не отрежет ли новое пятно последний подход у соседнего здания.
 * Временно помечаем клетки занятыми и проверяем соседей рядом.
 */
export function blocksNeighbour(map, tx, ty, w, h) {
  const cells = [];
  for (let y = ty; y < ty + h; y++)
    for (let x = tx; x < tx + w; x++) {
      const i = map.idx(x, y);
      if (!map.occupied[i]) { map.occupied[i] = 1; cells.push(i); }
    }

  let bad = null;
  for (const b of state.buildings) {
    if (b.x > tx + w + 1 || b.x + b.w < tx - 1) continue;
    if (b.y > ty + h + 1 || b.y + b.h < ty - 1) continue;
    if (!hasApproach(map, b.x, b.y, b.w, b.h)) { bad = b; break; }
  }

  for (const i of cells) map.occupied[i] = 0;
  return bad;
}

/** Заливка проходимых клеток от точки — что вообще достижимо */
function floodFrom(map, sx, sy) {
  const seen = new Uint8Array(map.w * map.h);
  if (!map.walkable(sx, sy)) return seen;
  const q = [sy * map.w + sx];
  seen[q[0]] = 1;
  for (let head = 0; head < q.length; head++) {
    const i = q[head];
    const x = i % map.w, y = (i / map.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (seen[ni] || !map.walkable(nx, ny)) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

/**
 * Не отрежет ли новая постройка часть замка от донжона.
 * Без этой проверки игрок случайно строит стену из домов, и рабочие
 * по ту сторону навсегда встают с грузом в руках.
 */
export function cutsOff(map, tx, ty, w, h) {
  const keep = state.buildings.find((b) => b.def.id === 'keep');
  if (!keep) return null;

  const cells = [];
  for (let y = ty; y < ty + h; y++)
    for (let x = tx; x < tx + w; x++) {
      const i = map.idx(x, y);
      if (!map.occupied[i]) { map.occupied[i] = 1; cells.push(i); }
    }

  const start = approachOf(map, keep, keep.x, keep.y);
  let bad = null;
  if (start) {
    const seen = floodFrom(map, start.x, start.y);
    const reachable = (b) => {
      for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (map.inBounds(x, b.y - 1) && seen[map.idx(x, b.y - 1)]) return true;
        if (map.inBounds(x, b.y + b.h) && seen[map.idx(x, b.y + b.h)]) return true;
      }
      for (let y = b.y - 1; y <= b.y + b.h; y++) {
        if (map.inBounds(b.x - 1, y) && seen[map.idx(b.x - 1, y)]) return true;
        if (map.inBounds(b.x + b.w, y) && seen[map.idx(b.x + b.w, y)]) return true;
      }
      return false;
    };
    for (const b of state.buildings) {
      if (b === keep) continue;
      if (!reachable(b)) { bad = b; break; }
    }
    // и само новое здание должно быть достижимо
    if (!bad && !reachable({ x: tx, y: ty, w, h, def: { name: 'новое здание' } }))
      bad = { def: { name: 'само это здание' } };
  }

  for (const i of cells) map.occupied[i] = 0;
  return bad;
}

/** Ближайшая к точке проходимая клетка по периметру здания */
export function approachOf(map, b, fromX, fromY) {
  let best = null, bestD = Infinity;
  const check = (x, y) => {
    if (!map.walkable(x, y)) return;
    const d = Math.abs(x - fromX) + Math.abs(y - fromY);
    if (d < bestD) { bestD = d; best = { x, y }; }
  };
  for (let x = b.x - 1; x <= b.x + b.w; x++) { check(x, b.y - 1); check(x, b.y + b.h); }
  for (let y = b.y - 1; y <= b.y + b.h; y++) { check(b.x - 1, y); check(b.x + b.w, y); }
  return best;
}

export function place(map, def, tx, ty, side = 'player') {
  const check = checkPlace(map, def, tx, ty, side);
  if (!check.ok) return null;

  const [w, h] = def.size;
  for (let y = ty; y < ty + h; y++)
    for (let x = tx; x < tx + w; x++) {
      const i = map.idx(x, y);
      if (def.passable) map.walls[i] = 0;   // ворота встают в разрыв стены
      map.occupied[i] = 1;
      // ворота заняты для застройки, но люди сквозь них ходят
      map.passable[i] = def.passable ? 1 : 0;
    }

  for (const [res, amount] of Object.entries(def.cost || {}))
    state.resources[res] -= amount;

  const hp = def.hp || Math.round(60 * w * h
    + (def.cost?.stone || 0) * 6 + (def.cost?.wood || 0) * 2);

  const b = {
    id: state.nextId++,
    def,
    side,
    hp,
    maxHp: hp,
    x: tx, y: ty,
    w, h,
    // якорь сортировки по глубине — нижняя грань пятна застройки
    sortY: ty + h - 1,
    workers: 0,
    progress: 0,
    built: state.tick,
  };
  state.buildings.push(b);
  events.emit('built', b);
  return b;
}

export function demolish(map, b) {
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = map.idx(x, y);
      map.occupied[i] = 0;
      map.passable[i] = 0;
    }
  const i = state.buildings.indexOf(b);
  if (i >= 0) state.buildings.splice(i, 1);
  events.emit('demolished', b);
}

/** Урон по зданию. Разрушено — сносится вместе с рабочими. */
export function damageBuilding(map, b, amount) {
  b.hp = Math.max(0, (b.hp || 0) - amount);
  if (b.hp > 0) return false;

  // рабочие погибают вместе со зданием
  for (let i = state.entities.length - 1; i >= 0; i--) {
    if (state.entities[i].home === b) state.entities.splice(i, 1);
  }
  demolish(map, b);
  events.emit('buildingDestroyed', { building: b });
  return true;
}

/** Здание под клеткой, если есть */
export function buildingAt(tx, ty) {
  return state.buildings.find((b) =>
    tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) || null;
}
