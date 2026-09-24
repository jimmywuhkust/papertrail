#!/usr/bin/env python3
"""Render a 1080x1920 title card PNG for a daily speed-read episode.

Usage: render_title_card.py <meta.txt> <out.png> <font.otf>
meta.txt lines: 1 = paper title, 2 = venue · year, 3 = date
"""
import sys

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1080, 1920


def wrap(draw, text, font, max_width):
    lines, current = [], ""
    for char in text:
        trial = current + char
        if draw.textlength(trial, font=font) > max_width and current:
            lines.append(current)
            current = char
        else:
            current = trial
    if current:
        lines.append(current)
    return lines


def main():
    meta_path, out_path, font_path = sys.argv[1], sys.argv[2], sys.argv[3]
    lines = [line.strip() for line in open(meta_path, encoding="utf-8") if line.strip()]
    title, venue, date = (lines + ["", "", ""])[:3]

    image = Image.new("RGB", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        ratio = y / HEIGHT
        draw.line([(0, y), (WIDTH, y)], fill=(int(16 + 20 * ratio), int(20 + 24 * ratio), int(28 + 34 * ratio)))

    brand_font = ImageFont.truetype(font_path, 40)
    title_font = ImageFont.truetype(font_path, 72)
    meta_font = ImageFont.truetype(font_path, 44)
    small_font = ImageFont.truetype(font_path, 36)

    draw.text((80, 120), "文脉 PAPERTRAIL", font=brand_font, fill=(233, 168, 120))
    draw.text((80, 180), "每日论文速读 · DAILY SPEED-READ", font=small_font, fill=(150, 158, 170))

    y = 460
    for line in wrap(draw, title, title_font, WIDTH - 160)[:8]:
        draw.text((80, y), line, font=title_font, fill=(245, 243, 238))
        y += 100

    draw.rectangle([(80, y + 40), (560, y + 46)], fill=(233, 168, 120))
    draw.text((80, y + 80), venue, font=meta_font, fill=(200, 206, 216))
    draw.text((80, HEIGHT - 200), date, font=meta_font, fill=(150, 158, 170))
    draw.text((80, HEIGHT - 130), "每天三分钟 · 一篇顶会论文", font=small_font, fill=(120, 128, 140))

    image.save(out_path)


if __name__ == "__main__":
    main()
