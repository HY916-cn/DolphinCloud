// A PDF with one JPEG per A4 page, as wide as the page and from its top edge. Pages drawn on a canvas carry their
// Chinese text as pixels, so no font has to be embedded. Each JPEG stays a Blob, kept by the browser outside the
// JavaScript heap, and the file is put together from them without being copied into one array.
export type PdfPage = { jpeg: Blob; width: number; height: number };
export const A4 = { width: 595.28, height: 841.89 }; // points

export function jpegPdf(pages: PdfPage[]): Blob {
  const parts: (string | Blob)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const put = (part: string | Blob) => {
    parts.push(part);
    length += typeof part === 'string' ? part.length : part.size; // every string here is ASCII: one byte a character
  };
  const object = (n: number, ...body: (string | Blob)[]) => {
    offsets[n] = length;
    put(`${n} 0 obj\n`);
    body.forEach(put);
    put('\nendobj\n');
  };

  // Objects: 1 catalog, 2 page tree, then per page a page, its content stream and its image.
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
  put('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const n = 3 + 3 * i;
    const height = +(A4.width * p.height / p.width).toFixed(2);
    const draw = `q ${A4.width} 0 0 ${height} 0 ${+(A4.height - height).toFixed(2)} cm /Im0 Do Q`;
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] `
      + `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    object(n + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    object(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB `
      + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.size} >>\nstream\n`, p.jpeg, '\nendstream');
  });
  const xref = length;
  put(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let n = 1; n < offsets.length; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(parts, { type: 'application/pdf' });
}
