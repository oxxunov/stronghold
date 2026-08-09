// Население. Лачуги дают места, люди приходят сами, пока есть куда селиться
// и пока их всё устраивает. Ушедших не вернуть — только заманить обратно.
//
// Популярность на этом шаге держится на 50 (нейтрально); её расчёт — шаг 4.3.

import { CONFIG } from '../config.js';
import { state, addEntity } from '../core/state.js';
import { events } from '../core/events.js';

const PER_HOVEL = 8;

/** Сколько человек помещается в замке */
export function housingCap() {
  return state.buildings
    .filter((b) => b.def.id === 'hovel')
    .length * PER_HOVEL;
}

/** Всего людей: свободные плюс занятые на работах */
export function totalPeople() {
  return state.population + state.buildings.reduce((n, b) => n + (b.workers || 0), 0);
}

/** Клетка у донжона — там люди толкутся, пока не найдут работу */
function campfire(map) {
  const keep = state.buildings.find((b) => b.def.id === 'keep');
  if (!keep) return null;
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = keep.x + (keep.w >> 1) + dx;
        const y = keep.y + keep.h + dy;
        if (map.walkable(x, y)) return { x, y };
      }
    }
  }
  return null;
}

function spawnIdler(map) {
  const spot = campfire(map);
  if (!spot) return false;
  state.population++;
  addEntity({
    type: 'idler',
    role: 'peasant',
    x: spot.x, y: spot.y,
    home: null,
    speed: 1.1,
    path: null, pathStep: 0, pathPending: false,
    dir: 'down', frame: 0, anim: Math.random() * CONFIG.UNIT_FRAMES,
    idle: Math.random() * 3,
    nav: null, target: null,
  });
  return true;
}

/** Забрать одного праздного крестьянина: его нанимают на работу */
export function takeIdler() {
  const i = state.entities.findIndex((e) => e.type === 'idler');
  if (i < 0) return false;
  state.entities.splice(i, 1);
  return true;
}

/** Проводить одного: мест нет или народ недоволен */
function removePerson() {
  if (takeIdler()) { state.population--; return true; }
  // свободных нет — увольняем рабочего с последнего построенного здания
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    const b = state.buildings[i];
    if (!b.workers) continue;
    const w = state.entities.findIndex((e) => e.type === 'worker' && e.home === b);
    if (w < 0) continue;
    state.entities.splice(w, 1);
    b.workers--;
    return true;
  }
  return false;
}

/**
 * Раз в игровой день: считаем места и настроение.
 * Популярность выше 50 — приходят, ниже — уходят, ровно 50 — ничего.
 */
export function populationDay(map) {
  const cap = housingCap();
  const total = totalPeople();
  state.populationCap = cap;

  if (total > cap) {                       // жильё снесли — лишние уходят
    removePerson();
    events.emit('peopleLeft', { reason: 'нет жилья' });
    return;
  }

  if (state.popularity > 50 && total < cap) {
    if (spawnIdler(map)) events.emit('peopleCame', { total: total + 1 });
    return;
  }

  if (state.popularity < 50) {
    if (removePerson()) events.emit('peopleLeft', { reason: 'недовольство' });
  }
}

/** Праздные крестьяне слоняются у костра, а не стоят столбами */
export function updateIdlers(map, dt, requestPath) {
  for (const e of state.entities) {
    if (e.type !== 'idler') continue;

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
    e.idle -= dt;
    if (e.idle > 0) continue;
    e.idle = 2 + Math.random() * 4;

    const spot = campfire(map);
    if (!spot) continue;
    const tx = spot.x + ((Math.random() * 7) | 0) - 3;
    const ty = spot.y + ((Math.random() * 7) | 0) - 3;
    if (map.walkable(tx, ty)) requestPath(e, tx, ty);
  }
}
