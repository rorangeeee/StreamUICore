import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {subscriber} from './ws-fixture.mjs';
const [outputUrl,configUrl,directory]=process.argv.slice(2);
const passed=[],streams=[];
const check=(value,name)=>{assert.ok(value,name);passed.push(name);};
async function request(route,method='GET',body,base=configUrl){
 const response=await fetch(new URL(route,base),{method,headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.ok(response.ok,route+': '+response.status+' '+(!response.ok?await response.text():''));
 return response.headers.get('content-type')?.includes('application/json')?response.json():null;
}
async function until(predicate){const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,60));}throw Error('Condition timed out');}
try {
 await until(async()=>{try{return(await fetch(new URL('/api/state',configUrl))).ok;}catch{return false;}});
 const initial=await request('/api/state'),preferences=await request('/api/settings');
 check(initial.apiVersion===2&&!('obs'in initial)&&!('chat'in initial)&&!('away'in initial.scene),'Core exposes generic scene and plugin state only');
 check(Object.keys(preferences).join()==='enabledPlugins','Core preferences contain no integration settings');
 for(const route of ['/api/actions/away','/api/obs/reconnect','/api/chat/reconnect'])check((await fetch(new URL(route,configUrl),{method:'POST',headers:{'X-StreamUI-Request':'1','Content-Type':'application/json'},body:'{}'})).status===404,'removed integration endpoint '+route);
 for(const value of [{scenes:[]},{obs:{}},{laplace:{}},{away:{enabled:true}}]){
  const response=await fetch(new URL('/api/settings',configUrl),{method:'PATCH',headers:{'Content-Type':'application/json','X-StreamUI-Request':'1'},body:JSON.stringify(value)});
  check(response.status===400,'Core rejects extension-owned preference '+Object.keys(value)[0]);
 }
 check((await fetch(new URL('/api/settings',outputUrl))).status===404,'private settings stay on the configuration port');
 check((await fetch(new URL('/api/state',outputUrl),{headers:{Origin:'https://example.com'}})).status===403,'foreign origins cannot access the host');
 const live=subscriber(new URL('/ws/events',outputUrl).href.replace('http:','ws:'));streams.push(live.socket);
 check((await live.next(value=>value.type==='state')).data.scene.activeId==='live','output subscribers receive the active output scene');
 const first=await request('/api/previews','POST'),second=await request('/api/previews','POST');
 const before=await readFile(path.join(directory,'core-settings.json'),'utf8'),revision=(await request('/api/state')).scene.revision;
 const preview=subscriber(new URL('/ws/events?preview='+first.id,outputUrl).href.replace('http:','ws:'));streams.push(preview.socket);
 check((await preview.next(value=>value.type==='state')).data.preview,'preview subscribers receive their own scope');
 let selected=await request('/api/actions/scene?preview='+first.id,'POST',{id:'rehearsal'});
 check(selected.scene.activeId==='rehearsal'&&selected.scene.playback.animate,'preview scene selection starts its own transition');
 check((await request('/api/state')).scene.activeId==='live'&&(await request('/api/state')).scene.revision===revision,'preview selection never changes the output or its animation clock');
 check((await request('/api/state?preview='+second.id)).scene.activeId==='live','independent previews do not follow each other');
 check((await readFile(path.join(directory,'core-settings.json'),'utf8'))===before,'preview actions never write output preferences');
 const cue=selected.scene.playback.id;
 selected=await request('/api/actions/scene?preview='+first.id,'POST',{id:'rehearsal'});
 check(selected.scene.playback.id!==cue,'the same preview scene can replay its transition');
 const event={id:'second',cue:'external-event',startedAt:Date.now(),animate:true};
 selected=await request('/api/actions/scene','POST',event);
 const applied=selected.scene.revision;
 check(selected.scene.activeId==='second'&&selected.scene.playback.id===event.cue,'scene components can activate an output scene with an animation cue');
 check((await request('/api/actions/scene','POST',event)).scene.revision===applied,'multiple output pages deduplicate the same capability event');
 check((await request('/api/state?preview='+first.id)).scene.activeId==='rehearsal','actual output changes do not move an open preview');
 await request('/api/scenes/live/settings','PATCH',{title:'Personal title',custom:{retained:true}});
 let parameters=await request('/api/scenes/live/settings');
 check(parameters.layout.x===.85&&parameters.title==='Personal title','scene parameters merge author defaults with personal fields');
 const overrides=JSON.parse(await readFile(path.join(directory,'scene-settings/live.json'),'utf8'));
 check(!('layout'in overrides),'saving a scene title does not freeze its default layout');
 await writeFile(path.join(directory,'scenes/live/defaults.json'),JSON.stringify({title:'Author title',layout:{x:.7}}));
 parameters=await request('/api/scenes/live/settings');
 check(parameters.layout.x===.7&&parameters.title==='Personal title','author scene updates remain effective after parameter edits');
 await request('/api/scenes/live/settings','PATCH',{custom:{next:true}});
 check((await request('/api/scenes/live/settings')).custom.retained,'field saves preserve unrelated scene customization');
 const storage=await request('/api/storage'),pluginDirectory=path.join(storage.plugins,'uptime');
 await mkdir(pluginDirectory,{recursive:true});
 await cp(path.resolve('tests/fixtures/uptime/bin/Release/net10.0'),pluginDirectory,{recursive:true});
 for(const name of ['plugin.json','settings.html'])await cp(path.resolve('tests/fixtures/uptime',name),path.join(pluginDirectory,name));
 await writeFile(path.join(directory,'core-settings.v1.json'),JSON.stringify({legacyProbe:{interval:321,privateKey:'legacy-private'}}));
 const manifest=JSON.parse(await readFile(path.join(pluginDirectory,'plugin.json'),'utf8'));manifest.legacySettingsKey='legacyProbe';await writeFile(path.join(pluginDirectory,'plugin.json'),JSON.stringify(manifest));
 await request('/api/plugins/reload','POST');await request('/api/settings','PATCH',{enabledPlugins:['uptime']});
 check((await request('/api/plugins/uptime/settings')).interval===321,'plugins can import their own legacy settings without Core knowing the integration');
 const tick=await live.next(value=>value.topic==='plugin.uptime.tick');
 check(tick.data.uptimeMs>0,'generic native capabilities publish namespaced events');
 const cached=(await request('/api/state')).plugins.find(plugin=>plugin.id==='uptime');
 check(cached.topics.tick.uptimeMs>0,'new pages can read the latest capability snapshot');
 const binary=subscriber(new URL('/ws/plugins/uptime/raw',outputUrl).href.replace('http:','ws:'));streams.push(binary.socket);
 check((await binary.next(value=>value instanceof ArrayBuffer)).byteLength===8,'binary capability data is independent of scene scope');
 await request('/api/plugins/uptime/settings','PATCH',{interval:120,privateKey:'probe-secret'});
 check(!JSON.stringify(await request('/api/state')).includes('probe-secret'),'published plugin state excludes private configuration');
 await request('/api/settings','PATCH',{enabledPlugins:[]});
 check((await request('/api/state')).plugins.find(plugin=>plugin.id==='uptime').state==='disabled','disabling a plugin releases its lifecycle');
 await request('/api/previews/'+first.id,'DELETE');
 check((await fetch(new URL('/api/state?preview='+first.id,configUrl))).status===404,'closing a preview releases its state');
 await request('/api/previews/'+second.id,'DELETE');
 await request('/api/actions/scene','POST',{id:'live',animate:false});
 await writeFile(path.join(directory,'integration-passed.json'),JSON.stringify({passed},null,2));console.log(JSON.stringify({passed},null,2));
} finally {for(const socket of streams)socket.close();}
