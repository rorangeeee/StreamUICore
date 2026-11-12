import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const git = promisify(execFile);
const hostPath = path.resolve(process.argv[2] ?? 'StreamUI Core.exe');
const root = path.resolve('.local', 'install-test-' + randomUUID());
const repos = path.join(root, 'repos');
const data = path.join(root, 'data');
const presets = path.join(root, 'presets');
const plugins = path.join(root, 'plugins');
const json = value => JSON.stringify(value);
const headers = { 'Content-Type': 'application/json', 'X-StreamUI-Request': '1' };

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const gitPort = await freePort(), configPort = await freePort(), obsPort = await freePort();
const config = 'http://127.0.0.1:' + configPort;
const repo = name => 'git://127.0.0.1:' + gitPort + '/' + name;

async function createRepo(name, files) {
  const directory = path.join(repos, name);
  await mkdir(directory, { recursive: true });
  for (const [file, value] of Object.entries(files)) await writeFile(path.join(directory, file), value);
  const run = (...args) => git('git', args, { cwd: directory, windowsHide: true });
  await run('init', '-q', '-b', 'main');
  await run('add', '.');
  await run('-c', 'user.name=StreamUI Test', '-c', 'user.email=streamui@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'Test source');
}

async function makePlugin(name, id) {
  await createRepo(name, {
    'plugin.json': json({ id, name, version: '1.0.0', assembly: 'Uptime.dll', type: 'StreamUI.Examples.UptimePlugin', capabilities: ['uptime'] }),
    'UptimePlugin.cs': await readFile(new URL('./fixtures/uptime/UptimePlugin.cs', import.meta.url), 'utf8'),
    'Uptime.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup><Reference Include="StreamUI.Contracts"><HintPath>$(StreamUISdkPath)/StreamUI.Contracts.dll</HintPath><Private>false</Private></Reference></ItemGroup></Project>',
    'NuGet.Config': '<configuration><packageSources><clear /></packageSources></configuration>',
    'build.ps1': [
      'param([Parameter(Mandatory=$true)][string]$SdkPath)',
      "$ErrorActionPreference = 'Stop'",
      'dotnet build -c Release --configfile NuGet.Config "-p:StreamUISdkPath=$SdkPath"',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      "Copy-Item -LiteralPath 'bin/Release/net10.0/Uptime.dll' -Destination '.'",
      "Copy-Item -LiteralPath 'bin/Release/net10.0/Uptime.deps.json' -Destination '.'",
    ].join('\n'),
  });
}

async function makePreset(id, list, required = [], failBuild = false) {
  const name = 'preset-' + id;
  const files = {
    'preset.json': json({ id, name, version: '1.0.0', formatVersion: 1, sdkVersion: 2, defaultScene: 'live',
      scenes: [{ id: 'live', name: 'Live', entry: 'ui/index.html' }],
      plugins: required.map(plugin => ({ id: plugin, minimumVersion: '1.0.0', required: true })) }),
    'package.json': json({ name, version: '1.0.0', scripts: { build: 'node build.mjs' } }),
    'package-lock.json': json({ name, version: '1.0.0', lockfileVersion: 3, packages: { '': { name, version: '1.0.0' } } }),
    'build.mjs': failBuild ? 'throw Error("fixture build failed");' :
      'import { mkdir, writeFile } from "node:fs/promises"; await mkdir("ui"); await writeFile("ui/index.html", "<!doctype html><title>Git install</title>");',
  };
  if (list !== null) files['plugins.txt'] = list;
  await createRepo(name, files);
  return repo(name);
}

async function request(route, method = 'GET', body, expected = 200) {
  const response = await fetch(config + route, { method, headers, body: body === undefined ? undefined : json(body) });
  const text = await response.text();
  assert.equal(response.status, expected, route + ' ' + text);
  return text ? JSON.parse(text) : null;
}
const install = (repository, expected) => request('/api/extensions/install', 'POST', { repository }, expected);

await makePlugin('standalone-repo', 'standalone');
await makePlugin('provider-repo', 'provider');
await makePlugin('rollback-repo', 'rollback');
const good = await makePreset('good', repo('standalone-repo') + '\n\n' + repo('provider-repo') + '\n' + repo('provider-repo') + '\n', ['standalone', 'provider']);
const missingList = await makePreset('missing-list', null);
const missingDependency = await makePreset('missing-dependency', '', ['provider']);
const brokenBuild = await makePreset('broken-build', repo('rollback-repo'), ['rollback'], true);
const gitServer = spawn('git', ['daemon', '--export-all', '--reuseaddr', '--log-destination=none',
  '--listen=127.0.0.1', '--port=' + gitPort, '--base-path=' + repos, repos], { windowsHide: true, stdio: 'ignore' });
const host = spawn(hostPath, ['--headless', '--no-open', '--obs-port', String(obsPort), '--config-port', String(configPort),
  '--data-dir', data, '--presets-dir', presets, '--plugins-dir', plugins],
  { windowsHide: true, stdio: 'ignore', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && host.exitCode === null; attempt++) {
    try { if ((await fetch(config + '/api/state')).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, 'Host must start. See ' + path.join(data, 'host.log'));
  await git('git', ['ls-remote', repo('standalone-repo')], { windowsHide: true });

  assert.equal((await install(repo('standalone-repo'))).kind, 'plugin');
  assert.equal((await request('/api/state')).plugins.find(plugin => plugin.id === 'standalone').state, 'disabled');
  await writeFile(path.join(plugins, 'standalone', 'local-edit.txt'), 'keep this');
  assert.deepEqual(await install(good), { kind: 'preset', id: 'good', name: 'preset-good' });
  assert.equal(await readFile(path.join(plugins, 'standalone', 'local-edit.txt'), 'utf8'), 'keep this');
  assert.ok((await request('/api/presets')).some(preset => preset.id === 'good' && preset.available));
  assert.equal((await request('/api/state')).preset, null);
  const activated = await request('/api/presets/activate', 'POST', { id: 'good' });
  assert.equal(activated.scene.activeId, 'good__live');
  assert.deepEqual(activated.plugins.filter(plugin => plugin.state === 'running').map(plugin => plugin.id).sort(), ['provider', 'standalone']);
  assert.equal((await install(good)).id, 'good');

  assert.match((await install(missingList, 400)).error, /plugins\.txt/);
  assert.match((await install(missingDependency, 400)).error, /plugins\.txt.*provider/);
  assert.match((await install(brokenBuild, 400)).error, /fixture build failed/);
  assert.deepEqual(await readdir(presets), ['good']);
  assert.deepEqual((await readdir(plugins)).sort(), ['provider', 'standalone']);
  assert.equal((await request('/api/state')).preset.id, 'good');
  assert.match((await install('ext::echo unsafe', 400)).error, /Git 仓库地址/);
  const fromOutput = await fetch('http://127.0.0.1:' + obsPort + '/api/extensions/install', { method: 'POST', headers, body: json({ repository: good }) });
  assert.equal(fromOutput.status, 404);
  console.log('Git install passed: native build, preset dependencies, reuse, activation, failed build cleanup, and config-only access.');
} finally {
  try { await request('/api/shutdown', 'POST', undefined, 202); } catch { host.kill(); }
  gitServer.kill();
}
