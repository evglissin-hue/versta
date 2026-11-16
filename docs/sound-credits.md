# Sound credits

The recorded soundscape loops in `public/sounds/` come from Wikimedia Commons. Only files marked CC0 or public domain
in their Commons metadata are used, so no attribution is required; it is recorded here anyway. Licence strings are as
Commons showed them on 16 November 2026.

Each file was cut, mixed to mono, high-passed at 60 Hz unless noted, normalised to about -26 LUFS and encoded at
64 kbps mp3 by `tools/sound/build_sounds.py` (the list of sources is `tools/sound/sources.json`). The app joins the
end of each loop to its start with a 1.5 s crossfade when it decodes the file.

| Loop | Source page on Commons | Author | Licence | Cut |
| --- | --- | --- | --- | --- |
| water.mp3 | [Shallow small river with stony riverbed.ogg](https://commons.wikimedia.org/wiki/File:Shallow_small_river_with_stony_riverbed.ogg) | stephan | Public domain | 18 s, whole file |
| shore.mp3 | [On a pebble beach.ogg](https://commons.wikimedia.org/wiki/File:On_a_pebble_beach.ogg) | earthcalling | Public domain | 40 s from 0 s, high-pass 100 Hz |
| wharf.mp3 | [Boat by a wharf 2.ogg](https://commons.wikimedia.org/wiki/File:Boat_by_a_wharf_2.ogg) | ezwa | Public domain | 40 s from 59 s, high-pass 100 Hz |
| wind.mp3 | [Howling wind.ogg](https://commons.wikimedia.org/wiki/File:Howling_wind.ogg) | Tvabutzku1234 | CC0 | 40 s from 34 s |
| gulls.mp3 | [Gull 1.ogg](https://commons.wikimedia.org/wiki/File:Gull_1.ogg) | avphillips | Public domain | 18 s, whole file |
| murmur.mp3 | [360703 eguobyte large-crowd-medium-distance-stereo.wav](https://commons.wikimedia.org/wiki/File:360703_eguobyte_large-crowd-medium-distance-stereo.wav) | eguobyte | CC0 | 40 s from 12 s |
| tick.mp3 | [Clock (tic tac).ogg](https://commons.wikimedia.org/wiki/File:Clock_(tic_tac).ogg) | Saaabaaato | CC0 | 18 s, whole file |
| bells.mp3 | [Church bells - Leverkusen, 2007.oga](https://commons.wikimedia.org/wiki/File:Church_bells_-_Leverkusen,_2007.oga) | natalie | Public domain | 40 s from 0 s |

## Still generated

No recording with a free enough licence was found for these, so they stay synthesised in `src/audio/soundscapes.ts`:
creaking of wood and rope, hammering, dripping in a tunnel, the tunnel rumble, the foghorn, glass clinks, and the
music (pad and line). A soundscape's recipe also keeps a generated layer as a stand-in for every recorded loop, which
plays if the recording cannot be loaded.

## Not used

Found and rejected: files under CC BY or CC BY-SA licences (for example the water drips in Treak Cliff Cavern and most
Xeno-canto gull recordings). They need attribution or share-alike terms the brief excluded.
