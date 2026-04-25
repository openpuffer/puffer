// Runtime validation for community-contributed Puffer detection rules.
//
// Rules live in YAML packs under rules/ (bundled) and ~/.puffer/rules/
// (user-installed). They drive the layered detector pipeline, so the
// validator MUST be strict — a malformed rule that loads silently can
// make a layer detect nothing while looking healthy.

import { z } from 'zod';
import type { PufferRule } from '../rules/types.js';

export const RuleSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const RuleLayerSchema = z.enum([
  'injection',
  'pii',
  'commands',
  'network',
  'filesystem',
  'behavior',
  'mcp',
]);
export const RuleActionSchema = z.enum(['block', 'audit', 'escalate']);

const baseRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  author: z.string(),
  severity: RuleSeveritySchema,
  layer: RuleLayerSchema,
  action: RuleActionSchema,
  tags: z.array(z.string()),
  pattern: z.string().optional(),
  patterns: z.array(z.string()).optional(),
  command: z.string().optional(),
  path: z.string().optional(),
  domain: z.string().optional(),
  version: z.string().optional(),
  references: z.array(z.string()).optional(),
  created: z.string().optional(),
  modified: z.string().optional(),
});

/**
 * A rule MUST carry at least one detection criterion. The previous
 * hand-rolled validator allowed otherwise; that meant a rule with only
 * metadata could be loaded and would silently never fire. Refusing rules
 * without a criterion is the safer behavior.
 */
export const PufferRuleSchema = baseRuleSchema.refine(
  (r) =>
    r.pattern !== undefined ||
    (r.patterns !== undefined && r.patterns.length > 0) ||
    r.command !== undefined ||
    r.path !== undefined ||
    r.domain !== undefined,
  {
    message:
      'Rule must define at least one detection criterion: pattern, patterns, command, path, or domain',
  },
);

export type ValidatedPufferRule = z.infer<typeof PufferRuleSchema>;
const _typeCompat = null as unknown as ValidatedPufferRule satisfies PufferRule;
void _typeCompat;
