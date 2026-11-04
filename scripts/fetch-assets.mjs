import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../public/piano/", import.meta.url);
await mkdir(root, { recursive: true });
const notes = [
  "A0",
  ...Array.from({ length: 7 }, (_, i) => [
    `C${i + 1}`,
    `Ds${i + 1}`,
    `Fs${i + 1}`,
    `A${i + 1}`,
  ]).flat(),
  "C8",
];
const manifest = {};
for (const note of notes) {
  const file = new URL(`${note}.mp3`, root);
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    const response = await fetch(
      `https://tonejs.github.io/audio/salamander/${note}.mp3`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error(`${note}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(file, bytes);
  }
  manifest[note] = {
    file: `${note}.mp3`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
  console.log(`${note}: ${bytes.length} bytes`);
}
await writeFile(
  new URL("manifest.json", root),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  new URL("LICENSE.txt", root),
  `Salamander Grand Piano V3\nRecorded by Alexander Holm (Yamaha C5 acoustic grand piano).\nLicense: Creative Commons Attribution 3.0 Unported (CC BY 3.0)\nhttps://creativecommons.org/licenses/by/3.0/\nhttps://github.com/sfzinstruments/SalamanderGrandPiano\nMP3 distribution: https://github.com/Tonejs/audio/tree/master/salamander\nBundled MP3 files are unchanged. The player repitches recordings to nearby notes and applies gain and release envelopes.\nNo endorsement by the author is implied.\n`,
);
// This upstream package omits its license file from its npm tarball.
const noticeDir = new URL("../public/licenses/", import.meta.url);
await mkdir(noticeDir, { recursive: true });
const licenseResponse = await fetch(
  "https://raw.githubusercontent.com/nodable/val-parsers/main/LICENSE",
  { signal: AbortSignal.timeout(20000) },
);
if (!licenseResponse.ok) throw new Error("Nodable license unavailable");
await writeFile(
  new URL("_nodable_entities-upstream.txt", noticeDir),
  await licenseResponse.text(),
);
