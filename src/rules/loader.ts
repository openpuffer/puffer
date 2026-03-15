import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { PufferRule } from './types.js';
import { logger } from '../utils/logger.js';

const RULES_DIR = path.join(process.cwd(), 'rules');
const USER_RULES_DIR = path.join(process.env.HOME ?? '~', '.puffer', 'rules');

export function loadRules(dirs?: string[]): PufferRule[] {
  const searchDirs = dirs ?? [RULES_DIR, USER_RULES_DIR];
  const rules: PufferRule[] = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const docs = YAML.parseAllDocuments(content);

        for (const doc of docs) {
          const rule = doc.toJSON() as PufferRule;
          if (validateRule(rule)) {
            rules.push(rule);
          } else {
            logger.warn(`Invalid rule in ${file}: missing required fields`);
          }
        }
      } catch (err) {
        logger.warn(`Failed to parse rule file ${file}: ${(err as Error).message}`);
      }
    }
  }

  logger.info(`Loaded ${rules.length} custom rule(s) from ${searchDirs.length} director(ies)`);
  return rules;
}

function validateRule(rule: unknown): rule is PufferRule {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.severity === 'string' &&
    typeof r.layer === 'string' &&
    typeof r.action === 'string' &&
    (typeof r.pattern === 'string' || Array.isArray(r.patterns) || typeof r.command === 'string' || typeof r.path === 'string' || typeof r.domain === 'string')
  );
}

export function matchRule(rule: PufferRule, text: string): boolean {
  if (rule.pattern) {
    try {
      return new RegExp(rule.pattern, 'gi').test(text);
    } catch { return false; }
  }

  if (rule.patterns) {
    return rule.patterns.some(p => {
      try { return new RegExp(p, 'gi').test(text); } catch { return false; }
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
