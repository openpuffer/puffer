import chalk from 'chalk';
import type { PufferScore } from './calculator.js';

function scoreColor(score: number, max: number): typeof chalk {
  const pct = score / max;
  if (pct >= 0.8) return chalk.green;
  if (pct >= 0.5) return chalk.yellow;
  return chalk.red;
}

function gradeColor(grade: string): typeof chalk {
  if (grade.startsWith('A')) return chalk.green;
  if (grade === 'B') return chalk.cyan;
  if (grade === 'C') return chalk.yellow;
  return chalk.red;
}

function progressBar(score: number, max: number, width = 20): string {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const color = scoreColor(score, max);
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

export function formatScore(score: PufferScore): string {
  const lines: string[] = [];
  const gc = gradeColor(score.grade);

  lines.push('');
  lines.push(gc(`  ╔══════════════════════════════════════════╗`));
  lines.push(
    gc(`  ║`) +
      `  🐡 PUFFER SCORE: ${gc.bold(String(score.total))}${chalk.gray('/100')}  ${gc.bold(score.grade)} — ${gc(score.label)}  ` +
      gc(`║`),
  );
  lines.push(gc(`  ╚══════════════════════════════════════════╝`));
  lines.push('');

  // Breakdown
  const { breakdown: b } = score;
  const categories = [
    { name: 'Coverage ', ...b.coverage },
    { name: 'Exposure ', ...b.exposure },
    { name: 'Policy   ', ...b.policy },
    { name: 'Activity ', ...b.activity },
    { name: 'Monitoring', ...b.monitoring },
  ];

  for (const cat of categories) {
    const bar = progressBar(cat.score, cat.max);
    const sc = scoreColor(cat.score, cat.max);
    const scoreStr = sc(`${String(cat.score).padStart(2)}/${cat.max}`);
    lines.push(`  ${chalk.white(cat.name)}  ${bar}  ${scoreStr}  ${chalk.gray(cat.details)}`);
  }

  // Recommendations
  if (score.recommendations.length > 0) {
    lines.push('');
    lines.push(chalk.yellow.bold('  Recommendations:'));
    for (const rec of score.recommendations) {
      lines.push(chalk.yellow(`    → ${rec}`));
    }
  }

  lines.push('');
  return lines.join('\n');
}
