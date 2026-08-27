# clickable-path

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Github Actions][github-actions-src]][github-actions-href]
[![Codecov][codecov-src]][codecov-href]

> Make the file paths your CLI prints ctrl/cmd-clickable

CLIs print paths, but making them open can be tricky.

Thankfully, [OSC 8 hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) exist. They point at an invisible absolute `file://` URL.

`clickable-path` is a zero-dependency package to print paths as OSC 8 hyperlinks if your terminal supports them, falling back to a plain label if not.

## Usage

```sh
npm install clickable-path
```

> [!NOTE]
> Requires Node 22.1 or newer, which is where `pathToFileURL` gained the `windows` option used to convert Windows-shaped paths on any platform.

```js
import { link } from 'clickable-path'

console.log(`Building ${link('/home/me/project/nuxt.config.ts')}`)
// -> label `nuxt.config.ts`, linking file:///home/me/project/nuxt.config.ts

console.log(link('src/index.ts', { line: 12 }))
// -> label `src/index.ts:12`, linking file:///home/me/project/src/index.ts#L12
```

### API

#### `link(path, options?)`

Wraps `path` in an OSC 8 hyperlink pointing at it on disk, labelled with the `cwd`-relative form (plus `:<line>:<column>` if given) or with whatever `options.formatter` returns. Relative input is resolved against `options.cwd`.

#### `createLinker(defaults?)`

Returns a `{ link }` with `defaults` pre-applied, so you can configure a `formatter` and cwd once rather than at every call site:

```js
const { link } = createLinker({
  formatter: absolute => absolute.replace(rootDir, '~'),
})

console.log(link('/project/app/tailwind.config.ts'))
// label `~/tailwind.config.ts`, linking file:///project/app/tailwind.config.ts
```

The formatter receives the resolved absolute path, plus `line` and `column` if they were passed, and its return value is used without modification. (The default formatter is `path.relative` with a `:<line>:<column>` suffix.) Showing the position is up to the formatter; a label that omits it still links to it, so the file opens at the right line either way. Every `LinkOptions` key can be defaulted this way and overridden per call.

> [!TIP]
> Pad and align inside the formatter, not on the result. The returned string contains invisible escapes, so `link(path).padEnd(20)` pads to the wrong width, while `formatter: absolute => basename(absolute).padEnd(20)` lines up as expected.

#### `supportsHyperlinks(stream?)`

Whether `stream` (default `process.stdout`) will render hyperlinks.

The environment is read on every call rather than snapshotted at module load, so a `.env` file or a `--no-color` flag applied after import is still respected. It costs around a microsecond; if you are linking in a hot loop, call this once and pass the result as `enabled`.

#### `LinkOptions`

| Option | Default | |
| --- | --- | --- |
| `formatter` | `cwd`-relative path plus `:<line>:<column>` | builds the label, given the absolute path, `line` and `column` |
| `cwd` | `process.cwd()`, read at call time | base for relative paths |
| `stream` | `process.stdout` | stream whose TTY state gates output |
| `line` / `column` | | shown as `:<line>:<column>` and linked as `#L<line>,<column>` |
| `id` | | OSC 8 `id` param, so a label wrapped across lines hovers as one link |
| `enabled` | detection result | force on/off |

Paths are converted with `pathToFileURL`, so spaces, `#`, `?` and non-ASCII characters are percent-encoded. Windows-shaped inputs (`C:\...`, `\\server\share\...`) are converted on any platform.

### Non-TTY and CI

> [!NOTE]
> No escapes are emitted when the target stream isn't a TTY, or when `CI` is set, as they would otherwise end up in log files. Netlify is the exception, since it renders build logs as HTML and never allocates a TTY.

Overrides, in order of precedence: `FORCE_HYPERLINK` (set to `0` to disable), then `NO_COLOR` / `NO_HYPERLINK` / `NO_HYPERLINKS`.

> [!WARNING]
> `FORCE_HYPERLINK=1` bypasses every check, including the CI and non-TTY ones. Escape sequences will end up in whatever you are redirecting to.

`NO_COLOR` disables hyperlinks here. Colour support and hyperlink support are not the same capability, so there is no general colour-support check, but someone who has asked for no escape sequences at all should get none.

### Terminal support

| Terminal | Detection |
| --- | --- |
| Windows Terminal >= 1.4 | `WT_SESSION` (any other terminal on win32 is treated as unsupported) |
| VS Code >= 1.72 | `TERM_PROGRAM=vscode` + version |
| Cursor | `TERM_PROGRAM=vscode` + `CURSOR_TRACE_ID` (own 0.x version line) |
| iTerm2 >= 3.1 | `TERM_PROGRAM=iTerm.app` + version |
| WezTerm >= 20200620 | `TERM_PROGRAM=WezTerm`, including Nix's `0-unstable-YYYY-MM-DD` scheme |
| ghostty | `TERM_PROGRAM=ghostty` or `TERM=xterm-ghostty` |
| kitty | `TERM=xterm-kitty` |
| Alacritty >= 0.11 | `TERM=alacritty` |
| zed, rio, Tabby, Warp, Orca | `TERM_PROGRAM` |
| GNOME Terminal / VTE >= 0.50.1 | `VTE_VERSION` (0.50.0 is excluded: it segfaults on hyperlinks) |
| tmux >= 3.4 | `TERM_PROGRAM=tmux` + version |

Terminal.app is explicitly unsupported: it ignores OSC 8, though it degrades gracefully to the plain label. TeamCity is excluded. Anything unrecognised gets no escapes, since a wrong positive prints visible junk.

Passing `line` (and optionally `column`) appends `:12:3` to the default label and `#L12,3` to the URL. Most terminals ignore the fragment and simply open the file, so treat jump-to-line as a hint. You can decide whether to show a position in a custom `formatter` if you want.

> [!IMPORTANT]
> The comma in `#L12,3` is deliberate. VS Code parses the fragment with `/^L?(\d+)(?:,(\d+))?/`, so `#L12:3` matches the line and silently drops the column.

### Differences from `terminal-link` and `supports-hyperlinks`

- **When hyperlinks are unsupported, only the label is printed.** `terminal-link` falls back to appending the raw URL (`nuxt.config.ts file:///home/me/nuxt.config.ts`), which is noise in a log file and breaks any width maths. Here the output is exactly what you would have printed anyway.
- **tmux is detected.** tmux overwrites `TERM_PROGRAM` with `tmux`, hiding the outer terminal, so `supports-hyperlinks` reports no support inside every tmux session. tmux itself has handled OSC 8 since 3.4, so that version and up are supported directly.
- **Detection reads the environment per call.** `supports-hyperlinks` snapshots `supportsHyperlinks.stdout` at module load, so anything that mutates the environment after import is missed, such as loading a `.env` file, or normalising `--no-color` into `NO_COLOR` while parsing argv.
- **No colour-support coupling.** `supports-hyperlinks` returns false whenever `supports-color` does, but this isn't necessarily correct. (We still honour `NO_COLOR` if set.)
- **The OSC 8 `id` param is exposed**, which `terminal-link` does not surface.
- **Labels are derived, not passed in.** `terminal-link(text, url)` makes every call site build both halves; here the path is the argument and the label comes from a formatter you configure once.
- **Zero dependencies**, versus `supports-color` + `has-flag` + `ansi-escapes`.

## Credits

- [`supports-hyperlinks`](https://github.com/chalk/supports-hyperlinks) and [`terminal-link`](https://github.com/sindresorhus/terminal-link) by [Sindre Sorhus](https://github.com/sindresorhus) and [James Talmage](https://github.com/jamestalmage) are excellent. Detection coverage in this package is informed by `supports-hyperlinks`, reimplemented so there are no dependencies and no module-load-time caching. If you want hyperlinks in general rather than paths specifically, `terminal-link` would be a good choice.
- [Egmont Koblinger](https://github.com/egmontkob)'s [hyperlinks in terminal emulators](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) is the de facto OSC 8 spec.

## 💻 Development

- Clone this repository
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

## License

Made with ❤️

Published under [MIT License](./LICENCE).

<!-- Badges -->

[npm-version-src]: https://npmx.dev/api/registry/badge/version/clickable-path
[npm-version-href]: https://npmx.dev/package/clickable-path
[npm-downloads-src]: https://npmx.dev/api/registry/badge/downloads/clickable-path
[npm-downloads-href]: https://npm.chart.dev/clickable-path
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/danielroe/clickable-path/ci.yml?branch=main&style=flat-square
[github-actions-href]: https://github.com/danielroe/clickable-path/actions?query=workflow%3Aci
[codecov-src]: https://img.shields.io/codecov/c/gh/danielroe/clickable-path/main?style=flat-square
[codecov-href]: https://codecov.io/gh/danielroe/clickable-path
