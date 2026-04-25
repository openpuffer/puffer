import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { fromZodError } from 'zod-validation-error';
import type { PufferRule } from '@puffer/core';
import { PufferRuleSchema } from '@puffer/core';
import { logger } from '@puffer/core';

const RULES_DIR = path.join(process.cwd(), 'rules');
const USER_RULES_DIR = path.join(process.env.HOME ?? '~', '.puffer', 'rules');

/**
 * Load community detection rules from one or more YAML pack directories.
 *
 * Each rule is validated against `PufferRuleSchema` (zod) and its regex
 * patterns are compiled eagerly. Rules that fail validation OR contain a
 * regex that does not compile are dropped and a WARN is logged with the
 * file, rule id, and reason. We never silently keep a half-broken rule.
 */
export function loadRules(dirs?: string[]): PufferRule[] {
  const searchDirs = dirs ?? [RULES_DIR, USER_RULES_DIR];
  const rules: PufferRule[] = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      const filePath = path.join(dir, file);
      let docs: ReturnType<typeof YAML.parseAllDocuments>;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        docs = YAML.parseAllDocuments(content);
      } catch (err) {
        logger.warn(`Failed to parse rule file ${file}: ${(err as Error).message}`);
        continue;
      }

      for (const doc of docs) {
        const candidate = doc.toJSON() as unknown;
        // YAML allows empty documents (e.g. trailing `---`); skip them.
        if (candidate === null || candidate === undefined) continue;

        const result = PufferRuleSchema.safeParse(candidate);
        if (!result.success) {
          const issue = fromZodError(result.error, {
            prefix: `Rule rejected in ${file}`,
            issueSeparator: '; ',
          });
          logger.warn(issue.toString());
          continue;
        }
        if (!regexesCompile(result.data, file)) continue;
        rules.push(result.data);
      }
    }
  }

  logger.info(`Loaded ${rules.length} custom rule(s) from ${searchDirs.length} director(ies)`);
  return rules;
}

/**
 * Validate that all regex patterns on a rule actually compile. If any
 * fail, log the offending pattern and drop the whole rule — half-broken
 * detection is worse than no detection at all because users assume the
 * rule is protecting them.
 */
function regexesCompile(rule: PufferRule, file: string): boolean {
  if (rule.pattern !== undefined) {
    try {
      new RegExp(rule.pattern, 'gi');
    } catch (err) {
      logger.warn(
        `Rule ${rule.id} in ${file} has invalid regex \`${rule.pattern}\`: ${(err as Error).message}. Rule dropped.`,
      );
      return false;
    }
  }
  if (rule.patterns !== undefined) {
    for (const p of rule.patterns) {
      try {
        new RegExp(p, 'gi');
      } catch (err) {
        logger.warn(
          `Rule ${rule.id} in ${file} has invalid regex \`${p}\`: ${(err as Error).message}. Rule dropped.`,
        );
        return false;
      }
    }
  }
  return true;
}

/**
 * Test whether a rule matches a piece of text. Patterns are recompiled per
 * call rather than cached, but the loader has already proven they compile
 * so the catch arms here are defensive — they should never fire in
 * practice and exist purely to harden against runtime surprises.
 */
export function matchRule(rule: PufferRule, text: string): boolean {
  if (rule.pattern) {
    try {
      return new RegExp(rule.pattern, 'gi').test(text);
    } catch (err) {
      logger.warn(`Rule ${rule.id} regex failed at match time: ${(err as Error).message}`);
      return false;
    }
  }

  if (rule.patterns) {
    return rule.patterns.some((p) => {
      try {
        return new RegExp(p, 'gi').test(text);
      } catch (err) {
        logger.warn(`Rule ${rule.id} regex failed at match time: ${(err as Error).message}`);
        return false;
      }
    });
  }

  if (rule.command) {
    return text.toLowerCase().includes(rule.command.toLowerCase());
  }

  if (rule.domain) {
    return text.toLowerCase().includes(rule.domain.toLowerCase());
  }

  return false;
}
