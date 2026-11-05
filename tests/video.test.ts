import { test, expect } from "vitest";
import { youtubeUrl } from "../src/core/video";
import {
  transcriptionMeter,
  transcriptionSong,
} from "../src/core/transcription";
import { exportMidi } from "../src/core/midi";
import { exportMusicXml } from "../src/core/musicxml";
import { importSong } from "../src/core/import";
import { PlaybackStore } from "../desktop/playback-store";
import { convertArrangement } from "../src/core/convert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const result = {
  duration: 4.123,
  model: "test",
  notes: [
    { pitch: 60, start: 0.313, end: 1.109, velocity: 80, score: 0.4 },
    { pitch: 64, start: 0.313, end: 1.413, velocity: 70, score: 0.9 },
  ],
};
test("only single YouTube videos accepted; canonical URL cannot target arbitrary servers", () => {
  expect(youtubeUrl("https://youtu.be/kcS_ZWM03-E?t=2")).toBe(
    "https://www.youtube.com/watch?v=kcS_ZWM03-E",
  );
  for (const s of [
    "https://evil.test/watch?v=kcS_ZWM03-E",
    "https://youtube.com.evil.test/watch?v=kcS_ZWM03-E",
    "file:///tmp/test",
    "https://www.youtube.com/playlist?list=abc",
  ])
    expect(() => youtubeUrl(s)).toThrow();
});
test("reject empty, nonfinite, out-of-range and invalid transcription events", () => {
  for (const bad of [
    { ...result, notes: [] },
    { ...result, duration: NaN },
    ...["pitch", "start", "end", "velocity", "score"].map((key) => ({
      ...result,
      notes: [{ ...result.notes[0], [key]: NaN }],
    })),
    { ...result, notes: [{ ...result.notes[0], end: 0.2 }] },
  ])
    expect(() => transcriptionSong(bad, "file", "audio", "test")).toThrow();
});
test("performance times, confidence and all notes survive snapshots, MIDI and XML", async () => {
  const song = transcriptionSong(result, "local.mp4", "audio", "Transkription");
  song.id = "a".repeat(64);
  const store = new PlaybackStore(
    await mkdtemp(path.join(tmpdir(), "jazz-transcript-")),
    async () => ({
      entry: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        format: "Video",
        source: "file",
        license: "unknown",
        version: "transcript",
      },
      song,
    }),
    async (s, settings) => convertArrangement(s, settings),
  );
  const version = await store.resolve(song.id, { kind: "original" });
  expect((await store.load(song.id, version.id)).music).toEqual(version.music);
  const midi = importSong(exportMidi(version.music), "test.mid"),
    xml = importSong(
      new TextEncoder().encode(exportMusicXml(version.music)),
      "test.musicxml",
    );
  for (const output of [midi, xml]) {
    const notes = output.tracks.flatMap((t) => t.notes);
    expect(notes).toHaveLength(2);
    expect(
      Math.abs(notes[0].start.n / notes[0].start.d - 0.313),
    ).toBeLessThanOrEqual(1 / 960);
  }
  expect(song.issues).toHaveLength(1);
  expect(song.transcription?.timing).toBe("performance");
});

test("manual beat grid keeps absolute recording time across repeated changes", () => {
  const source = transcriptionSong(result, "video", "audio", "Test");
  for (const bpm of [120, 90, 137]) {
    const next = transcriptionMeter(source, bpm, 3, 4);
    for (const [i, n] of next.tracks[0].notes.entries()) {
      expect(((n.start.n / n.start.d) * 60) / bpm).toBeCloseTo(
        result.notes[i].start,
        3,
      );
      expect(((n.duration.n / n.duration.d) * 60) / bpm).toBeCloseTo(
        result.notes[i].end - result.notes[i].start,
        3,
      );
    }
  }
});

test("beat grid conversion also preserves notes crossing manual tempo changes", () => {
  const s = transcriptionSong(result, "file", "audio", "test");
  s.tempos = [
    { at: { n: 0, d: 1 }, bpm: 60 },
    { at: { n: 1, d: 1 }, bpm: 120 },
  ];
  const n = transcriptionMeter(s, 90, 4, 4).tracks[0].notes[0];
  expect(((n.start.n / n.start.d) * 60) / 90).toBeCloseTo(0.313, 3);
  expect(
    ((n.start.n / n.start.d + n.duration.n / n.duration.d) * 60) / 90,
  ).toBeCloseTo(1.0545, 3);
});
