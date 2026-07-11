import { QpdfRunner, type RunResult } from './runner.js';
import { PdfError, PdfPasswordError } from './errors.js';
import type {
  ChangePasswordOptions,
  ExtractPagesOptions,
  LockOptions,
  MergeSource,
  PageSelection,
  PasswordOption,
  PdfInput,
  PdfToolkitOptions,
  Permissions,
  RotateOptions,
  SplitOptions,
  UnlockOptions,
} from './types.js';

export { PdfError, PdfPasswordError } from './errors.js';
export type * from './types.js';

/**
 * A PDF toolkit backed by qpdf compiled to WebAssembly. All operations run
 * locally (browser, worker, or Node) — documents never leave the device.
 *
 * Create one with {@link createPdfToolkit} and reuse it; instantiation loads
 * and compiles the wasm binary once.
 */
export class PdfToolkit {
  private runner: QpdfRunner;

  private constructor(runner: QpdfRunner) {
    this.runner = runner;
  }

  /** @internal — use {@link createPdfToolkit}. */
  static async create(options: PdfToolkitOptions = {}): Promise<PdfToolkit> {
    return new PdfToolkit(await QpdfRunner.create(options));
  }

  /**
   * Decrypt an encrypted PDF, producing a copy with no password and no
   * usage restrictions.
   */
  unlock(pdf: PdfInput, options: UnlockOptions): Promise<Uint8Array> {
    return this.transform(pdf, [passwordArg(options.password), '--decrypt']);
  }

  /**
   * Alias of {@link unlock}: removes the password and all restrictions.
   */
  removePassword(pdf: PdfInput, options: UnlockOptions): Promise<Uint8Array> {
    return this.unlock(pdf, options);
  }

  /**
   * Encrypt a PDF with a password (AES-256 by default) and optional
   * usage restrictions.
   */
  lock(pdf: PdfInput, options: LockOptions): Promise<Uint8Array> {
    return this.transform(pdf, encryptArgs(options));
  }

  /**
   * Change the password of an encrypted PDF (decrypts with the current
   * password and re-encrypts with the new one in a single pass).
   */
  changePassword(pdf: PdfInput, options: ChangePasswordOptions): Promise<Uint8Array> {
    const lockOptions: LockOptions = {
      userPassword: options.newPassword,
      ownerPassword: options.newOwnerPassword ?? options.newPassword,
      ...(options.keyLength !== undefined && { keyLength: options.keyLength }),
      ...(options.permissions !== undefined && { permissions: options.permissions }),
    };
    return this.transform(pdf, [
      passwordArg(options.currentPassword),
      ...encryptArgs(lockOptions),
    ]);
  }

  /**
   * Merge multiple PDFs (or page selections from them) into one document,
   * in the order given.
   */
  async merge(sources: ReadonlyArray<PdfInput | MergeSource>): Promise<Uint8Array> {
    if (sources.length === 0) {
      throw new TypeError('merge() needs at least one source document');
    }
    const normalized: MergeSource[] = sources.map((s) =>
      s instanceof Uint8Array || s instanceof ArrayBuffer || (typeof Blob !== 'undefined' && s instanceof Blob)
        ? { data: s }
        : (s as MergeSource),
    );
    return this.runner.run(normalized.map((s) => s.data), ({ dir, inputPaths, exec, fs }) => {
      const args = ['--empty', '--pages'];
      normalized.forEach((source, i) => {
        args.push(inputPaths[i]!);
        if (source.password !== undefined) args.push(`--password=${source.password}`);
        args.push(source.pages !== undefined ? pagesArg(source.pages) : '1-z');
      });
      const out = `${dir}/out.pdf`;
      args.push('--', out);
      assertOk(exec(args));
      return fs.readFile(out);
    });
  }

  /**
   * Split a PDF into multiple documents of `pagesPerFile` pages each
   * (default 1 — one document per page). Returns the parts in order.
   */
  async split(pdf: PdfInput, options: SplitOptions = {}): Promise<Uint8Array[]> {
    const per = options.pagesPerFile ?? 1;
    if (!Number.isInteger(per) || per < 1) {
      throw new TypeError(`pagesPerFile must be a positive integer, got ${per}`);
    }
    return this.runner.run([pdf], ({ dir, inputPaths, exec, fs }) => {
      const args: string[] = [];
      if (options.password !== undefined) args.push(passwordArg(options.password));
      args.push(`--split-pages=${per}`, inputPaths[0]!, `${dir}/part-%d.pdf`);
      assertOk(exec(args));
      const parts = fs
        .readdir(dir)
        .filter((name) => name.startsWith('part-'))
        .sort((a, b) => partNumber(a) - partNumber(b));
      return parts.map((name) => fs.readFile(`${dir}/${name}`));
    });
  }

  /**
   * Extract a page selection into a new document.
   */
  extractPages(pdf: PdfInput, options: ExtractPagesOptions): Promise<Uint8Array> {
    const args: string[] = [];
    if (options.password !== undefined) args.push(passwordArg(options.password));
    args.push('--pages', '.', pagesArg(options.pages), '--');
    return this.transform(pdf, args);
  }

  /**
   * Rotate pages. Relative to the current rotation by default; pass
   * `absolute: true` to set the exact rotation instead.
   */
  async rotate(pdf: PdfInput, options: RotateOptions): Promise<Uint8Array> {
    const { angle, absolute = false, pages, password } = options;
    if (absolute && angle < 0) {
      throw new TypeError('absolute rotation must use a non-negative angle (90, 180, or 270)');
    }
    const prefix = absolute ? '' : angle < 0 ? '-' : '+';
    const spec = `${prefix}${Math.abs(angle)}${pages !== undefined ? `:${pagesArg(pages)}` : ''}`;
    const args: string[] = [];
    if (password !== undefined) args.push(passwordArg(password));
    args.push(`--rotate=${spec}`);
    return this.transform(pdf, args);
  }

  /** Number of pages in the document. */
  async pageCount(pdf: PdfInput, options: PasswordOption = {}): Promise<number> {
    return this.runner.run([pdf], ({ inputPaths, exec }) => {
      const args: string[] = [];
      if (options.password !== undefined) args.push(passwordArg(options.password));
      args.push('--show-npages', inputPaths[0]!);
      const result = exec(args);
      assertOk(result);
      return Number.parseInt(result.stdout.trim(), 10);
    });
  }

  /** Whether the document is encrypted (locked). */
  async isEncrypted(pdf: PdfInput): Promise<boolean> {
    return this.runner.run([pdf], ({ inputPaths, exec }) => {
      const result = exec(['--is-encrypted', inputPaths[0]!]);
      // qpdf exit codes here: 0 = encrypted, 2 = not encrypted.
      if (result.exitCode === 0) return true;
      if (result.exitCode === 2) return false;
      throw toPdfError(result);
    });
  }

  /**
   * Whether opening the document requires a password. `false` for
   * unencrypted files and for files encrypted with an empty user password.
   */
  async requiresPassword(pdf: PdfInput): Promise<boolean> {
    return this.runner.run([pdf], ({ inputPaths, exec }) => {
      const result = exec(['--requires-password', inputPaths[0]!]);
      // 0 = password required, 2 = not encrypted,
      // 3 = encrypted but opens without a password.
      if (result.exitCode === 0) return true;
      if (result.exitCode === 2 || result.exitCode === 3) return false;
      throw toPdfError(result);
    });
  }

  /**
   * Escape hatch: run qpdf with arbitrary CLI arguments. Input documents
   * are staged as `in0.pdf`, `in1.pdf`, … in the working directory; write
   * your output to `out.pdf`. Placeholders `$in0`, `$in1`, …, `$out` in
   * `args` are replaced with the real paths.
   */
  async raw(inputs: PdfInput[], args: string[]): Promise<Uint8Array> {
    return this.runner.run(inputs, ({ dir, inputPaths, exec, fs }) => {
      const out = `${dir}/out.pdf`;
      const resolved = args.map((a) =>
        a.replace(/\$out/g, out).replace(/\$in(\d+)/g, (_, i) => {
          const path = inputPaths[Number(i)];
          if (path === undefined) throw new TypeError(`no input for placeholder $in${i}`);
          return path;
        }),
      );
      assertOk(exec(resolved));
      return fs.readFile(out);
    });
  }

  /** Run a single-input → single-output qpdf transform. */
  private async transform(pdf: PdfInput, extraArgs: string[]): Promise<Uint8Array> {
    return this.runner.run([pdf], ({ dir, inputPaths, exec, fs }) => {
      const out = `${dir}/out.pdf`;
      assertOk(exec([...extraArgs, inputPaths[0]!, out]));
      return fs.readFile(out);
    });
  }
}

/**
 * Load the qpdf WebAssembly module and return a ready-to-use toolkit.
 * Loads ~2 MB of wasm on first call; reuse the returned instance.
 */
export function createPdfToolkit(options: PdfToolkitOptions = {}): Promise<PdfToolkit> {
  return PdfToolkit.create(options);
}

function partNumber(name: string): number {
  return Number.parseInt(name.replace(/^part-/, ''), 10);
}

function passwordArg(password: string): string {
  return `--password=${password}`;
}

function pagesArg(pages: PageSelection): string {
  if (typeof pages === 'number') return String(pages);
  if (typeof pages === 'string') return pages;
  return pages.map(String).join(',');
}

function encryptArgs(options: LockOptions): string[] {
  const {
    userPassword,
    ownerPassword = userPassword,
    keyLength = 256,
    permissions = {},
  } = options;
  const args: string[] = [];
  // qpdf (correctly) refuses to write RC4 files unless explicitly allowed.
  if (keyLength === 40) args.push('--allow-weak-crypto');
  args.push(
    '--encrypt',
    `--user-password=${userPassword}`,
    `--owner-password=${ownerPassword}`,
    `--bits=${keyLength}`,
  );
  if (keyLength === 128) args.push('--use-aes=y');
  const { print, modify, extract, accessibility } = permissions;
  if (keyLength === 40) {
    // The legacy scheme only has y/n switches.
    if (print !== undefined) args.push(`--print=${print === 'none' ? 'n' : 'y'}`);
    if (modify !== undefined) args.push(`--modify=${modify === 'none' ? 'n' : 'y'}`);
    if (extract !== undefined) args.push(`--extract=${extract ? 'y' : 'n'}`);
  } else {
    if (print !== undefined) args.push(`--print=${print}`);
    if (modify !== undefined) args.push(`--modify=${modify}`);
    if (extract !== undefined) args.push(`--extract=${extract ? 'y' : 'n'}`);
    if (accessibility !== undefined) args.push(`--accessibility=${accessibility ? 'y' : 'n'}`);
  }
  args.push('--');
  return args;
}

/** Exit code 0 is success; 3 is success with warnings. Anything else throws. */
function assertOk(result: RunResult): void {
  if (result.exitCode === 0 || result.exitCode === 3) return;
  throw toPdfError(result);
}

function toPdfError(result: RunResult): PdfError {
  const stderr = result.stderr.trim();
  const message = stderr.split('\n').at(-1) ?? `qpdf failed with exit code ${result.exitCode}`;
  if (/invalid password|password.*(required|incorrect)/i.test(stderr)) {
    return new PdfPasswordError(message, result.exitCode, stderr);
  }
  return new PdfError(message, result.exitCode, stderr);
}
