export type Beat = { n: number; d: number };
export type Hand = "left" | "right";
export type Difficulty = "easy" | "medium";
export interface Note {
  id: string;
  pitch: number;
  start: Beat;
  duration: Beat;
  velocity: number;
  track: string;
  melody?: boolean;
  hand?: Hand;
}
export interface Track {
  id: string;
  name: string;
  channel?: number;
  notes: Note[];
  score: number;
}
export interface Meter {
  at: Beat;
  numerator: number;
  denominator: number;
}
export interface Tempo {
  at: Beat;
  bpm: number;
}
export interface Bar {
  number: number;
  start: Beat;
  duration: Beat;
  numerator: number;
  denominator: number;
}
export interface Section {
  at: Beat;
  name: string;
}
export interface Chord {
  id: string;
  at: Beat;
  duration: Beat;
  symbol: string;
  confidence: number;
  source: "provided" | "inferred" | "manual";
}
export interface Song {
  id: string;
  title: string;
  artist: string;
  format: string;
  tracks: Track[];
  tempos: Tempo[];
  meters: Meter[];
  bars: Bar[];
  sections: Section[];
  chords: Chord[];
  duration: Beat;
  warnings: string[];
  key?: { root: number; minor: boolean };
}
export interface Settings {
  style: "swing";
  difficulty: Difficulty;
  melodyTrackId: string;
  chords: Chord[];
}
export interface Arrangement {
  songId: string;
  title: string;
  artist: string;
  version: string;
  settings: Settings;
  notes: Note[];
  bars: Bar[];
  tempos: Tempo[];
  meters: Meter[];
  sections: Section[];
  duration: Beat;
  warnings: string[];
}
export interface CatalogEntry {
  id: string;
  title: string;
  artist: string;
  version: string;
  format: string;
  source: string;
  license: string;
  importedAt?: string;
}
export interface CatalogSong {
  entry: CatalogEntry;
  song: Song;
  settings?: Settings;
}
export const ENGINE_VERSION = "1.0.0";
export const LIMITS = {
  easy: { span: 7, left: 2, right: 3 },
  medium: { span: 12, left: 3, right: 4 },
} as const;
