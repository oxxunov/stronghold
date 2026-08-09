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


BUILDINGS = {
    'keep':       ('Донжон',          keep),
    'hovel':      ('Лачуга',          lambda: house(2, 2, PLASTER, 'plaster', THATCH, 'thatch', True, 1, False, 1)),
    'woodcutter': ('Лесопилка',       lambda: house(2, 2, WOOD, 'wood', THATCH, 'thatch', True, 0, False, 2)),
    'quarry':     ('Каменоломня',     quarry),
    'wheatfarm':  ('Пшеничная ферма', farm),
    'mill':       ('Мельница',        mill),
    'bakery':     ('Пекарня',         lambda: house(3, 3, PLASTER, 'plaster', TILE_R, 'tile', True, 2, True, 4, storeys=2)),
    'stockpile':  ('Склад',           stockpile),
    'granary':    ('Амбар',           lambda: house(3, 3, WOOD, 'wood', THATCH, 'thatch', True, 1, False, 5)),
    'garden':     ('Сад',             garden),
    'statue':     ('Статуя',          statue),
    'fountain':   ('Фонтан',          fountain),
    'stocks':     ('Позорный столб',  stocks),
    'cage':       ('Клетка',          cage),
    'gallows':    ('Виселица',        gallows),
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
