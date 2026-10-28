import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { subscriber } from './ws-fixture.mjs';

const executable = path.resolve(process.argv[2] || '.local/host/StreamUI.Core.exe');
const directory = path.resolve('.local/preset-test-' + randomUUID());
const catalog = path.join(directory, 'catalog');
await mkdir(directory, { recursive: true }); await cp(path.resolve('presets'), catalog, { recursive: true });
const alternate = path.join(catalog, 'alternate'); await cp(path.join(catalog, 'minimal'), alternate, { recursive: true });
const alternateManifest = JSON.parse(await readFile(path.join(alternate, 'preset.json'), 'utf8'));
alternateManifest.id = 'alternate'; alternateManifest.name = 'Alternate';
await writeFile(path.join(alternate, 'preset.json'), JSON.stringify(alternateManifest));
const invalid = path.join(catalog, 'invalid'); await cp(alternate, invalid, { recursive: true });
await writeFile(path.join(invalid, 'preset.json'), JSON.stringify({ ...alternateManifest, id: 'invalid', sdkVersion: 999 }));
const traversal = path.join(catalog, 'traversal'); await cp(alternate, traversal, { recursive: true });
await writeFile(path.join(traversal, 'preset.json'), JSON.stringify({ ...alternateManifest, id: 'traversal', defaults: '../outside.json' }));
async function freePort() { const server=createServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port; }
const outputPort = await freePort(), configPort = await freePort();
const base = 'http://127.0.0.1:' + configPort, output = 'http://127.0.0.1:' + outputPort;
const args = ['--headless','--no-open','--obs-port',String(outputPort),'--config-port',String(configPort),'--data-dir',directory,'--presets-dir',catalog,'--plugins-dir',path.resolve('plugins')];
const checks = [], streams = [];
const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
async function until(predicate) { const end=Date.now()+15000; while(Date.now()<end) { if(await predicate())return; await new Promise(resolve=>setTimeout(resolve,80)); } throw Error('Timed out waiting for test Host.'); }
async function request(route,method='GET',body) { const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})}); assert.ok(response.ok,route+': '+response.status+' '+(!response.ok?await response.text():'')); return response.headers.get('content-type')?.includes('application/json')?response.json():null; }
let instance;
async function start() { instance=spawn(executable,args,{windowsHide:true,stdio:'ignore'}); await until(async()=>{try{return(await fetch(base+'/api/state')).ok;}catch{return false;}}); }
async function stop() { if(!instance || instance.exitCode!==null)return; const exiting=new Promise(resolve=>instance.once('exit',resolve)); await request('/api/shutdown','POST'); await Promise.race([exiting,new Promise((_,reject)=>setTimeout(()=>reject(Error('Test Host failed to exit.')),12000))]); }
try {
  await start();
  let state=await request('/api/state');
  check(state.preset===null&&state.scenes.length===0&&state.scene.activeId===null,'a fresh Host discovers presets without loading any scene');
  check(state.plugins.every(p=>p.state==='disabled'),'preset discovery starts no audio or media provider');
  const available=await request('/api/presets');
  check(available.some(p=>p.id==='latenite'&&p.available&&p.sceneCount===3),'the personal three-scene preset is discoverable');
  check(available.some(p=>p.id==='invalid'&&!p.available)&&available.some(p=>p.id==='traversal'&&!p.available),'unsupported SDK versions and escaping preset paths are rejected independently');
  check((await fetch(output+'/api/presets/activate',{method:'POST',headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},body:'{"id":"minimal"}'})).status===404,'OBS output cannot install or activate presets');
  const defaults=await readFile(path.join(catalog,'minimal/defaults.json'),'utf8');
  await request('/api/presets/activate','POST',{id:'minimal'}); state=await request('/api/state');
  check(state.scenes.length===2&&state.scene.activeId==='minimal__live','applying a preset registers its prebuilt scenes automatically');
  await request('/api/presets/minimal/settings','PUT',{title:'My title'});
  await request('/api/presets/activate','POST',{id:'alternate'});
  check((await request('/api/presets/alternate/settings')).title!=='My title'&&(await request('/api/state')).scene.activeId==='alternate__live','identical local scene IDs remain isolated between presets');
  await request('/api/presets/activate','POST',{id:'minimal'});
  check((await request('/api/presets/minimal/settings')).title==='My title'&&(await readFile(path.join(catalog,'minimal/defaults.json'),'utf8'))===defaults,'user overrides survive preset switching without rewriting author defaults');
  await request('/api/actions/away','POST',{enabled:true}); state=await request('/api/state');
  check(state.scene.activeId==='minimal__away'&&state.scene.selectedId==='minimal__live','preset away mode preserves the selected normal scene');
  await request('/api/actions/away','POST',{enabled:false});
  const events=subscriber(output.replace('http:','ws:')+'/ws/events');streams.push(events.socket);
  await events.next(value=>value.type==='state');
  await request('/api/presets/activate','POST',{id:'latenite'}); state=await request('/api/state');
  check(state.plugins.filter(p=>['desktop-audio','system-media'].includes(p.id)).every(p=>p.state==='running'),'explicitly applying LATENITE starts its external capability dependencies');
  const audio=await events.next(value=>value.topic==='plugin.desktop-audio.status'&&value.data.audio.state==='live');
  check(audio.data.audio.sampleRate===48000,'the audio plugin publishes live 48 kHz status');
  const binary=subscriber(output.replace('http:','ws:')+'/ws/plugins/desktop-audio/frames');streams.push(binary.socket);
  const frame=await binary.next(value=>value instanceof ArrayBuffer);
  check(new DataView(frame).getUint32(0,true)===0x41495553&&frame.byteLength>8192,'the external audio plugin delivers FFT and waveform frames');
  await request('/api/actions/scene','POST',{id:'latenite__fullscreen'}); state=await request('/api/state');
  check(state.scene.activeId==='latenite__fullscreen'&&state.scenes.every(s=>s.runtimeGroup==='latenite__overlay'),'the personal views share a stable runtime group');
  const before=await request('/api/presets/latenite/settings');
  await request('/api/presets/latenite/settings','PUT',{away:{text1:'My away text'}});
  const after=await request('/api/presets/latenite/settings');
  check(after.away.text1==='My away text'&&after.away.text2===before.away.text2&&after.titles.english[0]===before.titles.english[0],'partial user parameters merge with preset defaults');
  await stop(); await start(); state=await request('/api/state');
  check(state.preset.id==='latenite'&&state.scene.activeId==='latenite__fullscreen'&&(await request('/api/presets/latenite/settings')).away.text1==='My away text','restart restores the chosen preset, view and independent parameters');
  await request('/api/presets/activate','POST',{id:null}); state=await request('/api/state');
  check(state.preset===null&&state.scenes.length===0&&state.plugins.every(p=>p.state==='disabled'),'deactivating the preset unloads scenes and stops its automatic plugins');
  await request('/api/presets/reload','POST');
  check((await request('/api/state')).preset===null,'refreshing the preset catalog cannot activate content');
  await writeFile(path.join(directory,'passed.json'),JSON.stringify({checks},null,2));
  await writeFile(path.resolve('.local/preset-integration-report.json'),JSON.stringify({checks},null,2));
  console.log(JSON.stringify({passed:checks,directory},null,2));
} finally { for(const stream of streams)stream.close(); await stop(); }
