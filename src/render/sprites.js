// Загрузка и нарезка спрайтов.
// Два источника: наш сгенерированный лист юнитов и наборы CraftPix (объекты, звери).

import { CONFIG } from '../config.js';

const cache = new Map();

export function loadImage(src) {
  if (cache.has(src)) return cache.get(src);
  const img = new Image();
  const p = new Promise((res) => {
    img.onload = () => res(img);
    img.onerror = () => { console.warn('[sprites] не загрузился:', src); res(null); };
  });
  img.src = src;
  const rec = { img, ready: p };
  cache.set(src, rec);
  return rec;
}

/**
 * Лист юнитов: units64.png
 * строки — роль × направление (down, left, up, right), столбцы — кадры ходьбы.
 */
export const UNIT_ROLES = ['peasant', 'archer', 'spearman', 'swordsman'];
export const UNIT_DIRS = ['down', 'left', 'up', 'right'];

export class UnitSheet {
  constructor(src = './assets/sprites/units64.png') {
    this.size = CONFIG.UNIT;
    this.frames = CONFIG.UNIT_FRAMES;
    const rec = loadImage(src);
    this.img = rec.img;
    this.ready = rec.ready;
  }

  /** Координаты кадра в листе */
  frame(role, dir, index) {
    const r = UNIT_ROLES.indexOf(role);
    const d = UNIT_DIRS.indexOf(dir);
    if (r < 0 || d < 0) return null;
    const row = r * UNIT_DIRS.length + d;
    return {
      sx: (index % this.frames) * this.size,
      sy: row * this.size,
      sw: this.size,
      sh: this.size,
    };
  }

  draw(ctx, role, dir, index, x, y, scale = 1) {
    const f = this.frame(role, dir, index);
    if (!f || !this.img.complete || !this.img.naturalWidth) return;
    ctx.drawImage(this.img, f.sx, f.sy, f.sw, f.sh,
                  Math.round(x), Math.round(y),
                  Math.round(f.sw * scale), Math.round(f.sh * scale));
  }
}

/** Одиночные объекты CraftPix: деревья, камни, кусты, руины */
export class ObjectSet {
  constructor(basePath, names) {
    this.items = names.map((n) => {
      const rec = loadImage(`${basePath}/${n}`);
      return { name: n, img: rec.img };
    });
  }

  get(i) { return this.items[i % this.items.length]; }

  draw(ctx, i, cx, footY, scale = 1) {
    const it = this.get(i);
    const img = it.img;
    if (!img.complete || !img.naturalWidth) return;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    // объект стоит основанием на клетке, поэтому якорь — низ по центру
    ctx.drawImage(img, Math.round(cx - w / 2), Math.round(footY - h), Math.round(w), Math.round(h));
  }
}

// Наборы, отобранные из паков. Имена файлов — как в assets/craftpix.
// Одна порода на карту, иначе лес выглядит винегретом.
// 0,1 — крупные (глубина леса), 2,3 — мелкие (кромка), 3 — редкий акцент.
export const TREES = ['Tree1.png', 'Tree2.png', 'Tree3.png', 'Fruit_tree2.png'];
export const ROCKS = ['Rock1_1.png', 'Rock1_2.png', 'Rock2_1.png',
                      'Rock2_2.png', 'Rock3_1.png', 'Rock3_2.png'];
export const BUSHES = ['Bush_blue_flowers2.png', 'Bush_orange_flowers2.png',
                       'Autumn_bush2.png', 'Bush_blue_flowers3.png'];


/** Спрайты зданий: один PNG на здание, имя файла = id из buildings.json */
export class BuildingSprites {
  constructor(base = './assets/sprites/buildings') {
    this.base = base;
    this.map = new Map();
  }

  get(id) {
    if (!this.map.has(id)) this.map.set(id, loadImage(`${this.base}/${id}.png`).img);
    return this.map.get(id);
  }

  /** Рисует здание: низ спрайта совпадает с нижней гранью пятна застройки */
  draw(ctx, id, footLeftX, footBottomY, tilesW, zoom, alpha = 1) {
    const img = this.get(id);
    if (!img.complete || !img.naturalWidth) return;
    const scale = (tilesW * CONFIG.TILE) / img.naturalWidth * zoom;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    if (alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; }
    ctx.drawImage(img, Math.round(footLeftX), Math.round(footBottomY - h),
                  Math.round(w), Math.round(h));
    if (alpha < 1) ctx.restore();
  }
}
