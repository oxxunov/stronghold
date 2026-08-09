// Склады. Ресурс сам находит, куда лечь: сырьё на склад, еда в амбар.
// Если нужного здания нет — ресурс просто не принимается, как в оригинале.

import { state } from '../core/state.js';
import { events } from '../core/events.js';

export const RAW = ['wood', 'stone', 'iron', 'pitch', 'wheat', 'flour', 'hops', 'ale'];
export const FOOD = ['bread', 'meat', 'cheese', 'apples'];

/** Куда нести этот ресурс */
export function storeFor(res) {
  const id = RAW.includes(res) ? 'stockpile' : (FOOD.includes(res) ? 'granary' : null);
  if (!id) return null;
  return state.buildings.find((b) => b.def.id === id) || null;
}

export function deposit(res, amount) {
  const store = storeFor(res);
  if (!store) return false;
  state.resources[res] = (state.resources[res] || 0) + amount;
  events.emit('stored', { res, amount, store });
  return true;
}

export function has(res, amount) {
  return (state.resources[res] || 0) >= amount;
}

export function take(res, amount) {
  if ((state.resources[res] || 0) < amount) return false;
  state.resources[res] -= amount;
  return true;
}
