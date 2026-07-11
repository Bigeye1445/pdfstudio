/**
 * Anything we accept as a PDF input. `Blob` covers `File` from
 * `<input type="file">` and drag-and-drop.
 */
export type PdfInput = Uint8Array | ArrayBuffer | Blob;

/**
 * A page selection.
 *
 * - a single 1-based page number: `3`
 * - a qpdf-style range string: `"1-5"`, `"1,3,5-9"`, `"z"` (last page),
 *   `"r2"` (second-to-last), `"1-9:odd"`, `"x3-4"` (exclusions)
 * - an array mixing both: `[1, "4-8", "z"]`
 */
export type PageSelection = number | string | ReadonlyArray<number | string>;

/** Print permission granted to the user-password holder. */
export type PrintPermission = 'full' | 'low' | 'none';

/** Modification permission granted to the user-password holder. */
export type ModifyPermission = 'all' | 'annotate' | 'form' | 'assembly' | 'none';

export interface Permissions {
  /** Allowed printing quality. Default `'full'`. */
  print?: PrintPermission;
  /** Allowed document modifications. Default `'all'`. */
  modify?: ModifyPermission;
  /** Allow text/image extraction (copy). Default `true`. */
  extract?: boolean;
  /**
   * Allow extraction for accessibility (screen readers). Default `true`.
   * Only meaningful for 128-bit encryption; always allowed with 256-bit.
   */
  accessibility?: boolean;
}

export interface LockOptions {
  /**
   * Password required to open the document. May be empty (`""`), in which
   * case the PDF opens without a prompt but is still encrypted and
   * restricted by `permissions` unless the owner password is supplied.
   */
  userPassword: string;
  /**
   * Password that grants full access. Defaults to `userPassword`.
   */
  ownerPassword?: string;
  /**
   * Encryption strength. Default `256` (AES-256, PDF 2.0).
   * `128` uses AES-128; `40` is the legacy RC4 scheme (insecure — only for
   * compatibility with ancient viewers).
   */
  keyLength?: 40 | 128 | 256;
  /** Restrictions applied when opened with the user password. */
  permissions?: Permissions;
}

export interface UnlockOptions {
  /** User or owner password of the encrypted PDF. */
  password: string;
}

export interface ChangePasswordOptions {
  /** Current (user or owner) password. */
  currentPassword: string;
  /** New user password. */
  newPassword: string;
  /** New owner password. Defaults to `newPassword`. */
  newOwnerPassword?: string;
  /** Encryption strength for the re-encrypted file. Default `256`. */
  keyLength?: 40 | 128 | 256;
  /** Permissions for the re-encrypted file. */
  permissions?: Permissions;
}

/** One source document for a merge. */
export interface MergeSource {
  data: PdfInput;
  /** Password, if this source is encrypted. */
  password?: string;
  /** Pages to take from this source. Default: all pages. */
  pages?: PageSelection;
}

export interface SplitOptions {
  /** Number of pages per output document. Default `1`. */
  pagesPerFile?: number;
  /** Password, if the input is encrypted. */
  password?: string;
}

export interface RotateOptions {
  /**
   * Rotation in degrees. Positive = clockwise, negative = counter-clockwise.
   * By default the rotation is applied relative to each page's current
   * rotation; set `absolute: true` to set it as the absolute page rotation.
   */
  angle: 90 | 180 | 270 | -90 | -180 | -270;
  /** Set the absolute rotation instead of rotating relatively. */
  absolute?: boolean;
  /** Pages to rotate. Default: all pages. */
  pages?: PageSelection;
  /** Password, if the input is encrypted. */
  password?: string;
}

export interface ExtractPagesOptions {
  /** Pages to keep. */
  pages: PageSelection;
  /** Password, if the input is encrypted. */
  password?: string;
}

export interface PasswordOption {
  /** Password, if the input is encrypted. */
  password?: string;
}

export interface CompressOptions {
  /** Password, if the input is encrypted. */
  password?: string;
  /**
   * Recompress already-compressed streams with zlib at the given level
   * (1–9). Default: recompress at level 9.
   */
  compressionLevel?: number;
  /** Pack objects into object streams for smaller files. Default `true`. */
  objectStreams?: boolean;
  /** Also linearize the output for fast web view. Default `false`. */
  linearize?: boolean;
}

export interface WatermarkOptions {
  /**
   * Where the stamp is drawn: `'overlay'` (on top of the page, default)
   * or `'underlay'` (behind the page content).
   */
  mode?: 'overlay' | 'underlay';
  /** Password of the stamp document, if encrypted. */
  stampPassword?: string;
  /** Pages of the target document to stamp. Default: all. */
  to?: PageSelection;
  /** Pages of the stamp document to use, in order. Default: `1-z`. */
  from?: PageSelection;
  /**
   * Stamp pages to repeat once `from` runs out — e.g. `1` or `'1-z'` to
   * tile a single-page watermark across the whole document.
   */
  repeat?: PageSelection;
  /** Password of the target document, if encrypted. */
  password?: string;
}

export interface DeletePagesOptions {
  /** Pages to remove. */
  pages: PageSelection;
  /** Password, if the input is encrypted. */
  password?: string;
}

export interface CollateOptions {
  /** Pages taken from each document per round. Default `1` (interleave). */
  groupSize?: number;
}

export interface FlattenOptions {
  /** Password, if the input is encrypted. */
  password?: string;
  /**
   * Which annotations to include: `'all'` (default), `'print'` (only those
   * that print), or `'screen'` (only those shown on screen).
   */
  annotations?: 'all' | 'print' | 'screen';
}

export interface AddAttachmentOptions {
  /** File content to attach. */
  data: PdfInput;
  /** Key in the PDF's embedded-files table, and the displayed filename. */
  name: string;
  /** MIME type, e.g. `application/json`. */
  mimeType?: string;
  /** Human-readable description shown by some viewers. */
  description?: string;
  /** Password, if the input PDF is encrypted. */
  password?: string;
}

export interface AttachmentRef {
  /** Attachment name (embedded-files table key). */
  name: string;
  /** Password, if the PDF is encrypted. */
  password?: string;
}

export interface AttachmentInfo {
  /** Key in the embedded-files table. */
  name: string;
  /** Preferred display filename, when present. */
  filename?: string;
  /** Description, when present. */
  description?: string;
}

export interface PdfPermissionsInfo {
  accessibility: boolean;
  extract: boolean;
  print: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  assemble: boolean;
}

export interface PdfEncryptionInfo {
  /** Effective key length in bits. */
  bits: number;
  /** Encryption method for streams, e.g. `'AESv3'`, `'AESv2'`, `'RC4'`. */
  method: string;
  /** Whether the supplied password matched the user password. */
  userPasswordMatched: boolean;
  /** Whether the supplied password matched the owner password. */
  ownerPasswordMatched: boolean;
  /** What the user-password holder is allowed to do. */
  permissions: PdfPermissionsInfo;
}

export interface PdfInfo {
  /** PDF specification version of the file, e.g. `'1.7'`, `'2.0'`. */
  pdfVersion: string;
  pageCount: number;
  encrypted: boolean;
  /** Present only when `encrypted` is true. */
  encryption?: PdfEncryptionInfo;
  attachments: AttachmentInfo[];
}

export interface ImagesToPdfOptions {
  /**
   * Resolution the pixel dimensions are mapped at, in dots per inch.
   * Each page is sized to its image: at the default 72 dpi one pixel
   * equals one PDF point.
   */
  dpi?: number;
}

export interface PdfToolkitOptions {
  /**
   * Override the location of `qpdf.wasm`. Useful when your bundler moves
   * assets around or you serve the wasm from a CDN.
   */
  wasmUrl?: string | URL;
  /**
   * A precompiled `WebAssembly.Module` to use instead of fetching and
   * compiling `qpdf.wasm`. Required on platforms that forbid runtime wasm
   * compilation, like Cloudflare Workers:
   *
   * ```ts
   * import qpdfWasm from 'pdfstudio/qpdf.wasm';
   * const pdf = await createPdfToolkit({ wasmModule: qpdfWasm });
   * ```
   *
   * Takes precedence over `wasmUrl`.
   */
  wasmModule?: WebAssembly.Module;
}
