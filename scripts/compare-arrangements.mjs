// Reviewable A/B evidence: old engine from Git, new engine, equal source/settings.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const root = path.resolve("test-results/jazz-quality");
await mkdir(root, { recursive: true });
const oldArrange = execFileSync("git", ["show", "HEAD:src/core/arrange.ts"], {
  encoding: "utf8",
});
const oldHarmony = execFileSync("git", ["show", "HEAD:src/core/harmony.ts"], {
  encoding: "utf8",
});
await build({
  stdin: {
    contents: oldArrange,
    loader: "ts",
    resolveDir: path.resolve("src/core"),
  },
  outfile: path.join(root, "before.cjs"),
  platform: "node",
  format: "cjs",
  bundle: true,
  plugins: [
    {
      name: "previous-harmony",
      setup(b) {
        b.onLoad({ filter: /\/harmony.ts$/ }, () => ({
          contents: oldHarmony,
          loader: "ts",
          resolveDir: path.resolve("src/core"),
        }));
      },
    },
  ],
});
await build({
  stdin: {
    contents: `export {arrange} from './src/core/arrange';export {demoXml} from './src/core/demo';export{importSong}from'./src/core/import';export{beat,barsFor,value,secondsAt}from'./src/core/time';export{exportMidi}from'./src/core/midi';export{chordsFor}from'./src/core/harmony';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: path.join(root, "after.cjs"),
  platform: "node",
  format: "cjs",
  bundle: true,
});
const require = createRequire(import.meta.url),
  before = require(path.join(root, "before.cjs")),
  api = require(path.join(root, "after.cjs"));
const { beat, barsFor, value, secondsAt } = api;
function fixture(name, meter, minor = false, dense = false) {
  const base = api.importSong(api.demoXml(), "demo.musicxml");
  base.id = name;
  base.title = name;
  const duration = beat(((meter[0] * 4) / meter[1]) * 4 * 8, 8),
    meters = [{ at: beat(0), numerator: meter[0], denominator: meter[1] }],
    bars = barsFor(duration, meters);
  const count = dense
    ? Math.floor(value(duration) * 8)
    : Math.floor(value(duration) * 2);
  const notes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    pitch: (minor
      ? [72, 74, 75, 79, 77, 75, 74, 72]
      : [72, 74, 76, 79, 77, 76, 74, 72])[i % 8],
    start: beat(i, dense ? 8 : 2),
    duration: beat(1, dense ? 8 : 2),
    velocity: 88,
    track: "melody",
  }));
  return {
    ...base,
    tracks: [{ id: "melody", name: "Melodie", score: 100, notes }],
    duration,
    meters,
    bars,
    sections: [
      { at: beat(0), name: "A" },
      { at: bars[2].start, name: "B" },
    ],
    chords: bars.map((b, i) => ({
      id: `c${i}`,
      at: b.start,
      duration: b.duration,
      symbol: (minor ? ["Cm", "Fm", "G7", "Cm"] : ["C", "F", "G", "C"])[i],
      source: "provided",
      confidence: 1,
    })),
  };
}
const demo = api.importSong(api.demoXml(), "demo.musicxml");
const songs = [
  demo,
  fixture("Ballade", [4, 4]),
  fixture("Moll", [4, 4], true),
  fixture("Walzer", [3, 4]),
  fixture("Sechsachtel", [6, 8]),
  fixture("Dichte-Melodie", [4, 4], false, true),
];
for (const filename of [
  "anna-magdalena-04.mid",
  "BWV-120.mid",
  "BWV-121.mid",
]) {
  try {
    const song = api.importSong(
      new Uint8Array(await readFile(path.resolve("test-results", filename))),
      filename,
    );
    song.title = filename.includes("120")
      ? "Menuett a-Moll"
      : filename.includes("121")
        ? "Menuett c-Moll"
        : "Menuett G-Dur";
    song.chords = api
      .chordsFor(song, song.tracks[0].id)
      .map((c) => ({ ...c, source: "manual", confidence: 1 }));
    songs.push(song);
  } catch (e) {
    console.warn("Optional catalogue fixture unavailable: " + filename);
  }
}
const report = [],
  tracks = [];
for (const [i, song] of songs.entries()) {
  const settings = {
    style: "swing",
    difficulty: "easy",
    melodyTrackId: song.tracks[0].id,
    chords: song.chords,
  };
  const outputs = [before.arrange(song, settings), api.arrange(song, settings)];
  const summary = { piece: song.title };
  for (const [j, a] of outputs.entries()) {
    const label = j ? "nachher" : "vorher",
      accomp = a.notes.filter((n) => !n.melody);
    summary[label] = {
      accompanimentNotes: accomp.length,
      meanVelocity: accomp.reduce((s, n) => s + n.velocity, 0) / accomp.length,
      melodyPitchClasses: a.notes
        .filter((n) => n.melody)
        .map((n) => n.pitch % 12),
    };
    await writeFile(path.join(root, `${i}-${label}.mid`), api.exportMidi(a));
    tracks.push({
      name: `${i}-${label}`,
      notes: a.notes.map((n) => ({
        ...n,
        start: secondsAt(value(n.start), a.tempos),
        duration:
          secondsAt(value(n.start) + value(n.duration), a.tempos) -
          secondsAt(value(n.start), a.tempos),
      })),
    });
  }
  report.push(summary);
}
await writeFile(
  path.join(root, "comparison.json"),
  JSON.stringify(report, null, 2),
);
const manifest = JSON.parse(
    await readFile("public/piano/manifest.json", "utf8"),
  ),
  bank = [];
for (const key of [
  "A2",
  "C3",
  "Ds3",
  "Fs3",
  "A3",
  "C4",
  "Ds4",
  "Fs4",
  "A4",
  "C5",
  "Ds5",
  "Fs5",
  "A5",
]) {
  const entry = manifest[key];
  if (!entry) continue;
  const wav = path.join(root, `${key}.wav`);
  const ffmpeg =
    process.env.JAZZ_FFMPEG ??
    execFileSync(
      path.resolve("resources/video/dev-env/bin/python"),
      ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],
      { encoding: "utf8" },
    ).trim();
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-i",
    path.resolve("public/piano", entry.file),
    "-ac",
    "1",
    "-ar",
    "22050",
    "-c:a",
    "pcm_s16le",
    "-y",
    wav,
  ]);
  const m = /^(A|C|Ds|Fs)(\d)$/.exec(key);
  bank.push({
    pitch: 12 * (Number(m[2]) + 1) + { A: 9, C: 0, Ds: 3, Fs: 6 }[m[1]],
    wav,
  });
}
await writeFile(
  path.join(root, "listening.json"),
  JSON.stringify({ bank, tracks }),
);
execFileSync(
  "python3",
  ["scripts/render-listening.py", path.join(root, "listening.json")],
  { stdio: "inherit" },
);
console.log(
  JSON.stringify(
    report.map((r) => ({
      piece: r.piece,
      before: r.vorher.accompanimentNotes,
      after: r.nachher.accompanimentNotes,
    })),
    null,
    2,
  ),
);
