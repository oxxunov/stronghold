// Сетка карты: тайлы местности, проходимость, занятость клеток.
// Здания на этапе 1 будут писать в occupied[], поиск пути его уже учитывает.

import { CONFIG } from '../config.js';

export const TERRAIN = {
  GRASS:  { id: 0, name: 'Трава',   color: '#74a84c', walk: true,  build: ['farm','any'] },
  DIRT:   { id: 1, name: 'Земля',   color: '#a68052', walk: true,  build: ['any'] },
  ROCK:   { id: 2, name: 'Скала',   color: '#949494', walk: false, build: ['quarry'] },
  WATER:  { id: 3, name: 'Вода',    color: '#3a80ba', walk: false, build: [] },
  MARSH:  { id: 4, name: 'Болото',  color: '#607848', walk: true,  build: ['pitch'] },
  FOREST: { id: 5, name: 'Лес',     color: '#487a3a', walk: false, build: ['woodcutter'] },
  ORE:    { id: 6, name: 'Руда',    color: '#967c5c', walk: false, build: ['ironmine'] },
};

const BY_ID = Object.values(TERRAIN).sort((a, b) => a.id - b.id);
export const terrainById = (id) => BY_ID[id];

// --- Детерминированный ГПСЧ, чтобы карта повторялась по сиду ---
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

// Простой value-noise: решётка случайных значений + сглаживание
function noiseField(w, h, scale, rand) {
  const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rand();

  const out = new Float32Array(w * h);
  const smooth = (t) => t * t * (3 - 2 * t);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / scale, fy = y / scale;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0);
      const a = g[y0 * gw + x0],       b = g[y0 * gw + x0 + 1];
      const c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

export class GameMap {
  constructor(w = CONFIG.MAP_W, h = CONFIG.MAP_H, seed = 20260808) {
    this.w = w;
    this.h = h;
    this.seed = seed;
    this.tiles = new Uint8Array(w * h);     // id местности
    this.occupied = new Uint8Array(w * h);  // 0 свободно, 1 занято зданием
    this.walls = new Uint8Array(w * h);     // 0 нет, 1 частокол, 2 камень
    this.passable = new Uint8Array(w * h);  // клетка занята зданием, но проходима (ворота)
    this.moat = new Uint8Array(w * h);      // 0 нет, 1 сухой ров, 2 смоляной
    this.wallHp = new Uint16Array(w * h);   // прочность стены в клетке
    this.crossing = new Uint8Array(w * h);  // лестница или мостик: через стену можно перелезть
    this.decor = [];
    this.stumps = [];
    this.generate(seed);
    this.buildDecor();
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : TERRAIN.WATER.id; }

  /** Проходима ли сама местность, без учёта построек */
  walkableTerrain(x, y) {
    if (!this.inBounds(x, y)) return false;
    return terrainById(this.tiles[this.idx(x, y)]).walk;
  }

  /**
   * Во сколько раз клетка «дороже» обычной. Ров не перекрывает путь,
   * а вязнет: обходить его выгоднее, чем лезть напролом.
   */
  moveCost(x, y) {
    if (!this.inBounds(x, y)) return 1;
    const i = this.idx(x, y);
    if (this.walls[i] && this.crossing[i]) return 6;   // перелезать долго
    const m = this.moat[i];
    return m === 1 ? 4 : (m === 2 ? 3 : 1);
  }

  /** Можно ли пройти по клетке пешком */
  walkable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.walls[i] && !this.crossing[i]) return false;   // стена, если нет переправы
    if (this.occupied[i] && !this.passable[i]) return false;
    return terrainById(this.tiles[i]).walk;
  }

  generate(seed) {
    const rand = rng(seed);
    const w = this.w, h = this.h;
    const height  = noiseField(w, h, 9, rand);
    const wet     = noiseField(w, h, 7, rand);
    const veg     = noiseField(w, h, 5, rand);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.idx(x, y);
        const hgt = height[i], wt = wet[i], vg = veg[i];
        let t;

        if (hgt > 0.74)                 t = TERRAIN.ROCK.id;
        else if (wt > 0.78)             t = TERRAIN.WATER.id;
        else if (wt > 0.66)             t = TERRAIN.MARSH.id;
        else if (vg > 0.58 && hgt < .7) t = TERRAIN.FOREST.id;
        else if (hgt < 0.28)            t = TERRAIN.DIRT.id;
        else                            t = TERRAIN.GRASS.id;

        this.tiles[i] = t;
      }
    }

    // Жилы железа — редкие пятна внутри скал
    let veins = 0;
    for (let n = 0; n < 400 && veins < 5; n++) {
      const cx = 2 + Math.floor(rand() * (w - 4));
      const cy = 2 + Math.floor(rand() * (h - 4));
      if (this.tiles[this.idx(cx, cy)] !== TERRAIN.ROCK.id) continue;
      veins++;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (this.inBounds(cx + dx, cy + dy) && rand() > .35)
            this.tiles[this.idx(cx + dx, cy + dy)] = TERRAIN.ORE.id;
    }

    this.smooth(2);

    // Ровная площадка в центре — там встанет донжон на этапе 1
    const cx = w >> 1, cy = h >> 1;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++)
        if (this.inBounds(cx + dx, cy + dy))
          this.tiles[this.idx(cx + dx, cy + dy)] = TERRAIN.GRASS.id;
  }

  /**
   * Сглаживание: клетка, у которой почти все соседи другого типа, меняет тип.
   * Убирает одиночные вкрапления, из-за которых карта выглядит рябой.
   */
  smooth(passes = 1) {
    for (let p = 0; p < passes; p++) {
      const src = this.tiles.slice();
      for (let y = 1; y < this.h - 1; y++) {
        for (let x = 1; x < this.w - 1; x++) {
          const i = this.idx(x, y);
          const counts = {};
          let best = src[i], bestN = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const t = src[this.idx(x + dx, y + dy)];
              counts[t] = (counts[t] || 0) + 1;
              if (counts[t] > bestN) { bestN = counts[t]; best = t; }
            }
          }
          if (bestN >= 6) this.tiles[i] = best;
        }
      }
    }
  }

  /** Насколько клетка утоплена внутрь своей зоны: 0 — край, больше — глубина */
  depthMap(typeId) {
    const d = new Int16Array(this.w * this.h).fill(-1);
    const queue = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        if (this.tiles[i] !== typeId) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++)
          for (let dx = -1; dx <= 1 && !edge; dx++)
            if (!this.inBounds(x + dx, y + dy) || this.tiles[this.idx(x + dx, y + dy)] !== typeId)
              edge = true;
        if (edge) { d[i] = 0; queue.push(i); }
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % this.w, y = (i / this.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (this.tiles[ni] !== typeId || d[ni] >= 0) continue;
        d[ni] = d[i] + 1;
        queue.push(ni);
      }
    }
    return d;
  }

  /** Декорации: что и где стоит поверх тайла. Заполняется после генерации. */
  buildDecor(seed = this.seed ^ 0x9e37) {
    const rand = rng(seed);
    this.decor = [];

    // занятость для «синего шума»: не даём объектам садиться друг на друга
    const taken = new Uint8Array(this.w * this.h);
    const free = (x, y, r) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (this.inBounds(nx, ny) && taken[this.idx(nx, ny)]) return false;
        }
      return true;
    };
    const mark = (x, y) => { taken[this.idx(x, y)] = 1; };

    // перебираем клетки в случайном порядке, иначе объекты лягут рядами
    const order = [];
    for (let i = 0; i < this.w * this.h; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }

    const forestDepth = this.depthMap(TERRAIN.FOREST.id);
    const rockDepth = this.depthMap(TERRAIN.ROCK.id);

    for (const i of order) {
      const x = i % this.w, y = (i / this.w) | 0;
      const t = this.tiles[i];

      if (t === TERRAIN.FOREST.id) {
        const deep = forestDepth[i];
        // в глубине леса деревья крупные, по кромке — мелкие: край читается мягко
        const big = deep >= 1 && rand() > 0.52;
        // крупные держат дистанцию, мелкие могут стоять вплотную — так кроны смыкаются
        if (!free(x, y, big ? 1 : 0)) continue;
        this.decor.push({
          kind: 'tree', x, y,
          // 0,1 — крупные; 2 — мелкая; 3 — плодовая, редкий акцент
          v: rand() > 0.88 ? 3 : (big ? ((rand() * 2) | 0) : 2),
          s: big ? 0.9 + rand() * 0.22 : 0.62 + rand() * 0.2,
        });
        mark(x, y);

      } else if (t === TERRAIN.ROCK.id) {
        if (rockDepth[i] > 1 && rand() > 0.5) continue;   // в центре скалы пусто, камни по кромке
        if (!free(x, y, 1)) continue;
        this.decor.push({
          kind: 'rock', x, y,
          v: (rand() * 6) | 0,
          s: 0.7 + rand() * 0.25,
        });
        mark(x, y);

      } else if (t === TERRAIN.GRASS.id) {
        // кусты только у кромки леса, небольшими группами, а не по всему полю
        let nearForest = false;
        for (let dy = -1; dy <= 1 && !nearForest; dy++)
          for (let dx = -1; dx <= 1 && !nearForest; dx++)
            if (this.inBounds(x + dx, y + dy) &&
                this.tiles[this.idx(x + dx, y + dy)] === TERRAIN.FOREST.id) nearForest = true;
        if (!nearForest || rand() > 0.55) continue;
        if (!free(x, y, 1)) continue;
        this.decor.push({ kind: 'bush', x, y, v: (rand() * 4) | 0, s: 0.75 + rand() * 0.2 });
        mark(x, y);
      }
    }

    return this.decor;
  }

  /** Случайная проходимая клетка — нужна для стресс-теста и спавна */
  randomWalkable(rand = Math.random) {
    for (let i = 0; i < 400; i++) {
      const x = Math.floor(rand() * this.w);
      const y = Math.floor(rand() * this.h);
      if (this.walkable(x, y)) return { x, y };
    }
    return { x: this.w >> 1, y: this.h >> 1 };
  }
}
