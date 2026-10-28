import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

test('the portable personal preset adapts Core data while preserving layout, chat and away state', async () => {
  const defaults=JSON.parse(await readFile(new URL('../presets/latenite/defaults.json',import.meta.url),'utf8'));
  const fixture={context:{presetId:'latenite',sceneId:'latenite__ultrawide'},visuals:defaults,client:null};
  class Client {
    handlers=new Map();
    onState(callback){this.stateCallback=callback;}
    on(topic,callback){const values=this.handlers.get(topic)||[];values.push(callback);this.handlers.set(topic,values);return()=>{};}
    emit(topic,value){for(const callback of this.handlers.get(topic)||[])callback(value);}
    settings(){return{read:async()=>structuredClone(fixture.visuals)};}
    start(){this.emit('connection',true);}
    stop(){this.stopped=true;}
  }
  const previousFixture=globalThis.__corePresetTest, previousLocation=globalThis.location;
  globalThis.__corePresetTest=fixture;globalThis.location={origin:'http://127.0.0.1:5280',protocol:'http:'};
  const sdk=`export const createClient=()=>globalThis.__corePresetTest.make();export const getSceneContext=()=>globalThis.__corePresetTest.context;export const request=()=>Promise.resolve();`;
  fixture.make=()=>fixture.client=new Client();
  const sdkUrl='data:text/javascript;base64,'+Buffer.from(sdk).toString('base64');
  const source=(await readFile(new URL('../preset-sources/latenite/src/host-client.ts',import.meta.url),'utf8')).replace("const sdkUrl = '/sdk/streamui.js';",'const sdkUrl = '+JSON.stringify(sdkUrl)+';');
  const javascript=stripTypeScriptTypes(source,{mode:'transform'});
  try {
    const {host,socketUrl}=await import('data:text/javascript;base64,'+Buffer.from(javascript).toString('base64'));
    const state={scenes:[{id:'latenite__ultrawide',view:'21:9'},{id:'latenite__fullscreen',view:'16:9'},{id:'latenite__away',view:'away'}],
      scene:{selectedId:'latenite__ultrawide',activeId:'latenite__ultrawide',away:false},
      obs:{state:'disabled',scene:null,error:null,transition:null},chat:{state:'connected',error:null,localBridge:false,events:0,lastEventAt:null},
      plugins:[{id:'desktop-audio',enabled:true}],outputUrl:'http://127.0.0.1:5280/',configUrl:'http://127.0.0.1:5281/',startup:false};
    host.start();fixture.client.stateCallback(state);await new Promise(setImmediate);
    assert.equal(host.state.config.layoutMode,'21:9');assert.deepEqual(host.state.config.layout,defaults.layoutProfiles['21:9']);
    assert.deepEqual(host.state.config.titles,defaults.titles);
    const chats=[];host.addEventListener('chat',event=>chats.push(event.detail));
    const message={id:'bilibili:message:one',kind:'message',platform:'bilibili',timestamp:1700000000000,user:{id:'42',name:'观众',level:12,medalName:'测试牌',medalLevel:3},text:'一条消息',gift:null,payment:null};
    fixture.client.emit('chat.message',message);
    assert.equal(chats[0].username,'观众');assert.equal(chats[0].timestampNormalized,message.timestamp);assert.equal(chats[0].userLvl,12);
    state.scene.selectedId=state.scene.activeId='latenite__fullscreen';fixture.context.sceneId='latenite__fullscreen';
    fixture.client.stateCallback(state);fixture.client.emit('scene.enter',{sceneId:fixture.context.sceneId});
    assert.equal(host.state.config.layoutMode,'16:9');assert.deepEqual(host.state.config.layout,defaults.layoutProfiles['16:9']);
    fixture.client.emit('chat.message',{...message,id:'two',text:'切换后继续'});assert.equal(chats.length,2);
    state.scene.away=true;state.scene.activeId='latenite__away';fixture.context.sceneId='latenite__away';fixture.client.stateCallback(state);
    assert.equal(host.state.config.layoutMode,'16:9');assert.equal(host.state.config.away.enabled,true);
    fixture.visuals={...fixture.visuals,titles:{english:['New title'],chinese:['新标题']}};
    fixture.client.emit('preset.settingsChanged',{id:'latenite'});await new Promise(setImmediate);
    assert.equal(host.state.config.titles.english[0],'New title');assert.equal(host.state.config.layoutMode,'16:9');
    const audio={state:'live',error:null,deviceId:'default',sampleRate:48000,channels:2,deviceSampleRate:48000,frameRate:60};
    fixture.client.emit('plugin.desktop-audio.status',{audio});assert.deepEqual(host.state.audio,audio);
    fixture.client.emit('plugin.system-media.track',{title:'Track',artist:'Artist',playing:true,state:'playing'});assert.equal(host.state.nowPlaying.title,'Track');
    assert.equal(socketUrl('/ws/audio'),'ws://127.0.0.1:5280/ws/plugins/desktop-audio/frames');
    host.stop();assert.equal(fixture.client.stopped,true);
  } finally { globalThis.__corePresetTest=previousFixture;globalThis.location=previousLocation; }
});
