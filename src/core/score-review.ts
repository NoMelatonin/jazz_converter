import { z } from "zod";
import type { Song, Beat } from "./model";
import { add, beat, cmp, end, sub, value } from "./time";
const rational = z.object({
  n: z.number().int().nonnegative().max(1000000000),
  d: z.number().int().positive().max(1000000),
});
const source = z
  .object({
    page: z.number().int().positive().optional(),
    measure: z.number().int().positive(),
    partId: z.string().max(200).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .optional();
const note = z.object({
  id: z.string().min(1).max(256),
  pitch: z.number().int().min(0).max(127),
  start: rational,
  duration: rational,
  velocity: z.number().int().min(1).max(127),
  track: z.string().min(1).max(200),
  partId: z.string().max(200).optional(),
  staff: z.number().int().min(1).max(20).optional(),
  voice: z.string().max(100).optional(),
  writtenPitch: z.number().int().min(-48).max(175).optional(),
  source,
  hand: z.enum(["left", "right"]).optional(),
  melody: z.boolean().optional(),
  recognition: z
    .object({
      score: z.number().min(0).max(1),
      method: z.enum(["visual", "audio"]),
    })
    .optional(),
  sourceIds: z.array(z.string().max(256)).max(200).optional(),
});
const rest = z.object({
  id: z.string().min(1).max(256),
  start: rational,
  duration: rational,
  track: z.string().min(1).max(200),
  partId: z.string().max(200).optional(),
  staff: z.number().int().min(1).max(20).optional(),
  voice: z.string().max(100).optional(),
  source,
});
const scoreSchema = z.object({
  chords: z
    .array(
      z.object({
        id: z.string().max(256),
        at: rational,
        duration: rational,
        symbol: z.string().max(50),
        confidence: z.number().min(0).max(1),
        source: z.enum(["provided", "inferred", "manual"]),
      }),
    )
    .max(20000),
  tracks: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().max(300),
        notes: z.array(note).max(200000),
        score: z.number(),
        channel: z.number().int().min(0).max(15).optional(),
        partId: z.string().max(200).optional(),
        staff: z.number().int().min(1).max(20).optional(),
        instrument: z.string().max(300).optional(),
        program: z.number().int().min(0).max(127).optional(),
        percussion: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(1000),
  rests: z.array(rest).max(200000).optional(),
  bars: z
    .array(
      z.object({
        number: z.number().int().positive(),
        start: rational,
        duration: rational,
        numerator: z.number().int().min(1).max(64),
        denominator: z.number().int().min(1).max(128),
      }),
    )
    .min(1)
    .max(20000),
  parts: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().max(300),
        instrument: z.string().max(300).optional(),
        program: z.number().int().min(0).max(127).optional(),
        percussion: z.boolean().optional(),
        staves: z.number().int().min(1).max(20),
        transpositions: z
          .array(
            z.object({
              at: rational,
              semitones: z.number().int().min(-48).max(48),
            }),
          )
          .max(20000),
        clefs: z
          .array(
            z.object({
              staff: z.number().int().positive().max(20),
              sign: z.string().max(20),
              line: z.number().int().min(0).max(5),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .max(500)
    .optional(),
  tempos: z
    .array(z.object({ at: rational, bpm: z.number().min(10).max(1000) }))
    .min(1)
    .max(20000),
  meters: z
    .array(
      z.object({
        at: rational,
        numerator: z.number().int().positive().max(64),
        denominator: z.number().int().positive().max(128),
      }),
    )
    .min(1)
    .max(20000),
  sections: z
    .array(z.object({ at: rational, name: z.string().max(300) }))
    .max(20000),
  duration: rational,
});
export function validateScore(
  input: unknown,
  original: Song,
): Pick<
  Song,
  | "tracks"
  | "rests"
  | "bars"
  | "parts"
  | "tempos"
  | "meters"
  | "sections"
  | "duration"
  | "chords"
> {
  const score = scoreSchema.parse(input);
  let cursor = beat(0);
  for (const [i, bar] of score.bars.entries()) {
    if (
      bar.number !== i + 1 ||
      cmp(cursor, bar.start) !== 0 ||
      value(bar.duration) <= 0 ||
      !Number.isInteger(Math.log2(bar.denominator))
    )
      throw new Error(
        "Die Taktfolge ist nicht lückenlos oder hat ein ungültiges Taktmaß.",
      );
    cursor = add(cursor, bar.duration);
  }
  if (cmp(cursor, score.duration) !== 0)
    throw new Error("Taktfolge und Songlänge stimmen nicht überein.");
  const ids = new Set<string>(),
    trackIds = new Set(score.tracks.map((t) => t.id));
  let count = 0;
  if (trackIds.size !== score.tracks.length)
    throw new Error("Stimmen-IDs müssen eindeutig sein.");
  const parts = new Map(score.parts?.map((p) => [p.id, p]) ?? []);
  if (parts.size !== (score.parts?.length ?? 0))
    throw new Error("Instrumenten-IDs müssen eindeutig sein.");
  const checkEvent = (n: {
    id: string;
    track: string;
    partId?: string;
    staff?: number;
    duration: Beat;
    start: Beat;
  }) => {
    const part = n.partId ? parts.get(n.partId) : undefined;
    if (
      ids.has(n.id) ||
      !trackIds.has(n.track) ||
      value(n.duration) <= 0 ||
      cmp(end(n), score.duration) > 0 ||
      (n.partId && !part) ||
      (part && (n.staff ?? 1) > part.staves)
    )
      throw new Error(
        "Eine Note oder Pause ist doppelt, ungültig oder reicht über das Stückende. Bitte Notenwert, Stimme und Taktposition prüfen.",
      );
    ids.add(n.id);
  };
  for (const track of score.tracks)
    for (const n of track.notes) {
      if (n.track !== track.id)
        throw new Error("Die Stimme einer Note ist ungültig.");
      checkEvent(n);
      count++;
    }
  if (!count || count > 200000)
    throw new Error(
      "Bitte mindestens eine Note und höchstens 200.000 Noten übernehmen.",
    );
  for (const r of score.rests ?? []) checkEvent(r);
  if (
    score.tempos.some((t, i) => i && cmp(t.at, score.tempos[i - 1].at) < 0) ||
    value(score.tempos[0].at) !== 0
  )
    throw new Error(
      "Die Tempofolge muss bei Stückbeginn anfangen und zeitlich sortiert sein.",
    );
  return score;
}
export function changePartTransposition(
  song: Song,
  partId: string,
  semitones: number,
): Song {
  if (!Number.isInteger(semitones) || Math.abs(semitones) > 48)
    throw new Error("Ungültige Instrumententransposition.");
  return {
    ...song,
    parts: song.parts?.map((p) =>
      p.id === partId
        ? { ...p, transpositions: [{ at: beat(0), semitones }] }
        : p,
    ),
    tracks: song.tracks.map((t) => ({
      ...t,
      notes: t.notes.map((n) =>
        n.partId === partId
          ? { ...n, pitch: (n.writtenPitch ?? n.pitch) + semitones }
          : n,
      ),
    })),
  };
}
export function changeMeter(
  song: Song,
  index: number,
  numerator: number,
  denominator: number,
): Song {
  if (
    !Number.isInteger(numerator) ||
    numerator < 1 ||
    numerator > 64 ||
    ![1, 2, 4, 8, 16, 32, 64, 128].includes(denominator)
  )
    throw new Error("Ungültiges Taktmaß.");
  const old = song.bars[index],
    duration = beat(numerator * 4, denominator),
    delta = sub(duration, old.duration),
    boundary = add(old.start, old.duration);
  const shift = (position: Beat) =>
    cmp(position, boundary) >= 0 ? add(position, delta) : position;
  return {
    ...song,
    duration: add(song.duration, delta),
    chords: song.chords.map((c) => ({
      ...c,
      at: shift(c.at),
      duration: sub(shift(add(c.at, c.duration)), shift(c.at)),
    })),
    parts: song.parts?.map((p) => ({
      ...p,
      transpositions: p.transpositions.map((t) => ({ ...t, at: shift(t.at) })),
    })),
    bars: song.bars.map((b, i) =>
      i === index
        ? { ...b, numerator, denominator, duration }
        : { ...b, start: shift(b.start) },
    ),
    tracks: song.tracks.map((t) => ({
      ...t,
      notes: t.notes.map((n) => ({ ...n, start: shift(n.start) })),
    })),
    rests: song.rests?.map((r) => ({ ...r, start: shift(r.start) })),
    tempos: song.tempos.map((t) => ({ ...t, at: shift(t.at) })),
    sections: song.sections.map((s) => ({ ...s, at: shift(s.at) })),
    meters: song.bars.map((b, i) => ({
      at: shift(b.start),
      numerator: i === index ? numerator : b.numerator,
      denominator: i === index ? denominator : b.denominator,
    })),
  };
}
export function parsePages(text: string, total: number): number[] {
  const result = new Set<number>();
  for (const token of text
    .trim()
    .split(/[;,\s]+/)
    .filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) throw new Error("Seiten bitte als 1-3, 5 angeben.");
    const start = Number(match[1]),
      stop = Number(match[2] ?? match[1]);
    if (start < 1 || stop < start || stop > total || stop - start >= 200)
      throw new Error("Der Seitenbereich ist ungültig oder zu groß.");
    for (let p = start; p <= stop; p++) result.add(p);
  }
  if (!result.size || result.size > 200)
    throw new Error("Bitte 1 bis 200 Seiten auswählen.");
  return [...result].sort((a, b) => a - b);
}
