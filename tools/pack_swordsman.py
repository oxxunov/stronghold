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

SRC = '/home/claude/sword2'
OUT = 'assets/sprites/swordsman'
FRAME = 64

# порядок 16 направлений по часовой от севера
DIRS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
          'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

# чего нет в исходнике — берём зеркалом
MIRROR = {'W': 'E', 'WNW': 'ENE', 'NW': 'NE', 'NNW': 'NNE'}

# Пакуем ВСЕ анимации из пака и все кадры без прореживания:
# качество важнее размера. Длинные циклы идут на 30 к/с, как в исходнике.
ANIMS = {
    'idle':             {'fps': 8},
    'walk':             {'fps': 15},
    'run':              {'fps': 18},
    'attack':           {'fps': 30},
    'attack2':          {'fps': 30},
    'block':            {'fps': 30},
    'parry':            {'fps': 30},
    'charge':           {'fps': 30},
    'dodge':            {'fps': 30},
    'hit':              {'fps': 30},
    'hurt':             {'fps': 30},
    'death':            {'fps': 30},
    'death_transition': {'fps': 30},
    'victory':          {'fps': 24},
    'cast':             {'fps': 30},
    'interact':         {'fps': 24},
    'use_item':         {'fps': 24},
}

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

    for anim, cfg in ANIMS.items():
        per_dir = {d: frames_of(anim, d) for d in DIRS16}
        count = max((len(v) for v in per_dir.values()), default=0)
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
                # линия ступней берётся ТОЛЬКО по стойке и ходьбе:
                # в смерти тело лежит ниже, и по нему якорь ставить нельзя —
                # иначе все спрайты уедут вверх
                if anim in ('idle', 'walk'):
                    b = im.getbbox()
                    if b:
                        foot_max = max(foot_max, b[3])

        sheet.save(os.path.join(OUT, f'{anim}.png'))
        meta['anims'][anim] = {'frames': count, 'fps': cfg['fps']}

    # где у спрайта ступни: ниже этой линии в кадре пусто
    meta['foot'] = foot_max
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return meta


if __name__ == '__main__':
    m = build()
    print('готово:', {k: v['frames'] for k, v in m['anims'].items()}, 'ступни на', m['foot'])
