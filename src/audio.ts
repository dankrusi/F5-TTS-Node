import { readFile } from 'node:fs/promises';
import type { AudioData } from './types.js';

/** Decode PCM (16/24/32-bit) or float32 WAV and downmix channels. */
export function decodeWav(bytes: Uint8Array): AudioData {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected a RIFF/WAVE audio file');
  let format = 0, channels = 0, rate = 0, bits = 0, block = 0;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= b.length;) {
    const tag = b.toString('ascii', offset, offset + 4), length = b.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > b.length) throw new Error('Truncated WAV chunk');
    if (tag === 'fmt ') {
      if (length < 16) throw new Error('Invalid WAV format');
      format = b.readUInt16LE(start); channels = b.readUInt16LE(start + 2); rate = b.readUInt32LE(start + 4);
      block = b.readUInt16LE(start + 12); bits = b.readUInt16LE(start + 14);
      if (format === 65534 && length >= 40) format = b.readUInt16LE(start + 24);
    } else if (tag === 'data') data = b.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  if (!data || channels < 1 || channels > 32 || rate < 8000 || rate > 192000 || ![16,24,32].includes(bits) || ![1,3].includes(format) || (format === 3 && bits !== 32) || block !== channels * bits / 8 || data.length % block) throw new Error('Unsupported or malformed WAV; use PCM16/24/32 or float32');
  const samples = new Float32Array(data.length / block);
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const offset = i * block + channel * bits / 8;
      sum += format === 3 ? data.readFloatLE(offset) : bits === 16 ? data.readInt16LE(offset) / 32768 : bits === 24 ? data.readIntLE(offset, 3) / 8388608 : data.readInt32LE(offset) / 2147483648;
    }
    samples[i] = sum / channels;
    if (!Number.isFinite(samples[i])) throw new Error('Reference audio contains non-finite samples');
  }
  return { samples, sampleRate: rate };
}
export function encodeWav(samples: Float32Array, sampleRate = 24000): Buffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid sample rate');
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('Cannot encode non-finite audio');
    const x = Math.max(-1, Math.min(1, samples[i])); b.writeInt16LE(Math.round(x * (x < 0 ? 32768 : 32767)), 44 + i * 2);
  }
  return b;
}
/** Windowed-sinc resampling, including low-pass filtering when downsampling. */
export function resample(audio: AudioData, sampleRate = 24000): Float32Array {
  const input = audio.samples;
  if (audio.sampleRate === sampleRate) return input.slice();
  const ratio = audio.sampleRate / sampleRate, cutoff = Math.min(1, 1 / ratio) * .95;
  const output = new Float32Array(Math.round(input.length / ratio)), radius = Math.ceil(20 / cutoff);
  for (let i = 0; i < output.length; i++) {
    const center = i * ratio; let value = 0, weight = 0;
    for (let j = Math.max(0, Math.ceil(center - radius)); j <= Math.min(input.length - 1, Math.floor(center + radius)); j++) {
      const distance = j - center, x = Math.PI * cutoff * distance;
      const w = (Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x) * (.5 + .5 * Math.cos(Math.PI * distance / radius));
      value += input[j] * w; weight += w;
    }
    output[i] = weight ? value / weight : 0;
  }
  return output;
}
export async function referenceSamples(input: string | Uint8Array | AudioData): Promise<Float32Array> {
  const audio = typeof input === 'string' ? decodeWav(await readFile(input)) : input instanceof Uint8Array ? decodeWav(input) : input;
  if (!(audio.samples instanceof Float32Array) || !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000) throw new Error('Invalid reference audio');
  const seconds = audio.samples.length / audio.sampleRate;
  if (seconds < 1 || seconds > 15) throw new Error('Reference audio must be 1–15 seconds; 5–10 seconds is recommended. Supply the exact transcript.');
  const samples = resample(audio);
  let sum = 0;
  for (const x of samples) { if (!Number.isFinite(x)) throw new Error('Reference audio contains non-finite samples'); sum += x * x; }
  const rms = Math.sqrt(sum / samples.length);
  if (rms < .0001) throw new Error('Reference audio is silent');
  // Match the official F5 conditioning level without amplifying loud references.
  if (rms < .1) for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i] * .1 / rms));
  return samples;
}
