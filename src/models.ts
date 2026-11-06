import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import manifest from './models.json' with { type: 'json' };
import type { Language, ProgressCallback } from './types.js';

export const MODEL_PRESETS = manifest;
export const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'f5-tts-node');
export function validateLanguage(language: string): asserts language is Language {
  if (language !== 'en' && language !== 'de') throw new Error('language must be en or de');
}
async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function downloadModels(options: { language: Language; cacheDir?: string; onProgress?: ProgressCallback; signal?: AbortSignal }): Promise<string[]> {
  const { language, cacheDir = DEFAULT_CACHE_DIR, onProgress, signal } = options;
  validateLanguage(language);
  const preset = MODEL_PRESETS[language];
  const directory = join(cacheDir, language);
  await mkdir(directory, { recursive: true });
  const paths: string[] = [];
  for (const file of preset.files) {
    signal?.throwIfAborted();
    const target = join(directory, basename(file.path));
    const expectedHash = 'sha256' in file ? file.sha256 : undefined;
    onProgress?.({ phase: 'verify', language, file: file.path, completed: 0, total: file.size });
    const cached = await stat(target).catch(() => null);
    if (cached?.size === file.size && (!expectedHash || await digest(target) === expectedHash)) { paths.push(target); continue; }
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const temporary = `${target}.${randomUUID()}.part`;
      try {
        signal?.throwIfAborted();
        const requestSignal = AbortSignal.any([AbortSignal.timeout(1_800_000), ...(signal ? [signal] : [])]);
        const response = await fetch(`https://huggingface.co/${preset.repo}/resolve/${preset.revision}/${file.path}`, { signal: requestSignal });
        if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status} (${file.path})`);
        let received = 0, last = 0;
        const hash = createHash('sha256');
        const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          try {
            received += chunk.length; hash.update(chunk);
            if (received > file.size) throw new Error(`Model exceeds expected size: ${file.path}`);
            if (Date.now() - last > 250 || received === file.size) {
              last = Date.now(); onProgress?.({ phase: 'download', language, file: file.path, completed: received, total: file.size });
            }
            callback(null, chunk);
          } catch (error) { callback(error as Error); }
        } });
        await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(temporary, { flags: 'wx' }), { signal: requestSignal });
        if (received !== file.size || (expectedHash && hash.digest('hex') !== expectedHash)) throw new Error(`Model integrity check failed: ${file.path}`);
        await rename(temporary, target); done = true;
      } catch (error) {
        await rm(temporary, { force: true });
        signal?.throwIfAborted();
        if (attempt === 2) throw error;
      }
    }
    paths.push(target);
  }
  return paths;
}
