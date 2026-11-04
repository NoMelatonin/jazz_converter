import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Disc3,
  Download,
  FileMusic,
  FolderOpen,
  Globe2,
  HardDrive,
  Headphones,
  Library,
  LoaderCircle,
  Music2,
  Pencil,
  Piano,
  Play,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import type {
  Arrangement,
  CatalogEntry,
  CatalogSong,
  Chord,
  Difficulty,
  Settings,
} from "./core/model";
import { LIMITS } from "./core/model";
import { parseChord } from "./core/harmony";
import { ONLINE_CATALOGUE, matches } from "./core/catalogue";
import { extractMelody } from "./core/melody";
import { cmp, value } from "./core/time";
import { Player } from "./components/Player";

type Page = "library" | "online";
export function App() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]),
    [page, setPage] = useState<Page>("library"),
    [query, setQuery] = useState("");
  const [record, setRecord] = useState<CatalogSong | null>(null),
    [trackId, setTrackId] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy"),
    [chords, setChords] = useState<Chord[]>([]),
    [showChords, setShowChords] = useState(false);
  const [arrangement, setArrangement] = useState<Arrangement | null>(null),
    [mode, setMode] = useState<"listen" | "practice">("listen");
  const [preview, setPreview] = useState<"melody" | "original" | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false),
    [modal, setModal] = useState<"help" | "credits" | "metadata" | null>(null);
  const [title, setTitle] = useState(""),
    [artist, setArtist] = useState("");
  const [rangeFrom, setRangeFrom] = useState(1),
    [rangeTo, setRangeTo] = useState(1),
    [rangeChord, setRangeChord] = useState("C");
  const showError = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  async function task<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      return await action();
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }
  const refresh = async () => setEntries(await window.jazz.list());
  useEffect(() => {
    refresh().catch(showError);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function selectRecord(next: CatalogSong) {
    const id = next.settings?.melodyTrackId ?? next.song.tracks[0].id;
    const inferredChords =
      next.settings?.chords ?? (await window.jazz.analyze(next.entry.id, id));
    setRecord(next);
    setArrangement(null);
    setPreview(null);
    setShowChords(false);
    setConfirmed(next.song.tracks.length === 1 || !!next.settings);
    setTrackId(id);
    setDifficulty(next.settings?.difficulty ?? "easy");
    setChords(inferredChords);
    setRangeFrom(1);
    setRangeTo(1);
    setError("");
    setQuery("");
    setTitle(next.entry.title);
    setArtist(next.entry.artist);
  }
  async function openFiles() {
    await task("Datei wird geöffnet", async () => {
      const songs = await window.jazz.openFiles();
      await refresh();
      if (songs[0]) await selectRecord(songs[0]);
    });
  }
  async function drop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const files = Array.from(event.dataTransfer.files);
    await task("Datei wird importiert", async () => {
      const songs = await window.jazz.importPaths(
        files.map((f) => window.jazz.filePath(f)),
      );
      await refresh();
      if (songs[0]) await selectRecord(songs[0]);
    });
  }
  function library(next: Page) {
    setPage(next);
    setRecord(null);
    setArrangement(null);
    setPreview(null);
    setQuery("");
    setError("");
  }
  const settings = (): Settings => ({
    style: "swing",
    difficulty,
    melodyTrackId: trackId,
    chords,
  });
  async function convert() {
    if (!record || !confirmed) return;
    await task("Dein Swing-Arrangement entsteht", async () => {
      const result = await window.jazz.convert(record.entry.id, settings());
      setArrangement(result);
      setPreview(null);
      setMode("listen");
    });
  }
  async function save() {
    if (!record) return;
    await task("MIDI wird gespeichert", async () => {
      const location = await window.jazz.saveMidi(
        record.entry.id,
        arrangement?.settings ?? settings(),
      );
      if (location) setNotice(`MIDI gespeichert: ${location}`);
    });
  }
  const uncertain = chords.filter(
    (c) => c.confidence < 0.65 && c.source === "inferred",
  ).length;
  const needsConfirmation = chords.some(
    (c) => c.confidence < 0.2 && c.source !== "manual",
  );
  const selectedTrack = record?.song.tracks.find((t) => t.id === trackId);
  const selectedMelody = useMemo(
    () => (selectedTrack ? extractMelody(selectedTrack) : []),
    [selectedTrack],
  );
  const previewMusic = useMemo(() => {
    if (!preview || !record || !selectedTrack) return null;
    const notes =
      preview === "melody"
        ? selectedMelody.map((n) => ({ ...n, hand: "right" as const }))
        : record.song.tracks.flatMap((t) =>
            t.notes.map((n) => ({
              ...n,
              hand: n.pitch < 60 ? ("left" as const) : ("right" as const),
            })),
          );
    return { ...record.song, notes };
  }, [record, selectedTrack, selectedMelody, preview]);
  async function changeTrack(id: string) {
    if (!record) return;
    await task("Akkorde werden geprüft", async () => {
      const next = await window.jazz.analyze(record.entry.id, id);
      setTrackId(id);
      setConfirmed(false);
      setPreview(null);
      setChords(next);
    });
  }
  function applyRange() {
    if (!parseChord(rangeChord)) {
      setError(
        "Bitte einen gültigen Akkord eingeben, z. B. C, Am7, G7 oder Fmaj7.",
      );
      return;
    }
    if (!record) return;
    const first = record.song.bars[rangeFrom - 1],
      last = record.song.bars[rangeTo - 1];
    setChords(
      chords.map((c) =>
        cmp(c.at, first.start) >= 0 &&
        value(c.at) < value(last.start) + value(last.duration)
          ? { ...c, symbol: rangeChord, source: "manual", confidence: 1 }
          : c,
      ),
    );
    setError("");
  }
  const step = !record ? 1 : arrangement ? 3 : 2;
  const results = entries.filter((e) => matches(query, e)),
    online = ONLINE_CATALOGUE.filter((e) => matches(query, e));
  return (
    <div
      className={`app-shell ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={drop}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Piano size={26} />
          </div>
          <div>
            jazz converter<span>DEIN PIANO. DEIN SOUND.</span>
          </div>
        </div>
        <div className="workspace-label">DEIN STUDIO</div>
        <nav aria-label="Hauptnavigation">
          <button
            className={page === "library" ? "nav-item active" : "nav-item"}
            onClick={() => library("library")}
          >
            <Library size={20} />
            Meine Songs<span>{entries.length}</span>
          </button>
          <button
            className={page === "online" ? "nav-item active" : "nav-item"}
            onClick={() => library("online")}
          >
            <Globe2 size={20} />
            Songs entdecken
          </button>
          <button className="nav-item" onClick={openFiles} disabled={!!busy}>
            <FolderOpen size={20} />
            Datei öffnen
          </button>
        </nav>
        <div className="sidebar-tip">
          <span className="tiny-piano">♪</span>
          <p>
            Ein vertrauter Song.
            <br />
            Ein ganz neues Spielgefühl.
          </p>
          <span>Für zwei Hände gemacht.</span>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setModal("help")}>
            <CircleHelp size={18} />
            So funktioniert’s
          </button>
          <button onClick={() => setModal("credits")}>
            <ShieldCheck size={18} />
            Quellen & Lizenzen
          </button>
          <div className="offline-badge">
            <i />
            Lokal auf deinem Mac
          </div>
          <span className="app-version">VERSION 1.0 · SWING EDITION</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span>Dein Studio</span>
            <span className="breadcrumb">/</span>
            {record
              ? record.entry.title
              : page === "library"
                ? "Meine Songs"
                : "Songs entdecken"}
          </div>
          <span className="privacy">
            <HardDrive size={15} />
            Deine Musik bleibt bei dir
          </span>
        </header>
        <div className="main-content">
          <div className="steps" aria-label="Fortschritt">
            {["Song auswählen", "Jazz gestalten", "Anhören & üben"].map(
              (label, i) => (
                <div
                  key={label}
                  className={
                    step === i + 1
                      ? "step current"
                      : step > i + 1
                        ? "step done"
                        : "step"
                  }
                >
                  <span>{step > i + 1 ? <Check size={14} /> : i + 1}</span>
                  {label}
                  {i < 2 && <div className="step-line" />}
                </div>
              ),
            )}
          </div>
          {error && (
            <div className="message error" role="alert">
              <span>{error}</span>
              <button
                aria-label="Fehlermeldung schließen"
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {busy && (
            <div className="busy-indicator" role="status">
              <LoaderCircle className="spin" size={17} />
              {busy} …
            </div>
          )}
          {!record ? (
            <>
              <section className="hero">
                <div>
                  <div className="eyebrow">
                    <span /> AUS LIEBLINGSSONGS WIRD JAZZ
                  </div>
                  <h1>
                    Dein Song.
                    <br />
                    <em>Ein neuer Groove.</em>
                  </h1>
                  <p>
                    Finde einen Song und mach ihn zu deinem.
                    <br />
                    Als spielbares Swing-Arrangement für zwei Hände.
                  </p>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="vinyl">
                    <div className="record-label">
                      <Music2 size={23} />
                      <span>
                        SWING
                        <br />
                        SIDE A
                      </span>
                      <i />
                    </div>
                  </div>
                  <div className="music-note one">♪</div>
                  <div className="music-note two">♫</div>
                  <div className="art-caption">
                    A LITTLE SWING GOES A LONG WAY.
                  </div>
                </div>
              </section>
              <div className="library-heading">
                <div>
                  <h2>
                    {page === "online" ? "Songs entdecken" : "Deine Songs"}
                  </h2>
                  <p>
                    {page === "online"
                      ? "Ein kleiner, kuratierter Katalog mit freien MIDI-Dateien."
                      : "Deine Sammlung. Bereit für eine neue Klangfarbe."}
                  </p>
                </div>
                <button
                  className="button outline"
                  onClick={openFiles}
                  disabled={!!busy}
                >
                  <Upload size={17} />
                  Datei importieren
                </button>
              </div>
              <div className="search-box">
                <Search size={21} />
                <input
                  aria-label="Song suchen"
                  placeholder="Titel oder Interpret suchen …"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    aria-label="Suche löschen"
                    onClick={() => setQuery("")}
                  >
                    <X size={18} />
                  </button>
                )}
                <kbd>⌕</kbd>
              </div>
              <div className="list-caption">
                <span>
                  {page === "online"
                    ? "KURATIERTER ONLINE-KATALOG"
                    : "LOKALER KATALOG"}
                </span>
                <span>
                  {page === "online" ? online.length : results.length} Versionen
                </span>
              </div>
              <div className="song-list">
                {page === "library"
                  ? results.map((entry) => (
                      <button
                        key={entry.id}
                        className="song-row"
                        disabled={!!busy}
                        onClick={() =>
                          void task("Song wird geladen", async () =>
                            selectRecord(await window.jazz.load(entry.id)),
                          )
                        }
                      >
                        <div
                          className={`song-art ${entry.format === "MIDI" ? "blue" : ""}`}
                        >
                          <Music2 size={27} />
                        </div>
                        <div className="song-info">
                          <strong>{entry.title}</strong>
                          <span>
                            {entry.artist} <i>·</i> {entry.version}
                          </span>
                          <small>
                            {entry.source} · {entry.license}
                          </small>
                        </div>
                        <span className="format-tag">{entry.format}</span>
                        {entry.license === "CC0 1.0" && (
                          <span className="demo-tag">DEMO</span>
                        )}
                        <ArrowRight size={20} />
                      </button>
                    ))
                  : online.map((entry) => (
                      <div key={entry.id} className="song-row online-row">
                        <div className="song-art blue">
                          <Globe2 size={26} />
                        </div>
                        <div className="song-info">
                          <strong>{entry.title}</strong>
                          <span>
                            {entry.artist} <i>·</i> {entry.version}
                          </span>
                          <small>
                            {entry.source} · {entry.license}
                          </small>
                        </div>
                        <button
                          className="button outline"
                          disabled={!!busy}
                          onClick={() =>
                            void task("Song wird heruntergeladen", async () => {
                              const next = await window.jazz.download(entry.id);
                              await refresh();
                              await selectRecord(next);
                            })
                          }
                        >
                          <ArrowDownToLine size={17} />
                          Herunterladen
                        </button>
                      </div>
                    ))}
              </div>
              {(page === "library" ? !results.length : !online.length) && (
                <div className="empty-state">
                  <Search size={28} />
                  <h3>Kein passender Song gefunden.</h3>
                  <p>
                    Öffne eine MIDI- oder MusicXML-Datei, um ihn deiner Sammlung
                    hinzuzufügen.
                  </p>
                  <button className="button primary" onClick={openFiles}>
                    Datei öffnen
                    <ArrowRight size={17} />
                  </button>
                </div>
              )}
              <button
                className="drop-zone"
                onClick={openFiles}
                disabled={!!busy}
              >
                <div className="upload-circle">
                  <FileMusic size={25} />
                </div>
                <div>
                  <strong>Dein Song ist noch nicht dabei?</strong>
                  <p>
                    Datei hierher ziehen oder{" "}
                    <span>auf deinem Mac auswählen</span>
                  </p>
                  <small>
                    MIDI (.mid, .midi) oder MusicXML (.musicxml, .mxl)
                  </small>
                </div>
                <span className="drop-plus">+</span>
              </button>
              <div className="reassurance">
                <span>
                  <WifiOff size={16} />
                  Auch ohne Internet spielbereit
                </span>
                <span>
                  <Piano size={16} />
                  Nur akustisches Klavier
                </span>
                <span>
                  <Download size={16} />
                  Als MIDI mitnehmen
                </span>
              </div>
            </>
          ) : (
            <>
              <button className="back-link" onClick={() => library(page)}>
                <ArrowLeft size={16} />
                Zur Songauswahl
              </button>
              <div className="song-header">
                <div className="selected-art">
                  <Music2 size={30} />
                </div>
                <div>
                  <span className="eyebrow">
                    {arrangement
                      ? "DEIN SWING-ARRANGEMENT"
                      : "MACH DEINEN SONG ZU JAZZ"}
                  </span>
                  <h1>
                    {record.entry.title}
                    <button
                      aria-label="Titel und Interpret bearbeiten"
                      className="icon-button"
                      onClick={() => setModal("metadata")}
                    >
                      <Pencil size={17} />
                    </button>
                  </h1>
                  <p>
                    {record.entry.artist}
                    <span>·</span>
                    {record.song.bars.length} Takte<span>·</span>
                    {Math.round(record.song.tempos[0].bpm)} BPM<span>·</span>
                    {record.entry.format}
                  </p>
                </div>
              </div>
              {!arrangement ? (
                <>
                  <section className="panel melody-panel">
                    <div className="panel-heading">
                      <div className="number-icon">1</div>
                      <div>
                        <h2>Die Melodie macht den Song.</h2>
                        <p>
                          {record.song.tracks.length > 1
                            ? "Hör dir unseren Vorschlag an und wähle die passende Stimme."
                            : "Die Melodiestimme wurde aus deiner Datei übernommen."}
                        </p>
                      </div>
                      {confirmed && (
                        <span className="confirmed">
                          <CheckCircle2 size={17} />
                          Bestätigt
                        </span>
                      )}
                    </div>
                    <div className="melody-select">
                      <label>
                        Melodiestimme
                        <select
                          aria-label="Melodiestimme"
                          value={trackId}
                          onChange={(e) => changeTrack(e.target.value)}
                        >
                          {record.song.tracks.map((t, i) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {i === 0 ? " · Vorschlag" : ""} ({t.notes.length}{" "}
                              Noten)
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="button outline"
                        onClick={() =>
                          setPreview(preview === "melody" ? null : "melody")
                        }
                      >
                        <Headphones size={17} />
                        {preview === "melody"
                          ? "Hörprobe schließen"
                          : "Melodie anhören"}
                      </button>
                      {!confirmed && (
                        <button
                          className="button primary small"
                          onClick={() => {
                            setConfirmed(true);
                            setPreview(null);
                          }}
                        >
                          <Check size={17} />
                          Melodie bestätigen
                        </button>
                      )}
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        setPreview(preview === "original" ? null : "original")
                      }
                    >
                      {preview === "original"
                        ? "Original schließen"
                        : "Original zum Vergleich anhören"}
                      <Play size={13} />
                    </button>
                    {selectedTrack &&
                      selectedTrack.notes.length !== selectedMelody.length && (
                        <p className="inline-hint">
                          Diese Spur ist mehrstimmig. Die Hörprobe verwendet die
                          vorgeschlagene obere Melodielinie.
                        </p>
                      )}
                  </section>
                  {previewMusic && (
                    <Player
                      key={`${record.entry.id}-${preview}-${trackId}`}
                      music={previewMusic}
                      mode="listen"
                      onError={showError}
                    />
                  )}
                  <section className="panel settings-panel">
                    <div className="panel-heading">
                      <div className="number-icon">2</div>
                      <div>
                        <h2>Ein bisschen Swing. Dein Schwierigkeitsgrad.</h2>
                        <p>
                          Die Melodie bleibt vertraut. Die Begleitung bekommt
                          einen neuen Groove.
                        </p>
                      </div>
                    </div>
                    <div className="settings-grid">
                      <div className="style-card">
                        <span className="eyebrow">DEIN STIL</span>
                        <div className="style-title">
                          <Disc3 size={30} />
                          <h3>Swing</h3>
                          <span className="check-dot">
                            <Check size={13} />
                          </span>
                        </div>
                        <p>
                          Lockere Achtel, warme Jazzakkorde
                          <br />
                          und eine neue Bassbegleitung.
                        </p>
                        <span className="style-label">
                          DER KLASSIKER AM KLAVIER
                        </span>
                      </div>
                      <div className="difficulty">
                        <span className="eyebrow">DEIN SPIELNIVEAU</span>
                        <div className="difficulty-options">
                          {(["easy", "medium"] as const).map((d) => (
                            <button
                              key={d}
                              className={
                                difficulty === d
                                  ? "difficulty-card selected"
                                  : "difficulty-card"
                              }
                              onClick={() => setDifficulty(d)}
                              aria-pressed={difficulty === d}
                            >
                              <div>
                                <span className="level-bars">
                                  {d === "easy" ? "▂▄" : "▂▄▆"}
                                </span>
                                <strong>
                                  {d === "easy" ? "Einfach" : "Mittel"}
                                </strong>
                                <i>{difficulty === d && <Check size={12} />}</i>
                              </div>
                              <p>
                                {d === "easy"
                                  ? "Ruhiger Bass, kompakte Griffe."
                                  : "Bewegter Bass, vollere Akkorde."}
                              </p>
                              <small>
                                {d === "easy"
                                  ? "Max. Quinte · links 2 / rechts 3 Töne"
                                  : "Max. Oktave · links 3 / rechts 4 Töne"}
                              </small>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="panel chords-panel">
                    <button
                      className="chords-toggle"
                      onClick={() => setShowChords(!showChords)}
                      aria-expanded={showChords}
                    >
                      <SlidersHorizontal size={20} />
                      <div>
                        <strong>Akkorde prüfen & anpassen</strong>
                        <span>
                          {uncertain
                            ? `${uncertain} unsichere Stelle${uncertain === 1 ? "" : "n"} – bitte anhören und prüfen`
                            : "Akkorde aus der Datei oder bestätigte Vorschläge"}
                        </span>
                      </div>
                      {uncertain > 0 && (
                        <span className="warning-badge">{uncertain}</span>
                      )}
                      <ChevronDown
                        size={19}
                        className={showChords ? "rotate" : ""}
                      />
                    </button>
                    {showChords && (
                      <div className="chord-editor">
                        <p>
                          Internationale Akkordsymbole: B entspricht dem
                          deutschen H, Bb dem deutschen B.
                        </p>
                        <div className="chord-grid">
                          {chords.map((c) => {
                            const bar =
                              record.song.bars.findLast(
                                (b) => cmp(b.start, c.at) <= 0,
                              )?.number ?? 1;
                            return (
                              <label
                                key={c.id}
                                className={
                                  c.confidence < 0.65 && c.source === "inferred"
                                    ? "uncertain"
                                    : ""
                                }
                              >
                                <span>Takt {bar}</span>
                                <input
                                  aria-label={`Akkord ${c.id} Takt ${bar}`}
                                  value={c.symbol}
                                  onChange={(e) =>
                                    setChords(
                                      chords.map((v) =>
                                        v.id === c.id
                                          ? {
                                              ...v,
                                              symbol: e.target.value,
                                              confidence: 1,
                                              source: "manual",
                                            }
                                          : v,
                                      ),
                                    )
                                  }
                                />
                                <small>
                                  {c.source === "provided"
                                    ? "Aus Datei"
                                    : c.source === "manual"
                                      ? "Bestätigt"
                                      : c.confidence < 0.65
                                        ? "Unsicher"
                                        : "Abgeleitet"}
                                </small>
                              </label>
                            );
                          })}
                        </div>
                        <div className="range-editor">
                          <span>Akkord für Takte</span>
                          <select
                            aria-label="Akkordbereich von"
                            value={rangeFrom}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              setRangeFrom(n);
                              setRangeTo(Math.max(n, rangeTo));
                            }}
                          >
                            {record.song.bars.map((b) => (
                              <option key={b.number}>{b.number}</option>
                            ))}
                          </select>
                          <span>bis</span>
                          <select
                            aria-label="Akkordbereich bis"
                            value={rangeTo}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              setRangeTo(n);
                              setRangeFrom(Math.min(n, rangeFrom));
                            }}
                          >
                            {record.song.bars.map((b) => (
                              <option key={b.number}>{b.number}</option>
                            ))}
                          </select>
                          <input
                            aria-label="Akkord für Taktbereich"
                            value={rangeChord}
                            onChange={(e) => setRangeChord(e.target.value)}
                          />
                          <button
                            className="button outline small"
                            onClick={applyRange}
                          >
                            Übernehmen
                          </button>
                        </div>
                        {uncertain > 0 && (
                          <button
                            className="text-button"
                            onClick={() =>
                              setChords(
                                chords.map((c) =>
                                  c.source === "inferred"
                                    ? { ...c, source: "manual", confidence: 1 }
                                    : c,
                                ),
                              )
                            }
                          >
                            <Check size={15} />
                            Ich habe die Vorschläge geprüft – alle bestätigen
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                  {record.song.warnings.length > 0 && (
                    <div className="source-warnings">
                      {record.song.warnings.map((w) => (
                        <p key={w}>{w}</p>
                      ))}
                    </div>
                  )}
                  <div className="convert-row">
                    <span>
                      <ShieldCheck size={17} />
                      Entsteht vollständig auf deinem Mac.
                    </span>
                    <button
                      className="button primary convert"
                      onClick={convert}
                      disabled={!!busy || !confirmed || needsConfirmation}
                    >
                      <Sparkles size={19} />
                      Swing-Arrangement erstellen
                      <ArrowRight size={18} />
                    </button>
                  </div>
                  {needsConfirmation && (
                    <p className="required-hint">
                      Für diese Datei fehlen sichere Akkorde. Öffne „Akkorde
                      prüfen & anpassen“ und bestätige oder korrigiere die
                      Vorschläge.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="result-banner">
                    <span>
                      <CheckCircle2 size={21} />
                      <strong>Dein Arrangement ist bereit.</strong> Swing ·{" "}
                      {difficulty === "easy" ? "Einfach" : "Mittel"} · zwei
                      Hände
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setArrangement(null)}
                    >
                      <SlidersHorizontal size={15} />
                      Anpassen
                    </button>
                  </div>
                  <div className="result-actions">
                    <div className="tabs">
                      <button
                        className={mode === "listen" ? "selected" : ""}
                        onClick={() => setMode("listen")}
                      >
                        <Headphones size={18} />
                        Anhören
                      </button>
                      <button
                        className={mode === "practice" ? "selected" : ""}
                        onClick={() => setMode("practice")}
                      >
                        <Piano size={18} />
                        Üben
                      </button>
                    </div>
                    <button
                      className="button primary"
                      disabled={!!busy}
                      onClick={save}
                    >
                      <Download size={18} />
                      MIDI speichern
                    </button>
                  </div>
                  <Player
                    key={`${record.entry.id}-arranged`}
                    music={arrangement}
                    mode={mode}
                    onSave={save}
                    onError={showError}
                  />
                  <div className="arrangement-details">
                    <div>
                      <span>STIL</span>
                      <strong>Swing</strong>
                    </div>
                    <div>
                      <span>NIVEAU</span>
                      <strong>
                        {difficulty === "easy" ? "Einfach" : "Mittel"}
                      </strong>
                    </div>
                    <div>
                      <span>GRIFFWEITE</span>
                      <strong>
                        {LIMITS[difficulty].span === 7
                          ? "Max. Quinte"
                          : "Max. Oktave"}
                      </strong>
                    </div>
                    <div>
                      <span>INSTRUMENT</span>
                      <strong>Akustisches Klavier</strong>
                    </div>
                  </div>
                  {arrangement.warnings.map((w) => (
                    <p className="inline-hint" key={w}>
                      {w}
                    </p>
                  ))}
                  <button
                    className="text-button"
                    onClick={() =>
                      setPreview(preview === "original" ? null : "original")
                    }
                  >
                    <Headphones size={16} />
                    Original zum Vergleich{" "}
                    {preview === "original" ? "schließen" : "anhören"}
                  </button>
                  {previewMusic && (
                    <Player
                      key={`${record.entry.id}-compare`}
                      music={previewMusic}
                      mode="listen"
                      onError={showError}
                    />
                  )}
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>Mit Gefühl spielen. Mit Swing lernen.</span>
            <span>
              JAZZ CONVERTER<span className="footer-dot">·</span>MADE FOR YOUR
              PIANO
            </span>
          </footer>
        </div>
      </main>
      {dragging && (
        <div className="drop-overlay">
          <FileMusic size={44} />
          <h2>Deinen Song hier ablegen</h2>
          <p>MIDI oder MusicXML</p>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Dialog schließen"
              onClick={() => setModal(null)}
            >
              <X size={22} />
            </button>
            {modal === "metadata" ? (
              <>
                <span className="eyebrow">DEIN KATALOG</span>
                <h2 id="modal-title">Songangaben bearbeiten</h2>
                <label>
                  Titel
                  <input
                    aria-label="Titel"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  Interpret / Komponist
                  <input
                    aria-label="Interpret"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={!!busy || !title.trim() || !artist.trim()}
                  onClick={() =>
                    void task("Songangaben werden gespeichert", async () => {
                      if (record) {
                        const next = await window.jazz.update(record.entry.id, {
                          title,
                          artist,
                        });
                        await selectRecord(next);
                        await refresh();
                        setModal(null);
                      }
                    })
                  }
                >
                  Speichern
                </button>
              </>
            ) : modal === "help" ? (
              <>
                <span className="eyebrow">GUT ZU WISSEN</span>
                <h2 id="modal-title">Vom Lieblingssong zum Swing.</h2>
                <ol>
                  <li>
                    Suche einen lokalen Song oder importiere MIDI
                    beziehungsweise MusicXML.
                  </li>
                  <li>
                    Bestätige bei mehreren Stimmen die Melodie. Die Hörprobe
                    spielt genau diese Linie.
                  </li>
                  <li>
                    Wähle Einfach oder Mittel und prüfe markierte Akkorde.
                  </li>
                  <li>
                    Erstelle dein Arrangement, höre es an und übe in deinem
                    Tempo.
                  </li>
                  <li>
                    Speichere es als MIDI mit getrennten Spuren für beide Hände.
                  </li>
                </ol>
                <p>
                  Die Online-Auswahl umfasst drei freie Mutopia-Dateien. Andere
                  Songs kannst du selbst importieren. Sprache, PDF und MP3
                  werden noch nicht unterstützt.
                </p>
                <button
                  className="button outline"
                  onClick={() =>
                    void task("Demo-Dateien werden gespeichert", async () => {
                      const location = await window.jazz.demoFiles();
                      if (location)
                        setNotice(`Demo-Dateien gespeichert: ${location}`);
                    })
                  }
                >
                  <Download size={17} />
                  Demo-Dateien speichern
                </button>
              </>
            ) : (
              <>
                <span className="eyebrow">TRANSPARENZ</span>
                <h2 id="modal-title">Quellen & Lizenzen</h2>
                <p>
                  <strong>Demo „Bruder Jakob“</strong>
                  <br />
                  Traditionelle Melodie. Neue MIDI- und MusicXML-Dateifassung
                  samt Begleitung: CC0 1.0.
                </p>
                <p>
                  <strong>Klavier: Salamander Grand Piano V3</strong>
                  <br />
                  Alexander Holm · CC BY 3.0. Unveränderte MP3-Dateien aus der
                  Tone.js-Verteilung. Wiedergabe mit Tonhöhenanpassung und
                  Lautstärkehüllkurve. Keine Unterstützung durch den Urheber
                  impliziert.
                </p>
                <p className="license-url">
                  https://github.com/sfzinstruments/SalamanderGrandPiano
                  <br />
                  https://creativecommons.org/licenses/by/3.0/
                </p>
                <p>
                  <strong>Online-Katalog: Mutopia Project</strong>
                  <br />
                  Die drei hinterlegten Ausgaben sind dort als Public Domain
                  ausgewiesen. Quelle und Lizenz bleiben nach dem Import im
                  lokalen Katalog erhalten.
                </p>
                {ONLINE_CATALOGUE.map((e) => (
                  <p key={e.id} className="license-url">
                    {e.title} · {e.version}
                    <br />
                    {e.licenseUrl}
                  </p>
                ))}
                <p>
                  Importierte eigene Dateien werden nicht hochgeladen.
                  Lizenzangaben eigener Dateien werden nicht automatisch
                  ermittelt.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
