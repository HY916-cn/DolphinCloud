#!/usr/bin/env bash
# Mix the opening (film 0:00–1:45) music and sound effects into ../out/titles/opening-mix.wav,
# on the cue sheet in AUDIO.md. Needs the files in audio/ (see AUDIO.md for where they come from).
set -euo pipefail
cd "$(dirname "$0")/.."
M=audio/music/01-dreaming-big.mp3
X=audio/sfx
DRUM=${DRUM:-fs_378378_Floor-tom-wav.mp3}
DRUM_AT=${DRUM_AT:-0.043}   # seconds into the drum file where its attack is

# Title drum hits: one per amount, on the music's beat grid (135 BPM) from film 1:20.
hits=$(awk 'BEGIN { b = 60 / 135; t = 0; n = split("1 1 1 1 .5 .5 .5 .5 .25 .25 .25 .25 .25 .25 .25 .25 .25 .25", d, " ");
  for (i = 1; i <= n; i++) { printf "%d ", (80 + int(t * 30 + 0.5) / 30 - '"$DRUM_AT"') * 1000; t += d[i] * b } }')

# Input 0 is a silent 105 s bed: it pins the mix to film 0:00 and runs it to 1:45.
inputs=(-f lavfi -t 105 -i anullsrc=r=48000:cl=stereo) filters=() labels=("[0:a]") count=1
add() { # file, start-in-file, end-in-file, film-second, volume
  local i=$count ms
  count=$((count + 1))
  ms=$(awk -v s="$4" 'BEGIN { printf "%d", s * 1000 }')
  inputs+=(-i "$1")
  filters+=("[$i:a]atrim=$2:$3,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=$5,adelay=delays=$ms:all=1[a$i]")
  labels+=("[a$i]")
}

# Music: film 0:11 = song 23.2 s (fade in 3 s); stops dead at film 1:15 = song 87.2 s, half a second of tail.
add "$M" 23.2 87.7 11 1.0
filters[0]="${filters[0]/volume=1.0/volume=1.0,afade=t=in:st=0:d=3,afade=t=out:st=64:d=0.5}"

add $X/fs_794463_Upright-Piano-Remeau-up-close-XY-G4.mp3 0 7.6 0 0.9      # 0:00 piano
add $X/fs_545521_briefcase-latch-open-close-click-wav.mp3 2.1 3.2 3.84 0.8 # 0:04 latch (click at 2.26 s)
add $X/fs_794463_Upright-Piano-Remeau-up-close-XY-G4.mp3 0 7.6 8 0.8      # 0:08 piano
add $X/fs_683102_water-drop.mp3 0 1.7 15 0.9                                # 0:15 water drop
add $X/fs_497133_Paper-landing-m4a.mp3 2.6 4.2 19.72 1.0                    # 0:20 note on palm (lands at 2.88 s)
add $X/fs_347892_window-blinds-raise-01-wav.mp3 0 1.4 43 0.5                # 0:43 blinds
add $X/fs_538771_Manual-banknote-counting-mp3.mp3 0 4 47 0.35               # 0:47 counting notes
add $X/fs_627647_Enter-Key-Press-Mechanical-Keyboard.mp3 0 0.2 51 0.6       # 0:51 enter
add $X/fs_611113_bell-ding-1-wav.mp3 0 2.5 71 0.5                          # 1:11 ding
for ms in $hits; do add "$X/$DRUM" 0 0.5 "$(awk -v m="$ms" 'BEGIN { print m / 1000 }')" 0.9; done  # 1:20 drum hits
add $X/fs_794463_Upright-Piano-Remeau-up-close-XY-G4.mp3 0 7.6 85 0.9     # 1:25 piano returns
add $X/fs_428073_Sub-Drop-Smooth-wav.mp3 0 3.8 89 0.5                       # 1:29 low hit on the logo
add $X/fs_531015_Ocean-Waves-wav.mp3 0 9 89 0.25                            # 1:29 waves under the logo
add $X/fs_718274_empty-lecture-theatre-ambience-stereo.mp3 0 10 95 0.6      # 1:35 hall
add $X/fs_272490_Footsteps_on_stage_Simple_with_reverb-wa.mp3 0 3.4 98 18   # 1:38 footsteps (+25 dB)

graph=$(IFS=';'; echo "${filters[*]}")
ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex \
  "$graph;$(IFS=; echo "${labels[*]}")amix=inputs=${#labels[@]}:normalize=0:dropout_transition=0,atrim=0:105,alimiter=limit=0.95[out]" \
  -map "[out]" -ar 48000 ../out/titles/opening-mix.wav
echo "../out/titles/opening-mix.wav"
