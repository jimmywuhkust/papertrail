#!/usr/bin/env bash
# Render any daily speed-read episodes that do not have a video yet.
# Episodes with a PDF walk the viewer through the paper page by page, one
# frame per narration segment; others fall back to a static title card.
# Subtitles are NOT burned in — a VTT sidecar is published for the player.
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

  # 1. Optional: download the paper PDF and rasterize its pages.
  if [ -n "$pdf_url" ] && [ "$page_count" -gt 0 ]; then
    mkdir -p "$work/pages"
    if curl -sSL --max-time 120 -o "$work/paper.pdf" "$pdf_url"; then
      pdftoppm -r 110 -png "$work/paper.pdf" "$work/pages/page"
      echo "${date}: PDF rendered ($pdf_url)"
    else
      echo "${date}: PDF download failed, using title cards"
      page_count=0
    fi
  fi

  # 2. Per segment: TTS audio + a frame showing the page being discussed.
  > "$work/frames.txt"
  > "$work/audio.txt"
  vtt_inputs=()
  for ((i = 0; i < segment_count; i++)); do
    text=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$segments_json','utf8')).segments[$i].text)")
    page=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$segments_json','utf8')).segments[$i].page || 0)")
    printf '%s' "$text" > "$work/seg-$i.txt"
    edge-tts --voice zh-CN-YunjianNeural --file "$work/seg-$i.txt" \
      --write-media "$work/seg-$i.mp3" --write-subtitles "$work/seg-$i.vtt"
    dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$work/seg-$i.mp3")
    page_png=$(printf '%s/page-%02d.png' "$work/pages" "$page")
    if [ "$page" -gt 0 ] && [ -f "$page_png" ]; then
      python scripts/render_paper_frame.py "$page_png" "$meta" "$page" "$page_count" "$work/frame-$i.png" "$FONT"
    else
      python scripts/render_title_card.py "$meta" "$work/frame-$i.png" "$FONT"
    fi
    echo "file '$work/frame-$i.png'" >> "$work/frames.txt"
    echo "duration $dur" >> "$work/frames.txt"
    echo "file '$work/seg-$i.mp3'" >> "$work/audio.txt"
    vtt_inputs+=("$work/seg-$i.vtt" "$dur")
  done
  # concat demuxer needs the last frame repeated once.
  echo "file '$work/frame-$((segment_count - 1)).png'" >> "$work/frames.txt"

  # 3. Assemble video, audio, and the merged caption track.
  node scripts/merge-vtt.mjs "public/daily/${date}.vtt" "${vtt_inputs[@]}"
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$work/frames.txt" \
    -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x101418,format=yuv420p" \
    -fps_mode vfr "$work/video.mp4"
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$work/audio.txt" -c:a aac -b:a 128k "$work/audio.m4a"
  ffmpeg -y -loglevel error -i "$work/video.mp4" -i "$work/audio.m4a" \
    -c:v copy -c:a copy -movflags +faststart -shortest "$mp4"
  rm -rf "$work"
  echo "rendered ${mp4}"
done
