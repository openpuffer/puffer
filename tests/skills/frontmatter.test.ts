import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '@puffer/skills';

describe('parseFrontmatter', () => {
  it('parses valid frontmatter with name and description', () => {
    const raw = `---
name: my-skill
description: Does awesome things
---
Body content here.`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter['name']).toBe('my-skill');
    expect(frontmatter['description']).toBe('Does awesome things');
    expect(body.trim()).toBe('Body content here.');
  });

  it('strips surrounding quotes from values', () => {
    const raw = `---
name: "quoted-skill"
description: 'single quoted desc'
---
Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter['name']).toBe('quoted-skill');
    expect(frontmatter['description']).toBe('single quoted desc');
  });

  it('returns empty frontmatter and full body when no frontmatter block present', () => {
    const raw = `Just plain content here
with multiple lines.`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('returns empty frontmatter when only opening --- exists (malformed)', () => {
    const raw = `---
name: orphan
No closing delimiter`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('only captures first line of multi-line values (the rest are ignored)', () => {
    const raw = `---
description: first line only
  continuation is ignored
---
Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter['description']).toBe('first line only');
  });

  it('handles empty input gracefully', () => {
    const { frontmatter, body } = parseFrontmatter('');
    expect(frontmatter).toEqual({});
    expect(body).toBe('');
  });

  it('does not treat --- mid-document as frontmatter', () => {
    const raw = `Some body text
---
not: frontmatter
---
more body`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('silently skips lines without colon inside frontmatter', () => {
    const raw = `---
name: valid-skill
this line has no colon
description: still parsed
---
Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter['name']).toBe('valid-skill');
    expect(frontmatter['description']).toBe('still parsed');
    expect(Object.keys(frontmatter)).not.toContain('this line has no colon');
  });

  it('handles whitespace around keys and values', () => {
    const raw = `---
  name  :   spaced skill
  description  :   spaced desc
---
Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter['name']).toBe('spaced skill');
    expect(frontmatter['description']).toBe('spaced desc');
  });

  it('handles unicode in values', () => {
    const raw = `---
description: 解析技能 — with émoji 🎯
---
Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter['description']).toBe('解析技能 — with émoji 🎯');
  });

  it('returns body without the frontmatter block', () => {
    const raw = `---
name: x
---
Line one.
Line two.`;
    const { body } = parseFrontmatter(raw);
    expect(body).toContain('Line one.');
    expect(body).toContain('Line two.');
    expect(body).not.toContain('name: x');
  });
});
