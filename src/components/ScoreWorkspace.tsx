import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileMusic,
  Piano,
  SlidersHorizontal,
  Sparkles,
  Headphones,
  AlertTriangle,
} from "lucide-react";
import type {
  Arrangement,
  CatalogSong,
  Difficulty,
  PianoAnalysis,
  Settings,
} from "../core/model";
import { Player } from "./Player";
import { ScoreReview } from "./ScoreReview";
export function ScoreWorkspace({
  record,
  onUpdated,
  onSwing,
  onReady,
}: {
  record: CatalogSong;
  onUpdated: (record: CatalogSong) => void | Promise<void>;
  onSwing: () => void;
  onReady: (arrangement: Arrangement) => void;
}) {
  const [videoTempo, setVideoTempo] = useState(120),
    [videoNumerator, setVideoNumerator] = useState(4),
    [videoDenominator, setVideoDenominator] = useState(4);
  const generation = useRef(0);
  const [analysis, setAnalysis] = useState<PianoAnalysis | null>(null),
    [arrangement, setArrangement] = useState<Arrangement | null>(null),
    [difficulty, setDifficulty] = useState<Difficulty>("easy"),
    [melody, setMelody] = useState("auto"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState(false),
    [mode, setMode] = useState<"listen" | "practice">("listen");
  const settings = (output: "original" | "reduction"): Settings => ({
    style: "swing",
    mode: output,
    difficulty,
    melodyTrackId: melody,
    chords: [],
  });
  async function convert(output: "original" | "reduction", trackId = melody) {
    const token = ++generation.current;
    setArrangement(null);
    setBusy("Klavierfassung wird vorbereitet …");
    setError("");
    try {
      const next =
        record.song.transcription && output === "original"
          ? (
              await window.jazz.getPlaybackVersion(
                record.entry.id,
                { kind: "original" },
                record.sourceRevision,
              )
            ).music
          : await window.jazz.convert(
              record.entry.id,
              {
                ...settings(output),
                melodyTrackId: trackId,
              },
              record.sourceRevision,
            );
      if (token === generation.current) {
        setArrangement(next);
        onReady(next);
      }
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy("");
    }
  }
  useEffect(() => {
    const token = ++generation.current;
    let active = true;
    setArrangement(null);
    setError("");
    setBusy("Spielbarkeit wird geprüft …");
    void window.jazz
      .analyzePiano(record.entry.id, record.settings?.melodyTrackId ?? "auto")
      .then(async (report) => {
        if (!active || token !== generation.current) return;
        setAnalysis(report);
        if (report.issues.some((i) => i.severity === "error")) {
          setReview(true);
          setBusy("");
          return;
        }
        const restored =
          record.settings ??
          ({
            style: "swing",
            mode: report.directlyPlayable ? "original" : "reduction",
            difficulty: "easy",
            melodyTrackId: "auto",
            chords: [],
          } satisfies Settings);
        setDifficulty(restored.difficulty);
        setMelody(restored.melodyTrackId);
        const next = (
          await window.jazz.getPlaybackVersion(
            record.entry.id,
            record.song.transcription
              ? { kind: "original" }
              : { kind: "arrangement", settings: restored },
            record.sourceRevision,
          )
        ).music;
        if (active && token === generation.current) {
          setArrangement(next);
          onReady(next);
          setBusy("");
        }
      })
      .catch((e) => {
        if (active && token === generation.current) {
          setError(e.message);
          setBusy("");
        }
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [record]);
  async function save(xml: boolean, source = false) {
    setBusy("Datei wird gespeichert …");
    setError("");
    try {
      const location = xml
        ? await window.jazz.saveMusicXml(
            record.entry.id,
            source
              ? undefined
              : (arrangement?.playbackVersionId ?? arrangement?.settings),
          )
        : await window.jazz.saveMidi(
            record.entry.id,
            arrangement!.playbackVersionId ?? arrangement!.settings,
          );
      if (location) setNotice(`Gespeichert: ${location}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (review)
    return (
      <ScoreReview
        record={record}
        onClose={() => setReview(false)}
        onSaved={(next) => {
          setReview(false);
          onUpdated(next);
        }}
      />
    );
  const kind = record.song.transcription
    ? "Transkription des Videos"
    : analysis?.kind === "piano"
      ? "Klavierpartitur"
      : analysis?.kind === "solo"
        ? "Einzelinstrument"
        : analysis?.kind === "ensemble"
          ? "Ensemble / Orchester"
          : "Besetzung wird geprüft";
  return (
    <section className="score-workspace">
      <div className="score-summary panel">
        <div className="score-status-icon">
          <Piano size={27} />
        </div>
        <div>
          <span className="eyebrow">{kind}</span>
          <h2>
            {analysis?.directlyPlayable
              ? "Ohne Reduktion auf zwei Hände zuweisbar."
              : "Eine eigene Klavierfassung entsteht."}
          </h2>
          <p>
            {analysis?.reasons[0] ??
              "Tonumfang, gehaltene Töne und Handzuordnung werden geprüft."}
          </p>
        </div>
        <button className="button outline" onClick={() => setReview(true)}>
          <SlidersHorizontal size={16} />
          Noten prüfen
        </button>
      </div>
      {analysis?.issues.length ? (
        <div className="message recognition-warning">
          <AlertTriangle size={18} />
          <span>
            {analysis.issues.length} Hinweis(e) zur Erkennung oder
            Melodiestimme. {analysis.issues[0].message}
          </span>
        </div>
      ) : null}
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="message success" role="status">
          {notice}
        </div>
      )}
      {busy && (
        <p role="status" className="inline-hint">
          {busy}
        </p>
      )}
      {record.song.transcription && (
        <div className="panel video-import">
          <p>
            Die erste Fassung erhält das Aufnahmetiming. Für eine rhythmisch
            passende Jazzbegleitung kannst du Tempo und Taktmaß setzen. Die
            Noten werden dabei zeitlich nicht verschoben.
          </p>
          <label>
            Tempo der Begleitung (BPM)
            <input
              type="number"
              min="30"
              max="300"
              value={videoTempo}
              onChange={(e) => setVideoTempo(Number(e.target.value))}
            />
          </label>
          <label>
            Taktmaß
            <select
              value={`${videoNumerator}/${videoDenominator}`}
              onChange={(e) => {
                const [n, d] = e.target.value.split("/").map(Number);
                setVideoNumerator(n);
                setVideoDenominator(d);
              }}
            >
              {["4/4", "3/4", "6/8", "2/4", "12/8"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <button
            className="button outline"
            disabled={!!busy}
            onClick={async () => {
              setBusy("Taktmaß zuordnen …");
              try {
                await onUpdated(
                  await window.jazz.videoMeter(
                    record.entry.id,
                    videoTempo,
                    videoNumerator,
                    videoDenominator,
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            Zeitbasis zuordnen
          </button>
        </div>
      )}
      <div className="piano-options panel">
        <label>
          Melodiestimme
          <select
            aria-label="Hauptmelodie der Klavierfassung"
            value={melody}
            disabled={!!busy}
            onChange={(e) => {
              setMelody(e.target.value);
              generation.current++;
              setArrangement(null);
            }}
          >
            <option value="auto">
              Automatisch verfolgen · auch bei Instrumentwechsel
            </option>
            {record.song.tracks
              .filter((t) => !t.percussion)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Reduktionsniveau
          <select
            aria-label="Schwierigkeitsgrad Klavierreduktion"
            value={difficulty}
            disabled={!!busy}
            onChange={(e) => {
              setDifficulty(e.target.value as Difficulty);
              generation.current++;
              setArrangement(null);
            }}
          >
            <option value="easy">Einfach · kompakte Griffe</option>
            <option value="medium">Mittel · vollere Klänge</option>
          </select>
        </label>
        <button
          className="button primary"
          disabled={
            !!busy || analysis?.issues.some((i) => i.severity === "error")
          }
          onClick={() =>
            void convert(analysis?.directlyPlayable ? "original" : "reduction")
          }
        >
          <Piano size={17} />
          {analysis?.directlyPlayable
            ? "Original übernehmen"
            : "Klavierfassung erstellen"}
        </button>
        {analysis?.directlyPlayable && (
          <button
            className="button outline"
            disabled={!!busy}
            onClick={() => void convert("reduction")}
          >
            Trotzdem vereinfachen
          </button>
        )}
      </div>
      {arrangement && (
        <>
          <div className="result-banner">
            <span>
              <CheckCircle2 size={20} />
              <strong>
                {arrangement.settings.mode === "original"
                  ? record.song.transcription
                    ? "Erkannte Noten mit Aufnahmetiming."
                    : "Originalnoten erhalten."
                  : (arrangement.settings.mode ?? "swing") === "swing"
                    ? "Swing-Fassung bereit."
                    : "Klavierfassung bereit."}
              </strong>
              {arrangement.settings.mode === "original"
                ? "Max. Oktave · 5 Töne je Hand"
                : difficulty === "easy"
                  ? "Einfach · max. Quinte"
                  : "Mittel · max. Oktave"}
            </span>
          </div>
          <div className="result-actions">
            <div className="tabs">
              <button
                className={mode === "listen" ? "selected" : ""}
                onClick={() => setMode("listen")}
              >
                <Headphones size={17} />
                Anhören
              </button>
              <button
                className={mode === "practice" ? "selected" : ""}
                onClick={() => setMode("practice")}
              >
                <Piano size={17} />
                Üben
              </button>
            </div>
            <div className="score-export-buttons">
              <button
                className="button outline"
                disabled={!!busy}
                onClick={() => void save(true)}
              >
                <FileMusic size={17} />
                MusicXML speichern
              </button>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() => void save(false)}
              >
                <Download size={17} />
                MIDI speichern
              </button>
            </div>
          </div>
          <Player
            music={arrangement}
            mode={mode}
            onError={(e) => setError((e as Error).message)}
          />
          {arrangement.warnings.map((w) => (
            <p key={w} className="inline-hint">
              {w}
            </p>
          ))}
        </>
      )}
      <div className="score-bottom-actions">
        <button
          className="button outline"
          disabled={!!busy}
          onClick={() => void save(true, true)}
        >
          <FileMusic size={17} />
          Erkannte Partitur speichern
        </button>
        <button
          className="button primary"
          disabled={
            !!busy || analysis?.issues.some((i) => i.severity === "error")
          }
          onClick={async () => {
            if (
              record.song.transcription &&
              !record.song.transcription.reviewed
            ) {
              setBusy("Hörkontrolle bestätigen …");
              try {
                const next = await window.jazz.correctScore(
                  record.entry.id,
                  record.song,
                );
                await onUpdated(next);
              } catch (e) {
                setError((e as Error).message);
                return;
              } finally {
                setBusy("");
              }
            }
            onSwing();
          }}
        >
          <Sparkles size={17} />
          {record.song.transcription && !record.song.transcription.reviewed
            ? "Hörkontrolle bestätigen und als Swing arrangieren"
            : "Als Swing arrangieren"}
        </button>
      </div>
      <p className="inline-hint">
        Die unveränderte Zuordnung prüft Griffbelegung und Tonumfang. Schnelle
        Läufe und große Sprünge erfordern zusätzlich eine Prüfung des
        Spieltempos.
      </p>
    </section>
  );
}
