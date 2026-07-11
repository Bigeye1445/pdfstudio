import { beforeAll, describe, expect, it } from 'vitest';
import { createPdfToolkit, PdfPasswordError, type PdfToolkit } from '../src/index.js';
import { makePdf, pdfText } from './fixtures.js';

let pdf: PdfToolkit;

beforeAll(async () => {
  pdf = await createPdfToolkit();
});

describe('inspection', () => {
  it('counts pages', async () => {
    expect(await pdf.pageCount(makePdf(7))).toBe(7);
  });

  it('accepts ArrayBuffer and Blob inputs', async () => {
    const bytes = makePdf(2);
    const buffer = bytes.slice().buffer;
    expect(await pdf.pageCount(buffer)).toBe(2);
    expect(await pdf.pageCount(new Blob([bytes]))).toBe(2);
  });

  it('reports unencrypted files', async () => {
    expect(await pdf.isEncrypted(makePdf(1))).toBe(false);
    expect(await pdf.requiresPassword(makePdf(1))).toBe(false);
  });
});

describe('lock / unlock', () => {
  it('locks with AES-256 and unlocks with the password', async () => {
    const locked = await pdf.lock(makePdf(3), { userPassword: 'hunter2' });
    expect(await pdf.isEncrypted(locked)).toBe(true);
    expect(await pdf.requiresPassword(locked)).toBe(true);

    const unlocked = await pdf.unlock(locked, { password: 'hunter2' });
    expect(await pdf.isEncrypted(unlocked)).toBe(false);
    expect(await pdf.pageCount(unlocked)).toBe(3);
  });

  it('supports distinct owner password and unlocks with it', async () => {
    const locked = await pdf.lock(makePdf(2), {
      userPassword: 'user-pw',
      ownerPassword: 'owner-pw',
    });
    const unlocked = await pdf.unlock(locked, { password: 'owner-pw' });
    expect(await pdf.isEncrypted(unlocked)).toBe(false);
  });

  it('locks with an empty user password (restrictions without a prompt)', async () => {
    const locked = await pdf.lock(makePdf(1), {
      userPassword: '',
      ownerPassword: 'owner-pw',
      permissions: { print: 'none', extract: false },
    });
    expect(await pdf.isEncrypted(locked)).toBe(true);
    expect(await pdf.requiresPassword(locked)).toBe(false);
  });

  it('supports legacy 128-bit and 40-bit encryption', async () => {
    for (const keyLength of [128, 40] as const) {
      const locked = await pdf.lock(makePdf(1), { userPassword: 'pw', keyLength });
      expect(await pdf.isEncrypted(locked)).toBe(true);
      expect(await pdf.pageCount(await pdf.unlock(locked, { password: 'pw' }))).toBe(1);
    }
  });

  it('throws PdfPasswordError on a wrong password', async () => {
    const locked = await pdf.lock(makePdf(1), { userPassword: 'right' });
    await expect(pdf.unlock(locked, { password: 'wrong' })).rejects.toBeInstanceOf(
      PdfPasswordError,
    );
  });

  it('handles passwords with spaces, unicode, and dashes', async () => {
    const password = '--héllo wörld 密码 -x';
    const locked = await pdf.lock(makePdf(1), { userPassword: password });
    expect(await pdf.pageCount(await pdf.unlock(locked, { password }), {})).toBe(1);
  });
});

describe('changePassword / removePassword', () => {
  it('changes the password', async () => {
    const locked = await pdf.lock(makePdf(2), { userPassword: 'old-pw' });
    const rekeyed = await pdf.changePassword(locked, {
      currentPassword: 'old-pw',
      newPassword: 'new-pw',
    });
    await expect(pdf.unlock(rekeyed, { password: 'old-pw' })).rejects.toBeInstanceOf(
      PdfPasswordError,
    );
    expect(await pdf.pageCount(await pdf.unlock(rekeyed, { password: 'new-pw' }))).toBe(2);
  });

  it('removes the password', async () => {
    const locked = await pdf.lock(makePdf(2), { userPassword: 'pw' });
    const open = await pdf.removePassword(locked, { password: 'pw' });
    expect(await pdf.isEncrypted(open)).toBe(false);
  });
});

describe('merge', () => {
  it('merges whole documents in order', async () => {
    const merged = await pdf.merge([makePdf(3), makePdf(2), makePdf(4)]);
    expect(await pdf.pageCount(merged)).toBe(9);
  });

  it('merges page selections and encrypted sources', async () => {
    const locked = await pdf.lock(makePdf(5), { userPassword: 'pw' });
    const merged = await pdf.merge([
      { data: makePdf(4), pages: '1-2' },
      { data: locked, password: 'pw', pages: [1, 'z'] },
    ]);
    expect(await pdf.pageCount(merged)).toBe(4);
  });

  it('rejects an empty source list', async () => {
    await expect(pdf.merge([])).rejects.toBeInstanceOf(TypeError);
  });
});

describe('split / extractPages', () => {
  it('splits into single pages', async () => {
    const parts = await pdf.split(makePdf(5));
    expect(parts).toHaveLength(5);
    for (const part of parts) expect(await pdf.pageCount(part)).toBe(1);
  });

  it('splits into chunks', async () => {
    const parts = await pdf.split(makePdf(5), { pagesPerFile: 2 });
    expect(parts).toHaveLength(3);
    expect(await pdf.pageCount(parts[0]!)).toBe(2);
    expect(await pdf.pageCount(parts[2]!)).toBe(1);
  });

  it('extracts a page range', async () => {
    const extracted = await pdf.extractPages(makePdf(10), { pages: '2-4,9' });
    expect(await pdf.pageCount(extracted)).toBe(4);
  });
});

describe('rotate', () => {
  it('rotates all pages relatively', async () => {
    const rotated = await pdf.rotate(makePdf(2), { angle: 90 });
    expect(pdfText(rotated)).toContain('/Rotate 90');
  });

  it('rotates counter-clockwise', async () => {
    const rotated = await pdf.rotate(makePdf(1), { angle: -90 });
    expect(pdfText(rotated)).toContain('/Rotate 270');
  });

  it('rotates selected pages with an absolute angle', async () => {
    const once = await pdf.rotate(makePdf(3), { angle: 90, pages: 1 });
    const again = await pdf.rotate(once, { angle: 180, absolute: true, pages: 1 });
    expect(pdfText(again)).toContain('/Rotate 180');
  });

  it('rejects negative absolute angles', async () => {
    await expect(pdf.rotate(makePdf(1), { angle: -90, absolute: true })).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe('raw + concurrency', () => {
  it('runs arbitrary qpdf commands via raw()', async () => {
    const out = await pdf.raw([makePdf(3)], ['--pages', '$in0', '1-2', '--', '--empty', '$out']);
    expect(await pdf.pageCount(out)).toBe(2);
  });

  it('serializes interleaved operations safely', async () => {
    const results = await Promise.all([
      pdf.pageCount(makePdf(1)),
      pdf.lock(makePdf(2), { userPassword: 'x' }).then((locked) => pdf.isEncrypted(locked)),
      pdf.merge([makePdf(2), makePdf(3)]).then((merged) => pdf.pageCount(merged)),
      pdf.split(makePdf(4)).then((parts) => parts.length),
    ]);
    expect(results).toEqual([1, true, 5, 4]);
  });
});
