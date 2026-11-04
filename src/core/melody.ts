import type { Note, Track } from "./model";
import { cmp, end, sub, value } from "./time";

export function rankTracks(tracks: Track[]): Track[] {
  return tracks
    .map((track) => {
      track.notes.sort(
        (a, b) =>
          cmp(a.start, b.start) ||
          a.pitch - b.pitch ||
          a.id.localeCompare(b.id, "en"),
      );
      const notes = track.notes;
      const mean =
        notes.reduce((s, n) => s + n.pitch, 0) / Math.max(1, notes.length);
      const overlaps =
        notes.filter((n, i) => i > 0 && cmp(notes[i - 1].start, n.start) === 0)
          .length / Math.max(1, notes.length);
      const named = /melod|vocal|voice|gesang|right|rechte|soprano|lead/i.test(
        track.name,
      )
        ? 30
        : 0;
      return {
        ...track,
        score: mean - overlaps * 45 + named + Math.min(10, notes.length / 10),
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "en"));
}

/** Deterministic upper voice; the user hears and confirms this exact result. */
export function extractMelody(track: Track): Note[] {
  const sorted = [...track.notes].sort(
    (a, b) =>
      cmp(a.start, b.start) ||
      b.pitch - a.pitch ||
      a.id.localeCompare(b.id, "en"),
  );
  const selected = sorted
    .filter((n, i) => i === 0 || cmp(n.start, sorted[i - 1].start) !== 0)
    .map((n) => ({ ...n, melody: true }));
  for (let i = 0; i + 1 < selected.length; i++) {
    if (cmp(end(selected[i]), selected[i + 1].start) > 0)
      selected[i].duration = sub(selected[i + 1].start, selected[i].start);
  }
  return selected.filter((n) => value(n.duration) > 0);
}
