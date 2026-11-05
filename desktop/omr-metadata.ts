import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { Song } from "../src/core/model";
import { beat } from "../src/core/time";
import { instrumentTransposition } from "../src/core/instruments";
const list = (value: any): any[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const generic = (name: string) =>
  !name || /^(?:Voice|Part\s*\d*|Instrument\s*\d*|P\d+)$/i.test(name);
const instruments =
  /piano|klavier|keyboard|flute|flöte|clarinet|klarinette|violin|violine|violoncello|cello|viola|bratsche|bass|horn|tromp|trump|oboe|fagott|bassoon|sax|voice|sopran|tenor|alto|tuba|harp|harfe|guitar|gitarre/i;
/** Recover instrument labels the OMR exporter sometimes leaves as generic Voice. */
export async function enrichOmrMetadata(
  song: Song,
  folder: string,
  selectedSheets: number[],
) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
  });
  const labels = new Map<string, string>();
  for (const filename of (await readdir(folder)).filter((f) =>
    f.endsWith(".omr"),
  )) {
    const files = unzipSync(await readFile(path.join(folder, filename)), {
      filter: (f) =>
        (f.name === "book.xml" || /sheet#\d+\.xml$/.test(f.name)) &&
        f.originalSize < 32 * 1024 * 1024,
    });
    const book = files["book.xml"]
      ? parser.parse(strFromU8(files["book.xml"])).book
      : undefined;
    for (const [name, bytes] of Object.entries(files)) {
      const match = /sheet#(\d+)\.xml$/.exec(name);
      if (!match) continue;
      const sheetNumber = Number(match[1]);
      if (selectedSheets.length && !selectedSheets.includes(sheetNumber))
        continue;
      const sheet = parser.parse(strFromU8(bytes)).sheet,
        bookSheet = list(book?.sheet).find(
          (s) => Number(s.number) === sheetNumber,
        );
      const interline = Number(sheet.scale?.interline?.main ?? 20);
      for (const [pageIndex, page] of list(sheet.page).entries())
        for (const [systemIndex, system] of list(page.system).entries()) {
          const mapping = list(list(bookSheet?.page)[pageIndex]?.system)[
            systemIndex
          ];
          const words = list(system.sig?.inters?.word);
          for (const [partIndex, part] of list(system.part).entries()) {
            const logical =
                list(mapping?.part)[partIndex]?.["logical-id"] ?? part.id,
              partId = `P${logical}`;
            if (labels.has(partId) || !song.parts?.some((p) => p.id === partId))
              continue;
            const staff = list(part.staff)[0];
            if (!staff) continue;
            const points = list(list(staff.lines?.line)[0]?.point),
              top = Number(points[0]?.y ?? 0),
              bottom = top + 4 * interline,
              left = Number(staff.left);
            const near = words
              .filter((w) => {
                const b = w.bounds;
                return (
                  b &&
                  Number(b.x) + Number(b.w) < left - interline * 0.2 &&
                  Number(b.y) + Number(b.h) > top - 2 * interline &&
                  Number(b.y) < bottom + interline &&
                  Number(w["ctx-grade"] ?? w.grade ?? 0) >= 0.5
                );
              })
              .sort((a, b) => Number(a.bounds.x) - Number(b.bounds.x));
            if (!near.some((w) => instruments.test(String(w.value)))) continue;
            const label = near
              .map((w) => String(w.value))
              .join(" ")
              .trim();
            if (label.length < 160) labels.set(partId, label);
          }
        }
    }
  }
  for (const part of song.parts ?? []) {
    const label = labels.get(part.id);
    if (!label || !generic(part.name)) continue;
    part.name = label;
    part.instrument = label;
    const transposition = instrumentTransposition(label);
    if (transposition !== undefined && !part.transpositions.length) {
      part.transpositions = [{ at: beat(0), semitones: transposition }];
      for (const track of song.tracks)
        for (const n of track.notes)
          if (n.partId === part.id)
            n.pitch = (n.writtenPitch ?? n.pitch) + transposition;
    }
    for (const track of song.tracks)
      if (track.partId === part.id) {
        track.name = `${label} · Stimme ${track.notes[0]?.voice ?? 1}`;
        track.instrument = label;
      }
  }
  // A labelled piano staff plus its unnamed bass-clef companion form one grand staff.
  for (let i = 0; i < (song.parts?.length ?? 0) - 1; i++) {
    const upper = song.parts![i],
      lower = song.parts![i + 1];
    if (
      !/piano|klavier/i.test(upper.name) ||
      upper.staves !== 1 ||
      !generic(lower.name) ||
      lower.clefs?.[0]?.sign !== "F"
    )
      continue;
    upper.staves = 2;
    upper.program = 0;
    upper.clefs = [
      ...(upper.clefs ?? [{ staff: 1, sign: "G", line: 2 }]),
      { staff: 2, sign: "F", line: 4 },
    ];
    for (const track of song.tracks)
      if (track.partId === lower.id) {
        track.partId = upper.id;
        track.staff = 2;
        track.name = `${upper.name} · Linkes System · Stimme ${track.notes[0]?.voice ?? 1}`;
        for (const n of track.notes) {
          n.partId = upper.id;
          n.staff = 2;
        }
      }
    for (const rest of song.rests ?? [])
      if (rest.partId === lower.id) {
        rest.partId = upper.id;
        rest.staff = 2;
      }
    song.parts!.splice(i + 1, 1);
  }
  return song;
}
