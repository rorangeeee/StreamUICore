import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { websocketServer, subscriber } from './ws-fixture.mjs';
const [outputUrl,configUrl,directory]=process.argv.slice(2);
if(!outputUrl||!configUrl||!directory)throw Error('Expected output URL, config URL and isolated user directory.');
const passed=[];const check=(value,name)=>{assert.ok(value,name);passed.push(name);};
async function request(route,method='GET',body){const response=await fetch(new URL(route,configUrl),{method,headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,route+': '+response.status+' '+(!response.ok?await response.text():''));return response.headers.get('content-type')?.includes('application/json')?response.json():null;}
async function until(predicate){const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,80));}throw Error('Condition timed out.');}
const hash=value=>createHash('sha256').update(value).digest('base64');
let currentObs='Game',authenticated=false,pong=false,bridgeAuth=false;
const obs=await websocketServer({
 opened(socket,_,send){send(socket,{op:0,d:{rpcVersion:1,authentication:{salt:'salt',challenge:'challenge'}}});},
 message(value,socket,_,send){
 if(value.op===1){authenticated=value.d.authentication===hash(hash('test-password'+'salt')+'challenge');send(socket,{op:2,d:{negotiatedRpcVersion:1}});}
 if(value.op===6)send(socket,{op:7,d:{requestId:value.d.requestId,requestStatus:{result:true,code:100},responseData:{currentProgramSceneName:currentObs}}});
 }
});
const bridge=await websocketServer({
 opened(socket,request,send){bridgeAuth=new URL(request.url,'http://localhost').searchParams.get('token')==='test-token';send(socket,{type:'ping',timestamp:123});},
 message(value){if(value.type==='pong')pong=true;}
});
const streams=[];
try{
 await until(async()=>{try{return(await fetch(new URL('/api/state',configUrl))).ok;}catch{return false;}});
 const config=await request('/api/settings');
 const initial=await request('/api/state');
 check(initial.scenes.length===3&&!('audio'in initial)&&!('nowPlaying'in initial),'core loads prebuilt scenes without audio or media capabilities');
 check(!('scenes'in config)&&!('selectedSceneId'in config)&&!('away'in config),'broadcaster settings expose no scene authoring fields');
 const fixedScenes=initial.scenes;
 const initialFiles=await readFile(path.join(directory,'core-settings.json'),'utf8');
 const create=await fetch(new URL('/api/scenes',configUrl),{method:'POST',headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},body:JSON.stringify({name:'Forbidden scene'})});
 check(create.status===404,'the scene creation endpoint is removed');
 const remove=await fetch(new URL('/api/scenes/rehearsal',configUrl),{method:'DELETE',headers:{'X-StreamUI-Request':'1'}});
 check(remove.status===404,'the configuration API cannot delete prebuilt scenes');
 for(const fields of [{scenes:[]},{selectedSceneId:'rehearsal'},{activePresetId:'latenite'},{away:{enabled:true,sceneId:'rehearsal'}}]){
   const response=await fetch(new URL('/api/settings',configUrl),{method:'PUT',headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},body:JSON.stringify({...config,...fields})});
   check(response.status===400,'broadcaster writes reject structural field '+Object.keys(fields)[0]);
 }
 check((await readFile(path.join(directory,'core-settings.json'),'utf8'))===initialFiles,'rejected scene authoring leaves the preset unchanged');
 check((await fetch(new URL('/api/settings',outputUrl))).status===404,'private settings are not exposed to OBS pages');
 check((await fetch(new URL('/api/settings',configUrl),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(config)})).status===403,'writes require the application header');
 check((await fetch(new URL('/api/state',outputUrl),{headers:{Origin:'https://example.com'}})).status===403,'foreign origins are rejected');
 const events=subscriber(new URL('/ws/events',outputUrl).href.replace('http:','ws:'));streams.push(events.socket);
 const snapshot=await events.next(value=>value.type==='state');
 check(snapshot.data.scene.activeId==='live','new subscribers receive the current scene snapshot');
 await request('/api/scenes/live/settings','PUT',{title:'User title',custom:{count:7}});
 check((await request('/api/scenes/live/settings')).custom.count===7,'scene settings preserve arbitrary user fields');
 const sceneFile=path.join(directory,'scenes/live/index.html');
 const originalFile=await readFile(sceneFile,'utf8');
 await request('/api/settings','PUT',{...config,obs:{enabled:true,url:obs.url,password:'test-password'},laplace:{enabled:true,url:bridge.url,token:'test-token',startLocalBridge:false}});
 await until(async()=>{const s=await request('/api/state');return s.obs.state==='connected'&&s.chat.state==='connected'&&authenticated&&bridgeAuth&&pong;});
 check(true,'OBS authenticates and the chat bridge answers heartbeats');
 const publicState=JSON.stringify(await request('/api/state'));
 check(!publicState.includes('test-password')&&!publicState.includes('test-token'),'public snapshots exclude connection credentials');
 currentObs='Break';for(const socket of obs.clients)obs.send(socket,{op:5,d:{eventType:'CurrentProgramSceneChanged',eventData:{sceneName:'Break'}}});
 await until(async()=>(await request('/api/state')).scene.activeId==='away');
 check(true,'OBS program scene changes select the matching arbitrary slot');
 currentObs='Game';for(const socket of obs.clients)obs.send(socket,{op:5,d:{eventType:'CurrentProgramSceneChanged',eventData:{sceneName:'Game'}}});
 await until(async()=>(await request('/api/state')).scene.activeId==='live');
 await request('/api/actions/away','POST',{enabled:true});
 let state=await request('/api/state');check(state.scene.activeId==='away'&&state.scene.selectedId==='live','away mode overlays the selected scene without losing it');
 await request('/api/settings','PUT',await request('/api/settings'));
 check((await request('/api/state')).scene.away,'saving broadcaster settings preserves independent away state');
 await request('/api/actions/away','POST',{enabled:false});
 check((await request('/api/state')).scene.activeId==='live','return restores the selected scene');
 const chat={type:'message',origin:'test',id:'message-one',uid:1,username:'测试',message:'Hello',timestampNormalized:1700000000000,userLvl:9};
 for(const socket of bridge.clients)bridge.send(socket,chat);
 const relayed=await events.next(value=>value.topic==='chat.message');
 check(relayed.data.user.name==='测试'&&relayed.data.text==='Hello'&&relayed.data.timestamp===1700000000000,'chat events use the public structured protocol');
 const rehearsal=initial.scenes.find(scene=>scene.id==='rehearsal');
 check((await fetch(new URL('/user/'+rehearsal.entry,outputUrl))).ok&&(await fetch(new URL('/user/'+rehearsal.settingsPage,configUrl))).ok,'prebuilt scenes serve their content and parameter panels');
 await request('/api/scenes/rehearsal/settings','PUT',{title:'独立场景标题',custom:{preserved:true}});
 check((await request('/api/scenes/rehearsal/settings')).title==='独立场景标题'&&(await request('/api/scenes/live/settings')).title==='User title','scene parameters remain editable and isolated without authoring a slot');
 check((await readFile(sceneFile,'utf8'))===originalFile,'slot and connection changes never overwrite user scene files');
 const pluginDirectory=path.join(directory,'plugins/uptime');await mkdir(pluginDirectory,{recursive:true});
 await cp(path.resolve('examples/plugins/uptime/bin/Release/net10.0'),pluginDirectory,{recursive:true});
 for(const name of ['plugin.json','settings.html'])await cp(path.resolve('examples/plugins/uptime',name),path.join(pluginDirectory,name));
 await request('/api/plugins/reload','POST');
 const withPlugin=await request('/api/settings');await request('/api/settings','PUT',{...withPlugin,enabledPlugins:['uptime']});
 await until(async()=>(await request('/api/state')).plugins.some(p=>p.id==='uptime'&&p.state==='running'));
 const tick=await events.next(value=>value.topic==='plugin.uptime.tick');
 check(tick.data.uptimeMs>0,'an external native capability plugin loads and publishes events');
 const binary=subscriber(new URL('/ws/plugins/uptime/raw',outputUrl).href.replace('http:','ws:'));streams.push(binary.socket);
 check((await binary.next(value=>value instanceof ArrayBuffer)).byteLength===8,'plugins publish binary data without a core-specific protocol');
 await request('/api/plugins/uptime/settings','PUT',{interval:120});
 check((await request('/api/plugins/uptime/settings')).interval===120,'plugin configuration is isolated and restarts the provider');
 await request('/api/settings','PUT',{...await request('/api/settings'),enabledPlugins:[]});
 check((await request('/api/state')).plugins.find(p=>p.id==='uptime').state==='disabled','disabling a capability releases its lifecycle');
 check((await request('/api/scenes/live/settings')).title==='User title','plugin changes preserve scene configuration');
 check(JSON.stringify((await request('/api/state')).scenes)===JSON.stringify(fixedScenes),'all runtime actions preserve the prebuilt scene manifest');
 await writeFile(path.join(directory,'integration-passed.json'),JSON.stringify({passed},null,2));
 console.log(JSON.stringify({passed},null,2));
}finally{for(const socket of streams)socket.close();obs.close();bridge.close();}
