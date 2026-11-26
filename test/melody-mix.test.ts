// Regression: a sung melody over a loud bass line and chords, through the real Basic Pitch model (CPU, in Node).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as tf from '@tensorflow/tfjs';
import { basicPitchMelody } from '../src/basicpitch';
import { noteStarts, synth } from './synth';

const SR = 22050;
const loadModel = () => {
  const dir = 'node_modules/@spotify/basic-pitch/model/';
  const json = JSON.parse(readFileSync(dir + 'model.json', 'utf8'));
  const w = readFileSync(dir + 'group1-shard1of1.bin');
  return tf.loadGraphModel(tf.io.fromMemory({ modelTopology: json.modelTopology, weightSpecs: json.weightsManifest[0].weights, weightData: w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength) }));
};
const mix = (...parts: [Float32Array, number][]) => {
  const x = new Float32Array(Math.max(...parts.map(([p]) => p.length)));
  for (const [p, g] of parts) p.forEach((v, i) => (x[i] += g * v));
  return x;
};

// Twinkle Twinkle (traditional) in C, sung with vibrato: C C G G A A G, F F E E D D C
const tune = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
const melody = tune.map((midi, i) => ({ midi, dur: i % 7 === 6 ? 0.95 : 0.45, rest: 0.05, vibrato: 0.3 }));
const total = melody.reduce((a, n) => a + n.dur + n.rest, 0);
// a loud bass line two octaves down, and sustained triads in the octave below the melody (C3-B3)
const chordRoots = [48, 53, 48, 55, 53, 48, 55, 48];
const bass = chordRoots.map((r) => ({ midi: r - 12, dur: total / 8 - 0.05, rest: 0.05 }));
const triad = (k: number) => chordRoots.map((r) => ({ midi: 48 + ((r + [0, 4, 7][k]) % 12), dur: total / 8 - 0.05, rest: 0.05 }));
const audio = mix([synth(melody, SR), 1], [synth(bass, SR), 0.8], [synth(triad(0), SR), 0.3], [synth(triad(1), SR), 0.3], [synth(triad(2), SR), 0.3]);
const starts = noteStarts(melody);

describe('melody over bass and chords (generated audio, real Basic Pitch)', () => {
  it('extracts the sung line, in its own range', async () => {
    const { notes } = await basicPitchMelody(loadModel(), audio);
    const mids = notes.map((n) => n.midi);
    // the line stays in the singer's register: no bass, no chord tones an octave off
    expect(Math.min(...mids)).toBeGreaterThanOrEqual(59);
    expect(Math.max(...mids)).toBeLessThanOrEqual(70);
    // each sung note is found (exact pitch) at its middle
    const found = tune.filter((m, i) => notes.some((n) => n.midi === m && n.start <= starts[i] + 0.2 && n.end >= starts[i] + 0.2)).length;
    expect(found / tune.length).toBeGreaterThanOrEqual(0.85);
    // and not buried in extra notes
    expect(notes.length).toBeLessThanOrEqual(tune.length + 3);
  }, 120000);
});
