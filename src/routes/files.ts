/**
 * The route store's hands: files on the phone and requests to the site, behind one interface so the store can be
 * tested with an in-memory device. The Capacitor parts are loaded with dynamic imports, so the web build never
 * runs them. Paths are relative to the app's data folder, for example `packs/thames-loop/ab12/pack.json`.
 */

export interface GetResult { status: number; /** The body, base64. */ data: string }

export interface Device {
  /** A file's bytes as base64, or null when it is not there. */
  read(path: string): Promise<string | null>;
  /** Write a file (base64), making its folders. */
  write(path: string, base64: string): Promise<void>;
  /** Delete a file or a folder with everything in it. Missing is not an error. */
  remove(path: string): Promise<void>;
  /** The names (not paths) directly inside a folder; empty when it is not there. */
  list(dir: string): Promise<string[]>;
  /** The URL the WebView reads this path from. */
  uri(path: string): string;
  /**
   * GET a small file from the network (the site) that is only parsed: the index, a manifest, the sound credits.
   * Throws when the network fails or the timeout passes. A body the transport has already parsed comes back as JSON
   * text: CapacitorHttp parses every application/json response, whatever responseType asks (issue 3 of iteration 7).
   */
  getText(url: string, timeoutMs?: number): Promise<{ status: number; text: string }>;
  /**
   * Download a file from the network to `path` in the data folder, making its folders: the exact bytes, whatever the
   * content type. Resolves when the whole file is there; throws on any failure (network, timeout, a status other
   * than 200), leaving nothing at `path`. The caller checks size and checksum.
   */
  download(url: string, path: string, timeoutMs?: number): Promise<void>;
  /** GET one of the app's own files (shipped in the APK). Throws when it cannot be read. */
  getOwn(url: string): Promise<GetResult>;
  /** Copy a file inside the data folder. */
  copy(from: string, to: string): Promise<void>;
}

/** The text of a response body as a transport hands it over: a string as it is, anything already parsed as JSON. */
export function bodyText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data === null || data === undefined) return "";
  return JSON.stringify(data);
}

/* ------------------------------------------------------------------ bytes */

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function textToB64(text: string): string { return bytesToB64(new TextEncoder().encode(text)); }
export function b64ToText(b64: string): string { return new TextDecoder().decode(b64ToBytes(b64)); }

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ Capacitor */

/** The phone's device. Only call it inside the Android app. */
export async function capacitorDevice(): Promise<Device> {
  const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const directory = Directory.Data;
  const probe = await Filesystem.getUri({ path: "packs", directory });
  const root = probe.uri.replace(/\/packs$/, "");
  const dirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf("/")));

  return {
    async read(path) {
      try { return (await Filesystem.readFile({ path, directory })).data as string; } catch { return null; }
    },
    async write(path, base64) {
      await Filesystem.writeFile({ path, data: base64, directory, recursive: true });
    },
    async remove(path) {
      try { await Filesystem.rmdir({ path, directory, recursive: true }); return; } catch { /* a file, or missing */ }
      try { await Filesystem.deleteFile({ path, directory }); } catch { /* already gone */ }
    },
    async list(dir) {
      try { return (await Filesystem.readdir({ path: dir, directory })).files.map((f) => f.name); } catch { return []; }
    },
    uri(path) { return Capacitor.convertFileSrc(`${root}/${path}`); },
    async getText(url, timeoutMs = 15000) {
      const res = await CapacitorHttp.get({ url, responseType: "text", connectTimeout: timeoutMs, readTimeout: timeoutMs });
      return { status: res.status, text: bodyText(res.data) };
    },
    async download(url, path, timeoutMs = 30000) {
      // Native, straight to the file: no base64 through the bridge, and no JSON parsing on the way (CapacitorHttp would).
      const dir = dirOf(path);
      if (dir) { try { await Filesystem.mkdir({ path: dir, directory, recursive: true }); } catch { /* exists */ } }
      try {
        await Filesystem.downloadFile({ url, path, directory, connectTimeout: timeoutMs, readTimeout: timeoutMs });
      } catch (e) {
        try { await Filesystem.deleteFile({ path, directory }); } catch { /* nothing was written */ }
        throw e;
      }
    },
    async getOwn(url) {
      const res = await fetch(url);
      return { status: res.status, data: bytesToB64(new Uint8Array(await res.arrayBuffer())) };
    },
    async copy(from, to) {
      const dir = dirOf(to);
      if (dir) { try { await Filesystem.mkdir({ path: dir, directory, recursive: true }); } catch { /* exists */ } }
      await Filesystem.copy({ from, to, directory, toDirectory: directory });
    },
  };
}

/* ------------------------------------------------------------------ in memory (tests) */

export interface MemoryDevice extends Device {
  /** Every file by path, base64. */
  files: Map<string, string>;
  /** What the site answers: url to a body (base64), or a status. Missing urls answer 404. A function can throw to cut off. */
  site: Map<string, string | { status: number; data?: string } | (() => string | { status: number; data?: string })>;
  /** The app's own files by url. */
  own: Map<string, string>;
  /** Network requests made, in order. */
  requests: string[];
  /** Called before every write; may throw to cut a download off. */
  beforeWrite?: (path: string) => void;
  /** Called after every write. */
  afterWrite?: (path: string) => void;
  /**
   * Answer getText as CapacitorHttp does on the phone: a ".json" body arrives parsed, as an object, and goes through
   * the same bodyText() the phone's device uses. On by default, so every store test runs against the real behaviour.
   */
  parsesJson: boolean;
}

export function memoryDevice(): MemoryDevice {
  const files = new Map<string, string>();
  const answer = (url: string): { status: number; data: string } => {
    dev.requests.push(url);
    let hit = dev.site.get(url);
    if (typeof hit === "function") hit = hit();
    if (hit === undefined) return { status: 404, data: "" };
    if (typeof hit === "string") return { status: 200, data: hit };
    return { status: hit.status, data: hit.data ?? "" };
  };
  const dev: MemoryDevice = {
    files,
    site: new Map(),
    own: new Map(),
    requests: [],
    parsesJson: true,
    async read(path) { return files.get(path) ?? null; },
    async write(path, base64) { dev.beforeWrite?.(path); files.set(path, base64); dev.afterWrite?.(path); },
    async remove(path) {
      files.delete(path);
      for (const k of [...files.keys()]) if (k.startsWith(`${path}/`)) files.delete(k);
    },
    async list(dir) {
      const names = new Set<string>();
      const prefix = dir ? `${dir}/` : "";
      for (const k of files.keys()) if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split("/")[0]!);
      return [...names];
    },
    uri(path) { return `mem://${path}`; },
    async getText(url) {
      const res = answer(url);
      if (res.status !== 200) return { status: res.status, text: "" };
      const text = b64ToText(res.data);
      if (!dev.parsesJson || !/\.json(\?|$)/.test(url)) return { status: 200, text };
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return { status: 200, text }; }
      return { status: 200, text: bodyText(parsed) };
    },
    async download(url, path) {
      const res = answer(url);
      if (res.status !== 200) throw new Error(`${url} answered ${res.status}`);
      dev.beforeWrite?.(path);
      files.set(path, res.data);
      dev.afterWrite?.(path);
    },
    async getOwn(url) {
      const hit = dev.own.get(url);
      if (hit === undefined) return { status: 404, data: "" };
      return { status: 200, data: hit };
    },
    async copy(from, to) {
      const data = files.get(from);
      if (data === undefined) throw new Error(`no such file ${from}`);
      dev.beforeWrite?.(to);
      files.set(to, data);
      dev.afterWrite?.(to);
    },
  };
  return dev;
}
