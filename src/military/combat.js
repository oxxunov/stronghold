// Бой. Живёт по трём правилам:
//   1. Стрелок бьёт с дистанции и не сходит с места, если стоит на посту.
//   2. Рукопашник идёт к ближайшему врагу и рубит, пока не свалится.
//   3. Урон = урон минус броня, но не меньше единицы — доспех спасает,
//      но не делает бессмертным.

import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { requestPath } from '../world/pathfinding.js';
import { damageWall } from '../world/walls.js';
import { effectiveRange } from './orders.js';
import { demolish } from '../economy/buildings.js';
import { dirIndex } from '../render/actorsheet.js';

export const ATTACK_COOLDOWN = 1.2;   // секунд между ударами
export const CHASE_RADIUS = 9;        // насколько далеко рукопашник погонится
export const FIRE_DPS = 14;           // урон в секунду в горящем рву

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const isFighter = (e) =>
  e.type === 'soldier' || e.type === 'enemy';

const enemyOf = (e) => (e.type === 'soldier' ? 'enemy' : 'soldier');

/** Ближайший противник в радиусе */
export function findFoe(e, radius) {
  const want = enemyOf(e);
  let best = null, bestD = Infinity;
  for (const o of state.entities) {
    if (o.type !== want || o.hp <= 0) continue;
    const d = dist(e, o);
    if (d < bestD && d <= radius) { bestD = d; best = o; }
  }
  return best;
}

export function damage(target, amount, source = null) {
  const real = Math.max(1, Math.round(amount - (target.armor || 0)));
  target.hp -= real;
  if (target.hp <= 0) kill(target, source);
  return real;
}

export function kill(e, source = null) {
  // мечник падает с анимацией: убираем не сразу, а после последнего кадра
  if (e.role === 'swordsman' && !e.deathDone) {
    e.hp = 0;
    e.animState = 'death';
    e.dying = true;
    return;
  }
  const i = state.entities.indexOf(e);
  if (i >= 0) state.entities.splice(i, 1);
  // погибший солдат уносит с собой человека: население не возвращается
  events.emit('died', { entity: e, by: source });
}

/** Выстрел рисуется недолго — только чтобы было видно, кто в кого */
function shoot(from, to) {
  state.shots.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, left: 0.25 });
}

export function updateCombat(map, dt) {
  // полёт стрел
  for (let i = state.shots.length - 1; i >= 0; i--) {
    state.shots[i].left -= dt;
    if (state.shots[i].left <= 0) state.shots.splice(i, 1);
  }

  // доигравшие смерть убираются с карты
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (e.dying && e.deathDone) {
      state.entities.splice(i, 1);
      events.emit('died', { entity: e, by: null });
    }
  }

  for (const e of state.entities) {
    if (!isFighter(e) || e.hp <= 0) continue;

    e.cool = Math.max(0, (e.cool || 0) - dt);

    // --- огонь под ногами ---
    for (const f of state.fires) {
      if (Math.abs(f.x - e.x) < 0.7 && Math.abs(f.y - e.y) < 0.7) {
        e.hp -= FIRE_DPS * dt;
        if (e.hp <= 0) { kill(e, null); break; }
      }
    }
    if (e.hp <= 0) continue;

    // --- ловушки ---
    if (e.type === 'enemy') {
      const b = trapAt(map, Math.round(e.x), Math.round(e.y));
      if (b) {
        damage(e, b.def.damage || 30, null);
        demolish(map, b);                  // яма срабатывает один раз
        events.emit('trapSprung', { x: b.x, y: b.y });
        if (e.hp <= 0) continue;
      }
    }

    // упёрся в стену — ломает её вместо поиска обхода
    if (e.breach && e.cool <= 0) {
      const w = map.walls[map.idx(e.breach.x, e.breach.y)];
      if (!w) { e.breach = null; }
      else {
        e.cool = ATTACK_COOLDOWN;
        const broke = damageWall(map, e.breach.x, e.breach.y, Math.max(4, e.damage));
        if (broke) e.breach = null;
        continue;
      }
    }

    const reach = e.range > 0 ? effectiveRange(e) : 1.5;
    const foe = findFoe(e, Math.max(reach, e.order === 'post' ? reach : CHASE_RADIUS));
    if (!foe) continue;

    const d = dist(e, foe);

    if (d <= reach) {
      if (e.cool > 0) continue;
      e.cool = ATTACK_COOLDOWN;
      // повернуться к цели
      const dx = foe.x - e.x, dy = foe.y - e.y;
      if (Math.abs(dx) > Math.abs(dy)) e.dir = dx > 0 ? 'right' : 'left';
      else e.dir = dy > 0 ? 'down' : 'up';
      e.facing = dirIndex(dx, dy);
      e.animState = 'attack';

      if (e.range > 0) shoot(e, foe);
      damage(foe, e.damage, e);
      continue;
    }

    // не достал: стрелок на посту стоит, остальные идут в контакт
    if (e.order === 'post' || e.range > 0) continue;
    if (e.pathPending || (e.path && e.pathStep < e.path.length)) continue;
    if (d > CHASE_RADIUS) continue;

    requestPath(e, Math.round(foe.x), Math.round(foe.y));
    e.order = 'fight';
  }
}

/** Ловушка на этой клетке, если есть */
function trapAt(map, x, y) {
  return state.buildings.find(
    (b) => b.def.trap && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) || null;
}
