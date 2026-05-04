/**
 * Tiny zero-dependency YAML frontmatter parser.
 *
 * Supports only single-line `key: value` pairs. No nested objects, no arrays.
 * Robust to malformed YAML — non-parseable lines are silently ignored.
 */

const FRONTMATTER_OPEN = '---';

/**
 * Parse YAML frontmatter from a raw string.
 *
 * Returns the key/value pairs found between the opening `---` and closing `---`,
 * plus the remaining body text. If no valid frontmatter block is found (no opening
 * `---` at the very start, or no closing `---`), frontmatter is `{}` and body is
 * the full raw string.
 *
 * Rules:
 * - Only single-line `key: value` pairs are extracted (first `:` splits key/value).
 * - Lines without `:` inside the frontmatter block are silently skipped.
 * - Values are trimmed; surrounding single or double quotes are stripped.
 * - Keys are trimmed.
 * - Continuation lines (indented) do not extend the previous value; they are ignored.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!raw.startsWith(FRONTMATTER_OPEN)) {
    return { frontmatter: {}, body: raw };
  }

  // Split on the first newline after the opening ---
  const afterOpen = raw.slice(FRONTMATTER_OPEN.length);
  // Find closing ---
  const closeIndex = afterOpen.indexOf(`\n${FRONTMATTER_OPEN}`);
  if (closeIndex === -1) {
    // No closing delimiter — malformed, return empty frontmatter
    return { frontmatter: {}, body: raw };
  }

  const fmContent = afterOpen.slice(0, closeIndex);
  // Body is everything after the closing ---\n
  const body = afterOpen.slice(closeIndex + FRONTMATTER_OPEN.length + 1 /* \n */);

  const frontmatter: Record<string, string> = {};
  for (const line of fmContent.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;

    const rawValue = line.slice(colonIdx + 1).trim();
    frontmatter[key] = stripQuotes(rawValue);
  }

  return { frontmatter, body };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
