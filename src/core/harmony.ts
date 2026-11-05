import type { Beat, Chord, Song, Note } from "./model";
import { extractMelody } from "./melody";
import { add, beat, cmp, end, sub, value } from "./time";
const ROOTS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
  H: 11,
};
export const PITCH_NAMES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
export interface ParsedChord {
  root: number;
  bass: number;
  intervals: number[];
  quality: string;
}
export function parseChord(symbol: string): ParsedChord | undefined {
  const m =
    /^([A-GH])([#b]?)(maj7|m7|m6|m|dim7|dim|ø7|aug|sus4|sus2|7|6)?(?:\/([A-GH])([#b]?))?$/.exec(
      symbol.trim(),
    );
  if (!m) return;
  const pitch = (letter: string, accidental: string) =>
    (ROOTS[letter] +
      (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) +
      12) %
    12;
  const quality = m[3] ?? "";
  const intervals = (
    {
      "": [0, 4, 7],
      m: [0, 3, 7],
      "7": [0, 4, 7, 10],
      maj7: [0, 4, 7, 11],
      m7: [0, 3, 7, 10],
      dim: [0, 3, 6],
      dim7: [0, 3, 6, 9],
      ø7: [0, 3, 6, 10],
      aug: [0, 4, 8],
      sus4: [0, 5, 7],
      sus2: [0, 2, 7],
      "6": [0, 4, 7, 9],
      m6: [0, 3, 7, 9],
    } as Record<string, number[]>
  )[quality];
  const root = pitch(m[1], m[2]);
  return { root, bass: m[4] ? pitch(m[4], m[5]) : root, intervals, quality };
}
export function jazzChord(symbol: string): ParsedChord {
  const parsed = parseChord(symbol);
  if (!parsed)
    throw new Error(
      `Ungültiger Akkord „${symbol}“. Beispiele: C, Am7, G7, Fmaj7, Dm7/G.`,
    );
  return parsed;
}

/** Add colour only with affirmative functional evidence; source symbols remain untouched. */
export function contextualChord(
  symbol: string,
  melody: Note[],
  next?: string,
  confidence = 1,
): ParsedChord {
  const chord = jazzChord(symbol);
  if (chord.quality || confidence < 0.65) return chord;
  const following = next ? parseChord(next) : undefined;
  // Dominant resolving down a fifth: minor seventh. A tonic maj7 needs the
  // seventh already present in the melody; a scale guess is insufficient.
  const extension =
    following && (chord.root + 5) % 12 === following.root
      ? 10
      : melody.some((n) => (n.pitch - chord.root + 120) % 12 === 11)
        ? 11
        : undefined;
  if (extension === undefined) return chord;
  const pc = (chord.root + extension) % 12;
  if (melody.some((n) => [1, 11].includes((n.pitch - pc + 120) % 12)))
    return chord;
  return { ...chord, intervals: [...chord.intervals, extension] };
}

function inferCandidates(
  song: Song,
  trackId: string,
  at: Beat,
  duration: Beat,
  id: string,
): (Chord & { score: number })[] {
  const selected = song.tracks.find((t) => t.id === trackId);
  const melodyIds = new Set(
    selected ? extractMelody(selected).map((n) => n.id) : [],
  );
  const stop = add(at, duration),
    otherTracks = song.tracks
      .filter((t) => t.id !== trackId && !t.percussion && t.channel !== 9)
      .flatMap((t) => t.notes);
  const accompaniment = otherTracks.length
    ? otherTracks
    : (selected?.notes.filter((n) => !melodyIds.has(n.id)) ?? []);
  const notes = (
    accompaniment.length ? accompaniment : song.tracks.flatMap((t) => t.notes)
  ).filter((n) => cmp(n.start, stop) < 0 && cmp(end(n), at) > 0);
  const chroma = Array<number>(12).fill(0);
  let bassPitch = 128,
    bassPc = 0;
  for (const note of notes) {
    const overlap = Math.max(
      0,
      Math.min(value(end(note)), value(stop)) -
        Math.max(value(note.start), value(at)),
    );
    chroma[note.pitch % 12] += overlap * (note.pitch < 60 ? 1.4 : 1);
    if (note.pitch < bassPitch) {
      bassPitch = note.pitch;
      bassPc = note.pitch % 12;
    }
  }
  const sum = chroma.reduce((a, b) => a + b, 0) || 1;
  const candidates = [];
  for (let root = 0; root < 12; root++)
    for (const quality of ["", "m", "dim", "7", "maj7", "m7", "sus4", "6"]) {
      const chord = parseChord(PITCH_NAMES[root] + quality)!;
      const coverage =
        chord.intervals.reduce((s, p) => s + chroma[(root + p) % 12], 0) / sum;
      const present = chord.intervals.filter(
        (p) => chroma[(root + p) % 12] > 0,
      ).length;
      const bass =
        root === bassPc
          ? 0.18
          : chord.intervals.some((p) => (root + p) % 12 === bassPc)
            ? 0.04
            : 0;
      const score = coverage + bass - (chord.intervals.length - present) * 0.12;
      candidates.push({
        symbol: PITCH_NAMES[root] + quality,
        score,
        coverage,
        present,
      });
    }
  candidates.sort(
    (a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol, "en"),
  );
  const best = candidates[0],
    margin = best.score - candidates[1].score;
  const confidence =
    !accompaniment.length || best.present < 2
      ? 0.1
      : Math.min(0.98, best.coverage * 0.45 + Math.max(0, margin) * 2);
  return candidates.slice(0, 5).map((c) => ({
    id,
    at,
    duration,
    symbol: notes.length ? c.symbol : PITCH_NAMES[song.key?.root ?? 0],
    confidence,
    source: "inferred" as const,
    score: c.score,
  }));
}

export function chordsFor(song: Song, trackId: string): Chord[] {
  const boundaries = [
    beat(0),
    song.duration,
    ...song.bars.map((b) => b.start),
    ...song.chords.flatMap((c) => [c.at, add(c.at, c.duration)]),
  ]
    .filter((b) => cmp(b, beat(0)) >= 0 && cmp(b, song.duration) <= 0)
    .sort(cmp)
    .filter((b, i, a) => !i || cmp(b, a[i - 1]) !== 0);
  const choices = boundaries.slice(0, -1).map((at, i) => {
    const duration = sub(boundaries[i + 1], at);
    const provided = song.chords.find(
      (c) => cmp(c.at, at) <= 0 && cmp(add(c.at, c.duration), at) > 0,
    );
    return provided
      ? [{ ...provided, id: `chord-${i}`, at, duration, score: 2 }]
      : inferCandidates(song, trackId, at, duration, `chord-${i}`);
  });
  type Path = { cost: number; chord?: Chord; previous?: Path };
  let paths: Path[] = [{ cost: 0 }];
  for (const options of choices)
    paths = options.map(
      (c) =>
        paths
          .map((p) => {
            const r = parseChord(c.symbol)!.root,
              prev = p.chord && parseChord(p.chord.symbol)!.root;
            const transition =
              prev === undefined || prev === r
                ? 0
                : (prev + 5) % 12 === r
                  ? 0.015
                  : 0.06;
            return {
              cost: p.cost - c.score + transition,
              chord: c,
              previous: p,
            };
          })
          .sort((a, b) => a.cost - b.cost)[0],
    );
  const result: Chord[] = [];
  let cursor: Path | undefined = paths.sort((a, b) => a.cost - b.cost)[0];
  while (cursor?.chord) {
    const { score: _, ...c } = cursor.chord as Chord & { score: number };
    result.push(c);
    cursor = cursor.previous;
  }
  return result.reverse();
}
