import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  stat,
  rm,
  statfs,
} from "node:fs/promises";
import path from "node:path";
import {
  youtubeUrl,
  type VideoJob,
  type Calibration,
  type VideoTools,
} from "../src/core/video";
import { transcriptionSong, type VideoResult } from "../src/core/transcription";
import type { Song, CatalogSong } from "../src/core/model";
const MODEL_SHA =
  "c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141";
const UV_SHA: Record<string, string> = {
  arm64: "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
  x64: "20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7",
};
interface Task {
  job: VideoJob;
  controller: AbortController;
  directory: string;
  file?: string;
  saving?: boolean;
}
async function checksum(file: string) {
  const hash = createHash("sha256");
  for await (const b of createReadStream(file)) hash.update(b);
  return hash.digest("hex");
}
export class VideoService {
  private tasks = new Map<string, Task>();
  private setupId?: string;
  readonly runtime: string;
  constructor(
    readonly dataDir: string,
    readonly assets: string,
    private save: (song: Song, id: string) => Promise<CatalogSong>,
  ) {
    this.runtime =
      process.env.JAZZ_VIDEO_RUNTIME ?? path.join(dataDir, "video-runtime-v1");
  }
  private python() {
    return path.join(this.runtime, "env/bin/python");
  }
  private env() {
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONNOUSERSITE: "1",
      UV_PYTHON_INSTALL_DIR: path.join(this.runtime, "python"),
      UV_CACHE_DIR: path.join(this.runtime, "cache"),
      NUMBA_CACHE_DIR: path.join(this.runtime, "numba"),
      MPLCONFIGDIR: path.join(this.runtime, "matplotlib"),
    };
  }
  async tools(): Promise<VideoTools> {
    const ready = await readFile(path.join(this.runtime, "ready.json"), "utf8")
      .then(
        async (s) =>
          JSON.parse(s).model === MODEL_SHA &&
          (await stat(this.python())).isFile() &&
          (await stat(path.join(this.runtime, "piano.pth"))).size === 171966578,
      )
      .catch(() => false);
    return {
      ready,
      modelBytes: 171966578,
      diskBytes: 3_000_000_000,
      message: ready
        ? "Lokale Videoverarbeitung bereit."
        : "Einmalig etwa 500 MB Download, mindestens 3 GB freier Platz; CPU, keine API-Schlüssel. Python, FFmpeg, yt-dlp und Klaviermodell werden privat installiert. Modell: CC BY 4.0, Kong et al., Zenodo 4034264.",
    };
  }
  private async task(label: string) {
    const id = randomUUID(),
      directory = path.join(this.dataDir, "video-jobs", id);
    await mkdir(directory, { recursive: true });
    const task: Task = {
      job: { id, status: "running", progress: 0, message: label },
      controller: new AbortController(),
      directory,
    };
    this.tasks.set(id, task);
    return task;
  }
  status(id: string) {
    const t = this.tasks.get(id);
    if (!t)
      throw new Error(
        "Dieser Videoauftrag ist nicht mehr verfügbar. Bitte erneut starten.",
      );
    return structuredClone(t.job);
  }
  cancel(id: string) {
    const t = this.tasks.get(id);
    if (!t) throw new Error("Unbekannter Videoauftrag.");
    if (t.job.status === "running" && !t.saving) {
      t.job.status = "cancelled";
      t.job.message = "Abgebrochen";
      t.controller.abort();
    }
    return this.status(id);
  }
  private assertActive(t: Task) {
    if (t.controller.signal.aborted) throw new Error("Abgebrochen");
  }
  private async execute(
    t: Task,
    file: string,
    args: string[],
    onEvent?: (data: any) => void,
  ): Promise<string> {
    this.assertActive(t);
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        env: this.env(),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "",
        err = "",
        line = "";
      const kill = () => {
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {}
        const timer = setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {}
        }, 1500);
        timer.unref();
      };
      const timeout = setTimeout(
        () => {
          kill();
          reject(
            new Error(
              "Die Verarbeitung hat zu lange gedauert. Bitte kürzeres Video verwenden.",
            ),
          );
        },
        45 * 60 * 1000,
      );
      t.controller.signal.addEventListener("abort", kill, { once: true });
      child.stdout.on("data", (b) => {
        const text = String(b);
        out = (out + text).slice(-2_000_000);
        line += text;
        let i;
        while ((i = line.indexOf("\n")) >= 0) {
          const next = line.slice(0, i);
          line = line.slice(i + 1);
          if (next.startsWith("JAZZ:")) {
            try {
              onEvent?.(JSON.parse(next.slice(5)));
            } catch {}
          } else if (next.includes("[download]")) {
            const percent = /([\d.]+)%/.exec(next);
            if (percent) t.job.progress = Number(percent[1]) / 100;
          }
        }
      });
      child.stderr.on("data", (b) => {
        err = (err + String(b)).slice(-4000);
      });
      child.on("error", (e) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Lokales Werkzeug konnte nicht gestartet werden: ${e.message}`,
          ),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        t.controller.signal.removeEventListener("abort", kill);
        if (t.controller.signal.aborted) reject(new Error("Abgebrochen"));
        else if (code !== 0) reject(new Error(this.downloadError(err || out)));
        else resolve(out);
      });
    });
  }
  private downloadError(error: string) {
    if (/private|unavailable|removed|not available/i.test(error))
      return "Video ist privat, entfernt oder hier nicht verfügbar. Bitte lokale Videodatei verwenden.";
    if (/sign in|confirm.*bot|403|429|login|age.restrict/i.test(error))
      return "YouTube blockiert den Abruf oder verlangt eine Anmeldung. Bitte eine lokale Videodatei verwenden.";
    if (/network|resolve|connection|timed out/i.test(error))
      return "Quelle nicht erreichbar. Internetverbindung prüfen oder lokale Videodatei verwenden.";
    return error.slice(-1500) || "Lokale Verarbeitung fehlgeschlagen.";
  }
  private async download(
    t: Task,
    url: string,
    target: string,
    sha: string,
    maxBytes: number,
  ) {
    if ((await checksum(target).catch(() => "")) === sha) return;
    if (process.env.JAZZ_TEST_OFFLINE === "1")
      throw new Error("Keine Internetverbindung im Offlinebetrieb.");
    const response = await fetch(url, {
      headers: {
        "User-Agent": "JazzConverter/2.1 (local piano transcription)",
      },
      signal: AbortSignal.any([
        t.controller.signal,
        AbortSignal.timeout(300000),
      ]),
    });
    if (!response.ok || !response.body)
      throw new Error(`Download nicht erreichbar (HTTP ${response.status}).`);
    const temp = target + ".part";
    const chunks: Uint8Array[] = [];
    let size = 0;
    const total = Number(response.headers.get("content-length")) || maxBytes;
    for await (const chunk of response.body as any) {
      size += chunk.length;
      if (size > maxBytes)
        throw new Error("Download überschreitet die erlaubte Größe.");
      chunks.push(chunk);
      t.job.progress = Math.min(0.99, size / total);
    }
    await writeFile(temp, Buffer.concat(chunks));
    if ((await checksum(temp)) !== sha) {
      await rm(temp, { force: true });
      throw new Error(
        "Prüfsumme des Downloads stimmt nicht. Bitte erneut versuchen.",
      );
    }
    await rename(temp, target);
  }
  async setup() {
    if (this.setupId && this.tasks.get(this.setupId)?.job.status === "running")
      return this.status(this.setupId);
    const t = await this.task("Lokale Videoverarbeitung einrichten");
    this.setupId = t.job.id;
    void this.guard(t, async () => {
      if (process.platform !== "darwin" || !UV_SHA[process.arch])
        throw new Error(
          "Videoverarbeitung unterstützt macOS auf Apple Silicon oder Intel.",
        );
      await mkdir(this.runtime, { recursive: true });
      const space = await statfs(this.runtime);
      if (space.bavail * space.bsize < 3_000_000_000)
        throw new Error(
          "Mindestens 3 GB freier Speicher für die Einrichtung erforderlich.",
        );
      const arch = process.arch === "arm64" ? "aarch64" : "x86_64",
        archive = path.join(this.runtime, "uv.tar.gz");
      await this.download(
        t,
        `https://github.com/astral-sh/uv/releases/download/0.13.7/uv-${arch}-apple-darwin.tar.gz`,
        archive,
        UV_SHA[process.arch],
        40_000_000,
      );
      await this.execute(t, "/usr/bin/tar", [
        "-xzf",
        archive,
        "-C",
        this.runtime,
      ]);
      const uv = path.join(this.runtime, `uv-${arch}-apple-darwin/uv`);
      t.job.message = "Python 3.11 installieren";
      t.job.progress = 0;
      if (!(await stat(this.python()).catch(() => null)))
        await this.execute(t, uv, [
          "venv",
          "--python",
          "3.11.18",
          "--managed-python",
          path.join(this.runtime, "env"),
        ]);
      t.job.message =
        "Geprüfte lokale Pakete installieren (Fortschritt unbekannt)";
      await this.execute(t, uv, [
        "pip",
        "install",
        "--python",
        this.python(),
        "--require-hashes",
        "-r",
        path.join(this.assets, "requirements.txt"),
      ]);
      t.job.message = "Klaviermodell laden (172 MB)";
      await this.download(
        t,
        "https://zenodo.org/api/records/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth/content",
        path.join(this.runtime, "piano.pth"),
        MODEL_SHA,
        180_000_000,
      );
      await this.runner(t, { action: "check" });
      await writeFile(
        path.join(this.runtime, "ready.json"),
        JSON.stringify({ model: MODEL_SHA }),
      );
      t.job.status = "complete";
      t.job.message = "Videoverarbeitung bereit";
    });
    return this.status(t.job.id);
  }
  private async guard(t: Task, action: () => Promise<void>) {
    try {
      await action();
      this.assertActive(t);
      t.job.progress = 1;
    } catch (e) {
      if (t.controller.signal.aborted) {
        await rm(t.directory, { recursive: true, force: true });
        return;
      }
      t.job.status = "error";
      t.job.error = e instanceof Error ? e.message : String(e);
      t.job.message = t.job.error;
    }
  }
  private async runner(t: Task, request: Record<string, unknown>) {
    const file = path.join(t.directory, "request.json");
    await writeFile(
      file,
      JSON.stringify({ ...request, directory: t.directory }),
    );
    let result: any = {};
    try {
      await this.execute(
        t,
        this.python(),
        [path.join(this.assets, "runner.py"), file],
        (data) => {
          if (data.error) result.error = data.error;
          else Object.assign(result, data);
          if (data.progress !== undefined) t.job.progress = data.progress;
          if (data.message) t.job.message = data.message;
        },
      );
    } catch (e) {
      if (result.error) throw new Error(result.error);
      throw e;
    }
    if (result.error) throw new Error(result.error);
    return result;
  }
  async prepare(input: { url?: string; file?: string }) {
    if (!(await this.tools()).ready)
      throw new Error("Bitte zuerst die lokale Videoverarbeitung einrichten.");
    const source = input.url ? youtubeUrl(input.url) : input.file;
    if (!source) throw new Error("Bitte Link oder Videodatei auswählen.");
    if (!input.url) {
      if (!path.isAbsolute(source) || !/\.(mp4|mov|mkv|webm)$/i.test(source))
        throw new Error("Bitte MP4, MOV, MKV oder WebM auswählen.");
      const info = await stat(source);
      if (!info.isFile() || info.size > 2_000_000_000)
        throw new Error("Die Videodatei darf maximal 2 GB groß sein.");
    }
    const t = await this.task("Videoquelle laden");
    t.job.source = source;
    t.job.title = input.url ? "YouTube-Klavierfassung" : path.basename(source);
    void this.guard(t, async () => {
      if (input.url) {
        if (process.env.JAZZ_TEST_OFFLINE === "1")
          throw new Error(
            "YouTube benötigt eine Internetverbindung. Lokale Videodateien funktionieren offline.",
          );
        const common = [
          "-m",
          "yt_dlp",
          "--ignore-config",
          "--no-playlist",
          "--no-warnings",
          "--socket-timeout",
          "20",
          "--js-runtimes",
          `node:${process.execPath}`,
        ];
        const metadata = JSON.parse(
          await this.execute(t, this.python(), [
            ...common,
            "--skip-download",
            "--dump-single-json",
            source,
          ]),
        );
        if (metadata.is_live || !metadata.duration || metadata.duration > 1800)
          throw new Error(
            "Livestreams und Videos über 30 Minuten werden nicht unterstützt.",
          );
        t.job.title = String(metadata.title).slice(0, 200);
        t.file = path.join(t.directory, "source.mp4");
        await this.execute(t, this.python(), [
          ...common,
          "--newline",
          "--max-filesize",
          "2G",
          "-f",
          "best[ext=mp4][height<=720]/best[height<=720]",
          "-o",
          t.file,
          source,
        ]);
      } else t.file = source;
      t.job.message = "Videobilder prüfen";
      t.job.progress = 0;
      const data = await this.runner(t, { action: "preview", file: t.file });
      t.job.previews = await Promise.all(
        data.preview.map(
          async (file: string) =>
            "data:image/jpeg;base64," +
            (await readFile(file)).toString("base64"),
        ),
      );
      t.job.duration = data.duration;
      t.job.fps = data.fps;
      t.job.status = "ready";
      t.job.message = "Quelle geladen. Verfahren wählen und Vorschau prüfen.";
    });
    return this.status(t.job.id);
  }
  transcribe(
    id: string,
    method: "audio" | "visual",
    calibration?: Calibration,
  ) {
    const t = this.tasks.get(id);
    if (!t || !t.file || !["ready", "error"].includes(t.job.status))
      throw new Error("Bitte zuerst eine Videoquelle laden.");
    if (
      method === "visual" &&
      (!calibration ||
        Object.values(calibration).some((v) => !Number.isFinite(v)) ||
        calibration.c5 - calibration.c4 < 21 ||
        calibration.line < 4)
    )
      throw new Error(
        "Bitte C4, C5 und die Anschlaglinie im Vorschaubild markieren.",
      );
    t.controller = new AbortController();
    t.saving = false;
    t.job.status = "running";
    t.job.progress = 0;
    t.job.error = undefined;
    t.job.message = "Transkription vorbereiten";
    void this.guard(t, async () => {
      if (
        method === "audio" &&
        (await checksum(path.join(this.runtime, "piano.pth"))) !== MODEL_SHA
      )
        throw new Error(
          "Das Klaviermodell ist beschädigt. Bitte die Videoverarbeitung erneut einrichten.",
        );
      const data = await this.runner(t, {
        action: method,
        file: t.file,
        calibration,
        model: path.join(this.runtime, "piano.pth"),
      });
      this.assertActive(t);
      const result: VideoResult = JSON.parse(
        await readFile(data.result, "utf8"),
      );
      const song = transcriptionSong(
        result,
        t.job.source!,
        method,
        t.job.title!,
      );
      this.assertActive(t);
      t.saving = true;
      t.job.message = "Geprüfte Transkription speichern";
      t.job.result = await this.save(
        song,
        createHash("sha256")
          .update(JSON.stringify({ source: t.job.source, result, method }))
          .digest("hex"),
      );
      t.job.status = "complete";
      t.job.message = "Transkription gespeichert – bitte anhören und prüfen.";
    });
    return this.status(id);
  }
  shutdown() {
    for (const t of this.tasks.values()) t.controller.abort();
  }
}
