import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FileMusic,
  LoaderCircle,
  RotateCw,
  ScanLine,
  X,
} from "lucide-react";
import type { CatalogSong, PdfDocument, PdfJob } from "../core/model";
import { parsePages } from "../core/score-review";
import { PdfView } from "./PdfView";
export function PdfImport({
  document,
  onComplete,
  onClose,
}: {
  document: PdfDocument;
  onComplete: (record: CatalogSong) => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState(
      document.pages === 1 ? "1" : `1-${Math.min(200, document.pages)}`,
    ),
    [rotation, setRotation] = useState(0),
    [previewPage, setPreviewPage] = useState(1),
    [job, setJob] = useState<PdfJob | null>(null),
    [error, setError] = useState(""),
    [starting, setStarting] = useState(false);
  const working =
    starting || job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!job || !["running", "queued"].includes(job.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await window.jazz.pdfStatus(job.id);
        if (!active) return;
        setJob(next);
        if (next.status === "complete" && next.results?.length) {
          onComplete(await window.jazz.load(next.results[0].entry.id));
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    const timer = setInterval(() => void poll(), 750);
    void poll();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  async function start() {
    setError("");
    setStarting(true);
    try {
      const next = await window.jazz.startPdf(
        document.id,
        parsePages(pages, document.pages),
        rotation,
      );
      setJob(next);
      if (next.status === "complete" && next.results?.length)
        onComplete(await window.jazz.load(next.results[0].entry.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function cancel() {
    if (job && working) setJob(await window.jazz.cancelPdf(job.id));
  }
  return (
    <section className="pdf-import">
      <button
        className="back-link"
        onClick={() =>
          void (async () => {
            await cancel();
            onClose();
          })()
        }
      >
        <ArrowLeft size={16} />
        Zurück zur Sammlung
      </button>
      <div className="song-header">
        <div className="selected-art">
          <FileMusic size={30} />
        </div>
        <div>
          <span className="eyebrow">NOTEN AUS EINEM PDF</span>
          <h1>{document.title}</h1>
          <p>
            {document.pages} Seite(n) ·{" "}
            {(document.bytes / 1024 / 1024).toFixed(1)} MB · bleibt auf deinem
            Mac
          </p>
        </div>
      </div>
      <div className="pdf-import-grid">
        <PdfView id={document.id} page={previewPage} rotation={rotation} />
        <section className="panel">
          <h2>Von der Partitur ans Klavier.</h2>
          <p>
            Gedruckte Noten werden lokal erkannt. Anschließend prüft die App, ob
            alle Stimmen auf zwei Hände passen.
          </p>
          <label className="field">
            Seiten erkennen
            <input
              aria-label="PDF-Seiten auswählen"
              value={pages}
              disabled={working}
              onChange={(e) => setPages(e.target.value)}
            />
            <small>Zum Beispiel 1-3, 5. Maximal 200 Seiten pro Vorgang.</small>
          </label>
          <label className="field">
            Vorschau auf Seite
            <select
              aria-label="PDF-Vorschauseite"
              value={previewPage}
              onChange={(e) => setPreviewPage(Number(e.target.value))}
            >
              {Array.from({ length: document.pages }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
          <button
            className="button outline"
            disabled={working}
            onClick={() => setRotation((rotation + 90) % 360)}
          >
            <RotateCw size={17} />
            Seiten drehen · {rotation}°
          </button>
          <p className="inline-hint">
            Deckblätter kannst du über die Seitenauswahl auslassen. Unklare
            Noten werden anschließend zur Prüfung angezeigt.
          </p>
          {(error || job?.error) && (
            <div className="message error" role="alert">
              {error || job?.error}
            </div>
          )}
          {job && (
            <div className="pdf-job" role="status">
              <div>
                {working && <LoaderCircle size={17} className="spin" />}
                {job.message}
              </div>
              <progress
                aria-label="Fortschritt der Notenerkennung"
                value={job.progress}
                max={100}
              />
            </div>
          )}
          <div className="pdf-import-actions">
            {working ? (
              <button className="button outline" onClick={() => void cancel()}>
                <X size={17} />
                Erkennung abbrechen
              </button>
            ) : (
              <button className="button primary" onClick={() => void start()}>
                <ScanLine size={18} />
                {job?.status === "error" ? "Erneut erkennen" : "Noten erkennen"}
              </button>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
