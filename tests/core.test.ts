import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { parseMidi, writeMidi, type MidiEvent } from "midi-file";
import { zipSync, strToU8 } from "fflate";
import { demoMidi, demoXml } from "../src/core/demo";
import { importSong } from "../src/core/import";
import { chordsFor, parseChord } from "../src/core/harmony";
import { arrange, violations } from "../src/core/arrange";
import { exportMidi } from "../src/core/midi";
import { extractMelody } from "../src/core/melody";
import {
  add,
  beat,
  beatAtSeconds,
  cmp,
  end,
  secondsAt,
  value,
} from "../src/core/time";
import type {
  Arrangement,
  Difficulty,
  Note,
  Settings,
  Song,
} from "../src/core/model";
import { matches } from "../src/core/catalogue";

const demo = () => importSong(demoXml(), "demo.musicxml");
function settings(song: Song, difficulty: Difficulty = "easy"): Settings {
  return {
    style: "swing",
    difficulty,
    melodyTrackId: song.tracks[0].id,
    chords: chordsFor(song, song.tracks[0].id),
  };
}
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const xml = (measures: string) =>
  strToU8(
    `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Melodie</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`,
  );
const attr =
  "<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
const note = (step = "C", duration = 8, extra = "") =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}</note>`;

describe("Quellen und Import", () => {
  test("CC0 demo retains 32 melody notes, exact form, chords and metadata", () => {
    const song = demo();
    expect(song.title).toBe("Bruder Jakob");
    expect(song.artist).toBe("Traditionell");
    expect(song.bars).toHaveLength(8);
    expect(value(song.duration)).toBe(32);
    expect(song.tracks[0].notes).toHaveLength(32);
    expect(song.chords.map((c) => c.symbol)).toEqual([
      "C",
      "C",
      "C",
      "C",
      "G7",
      "C",
      "G7",
      "C",
    ]);
    expect(song.sections.map((s) => s.name)).toEqual(["A", "B"]);
    expect(song.tempos[0].bpm).toBe(100);
  });
  test("multitrack MIDI proposes melody and derives uncertain editable harmony", () => {
    const song = importSong(demoMidi(), "demo.midi");
    expect(song.tracks).toHaveLength(3);
    expect(song.tracks[0].name).toBe("Melodie");
    expect(song.tracks[0].notes).toHaveLength(32);
    const chords = chordsFor(song, song.tracks[0].id);
    expect(chords).toHaveLength(8);
    expect(chords[0].symbol).toBe("C");
    expect(chords.some((c) => c.source === "inferred")).toBe(true);
    expect(() => arrange(song, settings(song))).not.toThrow();
  });
  test("compressed MXL uses declared container root and rejects traversal", () => {
    const bytes = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="scores/song.musicxml"/></rootfiles></container>',
      ),
      "scores/song.musicxml": demoXml(),
    });
    expect(importSong(bytes, "song.mxl").tracks[0].notes).toHaveLength(32);
    expect(() =>
      importSong(zipSync({ "../bad.xml": demoXml() }), "bad.mxl"),
    ).toThrow(/Pfad/);
  });
  test("pickup, ties, voices, rests and meter/tempo changes keep exact musical positions", () => {
    const source = xml(
      `<measure number="0" implicit="yes">${attr}${note("C", 2, '<tie type="start"/>')}</measure><measure number="1">${note("C", 2, '<tie type="stop"/>')}<note><rest/><duration>6</duration></note></measure><measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="80"/></direction>${note("E", 6)}</measure>`,
    );
    const song = importSong(source, "timing.musicxml");
    expect(song.bars.map((b) => value(b.duration))).toEqual([1, 4, 3]);
    expect(
      song.tracks[0].notes.map((n) => [value(n.start), value(n.duration)]),
    ).toEqual([
      [0, 2],
      [5, 3],
    ]);
    expect(song.tempos.at(-1)).toEqual({ at: beat(5), bpm: 80 });
    expect(song.meters.at(-1)?.numerator).toBe(3);
  });
  test("normal repeats and first/second endings expand in order", () => {
    const source = xml(
      `<measure>${attr}<barline location="left"><repeat direction="forward"/></barline>${note("C")}</measure><measure><barline location="left"><ending number="1" type="start"/></barline>${note("D")}<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure><measure><barline location="left"><ending number="2" type="start"/></barline>${note("E")}<barline location="right"><ending number="2" type="stop"/></barline></measure>`,
    );
    expect(
      importSong(source, "repeat.musicxml").tracks[0].notes.map((n) => n.pitch),
    ).toEqual([60, 62, 60, 64]);
  });
  test("timewise MusicXML, backup and chord notes preserve multiple voices", () => {
    const source = strToU8(
      `<score-timewise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><measure><part id="P1">${attr}${note("E", 8, "<voice>1</voice>")}<backup><duration>8</duration></backup>${note("C", 8, "<voice>2</voice>")}</part></measure></score-timewise>`,
    );
    const song = importSong(source, "voices.musicxml");
    expect(song.tracks).toHaveLength(2);
    expect(song.tracks.every((t) => value(t.notes[0].start) === 0)).toBe(true);
  });
  test("bad files, DTDs and unsupported navigation fail with actionable messages", () => {
    expect(() => importSong(strToU8("bad"), "bad.mid")).toThrow(/MIDI/);
    expect(() => importSong(strToU8("<unclosed>"), "bad.musicxml")).toThrow(
      /beschädigt/,
    );
    expect(() =>
      importSong(strToU8("<!DOCTYPE x><score-partwise/>"), "bad.musicxml"),
    ).toThrow(/DTD/);
    expect(() =>
      importSong(
        xml(
          `<measure>${attr}<direction><sound dacapo="yes"/></direction>${note()}</measure>`,
        ),
        "dc.musicxml",
      ),
    ).toThrow(/D.C./);
    expect(() => importSong(strToU8("abc"), "song.mp3")).toThrow(/MusicXML/);
  });
  test("standard external MusicXML DTD declarations are accepted without fetching them", () => {
    const source = new TextDecoder()
      .decode(demoXml())
      .replace(
        "<score-partwise",
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise',
      );
    expect(importSong(strToU8(source), "standard.musicxml").bars).toHaveLength(
      8,
    );
    expect(() =>
      importSong(
        strToU8(
          '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///etc/passwd">]><score-partwise/>',
        ),
        "entity.musicxml",
      ),
    ).toThrow(/DTD/);
  });
  test("a repeat restores the tempo inherited at its original beginning", () => {
    const source = xml(
      `<measure>${attr}<direction><sound tempo="100"/></direction>${note()}</measure><measure><barline location="left"><repeat direction="forward"/></barline>${note("D")}</measure><measure><direction><sound tempo="80"/></direction>${note("E")}<barline location="right"><repeat direction="backward"/></barline></measure>`,
    );
    const song = importSong(source, "tempo-repeat.musicxml");
    expect(song.tempos.map((t) => [value(t.at), t.bpm])).toEqual([
      [0, 100],
      [8, 80],
      [12, 100],
      [16, 80],
    ]);
  });
  test("MIDI end-of-track retains trailing rests in the song form", () => {
    const parsed = parseMidi(demoMidi());
    parsed.tracks[0].at(-1)!.deltaTime += 1920;
    const song = importSong(new Uint8Array(writeMidi(parsed)), "rests.mid");
    expect(value(song.duration)).toBe(36);
    expect(song.bars).toHaveLength(9);
  });
  test("MIDI splits channels within a track and excludes percussion", () => {
    const events: MidiEvent[] = [
      ...[0, 1, 9].map((channel) => ({
        deltaTime: 0,
        type: "noteOn" as const,
        channel,
        noteNumber: channel === 0 ? 72 : 48,
        velocity: 90,
      })),
      ...[0, 1, 9].map((channel, i) => ({
        deltaTime: i ? 0 : 480,
        type: "noteOff" as const,
        channel,
        noteNumber: channel === 0 ? 72 : 48,
        velocity: 0,
      })),
      { deltaTime: 0, type: "endOfTrack" },
    ];
    const bytes = new Uint8Array(
      writeMidi({
        header: { format: 0, numTracks: 1, ticksPerBeat: 480 },
        tracks: [events],
      }),
    );
    const song = importSong(bytes, "channels.mid");
    expect(song.tracks).toHaveLength(2);
    expect(song.tracks[0].notes[0].pitch).toBe(72);
    expect(chordsFor(song, song.tracks[0].id)[0].confidence).toBeLessThan(0.2);
    expect(() => arrange(song, settings(song))).toThrow(/prüfen/);
  });
  test("search handles title, performer, umlauts and version terms", () => {
    expect(
      matches("bruder traditionell", {
        title: "Bruder Jakob",
        artist: "Traditionell",
        version: "Demo",
      }),
    ).toBe(true);
    expect(
      matches("fur", {
        title: "Für Elise",
        artist: "Beethoven",
        version: "MIDI",
      }),
    ).toBe(true);
    expect(
      matches("anderer", {
        title: "Bruder Jakob",
        artist: "Traditionell",
        version: "Demo",
      }),
    ).toBe(false);
  });
});

describe("Arrangement und Export", () => {
  for (const difficulty of ["easy", "medium"] as const) {
    test(`${difficulty}: identical conversions produce byte-identical piano-only hand tracks`, () => {
      const song = demo(),
        a = arrange(song, settings(song, difficulty)),
        b = arrange(demo(), settings(demo(), difficulty));
      const bytes = exportMidi(a);
      expect(digest(bytes)).toBe(digest(exportMidi(b)));
      const midi = parseMidi(bytes);
      expect(midi.header.format).toBe(1);
      expect(midi.tracks).toHaveLength(3);
      expect(midi.tracks[0].some((e) => e.type === "noteOn")).toBe(false);
      expect(
        midi.tracks
          .flat()
          .filter((e) => e.type === "programChange")
          .map((e) => e.programNumber),
      ).toEqual([0, 0]);
      expect(midi.tracks[1].find((e) => e.type === "trackName")).toMatchObject({
        text: "Linke Hand",
      });
      expect(midi.tracks[2].find((e) => e.type === "trackName")).toMatchObject({
        text: "Rechte Hand",
      });
      expect(violations(a.notes, difficulty)).toEqual([]);
      expect(a.notes.every((n) => n.pitch >= 21 && n.pitch <= 108)).toBe(true);
      const imported = importSong(bytes, "arranged.mid");
      expect(imported.title).toBe(song.title);
      expect(imported.tracks.flatMap((t) => t.notes).length).toBe(
        a.notes.length,
      );
      for (const n of a.notes)
        expect(
          imported.tracks
            .flatMap((t) => t.notes)
            .some(
              (m) =>
                m.pitch === n.pitch &&
                Math.abs(value(m.start) - value(n.start)) <= 1 / 960 &&
                Math.abs(value(m.duration) - value(n.duration)) <= 1 / 960,
            ),
        ).toBe(true);
      expect(imported.meters).toEqual(song.meters);
      expect(imported.sections).toEqual(song.sections);
    });
    test(`${difficulty}: melody remains complete and accompaniment actually changes`, () => {
      const song = demo(),
        a = arrange(song, settings(song, difficulty));
      const melody = a.notes.filter((n) => n.melody);
      expect(melody.map((n) => n.pitch % 12)).toEqual(
        extractMelody(song.tracks[0]).map((n) => n.pitch % 12),
      );
      expect(melody.map((n) => value(n.duration))).toContain(2 / 3);
      expect(melody.map((n) => value(n.duration))).toContain(1 / 3);
      expect(
        a.notes.filter((n) => !n.melody && n.hand === "left").length,
      ).toBeGreaterThanOrEqual(8);
      expect(a.notes.some((n) => !n.melody && n.hand === "right")).toBe(true);
      expect(a.bars).toEqual(song.bars);
      expect(a.sections).toEqual(song.sections);
    });
  }
  test("lively accompaniment has a more active bass than gentle", () => {
    const song = demo();
    expect(
      arrange(song, {...settings(song, "medium"),intensity:"lively"}).notes.filter(
        (n) => n.hand === "left",
      ).length,
    ).toBeGreaterThan(
      arrange(song, settings(song)).notes.filter((n) => n.hand === "left")
        .length,
    );
  });
  test("manual chord corrections change accompaniment, preserve melody and stay deterministic", () => {
    const song = demo(),
      original = settings(song),
      corrected: Settings = {
        ...original,
        chords: original.chords.map((c) => ({
          ...c,
          symbol: "Dm7",
          source: "manual",
          confidence: 1,
        })),
      };
    const a = arrange(song, original),
      b = arrange(song, corrected);
    expect(digest(exportMidi(a))).not.toBe(digest(exportMidi(b)));
    expect(a.notes.filter((n) => n.melody)).toEqual(
      b.notes.filter((n) => n.melody),
    );
    expect(digest(exportMidi(b))).toBe(
      digest(exportMidi(arrange(song, corrected))),
    );
    expect(parseChord("invalid")).toBeUndefined();
    expect(parseChord("F#m7/C#")?.bass).toBe(1);
  });
  test("hand validator detects overlap with held notes, not just simultaneous attacks", () => {
    const n = (id: string, pitch: number, at: number): Note => ({
      id,
      pitch,
      start: beat(at),
      duration: beat(3),
      velocity: 80,
      track: "right",
      hand: "right",
    });
    expect(violations([n("1", 60, 0), n("2", 72, 1)], "easy")).toContain(
      "right: Griffweite überschritten",
    );
    expect(
      violations(
        [n("1", 60, 0), n("2", 62, 1), n("3", 64, 1), n("4", 65, 2)],
        "easy",
      ),
    ).toContain("right: zu viele gleichzeitige Noten");
  });
  test("tuplets and already swung durations are left intact", () => {
    const song = demo();
    song.tracks[0].notes = [0, 1, 2].map((i): Note => ({
      id: String(i),
      pitch: 60 + i,
      start: beat(i, 3),
      duration: beat(1, 3),
      velocity: 90,
      track: song.tracks[0].id,
    }));
    expect(
      arrange(song, settings(song))
        .notes.filter((n) => n.melody)
        .map((n) => n.duration),
    ).toEqual([beat(1, 3), beat(1, 3), beat(1, 3)]);
  });
  test("tempo map conversions remain inverse across changes", () => {
    const tempos = [
      { at: beat(0), bpm: 120 },
      { at: beat(4), bpm: 60 },
      { at: beat(8), bpm: 180 },
    ];
    for (const p of [0, 0.25, 3.9, 4, 5, 8, 10.333])
      expect(beatAtSeconds(secondsAt(p, tempos), tempos)).toBeCloseTo(p, 8);
  });
});
