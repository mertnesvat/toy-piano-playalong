// Turkish transcription with word timestamps, in the browser (transformers.js). Audio never leaves the machine;
// only the model weights are downloaded (from the Hugging Face CDN, cached by the browser afterwards).
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let loaded = '';
let device: 'webgpu' | 'wasm' = 'wasm';

self.onmessage = async (e: MessageEvent<{ audio: Float32Array; model: string }>) => {
  try {
    const { audio, model } = e.data;
    if (loaded !== model) {
      const files = new Map<string, { loaded: number; total: number }>();
      // WebGPU is many times faster; plain WASM is single-threaded here (Pages can't send the COOP/COEP headers threads need)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = await (navigator as any).gpu?.requestAdapter().catch(() => null);
      device = adapter ? 'webgpu' : 'wasm';
      // fp16 encoder halves the download when the GPU supports it (small: 176 MB vs 353 MB)
      const encoder = adapter?.features.has('shader-f16') ? 'fp16' : 'fp32';
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: adapter ? { encoder_model: encoder, decoder_model_merged: 'q4' } : 'q8',
        device,
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
    post({ type: 'progress', label: `Transcribing on the ${device === 'webgpu' ? 'graphics card' : 'CPU'} (this can take a few minutes)`, pct: -1 });
    const out = await asr(audio, { language: 'turkish', task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
    const words = (out.chunks ?? [])
      .map((c: { text: string; timestamp: [number, number | null] }) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
      .filter((w: { text: string }) => w.text);
    post({ type: 'done', words, text: out.text });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.stack ?? err) });
  }
};
