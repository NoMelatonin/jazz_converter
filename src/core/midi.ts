import { writeMidi, type MidiEvent } from "midi-file";
import type { Arrangement } from "./model";
import { cmp, end, value } from "./time";
const tick = (b: { n: number; d: number }) => Math.round(value(b) * 960);
type WithoutDelta<T> = T extends unknown ? Omit<T, "deltaTime"> : never;
type Timed = { at: number; order: number; event: WithoutDelta<MidiEvent> };
function events(items: Timed[]): MidiEvent[] {
  items.sort(
    (a, b) =>
      a.at - b.at ||
      a.order - b.order ||
      JSON.stringify(a.event).localeCompare(JSON.stringify(b.event), "en"),
  );
  let last = 0;
  return items.map((item) => {
    const result = { ...item.event, deltaTime: item.at - last } as MidiEvent;
    last = item.at;
    return result;
  });
}
export function exportMidi(arrangement: Arrangement): Uint8Array {
  const total = arrangement.notes.reduce(
    (latest, note) => Math.max(latest, tick(end(note)), tick(note.start) + 1),
    tick(arrangement.duration),
  );
  const meta: Timed[] = [
    { at: 0, order: 0, event: { type: "trackName", text: arrangement.title } },
    {
      at: 0,
      order: 1,
      event: {
        type: "text",
        text: `${arrangement.settings.mode ?? "swing"} / ${arrangement.settings.difficulty} / engine ${arrangement.version}`,
      },
    },
    ...arrangement.tempos.map((t) => ({
      at: tick(t.at),
      order: 2,
      event: {
        type: "setTempo" as const,
        microsecondsPerBeat: Math.round(60000000 / t.bpm),
      },
    })),
    ...arrangement.meters.map((m) => ({
      at: tick(m.at),
      order: 3,
      event: {
        type: "timeSignature" as const,
        numerator: m.numerator,
        denominator: m.denominator,
        metronome: 24,
        thirtyseconds: 8,
      },
    })),
    ...arrangement.sections.map((s) => ({
      at: tick(s.at),
      order: 4,
      event: { type: "marker" as const, text: s.name },
    })),
    { at: total, order: 99, event: { type: "endOfTrack" } },
  ];
  const tracks = [events(meta)];
  for (const [channel, hand] of (["left", "right"] as const).entries()) {
    const list: Timed[] = [
      {
        at: 0,
        order: 0,
        event: {
          type: "trackName",
          text: hand === "left" ? "Linke Hand" : "Rechte Hand",
        },
      },
      {
        at: 0,
        order: 1,
        event: { type: "programChange", channel, programNumber: 0 },
      },
    ];
    for (const n of arrangement.notes.filter((n) => n.hand === hand)) {
      const start = tick(n.start),
        stop = Math.max(start + 1, tick(end(n)));
      list.push(
        {
          at: start,
          order: 10,
          event: {
            type: "noteOn",
            channel,
            noteNumber: n.pitch,
            velocity: n.velocity,
          },
        },
        {
          at: stop,
          order: 5,
          event: { type: "noteOff", channel, noteNumber: n.pitch, velocity: 0 },
        },
      );
    }
    list.push(
      {
        at: total,
        order: 90,
        event: { type: "controller", channel, controllerType: 64, value: 0 },
      },
      { at: total, order: 99, event: { type: "endOfTrack" } },
    );
    tracks.push(events(list));
  }
  return new Uint8Array(
    writeMidi(
      { header: { format: 1, numTracks: 3, ticksPerBeat: 960 }, tracks },
      { running: false, useByte9ForNoteOff: false },
    ),
  );
}
