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
import { initBuildPanel, tapMap, buildMode } from './ui/buildpanel.js';
import { assignJobs, updateWorkers, regrowForest, growFields } from './economy/workers.js';
import { populationDay, updateIdlers, housingCap } from './society/population.js';
import { feedPeople } from './society/food.js';
import { serveAle } from './society/ale.js';
import { populateAnimals, updateAnimals, breedAnimals } from './world/animals.js';
import { monthlyPopularity } from './society/popularity.js';

const canvas = document.getElementById('game');

const map = new GameMap(CONFIG.MAP_W, CONFIG.MAP_H);
state.map = map;

const camera = new Camera(canvas, map);
const renderer = new Renderer(canvas, camera, map);

initHud(camera, map);
camera.center();

// --- Тап по карте: во время стройки переносит призрак ---
canvas.addEventListener('pointerup', (e) => {
  if (camera.moved) return;              // это было перетаскивание карты, не тап
  if (buildMode.active) tapMap(e.clientX, e.clientY);
});

// --- Загрузка данных, потом старт ---
loadBuildings().then(() => {
  initBuildPanel(map, camera);

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

let jobTimer = 0;

function update(dt) {
  processPathQueue(map);
  updateWalkers(map, dt);
  updateWorkers(map, dt);
  updateIdlers(map, dt, requestPath);
  updateAnimals(map, dt, requestPath);
  growFields();

  // наём проверяем раз в секунду, а не каждый тик
  jobTimer += dt;
  if (jobTimer >= 1) { jobTimer = 0; assignJobs(map); }
}

let lastFrame = performance.now();
function render() {
  const now = performance.now();
  const dtReal = (now - lastFrame) / 1000;
  lastFrame = now;
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
