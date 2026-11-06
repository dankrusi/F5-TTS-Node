# f5-tts-node

Local English and German F5-TTS voice generation in **Node.js**, using native
ONNX Runtime on **CPU**. No Python, PyTorch, browser, paid API, or external
service is needed for synthesis. Internet access is required for the first
model download. The package is prepared for local installation; it is not
published to npm.

## Quick start

Requires Node.js 22+ on a platform supported by `onnxruntime-node`. Tested on
Windows x64 with Node 24. Use pnpm 12.15.0, pinned in `package.json`.
The repository allows ONNX Runtime's native installation script through
`pnpm-workspace.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run demo de
pnpm run demo en
```

Listen to `output/news-de.wav` and `output/news-en.wav`. The corresponding JSON
files include fictional copy, generation time, duration and chunk timings.
The examples include downloaded, attributed narrator references, so no
reference upload or transcription service is necessary.

The demo caches models in `.cache/` in the current directory; the library and
CLI default to `~/.cache/f5-tts-node`. Set `cacheDir` explicitly or use
`F5_TTS_CACHE_DIR` for the demo. Both languages require approximately **2.9 GB
of disk space** in total. The package tarball excludes these models.

## JavaScript / TypeScript API

```js
import { F5TTS } from 'f5-tts-node';
import { writeFile } from 'node:fs/promises';

const tts = await F5TTS.create({
  language: 'de', // 'en' selects the separate English model
  cacheDir: './tts-models',
  threads: 6,
  onProgress: event => console.log(event.phase, event.completed, event.total),
});

try {
  const audio = await tts.generate({
    referenceAudio: './voice.wav',
    referenceText: 'Die genauen Worte aus der Referenzaufnahme.',
    text: 'Dies ist eine erfundene Nachrichtensendung.',
    speed: 1,
    seed: 42,
    onProgress: event => console.log(event),
  });
  await writeFile('news.wav', audio.wav);
  console.log(audio.duration, audio.segments, audio.timings);
} finally {
  await tts.dispose();
}
```

Use a reference and transcript in the selected model's language for reliable
results. A reference can be a WAV path, WAV bytes (`Uint8Array`), or
`{ samples: Float32Array, sampleRate }`. The exact transcript must describe
the entire clip. Prefer 5–10 seconds of clean, natural speech without music;
the accepted range is 1–15 seconds. PCM16/24/32 and float32 WAV are supported,
downmixed and resampled in JavaScript. MP3 input is not supported.

`generate()` returns:

- `wav`: a Node Buffer containing mono PCM16 WAV at 24 kHz.
- `samples`, `sampleRate`, `duration`, `language`.
- `segments`: `{ text, start, end }` in seconds for each generated text chunk.
- `timings`: synthesis wall time and real-time factor (generation / audio).

The timings cover whole chunks, **not individual words**. They can support
broadcast highlights by generating one highlighted sentence per chunk.
Each instance serializes requests and keeps its native model sessions loaded.
Create one instance per language and reuse it. `dispose()` waits for queued
work before releasing native memory. Use `signal: AbortSignal` on setup or
generation for cancellation; native inference can stop between denoising steps,
not in the middle of a step. Progress callbacks run on the Node main thread.
Do not mutate request objects while queued.

## CLI

```sh
node dist/cli.js download --language de --cache-dir .cache
node dist/cli.js generate --language en --reference examples/references/en.wav --reference-text-file ref.txt --text-file news.txt --output output/custom.wav --cache-dir .cache
```

After installation, the command is `f5-tts-node`. Run `--help` for options.
Reference transcripts are in `examples/references/en.json` and `de.json`.
Progress goes to stderr; the result report goes to stdout. An adjacent
`<output>.json` stores text and timings. Ctrl+C cancels pending work.

## Install into another project later

```sh
pnpm pack
# In the consuming project:
pnpm add /path/to/f5-tts-node/f5-tts-node-0.1.0.tgz
```

ES modules and TypeScript declarations are included. No model download occurs
at package installation or import. `F5TTS.create()` downloads missing models,
validates their pinned sizes and hashes, then initializes native CPU sessions.
`downloadModels()` can prefetch the assets independently.

## Implementation and limitations

- Separate pinned FP32 ONNX model sets for English and German, each ~1.45 GB.
- Native CPU only in this initial version. GPU support is not claimed.
- All 31 Euler intervals from the exports' fixed 32-point schedule are run.
  Arbitrarily shortening that loop would produce unfinished denoising, so there
  is deliberately no misleading "steps" setting.
- Long text is split at sentence/word boundaries using the reference speech
  rate; generated chunks target at most 12 seconds. Default inter-chunk pause
  is 0.15 seconds; `pauseSeconds` can change it.
- `speed` is 0.5–2.0. Spell numbers/abbreviations as spoken words for dependable
  pronunciation. Unsupported vocabulary characters cause a useful error.
- `seed` controls the initial noise reproducibly. Floating-point results may
  vary across hardware and ONNX versions.
- First initialization is expensive; CPU synthesis can be substantially slower
  than real time. See the actual reports in `output/` instead of assuming GPU
  benchmark numbers apply to this machine. Allow several GB of RAM per instance.

## Verification and provenance

Verified on **6 November 2026**, Windows x64, Node 24.22.1, native ONNX Runtime
1.31.1, Intel Core i5-9500T (6 CPU threads), 16 GB RAM. Both examples use four
sentence chunks, speed 1, seed 42, and all 31 denoising intervals per chunk.
Models were already downloaded; setup below includes cache verification and loading.

| Language | Output audio | Setup | Synthesis | Generation / audio |
| --- | ---: | ---: | ---: | ---: |
| English | 14.306 s | 6.70 s | 502.53 s (8.38 min) | 35.13x |
| German | 15.255 s | 9.56 s | 511.83 s (8.53 min) | 33.55x |

Independent Whisper-base q8 transcription recovered the supplied copy, with
differences limited to spelling/spacing of the fictional place names:
English `Lindenhaven` became `Lyndon Haven`; German `Stadt Lindenhafen` became
`Stadtlindenhafen`. Raw word error rates were 4.88% and 5.88%, respectively.
This checks intelligibility, not subjective voice similarity or naturalness.
Listen to the WAVs to assess voice quality. These CPU timings are too slow for
real-time playback generation on this machine; queued pre-rendering is possible.
No GPU speed claim is made.

The package was packed, installed into an isolated consumer directory, and its
public import and CLI were verified. The English sample was generated using
that installed package. Raw reports are in `output/news-*.json` and
`output/verification-*.json` in this working directory (not bundled in the tarball).

`pnpm test` checks audio decoding/encoding, anti-aliasing resampling, silent
reference rejection, German vocabulary handling, chunk preservation and
cancellation. `pnpm run demo both` performs real neural inference and writes
the two fictional news recordings. `examples/download-references.mjs` can
refresh the bundled reference clips from their original dataset rows.

See [NOTICE.md](NOTICE.md) for model/reference sources and licenses. Wrapper
code is MIT; the pretrained model lineage is **CC-BY-NC-4.0 (non-commercial)**.
The generated demo news is invented, not actual reporting.
