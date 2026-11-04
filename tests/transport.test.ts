import { describe, expect, test } from "vitest";
import { Transport, type PlaybackSink } from "../src/core/transport";
import { beat } from "../src/core/time";
import type { Note } from "../src/core/model";
function harness() {
  let clock = 10;
  const scheduled: {
    note: Note;
    when: number;
    duration: number;
    elapsed: number;
  }[] = [];
  let cancels = 0;
  const sink: PlaybackSink = {
    now: () => clock,
    cancel: () => {
      scheduled.length = 0;
      cancels++;
    },
    schedule: (note, when, duration, elapsed) =>
      scheduled.push({ note, when, duration, elapsed }),
  };
  const notes: Note[] = [
    {
      id: "left",
      pitch: 48,
      start: beat(0),
      duration: beat(4),
      velocity: 80,
      track: "l",
      hand: "left",
    },
    {
      id: "right",
      pitch: 72,
      start: beat(1),
      duration: beat(1),
      velocity: 90,
      track: "r",
      hand: "right",
    },
  ];
  const t = new Transport(sink, notes, [{ at: beat(0), bpm: 120 }], 8);
  return {
    t,
    scheduled,
    advance: (delta: number) => {
      clock += delta;
      t.tick();
    },
    time: () => clock,
    cancels: () => cancels,
  };
}
describe("Gemeinsamer musikalischer Transport", () => {
  test("half speed schedules unchanged pitches at double duration; keys match audible onsets", () => {
    const h = harness();
    h.t.setSpeed(0.5);
    h.t.play();
    expect(h.scheduled[0].note.pitch).toBe(48);
    expect(h.scheduled[0].duration).toBeCloseTo(4, 6);
    h.advance(0.93);
    const right = h.scheduled.find((n) => n.note.id === "right")!;
    expect(right.when).toBeCloseTo(11.025, 6);
    expect(right.duration).toBeCloseTo(1, 6);
    expect(h.t.active(h.t.position(right.when)).map((n) => n.pitch)).toContain(
      72,
    );
    expect(
      h.t
        .active(h.t.position(right.when + right.duration + 0.001))
        .map((n) => n.pitch),
    ).not.toContain(72);
  });
  test("seeking cancels stale notes and reconstructs notes held across destination", () => {
    const h = harness();
    h.t.play();
    h.advance(0.7);
    const before = h.cancels();
    h.t.seek(3);
    expect(h.cancels()).toBeGreaterThan(before);
    expect(h.scheduled.map((n) => n.note.id)).toEqual(["left"]);
    expect(h.scheduled[0].duration).toBeCloseTo(0.5, 6);
    expect(h.t.position()).toBe(3);
    expect(h.t.active().map((n) => n.pitch)).toEqual([48]);
  });
  test("tempo change reanchors without position jump or stale scheduled audio", () => {
    const h = harness();
    h.t.play();
    h.advance(0.525);
    const p = h.t.position();
    h.t.setSpeed(0.5);
    expect(h.t.position()).toBeCloseTo(p, 6);
    expect(h.scheduled.find((n) => n.note.id === "left")!.duration).toBeCloseTo(
      3,
      6,
    );
    h.advance(0.525);
    expect(h.t.position()).toBeCloseTo(p + 0.5, 6);
  });
  test("hand isolation, pause, resume and natural end clear scheduled notes", () => {
    const h = harness();
    h.t.setHand("right");
    h.t.play();
    expect(h.scheduled).toHaveLength(0);
    h.advance(0.5);
    expect(h.scheduled.every((n) => n.note.hand === "right")).toBe(true);
    h.t.pause();
    const p = h.t.position();
    expect(h.scheduled).toHaveLength(0);
    h.advance(1);
    expect(h.t.position()).toBe(p);
    h.t.play();
    h.advance(5);
    expect(h.t.playing).toBe(false);
  });
  test("loop truncates held notes and restarts at its exact musical beginning", () => {
    const h = harness();
    h.t.setLoop({ start: 1, end: 2 });
    h.t.play();
    expect(h.t.position()).toBe(1);
    expect(
      h.scheduled.every((n) => n.when + n.duration <= 10.525 + 0.00001),
    ).toBe(true);
    h.advance(0.45);
    expect(h.scheduled.some((n) => Math.abs(n.when - 10.525) < 0.00001)).toBe(
      true,
    );
    h.advance(0.076);
    expect(h.t.position()).toBeCloseTo(1.002, 6);
    expect(h.t.loop).toEqual({ start: 1, end: 2 });
    h.t.seek(5);
    expect(h.t.loop).toBeNull();
  });
});
