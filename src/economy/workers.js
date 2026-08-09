// Рабочие. Один автомат на все профессии, разница только в источнике сырья:
//   добытчик   — дерево или скала на карте
//   фермер     — собственное поле
//   мастеровой — склад
//
// Навигация вынесена в navTo/navToTile: они возвращают 'moving' | 'arrived' |
// 'failed', поэтому фазы не занимаются маршрутами и не могут зациклиться.

import { CONFIG } from '../config.js';
import { state, addEntity } from '../core/state.js';
import { events } from '../core/events.js';
import { requestPath, requestPathAny } from '../world/pathfinding.js';
import { TERRAIN } from '../world/map.js';
import { killAnimal } from '../world/animals.js';
import { storeFor, deposit, take, has } from './storage.js';
import { takeIdler } from '../society/population.js';
import { workRate } from '../society/popularity.js';

const WORK_TIME = { chop: 3.0, mine: 4.0, farm: 2.5, hunt: 4.0 };
const craftTime = (def) => (def.cycle || 20) / 4 / workRate();

const JOB_BY_BUILDING = {
  woodcutter: 'chop', quarry: 'mine',
  wheatfarm: 'farm', orchard: 'farm', hopsfarm: 'farm',
  hunter: 'hunt',
  mill: 'craft', bakery: 'craft', dairy: 'craft',
  brewery: 'craft', inn: 'craft',
  ironmine: 'craft', pitchrig: 'craft',    // добывают на своём участке, сырьё не нужно
  fletcher: 'craft', poleturner: 'craft', blacksmith: 'craft',
  armourer: 'craft', tanner: 'craft',
};

// ------------------------------------------------------------- навигация
/** Все проходимые клетки вплотную к зданию */
function approachTiles(map, b) {
  const out = [];
  for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (map.walkable(x, b.y - 1)) out.push({ x, y: b.y - 1 });
    if (map.walkable(x, b.y + b.h)) out.push({ x, y: b.y + b.h });
  }
  for (let y = b.y - 1; y <= b.y + b.h; y++) {
    if (map.walkable(b.x - 1, y)) out.push({ x: b.x - 1, y });
    if (map.walkable(b.x + b.w, y)) out.push({ x: b.x + b.w, y });
  }
  return out;
}

/** Свободная клетка рядом с целью-клеткой */
function approachTile(map, tx, ty) {
  let best = null, bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = tx + dx, y = ty + dy;
      if (!map.walkable(x, y)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

const nearTarget = (e, t, r = 1.5) =>
  Math.abs(e.x - t.x) <= r && Math.abs(e.y - t.y) <= r;

/** Идти к зданию. Маршрут ищется сразу ко всем его входам:
    ближайший по прямой может оказаться в тупике за лесом. */
function navTo(map, e, b) {
  if (e.pathPending) return 'moving';
  if (e.path && e.pathStep < e.path.length) return 'moving';

  if (e.nav === b) {                       // маршрут отработан, разбираем итог
    e.nav = null;
    const t = e.target;
    e.target = null;
    return t && nearTarget(e, t) ? 'arrived' : 'failed';
  }

  const goals = approachTiles(map, b);
  if (!goals.length) return 'failed';
  if (goals.some((g) => nearTarget(e, g, 0.6))) return 'arrived';

  e.nav = b;
  requestPathAny(e, goals);
  return 'moving';
}

/** Идти к клетке на карте: дерево, скала, борозда поля */
function navToTile(map, e, tx, ty) {
  if (e.pathPending) return 'moving';
  if (e.path && e.pathStep < e.path.length) return 'moving';

  if (e.nav === 'tile') {
    e.nav = null;
    const t = e.target;
    e.target = null;
    return t && nearTarget(e, t) ? 'arrived' : 'failed';
  }

  const spot = approachTile(map, tx, ty);
  if (!spot) return 'failed';
  if (nearTarget(e, spot, 0.6)) return 'arrived';

  e.nav = 'tile';
  requestPath(e, spot.x, spot.y);
  return 'moving';
}

/** Пауза после неудачи: без неё рабочий каждый тик просит новый маршрут */
function stall(e, seconds = 3) {
  e.nav = null;
  e.target = null;
  e.source = null;
  e.timer = seconds;
  e.phase = 'idle';
}

// ------------------------------------------------------------- источники
function findTree(map, b, maxR = 16) {
  let best = null, bestD = Infinity;
  for (const d of map.decor) {
    if (d.kind !== 'tree' || d.taken) continue;
    const dist = Math.abs(d.x - b.x) + Math.abs(d.y - b.y);
    if (dist < bestD && dist <= maxR) { bestD = dist; best = d; }
  }
  return best;
}

function findRock(map, b, maxR = 12) {
  let best = null, bestD = Infinity;
  for (let y = b.y - maxR; y <= b.y + maxR; y++) {
    for (let x = b.x - maxR; x <= b.x + maxR; x++) {
      if (!map.inBounds(x, y)) continue;
      if (map.tiles[map.idx(x, y)] !== TERRAIN.ROCK.id) continue;
      if (!approachTile(map, x, y)) continue;
      const dist = Math.abs(x - b.x) + Math.abs(y - b.y);
      if (dist < bestD) { bestD = dist; best = { x, y }; }
    }
  }
  return best;
}

/** Ближайший непомеченный зверь в радиусе охоты */
function findAnimal(map, b, maxR = 20) {
  let best = null, bestD = Infinity;
  for (const e of state.entities) {
    if (e.type !== 'animal' || e.taken) continue;
    const d = Math.abs(e.x - b.x) + Math.abs(e.y - b.y);
    if (d < bestD && d <= maxR) { bestD = d; best = e; }
  }
  return best;
}

function fieldTile(map, b) {
  for (let i = 0; i < 12; i++) {
    const x = b.x + ((Math.random() * b.w) | 0);
    const y = b.y + ((Math.random() * b.h) | 0);
    if (approachTile(map, x, y)) return { x, y };
  }
  return null;
}

// ------------------------------------------------------------------ наём
export function assignJobs(map) {
  for (const b of state.buildings) {
    if (b.def.stages && b.growth === undefined) {
      b.growth = 0; b.growTimer = 0; b.harvestsLeft = 0;
    }
    const need = b.def.workers || 0;
    if (!need || b.workers >= need) continue;
    const job = JOB_BY_BUILDING[b.def.id];
    if (!job) continue;

    const doors = approachTiles(map, b);
    if (!doors.length) continue;

    while (b.workers < need && state.population > 0) {
      const door = doors[b.workers % doors.length];
      if (!takeIdler()) break;            // крестьянин уходит с площади на работу
      state.population--;
      b.workers++;
      addEntity({
        type: 'worker',
        role: 'peasant',
        job,
        home: b,
        x: door.x, y: door.y,
        speed: 1.6,
        path: null, pathStep: 0, pathPending: false,
        dir: 'down', frame: 0, anim: Math.random() * CONFIG.UNIT_FRAMES,
        phase: 'toSource',
        timer: 0,
        carry: null,
        target: null,
        nav: null,
        source: null,
      });
    }
  }
}

// ------------------------------------------------------------------ поля
export function growFields() {
  for (const b of state.buildings) {
    if (!b.def.stages) continue;
    if (b.growth >= b.def.stages - 1) continue;
    b.growTimer = (b.growTimer || 0) + 1;
    if (b.growTimer < (b.def.growTicks || 400)) continue;
    b.growTimer = 0;
    b.growth = (b.growth || 0) + 1;
    if (b.growth >= b.def.stages - 1) b.harvestsLeft = b.def.harvests || 3;
  }
}

export function regrowForest(map) {
  const REGROW = CONFIG.TICKS_PER_DAY * CONFIG.DAYS_PER_MONTH * 2;
  for (let i = map.stumps.length - 1; i >= 0; i--) {
    const s = map.stumps[i];
    if (state.tick - s.at < REGROW) continue;
    if (Math.random() > 0.5) continue;
    map.stumps.splice(i, 1);
    map.decor.push({ kind: 'tree', x: s.x, y: s.y, v: 2, s: 0.62, taken: false });
    events.emit('regrown', s);
  }
}

// ---------------------------------------------------------- главный цикл
export function updateWorkers(map, dt) {
  for (const e of state.entities) {
    if (e.type !== 'worker') continue;

    // движение по уже проложенному маршруту
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

    if (e.job === 'craft') updateCrafter(map, e, dt);
    else updateGatherer(map, e, dt);
  }
}

// ---------------------------------------------------- добытчики и фермеры
function updateGatherer(map, e, dt) {
  if (e.phase === 'toSource') {
    if (e.job === 'farm') {
      if (!e.home.harvestsLeft) { stall(e, 2); return; }
      if (!e.source) {
        const spot = fieldTile(map, e.home);
        if (!spot) { stall(e, 2); return; }
        e.source = spot;
      }
    } else if (e.job === 'hunt') {
      if (!e.source) {
        const prey = findAnimal(map, e.home);
        if (!prey) { stall(e, 3); return; }
        prey.taken = true;
        e.source = prey;
      }
      // зверь ходит, поэтому цель обновляем на лету
      if (!state.entities.includes(e.source)) { e.source = null; stall(e, 1); return; }
    } else if (!e.source) {
      const src = e.job === 'chop' ? findTree(map, e.home) : findRock(map, e.home);
      if (!src) { stall(e, 2); return; }
      if (e.job === 'chop') src.taken = true;
      e.source = src;
    }

    const r = navToTile(map, e, Math.round(e.source.x), Math.round(e.source.y));
    if (r === 'moving') return;
    if (r === 'failed') {
      if (e.source && (e.job === 'chop' || e.job === 'hunt')) e.source.taken = false;
      stall(e, 2);
      return;
    }
    e.phase = 'working';
    e.timer = WORK_TIME[e.job] / workRate();
    return;
  }

  if (e.phase === 'working') {
    e.timer -= dt;
    if (e.source) {                       // лицом к работе
      const dx = e.source.x - e.x, dy = e.source.y - e.y;
      if (Math.abs(dx) > Math.abs(dy)) e.dir = dx > 0 ? 'right' : 'left';
      else e.dir = dy > 0 ? 'down' : 'up';
    }
    if (e.timer > 0) return;

    if (e.job === 'hunt') {
      if (!e.source || !state.entities.includes(e.source)) { e.source = null; stall(e, 1); return; }
      const meat = killAnimal(e.source);
      e.carry = { res: 'meat', n: meat };
    } else if (e.job === 'farm') {
      // что именно растёт, берём из данных здания: пшеница или яблоки
      const res = Object.keys(e.home.def.output || { wheat: 1 })[0];
      e.carry = { res, n: 1 };
      e.home.harvestsLeft = Math.max(0, (e.home.harvestsLeft || 0) - 1);
      if (!e.home.harvestsLeft) { e.home.growth = 0; e.home.growTimer = 0; }
    } else if (e.job === 'chop') {
      const i = map.decor.indexOf(e.source);
      if (i >= 0) map.decor.splice(i, 1);
      map.stumps.push({ x: e.source.x, y: e.source.y, at: state.tick });
      e.carry = { res: 'wood', n: 1 };
    } else {
      e.carry = { res: 'stone', n: 1 };
    }
    e.source = null;
    e.phase = 'toStore';
    return;
  }

  if (e.phase === 'toStore') {
    const store = storeFor(e.carry.res);
    if (!store) { stall(e, 3); return; }
    const r = navTo(map, e, store);
    if (r === 'moving') return;
    if (r === 'failed') { stall(e, 3); return; }
    deposit(e.carry.res, e.carry.n);
    e.carry = null;
    e.phase = 'toSource';
    return;
  }

  e.timer -= dt;
  if (e.timer <= 0) e.phase = e.carry ? 'toStore' : 'toSource';
}

// -------------------------------------------------------------- мастерские
function updateCrafter(map, e, dt) {
  const def = e.home.def;
  const inRes = Object.keys(def.input || {})[0];
  const inAmt = (def.input || {})[inRes] || 1;

  if (e.phase === 'toSource') {
    if (!inRes) { e.phase = 'working'; e.timer = craftTime(def); return; }
    const src = storeFor(inRes);
    if (!src || !has(inRes, inAmt)) { stall(e, 3); return; }
    const r = navTo(map, e, src);
    if (r === 'moving') return;
    if (r === 'failed') { stall(e, 3); return; }
    if (!take(inRes, inAmt)) { stall(e, 2); return; }
    e.carry = { res: inRes, n: inAmt };
    e.phase = 'toHome';
    return;
  }

  if (e.phase === 'toHome') {
    const r = navTo(map, e, e.home);
    if (r === 'moving') return;
    if (r === 'failed') { stall(e, 3); return; }
    e.carry = null;                       // сырьё ушло в работу
    e.phase = 'working';
    e.timer = craftTime(def);
    return;
  }

  if (e.phase === 'working') {
    e.timer -= dt;
    if (e.timer > 0) return;
    // таверна ничего не производит: бочка просто встаёт в её погреб
    if (def.serves) {
      e.home.ale = (e.home.ale || 0) + 1;
      e.phase = 'toSource';
      return;
    }
    const outRes = Object.keys(def.output || {})[0];
    const outAmt = (def.output || {})[outRes] || 1;
    e.carry = outRes ? { res: outRes, n: outAmt } : null;
    e.phase = e.carry ? 'toStore' : 'toSource';
    return;
  }

  if (e.phase === 'toStore') {
    const store = storeFor(e.carry.res);
    if (!store) { stall(e, 3); return; }
    const r = navTo(map, e, store);
    if (r === 'moving') return;
    if (r === 'failed') { stall(e, 3); return; }
    deposit(e.carry.res, e.carry.n);
    e.carry = null;
    e.phase = 'toSource';
    return;
  }

  e.timer -= dt;
  if (e.timer <= 0) e.phase = e.carry ? 'toStore' : 'toSource';
}
