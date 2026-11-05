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
  partId?: string;
  staff?: number;
  voice?: string;
  writtenPitch?: number;
  source?: SourceRef;
  sourceIds?: string[];
}
export interface SourceRef {
  page?: number;
  measure: number;
  partId?: string;
  x?: number;
  y?: number;
}
export interface Part {
  id: string;
  name: string;
  instrument?: string;
  program?: number;
  staves: number;
  percussion?: boolean;
  transpositions: { at: Beat; semitones: number }[];
  clefs?: { staff: number; sign: string; line: number }[];
}
export interface ReviewIssue {
  id: string;
  severity: "warning" | "error";
  kind: "recognition" | "rhythm" | "melody" | "instrument" | "playability";
  message: string;
  source?: SourceRef;
}
export interface PdfSource {
  version: string;
  pages: number[];
  sourceHash: string;
  issues: ReviewIssue[];
  reviewed?: boolean;
}
export interface Rest {
  id: string;
  start: Beat;
  duration: Beat;
  track: string;
  partId?: string;
  staff?: number;
  voice?: string;
  source?: SourceRef;
}
export interface Track {
  id: string;
  name: string;
  channel?: number;
  notes: Note[];
  score: number;
  partId?: string;
  staff?: number;
  instrument?: string;
  program?: number;
  percussion?: boolean;
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
  parts?: Part[];
  rests?: Rest[];
  issues?: ReviewIssue[];
  pdf?: PdfSource;
  schemaVersion?: number;
}
export interface Settings {
  style: "swing";
  difficulty: Difficulty;
  melodyTrackId: string;
  chords: Chord[];
  mode?: "original" | "reduction" | "swing";
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
  report?: PianoAnalysis;
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
export interface PianoAnalysis {
  kind: "piano" | "solo" | "ensemble" | "unknown";
  directlyPlayable: boolean;
  reasons: string[];
  warnings: string[];
  melody: MelodySegment[];
  issues: ReviewIssue[];
}
export interface MelodySegment {
  fromBar: number;
  toBar: number;
  trackId: string;
  confidence: number;
}
export interface PdfDocument {
  id: string;
  title: string;
  pages: number;
  bytes: number;
  existing?: string[];
  lowResolutionPages?: number[];
}
export interface PdfJob {
  id: string;
  documentId: string;
  status: "queued" | "running" | "complete" | "error" | "cancelled";
  progress: number;
  message: string;
  results?: CatalogSong[];
  error?: string;
}
export const ENGINE_VERSION = "2.0.0";
export const LIMITS = {
  easy: { span: 7, left: 2, right: 3 },
  medium: { span: 12, left: 3, right: 4 },
} as const;
