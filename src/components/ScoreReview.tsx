import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import type { CatalogSong, Note, Song, Beat, Rest } from "../core/model";
import { add, beat, cmp, end, sub, value } from "../core/time";
import { changeMeter, changePartTransposition } from "../core/score-review";
import { PdfView } from "./PdfView";
const showBeat = (b: Beat) => (b.d === 1 ? String(b.n) : `${b.n}/${b.d}`);
function readBeat(text: string): Beat {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(text.trim());
  if (m) return beat(Number(m[1]), Number(m[2] ?? 1));
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n))
    throw new Error("Bitte eine Zahl oder einen Bruch wie 1/2 eingeben.");
  return beat(Math.round(n * 10000), 10000);
}
const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const noteName = (p: number) =>
  `${names[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
function readPitch(text: string) {
  const m = /^([A-GH])([#b]?)(-?\d+)$/i.exec(text.trim());
  if (!m) throw new Error("Ton bitte als C4, F#4 oder Bb3 angeben.");
  const pitch =
    12 * (Number(m[3]) + 1) +
    ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 }[m[1].toUpperCase()] ??
      0) +
    (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  if (pitch < 0 || pitch > 127)
    throw new Error("Dieser Ton liegt außerhalb des unterstützten Tonumfangs.");
  return pitch;
}
export function ScoreReview({
  record,
  onSaved,
  onClose,
}: {
  record: CatalogSong;
  onSaved: (record: CatalogSong) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Song>(() => structuredClone(record.song)),
    [barIndex, setBarIndex] = useState(0),
    [page, setPage] = useState(record.song.pdf?.pages[0] ?? 1),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [filter, setFilter] = useState("all");
  const bar = draft.bars[barIndex],
    stop = add(bar.start, bar.duration);
  const notes = draft.tracks
    .flatMap((t) => t.notes)
    .filter(
      (n) =>
        cmp(n.start, stop) < 0 &&
        cmp(end(n), bar.start) > 0 &&
        (filter === "all" || n.partId === filter),
    );
  const rests = (draft.rests ?? []).filter(
    (n) =>
      cmp(n.start, stop) < 0 &&
      cmp(end(n), bar.start) > 0 &&
      (filter === "all" || n.partId === filter),
  );
  const issues = [
    ...new Map(
      [...(record.song.issues ?? []), ...(record.song.pdf?.issues ?? [])].map(
        (i) => [i.id, i],
      ),
    ).values(),
  ];
  function attempt(action: () => void) {
    try {
      action();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function editNote(id: string, patch: Partial<Note>) {
    setDraft({
      ...draft,
      tracks: draft.tracks.map((t) => ({
        ...t,
        notes: t.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      })),
    });
  }
  function editRest(id: string, patch: Partial<Rest>) {
    setDraft({
      ...draft,
      rests: draft.rests?.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  }
  function remove(id: string) {
    setDraft({
      ...draft,
      tracks: draft.tracks.map((t) => ({
        ...t,
        notes: t.notes.filter((n) => n.id !== id),
      })),
      rests: draft.rests?.filter((r) => r.id !== id),
    });
  }
  function move(id: string, isRest: boolean, trackId: string) {
    const target = draft.tracks.find((t) => t.id === trackId)!;
    const metadata = {
      track: trackId,
      partId: target.partId,
      staff: target.staff ?? 1,
      voice: target.notes[0]?.voice ?? "1",
    };
    if (isRest) {
      editRest(id, metadata);
      return;
    }
    const original = draft.tracks
      .flatMap((t) => t.notes)
      .find((n) => n.id === id)!;
    const transpose =
      draft.parts?.find((p) => p.id === target.partId)?.transpositions[0]
        ?.semitones ?? 0;
    setDraft({
      ...draft,
      tracks: draft.tracks.map((t) => ({
        ...t,
        notes: [
          ...t.notes.filter((n) => n.id !== id),
          ...(t.id === trackId
            ? [
                {
                  ...original,
                  ...metadata,
                  writtenPitch: original.pitch - transpose,
                },
              ]
            : []),
        ],
      })),
    });
  }
  function addEvent(rest: boolean) {
    const track =
      draft.tracks.find((t) => filter === "all" || t.partId === filter) ??
      draft.tracks[0];
    const ids = new Set([
      ...draft.tracks.flatMap((t) => t.notes.map((n) => n.id)),
      ...(draft.rests ?? []).map((r) => r.id),
    ]);
    let serial = 1;
    while (ids.has(`edit-${serial}`)) serial++;
    const base = {
      id: `edit-${serial}`,
      track: track.id,
      start: bar.start,
      duration: value(bar.duration) < 1 ? bar.duration : beat(1),
      partId: track.partId,
      staff: track.staff ?? 1,
      voice: "1",
      source: { measure: bar.number, page, partId: track.partId },
    };
    if (rest) setDraft({ ...draft, rests: [...(draft.rests ?? []), base] });
    else
      setDraft({
        ...draft,
        tracks: draft.tracks.map((t) =>
          t.id === track.id
            ? {
                ...t,
                notes: [
                  ...t.notes,
                  {
                    ...base,
                    pitch: 60,
                    writtenPitch:
                      60 -
                      (draft.parts
                        ?.find((p) => p.id === track.partId)
                        ?.transpositions.at(-1)?.semitones ?? 0),
                    velocity: 90,
                  },
                ],
              }
            : t,
        ),
      });
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      const next = await window.jazz.correctScore(record.entry.id, draft);
      onSaved(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="score-review">
      <div className="section-title">
        <div>
          <span className="eyebrow">ORIGINAL UND ERKANNTE NOTEN</span>
          <h2>Noten prüfen und korrigieren</h2>
        </div>
        <button className="button outline" onClick={onClose}>
          Zurück
        </button>
      </div>
      {!!issues.length && (
        <div className="review-issues">
          {issues.map((issue) => (
            <button
              key={issue.id}
              onClick={() => {
                if (issue.source?.page) setPage(issue.source.page);
                setBarIndex(
                  Math.min(
                    draft.bars.length - 1,
                    Math.max(0, (issue.source?.measure ?? 1) - 1),
                  ),
                );
              }}
            >
              <strong>
                {issue.source?.page ? `Seite ${issue.source.page}` : "Partitur"}
                {issue.source?.measure ? ` · Takt ${issue.source.measure}` : ""}
              </strong>
              <span>{issue.message}</span>
            </button>
          ))}
        </div>
      )}
      <div className="score-review-grid">
        {draft.pdf && (
          <div>
            <label className="field">
              Originalseite
              <select
                aria-label="Korrektur PDF-Seite"
                value={page}
                onChange={(e) => setPage(Number(e.target.value))}
              >
                {draft.pdf.pages.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <PdfView id={draft.pdf.sourceHash} page={page} />
          </div>
        )}
        <div className="panel">
          <div className="review-toolbar">
            <label>
              Takt
              <select
                aria-label="Korrektur Takt"
                value={barIndex}
                onChange={(e) => {
                  const index = Number(e.target.value);
                  setBarIndex(index);
                  const first = draft.tracks
                    .flatMap((t) => t.notes)
                    .find(
                      (n) =>
                        cmp(n.start, draft.bars[index].start) >= 0 &&
                        n.source?.page,
                    );
                  if (first?.source?.page) setPage(first.source.page);
                }}
              >
                {draft.bars.map((b, i) => (
                  <option key={b.number} value={i}>
                    {b.number}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Instrument
              <select
                aria-label="Instrument filtern"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Alle</option>
                {draft.parts?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Taktmaß
              <div className="meter-edit">
                <input
                  aria-label="Zähler des Taktmaßes"
                  key={`n-${barIndex}-${bar.numerator}`}
                  type="number"
                  defaultValue={bar.numerator}
                  onBlur={(e) =>
                    attempt(() =>
                      setDraft(
                        changeMeter(
                          draft,
                          barIndex,
                          Number(e.target.value),
                          bar.denominator,
                        ),
                      ),
                    )
                  }
                />
                <span>/</span>
                <select
                  aria-label="Nenner des Taktmaßes"
                  value={bar.denominator}
                  onChange={(e) =>
                    attempt(() =>
                      setDraft(
                        changeMeter(
                          draft,
                          barIndex,
                          bar.numerator,
                          Number(e.target.value),
                        ),
                      ),
                    )
                  }
                >
                  {[1, 2, 4, 8, 16, 32].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
            </label>
          </div>
          <p className="inline-hint">
            Tonhöhe klingend, z. B. C4 oder Bb3 (B entspricht H). Beginn und
            Länge in Viertelnoten: 1 = Viertel, 1/2 = Achtel. Beginn 0 ist der
            Taktanfang.
          </p>
          <div className="review-table-scroll">
            <table className="review-table">
              <thead>
                <tr>
                  <th>Ton / Pause</th>
                  <th>Beginn</th>
                  <th>Länge</th>
                  <th>System</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[
                  ...notes.map((n) => ({ ...n, isRest: false })),
                  ...rests.map((r) => ({ ...r, isRest: true, pitch: 0 })),
                ]
                  .sort((a, b) => cmp(a.start, b.start) || a.pitch - b.pitch)
                  .map((n) => (
                    <tr key={n.id}>
                      <td>
                        {n.isRest ? (
                          <span>Pause</span>
                        ) : (
                          <input
                            aria-label={`Ton ${n.id}`}
                            key={`${n.id}-${n.pitch}`}
                            defaultValue={noteName(n.pitch)}
                            onBlur={(e) =>
                              attempt(() => {
                                const pitch = readPitch(e.target.value),
                                  previous = draft.tracks
                                    .flatMap((t) => t.notes)
                                    .find((p) => p.id === n.id)!;
                                editNote(n.id, {
                                  pitch,
                                  writtenPitch:
                                    (previous.writtenPitch ?? previous.pitch) +
                                    pitch -
                                    previous.pitch,
                                });
                              })
                            }
                          />
                        )}
                      </td>
                      <td>
                        <input
                          aria-label={`Beginn ${n.id}`}
                          key={`${n.id}-start-${showBeat(n.start)}`}
                          defaultValue={showBeat(sub(n.start, bar.start))}
                          onBlur={(e) =>
                            attempt(() => {
                              const start = add(
                                bar.start,
                                readBeat(e.target.value),
                              );
                              n.isRest
                                ? editRest(n.id, { start })
                                : editNote(n.id, { start });
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Länge ${n.id}`}
                          key={`${n.id}-duration-${showBeat(n.duration)}`}
                          defaultValue={showBeat(n.duration)}
                          onBlur={(e) =>
                            attempt(() => {
                              const duration = readBeat(e.target.value);
                              n.isRest
                                ? editRest(n.id, { duration })
                                : editNote(n.id, { duration });
                            })
                          }
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Notensystem ${n.id}`}
                          value={n.staff ?? 1}
                          onChange={(e) => {
                            const staff = Number(e.target.value);
                            n.isRest
                              ? editRest(n.id, { staff })
                              : editNote(n.id, { staff });
                          }}
                        >
                          {Array.from(
                            {
                              length: Math.max(
                                1,
                                draft.parts?.find((p) => p.id === n.partId)
                                  ?.staves ?? 1,
                              ),
                            },
                            (_, i) => (
                              <option key={i + 1}>{i + 1}</option>
                            ),
                          )}
                        </select>
                        <select
                          aria-label={`Stimme ${n.id}`}
                          value={n.track}
                          onChange={(e) => move(n.id, n.isRest, e.target.value)}
                        >
                          {draft.tracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`${n.isRest ? "Pause" : "Note"} löschen ${n.id}`}
                          onClick={() => remove(n.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="review-add">
            <button className="text-button" onClick={() => addEvent(false)}>
              <Plus size={15} />
              Note ergänzen
            </button>
            <button className="text-button" onClick={() => addEvent(true)}>
              <Plus size={15} />
              Pause ergänzen
            </button>
          </div>
          {!!draft.parts?.length && (
            <details className="part-editor">
              <summary>Instrumente und Transpositionen prüfen</summary>
              {draft.parts.map((part) => (
                <label key={part.id}>
                  <input
                    aria-label={`Instrumentenname ${part.id}`}
                    value={part.name}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        parts: draft.parts!.map((p) =>
                          p.id === part.id ? { ...p, name: e.target.value } : p,
                        ),
                      })
                    }
                  />
                  <select
                    aria-label={`Transposition ${part.id}`}
                    value={part.transpositions[0]?.semitones ?? 0}
                    onChange={(e) =>
                      attempt(() =>
                        setDraft(
                          changePartTransposition(
                            draft,
                            part.id,
                            Number(e.target.value),
                          ),
                        ),
                      )
                    }
                  >
                    {Array.from({ length: 49 }, (_, i) => i - 24).map((n) => (
                      <option key={n} value={n}>
                        {n === 0
                          ? "Klingend (0)"
                          : n === -2
                            ? "B-Instrument (−2)"
                            : n === -7
                              ? "F-Instrument (−7)"
                              : `${n > 0 ? "+" : ""}${n} Halbtöne`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </details>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <p className="inline-hint">
            Mit „Geprüfte Noten übernehmen“ bestätigst du auch die markierten
            Erkennungsstellen. Original-PDF und rohe Erkennung bleiben erhalten.
          </p>
          <button
            className="button primary"
            disabled={saving}
            onClick={() => void save()}
          >
            <Check size={17} />
            Geprüfte Noten übernehmen
          </button>
        </div>
      </div>
    </section>
  );
}
