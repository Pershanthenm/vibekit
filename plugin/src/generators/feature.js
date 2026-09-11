import { FEATURES_DIR } from '../features.js';
import { file, frontMatter, markdown, section } from './shared.js';

function renderSpec({ id, title, targets }) {
  return markdown(
    frontMatter({ id, title: JSON.stringify(title), status: 'draft', targets: `[${targets.join(', ')}]` }),
    `# ${title}`,
    section('Problem', 'TODO: who has which problem, and why it matters now.'),
    section('User stories', '- TODO: As a <user>, I want <goal> so that <benefit>.'),
    section('Acceptance criteria', '- [ ] AC-1: TODO Given <context>, when <action>, then <observable outcome>.'),
    section('Edge cases', '- TODO: empty, invalid, offline, slow, concurrent, unauthorised'),
    section('Out of scope', '- TODO'),
    section('Open questions', '- TODO'),
  );
}

function renderPlan({ title }) {
  return markdown(
    `# Plan — ${title}`,
    section('Approach', 'TODO'),
    section('Modules & layers touched', 'TODO'),
    section('Data & contracts', 'TODO'),
    section('UI states per target', 'TODO (or "n/a")'),
    section('Test strategy', '| AC | Test | Level |\n|---|---|---|\n| AC-1 | TODO | unit / integration / UI |\n\nSmoke: TODO (the critical path, tagged as smoke)'),
    section('Documentation', 'TODO: docs and diagrams this feature creates or changes (feature doc, design doc if UI, architecture / data model / deployment if touched).'),
    section('NFRs, risks & rollback', 'TODO'),
  );
}

function renderTasks({ title }) {
  return markdown(
    `# Tasks — ${title}`,
    'Format: `- [ ] T-<n> [test|impl|docs] <what> (AC-<n>) — <files>`. Append `[P]` when a task shares no files with other open tasks. End with a `[docs]` task.',
    '- [ ] T-1 [test] TODO (AC-1)\n- [ ] T-2 [impl] TODO (AC-1)\n- [ ] T-3 [docs] TODO update docs and diagrams (AC-1)',
  );
}

export function featureFiles(feature) {
  const dir = `${FEATURES_DIR}/${feature.id}`;
  return [
    file(`${dir}/spec.md`, renderSpec(feature)),
    file(`${dir}/plan.md`, renderPlan(feature)),
    file(`${dir}/tasks.md`, renderTasks(feature)),
  ];
}
