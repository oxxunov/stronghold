// Панель казармы: список войск, чего не хватает, кнопка найма.
// Требования пишем словами, чтобы не гадать, почему кнопка не работает.

import { state } from '../core/state.js';
import { UNITS, canHire, hire, WEAPON_NAME, army, barracks } from '../military/units.js';
import { selectAll, selectType, clearSelection, orderStand, selection } from '../military/orders.js';

const el = {};
let map = null;

export function initBarracksPanel(_map) {
  map = _map;
  el.root = document.getElementById('barracks');
  el.list = document.getElementById('barracks-list');
  el.toggle = document.getElementById('b-army');
  el.note = document.getElementById('barracks-note');
  el.toggle.onclick = () => toggle();
}

export function toggle(force) {
  const open = force !== undefined ? force : el.root.style.display !== 'flex';
  el.root.style.display = open ? 'flex' : 'none';
  el.toggle.classList.toggle('on', open);
  if (open) render();
}

function note(text, bad = false) {
  el.note.textContent = text;
  el.note.className = bad ? 'bad' : 'ok';
  clearTimeout(note.t);
  note.t = setTimeout(() => { el.note.textContent = ''; }, 2200);
}

function renderOrders() {
  const bar = document.getElementById('barracks-orders');
  if (!bar) return;
  bar.innerHTML = '';

  const have = army();
  const total = Object.values(have).reduce((a, b) => a + b, 0);
  if (!total) return;

  const add = (label, fn, on = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (on) b.classList.add('on');
    b.onclick = () => { fn(); renderOrders(); };
    bar.appendChild(b);
  };

  add(`Все (${total})`, () => {
    const n = selectAll();
    note(n ? `Выбрано ${n}. Тапните по карте` : 'Некого выбирать');
  });
  for (const [id, n] of Object.entries(have)) {
    add(`${UNITS[id].name} ${n}`, () => {
      const c = selectType(id);
      note(`Выбрано ${c}. Тапните по карте`);
    });
  }
  if (selection.size) {
    add('Вольно', () => { orderStand(); note('Отряд распущен'); });
    add('Снять выбор', () => { clearSelection(); note(''); });
  }
}

function render() {
  renderOrders();
  if (!el.list) return;
  if (!barracks()) {
    el.list.innerHTML = '<div class="mrow"><b>Сначала постройте казарму</b></div>';
    return;
  }

  const have = army();
  el.list.innerHTML = '';

  for (const u of Object.values(UNITS)) {
    const row = document.createElement('div');
    row.className = 'mrow';

    const needs = Object.entries(u.needs || {})
      .map(([r, n]) => `${WEAPON_NAME[r] || r}${n > 1 ? ' ×' + n : ''}`).join(' + ');

    const label = document.createElement('span');
    label.className = 'mname';
    label.innerHTML = `${u.name} <i>${have[u.id] || 0}</i>`;

    const req = document.createElement('span');
    req.className = 'mreq';
    req.textContent = `${needs} + ${u.gold} зол.`;

    const b = document.createElement('button');
    const check = canHire(u);
    b.textContent = check.ok ? 'Нанять' : check.reason;
    b.disabled = !check.ok;
    if (!check.ok) b.classList.add('poor');
    b.onclick = () => {
      const r = hire(map, u);
      note(r.ok ? `${u.name} в строю` : r.reason, !r.ok);
      render();
    };

    row.append(label, req, b);
    el.list.appendChild(row);
  }
}

export { renderOrders };

export function refreshBarracks() {
  if (el.root && el.root.style.display === 'flex') render();
}
