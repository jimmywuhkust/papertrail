#!/usr/bin/env python3
"""Compose a 1080x1920 video frame showing one PDF page.

Usage: render_paper_frame.py <page.png> <meta.txt> <page_num> <page_total> <out.png> <font.otf>
meta.txt lines: 1 = paper title, 2 = venue · year, 3 = date
"""
import sys

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1080, 1920
TOP_BAR, BOTTOM_BAR = 132, 84


def main():
    page_path, meta_path, page_num, page_total, out_path, font_path = sys.argv[1:7]
    lines = [line.strip() for line in open(meta_path, encoding="utf-8") if line.strip()]
    title, venue, date = (lines + ["", "", ""])[:3]

    image = Image.new("RGB", (WIDTH, HEIGHT), (16, 20, 28))
    draw = ImageDraw.Draw(image)
    brand_font = ImageFont.truetype(font_path, 34)
    small_font = ImageFont.truetype(font_path, 30)

    draw.text((60, 34), "文脉 PAPERTRAIL", font=brand_font, fill=(233, 168, 120))
    draw.text((60, 80), f"{venue} · {date}", font=small_font, fill=(150, 158, 170))

    page = Image.open(page_path).convert("RGB")
    avail_w, avail_h = WIDTH - 48, HEIGHT - TOP_BAR - BOTTOM_BAR - 24
    scale = min(avail_w / page.width, avail_h / page.height)
    resized = page.resize((int(page.width * scale), int(page.height * scale)), Image.LANCZOS)
    x = (WIDTH - resized.width) // 2
    y = TOP_BAR + (avail_h - resized.height) // 2
    draw.rectangle([(x - 6, y - 6), (x + resized.width + 6, y + resized.height + 6)], fill=(60, 68, 80))
    image.paste(resized, (x, y))

    label = f"{page_num} / {page_total}"
    label_w = draw.textlength(label, font=small_font)
    draw.text(((WIDTH - label_w) / 2, HEIGHT - BOTTOM_BAR + 24), label, font=small_font, fill=(150, 158, 170))

    image.save(out_path)


if __name__ == "__main__":
    main()
