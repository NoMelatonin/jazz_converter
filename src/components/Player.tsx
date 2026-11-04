import { useEffect, useRef, useState } from "react";
import {
  Download,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Volume2,
  Headphones,
} from "lucide-react";
import type { Arrangement, Note, Song } from "../core/model";
import { beatAtSeconds, secondsAt, value } from "../core/time";
import { Transport, type PracticeHand } from "../core/transport";
import { PianoAudio } from "../audio";
import { PianoRoll } from "./PianoRoll";

export function Player({
  music,
  mode,
  onSave,
  onError,
}: {
  music: Arrangement | (Song & { notes: Note[] });
  mode: "listen" | "practice";
  onSave?: () => void;
  onError: (error: unknown) => void;
}) {
  const engine = useRef<PianoAudio | null>(null),
    transport = useRef<Transport | null>(null);
  const audioOwner = useRef(Symbol("player"));
  const [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [sounding, setSounding] = useState(false),
    [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1),
    [hand, setHand] = useState<PracticeHand>("both"),
    [looped, setLooped] = useState(false);
  const [from, setFrom] = useState(1),
    [to, setTo] = useState(music.bars.length);
  const duration = value(music.duration),
    totalSeconds = secondsAt(duration, music.tempos),
    actualBar =
      music.bars.findLast((b) => value(b.start) <= position)?.number ?? 1;
  useEffect(() => {
    setPosition(0);
    setPlaying(false);
    setSpeed(1);
    setHand("both");
    setLooped(false);
    setFrom(1);
    setTo(music.bars.length);
    let raf = 0;
    const render = () => {
      if (transport.current && engine.current) {
        transport.current.tick();
        const time = engine.current.audibleTime();
        setPosition(transport.current.position(time));
        setPlaying(transport.current.playing);
        setSounding(transport.current.audibleAt(time));
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    const interval = setInterval(() => transport.current?.tick(), 25);
    const otherPlayer = (event: Event) => {
      if ((event as CustomEvent).detail !== audioOwner.current) {
        transport.current?.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("jazz-play", otherPlayer);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
      window.removeEventListener("jazz-play", otherPlayer);
      transport.current?.pause();
      transport.current = null;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [music]);
  async function playPause() {
    if (loading) return;
    if (transport.current?.playing) {
      transport.current.pause();
      setPlaying(false);
      return;
    }
    setLoading(true);
    try {
      window.dispatchEvent(
        new CustomEvent("jazz-play", { detail: audioOwner.current }),
      );
      if (!engine.current) engine.current = new PianoAudio();
      const audio = engine.current;
      await audio.ready();
      if (engine.current !== audio) return;
      if (!transport.current) {
        transport.current = new Transport(
          engine.current,
          music.notes,
          music.tempos,
          duration,
        );
        transport.current.seek(position);
        transport.current.setSpeed(speed);
        transport.current.setHand(hand);
        if (looped) applyLoop(true);
      }
      transport.current.play();
      setPlaying(true);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }
  function seek(p: number) {
    transport.current?.seek(p);
    setPosition(p);
    if (looped && !transport.current?.loop) setLooped(false);
  }
  function applyLoop(enabled: boolean, start = from, stop = to) {
    setLooped(enabled);
    if (!transport.current) return;
    const a = music.bars[start - 1],
      b = music.bars[stop - 1];
    if (a && b)
      transport.current.setLoop(
        enabled
          ? { start: value(a.start), end: value(b.start) + value(b.duration) }
          : null,
      );
  }
  const time = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <section
      className="player"
      aria-label={mode === "practice" ? "Übemodus" : "Wiedergabe"}
    >
      <div className="player-top">
        <div>
          <span className="eyebrow light">
            {mode === "practice" ? "DEIN ÜBERAUM" : "DEIN ARRANGEMENT"}
          </span>
          <h2>
            {mode === "practice"
              ? "Ein Takt nach dem anderen."
              : "Zeit für ein bisschen Swing."}
          </h2>
        </div>
        <div className="hand-legend">
          <span>
            <i className="dot left" />
            Linke Hand
          </span>
          <span>
            <i className="dot right" />
            Rechte Hand
          </span>
        </div>
      </div>
      <PianoRoll
        notes={music.notes}
        tempos={music.tempos}
        position={position}
        hand={hand}
        playing={sounding}
      />
      <div className="player-controls">
        <button
          className="round secondary-dark"
          aria-label="Zum Anfang"
          onClick={() => seek(0)}
        >
          <RotateCcw size={19} />
        </button>
        <button
          className="play-button"
          onClick={playPause}
          disabled={loading}
          aria-label={playing ? "Pause" : "Abspielen"}
        >
          {playing ? (
            <Pause size={23} fill="currentColor" />
          ) : (
            <Play size={23} fill="currentColor" />
          )}
        </button>
        <div className="progress">
          <input
            aria-label="Position"
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={position}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <div>
            <span>{time(secondsAt(position, music.tempos))}</span>
            <span>
              Takt {actualBar} / {music.bars.length}
            </span>
            <span>{time(totalSeconds)}</span>
          </div>
        </div>
        <Volume2 size={19} className="volume-icon" />
      </div>
      {loading && (
        <p className="audio-status" role="status">
          Klavier wird vorbereitet …
        </p>
      )}
      <div className="practice-controls">
        <label>
          Tempo{" "}
          <select
            aria-label="Übetempo"
            value={speed}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSpeed(n);
              transport.current?.setSpeed(n);
            }}
          >
            {[1, 0.9, 0.75, 0.5, 0.25].map((n) => (
              <option key={n} value={n}>
                {n * 100} %
              </option>
            ))}
          </select>
        </label>
        <div className="hand-switch" role="group" aria-label="Hände üben">
          {(["both", "left", "right"] as const).map((h) => (
            <button
              key={h}
              className={hand === h ? "selected" : ""}
              onClick={() => {
                setHand(h);
                transport.current?.setHand(h);
              }}
            >
              {h === "both"
                ? "Beide Hände"
                : h === "left"
                  ? "Nur links"
                  : "Nur rechts"}
            </button>
          ))}
        </div>
        <div className="loop-control">
          <button
            className={looped ? "loop-button enabled" : "loop-button"}
            onClick={() => applyLoop(!looped)}
            aria-label="Taktbereich wiederholen"
            aria-pressed={looped}
          >
            <Repeat2 size={18} />
          </button>
          <label>
            Von{" "}
            <select
              aria-label="Wiederholen ab Takt"
              value={from}
              onChange={(e) => {
                const n = Number(e.target.value);
                setFrom(n);
                const stop = Math.max(n, to);
                setTo(stop);
                applyLoop(looped, n, stop);
              }}
            >
              {music.bars.map((b) => (
                <option key={b.number}>{b.number}</option>
              ))}
            </select>
          </label>
          <label>
            bis{" "}
            <select
              aria-label="Wiederholen bis Takt"
              value={to}
              onChange={(e) => {
                const n = Number(e.target.value);
                setTo(n);
                const start = Math.min(from, n);
                setFrom(start);
                applyLoop(looped, start, n);
              }}
            >
              {music.bars.map((b) => (
                <option key={b.number}>{b.number}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="player-note">
        <Headphones size={16} />
        <span>
          {mode === "practice"
            ? "Spiele in deinem Tempo. Ein Keyboard ist optional."
            : "Alles erklingt als akustisches Klavier."}
        </span>
        {onSave && (
          <button onClick={onSave}>
            <Download size={16} />
            MIDI speichern
          </button>
        )}
      </div>
    </section>
  );
}
