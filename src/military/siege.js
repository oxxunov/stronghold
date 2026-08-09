// Осадные машины. Собираются в гильдии инженеров, обслуживаются инженерами
// и бьют по постройкам, а не по людям: главная цель осады — проломить стену.
//
// Кадры спрайта: 0 — взведена, 1 — натянута, 2 — выстрел.

import { state, addEntity } from '../core/state.js';
import { events } from '../core/events.js';
import { damageWall } from '../world/walls.js';
import { buildingAt, damageBuilding } from '../economy/buildings.js';
import { spawnPlague } from './tunnel.js';
import { requestPath } from '../world/pathfinding.js';

export const ENGINES = {
  catapult: {
    name: 'Катапульта', row: 0,
    cost: { wood: 30, gold: 20 }, crew: 1,
    range: 11, damage: 60, splash: 1, reload: 6, speed: 0.5,
    desc: 'Бьёт по стенам и зданиям. Задевает соседние клетки.',
  },
  trebuchet: {
    name: 'Требушет', row: 1,
    cost: { wood: 50, stone: 20, gold: 40 }, crew: 2,
    range: 16, damage: 130, splash: 1, reload: 11, speed: 0.3,
    cow: true,                       // может стрелять дохлой коровой
    desc: 'Дальше и сильнее катапульты. Может метать дохлую корову.',
  },
  ladder: {
    name: 'Лестница', row: 3,
    cost: { wood: 15 }, crew: 1,
    range: 1.6, damage: 0, splash: 0, reload: 1, speed: 1.0,
    deploy: 1,                       // ставит переправу через одну клетку стены
    desc: 'Приставляется к стене: по ней лезут наверх.',
  },
  siegetower: {
    name: 'Осадная башня', row: 4,
    cost: { wood: 60, gold: 30 }, crew: 3,
    range: 1.8, damage: 0, splash: 0, reload: 1, speed: 0.35,
    deploy: 2,                       // мостик шириной в две клетки
    desc: 'Медленно едет, зато высаживает отряд прямо на стену.',
  },
  ram: {
    name: 'Таран', row: 2,
    cost: { wood: 40, gold: 15 }, crew: 2,
    range: 1.6, damage: 90, splash: 0, reload: 3, speed: 0.7,
    desc: 'Ломает ворота и стены вплотную.',
  },
};

export const guild = () =>
  state.buildings.find((b) => b.def.id === 'engineerguild') || null;

export function canBuildEngine(def) {
  if (!guild()) return { ok: false, reason: 'Нет гильдии инженеров' };
  if (state.population < def.crew) return { ok: false, reason: `Нужно людей: ${def.crew}` };
  for (const [res, n] of Object.entries(def.cost)) {
    if ((state.resources[res] || 0) < n) return { ok: false, reason: `Не хватает: ${res}` };
  }
  return { ok: true };
}

function spotNear(map, b) {
  for (let r = 1; r <= 5; r++) {
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

export function buildEngine(map, id) {
  const def = ENGINES[id];
  const check = canBuildEngine(def);
  if (!check.ok) return check;

  const g = guild();
  const spot = spotNear(map, g);
  if (!spot) return { ok: false, reason: 'К гильдии не подойти' };

  for (const [res, n] of Object.entries(def.cost)) state.resources[res] -= n;
  state.population -= def.crew;          // расчёт уходит к машине

  const e = addEntity({
    type: 'engine',
    side: 'player',
    engine: id,
    x: spot.x, y: spot.y,
    hp: 200, maxHp: 200,
    speed: def.speed,
    range: def.range,
    damage: def.damage,
    reload: def.reload,
    cool: 0,
    frame: 0,
    path: null, pathStep: 0, pathPending: false,
    order: 'stand',
    aim: null,                            // клетка обстрела
  });

  events.emit('engineBuilt', { id, entity: e });
  return { ok: true, entity: e };
}

/** Навести машину на клетку — бить или, у подъёмных, приставляться */
export function aimAt(engine, x, y) {
  engine.aim = { x, y };
  engine.order = ENGINES[engine.engine].deploy ? 'deploy' : 'bombard';
}

/**
 * Приставить лестницу или подвести башню: клетка стены становится
 * проходимой, но лезть через неё долго (moveCost 6).
 */
function deploy(map, e, def) {
  const { x, y } = e.aim;
  if (!map.inBounds(x, y) || !map.walls[map.idx(x, y)]) {
    e.order = 'stand';
    e.aim = null;
    return;
  }

  const cells = [{ x, y }];
  if (def.deploy > 1) {
    // мостик шире: захватываем соседнюю клетку стены вдоль неё
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (map.inBounds(x + dx, y + dy) && map.walls[map.idx(x + dx, y + dy)]) {
        cells.push({ x: x + dx, y: y + dy });
        break;
      }
    }
  }

  for (const c of cells) map.crossing[map.idx(c.x, c.y)] = 1;
  e.frame = 2;
  e.deployed = true;
  e.order = 'stand';
  events.emit('deployed', { engine: e, cells });

  // лестницу оставляем стоять, башня остаётся на месте с опущенным мостиком
  if (e.engine === 'ladder') e.speed = 0;
}

/** Что ломать в этой клетке: сначала стена, потом здание */
function hitTile(map, x, y, damage) {
  if (!map.inBounds(x, y)) return false;
  if (map.walls[map.idx(x, y)]) {
    damageWall(map, x, y, damage);
    return true;
  }
  const b = buildingAt(x, y);
  if (b) {
    damageBuilding(map, b, damage);
    return true;
  }
  return false;
}

export function updateEngines(map, dt) {
  for (const e of state.entities) {
    if (e.type !== 'engine') continue;

    e.cool = Math.max(0, e.cool - dt);
    const def = ENGINES[e.engine];

    // кадр показывает фазу перезарядки: взведена → натянута → выстрел
    if (e.deployed) { e.frame = 2; continue; }
    const part = 1 - e.cool / def.reload;
    e.frame = e.cool <= 0 ? 0 : (part > 0.75 ? 1 : 0);

    if (e.order === 'deploy' && e.aim) {
      const d0 = Math.hypot(e.aim.x - e.x, e.aim.y - e.y);
      if (d0 <= def.range) deploy(map, e, def);
      else e.needMove = true;
      continue;
    }

    if (e.order !== 'bombard' || !e.aim) continue;

    const d = Math.hypot(e.aim.x - e.x, e.aim.y - e.y);
    if (d > def.range) {
      // не достаёт — подъезжаем ближе своим ходом
      if (!e.pathPending && (!e.path || e.pathStep >= e.path.length)) {
        const step = Math.max(1, Math.round(d - def.range * 0.7));
        const nx = Math.round(e.x + (e.aim.x - e.x) / d * step);
        const ny = Math.round(e.y + (e.aim.y - e.y) / d * step);
        if (map.walkable(nx, ny)) requestPath(e, nx, ny);
      }
      continue;
    }

    if (e.cool > 0) continue;
    e.cool = def.reload;
    e.frame = 2;

    let hit = hitTile(map, e.aim.x, e.aim.y, def.damage);
    // осколки задевают соседние клетки
    if (def.splash) {
      for (let dy = -def.splash; dy <= def.splash; dy++) {
        for (let dx = -def.splash; dx <= def.splash; dx++) {
          if (!dx && !dy) continue;
          hitTile(map, e.aim.x + dx, e.aim.y + dy, Math.round(def.damage * 0.4));
        }
      }
    }

    // корова бьёт слабее камня: её дело — зараза, а не пролом
    if (e.ammo === 'cow') hit = true;

    // урон по людям в точке попадания
    for (const o of state.entities) {
      if (o.type !== 'soldier' && o.type !== 'enemy' && o.type !== 'worker') continue;
      if (Math.hypot(o.x - e.aim.x, o.y - e.aim.y) > 1.2) continue;
      o.hp = (o.hp || 1) - def.damage * 0.5;
      if (o.hp <= 0) {
        const i = state.entities.indexOf(o);
        if (i >= 0) state.entities.splice(i, 1);
      }
    }

    state.shots.push({ x0: e.x, y0: e.y, x1: e.aim.x, y1: e.aim.y, left: 0.4, lob: true });
    events.emit('bombard', { engine: e, hit });

    // заряжен коровой — вместо камня прилетает зараза
    if (e.ammo === 'cow') {
      spawnPlague(e.aim.x, e.aim.y);
      e.ammo = 'stone';               // корова одноразовая
    }

    // ломать больше нечего — прекращаем обстрел
    if (!hit && !map.walls[map.idx(e.aim.x, e.aim.y)] && !buildingAt(e.aim.x, e.aim.y)) {
      e.order = 'stand';
      e.aim = null;
    }
  }
}


/**
 * Котлы с маслом. Стоят у ворот, тратят смолу со склада и ошпаривают
 * всех врагов рядом. Перезарядка долгая — это последний довод, а не пулемёт.
 */
export function updateOil(map, dt) {
  for (const b of state.buildings) {
    if (!b.def.oil) continue;
    b.cool = Math.max(0, (b.cool || 0) - dt);
    if (b.cool > 0) continue;

    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const victims = state.entities.filter(
      (e) => e.type === 'enemy' && Math.hypot(e.x - cx, e.y - cy) <= b.def.radius);
    if (!victims.length) continue;

    const need = b.def.pitchPerShot || 1;
    if ((state.resources.pitch || 0) < need) continue;
    state.resources.pitch -= need;
    b.cool = b.def.reload || 8;

    for (const v of victims) {
      v.hp -= Math.max(1, b.def.damage - (v.armor || 0));
      if (v.hp <= 0) {
        const i = state.entities.indexOf(v);
        if (i >= 0) state.entities.splice(i, 1);
      }
    }
    // короткая вспышка на месте котла
    state.fires.push({ x: cx, y: cy, left: 0.8 });
    events.emit('oilPoured', { building: b, hit: victims.length });
  }
}


/** Зарядить требушет дохлой коровой: нужна молочная ферма */
export function loadCow(engine) {
  const def = ENGINES[engine.engine];
  if (!def.cow) return { ok: false, reason: 'Эта машина не мечет коров' };
  if (!state.buildings.some((b) => b.def.id === 'dairy'))
    return { ok: false, reason: 'Нужна молочная ферма' };
  engine.ammo = 'cow';
  events.emit('cowLoaded', { engine });
  return { ok: true };
}


/** Осадная машина противника — ставится сразу собранной у его замка */
export function spawnEnemyEngine(map, id, x, y) {
  const def = ENGINES[id];
  if (!def || !map.walkable(x, y)) return null;
  return addEntity({
    type: 'engine',
    side: 'enemy',
    engine: id,
    x, y,
    hp: 200, maxHp: 200,
    speed: def.speed,
    range: def.range,
    damage: def.damage,
    reload: def.reload,
    cool: def.reload,
    frame: 0,
    path: null, pathStep: 0, pathPending: false,
    order: 'stand',
    aim: null,
  });
}
