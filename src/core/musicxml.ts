import type { Arrangement, Song, Note, Part, Beat, Rest } from "./model";
import { add, beat, cmp, end, sub, value } from "./time";
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;
function pitchXml(pitch: number) {
  const pc = ((pitch % 12) + 12) % 12,
    spell = [
      ["C", 0],
      ["C", 1],
      ["D", 0],
      ["E", -1],
      ["E", 0],
      ["F", 0],
      ["F", 1],
      ["G", 0],
      ["A", -1],
      ["A", 0],
      ["B", -1],
      ["B", 0],
    ][pc];
  return `<pitch><step>${spell[0]}</step>${spell[1] ? `<alter>${spell[1]}</alter>` : ""}<octave>${Math.floor(pitch / 12) - 1}</octave></pitch>`;
}
/** Expanded performance form, exact rational durations, concert pitches for the piano. */
export function exportMusicXml(music: Song | Arrangement): string {
  const piano = "notes" in music;
  const sourceNotes: (Note | Rest)[] = piano
    ? music.notes
    : [...music.tracks.flatMap((t) => t.notes), ...(music.rests ?? [])];
  const parts: Part[] = piano
    ? [
        {
          id: "Piano",
          name: "Klavier",
          program: 0,
          staves: 2,
          transpositions: [],
        },
      ]
    : music.parts?.length
      ? music.parts
      : music.tracks.map((t, i) => ({
          id: t.id,
          name: t.name,
          program: t.program,
          staves: 1,
          transpositions: [],
        }));
  const assignedPart = (n: Note | Rest) =>
    piano
      ? "Piano"
      : (n.partId ??
        (music as Song).tracks.find((t) => t.id === n.track)?.partId ??
        n.track);
  let divisions = 1;
  for (const n of sourceNotes) {
    divisions = lcm(divisions, n.start.d);
    divisions = lcm(divisions, n.duration.d);
    if (divisions > 1000000)
      throw new Error(
        "Die Zeitauflösung ist für einen verlustfreien MusicXML-Export zu fein.",
      );
  }
  for (const b of music.bars) {
    divisions = lcm(divisions, b.start.d);
    divisions = lcm(divisions, b.duration.d);
  }
  const ticks = (b: Beat) => {
    const n = value(b) * divisions;
    if (Math.abs(n - Math.round(n)) > 1e-6)
      throw new Error("Nicht darstellbare Notendauer.");
    return Math.round(n);
  };
  const partList = parts
    .map(
      (p, i) =>
        `<score-part id="P${i + 1}"><part-name>${escape(p.name)}</part-name><score-instrument id="I${i + 1}"><instrument-name>${escape(p.instrument ?? p.name)}</instrument-name></score-instrument><midi-instrument id="I${i + 1}"><midi-channel>${(i % 15) + 1}</midi-channel><midi-program>${(piano ? 0 : (p.program ?? 0)) + 1}</midi-program></midi-instrument></score-part>`,
    )
    .join("");
  const body = parts
    .map((part, pi) => {
      const notes = sourceNotes.filter((n) => assignedPart(n) === part.id);
      const lanes: { staff: number; until: Beat; id: number }[] = [],
        voices = new Map<string, number>();
      for (const n of [...notes].sort(
        (a, b) =>
          cmp(a.start, b.start) ||
          ("pitch" in a ? a.pitch : -1) - ("pitch" in b ? b.pitch : -1) ||
          a.id.localeCompare(b.id, "en"),
      )) {
        const staff = piano
          ? (n as Note).hand === "left"
            ? 2
            : 1
          : (n.staff ?? 1);
        let lane = lanes.find(
          (l) => l.staff === staff && cmp(l.until, n.start) <= 0,
        );
        if (!lane) {
          lane = { staff, until: beat(0), id: lanes.length + 1 };
          lanes.push(lane);
        }
        voices.set(n.id, lane.id);
        lane.until = end(n);
      }
      return `<part id="P${pi + 1}">${music.bars
        .map((bar, bi) => {
          const stop = add(bar.start, bar.duration),
            units = ticks(bar.duration),
            fragments = notes
              .filter(
                (n) => cmp(n.start, stop) < 0 && cmp(end(n), bar.start) > 0,
              )
              .map((n) => ({
                n,
                start: cmp(n.start, bar.start) < 0 ? bar.start : n.start,
                stop: cmp(end(n), stop) > 0 ? stop : end(n),
              }))
              .sort(
                (a, b) =>
                  cmp(a.start, b.start) ||
                  ("pitch" in a.n ? a.n.pitch : -1) -
                    ("pitch" in b.n ? b.n.pitch : -1) ||
                  a.n.id.localeCompare(b.n.id, "en"),
              );
          const meterChanged =
            !bi ||
            music.bars[bi - 1].numerator !== bar.numerator ||
            music.bars[bi - 1].denominator !== bar.denominator;
          const transpose = piano
            ? 0
            : (part.transpositions
                .filter((t) => cmp(t.at, bar.start) <= 0)
                .at(-1)?.semitones ?? 0);
          const clefs = piano
            ? [
                { staff: 1, sign: "G", line: 2 },
                { staff: 2, sign: "F", line: 4 },
              ]
            : part.clefs?.length
              ? part.clefs
              : [
                  { staff: 1, sign: "G", line: 2 },
                  ...(part.staves > 1
                    ? [{ staff: 2, sign: "F", line: 4 }]
                    : []),
                ];
          let result = `<measure number="${bar.number}"${cmp(bar.duration, beat(bar.numerator * 4, bar.denominator)) < 0 ? ' implicit="yes"' : ""}><attributes><divisions>${divisions}</divisions>${meterChanged ? `<time><beats>${bar.numerator}</beats><beat-type>${bar.denominator}</beat-type></time>` : ""}${!bi ? `<staves>${piano ? 2 : part.staves}</staves>${clefs.map((c) => `<clef number="${c.staff}"><sign>${escape(c.sign)}</sign><line>${c.line}</line></clef>`).join("")}` : ""}${!piano ? `<transpose><chromatic>${transpose}</chromatic></transpose>` : ""}</attributes>`;
          if (pi === 0)
            for (const t of music.tempos.filter(
              (t) => cmp(t.at, bar.start) >= 0 && cmp(t.at, stop) < 0,
            ))
              result += `<direction><offset>${ticks(sub(t.at, bar.start))}</offset><sound tempo="${t.bpm}"/></direction>`;
          if (pi === 0)
            for (const section of music.sections.filter(
              (s) => cmp(s.at, bar.start) >= 0 && cmp(s.at, stop) < 0,
            ))
              result += `<direction><direction-type><rehearsal>${escape(section.name)}</rehearsal></direction-type><offset>${ticks(sub(section.at, bar.start))}</offset></direction>`;
          if (!fragments.length)
            return (
              result +
              `<note><rest/><duration>${units}</duration><voice>1</voice><staff>1</staff></note></measure>`
            );
          // Independent voices preserve arbitrary overlaps without inventing chord durations.
          fragments.forEach((f, index) => {
            if (index)
              result += `<backup><duration>${units}</duration></backup>`;
            const offset = ticks(sub(f.start, bar.start)),
              duration = ticks(sub(f.stop, f.start)),
              staff = piano
                ? (f.n as Note).hand === "left"
                  ? 2
                  : 1
                : (f.n.staff ?? 1);
            if (offset)
              result += `<forward><duration>${offset}</duration></forward>`;
            const tieStop = cmp(f.n.start, bar.start) < 0,
              tieStart = cmp(end(f.n), stop) > 0;
            const pitch =
              "pitch" in f.n
                ? pitchXml(piano ? f.n.pitch : f.n.pitch - transpose)
                : "<rest/>";
            result += `<note>${pitch}<duration>${duration}</duration>${tieStop && "pitch" in f.n ? '<tie type="stop"/>' : ""}${tieStart && "pitch" in f.n ? '<tie type="start"/>' : ""}<voice>${voices.get(f.n.id)}</voice><staff>${staff}</staff></note>`;
            const tail = units - offset - duration;
            if (tail)
              result += `<forward><duration>${tail}</duration></forward>`;
          });
          return result + "</measure>";
        })
        .join("")}</part>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${escape(music.title)}</work-title></work><identification><creator type="composer">${escape(music.artist)}</creator><encoding><software>Jazz Converter 2.0.0</software></encoding></identification><part-list>${partList}</part-list>${body}</score-partwise>`;
}
