// Приказы. Управление рассчитано на палец: выделение не рамкой, а списком
// в панели («все лучники»), потом один тап по карте — и отряд пошёл.
//
// Приказы: move (идти), post (встать на башню/стену), stand (вольно).

import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { requestPath, requestPathAny } from '../world/pathfinding.js';

export const selection = new Set();

export const isSelected = (e) => selection.has(e);

export function clearSelection() {
  selection.clear();
  events.emit('selection', { count: 0 });
}

/** Выделить всех солдат, подходящих под условие */
export function selectBy(fn) {
  selection.clear();
  for (const e of state.entities) {
    if (e.type === 'soldier' && fn(e)) selection.add(e);
  }
  events.emit('selection', { count: selection.size });
  return selection.size;
}

export const selectAll = () => selectBy(() => true);
export const selectType = (unitId) => selectBy((e) => e.unit === unitId);

/** Живые выделенные — мёртвых вычищаем при каждом обращении */
function alive() {
  for (const e of [...selection]) {
    if (!state.entities.includes(e)) selection.delete(e);
  }
  return [...selection];
}

/**
 * Раскладка отряда вокруг точки: спираль по клеткам, чтобы не толпились
 * в одной и не толкались при подходе.
 */
function spread(map, cx, cy, count) {
  const out = [];
  for (let r = 0; r <= 8 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (map.walkable(x, y)) out.push({ x, y });
      }
    }
  }
  return out;
}

/** Идти в точку. Возвращает, сколько солдат получили приказ. */
export function orderMove(map, tx, ty) {
  const units = alive();
  if (!units.length) return 0;

  const spots = spread(map, tx, ty, units.length);
  if (!spots.length) return 0;

  units.forEach((e, i) => {
    const s = spots[i % spots.length];
    e.order = 'move';
    e.post = null;
    e.nav = null;
    requestPath(e, s.x, s.y);
  });

  events.emit('ordered', { order: 'move', count: units.length, x: tx, y: ty });
  return units.length;
}

/**
 * Встать на башню. Стрелки на башне получают прибавку к дальности,
 * поэтому лучников есть смысл держать именно там, а не в поле.
 */
export function orderPost(map, building) {
  const units = alive();
  if (!units.length) return 0;
  const cap = building.def.garrison || 0;
  if (!cap) return 0;

  const spots = [];
  for (let x = building.x - 1; x <= building.x + building.w; x++) {
    if (map.walkable(x, building.y - 1)) spots.push({ x, y: building.y - 1 });
    if (map.walkable(x, building.y + building.h)) spots.push({ x, y: building.y + building.h });
  }
  for (let y = building.y - 1; y <= building.y + building.h; y++) {
    if (map.walkable(building.x - 1, y)) spots.push({ x: building.x - 1, y });
    if (map.walkable(building.x + building.w, y)) spots.push({ x: building.x + building.w, y });
  }
  if (!spots.length) return 0;

  const taken = state.entities.filter(
    (e) => e.type === 'soldier' && e.post === building).length;
  const room = Math.max(0, cap - taken);
  const going = units.slice(0, room);

  going.forEach((e, i) => {
    const s = spots[i % spots.length];
    e.order = 'post';
    e.post = building;
    e.nav = null;
    requestPath(e, s.x, s.y);
  });

  events.emit('ordered', { order: 'post', count: going.length, building });
  return going.length;
}

/** Вольно: солдат возвращается к обычному топтанию у казармы */
export function orderStand() {
  const units = alive();
  for (const e of units) {
    e.order = 'stand';
    e.post = null;
  }
  events.emit('ordered', { order: 'stand', count: units.length });
  return units.length;
}

/** Прибавка к дальности от поста: на башне стрелок бьёт дальше */
export function effectiveRange(e) {
  const base = e.range || 0;
  if (!base || !e.post) return base;
  return base + (e.post.def.rangeBonus || 0);
}
