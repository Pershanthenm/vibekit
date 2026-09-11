import { listFeatures, progress } from '../features.js';

function printTable(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  rows.forEach((row) => console.log(row.map((cell, column) => cell.padEnd(widths[column])).join('   ')));
}

export async function list({ root }) {
  const features = await listFeatures(root);
  if (!features.length) {
    console.log('No features yet. Create one with: vibecheck feature "<name>"');
    return;
  }
  const rows = features.map((feature) => {
    const criteria = progress(feature.spec, 'AC');
    const tasks = progress(feature.tasks, 'T');
    return [feature.id, feature.status, `AC ${criteria.done}/${criteria.total}`, `tasks ${tasks.done}/${tasks.total}`];
  });
  printTable([['FEATURE', 'STATUS', 'CRITERIA', 'TASKS'], ...rows]);
}
