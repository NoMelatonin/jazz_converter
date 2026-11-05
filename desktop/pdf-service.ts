import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  cp,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument as LibPdf,
  degrees,
  PDFName,
  PDFDict,
  PDFRawStream,
  PDFNumber,
} from "pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import type {
  PdfDocument,
  PdfJob,
  CatalogSong,
  Song,
  ReviewIssue,
} from "../src/core/model";
import { importXml } from "../src/core/import-xml";
import { enrichOmrMetadata } from "./omr-metadata";

const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const safe = (id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Ungültiger PDF-Auftrag.");
  return id;
};
export class PdfService {
  private jobs = new Map<string, PdfJob>();
  private children = new Map<string, ChildProcess>();
  private persistence = Promise.resolve();
  constructor(
    readonly dataDir: string,
    readonly resources: string,
    readonly commit: (
      song: Song,
      source: Uint8Array,
      jobId: string,
      index: number,
      doc: PdfDocument,
    ) => Promise<CatalogSong>,
  ) {}
  private folder(name: string, id?: string) {
    return path.join(this.dataDir, name, ...(id ? [safe(id)] : []));
  }
  async init() {
    await mkdir(this.folder("pdfs"), { recursive: true });
    await mkdir(this.folder("pdf-cache"), { recursive: true });
    for (const id of await readdir(this.folder("pdf-cache"))) {
      if (!/^[a-f0-9]{64}$/.test(id)) continue;
      try {
        const job = JSON.parse(
          await readFile(
            path.join(this.folder("pdf-cache", id), "job.json"),
            "utf8",
          ),
        ) as PdfJob;
        if (job.status === "running" || job.status === "queued") {
          job.status = "error";
          job.error =
            "Die Erkennung wurde beim Beenden unterbrochen. Bitte erneut starten.";
          job.message = job.error;
        }
        this.jobs.set(id, job);
      } catch {}
    }
  }
  async prepare(file: string): Promise<PdfDocument> {
    const info = await stat(file);
    if (!info.isFile() || info.size > 100 * 1024 * 1024)
      throw new Error("PDF-Dateien dürfen höchstens 100 MB groß sein.");
    const bytes = await readFile(file);
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("Die Datei ist keine gültige PDF-Datei.");
    let pdf: LibPdf;
    try {
      pdf = await LibPdf.load(bytes, { updateMetadata: false });
      // pdf-lib resolves the page tree lazily; validate it inside the same guard.
      pdf.getPages();
    } catch {
      throw new Error(
        "Das PDF ist beschädigt oder passwortgeschützt. Bitte eine entsperrte PDF-Kopie öffnen.",
      );
    }
    if (!pdf.getPageCount()) throw new Error("Das PDF enthält keine Seiten.");
    const lowResolutionPages: number[] = [];
    for (const [index, page] of pdf.getPages().entries()) {
      const resources = page.node.Resources(),
        refs = resources?.lookup(PDFName.of("XObject"));
      if (!(refs instanceof PDFDict)) continue;
      const resolutions: number[] = [];
      for (const [, ref] of refs.entries()) {
        const stream = pdf.context.lookup(ref);
        if (
          !(stream instanceof PDFRawStream) ||
          String(stream.dict.get(PDFName.of("Subtype"))) !== "/Image"
        )
          continue;
        const w = stream.dict.lookup(PDFName.of("Width")),
          h = stream.dict.lookup(PDFName.of("Height"));
        if (!(w instanceof PDFNumber) || !(h instanceof PDFNumber)) continue;
        const width = w.asNumber(),
          height = h.asNumber();
        if (
          width < 100 ||
          height < 100 ||
          Math.abs(width / height - page.getWidth() / page.getHeight()) > 0.08
        )
          continue;
        resolutions.push(
          Math.min(
            (width / page.getWidth()) * 72,
            (height / page.getHeight()) * 72,
          ),
        );
      }
      if (resolutions.length && Math.max(...resolutions) < 200)
        lowResolutionPages.push(index + 1);
    }
    const id = hash(bytes),
      doc: PdfDocument = {
        id,
        title: pdf.getTitle() || path.basename(file, ".pdf"),
        pages: pdf.getPageCount(),
        bytes: bytes.length,
        lowResolutionPages,
      };
    await mkdir(this.folder("pdfs", id), { recursive: true });
    await writeFile(path.join(this.folder("pdfs", id), "original.pdf"), bytes, {
      flag: "wx",
    }).catch((e: any) => {
      if (e.code !== "EEXIST") throw e;
    });
    await writeFile(
      path.join(this.folder("pdfs", id), "document.json"),
      JSON.stringify(doc),
    );
    return doc;
  }
  async document(id: string): Promise<PdfDocument> {
    return JSON.parse(
      await readFile(
        path.join(this.folder("pdfs", id), "document.json"),
        "utf8",
      ),
    );
  }
  async bytes(id: string) {
    return new Uint8Array(
      await readFile(path.join(this.folder("pdfs", id), "original.pdf")),
    );
  }
  status(id: string): PdfJob {
    const job = this.jobs.get(safe(id));
    if (!job) throw new Error("Der PDF-Auftrag wurde nicht gefunden.");
    return structuredClone(job);
  }
  async cancel(id: string) {
    const job = this.jobs.get(safe(id));
    if (!job) throw new Error("Der PDF-Auftrag wurde nicht gefunden.");
    if (job.status === "queued" || job.status === "running") {
      job.status = "cancelled";
      job.message = "Erkennung abgebrochen. Das Original-PDF bleibt erhalten.";
      const child = this.children.get(id);
      child?.kill("SIGTERM");
      if (child) {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 3000);
        timer.unref();
      }
      await this.persist(job);
    }
    return this.status(id);
  }
  private persist(job: PdfJob) {
    this.persistence = this.persistence
      .catch(() => {})
      .then(async () => {
        const dir = this.folder("pdf-cache", job.id);
        await mkdir(dir, { recursive: true });
        const tmp = path.join(dir, "job.json.tmp");
        await writeFile(tmp, JSON.stringify(job));
        await rename(tmp, path.join(dir, "job.json"));
      });
    return this.persistence;
  }
  async start(
    documentId: string,
    pages: number[],
    rotation: number,
  ): Promise<PdfJob> {
    const doc = await this.document(documentId);
    if (
      !pages.length ||
      pages.length > 200 ||
      new Set(pages).size !== pages.length ||
      pages.some((p) => !Number.isInteger(p) || p < 1 || p > doc.pages) ||
      ![0, 90, 180, 270].includes(rotation)
    )
      throw new Error("Bitte höchstens 200 gültige PDF-Seiten auswählen.");
    pages = [...pages].sort((a, b) => a - b);
    let manifest: string;
    try {
      manifest = await readFile(
        path.join(this.resources, "manifest.json"),
        "utf8",
      );
    } catch {
      throw new Error(
        "Die lokale Notenerkennung fehlt. Bitte das vollständige Jazz-Converter-Paket installieren.",
      );
    }
    const id = hash(
      JSON.stringify({
        documentId,
        pages,
        rotation,
        engine: hash(manifest),
        normalization: 4,
      }),
    );
    const previous = this.jobs.get(id);
    if (
      previous?.status === "complete" ||
      previous?.status === "running" ||
      previous?.status === "queued"
    )
      return this.status(id);
    if (
      [...this.jobs.values()].some(
        (j) => j.status === "running" || j.status === "queued",
      )
    )
      throw new Error(
        "Es läuft bereits eine PDF-Erkennung. Bitte warten oder den laufenden Auftrag abbrechen.",
      );
    const job: PdfJob = {
      id,
      documentId,
      status: "queued",
      progress: 0,
      message: "PDF wird vorbereitet …",
    };
    this.jobs.set(id, job);
    await this.persist(job);
    void this.recognize(job, doc, pages, rotation).catch(async (e) => {
      if (job.status !== "cancelled") {
        job.status = "error";
        job.error = e instanceof Error ? e.message : String(e);
        job.message = job.error;
      }
      await this.persist(job);
    });
    return this.status(id);
  }
  private async recognize(
    job: PdfJob,
    doc: PdfDocument,
    pages: number[],
    rotation: number,
  ) {
    const dir = this.folder("pdf-cache", job.id);
    await rm(path.join(dir, "output"), { recursive: true, force: true });
    await mkdir(path.join(dir, "output"), { recursive: true });
    const source = await LibPdf.load(await this.bytes(doc.id), {
        updateMetadata: false,
      }),
      selected = await LibPdf.create();
    const selectedPages = await selected.copyPages(
      source,
      pages.map((p) => p - 1),
    );
    for (const p of selectedPages) {
      p.setRotation(degrees((p.getRotation().angle + rotation) % 360));
      selected.addPage(p);
    }
    await writeFile(
      path.join(dir, "input.pdf"),
      await selected.save({ useObjectStreams: false }),
    );
    if (job.status === "cancelled") return;
    const home = path.join(this.dataDir, "omr-home"),
      tess = path.join(home, "data/tessdata");
    await mkdir(tess, { recursive: true });
    await cp(path.join(this.resources, "tessdata"), tess, {
      recursive: true,
      force: true,
    });
    const bundle = path.join(
      this.resources,
      process.arch === "arm64" ? "arm64" : "x64",
      "Audiveris.app/Contents",
    );
    const engine = path.join(bundle, "runtime/Contents/Home/bin/java");
    try {
      await stat(engine);
    } catch {
      throw new Error(
        "Für diesen Mac fehlt die mitgelieferte Notenerkennung. Bitte das passende Installationspaket verwenden.",
      );
    }
    if (this.status(job.id).status === "cancelled") return;
    job.status = "running";
    job.progress = 5;
    job.message = "Noten werden lokal erkannt …";
    await this.persist(job);
    let log = "",
      currentPage = 1;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        engine,
        [
          `-Djazz.omr.userRoot=${home}`,
          `-Duser.home=${home}`,
          `-Dorg.bytedeco.javacpp.cachedir=${path.join(home, "native-cache")}`,
          "-Djava.awt.headless=true",
          "-Xmx3g",
          "--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED",
          "--enable-native-access=ALL-UNNAMED",
          "-cp",
          `${path.join(this.resources, "jazz-omr-isolation.jar")}${path.delimiter}${path.join(bundle, "app/*")}`,
          "Audiveris",
          "-batch",
          "-transcribe",
          "-export",
          "-save",
          "-swap",
          "-output",
          path.join(dir, "output"),
          "-constant",
          "org.audiveris.omr.text.Language.defaultSpecification=eng+deu",
          "--",
          path.join(dir, "input.pdf"),
        ],
        {
          cwd: dir,
          env: { ...process.env, TESSDATA_PREFIX: tess },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      this.children.set(job.id, child);
      const timer = setTimeout(
        () => {
          child.kill("SIGTERM");
          const force = setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
          }, 3000);
          force.unref();
          reject(
            new Error(
              "Die PDF-Erkennung hat das Zeitlimit erreicht. Bitte weniger Seiten auswählen.",
            ),
          );
        },
        Math.min(45 * 60000, Math.max(5 * 60000, pages.length * 120000)),
      );
      const receive = (chunk: Buffer) => {
        const text = chunk.toString();
        log = (log + text).slice(-6 * 1024 * 1024);
        const sheets = [...text.matchAll(/(?:sheet#|Stub#)(\d+)/gi)].map((m) =>
          Number(m[1]),
        );
        if (sheets.length)
          currentPage = Math.min(
            pages.length,
            Math.max(currentPage, ...sheets),
          );
        const steps = [
          "LOAD",
          "BINARY",
          "SCALE",
          "GRID",
          "HEADERS",
          "STEM_SEEDS",
          "BEAMS",
          "LEDGERS",
          "HEADS",
          "STEMS",
          "REDUCTION",
          "CUE_BEAMS",
          "TEXTS",
          "MEASURES",
          "CHORDS",
          "CURVES",
          "SYMBOLS",
          "LINKS",
          "RHYTHMS",
          "PAGE",
        ];
        const stages = [...text.matchAll(/StepMonitoring[^\n]*\|\s*(\w+)/g)]
          .map((m) => steps.indexOf(m[1]))
          .filter((i) => i >= 0);
        if (stages.length) {
          const stage = stages.at(-1)!;
          job.progress = Math.max(
            job.progress,
            Math.min(
              90,
              5 +
                Math.round(
                  ((currentPage - 1 + (stage + 1) / steps.length) /
                    pages.length) *
                    85,
                ),
            ),
          );
        }
        job.message = `Noten erkennen · Seite ${currentPage} von ${pages.length}`;
      };
      child.stdout.on("data", receive);
      child.stderr.on("data", receive);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        this.children.delete(job.id);
        void writeFile(path.join(dir, "recognition.log"), log);
        if (job.status === "cancelled") resolve();
        else if (code !== 0)
          reject(
            new Error(
              `Die Notenerkennung konnte das PDF nicht vollständig lesen. Bitte Scanqualität und Seitenauswahl prüfen. ${log
                .split("\n")
                .filter((l) => /ERROR|Exception|No OCR|not found/i.test(l))
                .slice(-2)
                .join(" ")
                .slice(0, 400)}`,
            ),
          );
        else resolve();
      });
    });
    if (this.status(job.id).status === "cancelled") return;
    const files: string[] = [];
    const walk = async (folder: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (/\.mxl$/i.test(entry.name)) files.push(file);
      }
    };
    await walk(path.join(dir, "output"));
    files.sort();
    if (!files.length)
      throw new Error(
        "Keine lesbare Partitur gefunden. Bitte Notenseiten auswählen oder einen klareren Scan verwenden.",
      );
    job.progress = 93;
    job.message = "Stimmen und Spielbarkeit werden vorbereitet …";
    const results: CatalogSong[] = [];
    for (const [index, file] of files.entries()) {
      const bytes = await readFile(file),
        song = importXml(bytes, path.basename(file), { lenient: true });
      const xmlFiles = unzipSync(bytes, {
        filter: (f) =>
          /\.xml$/i.test(f.name) &&
          !f.name.startsWith("META-INF/") &&
          f.originalSize < 32 * 1024 * 1024,
      });
      const sheetIds = [
        ...new Set(
          Object.values(xmlFiles).flatMap((b) =>
            [...strFromU8(b).matchAll(/name="source-sheet-(\d+)"/g)].map((m) =>
              Number(m[1]),
            ),
          ),
        ),
      ].sort((a, b) => a - b);
      const scorePages = sheetIds.length
        ? sheetIds.map((p) => pages[p - 1] ?? pages[0])
        : pages;
      await enrichOmrMetadata(song, path.dirname(file), sheetIds);
      if (song.title === "input" || !song.title.trim()) song.title = doc.title;
      const mapSource = (ref: any) => {
        if (ref?.page) ref.page = scorePages[ref.page - 1] ?? scorePages[0];
      };
      for (const track of song.tracks)
        for (const n of track.notes) mapSource(n.source);
      for (const r of song.rests ?? []) mapSource(r.source);
      for (const i of song.issues ?? []) mapSource(i.source);
      const issues: ReviewIssue[] = [...(song.issues ?? [])];
      for (const page of doc.lowResolutionPages ?? [])
        if (scorePages.includes(page))
          issues.push({
            id: `resolution-${page}`,
            severity: "error",
            kind: "recognition",
            message:
              "Dieser Scan hat weniger als 200 dpi. Bitte erkannte Noten sorgfältig vergleichen oder einen Scan mit 300 dpi verwenden.",
            source: { page, measure: 1 },
          });
      for (const part of song.parts ?? [])
        if (!part.name || /^(?:Voice|P\d+|Part\s*\d+)$/i.test(part.name))
          issues.push({
            id: `part-${part.id}`,
            severity: "warning",
            kind: "instrument",
            message:
              "Instrumentenname nicht sicher erkannt. Bei transponierenden Instrumenten die klingende Tonhöhe prüfen.",
            source: { measure: 1, partId: part.id, page: scorePages[0] },
          });
      const omrIssues = await this.omrIssues(path.dirname(file), pages);
      issues.push(
        ...omrIssues.filter(
          (i) => !i.source?.page || scorePages.includes(i.source.page),
        ),
      );
      if (
        /could not initialize TessBaseAPI|couldn.t load any languages/i.test(
          log,
        )
      )
        issues.push({
          id: "ocr-languages",
          severity: "error",
          kind: "recognition",
          message:
            "Instrumentennamen und Text konnten nicht gelesen werden. Die mitgelieferten Sprachdaten prüfen.",
          source: { page: scorePages[0], measure: 1 },
        });
      song.pdf = {
        version: "Audiveris 5.11.0",
        sourceHash: doc.id,
        pages: scorePages,
        issues,
      };
      song.format = "PDF";
      if (this.status(job.id).status === "cancelled") return;
      results.push(await this.commit(song, bytes, job.id, index, doc));
    }
    if (this.status(job.id).status === "cancelled") return;
    job.results = results;
    job.status = "complete";
    job.progress = 100;
    job.message = "Partitur erkannt. Klavierfassung bereit zur Prüfung.";
    await this.persist(job);
  }
  private async omrIssues(
    folder: string,
    pages: number[],
  ): Promise<ReviewIssue[]> {
    const result: ReviewIssue[] = [];
    for (const file of (await readdir(folder)).filter((f) =>
      f.endsWith(".omr"),
    )) {
      const archive = unzipSync(await readFile(path.join(folder, file)), {
        filter: (f) =>
          /sheet#\d+\.xml$/.test(f.name) && f.originalSize < 32 * 1024 * 1024,
      });
      for (const [name, bytes] of Object.entries(archive)) {
        const text = strFromU8(bytes),
          page = Number(/sheet#(\d+)/.exec(name)?.[1] ?? 1);
        const count = (text.match(/\babnormal="true"/g) ?? []).length;
        if (count)
          result.push({
            id: `omr-${page}`,
            severity: "error",
            kind: "recognition",
            message: `Die Erkennung meldet ${count} unklare Noten- oder Rhythmusstellen auf dieser Seite. Bitte mit dem PDF vergleichen.`,
            source: { page: pages[page - 1] ?? pages[0], measure: 1 },
          });
      }
    }
    return result;
  }
  shutdown() {
    for (const child of this.children.values()) child.kill("SIGTERM");
  }
}
