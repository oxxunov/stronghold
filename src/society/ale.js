// Эль. Пивоварня варит его из хмеля и складывает на склад, разносчик таверны
// забирает бочки, а таверна каждый день поит народ.
//
// Считается не запас, а ОХВАТ: сколько людей реально получили эль. Одна таверна
// на большой замок даёт мало, поэтому их приходится ставить по кварталам —
// как в оригинале.

import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { totalPeople } from './population.js';

export const PEOPLE_PER_INN = 20;      // сколько человек обслуживает одна таверна
export const ALE_PER_DAY = 0.25;       // бочка держит полную таверну четыре дня

/** Разнос эля за день. Возвращает охват 0..1 */
export function serveAle() {
  const inns = state.buildings.filter((b) => b.def.id === 'inn');
  const people = totalPeople();
  if (!inns.length || people <= 0) {
    state.aleCoverage = 0;
    return 0;
  }

  let served = 0;
  let left = people;

  for (const inn of inns) {
    if (left <= 0) break;
    const stock = inn.ale || 0;
    if (stock <= 0) continue;

    const canServe = Math.min(PEOPLE_PER_INN, left);
    const need = ALE_PER_DAY * (canServe / PEOPLE_PER_INN);
    const spend = Math.min(stock, need);

    inn.ale = stock - spend;
    const actually = Math.round(PEOPLE_PER_INN * (spend / ALE_PER_DAY));
    served += Math.min(actually, canServe);
    left -= actually;
  }

  state.aleCoverage = Math.min(1, served / people);
  events.emit('aleServed', { coverage: state.aleCoverage });
  return state.aleCoverage;
}

/** Вклад эля в настроение: от 0 до +8 по охвату */
export function alePopularity() {
  const c = state.aleCoverage || 0;
  if (c <= 0) return 0;
  return Math.max(1, Math.round(c * 8));
}

/** Сколько бочек лежит по тавернам — для интерфейса */
export function aleInInns() {
  return state.buildings
    .filter((b) => b.def.id === 'inn')
    .reduce((n, b) => n + (b.ale || 0), 0);
}
