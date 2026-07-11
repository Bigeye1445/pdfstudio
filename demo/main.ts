import { createPdfToolkit, PdfPasswordError, type PdfToolkit } from '../src/index.js';

interface LoadedFile {
  name: string;
  bytes: Uint8Array;
  pages: number | null;
  encrypted: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const files: LoadedFile[] = [];
let selected = 0;
let pdf: PdfToolkit;

const status = $('status');
const app = $('app');
const fileList = $<HTMLUListElement>('file-list');
const results = $<HTMLUListElement>('results');
const errorBox = $('error');

init();

async function init() {
  try {
    pdf = await createPdfToolkit();
    status.textContent = 'WebAssembly module ready.';
    app.hidden = false;
  } catch (e) {
    status.textContent = `Failed to load wasm: ${e}`;
    return;
  }

  const input = $<HTMLInputElement>('file-input');
  const dropzone = $('dropzone');
  input.addEventListener('change', () => addFiles(input.files));
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    addFiles(e.dataTransfer?.files ?? null);
  });

  wire('btn-merge', async () => {
    need(files.length >= 2, 'Add at least two files to merge.');
    const merged = await pdf.merge(files.map((f) => sourceFor(f)));
    addResult('merged.pdf', merged);
  });

  wire('btn-lock', async () => {
    const f = current();
    const password = value('lock-password');
    need(password.length > 0, 'Enter a password to lock with.');
    const locked = await pdf.lock(f.bytes, {
      userPassword: password,
      permissions: {
        print: checked('lock-no-print') ? 'none' : 'full',
        extract: !checked('lock-no-copy'),
      },
    });
    addResult(rename(f.name, 'locked'), locked);
  });

  wire('btn-unlock', async () => {
    const f = current();
    const unlocked = await pdf.unlock(f.bytes, { password: value('unlock-password') });
    addResult(rename(f.name, 'unlocked'), unlocked);
  });

  wire('btn-change', async () => {
    const f = current();
    const rekeyed = await pdf.changePassword(f.bytes, {
      currentPassword: value('change-old'),
      newPassword: value('change-new'),
    });
    addResult(rename(f.name, 'new-password'), rekeyed);
  });

  wire('btn-split', async () => {
    const f = current();
    const n = Number(value('split-n')) || 1;
    const parts = await pdf.split(f.bytes, { pagesPerFile: n, ...passwordFor(f) });
    parts.forEach((part, i) => addResult(rename(f.name, `part-${i + 1}`), part));
  });

  wire('btn-rotate', async () => {
    const f = current();
    const angle = Number(value('rotate-angle')) as 90 | -90 | 180;
    const pages = value('rotate-pages').trim();
    const rotated = await pdf.rotate(f.bytes, {
      angle,
      ...(pages && { pages }),
      ...passwordFor(f),
    });
    addResult(rename(f.name, 'rotated'), rotated);
  });

  wire('btn-watermark', async () => {
    const f = current();
    const stampIndex = Number(value('wm-stamp'));
    const stamp = files[stampIndex];
    need(stamp !== undefined, 'Load a second PDF to use as the stamp.');
    need(stamp !== f, 'Pick a different file as the stamp (the selected file is the target).');
    const out = await pdf.watermark(f.bytes, stamp.bytes, {
      mode: value('wm-mode') as 'overlay' | 'underlay',
      ...(checked('wm-repeat') && { repeat: 1 }),
      ...passwordFor(f),
      ...(stamp.encrypted && { stampPassword: value('unlock-password') }),
    });
    addResult(rename(f.name, 'watermarked'), out);
  });

  wire('btn-delete', async () => {
    const f = current();
    const pages = value('delete-pages').trim();
    need(pages.length > 0, 'Enter a page selection to delete, e.g. 2-3');
    const out = await pdf.deletePages(f.bytes, { pages, ...passwordFor(f) });
    addResult(rename(f.name, 'trimmed'), out);
  });

  wire('btn-compress', async () => {
    const f = current();
    const out = await pdf.compress(f.bytes, passwordFor(f));
    addResult(rename(f.name, 'compressed'), out);
  });

  wire('btn-repair', async () => {
    const f = current();
    const out = await pdf.repair(f.bytes, passwordFor(f));
    addResult(rename(f.name, 'repaired'), out);
  });

  wire('btn-flatten', async () => {
    const f = current();
    const out = await pdf.flatten(f.bytes, passwordFor(f));
    addResult(rename(f.name, 'flattened'), out);
  });

  wire('btn-reverse', async () => {
    const f = current();
    const out = await pdf.reversePages(f.bytes, passwordFor(f));
    addResult(rename(f.name, 'reversed'), out);
  });

  wire('btn-info', async () => {
    const f = current();
    const info = await pdf.getInfo(f.bytes, passwordFor(f));
    const box = $<HTMLPreElement>('info-output');
    box.hidden = false;
    box.textContent = JSON.stringify(info, null, 2);
  });

  wire('btn-extract', async () => {
    const f = current();
    const pages = value('extract-pages').trim();
    need(pages.length > 0, 'Enter a page selection, e.g. 2-5,9');
    const extracted = await pdf.extractPages(f.bytes, { pages, ...passwordFor(f) });
    addResult(rename(f.name, 'extracted'), extracted);
  });
}

async function addFiles(list: FileList | null) {
  if (!list) return;
  for (const file of Array.from(list)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encrypted = await pdf.isEncrypted(bytes).catch(() => false);
    let pages: number | null = null;
    if (!encrypted) pages = await pdf.pageCount(bytes).catch(() => null);
    files.push({ name: file.name, bytes, pages, encrypted });
  }
  renderFiles();
}

function renderFiles() {
  fileList.innerHTML = '';
  files.forEach((f, i) => {
    const li = document.createElement('li');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'selected';
    radio.className = 'select-radio';
    radio.checked = i === selected;
    radio.addEventListener('change', () => (selected = i));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${(f.bytes.length / 1024).toFixed(0)} KB${f.pages !== null ? ` · ${f.pages} pages` : ''}`;
    li.append(radio, name, meta);
    if (f.encrypted) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'encrypted';
      li.append(badge);
    }
    const remove = document.createElement('button');
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      files.splice(i, 1);
      selected = Math.min(selected, Math.max(files.length - 1, 0));
      renderFiles();
    });
    li.append(remove);
    fileList.append(li);
  });

  const stampSelect = $<HTMLSelectElement>('wm-stamp');
  const previous = stampSelect.value;
  stampSelect.innerHTML = '';
  files.forEach((f, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `stamp: ${f.name}`;
    stampSelect.append(option);
  });
  if ([...stampSelect.options].some((o) => o.value === previous)) {
    stampSelect.value = previous;
  }
}

function addResult(name: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.textContent = name;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${(blob.size / 1024).toFixed(0)} KB`;
  li.append(link, meta);
  results.prepend(li);
}

function wire(id: string, handler: () => Promise<void>) {
  const button = $<HTMLButtonElement>(id);
  button.addEventListener('click', async () => {
    errorBox.hidden = true;
    button.disabled = true;
    try {
      await handler();
    } catch (e) {
      errorBox.hidden = false;
      errorBox.textContent =
        e instanceof PdfPasswordError
          ? 'Wrong or missing password.'
          : e instanceof Error
            ? e.message
            : String(e);
    } finally {
      button.disabled = false;
    }
  });
}

function current(): LoadedFile {
  need(files.length > 0, 'Add a PDF first.');
  return files[selected]!;
}

function sourceFor(f: LoadedFile) {
  return { data: f.bytes, ...passwordFor(f) };
}

/** For encrypted inputs, reuse whatever the unlock password field holds. */
function passwordFor(f: LoadedFile): { password?: string } {
  return f.encrypted ? { password: value('unlock-password') } : {};
}

function value(id: string): string {
  return $<HTMLInputElement>(id).value;
}

function checked(id: string): boolean {
  return $<HTMLInputElement>(id).checked;
}

function rename(name: string, suffix: string): string {
  return name.replace(/\.pdf$/i, '') + `-${suffix}.pdf`;
}

function need(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
