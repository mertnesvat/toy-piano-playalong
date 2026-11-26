import './style.css';
import { decodeMono, recordMic, recordTab, type Recording } from './audio';
import { allSongs, deleteSong, getSong, saveSong, type Song } from './db';
import { fetchLrclib, fmtTime, parseLrc, spotifyTitle, toLrc, wordsToLines, type Line } from './lyrics';
import { KEYS, bestFit, describe, mapToToy } from './mapping';
import type { Note } from './melody';
import { playView } from './play';
import { shapeImg } from './shapes';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const app = $('#app');
const tpl = (id: string) => ($<HTMLTemplateElement>(`#${id}`).content.cloneNode(true) as DocumentFragment);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const mapSong = (s: Pick<Song, 'notes' | 'whiteOnly' | 'bestFit'>) => {
  const midis = s.notes.map((n) => n.midi);
  return s.bestFit ? bestFit(midis, s.whiteOnly) : mapToToy(midis, { whiteOnly: s.whiteOnly });
};

/** Run a worker job, reporting progress into a <progress> + label. */
function runWorker<T>(worker: Worker, msg: unknown, transfer: Transferable[], prog: HTMLProgressElement, label: HTMLElement): Promise<T> {
  prog.hidden = false;
  return new Promise<T>((res, rej) => {
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') {
        label.textContent = d.label;
        if (d.pct < 0) prog.removeAttribute('value');
        else prog.value = d.pct;
      } else if (d.type === 'done') { prog.hidden = true; res(d); }
      else if (d.type === 'error') { prog.hidden = true; rej(new Error(d.message)); }
    };
    worker.onerror = (e) => { prog.hidden = true; rej(new Error(e.message)); };
    worker.postMessage(msg, transfer);
  });
}

let melodyWorker: Worker | null = null;
let whisperWorker: Worker | null = null;
let stopPlayback: (() => void) | null = null;

// ---------- routing ----------
function route() {
  stopPlayback?.();
  stopPlayback = null;
  const [, page, id] = location.hash.split('/');
  if (page === 'new') return editor();
  if (page === 'edit' && id) return getSong(id).then((s) => (s ? editor(s) : home()));
  if (page === 'play' && id) return getSong(id).then((s) => (s ? player(s) : home()));
  home();
}
addEventListener('hashchange', route);

// ---------- home / library ----------
async function home() {
  app.replaceChildren(tpl('home'));
  const list = $('#library');
  const songs = await allSongs();
  if (!songs.length) { list.innerHTML = '<li class="empty">No songs yet. Add your first one.</li>'; return; }
  list.innerHTML = '';
  for (const s of songs) {
    const li = document.createElement('li');
    const keys = mapSong(s).keys.slice(0, 10);
    li.innerHTML = `<a class="song" href="#/play/${s.id}"><b>${esc(s.title || 'Untitled')}</b><span>${esc(s.artist)}</span>
      <span class="mini">${keys.map((k) => (KEYS[k].black ? '<i class="blk"></i>' : shapeImg(KEYS[k].shape, KEYS[k].color, 14))).join('')}</span></a>
      <a class="btn ghost" href="#/edit/${s.id}">Edit</a><button class="btn ghost del">Delete</button>`;
    $('.del', li).onclick = async () => {
      if (!confirm(`Delete "${s.title}"?`)) return;
      await deleteSong(s.id);
      home();
    };
    list.append(li);
  }
}

// ---------- editor ----------
function editor(existing?: Song) {
  app.replaceChildren(tpl('editor'));
  const s: Song = existing
    ? { ...existing }
    : { id: crypto.randomUUID(), title: '', artist: '', audio: new Blob(), duration: 0, notes: [], tuning: 0, method: 'basic-pitch', lrc: '', lines: [], lyricsSource: '', whiteOnly: false, bestFit: false, createdAt: Date.now() };
  const title = $<HTMLInputElement>('#title'), artist = $<HTMLInputElement>('#artist');
  title.value = s.title; artist.value = s.artist;
  title.oninput = () => (s.title = title.value.trim());
  artist.oninput = () => (s.artist = artist.value.trim());
  const status = (id: string, msg: string, kind = '') => { const el = $(`#${id}`); el.textContent = msg; el.className = `status ${kind}`; };

  // Spotify link -> title
  $('#spotify-go').onclick = async () => {
    try {
      title.value = s.title = await spotifyTitle($<HTMLInputElement>('#spotify').value);
      status('spotify-status', 'Got the title from Spotify. Spotify does not share the artist this way, so type it if you know it.', 'ok');
    } catch (e) { status('spotify-status', (e as Error).message, 'err'); }
  };

  // ---- audio in ----
  const player = $<HTMLAudioElement>('#preview');
  const setAudio = async (blob: Blob, label: string) => {
    s.audio = blob;
    player.src = URL.createObjectURL(blob);
    player.hidden = false;
    try {
      s.duration = (await decodeMono(blob, 8000)).duration;
      status('audio-status', `${label} · ${fmtTime(s.duration)}`, 'ok');
    } catch (e) {
      status('audio-status', `Could not read this audio: ${(e as Error).message}`, 'err');
    }
    refresh();
  };
  if (existing) setAudio(existing.audio, 'Saved audio');
  $<HTMLInputElement>('#file').onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) { setAudio(f, f.name); if (!title.value) title.value = s.title = f.name.replace(/\.[^.]+$/, ''); }
  };
  let rec: Recording | null = null, meterRaf = 0;
  const startRec = async (kind: 'mic' | 'tab') => {
    try {
      rec = kind === 'mic' ? await recordMic() : await recordTab();
    } catch (e) {
      status('audio-status', (e as Error).name === 'NotAllowedError' ? 'Permission was not given.' : (e as Error).message, 'err');
      return;
    }
    $('#rec-bar').hidden = false;
    const t0 = performance.now();
    const meter = $<HTMLElement>('#meter-fill');
    const tick = () => {
      const lv = rec!.level();
      meter.style.width = `${Math.min(100, lv * 140)}%`;
      const secs = (performance.now() - t0) / 1000;
      const silent = secs > 4 && rec!.peak() < 0.003;
      status('audio-status', silent
        ? (kind === 'tab'
          ? 'Recording, but no sound is coming in. If this is the Spotify web player, Chrome may be blocking capture of its protected audio: use “Record microphone” instead and play the song out loud.'
          : 'Recording, but the microphone hears nothing. Check the input device.')
        : `Recording ${kind === 'tab' ? 'the tab' : 'the microphone'}… ${fmtTime(secs)}`, silent ? 'warn' : '');
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
    $('#rec-stop').onclick = async () => {
      cancelAnimationFrame(meterRaf);
      $('#rec-bar').hidden = true;
      const peak = rec!.peak();
      const blob = await rec!.stop();
      rec = null;
      if (peak < 0.003) {
        status('audio-status', kind === 'tab'
          ? 'Nothing was captured from the tab (silence). Spotify’s web player can block this. Use “Record microphone” and play the song from speakers instead.'
          : 'Nothing was recorded (silence).', 'err');
        return;
      }
      setAudio(blob, kind === 'tab' ? 'Captured tab audio' : 'Microphone recording');
    };
  };
  $('#rec-mic').onclick = () => startRec('mic');
  $('#rec-tab').onclick = () => startRec('tab');

  // ---- melody ----
  const method = $<HTMLSelectElement>('#method');
  method.value = s.method;
  $('#extract').onclick = async () => {
    if (!s.audio.size) return status('melody-status', 'Add audio first.', 'err');
    s.method = method.value as Song['method'];
    const btn = $<HTMLButtonElement>('#extract');
    btn.disabled = true;
    const t0 = performance.now();
    try {
      status('melody-status', 'Decoding audio…');
      melodyWorker ??= new Worker(new URL('./workers/melody.worker.ts', import.meta.url), { type: 'module' });
      const sr = s.method === 'yin' ? 16000 : 22050;
      const { pcm } = await decodeMono(s.audio, sr);
      const msg = s.method === 'yin'
        ? { kind: 'yin', audio: pcm, sr }
        : { kind: 'basic-pitch', audio: pcm, modelUrl: new URL('models/basic-pitch/model.json', location.href).href };
      const r = await runWorker<{ notes: Note[]; tuning: number }>(melodyWorker, msg, [pcm.buffer], $('#melody-prog'), $('#melody-status'));
      s.notes = r.notes; s.tuning = r.tuning;
      status('melody-status', `Found ${r.notes.length} notes in ${((performance.now() - t0) / 1000).toFixed(1)} s.`, 'ok');
      refresh();
    } catch (e) {
      console.error(e);
      status('melody-status', `Melody extraction failed: ${(e as Error).message.split('\n')[0]}`, 'err');
    } finally { btn.disabled = false; }
  };

  // ---- lyrics ----
  const lrc = $<HTMLTextAreaElement>('#lrc');
  lrc.value = s.lrc;
  const lyricsFrom = (text: string, source: string, keep: Line[] = []) => {
    const first = s.notes[0]?.start ?? 0, last = s.notes.at(-1)?.end ?? s.duration;
    s.lines = parseLrc(text, first, last || s.duration, keep);
    s.lrc = lrc.value = text;
    s.lyricsSource = source;
  };
  lrc.onchange = () => lyricsFrom(lrc.value, s.lyricsSource ? `${s.lyricsSource}, edited` : 'Typed in', s.lines);
  $('#lrclib').onclick = async () => {
    if (!s.title) return status('lyrics-status', 'Type the song title first.', 'err');
    status('lyrics-status', 'Searching LRCLIB…');
    try {
      const hit = await fetchLrclib(s.title, s.artist, s.duration || undefined);
      if (!hit) return status('lyrics-status', 'LRCLIB has no lyrics for this song. Try “Transcribe with Whisper”, or paste them below.', 'warn');
      lyricsFrom(hit.lrc, hit.source);
      status('lyrics-status', `Found ${hit.synced ? 'synced' : 'unsynced (lines spread evenly)'} lyrics: ${hit.source}. Check it is the same recording.`, 'ok');
    } catch (e) { status('lyrics-status', `LRCLIB failed: ${(e as Error).message}`, 'err'); }
  };
  $('#whisper').onclick = async () => {
    if (!s.audio.size) return status('lyrics-status', 'Add audio first.', 'err');
    const btn = $<HTMLButtonElement>('#whisper');
    btn.disabled = true;
    try {
      status('lyrics-status', 'Decoding audio…');
      whisperWorker ??= new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), { type: 'module' });
      const { pcm } = await decodeMono(s.audio, 16000);
      const r = await runWorker<{ words: { text: string; start: number; end: number }[] }>(
        whisperWorker, { audio: pcm, model: $<HTMLSelectElement>('#whisper-model').value }, [pcm.buffer], $('#lyrics-prog'), $('#lyrics-status'));
      const lines = wordsToLines(r.words);
      s.lines = lines; s.lrc = lrc.value = toLrc(lines); s.lyricsSource = 'Whisper transcription';
      status('lyrics-status', `Transcribed ${r.words.length} words. Machine transcription of old recordings makes mistakes: fix the text below.`, 'ok');
    } catch (e) {
      console.error(e);
      status('lyrics-status', `Transcription failed: ${(e as Error).message.split('\n')[0]}`, 'err');
    } finally { btn.disabled = false; }
  };

  // ---- mapping ----
  const white = $<HTMLInputElement>('#white-only'), fit = $<HTMLInputElement>('#best-fit');
  white.checked = s.whiteOnly; fit.checked = s.bestFit;
  white.onchange = () => { s.whiteOnly = white.checked; refresh(); };
  fit.onchange = () => { s.bestFit = fit.checked; refresh(); };
  function refresh() {
    const ok = s.notes.length > 0 && s.audio.size > 0;
    $<HTMLButtonElement>('#save').disabled = !ok;
    if (!s.notes.length) { $('#mapping').textContent = 'Extract the melody to see how it fits the toy.'; return; }
    const r = mapSong(s);
    $('#mapping').innerHTML = `<ul>${describe(s.notes.map((n) => n.midi), r, s.tuning).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="strip">${r.keys.slice(0, 40).map((k) => (KEYS[k].black ? '<i class="blk"></i>' : shapeImg(KEYS[k].shape, KEYS[k].color, 18))).join('')}${r.keys.length > 40 ? ' …' : ''}</div>`;
  }
  refresh();

  $('#save').onclick = async () => {
    if (lrc.value !== s.lrc) lyricsFrom(lrc.value, s.lyricsSource || 'Typed in', s.lines);
    s.title ||= 'Untitled';
    await saveSong(s);
    location.hash = `#/play/${s.id}`;
  };
}

// ---------- play-along ----------
function player(s: Song) {
  app.replaceChildren(tpl('player'));
  $('#p-title').textContent = s.title;
  $('#p-artist').textContent = s.artist;
  $<HTMLAnchorElement>('#p-edit').href = `#/edit/${s.id}`;
  const audio = $<HTMLAudioElement>('#p-audio');
  audio.src = URL.createObjectURL(s.audio);
  audio.preservesPitch = true; // slow down without changing pitch
  const seek = $<HTMLInputElement>('#p-seek'), time = $('#p-time');
  const playBtn = $<HTMLButtonElement>('#p-play');
  const white = $<HTMLInputElement>('#p-white');
  white.checked = s.whiteOnly;
  let view = playView($<HTMLCanvasElement>('#p-canvas'), s.notes, mapSong(s).keys, $('#p-lyrics'), s.lines);
  white.onchange = async () => {
    s.whiteOnly = white.checked;
    view = playView($<HTMLCanvasElement>('#p-canvas'), s.notes, mapSong(s).keys, $('#p-lyrics'), s.lines);
    await saveSong(s);
  };
  $<HTMLSelectElement>('#p-speed').onchange = (e) => (audio.playbackRate = +(e.target as HTMLSelectElement).value);
  playBtn.onclick = () => (audio.paused ? audio.play() : audio.pause());
  audio.onplay = () => (playBtn.textContent = 'Pause');
  audio.onpause = () => (playBtn.textContent = 'Play');
  audio.onloadedmetadata = () => (seek.max = String(audio.duration));
  seek.oninput = () => (audio.currentTime = +seek.value);
  $('#p-back').onclick = () => (audio.currentTime = Math.max(0, audio.currentTime - 5));
  $('#p-start').onclick = () => (audio.currentTime = 0);
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
    if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
    if (e.code === 'ArrowRight') audio.currentTime += 5;
  };
  addEventListener('keydown', onKey);
  let raf = 0;
  const frame = () => {
    view.draw(audio.currentTime);
    seek.value = String(audio.currentTime);
    time.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(s.duration)}`;
    raf = requestAnimationFrame(frame);
  };
  frame();
  stopPlayback = () => { cancelAnimationFrame(raf); audio.pause(); removeEventListener('keydown', onKey); URL.revokeObjectURL(audio.src); };
}

route();
