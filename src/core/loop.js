// Игровой цикл с фиксированным шагом логики.
// Логика всегда идёт ровными тиками (детерминированно), отрисовка — как успевает экран.

import { CONFIG, MONTHS } from '../config.js';
import { state } from './state.js';
import { events } from './events.js';

const STEP_MS = 1000 / CONFIG.TPS;

let acc = 0;
let last = 0;
let running = false;

// счётчик FPS
let frames = 0, fpsTimer = 0, fps = 0;

export function getFps() { return fps; }

export function start(update, render) {
  if (running) return;
  running = true;
  last = performance.now();

  function frame(now) {
    if (!running) return;

    let delta = now - last;
    last = now;
    if (delta > 250) delta = 250;   // после сворачивания вкладки не догоняем сотнями тиков

    // --- Логика ---
    if (!state.paused) {
      acc += delta * state.speed;
      let guard = 0;
      while (acc >= STEP_MS && guard < 12) {
        stepTime();
        update(STEP_MS / 1000);
        acc -= STEP_MS;
        guard++;
      }
      if (guard >= 12) acc = 0;     // не даём накопиться долгу на слабом устройстве
    } else {
      acc = 0;
    }

    // --- Отрисовка ---
    render();

    // --- FPS ---
    frames++;
    fpsTimer += delta;
    if (fpsTimer >= 500) {
      fps = Math.round(frames * 1000 / fpsTimer);
      frames = 0; fpsTimer = 0;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

export function stop() { running = false; }

function stepTime() {
  state.tick++;
  if (state.tick % CONFIG.TICKS_PER_DAY !== 0) return;

  state.day++;
  events.emit('day', { day: state.day });

  if (state.day > CONFIG.DAYS_PER_MONTH) {
    state.day = 1;
    state.month++;
    if (state.month >= MONTHS.length) { state.month = 0; state.year++; }
    // На этом событии позже будут налоги, популярность, зарплаты, урожай.
    events.emit('month', { month: state.month, year: state.year });
  }
}
