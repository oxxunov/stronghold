#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор пиксельных юнитов v2 — 24x24.

Что изменилось против v1:
  * холст 24x24 — хватает места на плечи, пояс, кисти рук, обувь
  * автоматическая светотень: свет сверху, пиксель без соседа сверху светлеет,
    без соседа снизу — темнеет. Объём появляется сам, вручную не красим
  * обводка не чёрная, а затемнённый цвет самого материала — так делают
    в хорошем пиксель-арте, силуэт не выглядит наклейкой
  * профиль в бок уже фронтального силуэта, плечо разворачивается
  * снаряжение: капюшон, шлем с наносником, колчан, щит, пояс

Направления: down, left, up, right. Кадры ходьбы: 4.
"""

from PIL import Image, ImageDraw, ImageFont

W = H = 24
FRAMES = 4
DIRS = ['down', 'left', 'up', 'right']
RU_DIR = {'down': 'вниз', 'left': 'влево', 'up': 'вверх', 'right': 'вправо'}

SKIN = (219, 168, 122)


def lighten(c, k=1.20):
    return tuple(min(255, int(v * k)) for v in c)


def darken(c, k=0.68):
    return tuple(int(v * k) for v in c)


ROLES = {
    'peasant': {
        'name': 'Крестьянин',
        'cloth': (156, 124, 76),
        'legs':  (94, 76, 52),
        'boots': (62, 46, 32),
        'hair':  (112, 74, 40),
        'belt':  (74, 52, 32),
        'head':  'hair',
        'weapon': None,
        'shield': False,
    },
    'archer': {
        'name': 'Лучник',
        'cloth': (92, 116, 66),
        'legs':  (78, 66, 46),
        'boots': (54, 42, 30),
        'hair':  (74, 52, 30),
        'belt':  (72, 54, 34),
        'head':  'hood',
        'weapon': 'bow',
        'shield': False,
    },
    'spearman': {
        'name': 'Копейщик',
        'cloth': (132, 66, 54),
        'legs':  (76, 64, 50),
        'boots': (52, 40, 28),
        'hair':  (66, 46, 28),
        'belt':  (70, 50, 32),
        'head':  'kettle',
        'weapon': 'spear',
        'shield': False,
    },
    'swordsman': {
        'name': 'Мечник',
        'cloth': (128, 132, 140),
        'legs':  (86, 88, 96),
        'boots': (50, 46, 42),
        'hair':  (62, 44, 26),
        'belt':  (68, 48, 30),
        'head':  'nasal',
        'weapon': 'sword',
        'shield': True,
    },
}

STEEL = (168, 172, 180)
WOOD = (128, 96, 56)
LEATHER = (96, 68, 42)


class Sprite:
    """Холст с материалами. Цвет пишется как есть, тени накладываются потом."""

    def __init__(self):
        self.px = {}
        self.shadow = set()
        self.noshade = set()   # пиксели, которые не трогает светотень (глаза, лезвия)

    def set(self, x, y, c, shade=True):
        if c is None or not (0 <= x < W and 0 <= y < H):
            return
        self.px[(x, y)] = c
        if not shade:
            self.noshade.add((x, y))
        else:
            self.noshade.discard((x, y))

    def rect(self, x0, y0, x1, y1, c, shade=True):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for x in range(min(x0, x1), max(x0, x1) + 1):
                self.set(x, y, c, shade)

    def shade(self):
        """Свет сверху-слева: верхняя кромка светлее, нижняя темнее."""
        out = dict(self.px)
        for (x, y), c in self.px.items():
            if (x, y) in self.noshade:
                continue
            up_empty = (x, y - 1) not in self.px
            down_empty = (x, y + 1) not in self.px
            if up_empty and not down_empty:
                out[(x, y)] = lighten(c, 1.16)
            elif down_empty and not up_empty:
                out[(x, y)] = darken(c, 0.78)
            elif (x - 1, y) not in self.px:
                out[(x, y)] = lighten(c, 1.07)
            elif (x + 1, y) not in self.px:
                out[(x, y)] = darken(c, 0.88)
        self.px = out

    def outline(self):
        """Обводка цветом материала, а не чёрным — силуэт мягче и живее."""
        ring = {}
        for (x, y), c in self.px.items():
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n in self.px or not (0 <= n[0] < W and 0 <= n[1] < H):
                    continue
                cand = darken(c, 0.34)
                prev = ring.get(n)
                if prev is None or sum(cand) < sum(prev):
                    ring[n] = cand
        self.px.update(ring)

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        p = im.load()
        for (x, y) in self.shadow:
            if 0 <= x < W and 0 <= y < H and (x, y) not in self.px:
                p[x, y] = (0, 0, 0, 70)
        for (x, y), c in self.px.items():
            p[x, y] = (*c, 255)
        return im


# --------------------------------------------------------------- построение
def draw_unit(role_id, direction, frame):
    """Геометрия 24x24:
       голова 7 рядов / шея / плечи шире торса / руки отдельными колонками /
       ноги 5 рядов с раздельным шагом / тень под ногами."""
    r = ROLES[role_id]
    s = Sprite()

    phase = [0, 1, 0, -1][frame % FRAMES]
    bob = 1 if frame % 2 == 1 else 0
    side = direction in ('left', 'right')
    flip = direction == 'left'

    HT = 2 + bob            # верх головы
    HB = HT + 6             # низ головы
    NECK = HB + 1
    SH = NECK + 1           # плечи
    TB = 16                 # низ торса
    LT = 17                 # верх ног

    # торс уже плеч — так силуэт читается
    if side:
        tx0, tx1 = 10, 14
        sx0, sx1 = 9, 15
        hx0, hx1 = 10, 14
    else:
        tx0, tx1 = 9, 14
        sx0, sx1 = 8, 15
        hx0, hx1 = 9, 14

    # ---- тень ----
    for x in range(tx0, tx1 + 1):
        s.shadow.add((x, 23))
    s.shadow.add((tx0 - 1, 23)); s.shadow.add((tx1 + 1, 23))

    # ---- ноги ----
    if side:
        legs = [(10, 1 if phase == 1 else 0), (12, 1 if phase == -1 else 0)]
    else:
        legs = [(9, 1 if phase == 1 else 0), (13, 1 if phase == -1 else 0)]

    for lx, raised in legs:
        top = LT
        bot = 20 if raised else 21
        s.rect(lx, top, lx + 1, bot, r['legs'])
        s.rect(lx, bot + 1, lx + 1 + (1 if not side else 0), bot + 1, r['boots'])

    # ---- торс ----
    s.rect(tx0, SH, tx1, TB, r['cloth'])
    s.rect(sx0, SH, sx1, SH + 1, r['cloth'])                 # плечи
    s.rect(sx0, SH, sx1, SH, lighten(r['cloth'], 1.12))
    s.rect(tx1, SH + 2, tx1, TB, darken(r['cloth'], 0.86))   # складка с теневой стороны
    s.rect(tx0, 14, tx1, 14, r['belt'])                      # пояс
    s.set(12 if not side else 12, 14, lighten(r['belt'], 1.55))

    # ---- руки ----
    drop_l = 1 if phase == -1 else 0
    drop_r = 1 if phase == 1 else 0
    if side:
        s.rect(sx1, SH + 2 + drop_r, sx1, SH + 5 + drop_r, r['cloth'])
        s.set(sx1, SH + 6 + drop_r, SKIN)
    else:
        s.rect(sx0, SH + 2 + drop_l, sx0, SH + 5 + drop_l, r['cloth'])
        s.set(sx0, SH + 6 + drop_l, SKIN)
        s.rect(sx1, SH + 2 + drop_r, sx1, SH + 5 + drop_r, r['cloth'])
        s.set(sx1, SH + 6 + drop_r, SKIN)

    # ---- шея ----
    s.rect(11, NECK, 12, NECK, darken(SKIN, 0.78))

    # ---- голова ----
    s.rect(hx0, HT + 1, hx1, HB, SKIN)
    s.rect(hx0 + 1, HT, hx1 - 1, HT, SKIN)

    head, hair = r['head'], r['hair']

    if head == 'hair':
        s.rect(hx0, HT + 1, hx1, HT + 2, hair)
        s.rect(hx0 + 1, HT, hx1 - 1, HT, hair)
        s.set(hx0, HT + 3, hair); s.set(hx1, HT + 3, hair)
    elif head == 'hood':
        hood = darken(r['cloth'], 0.80)
        s.rect(hx0 - 1, HT + 1, hx1 + 1, HT + 2, hood)
        s.rect(hx0, HT, hx1, HT, hood)
        s.rect(hx0 - 1, HT + 3, hx0, NECK, hood)             # ткань по бокам лица
        s.rect(hx1, HT + 3, hx1 + 1, NECK, hood)
        s.rect(hx0 + 1, HT + 3, hx1 - 1, HB, SKIN)           # проём капюшона
    elif head == 'kettle':
        s.rect(hx0, HT, hx1, HT + 2, STEEL)
        s.rect(hx0 + 1, HT - 1, hx1 - 1, HT - 1, STEEL)
        s.rect(hx0 - 1, HT + 3, hx1 + 1, HT + 3, darken(STEEL, 0.72))   # поля шлема
    elif head == 'nasal':
        s.rect(hx0, HT, hx1, HT + 2, STEEL)
        s.rect(hx0 + 1, HT - 1, hx1 - 1, HT - 1, STEEL)
        s.rect(hx0, HT + 3, hx0, HB - 1, darken(STEEL, 0.78))
        s.rect(hx1, HT + 3, hx1, HB - 1, darken(STEEL, 0.78))

    # ---- лицо ----
    ey = HT + 4
    if direction == 'down':
        s.set(hx0 + 1, ey, (44, 32, 24), shade=False)
        s.set(hx1 - 1, ey, (44, 32, 24), shade=False)
        s.rect(11, ey + 2, 12, ey + 2, darken(SKIN, 0.72))
        if head == 'nasal':
            s.rect(11, HT + 3, 12, ey + 1, STEEL)
    elif direction == 'up':
        if head == 'hair':
            s.rect(hx0, HT, hx1, HB, hair)
        elif head == 'hood':
            s.rect(hx0 - 1, HT, hx1 + 1, HB, darken(r['cloth'], 0.76))
        else:
            s.rect(hx0, HT + 3, hx1, HB, darken(STEEL, 0.70))
    else:
        if head == 'hair':
            s.rect(hx0, HT + 1, hx0, HB - 2, hair)           # затылок
        s.set(hx1 - 1, ey, (44, 32, 24), shade=False)
        s.set(hx1 + 1, ey + 1, SKIN)                         # нос в профиль

    # ---- оружие ----
    wx = 17
    if r['weapon'] == 'bow':
        arc = [(wx - 1, 6), (wx, 7), (wx, 8), (wx + 1, 9), (wx + 1, 10),
               (wx + 1, 11), (wx + 1, 12), (wx, 13), (wx, 14), (wx - 1, 15)]
        for (x, y) in arc:
            s.set(x, y, WOOD)
        for y in range(7, 15):
            s.set(wx - 1, y, (226, 216, 194), shade=False)   # тетива
        if direction == 'up':
            s.rect(7, 9, 8, 15, LEATHER)                     # колчан за спиной
            s.rect(7, 8, 8, 8, (196, 190, 172), shade=False)
    elif r['weapon'] == 'spear':
        s.rect(wx, 3, wx, 22, WOOD)
        s.rect(wx, 1, wx, 2, STEEL, shade=False)
        s.set(wx - 1, 3, darken(STEEL, 0.75), shade=False)
        s.set(wx + 1, 3, darken(STEEL, 0.75), shade=False)
    elif r['weapon'] == 'sword':
        s.rect(wx, 6, wx, 13, (208, 212, 220), shade=False)
        s.set(wx, 5, (170, 176, 188), shade=False)
        s.rect(wx - 1, 14, wx + 1, 14, (124, 98, 60))        # гарда
        s.rect(wx, 15, wx, 16, LEATHER)
        s.set(wx, 17, (178, 146, 74))                        # навершие

    if r['shield'] and direction != 'up':
        px = 6
        s.rect(px, 11, px + 1, 17, (112, 74, 46))
        s.rect(px, 12, px + 1, 16, (150, 102, 62))
        s.rect(px, 14, px + 1, 14, STEEL)

    s.shade()
    s.outline()
    im = s.image()
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    return im


# --------------------------------------------------------------- вывод
def build_sheet(path):
    roles = list(ROLES)
    sheet = Image.new('RGBA', (W * FRAMES, H * len(DIRS) * len(roles)), (0, 0, 0, 0))
    row = 0
    for role in roles:
        for d in DIRS:
            for f in range(FRAMES):
                sheet.paste(draw_unit(role, d, f), (f * W, row * H))
            row += 1
    sheet.save(path)


def build_preview(path, scale=7):
    roles = list(ROLES)
    pad, label_w, header = 8, 66, 34
    cell = W * scale
    img_w = label_w + FRAMES * (cell + pad) + pad
    img_h = header + len(roles) * (len(DIRS) * (cell + pad) + 24) + pad
    canvas = Image.new('RGB', (img_w, img_h), (20, 19, 15))
    d = ImageDraw.Draw(canvas)
    try:
        ft = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
        fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    except OSError:
        ft = fs = None

    d.text((pad, 8), 'Пиксельные юниты 24x24 — версия 2', fill=(195, 154, 63), font=ft)
    y = header
    for role in roles:
        d.text((pad, y), ROLES[role]['name'], fill=(217, 204, 169), font=ft)
        y += 22
        for di, dr in enumerate(DIRS):
            x = label_w
            d.text((pad, y + cell // 2 - 8), RU_DIR[dr], fill=(142, 131, 106), font=fs)
            for f in range(FRAMES):
                sp = draw_unit(role, dr, f).resize((cell, cell), Image.NEAREST)
                bg = Image.new('RGB', (cell, cell), (58, 74, 44) if di % 2 == 0 else (50, 65, 38))
                bg.paste(sp, (0, 0), sp)
                canvas.paste(bg, (x, y))
                x += cell + pad
            y += cell + pad
        y += 10
    canvas.save(path)


if __name__ == '__main__':
    build_sheet('assets/sprites/units24.png')
    build_preview('preview_units_v2.png')
    print('готово')
