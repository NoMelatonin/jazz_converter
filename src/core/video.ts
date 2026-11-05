import type { CatalogSong } from "./model";
export interface Calibration {
  c4: number;
  c5: number;
  line: number;
  offsetMs?: number;
}
export interface VideoJob {
  id: string;
  status: "running" | "ready" | "complete" | "cancelled" | "error";
  progress: number;
  message: string;
  title?: string;
  source?: string;
  previews?: string[];
  duration?: number;
  fps?: number;
  result?: CatalogSong;
  error?: string;
}
export interface VideoTools {
  ready: boolean;
  modelBytes: number;
  diskBytes: number;
  message: string;
}
export function youtubeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Bitte einen gültigen YouTube-Link eingeben.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Bitte einen HTTPS-Link zu YouTube verwenden.");
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1);
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host))
    id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : (/^\/(shorts|embed)\/([^/]+)$/.exec(url.pathname)?.[2] ?? null);
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
    throw new Error(
      "Dieser Link bezeichnet kein einzelnes unterstütztes YouTube-Video.",
    );
  return `https://www.youtube.com/watch?v=${id}`;
}
