// Terminal font resolution (#194). tmux-opener is a replacement for VS Code's
// built-in Terminal panel, not an editor surface, so when its own
// `tmuxOpener.terminal.font*` settings are unset it inherits the *terminal*
// font settings (`terminal.integrated.font*`) rather than the editor's. This
// fixes the serif-render bug: `editor.fontFamily` can legitimately be a
// proportional/serif face, which is wrong for a terminal (#194 background).
//
// This module is deliberately free of any `vscode` import (mirrors
// `src/font-registry.ts`) so `node --test` can drive the resolver with plain
// data. The `getConfiguration`/`inspect` I/O stays in `src/extension.ts`, which
// extracts the values below and hands them to `resolveTerminalFontConfig`.

/** Final fallback family when neither tmux nor terminal.integrated names one. */
export const DEFAULT_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';

/** Final fallback size when no configured source provides one. */
export const DEFAULT_FONT_SIZE = 14;

/**
 * Plain-data inputs the resolver needs, all already read out of VS Code config.
 *
 * The two `fontSize` fields carry **only an explicitly-set** value (else
 * `undefined`): unlike `terminal.integrated.fontFamily` (whose VS Code default
 * is `""`), `terminal.integrated.fontSize` and `editor.fontSize` ship *concrete*
 * numeric defaults, so a plain `get('fontSize')` can never be "unset". Reading
 * `terminal.integrated.fontSize`'s concrete default would shadow a user's
 * `editor.fontSize`; passing explicit-only values (via `inspect` on the host
 * side) keeps the priority meaningful. `undefined` here means "user did not set
 * this source", which the resolver then skips.
 */
export interface TerminalFontSettings {
  /** `tmuxOpener.terminal.fontFamily` raw value (config default `''`). */
  tmuxFontFamily: string;
  /** `tmuxOpener.terminal.fontSize` raw value (config default `null`). */
  tmuxFontSize: number | null;
  /** `terminal.integrated.fontFamily` raw value (VS Code default `''`). */
  terminalFontFamily: string;
  /** `terminal.integrated.fontSize`, only if the user explicitly set it. */
  terminalFontSize: number | undefined;
  /** `editor.fontSize`, only if the user explicitly set it. */
  editorFontSize: number | undefined;
}

/**
 * Resolve the terminal's effective `{ fontFamily, fontSize }`.
 *
 * fontFamily: `tmuxOpener.terminal.fontFamily` wins if non-empty, else
 *   `terminal.integrated.fontFamily` if non-empty, else the hardcoded monospace
 *   fallback. `terminal.integrated.fontFamily`'s empty default falls through to
 *   the hardcoded fallback (the guard against inheriting an unset editor face).
 *
 * fontSize: `tmuxOpener.terminal.fontSize` wins if set (non-null), else an
 *   explicitly-set `terminal.integrated.fontSize`, else an explicitly-set
 *   `editor.fontSize`, else the hardcoded default. Preferring the terminal size
 *   only when the user actually chose it avoids regressing a user who scaled
 *   `editor.fontSize` but never touched the terminal setting.
 */
export function resolveTerminalFontConfig(s: TerminalFontSettings): {
  fontFamily: string;
  fontSize: number;
} {
  const fontFamily = s.tmuxFontFamily || s.terminalFontFamily || DEFAULT_FONT_FAMILY;
  const fontSize =
    s.tmuxFontSize ?? s.terminalFontSize ?? s.editorFontSize ?? DEFAULT_FONT_SIZE;
  return { fontFamily, fontSize };
}
