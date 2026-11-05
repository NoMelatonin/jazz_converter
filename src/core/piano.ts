import type {
  Note,
  PianoAnalysis,
  Song,
  Difficulty,
  Settings,
  Arrangement,
  MelodySegment,
} from "./model";
import { ENGINE_VERSION, LIMITS } from "./model";
import { add, beat, cmp, end, sub, value } from "./time";
import { extractMelody } from "./melody";
import { violations } from "./arrange";

type Step = { previous?: Step; assigned: [string, "left" | "right"][] };
type State = {
  hands: Map<string, "left" | "right">;
  cost: number;
  left: number;
  right: number;
  path?: Step;
};
function barIndex(song: Song, at: number) {
  let lo = 0,
    hi = song.bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value(song.bars[mid].start) <= at) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}
function addToBars(song: Song, index: Map<number, Note[]>, n: Note) {
  for (
    let i = barIndex(song, value(n.start));
    i < song.bars.length && cmp(song.bars[i].start, end(n)) < 0;
    i++
  ) {
    const list = index.get(i) ?? [];
    list.push(n);
    index.set(i, list);
  }
}
function indexed(song: Song, notes: Note[]) {
  const result = new Map<number, Note[]>();
  for (const n of notes) addToBars(song, result, n);
  return result;
}
export function canonicalNotes(input: Note[]): Note[] {
  const unique = new Map<string, Note>();
  for (const n of input) {
    const key = `${n.pitch}:${value(n.start)}:${value(n.duration)}`;
    const existing = unique.get(key);
    if (existing) existing.sourceIds!.push(n.id);
    else unique.set(key, { ...n, sourceIds: [...(n.sourceIds ?? [n.id])] });
  }
  return [...unique.values()].sort(
    (a, b) =>
      cmp(a.start, b.start) ||
      a.pitch - b.pitch ||
      a.id.localeCompare(b.id, "en"),
  );
}
/** Exact feasibility search over held keys; preference costs never prune legal states. */
export function assignHands(input: Note[]): Note[] | null {
  const notes = canonicalNotes(input);
  if (
    !notes.length ||
    notes.some((n) => n.pitch < 21 || n.pitch > 108 || value(n.duration) <= 0)
  )
    return null;
  const byId = new Map(notes.map((n) => [n.id, n]));
  const groups = new Map<number, Note[]>();
  for (const n of notes) {
    const t = value(n.start),
      group = groups.get(t) ?? [];
    group.push(n);
    if (group.length > 10) return null;
    groups.set(t, group);
  }
  let states: State[] = [{ hands: new Map(), cost: 0, left: 48, right: 72 }];
  for (const [at, onsets] of groups) {
    const collapsed = new Map<string, State>();
    for (const state of states) {
      const hands = new Map(
        [...state.hands].filter(([id]) => value(end(byId.get(id)!)) > at),
      );
      const key = [...hands]
        .sort()
        .map(([id, h]) => `${id}:${h}`)
        .join("|");
      const next = { ...state, hands };
      if (!collapsed.has(key) || collapsed.get(key)!.cost > next.cost)
        collapsed.set(key, next);
    }
    const nextStates = new Map<string, State>();
    for (const state of collapsed.values()) {
      if (state.hands.size + onsets.length > 10) continue;
      const active = [...state.hands.keys()].map((id) => byId.get(id)!);
      if (onsets.some((n) => active.some((p) => p.pitch === n.pitch))) continue;
      const visit = (
        index: number,
        hands: Map<string, "left" | "right">,
        assigned: [string, "left" | "right"][],
        cost: number,
      ) => {
        if (index === onsets.length) {
          const own = (h: "left" | "right") =>
            [...hands]
              .filter(([, v]) => v === h)
              .map(([id]) => byId.get(id)!.pitch);
          const l = own("left"),
            r = own("right");
          const center = (a: number[], fallback: number) =>
            a.length ? a.reduce((s, p) => s + p, 0) / a.length : fallback;
          const left = center(l, state.left),
            right = center(r, state.right);
          const next: State = {
            hands,
            left,
            right,
            cost:
              state.cost +
              cost +
              Math.abs(left - state.left) * 0.1 +
              Math.abs(right - state.right) * 0.1 +
              (left > right ? 15 : 0),
            path: { previous: state.path, assigned },
          };
          const key = onsets
            .map((n) => `${n.id}:${hands.get(n.id)}`)
            .concat([...state.hands].map(([id, h]) => `${id}:${h}`))
            .sort()
            .join("|");
          if (!nextStates.has(key) || nextStates.get(key)!.cost > next.cost)
            nextStates.set(key, next);
          return;
        }
        const n = onsets[index];
        for (const h of ["right", "left"] as const) {
          const pitches = [...hands]
            .filter(([, v]) => v === h)
            .map(([id]) => byId.get(id)!.pitch);
          if (
            pitches.length >= 5 ||
            (pitches.length &&
              Math.max(n.pitch, ...pitches) - Math.min(n.pitch, ...pitches) >
                12)
          )
            continue;
          const copy = new Map(hands);
          copy.set(n.id, h);
          const preferred =
            n.hand ??
            (n.staff
              ? n.staff === 1
                ? "right"
                : "left"
              : n.pitch < 60
                ? "left"
                : "right");
          visit(
            index + 1,
            copy,
            [...assigned, [n.id, h]],
            cost + (preferred === h ? 0 : 2),
          );
        }
      };
      visit(0, state.hands, [], 0);
    }
    states = [...nextStates.values()];
    if (!states.length) return null;
  }
  states.sort((a, b) => a.cost - b.cost);
  const assigned = new Map<string, "left" | "right">();
  let step = states[0].path;
  while (step) {
    for (const [id, h] of step.assigned) assigned.set(id, h);
    step = step.previous;
  }
  return notes.map((n) => ({ ...n, hand: assigned.get(n.id)! }));
}

function pitchedTracks(song: Song) {
  return song.tracks.filter((t) => !t.percussion && t.notes.length);
}
export function melodySegments(song: Song, explicit?: string): MelodySegment[] {
  const tracks = pitchedTracks(song),
    segments: MelodySegment[] = [];
  let previous = "";
  const index = new Map(tracks.map((t) => [t.id, indexed(song, t.notes)]));
  if (explicit && explicit !== "auto" && !tracks.some((t) => t.id === explicit))
    throw new Error("Die gewählte Melodiestimme ist nicht vorhanden.");
  for (const bar of song.bars) {
    const candidates = tracks
      .map((t) => {
        const notes = index.get(t.id)?.get(bar.number - 1) ?? [];
        const mean =
          notes.reduce((s, n) => s + n.pitch, 0) / Math.max(1, notes.length);
        const uniqueOnsets = new Set(notes.map((n) => value(n.start))).size;
        const monophony = uniqueOnsets / Math.max(1, notes.length);
        const named =
          /melod|solo|lead|vocal|sopran|violin.?1|flute|flöte/i.test(t.name)
            ? 24
            : 0;
        const bass = /bass|contrab|cello|tuba/i.test(t.name) ? -10 : 0;
        const score = notes.length
          ? mean * 0.35 +
            monophony * 18 +
            named +
            bass +
            Math.min(8, uniqueOnsets) +
            (t.id === previous ? 5 : 0)
          : -1000;
        return { id: t.id, score };
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "en"));
    const chosen =
      explicit && explicit !== "auto" ? explicit : candidates[0]?.id;
    if (!chosen) continue;
    const confidence =
      explicit && explicit !== "auto"
        ? 1
        : candidates.length === 1
          ? 1
          : Math.min(
              1,
              Math.max(0, (candidates[0].score - candidates[1].score) / 20),
            );
    const last = segments.at(-1);
    if (last?.trackId === chosen) {
      last.toBar = bar.number;
      last.confidence = Math.min(last.confidence, confidence);
    } else
      segments.push({
        fromBar: bar.number,
        toBar: bar.number,
        trackId: chosen,
        confidence,
      });
    previous = chosen;
  }
  return segments;
}
export function analyzePiano(song: Song, explicit?: string): PianoAnalysis {
  const tracks = pitchedTracks(song),
    notes = tracks.flatMap((t) => t.notes),
    assigned = assignHands(notes);
  const hasPercussion =
    !!song.parts?.some((p) => p.percussion) ||
    song.warnings.some((w) => /Schlagzeugnoten/.test(w));
  const parts = song.parts?.filter((p) => !p.percussion) ?? tracks;
  const piano =
    parts.length === 1 &&
    /piano|klavier|grand|keyboard/i.test(parts[0]?.name ?? "");
  const kind = piano
    ? "piano"
    : parts.length === 1
      ? "solo"
      : parts.length > 1
        ? "ensemble"
        : "unknown";
  const melody = melodySegments(song, explicit),
    issues = [
      ...new Map(
        [
          ...(song.issues ?? []),
          ...(song.pdf?.reviewed ? [] : (song.pdf?.issues ?? [])),
        ].map((i) => [i.id, i]),
      ).values(),
    ];
  for (const segment of melody)
    if (segment.confidence < 0.25)
      issues.push({
        id: `melody-${segment.fromBar}`,
        severity: "warning",
        kind: "melody",
        message: `Melodiestimme in Takt ${segment.fromBar}–${segment.toBar} bitte anhören.`,
        source: { measure: segment.fromBar },
      });
  const warnings: string[] = [];
  for (const track of tracks) {
    const sorted = [...track.notes].sort((a, b) => cmp(a.start, b.start));
    if (
      sorted.some(
        (n, i) =>
          i > 0 &&
          Math.abs(n.pitch - sorted[i - 1].pitch) > 12 &&
          value(sub(n.start, sorted[i - 1].start)) < 1,
      )
    )
      warnings.push(
        "Große Sprünge in kurzer Zeit: Spieltempo gesondert prüfen.",
      );
  }
  if (hasPercussion)
    warnings.push(
      "Nicht gestimmtes Schlagzeug wird in der Klavierfassung ausgelassen.",
    );
  return {
    kind,
    directlyPlayable: !!assigned && !hasPercussion,
    reasons:
      assigned && !hasPercussion
        ? [
            "Alle klingenden Noten lassen sich auf 88 Tasten mit maximal einer Oktave und fünf Tönen je Hand zuweisen.",
          ]
        : [
            hasPercussion
              ? "Die Partitur enthält Schlagzeug, das nicht unverändert auf Klaviertasten übertragen werden kann."
              : "Die vollständige Partitur überschreitet Tonumfang, Griffweite, Stimmenzahl oder enthält überlappende Anschläge derselben Taste.",
          ],
    warnings: [...new Set(warnings)],
    melody,
    issues,
  };
}
export function sourceMelody(song: Song, explicit?: string): Note[] {
  const result: Note[] = [];
  const index = new Map(
    pitchedTracks(song).map((t) => [t.id, indexed(song, extractMelody(t))]),
  );
  for (const segment of melodySegments(song, explicit)) {
    const first = song.bars[segment.fromBar - 1],
      last = song.bars[segment.toBar - 1],
      stop = add(last.start, last.duration);
    const segmentNotes = [
      ...new Map(
        Array.from(
          { length: segment.toBar - segment.fromBar + 1 },
          (_, i) =>
            index.get(segment.trackId)?.get(segment.fromBar - 1 + i) ?? [],
        )
          .flat()
          .map((n) => [n.id, n]),
      ).values(),
    ];
    for (const n of segmentNotes) {
      if (cmp(n.start, stop) >= 0 || cmp(end(n), first.start) <= 0) continue;
      const start = cmp(n.start, first.start) < 0 ? first.start : n.start,
        finish = cmp(end(n), stop) > 0 ? stop : end(n);
      result.push({
        ...n,
        id: `lead-${segment.fromBar}-${n.id}`,
        sourceIds: [n.id],
        start,
        duration: sub(finish, start),
        melody: true,
        hand: "right",
      });
    }
  }
  return result.sort((a, b) => cmp(a.start, b.start));
}
export function reducePiano(
  song: Song,
  settings: Settings,
  report: PianoAnalysis,
): { notes: Note[]; warnings: string[] } {
  const raw = sourceMelody(song, settings.melodyTrackId),
    notes: Note[] = [],
    warnings: string[] = [];
  const phrases: Note[][] = [];
  for (const [i, n] of raw.entries()) {
    if (
      !i ||
      value(sub(n.start, end(raw[i - 1]))) >= 1 ||
      song.sections.some((s) => cmp(s.at, n.start) === 0)
    )
      phrases.push([]);
    phrases.at(-1)!.push(n);
  }
  for (const phrase of phrases) {
    const low = Math.min(...phrase.map((n) => n.pitch)),
      high = Math.max(...phrase.map((n) => n.pitch));
    const mean = phrase.reduce((s, n) => s + n.pitch, 0) / phrase.length;
    const shifts = Array.from({ length: 15 }, (_, i) => (i - 7) * 12)
      .filter((s) => low + s >= 21 && high + s <= 108)
      .sort(
        (a, b) =>
          Math.abs(mean + a - 72) - Math.abs(mean + b - 72) ||
          Math.abs(a) - Math.abs(b) ||
          a - b,
      );
    if (!shifts.length)
      throw new Error(
        "Die Hauptmelodie passt auch nach Oktavierung nicht auf 88 Tasten. Bitte die Stimme korrigieren.",
      );
    const shift = shifts[0];
    if (shift)
      warnings.push(
        `Melodiephrase ab Takt ${song.bars.findLast((b) => cmp(b.start, phrase[0].start) <= 0)?.number ?? 1} um ${shift / 12} Oktave(n) verlegt.`,
      );
    notes.push(
      ...phrase.map((n) => ({
        ...n,
        pitch: n.pitch + shift,
        writtenPitch: undefined,
        velocity: 100,
      })),
    );
  }
  const all = pitchedTracks(song).flatMap((t) => t.notes),
    leadIds = new Set(raw.flatMap((n) => n.sourceIds ?? []));
  const sourceIndex = indexed(song, all),
    outputIndex = indexed(song, notes);
  const nearby = (start: number, stop: number) => {
    const found = new Map<string, Note>();
    for (
      let i = barIndex(song, start);
      i < song.bars.length && value(song.bars[i].start) < stop;
      i++
    )
      for (const n of outputIndex.get(i) ?? [])
        if (value(n.start) < stop && value(end(n)) > start) found.set(n.id, n);
    return [...found.values()];
  };
  const insert = (candidate: Note) => {
    const relevant = nearby(value(candidate.start), value(end(candidate)));
    if (
      relevant.some((n) => n.pitch === candidate.pitch) ||
      violations([...relevant, candidate], settings.difficulty).length
    )
      return false;
    notes.push(candidate);
    addToBars(song, outputIndex, candidate);
    return true;
  };
  let serial = 0,
    previousBass = 45;
  const fold = (pitch: number, low: number, high: number, previous: number) =>
    Array.from({ length: 11 }, (_, i) => pitch + (i - 5) * 12)
      .filter((p) => p >= low && p <= high)
      .sort(
        (a, b) => Math.abs(a - previous) - Math.abs(b - previous) || a - b,
      )[0];
  for (const bar of song.bars)
    for (
      let index = 0;
      index < value(bar.duration);
      index += settings.difficulty === "easy" ? 2 : 1
    ) {
      const at = add(bar.start, beat(index)),
        active = (sourceIndex.get(bar.number - 1) ?? []).filter(
          (n) => cmp(n.start, at) <= 0 && cmp(end(n), at) > 0,
        );
      const candidate = active
        .filter((n) => !leadIds.has(n.id))
        .sort((a, b) => a.pitch - b.pitch || a.id.localeCompare(b.id, "en"))[0];
      if (!candidate) continue;
      const pitch = fold(candidate.pitch, 33, 57, previousBass);
      if (pitch === undefined) continue;
      previousBass = pitch;
      const maxLength = beat(
        settings.difficulty === "easy" ? 3 : 4,
        settings.difficulty === "easy" ? 2 : 5,
      );
      const finish =
        cmp(add(at, maxLength), end(candidate)) < 0
          ? add(at, maxLength)
          : end(candidate);
      const barEnd = add(bar.start, bar.duration),
        stop = cmp(finish, barEnd) > 0 ? barEnd : finish;
      const bass: Note = {
        ...candidate,
        id: `bass-${++serial}`,
        sourceIds: [candidate.id],
        pitch,
        start: at,
        duration: sub(stop, at),
        hand: "left",
        melody: false,
        velocity: 78,
      };
      insert(bass);
    }
  const accompaniment = all
    .filter((n) => !leadIds.has(n.id))
    .sort(
      (a, b) =>
        cmp(a.start, b.start) ||
        b.duration.n / b.duration.d - a.duration.n / a.duration.d ||
        a.pitch - b.pitch ||
        a.id.localeCompare(b.id, "en"),
    );
  for (const source of accompaniment) {
    // Keep harmonic notes at original onsets; shorten only accompaniment around melody/bass changes.
    let stop = end(source);
    const cap = add(
      source.start,
      beat(
        settings.difficulty === "easy" ? 1 : 2,
        settings.difficulty === "easy" ? 1 : 3,
      ),
    );
    if (cmp(stop, cap) > 0) stop = cap;
    const local = nearby(value(source.start), value(stop));
    const boundary = local
      .filter((n) => cmp(n.start, source.start) > 0 && cmp(n.start, stop) < 0)
      .sort((a, b) => cmp(a.start, b.start))[0];
    if (boundary) stop = boundary.start;
    for (const hand of ["right", "left"] as const) {
      const sounding = local.filter(
        (n) =>
          n.hand === hand &&
          cmp(n.start, stop) < 0 &&
          cmp(end(n), source.start) > 0,
      );
      const center = sounding.length
        ? sounding.reduce((s, n) => s + n.pitch, 0) / sounding.length
        : hand === "left"
          ? 48
          : 69;
      const pitch = fold(
        source.pitch,
        hand === "left" ? 33 : 48,
        hand === "left" ? 60 : 96,
        center,
      );
      if (pitch === undefined || sounding.some((n) => n.pitch === pitch))
        continue;
      const candidate: Note = {
        ...source,
        id: `inner-${++serial}`,
        sourceIds: [source.id],
        pitch,
        writtenPitch: undefined,
        duration: sub(stop, source.start),
        hand,
        melody: false,
        velocity: 60,
      };
      if (insert(candidate)) break;
    }
  }
  notes.sort(
    (a, b) =>
      cmp(a.start, b.start) ||
      a.pitch - b.pitch ||
      a.id.localeCompare(b.id, "en"),
  );
  if (violations(notes, settings.difficulty).length)
    throw new Error(
      "Die Hauptmelodie benötigt eine Korrektur, bevor eine spielbare Klavierfassung erzeugt werden kann.",
    );
  return { notes, warnings: [...new Set(warnings)] };
}
export function pianoArrangement(song: Song, settings: Settings): Arrangement {
  const report = analyzePiano(song, settings.melodyTrackId);
  if (report.issues.some((i) => i.severity === "error"))
    throw new Error(
      "Bitte zuerst die markierten Erkennungsprobleme prüfen und korrigieren.",
    );
  const direct =
    settings.mode === "original"
      ? assignHands(pitchedTracks(song).flatMap((t) => t.notes))
      : null;
  if (settings.mode === "original" && (!direct || !report.directlyPlayable))
    throw new Error(
      "Eine unveränderte Zuordnung ist nicht möglich. Bitte „Klavierfassung erstellen“ wählen.",
    );
  const reduced = direct
    ? { notes: direct, warnings: [] }
    : reducePiano(song, settings, report);
  return {
    songId: song.id,
    title: song.title,
    artist: song.artist,
    version: ENGINE_VERSION,
    settings,
    notes: reduced.notes,
    bars: song.bars,
    tempos: song.tempos,
    meters: song.meters,
    sections: song.sections,
    duration: song.duration,
    warnings: [...report.warnings, ...reduced.warnings],
    report,
  };
}
