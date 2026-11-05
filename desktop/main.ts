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
import { PdfService } from "./pdf-service";
import { PlaybackStore, sourceRevision } from "./playback-store";
import { assertSong, playbackError } from "../src/core/playback";
import { exportMidi } from "../src/core/midi";
import { exportMusicXml } from "../src/core/musicxml";
import { validateScore } from "../src/core/score-review";
import { demoMidi, demoXml } from "../src/core/demo";
import { ONLINE_CATALOGUE } from "../src/core/catalogue";
import { add, beat, cmp } from "../src/core/time";
import type {
  Arrangement,
  CatalogEntry,
  CatalogSong,
  Settings,
  Song,
  PlaybackRequest,
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
let pdfService: PdfService;
let playbackStore: PlaybackStore;
const writes = new Map<string, Promise<unknown>>();
async function catalogWrite<T>(
  id: unknown,
  action: () => Promise<T>,
): Promise<T> {
  const key = idSchema.parse(id),
    previous = writes.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  writes.set(key, next);
  try {
    return await next;
  } finally {
    if (writes.get(key) === next) writes.delete(key);
  }
}
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
  mode: z.enum(["original", "reduction", "swing"]).optional(),
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
    .min(0)
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
  const bytes = await readFile(path.join(store(), `${safe}.json`), "utf8");
  let record: CatalogSong;
  try {
    record = JSON.parse(bytes);
  } catch {
    throw new Error(
      "Dieser Katalogeintrag ist beschädigt und nicht abspielbar. Die gespeicherte Datei bleibt erhalten.",
    );
  }
  if (
    !record?.entry ||
    typeof record.entry.title !== "string" ||
    typeof record.entry.artist !== "string" ||
    typeof record.entry.version !== "string" ||
    !record.song ||
    record.entry.id !== safe ||
    record.song.id !== safe
  )
    throw new Error(
      "Dieser Katalogeintrag ist beschädigt. Bitte die Quelldatei erneut importieren.",
    );
  return {
    ...record,
    sourceRevision: sourceRevision(record.song),
    entry: { ...record.entry, playbackError: playbackError(record.song) },
  };
}
async function list() {
  const records: CatalogEntry[] = [];
  for (const name of (await readdir(store())).filter((n) =>
    /^[a-f0-9]{64}\.json$/.test(n),
  )) {
    try {
      records.push((await load(name.slice(0, -5))).entry);
    } catch {
      records.push({
        id: name.slice(0, -5),
        title: "Beschädigter Katalogeintrag",
        artist: "Unbekannt",
        version: "Gespeicherte Datei",
        format: "Unbekannt",
        source: name,
        license: "Nicht angegeben",
        playbackError:
          "Die gespeicherten Katalogdaten sind beschädigt und nicht abspielbar. Die Datei bleibt erhalten.",
      });
    }
  }
  return records.sort(
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
  assertSong(song);
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
  return load(id);
}
function checkedSettings(input: unknown, song: Song): Settings {
  const settings = settingsSchema.parse(input);
  if (settings.mode === "original" || settings.mode === "reduction")
    return settings;
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
  const result: (CatalogSong | import("../src/core/model").PdfDocument)[] = [];
  for (const file of paths) {
    if (!path.isAbsolute(file) || !/\.(mid|midi|musicxml|mxl|pdf)$/i.test(file))
      throw new Error("Bitte PDF-, MIDI- oder MusicXML-Dateien öffnen.");
    if (/\.pdf$/i.test(file)) {
      result.push(await pdfService.prepare(file));
      continue;
    }
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
    playbackStore = new PlaybackStore(
      app.getPath("userData"),
      load,
      async (song, settings) =>
        workerJob<Arrangement>({
          action: "arrange",
          song,
          settings: checkedSettings(settings, song),
        }),
    );
    pdfService = new PdfService(
      app.getPath("userData"),
      app.isPackaged
        ? path.join(process.resourcesPath, "omr")
        : path.resolve("resources/omr"),
      async (song, source, jobId, index, doc) => {
        assertSong(song);
        const id = createHash("sha256")
          .update(`${jobId}:${index}`)
          .digest("hex");
        try {
          return await load(id);
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
        song.id = id;
        const record: CatalogSong = {
          entry: {
            id,
            title: song.title,
            artist: song.artist,
            version: `PDF · ${song.pdf!.pages.length} Seite(n) · Erkannte Partitur${index ? ` ${index + 1}` : ""}`,
            format: "PDF",
            source: doc.title,
            license: "Eigene Datei · Lizenz nicht angegeben",
            importedAt: new Date().toISOString(),
          },
          song,
        };
        await writeFile(path.join(store(), `${id}.mxl`), source, {
          flag: "wx",
        }).catch((e: any) => {
          if (e.code !== "EEXIST") throw e;
        });
        await atomicJson(path.join(store(), `${id}.json`), record);
        return load(id);
      },
    );
    await pdfService.init();
    await importBytes(demoXml(), "Bruder Jakob.musicxml", {
      version: "Demo · Melodie mit Akkorden",
      source: "Mitgelieferte Dateifassung",
      license: "CC0 1.0",
    }).catch((error) =>
      console.warn(
        "Demo-Katalogeintrag kann nicht geladen werden:",
        error.message,
      ),
    );
    await importBytes(demoMidi(), "Bruder Jakob.mid", {
      artist: "Traditionell",
      version: "Demo · Mehrspurige MIDI-Datei",
      source: "Mitgelieferte Dateifassung",
      license: "CC0 1.0",
    }).catch((error) =>
      console.warn(
        "Demo-Katalogeintrag kann nicht geladen werden:",
        error.message,
      ),
    );
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
            `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ""}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self'; connect-src 'self'${dev ? " ws://127.0.0.1:5173" : ""}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
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
      if (
        trackId !== "auto" &&
        !record.song.tracks.some((t) => t.id === trackId)
      )
        throw new Error("Die Melodiestimme wurde nicht gefunden.");
      return workerJob({
        action: "chords",
        song: record.song,
        trackId: trackId === "auto" ? record.song.tracks[0].id : trackId,
      });
    });
    handle("files:import", importPaths);
    handle("files:open", async () => {
      const result = await dialog.showOpenDialog(win, {
        title: "Song öffnen",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "PDF, MIDI und MusicXML",
            extensions: ["pdf", "mid", "midi", "musicxml", "mxl"],
          },
        ],
      });
      return result.canceled ? [] : importPaths(result.filePaths);
    });
    handle("catalog:update", async (id, input) =>
      catalogWrite(id, async () => {
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
        return load(id);
      }),
    );
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
    handle("arrange", async (id, input, revision) =>
      catalogWrite(id, async () => {
        const record = await load(id),
          settings = checkedSettings(input, record.song);
        const result = await playbackStore.resolve(
          record.entry.id,
          { kind: "arrangement", settings },
          revision === undefined
            ? record.sourceRevision
            : idSchema.parse(revision),
        );
        record.settings = settings;
        await atomicJson(path.join(store(), `${record.entry.id}.json`), record);
        return result.music;
      }),
    );
    const requestSchema = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("original") }),
      z.object({
        kind: z.literal("melody"),
        trackId: z.string().min(1).max(200),
      }),
      z.object({ kind: z.literal("arrangement"), settings: settingsSchema }),
    ]);
    handle("playback:resolve", async (id, input, revision) => {
      const request = requestSchema.parse(input) as PlaybackRequest;
      return playbackStore.resolve(
        idSchema.parse(id),
        request,
        revision === undefined ? undefined : idSchema.parse(revision),
      );
    });
    handle("playback:load", async (id, versionId) =>
      playbackStore.load(idSchema.parse(id), idSchema.parse(versionId)),
    );
    handle("midi:save", async (id, input) => {
      const record = await load(id);
      const snapshot =
        typeof input === "string"
          ? await playbackStore.load(record.entry.id, idSchema.parse(input))
          : await playbackStore.resolve(record.entry.id, {
              kind: "arrangement",
              settings: checkedSettings(input, record.song),
            });
      const settings = snapshot.music.settings,
        bytes = exportMidi(snapshot.music);
      const result = await dialog.showSaveDialog(win, {
        title: "MIDI speichern",
        defaultPath: `${record.song.title.replace(/[/\\:]/g, "-")} – ${settings.mode === "original" ? "Klavier" : settings.mode === "reduction" ? "Klavierfassung" : "Swing"}.mid`,
        filters: [{ name: "Standard-MIDI", extensions: ["mid"] }],
      });
      if (result.canceled || !result.filePath) return null;
      await playbackStore.load(record.entry.id, snapshot.id);
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
    handle("pdf:bytes", async (id) => pdfService.bytes(idSchema.parse(id)));
    handle("pdf:start", async (id, pages, rotation) =>
      pdfService.start(
        idSchema.parse(id),
        z.array(z.number().int().positive()).min(1).max(200).parse(pages),
        z.number().int().parse(rotation),
      ),
    );
    handle("pdf:status", async (id) => pdfService.status(idSchema.parse(id)));
    handle("pdf:cancel", async (id) => pdfService.cancel(idSchema.parse(id)));
    handle("piano:analyze", async (id, trackId) => {
      const record = await load(id);
      assertSong(record.song);
      return workerJob({
        action: "piano-analysis",
        song: record.song,
        trackId:
          trackId === undefined ? "auto" : z.string().max(200).parse(trackId),
      });
    });
    handle("musicxml:save", async (id, input) => {
      const record = await load(id);
      assertSong(record.song);
      const snapshot =
        typeof input === "string"
          ? await playbackStore.load(record.entry.id, idSchema.parse(input))
          : input
            ? await playbackStore.resolve(record.entry.id, {
                kind: "arrangement",
                settings: checkedSettings(input, record.song),
              })
            : undefined;
      const settings = snapshot?.music.settings;
      const xml = exportMusicXml(snapshot ? snapshot.music : record.song);
      const result = await dialog.showSaveDialog(win, {
        title: settings
          ? "Klavierfassung als MusicXML speichern"
          : "Erkannte Partitur als MusicXML speichern",
        defaultPath: `${record.song.title.replace(/[/\\:]/g, "-")} – ${settings ? "Klavierfassung" : "Partitur"}.musicxml`,
        filters: [{ name: "MusicXML", extensions: ["musicxml"] }],
      });
      if (result.canceled || !result.filePath) return null;
      if (snapshot) await playbackStore.load(record.entry.id, snapshot.id);
      await writeFile(result.filePath, xml, "utf8");
      return result.filePath;
    });
    handle("score:correct", async (id, input) =>
      catalogWrite(id, async () => {
        const record = await load(id);
        const corrected = validateScore(input, record.song);
        record.song = {
          ...record.song,
          ...corrected,
          issues: [],
          pdf: record.song.pdf
            ? { ...record.song.pdf, reviewed: true }
            : undefined,
        };
        delete record.settings;
        assertSong(record.song);
        await atomicJson(path.join(store(), `${record.entry.id}.json`), record);
        return load(id);
      }),
    );
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
  pdfService?.shutdown();
  void worker?.terminate();
  app.quit();
});
