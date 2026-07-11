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

export interface PdfToolkitOptions {
  /**
   * Override the location of `qpdf.wasm`. Useful when your bundler moves
   * assets around or you serve the wasm from a CDN.
   */
  wasmUrl?: string | URL;
}
