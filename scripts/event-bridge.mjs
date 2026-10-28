import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Official Go server, pinned and verified against the GitHub release SHA-256.
const version = '0.3.21';
const builds = {
  'win32-x64': ['leb-server-windows-x64.exe', 'f312bc92ff9988a6753a2d53745baea8af9dce9c17f4f94b105892ab98594ab1'],
  'darwin-arm64': ['leb-server-darwin-arm64', '2f8571fee6f80f8a66a0fc376a4932812e1b3c20a39baaca845f0ccabfb0fdbe'],
  'linux-x64': ['leb-server-linux-x64', 'f99d40775327c8112818984765eafbf95e36d5e39dd2c317d518f6b3acbb50fb'],
  'linux-arm64': ['leb-server-linux-arm64', 'c8b613df82ea2b3b1d5a34e7a4fde6a04e44befaf0227b40a0574a2163a537cb'],
};
const build = builds[`${process.platform}-${process.arch}`];
if (!build) throw new Error('当前平台请手动安装官方 LAPLACE Event Bridge 服务端。');
const [asset, expectedHash] = build;
const directory = fileURLToPath(new URL(`../.local/event-bridge/${version}/`, import.meta.url));
const binary = path.join(directory, asset);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let cached = null;
try { cached = await readFile(binary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!cached || digest(cached) !== expectedHash) {
  console.log(`下载官方 LAPLACE Event Bridge ${version}…`);
  const tag = encodeURIComponent(`@laplace.live/event-bridge-server@${version}`);
  const response = await fetch(`https://github.com/laplace-live/event-bridge/releases/download/${tag}/${asset}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`桥接服务下载失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expectedHash) throw new Error('桥接服务校验失败，未运行下载文件。');
  await mkdir(directory, { recursive: true });
  await writeFile(binary, bytes);
}
if (process.platform !== 'win32') await chmod(binary, 0o755);
const server = spawn(binary, ['--host', 'localhost', '--port', '9696'], { stdio: 'inherit', windowsHide: true });
server.on('error', error => { console.error(error); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
