import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { F5TTS } from '../dist/index.js';
import { deviceOptions } from '../dist/device-options.js';

// Fictional demonstration copy. These events are invented, not published reporting.
const copy={
 en:'This is a fictional news bulletin. The city of Lindenhaven has opened a new solar powered library. Residents can borrow books and attend free evening classes. The project will also test a battery system that keeps the building running after sunset.',
 de:'Dies ist eine erfundene Nachrichtensendung. Die Stadt Lindenhafen hat eine neue Bibliothek mit Solaranlage eröffnet. Bewohner können Bücher ausleihen und kostenlose Abendkurse besuchen. Ein Batteriespeicher soll das Gebäude auch nach Sonnenuntergang mit Strom versorgen.',
};
const help=`Usage: pnpm run demo [en|de|both] [--cpu | --gpu | --device auto|cpu|gpu] [--gpu-device N]
  --cpu             Force CPU inference.
  --gpu             Require Windows DirectML; fail if GPU initialization fails.
  --device auto     Try GPU, with CPU fallback if initialization fails.
  --gpu-device N    Select a DXGI GPU adapter index.
Explicit flags override F5_TTS_DEVICE. With no flag, the environment applies (default: auto).`;
const {values,positionals}=parseArgs({allowPositionals:true,options:{
 help:{type:'boolean',short:'h'},cpu:{type:'boolean'},gpu:{type:'boolean'},device:{type:'string'},'gpu-device':{type:'string'},
}});
if(values.help){console.log(help);process.exit(0)}
const requested=positionals[0]||'both';
if(positionals.length>1||!['en','de','both'].includes(requested))throw Error(help);
const selectedDevice=deviceOptions(values);
const output=resolve('output');await mkdir(output,{recursive:true});
for(const language of requested==='both'?['en','de']:[requested]){
 const reference=JSON.parse(await readFile(new URL(`./references/${language}.json`,import.meta.url),'utf8'));
 const progress=p=>{if(p.phase!=='download'||p.completed===p.total)console.log(language,p.phase,p.file||'',`${p.completed}/${p.total}`)};
 const tts=await F5TTS.create({language,cacheDir:process.env.F5_TTS_CACHE_DIR||resolve('.cache'),...selectedDevice,onProgress:progress});
 console.log(`Selected backend: ${tts.backend}${tts.gpu ? ` (${tts.gpu.name})` : ''}${tts.gpuFallbackReason ? `; ${tts.gpuFallbackReason}` : ''}`);
 try{
  const result=await tts.generate({text:copy[language],referenceText:reference.transcript,referenceAudio:fileURLToPath(new URL(`./references/${language}.wav`,import.meta.url)),seed:42,onProgress:progress});
  const report={language,text:copy[language],fictional:true,sampleRate:result.sampleRate,duration:result.duration,segments:result.segments,setupSeconds:tts.setupSeconds,...result.timings,backend:tts.backend,gpu:tts.gpu?.name,gpuFallbackReason:tts.gpuFallbackReason,modelRevision:tts.modelRevision,reference:reference.speaker};
  await writeFile(resolve(output,`news-${language}.wav`),result.wav);await writeFile(resolve(output,`news-${language}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 }finally{await tts.dispose()}
}
