import type { QpdfModule } from './wasm/qpdf.js';
import type { PdfInput, PdfToolkitOptions } from './types.js';

export interface RunResult {
  exitCode: number;
  /** Raw stdout bytes — qpdf writes binary data here for some commands. */
  stdout: Uint8Array;
  /** stdout decoded as UTF-8 text. */
  stdoutText: string;
  /** stderr decoded as UTF-8 text. */
  stderr: string;
}

export interface JobContext {
  dir: string;
  inputPaths: string[];
  exec: (args: string[]) => RunResult;
  fs: QpdfModule['FS'];
}

/**
 * Runs qpdf jobs. The wasm binary is fetched and compiled once; every job
 * then gets its own fresh instance (instantiating a precompiled
 * `WebAssembly.Module` costs ~1 ms). Fresh instances matter for
 * correctness, not just isolation: qpdf keeps global state across
 * `callMain` calls — e.g. its logger refuses to redirect stdout once
 * stdout has been used — so a long-lived instance eventually breaks.
 * They also make jobs safely concurrent.
 *
 * stdout/stderr are captured at the byte level via FS.init so that
 * commands emitting binary output (e.g. --show-attachment) round-trip
 * losslessly.
 */
export class QpdfRunner {
  private compiled: WebAssembly.Module;
  private createModule: (init: object) => Promise<QpdfModule>;

  private constructor(
    compiled: WebAssembly.Module,
    createModule: (init: object) => Promise<QpdfModule>,
  ) {
    this.compiled = compiled;
    this.createModule = createModule;
  }

  static async create(options: PdfToolkitOptions = {}): Promise<QpdfRunner> {
    const { default: createQpdfModule } = await import('./wasm/qpdf.js');
    // A caller-provided module skips fetch + compile — mandatory on
    // platforms that forbid runtime wasm compilation (Cloudflare Workers).
    const compiled =
      options.wasmModule ??
      (await WebAssembly.compile(await loadWasmBytes(resolveWasmUrl(options.wasmUrl))));
    return new QpdfRunner(compiled, createQpdfModule as (init: object) => Promise<QpdfModule>);
  }

  /**
   * Run one or more qpdf invocations against a fresh instance, with
   * `inputs` staged as numbered files in a MEMFS working directory.
   */
  async run<T>(inputs: PdfInput[], job: (ctx: JobContext) => T | Promise<T>): Promise<T> {
    const stagedInputs = await Promise.all(inputs.map(toBytes));

    const stdoutBytes: number[] = [];
    const stderrBytes: number[] = [];
    // moduleArg doubles as the Module object, so by the time preRun fires
    // (the documented place to call FS.init) its FS property is populated.
    const moduleArg: {
      FS?: QpdfModule['FS'];
      preRun: Array<() => void>;
      instantiateWasm: (
        imports: WebAssembly.Imports,
        onSuccess: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
      ) => Record<string, never>;
    } = {
      preRun: [
        () => {
          moduleArg.FS!.init(
            null,
            (byte: number | null) => {
              if (byte !== null) stdoutBytes.push(byte);
            },
            (byte: number | null) => {
              if (byte !== null) stderrBytes.push(byte);
            },
          );
        },
      ],
      instantiateWasm: (imports, onSuccess) => {
        WebAssembly.instantiate(this.compiled, imports).then((instance) =>
          onSuccess(instance, this.compiled),
        );
        return {};
      },
    };
    const module = await this.createModule(moduleArg);

    const dir = '/job';
    module.FS.mkdir(dir);
    const inputPaths = stagedInputs.map((bytes, i) => {
      const path = `${dir}/in${i}.pdf`;
      module.FS.writeFile(path, bytes);
      return path;
    });

    const exec = (args: string[]): RunResult => {
      stdoutBytes.length = 0;
      stderrBytes.length = 0;
      let exitCode: number;
      try {
        exitCode = module.callMain(args);
      } catch (e) {
        // qpdf may terminate via exit(); Emscripten surfaces that as an
        // ExitStatus throw when EXIT_RUNTIME=0.
        if (isExitStatus(e)) {
          exitCode = e.status;
        } else {
          throw e;
        }
      }
      const stdout = new Uint8Array(stdoutBytes);
      return {
        exitCode: exitCode ?? 0,
        stdout,
        stdoutText: decoder.decode(stdout),
        stderr: decoder.decode(new Uint8Array(stderrBytes)),
      };
    };

    // The instance (and its MEMFS) is discarded afterwards, so no cleanup.
    return job({ dir, inputPaths, exec, fs: module.FS });
  }
}

const decoder = new TextDecoder();

function resolveWasmUrl(wasmUrl: string | URL | undefined): URL {
  if (wasmUrl === undefined) return new URL('./wasm/qpdf.wasm', import.meta.url);
  if (wasmUrl instanceof URL) return wasmUrl;
  // Resolve strings against the page when in a browser, else this module.
  const base =
    typeof location !== 'undefined' && typeof location.href === 'string'
      ? location.href
      : import.meta.url;
  return new URL(wasmUrl, base);
}

async function loadWasmBytes(url: URL): Promise<Uint8Array<ArrayBuffer>> {
  if (url.protocol === 'file:') {
    // Computed specifier so browser bundlers neither resolve nor include
    // the Node-only module; this branch can only execute under Node.
    const { readFile } = (await import('node' + ':fs/promises')) as {
      readFile: (path: URL) => Promise<Uint8Array>;
    };
    return new Uint8Array(await readFile(url));
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch qpdf.wasm from ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function isExitStatus(e: unknown): e is { status: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: string }).name === 'ExitStatus' &&
    typeof (e as { status?: unknown }).status === 'number'
  );
}

export async function toBytes(input: PdfInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new TypeError('Unsupported PDF input: expected Uint8Array, ArrayBuffer, or Blob');
}
