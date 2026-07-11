# pdfstudio

**A client-side PDF toolkit for the browser.** Lock, unlock, change or remove
passwords, merge, split, extract, and rotate PDFs — with nothing leaving the
device. Powered by [qpdf](https://qpdf.sourceforge.io/) compiled to
WebAssembly, wrapped in a small, fully typed TypeScript API.

```ts
import { createPdfToolkit } from 'pdfstudio';

const pdf = await createPdfToolkit();

const locked   = await pdf.lock(file, { userPassword: 'hunter2' });
const unlocked = await pdf.unlock(locked, { password: 'hunter2' });
const merged   = await pdf.merge([a, b, c]);
const pages    = await pdf.split(merged);            // one Uint8Array per page
const rotated  = await pdf.rotate(file, { angle: 90 });
```

## Why

Every "unlock PDF" / "merge PDF" site on the internet uploads your documents
to someone's server. That's a strange default for what is fundamentally a
local file transformation — often of documents (contracts, statements, IDs)
you'd least want to upload. The web platform is perfectly capable of doing
this work itself; what was missing was a proper library.

`pdfstudio` is qpdf — the same battle-tested C++ engine Linux distributions
have shipped for 15+ years — compiled to a 2.1 MB WebAssembly binary, with a
typesafe API in front of it. Everything runs in the page (or a worker, or
Node). No uploads, no server, no telemetry.

## Features

| | |
|---|---|
| 🔒 **Lock** | AES-256 encryption (also 128-bit AES and legacy 40-bit RC4), user + owner passwords, granular permissions (printing, modification, extraction) |
| 🔓 **Unlock** | Decrypt with the user *or* owner password, removing all restrictions |
| 🔁 **Change password** | Re-encrypt with a new password in a single pass |
| 🧹 **Remove password** | Produce an unencrypted copy |
| ➕ **Merge** | Combine whole documents or page selections, mixing encrypted and plain sources |
| ✂️ **Split** | One document per page, or N pages per document |
| 🎯 **Extract pages** | Pull any page selection into a new document |
| 🔄 **Rotate** | Relative or absolute rotation, per page range |
| 🗑 **Delete pages** | Remove a selection, keep the rest — plus reverse page order |
| 🂠 **Collate** | Interleave pages from multiple documents (fronts + backs of a scan) |
| 💧 **Watermark** | Overlay or underlay pages from another PDF — stamps, letterheads |
| 🗜 **Compress** | Lossless stream recompression + object streams; linearize for fast web view |
| 🩹 **Repair** | Reconstruct damaged cross-reference tables and recoverable corruption |
| 📎 **Attachments** | Add, list, extract, and remove embedded files |
| 🫓 **Flatten** | Bake annotations & form fields into page content |
| 🔍 **Inspect** | `getInfo()`: PDF version, page count, encryption scheme & permissions, attachments |
| 🖼 **Images → PDF** | Build a PDF from JPEGs in pure TypeScript (no recompression) |
| 🛠 **Escape hatch** | Run any qpdf CLI invocation via `raw()` |

Works in browsers (main thread or Web Worker), in Node.js ≥ 18, and on
Cloudflare Workers — same API everywhere.

## Install

```sh
npm install pdfstudio
```

The package ships ESM + type declarations + `qpdf.wasm`. Modern bundlers
(Vite, webpack 5, Rollup, esbuild) pick up the wasm asset automatically via
`import.meta.url`. If yours doesn't, or you serve the wasm from a CDN, pass
the location explicitly:

```ts
const pdf = await createPdfToolkit({ wasmUrl: '/assets/qpdf.wasm' });
```

## Usage

### Setup

```ts
import { createPdfToolkit } from 'pdfstudio';

// Loads + compiles the wasm once (~2 MB). Create one and reuse it.
const pdf = await createPdfToolkit();
```

Every operation accepts a `Uint8Array`, `ArrayBuffer`, or `Blob`/`File`
(straight from `<input type="file">` or drag-and-drop) and resolves to a
`Uint8Array` of the resulting document:

```ts
const input = document.querySelector<HTMLInputElement>('#file');
const bytes = await pdf.rotate(input.files[0], { angle: 90 });

// Download it:
const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
```

### Lock (encrypt)

```ts
const locked = await pdf.lock(doc, {
  userPassword: 'open-me',        // required to open the file
  ownerPassword: 'admin-only',    // full access; defaults to userPassword
  keyLength: 256,                 // 256 (default) | 128 | 40
  permissions: {
    print: 'low',                 // 'full' | 'low' | 'none'
    modify: 'none',               // 'all' | 'annotate' | 'form' | 'assembly' | 'none'
    extract: false,               // allow copying text/images
  },
});
```

An empty `userPassword: ''` with a real `ownerPassword` creates a file that
opens without a prompt but still enforces the permission restrictions.

### Unlock / remove password / change password

```ts
const open = await pdf.unlock(locked, { password: 'open-me' });
// removePassword() is an alias of unlock()

const rekeyed = await pdf.changePassword(locked, {
  currentPassword: 'open-me',
  newPassword: 'new-secret',
});
```

A wrong password rejects with `PdfPasswordError` (a subclass of `PdfError`),
so you can distinguish "bad password" from "corrupt file":

```ts
import { PdfPasswordError } from 'pdfstudio';

try {
  await pdf.unlock(doc, { password: guess });
} catch (e) {
  if (e instanceof PdfPasswordError) askAgain();
  else throw e;
}
```

### Merge

```ts
// Whole documents, in order:
const merged = await pdf.merge([a, b, c]);

// Page selections, including encrypted sources:
const report = await pdf.merge([
  { data: cover },
  { data: body, pages: '2-9' },
  { data: appendix, password: 'pw', pages: ['1', 'z'] }, // z = last page
]);
```

### Split & extract

```ts
const singlePages = await pdf.split(doc);                    // Uint8Array[]
const chunks      = await pdf.split(doc, { pagesPerFile: 10 });
const excerpt     = await pdf.extractPages(doc, { pages: '2-5,9' });
```

### Rotate

```ts
await pdf.rotate(doc, { angle: 90 });                  // all pages, clockwise
await pdf.rotate(doc, { angle: -90, pages: '1-3' });   // counter-clockwise
await pdf.rotate(doc, { angle: 180, absolute: true }); // set exact rotation
```

### Delete, reverse, collate

```ts
const trimmed  = await pdf.deletePages(doc, { pages: '2-3' });
const backward = await pdf.reversePages(doc);

// Interleave: page 1 of A, page 1 of B, page 2 of A, … Great for
// combining separately scanned fronts and backs:
const combined = await pdf.collate([fronts, { data: backs, pages: 'z-1' }]);
```

### Watermark / stamp

Overlay (or underlay) pages from another PDF. `repeat: 1` tiles a
single-page stamp across the whole document:

```ts
const stamped = await pdf.watermark(doc, confidentialStamp, { repeat: 1 });
const letterheaded = await pdf.watermark(doc, letterhead, {
  mode: 'underlay',   // draw behind the page content
  to: '1',            // first page only
});
```

### Compress, linearize, repair

```ts
const smaller = await pdf.compress(doc);                    // lossless
const fast    = await pdf.linearize(doc);                   // fast web view
const fixed   = await pdf.repair(brokenDoc);                // rebuild xref
```

### Attachments

```ts
const withFile = await pdf.addAttachment(doc, {
  data: jsonBytes,
  name: 'invoice.json',
  mimeType: 'application/json',
});
await pdf.listAttachments(withFile);                        // [{ name: 'invoice.json', … }]
const bytes = await pdf.getAttachment(withFile, { name: 'invoice.json' });
const clean = await pdf.removeAttachment(withFile, { name: 'invoice.json' });
```

### Flatten

Bake annotations and form-field appearances into the page content —
useful before printing, splitting, or sharing:

```ts
const flat = await pdf.flatten(doc);
```

### Inspect

```ts
await pdf.pageCount(doc);          // number
await pdf.isEncrypted(doc);        // boolean
await pdf.requiresPassword(doc);   // false for empty-user-password files

const info = await pdf.getInfo(locked, { password: 'pw' });
// {
//   pdfVersion: '2.0', pageCount: 12, encrypted: true,
//   encryption: {
//     bits: 256, method: 'AESv3',
//     userPasswordMatched: true, ownerPasswordMatched: false,
//     permissions: { print: false, extract: false, modify: false, … },
//   },
//   attachments: [],
// }
```

### Images → PDF

`imagesToPdf` needs no wasm at all — JPEG data is embedded verbatim
(no recompression, no quality loss), one page per image:

```ts
import { imagesToPdf } from 'pdfstudio';

const album = await imagesToPdf([scan1, scan2, photo], { dpi: 300 });
```

### Escape hatch

Anything else qpdf can do is reachable through `raw()`. Inputs are staged as
`$in0`, `$in1`, …; write output to `$out`:

```ts
// Two-up page layout? n-up is about the only thing qpdf can't do —
// but e.g. splitting into groups of pages after each bookmark, etc.:
const out = await pdf.raw([doc], ['--pages', '$in0', '1-z:odd', '--', '--empty', '$out']);
```

### Page selections

Anywhere a `pages` option appears, use qpdf's
[page range syntax](https://qpdf.readthedocs.io/en/stable/cli.html#page-ranges):

| Selection | Meaning |
|---|---|
| `5` | page 5 |
| `'1-5'` | pages 1–5 |
| `'1,3,5-9'` | union, in order |
| `'z'` | last page |
| `'r2'` | second-to-last |
| `'z-1'` | all pages, reversed |
| `'1-9:odd'` | odd positions within the range |
| `'1-z,x3-4'` | everything except pages 3–4 |
| `[1, '4-8', 'z']` | arrays mix numbers and ranges |

### Web Workers

Operations are synchronous inside the wasm and run on the calling thread. For
large documents, load the toolkit inside a Worker to keep the UI responsive —
the API works there unchanged, and `Uint8Array` results transfer cheaply via
`postMessage`.

### Cloudflare Workers

Works on the edge too. Workers forbid runtime wasm compilation, so import
the wasm as a module (compiled at deploy time) and pass it in:

```ts
import { createPdfToolkit } from 'pdfstudio';
import qpdfWasm from 'pdfstudio/qpdf.wasm';

const pdf = await createPdfToolkit({ wasmModule: qpdfWasm });
```

A runnable example (self-test route + a `POST /unlock` endpoint) lives in
[`examples/cloudflare-worker`](examples/cloudflare-worker):

```sh
cd examples/cloudflare-worker
npm install
npm run dev     # wrangler dev → http://localhost:8787
```

Mind the platform limits: PDF work needs real CPU time (the paid tier's
budget is comfortable, the free tier's ~10 ms is not), and MEMFS lives in
the wasm heap, so very large documents press against the 128 MB memory cap.

## Demo

```sh
npm install
npm run demo
```

Opens a small UI exercising every operation: drop PDFs in, lock/unlock,
merge, split, rotate, download results. All local.

## Building the wasm from source

The published package includes the compiled `qpdf.wasm`; you only need this
to upgrade qpdf or change build flags.

Requirements: [Emscripten](https://emscripten.org) and CMake
(`brew install emscripten cmake`).

```sh
npm run build:wasm   # downloads qpdf sources, compiles → src/wasm/
npm test             # 43 end-to-end tests through the real wasm
npm run build        # emits dist/ (ESM + d.ts + wasm)
```

Build details, for the curious:

- qpdf 12.3.2 with its built-in **native crypto** provider — no OpenSSL in
  the binary; AES/SHA2/MD5/RC4 are qpdf's own implementations.
- zlib and libjpeg come from Emscripten's ports.
- Compiled with wasm-native exception handling (`-fwasm-exceptions`) since
  qpdf uses C++ exceptions for all error reporting.
- Modularized ES6 output (`-sMODULARIZE -sEXPORT_ES6`) with an in-memory
  filesystem (MEMFS); each operation stages files in a scratch directory,
  invokes qpdf's CLI `main()`, and reads the result back.
- Random data comes from the platform's CSPRNG
  (`crypto.getRandomValues` via Emscripten).

## License

Apache-2.0, same as [qpdf](https://github.com/qpdf/qpdf) itself. The wasm
binary also contains zlib (zlib license) and libjpeg (IJG license).
