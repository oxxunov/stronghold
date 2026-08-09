// Еда. Народ ест из амбара каждый день, а размер пайка задаёт игрок.
// Щедрый паёк поднимает настроение и жрёт запасы, скудный экономит и злит.

import { CONFIG } from '../config.js';
import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { totalPeople } from './population.js';

// сколько порций в месяц на человека и что это даёт настроению
export const RATIONS = [
  { id: 'none',   name: 'Нет еды',    amount: 0,   popularity: -32 },
  { id: 'half',   name: 'Половина',   amount: 0.5, popularity: -4 },
  { id: 'normal', name: 'Обычный',    amount: 1,   popularity: 0 },
  { id: 'double', name: 'Двойной',    amount: 2,   popularity: 4 },
  { id: 'triple', name: 'Тройной',    amount: 3,   popularity: 8 },
];

export const FOOD_TYPES = ['bread', 'meat', 'cheese', 'apples'];

export const rationById = (id) => RATIONS.find((r) => r.id === id) || RATIONS[2];

export function foodStock() {
  return FOOD_TYPES.reduce((n, f) => n + (state.resources[f] || 0), 0);
}

/** Сколько разных видов еды есть в амбаре — за разнообразие народ доплачивает настроением */
export function foodVariety() {
  return FOOD_TYPES.filter((f) => (state.resources[f] || 0) > 0).length;
}

/** Хватит ли запасов на столько дней при текущем пайке */
export function daysOfFood() {
  const perDay = dailyNeed();
  if (perDay <= 0) return Infinity;
  return Math.floor(foodStock() / perDay);
}

function dailyNeed() {
  const r = rationById(state.ration);
  return totalPeople() * r.amount / CONFIG.DAYS_PER_MONTH;
}

/**
 * Дневная раздача. Еда списывается пропорционально запасам, чтобы
 * разнообразие держалось как можно дольше, а не съедался один хлеб.
 */
export function feedPeople() {
  const need = dailyNeed();
  state.foodEaten = 0;

  if (need <= 0) {
    state.starving = totalPeople() > 0 && rationById(state.ration).amount === 0;
    return;
  }

  const stock = foodStock();
  if (stock <= 0) {
    state.starving = true;
    events.emit('starving', {});
    return;
  }

  const give = Math.min(need, stock);
  for (const f of FOOD_TYPES) {
    const have = state.resources[f] || 0;
    if (have <= 0) continue;
    const part = give * (have / stock);
    state.resources[f] = Math.max(0, have - part);
  }

  state.foodEaten = give;
  state.starving = give < need - 1e-6;
  if (state.starving) events.emit('starving', {});
}

/** Вклад еды в популярность: сам паёк плюс премия за разнообразие */
export function foodPopularity() {
  if (state.starving && foodStock() <= 0) return RATIONS[0].popularity;
  const base = rationById(state.ration).popularity;
  const variety = Math.max(0, foodVariety() - 1);   // +1 за каждый вид сверх первого
  return base + variety;
}

export function cycleRation(dir = 1) {
  const i = RATIONS.findIndex((r) => r.id === state.ration);
  const next = Math.min(RATIONS.length - 1, Math.max(0, i + dir));
  state.ration = RATIONS[next].id;
  events.emit('rationChanged', { ration: state.ration });
  return RATIONS[next];
}
