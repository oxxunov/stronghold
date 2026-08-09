// ИИ-лорд. Не строит экономику по-настоящему — он ставит замок и шлёт
// волны, растущие со временем. Этого достаточно, чтобы игра стала игрой:
// давление есть, а тысяча строк экономического ИИ не нужна.

import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { DEFS, place, checkPlace } from '../economy/buildings.js';
import { WALL_STONE, placeWalls, canPlaceWall } from '../world/walls.js';
import { UNITS, spawnEnemy } from '../military/units.js';
import { spawnEnemyEngine, aimAt } from '../military/siege.js';
import { requestPath } from '../world/pathfinding.js';

export let LORDS = {};

export async function loadLords(url = './data/lords.json') {
  const res = await fetch(url);
  LORDS = await res.json();
  for (const [id, l] of Object.entries(LORDS)) l.id = id;
  return LORDS;
}

const CASTLE_SIZE = { small: 9, medium: 12, large: 15 };

/**
 * Место под вражеский замок. Идеально ровных площадок такого размера
 * на карте почти не бывает, поэтому берём лучшую из доступных и
 * расчищаем её — лорд ведь тоже готовил стройку.
 */
function castleSpot(map, size) {
  const keep = state.buildings.find((b) => b.def.id === 'keep' && b.side !== 'enemy');
  const kx = keep ? keep.x : map.w >> 1;
  const ky = keep ? keep.y : map.h >> 1;

  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 600; i++) {
    const x = 3 + ((Math.random() * (map.w - size - 6)) | 0);
    const y = 3 + ((Math.random() * (map.h - size - 6)) | 0);

    let flat = 0;
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++)
        if (map.walkableTerrain(x + dx, y + dy)) flat++;

    const share = flat / (size * size);
    if (share < 0.55) continue;                // слишком много воды или скал

    const d = Math.hypot(x - kx, y - ky);
    if (d < 18) continue;                      // слишком близко к игроку

    // ровное важнее далёкого, но и далёкое ценим
    const score = share * 60 + d;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

/** Расчистка площадки: воду и скалу под замком превращаем в землю */
function levelGround(map, x, y, size) {
  const DIRT = 1, GRASS = 0;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const i = map.idx(x + dx, y + dy);
      if (!map.walkableTerrain(x + dx, y + dy)) map.tiles[i] = DIRT;
      else if (map.tiles[i] === 5) map.tiles[i] = GRASS;   // лес вырублен
    }
  }
  // декор с площадки убираем
  map.decor = map.decor.filter(
    (d) => d.x < x || d.x >= x + size || d.y < y || d.y >= y + size);
}

/**
 * Ставит вражеский замок: донжон, кольцо стен с воротами, башни, казарма.
 * Всё помечается стороной enemy — свои рабочие туда не ходят.
 */
export function buildEnemyCastle(map, lord) {
  const size = CASTLE_SIZE[lord.castle] || 10;
  const spot = castleSpot(map, size);
  if (!spot) return null;

  const { x, y } = spot;
  levelGround(map, x, y, size);
  const cx = x + (size >> 1), cy = y + (size >> 1);

  const keep = place(map, DEFS.keep, cx - 2, cy - 2, 'enemy');
  if (!keep) return null;

  // кольцо стен по краю площадки
  const ring = [];
  for (let i = 0; i < size; i++) {
    ring.push({ x: x + i, y });
    ring.push({ x: x + i, y: y + size - 1 });
    ring.push({ x, y: y + i });
    ring.push({ x: x + size - 1, y: y + i });
  }
  const free = ring.filter((c) => canPlaceWall(map, c.x, c.y).ok);
  // стены врага строятся без списания наших ресурсов
  for (const c of free) {
    map.walls[map.idx(c.x, c.y)] = WALL_STONE;
    map.wallHp[map.idx(c.x, c.y)] = 400;
  }

  // ворота в южной стене
  for (let i = 2; i < size - 3; i++) {
    const gx = x + i, gy = y + size - 2;
    if (checkPlace(map, DEFS.gatehouse, gx, gy, 'enemy').ok) {
      place(map, DEFS.gatehouse, gx, gy, 'enemy');
      break;
    }
  }

  // башни по углам и казарма внутри
  const corners = [[x + 1, y + 1], [x + size - 4, y + 1], [x + 1, y + size - 4]];
  for (const [tx, ty] of corners) {
    if (checkPlace(map, DEFS.watchtower, tx, ty, 'enemy').ok) place(map, DEFS.watchtower, tx, ty, 'enemy');
  }
  const bx = cx - 2, by = cy + 3;
  if (checkPlace(map, DEFS.barracks, bx, by, 'enemy').ok) place(map, DEFS.barracks, bx, by, 'enemy');

  state.lord = {
    id: lord.id,
    def: lord,
    keep,
    timer: lord.firstWave,
    wave: 0,
    alive: true,
  };

  events.emit('lordArrived', { lord, keep });
  return keep;
}

/** Состав волны по вкусам лорда */
function waveComposition(lord, count) {
  const out = [];
  const mix = Object.entries(lord.mix);
  for (let i = 0; i < count; i++) {
    let roll = Math.random(), pick = mix[0][0];
    for (const [id, share] of mix) {
      if (roll < share) { pick = id; break; }
      roll -= share;
    }
    out.push(UNITS[pick] ? pick : 'spearman');
  }
  return out;
}

/** Точка сбора у ворот вражеского замка */
function musterSpot(map, keep) {
  for (let r = 3; r <= 10; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = keep.x + 2 + dx, y = keep.y + 2 + dy;
        if (map.walkable(x, y)) return { x, y };
      }
  return null;
}

/**
 * Куда бить: сначала ищем ворота (самое слабое место в стене),
 * потом самый побитый участок стены, и только если стен нет — прямо донжон.
 */
export function pickTarget(map) {
  const keep = state.buildings.find((b) => b.def.id === 'keep' && b.side !== 'enemy');
  if (!keep) return null;

  const gate = state.buildings.find((b) => b.def.passable && b.side !== 'enemy');
  if (gate) return { x: gate.x, y: gate.y, kind: 'gate' };

  // ближайшая к нашему замку клетка стены с наименьшей прочностью
  let best = null, bestScore = Infinity;
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = map.idx(x, y);
      if (!map.walls[i]) continue;
      const d = Math.hypot(x - keep.x, y - keep.y);
      if (d > 14) continue;                     // это стены не нашего замка
      const score = map.wallHp[i] + d * 4;
      if (score < bestScore) { bestScore = score; best = { x, y, kind: 'wall' }; }
    }
  }
  if (best) return best;

  return { x: keep.x + 2, y: keep.y + keep.h, kind: 'keep' };
}

/** Точка сбора: рядом с целью, но вне выстрела со стен */
function stagingSpot(map, target) {
  const L = state.lord;
  const fromX = L ? L.keep.x : 0, fromY = L ? L.keep.y : 0;
  const dx = target.x - fromX, dy = target.y - fromY;
  const len = Math.hypot(dx, dy) || 1;

  for (let back = 10; back >= 4; back--) {
    const x = Math.round(target.x - (dx / len) * back);
    const y = Math.round(target.y - (dy / len) * back);
    if (map.walkable(x, y)) return { x, y };
  }
  return null;
}

/**
 * Выпустить волну. Отряд сначала собирается в стороне и только потом идёт
 * на штурм — иначе бойцы прибывают поодиночке и гибнут по одному.
 */
export function sendWave(map) {
  const L = state.lord;
  if (!L || !L.alive) return 0;

  const size = L.def.waveStart + L.wave * L.def.waveGrow;
  const comp = waveComposition(L.def, size);
  const target = pickTarget(map);
  const staging = target ? stagingSpot(map, target) : null;

  const wave = { units: [], engines: [], target, stage: 'muster', timer: 0 };

  let sent = 0;
  for (const unitId of comp) {
    const spot = musterSpot(map, L.keep);
    if (!spot) break;
    const e = spawnEnemy(map, unitId, spot.x, spot.y);
    if (!e) continue;
    e.order = 'march';
    e.wave = wave;
    if (staging) requestPath(e, staging.x, staging.y);
    wave.units.push(e);
    sent++;
  }

  // злые лорды присылают машины: таран по воротам, катапульту по стене
  if (L.def.aggression >= 1.0 && L.wave >= 1) {
    const kind = target && target.kind === 'gate' ? 'ram' : 'catapult';
    const spot = musterSpot(map, L.keep);
    if (spot) {
      const eng = spawnEnemyEngine(map, kind, spot.x, spot.y);
      if (eng) {
        eng.wave = wave;
        if (staging) requestPath(eng, staging.x, staging.y);
        wave.engines.push(eng);
      }
    }
  }

  L.waves = L.waves || [];
  L.waves.push(wave);
  L.wave++;
  events.emit('wave', { number: L.wave, size: sent, target });
  return sent;
}

/**
 * Сбор и штурм. Как только большинство дошло до точки сбора (или истекло
 * терпение), волна переходит в атаку: рукопашники к цели, стрелки чуть позади,
 * машины наводятся на стену или ворота.
 */
function updateWaves(map, dt) {
  const L = state.lord;
  if (!L || !L.waves) return;

  for (let i = L.waves.length - 1; i >= 0; i--) {
    const w = L.waves[i];
    w.units = w.units.filter((e) => state.entities.includes(e));
    w.engines = w.engines.filter((e) => state.entities.includes(e));
    if (!w.units.length && !w.engines.length) { L.waves.splice(i, 1); continue; }

    if (w.stage !== 'muster') continue;

    w.timer += dt;
    const ready = w.units.filter(
      (e) => !e.pathPending && (!e.path || e.pathStep >= e.path.length)).length;

    // ждём большинство, но не дольше сорока секунд
    if (ready < w.units.length * 0.7 && w.timer < 40) continue;

    w.stage = 'assault';
    const t = w.target || pickTarget(map);
    if (!t) continue;

    for (const e of w.units) {
      e.order = 'march';
      e.stuck = 0;
      // стрелки держатся на пару клеток позади
      const back = e.range > 0 ? 2 : 0;
      requestPath(e, t.x, Math.max(0, t.y + back));
    }
    for (const eng of w.engines) {
      aimAt(eng, t.x, t.y);
      eng.order = 'bombard';
    }
    events.emit('assault', { target: t, size: w.units.length });
  }
}

/**
 * Раз в тик: отсчёт до волны и присмотр за застрявшими.
 * Если враг упёрся в стену и не может дойти — ломает её.
 */
export function updateLord(map, dt) {
  const L = state.lord;
  if (!L || !L.alive) return;

  // донжон лорда пал — волны прекращаются
  if (!state.buildings.includes(L.keep)) {
    L.alive = false;
    events.emit('lordDefeated', { lord: L.def });
    return;
  }

  L.timer -= dt;
  if (L.timer <= 0) {
    L.timer = L.def.interval;
    sendWave(map);
  }

  updateWaves(map, dt);

  // застрявшие атакуют преграду
  for (const e of state.entities) {
    if (e.type !== 'enemy' || e.order !== 'march') continue;
    if (e.pathPending || (e.path && e.pathStep < e.path.length)) continue;

    e.stuck = (e.stuck || 0) + dt;
    if (e.stuck < 1.5) continue;
    e.stuck = 0;

    // ищем стену рядом и бьём её
    const bx = Math.round(e.x), by = Math.round(e.y);
    let hit = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (map.inBounds(bx + dx, by + dy) && map.walls[map.idx(bx + dx, by + dy)]) {
        hit = { x: bx + dx, y: by + dy };
        break;
      }
    }
    if (hit) {
      e.breach = hit;
    } else {
      // не упёрся, просто потерял цель — идём к донжону заново
      const target = state.buildings.find((b) => b.def.id === 'keep' && b.side !== 'enemy');
      if (target) requestPath(e, target.x + 2, target.y + target.h);
    }
  }
}
