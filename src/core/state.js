// Единственное место, где живёт состояние игры.
// Никаких глобальных переменных по другим файлам — иначе будет каша.

import { CONFIG } from '../config.js';

export const state = {
  // --- Время ---
  tick: 0,
  day: 1,
  month: 0,
  year: CONFIG.START_YEAR,
  paused: false,
  speed: 1,              // 1 | 2 | 3

  // --- Мир ---
  map: null,             // заполняет world/map.js

  // --- Сущности (рабочие, солдаты, животные) ---
  entities: [],
  nextId: 1,

  // --- Ресурсы ---
  resources: {
    wood: 100, stone: 50, iron: 0, pitch: 0, gold: 200,
    wheat: 0, flour: 0, bread: 0, meat: 0, cheese: 0, apples: 0, ale: 0
  },

  // --- Постройки ---
  buildings: [],

  // --- Общество (полноценно на этапе 4) ---
  population: 0,          // свободные крестьяне, готовые пойти работать
  populationCap: 0,       // мест в лачугах
  ration: 'normal',       // размер пайка
  starving: false,        // еды не хватило на раздачу
  foodEaten: 0,
  popularity: 55,         // 0..100; ниже 50 люди уходят, выше — приходят
  popularityDelta: 0,     // на сколько сдвинулось в этом месяце
  tax: 'none',            // уровень налога
  fearPopularity: 0,      // шкала страха — шаг 4.4

  // --- Отладка ---
  showGrid: false,
};

export function addEntity(e) {
  if (state.entities.length >= CONFIG.MAX_ENTITIES) return null;
  e.id = state.nextId++;
  state.entities.push(e);
  return e;
}

export function clearEntities() {
  state.entities.length = 0;
}
