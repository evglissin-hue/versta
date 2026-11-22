/** Which recorded sounds the app ships, by the credits files (every shipped file is credited: tests/unit/sounds.test.ts). */
interface Credit { file: string }

const creditFiles = import.meta.glob("./credits-*.json", { eager: true, import: "default" }) as Record<string, Credit[]>;
const credited = new Set(
  Object.values(creditFiles).flatMap((list) => (Array.isArray(list) ? list.map((c) => c.file) : [])),
);

/** True when the APK ships the sound at this path under sounds/, without ".mp3" (for example "fx/gull"). */
export function recorded(path: string): boolean { return credited.has(`sounds/${path}.mp3`); }

/** Every shipped sound, as paths under sounds/ without ".mp3". */
export function bundledSounds(): Set<string> {
  const out = new Set<string>();
  for (const f of credited) {
    const m = /^sounds\/(.+)\.mp3$/.exec(f);
    if (m) out.add(m[1]!);
  }
  return out;
}
