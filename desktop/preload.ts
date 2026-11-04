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
  convert: (id: string, settings: unknown) => call("arrange", id, settings),
  saveMidi: (id: string, settings: unknown) => call("midi:save", id, settings),
  demoFiles: () => call("demo:save"),
} satisfies JazzApi);
