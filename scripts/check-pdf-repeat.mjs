// Run after verify:pdf: compare a fresh, independent OMR run with that baseline.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const output = path.resolve("test-results/pdf-repeat.cjs");
await build({
  stdin: {
    contents: `export { PdfService } from './desktop/pdf-service'; export { analyzePiano } from './src/core/piano'; export { convertArrangement } from './src/core/convert'; export { exportMidi } from './src/core/midi';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { PdfService, analyzePiano, convertArrangement, exportMidi } =
  createRequire(import.meta.url)(output);
const dataDir = await mkdtemp(path.join(tmpdir(), "jazz-pdf-repeat-")),
  cases = [];
const service = new PdfService(
  dataDir,
  path.resolve("resources/omr"),
  async (song, bytes, id) => ({
    entry: {
      id,
      title: song.title,
      artist: song.artist,
      format: "PDF",
      version: "Repeat",
      source: "CC0 fixture",
      license: "CC0",
    },
    song,
  }),
);
await service.init();
try {
  for (const name of ["piano", "orchestra-scan"]) {
    const baseline = JSON.parse(
      await readFile(`test-results/${name}-recognized.json`, "utf8"),
    );
    const doc = await service.prepare(
      path.resolve(`tests/fixtures/pdf/${name}.pdf`),
    );
    let job = await service.start(doc.id, [1], 0),
      deadline = Date.now() + 180000;
    while (
      ["queued", "running"].includes(job.status) &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 500));
      job = service.status(job.id);
    }
    assert.equal(job.status, "complete", job.error ?? "OMR timeout");
    const repeated = job.results[0].song;
    assert.equal(
      repeated.pdf.sourceHash,
      baseline.pdf.sourceHash,
      "Source PDF must be identical",
    );
    for (const difficulty of ["easy", "medium"]) {
      const settings = {
        style: "swing",
        mode: analyzePiano(baseline).directlyPlayable
          ? "original"
          : "reduction",
        difficulty,
        melodyTrackId: "auto",
        chords: [],
      };
      const bytes = exportMidi(convertArrangement(repeated, settings));
      assert.deepEqual(
        bytes,
        exportMidi(convertArrangement(baseline, settings)),
      );
      cases.push({
        name,
        difficulty,
        passed: true,
        midiSha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    console.log(
      `PASS ${name}: independent full OMR run produces byte-identical MIDI at both levels`,
    );
  }
  await writeFile(
    "test-results/pdf-repeat-report.json",
    JSON.stringify({ passed: true, dataDir, cases }, null, 2),
  );
} finally {
  service.shutdown();
}
