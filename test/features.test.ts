import { beforeAll, describe, expect, it } from 'vitest';
import { createPdfToolkit, imagesToPdf, PdfError, type PdfToolkit } from '../src/index.js';
import { makePdf, pdfText } from './fixtures.js';

// 1x1 white JPEG.
const TINY_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  ),
  (c) => c.charCodeAt(0),
);

let pdf: PdfToolkit;

beforeAll(async () => {
  pdf = await createPdfToolkit();
});

describe('compress / linearize', () => {
  it('compresses with object streams and keeps the document intact', async () => {
    const out = await pdf.compress(makePdf(5));
    expect(await pdf.pageCount(out)).toBe(5);
    expect(pdfText(out)).toContain('/ObjStm');
  });

  it('linearizes', async () => {
    const out = await pdf.linearize(makePdf(3));
    expect(await pdf.pageCount(out)).toBe(3);
    // Linearized files carry a linearization parameter dict up front.
    expect(pdfText(out.slice(0, 200))).toContain('/Linearized');
  });

  it('rejects a bad compression level', async () => {
    expect(() => pdf.compress(makePdf(1), { compressionLevel: 11 })).toThrow(TypeError);
  });
});

describe('repair', () => {
  it('repairs a file with a destroyed xref table', async () => {
    const broken = makePdf(4);
    // Zero out the xref offsets so normal parsing fails.
    const text = pdfText(broken);
    const xrefStart = text.indexOf('xref');
    for (let i = xrefStart + 10; i < xrefStart + 60; i++) broken[i] = 0x39; // '9'
    const repaired = await pdf.repair(broken);
    expect(await pdf.pageCount(repaired)).toBe(4);
  });

  it('rejects unrecoverable garbage', async () => {
    await expect(pdf.repair(new TextEncoder().encode('not a pdf at all'))).rejects.toBeInstanceOf(
      PdfError,
    );
  });
});

describe('watermark', () => {
  it('overlays a single-page stamp onto every page', async () => {
    const stamp = await pdf.rotate(makePdf(1), { angle: 90 }); // any 1-page pdf
    const out = await pdf.watermark(makePdf(4), stamp, { repeat: 1 });
    expect(await pdf.pageCount(out)).toBe(4);
  });

  it('underlays', async () => {
    const out = await pdf.watermark(makePdf(2), makePdf(1), { mode: 'underlay', repeat: 1 });
    expect(await pdf.pageCount(out)).toBe(2);
  });
});

describe('page surgery', () => {
  it('deletes a page range', async () => {
    const out = await pdf.deletePages(makePdf(5), { pages: '2-3' });
    expect(await pdf.pageCount(out)).toBe(3);
  });

  it('deletes a mixed selection', async () => {
    const out = await pdf.deletePages(makePdf(6), { pages: [1, 'z'] });
    expect(await pdf.pageCount(out)).toBe(4);
  });

  it('reverses page order', async () => {
    // Mark page 1 with a rotation, reverse, and expect it to land last.
    const marked = await pdf.rotate(makePdf(3), { angle: 90, pages: 1 });
    const reversed = await pdf.reversePages(marked);
    const parts = await pdf.split(reversed);
    expect(pdfText(parts[2]!)).toContain('/Rotate 90');
    expect(pdfText(parts[0]!)).not.toContain('/Rotate 90');
  });

  it('collates two documents', async () => {
    const out = await pdf.collate([makePdf(3), makePdf(2)]);
    expect(await pdf.pageCount(out)).toBe(5);
  });

  it('rejects collating a single document', async () => {
    await expect(pdf.collate([makePdf(2)])).rejects.toBeInstanceOf(TypeError);
  });
});

describe('flatten', () => {
  it('flattens annotations', async () => {
    const out = await pdf.flatten(makePdf(2));
    expect(await pdf.pageCount(out)).toBe(2);
  });
});

describe('attachments', () => {
  it('adds, lists, extracts, and removes an attachment', async () => {
    const content = new TextEncoder().encode('{"invoice": 42}');
    const withAttachment = await pdf.addAttachment(makePdf(1), {
      data: content,
      name: 'invoice.json',
      mimeType: 'application/json',
      description: 'Machine-readable invoice',
    });

    const list = await pdf.listAttachments(withAttachment);
    expect(list.map((a) => a.name)).toEqual(['invoice.json']);

    const extracted = await pdf.getAttachment(withAttachment, { name: 'invoice.json' });
    expect(new TextDecoder().decode(extracted)).toBe('{"invoice": 42}');

    const removed = await pdf.removeAttachment(withAttachment, { name: 'invoice.json' });
    expect(await pdf.listAttachments(removed)).toEqual([]);
  });

  it('round-trips binary attachments losslessly', async () => {
    const binary = Uint8Array.from({ length: 256 }, (_, i) => i);
    const doc = await pdf.addAttachment(makePdf(1), { data: binary, name: 'blob.bin' });
    const back = await pdf.getAttachment(doc, { name: 'blob.bin' });
    expect(Array.from(back)).toEqual(Array.from(binary));
  });
});

describe('getInfo', () => {
  it('describes an unencrypted file', async () => {
    const info = await pdf.getInfo(makePdf(3));
    expect(info).toMatchObject({
      pdfVersion: '1.7',
      pageCount: 3,
      encrypted: false,
      attachments: [],
    });
    expect(info.encryption).toBeUndefined();
  });

  it('describes an encrypted file, including permissions', async () => {
    const locked = await pdf.lock(makePdf(2), {
      userPassword: 'user-pw',
      ownerPassword: 'owner-pw',
      permissions: { print: 'none', extract: false },
    });
    const info = await pdf.getInfo(locked, { password: 'user-pw' });
    expect(info.encrypted).toBe(true);
    expect(info.pageCount).toBe(2);
    expect(info.encryption).toMatchObject({
      bits: 256,
      method: 'AESv3',
      userPasswordMatched: true,
      ownerPasswordMatched: false,
      permissions: { print: false, extract: false },
    });
  });
});

describe('imagesToPdf', () => {
  it('builds a valid PDF from JPEGs, one page each', async () => {
    const out = await imagesToPdf([TINY_JPEG, TINY_JPEG, TINY_JPEG]);
    expect(await pdf.pageCount(out)).toBe(3);
    expect(pdfText(out)).toContain('/DCTDecode');
    // qpdf fully parses it during a rewrite; throws if malformed.
    expect(await pdf.pageCount(await pdf.repair(out))).toBe(3);
  });

  it('honours dpi for page sizing', async () => {
    const out = await imagesToPdf([TINY_JPEG], { dpi: 36 }); // 1px → 2pt
    expect(pdfText(out)).toContain('/MediaBox [0 0 2 2]');
  });

  it('rejects non-JPEG data', async () => {
    await expect(imagesToPdf([new Uint8Array([1, 2, 3, 4])])).rejects.toBeInstanceOf(TypeError);
  });
});
