import { parseMidi } from "midi-file";
import type { Chord, Meter, Note, Section, Song, Tempo, Track } from "./model";
import { add, barsFor, beat, cmp, end, max, sub, value } from "./time";
import { rankTracks } from "./melody";

export function importMidi(bytes: Uint8Array, filename: string): Song {
  const midi = parseMidi(bytes);
  if (midi.header.format === 2)
    throw new Error(
      "MIDI Typ 2 enthält unabhängige Songs. Bitte als MIDI Typ 0 oder 1 speichern.",
    );
  const ppq = midi.header.ticksPerBeat;
  if (!ppq)
    throw new Error(
      "SMPTE-MIDI wird nicht unterstützt. Bitte mit musikalischer Zeitbasis exportieren.",
    );
  const tempos: Tempo[] = [],
    meters: Meter[] = [],
    sections: Section[] = [],
    chords: Chord[] = [],
    tracks: Track[] = [],
    warnings: string[] = [];
  let key: Song["key"];
  let duration = beat(0);
  let title = filename.replace(/\.(mid|midi)$/i, "");
  let noteCount = 0;
  midi.tracks.forEach((events, ti) => {
    let ticks = 0;
    let name = `Spur ${ti + 1}`;
    const channelTracks = new Map<number, Track>();
    const pending = new Map<
      string,
      { ticks: number; velocity: number; serial: number }[]
    >();
    const channelTrack = (ch: number) => {
      if (!channelTracks.has(ch))
        channelTracks.set(ch, {
          id: `midi-${ti}-${ch}`,
          name,
          channel: ch,
          notes: [],
          score: 0,
        });
      return channelTracks.get(ch)!;
    };
    for (const event of events) {
      ticks += event.deltaTime;
      const at = beat(ticks, ppq);
      duration = max(duration, at);
      if (event.type === "trackName") {
        name = event.text || name;
        if (ti === 0 && event.text) title = event.text;
      }
      if (event.type === "setTempo")
        tempos.push({ at, bpm: 60000000 / event.microsecondsPerBeat });
      if (event.type === "timeSignature")
        meters.push({
          at,
          numerator: event.numerator,
          denominator: event.denominator,
        });
      if (event.type === "keySignature")
        key = {
          root: ((event.scale ? 9 : 0) + event.key * 7 + 120) % 12,
          minor: event.scale === 1,
        };
      if (
        event.type === "marker" ||
        event.type === "cuePoint" ||
        event.type === "text"
      ) {
        const match =
          /^(?:chord:)?\s*([A-G](?:#|b)?(?:maj7|m7|m|7|dim|ø7)?(?:\/[A-G](?:#|b)?)?)\s*$/.exec(
            event.text,
          );
        const isChord =
          match && (event.type === "text" || event.text.startsWith("chord:"));
        if (isChord)
          chords.push({
            id: `midi-chord-${chords.length}`,
            at,
            duration: beat(0),
            symbol: match[1],
            confidence: 1,
            source: "provided",
          });
        else if (event.type !== "text" && event.text.trim())
          sections.push({ at, name: event.text });
      }
      if (event.type !== "noteOn" && event.type !== "noteOff") continue;
      if (event.channel === 9) continue;
      const id = `${event.channel}:${event.noteNumber}`;
      if (event.type === "noteOn" && event.velocity > 0) {
        if (++noteCount > 200000)
          throw new Error(
            "Die Datei enthält zu viele Noten (maximal 200.000).",
          );
        const queue = pending.get(id) ?? [];
        queue.push({ ticks, velocity: event.velocity, serial: noteCount });
        pending.set(id, queue);
      } else {
        const start = pending.get(id)?.shift();
        if (start) {
          if (ticks <= start.ticks)
            throw new Error(
              "Eine MIDI-Note hat keine positive Dauer. Bitte die Quelldatei korrigieren.",
            );
          const track = channelTrack(event.channel);
          track.notes.push({
            id: `m-${ti}-${start.serial}`,
            pitch: event.noteNumber,
            start: beat(start.ticks, ppq),
            duration: beat(ticks - start.ticks, ppq),
            velocity: start.velocity,
            track: track.id,
          });
        }
      }
      duration = max(duration, at);
    }
    for (const [id, starts] of pending)
      for (const start of starts) {
        const [ch, pitch] = id.split(":").map(Number),
          track = channelTrack(ch);
        const startBeat = beat(start.ticks, ppq);
        const stop =
          cmp(beat(ticks, ppq), startBeat) > 0
            ? beat(ticks, ppq)
            : add(startBeat, beat(1));
        track.notes.push({
          id: `m-${ti}-${start.serial}`,
          pitch,
          start: startBeat,
          duration: sub(stop, startBeat),
          velocity: start.velocity,
          track: track.id,
        });
        warnings.push("Fehlendes Note-off wurde am Spurende ergänzt.");
      }
    for (const track of channelTracks.values()) {
      track.name = `${name}${channelTracks.size > 1 ? ` · Kanal ${(track.channel ?? 0) + 1}` : ""}`;
      tracks.push(track);
    }
  });
  if (!tracks.some((t) => t.notes.length))
    throw new Error(
      "Keine spielbaren Melodienoten gefunden (Schlagzeug wird ausgelassen).",
    );
  duration = tracks.reduce(
    (latest, track) =>
      track.notes.reduce((stop, note) => max(stop, end(note)), latest),
    duration,
  );
  const sorted = <T extends { at: { n: number; d: number } }>(
    items: T[],
    fallback: T,
  ): T[] => {
    const ordered = [fallback, ...items].sort((a, b) => cmp(a.at, b.at));
    return ordered.filter(
      (v, i) => !ordered[i + 1] || cmp(v.at, ordered[i + 1].at) !== 0,
    );
  };
  const ts = sorted(tempos, { at: beat(0), bpm: 120 });
  const ms = sorted(meters, { at: beat(0), numerator: 4, denominator: 4 });
  if (
    ts.some((t) => !Number.isFinite(t.bpm) || t.bpm < 10 || t.bpm > 1000) ||
    ms.some((m) => m.numerator < 1 || m.denominator < 1)
  )
    throw new Error("Ungültiges Tempo oder Taktmaß.");
  chords.sort((a, b) => cmp(a.at, b.at));
  chords.forEach(
    (ch, i) => (ch.duration = sub(chords[i + 1]?.at ?? duration, ch.at)),
  );
  return {
    id: "",
    title,
    artist: "Unbekannt",
    format: "MIDI",
    tracks: rankTracks(tracks),
    tempos: ts,
    meters: ms,
    bars: barsFor(duration, ms),
    sections,
    chords,
    duration,
    warnings: [...new Set(warnings)],
    key,
  };
}
