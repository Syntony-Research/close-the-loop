import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as engine from './dist/engine.js';
import {readSavedState} from './dist/saved-state.mjs';

// Run the actual application handlers with small DOM/auth adapters. Storage
// failure and auth expiry can therefore exercise the save-to-redirect boundary.
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function application({stored=null,failWrites=false,fetchImpl=()=>{throw new Error('Unexpected network request');}}={}){
  const elements=new Map();
  function element(selector){
    if(!elements.has(selector)){
      const node=new EventTarget();
      Object.assign(node,{innerHTML:'',textContent:'',open:false,style:{},classList:{toggle(){}},
        setAttribute(){},removeAttribute(){},querySelector(){return null;},getContext(){return null;},
        showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},focus(){},scrollIntoView(){}});
      elements.set(selector,node);
    }
    return elements.get(selector);
  }
  const document=new EventTarget();
  Object.assign(document,{querySelector:element,body:element('body')});
  const storage={value:stored,failWrites,getItem(){return this.value;},setItem(key,value){
    if(this.failWrites)throw new Error('QuotaExceededError');
    this.value=value;
  }};
  const auth={canPractice:true,authenticated:true,require(){return this.authenticated;},headers(){return {};},subscribe(listener){this.listener=listener;listener({authenticated:false});},init(){}};
  const context=vm.createContext({...engine,readSavedState,document,localStorage:storage,arenaAuth:auth,
    mountAuthPanel(){},renderSyntony(){return '';},renderMissionContext(){return '';},
    renderRealWorldDebrief(){return '';},renderPracticeNote(){return '';},renderAssuranceQuestion(){return '';},
    console,setTimeout,clearTimeout,URL,AbortController,ARENA_API_URL:'',fetch:fetchImpl,window:{scrollTo(){},scrollY:0}});
  vm.runInContext(source,context,{filename:'app.js'});
  return {storage,auth,element,read:code=>vm.runInContext(code,context),input(value){
    const event=new Event('input');Object.defineProperty(event,'target',{value:{id:'attack-payload',value}});document.dispatchEvent(event);
  },signIn(){
    const event=new Event('syntony:before-signin',{cancelable:true});
    return {allowed:document.dispatchEvent(event),event};
  }};
}

test('failed campaign persistence cancels sign-in and retains current progress in memory',()=>{
  const app=application({failWrites:true});
  const run=app.read('run=createRun("atlas")');
  app.element('#auth-dialog').open=true;
  const {allowed,event}=app.signIn();
  assert.equal(allowed,false);assert.equal(event.defaultPrevented,true);
  assert.equal(app.read('run'),run);assert.equal(app.read('saved.atlas.run'),run);
  assert.equal(app.read('storageWarning'),true);
  assert.equal(app.element('#auth-dialog').open,false);assert.equal(app.element('#modal').open,true);
  assert.match(app.element('#modal-content').innerHTML,/keep it open until saving works again/);
  assert.match(app.element('#announcer').textContent,/Sign-in is paused/);
});

test('auth expiry keeps both campaigns available in memory and blocks a lossy redirect',()=>{
  const app=application({failWrites:true});
  const atlas=app.read('saved.atlas={run:createRun("atlas"),modelId:"cipher"};saved.atlas.run');
  const prism=app.read('run=createRun("prism")');
  app.auth.canPractice=false;
  app.auth.listener({authenticated:false});
  assert.equal(app.read('run'),null);
  assert.equal(app.signIn().allowed,false);
  assert.equal(app.read('saved.atlas.run'),atlas);assert.equal(app.read('saved.prism.run'),prism);
  assert.match(app.element('#app').innerHTML,/Sign-in is paused/);
});

test('empty-state sign-in remains available when local saving is unavailable',()=>{
  const app=application({failWrites:true});
  assert.equal(app.signIn().allowed,true);
  assert.equal(app.element('#modal').open,false);
  assert.equal(app.read('saved.atlas'),undefined);assert.equal(app.read('saved.prism'),undefined);
});

test('successful retry saves retained progress, clears the warning, and allows sign-in',()=>{
  const app=application({failWrites:true});
  const run=app.read('run=createRun("atlas")');
  assert.equal(app.signIn().allowed,false);
  app.storage.failWrites=false;
  assert.equal(app.signIn().allowed,true);
  assert.equal(app.read('storageWarning'),false);assert.equal(app.read('saveNotice'),'');
  assert.deepEqual(JSON.parse(app.storage.value).atlas.run,run);
});


test('auth and local gameplay work without a configured live-model endpoint',()=>{
  const app=application();
  app.read('run=createRun("atlas");attackDraft=CAMPAIGNS.atlas.levels[0].attacks[0].id;attackDraftText=CAMPAIGNS.atlas.levels[0].attacks[0].payload');
  const html=app.read('attackWorkbench()');
  assert.match(html,/id="attack-payload"/);
  assert.match(html,/red-team workbench/i);
  assert.match(html,/not yet connected/i);
  assert.equal(app.read('probeAvailable'),false);
  assert.equal(app.element('#modal').open,false);
});

function prepareProbe(app){
  app.read('ARENA_API_URL="https://arena.example/api";probeAvailable=true;run=createRun("atlas");attackDraft=CAMPAIGNS.atlas.levels[0].attacks[0].id;attackDraftText=CAMPAIGNS.atlas.levels[0].attacks[0].payload');
}
const response=result=>({ok:true,json:async()=>result});

test('optional probes require availability, sign-in, and the correct mission phase',async()=>{
  let requests=0;
  const app=application({fetchImpl:async()=>{requests++;return response({boundary:'held',agentResponse:'Fictional output'});}});
  prepareProbe(app);
  app.read('probeAvailable=false');
  await assert.rejects(app.read('runModelProbe("before")'),/not yet connected/);
  app.read('probeAvailable=true');app.auth.authenticated=false;
  await app.read('runModelProbe("before")');
  app.auth.authenticated=true;
  await assert.rejects(app.read('runModelProbe("after")'),/current mission phase/);
  assert.equal(requests,0);
});

test('pending probe records captured context after auth expiry without losing its response',async()=>{
  let resolve;
  const pending=new Promise(r=>{resolve=r;});
  const app=application({fetchImpl:()=>pending});
  prepareProbe(app);
  const task=app.read('runModelProbe("before")');
  app.auth.canPractice=false;app.auth.authenticated=false;app.auth.listener({authenticated:false});
  assert.equal(app.read('run'),null);
  resolve(response({boundary:'held',agentResponse:'The fictional request was held.'}));
  await task;
  assert.equal(app.read('busy'),false);assert.equal(app.read('run'),null);
  assert.equal(app.read('workbenches.atlas.journal.length'),1);
  assert.equal(app.read('workbenches.atlas.journal[0].campaignId'),'atlas');
  assert.equal(app.read('workbenches.atlas.journal[0].attempt'),1);
});

test('probe content is bounded and escaped and never changes mission gates or scores',async()=>{
  const markup='<img src=x onerror=alert(1)>';
  const app=application({fetchImpl:async()=>response({boundary:'crossed',agentResponse:markup.repeat(200),model:markup.repeat(20),toolIntent:markup.repeat(100),reason:markup.repeat(200)})});
  prepareProbe(app);
  const before=app.read('JSON.stringify(run)');
  await app.read('runModelProbe("before")');
  assert.equal(app.read('JSON.stringify(run)'),before);
  const entry=app.read('workbench.journal[0]');
  assert.equal(entry.agentResponse.length,1400);assert.equal(entry.model.length,100);
  assert.equal(entry.toolIntent.length,800);assert.equal(entry.reason.length,1400);
  const html=app.read('probePanel("before")');
  assert.equal(html.includes(markup),false);assert.match(html,/&lt;img/);
});

test('editing payload invalidates prior output and retries cannot display an earlier attempt',async()=>{
  const app=application({fetchImpl:async()=>response({boundary:'held',agentResponse:'Earlier attempt output'})});
  prepareProbe(app);
  await app.read('runModelProbe("before")');
  assert.match(app.read('probePanel("before")'),/Earlier attempt output/);
  app.read('run.attempt=2');
  assert.doesNotMatch(app.read('probePanel("before")'),/Earlier attempt output/);
  app.read('run.attempt=1');
  app.input('A changed fictional source note with different claimed authorization.');
  assert.equal(app.read('matchingProbe("before")'),null);
  assert.equal(app.element('.probe-result').removed,true);
});

test('in-tab campaign resume restores its own draft and evidence without cross-campaign exports',async()=>{
  const app=application();
  await app.read('start("atlas")');
  app.read('attackDraft=CAMPAIGNS.atlas.levels[0].attacks[0].id;attackDraftText="Atlas fictional source note with authorization claim";run=evaluateAttack(run,attackDraft);appendEvidence(workbench,{campaignId:"atlas",payload:attackDraftText});persist()');
  await app.read('start("prism")');
  app.read('appendEvidence(workbench,{campaignId:"prism",payload:"Prism evidence"});persist();resume("atlas")');
  assert.equal(app.read('run.phase'),'govern');
  assert.equal(app.read('attackDraftText'),'Atlas fictional source note with authorization claim');
  assert.equal(app.read('workbench.journal.length'),1);assert.equal(app.read('workbench.journal[0].campaignId'),'atlas');
  app.read('resume("prism")');
  assert.equal(app.read('workbench.journal.length'),1);assert.equal(app.read('workbench.journal[0].campaignId'),'prism');
});

test('workbench evidence retains only its latest 200 entries',()=>{
  const app=application();
  app.read('for(let i=0;i<1000;i++)appendEvidence(workbench,{index:i,payload:"x".repeat(1200)})');
  assert.equal(app.read('workbench.journal.length'),200);
  assert.equal(app.read('workbench.journal[0].index'),800);
  assert.equal(app.read('workbench.journal.at(-1).index'),999);
});
