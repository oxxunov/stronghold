#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор зданий — вид сверху с небольшим наклоном, как в Stronghold.

Каждое здание: пятно застройки в клетках (tw x th) плюс запас по высоте на
крышу. Якорь — низ спрайта совпадает с нижней гранью пятна, поэтому здание
садится в сортировку по глубине наравне с деревьями и юнитами.

Выход: assets/sprites/buildings/<id>.png
"""

import os, math
from PIL import Image, ImageDraw

T = 32
ROOF_OVER = 10          # свес крыши выше пятна застройки
WALL_H = 13             # видимая высота передней стены


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(max(0, int(v * k)) for v in c)


def h(x, y, s=0):
    n = (x * 374761393 + y * 668265263 + s * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967296


WOOD = (128, 92, 52)
PLASTER = (206, 190, 158)
STONE = (140, 136, 126)
THATCH = (176, 146, 78)
TILE_R = (150, 74, 56)
DARK = (46, 36, 26)


class Canvas:
    def __init__(self, w, hh):
        self.im = Image.new('RGBA', (w, hh), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.w, self.h = w, hh

    def rect(self, x0, y0, x1, y1, c):
        self.d.rectangle([x0, y0, x1, y1], fill=(*c, 255))

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.im.putpixel((int(x), int(y)), (*c, 255))

    def shadow(self, x0, y0, x1, y1, a=70):
        ov = Image.new('RGBA', self.im.size, (0, 0, 0, 0))
        ImageDraw.Draw(ov).rectangle([x0, y0, x1, y1], fill=(0, 0, 0, a))
        self.im = Image.alpha_composite(self.im, ov)
        self.d = ImageDraw.Draw(self.im)

    def outline(self, c=DARK):
        px = self.im.load()
        w, hh = self.im.size
        add = []
        for y in range(hh):
            for x in range(w):
                if px[x, y][3] == 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < hh and px[nx, ny][3] == 0:
                        add.append((nx, ny))
        for (x, y) in add:
            px[x, y] = (*c, 255)


def wall_texture(c, x0, y0, x1, y1, kind, seed=0):
    """Возвращает функцию раскраски пикселя стены."""
    def f(x, y):
        if kind == 'stone':
            bh, bw = 5, 9
            row = (y - y0) // bh
            off = (row % 2) * (bw // 2)
            if (y - y0) % bh == 0 or (x - x0 + off) % bw == 0:
                return mix(c, 0.72)                  # шов кладки
            return mix(c, 0.94 + h(x, y, seed) * 0.16)
        if kind == 'wood':
            if (x - x0) % 6 == 0:
                return mix(c, 0.74)                  # стык досок
            return mix(c, 0.92 + h(x, y, seed) * 0.14)
        # plaster: фахверк — светлая штукатурка с тёмными балками
        if (x - x0) % 13 == 0 or (y - y0) == (y1 - y0) // 2:
            return mix(WOOD, 0.75)
        return mix(c, 0.95 + h(x, y, seed) * 0.10)
    return f


def draw_roof(cv, x0, y0, x1, y1, base, style='thatch', seed=0):
    """Вальмовая крыша сверху.

    Контур крыши — весь прямоугольник (это карнизы). Внутри: короткий конёк
    посередине и четыре ската — задний, передний и две боковые вальмы,
    рёбра идут от концов конька к углам. Каждый скат светится по-своему,
    поэтому объём читается без обводки.
    """
    W = x1 - x0
    Hh = max(2, y1 - y0)
    ridge_y = y0 + int(Hh * 0.42)
    inset = max(3, W // 4)
    rx0, rx1 = x0 + inset, x1 - inset

    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            # доля пути от карниза к коньку по вертикали
            tv = (y - y0) / max(1, ridge_y - y0) if y <= ridge_y \
                else (y1 - y) / max(1, y1 - ridge_y)
            # доля пути от боковых карнизов
            tl = (x - x0) / max(1, inset)
            tr = (x1 - x) / max(1, inset)

            if tl < tv and tl < tr:
                facet, t = 'left', tl
            elif tr < tv and tr <= tl:
                facet, t = 'right', tr
            elif y <= ridge_y:
                facet, t = 'back', tv
            else:
                facet, t = 'front', tv

            if facet == 'back':
                k = 1.02 + t * 0.26          # задний скат к коньку светлеет
            elif facet == 'front':
                k = 0.78 + t * 0.30          # передний темнее, к карнизу совсем тёмный
            elif facet == 'left':
                k = 1.10 + t * 0.14          # вальма под светом
            else:
                k = 0.74 + t * 0.12          # вальма в тени

            c = mix(base, k)
            if style == 'thatch':
                if (x + (y % 2) * 2) % 4 == 0:
                    c = mix(c, 0.92)
                if h(x, y, seed) > 0.94:
                    c = mix(c, 1.10)
                elif h(x, y, seed) < 0.05:
                    c = mix(c, 0.88)
            elif style == 'tile':
                if (y - y0) % 3 == 0:
                    c = mix(c, 0.80)
                if (x + ((y - y0) // 3) * 2) % 6 == 0:
                    c = mix(c, 0.91)
            cv.px(x, y, c)

    # конёк
    cv.d.line([rx0, ridge_y, rx1, ridge_y], fill=(*mix(base, 1.50), 255))
    cv.d.line([rx0, ridge_y + 1, rx1, ridge_y + 1], fill=(*mix(base, 0.72), 255))

    # рёбра вальм от концов конька к углам
    for (ex, ey) in ((x0, y0), (x0, y1), (x1, y0), (x1, y1)):
        rx = rx0 if ex == x0 else rx1
        steps = max(abs(rx - ex), abs(ridge_y - ey))
        for i in range(steps + 1):
            px = ex + (rx - ex) * i // steps
            py = ey + (ridge_y - ey) * i // steps
            cv.px(px, py, mix(base, 1.22 if ex == x0 else 0.72))

    # карнизы по контуру
    cv.d.rectangle([x0, y0, x1, y1], outline=(*mix(base, 0.58), 255))
    cv.d.line([x0, y1 - 1, x1, y1 - 1], fill=(*mix(base, 0.70), 255))


def house(tw, th, wall=PLASTER, wall_kind='plaster', roof=THATCH, roof_style='thatch',
          door=True, windows=0, chimney=False, seed=0, storeys=1):
    """Жилой дом. Высота спрайта больше пятна застройки: человек ростом ~58 px
    должен доходить примерно до карниза, иначе домик выглядит игрушечным."""
    W = tw * T
    wall_h = 26 + th * 4 + (storeys - 1) * 22      # видимая стена
    roof_h = int(th * T * 0.88)                    # крыша чуть ниже глубины пятна
    Hh = roof_h + wall_h
    cv = Canvas(W, Hh)

    # тень на землю
    cv.shadow(3, Hh - 5, W - 1, Hh - 1, 65)

    wy0, wy1 = Hh - wall_h, Hh - 1
    tex = wall_texture(wall, 2, wy0, W - 3, wy1, wall_kind, seed)
    for y in range(wy0, wy1 + 1):
        for x in range(2, W - 2):
            c = tex(x, y)
            side = (x - 2) / max(1, W - 5)
            cv.px(x, y, mix(c, 1.06 - side * 0.20))     # объём стены
    cv.rect(2, wy1 - 2, W - 3, wy1, mix(wall, 0.62))    # цоколь

    draw_roof(cv, 0, 0, W - 1, wy0 - 1, roof, roof_style, seed)

    # дверь
    if door:
        dw = max(8, W // 8)
        dh = min(wall_h - 6, 22)
        dx = W // 2 - dw // 2
        cv.rect(dx - 1, wy1 - dh - 1, dx + dw + 1, wy1 - 2, mix(WOOD, 0.48))
        cv.rect(dx, wy1 - dh, dx + dw, wy1 - 3, WOOD)
        for i in range(1, 4):
            cv.d.line([dx, wy1 - dh + i * dh // 4, dx + dw, wy1 - dh + i * dh // 4],
                      fill=(*mix(WOOD, 0.74), 255))
        cv.px(dx + dw - 2, wy1 - dh // 2, (216, 192, 122))

    # окна равномерно по фасаду, мимо двери
    for i in range(windows):
        wx = 7 + int(i * (W - 18) / max(1, windows - 1 if windows > 1 else 1))
        if abs(wx + 3 - W // 2) < W // 9:
            continue
        wy = wy0 + 6
        cv.rect(wx - 1, wy - 1, wx + 6, wy + 9, mix(wall, 0.66))
        cv.rect(wx, wy, wx + 5, wy + 8, (74, 84, 92))
        cv.rect(wx, wy, wx + 5, wy + 2, (108, 122, 130))
        cv.d.line([wx + 2, wy, wx + 2, wy + 8], fill=(*mix(WOOD, 0.7), 255))

    # второй ярус окон
    if storeys > 1:
        for i in range(max(2, windows)):
            wx = 9 + int(i * (W - 22) / max(1, max(2, windows) - 1))
            wy = wy0 + 24
            cv.rect(wx, wy, wx + 5, wy + 8, (74, 84, 92))
            cv.rect(wx, wy, wx + 5, wy + 2, (108, 122, 130))

    # труба
    if chimney:
        cx = W - W // 4
        cv.rect(cx, 2, cx + 7, 20, mix(STONE, 0.86))
        cv.rect(cx, 2, cx + 7, 4, mix(STONE, 1.18))
        cv.rect(cx + 1, 5, cx + 6, 6, mix(STONE, 0.70))

    cv.outline()
    return cv.im


def keep():
    """Донжон: каменная башня с зубцами и угловыми башенками, 5x5."""
    tw = th = 5
    W, Hh = tw * T, th * T + 96          # донжон должен возвышаться над домами
    cv = Canvas(W, Hh)
    cv.shadow(8, Hh - 8, W - 2, Hh - 1, 80)

    body_top = 96
    bx0, bx1 = 22, W - 23
    tex = wall_texture(STONE, bx0, body_top, bx1, Hh - 1, 'stone', 3)

    # основной объём с боковой светотенью
    for y in range(body_top, Hh - 2):
        for x in range(bx0, bx1 + 1):
            side = (x - bx0) / (bx1 - bx0)
            cv.px(x, y, mix(tex(x, y), 1.10 - side * 0.26))

    # угловые башенки — выступают за корпус и выше него
    for tx0 in (4, W - 26):
        ttex = wall_texture(STONE, tx0, body_top - 14, tx0 + 21, Hh, 'stone', 5)
        for y in range(body_top - 14, Hh - 2):
            for x in range(tx0, tx0 + 22):
                side = (x - tx0) / 21
                cv.px(x, y, mix(ttex(x, y), 1.14 - side * 0.30))
        # зубцы башенки
        for mx in range(tx0, tx0 + 22, 7):
            cv.rect(mx, body_top - 22, mx + 4, body_top - 15, mix(STONE, 1.08))
            cv.rect(mx, body_top - 22, mx + 4, body_top - 21, mix(STONE, 1.30))
        cv.d.line([tx0, body_top - 15, tx0 + 21, body_top - 15], fill=(*mix(STONE, 0.66), 255))

    # зубцы корпуса
    for mx in range(bx0, bx1 - 4, 9):
        cv.rect(mx, body_top - 9, mx + 5, body_top - 1, mix(STONE, 1.04))
        cv.rect(mx, body_top - 9, mx + 5, body_top - 8, mix(STONE, 1.26))
    cv.d.line([bx0, body_top - 1, bx1, body_top - 1], fill=(*mix(STONE, 0.64), 255))

    # ворота с аркой
    dw = 20
    dx = W // 2 - dw // 2
    cv.d.ellipse([dx - 3, Hh - 46, dx + dw + 3, Hh - 22], fill=(*mix(STONE, 0.78), 255))
    cv.rect(dx - 3, Hh - 34, dx + dw + 3, Hh - 3, mix(STONE, 0.78))
    cv.d.ellipse([dx, Hh - 42, dx + dw, Hh - 24], fill=(*mix(WOOD, 0.55), 255))
    cv.rect(dx, Hh - 33, dx + dw, Hh - 4, mix(WOOD, 0.55))
    cv.rect(dx + 2, Hh - 31, dx + dw - 2, Hh - 4, WOOD)
    for i in range(3):
        cv.d.line([dx + 2, Hh - 27 + i * 8, dx + dw - 2, Hh - 27 + i * 8],
                  fill=(*mix(WOOD, 0.72), 255))

    # бойницы
    for wy in (body_top + 16, body_top + 52, body_top + 88):
        for wx in (W // 2 - 26, W // 2 + 22):
            cv.rect(wx, wy, wx + 4, wy + 11, mix(DARK, 1.05))
            cv.px(wx + 1, wy + 1, mix(STONE, 0.9))

    # флаг на башенке
    fx = 14
    cv.d.line([fx, body_top - 40, fx, body_top - 22], fill=(*mix(WOOD, 0.8), 255))
    cv.rect(fx + 1, body_top - 40, fx + 13, body_top - 33, (152, 60, 48))
    cv.rect(fx + 1, body_top - 40, fx + 13, body_top - 39, (192, 92, 70))

    cv.outline()
    return cv.im


def stockpile():
    """Склад: мощёная площадка со штабелями брёвен, камня и железа, без крыши."""
    tw = th = 3
    W, Hh = tw * T, th * T + 6
    cv = Canvas(W, Hh)
    top = Hh - th * T
    for y in range(top, Hh):
        for x in range(W):
            c = mix((118, 110, 98), 0.90 + h(x, y, 9) * 0.22)
            if (y - top) % 8 == 0 or (x + ((y - top) // 8) * 4) % 12 == 0:
                c = mix(c, 0.78)
            cv.px(x, y, c)
    cv.d.line([0, top, W - 1, top], fill=(*mix((118, 110, 98), 1.2), 255))

    # штабель брёвен: торцы кругляка
    for row in range(3):
        y = top + 8 + row * 7
        n = 5 - row
        for i in range(n):
            x = 8 + row * 4 + i * 9
            cv.d.ellipse([x, y, x + 8, y + 7], fill=(*mix(WOOD, 0.92), 255))
            cv.d.ellipse([x + 2, y + 2, x + 6, y + 5], fill=(*mix(WOOD, 1.18), 255))

    # штабель тёсаного камня
    for row in range(3):
        y = Hh - 14 - row * 8
        for i in range(3 - row):
            x = 8 + row * 7 + i * 15
            cv.rect(x, y, x + 13, y + 7, mix(STONE, 0.92))
            cv.rect(x, y, x + 13, y + 2, mix(STONE, 1.14))
            cv.d.line([x, y + 7, x + 13, y + 7], fill=(*mix(STONE, 0.66), 255))

    # железные крицы
    for i in range(3):
        x = W - 26 + (i % 2) * 10
        y = top + 44 + i * 5
        cv.rect(x, y, x + 9, y + 4, (96, 100, 108))
        cv.rect(x, y, x + 9, y + 1, (140, 146, 156))

    cv.outline()
    return cv.im


def farm(stage=3):
    """Поле пшеницы, 3x3. Четыре стадии: вспахано → всходы → налив → спелое.
    Стадия рисуется поверх одних и тех же борозд, поэтому поле «дышит»."""
    tw = th = 3
    W, Hh = tw * T, th * T + 34      # запас сверху под хижину фермера
    cv = Canvas(W, Hh)
    top = Hh - th * T

    # борозды
    for y in range(top, Hh):
        for x in range(W):
            band = ((y - top) // 4) % 2
            base = (150, 124, 84) if band else (124, 100, 64)
            cv.px(x, y, mix(base, 0.94 + h(x, y, 2) * 0.14))

    if stage >= 1:
        colour = {1: (120, 158, 78), 2: (176, 176, 92), 3: (214, 186, 96)}[stage]
        hgt = {1: 3, 2: 6, 3: 9}[stage]
        for gy in range(top + 6, Hh - 3, 5):
            for gx in range(3, W - 3, 4):
                if h(gx, gy, 4) < 0.18:
                    continue
                for i in range(hgt):
                    cv.px(gx, gy - i, mix(colour, 1.0 + i * 0.03))
                if stage == 3:                       # колос
                    cv.px(gx, gy - hgt, mix(colour, 1.22))
                    cv.px(gx + 1, gy - hgt + 1, mix(colour, 1.10))
                    cv.px(gx - 1, gy - hgt + 1, mix(colour, 0.90))

    # хижина фермера в углу
    hut = house(1, 1, PLASTER, 'plaster', THATCH, 'thatch', door=True, seed=6)
    cv.im.paste(hut, (W - hut.width - 2, top - hut.height + T), hut)
    cv.outline()
    return cv.im


def quarry():
    """Каменоломня: ступенчатая вырубка в скале, блоки и подъёмник, 4x4."""
    tw = th = 4
    W, Hh = tw * T, th * T + 8
    cv = Canvas(W, Hh)
    top = Hh - th * T

    for y in range(top, Hh):
        for x in range(W):
            cv.px(x, y, mix((134, 130, 122), 0.86 + h(x, y, 7) * 0.26))

    # ступени вырубки: каждая ниже и темнее, с освещённой кромкой
    steps = [(10, 10), (22, 20), (34, 30)]
    for i, (pad, _) in enumerate(steps):
        x0, y0 = pad, top + pad // 2 + 6
        x1, y1 = W - pad, Hh - pad // 2 - 8
        shade = 0.80 - i * 0.13
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                # неровный край, чтобы вырубка не была правильным овалом
                wob = int(2 * math.sin(x * 0.4 + i) + 2 * math.cos(y * 0.5 - i))
                if x0 + wob <= x <= x1 - wob and y0 + wob <= y <= y1 - wob:
                    cv.px(x, y, mix((132, 128, 120), shade + h(x, y, i) * 0.10))
        cv.d.line([x0 + 2, y0, x1 - 2, y0], fill=(*mix((132, 128, 120), shade + 0.30), 255))

    # готовые блоки у входа
    for i in range(4):
        x = 6 + (i % 2) * 18
        y = Hh - 28 + (i // 2) * 12
        cv.rect(x, y, x + 15, y + 10, mix(STONE, 1.0))
        cv.rect(x, y, x + 15, y + 3, mix(STONE, 1.20))
        cv.d.line([x, y + 10, x + 15, y + 10], fill=(*mix(STONE, 0.62), 255))

    # деревянный подъёмник
    cv.rect(W - 30, top + 4, W - 27, top + 34, mix(WOOD, 0.9))
    cv.rect(W - 44, top + 4, W - 27, top + 7, mix(WOOD, 1.05))
    cv.d.line([W - 42, top + 7, W - 42, top + 18], fill=(*mix((70, 62, 50), 1.0), 255))
    cv.rect(W - 46, top + 18, W - 38, top + 24, mix(STONE, 1.05))

    cv.outline()
    return cv.im


def mill():
    """Мельница: башня с четырьмя крыльями, 3x3."""
    tw = th = 3
    W, Hh = tw * T, th * T + 74          # башня мельницы заметно выше домов
    cv = Canvas(W, Hh)
    top = Hh - th * T
    cv.shadow(6, Hh - 6, W - 2, Hh - 1, 60)
    # корпус
    for y in range(top + 6, Hh - 1):
        t = (y - top - 6) / (Hh - top - 7)
        inset = int(10 * (1 - t))
        for x in range(6 + inset, W - 6 - inset):
            cv.px(x, y, wall_texture(PLASTER, 6, top, W - 6, Hh, 'plaster', 8)(x, y))
    # шапка-крыша
    draw_roof(cv, 6, top - 10, W - 6, top + 14, TILE_R, 'tile', 8)
    # крылья
    ccx, ccy = W // 2, top + 2
    for a in (0, 90, 180, 270):
        rad = math.radians(a + 20)
        for r in range(6, 30):
            x = ccx + math.cos(rad) * r
            y = ccy + math.sin(rad) * r * 0.8
            cv.px(x, y, mix(WOOD, 0.9))
            cv.px(x + math.cos(rad + 1.4) * 3, y + math.sin(rad + 1.4) * 3, mix(PLASTER, 0.9))
    cv.rect(ccx - 2, ccy - 2, ccx + 2, ccy + 2, mix(WOOD, 0.6))
    # дверь
    cv.rect(W // 2 - 5, Hh - 14, W // 2 + 4, Hh - 2, mix(WOOD, 0.7))
    cv.outline()
    return cv.im


SKIN_C = (214, 168, 122)

# ------------------------------------------------------------ страх и радость
def garden():
    """Сад: живая изгородь, клумбы, дорожка. 2x2."""
    tw = th = 2
    W, Hh = tw * T, th * T + 8
    cv = Canvas(W, Hh)
    top = Hh - th * T
    for y in range(top, Hh):
        for x in range(W):
            cv.px(x, y, mix((104, 132, 68), 0.92 + h(x, y, 3) * 0.18))
    # дорожка
    for y in range(top + 24, top + 32):
        for x in range(2, W - 2):
            cv.px(x, y, mix((166, 150, 118), 0.94 + h(x, y, 5) * 0.14))
    # изгородь по периметру
    for x in range(W):
        for y in (top, top + 1, Hh - 3, Hh - 2):
            cv.px(x, y, mix((62, 92, 46), 1.0 + h(x, y, 7) * 0.3))
    for y in range(top, Hh):
        for x in (0, 1, W - 2, W - 1):
            cv.px(x, y, mix((62, 92, 46), 1.0 + h(x, y, 8) * 0.3))
    # клумбы
    for (cx, cy, col) in ((14, top + 12, (206, 92, 84)), (46, top + 12, (198, 176, 92)),
                          (14, top + 44, (150, 116, 190)), (46, top + 44, (214, 130, 90))):
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                if dx * dx + dy * dy > 16:
                    continue
                c = col if (dx + dy) % 2 == 0 else mix((70, 108, 50), 1.0)
                cv.px(cx + dx, cy + dy, c)
    cv.outline()
    return cv.im


def statue():
    """Статуя лорда на постаменте. 1x1."""
    W, Hh = T, T + 26
    cv = Canvas(W, Hh)
    cv.shadow(4, Hh - 4, W - 3, Hh - 1, 70)
    # постамент
    cv.rect(6, Hh - 12, W - 7, Hh - 2, mix(STONE, 0.86))
    cv.rect(6, Hh - 12, W - 7, Hh - 10, mix(STONE, 1.16))
    cv.rect(9, Hh - 20, W - 10, Hh - 12, mix(STONE, 0.94))
    # фигура
    fx = W // 2
    cv.rect(fx - 3, 12, fx + 2, Hh - 20, mix(STONE, 1.08))     # тело
    cv.rect(fx - 4, 16, fx - 4, 26, mix(STONE, 0.90))          # рука
    cv.rect(fx + 3, 14, fx + 3, 24, mix(STONE, 0.90))          # поднятая рука
    cv.d.ellipse([fx - 3, 5, fx + 2, 12], fill=(*mix(STONE, 1.20), 255))   # голова
    cv.rect(fx + 3, 8, fx + 4, 16, mix(STONE, 1.0))            # меч
    cv.outline()
    return cv.im


def fountain():
    """Фонтан: каменная чаша с водой и струёй. 2x2."""
    tw = th = 2
    W, Hh = tw * T, th * T + 10
    cv = Canvas(W, Hh)
    top = Hh - th * T
    cv.shadow(4, Hh - 5, W - 3, Hh - 1, 60)
    # брусчатка вокруг
    for y in range(top, Hh):
        for x in range(W):
            c = mix((150, 144, 132), 0.92 + h(x, y, 2) * 0.16)
            if (y - top) % 8 == 0 or (x + ((y - top) // 8) * 4) % 12 == 0:
                c = mix(c, 0.82)
            cv.px(x, y, c)
    # чаша
    cv.d.ellipse([8, top + 12, W - 9, Hh - 6], fill=(*mix(STONE, 0.94), 255))
    cv.d.ellipse([11, top + 15, W - 12, Hh - 9], fill=(*mix((58, 108, 142), 1.0), 255))
    for i in range(6):                                          # блики на воде
        cv.px(16 + i * 5, top + 22 + (i % 2) * 4, (140, 190, 214))
    # струя
    cx = W // 2
    cv.rect(cx - 2, top + 4, cx + 1, top + 20, mix(STONE, 1.04))
    cv.rect(cx - 1, top, cx, top + 6, (168, 208, 228))
    cv.px(cx - 3, top + 6, (168, 208, 228))
    cv.px(cx + 2, top + 6, (168, 208, 228))
    cv.outline()
    return cv.im


def stocks():
    """Позорный столб. 1x1."""
    W, Hh = T, T + 14
    cv = Canvas(W, Hh)
    cv.shadow(6, Hh - 4, W - 5, Hh - 1, 65)
    cx = W // 2
    cv.rect(cx - 2, 8, cx + 1, Hh - 3, mix(WOOD, 0.86))         # столб
    cv.rect(cx - 10, 12, cx + 9, 17, WOOD)                      # доска
    cv.rect(cx - 10, 12, cx + 9, 13, mix(WOOD, 1.16))
    for dx in (-7, 0, 7):                                       # отверстия
        cv.rect(cx + dx - 1, 14, cx + dx + 1, 15, mix(DARK, 1.2))
    cv.outline()
    return cv.im


def cage():
    """Клетка с осуждённым. 1x1."""
    W, Hh = T, T + 20
    cv = Canvas(W, Hh)
    cv.shadow(8, Hh - 4, W - 7, Hh - 1, 60)
    cx = W // 2
    cv.rect(cx - 2, 0, cx + 1, 8, mix(WOOD, 0.8))               # столб
    cv.rect(cx - 12, 6, cx + 11, 8, WOOD)                       # перекладина
    cv.d.line([cx + 6, 8, cx + 6, 12], fill=(*mix(IRON.base if False else (90, 92, 98), 1.0), 255))
    # прутья
    for x in range(cx - 7, cx + 8, 3):
        cv.rect(x, 12, x + 1, Hh - 6, (108, 110, 118))
    for y in range(12, Hh - 5, 6):
        cv.rect(cx - 7, y, cx + 8, y + 1, (128, 130, 138))
    cv.rect(cx - 4, 18, cx + 3, 26, mix(SKIN_C, 0.9))           # узник
    cv.outline()
    return cv.im


def gallows():
    """Виселица. 2x2."""
    tw = th = 2
    W, Hh = tw * T, th * T + 16
    cv = Canvas(W, Hh)
    top = Hh - th * T
    cv.shadow(6, Hh - 5, W - 5, Hh - 1, 70)
    # помост
    for y in range(Hh - 14, Hh - 2):
        for x in range(6, W - 6):
            cv.px(x, y, mix(WOOD, 0.78 + h(x, y, 4) * 0.2))
    cv.rect(6, Hh - 14, W - 7, Hh - 13, mix(WOOD, 1.10))
    # рама
    cv.rect(12, top, 15, Hh - 14, mix(WOOD, 0.90))
    cv.rect(12, top, W - 13, top + 3, mix(WOOD, 1.02))
    cv.rect(W - 16, top, W - 13, Hh - 14, mix(WOOD, 0.82))
    # верёвка с петлёй
    rx = W // 2 + 4
    cv.rect(rx, top + 3, rx, top + 18, (196, 176, 132))
    cv.d.ellipse([rx - 3, top + 18, rx + 3, top + 26], outline=(*(196, 176, 132), 255))
    cv.outline()
    return cv.im


# ------------------------------------------------------------- этап 5.1
def hunter():
    """Охотничий домик: сруб с оленьими рогами и сушилкой. 2x2."""
    im = house(2, 2, WOOD, 'wood', THATCH, 'thatch', door=True, windows=1, seed=11)
    cv = Canvas(im.width, im.height)
    cv.im = im.copy()
    cv.d = ImageDraw.Draw(cv.im)
    W = im.width
    # рога над дверью
    cx = W // 2
    top = im.height - 30
    for side in (-1, 1):
        for i in range(6):
            cv.px(cx + side * (2 + i), top - i, (218, 206, 178))
            if i % 2 == 0:
                cv.px(cx + side * (2 + i), top - i - 3, (218, 206, 178))
                cv.px(cx + side * (2 + i), top - i - 2, (218, 206, 178))
    # сушилка для шкур сбоку
    cv.rect(2, im.height - 26, 4, im.height - 4, mix(WOOD, 0.8))
    cv.rect(2, im.height - 26, 14, im.height - 24, mix(WOOD, 0.9))
    cv.rect(4, im.height - 24, 13, im.height - 12, (150, 116, 84))
    cv.rect(4, im.height - 24, 13, im.height - 22, (176, 142, 106))
    return cv.im


def dairy():
    """Молочная ферма: хлев и загон с коровами. 3x3."""
    tw = th = 3
    W, Hh = tw * T, th * T + 40
    cv = Canvas(W, Hh)
    top = Hh - th * T

    # выгон
    for y in range(top + 20, Hh):
        for x in range(W):
            cv.px(x, y, mix((104, 134, 70), 0.94 + h(x, y, 6) * 0.14))
    # изгородь
    for x in range(0, W, 8):
        cv.rect(x, Hh - 20, x + 1, Hh - 6, mix(WOOD, 0.9))
    cv.rect(0, Hh - 18, W - 1, Hh - 16, WOOD)
    cv.rect(0, Hh - 11, W - 1, Hh - 9, mix(WOOD, 0.86))

    # хлев
    barn = house(3, 1, WOOD, 'wood', THATCH, 'thatch', door=True, windows=2, seed=12)
    cv.im.paste(barn, (0, top + 20 - barn.height), barn)
    cv.d = ImageDraw.Draw(cv.im)

    # две коровы
    for (cx, cy) in ((16, Hh - 14), (60, Hh - 10)):
        cv.rect(cx, cy - 8, cx + 16, cy, (238, 236, 230))          # туловище
        for (px, py) in ((cx + 2, cy - 7), (cx + 9, cy - 5), (cx + 5, cy - 3)):
            cv.rect(px, py, px + 4, py + 3, (58, 52, 48))          # пятна
        cv.rect(cx + 15, cy - 11, cx + 19, cy - 6, (238, 236, 230))  # голова
        cv.px(cx + 19, cy - 10, (48, 42, 38))
        for lx in (cx + 2, cx + 12):                                # ноги
            cv.rect(lx, cy, lx + 1, cy + 4, (196, 192, 186))
    cv.outline()
    return cv.im


def orchard(stage=3):
    """Яблоневый сад, 3x3. Стадии: голые деревья → цвет → завязь → яблоки."""
    tw = th = 3
    W, Hh = tw * T, th * T + 20
    cv = Canvas(W, Hh)
    top = Hh - th * T
    for y in range(top, Hh):
        for x in range(W):
            cv.px(x, y, mix((100, 128, 66), 0.94 + h(x, y, 9) * 0.14))

    crown = {0: (96, 84, 58), 1: (128, 156, 92), 2: (96, 140, 74), 3: (88, 132, 70)}[stage]
    for (cx, cy) in ((18, top + 22), (50, top + 16), (34, top + 52), (70, top + 46)):
        cv.rect(cx - 1, cy, cx + 1, cy + 12, mix(WOOD, 0.82))       # ствол
        for dy in range(-9, 6):
            for dx in range(-10, 11):
                if dx * dx * 1.2 + dy * dy > 90:
                    continue
                c = mix(crown, 1.06 if dy < -3 else (0.86 if dy > 2 else 1.0))
                cv.px(cx + dx, cy + dy, c)
        if stage == 1:                                              # цветение
            for i in range(6):
                cv.px(cx - 6 + i * 3, cy - 6 + (i % 3), (238, 220, 228))
        if stage >= 2:                                              # плоды
            n = 3 if stage == 2 else 6
            col = (176, 150, 72) if stage == 2 else (198, 68, 56)
            for i in range(n):
                px = cx - 7 + (i * 5) % 15
                py = cy - 5 + ((i * 7) % 9)
                cv.px(px, py, col)
                cv.px(px + 1, py, mix(col, 1.2))
    cv.outline()
    return cv.im


# --------------------------------------------------------------- этап 5.2
def hopsfarm(stage=3):
    """Хмельник: шпалеры с лозой, 3x3. Стадии — от голых жердей до шишек."""
    tw = th = 3
    W, Hh = tw * T, th * T + 26
    cv = Canvas(W, Hh)
    top = Hh - th * T
    for y in range(top, Hh):
        for x in range(W):
            cv.px(x, y, mix((118, 104, 70), 0.94 + h(x, y, 12) * 0.14))

    # верхняя проволока между жердями
    cv.rect(8, top - 12, W - 8, top - 12, mix(WOOD, 0.7))

    rows = [10, 34, 58, 82]
    for rx in rows:
        if rx >= W - 4:
            continue
        # жердь
        cv.rect(rx, top - 14, rx + 1, Hh - 6, mix(WOOD, 0.86))
        cv.px(rx, top - 14, mix(WOOD, 1.2))
        if stage == 0:
            continue
        hgt = {1: 34, 2: 62, 3: 92}[stage]
        col = {1: (128, 158, 84), 2: (108, 146, 72), 3: (98, 138, 68)}[stage]
        for i in range(hgt):
            y = Hh - 8 - i
            w = 2 if i < hgt - 6 else 1
            for dx in range(-w, w + 1):
                if (i + dx) % 3 == 0:
                    cv.px(rx + dx, y, mix(col, 1.10))
                else:
                    cv.px(rx + dx, y, col)
        if stage == 3:                       # шишки хмеля
            for i in range(9):
                cv.px(rx - 2 + (i % 3), Hh - 20 - i * 9, (206, 208, 148))
                cv.px(rx - 1 + (i % 3), Hh - 19 - i * 9, (178, 186, 122))
    cv.outline()
    return cv.im


def _barrel(cv, x, y, w=10, hh=13):
    """Бочка — пригодится и пивоварне, и таверне."""
    cv.rect(x, y, x + w, y + hh, mix(WOOD, 0.88))
    cv.rect(x + 1, y, x + w - 1, y, mix(WOOD, 1.16))
    for by in (y + 3, y + hh - 4):
        cv.rect(x, by, x + w, by + 1, mix((96, 86, 70), 1.0))
    cv.rect(x + w // 2 - 1, y + 1, x + w // 2, y + hh - 1, mix(WOOD, 1.06))


def brewery():
    """Пивоварня: дом с чаном и бочками во дворе. 3x3."""
    im = house(3, 3, PLASTER, 'plaster', TILE_R, 'tile', door=True, windows=2,
               chimney=True, seed=14)
    cv = Canvas(im.width, im.height + 16)
    cv.im.paste(im, (0, 0), im)
    cv.d = ImageDraw.Draw(cv.im)
    base = im.height + 15
    # двор с бочками
    for y in range(im.height - 2, base + 1):
        for x in range(cv.w):
            cv.px(x, y, mix((132, 122, 104), 0.92 + h(x, y, 3) * 0.16))
    _barrel(cv, 4, base - 14)
    _barrel(cv, 17, base - 12, 9, 11)
    _barrel(cv, cv.w - 16, base - 14)
    # чан у стены
    cv.d.ellipse([cv.w // 2 - 9, base - 16, cv.w // 2 + 9, base - 4],
                 fill=(*mix((104, 96, 82), 1.0), 255))
    cv.d.ellipse([cv.w // 2 - 7, base - 14, cv.w // 2 + 7, base - 7],
                 fill=(*(146, 116, 54), 255))
    cv.outline()
    return cv.im


def inn():
    """Таверна: дом с вывеской, кружкой на щите и бочками. 3x3."""
    im = house(3, 3, PLASTER, 'plaster', THATCH, 'thatch', door=True, windows=3,
               chimney=True, seed=15, storeys=2)
    cv = Canvas(im.width + 14, im.height + 14)
    cv.im.paste(im, (0, 14), im)
    cv.d = ImageDraw.Draw(cv.im)
    W, Hh = cv.w, cv.h

    # кронштейн с вывеской
    sx = im.width - 6
    cv.rect(sx, 20, sx + 12, 21, mix(WOOD, 0.8))
    cv.rect(sx + 11, 21, sx + 12, 26, mix(WOOD, 0.7))
    cv.rect(sx + 5, 26, sx + 13, 38, mix(WOOD, 0.92))
    cv.rect(sx + 6, 27, sx + 12, 37, (188, 156, 92))
    # кружка на вывеске
    cv.rect(sx + 8, 30, sx + 11, 35, (232, 226, 208))
    cv.rect(sx + 8, 30, sx + 11, 31, (246, 242, 230))
    cv.px(sx + 11, 32, (140, 120, 80))

    # бочки у входа
    _barrel(cv, 3, Hh - 16, 9, 12)
    _barrel(cv, 14, Hh - 14, 8, 10)
    cv.outline()
    return cv.im


IRON_C = (128, 132, 140)

# --------------------------------------------------------------- этап 5.3
def ironmine():
    """Железный рудник: копёр над стволом, отвал руды, вагонетка. 3x3."""
    tw = th = 3
    W, Hh = tw * T, th * T + 40
    cv = Canvas(W, Hh)
    top = Hh - th * T
    cv.shadow(6, Hh - 5, W - 4, Hh - 1, 65)

    # площадка из щебня
    for y in range(top, Hh):
        for x in range(W):
            c = mix((126, 112, 96), 0.90 + h(x, y, 15) * 0.22)
            if h(x, y, 16) > 0.96:
                c = (176, 122, 60)                       # рыжие крупицы руды
            cv.px(x, y, c)

    # ствол шахты
    cv.d.ellipse([W // 2 - 13, top + 16, W // 2 + 13, top + 40],
                 fill=(*(52, 46, 40), 255))
    cv.d.ellipse([W // 2 - 10, top + 19, W // 2 + 10, top + 36],
                 fill=(*(26, 22, 18), 255))
    # обвязка сруба
    for i in range(4):
        cv.rect(W // 2 - 14 + i * 8, top + 14, W // 2 - 8 + i * 8, top + 17, mix(WOOD, 0.9))

    # копёр: две ноги и перекладина с блоком
    cv.rect(W // 2 - 16, top - 34, W // 2 - 13, top + 18, mix(WOOD, 0.94))
    cv.rect(W // 2 + 13, top - 34, W // 2 + 16, top + 18, mix(WOOD, 0.80))
    cv.rect(W // 2 - 18, top - 38, W // 2 + 18, top - 34, WOOD)
    cv.rect(W // 2 - 18, top - 38, W // 2 + 18, top - 37, mix(WOOD, 1.16))
    for i in range(3):                                    # раскосы
        cv.rect(W // 2 - 15 + i, top - 20 + i * 6, W // 2 + 15 - i, top - 19 + i * 6,
                mix(WOOD, 0.74))
    # трос с бадьёй
    cv.rect(W // 2 - 1, top - 34, W // 2, top - 6, (76, 68, 56))
    cv.rect(W // 2 - 5, top - 6, W // 2 + 4, top + 2, mix(IRON_C, 1.0))
    cv.rect(W // 2 - 5, top - 6, W // 2 + 4, top - 5, mix(IRON_C, 1.25))

    # отвал руды
    for i in range(9):
        px = 6 + (i % 3) * 5 + (i // 3) * 2
        py = Hh - 12 + (i % 3) - (i // 3) * 4
        cv.rect(px, py, px + 4, py + 3, (150, 104, 58) if i % 2 else (128, 90, 52))
    cv.outline()
    return cv.im


def pitchrig():
    """Смоляная вышка: помост над болотом, ворот и бочки со смолой. 2x2."""
    tw = th = 2
    W, Hh = tw * T, th * T + 30
    cv = Canvas(W, Hh)
    top = Hh - th * T

    # болотная жижа
    for y in range(top, Hh):
        for x in range(W):
            c = mix((74, 84, 62), 0.90 + h(x, y, 21) * 0.2)
            if h(x, y, 22) > 0.88:
                c = (52, 62, 58)
            cv.px(x, y, c)

    # помост
    for y in range(top + 14, top + 30):
        for x in range(4, W - 4):
            c = mix(WOOD, 0.82 + ((x // 4) % 2) * 0.14)
            cv.px(x, y, c)
    cv.rect(4, top + 14, W - 5, top + 15, mix(WOOD, 1.14))
    for lx in (6, W - 10):                                # сваи
        cv.rect(lx, top + 30, lx + 2, Hh - 4, mix(WOOD, 0.72))

    # ворот с рукоятью
    cv.rect(W // 2 - 8, top - 2, W // 2 + 7, top + 4, mix(WOOD, 0.9))
    cv.rect(W // 2 - 10, top, W // 2 - 8, top + 2, mix(IRON_C, 1.0))
    cv.rect(W // 2 + 7, top, W // 2 + 10, top + 2, mix(IRON_C, 1.0))
    cv.rect(W // 2 - 1, top + 4, W // 2, top + 14, (70, 62, 52))

    # бочки со смолой
    _barrel(cv, W - 16, Hh - 18, 9, 12)
    _barrel(cv, 3, Hh - 15, 8, 10)
    cv.rect(W - 15, Hh - 18, W - 9, Hh - 17, (38, 34, 30))   # чёрная смола сверху
    cv.outline()
    return cv.im


def market():
    """Рынок: навесы на столбах, прилавки, ящики и мешки. 3x3."""
    tw = th = 3
    W, Hh = tw * T, th * T + 24
    cv = Canvas(W, Hh)
    top = Hh - th * T

    # утоптанная площадка
    for y in range(top, Hh):
        for x in range(W):
            cv.px(x, y, mix((146, 126, 96), 0.92 + h(x, y, 31) * 0.16))

    # два навеса в полоску
    for (sx, col) in ((2, (186, 78, 66)), (W // 2 + 2, (72, 108, 150))):
        w = W // 2 - 4
        for y in range(top + 2, top + 16):
            for x in range(sx, sx + w):
                stripe = ((x - sx) // 5) % 2
                c = col if stripe else (226, 216, 196)
                k = 1.10 - (y - top - 2) / 22
                cv.px(x, y, mix(c, k))
        cv.rect(sx, top + 16, sx + w - 1, top + 17, mix(col, 0.6))
        for px in (sx + 1, sx + w - 3):                 # столбы
            cv.rect(px, top + 17, px + 1, top + 34, mix(WOOD, 0.86))
        # прилавок
        cv.rect(sx, top + 30, sx + w - 1, top + 34, mix(WOOD, 0.94))
        cv.rect(sx, top + 30, sx + w - 1, top + 31, mix(WOOD, 1.14))

    # товар: ящики, мешки, корзина
    cv.rect(6, Hh - 16, 18, Hh - 5, mix(WOOD, 0.9))
    cv.rect(6, Hh - 16, 18, Hh - 14, mix(WOOD, 1.12))
    cv.d.line([6, Hh - 11, 18, Hh - 11], fill=(*mix(WOOD, 0.7), 255))
    for (mx, my) in ((26, Hh - 12), (36, Hh - 10)):     # мешки
        cv.d.ellipse([mx, my, mx + 10, my + 10], fill=(*(198, 182, 146), 255))
        cv.rect(mx + 3, my - 2, mx + 6, my + 2, (176, 160, 126))
    cv.d.ellipse([W - 22, Hh - 14, W - 6, Hh - 4], fill=(*(156, 118, 66), 255))
    for i in range(5):                                  # яблоки в корзине
        cv.px(W - 20 + i * 3, Hh - 13 + (i % 2), (188, 62, 52))
    cv.outline()
    return cv.im


STEEL_C = (168, 172, 182)
LEATHER = (110, 76, 46)

# ---------------------------------------------------------------- этап 6
def _props(base, fn):
    """Обёртка: берём готовый дом и дорисовываем поверх приметы ремесла."""
    im = base
    cv = Canvas(im.width, im.height)
    cv.im = im.copy()
    cv.d = ImageDraw.Draw(cv.im)
    fn(cv, im.width, im.height)
    return cv.im


def fletcher():
    """Лучный мастер: заготовки древков у стены и лук на фасаде. 2x2."""
    def props(cv, W, Hh):
        # связка древков
        for i in range(6):
            cv.rect(3 + i * 2, Hh - 34, 4 + i * 2, Hh - 8, mix(WOOD, 0.88 + (i % 2) * 0.16))
        cv.rect(2, Hh - 24, 15, Hh - 22, mix(LEATHER, 1.0))
        # лук на стене
        bx = W - 14
        for i, y in enumerate(range(Hh - 32, Hh - 12)):
            off = int(3 * math.sin((i / 19) * math.pi))
            cv.px(bx + off, y, WOOD)
            cv.px(bx + off + 1, y, mix(WOOD, 0.8))
        for y in range(Hh - 31, Hh - 13):
            cv.px(bx, y, (232, 224, 204))
    return _props(house(2, 2, WOOD, 'wood', THATCH, 'thatch', True, 1, False, 21), props)


def poleturner():
    """Копейщик-токарь: козлы с жердями и точильный станок. 2x2."""
    def props(cv, W, Hh):
        for i in range(5):                                # жерди на козлах
            y = Hh - 30 + i * 3
            cv.rect(2, y, W - 12, y + 1, mix(WOOD, 0.86 + (i % 2) * 0.2))
        cv.rect(4, Hh - 32, 5, Hh - 6, mix(WOOD, 0.7))
        cv.rect(W - 16, Hh - 32, W - 15, Hh - 6, mix(WOOD, 0.7))
        # наконечники на стойке
        for i in range(3):
            px = W - 12 + i * 3
            cv.rect(px, Hh - 26, px + 1, Hh - 18, STEEL_C)
            cv.px(px, Hh - 27, mix(STEEL_C, 1.3))
    return _props(house(2, 2, WOOD, 'wood', THATCH, 'thatch', True, 1, False, 22), props)


def blacksmith():
    """Кузница: горн с искрами, наковальня, готовые клинки. 3x3."""
    def props(cv, W, Hh):
        # горн у стены
        cv.rect(4, Hh - 30, 22, Hh - 6, mix(STONE, 0.9))
        cv.rect(4, Hh - 30, 22, Hh - 28, mix(STONE, 1.14))
        cv.rect(9, Hh - 24, 17, Hh - 14, (48, 34, 26))
        cv.rect(10, Hh - 22, 16, Hh - 16, (216, 108, 40))     # огонь
        cv.rect(11, Hh - 20, 15, Hh - 18, (248, 196, 96))
        for i in range(4):                                     # искры
            cv.px(12 + i * 2, Hh - 26 - (i % 3) * 2, (250, 214, 130))
        # наковальня
        cv.rect(W - 26, Hh - 16, W - 14, Hh - 12, mix(IRON_C, 1.0))
        cv.rect(W - 24, Hh - 12, W - 18, Hh - 6, mix(IRON_C, 0.8))
        cv.rect(W - 26, Hh - 16, W - 14, Hh - 15, mix(IRON_C, 1.3))
        # клинки на стойке
        for i in range(3):
            px = W - 12 + i * 4
            cv.rect(px, Hh - 30, px + 1, Hh - 14, (206, 210, 218))
            cv.rect(px - 1, Hh - 14, px + 2, Hh - 13, mix(WOOD, 0.8))
    return _props(house(3, 3, STONE, 'stone', TILE_R, 'tile', True, 2, True, 23), props)


def armourer():
    """Оружейник: кираса на стойке и заготовки пластин. 3x3."""
    def props(cv, W, Hh):
        cx = 16
        # кираса
        cv.rect(cx - 7, Hh - 32, cx + 7, Hh - 14, mix(STEEL_C, 1.0))
        cv.rect(cx - 7, Hh - 32, cx + 7, Hh - 30, mix(STEEL_C, 1.28))
        cv.rect(cx - 5, Hh - 30, cx - 4, Hh - 16, mix(STEEL_C, 1.18))
        cv.rect(cx + 4, Hh - 30, cx + 5, Hh - 16, mix(STEEL_C, 0.78))
        cv.rect(cx - 1, Hh - 32, cx, Hh - 14, mix(STEEL_C, 0.86))   # ребро
        cv.rect(cx - 2, Hh - 14, cx + 1, Hh - 6, mix(WOOD, 0.8))    # стойка
        # пластины стопкой
        for i in range(4):
            py = Hh - 12 - i * 3
            cv.rect(W - 24, py, W - 8, py + 2, mix(STEEL_C, 0.9 + i * 0.06))
    return _props(house(3, 3, PLASTER, 'plaster', TILE_R, 'tile', True, 2, True, 24), props)


def tanner():
    """Кожевник: шкуры, растянутые на рамах, и чан. 2x2."""
    def props(cv, W, Hh):
        for i, px in enumerate((2, 20)):                  # рамы со шкурами
            cv.rect(px, Hh - 34, px + 1, Hh - 6, mix(WOOD, 0.8))
            cv.rect(px + 13, Hh - 34, px + 14, Hh - 6, mix(WOOD, 0.8))
            cv.rect(px, Hh - 34, px + 14, Hh - 33, mix(WOOD, 0.9))
            for y in range(Hh - 32, Hh - 12):
                for x in range(px + 2, px + 13):
                    c = (166, 132, 96) if (x + y) % 5 else (148, 116, 82)
                    cv.px(x, y, c)
            cv.rect(px + 2, Hh - 32, px + 12, Hh - 31, (188, 154, 116))
    return _props(house(2, 2, WOOD, 'wood', THATCH, 'thatch', True, 0, False, 25), props)


def armoury():
    """Арсенал: каменное хранилище со стойками оружия. 3x3."""
    def props(cv, W, Hh):
        # стойка с копьями у стены
        for i in range(5):
            px = 5 + i * 4
            cv.rect(px, Hh - 34, px + 1, Hh - 8, mix(WOOD, 0.86))
            cv.rect(px, Hh - 36, px + 1, Hh - 34, STEEL_C)
        cv.rect(4, Hh - 20, 26, Hh - 18, mix(WOOD, 0.72))
        # щиты на стене
        for i, px in enumerate((W - 30, W - 16)):
            cv.d.ellipse([px, Hh - 32, px + 12, Hh - 18],
                         fill=(*(146, 100, 62), 255))
            cv.d.ellipse([px + 4, Hh - 28, px + 8, Hh - 22],
                         fill=(*STEEL_C, 255))
    return _props(house(3, 3, STONE, 'stone', TILE_R, 'tile', True, 1, False, 26), props)


# -------------------------------------------------------------- этап 7.2
def _crenels(cv, x0, x1, ytop, base, step=7, w=3, hgt=7):
    for mx in range(int(x0), int(x1) + 1, step):
        cv.rect(mx, ytop - hgt, min(mx + w, x1), ytop - 1, mix(base, 1.06))
        cv.rect(mx, ytop - hgt, min(mx + w, x1), ytop - hgt + 1, mix(base, 1.28))


def gatehouse():
    """Ворота: две башенки, арка проезда и решётка. 2x2, проход насквозь."""
    tw, th = 2, 2
    W, Hh = tw * T, th * T + 46
    cv = Canvas(W, Hh)
    top = Hh - th * T
    cv.shadow(4, Hh - 5, W - 3, Hh - 1, 70)

    body_top = top - 26
    tex = wall_texture(STONE, 0, body_top, W - 1, Hh, 'stone', 41)

    # боковые башенки
    for bx0, bx1 in ((0, 15), (W - 16, W - 1)):
        for y in range(body_top - 8, Hh - 2):
            for x in range(bx0, bx1 + 1):
                side = (x - bx0) / max(1, bx1 - bx0)
                cv.px(x, y, mix(tex(x, y), 1.12 - side * 0.26))
        _crenels(cv, bx0, bx1, body_top - 8, STONE)

    # перемычка над проездом
    for y in range(body_top, body_top + 14):
        for x in range(14, W - 14):
            cv.px(x, y, tex(x, y))
    _crenels(cv, 14, W - 15, body_top, STONE, step=7)

    # арка и решётка
    ax0, ax1 = 16, W - 17
    cv.d.ellipse([ax0 - 1, body_top + 8, ax1 + 1, body_top + 30],
                 fill=(*mix(STONE, 0.72), 255))
    cv.rect(ax0 - 1, body_top + 19, ax1 + 1, Hh - 3, mix(STONE, 0.72))
    cv.d.ellipse([ax0 + 1, body_top + 10, ax1 - 1, body_top + 30],
                 fill=(*(38, 32, 26), 255))
    cv.rect(ax0 + 1, body_top + 20, ax1 - 1, Hh - 4, (38, 32, 26))
    for x in range(ax0 + 2, ax1, 3):                    # прутья решётки
        cv.rect(x, body_top + 12, x, Hh - 12, mix(IRON_C, 1.05))
    for y in range(body_top + 14, Hh - 12, 6):
        cv.rect(ax0 + 2, y, ax1 - 2, y, mix(IRON_C, 0.9))
    cv.outline()
    return cv.im


def _tower(tw, size_name, round_top=False, big=False):
    """Общая заготовка башни: тело, зубцы, бойницы."""
    W, Hh = tw * T, tw * T + (78 if big else 58)
    cv = Canvas(W, Hh)
    cv.shadow(4, Hh - 5, W - 3, Hh - 1, 75)
    body_top = Hh - tw * T - (30 if big else 22)
    tex = wall_texture(STONE, 0, body_top, W - 1, Hh, 'stone', 43)

    inset = 3 if round_top else 0
    for y in range(body_top, Hh - 2):
        for x in range(inset, W - inset):
            side = (x - inset) / max(1, W - 1 - inset * 2)
            cv.px(x, y, mix(tex(x, y), 1.14 - side * 0.30))

    # площадка с зубцами
    _crenels(cv, inset, W - 1 - inset, body_top, STONE, step=8 if big else 7)
    cv.d.line([inset, body_top, W - 1 - inset, body_top],
              fill=(*mix(STONE, 0.62), 255))
    cv.rect(inset, body_top + 1, W - 1 - inset, body_top + 3, mix(STONE, 1.10))

    # бойницы
    rows = 2 if big else 1
    for r in range(rows):
        wy = body_top + 12 + r * 18
        for wx in (W // 2 - 8, W // 2 + 6):
            cv.rect(wx, wy, wx + 2, wy + 9, mix(DARK, 1.05))
            cv.px(wx, wy, mix(STONE, 0.9))

    # дверь у основания
    cv.rect(W // 2 - 4, Hh - 16, W // 2 + 3, Hh - 3, mix(WOOD, 0.6))
    cv.rect(W // 2 - 3, Hh - 15, W // 2 + 2, Hh - 3, WOOD)
    cv.outline()
    return cv.im


def watchtower():
    """Сторожевая башня: дёшево, обзор. 2x2."""
    return _tower(2, 'watch')


def roundtower():
    """Круглая башня: больше гарнизон, +дальность лучникам. 3x3."""
    return _tower(3, 'round', round_top=True)


def squaretower():
    """Большая квадратная башня: сюда встанут баллиста и мангонель. 3x3."""
    return _tower(3, 'square', big=True)


def wolfpit():
    """Волчья яма: замаскированная ловушка с кольями. 1x1."""
    W = Hh = T
    cv = Canvas(W, Hh)
    for y in range(Hh):
        for x in range(W):
            cv.px(x, y, mix((96, 108, 62), 0.94 + h(x, y, 51) * 0.16))
    # прикрытие из веток
    cv.d.ellipse([3, 5, W - 4, Hh - 4], fill=(*(74, 62, 44), 255))
    for i in range(7):
        y = 8 + i * 3
        cv.rect(4, y, W - 5, y, mix((118, 100, 66), 1.0 - i * 0.03))
    for i in range(4):
        x = 6 + i * 6
        cv.rect(x, 7, x, Hh - 6, mix((104, 88, 58), 1.05))
    # торчащие колья
    for (px, py) in ((9, 12), (17, 16), (13, 20), (21, 11)):
        cv.rect(px, py, px, py + 3, (206, 198, 176))
        cv.px(px, py - 1, (232, 226, 208))
    cv.outline()
    return cv.im


def well():
    """Колодец: каменное кольцо, навес и ведро. 1x1."""
    W, Hh = T, T + 20
    cv = Canvas(W, Hh)
    top = Hh - T
    cv.shadow(6, Hh - 4, W - 5, Hh - 1, 60)
    # кольцо
    cv.d.ellipse([5, top + 8, W - 6, Hh - 4], fill=(*mix(STONE, 0.92), 255))
    cv.d.ellipse([8, top + 11, W - 9, Hh - 7], fill=(*(40, 52, 60), 255))
    cv.d.ellipse([10, top + 13, W - 11, Hh - 10], fill=(*(64, 96, 118), 255))
    # стойки и навес
    for px in (6, W - 8):
        cv.rect(px, top - 12, px + 1, top + 12, mix(WOOD, 0.86))
    cv.rect(4, top - 16, W - 5, top - 12, mix(THATCH, 1.0))
    cv.rect(4, top - 16, W - 5, top - 15, mix(THATCH, 1.2))
    # ворот и ведро
    cv.rect(6, top - 8, W - 8, top - 6, mix(WOOD, 0.94))
    cv.rect(W // 2 - 1, top - 6, W // 2, top + 2, (78, 70, 58))
    cv.rect(W // 2 - 3, top + 2, W // 2 + 2, top + 7, mix(WOOD, 0.8))
    cv.rect(W // 2 - 3, top + 2, W // 2 + 2, top + 3, mix(WOOD, 1.1))
    cv.outline()
    return cv.im


# ---------------------------------------------------------------- этап 9
def engineerguild():
    """Гильдия инженеров: сарай с чертежами, козлы и колесо. 3x3."""
    def props(cv, W, Hh):
        # козлы с брусом
        cv.rect(4, Hh - 24, 5, Hh - 6, mix(WOOD, 0.8))
        cv.rect(16, Hh - 24, 17, Hh - 6, mix(WOOD, 0.8))
        cv.rect(2, Hh - 26, 19, Hh - 23, WOOD)
        # колесо у стены
        cx, cy = W - 16, Hh - 16
        cv.d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], outline=(*mix(WOOD, 0.7), 255), width=2)
        cv.d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(*mix(WOOD, 0.9), 255))
        for i in range(4):
            import math as _m
            a2 = _m.radians(i * 45)
            cv.d.line([cx, cy, cx + int(_m.cos(a2) * 8), cy + int(_m.sin(a2) * 8)],
                      fill=(*mix(WOOD, 0.8), 255))
    return _props(house(3, 3, WOOD, 'wood', THATCH, 'thatch', True, 2, False, 61), props)


def oilpot():
    """Котёл с кипящим маслом: жаровня, чан, дым. 1x1."""
    W, Hh = T, T + 22
    cv = Canvas(W, Hh)
    top = Hh - T
    cv.shadow(6, Hh - 4, W - 5, Hh - 1, 60)
    # жаровня
    cv.rect(6, Hh - 12, W - 7, Hh - 4, mix(STONE, 0.86))
    cv.rect(6, Hh - 12, W - 7, Hh - 11, mix(STONE, 1.12))
    cv.rect(9, Hh - 10, W - 10, Hh - 7, (206, 108, 40))     # угли
    cv.rect(11, Hh - 9, W - 12, Hh - 8, (248, 196, 96))
    # чан
    cv.d.ellipse([4, top + 2, W - 5, Hh - 10], fill=(*mix(IRON_C, 0.9), 255))
    cv.d.ellipse([7, top + 5, W - 8, Hh - 13], fill=(*(46, 38, 30), 255))
    cv.d.ellipse([9, top + 6, W - 10, Hh - 16], fill=(*(126, 96, 46), 255))
    cv.rect(3, top + 6, 4, top + 10, mix(IRON_C, 1.1))       # дужка
    cv.rect(W - 5, top + 6, W - 4, top + 10, mix(IRON_C, 1.1))
    # дым
    for i in range(4):
        cv.px(W // 2 - 2 + (i % 3), top - 2 - i * 3, (176, 172, 164))
        cv.px(W // 2 - 1 + (i % 2), top - 3 - i * 3, (200, 196, 188))
    cv.outline()
    return cv.im


def tunnelguild():
    """Гильдия тоннельщиков: вход в штольню, крепь, отвал земли. 3x3."""
    def props(cv, W, Hh):
        # вход в штольню
        cv.rect(6, Hh - 30, 30, Hh - 6, (52, 44, 34))
        cv.d.ellipse([6, Hh - 36, 30, Hh - 22], fill=(*(52, 44, 34), 255))
        cv.rect(4, Hh - 32, 8, Hh - 4, mix(WOOD, 0.9))       # крепь
        cv.rect(28, Hh - 32, 32, Hh - 4, mix(WOOD, 0.9))
        cv.rect(3, Hh - 36, 33, Hh - 32, WOOD)
        cv.rect(3, Hh - 36, 33, Hh - 35, mix(WOOD, 1.15))
        # отвал земли
        for i in range(9):
            px = W - 26 + (i % 3) * 6
            py = Hh - 10 + (i % 2) * 3 - (i // 3) * 4
            cv.rect(px, py, px + 5, py + 3, (128, 100, 66) if i % 2 else (104, 82, 54))
        # кирка и лопата у стены
        cv.rect(W - 8, Hh - 30, W - 7, Hh - 10, mix(WOOD, 0.8))
        cv.rect(W - 12, Hh - 30, W - 4, Hh - 29, mix(IRON_C, 1.0))
    return _props(house(3, 3, WOOD, 'wood', THATCH, 'thatch', True, 1, False, 71), props)


BUILDINGS = {
    'keep':       ('Донжон',          keep),
    'hovel':      ('Лачуга',          lambda: house(2, 2, PLASTER, 'plaster', THATCH, 'thatch', True, 1, False, 1)),
    'woodcutter': ('Лесопилка',       lambda: house(2, 2, WOOD, 'wood', THATCH, 'thatch', True, 0, False, 2)),
    'quarry':     ('Каменоломня',     quarry),
    'ironmine':   ('Железный рудник', ironmine),
    'pitchrig':   ('Смоляная вышка',  pitchrig),
    'wheatfarm':  ('Пшеничная ферма', farm),
    'mill':       ('Мельница',        mill),
    'bakery':     ('Пекарня',         lambda: house(3, 3, PLASTER, 'plaster', TILE_R, 'tile', True, 2, True, 4, storeys=2)),
    'gatehouse':  ('Ворота',          gatehouse),
    'wolfpit':    ('Волчья яма',      wolfpit),
    'oilpot':     ('Котёл с маслом', oilpot),
    'well':       ('Колодец',         well),
    'watchtower': ('Сторожевая башня', watchtower),
    'roundtower': ('Круглая башня',   roundtower),
    'squaretower':('Квадратная башня', squaretower),
    'stockpile':  ('Склад',           stockpile),
    'granary':    ('Амбар',           lambda: house(3, 3, WOOD, 'wood', THATCH, 'thatch', True, 1, False, 5)),
    'hunter':     ('Охотничий домик', hunter),
    'hopsfarm':   ('Хмельник',        hopsfarm),
    'brewery':    ('Пивоварня',       brewery),
    'inn':        ('Таверна',         inn),
    'dairy':      ('Молочная ферма', dairy),
    'orchard':    ('Яблоневый сад',  orchard),
    'market':     ('Рынок',           market),
    'garden':     ('Сад',             garden),
    'statue':     ('Статуя',          statue),
    'fountain':   ('Фонтан',          fountain),
    'stocks':     ('Позорный столб',  stocks),
    'cage':       ('Клетка',          cage),
    'gallows':    ('Виселица',        gallows),
    'fletcher':   ('Лучный мастер',   fletcher),
    'poleturner': ('Копейщик-токарь', poleturner),
    'blacksmith': ('Кузница',         blacksmith),
    'armourer':   ('Оружейник',       armourer),
    'tanner':     ('Кожевник',        tanner),
    'armoury':    ('Арсенал',         armoury),
    'engineerguild': ('Гильдия инженеров', engineerguild),
    'tunnelguild':   ('Гильдия тоннельщиков', tunnelguild),
    'barracks':   ('Казарма',         lambda: house(4, 3, STONE, 'stone', TILE_R, 'tile', True, 3, False, 7, storeys=2)),
}


def build(outdir='assets/sprites/buildings'):
    os.makedirs(outdir, exist_ok=True)
    sizes = {}
    for bid, (name, fn) in BUILDINGS.items():
        im = fn()
        im.save(f'{outdir}/{bid}.png')
        sizes[bid] = (name, im.size)
    # стадии роста поля отдельными файлами: wheatfarm_0 .. wheatfarm_3
    for st in range(4):
        farm(st).save(f'{outdir}/wheatfarm_{st}.png')
        orchard(st).save(f'{outdir}/orchard_{st}.png')
        hopsfarm(st).save(f'{outdir}/hopsfarm_{st}.png')
    return sizes


def preview(path='/tmp/buildings_preview.png', scale=3):
    ims = [(name, fn()) for (name, fn) in BUILDINGS.values()]
    pad = 12
    cw = max(i.width for _, i in ims) * scale + pad
    ch = max(i.height for _, i in ims) * scale + pad + 26
    percol = 5
    cols = (len(ims) + percol - 1) // percol
    canvas = Image.new('RGB', (cols * cw + pad, percol * ch + pad), (44, 58, 34))
    d = ImageDraw.Draw(canvas)
    try:
        from PIL import ImageFont
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
    except Exception:
        f = None
    for i, (name, im) in enumerate(ims):
        cx = pad + (i // percol) * cw
        cy = pad + (i % percol) * ch
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        canvas.paste(big, (cx, cy + 20), big)
        d.text((cx, cy), name, fill=(230, 220, 190), font=f)
    canvas.save(path)


if __name__ == '__main__':
    build()
    preview()
    print('готово')
