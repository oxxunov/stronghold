// HUD: ресурсы сверху, диагностика слева, кнопки снизу.
// UI только читает состояние — логику здесь не пишем.

import { MONTHS } from '../config.js';
import { state, clearEntities } from '../core/state.js';
import { getFps } from '../core/loop.js';
import { takePathStat, clearQueue } from '../world/pathfinding.js';
import { spawnWalkers } from '../world/walker.js';
import { refreshAffordable } from './buildpanel.js';
import { totalPeople, housingCap } from '../society/population.js';
import { foodStock, daysOfFood, cycleRation, rationById } from '../society/food.js';
import { cycleTax, taxById, popularityFactors, fearFactor, workRate } from '../society/popularity.js';
import { aleInInns } from '../society/ale.js';
import { refreshMarket } from './marketpanel.js';
import { refreshBarracks } from './barrackspanel.js';
import { armySize } from '../military/units.js';
import { events } from '../core/events.js';

const $ = (id) => document.getElementById(id);
let cam = null;

events.on('outcome', ({ result }) => {
  const box = document.getElementById('outcome');
  const title = document.getElementById('outcome-title');
  const text = document.getElementById('outcome-text');
  if (!box) return;
  title.textContent = result === 'win' ? 'Замок врага пал' : 'Ваш донжон разрушен';
  text.textContent = result === 'win'
    ? 'Лорд разбит. Земли ваши.'
    : 'Осада окончена. Обновите страницу, чтобы начать заново.';
  box.style.display = 'flex';
});

export function initHud(camera, map) {
  cam = camera;
  const bPause = $('b-pause');
  const bSpeed = $('b-speed');
  const bGrid = $('b-grid');

  bPause.onclick = () => {
    state.paused = !state.paused;
    bPause.textContent = state.paused ? 'Пуск' : 'Пауза';
    bPause.classList.toggle('on', state.paused);
  };

  bSpeed.onclick = () => {
    state.speed = state.speed >= 3 ? 1 : state.speed + 1;
    bSpeed.textContent = `Скорость ×${state.speed}`;
    bSpeed.classList.toggle('on', state.speed > 1);
  };

  bGrid.onclick = () => {
    state.showGrid = !state.showGrid;
    bGrid.classList.toggle('on', state.showGrid);
  };

  const bRation = $('b-ration');
  const showRation = () => {
    const r = rationById(state.ration);
    bRation.textContent = `Паёк: ${r.name.toLowerCase()}`;
    bRation.classList.toggle('on', r.amount > 1);
    bRation.classList.toggle('warn', r.amount < 1);
  };
  // тап поднимает паёк, долгое нажатие опускает — на телефоне это удобнее меню
  bRation.onclick = () => {
    const r = rationById(state.ration);
    cycleRation(r.id === 'triple' ? -4 : 1);
    showRation();
  };
  showRation();

  const bTax = $('b-tax');
  const showTax = () => {
    const t = taxById(state.tax);
    bTax.textContent = `Налог: ${t.name.toLowerCase()}`;
    bTax.classList.toggle('on', t.gold < 0);
    bTax.classList.toggle('warn', t.popularity <= -6);
  };
  bTax.onclick = () => {
    const t = taxById(state.tax);
    cycleTax(t.id === 'cruel' ? -8 : 1);
    showTax();
  };
  showTax();

  $('b-spawn100').onclick = () => spawnWalkers(map, 100);
  $('b-spawn500').onclick = () => spawnWalkers(map, 500);
  $('b-clear').onclick = () => { clearEntities(); clearQueue(); };
  $('b-center').onclick = () => camera.center();
}

let acc = 0, pathAcc = 0;

export function updateHud(dtReal) {
  acc += dtReal;
  pathAcc += takePathStat();
  if (acc < 0.25) return;

  const fps = getFps();
  const fpsEl = $('fps');
  fpsEl.textContent = fps;
  fpsEl.className = fps >= 45 ? 'ok' : (fps < 25 ? 'bad' : '');

  $('ents').textContent = state.entities.length;
  $('paths').textContent = Math.round(pathAcc / acc);
  $('zoom').textContent = cam ? cam.zoom.toFixed(2) : '—';
  $('blds').textContent = state.buildings.length;
  $('free').textContent = state.population;
  $('army').textContent = armySize();

  const stock = foodStock();
  const days = daysOfFood();
  $('s-food').textContent = Math.floor(stock);
  const fd = $('fooddays');
  fd.textContent = days === Infinity ? '∞' : `${days} дн`;
  fd.className = state.starving ? 'bad' : (days < 5 ? '' : 'ok');

  $('s-wood').textContent = Math.floor(state.resources.wood);
  $('s-stone').textContent = Math.floor(state.resources.stone);
  $('s-gold').textContent = Math.floor(state.resources.gold);
  $('s-pop').textContent = `${totalPeople()}/${housingCap()}`;
  $('workers').textContent = state.entities.filter((e) => e.type === 'worker').length;

  const cov = Math.round((state.aleCoverage || 0) * 100);
  const al = $('ale');
  al.textContent = `${cov}% (${Math.round(aleInInns())} б)`;
  al.className = cov >= 50 ? 'ok' : '';

  const ff = fearFactor();
  const fe = $('fear');
  fe.textContent = ff > 0 ? `+${ff} радость` : (ff < 0 ? `${ff} страх` : '0');
  fe.className = ff > 0 ? 'ok' : (ff < 0 ? 'bad' : '');
  $('rate').textContent = workRate().toFixed(2);

  const mood = $('s-pop-mood');
  const f = popularityFactors();
  const sign = f.total > 0 ? '+' : '';
  mood.textContent = `${Math.round(state.popularity)} (${sign}${f.total})`;
  mood.style.color = state.popularity >= 50 ? 'var(--gold)' : 'var(--blood)';

  const L = state.lord;
  $('s-lord').textContent = L ? L.def.name : '—';
  $('s-wave').textContent = L && L.alive
    ? `${L.wave} · ${Math.max(0, Math.ceil(L.timer))}с`
    : '—';

  $('s-year').textContent = state.year;
  $('s-month').textContent = MONTHS[state.month];

  refreshAffordable();
  refreshMarket();
  refreshBarracks();

  acc = 0; pathAcc = 0;
}
