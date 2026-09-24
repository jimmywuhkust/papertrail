#!/usr/bin/env node
/**
 * Merge per-segment WebVTT files into one, shifting each segment's cues by
 * the cumulative duration of the previous segments.
 *
 * Usage: node scripts/merge-vtt.mjs <out.vtt> <seg1.vtt> <dur1_sec> [<seg2.vtt> <dur2_sec> ...]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...rest] = process.argv.slice(2);
const pairs = [];
for (let index = 0; index < rest.length; index += 2) {
  pairs.push({ file: rest[index], duration: Number(rest[index + 1]) || 0 });
}

function parseTime(value) {
  const match = value.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
  if (!match) return 0;
  const [, hours = "0", minutes, seconds, fraction] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction}`);
}

function formatTime(total) {
  const clamped = Math.max(0, total);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

let offset = 0;
let cueNumber = 1;
const blocks = [];
for (const { file, duration } of pairs) {
  const text = readFileSync(file, "utf8").replace(/\r/g, "");
  for (const block of text.split("\n\n")) {
    const lines = block.trim().split("\n").filter(Boolean);
    if (!lines.length || /^WEBVTT/i.test(lines[0]) || /^NOTE/.test(lines[0])) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [start, end] = lines[timingIndex].split("-->");
    const body = lines.slice(timingIndex + 1).join("\n");
    if (!body.trim()) continue;
    blocks.push(`${cueNumber}\n${formatTime(parseTime(start) + offset)} --> ${formatTime(parseTime(end) + offset)}\n${body}`);
    cueNumber += 1;
  }
  offset += duration;
}

writeFileSync(out, `WEBVTT\n\n${blocks.join("\n\n")}\n`);
console.log(`merged ${pairs.length} segments, ${blocks.length} cues, ${offset.toFixed(1)}s total`);
