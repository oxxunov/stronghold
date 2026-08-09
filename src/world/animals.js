// Дичь. Звери бродят по лугам у леса, охотник их бьёт и несёт мясо в амбар.
// Спрайты из пака CraftPix: кадр 32x32, 6 кадров ходьбы, 4 направления.

import { CONFIG } from '../config.js';
import { state, addEntity } from '../core/state.js';
import { TERRAIN } from './map.js';

export const SPECIES = {
  deer:   { name: 'Олень',  file: 'Deer/Deer_Walk.png',                   frames: 6, meat: 3, speed: 1.0 },
  boar:   { name: 'Кабан',  file: 'Boar/Boar_Walk.png',                   frames: 6, meat: 4, speed: 0.9 },
  hare:   { name: 'Заяц',   file: 'Hare/Hare_Walk.png',                   frames: 5, meat: 1, speed: 1.8 },
  grouse: { name: 'Тетерев', file: 'Black_grouse/Black_grouse_Walk.png',  frames: 6, meat: 1, speed: 1.2 },
};

export const MAX_ANIMALS = 14;

/** Луг рядом с лесом — там дичь и держится */
function grazingSpot(map, rand = Math.random) {
  for (let i = 0; i < 200; i++) {
    const x = (rand() * map.w) | 0;
    const y = (rand() * map.h) | 0;
    if (!map.walkable(x, y)) continue;
    if (map.tiles[map.idx(x, y)] !== TERRAIN.GRASS.id) continue;
    let nearForest = false;
    for (let dy = -3; dy <= 3 && !nearForest; dy++)
      for (let dx = -3; dx <= 3 && !nearForest; dx++)
        if (map.inBounds(x + dx, y + dy) &&
            map.tiles[map.idx(x + dx, y + dy)] === TERRAIN.FOREST.id) nearForest = true;
    if (nearForest) return { x, y };
  }
  return null;
}

export function spawnAnimal(map, kind = null) {
  const keys = Object.keys(SPECIES);
  const id = kind || keys[(Math.random() * keys.length) | 0];
  const spot = grazingSpot(map);
  if (!spot) return null;

  return addEntity({
    type: 'animal',
    species: id,
    x: spot.x, y: spot.y,
    speed: SPECIES[id].speed,
    path: null, pathStep: 0, pathPending: false,
    dir: 'down', frame: 0, anim: Math.random() * 6,
    idle: Math.random() * 4,
    taken: false,          // кто-то уже вышел на этого зверя
  });
}

export function populateAnimals(map, n = MAX_ANIMALS) {
  for (let i = 0; i < n; i++) spawnAnimal(map);
}

/** Раз в месяц дичь подрастает, если её выбили */
export function breedAnimals(map) {
  const alive = state.entities.filter((e) => e.type === 'animal').length;
  if (alive >= MAX_ANIMALS) return;
  const born = Math.min(2, MAX_ANIMALS - alive);
  for (let i = 0; i < born; i++) spawnAnimal(map);
}

export function updateAnimals(map, dt, requestPath) {
  for (const e of state.entities) {
    if (e.type !== 'animal') continue;

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
      e.anim = (e.anim + step * 3) % SPECIES[e.species].frames;
      e.frame = Math.floor(e.anim);
      continue;
    }
    if (e.pathPending) continue;

    e.frame = 0;
    e.idle -= dt;
    if (e.idle > 0) continue;
    e.idle = 3 + Math.random() * 6;      // зверь пасётся, потом переходит

    const tx = Math.round(e.x) + ((Math.random() * 9) | 0) - 4;
    const ty = Math.round(e.y) + ((Math.random() * 9) | 0) - 4;
    if (map.walkable(tx, ty)) requestPath(e, tx, ty);
  }
}

export function killAnimal(e) {
  const i = state.entities.indexOf(e);
  if (i >= 0) state.entities.splice(i, 1);
  return SPECIES[e.species].meat;
}
