#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Упаковка мечника из папок в атласы.

Исходник: 1500 отдельных PNG по папкам анимация/направление. Грузить их
в браузер по одному нельзя, поэтому склеиваем в атлас на анимацию:
строка — направление, столбец — кадр.

Направлений в исходнике 12: западной четверти нет, её получаем зеркалом
восточной. На выходе полные 16.

Выход: assets/sprites/swordsman/<anim>.png + meta.json
"""

import json, os, shutil
from PIL import Image

SRC = '/home/claude/sword/SWORDSMAN_64x64_12DIRECTIONS_ACTUAL'
OUT = 'assets/sprites/swordsman'
FRAME = 64

# порядок 16 направлений по часовой от севера
DIRS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
          'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

# чего нет в исходнике — берём зеркалом
MIRROR = {'W': 'E', 'WNW': 'ENE', 'NW': 'NE', 'NNW': 'NNE'}

# что реально нужно игре
ANIMS = ['idle', 'walk', 'attack', 'hurt', 'death']


def frames_of(anim, d):
    src_dir = MIRROR.get(d, d)
    path = os.path.join(SRC, anim, src_dir)
    if not os.path.isdir(path):
        return []
    files = sorted(f for f in os.listdir(path) if f.endswith('.png'))
    out = []
    for f in files:
        im = Image.open(os.path.join(path, f)).convert('RGBA')
        if d in MIRROR:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        out.append(im)
    return out


def build():
    os.makedirs(OUT, exist_ok=True)
    meta = {'frame': FRAME, 'dirs': DIRS16, 'anims': {}}
    foot_max = 0

    for anim in ANIMS:
        per_dir = {d: frames_of(anim, d) for d in DIRS16}
        count = max(len(v) for v in per_dir.values())
        if not count:
            continue

        sheet = Image.new('RGBA', (FRAME * count, FRAME * len(DIRS16)), (0, 0, 0, 0))
        for row, d in enumerate(DIRS16):
            fr = per_dir[d]
            for col in range(count):
                im = fr[min(col, len(fr) - 1)] if fr else None
                if im is None:
                    continue
                sheet.paste(im, (col * FRAME, row * FRAME))
                b = im.getbbox()
                if b:
                    foot_max = max(foot_max, b[3])

        sheet.save(os.path.join(OUT, f'{anim}.png'))
        meta['anims'][anim] = {'frames': count, 'fps': 10 if anim != 'idle' else 4}

    # где у спрайта ступни: ниже этой линии в кадре пусто
    meta['foot'] = foot_max
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return meta


if __name__ == '__main__':
    m = build()
    print('готово:', {k: v['frames'] for k, v in m['anims'].items()}, 'ступни на', m['foot'])
