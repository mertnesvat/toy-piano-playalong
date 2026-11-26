// Audio input: decode/resample files, and record from the microphone or a captured Chrome tab.

/** Decode any browser-playable audio and resample it to mono at `sr`. */
export async function decodeMono(blob: Blob, sr: number): Promise<{ pcm: Float32Array; duration: number }> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * sr), sr);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return { pcm: out.getChannelData(0), duration: buf.duration };
  } finally {
    ctx.close();
  }
}

export interface Recording {
  stop: () => Promise<Blob>;
  /** Peak level (0..1) heard since recording started; ~0 means nothing was captured. */
  peak: () => number;
  level: () => number;
}

/** Record a MediaStream's audio, with a live level meter. */
function record(stream: MediaStream): Recording {
  const audioOnly = new MediaStream(stream.getAudioTracks());
  const rec = new MediaRecorder(audioOnly, { mimeType: 'audio/webm;codecs=opus' });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  ctx.createMediaStreamSource(audioOnly).connect(an);
  // a captured tab goes silent for the user unless we route it back out
  if (stream.getVideoTracks().length) ctx.createMediaStreamSource(audioOnly).connect(ctx.destination);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  const level = () => {
    an.getFloatTimeDomainData(buf);
    let m = 0;
    for (const v of buf) m = Math.max(m, Math.abs(v));
    peak = Math.max(peak, m);
    return m;
  };
  return {
    level,
    peak: () => peak,
    stop: () =>
      new Promise<Blob>((res) => {
        rec.onstop = () => res(new Blob(chunks, { type: 'audio/webm' }));
        rec.stop();
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      }),
  };
}

export async function recordMic(): Promise<Recording> {
  // no processing: echo cancellation / noise suppression would mangle music
  const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  return record(s);
}

export async function recordTab(): Promise<Recording> {
  const s = await navigator.mediaDevices.getDisplayMedia({
    video: true, // Chrome requires video to offer tab audio; we drop it
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as MediaTrackConstraints,
    // @ts-expect-error Chrome-only hints
    preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'exclude',
  });
  if (!s.getAudioTracks().length) {
    s.getTracks().forEach((t) => t.stop());
    throw new Error('No audio was shared. Pick a Chrome tab and keep "Also share tab audio" switched on.');
  }
  return record(s);
}
