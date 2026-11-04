"""Portable reference mix from the same exported musical events and piano samples.

These WAVs help with manual musical review; they are not an audio-device latency test.
"""
import array
import json
import math
import pathlib
import sys
import wave

source = pathlib.Path(sys.argv[1])
data = json.loads(source.read_text())
rate = 22050
bank = []
for item in data['bank']:
    with wave.open(item['wav']) as f:
        channels = f.getnchannels()
        assert f.getsampwidth() == 2 and f.getframerate() == rate
        samples = array.array('h', f.readframes(f.getnframes()))
        mono = [sum(samples[i:i + channels]) / channels / 32768 for i in range(0, len(samples), channels)]
        bank.append((item['pitch'], mono))

for track in data['tracks']:
    duration = max(n['start'] + n['duration'] for n in track['notes']) + .5
    mixed = [0.0] * math.ceil(duration * rate)
    for note in track['notes']:
        pitch, samples = min(bank, key=lambda item: abs(item[0] - note['pitch']))
        ratio = 2 ** ((note['pitch'] - pitch) / 12)
        first = round(note['start'] * rate)
        length = min(round((note['duration'] + .14) * rate), len(mixed) - first)
        gain = (note['velocity'] / 127) ** 1.5 * .55 * .55
        for i in range(length):
            pos = i * ratio
            index = int(pos)
            if index + 1 >= len(samples):
                break
            t = i / rate
            envelope = min(1, t / .004)
            if t > note['duration']:
                envelope *= .0001 ** ((t - note['duration']) / .12)
            sample = samples[index] + (samples[index + 1] - samples[index]) * (pos - index)
            mixed[first + i] += sample * gain * envelope
    pcm = array.array('h', (round(max(-1, min(.9999, s)) * 32767) for s in mixed))
    file = source.parent / f"Hoerprobe-{track['name']}.wav"
    with wave.open(str(file), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(pcm.tobytes())
    print(f'Rendered {file.name}: {duration:.1f}s, peak {max(abs(s) for s in mixed):.3f}')
