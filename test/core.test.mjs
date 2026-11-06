import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { decodeWav, encodeWav, resample, downloadModels } from '../dist/index.js';
import { referenceSamples } from '../dist/audio.js';
import { normalizeText, vocabulary, tokenize, splitText } from '../dist/text.js';

test('WAV roundtrip preserves timing, waveform, and clipping bounds', () => {
  const samples=Float32Array.from({length:24000},(_,i)=>.2*Math.sin(2*Math.PI*440*i/24000));
  samples[0]=-1;samples[1]=1;
  const audio=decodeWav(encodeWav(samples));
  assert.equal(audio.sampleRate,24000);assert.equal(audio.samples.length,24000);
  assert(audio.samples.every((x,i)=>Math.abs(x-samples[i])<.00007));
  assert.throws(()=>decodeWav(encodeWav(samples).subarray(0,100)),/Truncated/);
  assert.throws(()=>encodeWav(Float32Array.from([NaN])),/non-finite/);
});
test('resampling retains duration and suppresses frequencies above target Nyquist', () => {
  const tone=frequency=>Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*frequency*i/48000));
  const rms=samples=>Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length);
  const low=resample({samples:tone(1000),sampleRate:48000});
  const high=resample({samples:tone(18000),sampleRate:48000});
  assert.equal(low.length,24000);assert(rms(low)>.65);assert(rms(high)<.02);
});
test('reference preprocessing rejects silence and excessive duration without trimming transcript', async () => {
  await assert.rejects(referenceSamples({samples:new Float32Array(24000*5),sampleRate:24000}),/silent/);
  await assert.rejects(referenceSamples({samples:new Float32Array(24000*16),sampleRate:24000}),/1–15/);
});
test('German vocabulary strips BOM but preserves space at index zero and umlauts', () => {
  const vocab=vocabulary('\uFEFF \r\nä\r\nß\r\nx\r\n');
  assert.deepEqual([...tokenize(' äßx',vocab)],[0,1,2,3]);
  assert.throws(()=>tokenize('🙂',vocab),/Unsupported character/);
  assert.equal(normalizeText('„Guten\nMorgen!“'), '"Guten Morgen!"');
});
test('chunking preserves all normalized words and respects UTF-8 model duration budget', () => {
  const text=normalizeText('Grüne Bäume säumen die Straße. Die Bibliothek öffnet morgen. '+ 'Weitere Nachrichten folgen. '.repeat(10));
  const chunks=splitText(text,45);
  assert.equal(chunks.join(' '),text);assert(chunks.every(x=>Buffer.byteLength(x)<=45));
  assert.throws(()=>splitText('x'.repeat(100),40),/too long/);
});
test('model download honors cancellation before making network requests', async () => {
  const directory=await mkdtemp(join(tmpdir(),'f5-node-test-'));
  const controller=new AbortController();controller.abort();
  try { await assert.rejects(downloadModels({language:'de',cacheDir:directory,signal:controller.signal}),{name:'AbortError'}); }
  finally {
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert(basename(directory).startsWith('f5-node-test-'));
    await rm(directory,{recursive:true,force:true});
  }
});
