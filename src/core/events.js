// Шина событий. Правило проекта: модули не вызывают друг друга напрямую,
// они шлют события сюда. Так экономику можно переписать, не трогая военку.

const listeners = new Map();

export const events = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => events.off(name, fn);
  },

  off(name, fn) {
    listeners.get(name)?.delete(fn);
  },

  emit(name, payload) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); }
      catch (e) { console.error(`[events] ошибка в обработчике "${name}"`, e); }
    }
  },

  clear() { listeners.clear(); }
};
