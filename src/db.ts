// Song library in IndexedDB. Everything stays in this browser.
import type { Note } from './melody';
import type { Line, Word } from './lyrics';

export interface Song {
  id: string;
  title: string;
  artist: string;
  audio: Blob;
  duration: number;
  notes: Note[];
  tuning: number;
  method: 'basic-pitch' | 'yin';
  lrc: string;
  lines: Line[];
  lyricsSource: string;
  whisper?: Word[]; // word times from the last transcription: where the voice is, even when the text is wrong
  whiteOnly: boolean;
  bestFit: boolean;
  createdAt: number;
}

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('toy-piano', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const req = fn(db.transaction('songs', mode).objectStore('songs'));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const saveSong = (s: Song) => tx('readwrite', (st) => st.put(s));
export const getSong = (id: string) => tx<Song | undefined>('readonly', (st) => st.get(id));
export const allSongs = async () => (await tx<Song[]>('readonly', (st) => st.getAll())).sort((a, b) => b.createdAt - a.createdAt);
export const deleteSong = (id: string) => tx('readwrite', (st) => st.delete(id));
