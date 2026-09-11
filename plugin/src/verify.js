import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listProjectFiles, matchFiles } from './docs/files.js';

const TEST_PATTERNS = [
  '**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.py', '**/*_test.go',
  '**/*Tests.cs', '**/*Test.cs', '**/*Test.java', '**/*Tests.java', '**/*Test.kt',
  '**/tests/**', '**/test/**', '**/__tests__/**', '**/e2e/**',
];
const CRITERION = /^- \[[ x]\] AC-(\d+):/gim;

export const featureNumber = (feature) => feature.id.slice(0, 3);
export const testReference = (feature, criterion) => `${featureNumber(feature)}:AC-${criterion}`;

async function referencesIn(root, files, number) {
  const pattern = new RegExp(`\\b${number}:AC-(\\d+)\\b`, 'g');
  const references = new Map();
  for (const file of files) {
    const content = await readFile(join(root, file), 'utf8').catch(() => '');
    for (const [, criterion] of content.matchAll(pattern)) {
      references.set(Number(criterion), [...new Set([...(references.get(Number(criterion)) ?? []), file])]);
    }
  }
  return references;
}

export async function traceFeature(root, feature, files) {
  const testFiles = matchFiles(files ?? (await listProjectFiles(root)), TEST_PATTERNS).filter((file) => !file.startsWith('specs/'));
  const criteria = [...feature.spec.matchAll(CRITERION)].map(([, criterion]) => Number(criterion));
  const references = await referencesIn(root, testFiles, featureNumber(feature));
  return {
    featureId: feature.id,
    covered: criteria.filter((criterion) => references.has(criterion)).map((criterion) => ({ criterion, files: references.get(criterion) })),
    missing: criteria.filter((criterion) => !references.has(criterion)),
    orphans: [...references.keys()].filter((criterion) => !criteria.includes(criterion)),
  };
}

export async function traceabilityProblems(root, feature) {
  const trace = await traceFeature(root, feature);
  return trace.missing.map((criterion) => `verify: AC-${criterion} has no test named "${testReference(feature, criterion)} …"`);
}
