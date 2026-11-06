import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { F5TTS } from '../dist/index.js';

// Fictional demonstration copy. These events are invented, not published reporting.
const copy={
 en:'This is a fictional news bulletin. The city of Lindenhaven has opened a new solar powered library. Residents can borrow books and attend free evening classes. The project will also test a battery system that keeps the building running after sunset.',
 de:'Dies ist eine erfundene Nachrichtensendung. Die Stadt Lindenhafen hat eine neue Bibliothek mit Solaranlage eröffnet. Bewohner können Bücher ausleihen und kostenlose Abendkurse besuchen. Ein Batteriespeicher soll das Gebäude auch nach Sonnenuntergang mit Strom versorgen.',
};
const requested=process.argv[2]||'both';
if(!['en','de','both'].includes(requested))throw Error('Usage: pnpm run demo en|de|both');
const output=resolve('output');await mkdir(output,{recursive:true});
for(const language of requested==='both'?['en','de']:[requested]){
 const reference=JSON.parse(await readFile(new URL(`./references/${language}.json`,import.meta.url),'utf8'));
 const progress=p=>{if(p.phase!=='download'||p.completed===p.total)console.log(language,p.phase,p.file||'',`${p.completed}/${p.total}`)};
 const tts=await F5TTS.create({language,cacheDir:process.env.F5_TTS_CACHE_DIR||resolve('.cache'),onProgress:progress});
 try{
  const result=await tts.generate({text:copy[language],referenceText:reference.transcript,referenceAudio:fileURLToPath(new URL(`./references/${language}.wav`,import.meta.url)),seed:42,onProgress:progress});
  const report={language,text:copy[language],fictional:true,sampleRate:result.sampleRate,duration:result.duration,segments:result.segments,setupSeconds:tts.setupSeconds,...result.timings,backend:tts.backend,modelRevision:tts.modelRevision,reference:reference.speaker};
  await writeFile(resolve(output,`news-${language}.wav`),result.wav);await writeFile(resolve(output,`news-${language}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 }finally{await tts.dispose()}
}
