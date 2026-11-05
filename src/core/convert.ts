import type { Song, Settings, Arrangement } from "./model";
import { arrange } from "./arrange";
import { pianoArrangement } from "./piano";
import { assertPlayback, assertSong } from "./playback";
export function convertArrangement(
  song: Song,
  settings: Settings,
): Arrangement {
  assertSong(song);
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
  const output = {
    ...result,
    settings,
    report: reduction.report,
    warnings: [...result.warnings, ...reduction.warnings],
  };
  assertPlayback(output);
  return output;
}
