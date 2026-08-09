// Панель рынка. Список товаров: слева запас, справа две цены.
// Тап по цене — сделка на выбранное количество (1 / 5 / 20).

import { state } from '../core/state.js';
import { PRICES, buyPrice, sellPrice, buy, sell, hasMarket } from '../economy/market.js';

const el = {};
let qty = 5;

export function initMarketPanel() {
  el.root = document.getElementById('market');
  el.list = document.getElementById('market-list');
  el.toggle = document.getElementById('b-market');
  el.qty = document.getElementById('market-qty');
  el.note = document.getElementById('market-note');

  el.toggle.onclick = () => toggle();
  el.qty.onclick = () => {
    qty = qty === 1 ? 5 : (qty === 5 ? 20 : 1);
    el.qty.textContent = `по ${qty}`;
    render();
  };
  el.qty.textContent = `по ${qty}`;
}

export function toggle(force) {
  const open = force !== undefined ? force : el.root.style.display !== 'flex';
  el.root.style.display = open ? 'flex' : 'none';
  el.toggle.classList.toggle('on', open);
  if (open) render();
}

function note(text, bad = false) {
  el.note.textContent = text;
  el.note.className = bad ? 'bad' : 'ok';
  clearTimeout(note.t);
  note.t = setTimeout(() => { el.note.textContent = ''; }, 2200);
}

function render() {
  if (!el.list) return;
  if (!hasMarket()) {
    el.list.innerHTML = '<div class="mrow"><b>Сначала постройте рынок</b></div>';
    return;
  }
  el.list.innerHTML = '';

  for (const [res, info] of Object.entries(PRICES)) {
    const row = document.createElement('div');
    row.className = 'mrow';

    const have = Math.floor(state.resources[res] || 0);
    const label = document.createElement('span');
    label.className = 'mname';
    label.innerHTML = `${info.name}<i>${have}</i>`;

    const bBuy = document.createElement('button');
    bBuy.textContent = `купить ${buyPrice(res) * qty}`;
    bBuy.onclick = () => {
      const r = buy(res, qty);
      note(r.ok ? `${info.name}: −${r.cost} золота` : r.reason, !r.ok);
      render();
    };

    const bSell = document.createElement('button');
    bSell.className = 'sell';
    bSell.textContent = `продать ${sellPrice(res) * qty}`;
    bSell.onclick = () => {
      const r = sell(res, qty);
      note(r.ok ? `${info.name}: +${r.gain} золота` : r.reason, !r.ok);
      render();
    };

    row.append(label, bBuy, bSell);
    el.list.appendChild(row);
  }
}

export function refreshMarket() {
  if (el.root && el.root.style.display === 'flex') render();
}
