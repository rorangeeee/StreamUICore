import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateExtensionRepository } from '../scripts/validate-extension-repo.mjs';

test('repository checks require buildable source and reject tracked runtime artifacts', async () => {
  const root = path.resolve('.local/repository-test-' + randomUUID(), 'demo');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'plugin.json'), JSON.stringify({ id: 'demo', sdkVersion: 1, version: '1.0.0', build: { kind: 'dotnet', project: 'Demo.csproj' } }));
  const source = ['README.md', '.gitignore', 'plugin.json', 'build.ps1', 'NuGet.Config', 'Demo.csproj', 'Demo.cs'];
  assert.deepEqual(await validateExtensionRepository(root, source), []);
  const errors = await validateExtensionRepository(root, source.filter(name => name !== 'build.ps1').concat('Demo.dll', 'bin/Release/Demo.dll'));
  assert.ok(errors.some(error => error.includes('build.ps1')));
  assert.equal(errors.filter(error => error.startsWith('Generated artifact')).length, 2);
});
