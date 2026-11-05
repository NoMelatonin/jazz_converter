import type { Note, Tempo } from "./model";
import { beatAtSeconds, secondsAt, value } from "./time";
import { assertTimeline } from "./playback";
export type PracticeHand = "both" | "left" | "right";
export interface PlaybackSink {
  now(): number;
  cancel(): void;
  schedule(note: Note, when: number, duration: number, elapsed: number): void;
}
export interface Loop {
  start: number;
  end: number;
}
export class Transport {
  playing = false;
  speed = 1;
  hand: PracticeHand = "both";
  loop: Loop | null = null;
  private anchorTime = 0;
  private anchorSong = 0;
  private stopped = 0;
  private scheduled = new Set<string>();
  private timeline: { note: Note; start: number; end: number }[];
  constructor(
    private sink: PlaybackSink,
    readonly notes: Note[],
    readonly tempos: Tempo[],
    readonly duration: number,
  ) {
    assertTimeline(notes, tempos, duration);
    this.timeline = notes.map((note) => ({
      note,
      start: secondsAt(value(note.start), tempos),
      end: secondsAt(value(note.start) + value(note.duration), tempos),
    }));
  }
  position(time = this.sink.now()): number {
    if (!this.playing) return this.stopped;
    let seconds =
      this.anchorSong + Math.max(0, time - this.anchorTime) * this.speed;
    if (this.loop) {
      const start = secondsAt(this.loop.start, this.tempos),
        length = secondsAt(this.loop.end, this.tempos) - start;
      seconds = start + ((((seconds - start) % length) + length) % length);
    }
    return Math.min(
      this.duration,
      Math.max(0, beatAtSeconds(seconds, this.tempos)),
    );
  }
  audibleAt(time: number) {
    return this.playing && time >= this.anchorTime;
  }
  private reanchor(position: number) {
    this.sink.cancel();
    this.scheduled.clear();
    this.stopped = position;
    this.anchorSong = secondsAt(position, this.tempos);
    this.anchorTime = this.sink.now() + 0.025;
  }
  play() {
    let position = this.stopped >= this.duration ? 0 : this.stopped;
    if (this.loop && (position < this.loop.start || position >= this.loop.end))
      position = this.loop.start;
    this.reanchor(position);
    this.playing = true;
    this.tick();
  }
  pause() {
    const position = this.position();
    this.playing = false;
    this.reanchor(position);
  }
  seek(position: number) {
    position = Math.max(0, Math.min(this.duration, position));
    if (this.loop && (position < this.loop.start || position >= this.loop.end))
      this.loop = null;
    this.reanchor(position);
    if (this.playing) this.tick();
  }
  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 1)
      throw new Error("Ungültiges Übetempo.");
    const p = this.position();
    this.speed = speed;
    this.reanchor(p);
    if (this.playing) this.tick();
  }
  setHand(hand: PracticeHand) {
    const p = this.position();
    this.hand = hand;
    this.reanchor(p);
    if (this.playing) this.tick();
  }
  setLoop(loop: Loop | null) {
    if (
      loop &&
      (loop.start < 0 || loop.end > this.duration || loop.end <= loop.start)
    )
      throw new Error("Ungültiger Wiederholungsbereich.");
    this.loop = loop;
    const position = this.position();
    this.reanchor(
      loop && (position < loop.start || position >= loop.end)
        ? loop.start
        : position,
    );
    if (this.playing) this.tick();
  }
  tick() {
    if (!this.playing) return;
    const now = this.sink.now();
    const position = this.position(now);
    if (!this.loop && position >= this.duration) {
      this.playing = false;
      this.reanchor(this.duration);
      return;
    }
    const time = this.sink.now(),
      current =
        this.anchorSong + Math.max(0, time - this.anchorTime) * this.speed;
    if (this.loop) {
      const start = secondsAt(this.loop.start, this.tempos),
        stop = secondsAt(this.loop.end, this.tempos),
        length = stop - start;
      const cycle = Math.max(0, Math.floor((current - start) / length));
      for (const key of this.scheduled)
        if (Number(key.split(":")[0]) < cycle - 1) this.scheduled.delete(key);
      for (let pass = cycle; pass <= cycle + 1; pass++) {
        const base =
          this.anchorTime +
          (start + pass * length - this.anchorSong) / this.speed;
        for (const n of this.timeline) {
          const id = `${pass}:${n.note.id}`;
          if (
            this.scheduled.has(id) ||
            (this.hand !== "both" && n.note.hand !== this.hand) ||
            n.end <= start ||
            n.start >= stop
          )
            continue;
          const when = base + (Math.max(start, n.start) - start) / this.speed,
            end = base + (Math.min(stop, n.end) - start) / this.speed;
          if (when > time + 0.12 || end <= time + 0.003) continue;
          const actual = Math.max(when, time + 0.003, this.anchorTime);
          if (end <= actual) continue;
          this.sink.schedule(
            n.note,
            actual,
            end - actual,
            Math.max(0, actual - base - (n.start - start) / this.speed),
          );
          this.scheduled.add(id);
        }
      }
      return;
    }
    const loopEnd = Infinity;
    for (const n of this.timeline) {
      if (
        this.scheduled.has(n.note.id) ||
        (this.hand !== "both" && n.note.hand !== this.hand)
      )
        continue;
      if (n.end <= current || n.start >= loopEnd) continue;
      const when = this.anchorTime + (n.start - this.anchorSong) / this.speed;
      if (when > time + 0.12) continue;
      const actual = Math.max(when, time + 0.003, this.anchorTime),
        end =
          this.anchorTime +
          (Math.min(n.end, loopEnd) - this.anchorSong) / this.speed;
      if (end <= actual) continue;
      this.sink.schedule(
        n.note,
        actual,
        end - actual,
        Math.max(0, (current - n.start) / this.speed),
      );
      this.scheduled.add(n.note.id);
    }
  }
  active(position = this.position()): Note[] {
    return this.notes.filter(
      (n) =>
        (this.hand === "both" || n.hand === this.hand) &&
        value(n.start) <= position &&
        value(n.start) + value(n.duration) > position,
    );
  }
}
