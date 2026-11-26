// Writes a generated test song (no copyrighted audio): a hicaz-flavoured melody with known notes over a quiet drone.
// Usage: node --experimental-strip-types scripts/make-test-melody.ts out.wav [detuneCents]  -> also writes out.json with expected keys.
// detuneCents imitates an old 78rpm transfer that runs sharp or flat.
import { writeFileSync } from 'node:fs';
import { mapToToy } from '../src/mapping.ts';
import { synth } from '../test/synth.ts';

const sr = 22050;
// G A Bb C# D ... (D hicaz), crossing the toy's C so folding is exercised; 0.35-0.7 s notes
const tune = [62, 63, 66, 67, 69, 67, 66, 63, 62, 62, 69, 70, 69, 67, 66, 67, 66, 63, 62, 60, 62, 63, 66, 63, 62, 57, 58, 61, 62, 64, 62, 61, 62];
const melody = tune.map((midi, i) => ({ midi, dur: i % 4 === 3 ? 0.7 : 0.38, rest: 0.07 }));
const detune = Number(process.argv[3] ?? 0) / 100;
const x = synth(melody.map((n) => ({ ...n, midi: n.midi + detune })), sr);
const drone = 440 * 2 ** ((38 - 69) / 12); // D2, quiet, like a tanbur drone under the voice
for (let i = 0; i < x.length; i++) x[i] += 0.12 * Math.sin((2 * Math.PI * drone * i) / sr);

const out = process.argv[2] ?? 'test-melody.wav';
const pcm = Buffer.alloc(44 + x.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + x.length * 2, 4); pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24);
pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(x.length * 2, 40);
x.forEach((v, i) => pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
writeFileSync(out, pcm);
let t = 0.1;
const notes = melody.map((n) => { const s = t; t += n.dur + n.rest; return { start: s, end: s + n.dur, midi: n.midi }; });
writeFileSync(out.replace(/\.wav$/, '.json'), JSON.stringify({ notes, keys: mapToToy(tune).keys, whiteKeys: mapToToy(tune, { whiteOnly: true }).keys }, null, 1));
console.log(`wrote ${out}: ${tune.length} notes, ${(x.length / sr).toFixed(1)} s`);
