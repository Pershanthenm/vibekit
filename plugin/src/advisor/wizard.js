import { nextRoundFor } from './selection.js';

const signed = (points) => (points > 0 ? `+${points}` : `${points}`);

export function formatRecommendation(result) {
  const layers = Object.entries(result.layers).map(([layer, ranking]) => {
    const top = ranking.ranked.slice(0, 3).map((entry, index) => {
      const reasons = entry.reasons.map((reason) => `${signed(reason.points)} ${reason.text}`).join('; ');
      return `  ${index === 0 ? '★' : ' '} ${entry.label} (${entry.licence.name}) — ${entry.score}${reasons ? `: ${reasons}` : ''}`;
    });
    const excluded = ranking.excluded.map((entry) => `    ✖ ${entry.label}: ${entry.reason}`);
    return [`${layer}`, ...top, ...excluded].join('\n');
  });
  return [...layers, ...result.warnings.map((warning) => `! ${warning}`)].join('\n');
}

export async function runWizard(asker) {
  const raw = {};
  for (let round = await nextRoundFor(raw); !round.complete; round = await nextRoundFor(raw)) {
    console.log(`\n── ${round.title} ──`);
    for (const question of round.questions) raw[question.id] = await asker.choose(question);
  }
  return raw;
}
