#!/usr/bin/env bash
# Render the finished pieces into docs/launch/video/out/titles/.
#   scripts/render.sh            everything
#   scripts/render.sh P5 P14     only these groups (P1 P2 P3 P5 P10 P14)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=../out/titles
mkdir -p "$OUT/P1" "$OUT/P3"

hq()      { npx remotion render "$1" "$2.mov" --codec=prores --prores-profile=hq; }
alpha()   { npx remotion render "$1" "$2.mov" --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png; }
preview() { npx remotion render "$1" "$2.mp4" --codec=h264 --crf=16 --image-format=jpeg --jpeg-quality=95; }

groups=("$@")
[ ${#groups[@]} -eq 0 ] && groups=(P1 P2 P3 P5 P10 P14)

for g in "${groups[@]}"; do
  case $g in
    P1)
      # Over footage: transparent ProRes 4444. Full-frame cards: ProRes 422 HQ.
      for c in Sub-Small Sub-Counts Name-Teller Name-President Name-Admin; do alpha "P1-$c" "$OUT/P1/$c"; done
      for c in Chapter-Counter Chapter-Students Chapter-Bank EndCredit; do hq "P1-$c" "$OUT/P1/$c"; done ;;
    P2)  hq P2-Title-Light "$OUT/P2-title"; preview P2-Title-Light "$OUT/P2-title-preview" ;;
    P3)
      # For the auditorium screen: H.264 files that play and then hold (or loop seamlessly).
      for c in Waves Theme Sheet Launch Three Principles Numbers; do preview "P3-$c" "$OUT/P3/$c"; done ;;
    P5)  hq P5-Design "$OUT/P5-design"; preview P5-Design "$OUT/P5-design-preview" ;;
    P10) hq P10-Numbers "$OUT/P10-numbers"; preview P10-Numbers "$OUT/P10-numbers-preview" ;;
    P14) hq P14-Wall "$OUT/P14-wall"; preview P14-Wall "$OUT/P14-wall-preview" ;;
    *) echo "unknown group: $g" >&2; exit 1 ;;
  esac
done
