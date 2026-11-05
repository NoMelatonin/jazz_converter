import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { JazzApi } from "../src/api";
async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const reply = await ipcRenderer.invoke(method, ...args);
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
contextBridge.exposeInMainWorld("jazz", {
  list: () => call("catalog:list"),
  load: (id: string) => call("catalog:load", id),
  openFiles: () => call("files:open"),
  filePath: (file: File) => webUtils.getPathForFile(file),
  importPaths: (paths: string[]) => call("files:import", paths),
  download: (id: string) => call("catalog:download", id),
  update: (id: string, metadata: { title: string; artist: string }) =>
    call("catalog:update", id, metadata),
  analyze: (id: string, trackId: string) => call("chords:analyze", id, trackId),
  convert: (id: string, settings: unknown, revision?: string) =>
    call("arrange", id, settings, revision),
  getPlaybackVersion: (id, request, revision) =>
    call("playback:resolve", id, request, revision),
  loadPlaybackVersion: (id, versionId) => call("playback:load", id, versionId),
  saveMidi: (id: string, settings: unknown) => call("midi:save", id, settings),
  demoFiles: () => call("demo:save"),
  pdfBytes: (id: string) => call("pdf:bytes", id),
  startPdf: (id: string, pages: number[], rotation: number) =>
    call("pdf:start", id, pages, rotation),
  pdfStatus: (id: string) => call("pdf:status", id),
  cancelPdf: (id: string) => call("pdf:cancel", id),
  analyzePiano: (id: string, trackId?: string) =>
    call("piano:analyze", id, trackId),
  saveMusicXml: (id: string, settings?: unknown) =>
    call("musicxml:save", id, settings),
  correctScore: (id: string, score: unknown) =>
    call("score:correct", id, score),
} satisfies JazzApi);
