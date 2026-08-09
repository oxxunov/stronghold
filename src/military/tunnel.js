// Подкопы и чума — две вещи, которые в оригинале решают затяжную осаду.
//
// Тоннельщик не ломает стену снаружи, а подкапывается снизу: подходит
// вплотную, роет, и участок обрушивается сам. Дороже по времени, зато
// не под обстрелом со стены — если успел добежать.
//
// Чума прилетает дохлой коровой из требушета: облако заражает всех рядом,
// больные теряют здоровье и заражают других, а народ мрачнеет.

import { state, addEntity } from '../core/state.js';
import { events } from '../core/events.js';
import { requestPath } from '../world/pathfinding.js';
import { damageWall } from '../world/walls.js';
import { takeIdler } from '../society/population.js';

// ------------------------------------------------------------- подкопы
export const TUNNELLER = {
  name: 'Тоннельщик', gold: 30, hp: 30, speed: 1.4,
  digTime: 14,            // секунд на подкоп
  collapse: 2,            // сколько клеток стены обрушится
};

export const tunnelGuild = () =>
  state.buildings.find((b) => b.def.id === 'tunnelguild') || null;

export function canHireTunneller() {
  if (!tunnelGuild()) return { ok: false, reason: 'Нет гильдии тоннельщиков' };
  if (state.population <= 0) return { ok: false, reason: 'Нет свободных людей' };
  if (state.resources.gold < TUNNELLER.gold) return { ok: false, reason: 'Не хватает золота' };
  return { ok: true };
}

function spotNear(map, b) {
  for (let r = 1; r <= 5; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = b.x + (b.w >> 1) + dx, y = b.y + b.h + dy;
        if (map.walkable(x, y)) return { x, y };
      }
  return null;
}

export function hireTunneller(map) {
  const check = canHireTunneller();
  if (!check.ok) return check;

  const g = tunnelGuild();
  const spot = spotNear(map, g);
  if (!spot) return { ok: false, reason: 'К гильдии не подойти' };
  if (!takeIdler()) return { ok: false, reason: 'Нет свободных людей' };

  state.population--;
  state.resources.gold -= TUNNELLER.gold;

  const e = addEntity({
    type: 'tunneller',
    role: 'peasant',
    x: spot.x, y: spot.y,
    hp: TUNNELLER.hp, maxHp: TUNNELLER.hp,
    speed: TUNNELLER.speed,
    armor: 0, damage: 0, range: 0,
    path: null, pathStep: 0, pathPending: false,
    dir: 'down', frame: 0, anim: 0,
    order: 'stand', target: null, dig: 0,
  });

  events.emit('tunnellerHired', { entity: e });
  return { ok: true, entity: e };
}

/** Копать под указанную клетку стены */
export function orderDig(map, e, x, y) {
  if (!map.inBounds(x, y) || !map.walls[map.idx(x, y)]) return false;
  e.order = 'dig';
  e.target = { x, y };
  e.dig = 0;

  // если уже стоит вплотную — сразу за лопату, маршрут не нужен
  if (Math.hypot(x - e.x, y - e.y) <= 1.8) return true;

  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    if (map.walkable(x + dx, y + dy)) {
      requestPath(e, x + dx, y + dy);
      break;
    }
  }
  return true;
}

export function updateTunnellers(map, dt) {
  for (const e of state.entities) {
    if (e.type !== 'tunneller') continue;

    // движение делает общий код в units.js, здесь только копка
    if (e.path && e.pathStep < e.path.length) continue;
    if (e.pathPending) continue;
    if (e.order !== 'dig' || !e.target) continue;

    const d = Math.hypot(e.target.x - e.x, e.target.y - e.y);
    if (d > 1.8) continue;                    // ещё не дошёл

    e.dig += dt;
    if (e.dig < TUNNELLER.digTime) continue;

    // обрушение: сама клетка и соседние вдоль стены
    const cells = [{ x: e.target.x, y: e.target.y }];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (cells.length >= TUNNELLER.collapse) break;
      const nx = e.target.x + dx, ny = e.target.y + dy;
      if (map.inBounds(nx, ny) && map.walls[map.idx(nx, ny)]) cells.push({ x: nx, y: ny });
    }
    for (const c of cells) damageWall(map, c.x, c.y, 99999);

    events.emit('tunnelCollapse', { cells });
    e.order = 'stand';
    e.target = null;
    e.dig = 0;
  }
}

// --------------------------------------------------------------- чума
export const PLAGUE_RADIUS = 2.5;
export const PLAGUE_LIFE = 40;        // сколько секунд заразно место падения
export const SICK_DPS = 1.2;          // урон больному в секунду
export const SICK_TIME = 25;          // сколько болеет

/** Облако заразы в точке — сюда попала дохлая корова */
export function spawnPlague(x, y) {
  state.plague.push({ x, y, left: PLAGUE_LIFE });
  events.emit('plague', { x, y });
}

export function updatePlague(map, dt) {
  // облака выдыхаются
  for (let i = state.plague.length - 1; i >= 0; i--) {
    state.plague[i].left -= dt;
    if (state.plague[i].left <= 0) state.plague.splice(i, 1);
  }

  const catchable = (e) =>
    e.type === 'worker' || e.type === 'idler' || e.type === 'soldier'
    || e.type === 'enemy' || e.type === 'tunneller';

  // заражение от облаков
  for (const p of state.plague) {
    for (const e of state.entities) {
      if (!catchable(e) || e.sick > 0) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) > PLAGUE_RADIUS) continue;
      e.sick = SICK_TIME;
      events.emit('infected', { entity: e });
    }
  }

  // больные хиреют и заражают соседей
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (!e.sick || e.sick <= 0) continue;

    e.sick -= dt;
    e.hp = (e.hp === undefined ? 30 : e.hp) - SICK_DPS * dt;

    if (Math.random() < dt * 0.08) {          // редкая передача рядом стоящему
      for (const o of state.entities) {
        if (o === e || !catchable(o) || o.sick > 0) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) > 1.4) continue;
        o.sick = SICK_TIME;
        break;
      }
    }

    if (e.hp <= 0) {
      state.entities.splice(i, 1);
      if (e.type === 'worker' && e.home) e.home.workers = Math.max(0, e.home.workers - 1);
      // на месте смерти остаётся очаг заразы
      if (Math.random() < 0.35) spawnPlague(e.x, e.y);
      events.emit('diedOfPlague', { entity: e });
    }
  }
}

/** Сколько народу болеет — идёт в расчёт настроения */
export const sickCount = () =>
  state.entities.reduce((n, e) => n + (e.sick > 0 ? 1 : 0), 0);
