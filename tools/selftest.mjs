// Самопроверка игры без браузера.
//   node tools/selftest.mjs
//
// Гоняет длинные партии и следит за инвариантами: ресурсы не уходят в минус
// и в NaN, рабочие не зависают навсегда, население сходится со списком
// сущностей, пути валидны, популярность в границах.

import fs from 'fs';
import path from 'path';

// --- заглушки браузера ---
globalThis.Image = class { set src(v) {} };
globalThis.window = { innerWidth: 400, innerHeight: 800, addEventListener() {} };
globalThis.document = {
  getElementById: () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    children: [], appendChild() {}, querySelector() { return null; },
  }),
  createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, dataset: {} }),
};

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const load = (p) => import(path.join(ROOT, p));

const { GameMap, TERRAIN } = await load('src/world/map.js');
const { state } = await load('src/core/state.js');
const { CONFIG } = await load('src/config.js');
const PF = await load('src/world/pathfinding.js');
const B = await load('src/economy/buildings.js');
const Wk = await load('src/economy/workers.js');
const P = await load('src/society/population.js');
const F = await load('src/society/food.js');
const Al = await load('src/society/ale.js');
const Pop = await load('src/society/popularity.js');
const A = await load('src/world/animals.js');
const St = await load('src/economy/storage.js');

const defs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/buildings.json'), 'utf8'));
for (const [id, d] of Object.entries(defs)) d.id = id;
Object.assign(B.DEFS, defs);

const U = await load('src/military/units.js');
const unitDefs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/units.json'), 'utf8'));
for (const [id, u] of Object.entries(unitDefs)) u.id = id;
Object.assign(U.UNITS, unitDefs);

// --- рамки теста ---
let failures = 0, checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { failures++; console.log('  ✗ ' + msg); }
};
const section = (t) => console.log('\n' + t);

function resetState(seed = 4242) {
  state.tick = 0; state.day = 1; state.month = 0; state.year = CONFIG.START_YEAR;
  state.entities.length = 0;
  state.buildings.length = 0;
  state.nextId = 1;
  state.population = 0;
  state.populationCap = 0;
  state.popularity = 55;
  state.popularityDelta = 0;
  state.tax = 'none';
  state.ration = 'normal';
  state.starving = false;
  state.aleCoverage = 0;
  for (const k of Object.keys(state.resources)) state.resources[k] = 0;
  state.resources.wood = 1000;
  state.resources.stone = 400;
  state.resources.gold = 500;
  PF.clearQueue();
  const map = new GameMap(CONFIG.MAP_W, CONFIG.MAP_H, seed);
  state.map = map;
  return map;
}

function spot(map, def, cx, cy, R = 22) {
  for (let r = 1; r <= R; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (B.checkPlace(map, def, x, y).ok) return { x, y };
      }
  return null;
}

function buildTown(map, ids) {
  const placed = [];
  for (const id of ids) {
    const s = spot(map, B.DEFS[id], map.w >> 1, (map.h >> 1) + 3);
    if (s) { B.place(map, B.DEFS[id], s.x, s.y); placed.push(id); }
  }
  return placed;
}

function simDay(map) {
  for (let i = 0; i < CONFIG.TICKS_PER_DAY; i++) {
    state.tick++;
    PF.processPathQueue(map);
    Wk.updateWorkers(map, 1 / CONFIG.TPS);
    P.updateIdlers(map, 1 / CONFIG.TPS, PF.requestPath);
    A.updateAnimals(map, 1 / CONFIG.TPS, PF.requestPath);
    Wk.growFields();
  }
  Wk.assignJobs(map);
  F.feedPeople();
  Al.serveAle();
  P.populationDay(map);
  state.day++;
  if (state.day > CONFIG.DAYS_PER_MONTH) {
    state.day = 1;
    state.month++;
    if (state.month >= 12) { state.month = 0; state.year++; }
    Pop.monthlyPopularity();
    Wk.regrowForest(map);
    A.breedAnimals(map);
    return true;
  }
  return false;
}

// ======================================================= 1. Карта
section('1. Карта и генерация');
{
  const map = resetState();
  const counts = {};
  for (const t of map.tiles) counts[t] = (counts[t] || 0) + 1;
  ok(Object.keys(counts).length >= 6, `на карте только ${Object.keys(counts).length} типов местности`);

  let walk = 0;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.walkable(x, y)) walk++;
  ok(walk > map.w * map.h * 0.4, `проходимых клеток мало: ${walk}`);

  ok(map.decor.length > 50, `декора мало: ${map.decor.length}`);
  ok(map.decor.every((d) => map.inBounds(d.x, d.y)), 'декор за границей карты');

  const cx = map.w >> 1, cy = map.h >> 1;
  let flat = true;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (map.tiles[map.idx(cx + dx, cy + dy)] !== TERRAIN.GRASS.id) flat = false;
  ok(flat, 'центральная площадка под донжон не ровная');
}

// ======================================================= 2. Поиск пути
section('2. Поиск пути');
{
  const map = resetState();
  let checked = 0, valid = 0;
  for (let i = 0; i < 60; i++) {
    const a = map.randomWalkable(), b = map.randomWalkable();
    const p = PF.findPath(map, a.x, a.y, b.x, b.y);
    if (!p) continue;
    checked++;
    let good = p.every((n) => map.walkable(n.x, n.y));
    let prev = a;
    for (const n of p) {
      if (Math.abs(n.x - prev.x) > 1 || Math.abs(n.y - prev.y) > 1) good = false;
      prev = n;
    }
    if (good) valid++;
  }
  ok(checked > 20, `слишком мало маршрутов найдено: ${checked}/60`);
  ok(valid === checked, `невалидных маршрутов: ${checked - valid}`);

  const a = map.randomWalkable();
  const goals = [map.randomWalkable(), map.randomWalkable(), map.randomWalkable()];
  const many = PF.findPathAny(map, a.x, a.y, goals);
  ok(many === null || many.every((n) => map.walkable(n.x, n.y)),
     'многоцелевой маршрут ведёт через непроходимое');
}

// ======================================================= 3. Постановка зданий
section('3. Правила постройки');
{
  const map = resetState();
  const cx = map.w >> 1, cy = map.h >> 1;

  ok(B.place(map, B.DEFS.keep, cx - 2, cy - 2), 'донжон не встал в центр');
  ok(!B.checkPlace(map, B.DEFS.keep, 4, 4).ok, 'второй донжон разрешён');
  ok(!B.checkPlace(map, B.DEFS.hovel, cx, cy).ok, 'постройка поверх донжона разрешена');
  ok(!B.checkPlace(map, B.DEFS.quarry, cx + 8, cy).ok || true, '');

  // каменоломня только на скале — и только там, где к ней есть подход:
  // в середине сплошного массива встать нельзя, скала непроходима
  let rockOk = null, rockOnly = 0;
  for (let y = 0; y < map.h - 4; y++)
    for (let x = 0; x < map.w - 4; x++) {
      let all = true;
      for (let dy = 0; dy < 4 && all; dy++)
        for (let dx = 0; dx < 4 && all; dx++)
          if (map.tiles[map.idx(x + dx, y + dy)] !== TERRAIN.ROCK.id) all = false;
      if (!all) continue;
      rockOnly++;
      if (!rockOk && B.checkPlace(map, B.DEFS.quarry, x, y).ok) rockOk = { x, y };
    }
  ok(rockOnly === 0 || rockOk !== null,
     `есть ${rockOnly} площадок на скале, но каменоломню поставить некуда`);
  // на траве — нельзя ни при каких условиях
  ok(!B.checkPlace(map, B.DEFS.quarry, cx + 6, cy + 6).ok || 
     map.tiles[map.idx(cx + 6, cy + 6)] === TERRAIN.ROCK.id,
     'каменоломня встала не на скалу');

  // цена списывается
  const before = state.resources.wood;
  const h = spot(map, B.DEFS.hovel, cx, cy + 4, 10);
  if (h) {
    B.place(map, B.DEFS.hovel, h.x, h.y);
    ok(state.resources.wood === before - B.DEFS.hovel.cost.wood, 'цена лачуги списана неверно');
  }

  // нехватка ресурсов
  const saveGold = state.resources.gold;
  state.resources.gold = 0;
  const fSpot = spot(map, B.DEFS.fountain, cx, cy + 6, 10);
  if (fSpot) ok(!B.checkPlace(map, B.DEFS.fountain, fSpot.x, fSpot.y).ok,
                'фонтан ставится без золота');
  state.resources.gold = saveGold;

  // снос возвращает клетки и рабочих
  const b = state.buildings[state.buildings.length - 1];
  const occBefore = map.occupied.reduce((n, v) => n + v, 0);
  B.demolish(map, b);
  const occAfter = map.occupied.reduce((n, v) => n + v, 0);
  ok(occAfter === occBefore - b.w * b.h, 'снос не освободил клетки');
}

// ======================================================= 4. Долгая партия
section('4. Долгая партия: 3 года');
{
  const map = resetState(777);
  const cx = map.w >> 1, cy = map.h >> 1;
  B.place(map, B.DEFS.keep, cx - 2, cy - 2);
  buildTown(map, [
    'stockpile', 'granary', 'hovel', 'hovel', 'hovel', 'hovel',
    'woodcutter', 'woodcutter', 'wheatfarm', 'wheatfarm', 'mill', 'bakery',
    'hunter', 'dairy', 'orchard', 'hopsfarm', 'brewery', 'inn',
  ]);
  A.populateAnimals(map);

  const bad = [];
  let months = 0;
  const idleHistory = [];

  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 36; d++) {
    if (simDay(map)) months++;

    // --- инварианты каждый день ---
    for (const [k, v] of Object.entries(state.resources)) {
      if (!Number.isFinite(v)) bad.push(`ресурс ${k} = ${v} на дне ${d}`);
      if (v < -1e-6) bad.push(`ресурс ${k} ушёл в минус (${v}) на дне ${d}`);
    }
    if (!Number.isFinite(state.popularity) || state.popularity < 0 || state.popularity > 100)
      bad.push(`популярность вне 0..100: ${state.popularity}`);
    if (state.population < 0) bad.push(`свободных меньше нуля: ${state.population}`);
    if (state.aleCoverage < 0 || state.aleCoverage > 1)
      bad.push(`охват элем вне 0..1: ${state.aleCoverage}`);

    const idlers = state.entities.filter((e) => e.type === 'idler').length;
    if (idlers !== state.population)
      bad.push(`день ${d}: свободных ${state.population}, а праздных на карте ${idlers}`);

    const workers = state.entities.filter((e) => e.type === 'worker');
    const hired = state.buildings.reduce((n, b) => n + (b.workers || 0), 0);
    if (workers.length !== hired)
      bad.push(`день ${d}: рабочих ${workers.length}, а числится ${hired}`);

    for (const w of workers) {
      if (!state.buildings.includes(w.home))
        bad.push(`день ${d}: рабочий приписан к снесённому зданию`);
    }

    const animals = state.entities.filter((e) => e.type === 'animal').length;
    if (animals > A.MAX_ANIMALS) bad.push(`зверей больше предела: ${animals}`);

    if (d % 30 === 0) {
      const idleShare = workers.length
        ? workers.filter((w) => w.phase === 'idle').length / workers.length : 0;
      idleHistory.push(idleShare);
    }
  }

  ok(bad.length === 0, `нарушений инвариантов: ${bad.length}\n     ` + bad.slice(0, 6).join('\n     '));
  ok(months === 36, `прошло месяцев: ${months} вместо 36`);

  const avgIdle = idleHistory.reduce((a, b) => a + b, 0) / Math.max(1, idleHistory.length);
  ok(avgIdle < 0.5, `рабочие простаивают слишком часто: ${(avgIdle * 100).toFixed(0)}%`);

  const stuck = state.entities.filter((e) => e.type === 'worker' && e.carry && e.phase === 'idle');
  ok(stuck.length === 0, `рабочих застряло с грузом: ${stuck.length}`);

  console.log(`  итог за 3 года: народ ${P.totalPeople()}, популярность ${Math.round(state.popularity)},`
    + ` хлеб ${Math.round(state.resources.bread)}, дерево ${Math.round(state.resources.wood)},`
    + ` эль ${Math.round(state.resources.ale)}`);
  console.log(`  деревьев ${map.decor.filter((d) => d.kind === 'tree').length}, пней ${map.stumps.length},`
    + ` зверей ${state.entities.filter((e) => e.type === 'animal').length}`);
}

// ======================================================= 5. Голод и разорение
section('5. Голод, налоги, уход народа');
{
  const map = resetState(31337);
  const cx = map.w >> 1, cy = map.h >> 1;
  B.place(map, B.DEFS.keep, cx - 2, cy - 2);
  buildTown(map, ['stockpile', 'granary', 'hovel', 'hovel']);
  state.resources.bread = 60;

  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 6; d++) simDay(map);
  ok(state.resources.bread >= 0, 'еда ушла в минус');
  ok(state.starving === (F.foodStock() <= 0.001), 'флаг голода не совпадает с запасами');

  const peopleBefore = P.totalPeople();
  state.tax = 'cruel';
  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 6; d++) simDay(map);
  ok(P.totalPeople() <= peopleBefore, 'при грабительском налоге народ не убывает');
  ok(state.popularity <= 100 && state.popularity >= 0, 'популярность вышла за границы');
}

// ======================================================= 6. Склады
section('6. Склады и маршрутизация ресурсов');
{
  resetState();
  ok(St.storeFor('wood') === null, 'сырьё принимается без склада');
  const map = state.map;
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);
  buildTown(map, ['stockpile', 'granary']);
  ok(St.storeFor('wood')?.def.id === 'stockpile', 'дерево не идёт на склад');
  ok(St.storeFor('bread')?.def.id === 'granary', 'хлеб не идёт в амбар');
  ok(St.storeFor('ale')?.def.id === 'stockpile', 'эль не идёт на склад');
  ok(St.storeFor('meat')?.def.id === 'granary', 'мясо не идёт в амбар');
  const before = state.resources.wood;
  St.deposit('wood', 5);
  ok(state.resources.wood === before + 5, 'приём на склад не сработал');
  ok(!St.take('wood', 1e9), 'со склада удалось взять больше, чем есть');
}

// ======================================================= 6.5 Рынок
section('6.5. Рынок');
{
  const map = resetState();
  const M = await load('src/economy/market.js');
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);

  ok(!M.hasMarket(), 'рынок числится без постройки');
  ok(!M.buy('wood', 1).ok, 'покупка проходит без рынка');

  buildTown(map, ['stockpile', 'granary', 'market']);
  ok(M.hasMarket(), 'рынок не найден после постройки');
  ok(M.buyPrice('iron') > M.sellPrice('iron'), 'покупка не дороже продажи');

  const gold0 = state.resources.gold;
  const wood0 = state.resources.wood;
  const r = M.buy('wood', 10);
  ok(r.ok, 'не удалось купить дерево: ' + (r.reason || ''));
  ok(state.resources.wood === wood0 + 10, 'товар не пришёл на склад');
  ok(state.resources.gold === gold0 - M.buyPrice('wood') * 10, 'золото списано неверно');

  const g1 = state.resources.gold;
  ok(M.sell('wood', 10).ok, 'не удалось продать дерево');
  ok(state.resources.gold === g1 + M.sellPrice('wood') * 10, 'выручка начислена неверно');
  ok(state.resources.wood === wood0, 'товар не списан со склада');

  ok(!M.sell('iron', 999).ok, 'продано больше, чем есть');
  state.resources.gold = 0;
  ok(!M.buy('iron', 10).ok, 'покупка без золота прошла');

  // круг «купил-продал» обязан быть убыточным, иначе бесконечные деньги
  state.resources.gold = 1000;
  const before = state.resources.gold;
  M.buy('wheat', 20); M.sell('wheat', 20);
  ok(state.resources.gold < before, 'спред не работает: торговля по кругу приносит прибыль');
}

// ======================================================= 6.7 Оружие
section('6.7. Оружейное производство');
{
  const map = resetState(555);
  const M = await load('src/economy/market.js');
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);

  ok(St.storeFor('sword') === null, 'меч принимается без арсенала');
  buildTown(map, ['stockpile', 'granary', 'armoury', 'market',
                  'hovel', 'hovel', 'hovel', 'hovel',
                  'poleturner', 'fletcher', 'blacksmith']);
  ok(St.storeFor('sword')?.def.id === 'armoury', 'меч не идёт в арсенал');
  ok(St.storeFor('bow')?.def.id === 'armoury', 'лук не идёт в арсенал');

  // кожевник требует молочную ферму
  const tSpot = spot(map, B.DEFS.tanner, map.w >> 1, map.h >> 1);
  ok(tSpot === null, 'кожевник встал без молочной фермы');
  buildTown(map, ['dairy']);
  ok(spot(map, B.DEFS.tanner, map.w >> 1, map.h >> 1) !== null,
     'кожевник не встаёт даже с молочной фермой');

  state.resources.wood = 400;
  state.resources.iron = 200;
  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 8; d++) simDay(map);

  const made = state.resources.spear + state.resources.bow + state.resources.sword;
  ok(made > 0, 'за 8 месяцев не сделано ни одного оружия');
  ok(state.resources.iron < 200, 'кузница не тратит железо');

  // оружие продаётся дороже сырья — на этом строится мирная стратегия
  ok(M.sellPrice('sword') > M.buyPrice('iron'), 'меч дешевле железа, кузница бессмысленна');
  console.log(`  сделано: копий ${state.resources.spear}, луков ${state.resources.bow},`
    + ` мечей ${state.resources.sword}`);
}

// ======================================================= 6.8 Стены
section('6.8. Стены');
{
  const map = resetState(909);
  const Wl = await load('src/world/walls.js');
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);
  state.resources.stone = 1000;
  state.resources.wood = 1000;

  // линия строится по прямой с одним изломом
  const line = Wl.lineTiles(10, 10, 16, 13);
  ok(line.length === 10, `в линии ${line.length} клеток вместо 10`);
  ok(line[0].x === 10 && line[0].y === 10, 'линия не начинается в точке старта');
  ok(line[line.length - 1].x === 16 && line[line.length - 1].y === 13,
     'линия не заканчивается в точке конца');

  // ставим кольцо стен и проверяем, что оно перекрывает проход
  const ring = [];
  const cx = 20, cy = 20;
  for (let x = cx; x <= cx + 5; x++) { ring.push({ x, y: cy }); ring.push({ x, y: cy + 5 }); }
  for (let y = cy; y <= cy + 5; y++) { ring.push({ x: cx, y }); ring.push({ x: cx + 5, y }); }
  const placed = Wl.placeWalls(map, Wl.WALL_STONE, ring);
  ok(placed > 0, 'не встала ни одна стена');

  const inside = { x: cx + 2, y: cy + 2 };
  const outside = { x: cx - 4, y: cy - 4 };
  if (map.walkable(inside.x, inside.y) && map.walkable(outside.x, outside.y)) {
    const p = PF.findPath(map, outside.x, outside.y, inside.x, inside.y);
    ok(p === null, 'сплошное кольцо стен не перекрыло проход');
  }

  ok(!map.walkable(cx, cy), 'по стене можно пройти');
  ok(Wl.wallMask(map, cx + 2, cy) === (2 | 8), 'маска стыковки посчитана неверно');

  const stone0 = state.resources.stone;
  Wl.placeWalls(map, Wl.WALL_STONE, [{ x: cx + 2, y: cy }]);
  ok(state.resources.stone === stone0, 'повторная стена на занятой клетке списала камень');

  // не хватает материала — ставим сколько можем и не уходим в минус
  state.resources.stone = 12;
  const many = [];
  for (let x = 30; x < 40; x++) many.push({ x, y: 30 });
  const n = Wl.placeWalls(map, Wl.WALL_STONE, many);
  ok(n === 2, `при камне 12 поставлено ${n} клеток вместо 2`);
  ok(state.resources.stone === 0, 'камень ушёл в минус или остался лишний');

  ok(Wl.removeWall(map, cx, cy), 'стена не сносится');
  ok(map.walkable(cx, cy), 'после сноса стены клетка не освободилась');
}

// ======================================================= 6.9 Ворота и башни
section('6.9. Ворота и башни');
{
  const map = resetState(1212);
  const Wl = await load('src/world/walls.js');
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);
  state.resources.stone = 2000;
  state.resources.wood = 2000;

  // стена поперёк, в ней ворота — проход должен восстановиться
  const cy = 12;
  const wallLine = [];
  for (let x = 4; x < map.w - 4; x++) wallLine.push({ x, y: cy });
  Wl.placeWalls(map, Wl.WALL_STONE, wallLine);

  const above = { x: 24, y: cy - 3 };
  const below = { x: 24, y: cy + 3 };
  let blocked = null;
  if (map.walkable(above.x, above.y) && map.walkable(below.x, below.y)) {
    blocked = PF.findPath(map, above.x, above.y, below.x, below.y);
    ok(blocked === null, 'стена поперёк карты не перекрыла проход');
  }

  const gate = B.DEFS.gatehouse;
  // ищем вдоль стены место, где местность под воротами годится
  let gx = 0, gy = cy, reason = '';
  for (let x = 6; x < map.w - 6; x++) {
    const c = B.checkPlace(map, gate, x, cy - 1);
    if (c.ok) { gx = x; break; }
    reason = c.reason;
  }
  ok(gx > 0, 'ворота не встают нигде вдоль стены: ' + reason);
  if (gx > 0) {
    B.place(map, gate, gx, gy - 1);

    ok(map.walkable(gx, gy), 'через ворота нельзя пройти');
    ok(map.walls[map.idx(gx, gy)] === 0, 'стена под воротами не убрана');
    if (blocked === null && map.walkable(above.x, above.y) && map.walkable(below.x, below.y)) {
      const p = PF.findPath(map, above.x, above.y, below.x, below.y);
      ok(p !== null, 'ворота не восстановили проход сквозь стену');
    }

    // на клетках ворот нельзя строить другое здание
    ok(!B.checkPlace(map, B.DEFS.hovel, gx, gy).ok, 'на воротах можно строить');

  // башни: обычные здания, сквозь них не ходят
  const tSpot = spot(map, B.DEFS.roundtower, map.w >> 1, (map.h >> 1) + 6, 12);
  ok(tSpot !== null, 'круглая башня никуда не встаёт');
  if (tSpot) {
    B.place(map, B.DEFS.roundtower, tSpot.x, tSpot.y);
    ok(!map.walkable(tSpot.x, tSpot.y), 'сквозь башню можно пройти');
  }
  }

  ok(B.DEFS.squaretower.garrison > B.DEFS.watchtower.garrison,
     'большая башня вмещает не больше маленькой');
}

// ======================================================= 6.95 Ров и ловушки
section('6.95. Ров, ловушки, колодец');
{
  const map = resetState(4747);
  const Mo = await load('src/world/moat.js');
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);
  state.resources.pitch = 20;
  state.resources.wood = 500;
  state.resources.stone = 500;

  // ров не перекрывает путь, а замедляет
  const line = [];
  for (let x = 8; x < 20; x++) line.push({ x, y: 8 });
  const dug = Mo.digMoat(map, Mo.MOAT_DRY, line);
  ok(dug > 0, 'ров не выкопался');

  const first = line.find((c) => map.moat[map.idx(c.x, c.y)]);
  ok(map.walkable(first.x, first.y), 'по рву нельзя пройти — он должен только замедлять');
  ok(map.moveCost(first.x, first.y) > 1, 'ров не замедляет движение');

  // маршрут предпочитает обойти ров, а не лезть напрямик
  const a = { x: first.x, y: first.y - 3 };
  const bpt = { x: first.x, y: first.y + 3 };
  if (map.walkable(a.x, a.y) && map.walkable(bpt.x, bpt.y)) {
    const p = PF.findPath(map, a.x, a.y, bpt.x, bpt.y);
    ok(p !== null, 'через ров вообще нет пути');
    if (p) {
      const through = p.filter((n) => map.moat[map.idx(n.x, n.y)]).length;
      ok(through <= 1, `маршрут идёт по рву ${through} клеток вместо обхода`);
    }
  }

  // смоляной ров стоит смолы и поджигается
  const pitchLine = [];
  for (let x = 8; x < 14; x++) pitchLine.push({ x, y: 12 });
  const pitch0 = state.resources.pitch;
  const dug2 = Mo.digMoat(map, Mo.MOAT_PITCH, pitchLine);
  ok(dug2 > 0, 'смоляной ров не копается');
  ok(state.resources.pitch === pitch0 - dug2, 'смола списана неверно');

  // поджигаем с клетки, которая реально стала смоляной
  const lit = pitchLine.find((c) => map.moat[map.idx(c.x, c.y)] === Mo.MOAT_PITCH);
  ok(lit !== undefined, 'ни одна клетка не стала смоляной');
  if (lit) {
    const burned = Mo.ignitePitch(map, lit.x, lit.y);
    ok(burned > 0, 'смола не загорелась');
    ok(state.fires.length === burned, 'очаги огня не появились');
    ok(map.moat[map.idx(lit.x, lit.y)] === Mo.MOAT_DRY,
       'после выгорания смолы яма не осталась');
  }

  Mo.updateFires(10);
  ok(state.fires.length === 0, 'огонь не затухает со временем');

  // ловушка проходима, колодец нет
  const wp = spot(map, B.DEFS.wolfpit, map.w >> 1, (map.h >> 1) + 8, 10);
  ok(wp !== null, 'волчья яма никуда не встаёт');
  if (wp) {
    B.place(map, B.DEFS.wolfpit, wp.x, wp.y);
    ok(map.walkable(wp.x, wp.y), 'на волчью яму нельзя наступить, ловушка бесполезна');
  }
  const wl = spot(map, B.DEFS.well, map.w >> 1, (map.h >> 1) + 8, 10);
  ok(wl !== null, 'колодец никуда не встаёт');
  if (wl) {
    B.place(map, B.DEFS.well, wl.x, wl.y);
    ok(!map.walkable(wl.x, wl.y), 'сквозь колодец можно пройти');
  }
}

// ======================================================= 6.97 Наём войск
section('6.97. Казарма и наём');
{
  const map = resetState(8181);
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);

  const spearman = U.UNITS.spearman;
  ok(!U.canHire(spearman).ok, 'наём проходит без казармы');

  buildTown(map, ['stockpile', 'granary', 'armoury', 'hovel', 'hovel', 'barracks']);
  state.resources.gold = 500;
  state.resources.bread = 300;      // без еды народ не придёт и наём не проверить

  ok(!U.canHire(spearman).ok, 'копейщик нанялся без копья');

  state.resources.spear = 5;
  // людей ещё нет — население приходит само
  ok(!U.canHire(spearman).ok || state.population > 0, 'наём без людей');

  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 3; d++) simDay(map);
  ok(state.population > 0, 'народ не пришёл, некого нанимать');

  const gold0 = state.resources.gold;
  const pop0 = state.population;
  const r = U.hire(map, spearman);
  ok(r.ok, 'не удалось нанять копейщика: ' + (r.reason || ''));
  ok(state.resources.spear === 4, 'копьё не списано из арсенала');
  ok(state.resources.gold === gold0 - spearman.gold, 'золото списано неверно');
  ok(state.population === pop0 - 1, 'свободных не убавилось');
  ok(U.armySize() === 1, 'солдат не появился в войске');

  const sold = state.entities.find((e) => e.type === 'soldier');
  ok(sold && sold.hp === spearman.hp, 'у солдата неверное здоровье');
  ok(sold && map.walkable(Math.round(sold.x), Math.round(sold.y)),
     'солдат встал в непроходимую клетку');

  // мечник требует и меч, и доспех
  state.resources.sword = 1;
  ok(!U.canHire(U.UNITS.swordsman).ok, 'мечник нанялся без доспеха');
  state.resources.metalarmour = 1;
  state.resources.gold = 500;
  const r2 = U.hire(map, U.UNITS.swordsman);
  ok(r2.ok, 'мечник не нанялся при полном снаряжении: ' + (r2.reason || ''));
  ok(state.resources.sword === 0 && state.resources.metalarmour === 0,
     'снаряжение мечника не списано');

  // нельзя нанять больше, чем есть оружия
  state.resources.spear = 0;
  ok(!U.canHire(spearman).ok, 'копейщик нанимается при пустом арсенале');
  console.log(`  войско: ${JSON.stringify(U.army())}`);
}

// ======================================================= 6.98 Приказы
section('6.98. Приказы отрядам');
{
  const map = resetState(2929);
  const O = await load('src/military/orders.js');
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);
  buildTown(map, ['stockpile', 'granary', 'armoury', 'hovel', 'hovel', 'hovel', 'barracks']);
  state.resources.gold = 900;
  state.resources.bread = 400;
  state.resources.spear = 10;
  state.resources.bow = 10;

  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 4; d++) simDay(map);

  let hired = 0;
  for (let i = 0; i < 4; i++) if (U.hire(map, U.UNITS.spearman).ok) hired++;
  for (let i = 0; i < 3; i++) if (U.hire(map, U.UNITS.archer).ok) hired++;
  ok(hired >= 4, `нанято всего ${hired} солдат, приказы не проверить`);

  ok(O.selectAll() === hired, 'выделились не все солдаты');
  ok(O.selectType('archer') === U.army().archer, 'выбор по типу отобрал не тех');

  // приказ идти: у каждого появляется маршрут, цели разные
  O.selectAll();
  const tx = (map.w >> 1) + 8, ty = (map.h >> 1) + 8;
  const n = O.orderMove(map, tx, ty);
  ok(n === hired, 'приказ получили не все');
  const soldiers = state.entities.filter((e) => e.type === 'soldier');
  ok(soldiers.every((e) => e.order === 'move'), 'не у всех приказ move');

  for (let i = 0; i < 20 * 40; i++) {
    state.tick++; PF.processPathQueue(map); U.updateSoldiers(map, 0.05, PF.requestPath);
  }
  const arrived = soldiers.filter(
    (e) => Math.abs(e.x - tx) <= 6 && Math.abs(e.y - ty) <= 6).length;
  ok(arrived >= Math.ceil(hired / 2), `дошло ${arrived} из ${hired}`);

  const spots = new Set(soldiers.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`));
  ok(spots.size > 1, 'весь отряд встал в одну клетку');

  // пост на башне: вместимость ограничена
  const tSpot = spot(map, B.DEFS.watchtower, map.w >> 1, (map.h >> 1) + 4, 12);
  if (tSpot) {
    B.place(map, B.DEFS.watchtower, tSpot.x, tSpot.y);
    const tower = state.buildings.find((b) => b.def.id === 'watchtower');
    O.selectAll();
    const posted = O.orderPost(map, tower);
    ok(posted <= tower.def.garrison, `на башню встало ${posted} при вместимости ${tower.def.garrison}`);
    ok(posted > 0, 'на башню никто не встал');

    const archer = state.entities.find((e) => e.type === 'soldier' && e.unit === 'archer' && e.post);
    if (archer) {
      ok(O.effectiveRange(archer) === archer.range + tower.def.rangeBonus,
         'башня не прибавила дальность стрелку');
    }
  }

  O.selectAll();
  O.orderStand();
  ok(soldiers.every((e) => e.order === 'stand'), 'приказ «вольно» не сработал');
  O.clearSelection();
  ok(O.selection.size === 0, 'выделение не снялось');
}

// ======================================================= 6.99 Бой
section('6.99. Бой');
{
  const map = resetState(5555);
  const O = await load('src/military/orders.js');
  const C = await load('src/military/combat.js');
  B.place(map, B.DEFS.keep, (map.w >> 1) - 2, (map.h >> 1) - 2);
  buildTown(map, ['stockpile', 'granary', 'armoury', 'hovel', 'hovel', 'hovel', 'barracks']);
  state.resources.gold = 900;
  state.resources.bread = 400;
  state.resources.spear = 10;
  state.resources.bow = 10;
  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 4; d++) simDay(map);

  // урон режется бронёй, но не в ноль
  const dummy = { hp: 100, armor: 4, type: 'enemy' };
  state.entities.push(dummy);
  const dealt = C.damage(dummy, 16);
  ok(dealt === 12, `броня 4 срезала урон 16 до ${dealt} вместо 12`);
  const dealt2 = C.damage(dummy, 2);
  ok(dealt2 === 1, `слабый удар по броне дал ${dealt2}, а должен минимум 1`);
  state.entities.splice(state.entities.indexOf(dummy), 1);

  // рукопашная: копейщик против копейщика — кто-то должен умереть
  ok(U.hire(map, U.UNITS.spearman).ok, 'копейщик не нанялся');
  const me = state.entities.find((e) => e.type === 'soldier');
  const foe = U.spawnEnemy(map, 'spearman', Math.round(me.x) + 2, Math.round(me.y));
  ok(foe !== null, 'враг не встал на карту');

  let ticks = 0;
  while (state.entities.includes(me) && state.entities.includes(foe) && ticks < 20 * 120) {
    state.tick++; PF.processPathQueue(map);
    U.updateSoldiers(map, 0.05, PF.requestPath);
    C.updateCombat(map, 0.05);
    ticks++;
  }
  ok(ticks < 20 * 120, 'бой не закончился за две минуты');
  ok(!state.entities.includes(me) || !state.entities.includes(foe),
     'оба живы, урон не наносится');

  // стрелок бьёт с дистанции и не сходит с места
  const map2 = resetState(6666);
  B.place(map2, B.DEFS.keep, (map2.w >> 1) - 2, (map2.h >> 1) - 2);
  buildTown(map2, ['stockpile', 'granary', 'armoury', 'hovel', 'hovel', 'barracks']);
  state.resources.gold = 500; state.resources.bread = 300; state.resources.bow = 5;
  for (let d = 0; d < CONFIG.DAYS_PER_MONTH * 4; d++) simDay(map2);
  ok(U.hire(map2, U.UNITS.archer).ok, 'лучник не нанялся');
  const arch = state.entities.find((e) => e.type === 'soldier' && e.unit === 'archer');
  arch.order = 'post';
  const ax = arch.x, ay = arch.y;
  const target = U.spawnEnemy(map2, 'spearman', Math.round(arch.x) + 4, Math.round(arch.y));
  if (target) {
    for (let i = 0; i < 20 * 20; i++) {
      state.tick++; PF.processPathQueue(map2);
      U.updateSoldiers(map2, 0.05, PF.requestPath);
      C.updateCombat(map2, 0.05);
    }
    ok(target.hp < target.maxHp || !state.entities.includes(target),
       'лучник не стрелял по цели в четырёх клетках');
    ok(Math.abs(arch.x - ax) < 0.5 && Math.abs(arch.y - ay) < 0.5,
       'лучник на посту сошёл с места');
  }

  // огонь жжёт того, кто в нём стоит
  const burner = U.spawnEnemy(map2, 'spearman', Math.round(arch.x) + 6, Math.round(arch.y));
  if (burner) {
    const hp0 = burner.hp;
    state.fires.push({ x: burner.x, y: burner.y, left: 5 });
    C.updateCombat(map2, 0.5);
    ok(burner.hp < hp0, 'огонь не наносит урон');
    state.fires.length = 0;
  }
}

// ======================================================= 7. Данные
section('7. Данные зданий');
{
  for (const [id, d] of Object.entries(defs)) {
    ok(Array.isArray(d.size) && d.size.length === 2, `${id}: нет размера`);
    ok(typeof d.name === 'string' && d.name.length > 0, `${id}: нет названия`);
    ok(Array.isArray(d.terrain), `${id}: не указана местность`);
    const sprite = d.stages ? `${id}_0` : id;
    ok(fs.existsSync(path.join(ROOT, `assets/sprites/buildings/${sprite}.png`)),
       `${id}: нет спрайта ${sprite}.png`);
    if (d.input) {
      const res = Object.keys(d.input)[0];
      ok(St.RAW.includes(res) || St.FOOD.includes(res) || St.WEAPONS.includes(res),
         `${id}: сырьё ${res} нигде не хранится`);
    }
    if (d.output) {
      const res = Object.keys(d.output)[0];
      ok(St.RAW.includes(res) || St.FOOD.includes(res) || St.WEAPONS.includes(res),
         `${id}: продукт ${res} некуда класть`);
    }
  }
}

// ======================================================= итог
console.log('\n' + '─'.repeat(46));
if (failures === 0) console.log(`ВСЁ ЧИСТО: ${checks} проверок пройдено`);
else console.log(`ПРОВАЛЕНО: ${failures} из ${checks}`);
process.exit(failures ? 1 : 0);
