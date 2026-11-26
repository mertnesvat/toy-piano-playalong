// Turkish transcription with word timestamps, in the browser (transformers.js). Audio never leaves the machine;
// only the model weights are downloaded (from the Hugging Face CDN, cached by the browser afterwards).
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let loaded = '';

self.onmessage = async (e: MessageEvent<{ audio: Float32Array; model: string }>) => {
  try {
    const { audio, model } = e.data;
    if (loaded !== model) {
      const files = new Map<string, { loaded: number; total: number }>();
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status !== 'progress' || !p.file) return;
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          let l = 0, t = 0;
          files.forEach((f) => { l += f.loaded; t += f.total; });
          post({ type: 'progress', label: `Downloading Whisper (${Math.round(t / 1e6)} MB, once)`, pct: t ? l / t : 0 });
        },
      });
      loaded = model;
    }
    post({ type: 'progress', label: 'Transcribing (this can take a few minutes)', pct: -1 });
    const out = await asr(audio, { language: 'turkish', task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
    const words = (out.chunks ?? [])
      .map((c: { text: string; timestamp: [number, number | null] }) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
      .filter((w: { text: string }) => w.text);
    post({ type: 'done', words, text: out.text });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.stack ?? err) });
  }
};
