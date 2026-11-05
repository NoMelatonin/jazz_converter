import { describe, expect, test } from "vitest";
import { importSong } from "../src/core/import";
import { demoMidi, demoXml } from "../src/core/demo";
import {
  assertPlayback,
  assertSong,
  playbackError,
} from "../src/core/playback";
import { convertArrangement } from "../src/core/convert";
import { Transport } from "../src/core/transport";
import { beat, value } from "../src/core/time";
import type { Note, Settings, Song } from "../src/core/model";
import { writeMidi } from "midi-file";
import { exportMidi } from "../src/core/midi";
import { exportMusicXml } from "../src/core/musicxml";

const source = () => importSong(demoXml(), "demo.musicxml");
const settings = (
  song: Song,
  mode: Settings["mode"] = "reduction",
): Settings => ({
  style: "swing",
  mode,
  difficulty: "easy",
  melodyTrackId: song.tracks[0].id,
  chords: song.chords,
});
describe("Fassungen müssen tatsächlich spielbare Ereignisse enthalten", () => {
  test("empty derived output is rejected by both export formats", () => {
    const song = source(),
      music = convertArrangement(song, settings(song));
    expect(() => exportMidi({ ...music, notes: [] })).toThrow(
      /keine hörbaren Noten/,
    );
    expect(() => exportMusicXml({ ...music, notes: [] })).toThrow(
      /keine hörbaren Noten/,
    );
  });
  test("a zero-duration MIDI note is rejected even alongside otherwise valid notes", () => {
    const bytes = new Uint8Array(
      writeMidi({
        header: { format: 0, numTracks: 1, ticksPerBeat: 480 },
        tracks: [
          [
            {
              deltaTime: 0,
              type: "noteOn",
              channel: 0,
              noteNumber: 60,
              velocity: 90,
            },
            {
              deltaTime: 480,
              type: "noteOff",
              channel: 0,
              noteNumber: 60,
              velocity: 0,
            },
            {
              deltaTime: 0,
              type: "noteOn",
              channel: 0,
              noteNumber: 64,
              velocity: 90,
            },
            {
              deltaTime: 0,
              type: "noteOff",
              channel: 0,
              noteNumber: 64,
              velocity: 0,
            },
            { deltaTime: 0, type: "endOfTrack" },
          ],
        ],
      }),
    );
    expect(() => importSong(bytes, "zero.mid")).toThrow(/positive Dauer/);
  });
  test("zero-duration XML notes cannot create a playable imported version", () => {
    const xml = new TextDecoder()
      .decode(demoXml())
      .replace("<duration>2</duration>", "<duration>0</duration>");
    expect(() =>
      importSong(new TextEncoder().encode(xml), "zero.musicxml"),
    ).toThrow(/Notendauer/);
  });
  test.each([
    "empty",
    "outside",
    "zero",
    "negative",
    "fractional-pitch",
    "pitch-low",
    "pitch-high",
    "nan-pitch",
    "infinite-pitch",
    "nan-time",
    "zero-denominator",
    "silent",
    "bad-tempo",
  ])("rejects %s at source, conversion and playback boundaries", (kind) => {
    const song = source(),
      note = song.tracks[0].notes[0];
    switch (kind) {
      case "empty":
        song.tracks[0].notes = [];
        break;
      case "outside":
        note.start = song.duration;
        break;
      case "zero":
        note.duration = beat(0);
        break;
      case "negative":
        note.start = beat(-1);
        break;
      case "fractional-pitch":
        note.pitch = 60.5;
        break;
      case "pitch-low":
        note.pitch = -1;
        break;
      case "pitch-high":
        note.pitch = 128;
        break;
      case "nan-pitch":
        note.pitch = NaN;
        break;
      case "infinite-pitch":
        note.pitch = Infinity;
        break;
      case "nan-time":
        note.start.n = NaN;
        break;
      case "zero-denominator":
        note.duration.d = 0;
        break;
      case "silent":
        note.velocity = 0;
        break;
      case "bad-tempo":
        song.tempos[0].bpm = 0;
        break;
    }
    expect(() => assertSong(song)).toThrow(/nicht abspielbar/);
    for (const mode of ["original", "reduction", "swing"] as const)
      expect(() => convertArrangement(song, settings(song, mode))).toThrow(
        /nicht abspielbar/,
      );
    expect(
      () =>
        new Transport(
          {
            now: () => 0,
            cancel() {},
            schedule() {
              throw new Error("Must not reach audio");
            },
          },
          song.tracks
            .flatMap((t) => t.notes)
            .map((n) => ({ ...n, hand: "right" as const })),
          song.tempos,
          value(song.duration),
        ),
    ).toThrow();
  });
  test("zero song length and notes ending beyond it are rejected", () => {
    const song = source();
    song.duration = beat(0);
    expect(() => assertSong(song)).toThrow(/Songlänge/);
    const other = source();
    other.tracks[0].notes[0].duration = beat(100);
    expect(() => assertSong(other)).toThrow(/Songlänge/);
  });
  test("MIDI-range source notes outside piano range require an arrangement", () => {
    const song = source();
    song.tracks[0].notes.forEach((n) => (n.pitch = 12));
    expect(() => assertSong(song)).not.toThrow();
    const music = convertArrangement(song, settings(song));
    expect(() => assertPlayback(music)).not.toThrow();
    expect(() =>
      assertPlayback({
        ...music,
        notes: music.notes.map((n) => ({ ...n, pitch: 12 })),
      }),
    ).toThrow(/88 Klaviertasten/);
  });
  test("an empty chosen melody cannot silently become an accompaniment-only Swing version", () => {
    const song = source();
    song.tracks.push({
      id: "empty",
      name: "Leere Stimme",
      notes: [],
      score: 100,
    });
    expect(() =>
      convertArrangement(song, {
        ...settings(song, "swing"),
        melodyTrackId: "empty",
      }),
    ).toThrow(/Melodiestimme/);
  });
  test.each(["MIDI", "MusicXML"])(
    "valid %s sources remain audible in original, reduction and Swing",
    (format) => {
      const song = importSong(
        format === "MIDI" ? demoMidi() : demoXml(),
        format === "MIDI" ? "demo.mid" : "demo.musicxml",
      );
      for (const mode of ["original", "reduction", "swing"] as const) {
        // A full source MIDI has wide held chords; reduction and Swing remain valid.
        if (mode === "original" && format === "MIDI") continue;
        const config = settings(song, mode);
        if (!config.chords.length)
          config.chords = song.bars.map((b) => ({
            id: `c${b.number}`,
            at: b.start,
            duration: b.duration,
            symbol: "C",
            confidence: 1,
            source: "manual",
          }));
        const music = convertArrangement(song, config),
          heard: Note[] = [];
        const transport = new Transport(
          {
            now: () => 0,
            cancel() {},
            schedule: (n) => {
              heard.push(n);
            },
          },
          music.notes,
          music.tempos,
          value(music.duration),
        );
        transport.play();
        expect(heard.length).toBeGreaterThan(0);
        expect(
          heard.every((n) => Number.isFinite(n.pitch) && n.velocity > 0),
        ).toBe(true);
      }
    },
  );
  test("invalid stored sources expose a reason without mutating them", () => {
    const song = source();
    song.tracks[0].notes = [];
    const before = JSON.stringify(song);
    expect(playbackError(song)).toMatch(/keine hörbaren Noten/);
    expect(JSON.stringify(song)).toBe(before);
  });
});
