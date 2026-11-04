import type {
  Arrangement,
  CatalogEntry,
  CatalogSong,
  Chord,
  Settings,
} from "./core/model";
export interface JazzApi {
  list(): Promise<CatalogEntry[]>;
  load(id: string): Promise<CatalogSong>;
  openFiles(): Promise<CatalogSong[]>;
  filePath(file: File): string;
  importPaths(paths: string[]): Promise<CatalogSong[]>;
  download(id: string): Promise<CatalogSong>;
  update(
    id: string,
    metadata: { title: string; artist: string },
  ): Promise<CatalogSong>;
  analyze(id: string, trackId: string): Promise<Chord[]>;
  convert(id: string, settings: Settings): Promise<Arrangement>;
  saveMidi(id: string, settings: Settings): Promise<string | null>;
  demoFiles(): Promise<string | null>;
}
declare global {
  interface Window {
    jazz: JazzApi;
  }
}
