import process from 'node:process'

// Terminal coverage below is informed by `supports-hyperlinks` (MIT,
// https://github.com/chalk/supports-hyperlinks) and the OSC 8 notes at
// https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda

export interface StreamLike {
  isTTY?: boolean
}

interface Version {
  major: number
  minor: number
}

function parseVersion(value: string | undefined): Version {
  // Some terminals report versions without dots, e.g. VTE's `4601` => 46.1
  const packed = value && /^\d{3,4}$/.test(value) ? /(\d{1,2})(\d{2})/.exec(value) : undefined
  if (packed) {
    return { major: 0, minor: Number(packed[1]) }
  }

  const [major, minor] = (value ?? '').split('.').map(part => Number.parseInt(part, 10))
  return { major: major || 0, minor: minor || 0 }
}

function atLeast(version: Version, major: number, minor: number): boolean {
  return version.major > major || (version.major === major && version.minor >= minor)
}

function hasFlag(...flags: string[]): boolean {
  const argv = process.argv.slice(2)
  const end = argv.indexOf('--')
  const args = end === -1 ? argv : argv.slice(0, end)
  return flags.some(flag => args.includes(`--${flag}`))
}

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value !== 'false'
}

/**
 * Whether hyperlinks should be emitted for `stream` (defaulting to `process.stdout`).
 *
 * Evaluated on every call: environment and TTY state can both change during the
 * lifetime of a long-running process.
 */
export function supportsHyperlinks(stream: StreamLike | undefined = process.stdout): boolean {
  const env = process.env

  if (env.FORCE_HYPERLINK !== undefined) {
    return truthy(env.FORCE_HYPERLINK)
  }

  if (hasFlag('no-hyperlink', 'no-hyperlinks', 'hyperlink=false', 'hyperlink=never')) {
    return false
  }

  if (hasFlag('hyperlink', 'hyperlink=true', 'hyperlink=always')) {
    return true
  }

  // Netlify renders build logs as HTML and never allocates a TTY.
  if (truthy(env.NETLIFY)) {
    return true
  }

  // A user who has opted out of colour has opted out of escape sequences.
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false
  }

  if (truthy(env.NO_HYPERLINK) || truthy(env.NO_HYPERLINKS)) {
    return false
  }

  if (stream && stream.isTTY !== true) {
    return false
  }

  // Windows Terminal supports OSC 8; conhost and the legacy console do not.
  if (env.WT_SESSION) {
    return true
  }

  if (process.platform === 'win32') {
    return false
  }

  if (truthy(env.CI) || env.TEAMCITY_VERSION) {
    return false
  }

  const termProgram = env.TERM_PROGRAM
  const termProgramVersion = env.TERM_PROGRAM_VERSION

  if (termProgram) {
    const version = parseVersion(termProgramVersion)

    switch (termProgram) {
      case 'iTerm.app':
        return atLeast(version, 3, 1)

      case 'WezTerm': {
        // Nix packages WezTerm with a `0-unstable-YYYY-MM-DD` version string.
        const unstable = /^0-unstable-(\d{4}-\d{2}-\d{2})$/.exec(termProgramVersion ?? '')
        if (unstable?.[1]) {
          return unstable[1] >= '2020-06-20'
        }
        return version.major >= 20200620
      }

      // tmux overwrites `TERM_PROGRAM`, hiding the outer terminal, so this is
      // the only signal available inside a session. Hyperlinks landed in 3.4;
      // older versions swallow the sequence and print the label alone.
      case 'tmux':
        return atLeast(version, 3, 4)

      case 'vscode':
        // Cursor is a VS Code fork on its own 0.x version line.
        return env.CURSOR_TRACE_ID ? true : atLeast(version, 1, 72)

      // `Orca` is an Electron terminal built on xterm.js with an OSC 8 link handler.
      case 'ghostty':
      case 'zed':
      case 'rio':
      case 'Tabby':
      case 'WarpTerminal':
      case 'Orca':
        return true

      // Terminal.app silently drops OSC 8, leaving the label visible.
      case 'Apple_Terminal':
        return false
    }
  }

  if (env.VTE_VERSION) {
    // VTE 0.50.0 shipped hyperlink support but segfaults on it.
    if (env.VTE_VERSION === '0.50.0') {
      return false
    }
    return atLeast(parseVersion(env.VTE_VERSION), 0, 50)
  }

  // Alacritty gained OSC 8 support in 0.11.0 and does not report its version.
  switch (env.TERM) {
    case 'xterm-kitty':
    case 'xterm-ghostty':
    case 'alacritty':
      return true
  }

  return false
}
