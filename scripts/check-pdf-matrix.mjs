import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("test-results");
await mkdir(root, { recursive: true });
await build({
  stdin: {
    contents: `export { PdfService } from './desktop/pdf-service'; export { analyzePiano } from './src/core/piano'; export { convertArrangement } from './src/core/convert'; export { violations } from './src/core/arrange'; export { exportMidi } from './src/core/midi'; export { exportMusicXml } from './src/core/musicxml'; export { instrumentTransposition } from './src/core/instruments';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: path.join(root, "pdf-matrix.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
});
const {
  PdfService,
  analyzePiano,
  convertArrangement,
  violations,
  exportMidi,
  exportMusicXml,
  instrumentTransposition,
} = createRequire(import.meta.url)(path.join(root, "pdf-matrix.cjs"));
const dataDir = await mkdtemp(path.join(tmpdir(), "jazz-pdf-matrix-")),
  cases = [],
  references = JSON.parse(
    await readFile("tests/fixtures/pdf/reference.json", "utf8"),
  );
const service = new PdfService(
  dataDir,
  path.resolve("resources/omr"),
  async (song, bytes, jobId, index, doc) => {
    song.id = jobId;
    return {
      entry: {
        id: jobId,
        title: song.title,
        artist: song.artist,
        version: "Matrix",
        format: "PDF",
        source: doc.title,
        license: "CC0",
      },
      song,
    };
  },
);
await service.init();
const events = (notes) =>
  notes
    .map(
      (n) =>
        `${n.pitch}@${n.start.n / n.start.d}:${n.duration.n / n.duration.d}`,
    )
    .sort();
async function wait(job) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    job = service.status(job.id);
    if (job.status === "complete") return job;
    if (job.status === "error") throw new Error(job.error);
    await new Promise((r) => setTimeout(r, 500));
  }
  await service.cancel(job.id);
  throw new Error("Matrix timeout");
}
for (const name of [
  "piano",
  "piano-scan",
  "solo",
  "solo-scan",
  "ensemble",
  "orchestra",
  "orchestra-scan",
  "difficult-piano",
]) {
  const report = { name, passed: false };
  try {
    const doc = await service.prepare(
        path.resolve(`tests/fixtures/pdf/${name}.pdf`),
      ),
      job = await wait(await service.start(doc.id, [1], 0));
    const song = job.results[0].song,
      ref = references.find((r) => r.name === name.replace("-scan", ""));
    await writeFile(
      path.join(root, `${name}-recognized.json`),
      JSON.stringify(song, null, 2),
    );
    const expected = ref.parts
      .flatMap((p) =>
        p.notes.flatMap((chord, i) =>
          (Array.isArray(chord) ? chord : [chord]).map(
            (pitch) =>
              `${pitch + (instrumentTransposition(p.name) ?? 0)}@${i}:1`,
          ),
        ),
      )
      .sort();
    const actual = events(song.tracks.flatMap((t) => t.notes));
    if (
      JSON.stringify(actual) !== JSON.stringify(expected) &&
      ["solo", "orchestra"].includes(name)
    ) {
      assert.ok(
        song.pdf.issues.some((i) => i.severity === "error"),
        "Incorrect score must require review",
      );
      assert.throws(
        () =>
          convertArrangement(song, {
            style: "swing",
            mode: "reduction",
            difficulty: "easy",
            melodyTrackId: "auto",
            chords: [],
          }),
        /prüfen/,
      );
      report.outcome = "review-required";
      report.issues = song.pdf.issues;
      report.passed = true;
      console.log(
        `PASS ${name}: actual OMR error detected, automatic export gated`,
      );
      cases.push(report);
      await writeFile(
        path.join(root, "pdf-matrix-report.json"),
        JSON.stringify(
          { passed: cases.every((c) => c.passed), dataDir, cases },
          null,
          2,
        ),
      );
      continue;
    }
    assert.deepEqual(
      actual,
      expected,
      `${name}: recognized pitches/times differ from engraved ground truth`,
    );
    assert.equal(song.bars.length, 4);
    assert.equal(song.duration.n / song.duration.d, 16);
    assert.equal(
      song.pdf.issues.filter((i) => i.severity === "error").length,
      0,
      `${name}: recognition requires structural correction`,
    );
    const analysis = analyzePiano(song);
    report.kind = analysis.kind;
    report.directlyPlayable = analysis.directlyPlayable;
    report.notes = actual.length;
    report.parts = song.parts.map((p) => p.name);
    report.issues = song.pdf.issues;
    if (name.startsWith("piano")) {
      assert.equal(analysis.directlyPlayable, true);
      assert.equal(analysis.kind, "piano");
    }
    if (name.startsWith("orchestra") || name === "difficult-piano")
      assert.equal(analysis.directlyPlayable, false);
    for (const difficulty of ["easy", "medium"]) {
      const output = convertArrangement(song, {
        style: "swing",
        mode: analysis.directlyPlayable ? "original" : "reduction",
        difficulty,
        melodyTrackId: "auto",
        chords: [],
      });
      if (output.settings.mode === "reduction")
        assert.deepEqual(violations(output.notes, difficulty), []);
      assert.deepEqual(
        exportMidi(output),
        exportMidi(convertArrangement(song, output.settings)),
      );
      await writeFile(
        path.join(root, `${name}-${difficulty}.mid`),
        exportMidi(output),
      );
      await writeFile(
        path.join(root, `${name}-${difficulty}.musicxml`),
        exportMusicXml(output),
      );
    }
    const cached = await service.start(doc.id, [1], 0);
    assert.equal(cached.status, "complete");
    assert.equal(cached.id, job.id);
    await writeFile(
      path.join(root, `${name}-recognized.json`),
      JSON.stringify(song, null, 2),
    );
    report.passed = true;
    console.log(
      `PASS ${name}: ${actual.length} reference notes, ${analysis.directlyPlayable ? "unchanged" : "reduction"}`,
    );
  } catch (e) {
    report.error = e.message;
    console.error(`FAIL ${name}: ${e.message.slice(0, 500)}`);
  }
  cases.push(report);
  await writeFile(
    path.join(root, "pdf-matrix-report.json"),
    JSON.stringify(
      { passed: cases.every((c) => c.passed), dataDir, cases },
      null,
      2,
    ),
  );
}
// Cancellation is persisted and a fresh service sees it; no user files are removed.
const cancelDoc = await service.prepare(
  path.resolve("tests/fixtures/pdf/cover-and-score.pdf"),
);
const cancelling = await service.start(cancelDoc.id, [1, 2], 90);
await service.cancel(cancelling.id);
const restored = new PdfService(
  dataDir,
  path.resolve("resources/omr"),
  async () => {
    throw new Error("Must not commit cancelled recognition");
  },
);
await restored.init();
assert.equal(restored.status(cancelling.id).status, "cancelled");
console.log("PASS cancellation and restart");
service.shutdown();
if (cases.some((c) => !c.passed)) process.exitCode = 1;
