#!/usr/bin/env python3
"""Plan per-segment video canvases for a paper walkthrough episode.

For each narration segment this emits one canvas PNG plus a plan line:
  - "region": the figure/table the segment discusses, cropped from the page
    (caption located via pdftotext -bbox coordinates), upscaled with a
    highlight border. The video gently pans across it.
  - "scroll": the full page upscaled to 1620px wide. The video scrolls down.

Usage:
  render_paper_frames.py <segments.json> <pages_dir> <bbox.xhtml> <font.otf> <out_dir>
Writes <out_dir>/canvas-<i>.png and <out_dir>/plan.txt
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ACCENT = (233, 168, 120)
BG = (16, 20, 28)


def load_bbox_pages(xhtml_path):
    tree = ET.parse(xhtml_path)
    root = tree.getroot()
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
    pages = []
    for page in root.iter(f"{ns}page"):
        words = []
        for word in page.iter(f"{ns}word"):
            words.append(
                {
                    "text": word.text or "",
                    "x0": float(word.get("xMin")),
                    "y0": float(word.get("yMin")),
                    "x1": float(word.get("xMax")),
                    "y1": float(word.get("yMax")),
                }
            )
        pages.append({"width": float(page.get("width")), "height": float(page.get("height")), "words": words})
    return pages


def find_caption(words, label):
    """Locate '<Figure|Table> <N>' in reading order; return its bbox."""
    match = re.match(r"(?i)\s*(figure|fig\.?|table)\s*(\d+)", label or "")
    if not match:
        return None
    kind, number = match.group(1).lower(), match.group(2)
    ordered = sorted(words, key=lambda w: (round(w["y0"], 1), w["x0"]))
    for index, word in enumerate(ordered):
        text = word["text"].lower().rstrip(".,:;")
        if text not in ("figure", "fig.", "fig", "table"):
            continue
        if kind.startswith("tab") != text.startswith("tab"):
            continue
        for follow in ordered[index + 1 : index + 3]:
            if follow["y0"] > word["y1"] + 6:
                break
            if re.match(rf"^{number}\b", follow["text"]):
                return {
                    "x0": min(word["x0"], follow["x0"]),
                    "y0": min(word["y0"], follow["y0"]),
                    "x1": max(word["x1"], follow["x1"]),
                    "y1": max(word["y1"], follow["y1"]),
                }
    return None


def region_for(page, caption, is_table):
    page_w, page_h = page["width"], page["height"]
    gutter = page_w / 2
    # Single-line captions are column-centered in ACM style, so the caption's
    # own position says nothing about figure width — always crop the column.
    if caption["x0"] < gutter - 20:
        col_x0, col_x1 = 46.0, gutter - 18
    else:
        col_x0, col_x1 = gutter + 12, page_w - 46.0
    if is_table:
        y0, y1 = caption["y0"] - 8, caption["y1"] + 0.34 * page_h
    else:
        y0, y1 = caption["y0"] - 0.42 * page_h, caption["y1"] + 8
    y0 = max(72.0, y0)  # stay below the running head
    y1 = min(page_h - 46.0, y1)
    if y1 - y0 > 0.8 * page_h or y1 - y0 < 60:
        return None
    return (col_x0, y0, col_x1, y1)


def main():
    segments_path, pages_dir, bbox_path, font_path, out_dir = sys.argv[1:6]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    data = json.loads(Path(segments_path).read_text(encoding="utf-8"))
    bbox_pages = load_bbox_pages(bbox_path)
    plan = []

    for index, segment in enumerate(data["segments"]):
        page_number = segment.get("page") or 1
        candidates = sorted(Path(pages_dir).glob(f"page-*{page_number:02d}.png"))
        if not candidates:
            candidates = sorted(Path(pages_dir).glob(f"page-{page_number:03d}.png"))
        page_image = Image.open(candidates[0]).convert("RGB") if candidates else None
        mode = "scroll"

        label = segment.get("figure") or segment.get("table") or ""
        if page_image and 1 <= page_number <= len(bbox_pages) and label:
            bbox_page = bbox_pages[page_number - 1]
            caption = find_caption(bbox_page["words"], label)
            is_table = bool(re.match(r"(?i)\s*tab", label))
            region = region_for(bbox_page, caption, is_table) if caption else None
            if region:
                scale_x = page_image.width / bbox_page["width"]
                scale_y = page_image.height / bbox_page["height"]
                crop = (
                    int(region[0] * scale_x),
                    int(region[1] * scale_y),
                    int(region[2] * scale_x),
                    int(region[3] * scale_y),
                )
                figure = page_image.crop(crop)
                mode = "region"

        if mode == "region":
            canvas = Image.new("RGB", (1296, 2304), BG)
            scale = min(1180 / figure.width, 2050 / figure.height)
            resized = figure.resize((int(figure.width * scale), int(figure.height * scale)), Image.LANCZOS)
            x, y = (1296 - resized.width) // 2, (2304 - resized.height) // 2
            canvas.paste(resized, (x, y))
            draw = ImageDraw.Draw(canvas)
            for inset in range(10):
                draw.rectangle(
                    [(x - 14 - inset, y - 14 - inset), (x + resized.width + 13 + inset, y + resized.height + 13 + inset)],
                    outline=ACCENT,
                )
            font = ImageFont.truetype(font_path, 40)
            draw.text((60, 60), label, font=font, fill=ACCENT)
        else:
            if page_image is None:
                canvas = Image.new("RGB", (1620, 2289), BG)
            else:
                scale = 1620 / page_image.width
                canvas = page_image.resize((1620, int(page_image.height * scale)), Image.LANCZOS)
            if canvas.height < 1920:
                background = Image.new("RGB", (1620, 1920), BG)
                background.paste(canvas, (0, (1920 - canvas.height) // 2))
                canvas = background

        canvas.save(out / f"canvas-{index}.png")
        plan.append(f"{index} {mode}")
        print(f"segment {index}: {mode}{' (' + label + ')' if label and mode == 'region' else ''}")

    (out / "plan.txt").write_text("\n".join(plan) + "\n")


if __name__ == "__main__":
    main()
