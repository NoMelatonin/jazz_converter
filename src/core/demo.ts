import { writeMidi, type MidiEvent } from "midi-file";
// Newly encoded traditional melody and original simple accompaniment: CC0 1.0.
const melody: [number, number][][] = [
  [
    [60, 1],
    [62, 1],
    [64, 1],
    [60, 1],
  ],
  [
    [60, 1],
    [62, 1],
    [64, 1],
    [60, 1],
  ],
  [
    [64, 1],
    [65, 1],
    [67, 2],
  ],
  [
    [64, 1],
    [65, 1],
    [67, 2],
  ],
  [
    [67, 0.5],
    [69, 0.5],
    [67, 0.5],
    [65, 0.5],
    [64, 1],
    [60, 1],
  ],
  [
    [67, 0.5],
    [69, 0.5],
    [67, 0.5],
    [65, 0.5],
    [64, 1],
    [60, 1],
  ],
  [
    [60, 1],
    [55, 1],
    [60, 2],
  ],
  [
    [60, 1],
    [55, 1],
    [60, 2],
  ],
];
const chords = ["C", "C", "C", "C", "G7", "C", "G7", "C"];
export function demoXml(): Uint8Array {
  const step = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Bruder Jakob</work-title></work><identification><creator type="composer">Traditionell</creator><rights>CC0 1.0 · Neue Dateifassung für Jazz Converter</rights></identification><part-list><score-part id="P1"><part-name>Melodie</part-name></score-part></part-list><part id="P1">${melody.map((notes, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="100"/></direction><direction><direction-type><rehearsal>A</rehearsal></direction-type></direction>' : i === 4 ? "<direction><direction-type><rehearsal>B</rehearsal></direction-type></direction>" : ""}<harmony><root><root-step>${chords[i][0]}</root-step></root><kind>${chords[i].includes("7") ? "dominant" : "major"}</kind></harmony>${notes.map(([p, d]) => `<note><pitch><step>${step[p % 12]}</step><octave>${Math.floor(p / 12) - 1}</octave></pitch><duration>${d * 2}</duration><voice>1</voice><type>${d === 0.5 ? "eighth" : d === 2 ? "half" : "quarter"}</type></note>`).join("")}</measure>`).join("")}</part></score-partwise>`);
}
export function demoMidi(): Uint8Array {
  const meta: MidiEvent[] = [
    { deltaTime: 0, type: "trackName", text: "Bruder Jakob" },
    { deltaTime: 0, type: "setTempo", microsecondsPerBeat: 600000 },
    {
      deltaTime: 0,
      type: "timeSignature",
      numerator: 4,
      denominator: 4,
      metronome: 24,
      thirtyseconds: 8,
    },
    { deltaTime: 15360, type: "endOfTrack" },
  ];
  const make = (
    name: string,
    channel: number,
    program: number,
    notes: { at: number; duration: number; pitch: number }[],
  ): MidiEvent[] => {
    const list: { at: number; order: number; event: MidiEvent }[] = [
      {
        at: 0,
        order: 0,
        event: { deltaTime: 0, type: "trackName", text: name },
      },
      {
        at: 0,
        order: 1,
        event: {
          deltaTime: 0,
          type: "programChange",
          channel,
          programNumber: program,
        },
      },
    ];
    for (const n of notes)
      list.push(
        {
          at: n.at * 480,
          order: 3,
          event: {
            deltaTime: 0,
            type: "noteOn",
            channel,
            noteNumber: n.pitch,
            velocity: 90,
          },
        },
        {
          at: (n.at + n.duration) * 480,
          order: 2,
          event: {
            deltaTime: 0,
            type: "noteOff",
            channel,
            noteNumber: n.pitch,
            velocity: 0,
          },
        },
      );
    list.push({
      at: 32 * 480,
      order: 9,
      event: { deltaTime: 0, type: "endOfTrack" },
    });
    list.sort((a, b) => a.at - b.at || a.order - b.order);
    let last = 0;
    return list.map((n) => {
      const e = { ...n.event, deltaTime: n.at - last };
      last = n.at;
      return e;
    });
  };
  let at = 0;
  const lead = melody.flatMap((bar) =>
    bar.map(([pitch, duration]) => {
      const n = { at, duration, pitch };
      at += duration;
      return n;
    }),
  );
  const bass = chords.map((c, i) => ({
    at: i * 4,
    duration: 4,
    pitch: c[0] === "G" ? 43 : 48,
  }));
  const pads = chords.flatMap((c, i) =>
    (c[0] === "G" ? [55, 59, 62, 65] : [48, 52, 55]).map((pitch) => ({
      at: i * 4,
      duration: 4,
      pitch,
    })),
  );
  return new Uint8Array(
    writeMidi({
      header: { format: 1, numTracks: 4, ticksPerBeat: 480 },
      tracks: [
        meta,
        make("Melodie", 0, 73, lead),
        make("Bass", 1, 32, bass),
        make("Begleitung", 2, 48, pads),
      ],
    }),
  );
}
