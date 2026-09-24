#!/usr/bin/env bash
# Render any daily speed-read episodes that do not have a video yet.
# Expects: edge-tts, ffmpeg, pillow, and .cache/fonts/NotoSansCJKsc-Regular.otf
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
  python scripts/render_title_card.py "$meta" "/tmp/${date}.png" "$FONT"
  edge-tts --voice zh-CN-YunjianNeural --file "$txt" \
    --write-media "/tmp/${date}.mp3" --write-subtitles "/tmp/${date}.vtt"
  ffmpeg -y -loglevel error -i "/tmp/${date}.vtt" "/tmp/${date}.srt"
  cp "/tmp/${date}.vtt" "public/daily/${date}.vtt"
  dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "/tmp/${date}.mp3")
  ffmpeg -y -loglevel error -loop 1 -framerate 30 -i "/tmp/${date}.png" -i "/tmp/${date}.mp3" \
    -vf "subtitles=/tmp/${date}.srt:force_style='FontName=Noto Sans CJK SC,FontSize=14,PrimaryColour=&HFFFFFF,OutlineColour=&H80000000,Outline=2,MarginV=120'" \
    -t "$dur" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart -shortest "$mp4"
  echo "rendered ${mp4} (${dur}s)"
done
