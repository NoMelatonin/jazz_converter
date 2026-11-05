import type { Song } from "./model";
import { beat, barsFor, end, sub, value, secondsAt } from "./time";
import { assertSong } from "./playback";
export interface RecognizedNote {
  pitch: number;
  start: number;
  end: number;
  velocity: number;
  score?: number;
}
export interface VideoResult {
  notes: RecognizedNote[];
  duration: number;
  model: string;
}
/** A performance timebase, not inferred notation: one beat initially means one second. */
export function transcriptionSong(
  result: VideoResult,
  source: string,
  method: "audio" | "visual",
  title: string,
): Song {
  if (
    !Number.isFinite(result.duration) ||
    result.duration <= 0 ||
    result.duration > 1801 ||
    !Array.isArray(result.notes) ||
    !result.notes.length ||
    result.notes.length > 150000
  )
    throw new Error("Leeres oder ungültiges Transkriptionsergebnis.");
  const duration = beat(Math.ceil(result.duration * 1000), 1000);
  const notes = result.notes.map((n, i) => {
    if (
      !Number.isInteger(n.pitch) ||
      n.pitch < 21 ||
      n.pitch > 108 ||
      !Number.isFinite(n.start) ||
      !Number.isFinite(n.end) ||
      n.start < 0 ||
      n.end <= n.start ||
      n.end > result.duration + 0.001 ||
      !Number.isInteger(n.velocity) ||
      n.velocity < 1 ||
      n.velocity > 127 ||
      (n.score !== undefined &&
        (!Number.isFinite(n.score) || n.score < 0 || n.score > 1))
    )
      throw new Error("Die Transkription enthält ungültige Noten.");
    const start = Math.round(n.start * 1000),
      stop = Math.round(n.end * 1000);
    if (stop <= start)
      throw new Error(
        "Eine erkannte Note ist kürzer als die unterstützte Zeitauflösung.",
      );
    return {
      id: `video-${i}`,
      pitch: n.pitch,
      start: beat(start, 1000),
      duration: beat(stop - start, 1000),
      velocity: n.velocity,
      track: "piano",
      recognition:
        n.score === undefined ? undefined : { score: n.score, method },
    };
  });
  const meters = [{ at: beat(0), numerator: 4, denominator: 4 }];
  const song: Song = {
    id: "pending",
    title,
    artist: "Video-Transkription",
    format: "Video",
    tracks: [
      {
        id: "piano",
        name: "Erkannte Klaviernoten",
        program: 0,
        score: 100,
        notes,
      },
    ],
    parts: [
      {
        id: "piano",
        name: "Klavier",
        program: 0,
        staves: 2,
        transpositions: [],
      },
    ],
    tempos: [{ at: beat(0), bpm: 60 }],
    meters,
    bars: barsFor(duration, meters),
    sections: [],
    chords: [],
    duration,
    warnings: [
      "Transkription des Videos; keine offiziell originale Partitur.",
      "Aufnahmetiming erhalten. 60 BPM und 4/4 sind eine technische Zeitbasis, keine erkannten Taktangaben.",
      ...(method === "audio"
        ? [
            "Pedal, Hall und weitere Instrumente können zusätzliche oder fehlende Noten verursachen. Lange Noten an Analysegrenzen können verkürzt sein.",
          ]
        : [
            "Visuelle Anschlagstärken sind geschätzt. Gleichfarbige Noten ohne sichtbare Lücke können zusammenfallen.",
          ]),
    ],
    transcription: {
      source,
      method,
      model: result.model,
      timing: "performance",
      reviewed: false,
    },
  };
  song.issues = notes
    .filter((n) => n.recognition && n.recognition.score < 0.65)
    .slice(0, 500)
    .map((n) => ({
      id: `recognition-${n.id}`,
      severity: "warning" as const,
      kind: "recognition" as const,
      message: `${n.id}: unsichere ${method === "audio" ? "Audio" : "Bild"}erkennung (${Math.round(n.recognition!.score * 100)}% Modell-/Bildwert, keine Fehlerwahrscheinlichkeit).`,
      source: { measure: Math.floor(n.start.n / n.start.d / 4) + 1 },
    }));
  assertSong(song);
  return song;
}

/** Re-label the beat grid while preserving every event's absolute performance time. */
export function transcriptionMeter(
  song: Song,
  bpm: number,
  numerator: number,
  denominator: number,
): Song {
  if (
    !song.transcription ||
    !Number.isInteger(bpm) ||
    bpm < 30 ||
    bpm > 300 ||
    !Number.isInteger(numerator) ||
    numerator < 1 ||
    numerator > 12 ||
    ![2, 4, 8, 16].includes(denominator)
  )
    throw new Error("Bitte Tempo 30–300 und ein gültiges Taktmaß wählen.");
  const scale = (b: { n: number; d: number }) =>
    beat(Math.round(secondsAt(value(b), song.tempos) * 1000) * bpm, 60000);
  const duration = scale(song.duration),
    meters = [{ at: beat(0), numerator, denominator }];
  const next: Song = {
    ...song,
    tracks: song.tracks.map((t) => ({
      ...t,
      notes: t.notes.map((n) => ({
        ...n,
        start: scale(n.start),
        duration: sub(scale(end(n)), scale(n.start)),
      })),
    })),
    rests: song.rests?.map((n) => ({
      ...n,
      start: scale(n.start),
      duration: sub(scale(end(n)), scale(n.start)),
    })),
    duration,
    meters,
    bars: barsFor(duration, meters),
    tempos: [{ at: beat(0), bpm }],
    chords: [],
    sections: [],
    warnings: song.warnings
      .filter((w) => !w.startsWith("Aufnahmetiming erhalten."))
      .concat(
        "Tempo und Taktmaß manuell gesetzt; Aufnahmezeiten bleiben erhalten.",
      ),
    transcription: { ...song.transcription, reviewed: false },
  };
  assertSong(next);
  return next;
}
