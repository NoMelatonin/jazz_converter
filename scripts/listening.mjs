import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const root = path.resolve("test-results");
await mkdir(path.join(root, "pcm"), { recursive: true });
await mkdir("public/demo", { recursive: true });
await build({
  stdin: {
    contents: `export { demoMidi, demoXml } from './src/core/demo'; export { importSong } from './src/core/import'; export { arrange } from './src/core/arrange'; export { chordsFor } from './src/core/harmony'; export { exportMidi } from './src/core/midi'; export { secondsAt, value } from './src/core/time';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  outfile: path.join(root, "listening.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
});
const {
  demoMidi,
  demoXml,
  importSong,
  arrange,
  chordsFor,
  exportMidi,
  secondsAt,
  value,
} = createRequire(import.meta.url)(path.join(root, "listening.cjs"));
await writeFile("public/demo/Bruder Jakob.mid", demoMidi());
await writeFile("public/demo/Bruder Jakob.musicxml", demoXml());
await writeFile(
  "public/demo/LICENSE.txt",
  "Bruder Jakob — traditionelle Melodie.\nDiese neue Dateifassung und die einfache Ausgangsbegleitung wurden für Jazz Converter erstellt und unter CC0 1.0 freigegeben.\nhttps://creativecommons.org/publicdomain/zero/1.0/\n",
);
const original = importSong(demoMidi(), "demo.mid"),
  song = importSong(demoXml(), "demo.musicxml");
const tracks = [
  {
    name: "Original",
    notes: original.tracks.flatMap((t) => t.notes),
    tempos: original.tempos,
  },
];
for (const difficulty of ["easy", "medium"]) {
  const a = arrange(song, {
    style: "swing",
    difficulty,
    melodyTrackId: song.tracks[0].id,
    chords: chordsFor(song, song.tracks[0].id),
  });
  const name = difficulty === "easy" ? "Swing-Einfach" : "Swing-Mittel";
  await writeFile(path.join(root, `${name}.mid`), exportMidi(a));
  tracks.push({ name, notes: a.notes, tempos: a.tempos });
}
const manifest = JSON.parse(
  await readFile("public/piano/manifest.json", "utf8"),
);
const bank = [];
for (const [name, entry] of Object.entries(manifest)) {
  const wav = path.join(root, "pcm", `${name}.wav`);
  execFileSync("/usr/bin/afconvert", [
    "-f",
    "WAVE",
    "-d",
    "LEI16@22050",
    path.resolve("public/piano", entry.file),
    wav,
  ]);
  const m = /^(A|C|Ds|Fs)(\d)$/.exec(name),
    pitch = 12 * (Number(m[2]) + 1) + { A: 9, C: 0, Ds: 3, Fs: 6 }[m[1]];
  bank.push({ pitch, wav });
}
await writeFile(
  path.join(root, "listening.json"),
  JSON.stringify({
    bank: bank.sort((a, b) => a.pitch - b.pitch),
    tracks: tracks.map((t) => ({
      name: t.name,
      notes: t.notes.map((n) => ({
        pitch: n.pitch,
        velocity: n.velocity,
        start: secondsAt(value(n.start), t.tempos),
        duration:
          secondsAt(value(n.start) + value(n.duration), t.tempos) -
          secondsAt(value(n.start), t.tempos),
      })),
    })),
  }),
);
execFileSync(
  "python3",
  ["scripts/render-listening.py", path.join(root, "listening.json")],
  { stdio: "inherit" },
);
