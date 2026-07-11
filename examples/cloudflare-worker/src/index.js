/**
 * pdfstudio on Cloudflare Workers.
 *
 * Workers forbid runtime wasm compilation, so the wasm is imported as a
 * module (compiled at deploy time) and handed to the toolkit via the
 * `wasmModule` option.
 *
 *   GET  /            self-test: exercises lock/unlock/merge/getInfo
 *   POST /unlock?password=…   body: an encrypted PDF → decrypted PDF
 *   POST /merge               body: not supported here — see README
 */
import { createPdfToolkit } from 'pdfstudio';
import qpdfWasm from 'pdfstudio/qpdf.wasm';

let toolkitPromise;
function toolkit() {
  // Lazy so nothing heavy happens at isolate startup; shared across requests.
  toolkitPromise ??= createPdfToolkit({ wasmModule: qpdfWasm });
  return toolkitPromise;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/unlock') {
      const password = url.searchParams.get('password') ?? '';
      const pdf = await toolkit();
      const unlocked = await pdf.unlock(await request.arrayBuffer(), { password });
      return new Response(unlocked, {
        headers: { 'content-type': 'application/pdf' },
      });
    }

    // Self-test: run a few operations end to end.
    const pdf = await toolkit();
    const doc = tinyPdf(3);
    const locked = await pdf.lock(doc, {
      userPassword: 's3cret',
      permissions: { extract: false },
    });
    const info = await pdf.getInfo(locked, { password: 's3cret' });
    const unlocked = await pdf.unlock(locked, { password: 's3cret' });
    const merged = await pdf.merge([doc, unlocked]);

    return Response.json({
      ok: true,
      lockedInfo: info,
      mergedPages: await pdf.pageCount(merged),
    });
  },
};

/** Minimal valid n-page PDF for the self-test. */
function tinyPdf(pages) {
  const objs = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n`);
  for (let i = 0; i < pages; i++) {
    objs.push(
      `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>\nendobj\n`,
    );
  }
  let body = '%PDF-1.7\n';
  const offsets = [];
  for (const o of objs) {
    offsets.push(body.length);
    body += o;
  }
  const xrefPos = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
