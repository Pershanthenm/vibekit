import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { adoptedProject, adoptReport, asIsDataModel } from '../src/commands/adopt.js';
import { describe, erDiagramFrom } from '../src/brownfield/assemble.js';
import { detectDotnet, detectNode, inspect, languageShare } from '../src/brownfield/detect.js';
import { run } from '../src/cli.js';

console.log = () => {};

const CSPROJ = `<Project ToolsVersion="15.0">
  <PropertyGroup><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup>
</Project>`;

const PACKAGES_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Microsoft.AspNet.Mvc" version="5.2.7" targetFramework="net48" />
  <package id="EntityFramework" version="6.4.4" targetFramework="net48" />
</packages>`;

const ANGULARJS_PACKAGE = JSON.stringify({
  name: 'legacy-web',
  dependencies: { angular: '1.8.2', 'angular-route': '1.8.2' },
  devDependencies: { karma: '^6.3.0' },
  scripts: { build: 'gulp build' },
});

const EF6_MIGRATION = `namespace Legacy.Migrations
{
    public partial class AddAssets : DbMigration
    {
        public override void Up()
        {
            CreateTable(
                "dbo.Assets",
                c => new
                    {
                        Id = c.Int(nullable: false, identity: true),
                        SerialNumber = c.String(maxLength: 64),
                        PurchasedOn = c.DateTime(),
                    })
                .PrimaryKey(t => t.Id);
        }
    }
}`;

async function legacyRepo() {
  const root = await mkdtemp(join(tmpdir(), 'vibecheck-adopt-'));
  await mkdir(join(root, 'src', 'Web', 'Migrations'), { recursive: true });
  await writeFile(join(root, 'src', 'Web', 'Web.csproj'), CSPROJ);
  await writeFile(join(root, 'src', 'Web', 'packages.config'), PACKAGES_CONFIG);
  await writeFile(join(root, 'src', 'Web', 'HomeController.cs'), 'public class HomeController {}');
  await writeFile(join(root, 'src', 'Web', 'Migrations', '202401010000_AddAssets.cs'), EF6_MIGRATION);
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(join(root, 'client', 'package.json'), ANGULARJS_PACKAGE);
  await writeFile(join(root, 'client', 'app.js'), 'angular.module("app", []);');
  return root;
}

// AC-1: the exact versions in the manifests are reported, not a guess.
test('adopt detects a .NET Framework 4.8 MVC app with an AngularJS front end', async () => {
  const described = describe(await inspect(await legacyRepo()));

  assert.ok(described.languages.includes('C#'), `expected C#, got ${described.languages}`);
  assert.ok(described.languages.includes('JavaScript'), `expected JavaScript, got ${described.languages}`);
  assert.ok(described.runtimes.includes('.NET Framework 4.8'), `expected .NET Framework 4.8, got ${described.runtimes}`);
  assert.ok(described.frameworks.includes('ASP.NET MVC 5'), `expected ASP.NET MVC 5, got ${described.frameworks}`);
  assert.ok(described.frameworks.includes('AngularJS 1.8.2'), `expected AngularJS 1.8.2, got ${described.frameworks}`);
  assert.ok(described.frameworks.includes('Entity Framework 6'), `expected Entity Framework 6, got ${described.frameworks}`);
});

// AC-2: an undetectable command stays empty and is reported, with the files that were read.
test('a repository with no test command leaves commands.test empty and says so', async () => {
  const described = describe(await inspect(await legacyRepo()));

  assert.equal(described.commands.test, '');
  assert.ok(described.unknown.includes('commands.test'));

  const project = adoptedProject('legacy', described);
  assert.equal(project.commands.test, '', 'a preset must not fill in a test command that was never found');
  assert.equal(project.origin, 'adopted');

  const report = adoptReport('legacy', described);
  assert.match(report, /\| test \| \*\*not found\*\* \|/);
  assert.match(report, /Web\.csproj/, 'the report must list the manifests it inspected');
  assert.match(report, /package\.json/);
});

// AC-3: a data model diagram comes from the migrations, and the doc is stamped against them.
test('EF6 migrations produce an erDiagram stamped against the migration files', async () => {
  const described = describe(await inspect(await legacyRepo()));

  assert.equal(described.migrations.length, 1);
  const diagram = erDiagramFrom([EF6_MIGRATION]);
  assert.ok(diagram.startsWith('erDiagram'));
  assert.match(diagram, /ASSETS \{/);
  assert.match(diagram, /int Id/);
  assert.match(diagram, /string SerialNumber/);

  const doc = asIsDataModel('legacy', diagram, described.migrations);
  assert.match(doc, /kind: "data-model"/);
  assert.match(doc, /202401010000_AddAssets\.cs/, 'sources must name the migration it read');
});

test('no parsable migrations produces an honest note rather than an empty diagram', () => {
  assert.equal(erDiagramFrom(['public void Up() { /* nothing */ }']), null);
  const doc = asIsDataModel('legacy', null, []);
  assert.match(doc, /No table definitions could be parsed/);
  assert.doesNotMatch(doc, /```mermaid/, 'an empty diagram must not be emitted');
});

// AC-5: adopting an already-specified repository changes nothing.
test('adopt does not overwrite an existing project.json, and reports what it would have done', async () => {
  const root = await legacyRepo();
  await run(['adopt', '--dir', root]);
  const first = await readFile(join(root, 'specs/project.json'), 'utf8');

  await writeFile(join(root, 'specs/project.json'), first.replace(/"name": "[^"]+"/, '"name": "renamed-by-hand"'));
  await run(['adopt', '--dir', root]);

  const after = await readFile(join(root, 'specs/project.json'), 'utf8');
  assert.match(after, /renamed-by-hand/, 'a second adopt must leave the file alone');
});

test('adopt writes the project, the report and both as-is docs', async () => {
  const root = await legacyRepo();
  await run(['adopt', '--dir', root]);

  const project = JSON.parse(await readFile(join(root, 'specs/project.json'), 'utf8'));
  assert.equal(project.origin, 'adopted');
  assert.ok(project.stack.languages.includes('C#'));
  assert.match(project.stack.backend, /ASP\.NET MVC 5/);

  assert.match(await readFile(join(root, 'assessment/adopt.md'), 'utf8'), /Adopt report/);
  assert.match(await readFile(join(root, 'docs/architecture.md'), 'utf8'), /Architecture \(as-is\)/);
  assert.match(await readFile(join(root, 'docs/data-model.md'), 'utf8'), /erDiagram/);
});

test('detectors read versions out of manifests without guessing', () => {
  const net = detectDotnet(CSPROJ, PACKAGES_CONFIG);
  assert.equal(net.runtime, '.NET Framework 4.8');
  assert.deepEqual(net.frameworks, ['ASP.NET MVC 5', 'Entity Framework 6']);

  const node = detectNode(ANGULARJS_PACKAGE);
  assert.equal(node.language, 'JavaScript');
  assert.deepEqual(node.frameworks, ['AngularJS 1.8.2']);
  assert.deepEqual(node.testFrameworks, ['Karma 6.3.0']);
  assert.equal(node.commands.test, '', 'no test script means no test command');
  assert.equal(node.commands.build, 'npm run build');

  assert.equal(detectNode('{ not json'), null);
  assert.deepEqual(detectDotnet('', '').frameworks, []);
});

test('language share is ordered and adds up', () => {
  assert.deepEqual(languageShare(new Map([['C#', 30], ['JavaScript', 10]])), [
    { language: 'C#', files: 30, share: 75 },
    { language: 'JavaScript', files: 10, share: 25 },
  ]);
  assert.deepEqual(languageShare(new Map()), []);
});

test('inspect skips dependency folders so vendored code cannot skew the result', async () => {
  const root = await legacyRepo();
  await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'left-pad', 'package.json'), JSON.stringify({ name: 'left-pad', dependencies: { react: '18.0.0' } }));

  const described = describe(await inspect(root));
  assert.ok(!described.frameworks.some((name) => name.startsWith('React')), 'node_modules must not be inspected');
});
