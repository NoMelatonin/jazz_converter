import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ZoomIn, ZoomOut } from "lucide-react";
GlobalWorkerOptions.workerSrc = workerUrl;
export function PdfView({
  id,
  page = 1,
  rotation = 0,
}: {
  id: string;
  page?: number;
  rotation?: number;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true,
      loading: ReturnType<typeof getDocument> | undefined;
    setDocument(null);
    setError("");
    void window.jazz
      .pdfBytes(id)
      .then((bytes) => {
        loading = getDocument({
          data: new Uint8Array(bytes),
          cMapUrl: new URL("pdf/cmaps/", window.document.baseURI).href,
          cMapPacked: true,
          standardFontDataUrl: new URL(
            "pdf/standard_fonts/",
            window.document.baseURI,
          ).href,
          wasmUrl: new URL("pdf/wasm/", window.document.baseURI).href,
        });
        return loading.promise;
      })
      .then((pdf) => {
        if (alive) setDocument(pdf);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      void loading?.destroy();
    };
  }, [id]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let alive = true,
      task: any;
    void document
      .getPage(Math.max(1, Math.min(page, document.numPages)))
      .then((pdfPage) => {
        if (!alive) return;
        const original = pdfPage.getViewport({ scale: 1 }),
          viewport = pdfPage.getViewport({
            scale: Math.min(1.5, 560 / original.width) * zoom,
            rotation: (pdfPage.rotate + rotation) % 360,
          });
        const el = canvas.current!;
        const ratio = window.devicePixelRatio || 1;
        el.width = Math.ceil(viewport.width * ratio);
        el.height = Math.ceil(viewport.height * ratio);
        el.style.width = `${viewport.width}px`;
        el.style.height = `${viewport.height}px`;
        task = pdfPage.render({
          canvas: el,
          canvasContext: el.getContext("2d")!,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        return task.promise;
      })
      .catch((e) => {
        if (alive && e.name !== "RenderingCancelledException")
          setError(e.message);
      });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [document, page, rotation, zoom]);
  return (
    <div className="pdf-view">
      <div className="pdf-view-toolbar">
        <span>Original-PDF · Seite {page}</span>
        <button
          aria-label="PDF verkleinern"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          <ZoomOut size={17} />
        </button>
        <button
          aria-label="PDF vergrößern"
          onClick={() => setZoom(Math.min(3, zoom + 0.25))}
        >
          <ZoomIn size={17} />
        </button>
      </div>
      <div className="pdf-canvas-scroll">
        {error ? (
          <p role="alert">PDF-Vorschau: {error}</p>
        ) : (
          <>
            <canvas
              ref={canvas}
              aria-label={`Originalnoten Seite ${page}`}
              role="img"
            />
            {!document && <p>PDF-Vorschau wird geladen …</p>}
          </>
        )}
      </div>
    </div>
  );
}
