import { useEffect, useState } from "react";
import type { CatalogSong } from "../core/model";
import type { VideoJob, VideoTools, Calibration } from "../core/video";
export function VideoImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (record: CatalogSong) => void;
}) {
  const [tools, setTools] = useState<VideoTools | null>(null),
    [job, setJob] = useState<VideoJob | null>(null),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [method, setMethod] = useState<"visual" | "audio">("audio"),
    [points, setPoints] = useState<number[]>([]),
    [frame, setFrame] = useState(0),
    [imageHeight, setImageHeight] = useState(405);
  const [offsetMs, setOffsetMs] = useState(0);
  const active = job?.status === "running";
  useEffect(() => {
    window.jazz
      .videoTools()
      .then(setTools)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!job || job.status !== "running") return;
    let alive = true;
    const timer = setInterval(() => {
      window.jazz
        .videoStatus(job.id)
        .then(async (next) => {
          if (!alive) return;
          setJob(next);
          if (next.status === "complete" && !next.result)
            setTools(await window.jazz.videoTools());
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  async function action(fn: () => Promise<VideoJob>) {
    setError("");
    try {
      setJob(await fn());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const calibration: Calibration | undefined =
    points.length === 3
      ? { c4: points[0], c5: points[1], line: points[2], offsetMs }
      : undefined;
  return (
    <section className="panel video-import">
      <div className="score-bottom-actions">
        <h2>Klaviervideo importieren</h2>
        <button className="button outline" disabled={active} onClick={onClose}>
          Schließen
        </button>
      </div>
      <p>
        Rekonstruierte Noten zum Anhören und Bearbeiten. Die Erkennung kann
        Fehler enthalten; sie liefert keine offiziell originale Partitur.
      </p>
      <p>{tools?.message ?? "Voraussetzungen prüfen …"}</p>
      {!tools?.ready && (
        <button
          className="button primary"
          disabled={active || !tools}
          onClick={() => action(() => window.jazz.videoSetup())}
        >
          Lokale Videoverarbeitung einrichten
        </button>
      )}
      {tools?.ready && (
        <button
          className="button outline"
          disabled={active}
          onClick={() => action(() => window.jazz.videoSetup())}
        >
          Komponenten erneut prüfen / einrichten
        </button>
      )}
      {tools?.ready && !job?.result && (
        <>
          <label>
            YouTube-Link
            <input
              aria-label="YouTube-Link"
              value={url}
              disabled={active}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </label>
          <div className="score-bottom-actions">
            <button
              className="button primary"
              disabled={active || !url.trim()}
              onClick={() => {
                setPoints([]);
                action(() => window.jazz.videoPrepare({ url: url.trim() }));
              }}
            >
              Link laden
            </button>
            <button
              className="button outline"
              disabled={active}
              onClick={async () => {
                try {
                  const file = await window.jazz.videoPick();
                  if (file) {
                    setPoints([]);
                    await action(() => window.jazz.videoPrepare({ file }));
                  }
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Lokale Videodatei öffnen
            </button>
          </div>
          <p className="inline-hint">
            Einzelvideos bis 30 Minuten, lokale Dateien bis 2 GB. Nutze Quellen,
            die du verarbeiten darfst. Bei YouTube-Sperren bleibt die lokale
            Datei als Alternative.
          </p>
        </>
      )}
      {job && (
        <>
          <p role="status">{job.message}</p>
          {active && (
            <>
              <progress max={1} value={job.progress} />
              <button
                className="button outline"
                onClick={() => action(() => window.jazz.videoCancel(job.id))}
              >
                Abbrechen
              </button>
            </>
          )}
        </>
      )}
      {(error || job?.error) && (
        <p className="message error" role="alert">
          {error || job?.error}
        </p>
      )}
      {job?.previews &&
        !job.result &&
        !active &&
        job.status !== "cancelled" && (
          <>
            <h3>{job.title}</h3>
            <label>
              Erkennungsverfahren
              <select
                aria-label="Erkennungsverfahren"
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as "visual" | "audio")
                }
              >
                <option value="audio">
                  Audio · lokale polyphone Klaviererkennung
                </option>
                <option value="visual">
                  Bild · farbige fallende Noten mit fester Klaviatur
                </option>
              </select>
            </label>
            <p>
              {method === "visual"
                ? "Markiere nacheinander die Mitte von C4 (mittleres C), C5 (eine Oktave höher) und die Anschlaglinie direkt oberhalb der Tasten. Die farbigen Balken müssen diese Linie durchlaufen. Prüfe auch die anderen Vorschaubilder auf Schnitte und Perspektivwechsel."
                : "Geeignet für Solo-Klavier. Stimmen, Schlagzeug, Hall und Pedal können die Erkennung verschlechtern. Die Verarbeitung erfolgt auf deinem Mac."}
            </p>
            <div className="video-calibration">
              <img
                onLoad={(e) => setImageHeight(e.currentTarget.naturalHeight)}
                alt="Videovorschau zur Kalibrierung"
                src={job.previews[frame] ?? job.previews[0]}
                onClick={(e) => {
                  if (method !== "visual") return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - r.left) * 720) / r.width,
                    y =
                      ((e.clientY - r.top) * e.currentTarget.naturalHeight) /
                      r.height;
                  setPoints((p) =>
                    p.length >= 3 ? [x] : [...p, p.length === 2 ? y : x],
                  );
                }}
              />
              {calibration && (
                <div
                  className="video-line"
                  style={{ top: `${(calibration.line / imageHeight) * 100}%` }}
                />
              )}
            </div>
            <div className="score-bottom-actions">
              {job.previews.map((_, i) => (
                <button
                  key={i}
                  className="button outline"
                  onClick={() => setFrame(i)}
                >
                  Vorschaubild {i + 1}
                </button>
              ))}
              {method === "visual" && (
                <button
                  className="button outline"
                  onClick={() => setPoints([])}
                >
                  Markierungen zurücksetzen ({points.length}/3)
                </button>
              )}
            </div>
            {method === "visual" && (
              <label>
                Bild-/Tonversatz in Millisekunden (optional)
                <input
                  type="number"
                  min="-1000"
                  max="1000"
                  value={offsetMs}
                  onChange={(e) => setOffsetMs(Number(e.target.value))}
                />
                <small>
                  Positiv verschiebt die erkannten Noten nach hinten. Manche
                  Tutorials zeigen Balken vor dem hörbaren Anschlag.
                </small>
              </label>
            )}
            <button
              className="button primary"
              disabled={method === "visual" && !calibration}
              onClick={() =>
                action(() =>
                  window.jazz.videoTranscribe(job.id, method, calibration),
                )
              }
            >
              Transkribieren
            </button>
          </>
        )}
      {job?.result && (
        <button
          className="button primary"
          onClick={() => onImported(job.result!)}
        >
          Transkription anhören und prüfen
        </button>
      )}
    </section>
  );
}
