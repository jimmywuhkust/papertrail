#!/usr/bin/env bash
# Render any daily speed-read episodes that do not have a video yet.
# Episodes with a PDF walk the viewer through the paper: segments that
# discuss a figure/table zoom into it (highlighted), others scroll smoothly
# down the page. Subtitles are NOT burned in — a VTT sidecar is published.
# Expects: edge-tts, ffmpeg, poppler-utils, pillow, node, and
# .cache/fonts/NotoSansCJKsc-Regular.otf
set -euo pipefail

FONT=.cache/fonts/NotoSansCJKsc-Regular.otf
mkdir -p public/daily

for txt in public/data/daily/*.txt; do
  case "$txt" in
    *.meta.txt) continue ;;
  esac
  date=$(basename "$txt" .txt)
  mp4="public/daily/${date}.mp4"
  if [ -f "$mp4" ]; then
    echo "skip ${date} (video exists)"
    continue
  fi

  meta="public/data/daily/${date}.meta.txt"
  segments_json="public/data/daily/${date}.segments.json"
  work=$(mktemp -d)
  pdf_url=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$segments_json','utf8')).pdfUrl || '')")
  page_count=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$segments_json','utf8')).pageCount || 0)")
  segment_count=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$segments_json','utf8')).segments.length)")
  use_pdf=0

  # 1. Optional: download the paper PDF, rasterize pages, extract word boxes.
  if [ -n "$pdf_url" ] && [ "$page_count" -gt 0 ]; then
    mkdir -p "$work/pages"
    if curl -sSL --max-time 120 -o "$work/paper.pdf" "$pdf_url"; then
      pdftoppm -r 110 -png "$work/paper.pdf" "$work/pages/page"
      pdftotext -bbox "$work/paper.pdf" "$work/bbox.xhtml"
      python scripts/render_paper_frames.py "$segments_json" "$work/pages" "$work/bbox.xhtml" "$FONT" "$work"
      use_pdf=1
      echo "${date}: PDF walkthrough planned ($pdf_url)"
    else
      echo "${date}: PDF download failed, using title cards"
    fi
  fi

  # 2. Per segment: TTS audio + an animated video clip.
  > "$work/videos.txt"
  > "$work/audio.txt"
  vtt_inputs=()
  for ((i = 0; i < segment_count; i++)); do
    text=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$segments_json','utf8')).segments[$i].text)")
    printf '%s' "$text" > "$work/seg-$i.txt"
    edge-tts --voice zh-CN-YunjianNeural --file "$work/seg-$i.txt" \
      --write-media "$work/seg-$i.mp3" --write-subtitles "$work/seg-$i.vtt"
    dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$work/seg-$i.mp3")

    if [ "$use_pdf" -eq 1 ]; then
      mode=$(awk -v n="$i" '$1 == n {print $2}' "$work/plan.txt")
      if [ "$mode" = "region" ]; then
        # Gentle diagonal drift across the highlighted figure/table crop.
        ffmpeg -y -loglevel error -loop 1 -i "$work/canvas-$i.png" \
          -vf "crop=1080:1920:'(iw-1080)*min(t/$dur\,1)':'(ih-1920)*0.65*min(t/$dur\,1)',format=yuv420p,fps=30" \
          -t "$dur" -c:v libx264 -preset veryfast -crf 23 "$work/vid-$i.mp4"
      else
        # Smooth top-to-bottom scroll of the full page.
        ffmpeg -y -loglevel error -loop 1 -i "$work/canvas-$i.png" \
          -vf "crop=1080:1920:'(iw-1080)/2':'(ih-1920)*min(t/$dur\,1)',format=yuv420p,fps=30" \
          -t "$dur" -c:v libx264 -preset veryfast -crf 23 "$work/vid-$i.mp4"
      fi
    else
      python scripts/render_title_card.py "$meta" "$work/card.png" "$FONT"
      ffmpeg -y -loglevel error -loop 1 -i "$work/card.png" \
        -vf "format=yuv420p,fps=30" -t "$dur" -c:v libx264 -preset veryfast -crf 23 "$work/vid-$i.mp4"
    fi
    echo "file '$work/vid-$i.mp4'" >> "$work/videos.txt"
    echo "file '$work/seg-$i.mp3'" >> "$work/audio.txt"
    vtt_inputs+=("$work/seg-$i.vtt" "$dur")
  done

  # 3. Assemble video, audio, and the merged caption track.
  node scripts/merge-vtt.mjs "public/daily/${date}.vtt" "${vtt_inputs[@]}"
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$work/videos.txt" -c:v copy "$work/video.mp4"
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$work/audio.txt" -c:a aac -b:a 128k "$work/audio.m4a"
  ffmpeg -y -loglevel error -i "$work/video.mp4" -i "$work/audio.m4a" \
    -c:v copy -c:a copy -movflags +faststart -shortest "$mp4"
  rm -rf "$work"
  echo "rendered ${mp4}"
done
