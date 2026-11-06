export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, ', ').replace(/…/g, '...').replace(/\s+/g, ' ').trim();
}
/** Preserve spaces (vocabulary entry zero) and Unicode characters verbatim. */
export function vocabulary(text: string): Map<string, number> {
  return new Map(text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').map((token, index) => [token, index]));
}
export function tokenize(text: string, vocab: Map<string, number>): Int32Array {
  return Int32Array.from([...text], char => {
    const id = vocab.get(char);
    if (id === undefined) throw new Error(`Unsupported character ${JSON.stringify(char)}. Spell out symbols and numbers in the script language.`);
    return id;
  });
}
export function splitText(text: string, maxBytes: number): string[] {
  if (!Number.isFinite(maxBytes) || maxBytes < 16) throw new Error('Invalid text chunk size');
  const chunks: string[] = []; let current = '';
  for (const sentence of text.match(/[^.!?]+[.!?]*(?:\s+|$)|[.!?]+/g) || [text]) {
    for (const word of sentence.trim().split(/\s+/)) {
      if (Buffer.byteLength(word) > maxBytes) throw new Error('A word is too long for the model. Add spaces or punctuation.');
      if (current && Buffer.byteLength(current + ' ' + word) > maxBytes) { chunks.push(current); current = ''; }
      current += (current ? ' ' : '') + word;
    }
    // Prefer complete sentences instead of filling a chunk across sentence boundaries.
    if (current && /[.!?]$/.test(current)) { chunks.push(current); current = ''; }
  }
  if (current) chunks.push(current);
  return chunks;
}
