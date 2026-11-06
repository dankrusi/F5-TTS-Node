#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { F5TTS } from './engine.js';
import { downloadModels, validateLanguage } from './models.js';
import type { Progress } from './types.js';
import { deviceOptions } from './device-options.js';

const help = `f5-tts-node: local English/German F5-TTS (native CPU or Windows GPU, no Python)

  f5-tts-node download --language en|de [--cache-dir PATH]
  f5-tts-node generate --language en|de --reference voice.wav
    --reference-text "Exact words in voice.wav" --text "Words to speak"
    --output result.wav [--speed 1] [--seed 42] [--threads 8]
    [--cpu | --gpu | --device auto|cpu|gpu] [--gpu-device N]

Text may instead come from --text-file and --reference-text-file (UTF-8).
Reference: 1–15 seconds of PCM WAV, preferably 5–10 seconds of clean speech.
--device auto (default) uses a Windows GPU via DirectML when available, else CPU.
--cpu forces CPU. --gpu requires DirectML and fails if GPU initialization fails.
Explicit device flags override F5_TTS_DEVICE. With no flag, the environment applies.
--gpu-device picks a DXGI adapter index (default: largest dedicated memory).
Outputs a WAV and an adjacent JSON file containing text, timing and model provenance.
Models download on first use (~1.45 GB per language) and are cached. Model weights
are CC-BY-NC-4.0; see NOTICE.md. Generation is local after download.
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, language: { type: 'string' }, 'cache-dir': { type: 'string' },
    reference: { type: 'string' }, 'reference-text': { type: 'string' }, 'reference-text-file': { type: 'string' },
    text: { type: 'string' }, 'text-file': { type: 'string' }, output: { type: 'string' }, speed: { type: 'string' },
    seed: { type: 'string' }, threads: { type: 'string' }, device: { type: 'string' }, 'gpu-device': { type: 'string' }, quiet: { type: 'boolean' },
    cpu: { type: 'boolean' }, gpu: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) { console.log(help); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !['download','generate'].includes(command)) throw new Error('Expected download or generate. Use --help.');
  const selectedDevice = deviceOptions(values);
  const language = values.language || ''; validateLanguage(language);
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Cancelled'));
  process.once('SIGINT', interrupt);
  let last = 0;
  const onProgress = (event: Progress) => {
    if (values.quiet) return;
    if (event.phase === 'download' && Date.now() - last < 1000 && event.completed !== event.total) return;
    last = Date.now(); console.error(`${event.language} ${event.phase}: ${event.file || ''} ${event.completed}/${event.total}`);
  };
  try {
    if (command === 'download') { console.log(JSON.stringify({ language, files: await downloadModels({ language, cacheDir: values['cache-dir'], onProgress, signal: controller.signal }) })); return; }
    const readText = async (inline: string | undefined, file: string | undefined) => {
      if (!!inline === !!file) throw new Error('Supply exactly one text value or corresponding text file');
      return file ? readFile(file, 'utf8') : inline!;
    };
    if (!values.reference || !values.output) throw new Error('--reference and --output are required');
    const text = await readText(values.text, values['text-file']);
    const referenceText = await readText(values['reference-text'], values['reference-text-file']);
    const tts = await F5TTS.create({ language, cacheDir: values['cache-dir'], threads: values.threads ? Number(values.threads) : undefined,
      ...selectedDevice, onProgress, signal: controller.signal });
    try {
      const result = await tts.generate({ text, referenceText, referenceAudio: values.reference,
        speed: values.speed ? Number(values.speed) : undefined, seed: values.seed ? Number(values.seed) : undefined, onProgress, signal: controller.signal });
      const output = resolve(values.output); await mkdir(dirname(output), { recursive: true });
      await writeFile(output, result.wav);
      const report = { output, language, text, synthetic: true, sampleRate: result.sampleRate, duration: result.duration,
        segments: result.segments, setupSeconds: tts.setupSeconds, ...result.timings, backend: tts.backend, gpu: tts.gpu?.name, gpuFallbackReason: tts.gpuFallbackReason, modelRevision: tts.modelRevision };
      await writeFile(output + '.json', JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report, null, 2));
    } finally { await tts.dispose(); }
  } finally { process.removeListener('SIGINT', interrupt); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
