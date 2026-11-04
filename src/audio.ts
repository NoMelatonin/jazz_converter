import type { Note } from "./core/model";
import type { PlaybackSink } from "./core/transport";

export class PianoAudio implements PlaybackSink {
  readonly context = new AudioContext({ latencyHint: "interactive" });
  private samples: { pitch: number; buffer: AudioBuffer }[] = [];
  private voices = new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
  private master = this.context.createGain();
  private loaded?: Promise<void>;
  constructor() {
    this.master.gain.value = 0.55;
    this.master.connect(this.context.destination);
  }
  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const response = await fetch(
        new URL("piano/manifest.json", document.baseURI),
      );
      if (!response.ok)
        throw new Error(
          "Die mitgelieferten Klaviersamples fehlen. Bitte die App neu installieren.",
        );
      const manifest = (await response.json()) as Record<
        string,
        { file: string }
      >;
      this.samples = await Promise.all(
        Object.entries(manifest).map(async ([name, info]) => {
          const root = /^(A|C|Ds|Fs)(\d)$/.exec(name)!;
          const pitch =
            12 * (Number(root[2]) + 1) +
            ({ A: 9, C: 0, Ds: 3, Fs: 6 } as Record<string, number>)[root[1]];
          const sound = await fetch(
            new URL(`piano/${info.file}`, document.baseURI),
          );
          if (!sound.ok) throw new Error(`Klaviersample ${name} fehlt.`);
          return {
            pitch,
            buffer: await this.context.decodeAudioData(
              await sound.arrayBuffer(),
            ),
          };
        }),
      );
      this.samples.sort((a, b) => a.pitch - b.pitch);
    })().catch((error) => {
      this.loaded = undefined;
      throw error;
    }));
  }
  async ready() {
    await this.load();
    await this.context.resume();
  }
  now() {
    return this.context.currentTime;
  }
  audibleTime() {
    const timestamp = this.context.getOutputTimestamp();
    return (timestamp.contextTime ?? 0) > 0
      ? Math.min(
          this.now(),
          timestamp.contextTime! +
            Math.max(0, performance.now() - timestamp.performanceTime!) / 1000,
        )
      : Math.max(0, this.now() - (this.context.outputLatency || 0));
  }
  schedule(note: Note, when: number, duration: number, elapsed: number) {
    if (!this.samples.length)
      throw new Error("Das Klavier ist noch nicht geladen.");
    const sample = this.samples.reduce((best, current) =>
      Math.abs(current.pitch - note.pitch) < Math.abs(best.pitch - note.pitch)
        ? current
        : best,
    );
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = sample.buffer;
    const rate = 2 ** ((note.pitch - sample.pitch) / 12);
    source.playbackRate.value = rate;
    source.connect(gain);
    gain.connect(this.master);
    const level = Math.max(0.01, (note.velocity / 127) ** 1.5 * 0.55);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.004);
    gain.gain.setValueAtTime(level, when + Math.max(0.005, duration));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.12);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      source.disconnect();
      gain.disconnect();
    };
    const offset = Math.min(
      elapsed * rate,
      Math.max(0, sample.buffer.duration - 0.05),
    );
    source.start(when, offset);
    source.stop(when + duration + 0.14);
  }
  cancel() {
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(this.now());
      voice.gain.gain.setTargetAtTime(0.0001, this.now(), 0.002);
      try {
        voice.source.stop(this.now() + 0.01);
      } catch {
        /* Already ended. */
      }
    }
    this.voices.clear();
  }
  dispose() {
    this.cancel();
    void this.context.close();
  }
}
