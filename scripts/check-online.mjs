import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const out = path.resolve("test-results");
await mkdir(out, { recursive: true });
await build({
  stdin: {
    contents: `export { ONLINE_CATALOGUE } from './src/core/catalogue'; export { importSong } from './src/core/import'; export { arrange } from './src/core/arrange'; export { chordsFor } from './src/core/harmony';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: path.join(out, "online-check.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { ONLINE_CATALOGUE, importSong, arrange, chordsFor } = createRequire(
  import.meta.url,
)(path.join(out, "online-check.cjs"));
const report = [];
for (const entry of ONLINE_CATALOGUE) {
  const response = await fetch(entry.url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${entry.title}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const song = importSong(bytes, entry.filename);
  const chords = chordsFor(song, song.tracks[0].id).map((c) => ({
    ...c,
    source: "manual",
    confidence: 1,
  }));
  for (const difficulty of ["easy", "medium"]) {
    const a = arrange(song, {
      style: "swing",
      difficulty,
      melodyTrackId: song.tracks[0].id,
      chords,
    });
    console.log(
      `PASS ${entry.title} (${difficulty}): ${song.bars.length} Takte, ${a.notes.length} Noten`,
    );
  }
  await writeFile(path.join(out, entry.filename), bytes);
  report.push({
    id: entry.id,
    url: entry.url,
    licenseUrl: entry.licenseUrl,
    bytes: bytes.length,
    bars: song.bars.length,
    tracks: song.tracks.length,
  });
}
await writeFile(
  path.join(out, "online-report.json"),
  JSON.stringify(report, null, 2),
);
