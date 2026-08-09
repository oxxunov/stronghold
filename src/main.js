// Точка входа. Здесь только сборка модулей — никакой игровой логики.

import { CONFIG } from './config.js';
import { state } from './core/state.js';
import { events } from './core/events.js';
import { start } from './core/loop.js';
import { GameMap } from './world/map.js';
import { Camera } from './world/camera.js';
import { processPathQueue, requestPath } from './world/pathfinding.js';
import { updateWalkers } from './world/walker.js';
import { Renderer } from './render/renderer.js';
import { initHud, updateHud } from './ui/hud.js';
import { loadBuildings, place, checkPlace, DEFS } from './economy/buildings.js';
import { initBuildPanel, tapMap, buildMode, wallDrag } from './ui/buildpanel.js';
import { initMarketPanel, refreshMarket } from './ui/marketpanel.js';
import { initBarracksPanel } from './ui/barrackspanel.js';
import { loadUnits, updateSoldiers } from './military/units.js';
import { selection, orderMove, orderPost, clearSelection } from './military/orders.js';
import { updateCombat } from './military/combat.js';
import { updateEngines, updateOil, aimAt } from './military/siege.js';
import { updateTunnellers, updatePlague, orderDig } from './military/tunnel.js';
import { loadLords, LORDS, buildEnemyCastle, updateLord } from './ai/lord.js';
import { buildingAt } from './economy/buildings.js';
import { assignJobs, updateWorkers, regrowForest, growFields } from './economy/workers.js';
import { populationDay, updateIdlers, housingCap } from './society/population.js';
import { feedPeople } from './society/food.js';
import { serveAle } from './society/ale.js';
import { populateAnimals, updateAnimals, breedAnimals } from './world/animals.js';
import { updateFires } from './world/moat.js';
import { monthlyPopularity } from './society/popularity.js';

const canvas = document.getElementById('game');

const map = new GameMap(CONFIG.MAP_W, CONFIG.MAP_H);
state.map = map;

const camera = new Camera(canvas, map);
const renderer = new Renderer(canvas, camera, map);

initHud(camera, map);
camera.center();

// в режиме стены один палец чертит линию, а не двигает карту
camera.lockDrag = () => buildMode.active && !!buildMode.wall;

canvas.addEventListener('pointerdown', (e) => {
  if (buildMode.wall) wallDrag('start', e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  if (buildMode.wall && e.buttons !== 0) wallDrag('move', e.clientX, e.clientY);
  else if (buildMode.wall && e.pressure > 0) wallDrag('move', e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', (e) => {
  if (buildMode.wall) { wallDrag('move', e.clientX, e.clientY); return; }
  if (camera.moved) return;              // это было перетаскивание карты, не тап
  if (buildMode.active) { tapMap(e.clientX, e.clientY); return; }

  // тап по карте с выделенным отрядом = приказ
  if (selection.size) {
    const t = camera.screenToTile(e.clientX, e.clientY);
    const b = buildingAt(t.x, t.y);
    if (b && b.def.garrison) orderPost(map, b);
    else orderMove(map, t.x, t.y);
    return;
  }

  // без выделения тап по стене или зданию наводит машины и тоннельщиков
  const t = camera.screenToTile(e.clientX, e.clientY);
  const isWall = map.inBounds(t.x, t.y) && map.walls[map.idx(t.x, t.y)];
  if (isWall) {
    let diggers = 0;
    for (const tu of state.entities) {
      if (tu.type !== 'tunneller') continue;
      if (orderDig(map, tu, t.x, t.y)) diggers++;
    }
    if (diggers) console.log('[подкоп] копают:', diggers);
  }
  if (isWall || buildingAt(t.x, t.y)) {
    let aimed = 0;
    for (const en of state.entities) {
      if (en.type !== 'engine') continue;
      aimAt(en, t.x, t.y);
      aimed++;
    }
    if (aimed) console.log('[осада] наведено машин:', aimed);
  }
});

// --- Загрузка данных, потом старт ---
Promise.all([loadBuildings(), loadUnits(), loadLords()]).then(() => {
  initBuildPanel(map, camera);
  initMarketPanel();
  initBarracksPanel(map);

  // донжон в центре — точка отсчёта для игрока, склад на ближайшем годном месте
  const cx = (map.w >> 1) - 2, cy = (map.h >> 1) - 2;
  place(map, DEFS.keep, cx, cy);
  const spot = findSpot(DEFS.stockpile, map.w >> 1, map.h >> 1, 12);
  if (spot) place(map, DEFS.stockpile, spot.x, spot.y);

  // две лачуги на старте — иначе селиться некуда и игра не начнётся
  for (let i = 0; i < 2; i++) {
    const h = findSpot(DEFS.hovel, map.w >> 1, (map.h >> 1) + 4, 14);
    if (h) place(map, DEFS.hovel, h.x, h.y);
  }
  state.populationCap = housingCap();
  populateAnimals(map);   // дичь на лугах у леса

  // противник: пока выбираем случайного лорда, выбор будет в меню миссий
  const ids = Object.keys(LORDS);
  const lord = LORDS[ids[(Math.random() * ids.length) | 0]];
  if (lord && buildEnemyCastle(map, lord)) {
    renderer.buildTerrain();     // лорд расчистил площадку, местность изменилась
    console.log('[лорд]', lord.name, '—', lord.desc);
  }
});

/** Ближайшее к точке место, куда здание влезает: обходим кольцами наружу */
function findSpot(def, cx, cy, maxR) {
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (checkPlace(map, def, x, y).ok) return { x, y };
      }
    }
  }
  return null;
}

/** Победа и поражение: чей донжон пал, тот и проиграл */
function checkOutcome() {
  if (state.outcome) return;
  const mine = state.buildings.some((b) => b.def.id === 'keep' && b.side !== 'enemy');
  const theirs = state.buildings.some((b) => b.def.id === 'keep' && b.side === 'enemy');
  if (!mine) { state.outcome = 'lose'; events.emit('outcome', { result: 'lose' }); }
  else if (!theirs && state.lord) { state.outcome = 'win'; events.emit('outcome', { result: 'win' }); }
}

let jobTimer = 0;

function update(dt) {
  processPathQueue(map);
  updateWalkers(map, dt);
  updateWorkers(map, dt);
  updateIdlers(map, dt, requestPath);
  updateAnimals(map, dt, requestPath);
  updateSoldiers(map, dt, requestPath);
  updateCombat(map, dt);
  updateEngines(map, dt);
  updateOil(map, dt);
  updateTunnellers(map, dt);
  updatePlague(map, dt);
  updateLord(map, dt);
  checkOutcome();
  growFields();
  updateFires(dt);

  // наём проверяем раз в секунду, а не каждый тик
  jobTimer += dt;
  if (jobTimer >= 1) { jobTimer = 0; assignJobs(map); }
}

let lastFrame = performance.now();
function render() {
  const now = performance.now();
  const dtReal = (now - lastFrame) / 1000;
  lastFrame = now;
  renderer.stepActors(dtReal);
  renderer.draw();
  updateHud(dtReal);
}

events.on('built', (b) => {
  assignJobs(map);
  if (CONFIG.DEBUG) console.log('[стройка]', b.def.name, b.x, b.y);
});

events.on('month', () => {
  regrowForest(map);
  breedAnimals(map);      // дичь восстанавливается, если её выбили
  monthlyPopularity();     // налоги и пересчёт настроения
});
events.on('day', () => {
  feedPeople();          // сначала кормим
  serveAle();            // потом поим
  populationDay(map);    // потом считаем, кто пришёл и кто ушёл
});

start(update, render);

if (CONFIG.DEBUG) {
  window.SH = { state, map, camera, renderer, events, CONFIG, DEFS };
}
