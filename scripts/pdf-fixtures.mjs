import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
const dir = "tests/fixtures/pdf";
await mkdir(dir, { recursive: true });
const fontFile = `${dir}/Bravura.otf`;
let bytes;
try {
  bytes = await readFile(fontFile);
} catch {
  const r = await fetch(
    "https://raw.githubusercontent.com/steinbergmedia/bravura/master/redist/otf/Bravura.otf",
  );
  if (!r.ok) throw new Error("Bravura font unavailable");
  bytes = Buffer.from(await r.arrayBuffer());
  await writeFile(fontFile, bytes);
}
const rawFont = fontkit.create(bytes),
  black = rgb(0, 0, 0),
  ref = [];
function glyph(page, code, x, y, size) {
  page.drawSvgPath(rawFont.glyphForCodePoint(code).path.scale(1, -1).toSVG(), {
    x,
    y,
    scale: size / rawFont.unitsPerEm,
    color: black,
  });
}
const melody = [64, 65, 67, 69, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 60];
const cases = [
  {
    name: "piano",
    title: "Piano study",
    parts: [
      { name: "Piano", clef: "G", notes: melody },
      {
        name: "",
        clef: "F",
        notes: Array.from({ length: 16 }, (_, i) => [48, 52, 55, 48][i % 4]),
      },
    ],
    piano: true,
  },
  {
    name: "solo",
    title: "Flute study",
    parts: [{ name: "Flute", clef: "G", notes: melody.map((p) => p + 12) }],
  },
  {
    name: "ensemble",
    title: "Ensemble study",
    parts: [
      { name: "Flute", clef: "G", notes: melody.map((p) => p + 12) },
      {
        name: "Cello",
        clef: "F",
        notes: Array.from({ length: 16 }, (_, i) => [36, 43, 48, 43][i % 4]),
      },
    ],
  },
  {
    name: "orchestra",
    title: "Orchestra study",
    parts: [
      { name: "Flute solo", clef: "G", notes: melody.map((p) => p + 12) },
      { name: "Clarinet in Bb", clef: "G", notes: Array(16).fill(67) },
      { name: "Violin", clef: "G", notes: Array(16).fill(64) },
      { name: "Viola", clef: "G", notes: Array(16).fill(55) },
      {
        name: "Cello",
        clef: "F",
        notes: Array.from({ length: 16 }, (_, i) => [36, 43, 48, 43][i % 4]),
      },
    ],
  },
  {
    name: "difficult-piano",
    title: "Wide piano study",
    parts: [
      { name: "Piano", clef: "G", notes: melody.map((p) => [p, p + 19]) },
      { name: "", clef: "F", notes: Array(16).fill([36, 55]) },
    ],
    piano: true,
  },
];
function spell(p) {
  const names = [
      ["C", 0],
      ["C", 1],
      ["D", 0],
      ["E", -1],
      ["E", 0],
      ["F", 0],
      ["F", 1],
      ["G", 0],
      ["A", -1],
      ["A", 0],
      ["B", -1],
      ["B", 0],
    ],
    [name, alter] = names[p % 12];
  return {
    diatonic: 7 * (Math.floor(p / 12) - 1) + "CDEFGAB".indexOf(name),
    alter,
  };
}
for (const c of cases) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const text = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(c.title);
  pdf.setAuthor("Jazz Converter CC0 fixture");
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const page = pdf.addPage([595, 842]);
  page.drawText(c.title, { x: 80, y: 795, size: 17, font: text });
  page.drawText("Quarter = 100", { x: 80, y: 770, size: 9, font: text });
  const top = 690,
    spacing = 75;
  for (const [pi, part] of c.parts.entries()) {
    const y = top - pi * spacing,
      base = part.clef === "F" ? 7 * 2 + 4 : 7 * 4 + 2;
    if (part.name)
      page.drawText(part.name, { x: 12, y: y + 17, size: 8, font: text });
    for (let line = 0; line < 5; line++)
      page.drawLine({
        start: { x: 80, y: y + line * 5 },
        end: { x: 565, y: y + line * 5 },
        thickness: 0.35,
        color: black,
      });
    glyph(
      page,
      part.clef === "F" ? 0xe062 : 0xe050,
      85,
      y + (part.clef === "F" ? 15 : 5),
      20,
    );
    for (const dy of [5, 15]) glyph(page, 0xe084, 113, y + dy, 20);
    for (let b = 1; b <= 4; b++)
      page.drawLine({
        start: { x: 140 + b * 106, y },
        end: { x: 140 + b * 106, y: y + 20 },
        thickness: b === 4 ? 1.5 : 0.8,
      });
    for (const [i, chord] of part.notes.entries())
      for (const pitch of Array.isArray(chord) ? chord : [chord]) {
        const s = spell(pitch),
          pos = s.diatonic - base,
          x = 153 + i * 26.5,
          ny = y + pos * 2.5;
        for (let ledger = -2; ledger >= pos; ledger -= 2)
          page.drawLine({
            start: { x: x - 3, y: y + ledger * 2.5 },
            end: { x: x + 8, y: y + ledger * 2.5 },
            thickness: 0.5,
          });
        for (let ledger = 10; ledger <= pos; ledger += 2)
          page.drawLine({
            start: { x: x - 3, y: y + ledger * 2.5 },
            end: { x: x + 8, y: y + ledger * 2.5 },
            thickness: 0.5,
          });
        if (s.alter)
          glyph(page, s.alter === 1 ? 0xe262 : 0xe260, x - 8, ny, 20);
        glyph(page, 0xe0a4, x, ny, 20);
        const down = pos >= 4;
        page.drawLine({
          start: { x: x + (down ? 0.25 : 5.65), y: ny },
          end: { x: x + (down ? 0.25 : 5.65), y: ny + (down ? -16.5 : 16.5) },
          thickness: 0.7,
        });
      }
  }
  if (c.parts.length > 1) {
    const low = top - (c.parts.length - 1) * spacing,
      high = top + 20;
    page.drawLine({
      start: { x: 80, y: low },
      end: { x: 80, y: high },
      thickness: 0.8,
    });
    for (let b = 1; b <= 4; b++)
      page.drawLine({
        start: { x: 140 + b * 106, y: low },
        end: { x: 140 + b * 106, y: high },
        thickness: 0.8,
      });
  }
  if (c.piano) {
    const low = top - spacing,
      high = top + 20,
      bbox = rawFont.glyphForCodePoint(0xe000).bbox,
      size = ((high - low) * rawFont.unitsPerEm) / (bbox.maxY - bbox.minY);
    glyph(
      page,
      0xe000,
      76 - (bbox.maxX / rawFont.unitsPerEm) * size,
      low - (bbox.minY / rawFont.unitsPerEm) * size,
      size,
    );
    for (let b = 1; b <= 4; b++)
      page.drawLine({
        start: { x: 140 + b * 106, y: low },
        end: { x: 140 + b * 106, y: high },
        thickness: 0.8,
      });
  }
  const data = await pdf.save({ useObjectStreams: false });
  await writeFile(`${dir}/${c.name}.pdf`, data);
  ref.push(c);
}
// Rasterize the exact same scores to make scan fixtures, not copies with hidden notation data.
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
for (const name of ["piano", "solo", "orchestra"]) {
  const loading = getDocument({
    data: new Uint8Array(await readFile(`${dir}/${name}.pdf`)),
    useSystemFonts: true,
  });
  const doc = await loading.promise,
    page = await doc.getPage(1),
    viewport = page.getViewport({ scale: 300 / 72 });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  await page.render({
    canvas,
    canvasContext: canvas.getContext("2d"),
    viewport,
  }).promise;
  const pdf = await PDFDocument.create(),
    image = await pdf.embedPng(canvas.toBuffer("image/png")),
    out = pdf.addPage([595, 842]);
  out.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  await writeFile(`${dir}/${name}-scan.pdf`, await pdf.save());
  await writeFile(
    `test-results/${name}-fixture.png`,
    canvas.toBuffer("image/png"),
  );
  await loading.destroy();
}
const cover = await PDFDocument.create();
const p = cover.addPage([595, 842]);
p.drawText("A title page without music", { x: 60, y: 700, size: 22 });
const base = await PDFDocument.load(await readFile(`${dir}/piano.pdf`));
for (const sheet of await cover.copyPages(base, [0])) cover.addPage(sheet);
await writeFile(`${dir}/cover-and-score.pdf`, await cover.save());
await writeFile(`${dir}/reference.json`, JSON.stringify(ref, null, 2));
await writeFile(
  `${dir}/README.md`,
  "# PDF fixtures\n\nNewly engraved deterministic test scores by Jazz Converter, CC0 1.0. Pitch arrays in reference.json are the ground truth. Scan PDFs contain only a rendered image of the corresponding score. Bravura font by Steinberg Media Technologies is licensed under SIL OFL 1.1: https://github.com/steinbergmedia/bravura/blob/master/LICENSE.txt.\n",
);
try {
  await readFile(`${dir}/LICENSE-Bravura.txt`);
} catch {
  const license = await fetch(
    "https://raw.githubusercontent.com/steinbergmedia/bravura/master/LICENSE.txt",
  );
  if (!license.ok) throw new Error("Bravura license unavailable");
  await writeFile(`${dir}/LICENSE-Bravura.txt`, await license.text());
}
console.log(
  "Printed, scanned, piano, solo, ensemble, orchestral and cover-page fixtures written.",
);
