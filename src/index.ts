import type { StreamLike } from './supports.ts'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { supportsHyperlinks } from './supports.ts'

export { supportsHyperlinks } from './supports.ts'
export type { StreamLike } from './supports.ts'

const OSC = '\u001B]'
const BEL = '\u0007'

export interface HyperlinkOptions {
  /** Stream whose TTY state determines whether escapes are emitted. Defaults to `process.stdout`. */
  stream?: StreamLike
  /** Force hyperlinks on or off, bypassing terminal detection. */
  enabled?: boolean
  /**
   * OSC 8 `id` param, letting a terminal treat separate runs of cells as one
   * hyperlink, so a label wrapped across lines highlights as a whole on hover.
   * Must not contain `;`, `:` or `=`.
   */
  id?: string
}

export interface LinkOptions extends HyperlinkOptions {
  /**
   * Builds the visible label from the absolute target and any `line`/`column`,
   * e.g. as a CLI's own alias: `absolute => absolute.replace(rootDir, '~')`.
   *
   * Defaults to the `cwd`-relative path with a `:<line>:<column>` suffix. The
   * link target is unaffected, so a label need not resemble a path at all, and
   * a label that omits the position still links to it.
   */
  formatter?: (absolute: string, line?: number, column?: number) => string
  /** Directory used to resolve relative paths. Defaults to `process.cwd()`, read at call time. */
  cwd?: string
  /** 1-based line number, shown as `:<line>` in the default label and linked as `#L<line>`. */
  line?: number
  /** 1-based column number, shown and linked after the line as `:<column>`. */
  column?: number
}

export interface Linker {
  /** Link `target`, with the linker's defaults applied. */
  link: typeof link
}

/** Windows drive-letter or UNC path, in either separator style. */
const WINDOWS_PATH_RE = /^(?:[a-z]:|[\\/]{2}[^\\/])/i

/**
 * Resolve `target` against `cwd` in whichever separator style they are written
 * in, so a CLI can link paths it received from elsewhere (logs, config, a
 * Windows machine's output) regardless of the platform it is running on.
 */
function resolve(target: string, cwd: string): { absolute: string, relative: string, url: string } {
  const windows = WINDOWS_PATH_RE.test(target) || WINDOWS_PATH_RE.test(cwd)
  const { resolve, relative } = windows ? path.win32 : path.posix
  const absolute = resolve(cwd, target)

  return {
    absolute,
    relative: relative(cwd, absolute) || '.',
    // `pathToFileURL` renders a bare drive root as `file:///C://`.
    url: pathToFileURL(absolute, { windows }).href.replace(/:\/\/$/, ':/'),
  }
}

/**
 * The `:12:3` label suffix and the `#L12,3` URL fragment for a line and column.
 *
 * The fragment is an editor jump-to-line hint; terminals that do not understand
 * it just open the file. The comma is what VS Code's `extractSelection` parses
 * (`/^L?(\d+)(?:,(\d+))?/`), and a colon there silently drops the column.
 */
function position({ line, column }: LinkOptions): [suffix: string, fragment: string] {
  if (line === undefined) {
    return ['', '']
  }

  return column === undefined
    ? [`:${line}`, `#L${line}`]
    : [`:${line}:${column}`, `#L${line},${column}`]
}

/**
 * Wrap `target` in an OSC 8 hyperlink pointing at it on disk, labelled by
 * `options.formatter` or, by default, with its `cwd`-relative path and a
 * `:<line>:<column>` suffix.
 *
 * The label is emitted byte-for-byte; only invisible escapes are added. When the
 * terminal does not support hyperlinks the label is returned on its own.
 */
export function link(target: string, options: LinkOptions = {}): string {
  const { absolute, relative, url } = resolve(target, options.cwd ?? process.cwd())
  const [suffix, fragment] = position(options)
  const label = options.formatter?.(absolute, options.line, options.column) ?? relative + suffix

  return hyperlink(label, url + fragment, options)
}

/**
 * Wrap `label` in an OSC 8 hyperlink pointing at `url`, which is used as the
 * link target verbatim: no path resolution and no `file://` conversion.
 *
 * The label is emitted byte-for-byte, so a label that already contains colour
 * escapes is passed through untouched. When the terminal does not support
 * hyperlinks the label is returned on its own.
 */
export function hyperlink(label: string, url: string, options: HyperlinkOptions = {}): string {
  if (!(options.enabled ?? supportsHyperlinks(options.stream))) {
    return label
  }

  const params = options.id === undefined ? '' : `id=${options.id}`

  return `${OSC}8;${params};${url}${BEL}${label}${OSC}8;;${BEL}`
}

/**
 * Create a `link` with `defaults` pre-applied, so a CLI can configure its own
 * aliasing (`~/nuxt.config.ts`) and cwd once rather than at every call site.
 */
export function createLinker(defaults: LinkOptions = {}): Linker {
  return {
    link: (target, options = {}) => link(target, { ...defaults, ...options }),
  }
}
