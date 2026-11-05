import { describe, test, expect } from "vitest";
import { arrange } from "../src/core/arrange";
import { contextualChord, jazzChord, chordsFor } from "../src/core/harmony";
import { beat, barsFor, value } from "../src/core/time";
import type { Song, Settings, Note } from "../src/core/model";
export function musicalFixture(
  name: string,
  meter = [4, 4],
  dense = false,
): Song {
  const duration = beat(((meter[0] * 4) / meter[1]) * 4 * 8, 8),
    meters = [{ at: beat(0), numerator: meter[0], denominator: meter[1] }];
  const melody: Note[] = Array.from({ length: dense ? 96 : 16 }, (_, i) => ({
    id: `m${i}`,
    pitch: [72, 74, 76, 79][i % 4],
    start: beat(i * duration.n, duration.d * (dense ? 96 : 16)),
    duration: beat(dense ? 1 : 2, dense ? 8 : 4),
    velocity: 85,
    track: "melody",
  }));
  const song: Song = {
    id: name,
    title: name,
    artist: "Test",
    format: "fixture",
    tracks: [{ id: "melody", name: "Melodie", score: 100, notes: melody }],
    tempos: [{ at: beat(0), bpm: 120 }],
    meters,
    bars: barsFor(duration, meters),
    duration,
    sections: [],
    warnings: [],
    chords: [],
  };
  song.chords = song.bars.map((b, i) => ({
    id: `c${i}`,
    at: b.start,
    duration: b.duration,
    symbol: ["C", "F", "G", "C"][i % 4],
    source: "provided",
    confidence: 1,
  }));
  return song;
}
const settings = (
  s: Song,
  intensity: Settings["intensity"] = "gentle",
): Settings => ({
  style: "swing",
  difficulty: "easy",
  intensity,
  melodyTrackId: "melody",
  chords: s.chords,
});
describe("Musikalische Regression", () => {
  test("no unconditional sevenths; dominant colour obeys melody", () => {
    expect(jazzChord("C").intervals).toEqual([0, 4, 7]);
    expect(jazzChord("Am").intervals).toEqual([0, 3, 7]);
    expect(contextualChord("G", [], "C").intervals).toContain(10);
    expect(
      contextualChord("G", [{ pitch: 78 } as Note], "C").intervals,
    ).not.toContain(10);
    expect(contextualChord("G", [], "C", 0.3).intervals).toEqual([0, 4, 7]);
  });
  for (const [name, meter] of [
    ["Ballade", [4, 4]],
    ["Walzer", [3, 4]],
    ["Wiegenlied", [6, 8]],
  ] as const)
    test(`${name}: melody, dynamics, exact source chords and determinism`, () => {
      const s = musicalFixture(name, [...meter]);
      const a = arrange(s, settings(s));
      expect(a).toEqual(arrange(s, settings(s)));
      expect(
        a.notes.filter((n) => n.melody).map((n) => [n.pitch, n.velocity]),
      ).toEqual(s.tracks[0].notes.map((n) => [n.pitch, n.velocity]));
      expect(
        a.notes.filter((n) => !n.melody).every((n) => n.velocity < 85),
      ).toBe(true);
      expect(chordsFor(s, "melody").map((c) => c.symbol)).toEqual(
        s.chords.map((c) => c.symbol),
      );
    });
  test("dense melody suppresses comping; intensity governs bass independently", () => {
    const s = musicalFixture("dense", [4, 4], true),
      a = arrange(s, settings(s));
    expect(a.notes.filter((n) => !n.melody && n.hand === "right")).toHaveLength(
      0,
    );
    const sparse = musicalFixture("sparse");
    expect(
      arrange(sparse, settings(sparse, "lively")).notes.filter((n) => !n.melody)
        .length,
    ).toBeGreaterThan(
      arrange(sparse, settings(sparse)).notes.filter((n) => !n.melody).length,
    );
  });
  test("minor and altered fifths are retained in the bass harmony", () => {
    const s = musicalFixture("minor");
    s.chords = s.chords.map((c) => ({ ...c, symbol: "Bdim" }));
    const a = arrange(s, settings(s));
    expect(
      a.notes
        .filter((n) => !n.melody)
        .every((n) => [11, 2, 5].includes(n.pitch % 12)),
    ).toBe(true);
  });
});
