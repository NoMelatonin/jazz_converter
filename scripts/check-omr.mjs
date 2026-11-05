import { build } from "esbuild";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
const results = path.resolve("test-results");
await mkdir(results, { recursive: true });
await build({
  entryPoints: ["desktop/pdf-service.ts"],
  outfile: path.join(results, "pdf-service.cjs"),
  platform: "node",
  format: "cjs",
  bundle: true,
});
const { PdfService } = createRequire(import.meta.url)(
  path.join(results, "pdf-service.cjs"),
);
const archive = unzipSync(
  await readFile("resources/omr/audiveris-source-5.11.0.zip"),
  { filter: (f) => f.name.endsWith("/data/examples/SchbAvMaSample.pdf") },
);
const input = process.argv[2] ?? path.join(results, "SchbAvMaSample.pdf");
if (!process.argv[2]) await writeFile(input, Object.values(archive)[0]);
const dataDir = await mkdtemp(path.join(tmpdir(), "jazz-omr-test-"));
const service = new PdfService(
  dataDir,
  path.resolve("resources/omr"),
  async (song, source, jobId, index, doc) => {
    song.id = jobId;
    await writeFile(path.join(results, `recognized-${index}.mxl`), source);
    await writeFile(
      path.join(results, `recognized-${index}.json`),
      JSON.stringify(song, null, 2),
    );
    return {
      entry: {
        id: jobId,
        title: song.title,
        artist: song.artist,
        version: "PDF-Test",
        format: "PDF",
        source: doc.title,
        license: "Test",
      },
      song,
    };
  },
);
await service.init();
const doc = await service.prepare(input);
let job = await service.start(
  doc.id,
  Array.from({ length: Math.min(doc.pages, 2) }, (_, i) => i + 1),
  0,
);
console.log(`OMR data: ${dataDir}`);
console.log(job.message);
let last = "";
await new Promise((resolve, reject) => {
  const timer = setInterval(() => {
    job = service.status(job.id);
    if (job.message !== last) {
      console.log(`${job.progress}% ${job.message}`);
      last = job.message;
    }
    if (job.status === "complete") {
      clearInterval(timer);
      console.log(
        `PASS: ${job.results.length} Partitur(en), ${job.results[0].song.tracks.length} Stimmen, ${job.results[0].song.bars.length} Takte`,
      );
      resolve();
    }
    if (job.status === "error" || job.status === "cancelled") {
      clearInterval(timer);
      reject(new Error(job.error ?? job.message));
    }
  }, 1000);
});
await writeFile(
  path.join(results, "omr-report.json"),
  JSON.stringify({ passed: true, input, dataDir, job }, null, 2),
);
