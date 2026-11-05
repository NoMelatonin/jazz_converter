import {
  ENGINE_VERSION,
  LIMITS,
  type Arrangement,
  type Beat,
  type Note,
  type Settings,
  type Song,
} from "./model";
import { add, beat, cmp, end, max, sub, value } from "./time";
import { extractMelody } from "./melody";
import { jazzChord, type ParsedChord } from "./harmony";
import { assertPlayback, assertSong } from "./playback";

function swing(melody: Note[]): Note[] {
  const notes = melody.map((n) => ({ ...n }));
  for (let i = 0; i + 1 < notes.length; i++) {
    const a = notes[i],
      b = notes[i + 1];
    if (
      a.start.n % a.start.d !== 0 ||
      cmp(a.duration, beat(1, 2)) !== 0 ||
      cmp(b.duration, beat(1, 2)) !== 0 ||
      cmp(b.start, add(a.start, beat(1, 2))) !== 0
    )
      continue;
    a.duration = beat(2, 3);
    b.start = add(a.start, beat(2, 3));
    b.duration = beat(1, 3);
    i++;
  }
  return notes;
}

function octavePhrases(
  notes: Note[],
  song: Song,
): { notes: Note[]; warnings: string[] } {
  const result: Note[] = [],
    warnings: string[] = [];
  const phrases: Note[][] = [];
  for (const [i, note] of notes.entries()) {
    const boundary =
      i === 0 ||
      value(sub(note.start, end(notes[i - 1]))) >= 1 ||
      song.sections.some((s) => cmp(s.at, note.start) === 0);
    if (boundary) phrases.push([]);
    phrases.at(-1)!.push(note);
  }
  for (const phrase of phrases) {
    const low = Math.min(...phrase.map((n) => n.pitch)),
      high = Math.max(...phrase.map((n) => n.pitch));
    const mean = phrase.reduce((s, n) => s + n.pitch, 0) / phrase.length;
    const shifts = [-48, -36, -24, -12, 0, 12, 24, 36, 48].filter(
      (s) => low + s >= 21 && high + s <= 108,
    );
    if (!shifts.length)
      throw new Error(
        "Die Melodiephrase passt auch nach Oktavierung nicht auf 88 Tasten. Bitte eine andere Melodiestimme wählen.",
      );
    shifts.sort(
      (a, b) =>
        Math.abs(mean + a - 72) - Math.abs(mean + b - 72) ||
        Math.abs(a) - Math.abs(b) ||
        a - b,
    );
    const shift = shifts[0];
    if (shift)
      warnings.push(
        `Melodie ab Takt ${song.bars.findLast((b) => cmp(b.start, phrase[0].start) <= 0)?.number ?? 1}: ${shift > 0 ? "+" : "−"}${Math.abs(shift) / 12} Oktave(n).`,
      );
    result.push(
      ...phrase.map((n) => ({
        ...n,
        pitch: n.pitch + shift,
        hand: "right" as const,
        melody: true,
        velocity: 102,
      })),
    );
  }
  return { notes: result, warnings };
}

function voicing(
  chord: ParsedChord,
  count: number,
  low: number,
  high: number,
  span: number,
  previous: number[],
): number[] {
  // Shells privilege third and seventh. Enumerate small legal inversions and minimize motion.
  const pcs = chord.intervals.map((i) => (i + chord.root) % 12);
  const pitches: number[] = [];
  for (
    let p = Math.max(21, Math.ceil(low));
    p <= Math.min(108, Math.floor(high));
    p++
  )
    if (pcs.includes(p % 12)) pitches.push(p);
  const candidates: { notes: number[]; cost: number }[] = [];
  const visit = (selected: number[], from: number) => {
    if (selected.length) {
      const third = pcs[1],
        seventh = pcs.length >= 4 ? pcs[3] : pcs[0];
      const missing =
        (selected.some((p) => p % 12 === third) ? 0 : 5) +
        (selected.some((p) => p % 12 === seventh) ? 0 : 4);
      const movement = selected.reduce(
        (s, p, i) => s + Math.abs(p - (previous[i] ?? (low + high) / 2)),
        0,
      );
      candidates.push({
        notes: [...selected],
        cost: missing + movement * 0.35 + (count - selected.length) * 8,
      });
    }
    if (selected.length >= count) return;
    for (let i = from; i < pitches.length; i++) {
      if (selected.length && pitches[i] - selected[0] > span) break;
      if (selected.some((p) => p % 12 === pitches[i] % 12)) continue;
      visit([...selected, pitches[i]], i + 1);
    }
  };
  visit([], 0);
  candidates.sort(
    (a, b) =>
      a.cost - b.cost ||
      a.notes.join(",").localeCompare(b.notes.join(","), "en"),
  );
  return candidates[0]?.notes ?? [];
}

export function violations(
  notes: Note[],
  difficulty: Settings["difficulty"],
): string[] {
  const limits = LIMITS[difficulty];
  const errors = new Set<string>();
  for (const hand of ["left", "right"] as const) {
    const own = notes.filter((n) => n.hand === hand);
    const events = own
      .flatMap((n) => [
        { at: n.start, on: true, n },
        { at: end(n), on: false, n },
      ])
      .sort(
        (a, b) =>
          cmp(a.at, b.at) ||
          Number(a.on) - Number(b.on) ||
          a.n.id.localeCompare(b.n.id, "en"),
      );
    const active = new Map<string, Note>();
    for (const e of events) {
      if (e.on) active.set(e.n.id, e.n);
      else active.delete(e.n.id);
      const pitches = [...active.values()].map((n) => n.pitch);
      if (pitches.length > limits[hand])
        errors.add(`${hand}: zu viele gleichzeitige Noten`);
      if (
        pitches.length &&
        Math.max(...pitches) - Math.min(...pitches) > limits.span
      )
        errors.add(`${hand}: Griffweite überschritten`);
      if (e.n.pitch < 21 || e.n.pitch > 108 || value(e.n.duration) <= 0)
        errors.add("Ungültige Note");
    }
  }
  return [...errors];
}

export function arrange(song: Song, settings: Settings): Arrangement {
  assertSong(song);
  const track = song.tracks.find((t) => t.id === settings.melodyTrackId);
  if (!track) throw new Error("Bitte eine Melodiespur auswählen.");
  if (!track.notes.length)
    throw new Error("Die gewählte Melodiestimme enthält keine hörbaren Noten.");
  if (!settings.chords.length)
    throw new Error("Bitte zuerst Akkorde ergänzen.");
  if (settings.chords.some((c) => c.confidence < 0.2 && c.source !== "manual"))
    throw new Error(
      "Für diese Quelle fehlen sichere Begleitdaten. Bitte die markierten Akkorde prüfen und bestätigen.",
    );
  const chords = [...settings.chords].sort((a, b) => cmp(a.at, b.at));
  for (const c of chords) jazzChord(c.symbol);
  const adapted = octavePhrases(swing(extractMelody(track)), song);
  const melody = adapted.notes;
  const notes: Note[] = [...melody];
  const limits = LIMITS[settings.difficulty];
  const medium = settings.difficulty === "medium";
  let serial = 0,
    previousRight: number[] = [],
    previousBass = 45;
  function addNote(
    pitch: number,
    start: Beat,
    duration: Beat,
    hand: "left" | "right",
    velocity: number,
  ) {
    if (cmp(start, song.duration) >= 0) return;
    if (cmp(add(start, duration), song.duration) > 0)
      duration = sub(song.duration, start);
    if (value(duration) > 0)
      notes.push({
        id: `a-${++serial}`,
        pitch,
        start,
        duration,
        hand,
        velocity,
        track: hand,
      });
  }
  for (const bar of song.bars) {
    const length = value(bar.duration);
    for (let index = 0; index < Math.ceil(length); index++) {
      const at = add(bar.start, beat(index));
      if (cmp(at, add(bar.start, bar.duration)) >= 0) continue;
      const sourceChord =
        chords.findLast((c) => cmp(c.at, at) <= 0) ?? chords[0];
      const chord = jazzChord(sourceChord.symbol);
      if (medium || index % 2 === 0) {
        const targetPc =
          index === 0 || !medium
            ? chord.bass
            : index % 2
              ? (chord.root + 7) % 12
              : chord.root;
        const options = Array.from({ length: 25 }, (_, i) => 33 + i).filter(
          (p) => p % 12 === targetPc,
        );
        options.sort(
          (a, b) =>
            Math.abs(a - previousBass) - Math.abs(b - previousBass) || a - b,
        );
        const bass = options[0] ?? 45;
        previousBass = bass;
        let duration = beat(medium ? 4 : 3, medium ? 5 : 4);
        const harmonicEnd = add(sourceChord.at, sourceChord.duration);
        const barEnd = add(bar.start, bar.duration);
        if (cmp(add(at, duration), harmonicEnd) > 0)
          duration = sub(harmonicEnd, at);
        if (cmp(add(at, duration), barEnd) > 0) duration = sub(barEnd, at);
        addNote(bass, at, duration, "left", 76);
        if (!medium && index === 0) {
          const fifth = bass + 7;
          if (fifth <= 60) addNote(fifth, at, duration, "left", 62);
        }
        if (medium && index % 2 === 1) {
          const shell = voicing(chord, 2, bass + 2, bass + 12, 12, []);
          for (const p of shell)
            if (p !== bass)
              addNote(
                p,
                at,
                cmp(duration, beat(1, 3)) < 0 ? duration : beat(1, 3),
                "left",
                58,
              );
        }
      }
      if (index % 2 === 1 || (medium && index === 0)) {
        const compAt = medium ? add(at, beat(2, 3)) : at;
        if (cmp(compAt, add(bar.start, bar.duration)) >= 0) continue;
        const compChord = jazzChord(
          (chords.findLast((c) => cmp(c.at, compAt) <= 0) ?? chords[0]).symbol,
        );
        let stop = add(compAt, beat(1, 3));
        const sounding = melody.filter(
          (n) => cmp(n.start, stop) < 0 && cmp(end(n), compAt) > 0,
        );
        const pitches = sounding.map((n) => n.pitch);
        const minMelody = pitches.length ? Math.min(...pitches) : 76;
        const maxMelody = pitches.length ? Math.max(...pitches) : 76;
        const nextChord = chords.find((c) => cmp(c.at, compAt) > 0);
        if (nextChord && cmp(stop, nextChord.at) > 0) stop = nextChord.at;
        // Include every melody pitch sounding during the grip, not only its first note.
        const grip = voicing(
          compChord,
          limits.right - (sounding.length ? 1 : 0),
          Math.max(48, maxMelody - limits.span),
          minMelody - 1,
          limits.span,
          previousRight,
        );
        previousRight = grip;
        for (const p of grip)
          addNote(p, compAt, sub(stop, compAt), "right", 64);
      }
    }
  }
  notes.sort(
    (a, b) =>
      cmp(a.start, b.start) ||
      (a.hand ?? "").localeCompare(b.hand ?? "", "en") ||
      a.pitch - b.pitch ||
      a.id.localeCompare(b.id, "en"),
  );
  const errors = violations(notes, settings.difficulty);
  if (errors.length)
    throw new Error(
      `Die Griffprüfung konnte diese Passage nicht vereinfachen: ${errors.join(", ")}.`,
    );
  const output: Arrangement = {
    songId: song.id,
    title: song.title,
    artist: song.artist,
    version: ENGINE_VERSION,
    settings,
    notes,
    bars: song.bars,
    tempos: song.tempos,
    meters: song.meters,
    sections: song.sections,
    duration: song.duration,
    warnings: adapted.warnings,
  };
  assertPlayback(output);
  return output;
}
