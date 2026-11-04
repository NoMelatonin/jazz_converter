import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
} from "electron";
import { Worker } from "node:worker_threads";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { demoMidi, demoXml } from "../src/core/demo";
import { ONLINE_CATALOGUE } from "../src/core/catalogue";
import { add, beat, cmp } from "../src/core/time";
import type {
  Arrangement,
  CatalogSong,
  Settings,
  Song,
} from "../src/core/model";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "jazz",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
if (process.env.JAZZ_DATA_DIR)
  app.setPath("userData", process.env.JAZZ_DATA_DIR);
let win: BrowserWindow;
let worker: Worker | undefined;
let nextRequest = 0;
const pending = new Map<
  number,
  {
    resolve: (data: any) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
function workerJob<T>(payload: Record<string, unknown>): Promise<T> {
  if (!worker) {
    worker = new Worker(path.join(__dirname, "worker.cjs"), {
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
    worker.on("message", (result) => {
      const request = pending.get(result.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(result.requestId);
      result.ok
        ? request.resolve(result.data)
        : request.reject(new Error(result.error));
    });
    worker.on("error", (error) => {
      for (const r of pending.values()) {
        clearTimeout(r.timer);
        r.reject(error instanceof Error ? error : new Error(String(error)));
      }
      pending.clear();
      worker = undefined;
    });
    worker.on("exit", () => {
      for (const r of pending.values()) {
        clearTimeout(r.timer);
        r.reject(
          new Error("Musikverarbeitung wurde beendet. Bitte erneut versuchen."),
        );
      }
      pending.clear();
      worker = undefined;
    });
  }
  const requestId = ++nextRequest;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker?.terminate();
      reject(
        new Error(
          "Die Musikverarbeitung hat zu lange gedauert. Bitte eine kleinere Datei verwenden.",
        ),
      );
    }, 30000);
    pending.set(requestId, { resolve, reject, timer });
    worker!.postMessage({ ...payload, requestId });
  });
}
const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
const rational = z.object({
  n: z.number().int().nonnegative().max(1000000000),
  d: z.number().int().positive().max(1000000000),
});
const settingsSchema = z.object({
  style: z.literal("swing"),
  difficulty: z.enum(["easy", "medium"]),
  melodyTrackId: z.string().min(1).max(200),
  chords: z
    .array(
      z.object({
        id: z.string().max(200),
        at: rational,
        duration: rational,
        symbol: z.string().min(1).max(30),
        confidence: z.number().min(0).max(1),
        source: z.enum(["provided", "inferred", "manual"]),
      }),
    )
    .min(1)
    .max(20000),
});
const store = () => path.join(app.getPath("userData"), "songs");
async function atomicJson(file: string, data: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data));
  await rename(temp, file);
}
async function load(id: unknown): Promise<CatalogSong> {
  const safe = idSchema.parse(id);
  const record = JSON.parse(
    await readFile(path.join(store(), `${safe}.json`), "utf8"),
  ) as CatalogSong;
  if (
    record.entry.id !== safe ||
    record.song.id !== safe ||
    !record.song.tracks.length
  )
    throw new Error(
      "Dieser Katalogeintrag ist beschädigt. Bitte die Quelldatei erneut importieren.",
    );
  return record;
}
async function list() {
  const records: CatalogSong[] = [];
  for (const name of (await readdir(store())).filter((n) =>
    /^[a-f0-9]{64}\.json$/.test(n),
  )) {
    try {
      records.push(await load(name.slice(0, -5)));
    } catch {
      /* A damaged record never prevents access to the remaining library. */
    }
  }
  return records
    .map((r) => r.entry)
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, "de") ||
        a.version.localeCompare(b.version, "de"),
    );
}
async function importBytes(
  bytes: Uint8Array,
  filename: string,
  origin?: {
    title?: string;
    artist?: string;
    version: string;
    source: string;
    license: string;
  },
): Promise<CatalogSong> {
  const id = createHash("sha256").update(bytes).digest("hex");
  try {
    return await load(id);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const song = await workerJob<Song>({ action: "import", bytes, filename });
  song.id = id;
  if (origin?.title) song.title = origin.title;
  if (origin?.artist) song.artist = origin.artist;
  const record: CatalogSong = {
    entry: {
      id,
      title: song.title,
      artist: song.artist,
      format: song.format,
      version: origin?.version ?? filename,
      source: origin?.source ?? "Eigene Datei",
      license: origin?.license ?? "Eigene Datei · Lizenz nicht angegeben",
      importedAt: new Date().toISOString(),
    },
    song,
  };
  await writeFile(
    path.join(store(), `${id}${path.extname(filename).toLowerCase()}`),
    bytes,
    { flag: "wx" },
  ).catch((e: any) => {
    if (e.code !== "EEXIST") throw e;
  });
  await atomicJson(path.join(store(), `${id}.json`), record);
  return record;
}
function checkedSettings(input: unknown, song: Song): Settings {
  const settings = settingsSchema.parse(input);
  let cursor = beat(0);
  for (const c of settings.chords) {
    if (cmp(c.at, cursor) !== 0 || c.duration.n <= 0)
      throw new Error("Akkorde müssen den Song lückenlos abdecken.");
    cursor = add(cursor, c.duration);
  }
  if (cmp(cursor, song.duration) !== 0)
    throw new Error("Die Akkordfolge passt nicht zur Songlänge.");
  return settings;
}
function handle(name: string, fn: (...args: any[]) => Promise<any>) {
  ipcMain.handle(name, async (event, ...args) => {
    try {
      const allowed = process.env.JAZZ_DEV_URL ?? "jazz://app";
      const frameUrl = event.senderFrame?.url ?? "";
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        !frameUrl.startsWith(`${allowed}/`)
      )
        throw new Error("Unzulässiger App-Aufruf.");
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof z.ZodError
            ? "Die Eingaben sind ungültig. Bitte erneut versuchen."
            : e instanceof Error
              ? e.message
              : "Ein unbekannter Fehler ist aufgetreten.",
      };
    }
  });
}
async function importPaths(input: unknown) {
  const paths = z.array(z.string().max(4096)).min(1).max(20).parse(input);
  const result: CatalogSong[] = [];
  for (const file of paths) {
    if (!path.isAbsolute(file) || !/\.(mid|midi|musicxml|mxl)$/i.test(file))
      throw new Error("Bitte MIDI- oder MusicXML-Dateien öffnen.");
    const info = await stat(file);
    if (!info.isFile() || info.size > 20 * 1024 * 1024)
      throw new Error(
        "Die Datei ist zu groß oder keine reguläre Musikdatei (maximal 20 MB).",
      );
    result.push(await importBytes(await readFile(file), path.basename(file)));
  }
  return result;
}
app
  .whenReady()
  .then(async () => {
    await mkdir(store(), { recursive: true });
    await importBytes(demoXml(), "Bruder Jakob.musicxml", {
      version: "Demo · Melodie mit Akkorden",
      source: "Mitgelieferte Dateifassung",
      license: "CC0 1.0",
    });
    await importBytes(demoMidi(), "Bruder Jakob.mid", {
      artist: "Traditionell",
      version: "Demo · Mehrspurige MIDI-Datei",
      source: "Mitgelieferte Dateifassung",
      license: "CC0 1.0",
    });
    protocol.handle("jazz", (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "app")
        return new Response("Not found", { status: 404 });
      const root = path.join(__dirname, "..", "dist");
      const target = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!target.startsWith(root + path.sep))
        return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    const dev = process.env.JAZZ_DEV_URL;
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'${dev ? " ws://127.0.0.1:5173" : ""}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
          ],
        },
      }),
    );
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    if (process.env.JAZZ_TEST_OFFLINE === "1")
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/.test(details.url) }),
      );
    win = new BrowserWindow({
      width: 1380,
      height: 920,
      minWidth: 1000,
      minHeight: 760,
      title: "Jazz Converter",
      backgroundColor: "#f6f5f0",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 20, y: 20 },
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(dev ? `${dev}/` : "jazz://app/"))
        event.preventDefault();
    });
    handle("catalog:list", list);
    handle("catalog:load", load);
    handle("chords:analyze", async (id, input) => {
      const record = await load(id),
        trackId = z.string().max(200).parse(input);
      if (!record.song.tracks.some((t) => t.id === trackId))
        throw new Error("Die Melodiestimme wurde nicht gefunden.");
      return workerJob({ action: "chords", song: record.song, trackId });
    });
    handle("files:import", importPaths);
    handle("files:open", async () => {
      const result = await dialog.showOpenDialog(win, {
        title: "Song öffnen",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "MIDI und MusicXML",
            extensions: ["mid", "midi", "musicxml", "mxl"],
          },
        ],
      });
      return result.canceled ? [] : importPaths(result.filePaths);
    });
    handle("catalog:update", async (id, input) => {
      const metadata = z
        .object({
          title: z.string().trim().min(1).max(200),
          artist: z.string().trim().min(1).max(200),
        })
        .parse(input);
      const record = await load(id);
      Object.assign(record.entry, metadata);
      Object.assign(record.song, metadata);
      await atomicJson(path.join(store(), `${record.entry.id}.json`), record);
      return record;
    });
    handle("catalog:download", async (input) => {
      const entry = ONLINE_CATALOGUE.find(
        (e) => e.id === z.string().parse(input),
      );
      if (!entry)
        throw new Error("Dieser Download ist nicht im kuratierten Katalog.");
      if (process.env.JAZZ_TEST_OFFLINE === "1")
        throw new Error(
          "Keine Internetverbindung. Bitte eine Datei importieren.",
        );
      try {
        const response = await fetch(entry.url, {
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
        if (
          !response.ok ||
          Number(response.headers.get("content-length") ?? 0) > 20 * 1024 * 1024
        )
          throw new Error("Download nicht verfügbar.");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Leerer Download.");
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 20 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Download ist zu groß.");
          }
          chunks.push(value);
        }
        return importBytes(Buffer.concat(chunks), entry.filename, entry);
      } catch (e) {
        throw new Error(
          `Online-Download nicht möglich. Bitte eine Datei importieren. ${e instanceof Error ? e.message : ""}`,
        );
      }
    });
    handle("arrange", async (id, input) => {
      const record = await load(id),
        settings = checkedSettings(input, record.song);
      const result = await workerJob<Arrangement>({
        action: "arrange",
        song: record.song,
        settings,
      });
      record.settings = settings;
      await atomicJson(path.join(store(), `${record.entry.id}.json`), record);
      return result;
    });
    handle("midi:save", async (id, input) => {
      const record = await load(id),
        settings = checkedSettings(input, record.song);
      const bytes = await workerJob<Uint8Array>({
        action: "export",
        song: record.song,
        settings,
      });
      const result = await dialog.showSaveDialog(win, {
        title: "MIDI speichern",
        defaultPath: `${record.song.title.replace(/[/\\:]/g, "-")} – Swing.mid`,
        filters: [{ name: "Standard-MIDI", extensions: ["mid"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, bytes);
      return result.filePath;
    });
    handle("demo:save", async () => {
      const result = await dialog.showOpenDialog(win, {
        title: "Demo-Dateien speichern",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      const folder = result.filePaths[0];
      // Exclusive writes preserve existing user files.
      for (const [name, bytes] of [
        ["Bruder Jakob.musicxml", demoXml()],
        ["Bruder Jakob.mid", demoMidi()],
      ] as const) {
        const file = path.join(folder, name);
        await writeFile(file, bytes, { flag: "wx" }).catch((e: any) => {
          if (e.code !== "EEXIST") throw e;
        });
      }
      return folder;
    });
    await win.loadURL(dev ?? "jazz://app/");
    app.on("activate", () => {
      if (win.isDestroyed()) app.relaunch();
      else win.show();
    });
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
app.on("window-all-closed", () => {
  void worker?.terminate();
  app.quit();
});
