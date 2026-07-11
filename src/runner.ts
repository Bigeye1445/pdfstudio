import type { QpdfModule } from './wasm/qpdf.js';
import type { PdfInput, PdfToolkitOptions } from './types.js';

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Owns the Emscripten module instance: loads it, serializes operations
 * (the wasm instance is single-threaded and not reentrant), stages input
 * files into MEMFS, and collects stdout/stderr per run.
 */
export class QpdfRunner {
  private module: QpdfModule;
  private queue: Promise<unknown> = Promise.resolve();
  private jobId = 0;
  private stdoutBuf: string[] = [];
  private stderrBuf: string[] = [];

  private constructor(module: QpdfModule) {
    this.module = module;
  }

  static async create(options: PdfToolkitOptions = {}): Promise<QpdfRunner> {
    const { default: createQpdfModule } = await import('./wasm/qpdf.js');
    let runner: QpdfRunner;
    const module = await createQpdfModule({
      print: (text) => runner.stdoutBuf.push(text),
      printErr: (text) => runner.stderrBuf.push(text),
      ...(options.wasmUrl !== undefined && {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? String(options.wasmUrl) : prefix + path,
      }),
    });
    runner = new QpdfRunner(module);
    return runner;
  }

  /**
   * Run qpdf with `args` inside a fresh MEMFS working directory.
   * `inputs` are staged as numbered files; `job(dir)` receives the directory
   * path and the staged file paths via the second argument of `buildArgs`.
   */
  async run<T>(
    inputs: PdfInput[],
    job: (ctx: {
      dir: string;
      inputPaths: string[];
      exec: (args: string[]) => RunResult;
      fs: QpdfModule['FS'];
    }) => T | Promise<T>,
  ): Promise<T> {
    const result = this.queue.then(async () => {
      const dir = `/job${++this.jobId}`;
      const fs = this.module.FS;
      fs.mkdir(dir);
      const inputPaths: string[] = [];
      try {
        for (let i = 0; i < inputs.length; i++) {
          const path = `${dir}/in${i}.pdf`;
          fs.writeFile(path, await toBytes(inputs[i]!));
          inputPaths.push(path);
        }
        return await job({
          dir,
          inputPaths,
          exec: (args) => this.exec(args),
          fs,
        });
      } finally {
        for (const name of fs.readdir(dir)) {
          if (name !== '.' && name !== '..') fs.unlink(`${dir}/${name}`);
        }
        fs.rmdir(dir);
      }
    });
    // Keep the queue alive even when this job fails.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private exec(args: string[]): RunResult {
    this.stdoutBuf = [];
    this.stderrBuf = [];
    let exitCode: number;
    try {
      exitCode = this.module.callMain(args);
    } catch (e) {
      // qpdf may terminate via exit(); Emscripten surfaces that as an
      // ExitStatus throw when EXIT_RUNTIME=0.
      if (isExitStatus(e)) {
        exitCode = e.status;
      } else {
        throw e;
      }
    }
    return {
      exitCode: exitCode ?? 0,
      stdout: this.stdoutBuf.join('\n'),
      stderr: this.stderrBuf.join('\n'),
    };
  }
}

function isExitStatus(e: unknown): e is { status: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: string }).name === 'ExitStatus' &&
    typeof (e as { status?: unknown }).status === 'number'
  );
}

async function toBytes(input: PdfInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new TypeError('Unsupported PDF input: expected Uint8Array, ArrayBuffer, or Blob');
}
