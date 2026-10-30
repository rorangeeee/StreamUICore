import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const executable=path.resolve(process.argv[2]||'.local/host/StreamUI.Core.exe'),directory=path.resolve('.local/preset-test-'+randomUUID()),catalog=path.join(directory,'catalog');
await mkdir(catalog,{recursive:true});
const scenes=[{id:'wide',name:'Wide',entry:'scene.html',width:1920,height:1080,view:'wide',runtimeGroup:'overlay'},{id:'full',name:'Full',entry:'scene.html',width:1920,height:1080,view:'full',runtimeGroup:'overlay'},{id:'away',name:'Overlay',entry:'scene.html',width:1920,height:1080,role:'overlay',runtimeGroup:'overlay'}];
for(const id of ['demo','alternate','invalid','escaping','needs-plugin']){
 const root=path.join(catalog,id);await mkdir(root,{recursive:true});
 await writeFile(path.join(root,'scene.html'),'<!doctype html><body>Test scene</body>');
 await writeFile(path.join(root,'settings.html'),'<!doctype html><body>Test parameters</body>');
 await writeFile(path.join(root,'defaults.json'),JSON.stringify({title:'Author default',nested:{first:1,second:2},layout:{chatX:0.85}}));
 await writeFile(path.join(root,'preset.json'),JSON.stringify({formatVersion:1,sdkVersion:id==='invalid'?999:2,id,name:id,version:'1.0.0',description:'Synthetic test fixture',scenes,defaultScene:'wide',settingsPage:'settings.html',defaults:id==='escaping'?'../private.json':'defaults.json',plugins:id==='needs-plugin'?[{id:'missing-provider',minimumVersion:'1.0.0',required:true}]:[]}));
}
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
const outputPort=await freePort();let configPort=await freePort();while(configPort===outputPort)configPort=await freePort();
const base='http://127.0.0.1:'+configPort,output='http://127.0.0.1:'+outputPort,checks=[];let instance;
const check=(condition,name)=>{assert.ok(condition,name);checks.push(name);};
async function request(route,method='GET',body){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,route+': '+response.status+' '+(!response.ok?await response.text():''));return response.headers.get('content-type')?.includes('application/json')?response.json():null;}
async function start(){instance=spawn(executable,['--headless','--no-open','--obs-port',String(outputPort),'--config-port',String(configPort),'--data-dir',directory,'--presets-dir',catalog,'--plugins-dir',path.join(directory,'empty-providers')],{windowsHide:true,stdio:'ignore'});for(let i=0;i<100;i++){try{if((await fetch(base+'/api/state')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Host startup timeout.');}
async function stop(){if(!instance||instance.exitCode!==null)return;const exited=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Host exit timeout.')),12000);instance.once('exit',()=>{clearTimeout(timer);resolve();});});await request('/api/shutdown','POST');await exited;}
try{
 await start();let state=await request('/api/state');
 check(state.preset===null&&state.scenes.length===0,'fresh Host never automatically loads discovered presets');
 check(state.plugins.length===0,'generic Core tests require no installed capability plugin');
 const available=await request('/api/presets');
 check(available.some(p=>p.id==='demo'&&p.available&&p.sceneCount===3),'external synthetic preset manifests are discovered');
 check(available.some(p=>p.id==='invalid'&&!p.available)&&available.some(p=>p.id==='escaping'&&!p.available),'invalid SDK and escaping resource paths are rejected separately');
 check((await fetch(output+'/api/presets/activate',{method:'POST',headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},body:'{"id":"demo"}'})).status===404,'output port cannot activate presets');
 await request('/api/presets/activate','POST',{id:'demo'});state=await request('/api/state');
 check(state.scenes.length===3&&state.scene.activeId==='demo__wide','explicit activation registers the manifest scenes');
 await request('/api/presets/demo/settings','PUT',{title:'Personal title',nested:{first:9}});
 const values=await request('/api/presets/demo/settings');
 check(values.nested.first===9&&values.nested.second===2,'user parameter overrides merge with author defaults');
 check(JSON.parse(await readFile(path.join(catalog,'demo/defaults.json'),'utf8')).title==='Author default','saving user parameters never overwrites preset source');
 await request('/api/presets/demo/settings','PUT',{...values,title:'Personal title'});
 let overrides=JSON.parse(await readFile(path.join(directory,'preset-settings/demo.json'),'utf8'));
 check(!('second' in overrides.nested)&&!('layout' in overrides),'saving a merged snapshot does not freeze unchanged author defaults');
 await writeFile(path.join(catalog,'demo/defaults.json'),JSON.stringify({title:'Author default',nested:{first:1,second:8},layout:{chatX:0.7}}));
 let revised=await request('/api/presets/demo/settings');
 check(revised.nested.second===8&&revised.layout.chatX===0.7&&revised.title==='Personal title','author layout changes remain effective after the user saves a title');
 await request('/api/presets/demo/settings','PATCH',{custom:{retained:true},nested:{first:9}});
 await request('/api/presets/demo/settings','PATCH',{custom:{next:true}});
 revised=await request('/api/presets/demo/settings');
 check(revised.custom.retained&&revised.custom.next&&revised.title==='Personal title'&&revised.nested.second===8,'field patches preserve unrelated personal values and current author defaults');
 await request('/api/presets/demo/settings','PATCH',{nested:{first:1}});
 overrides=JSON.parse(await readFile(path.join(directory,'preset-settings/demo.json'),'utf8'));
 check(!('nested' in overrides),'returning a value to its author default removes its override');
 await request('/api/presets/activate','POST',{id:'alternate'});
 check((await request('/api/state')).scene.activeId==='alternate__wide'&&(await request('/api/presets/alternate/settings')).title==='Author default','scene and parameter namespaces are isolated between presets');
 await request('/api/presets/activate','POST',{id:'demo'});
 check((await request('/api/presets/demo/settings')).title==='Personal title','parameters survive switching presets');
 const missing=await fetch(base+'/api/presets/activate',{method:'POST',headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},body:'{"id":"needs-plugin"}'});
 check(missing.status===400&&(await request('/api/state')).preset.id==='demo','missing dependencies cannot replace the working preset');
 await request('/api/actions/scene','POST',{id:'demo__full'});state=await request('/api/state');
 check(state.scene.activeId==='demo__full'&&state.scenes.every(s=>s.runtimeGroup==='demo__overlay'),'shared runtime metadata survives registration');
 const overlaySelection=await fetch(base+'/api/actions/scene',{method:'POST',headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},body:'{"id":"demo__away"}'});
 check(overlaySelection.status===400&&(await request('/api/state')).scene.activeId==='demo__full','overlay descriptors cannot replace the active main scene');
 const preview=await request('/api/previews','POST');
 const outputClock=(await request('/api/state')).scene.playback.id,previewClock=preview.state.scene.playback;
 await request('/api/presets/demo/settings','PATCH',{controls:{cover:true}});
 check((await request('/api/state')).scene.playback.id===outputClock&&(await request('/api/state?preview='+preview.id)).scene.playback===previewClock,'a shared preset control does not create a playback cue in output or preview');
 check((await request('/api/presets/demo/settings')).controls.cover,'shared preset controls are readable from every playback context');
 await stop();await start();state=await request('/api/state');
 check(state.preset.id==='demo'&&state.scene.activeId==='demo__full'&&(await request('/api/presets/demo/settings')).title==='Personal title','restart restores the explicit preset, scene and parameters');
 check((await request('/api/presets/demo/settings')).controls.cover,'a shared Host control survives restarting the Core');
 await stop();
 const legacyFile=path.join(directory,'core-settings.json'),legacySettings=JSON.parse(await readFile(legacyFile,'utf8'));
 legacySettings.selectedSceneId='demo__away';for(const scene of legacySettings.scenes)delete scene.role;
 await writeFile(legacyFile,JSON.stringify(legacySettings));await start();
 check((await request('/api/state')).scene.activeId==='demo__wide','a formerly selected overlay restores a valid main scene during upgrade');
 await request('/api/presets/activate','POST',{id:null});state=await request('/api/state');
 check(state.preset===null&&state.scenes.length===0,'deactivation clears the output');
 await request('/api/presets/reload','POST');check((await request('/api/state')).preset===null,'catalog refresh never activates a preset');
 await writeFile(path.resolve('.local/preset-integration-report.json'),JSON.stringify({checks},null,2));console.log(JSON.stringify({passed:checks},null,2));
}finally{await stop();}
