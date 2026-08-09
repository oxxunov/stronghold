// Наём войск. Формула из оригинала: свободный человек + оружие из арсенала
// + золото. Не хватило любого из трёх — солдата не будет.

import { CONFIG } from '../config.js';
import { state, addEntity } from '../core/state.js';
import { events } from '../core/events.js';
import { takeIdler } from '../society/population.js';
import { take } from '../economy/storage.js';

export let UNITS = {};

export async function loadUnits(url = './data/units.json') {
  const res = await fetch(url);
  UNITS = await res.json();
  for (const [id, u] of Object.entries(UNITS)) u.id = id;
  events.emit('unitsLoaded', UNITS);
  return UNITS;
}

export const barracks = () => state.buildings.find((b) => b.def.id === 'barracks') || null;

/** Чего не хватает для найма: возвращает { ok } либо причину */
export function canHire(unit) {
  if (!barracks()) return { ok: false, reason: 'Нет казармы' };
  if (state.population <= 0) return { ok: false, reason: 'Нет свободных людей' };
  if (state.resources.gold < unit.gold) return { ok: false, reason: 'Не хватает золота' };

  for (const [res, n] of Object.entries(unit.needs || {})) {
    if ((state.resources[res] || 0) < n) {
      return { ok: false, reason: `Нет: ${WEAPON_NAME[res] || res}` };
    }
  }
  return { ok: true };
}

export const WEAPON_NAME = {
  spear: 'копьё', bow: 'лук', sword: 'меч',
  leatherarmour: 'кожаный доспех', metalarmour: 'доспех',
};

/** Свободная клетка рядом с казармой */
function musterSpot(map, b) {
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = b.x + (b.w >> 1) + dx, y = b.y + b.h + dy;
        if (map.walkable(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function hire(map, unit) {
  const check = canHire(unit);
  if (!check.ok) return check;

  const b = barracks();
  const spot = musterSpot(map, b);
  if (!spot) return { ok: false, reason: 'К казарме не подойти' };
  if (!takeIdler()) return { ok: false, reason: 'Нет свободных людей' };

  state.population--;
  state.resources.gold -= unit.gold;
  for (const [res, n] of Object.entries(unit.needs || {})) take(res, n);

  const e = addEntity({
    type: 'soldier',
    unit: unit.id,
    role: unit.sprite,
    x: spot.x, y: spot.y,
    hp: unit.hp,
    maxHp: unit.hp,
    speed: unit.speed,
    damage: unit.damage,
    armor: unit.armor,
    range: unit.range,
    path: null, pathStep: 0, pathPending: false,
    dir: 'down', frame: 0, anim: Math.random() * CONFIG.UNIT_FRAMES,
    idle: Math.random() * 2,
    order: 'stand',          // stand | move | attack — приказы на шаге 8.2
    target: null,
    nav: null,
  });

  events.emit('hired', { unit, entity: e });
  return { ok: true, entity: e };
}

/** Сколько солдат каждого вида в замке */
export function army() {
  const out = {};
  for (const e of state.entities) {
    if (e.type !== 'soldier') continue;
    out[e.unit] = (out[e.unit] || 0) + 1;
  }
  return out;
}

export const armySize = () =>
  state.entities.reduce((n, e) => n + (e.type === 'soldier' ? 1 : 0), 0);


/** Пока приказов нет, солдаты топчутся у казармы */
export function updateSoldiers(map, dt, requestPath) {
  for (const e of state.entities) {
    if (e.type !== 'soldier') continue;

    if (e.path && e.pathStep < e.path.length) {
      const node = e.path[e.pathStep];
      const dx = node.x - e.x, dy = node.y - e.y;
      const dist = Math.hypot(dx, dy);
      const step = e.speed * dt;
      if (dist > 0.001) {
        if (Math.abs(dx) > Math.abs(dy)) e.dir = dx > 0 ? 'right' : 'left';
        else e.dir = dy > 0 ? 'down' : 'up';
      }
      if (dist <= step) { e.x = node.x; e.y = node.y; e.pathStep++; }
      else { e.x += (dx / dist) * step; e.y += (dy / dist) * step; }
      e.anim = (e.anim + step * 4) % CONFIG.UNIT_FRAMES;
      e.frame = Math.floor(e.anim);
      continue;
    }
    if (e.pathPending) continue;

    e.frame = 0;

    // дошёл до места приказа — стоит там, а не бредёт обратно
    if (e.order === 'move' || e.order === 'post') continue;

    e.idle -= dt;
    if (e.idle > 0) continue;
    e.idle = 3 + Math.random() * 5;

    const b = barracks();
    if (!b) continue;
    const tx = b.x + (b.w >> 1) + ((Math.random() * 9) | 0) - 4;
    const ty = b.y + b.h + ((Math.random() * 5) | 0) - 1;
    if (map.walkable(tx, ty)) requestPath(e, tx, ty);
  }
}
