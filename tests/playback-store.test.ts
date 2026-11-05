import { describe, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PlaybackStore } from "../desktop/playback-store";
import { importSong } from "../src/core/import";
import { demoXml } from "../src/core/demo";
import { convertArrangement } from "../src/core/convert";
import { exportMidi } from "../src/core/midi";
import type { CatalogSong, PlaybackRequest } from "../src/core/model";
const id = "a".repeat(64),
  otherId = "b".repeat(64);
async function fixture(
  action: (f: {
    dir: string;
    file: string;
    load: () => Promise<CatalogSong>;
    store: PlaybackStore;
    calls: () => number;
    request: PlaybackRequest;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "jazz-versions-")),
    file = path.join(dir, "songs", `${id}.json`);
  await mkdir(path.dirname(file));
  const song = importSong(demoXml(), "demo.musicxml");
  song.id = id;
  const record: CatalogSong = {
    entry: {
      id,
      title: song.title,
      artist: song.artist,
      version: "Altbestand",
      format: "MusicXML",
      source: "CC0",
      license: "CC0",
    },
    song,
    settings: {
      style: "swing",
      difficulty: "medium",
      melodyTrackId: song.tracks[0].id,
      chords: song.chords,
    },
  };
  await writeFile(file, JSON.stringify(record));
  await writeFile(path.join(dir, "songs", "original.musicxml"), demoXml());
  const load = async () =>
    JSON.parse(await readFile(file, "utf8")) as CatalogSong;
  let calls = 0;
  const store = new PlaybackStore(dir, load, async (s, settings) => {
    calls++;
    return convertArrangement(s, settings);
  });
  try {
    await action({
      dir,
      file,
      load,
      store,
      calls: () => calls,
      request: { kind: "arrangement", settings: record.settings! },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
describe("Gespeicherte Fassungen und Altbestand", () => {
  test("source loader returning another catalog record cannot create a version", () =>
    fixture(async ({ store, request }) => {
      await expect(store.resolve(otherId, request)).rejects.toThrow(
        /gewählten Quelle/,
      );
    }));
  test("legacy settings create immutable snapshots; reload and export use their exact notes", () =>
    fixture(async ({ dir, file, load, store, calls, request }) => {
      const before = await readFile(file),
        original = await readFile(path.join(dir, "songs", "original.musicxml"));
      const first = await store.resolve(id, request),
        second = await store.resolve(id, request);
      expect(second).toEqual(first);
      expect(calls()).toBe(1);
      const restarted = new PlaybackStore(dir, load, async () => {
        throw new Error("Must not regenerate saved notes");
      });
      const restored = await restarted.resolve(id, request);
      expect(restored.music.notes).toEqual(first.music.notes);
      expect(exportMidi(restored.music)).toEqual(exportMidi(first.music));
      expect(await readFile(file)).toEqual(before);
      expect(
        await readFile(path.join(dir, "songs", "original.musicxml")),
      ).toEqual(original);
    }));
  test("original, melody and two difficulty versions have separate identities and survive each other", () =>
    fixture(async ({ dir, store, request }) => {
      if (request.kind !== "arrangement") throw new Error();
      const versions = await Promise.all([
        store.resolve(id, { kind: "original" }),
        store.resolve(id, {
          kind: "melody",
          trackId: request.settings.melodyTrackId,
        }),
        store.resolve(id, request),
        store.resolve(id, {
          ...request,
          settings: { ...request.settings, difficulty: "easy" },
        }),
      ]);
      expect(new Set(versions.map((v) => v.id)).size).toBe(4);
      expect(await readdir(path.join(dir, "versions", id))).toHaveLength(4);
      for (const version of versions)
        expect((await store.load(id, version.id)).music.notes).toEqual(
          version.music.notes,
        );
    }));
  test("a late melody preview preserves original note positions in its saved data", () =>
    fixture(async ({ file, load, store }) => {
      const record = await load();
      record.song.tracks[0].notes = record.song.tracks[0].notes.filter(
        (n) => n.start.n / n.start.d >= 16,
      );
      await writeFile(file, JSON.stringify(record));
      const preview = await store.resolve(id, {
        kind: "melody",
        trackId: record.song.tracks[0].id,
      });
      expect(preview.music.notes[0].start).toEqual({ n: 16, d: 1 });
    }));
  test("corrupt snapshots cannot be played or silently overwritten", () =>
    fixture(async ({ dir, store, request }) => {
      const version = await store.resolve(id, request),
        file = path.join(dir, "versions", id, `${version.id}.json`);
      const corrupt = { ...version, music: { ...version.music, notes: [] } };
      await writeFile(file, JSON.stringify(corrupt));
      const before = await readFile(file);
      await expect(store.load(id, version.id)).rejects.toThrow(/Fassungsdaten/);
      await expect(store.resolve(id, request)).rejects.toThrow(/Fassungsdaten/);
      expect(await readFile(file)).toEqual(before);
    }));
  test("a snapshot belonging to another source is rejected", () =>
    fixture(async ({ dir, store, request }) => {
      const version = await store.resolve(id, request);
      await mkdir(path.join(dir, "versions", otherId));
      await writeFile(
        path.join(dir, "versions", otherId, `${version.id}.json`),
        JSON.stringify(version),
      );
      await expect(store.load(otherId, version.id)).rejects.toThrow(
        /anderen Fassung/,
      );
    }));
  test("source corrections invalidate stale references while retaining previous versions", () =>
    fixture(async ({ dir, file, load, store, request }) => {
      const old = await store.resolve(id, request),
        record = await load();
      record.song.tracks[0].notes[0].pitch++;
      await writeFile(file, JSON.stringify(record));
      await expect(store.load(id, old.id)).rejects.toThrow(
        /inzwischen geändert/,
      );
      await expect(
        store.resolve(id, request, old.sourceRevision),
      ).rejects.toThrow(/inzwischen geändert/);
      const fresh = await store.resolve(id, request);
      expect(fresh.id).not.toBe(old.id);
      expect(await readdir(path.join(dir, "versions", id))).toHaveLength(2);
    }));
  test("late conversion results cannot be attached to a corrected source", () =>
    fixture(async ({ dir, file, load, request }) => {
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>((r) => {
        entered = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const store = new PlaybackStore(dir, load, async (song, settings) => {
        entered();
        await gate;
        return convertArrangement(song, settings);
      });
      const pending = store.resolve(id, request);
      await started;
      const changed = await load();
      changed.song.tracks[0].notes[0].pitch++;
      await writeFile(file, JSON.stringify(changed));
      release();
      await expect(pending).rejects.toThrow(/inzwischen geändert/);
      await expect(readdir(path.join(dir, "versions"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }));
  test("invalid sources and empty selected melodies never create playable snapshots", () =>
    fixture(async ({ dir, file, load, store }) => {
      const record = await load();
      record.song.tracks.push({
        id: "empty",
        name: "Leer",
        notes: [],
        score: 0,
      });
      await writeFile(file, JSON.stringify(record));
      await expect(
        store.resolve(id, { kind: "melody", trackId: "empty" }),
      ).rejects.toThrow(/keine hörbaren Noten/);
      record.song.tracks.forEach((t) => (t.notes = []));
      await writeFile(file, JSON.stringify(record));
      await expect(store.resolve(id, { kind: "original" })).rejects.toThrow(
        /keine hörbaren Noten/,
      );
      await expect(readdir(path.join(dir, "versions"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }));
  test("a producer returning a different source or settings is rejected", () =>
    fixture(async ({ dir, load, request }) => {
      const store = new PlaybackStore(dir, load, async (song, settings) => ({
        ...convertArrangement(song, settings),
        songId: otherId,
      }));
      await expect(store.resolve(id, request)).rejects.toThrow(
        /gewählten Quelle/,
      );
    }));
});
