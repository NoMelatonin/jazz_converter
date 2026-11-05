import { describe, expect, test } from "vitest";
import { importXml } from "../src/core/import-xml";
import { demoXml } from "../src/core/demo";
import { assignHands, analyzePiano, canonicalNotes } from "../src/core/piano";
import { convertArrangement } from "../src/core/convert";
import { exportMusicXml } from "../src/core/musicxml";
import { exportMidi } from "../src/core/midi";
import { violations } from "../src/core/arrange";
import { beat, value } from "../src/core/time";
import {
  changePartTransposition,
  parsePages,
  validateScore,
} from "../src/core/score-review";
import type { Note, Settings, Song } from "../src/core/model";
const n = (
  id: string,
  pitch: number,
  at = 0,
  duration = 1,
  track = "melody",
): Note => ({
  id,
  pitch,
  start: beat(at),
  duration: beat(duration),
  track,
  velocity: 90,
});
function score(tracks: { id: string; name: string; notes: Note[] }[]): Song {
  return {
    id: "test",
    title: "Test",
    artist: "Traditionell",
    format: "MusicXML",
    tracks: tracks.map((t) => ({ ...t, score: 0 })),
    tempos: [{ at: beat(0), bpm: 100 }],
    meters: [{ at: beat(0), numerator: 4, denominator: 4 }],
    bars: [
      {
        number: 1,
        start: beat(0),
        duration: beat(4),
        numerator: 4,
        denominator: 4,
      },
      {
        number: 2,
        start: beat(4),
        duration: beat(4),
        numerator: 4,
        denominator: 4,
      },
    ],
    duration: beat(8),
    chords: [],
    sections: [],
    warnings: [],
  };
}
const settings = (
  mode: Settings["mode"],
  difficulty: Settings["difficulty"] = "easy",
): Settings => ({
  style: "swing",
  mode,
  difficulty,
  melodyTrackId: "auto",
  chords: [],
});
describe("Unveränderte Klavierzuordnung und Reduktion", () => {
  test("preserves every pitch and time when an eight-note chord fits two hands", () => {
    const notes = [48, 52, 55, 60, 64, 67, 71, 76].map((p, i) =>
      n(String(i), p, 0, 4),
    );
    const assigned = assignHands(notes)!;
    expect(assigned).not.toBeNull();
    for (const hand of ["left", "right"]) {
      const p = assigned.filter((n) => n.hand === hand).map((n) => n.pitch);
      expect(p.length).toBeLessThanOrEqual(5);
      expect(Math.max(...p) - Math.min(...p)).toBeLessThanOrEqual(12);
    }
    expect(assigned.map(({ hand, sourceIds, ...x }) => x)).toEqual(notes);
  });
  test("held notes constrain later attacks; density and keyboard limits are real failures", () => {
    expect(
      assignHands(Array.from({ length: 11 }, (_, i) => n(String(i), 48 + i))),
    ).toBeNull();
    expect(assignHands([n("a", 20)])).toBeNull();
    expect(
      assignHands([n("a", 21, 0, 4), n("b", 60, 0, 4), n("c", 100, 1, 1)]),
    ).toBeNull();
    expect(assignHands([n("a", 60, 0, 4), n("b", 60, 1, 1)])).toBeNull();
  });
  test("exact unison doublings are coalesced with their full provenance", () => {
    const notes = canonicalNotes([n("flute", 72), n("violin", 72)]);
    expect(notes).toHaveLength(1);
    expect(notes[0].sourceIds).toEqual(["flute", "violin"]);
  });
  test("source piano is not simplified to the Swing difficulty limits", () => {
    const song = score([
      {
        id: "piano",
        name: "Klavier",
        notes: [
          n("a", 60, 0, 2, "piano"),
          n("b", 72, 0, 2, "piano"),
          n("c", 64, 0, 2, "piano"),
          n("d", 67, 0, 2, "piano"),
        ],
      },
    ]);
    expect(analyzePiano(song).directlyPlayable).toBe(true);
    const a = convertArrangement(song, settings("original"));
    expect(a.notes.map((n) => n.pitch).sort()).toEqual([60, 64, 67, 72]);
    expect(a.notes.every((n) => value(n.duration) === 2)).toBe(true);
  });
  test("orchestral reduction follows a melody passing between instruments and obeys both levels", () => {
    const song = score([
      {
        id: "flute",
        name: "Solo Flöte",
        notes: [n("f1", 76, 0, 1, "flute"), n("f2", 77, 1, 1, "flute")],
      },
      {
        id: "violin",
        name: "Solo Violine",
        notes: [n("v1", 79, 4, 1, "violin"), n("v2", 81, 5, 1, "violin")],
      },
      {
        id: "bass",
        name: "Kontrabass",
        notes: [n("b1", 24, 0, 4, "bass"), n("b2", 31, 4, 4, "bass")],
      },
      {
        id: "harmony",
        name: "Begleitung",
        notes: [36, 48, 60, 64, 67, 72, 84, 96].map((p, i) =>
          n(`h${i}`, p, 0, 8, "harmony"),
        ),
      },
    ]);
    expect(analyzePiano(song).directlyPlayable).toBe(false);
    for (const level of ["easy", "medium"] as const) {
      const a = convertArrangement(song, settings("reduction", level));
      expect(violations(a.notes, level)).toEqual([]);
      expect(a.notes.filter((n) => n.melody).map((n) => n.pitch % 12)).toEqual([
        4, 5, 7, 9,
      ]);
      expect(a.notes.some((n) => n.hand === "left")).toBe(true);
      expect(exportMidi(a)).toEqual(
        exportMidi(convertArrangement(song, settings("reduction", level))),
      );
    }
  });
  test("structural recognition problems gate the automatic result", () => {
    const song = importXml(demoXml(), "demo.musicxml");
    song.issues = [
      { id: "bad", kind: "recognition", severity: "error", message: "Unklar" },
    ];
    expect(() => convertArrangement(song, settings("original"))).toThrow(
      /prüfen/,
    );
  });
});
describe("Instrumente, Korrekturen und MusicXML", () => {
  test("source MusicXML retains bass clefs and corrected rests", () => {
    const xml =
      '<score-partwise><part-list><score-part id="B"><part-name>Cello</part-name></score-part></part-list><part id="B"><measure number="1"><attributes><divisions>2</divisions><clef><sign>F</sign><line>4</line></clef><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>1</duration><voice>1</voice></note><note><pitch><step>C</step><octave>3</octave></pitch><duration>7</duration><voice>1</voice></note></measure></part></score-partwise>';
    const song = importXml(new TextEncoder().encode(xml), "bass.musicxml"),
      out = exportMusicXml(song),
      reopened = importXml(new TextEncoder().encode(out), "again.musicxml");
    expect(out).toContain("<sign>F</sign><line>4</line>");
    expect(
      reopened.rests?.map((r) => [value(r.start), value(r.duration)]),
    ).toEqual([[0, 0.5]]);
    expect(
      reopened.tracks
        .flatMap((t) => t.notes)
        .map((n) => [n.pitch, value(n.start), value(n.duration)]),
    ).toEqual([[48, 0.5, 3.5]]);
  });
  test("transposing instruments produce sounding pitches and source export roundtrips them", () => {
    const xml =
      '<score-partwise><part-list><score-part id="C"><part-name>Clarinet in Bb</part-name></score-part></part-list><part id="C"><measure number="1"><attributes><divisions>1</divisions><transpose><chromatic>-2</chromatic></transpose><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note></measure></part></score-partwise>';
    const s = importXml(new TextEncoder().encode(xml), "clarinet.musicxml");
    expect(s.tracks[0].notes[0].pitch).toBe(62);
    expect(s.tracks[0].notes[0].writtenPitch).toBe(64);
    expect(s.parts![0].transpositions[0].semitones).toBe(-2);
    const reopened = importXml(
      new TextEncoder().encode(exportMusicXml(s)),
      "again.musicxml",
    );
    expect(reopened.tracks[0].notes[0].pitch).toBe(62);
    expect(changePartTransposition(s, "C", -7).tracks[0].notes[0].pitch).toBe(
      57,
    );
  });
  test("Audiveris shared divisions do not stretch a second instrument by a factor of 24", () => {
    const xml =
      '<score-partwise><part-list/><part id="P1"><measure><attributes><divisions>24</divisions></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>96</duration></note></measure></part><part id="P2"><measure><note><pitch><step>C</step><octave>3</octave></pitch><duration>96</duration></note></measure></part></score-partwise>';
    const s = importXml(new TextEncoder().encode(xml), "shared.musicxml");
    expect(value(s.duration)).toBe(4);
    expect(s.tracks.every((t) => value(t.notes[0].duration) === 4)).toBe(true);
  });
  test("piano MusicXML has two staves, exact overlapping durations and stable ties across bars", () => {
    const song = score([
      {
        id: "melody",
        name: "Melodie",
        notes: [n("held", 72, 0, 6), n("next", 74, 6, 2)],
      },
      {
        id: "bass",
        name: "Bass",
        notes: [n("bass1", 48, 0, 4, "bass"), n("bass2", 55, 4, 4, "bass")],
      },
    ]);
    const a = convertArrangement(song, settings("original")),
      xml = exportMusicXml(a);
    expect(xml).toContain("<staves>2</staves>");
    expect(xml).toContain('<tie type="start"/>');
    const r = importXml(new TextEncoder().encode(xml), "piano.musicxml");
    expect(r.parts![0].staves).toBe(2);
    expect(
      r.tracks
        .flatMap((t) => t.notes)
        .map((n) => [n.pitch, value(n.start), value(n.duration)])
        .sort(),
    ).toEqual(
      a.notes.map((n) => [n.pitch, value(n.start), value(n.duration)]).sort(),
    );
  });
  test("note/rest edits are validated before storage", () => {
    const s = importXml(demoXml(), "demo.musicxml");
    expect(() => validateScore(s, s)).not.toThrow();
    const invalid = structuredClone(s);
    invalid.tracks[0].notes[0].duration = beat(9999);
    expect(() => validateScore(invalid, s)).toThrow(/Stückende/);
  });
  test("page selection is bounded, normalized and explicit", () => {
    expect(parsePages("1-3, 5; 2", 10)).toEqual([1, 2, 3, 5]);
    expect(() => parsePages("4-2", 10)).toThrow();
    expect(() => parsePages("1-201", 300)).toThrow();
    expect(() => parsePages("0", 3)).toThrow();
  });
});
