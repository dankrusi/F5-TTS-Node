export type Language = 'en' | 'de';
export interface Progress {
  phase: 'download' | 'verify' | 'load' | 'generate' | 'ready';
  language: Language;
  file?: string;
  completed: number;
  total: number;
  segment?: number;
  segments?: number;
}
export type ProgressCallback = (event: Progress) => void;
export interface AudioData { samples: Float32Array; sampleRate: number }
export interface SegmentTiming { text: string; start: number; end: number }
export interface GenerateOptions {
  text: string;
  referenceAudio: string | Uint8Array | AudioData;
  /** Exact transcript of the complete reference recording. */
  referenceText: string;
  speed?: number;
  seed?: number;
  /** Silence inserted between generated chunks, default 0.15 seconds. */
  pauseSeconds?: number;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}
export interface GenerationResult extends AudioData {
  wav: Buffer;
  duration: number;
  language: Language;
  /** Chunk-level alignment; not word timestamps. */
  segments: SegmentTiming[];
  timings: { generationSeconds: number; realTimeFactor: number };
}
