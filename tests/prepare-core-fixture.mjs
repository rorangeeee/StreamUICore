import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Expected an isolated test user directory.');
await mkdir(directory, { recursive: true });
await cp(path.resolve('examples/scenes'), path.join(directory, 'scenes'), { recursive: true });
await cp(path.resolve('examples/scenes/live'), path.join(directory, 'scenes/rehearsal'), { recursive: true });
const slot = (id, name, obsScene, settingsPage = '') => ({
  id, name, obsScene, entry: `scenes/${id}/index.html`, width: 1920, height: 1080,
  transition: `scenes/${id}/fade.js`, settingsPage,
});
await writeFile(path.join(directory, 'core-settings.json'), JSON.stringify({
  obs: { enabled: false, url: 'ws://127.0.0.1:4455', password: '' },
  laplace: { enabled: false, url: 'ws://localhost:9696', token: '', startLocalBridge: false },
  scenes: [slot('live', '直播', 'Game', 'scenes/live/settings.html'), slot('away', '暂离', 'Break'),
    slot('rehearsal', '预制场景', 'Rehearsal', 'scenes/rehearsal/settings.html')],
  selectedSceneId: 'live', away: { enabled: false, sceneId: 'away' }, enabledPlugins: [],
}, null, 2));
await mkdir(path.join(directory, 'scene-settings'), { recursive: true });
await writeFile(path.join(directory, 'scene-settings/rehearsal.json'), JSON.stringify({ title: '预先开发好的场景', custom: { preserved: true } }));
