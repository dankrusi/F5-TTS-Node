import * as ort from 'onnxruntime-node';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { downloadModels, MODEL_PRESETS, validateLanguage } from './models.js';
import { encodeWav, referenceSamples } from './audio.js';
import { normalizeText, splitText, tokenize, vocabulary } from './text.js';
import type { GenerateOptions, GenerationResult, Language, ProgressCallback, SegmentTiming } from './types.js';

export interface ModelOptions {
  language: Language;
  cacheDir?: string;
  /** Native CPU inference threads. Default: up to 8. */
  threads?: number;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}
function seededNoise(length: number, seed: number): Float32Array {
  let state = seed >>> 0;
  const random = () => {
    state += 0x6D2B79F5; let x = state;
    x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
  const result = new Float32Array(length);
  for (let i = 0; i < length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))), angle = 2 * Math.PI * random();
    result[i] = radius * Math.cos(angle); if (i + 1 < length) result[i + 1] = radius * Math.sin(angle);
  }
  return result;
}
const release = (tensors: Iterable<ort.Tensor>) => { for (const tensor of new Set(tensors)) tensor.dispose(); };

/** Native CPU F5-TTS. Instances serialize generation and reuse their loaded models. */
export class F5TTS {
  readonly sampleRate = 24000;
  readonly backend = 'cpu';
  readonly language: Language;
  readonly modelRevision: string;
  readonly setupSeconds: number;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private disposal?: Promise<void>;
  private constructor(language: Language, private sessions: ort.InferenceSession[], private vocab: Map<string, number>, setupSeconds: number) {
    this.language = language; this.modelRevision = MODEL_PRESETS[language].revision; this.setupSeconds = setupSeconds;
  }
  static async create(options: ModelOptions): Promise<F5TTS> {
    validateLanguage(options.language);
    const threads = options.threads ?? Math.min(8, availableParallelism());
    if (!Number.isInteger(threads) || threads < 1 || threads > 64) throw new Error('threads must be an integer from 1 to 64');
    const started = performance.now();
    const files = await downloadModels(options);
    const sessions: ort.InferenceSession[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        options.signal?.throwIfAborted();
        options.onProgress?.({ phase: 'load', language: options.language, file: files[i], completed: i, total: 3 });
        sessions.push(await ort.InferenceSession.create(files[i], {
          executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1,
          executionMode: 'sequential', graphOptimizationLevel: 'all', logSeverityLevel: 3,
        }));
      }
      if (sessions[0].inputNames.length !== 3 || sessions[0].outputNames.length !== 8 || sessions[1].inputNames.length !== 8 || sessions[1].outputNames.length !== 2 || sessions[2].inputNames.length !== 2) throw new Error('Unsupported F5 ONNX graph contract');
      options.signal?.throwIfAborted();
      const instance = new F5TTS(options.language, sessions, vocabulary(await readFile(files[3], 'utf8')), (performance.now() - started) / 1000);
      options.onProgress?.({ phase: 'ready', language: options.language, completed: 1, total: 1 });
      return instance;
    } catch (error) { await Promise.all(sessions.map(session => session.release())); throw error; }
  }
  generate(options: GenerateOptions): Promise<GenerationResult> {
    if (this.closed) return Promise.reject(new Error('F5TTS instance has been disposed'));
    const job = this.tail.then(() => this.generateInternal(options));
    this.tail = job.catch(() => {});
    return job;
  }
  private async generateInternal(options: GenerateOptions): Promise<GenerationResult> {
    options.signal?.throwIfAborted();
    const started = performance.now();
    const speed = options.speed ?? 1, pauseSeconds = options.pauseSeconds ?? .15, seed = options.seed ?? 42;
    if (!Number.isFinite(speed) || speed < .5 || speed > 2) throw new Error('speed must be between 0.5 and 2');
    if (!Number.isFinite(pauseSeconds) || pauseSeconds < 0 || pauseSeconds > 2) throw new Error('pauseSeconds must be between 0 and 2');
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be an unsigned 32-bit integer');
    if (typeof options.text !== 'string' || typeof options.referenceText !== 'string') throw new Error('text and referenceText must be strings');
    const text = normalizeText(options.text), refText = normalizeText(options.referenceText);
    if (!text || text.length > 50000 || !refText || refText.length > 2000) throw new Error('Provide non-empty text (max 50,000 characters) and an exact reference transcript (max 2,000 characters)');
    tokenize(text, this.vocab); tokenize(refText, this.vocab);
    const reference = await referenceSamples(options.referenceAudio);
    const refFrames = Math.floor(reference.length / 256), refBytes = Buffer.byteLength(refText + ' ');
    // Short chunks bound transformer attention memory and preserve natural cadence.
    const maxBytes = Math.max(32, Math.floor(12 * 24000 / 256 * refBytes * speed / refFrames));
    const chunks = splitText(text, maxBytes), outputs: Float32Array[] = [], segments: SegmentTiming[] = [];
    let offset = 0;
    for (let index = 0; index < chunks.length; index++) {
      options.signal?.throwIfAborted();
      const chunk = chunks[index];
      const frames = refFrames + Math.max(1, Math.floor(refFrames / refBytes * Buffer.byteLength(chunk) / speed));
      if (frames >= 4096) throw new Error('Requested audio exceeds the model context window');
      const samples = await this.infer(reference, `${refText} ${chunk}`, frames, (seed + index) >>> 0, step => {
        options.onProgress?.({ phase: 'generate', language: this.language, completed: index * 31 + step, total: chunks.length * 31, segment: index + 1, segments: chunks.length });
      }, options.signal);
      segments.push({ text: chunk, start: offset / 24000, end: (offset + samples.length) / 24000 });
      outputs.push(samples); offset += samples.length;
      if (index < chunks.length - 1 && pauseSeconds) { const silence = new Float32Array(Math.round(pauseSeconds * 24000)); outputs.push(silence); offset += silence.length; }
    }
    const samples = new Float32Array(offset); offset = 0;
    for (const part of outputs) { samples.set(part, offset); offset += part.length; }
    const duration = samples.length / 24000, wav = encodeWav(samples);
    const generationSeconds = (performance.now() - started) / 1000;
    options.onProgress?.({ phase: 'ready', language: this.language, completed: 1, total: 1 });
    return { samples, wav, duration, sampleRate: 24000, language: this.language, segments, timings: { generationSeconds, realTimeFactor: generationSeconds / duration } };
  }
  private async infer(reference: Float32Array, text: string, frames: number, seed: number, progress: (step: number) => void, signal?: AbortSignal): Promise<Float32Array> {
    const [encoder, transformer, decoder] = this.sessions;
    const pcm = Int16Array.from(reference, x => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
    const tokens = tokenize(text, this.vocab);
    const audio = new ort.Tensor('int16', pcm, [1,1,pcm.length]);
    const ids = new ort.Tensor('int32', tokens, [1,tokens.length]);
    const duration = new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]);
    const owned = new Set<ort.Tensor>([audio, ids, duration]);
    try {
      signal?.throwIfAborted();
      const encoded = await encoder.run(Object.fromEntries(encoder.inputNames.map((name, i) => [name, [audio, ids, duration][i]])));
      Object.values(encoded).forEach(t => owned.add(t));
      const conditioning = encoder.outputNames.map(name => encoded[name]);
      let noise: ort.Tensor = new ort.Tensor('float32', seededNoise(conditioning[0].size, seed), conditioning[0].dims);
      let time: ort.Tensor = new ort.Tensor('int32', Int32Array.from([0]), [1]);
      owned.add(noise); owned.add(time);
      progress(0);
      // These pinned exports bake 32 time points into the graph: exactly 31 Euler intervals.
      // Stopping early is NOT a lower-quality sampler; it would leave incomplete denoising.
      for (let step = 0; step < 31; step++) {
        signal?.throwIfAborted();
        const inputs = [noise, ...conditioning.slice(1,7), time];
        const result = await transformer.run(Object.fromEntries(transformer.inputNames.map((name, i) => [name, inputs[i]])));
        Object.values(result).forEach(t => owned.add(t));
        const previous = [noise, time];
        noise = result[transformer.outputNames[0]]; time = result[transformer.outputNames[1]];
        for (const tensor of previous) { owned.delete(tensor); tensor.dispose(); }
        progress(step + 1);
      }
      signal?.throwIfAborted();
      const decoded = await decoder.run({ [decoder.inputNames[0]]: noise, [decoder.inputNames[1]]: conditioning[7] });
      Object.values(decoded).forEach(t => owned.add(t));
      signal?.throwIfAborted();
      const output = decoded[decoder.outputNames[0]];
      if (output.type !== 'int16' && output.type !== 'float32') throw new Error(`Unsupported vocoder output: ${output.type}`);
      const samples = Float32Array.from(output.data as Int16Array | Float32Array, x => output.type === 'int16' ? x / 32768 : x);
      if (!samples.length || samples.some(x => !Number.isFinite(x))) throw new Error('The model returned invalid audio');
      return samples;
    } finally { release(owned); }
  }
  /** Wait for queued work and free native sessions. Abort requests first to stop sooner. */
  dispose(): Promise<void> {
    this.closed = true;
    return this.disposal ??= this.tail.then(async () => { await Promise.all(this.sessions.map(session => session.release())); });
  }
}
