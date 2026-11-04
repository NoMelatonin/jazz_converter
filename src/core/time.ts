import type { Bar, Beat, Meter, Tempo } from "./model";
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
export function beat(n: number, d = 1): Beat {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d <= 0)
    throw new Error("Ungültiger musikalischer Zeitwert.");
  const g = gcd(Math.abs(n), d) || 1;
  return { n: n / g, d: d / g };
}
export const value = (a: Beat) => a.n / a.d;
export const add = (a: Beat, b: Beat) => beat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Beat, b: Beat) => beat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Beat, n: number, d = 1) => beat(a.n * n, a.d * d);
export const cmp = (a: Beat, b: Beat) => a.n * b.d - b.n * a.d;
export const end = (note: { start: Beat; duration: Beat }) =>
  add(note.start, note.duration);
export const max = (...a: Beat[]) =>
  a.reduce((x, y) => (cmp(x, y) > 0 ? x : y), beat(0));
export function barsFor(duration: Beat, meters: Meter[]): Bar[] {
  const bars: Bar[] = [];
  let at = beat(0);
  let mi = 0;
  while (cmp(at, duration) < 0 && bars.length < 20000) {
    while (mi + 1 < meters.length && cmp(meters[mi + 1].at, at) <= 0) mi++;
    const meter = meters[mi];
    let length = beat(meter.numerator * 4, meter.denominator);
    if (meters[mi + 1] && cmp(add(at, length), meters[mi + 1].at) > 0)
      length = sub(meters[mi + 1].at, at);
    if (cmp(add(at, length), duration) > 0) length = sub(duration, at);
    if (value(length) <= 0) throw new Error("Ungültige Taktfolge.");
    bars.push({
      number: bars.length + 1,
      start: at,
      duration: length,
      numerator: meter.numerator,
      denominator: meter.denominator,
    });
    at = add(at, length);
  }
  if (cmp(at, duration) < 0)
    throw new Error("Die Datei enthält zu viele Takte.");
  return bars;
}
export function secondsAt(position: number, tempos: Tempo[]): number {
  let seconds = 0;
  for (let i = 0; i < tempos.length; i++) {
    const start = value(tempos[i].at),
      stop = Math.min(
        position,
        tempos[i + 1] ? value(tempos[i + 1].at) : position,
      );
    if (stop > start) seconds += ((stop - start) * 60) / tempos[i].bpm;
    if (stop >= position) break;
  }
  return seconds;
}
export function beatAtSeconds(seconds: number, tempos: Tempo[]): number {
  let rest = Math.max(0, seconds);
  for (let i = 0; i < tempos.length; i++) {
    const start = value(tempos[i].at),
      next = tempos[i + 1] ? value(tempos[i + 1].at) : Infinity;
    const duration = ((next - start) * 60) / tempos[i].bpm;
    if (rest <= duration) return start + (rest * tempos[i].bpm) / 60;
    rest -= duration;
  }
  return 0;
}
