import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodeWav, encodeWav, resample } from '../dist/index.js';

const sources = [
  { language:'en', dataset:'MikhailT/lj-speech', config:'default', split:'full', row:3, speaker:'Linda Johnson', license:'CC-BY-4.0 (mirror); original LJ Speech recordings are public domain', original:'https://keithito.com/LJ-Speech-Dataset/' },
  { language:'de', dataset:'Thorsten-Voice/TV-44kHz-Full', config:'TV-2022.10-Neutral', split:'train', row:5, speaker:'Thorsten Müller', license:'CC0-1.0', original:'https://github.com/thorstenMueller/Thorsten-Voice' },
];
const directory = new URL('./references/', import.meta.url);
await mkdir(directory,{recursive:true});
for (const source of sources) {
  const endpoint=`https://datasets-server.huggingface.co/rows?dataset=${source.dataset}&config=${source.config}&split=${source.split}&offset=${source.row}&length=1`;
  const response=await fetch(endpoint);if(!response.ok)throw Error(`Reference metadata HTTP ${response.status}`);
  const data=await response.json(), row=data.rows[0].row;
  const url=row.audio[0].src;
  const download=await fetch(url);if(!download.ok)throw Error(`Reference audio HTTP ${download.status}`);
  const wav=encodeWav(resample(decodeWav(new Uint8Array(await download.arrayBuffer()))));
  await writeFile(new URL(`${source.language}.wav`,directory),wav);
  const metadata={...source, transcript:row.normalized_text||row.text, datasetRowId:row.file||row.id, sourceUrl:endpoint,
    audioSourcePath:new URL(url).pathname, sha256:createHash('sha256').update(wav).digest('hex'), sampleRate:24000,
    note:'Resampled to 24 kHz mono PCM16 for F5-TTS. Narrator reference, not a news-anchor endorsement.'};
  await writeFile(new URL(`${source.language}.json`,directory),JSON.stringify(metadata,null,2)+'\n');
  console.log(source.language,fileURLToPath(new URL(`${source.language}.wav`,directory)),metadata.transcript);
}
