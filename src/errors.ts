/** Base error for all failed PDF operations. */
export class PdfError extends Error {
  /** qpdf process exit code (2 = error). */
  readonly exitCode: number;
  /** Raw qpdf stderr output. */
  readonly stderr: string;

  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = 'PdfError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Thrown when a supplied password is wrong or a required password is missing. */
export class PdfPasswordError extends PdfError {
  constructor(message: string, exitCode: number, stderr: string) {
    super(message, exitCode, stderr);
    this.name = 'PdfPasswordError';
  }
}
