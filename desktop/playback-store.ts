import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  Arrangement,
  CatalogSong,
  PlaybackRequest,
  PlaybackVersion,
  Settings,
  Song,
} from "../src/core/model";
import { ENGINE_VERSION } from "../src/core/model";
import { assertPlayback, assertSong } from "../src/core/playback";
import { extractMelody } from "../src/core/melody";
import { sourceMelody } from "../src/core/piano";

export function canonicalJson(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(",")}]`;
  if (input && typeof input === "object")
    return `{${Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(input);
}
const hash = (input: unknown) =>
  createHash("sha256").update(canonicalJson(input)).digest("hex");
export const sourceRevision = (song: Song) => hash(song);
const safe = (id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Ungültige Fassungskennung.");
  return id;
};
const normalize = (request: PlaybackRequest): PlaybackRequest => {
  if (request.kind === "original") return { kind: "original" };
  if (
    request.kind === "melody" &&
    typeof request.trackId === "string" &&
    request.trackId
  )
    return { kind: "melody", trackId: request.trackId };
  if (request.kind === "arrangement" && request.settings)
    return {
      kind: "arrangement",
      settings: { ...request.settings, mode: request.settings.mode ?? "swing" },
    };
  throw new Error("Die angeforderte Fassung ist ungültig.");
};
const key = (
  sourceId: string,
  revision: string,
  engineVersion: string,
  request: PlaybackRequest,
) => hash({ sourceId, revision, engineVersion, request });
const stale = () =>
  new Error(
    "Die Quelle wurde inzwischen geändert. Bitte die Fassung erneut laden oder neu erstellen. Die bisherige Fassung bleibt gespeichert.",
  );

/** Immutable playback snapshots; originals/catalog records are never written here. */
export class PlaybackStore {
  private pending = new Map<string, Promise<PlaybackVersion>>();
  constructor(
    readonly dataDir: string,
    private readSource: (id: string) => Promise<CatalogSong>,
    private arrange: (song: Song, settings: Settings) => Promise<Arrangement>,
  ) {}
  private file(sourceId: string, id: string) {
    return path.join(
      this.dataDir,
      "versions",
      safe(sourceId),
      `${safe(id)}.json`,
    );
  }
  async resolve(
    sourceId: string,
    input: PlaybackRequest,
    expectedRevision?: string,
  ): Promise<PlaybackVersion> {
    const record = await this.readSource(safe(sourceId));
    if (record.entry.id !== sourceId || record.song.id !== sourceId)
      throw new Error(
        "Die geladenen Noten gehören nicht zur gewählten Quelle.",
      );
    assertSong(record.song);
    const revision = sourceRevision(record.song),
      request = normalize(input),
      id = key(sourceId, revision, ENGINE_VERSION, request);
    if (expectedRevision && expectedRevision !== revision) throw stale();
    const existing = this.pending.get(id);
    if (existing) return existing;
    const promise = this.create(record, revision, id, request);
    this.pending.set(id, promise);
    try {
      return await promise;
    } finally {
      if (this.pending.get(id) === promise) this.pending.delete(id);
    }
  }
  private async create(
    record: CatalogSong,
    revision: string,
    id: string,
    request: PlaybackRequest,
  ): Promise<PlaybackVersion> {
    const file = this.file(record.entry.id, id);
    try {
      await readFile(file);
      return this.load(record.entry.id, id);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    const song = record.song;
    let music: Arrangement;
    if (request.kind === "arrangement") {
      music = await this.arrange(
        structuredClone(song),
        structuredClone(request.settings),
      );
      if (
        music.songId !== record.entry.id ||
        canonicalJson(music.settings) !== canonicalJson(request.settings)
      )
        throw new Error(
          "Die erzeugte Fassung gehört nicht zur gewählten Quelle oder Einstellung.",
        );
    } else {
      const track =
        request.kind === "melody" && request.trackId !== "auto"
          ? song.tracks.find((t) => t.id === request.trackId)
          : undefined;
      if (request.kind === "melody" && request.trackId !== "auto" && !track)
        throw new Error(
          "Die gespeicherte Melodiestimme ist nicht mehr vorhanden. Bitte eine Stimme auswählen.",
        );
      const notes =
        request.kind === "original"
          ? song.tracks
              .filter((t) => !t.percussion)
              .flatMap((t) => t.notes)
              .map((n) => ({
                ...n,
                hand:
                  n.hand ??
                  (n.staff === 2 || n.pitch < 60
                    ? ("left" as const)
                    : ("right" as const)),
              }))
          : (track ? extractMelody(track) : sourceMelody(song, "auto")).map(
              (n) => ({ ...n, hand: "right" as const }),
            );
      music = {
        songId: record.entry.id,
        title: song.title,
        artist: song.artist,
        version: ENGINE_VERSION,
        settings: {
          style: "swing",
          mode: "original",
          difficulty: "medium",
          melodyTrackId: request.kind === "melody" ? request.trackId : "auto",
          chords: [],
        },
        notes,
        bars: song.bars,
        tempos: song.tempos,
        meters: song.meters,
        sections: song.sections,
        duration: song.duration,
        warnings: song.warnings,
      };
    }
    music = { ...music, playbackVersionId: id, sourceRevision: revision };
    assertPlayback(music);
    if (
      sourceRevision((await this.readSource(record.entry.id)).song) !== revision
    )
      throw stale();
    const snapshot: PlaybackVersion = {
      schemaVersion: 1,
      id,
      sourceId: record.entry.id,
      sourceRevision: revision,
      engineVersion: ENGINE_VERSION,
      request,
      music,
      contentHash: hash(music),
    };
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(snapshot), { flag: "wx" });
      try {
        await link(temporary, file);
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return this.load(record.entry.id, id);
  }
  async load(sourceId: string, id: string): Promise<PlaybackVersion> {
    let snapshot: PlaybackVersion;
    try {
      snapshot = JSON.parse(await readFile(this.file(sourceId, id), "utf8"));
    } catch (error: any) {
      if (error.code === "ENOENT")
        throw new Error(
          "Die gespeicherte Fassung fehlt. Bitte die Fassung neu erstellen.",
        );
      throw new Error(
        "Die gespeicherte Fassung ist beschädigt. Bitte die Quelle prüfen; vorhandene Dateien bleiben erhalten.",
      );
    }
    try {
      if (
        snapshot.schemaVersion !== 1 ||
        snapshot.id !== id ||
        snapshot.sourceId !== sourceId ||
        typeof snapshot.engineVersion !== "string" ||
        key(
          sourceId,
          snapshot.sourceRevision,
          snapshot.engineVersion,
          normalize(snapshot.request),
        ) !== id ||
        snapshot.music.songId !== sourceId ||
        snapshot.music.playbackVersionId !== id ||
        snapshot.music.sourceRevision !== snapshot.sourceRevision ||
        hash(snapshot.music) !== snapshot.contentHash
      )
        throw new Error();
      if (
        snapshot.request.kind === "arrangement" &&
        canonicalJson(snapshot.request.settings) !==
          canonicalJson(snapshot.music.settings)
      )
        throw new Error();
      assertPlayback(snapshot.music);
    } catch {
      throw new Error(
        "Die gespeicherten Fassungsdaten sind ungültig oder gehören zu einer anderen Fassung. Bitte die Quelle prüfen; vorhandene Dateien bleiben erhalten.",
      );
    }
    const record = await this.readSource(safe(sourceId));
    if (record.entry.id !== sourceId || record.song.id !== sourceId)
      throw new Error(
        "Die geladenen Noten gehören nicht zur gewählten Quelle.",
      );
    assertSong(record.song);
    if (sourceRevision(record.song) !== snapshot.sourceRevision) throw stale();
    return snapshot;
  }
}
