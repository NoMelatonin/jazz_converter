import type { Arrangement, Beat, Note, Song, Tempo } from "./model";

const fail = (message: string): never => {
  throw new Error(`Diese Fassung ist nicht abspielbar: ${message}`);
};
export function timeValue(
  input: Beat,
  label: string,
  positive = false,
): number {
  if (
    !input ||
    !Number.isSafeInteger(input.n) ||
    !Number.isSafeInteger(input.d) ||
    input.d <= 0 ||
    input.n < 0 ||
    (positive && input.n === 0)
  )
    fail(`${label} ist ungültig.`);
  const result = input.n / input.d;
  if (!Number.isFinite(result)) fail(`${label} ist ungültig.`);
  return result;
}
export function assertTimeline(
  notes: Note[],
  tempos: Tempo[],
  duration: number,
  piano = true,
  hands = true,
): void {
  if (!Number.isFinite(duration) || duration <= 0)
    fail("Die Songlänge ist ungültig.");
  if (!Array.isArray(tempos) || !tempos.length) fail("Die Tempodaten fehlen.");
  let previous = -1;
  for (const [i, tempo] of tempos.entries()) {
    const at = timeValue(tempo?.at, "Tempoposition");
    if (
      (!i && at !== 0) ||
      at < previous ||
      at > duration ||
      !Number.isFinite(tempo.bpm) ||
      tempo.bpm < 10 ||
      tempo.bpm > 1000
    )
      fail("Die Tempodaten sind ungültig.");
    previous = at;
  }
  if (!Array.isArray(notes) || !notes.length)
    fail(
      "Es sind keine hörbaren Noten vorhanden. Bitte die Quelle oder Melodiestimme prüfen.",
    );
  const ids = new Set<string>();
  for (const note of notes) {
    if (!note || typeof note.id !== "string" || !note.id || ids.has(note.id))
      fail("Notenkennungen fehlen oder sind doppelt.");
    ids.add(note.id);
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127)
      fail("Eine Tonhöhe ist ungültig.");
    if (piano && (note.pitch < 21 || note.pitch > 108))
      fail(
        "Eine Note liegt außerhalb der 88 Klaviertasten. Bitte eine Klavierfassung erstellen.",
      );
    const at = timeValue(note.start, "Notenbeginn"),
      length = timeValue(note.duration, "Notendauer", true);
    if (at >= duration || at + length > duration + 1e-8)
      fail(
        "Eine Note liegt außerhalb der Songlänge. Bitte Beginn und Notendauer korrigieren.",
      );
    if (
      !Number.isInteger(note.velocity) ||
      note.velocity < 1 ||
      note.velocity > 127
    )
      fail("Eine Note hat keine gültige hörbare Anschlagstärke.");
    if (hands && note.hand !== "left" && note.hand !== "right")
      fail("Die Handzuordnung einer Note fehlt.");
  }
}
function assertStructure(
  music: Pick<Arrangement, "bars" | "meters" | "sections" | "duration">,
): void {
  const duration = timeValue(music.duration, "Songlänge", true);
  if (!Array.isArray(music.bars) || !music.bars.length)
    fail("Die Takte fehlen.");
  let stop = 0;
  for (const [i, bar] of music.bars.entries()) {
    const at = timeValue(bar?.start, "Taktbeginn"),
      length = timeValue(bar?.duration, "Taktdauer", true);
    if (
      bar.number !== i + 1 ||
      Math.abs(at - stop) > 1e-8 ||
      !Number.isInteger(bar.numerator) ||
      bar.numerator < 1 ||
      !Number.isInteger(bar.denominator) ||
      bar.denominator < 1
    )
      fail("Die Taktfolge ist ungültig.");
    stop = at + length;
  }
  if (Math.abs(stop - duration) > 1e-8)
    fail("Taktfolge und Songlänge stimmen nicht überein.");
  if (
    !Array.isArray(music.meters) ||
    !music.meters.length ||
    !Array.isArray(music.sections)
  )
    fail("Takt- oder Abschnittsdaten fehlen.");
  for (const meter of music.meters)
    if (
      timeValue(meter.at, "Taktwechsel") > duration ||
      !Number.isInteger(meter.numerator) ||
      meter.numerator < 1 ||
      !Number.isInteger(meter.denominator) ||
      meter.denominator < 1
    )
      fail("Ein Taktwechsel ist ungültig.");
  for (const section of music.sections)
    if (timeValue(section.at, "Abschnittsbeginn") > duration)
      fail("Ein Abschnitt liegt außerhalb des Songs.");
}
export function assertSong(song: Song): void {
  if (
    !song ||
    typeof song.title !== "string" ||
    typeof song.artist !== "string"
  )
    fail("Die gespeicherten Songdaten sind ungültig.");
  if (!song || !Array.isArray(song.tracks) || !song.tracks.length)
    fail("Die gespeicherten Stimmen fehlen.");
  const tracks = new Set<string>();
  for (const track of song.tracks) {
    if (
      !track ||
      typeof track.id !== "string" ||
      tracks.has(track.id) ||
      !Array.isArray(track.notes)
    )
      fail("Die gespeicherten Stimmen sind ungültig.");
    tracks.add(track.id);
    if (track.notes.some((n) => !n || n.track !== track.id))
      fail("Noten sind der falschen Stimme zugeordnet.");
  }
  assertTimeline(
    song.tracks.flatMap((t) => t.notes),
    song.tempos,
    timeValue(song.duration, "Songlänge", true),
    false,
    false,
  );
  assertStructure(song);
}
export function assertPlayback(
  music: Pick<
    Arrangement,
    "notes" | "tempos" | "duration" | "bars" | "meters" | "sections"
  >,
): void {
  assertTimeline(
    music.notes,
    music.tempos,
    timeValue(music.duration, "Songlänge", true),
  );
  assertStructure(music);
}
export function playbackError(song: Song): string | undefined {
  try {
    assertSong(song);
    return undefined;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Diese Fassung ist beschädigt und nicht abspielbar.";
  }
}
