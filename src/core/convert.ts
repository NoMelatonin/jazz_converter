import type { Song, Settings, Arrangement } from "./model";
import { arrange } from "./arrange";
import { pianoArrangement } from "./piano";
export function convertArrangement(
  song: Song,
  settings: Settings,
): Arrangement {
  if (settings.mode && settings.mode !== "swing")
    return pianoArrangement(song, settings);
  if (settings.melodyTrackId !== "auto") return arrange(song, settings);
  const reduction = pianoArrangement(song, { ...settings, mode: "reduction" });
  const virtual = {
    ...song,
    tracks: [
      {
        id: "automatic-melody",
        name: "Automatisch verfolgte Hauptmelodie",
        score: 100,
        notes: reduction.notes.filter((n) => n.melody),
      },
      ...song.tracks,
    ],
  };
  const result = arrange(virtual, {
    ...settings,
    melodyTrackId: "automatic-melody",
  });
  return {
    ...result,
    settings,
    report: reduction.report,
    warnings: [...result.warnings, ...reduction.warnings],
  };
}
