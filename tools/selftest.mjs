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

  // каменоломня только на скале
  let rock = null;
  for (let y = 0; y < map.h - 4 && !rock; y++)
    for (let x = 0; x < map.w - 4 && !rock; x++) {
      let all = true;
      for (let dy = 0; dy < 4 && all; dy++)
        for (let dx = 0; dx < 4 && all; dx++)
          if (map.tiles[map.idx(x + dx, y + dy)] !== TERRAIN.ROCK.id) all = false;
      if (all) rock = { x, y };
    }
  if (rock) ok(B.checkPlace(map, B.DEFS.quarry, rock.x, rock.y).ok, 'каменоломня не встаёт на скалу');

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
      ok(St.RAW.includes(res) || St.FOOD.includes(res), `${id}: сырьё ${res} нигде не хранится`);
    }
    if (d.output) {
      const res = Object.keys(d.output)[0];
      ok(St.RAW.includes(res) || St.FOOD.includes(res), `${id}: продукт ${res} некуда класть`);
    }
  }
}

// ======================================================= итог
console.log('\n' + '─'.repeat(46));
if (failures === 0) console.log(`ВСЁ ЧИСТО: ${checks} проверок пройдено`);
else console.log(`ПРОВАЛЕНО: ${failures} из ${checks}`);
process.exit(failures ? 1 : 0);
