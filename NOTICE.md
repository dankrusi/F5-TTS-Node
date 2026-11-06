# Model and reference attribution

The Node/TypeScript wrapper is MIT licensed. Model weights and reference
recordings are separate works with their own terms; the wrapper license does
not relicense them. No model weights are bundled in the npm tarball.

## Models

- **F5-TTS**, Yushen Chen, Zhikang Niu, Ziyang Ma, Keqi Deng, Chunhui Wang,
  Jian Zhao, Kai Yu, and Xie Chen. [Official project](https://github.com/SWivid/F5-TTS),
  [paper](https://arxiv.org/abs/2410.06885),
  [model](https://huggingface.co/SWivid/F5-TTS).
  Original code: MIT. Official pretrained weights: **CC-BY-NC-4.0**.
- English ONNX export: [nsarang/F5-TTS-ONNX](https://huggingface.co/nsarang/F5-TTS-ONNX),
  revision `2e7e47e103a565c85dcd32141b6b11eeeb57eee6`.
  The export's card says Apache-2.0; this package conservatively retains the
  original pretrained model's **non-commercial** restriction.
- German checkpoint: [hvoss-techfak/F5-TTS-German](https://huggingface.co/hvoss-techfak/F5-TTS-German),
  Bielefeld University SCS. **CC-BY-NC-4.0**.
  ONNX conversion: [nibor1896/F5-TTS-German-ONNX](https://huggingface.co/nibor1896/F5-TTS-German-ONNX),
  revision `6d46e3a9dbdbddf022212619190fb7bb6c9a2240`.
  This export preserves the German v0 architecture's attention and padding behavior.
- ONNX pipeline reference: [DakeQQ/F5-TTS-ONNX](https://github.com/DakeQQ/F5-TTS-ONNX),
  Apache-2.0. The Node implementation follows its public graph contract:
  preprocessing, iterative denoising, and waveform decoding. It is independently
  implemented in TypeScript, including tokenization, PCM processing and sampling.

License text: https://creativecommons.org/licenses/by-nc/4.0/legalcode.en

## Bundled reference clips

- **English:** Linda Johnson, LJ Speech `lj-001-0004.wav`.
  Dataset by Keith Ito and Linda Johnson, 2017.
  [Original dataset](https://keithito.com/LJ-Speech-Dataset/) describes the
  recordings as public domain. Downloaded through
  [MikhailT/lj-speech](https://huggingface.co/datasets/MikhailT/lj-speech),
  whose mirror is marked CC-BY-4.0:
  https://creativecommons.org/licenses/by/4.0/legalcode.en
- **German:** Thorsten Müller (Thorsten-Voice), TV-2022.10-Neutral,
  recording `dd01c488-10f3-a683-00cf-4d215f4d9b19---3df17877aafbf59917014184f03b607a`
  (also recorded in `examples/references/de.json`).
  [Thorsten-Voice](https://github.com/thorstenMueller/Thorsten-Voice),
  [original dataset](https://huggingface.co/datasets/Thorsten-Voice/TV-44kHz-Full).
  **CC0-1.0:** https://creativecommons.org/publicdomain/zero/1.0/legalcode.en

Both clips were resampled to 24 kHz mono PCM16. Their exact transcripts,
dataset revisions (in source paths), row identifiers and SHA-256 hashes are
included in the adjacent JSON files. These are narrator recordings, not
news-anchor endorsements. The news demo is explicitly fictional and synthesized.
The voice owners did not author or endorse the generated news copy.
