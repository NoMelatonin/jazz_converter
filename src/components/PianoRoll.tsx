import { useEffect, useRef } from "react";
import type { Note, Tempo } from "../core/model";
import { secondsAt, value } from "../core/time";
import type { PracticeHand } from "../core/transport";

const black = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);
const keys = Array.from({ length: 88 }, (_, i) => i + 21);
const whites = keys.filter((p) => !black(p));
export function keyGeometry(pitch: number, width: number) {
  const w = width / 52;
  if (!black(pitch))
    return { x: whites.indexOf(pitch) * w, width: w, black: false };
  const next = whites.findIndex((p) => p > pitch);
  return { x: next * w - w * 0.32, width: w * 0.64, black: true };
}
export function PianoRoll({
  notes,
  tempos,
  position,
  hand,
  playing,
}: {
  notes: Note[];
  tempos: Tempo[];
  position: number;
  hand: PracticeHand;
  playing: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!;
    const draw = () => {
      const rect = el.getBoundingClientRect(),
        ratio = window.devicePixelRatio || 1;
      el.width = Math.round(rect.width * ratio);
      el.height = Math.round(rect.height * ratio);
      const ctx = el.getContext("2d")!;
      ctx.scale(ratio, ratio);
      const w = rect.width,
        h = rect.height,
        keyboard = 100,
        lane = h - keyboard;
      ctx.fillStyle = "#111d22";
      ctx.fillRect(0, 0, w, h);
      for (const p of whites) {
        const k = keyGeometry(p, w);
        if (p % 12 === 0) {
          ctx.fillStyle = "#ffffff05";
          ctx.fillRect(k.x, 0, k.width, lane);
        }
        ctx.strokeStyle = "#ffffff06";
        ctx.beginPath();
        ctx.moveTo(k.x, 0);
        ctx.lineTo(k.x, lane);
        ctx.stroke();
      }
      const now = secondsAt(position, tempos),
        horizon = 4;
      for (let i = 1; i <= 4; i++) {
        const y = lane - (i / horizon) * lane;
        ctx.strokeStyle = "#ffffff0c";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      const active = new Map<number, "left" | "right">();
      for (const note of notes) {
        if (hand !== "both" && note.hand !== hand) continue;
        const start = secondsAt(value(note.start), tempos),
          stop = secondsAt(value(note.start) + value(note.duration), tempos);
        if (stop < now || start > now + horizon) continue;
        const k = keyGeometry(note.pitch, w);
        if (k.x < 0) continue;
        const y = lane - ((stop - now) / horizon) * lane,
          bottom = lane - ((start - now) / horizon) * lane;
        const top = Math.max(0, y),
          height = Math.min(lane, bottom) - top;
        if (height > 0) {
          ctx.fillStyle = note.hand === "left" ? "#77b9d1" : "#f2aa6f";
          ctx.beginPath();
          ctx.roundRect(
            k.x + 1.5,
            top,
            Math.max(2, k.width - 3),
            Math.max(2, height),
            3,
          );
          ctx.fill();
        }
        if (playing && start <= now && stop > now)
          active.set(note.pitch, note.hand ?? "right");
      }
      for (const p of whites) {
        const k = keyGeometry(p, w),
          own = active.get(p);
        ctx.fillStyle = own
          ? own === "left"
            ? "#77b9d1"
            : "#f2aa6f"
          : "#f7f6f0";
        ctx.fillRect(k.x, lane, k.width - 1, keyboard - 1);
        if (p % 12 === 0 || p === 21) {
          ctx.fillStyle = "#586366";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(
            p === 21 ? "A0" : `C${Math.floor(p / 12) - 1}`,
            k.x + k.width / 2,
            h - 12,
          );
        }
      }
      for (const p of keys.filter(black)) {
        const k = keyGeometry(p, w),
          own = active.get(p);
        ctx.fillStyle = own
          ? own === "left"
            ? "#4c93ad"
            : "#d78140"
          : "#18252b";
        ctx.beginPath();
        ctx.roundRect(k.x, lane, k.width, 62, [0, 0, 3, 3]);
        ctx.fill();
      }
      ctx.fillStyle = "#d6aa69";
      ctx.fillRect(0, lane - 2, w, 2);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [notes, tempos, position, hand, playing]);
  return (
    <canvas
      ref={canvas}
      className="piano-roll"
      role="img"
      aria-label="Klaviatur mit 88 Tasten. Linke Hand blau, rechte Hand orange. Fallende Balken zeigen Beginn und Dauer der Töne."
      data-testid="piano-roll"
      data-position={position.toFixed(3)}
    />
  );
}
