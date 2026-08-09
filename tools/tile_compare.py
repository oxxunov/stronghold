#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Макеты для выбора размера тайла.
Рисуются в реальный размер экрана телефона (1080 физических пикселей в ширину),
чтобы можно было судить по картинке, а не по цифрам.
"""

import json, sys, math
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, 'tools')
from gen_sprites_v4 import draw_unit

SCREEN_W = 1080
PANEL_H = 800

TERRAIN = {
    0: (92, 122, 61),    # трава
    1: (107, 87, 60),    # земля
    2: (122, 120, 115),  # скала
    3: (36, 80, 107),    # вода
    4: (74, 83, 64),     # болото
    5: (36, 57, 29),     # лес
    6: (138, 107, 74),   # руда
}

tiles = json.load(open('/tmp/tiles.json'))
MW = MH = 48


def tile_at(x, y):
    x %= MW; y %= MH
    return tiles[y * MW + x]


def render(tile_px, unit_px, grid=True):
    """Кусок карты в реальный размер: tile_px пикселей на клетку."""
    img = Image.new('RGB', (SCREEN_W, PANEL_H), (13, 12, 10))
    d = ImageDraw.Draw(img)

    cols = math.ceil(SCREEN_W / tile_px)
    rows = math.ceil(PANEL_H / tile_px)
    ox, oy = 8, 6                       # смещение по карте

    for ty in range(rows):
        for tx in range(cols):
            c = TERRAIN[tile_at(tx + ox, ty + oy)]
            n = ((tx * 73 + ty * 151) % 7) - 3
            if n > 0:
                c = tuple(int(v * (1 - n * 0.012)) for v in c)
            d.rectangle([tx * tile_px, ty * tile_px,
                         tx * tile_px + tile_px - 1, ty * tile_px + tile_px - 1], fill=c)

    if grid:
        for tx in range(cols + 1):
            d.line([(tx * tile_px, 0), (tx * tile_px, PANEL_H)], fill=(217, 204, 169, 40), width=1)
        for ty in range(rows + 1):
            d.line([(0, ty * tile_px), (SCREEN_W, ty * tile_px)], fill=(217, 204, 169, 40), width=1)

    # --- юниты: колонна на марше плюс несколько работников ---
    scene = [
        ('peasant', 3, 4, 0), ('peasant', 5, 6, 3), ('peasant', 7, 3, 5),
        ('archer', 10, 7, 1), ('archer', 12, 8, 4),
        ('spearman', 6, 10, 2), ('spearman', 8, 10, 2), ('spearman', 10, 10, 2),
        ('swordsman', 14, 5, 6), ('swordsman', 16, 9, 0),
        ('peasant', 2, 9, 7), ('archer', 4, 12, 3), ('spearman', 13, 12, 5),
        ('swordsman', 9, 14, 4), ('peasant', 15, 13, 1),
    ]
    for role, gx, gy, frame in scene:
        sp = draw_unit(role, 'down' if frame % 2 == 0 else 'right', frame)
        if unit_px != 64:
            sp = sp.resize((unit_px, unit_px), Image.NEAREST)
        # ноги юнита стоят на нижней грани его клетки
        px = gx * tile_px + tile_px // 2 - unit_px // 2
        py = gy * tile_px + tile_px - unit_px
        if px > SCREEN_W or py > PANEL_H:
            continue
        img.paste(sp, (px, py), sp)

    return img, cols, rows


def label_bar(text, sub, w=SCREEN_W, h=104):
    bar = Image.new('RGB', (w, h), (26, 24, 19))
    d = ImageDraw.Draw(bar)
    try:
        ft = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 36)
        fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 27)
    except OSError:
        ft = fs = None
    d.text((20, 14), text, fill=(195, 154, 63), font=ft)
    d.text((20, 60), sub, fill=(160, 150, 126), font=fs)
    return bar


variants = [
    ('Вариант А — тайл 64, юнит 64', 64, 64),
    ('Вариант Б — тайл 32, юнит 64', 32, 64),
    ('Вариант В — тайл 32, юнит 32', 32, 32),
]

panels = []
for title, tp, up in variants:
    img, cols, rows = render(tp, up)
    sub = f'видно {cols}×{rows} клеток на экране, юнит {up} px'
    panels.append(label_bar(title, sub))
    panels.append(img)

total_h = sum(p.height for p in panels) + 8 * len(panels)
out = Image.new('RGB', (SCREEN_W, total_h), (13, 12, 10))
y = 0
for p in panels:
    out.paste(p, (0, y))
    y += p.height + 8
out.save('/tmp/tile_compare.png')
print('ok', out.size)
