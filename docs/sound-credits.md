# Sound credits

Every recorded sound in `public/sounds/` comes from Wikimedia Commons or a free soundfont. Licences are CC0, public
domain or CC BY (attribution given below and in the app). Nothing under CC BY-SA, NC, ND or GFDL is used. Licence
strings and authors are as Commons showed them when the files were fetched.

`tools/sound/build_sounds.py` cuts each file, mixes it to mono, high-passes it (60 Hz unless noted), normalises it and
encodes it as mp3 (loops about -26 LUFS at 64 kbps, effects about -27 LUFS, the ship's bell about -24 LUFS). The list of
sources is `tools/sound/sources.json`; this page is written by `python3 tools/sound/build_sounds.py credits` from
`src/audio/credits-sounds.json` and `src/audio/credits-music.json`. The app joins the end of each loop to its start
with a 1.5 s crossfade when it decodes the file.

## Loops

| File | Source page on Commons | Author | Licence | Cut |
| --- | --- | --- | --- | --- |
| water.mp3 | [Shallow small river with stony riverbed.ogg](https://commons.wikimedia.org/wiki/File:Shallow_small_river_with_stony_riverbed.ogg) | stephan | Public domain | 18 s from the start |
| shore.mp3 | [On a pebble beach.ogg](https://commons.wikimedia.org/wiki/File:On_a_pebble_beach.ogg) | earthcalling | Public domain | 40 s from the start, high-pass 100 Hz |
| wharf.mp3 | [Boat by a wharf 2.ogg](https://commons.wikimedia.org/wiki/File:Boat_by_a_wharf_2.ogg) | ezwa | Public domain | 40 s from 59 s, high-pass 100 Hz |
| wind.mp3 | [Howling wind.ogg](https://commons.wikimedia.org/wiki/File:Howling_wind.ogg) | Tvabutzku1234 | CC0 | 40 s from 34 s |
| gulls.mp3 | [Gull 1.ogg](https://commons.wikimedia.org/wiki/File:Gull_1.ogg) | avphillips | Public domain | 18 s from the start |
| murmur.mp3 | [360703 eguobyte large-crowd-medium-distance-stereo.wav](https://commons.wikimedia.org/wiki/File:360703_eguobyte_large-crowd-medium-distance-stereo.wav) | eguobyte | CC0 | 40 s from 12 s |
| tick.mp3 | [Clock (tic tac).ogg](https://commons.wikimedia.org/wiki/File:Clock_(tic_tac).ogg) | Saaabaaato | CC0 | 18 s from the start |
| bells.mp3 | [Church bells - Leverkusen, 2007.oga](https://commons.wikimedia.org/wiki/File:Church_bells_-_Leverkusen,_2007.oga) | natalie | Public domain | 40 s from the start |

## Still generated

The stand-in layers in `src/audio/soundscapes.ts` (`gen`) play in place of a recording that fails to load, and
wherever no recording has been fetched yet (below).

### Chosen on Commons, not fetched yet

These are in `tools/sound/sources.json` with licences read from their Commons pages. `python3 tools/sound/build_sounds.py fetch` downloads them; Wikimedia answered every download request with 429 (retry-after 600) while this was prepared.

- `tide.mp3`: Water over rocks as tide recedes.ogg
- `lap.mp3`: WWS Smallwaves.ogg
- `creak.mp3`: WWS Creakingfloors.ogg
- `ice.mp3`: Singing iceberg.oga
- `timber.mp3`: WWS Wheelwrightcarvingaspoke.ogg
- `drips.mp3`: WWS Waterdrainingthroughtherock.ogg
- `pub.mp3`: Restaurant ambience.ogg
- `church.mp3`: Church people walking steps with reverb.ogg
- `birds.mp3`: Birds singing in garden.ogg
- `crowd.mp3`: 211146 unfa another-crowd.flac
- `weir.mp3`: Vojníkov, 3. jez, středa.ogg
- `hum.mp3`: Pump.ogg
- `office.mp3`: LA2 kitchen clock.ogg
- `fx/ship-horn.mp3`: Fog signal Bremerhaven.ogg
- `fx/steam-engine.mp3`: Steam engine.ogg
- `fx/ice-creak.mp3`: Singing iceberg.oga
- `fx/hammer.mp3`: WWS Watersmithyforgingwithtwohammers.ogg
- `fx/adze.mp3`: WWS Wheelwrightcarvingaspoke.ogg
- `fx/chain.mp3`: WWS Wardrobechainloweringandraising.ogg
- `fx/water-lap.mp3`: WWS Smallwaves.ogg
- `fx/crowd.mp3`: 211146 unfa another-crowd.flac
- `fx/fire-crackle.mp3`: Campfire sound ambience.ogg
- `fx/telegraph.mp3`: WWS Teleprintertyping.ogg
- `fx/water-wheel.mp3`: WWS Horizontalwaterwheel.ogg
- `fx/bubbling.mp3`: Oil boiling.ogg
- `signals/aside.mp3`: WWS ShipSodekshipsbell.ogg

No candidate under CC0, public domain or CC BY was found for these effects, and they stay unrecorded: `sail-flap`, `tankards`, `oars`, `distant-cannon`, `parrots`, `big-bell`, `crates`, `waders`, `water-flow`.
