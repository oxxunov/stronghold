// Налоги и популярность.
//
// Раз в игровой месяц популярность сдвигается на сумму факторов: еда, налоги,
// позже страх и религия. Значение копится, а не пересчитывается с нуля —
// поэтому щедрость отыгрывается не мгновенно, и разорить доверие легче,
// чем его вернуть.

import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { totalPeople } from './population.js';
import { foodPopularity } from './food.js';
import { alePopularity } from './ale.js';
import { sickCount } from '../military/tunnel.js';

export const TAXES = [
  { id: 'gift3', name: 'Раздача ×3',    gold: -1.6, popularity: 7 },
  { id: 'gift2', name: 'Раздача ×2',    gold: -1.0, popularity: 5 },
  { id: 'gift1', name: 'Раздача ×1',    gold: -0.6, popularity: 3 },
  { id: 'none',  name: 'Без налога',    gold: 0,    popularity: 1 },
  { id: 'low',   name: 'Низкий',        gold: 0.6,  popularity: -2 },
  { id: 'mid',   name: 'Средний',       gold: 1.2,  popularity: -4 },
  { id: 'high',  name: 'Высокий',       gold: 1.8,  popularity: -6 },
  { id: 'vhigh', name: 'Очень высокий', gold: 2.4,  popularity: -8 },
  { id: 'cruel', name: 'Грабительский', gold: 3.0,  popularity: -12 },
];

export const taxById = (id) => TAXES.find((t) => t.id === id) || TAXES[3];

/** Сколько золота принесёт этот месяц при нынешнем населении */
export function taxIncome() {
  return taxById(state.tax).gold * totalPeople();
}

/**
 * Шкала страха от −5 (ужас) до +5 (радость). Считается по постройкам:
 * сады и фонтаны в плюс, столбы и виселицы в минус.
 */
export function fearFactor() {
  let sum = 0;
  for (const b of state.buildings) sum += b.def.fear || 0;
  return Math.max(-5, Math.min(5, sum));
}

/**
 * Множитель скорости работы. Запуганный народ работает быстрее, довольный —
 * медленнее: это и есть выбор между добрым и злым лордом.
 */
export function workRate() {
  return 1 - fearFactor() * 0.10;      // −5 → ×1.5, +5 → ×0.5
}

/** Разбивка факторов — её же показываем игроку в советнике */
export function popularityFactors() {
  const food = foodPopularity();
  const ale = alePopularity();
  const tax = taxById(state.tax).popularity;
  const fear = fearFactor() * 2;                 // −5 → −10, +5 → +10
  const crowding = state.populationCap > 0 && totalPeople() > state.populationCap ? -6 : 0;
  // чума: чем больше больных, тем мрачнее народ, до −10
  const sick = sickCount();
  const plague = sick ? -Math.min(10, 2 + Math.round(sick / 2)) : 0;
  return { food, ale, tax, fear, crowding, plague,
           total: food + ale + tax + fear + crowding + plague };
}

/** Месячный расчёт: собираем налог и двигаем популярность */
export function monthlyPopularity() {
  const income = taxIncome();
  if (income >= 0) {
    state.resources.gold += income;
  } else {
    // раздача идёт только пока в казне есть чем платить
    const canGive = Math.min(-income, state.resources.gold);
    state.resources.gold -= canGive;
  }

  const f = popularityFactors();
  state.popularityDelta = f.total;
  state.popularity = Math.max(0, Math.min(100, state.popularity + f.total));

  events.emit('popularity', { value: state.popularity, factors: f });
  return f;
}

export function cycleTax(dir = 1) {
  const i = TAXES.findIndex((t) => t.id === state.tax);
  const next = Math.min(TAXES.length - 1, Math.max(0, i + dir));
  state.tax = TAXES[next].id;
  events.emit('taxChanged', { tax: state.tax });
  return TAXES[next];
}
