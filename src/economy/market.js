// Рынок. Купля-продажа со спредом: покупаешь дороже, продаёшь дешевле.
// Именно на разнице живёт «мирная» стратегия — гнать оружие и скупать еду.

import { state } from '../core/state.js';
import { events } from '../core/events.js';
import { storeFor, deposit, take } from './storage.js';

// базовая цена товара; покупка выше, продажа ниже
export const PRICES = {
  wood:   { base: 4,  name: 'Дерево' },
  stone:  { base: 6,  name: 'Камень' },
  iron:   { base: 25, name: 'Железо' },
  pitch:  { base: 15, name: 'Смола' },
  hops:   { base: 12, name: 'Хмель' },
  wheat:  { base: 12, name: 'Пшеница' },
  flour:  { base: 18, name: 'Мука' },
  ale:    { base: 20, name: 'Эль' },
  bread:  { base: 8,  name: 'Хлеб' },
  meat:   { base: 10, name: 'Мясо' },
  cheese: { base: 10, name: 'Сыр' },
  apples: { base: 8,  name: 'Яблоки' },
  bow:    { base: 32, name: 'Лук' },
  spear:  { base: 20, name: 'Копьё' },
  sword:  { base: 58, name: 'Меч' },
  leatherarmour: { base: 35, name: 'Кожаный доспех' },
  metalarmour:   { base: 65, name: 'Металлический доспех' },
};

export const BUY_MARKUP = 1.25;    // наценка при покупке
export const SELL_CUT = 0.70;      // скидка при продаже

export const buyPrice = (res) => Math.max(1, Math.round((PRICES[res]?.base || 1) * BUY_MARKUP));
export const sellPrice = (res) => Math.max(1, Math.round((PRICES[res]?.base || 1) * SELL_CUT));

export function hasMarket() {
  return state.buildings.some((b) => b.def.id === 'market');
}

/** Купить: нужен рынок, золото и здание, куда товар положить */
export function buy(res, qty = 1) {
  if (!hasMarket()) return { ok: false, reason: 'Нет рынка' };
  if (!PRICES[res]) return { ok: false, reason: 'Этим не торгуют' };
  if (!storeFor(res)) return { ok: false, reason: 'Некуда складывать' };

  const cost = buyPrice(res) * qty;
  if (state.resources.gold < cost) return { ok: false, reason: 'Не хватает золота' };

  state.resources.gold -= cost;
  deposit(res, qty);
  events.emit('traded', { res, qty, gold: -cost });
  return { ok: true, cost };
}

/** Продать: товар должен лежать на складе */
export function sell(res, qty = 1) {
  if (!hasMarket()) return { ok: false, reason: 'Нет рынка' };
  if (!PRICES[res]) return { ok: false, reason: 'Этим не торгуют' };
  if ((state.resources[res] || 0) < qty) return { ok: false, reason: 'Нечего продавать' };

  take(res, qty);
  const gain = sellPrice(res) * qty;
  state.resources.gold += gain;
  events.emit('traded', { res, qty: -qty, gold: gain });
  return { ok: true, gain };
}
