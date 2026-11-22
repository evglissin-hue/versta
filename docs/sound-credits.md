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
| bells.mp3 | [Church bells - Leverkusen, 2007.oga](https://commons.wikimedia.org/wiki/File:Church_bells_-_Leverkusen,_2007.oga) | natalie | Public domain | 40 s from the start |
| birds.mp3 | [Birds singing in garden.ogg](https://commons.wikimedia.org/wiki/File:Birds_singing_in_garden.ogg) | ezwa | Public domain | 45 s from 4 s |
| church.mp3 | [Church people walking steps with reverb.ogg](https://commons.wikimedia.org/wiki/File:Church_people_walking_steps_with_reverb.ogg) | stephan | Public domain | 30 s from the start |
| cobbles.mp3 | [Hooves and wheels on cobbles](tools/sound/sfx/design.py) | Composed for Versta | CC0 | A 30 s seamless loop, rendered offline by tools/sound/sfx/make.py |
| creak.mp3 | [WWS Creakingfloors.ogg](https://commons.wikimedia.org/wiki/File:WWS_Creakingfloors.ogg) | Work With Sounds / Torsten Nilsson | CC BY 4.0 | 45 s from 32 s |
| crowd.mp3 | [211146 unfa another-crowd.flac](https://commons.wikimedia.org/wiki/File:211146_unfa_another-crowd.flac) | unfa | CC0 | 50 s from the start |
| dockyard.mp3 | [A working dock in the distance](tools/sound/sfx/design.py) | Composed for Versta | CC0 | A 30 s seamless loop, rendered offline by tools/sound/sfx/make.py |
| drips.mp3 | [WWS Waterdrainingthroughtherock.ogg](https://commons.wikimedia.org/wiki/File:WWS_Waterdrainingthroughtherock.ogg) | Work With Sounds / Technical Museum of Slovenia | CC BY 4.0 | 35 s from 6 s |
| gulls.mp3 | [Gull 1.ogg](https://commons.wikimedia.org/wiki/File:Gull_1.ogg) | avphillips | Public domain | 18 s from the start |
| gulls2.mp3 | [Gulls above the street at dawn.ogg](https://commons.wikimedia.org/wiki/File:Gulls_above_the_street_at_dawn.ogg) | earthcalling | Public domain | 45 s from 12 s |
| hum.mp3 | [Pump.ogg](https://commons.wikimedia.org/wiki/File:Pump.ogg) | ezwa | Public domain | 30 s from the start, low-pass 2500 Hz |
| ice.mp3 | [Singing iceberg.oga](https://commons.wikimedia.org/wiki/File:Singing_iceberg.oga) | Müller, Christian; Schlindwein, Vera; Eckstaller, Alfons; Miller, Heinz (2005) | CC BY 3.0 | 40 s from 161 s |
| lap.mp3 | [WWS Smallwaves.ogg](https://commons.wikimedia.org/wiki/File:WWS_Smallwaves.ogg) | Work With Sounds / Torsten Nilsson | CC BY 4.0 | 45 s from 2 s, high-pass 90 Hz |
| murmur.mp3 | [360703 eguobyte large-crowd-medium-distance-stereo.wav](https://commons.wikimedia.org/wiki/File:360703_eguobyte_large-crowd-medium-distance-stereo.wav) | eguobyte | CC0 | 40 s from 12 s |
| office.mp3 | [LA2 kitchen clock.ogg](https://commons.wikimedia.org/wiki/File:LA2_kitchen_clock.ogg) | LA2 | Public domain | 20 s from the start |
| pub.mp3 | [Restaurant ambience.ogg](https://commons.wikimedia.org/wiki/File:Restaurant_ambience.ogg) | stephan | Public domain | 45 s from 31 s |
| rigging.mp3 | [Rigging in the wind](tools/sound/sfx/design.py) | Composed for Versta | CC0 | A 30 s seamless loop, rendered offline by tools/sound/sfx/make.py |
| river.mp3 | [433589 jackthemurray stream-river-water-up-close.wav](https://commons.wikimedia.org/wiki/File:433589_jackthemurray_stream-river-water-up-close.wav) | jackthemurray | CC0 | 60 s from 7 s |
| shore.mp3 | [On a pebble beach.ogg](https://commons.wikimedia.org/wiki/File:On_a_pebble_beach.ogg) | earthcalling | Public domain | 40 s from the start, high-pass 100 Hz |
| tick.mp3 | [Clock (tic tac).ogg](https://commons.wikimedia.org/wiki/File:Clock_(tic_tac).ogg) | Saaabaaato | CC0 | 18 s from the start |
| tide.mp3 | [Water over rocks as tide recedes.ogg](https://commons.wikimedia.org/wiki/File:Water_over_rocks_as_tide_recedes.ogg) | earthcalling | Public domain | 30 s from the start, high-pass 100 Hz |
| timber.mp3 | [WWS Wheelwrightcarvingaspoke.ogg](https://commons.wikimedia.org/wiki/File:WWS_Wheelwrightcarvingaspoke.ogg) | Work With Sounds / Museum of Municipal Engineering | CC BY 4.0 | 40 s from 42 s |
| tunnel.mp3 | [The foot tunnel under the Thames](tools/sound/sfx/design.py) | Composed for Versta | CC0 | A 30 s seamless loop, rendered offline by tools/sound/sfx/make.py |
| waders.mp3 | [Wading birds on a tidal shore](tools/sound/sfx/design.py) | Composed for Versta | CC0 | A 30 s seamless loop, rendered offline by tools/sound/sfx/make.py |
| water.mp3 | [Shallow small river with stony riverbed.ogg](https://commons.wikimedia.org/wiki/File:Shallow_small_river_with_stony_riverbed.ogg) | stephan | Public domain | 18 s from the start |
| weir.mp3 | [Vojníkov, 3. jez, středa.ogg](https://commons.wikimedia.org/wiki/File:Vojníkov,_3._jez,_středa.ogg) | Juandev | Public domain | 40 s from the start |
| wharf.mp3 | [Boat by a wharf 2.ogg](https://commons.wikimedia.org/wiki/File:Boat_by_a_wharf_2.ogg) | ezwa | Public domain | 40 s from 59 s, high-pass 100 Hz |
| wind.mp3 | [Howling wind.ogg](https://commons.wikimedia.org/wiki/File:Howling_wind.ogg) | Tvabutzku1234 | CC0 | 40 s from 34 s |

## Effects

| File | Source page on Commons | Author | Licence | Cut |
| --- | --- | --- | --- | --- |
| fx/adze.mp3 | [WWS Wheelwrightcarvingaspoke.ogg](https://commons.wikimedia.org/wiki/File:WWS_Wheelwrightcarvingaspoke.ogg) | Work With Sounds / Museum of Municipal Engineering | CC BY 4.0 | 3 s from 98 s |
| fx/big-bell.mp3 | [One stroke of a great bell](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/bubbling.mp3 | [Oil boiling.ogg](https://commons.wikimedia.org/wiki/File:Oil_boiling.ogg) | ezwa | Public domain | 5 s from 1 s |
| fx/chain.mp3 | [WWS Wardrobechainloweringandraising.ogg](https://commons.wikimedia.org/wiki/File:WWS_Wardrobechainloweringandraising.ogg) | Work With Sounds / Technical Museum of Slovenia | CC BY 4.0 | 4 s from 10 s |
| fx/crates.mp3 | [Crates being loaded](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/crowd.mp3 | [211146 unfa another-crowd.flac](https://commons.wikimedia.org/wiki/File:211146_unfa_another-crowd.flac) | unfa | CC0 | 6 s from 25 s |
| fx/distant-cannon.mp3 | [A cannon far off](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/fire-crackle.mp3 | [Campfire sound ambience.ogg](https://commons.wikimedia.org/wiki/File:Campfire_sound_ambience.ogg) | Glaneur de sons | CC BY 3.0 | 5 s from 17 s, compressed and raised 10 dB |
| fx/hammer.mp3 | [WWS Watersmithyforgingwithtwohammers.ogg](https://commons.wikimedia.org/wiki/File:WWS_Watersmithyforgingwithtwohammers.ogg) | Work With Sounds / Museum of Municipal Engineering | CC BY 4.0 | 3 s from 4 s |
| fx/ice-creak.mp3 | [Singing iceberg.oga](https://commons.wikimedia.org/wiki/File:Singing_iceberg.oga) | Müller, Christian; Schlindwein, Vera; Eckstaller, Alfons; Miller, Heinz (2005) | CC BY 3.0 | 4 s from 159 s |
| fx/oars.mp3 | [Oars in the water](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/parrots.mp3 | [Parrots in a shop](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/sail-flap.mp3 | [Sails filling, rigging](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/ship-horn.mp3 | [Fog signal Bremerhaven.ogg](https://commons.wikimedia.org/wiki/File:Fog_signal_Bremerhaven.ogg) | Tvabutzku1234 | CC0 | 5 s from 0 s |
| fx/steam-engine.mp3 | [Steam engine.ogg](https://commons.wikimedia.org/wiki/File:Steam_engine.ogg) | aradlaw | Public domain | 6 s from 12 s |
| fx/tankards.mp3 | [Tankards and glasses](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/telegraph.mp3 | [WWS Teleprintertyping.ogg](https://commons.wikimedia.org/wiki/File:WWS_Teleprintertyping.ogg) | Work With Sounds / Konrad Gutkowski | CC BY 4.0 | 4 s from 62 s |
| fx/waders.mp3 | [Wading birds on the mud](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/water-flow.mp3 | [Water rushing underground](tools/sound/sfx/design.py) | Composed for Versta | CC0 | Rendered offline by tools/sound/sfx/make.py |
| fx/water-lap.mp3 | [WWS Smallwaves.ogg](https://commons.wikimedia.org/wiki/File:WWS_Smallwaves.ogg) | Work With Sounds / Torsten Nilsson | CC BY 4.0 | 4 s from 23 s, compressed and raised 10 dB |
| fx/water-wheel.mp3 | [WWS Horizontalwaterwheel.ogg](https://commons.wikimedia.org/wiki/File:WWS_Horizontalwaterwheel.ogg) | Work With Sounds / Konrad Gutkowski | CC BY 4.0 | 6 s from 3 s |

## Signals

| File | Source page on Commons | Author | Licence | Cut |
| --- | --- | --- | --- | --- |
| signals/aside.mp3 | [WWS ShipSodekshipsbell.ogg](https://commons.wikimedia.org/wiki/File:WWS_ShipSodekshipsbell.ogg) | Work With Sounds / Museum of Municipal Engineering | CC BY 4.0 | 3 s from 1 s |
| signals/arrive.mp3 | [Arrival signal](tools/music/signals.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | A 2 s motif, rendered offline by tools/music/render.py |
| signals/close.mp3 | [End of a stop's stories signal](tools/music/signals.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | A 2.5 s motif, rendered offline by tools/music/render.py |
| signals/finish.mp3 | [End of the ride signal](tools/music/signals.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | A 4 s motif, rendered offline by tools/music/render.py |

## Music

| File | Source page on Commons | Author | Licence | Cut |
| --- | --- | --- | --- | --- |
| music/noir.mp3 | [Noir: spies and secrets](tools/music/themes/noir.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | One loop plus a 1.5 s tail, rendered offline by tools/music/render.py |
| music/river.mp3 | [River: the working Thames](tools/music/themes/river.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | One loop plus a 1.5 s tail, rendered offline by tools/music/render.py |
| music/solemn.mp3 | [Solemn: loss and remembrance](tools/music/themes/solemn.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | One loop plus a 1.5 s tail, rendered offline by tools/music/render.py |
| music/russia.mp3 | [Russia](tools/music/themes/russia.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | One loop plus a 1.5 s tail, rendered offline by tools/music/render.py |
| music/bright.mp3 | [Bright: light and forward](tools/music/themes/bright.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | One loop plus a 1.5 s tail, rendered offline by tools/music/render.py |
| music/voyage.mp3 | [Voyage: ships and exploration](tools/music/themes/voyage.py. Rendered with FluidR3_GM by Frank Wen (MIT licence)) | Composed for Versta | CC0 | One loop plus a 1.5 s tail, rendered offline by tools/music/render.py |

## Still generated

The stand-in layers in `src/audio/soundscapes.ts` (`gen`) play in place of a recording that fails to load, and
wherever no recording has been fetched yet (below).

With no recording under the licence bar, these are synthesised with sfx-skill (MIT), from synthesis only, and are CC0 (`tools/sound/sfx/README.md` says how to remake them): `cobbles.mp3`, `dockyard.mp3`, `fx/big-bell.mp3`, `fx/crates.mp3`, `fx/distant-cannon.mp3`, `fx/oars.mp3`, `fx/parrots.mp3`, `fx/sail-flap.mp3`, `fx/tankards.mp3`, `fx/waders.mp3`, `fx/water-flow.mp3`, `rigging.mp3`, `tunnel.mp3`, `waders.mp3`.
