// node src/lib/pdf.test.mjs — the PDF's structure: one page per image and a cross-reference table that points at
// every object.
import assert from 'node:assert/strict';
const { jpegPdf } = await import('./pdf.ts');

const fake = (s) => ({ jpeg: new TextEncoder().encode(s), width: 2, height: 3 });
const pdf = jpegPdf([fake('JPEG-ONE'), fake('JPEG-TWO')]);
const text = new TextDecoder('latin1').decode(pdf);

assert.ok(text.startsWith('%PDF-1.4\n') && text.endsWith('%%EOF\n'));
assert.equal(text.match(/\/Type \/Page /g).length, 2);
assert.match(text, /\/Count 2 /);
assert.match(text, /\/Width 2 \/Height 3 .*\/Length 8 >>\nstream\nJPEG-ONE\nendstream/);

const xref = Number(text.match(/startxref\n(\d+)\n/)[1]);
assert.ok(text.startsWith('xref\n0 9\n', xref));
const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
assert.equal(offsets.length, 8);
offsets.forEach((o, i) => assert.ok(text.startsWith(`${i + 1} 0 obj\n`, o), `object ${i + 1}`));

console.log('pdf ok');
