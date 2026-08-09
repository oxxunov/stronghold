#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор пиксельных персонажей для Stronghold Mobile.
Спрайты строятся кодом: тело собирается из частей, палитра и снаряжение
задаются в ROLES. Меняешь цифры — получаешь другого юнита, ничего не перерисовывая.

Размер кадра: 16x16. Направления: down, up, left, right. Кадры ходьбы: 4.
"""

from PIL import Image

W = H = 16
DIRS = ['down', 'left', 'up', 'right']
RU_DIR = {'down': 'вниз', 'left': 'влево', 'up': 'вверх', 'right': 'вправо'}
FRAMES = 4  # стойка, шаг левой, стойка, шаг правой

# ---------------------------------------------------------------- палитры
SKIN   = (214, 160, 116)
SKIN_D = (168, 118,  82)
OUT    = ( 26,  20,  15)   # обводка

ROLES = {
    'peasant': {
        'name': 'Крестьянин',
        'cloth':  (150, 122,  74), 'cloth_d': (108,  86,  50),
        'hair':   (104,  72,  40),
        'legs':   ( 78,  62,  42),
        'boots':  ( 46,  36,  26),
        'helmet': None, 'weapon': None,
    },
    'archer': {
        'name': 'Лучник',
        'cloth':  ( 86, 108,  62), 'cloth_d': ( 58,  76,  42),
        'hair':   ( 70,  48,  28),
        'legs':   ( 66,  56,  40),
        'boots':  ( 42,  34,  24),
        'helmet': None, 'weapon': 'bow',
    },
    'spearman': {
        'name': 'Копейщик',
        'cloth':  (122,  62,  52), 'cloth_d': ( 88,  42,  36),
        'hair':   ( 60,  44,  28),
        'legs':   ( 62,  54,  44),
        'boots':  ( 40,  32,  24),
        'helmet': (150, 152, 158), 'weapon': 'spear',
    },
    'swordsman': {
        'name': 'Мечник',
        'cloth':  ( 92,  96, 104), 'cloth_d': ( 64,  68,  76),
        'hair':   ( 60,  44,  28),
        'legs':   ( 70,  72,  78),
        'boots':  ( 40,  36,  32),
        'helmet': (176, 178, 184), 'weapon': 'sword',
    },
}


class Sprite:
    def __init__(self):
        self.px = {}

    def set(self, x, y, c):
        if c is None:
            return
        if 0 <= x < W and 0 <= y < H:
            self.px[(x, y)] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    def to_image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        p = im.load()
        for (x, y), c in self.px.items():
            p[x, y] = (*c, 255)
        return im


def outline(s):
    """Обводка: тёмный пиксель вокруг каждого непустого, если место свободно."""
    filled = set(s.px.keys())
    ring = set()
    for (x, y) in filled:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in filled and 0 <= n[0] < W and 0 <= n[1] < H:
                ring.add(n)
    for n in ring:
        s.px[n] = OUT


def draw_unit(role, direction, frame):
    r = ROLES[role]
    s = Sprite()

    # фазы ходьбы: 0 и 2 — стойка, 1 — шаг левой, 3 — шаг правой
    phase = [0, 1, 0, -1][frame % FRAMES]
    bob = 1 if frame % 2 == 1 else 0        # корпус чуть приседает на шаге

    HEAD_Y = 1 + bob        # голова: HEAD_Y .. HEAD_Y+5
    TORSO_Y = HEAD_Y + 6    # туловище: TORSO_Y .. 11
    LEG_Y = 12              # ноги: 12..14, сапоги 15

    # ---------------- ноги ----------------
    lx, rx = 6, 9           # левая нога cols 6-7, правая 9-10
    if phase == 1:  lx, rx = 5, 9
    if phase == -1: lx, rx = 6, 10

    s.rect(lx, LEG_Y, lx + 1, 14, r['legs'])
    s.rect(rx, LEG_Y, rx + 1, 14, r['legs'])
    s.rect(lx, 15, lx + 1, 15, r['boots'])
    s.rect(rx, 15, rx + 1, 15, r['boots'])

    # ---------------- туловище ----------------
    s.rect(5, TORSO_Y, 10, 11, r['cloth'])
    s.rect(5, 11, 10, 11, r['cloth_d'])              # подол в тени
    if direction == 'left':
        s.rect(5, TORSO_Y, 5, 11, r['cloth_d'])
    if direction == 'right':
        s.rect(10, TORSO_Y, 10, 11, r['cloth_d'])

    # ---------------- руки ----------------
    swing_l = 1 if phase == -1 else 0
    swing_r = 1 if phase == 1 else 0
    if direction in ('down', 'up'):
        s.rect(4, TORSO_Y + swing_l, 4, TORSO_Y + 2 + swing_l, r['cloth'])
        s.set(4, TORSO_Y + 3 + swing_l, SKIN)
        s.rect(11, TORSO_Y + swing_r, 11, TORSO_Y + 2 + swing_r, r['cloth'])
        s.set(11, TORSO_Y + 3 + swing_r, SKIN)
    elif direction == 'left':
        s.rect(4, TORSO_Y + swing_l, 4, TORSO_Y + 2 + swing_l, r['cloth_d'])
        s.set(4, TORSO_Y + 3 + swing_l, SKIN)
    else:
        s.rect(11, TORSO_Y + swing_r, 11, TORSO_Y + 2 + swing_r, r['cloth_d'])
        s.set(11, TORSO_Y + 3 + swing_r, SKIN)

    # ---------------- голова ----------------
    hy = HEAD_Y
    s.rect(5, hy, 10, hy + 5, SKIN)

    if direction == 'down':
        s.rect(5, hy, 10, hy + 1, r['hair'])
        s.set(5, hy + 2, r['hair']); s.set(10, hy + 2, r['hair'])
        s.set(6, hy + 3, OUT); s.set(9, hy + 3, OUT)          # глаза
        s.rect(7, hy + 5, 8, hy + 5, SKIN_D)                  # рот
    elif direction == 'up':
        s.rect(5, hy, 10, hy + 4, r['hair'])
    elif direction == 'left':
        s.rect(5, hy, 10, hy + 1, r['hair'])
        s.rect(9, hy, 10, hy + 4, r['hair'])                  # затылок справа
        s.set(6, hy + 3, OUT)                                 # один глаз
        s.set(4, hy + 3, SKIN)                                # нос
    else:
        s.rect(5, hy, 10, hy + 1, r['hair'])
        s.rect(5, hy, 6, hy + 4, r['hair'])
        s.set(9, hy + 3, OUT)
        s.set(11, hy + 3, SKIN)

    # ---------------- шлем ----------------
    if r['helmet']:
        dark = tuple(int(c * 0.68) for c in r['helmet'])
        s.rect(4, hy - 1, 11, hy + 1, r['helmet'])
        s.rect(4, hy + 2, 11, hy + 2, dark)
        if direction == 'down':
            s.rect(7, hy + 2, 8, hy + 4, r['helmet'])         # наносник
            s.set(7, hy + 4, dark); s.set(8, hy + 4, dark)

    # ---------------- оружие ----------------
    wp = r['weapon']
    side_x = 3 if direction == 'left' else 12
    if wp == 'spear':
        s.rect(side_x, 2, side_x, 15, (126, 96, 58))
        s.rect(side_x, 0, side_x, 1, (200, 204, 210))
    elif wp == 'sword':
        s.rect(side_x, 4, side_x, 10, (198, 202, 210))
        s.rect(side_x - 1, 11, side_x + 1, 11, (110, 92, 60))
        s.rect(side_x, 12, side_x, 13, (110, 92, 60))
    elif wp == 'bow':
        inner = side_x + (1 if direction == 'left' else -1)
        s.rect(side_x, 4, side_x, 12, (132, 100, 58))
        s.set(inner, 3, (132, 100, 58))
        s.set(inner, 13, (132, 100, 58))

    outline(s)
    return s.to_image()


def build_sheet(path):
    roles = list(ROLES.keys())
    sheet = Image.new('RGBA', (W * FRAMES, H * len(DIRS) * len(roles)), (0, 0, 0, 0))
    row = 0
    for role in roles:
        for d in DIRS:
            for f in range(FRAMES):
                sheet.paste(draw_unit(role, d, f), (f * W, row * H))
            row += 1
    sheet.save(path)
    return sheet


def build_preview(path, scale=10):
    """Крупный лист для просмотра на телефоне, с подписями."""
    roles = list(ROLES.keys())
    pad, label_w, header = 8, 62, 34
    cell = W * scale
    img_w = label_w + (cell + pad) * FRAMES * 1 + pad
    img_w = label_w + FRAMES * (cell + pad) + pad
    img_h = header + len(roles) * (len(DIRS) * (cell + pad) + 22) + pad

    canvas = Image.new('RGB', (img_w, img_h), (20, 19, 15))
    from PIL import ImageDraw, ImageFont
    try:
        font_t = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
        font_s = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    except OSError:
        font_t = font_s = None
    d = ImageDraw.Draw(canvas)
    d.text((pad, 6), 'Stronghold Mobile — пиксельные юниты 16x16', fill=(195, 154, 63), font=font_t)

    y = header
    for role in roles:
        d.text((pad, y), f"{ROLES[role]['name']}", fill=(217, 204, 169), font=font_t)
        y += 22
        for di, dr in enumerate(DIRS):
            x = label_w + pad
            for f in range(FRAMES):
                sp = draw_unit(role, dr, f).resize((cell, cell), Image.NEAREST)
                bg = Image.new('RGB', (cell, cell), (44, 52, 34) if di % 2 == 0 else (38, 45, 30))
                bg.paste(sp, (0, 0), sp)
                canvas.paste(bg, (x, y))
                x += cell + pad
            d.text((pad, y + cell // 2 - 8), RU_DIR[dr], fill=(142, 131, 106), font=font_s)
            y += cell + pad
        y += 8

    canvas.save(path)
    return canvas


if __name__ == '__main__':
    build_sheet('assets/sprites/units.png')
    build_preview('preview_units.png')
    print('готово')
