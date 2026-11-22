# Synthesised sounds (sfx-skill)

Nine story effects and five soundscape loops have no recording under Versta's licence bar, so they are made by
synthesis with [sfx-skill](https://github.com/owoevan-dev/sfx-skill) (MIT): oscillators, FM, noise, struck modes,
bubbles and wind, no recordings and no audio model. Every file is CC0, composed for Versta.

| File | What |
| --- | --- |
| `design.py` | The sounds, written with sfx-skill's builders (`scripts/sfxkit.py`). Writes `project.json` (not committed). |
| `make.py` | Runs `design.py`, renders with `sfx.py render`, then masters each file to Versta's targets. |

Effects go to `public/sounds/fx/<name>.mp3` (mono, 64 kbps, about -27 LUFS, peak under -3 dBFS, leading silence
trimmed, short fades); loops to `public/sounds/<name>.mp3` (mono, 64 kbps, about -26 LUFS, 30 s, seamless).

## Rerun

1. Get the skill outside this repo, for example `git clone https://github.com/owoevan-dev/sfx-skill ~/sfx-skill`. It
   needs Python 3.10 or newer with NumPy, and FFmpeg. Do not commit it here. No sample library is needed.
2. `python3 tools/sound/sfx/make.py --skill ~/sfx-skill/skills/sound-effects --render /tmp/versta-sfx-render`
   (a new, empty render folder each time; the render takes about six minutes). `--no-render` masters an existing render
   again.
3. Copy each effect's printed length into `src/audio/catalogue.json`, then run
   `python3 tools/sound/build_sounds.py check` and `python3 tools/sound/build_sounds.py credits`.
4. If a loop changed, measure the soundscapes again (`tools/sound/measure-scapes.mjs`) and paste its `TRIM_DB` into
   `src/audio/soundscapes.ts`.

To hear the sounds before they are mastered, render without `--no-page` and open the `audition.html` that sfx-skill
writes in the render folder.
