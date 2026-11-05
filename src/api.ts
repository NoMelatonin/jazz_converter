import type {
  Arrangement,
  CatalogEntry,
  CatalogSong,
  Chord,
  Settings,
  PdfDocument,
  PdfJob,
  PianoAnalysis,
  Song,
  PlaybackVersion,
  PlaybackRequest,
} from "./core/model";
export interface JazzApi {
  list(): Promise<CatalogEntry[]>;
  load(id: string): Promise<CatalogSong>;
  openFiles(): Promise<(CatalogSong | PdfDocument)[]>;
  filePath(file: File): string;
  importPaths(paths: string[]): Promise<(CatalogSong | PdfDocument)[]>;
  download(id: string): Promise<CatalogSong>;
  update(
    id: string,
    metadata: { title: string; artist: string },
  ): Promise<CatalogSong>;
  analyze(id: string, trackId: string): Promise<Chord[]>;
  convert(
    id: string,
    settings: Settings,
    revision?: string,
  ): Promise<Arrangement>;
  saveMidi(id: string, settings: Settings | string): Promise<string | null>;
  getPlaybackVersion(
    id: string,
    request: PlaybackRequest,
    revision?: string,
  ): Promise<PlaybackVersion>;
  loadPlaybackVersion(id: string, versionId: string): Promise<PlaybackVersion>;
  demoFiles(): Promise<string | null>;
  pdfBytes(id: string): Promise<Uint8Array>;
  startPdf(id: string, pages: number[], rotation: number): Promise<PdfJob>;
  pdfStatus(id: string): Promise<PdfJob>;
  cancelPdf(id: string): Promise<PdfJob>;
  analyzePiano(id: string, trackId?: string): Promise<PianoAnalysis>;
  saveMusicXml(
    id: string,
    settings?: Settings | string,
  ): Promise<string | null>;
  correctScore(
    id: string,
    score: Pick<
      Song,
      | "tracks"
      | "rests"
      | "bars"
      | "parts"
      | "tempos"
      | "meters"
      | "sections"
      | "duration"
      | "chords"
    >,
  ): Promise<CatalogSong>;
}
declare global {
  interface Window {
    jazz: JazzApi;
  }
}
