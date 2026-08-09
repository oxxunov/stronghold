// Панель строительства. Схема под палец:
// категория → здание → призрак на карте → подтверждение галочкой.
// Палец не закрывает место постройки, потому что подтверждение внизу экрана.

import { state } from '../core/state.js';
import { CATEGORIES, DEFS, checkPlace, place, canAfford } from '../economy/buildings.js';

let map = null;
let camera = null;

export const buildMode = {
  active: false,
  def: null,
  tx: 0, ty: 0,
  valid: false,
  reason: '',
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

const RES_NAME = { wood: 'дерево', stone: 'камень', iron: 'железо', gold: 'золото' };

function startPlacing(def) {
  buildMode.active = true;
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
  place(map, buildMode.def, buildMode.tx, buildMode.ty);
  const def = buildMode.def;
  cancel();
  // сразу предлагаем поставить ещё одно такое же — так строят цепочками
  if (canAfford(def) && !def.unique) startPlacing(def);
}

export function cancel() {
  buildMode.active = false;
  buildMode.def = null;
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
