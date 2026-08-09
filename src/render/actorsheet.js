// Спрайты с 16 направлениями и анимациями (мечник из готового пака).
//
// Отличие от наших генерируемых юнитов: там 4 направления и один цикл ходьбы,
// здесь направление берётся от угла движения, а анимация переключается
// состоянием — стоит, идёт, бьёт, падает.

import { loadImage } from './sprites.js';

export const DIRS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                       'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Индекс направления по вектору движения. 0 — север, дальше по часовой. */
export function dirIndex(dx, dy) {
  if (!dx && !dy) return 8;                 // по умолчанию смотрим на юг
  // экранные координаты: y растёт вниз, поэтому север это -y
  let a = Math.atan2(dx, -dy);              // 0 = север, по часовой
  if (a < 0) a += Math.PI * 2;
  return Math.round(a / (Math.PI * 2) * 16) % 16;
}

export class ActorSheet {
  constructor(base) {
    this.base = base;
    this.meta = null;
    this.sheets = {};
    this.ready = fetch(`${base}/meta.json`)
      .then((r) => r.json())
      .then((m) => {
        this.meta = m;
        for (const name of Object.keys(m.anims)) {
          this.sheets[name] = loadImage(`${base}/${name}.png`).img;
        }
        return m;
      })
      .catch(() => null);
  }

  frames(anim) {
    return this.meta?.anims[anim]?.frames || 1;
  }

  fps(anim) {
    return this.meta?.anims[anim]?.fps || 10;
  }

  /**
   * Рисует кадр. footY — экранная координата ступней; спрайт в кадре стоит
   * не на нижней грани, поэтому смещаем на meta.foot.
   */
  draw(ctx, anim, dir, frame, cx, footY, scale) {
    const img = this.sheets[anim] || this.sheets.idle;
    if (!img || !img.complete || !img.naturalWidth || !this.meta) return false;

    const F = this.meta.frame;
    const cols = this.frames(anim);
    const sx = (frame % cols) * F;
    const sy = (dir % 16) * F;

    const size = F * scale;
    const footInFrame = (this.meta.foot || F) * scale;

    ctx.drawImage(img, sx, sy, F, F,
                  Math.round(cx - size / 2), Math.round(footY - footInFrame),
                  Math.round(size), Math.round(size));
    return true;
  }
}

/**
 * Обновление состояния анимации у сущности.
 * Состояния: idle / walk / attack / hurt / death.
 */
export function stepAnim(e, sheet, dt) {
  if (!sheet.meta) return;
  if (e.facing === undefined) e.facing = 8;

  const want = e.animState || 'idle';
  if (e.animName !== want) {
    e.animName = want;
    e.animFrame = 0;
    e.animTime = 0;
  }

  e.animTime = (e.animTime || 0) + dt;
  const step = 1 / sheet.fps(want);
  const total = sheet.frames(want);

  while (e.animTime >= step) {
    e.animTime -= step;
    e.animFrame = (e.animFrame || 0) + 1;

    if (e.animFrame >= total) {
      // разовые анимации доигрывают и возвращают в покой
      if (want === 'attack' || want === 'attack2' || want === 'hurt'
          || want === 'hit' || want === 'dodge' || want === 'parry') {
        e.animState = 'idle';
        e.animFrame = 0;
      } else if (want === 'death') {
        e.animFrame = total - 1;      // застыть на последнем кадре
        e.deathDone = true;
      } else {
        e.animFrame = 0;
      }
    }
  }
}
