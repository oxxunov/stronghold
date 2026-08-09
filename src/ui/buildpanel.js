// Панель строительства. Схема под палец:
// категория → здание → призрак на карте → подтверждение галочкой.
// Палец не закрывает место постройки, потому что подтверждение внизу экрана.

import { state } from '../core/state.js';
import { CATEGORIES, DEFS, checkPlace, place, canAfford } from '../economy/buildings.js';
import { WALL_TYPES, WALL_WOOD, WALL_STONE, lineTiles, placeWalls,
         canPlaceWall, affordableCount } from '../world/walls.js';
import { MOAT_TYPES, MOAT_DRY, MOAT_PITCH, digMoat, canDig } from '../world/moat.js';

let map = null;
let camera = null;

export const buildMode = {
  active: false,
  def: null,
  tx: 0, ty: 0,
  valid: false,
  reason: '',

  // строительство стены полосой: тянем палец от начала к концу
  wall: 0,          // 0 — обычное здание, иначе тип стены
  moat: 0,          // если задан — чертим ров, а не стену
  from: null,       // клетка начала
  tiles: [],        // предпросчитанная линия
};

const el = {};

export function initBuildPanel(_map, _camera) {
  map = _map;
  camera = _camera;

  el.root = document.getElementById('build');
  el.cats = document.getElementById('build-cats');
  el.list = document.getElementById('build-list');
  el.confirm = document.getElementById('build-confirm');
  el.reason = document.getElementById('build-reason');
  el.toggle = document.getElementById('b-build');

  el.toggle.onclick = () => togglePanel();
  document.getElementById('b-place').onclick = () => commit();
  document.getElementById('b-cancel').onclick = () => cancel();

  renderCategories();
  selectCategory('castle');
}

function togglePanel(force) {
  const open = force !== undefined ? force : el.root.style.display !== 'flex';
  el.root.style.display = open ? 'flex' : 'none';
  el.toggle.classList.toggle('on', open);
  if (!open) cancel();
}

function renderCategories() {
  el.cats.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.dataset.cat = c.id;
    b.onclick = () => selectCategory(c.id);
    el.cats.appendChild(b);
  }
}

function selectCategory(cat) {
  for (const b of el.cats.children) b.classList.toggle('on', b.dataset.cat === cat);
  el.list.innerHTML = '';

  // стены живут не в data/buildings.json, а в слое карты — добавляем вручную
  if (cat === 'castle') {
    for (const type of [WALL_WOOD, WALL_STONE]) {
      const w = WALL_TYPES[type];
      const b = document.createElement('button');
      b.className = 'bcard';
      const cost = Object.entries(w.cost).map(([r, n]) => `${RES_NAME[r] || r} ${n}`).join(' ');
      b.innerHTML = `<b>${w.name}</b><i>линия</i><s>${cost} / клетка</s>`;
      b.onclick = () => startWall(type);
      el.list.appendChild(b);
    }

    for (const type of [MOAT_DRY, MOAT_PITCH]) {
      const m = MOAT_TYPES[type];
      const b = document.createElement('button');
      b.className = 'bcard';
      const cost = Object.entries(m.cost)
        .map(([r, n]) => `${RES_NAME[r] || r} ${n}`).join(' ') || 'бесплатно';
      b.innerHTML = `<b>${m.name}</b><i>линия</i><s>${cost}</s>`;
      b.onclick = () => startWall(type, true);
      el.list.appendChild(b);
    }
  }

  for (const def of Object.values(DEFS)) {
    if (def.category !== cat) continue;
    const b = document.createElement('button');
    b.className = 'bcard';
    const cost = Object.entries(def.cost || {})
      .map(([r, n]) => `${RES_NAME[r] || r} ${n}`).join('  ') || 'бесплатно';
    b.innerHTML = `<b>${def.name}</b><i>${def.size[0]}×${def.size[1]}</i><s>${cost}</s>`;
    b.onclick = () => startPlacing(def);
    if (!canAfford(def)) b.classList.add('poor');
    el.list.appendChild(b);
  }
}

const RES_NAME = { wood: 'дерево', stone: 'камень', iron: 'железо',
                   gold: 'золото', pitch: 'смола' };

const stateRes = (res) => state.resources[res] || 0;

function startWall(type, isMoat = false) {
  buildMode.active = true;
  buildMode.wall = type;
  buildMode.moat = isMoat ? type : 0;
  buildMode.def = null;
  buildMode.from = null;
  buildMode.tiles = [];
  el.confirm.style.display = 'flex';
  el.reason.textContent = 'Проведите пальцем линию стены';
  el.reason.className = 'ok';
  togglePanel(false);
  el.toggle.classList.add('on');
}

/** Палец ведёт линию: начало, протяжка, отпускание */
export function wallDrag(phase, sx, sy) {
  if (!buildMode.active || !buildMode.wall) return false;
  const t = camera.screenToTile(sx, sy);

  if (phase === 'start') {
    buildMode.from = t;
    buildMode.tiles = [t];
  } else if (buildMode.from) {
    buildMode.tiles = lineTiles(buildMode.from.x, buildMode.from.y, t.x, t.y);
  }

  if (buildMode.moat) {
    const good = buildMode.tiles.filter((c) => canDig(map, c.x, c.y).ok);
    const m = MOAT_TYPES[buildMode.moat];
    const res = Object.keys(m.cost)[0];
    const paid = res
      ? Math.min(good.length, Math.floor((stateRes(res)) / m.cost[res]))
      : good.length;
    buildMode.valid = paid > 0;
    el.reason.textContent = paid
      ? `${m.name}: ${paid} клеток` + (res ? `, ${RES_NAME[res]} ${m.cost[res] * paid}` : '')
      : 'Копать негде';
    el.reason.className = paid ? 'ok' : 'bad';
    return true;
  }

  const good = buildMode.tiles.filter((c) => canPlaceWall(map, c.x, c.y).ok);
  const paid = affordableCount(buildMode.wall, good.length);
  buildMode.valid = paid > 0;
  const w = WALL_TYPES[buildMode.wall];
  const res = Object.keys(w.cost)[0];
  el.reason.textContent = paid
    ? `${w.name}: ${paid} клеток, ${RES_NAME[res]} ${w.cost[res] * paid}`
    : 'Не хватает материала';
  el.reason.className = paid ? 'ok' : 'bad';
  return true;
}

function startPlacing(def) {
  buildMode.active = true;
  buildMode.wall = 0;
  buildMode.def = def;
  // ставим призрак в центр экрана, дальше игрок двигает карту или тыкает
  const c = camera.screenToTile(window.innerWidth / 2, window.innerHeight / 2);
  moveGhost(c.x - (def.size[0] >> 1), c.y - (def.size[1] >> 1));
  el.confirm.style.display = 'flex';
  togglePanel(false);
  el.toggle.classList.add('on');
}

export function moveGhost(tx, ty) {
  if (!buildMode.active) return;
  buildMode.tx = tx;
  buildMode.ty = ty;
  const r = checkPlace(map, buildMode.def, tx, ty);
  buildMode.valid = r.ok;
  buildMode.reason = r.reason || '';
  el.reason.textContent = r.ok ? buildMode.def.name : r.reason;
  el.reason.className = r.ok ? 'ok' : 'bad';
}

/** Тап по карте во время стройки — перенести призрак */
export function tapMap(sx, sy) {
  if (!buildMode.active) return false;
  const t = camera.screenToTile(sx, sy);
  moveGhost(t.x - (buildMode.def.size[0] >> 1), t.y - (buildMode.def.size[1] >> 1));
  return true;
}

function commit() {
  if (!buildMode.active || !buildMode.valid) return;

  if (buildMode.wall) {
    const type = buildMode.wall;
    if (buildMode.moat) digMoat(map, type, buildMode.tiles);
    else placeWalls(map, type, buildMode.tiles);
    buildMode.from = null;
    buildMode.tiles = [];
    el.reason.textContent = 'Проведите пальцем следующую линию';
    return;                              // остаёмся в режиме стены
  }

  place(map, buildMode.def, buildMode.tx, buildMode.ty);
  const def = buildMode.def;
  cancel();
  // сразу предлагаем поставить ещё одно такое же — так строят цепочками
  if (canAfford(def) && !def.unique) startPlacing(def);
}

export function cancel() {
  buildMode.active = false;
  buildMode.def = null;
  buildMode.wall = 0;
  buildMode.moat = 0;
  buildMode.from = null;
  buildMode.tiles = [];
  el.confirm.style.display = 'none';
  el.toggle.classList.remove('on');
}

export function refreshAffordable() {
  for (const b of el.list.children) {
    const name = b.querySelector('b')?.textContent;
    const def = Object.values(DEFS).find((d) => d.name === name);
    if (def) b.classList.toggle('poor', !canAfford(def));
  }
}
