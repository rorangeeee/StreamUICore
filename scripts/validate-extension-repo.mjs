import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const execute = promisify(execFile);

export async function validateExtensionRepository(root, tracked) {
  const errors = [], files = new Set(tracked);
  const requireFile = name => { if (!files.has(name)) errors.push('Missing tracked file: ' + name); };
  const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
  for (const name of ['README.md', '.gitignore']) requireFile(name);
  for (const name of files)
    if (/(^|\/)(node_modules|bin|obj|ui|release)\//.test(name) || /\.(dll|exe|pdb|deps\.json)$/i.test(name)) errors.push('Generated artifact must not be tracked: ' + name);
  const kind = files.has('preset.json') ? 'preset' : files.has('plugin.json') ? 'plugin' : null;
  if (!kind) return [...errors, 'Missing preset.json or plugin.json'];
  const manifest = await read(kind + '.json');
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(manifest.id ?? '') || path.basename(root) !== manifest.id) errors.push('Directory name must match the manifest id');
  if (manifest.sdkVersion !== (kind === 'preset' ? 2 : 1)) errors.push('Use browser SDK 2 for presets or native SDK 1 for plugins');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) errors.push('version must have three numeric components');
  if (kind === 'preset') {
    for (const name of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'source/index.html']) requireFile(name);
    if (manifest.build?.kind !== 'vite' || manifest.build?.output !== 'ui') errors.push('Preset build must declare kind=vite and output=ui');
    const pkg = files.has('package.json') ? await read('package.json') : {};
    if (!pkg.scripts?.build || !pkg.scripts?.check) errors.push('Preset package.json must provide build and check scripts');
    if (!files.has(manifest.defaults ?? '')) errors.push('Preset defaults must be tracked source JSON');
    for (const dependency of manifest.plugins ?? [])
      if (!dependency.repository?.startsWith('https://') || !dependency.ref) errors.push('Plugin dependencies must declare repository and ref');
  } else {
    for (const name of ['build.ps1', 'NuGet.Config']) requireFile(name);
    const project = manifest.build?.project;
    if (manifest.build?.kind !== 'dotnet' || typeof project !== 'string' || !/^[a-zA-Z0-9._-]+\.csproj$/.test(project)) errors.push('Plugin build must declare a root dotnet project');
    else requireFile(project);
    if (![...files].some(name => name.endsWith('.cs'))) errors.push('Plugin C# source is required');
  }
  if (manifest.settingsPage) requireFile(manifest.settingsPage);
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const roots = process.argv.slice(2);
  if (!roots.length) { console.error('Usage: npm run extensions:check -- <repository> [...]'); process.exitCode = 1; }
  for (const supplied of roots) {
    const root = path.resolve(supplied);
    try {
      const { stdout } = await execute('git', ['-C', root, 'ls-files', '-z']);
      const errors = await validateExtensionRepository(root, stdout.split('\0').filter(Boolean));
      console.log(JSON.stringify({ repository: root, valid: !errors.length, errors }, null, 2));
      if (errors.length) process.exitCode = 1;
    } catch (error) { console.error(root + ': ' + error.message); process.exitCode = 1; }
  }
}
