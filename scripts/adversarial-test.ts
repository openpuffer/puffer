#!/usr/bin/env npx tsx
/**
 * Puffer Adversarial Test Script
 *
 * Runs attack scenarios against Puffer's defense pipeline and outputs a detection scorecard.
 *
 * Usage:
 *   npx tsx scripts/adversarial-test.ts --dry-run     # Test pipeline directly (no proxy needed)
 *   npx tsx scripts/adversarial-test.ts                # Test via HTTP proxy (requires puffer start)
 *   npx tsx scripts/adversarial-test.ts --json         # Output JSON results
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures');
const PROXY_URL = process.env.PUFFER_PROXY_URL ?? 'http://127.0.0.1:8787';

interface TestCase {
  text: string;
  category?: string;
  expectedBlocked: boolean;
}

interface CategoryResult {
  total: number;
  detected: number;
  missed: string[];
}

// ── Load fixtures ──
function loadFixture(filename: string): string[] {
  const filepath = path.join(FIXTURES_DIR, filename);
  if (!fs.existsSync(filepath)) return [];
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function buildTestCases(): TestCase[] {
  const cases: TestCase[] = [];

  // Attack fixtures — extract .text field from objects
  for (const entry of loadFixture('injection-attacks.json')) {
    const text = typeof entry === 'string' ? entry : (entry as any).text;
    if (text) cases.push({ text, category: 'injection', expectedBlocked: true });
  }
  for (const entry of loadFixture('pii-samples.json')) {
    const obj = entry as any;
    const text = typeof entry === 'string' ? entry : obj.text;
    const shouldDetect = obj.shouldDetect !== false; // default true
    if (text) cases.push({ text, category: 'pii', expectedBlocked: shouldDetect });
  }

  // Safe fixtures (should NOT be blocked)
  for (const entry of loadFixture('safe-prompts.json')) {
    const text = typeof entry === 'string' ? entry : (entry as any).text;
    if (text) cases.push({ text, category: 'safe', expectedBlocked: false });
  }

  // Note: network-attacks.json and filesystem-attacks.json contain URL/path fixtures
  // that are tested as proper event types by the red team runner, not as LLM text.
  // The adversarial script focuses on text-based detection (injection + PII).

  return cases;
}

// ── Dry-run mode: test through pipeline directly ──
async function runDryMode(cases: TestCase[]) {
  const { createDefaultPipeline } = await import('../src/layers/index.js');
  const { makeDecision } = await import('../src/engine/decision.js');
  const { loadConfig } = await import('../src/utils/config.js');

  const config = loadConfig();
  const testConfig = { ...config, mode: 'enforce' as const };
  const pipeline = createDefaultPipeline(testConfig);

  const results = new Map<string, CategoryResult>();

  for (const tc of cases) {
    const category = tc.category ?? 'unknown';
    if (!results.has(category)) {
      results.set(category, { total: 0, detected: 0, missed: [] });
    }
    const cat = results.get(category)!;
    cat.total++;

    // Build a simple LLM request event
    const event = {
      id: `adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      source: { type: 'hook' as const, agent: 'adversarial-test', provider: 'test' },
      action: {
        type: 'llm_request' as const,
        method: 'POST',
        endpoint: '/v1/messages',
        body: { messages: [{ role: 'user', content: tc.text }] },
      },
      payload: null,
      metadata: { sessionId: 'adversarial', sequenceNumber: 1 },
      layers: [] as any[],
      decision: null as string | null,
    };

    const evaluated = await pipeline.evaluate(event as any);
    evaluated.decision = makeDecision(evaluated as any, { mode: 'enforce' });

    const wasBlocked = evaluated.decision === 'BLOCK' || evaluated.decision === 'ESCALATE';

    if (tc.expectedBlocked) {
      if (wasBlocked) cat.detected++;
      else cat.missed.push(tc.text.slice(0, 80));
    } else {
      // For safe ops, "detected" = correctly allowed (not blocked)
      if (!wasBlocked) cat.detected++;
      else cat.missed.push(`FALSE POSITIVE: ${tc.text.slice(0, 80)}`);
    }
  }

  return results;
}

// ── HTTP mode: test through proxy ──
async function runHttpMode(cases: TestCase[]) {
  const results = new Map<string, CategoryResult>();

  // Only test LLM-type cases via HTTP (network/filesystem need different event types)
  const httpCases = cases.filter(
    (c) => c.category === 'injection' || c.category === 'pii' || c.category === 'safe',
  );

  for (const tc of httpCases) {
    const category = tc.category ?? 'unknown';
    if (!results.has(category)) {
      results.set(category, { total: 0, detected: 0, missed: [] });
    }
    const cat = results.get(category)!;
    cat.total++;

    try {
      const res = await fetch(`${PROXY_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'adversarial-test',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: tc.text }],
        }),
      });

      const wasBlocked = res.status === 403;

      if (tc.expectedBlocked) {
        if (wasBlocked) cat.detected++;
        else cat.missed.push(tc.text.slice(0, 80));
      } else {
        if (!wasBlocked) cat.detected++;
        else cat.missed.push(`FALSE POSITIVE: ${tc.text.slice(0, 80)}`);
      }
    } catch (err) {
      cat.missed.push(`ERROR: ${tc.text.slice(0, 60)} - ${(err as Error).message}`);
    }
  }

  return results;
}

// ── Output ──
function printScorecard(results: Map<string, CategoryResult>, jsonMode: boolean) {
  if (jsonMode) {
    const obj: Record<string, any> = {};
    let totalAll = 0,
      detectedAll = 0;
    for (const [cat, r] of results) {
      obj[cat] = {
        total: r.total,
        detected: r.detected,
        rate: r.total > 0 ? Math.round((r.detected / r.total) * 100) : 100,
        missed: r.missed,
      };
      totalAll += r.total;
      detectedAll += r.detected;
    }
    obj._overall = {
      total: totalAll,
      detected: detectedAll,
      rate: Math.round((detectedAll / totalAll) * 100),
    };
    console.log(JSON.stringify(obj, null, 2));
    return;
  }

  console.log('\n  ADVERSARIAL TEST SCORECARD');
  console.log('  ═══════════════════════════════════════');

  let totalAll = 0,
    detectedAll = 0;
  const safeResult = results.get('safe');

  for (const [cat, r] of results) {
    totalAll += r.total;
    detectedAll += r.detected;
    const rate = r.total > 0 ? Math.round((r.detected / r.total) * 100) : 100;
    const label = cat === 'safe' ? `${cat} (not blocked)` : cat;
    const color = rate >= 90 ? '\x1b[32m' : rate >= 70 ? '\x1b[33m' : '\x1b[31m';
    console.log(`  ${label.padEnd(22)} ${color}${rate}%\x1b[0m (${r.detected}/${r.total})`);
  }

  console.log('  ───────────────────────────────────────');
  const overallRate = Math.round((detectedAll / totalAll) * 100);
  const overallColor = overallRate >= 90 ? '\x1b[32m' : overallRate >= 70 ? '\x1b[33m' : '\x1b[31m';
  console.log(
    `  ${'Overall'.padEnd(22)} ${overallColor}${overallRate}%\x1b[0m (${detectedAll}/${totalAll})`,
  );

  if (safeResult && safeResult.missed.length > 0) {
    const fpRate = Math.round((safeResult.missed.length / safeResult.total) * 100);
    console.log(
      `  ${'False Positive Rate'.padEnd(22)} \x1b[33m${fpRate}%\x1b[0m (${safeResult.missed.length}/${safeResult.total})`,
    );
  }

  // Show missed attacks
  const allMissed = [...results.entries()].flatMap(([cat, r]) =>
    r.missed.map((m) => `[${cat}] ${m}`),
  );
  if (allMissed.length > 0) {
    console.log(`\n  Missed (${allMissed.length}):`);
    for (const m of allMissed.slice(0, 15)) {
      console.log(`    \x1b[33m⚠\x1b[0m ${m}`);
    }
    if (allMissed.length > 15) {
      console.log(`    ... and ${allMissed.length - 15} more`);
    }
  }

  console.log('');
}

// ── Main ──
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const jsonMode = args.includes('--json');

  const cases = buildTestCases();

  if (!jsonMode) {
    console.log(
      `\n  🐡 Puffer Adversarial Test (${dryRun ? 'dry-run / pipeline direct' : 'HTTP proxy mode'})`,
    );
    console.log(`  Loading ${cases.length} test cases...\n`);
  }

  const results = dryRun ? await runDryMode(cases) : await runHttpMode(cases);
  printScorecard(results, jsonMode);

  // Exit code: non-zero if overall rate < 80%
  let totalAll = 0,
    detectedAll = 0;
  for (const r of results.values()) {
    totalAll += r.total;
    detectedAll += r.detected;
  }
  if (Math.round((detectedAll / totalAll) * 100) < 80) process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
