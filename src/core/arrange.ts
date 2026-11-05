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
import { jazzChord, contextualChord, type ParsedChord } from "./harmony";
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
    const shift = low >= 21 && high <= 108 ? 0 : shifts[0];
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
        velocity: n.velocity,
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
  if (song.transcription && !song.transcription.reviewed)
    throw new Error(
      "Bitte zuerst die Video-Transkription anhören und die Hörkontrolle bestätigen.",
    );
  const track = song.tracks.find((t) => t.id === settings.melodyTrackId);
  if (!track) throw new Error("Bitte eine Melodiespur auswählen.");
  if (!track.notes.length)
    throw new Error("Die gewählte Melodiestimme enthält keine hörbaren Noten.");
  if (!settings.chords.length)
    throw new Error("Bitte zuerst Akkorde ergänzen.");
  if (
    settings.chords.some(
      (c) =>
        c.confidence < 0.2 &&
        c.source !== "manual" &&
        track.notes.some(
          (n) =>
            cmp(n.start, add(c.at, c.duration)) < 0 && cmp(end(n), c.at) > 0,
        ),
    )
  )
    throw new Error(
      "Für diese Quelle fehlen sichere Begleitdaten. Bitte die markierten Akkorde prüfen und bestätigen.",
    );
  const chords = [...settings.chords].sort((a, b) => cmp(a.at, b.at));
  for (const c of chords) jazzChord(c.symbol);
  const rawMelody = extractMelody(track);
  const grid =
    !song.transcription &&
    !song.meters.some((m) => m.denominator === 8 && m.numerator % 3 === 0) &&
    rawMelody.every(
      (n) =>
        Math.abs(value(n.start) * 2 - Math.round(value(n.start) * 2)) < 1e-6,
    );
  const adapted = octavePhrases(grid ? swing(rawMelody) : rawMelody, song);
  const melody = adapted.notes;
  const notes: Note[] = [...melody];
  const limits = LIMITS[settings.difficulty];
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
  const level = { gentle: 0, balanced: 1, lively: 2 }[
    settings.intensity ?? "gentle"
  ];
  const typicalVelocity = [...melody].sort((a, b) => a.velocity - b.velocity)[
    Math.floor(melody.length / 2)
  ].velocity;
  const quiet = Math.max(20, Math.min(66, typicalVelocity - 24 + level * 4));
  for (const bar of song.bars) {
    const barStop = add(bar.start, bar.duration),
      length = value(bar.duration);
    const local = melody.filter(
      (n) => cmp(n.start, barStop) < 0 && cmp(end(n), bar.start) > 0,
    );
    if (!local.length) continue;
    const first = melody[0].start,
      last = end(melody.at(-1)!);
    const bpm =
      song.tempos.findLast((t) => cmp(t.at, bar.start) <= 0)?.bpm ?? 120;
    const dense = local.length / ((length * 60) / bpm) > 5;
    const compound = bar.denominator === 8 && bar.numerator % 3 === 0;
    const pulse = compound ? 1.5 : 4 / bar.denominator;
    const section = song.sections.filter(
      (s) => cmp(s.at, bar.start) <= 0,
    ).length;
    const phraseEnd = melody.some(
      (n) =>
        cmp(n.start, bar.start) >= 0 &&
        cmp(end(n), barStop) <= 0 &&
        !melody.some(
          (m) =>
            cmp(m.start, end(n)) >= 0 && value(sub(m.start, end(n))) < 0.75,
        ),
    );
    const variant = (bar.number + section) % 3;
    // Harmonic changes are anchors even when they fall between metric beats.
    const anchors = [
      0,
      ...chords
        .filter((c) => cmp(c.at, bar.start) > 0 && cmp(c.at, barStop) < 0)
        .map((c) => value(sub(c.at, bar.start))),
    ];
    if (!dense && level > 0)
      for (let t = pulse; t < length; t += pulse) {
        if (level === 2 || Math.round(t / pulse) % 2 === 0) anchors.push(t);
      }
    for (const offset of [...new Set(anchors)].sort((a, b) => a - b)) {
      const at = add(bar.start, beat(Math.round(offset * 960), 960));
      if (cmp(at, first) < 0 || cmp(at, last) >= 0) continue;
      const sourceChord =
        chords.findLast((c) => cmp(c.at, at) <= 0) ?? chords[0];
      const next = chords.find((c) => cmp(c.at, at) > 0);
      const harmonicEnd = next?.at ?? song.duration;
      const chord = contextualChord(
        sourceChord.symbol,
        local,
        next?.symbol,
        sourceChord.confidence,
      );
      const sounding = local.filter(
        (n) => cmp(n.start, add(at, beat(1))) < 0 && cmp(end(n), at) > 0,
      );
      const melodyLow = sounding.length
        ? Math.min(...sounding.map((n) => n.pitch))
        : 72;
      const bassOptions = Array.from({ length: 25 }, (_, i) => 33 + i).filter(
        (p) => p % 12 === chord.bass && p < melodyLow - 7,
      );
      bassOptions.sort(
        (a, b) =>
          Math.abs(a - previousBass) - Math.abs(b - previousBass) || a - b,
      );
      if (bassOptions.length) {
        const bass = bassOptions[0];
        previousBass = bass;
        const duration = beat(
          Math.round(
            Math.min(
              value(sub(harmonicEnd, at)),
              value(sub(barStop, at)),
              pulse * (dense ? 0.65 : 0.85),
            ) * 960,
          ),
          960,
        );
        addNote(bass, at, duration, "left", quiet);
      }
    }
    // Short shells breathe around melodic activity; no compulsory offbeat chord.
    const offsets = dense
      ? []
      : level === 0
        ? [variant === 0 ? pulse : Math.min(pulse * 2, length - pulse)]
        : level === 1
          ? [pulse, pulse * 2 + (variant === 1 ? pulse / 2 : 0)]
          : [0, pulse, pulse * 2, pulse * 3];
    for (const offset of [...new Set(offsets)]) {
      if (
        offset < 0 ||
        offset >= length ||
        (phraseEnd && offset > length - pulse)
      )
        continue;
      const at = add(bar.start, beat(Math.round(offset * 960), 960));
      if (cmp(at, first) < 0 || cmp(at, last) >= 0) continue;
      const source = chords.findLast((c) => cmp(c.at, at) <= 0) ?? chords[0],
        next = chords.find((c) => cmp(c.at, at) > 0);
      let stop = add(at, beat(1, 3));
      if (cmp(stop, barStop) > 0) stop = barStop;
      if (next && cmp(stop, next.at) > 0) stop = next.at;
      const sounding = melody.filter(
        (n) => cmp(n.start, stop) < 0 && cmp(end(n), at) > 0,
      );
      const pitches = sounding.map((n) => n.pitch),
        lo = pitches.length ? Math.min(...pitches) : 76,
        hi = pitches.length ? Math.max(...pitches) : 76;
      const chord = contextualChord(
        source.symbol,
        sounding,
        next?.symbol,
        source.confidence,
      );
      const grip = voicing(
        chord,
        Math.min(level === 0 ? 1 : 2, limits.right - sounding.length),
        Math.max(48, hi - limits.span),
        lo - 3,
        limits.span,
        previousRight,
      );
      previousRight = grip;
      const compHand = grip.length ? ("right" as const) : ("left" as const);
      const tones = grip.length
        ? grip
        : voicing(
            chord,
            1,
            previousBass + 2,
            Math.min(previousBass + limits.span, lo - 10),
            limits.span,
            [],
          );
      for (const p of tones) {
        const candidate: Note = {
          id: `check-${serial}`,
          pitch: p,
          start: at,
          duration: sub(stop, at),
          hand: compHand,
          velocity: quiet - 6,
          track: "right",
        };
        if (
          !violations(
            [
              ...notes.filter(
                (n) => cmp(n.start, stop) < 0 && cmp(end(n), at) > 0,
              ),
              candidate,
            ],
            settings.difficulty,
          ).length
        )
          addNote(p, at, sub(stop, at), compHand, quiet - 6);
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
    warnings: [
      ...song.warnings,
      ...adapted.warnings,
      ...(chords.some((c) => c.source === "inferred" && c.confidence < 0.65)
        ? [
            "Unsicher abgeleitete Akkorde: vor der Übernahme anhören und bei Bedarf korrigieren.",
          ]
        : []),
    ],
  };
  assertPlayback(output);
  return output;
}
