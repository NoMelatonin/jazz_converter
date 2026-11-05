import { XMLParser, XMLValidator } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import type {
  Bar,
  Beat,
  Chord,
  Meter,
  Note,
  Section,
  Song,
  Tempo,
  Track,
  Part,
  Rest,
  ReviewIssue,
} from "./model";
import { add, beat, cmp, end, max, mul, sub, value } from "./time";
import { rankTracks } from "./melody";
import { parseChord } from "./harmony";
import { instrumentTransposition } from "./instruments";

type Element = {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: Element[];
};
const children = (e: Element, name: string) =>
  e.children.filter((c) => c.name === name);
const child = (e: Element, name: string) =>
  e.children.find((c) => c.name === name);
const txt = (e: Element, name: string, fallback = "") =>
  child(e, name)?.text ?? fallback;
const num = (e: Element, name: string, fallback = 0) =>
  Number(txt(e, name, String(fallback)));
function tree(raw: any[]): Element[] {
  return raw.flatMap((item) =>
    Object.keys(item)
      .filter((k) => k !== ":@" && k !== "#text" && !k.startsWith("?"))
      .map((name) => ({
        name,
        attrs: Object.fromEntries(
          Object.entries(item[":@"] ?? {}).map(([k, v]) => [
            k.replace(/^@_/, ""),
            String(v),
          ]),
        ),
        text: Array.isArray(item[name])
          ? item[name]
              .filter((v: any) => v["#text"] !== undefined)
              .map((v: any) => String(v["#text"]))
              .join("")
          : "",
        children: Array.isArray(item[name]) ? tree(item[name]) : [],
      })),
  );
}
function parse(text: string): Element[] {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text))
    throw new Error(
      "MusicXML mit eigenen DTD-Entitäten wird nicht geöffnet. Bitte ohne interne DTD exportieren.",
    );
  // Standard MusicXML exports often declare an external DTD. Ignore that declaration;
  // never resolve or fetch it. Internal subsets and custom entities remain forbidden.
  text = text.replace(
    /<!DOCTYPE\s+score-(?:partwise|timewise)\s+(?:PUBLIC\s+"[^"]*"\s+"[^"]*"|SYSTEM\s+"[^"]*")\s*>/gi,
    "",
  );
  if (/<!DOCTYPE/i.test(text))
    throw new Error(
      "Nicht unterstützte DTD. Bitte als MusicXML ohne eigene DTD exportieren.",
    );
  if (XMLValidator.validate(text) !== true)
    throw new Error("Die MusicXML-Datei ist beschädigt.");
  return tree(
    new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      parseTagValue: false,
      trimValues: true,
    }).parse(text),
  );
}

function xmlText(bytes: Uint8Array, filename: string) {
  if (!filename.toLowerCase().endsWith(".mxl")) return strFromU8(bytes);
  let total = 0;
  let count = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (
        ++count > 2000 ||
        file.originalSize > 32 * 1024 * 1024 ||
        (total += file.originalSize) > 64 * 1024 * 1024
      )
        throw new Error("Das MXL-Archiv ist zu groß.");
      if (file.name.includes("..") || file.name.startsWith("/"))
        throw new Error("Ungültiger Pfad im MXL-Archiv.");
      return !file.name.endsWith("/");
    },
  });
  const container = files["META-INF/container.xml"];
  if (!container)
    throw new Error("Im MXL-Archiv fehlt META-INF/container.xml.");
  const root = parse(strFromU8(container)).find((e) => e.name === "container");
  const roots = root && child(root, "rootfiles");
  const path = roots && child(roots, "rootfile")?.attrs["full-path"];
  if (!path || !files[path])
    throw new Error("Die Partitur im MXL-Archiv wurde nicht gefunden.");
  return strFromU8(files[path]);
}

function measureSequence(measures: Element[]): number[] {
  let ending: number[] = [];
  const endings: number[][] = [];
  for (const m of measures) {
    for (const barline of children(m, "barline")) {
      const e = child(barline, "ending");
      if (e?.attrs.type === "start")
        ending = e.attrs.number.split(/[, ]+/).map(Number);
    }
    endings.push([...ending]);
    if (
      children(m, "barline").some((b) =>
        ["stop", "discontinue"].includes(child(b, "ending")?.attrs.type ?? ""),
      )
    )
      ending = [];
  }
  const result: number[] = [],
    stack: { start: number; pass: number }[] = [];
  let carriedPass = 1;
  for (let i = 0, guard = 0; i < measures.length; guard++) {
    if (guard > measures.length * 32 || result.length >= 20000)
      throw new Error(
        "Die Wiederholungsstruktur ist zu komplex. Bitte als MIDI mit ausgeschriebenen Wiederholungen importieren.",
      );
    const m = measures[i];
    const repeats = children(m, "barline")
      .map((b) => child(b, "repeat"))
      .filter(Boolean) as Element[];
    if (
      repeats.some((r) => r.attrs.direction === "forward") &&
      stack.at(-1)?.start !== i
    )
      stack.push({ start: i, pass: 1 });
    const pass = stack.at(-1)?.pass ?? carriedPass;
    if (!endings[i].length || endings[i].includes(pass)) result.push(i);
    const backward = repeats.find((r) => r.attrs.direction === "backward");
    if (backward) {
      if (!stack.length) stack.push({ start: 0, pass: 1 });
      const frame = stack.at(-1)!;
      const times = Number(backward.attrs.times ?? 2);
      if (!Number.isInteger(times) || times < 1 || times > 8)
        throw new Error("Ungültige Wiederholungsanzahl.");
      if (frame.pass < times) {
        frame.pass++;
        i = frame.start;
        continue;
      }
      carriedPass = frame.pass;
      stack.pop();
    } else if (!endings[i].length && !stack.length) carriedPass = 1;
    i++;
  }
  return result;
}

export function importXml(
  bytes: Uint8Array,
  filename: string,
  options: { lenient?: boolean } = {},
): Song {
  const roots = parse(xmlText(bytes, filename));
  let root = roots.find(
    (e) => e.name === "score-partwise" || e.name === "score-timewise",
  );
  if (!root) throw new Error("Keine MusicXML-Partitur gefunden.");
  if (root.name === "score-timewise") {
    const parts = new Map<string, Element>();
    for (const measure of children(root, "measure"))
      for (const part of children(measure, "part")) {
        const id = part.attrs.id;
        if (!parts.has(id))
          parts.set(id, {
            name: "part",
            attrs: { id },
            text: "",
            children: [],
          });
        parts.get(id)!.children.push({ ...measure, children: part.children });
      }
    root = {
      ...root,
      name: "score-partwise",
      children: [
        ...root.children.filter((c) => c.name !== "measure"),
        ...parts.values(),
      ],
    };
  }
  const partNames = new Map(
    (child(root, "part-list")?.children ?? [])
      .filter((p) => p.name === "score-part")
      .map((p) => [p.attrs.id, txt(p, "part-name", p.attrs.id)]),
  );
  const parts = children(root, "part");
  const scoreParts: Part[] = parts.map((part) => {
    const definition = child(root!, "part-list")?.children.find(
      (p) => p.name === "score-part" && p.attrs.id === part.attrs.id,
    );
    const instrument = definition && child(definition, "score-instrument");
    const midi = definition && child(definition, "midi-instrument");
    return {
      id: part.attrs.id,
      name: partNames.get(part.attrs.id) ?? part.attrs.id,
      instrument: instrument ? txt(instrument, "instrument-name") : undefined,
      program:
        midi && child(midi, "midi-program")
          ? num(midi, "midi-program") - 1
          : undefined,
      percussion: !!midi && !!child(midi, "midi-unpitched"),
      staves: 1,
      transpositions: [],
    };
  });
  if (!parts.length)
    throw new Error("Die MusicXML-Datei enthält keine Stimmen.");
  const firstMeasures = children(parts[0], "measure");
  let sharedDivisions = 1;
  const divisionMap = firstMeasures.map((m) => {
    const a = child(m, "attributes");
    if (a && child(a, "divisions")) sharedDivisions = num(a, "divisions", 1);
    return sharedDivisions;
  });
  const sequence = measureSequence(firstMeasures);
  const tracks = new Map<string, Track>(),
    tempos: Tempo[] = [{ at: beat(0), bpm: 120 }],
    meters: Meter[] = [],
    bars: Bar[] = [],
    chords: Chord[] = [],
    sections: Section[] = [],
    warnings: string[] = [];
  const rests: Rest[] = [],
    issues: ReviewIssue[] = [];
  let key: Song["key"];
  let totalNotes = 0;
  // Read each source measure before repetition expansion so divisions and meter retain their source meaning.
  const parsedParts = parts.map((part, pi) => {
    const ownDivisions = children(part, "measure").some((m) => {
      const a = child(m, "attributes");
      return a && child(a, "divisions");
    });
    let divisions = 1,
      numerator = 4,
      denominator = 4,
      currentTempo = 120,
      transpose = 0,
      page = 1;
    const label = `${scoreParts[pi].name} ${scoreParts[pi].instrument ?? ""}`;
    const explicit = children(part, "measure").some((m) =>
      children(m, "attributes").some((a) => child(a, "transpose")),
    );
    if (!explicit) {
      transpose = instrumentTransposition(label) ?? 0;
      if (transpose)
        scoreParts[pi].transpositions.push({
          at: beat(0),
          semitones: transpose,
        });
      else if (
        options.lenient &&
        /clarinet|klarinette|trumpet|trompete|horn|sax/i.test(label)
      )
        issues.push({
          id: `transpose-${part.attrs.id}`,
          severity: "warning",
          kind: "instrument",
          message: `Bei „${scoreParts[pi].name}“ ist die Instrumententransposition nicht angegeben. Klingende Tonhöhe prüfen.`,
          source: { page: 1, measure: 1, partId: part.attrs.id },
        });
    }
    return children(part, "measure").map((measure, mi) => {
      if (!ownDivisions) divisions = divisionMap[mi] ?? divisionMap.at(-1) ?? 1;
      const print = child(measure, "print");
      if (mi && print?.attrs["new-page"] === "yes") page++;
      const source = { page, measure: mi + 1, partId: part.attrs.id };
      const issue = (
        message: string,
        severity: "warning" | "error" = "error",
      ) =>
        issues.push({
          id: `xml-${pi}-${mi}-${issues.length}`,
          severity,
          kind: "recognition",
          message,
          source,
        });
      const startingTempo = currentTempo;
      let cursor = beat(0),
        lastStart = beat(0),
        extent = beat(0);
      const notes: Note[] = [],
        localChords: Chord[] = [],
        localTempos: Tempo[] = [],
        localSections: Section[] = [],
        localRests: Rest[] = [],
        transpositions: { at: Beat; semitones: number }[] = [];
      for (const el of measure.children) {
        if (el.name === "attributes") {
          if (child(el, "divisions")) divisions = num(el, "divisions");
          if (child(el, "staves"))
            scoreParts[pi].staves = Math.max(
              scoreParts[pi].staves,
              num(el, "staves", 1),
            );
          const clefs = children(el, "clef").map((c) => ({
            staff: Number(c.attrs.number ?? 1),
            sign: txt(c, "sign"),
            line: num(c, "line", 2),
          }));
          if (clefs.length && !scoreParts[pi].clefs?.length)
            scoreParts[pi].clefs = clefs;
          const trans = child(el, "transpose");
          if (trans) {
            transpose =
              num(trans, "chromatic") + num(trans, "octave-change") * 12;
            if (!Number.isInteger(transpose))
              throw new Error(
                "Mikrotonale Instrumententransposition wird nicht unterstützt.",
              );
            transpositions.push({ at: cursor, semitones: transpose });
          }
          const time = child(el, "time");
          if (time) {
            const counts = children(time, "beats").map((e) =>
              e.text.split("+").reduce((sum, n) => sum + Number(n), 0),
            );
            const units = children(time, "beat-type").map((e) =>
              Number(e.text),
            );
            if (
              !counts.length ||
              counts.length !== units.length ||
              units.some(
                (n) => n < 1 || n > 128 || !Number.isInteger(Math.log2(n)),
              )
            )
              throw new Error(
                "Nicht unterstütztes Taktmaß. Bitte mit ausgeschriebenen Takten als MIDI importieren.",
              );
            denominator = Math.max(...units);
            numerator = counts.reduce(
              (sum, n, i) => sum + (n * denominator) / units[i],
              0,
            );
          }
          const k = child(el, "key");
          if (k && pi === 0)
            key = {
              root:
                ((txt(k, "mode") === "minor" ? 9 : 0) +
                  num(k, "fifths") * 7 +
                  120) %
                12,
              minor: txt(k, "mode") === "minor",
            };
          if (
            !Number.isInteger(divisions) ||
            divisions <= 0 ||
            numerator <= 0 ||
            denominator <= 0
          )
            throw new Error("Ungültige MusicXML-Zeiteinteilung.");
        }
        if (el.name === "backup")
          cursor = sub(cursor, beat(num(el, "duration"), divisions));
        if (el.name === "forward")
          cursor = add(cursor, beat(num(el, "duration"), divisions));
        if (value(cursor) < 0)
          throw new Error("Ungültige Stimmenposition in MusicXML.");
        if (el.name === "direction") {
          const sound = child(el, "sound");
          if (
            sound &&
            ["dacapo", "dalsegno", "tocoda", "fine"].some((k) => sound.attrs[k])
          ) {
            if (!options.lenient)
              throw new Error(
                "D.C./D.S./Coda bitte vor dem Import ausschreiben oder als MIDI exportieren.",
              );
            issue(
              "D.C./D.S./Coda erkannt: Ablauf vor der Übernahme prüfen und ausschreiben.",
            );
          }
          const metronome = child(
            child(el, "direction-type") ?? el,
            "metronome",
          );
          let bpm = Number(sound?.attrs.tempo ?? 0);
          if (!bpm && metronome) {
            const unit = txt(metronome, "beat-unit", "quarter");
            const factor =
              (
                { whole: 4, half: 2, quarter: 1, eighth: 0.5 } as Record<
                  string,
                  number
                >
              )[unit] ?? 1;
            bpm =
              num(metronome, "per-minute") *
              factor *
              (child(metronome, "beat-unit-dot") ? 1.5 : 1);
          }
          const at = add(cursor, beat(num(el, "offset"), divisions));
          if (bpm) {
            if (bpm < 10 || bpm > 1000)
              throw new Error("Nicht unterstütztes Tempo.");
            localTempos.push({ at, bpm });
            currentTempo = bpm;
          }
          const rehearsal = child(
            child(el, "direction-type") ?? el,
            "rehearsal",
          );
          if (rehearsal?.text) localSections.push({ at, name: rehearsal.text });
        }
        if (el.name === "harmony") {
          if (children(el, "degree").length) {
            if (!options.lenient)
              throw new Error(
                "Veränderte Akkorderweiterungen bitte vor dem MusicXML-Import vereinfachen oder als MIDI importieren.",
              );
            issue("Veränderten Akkord bitte nachtragen.", "warning");
            continue;
          }
          const rootNote = child(el, "root");
          if (!rootNote) continue;
          const alter = num(rootNote, "root-alter");
          const kind = txt(el, "kind", "major");
          const suffix = (
            {
              major: "",
              minor: "m",
              dominant: "7",
              "major-seventh": "maj7",
              "minor-seventh": "m7",
              diminished: "dim",
              "diminished-seventh": "dim7",
              "half-diminished": "ø7",
              augmented: "aug",
              suspended: "sus4",
              "suspended-fourth": "sus4",
              "suspended-second": "sus2",
              "major-sixth": "6",
              "minor-sixth": "m6",
            } as Record<string, string>
          )[kind];
          if (suffix === undefined) {
            if (!options.lenient)
              throw new Error(
                `Der Akkordtyp „${kind}“ wird noch nicht unterstützt. Bitte in MusicXML vereinfachen.`,
              );
            issue(`Akkordtyp ${kind}: Harmonie prüfen.`, "warning");
            continue;
          }
          let symbol =
            txt(rootNote, "root-step") +
            (alter === 1 ? "#" : alter === -1 ? "b" : "") +
            suffix;
          const bass = child(el, "bass");
          if (bass)
            symbol +=
              "/" +
              txt(bass, "bass-step") +
              (num(bass, "bass-alter") === 1
                ? "#"
                : num(bass, "bass-alter") === -1
                  ? "b"
                  : "");
          if (transpose) {
            const parsed = parseChord(symbol);
            if (parsed) {
              const names = [
                "C",
                "C#",
                "D",
                "Eb",
                "E",
                "F",
                "F#",
                "G",
                "Ab",
                "A",
                "Bb",
                "B",
              ];
              symbol =
                names[(parsed.root + transpose + 120) % 12] +
                suffix +
                (child(el, "bass")
                  ? "/" + names[(parsed.bass + transpose + 120) % 12]
                  : "");
            }
          }
          if (!parseChord(symbol))
            throw new Error(`Ungültiger Akkord: ${symbol}`);
          localChords.push({
            id: `x-ch-${pi}-${mi}-${localChords.length}`,
            at: add(cursor, beat(num(el, "offset"), divisions)),
            duration: beat(0),
            symbol,
            confidence: 1,
            source: "provided",
          });
        }
        if (el.name !== "note") continue;
        if (child(el, "grace")) {
          if (!options.lenient)
            throw new Error(
              "Vorschlagsnoten bitte ausschreiben oder die Partitur als MIDI importieren.",
            );
          issue(
            "Vorschlagsnote erkannt, aber noch nicht zeitlich zugeordnet. Bitte ergänzen oder ausdrücklich prüfen.",
          );
          continue;
        }
        const isChord = !!child(el, "chord");
        const start = isChord ? lastStart : cursor;
        const duration = beat(num(el, "duration"), divisions);
        if (!isChord) {
          lastStart = cursor;
          cursor = add(cursor, duration);
        }
        extent = max(extent, add(start, duration), cursor);
        const staff = num(el, "staff", 1),
          voice = txt(el, "voice", "1"),
          trackId = `xml-${part.attrs.id}-${voice}`;
        if (child(el, "rest")) {
          localRests.push({
            id: `rest-${pi}-${mi}-${localRests.length}`,
            start,
            duration,
            track: trackId,
            partId: part.attrs.id,
            staff,
            voice,
            source,
          });
          continue;
        }
        const p = child(el, "pitch");
        if (!p) {
          warnings.push("Unbestimmte Schlagzeugnoten wurden ausgelassen.");
          continue;
        }
        const writtenPitch =
          12 * (num(p, "octave") + 1) +
          (
            { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<
              string,
              number
            >
          )[txt(p, "step")] +
          num(p, "alter");
        const pitch = writtenPitch + transpose;
        if (
          !Number.isInteger(pitch) ||
          pitch < 0 ||
          pitch > 127 ||
          value(duration) <= 0
        )
          throw new Error("Ungültige Tonhöhe oder Notendauer.");
        if (!tracks.has(trackId))
          tracks.set(trackId, {
            id: trackId,
            name: `${partNames.get(part.attrs.id) ?? part.attrs.id} · Stimme ${txt(el, "voice", "1")}`,
            notes: [],
            score: 0,
            partId: part.attrs.id,
            staff,
            instrument: scoreParts[pi].instrument,
            program: scoreParts[pi].program,
            percussion: scoreParts[pi].percussion,
          });
        const tie = children(el, "tie").map((t) => t.attrs.type);
        notes.push({
          id: `x-${pi}-${mi}-${++totalNotes}${tie.includes("stop") ? ":tie-stop" : ""}${tie.includes("start") ? ":tie-start" : ""}`,
          pitch,
          start,
          duration,
          velocity: 90,
          track: trackId,
          partId: part.attrs.id,
          staff,
          voice,
          writtenPitch,
          source: {
            ...source,
            x: Number(el.attrs["default-x"]) || undefined,
            y: Number(el.attrs["default-y"]) || undefined,
          },
        });
        if (totalNotes > 200000)
          throw new Error("Die Datei enthält zu viele Noten.");
      }
      const nominal = beat(numerator * 4, denominator);
      if (
        options.lenient &&
        measure.attrs.implicit !== "yes" &&
        cmp(extent, nominal) > 0
      )
        issue(
          `Takt ${mi + 1} enthält ${value(extent)} Viertel statt ${value(nominal)}. Notenwerte und Taktmaß prüfen.`,
        );
      const duration =
        measure.attrs.implicit === "yes" ? extent : max(nominal, extent);
      if (value(duration) <= 0) throw new Error("Leerer Auftakt ohne Dauer.");
      return {
        notes,
        localChords,
        localTempos,
        localSections,
        duration,
        numerator,
        denominator,
        startingTempo,
        localRests,
        transpositions,
      };
    });
  });
  let at = beat(0);
  for (const [occurrence, index] of sequence.entries()) {
    const first = parsedParts[0][index];
    if (!first) continue;
    const length = max(
      ...parsedParts.map((p) => p[index]?.duration ?? beat(0)),
    );
    bars.push({
      number: bars.length + 1,
      start: at,
      duration: length,
      numerator: first.numerator,
      denominator: first.denominator,
    });
    if (
      !meters.length ||
      meters.at(-1)!.numerator !== first.numerator ||
      meters.at(-1)!.denominator !== first.denominator
    )
      meters.push({
        at,
        numerator: first.numerator,
        denominator: first.denominator,
      });
    for (let pi = 0; pi < parsedParts.length; pi++) {
      const measure = parsedParts[pi][index];
      if (!measure) continue;
      for (const n of measure.notes) {
        const notes = tracks.get(n.track)!.notes,
          start = add(at, n.start);
        const previous = [...notes]
          .reverse()
          .find(
            (p) =>
              p.pitch === n.pitch &&
              cmp(end(p), start) === 0 &&
              p.id.includes(":tie-start"),
          );
        if (n.id.includes(":tie-stop") && previous) {
          previous.duration = add(previous.duration, n.duration);
          if (!n.id.includes(":tie-start"))
            previous.id = previous.id.replace(":tie-start", "");
        } else notes.push({ ...n, id: `${n.id}-${occurrence}`, start });
      }
      rests.push(
        ...measure.localRests.map((r) => ({
          ...r,
          id: `${r.id}-${occurrence}`,
          start: add(at, r.start),
        })),
      );
      scoreParts[pi].transpositions.push(
        ...measure.transpositions.map((t) => ({ ...t, at: add(at, t.at) })),
      );
      if (pi === 0 || !parsedParts[0][index].localChords.length)
        chords.push(
          ...measure.localChords.map((c) => ({
            ...c,
            id: `${c.id}-${occurrence}`,
            at: add(at, c.at),
          })),
        );
      if (pi === 0) {
        tempos.push(
          { at, bpm: measure.startingTempo },
          ...measure.localTempos.map((t) => ({ ...t, at: add(at, t.at) })),
        );
        sections.push(
          ...measure.localSections.map((s) => ({ ...s, at: add(at, s.at) })),
        );
      }
    }
    at = add(at, length);
  }
  if (![...tracks.values()].some((t) => t.notes.length))
    throw new Error("Die Partitur enthält keine spielbaren Noten.");
  chords.sort((a, b) => cmp(a.at, b.at));
  const uniqueChords = chords.filter(
    (c, i) => !chords[i + 1] || cmp(c.at, chords[i + 1].at) !== 0,
  );
  uniqueChords.forEach(
    (c, i) => (c.duration = sub(uniqueChords[i + 1]?.at ?? at, c.at)),
  );
  tempos.sort((a, b) => cmp(a.at, b.at));
  const lastTempos = tempos.filter(
    (t, i) => !tempos[i + 1] || cmp(t.at, tempos[i + 1].at) !== 0,
  );
  const uniqueTempos = lastTempos.filter(
    (t, i) => !i || lastTempos[i - 1].bpm !== t.bpm,
  );
  return {
    id: "",
    title:
      txt(root, "movement-title") ||
      txt(child(root, "work") ?? root, "work-title") ||
      filename.replace(/\.(musicxml|mxl)$/i, ""),
    artist:
      children(child(root, "identification") ?? root, "creator").find(
        (c) => c.attrs.type === "composer",
      )?.text || "Unbekannt",
    format: filename.endsWith(".mxl") ? "MXL" : "MusicXML",
    tracks: rankTracks([...tracks.values()].filter((t) => t.notes.length)),
    tempos: uniqueTempos,
    meters,
    bars,
    sections,
    chords: uniqueChords,
    duration: at,
    warnings: [...new Set(warnings)],
    key,
    parts: scoreParts,
    rests,
    issues,
    schemaVersion: 2,
  };
}
