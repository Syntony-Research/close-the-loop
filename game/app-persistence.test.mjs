import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as engine from './dist/engine.js';
import {readSavedState} from './dist/saved-state.mjs';

// Run the actual application handlers with small DOM/auth adapters. Storage
// failure and auth expiry can therefore exercise the save-to-redirect boundary.
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function application({stored=null,failWrites=false}={}){
  const elements=new Map();
  function element(selector){
    if(!elements.has(selector)){
      const node=new EventTarget();
      Object.assign(node,{innerHTML:'',textContent:'',open:false,style:{},classList:{toggle(){}},
        setAttribute(){},removeAttribute(){},querySelector(){return null;},getContext(){return null;},
        showModal(){this.open=true;},close(){this.open=false;}});
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
  const auth={canPractice:true,subscribe(listener){this.listener=listener;listener({authenticated:false});},init(){}};
  const context=vm.createContext({...engine,readSavedState,document,localStorage:storage,arenaAuth:auth,
    mountAuthPanel(){},renderSyntony(){return '';},renderMissionContext(){return '';},
    renderRealWorldDebrief(){return '';},renderPracticeNote(){return '';},renderAssuranceQuestion(){return '';},
    console,setTimeout,clearTimeout,window:{scrollTo(){},scrollY:0}});
  vm.runInContext(source,context,{filename:'app.js'});
  return {storage,auth,element,read:code=>vm.runInContext(code,context),signIn(){
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


test('BLACKLINE authored prompt editor keeps deterministic simulation and has no model calls',()=>{
  const app=application();
  for(const campaign of ['atlas','prism']){
    app.read('run=createRun("'+campaign+'");attackDraft=CAMPAIGNS[run.campaignId].levels[0].attacks[0].id;attackDraftText=CAMPAIGNS[run.campaignId].levels[0].attacks[0].payload');
    const html=app.read('attackWorkbench()');
    assert.match(html,/id="attack-payload"/);
    assert.match(html,/RED-TEAM WORKBENCH/);
    assert.match(html,/SIMULATION/);
    assert.match(html,/never sent to an AI/i);
    assert.doesNotMatch(html,/OpenAI|not connected|probe with/i);
  }
  assert.equal(app.read('typeof runModelProbe'),'undefined');
  assert.equal(app.read('typeof refreshProbeAvailability'),'undefined');
  assert.equal(app.read('typeof probePanel'),'undefined');
  assert.equal(app.element('#modal').open,false);
});

test('campaign resume restores its own in-tab draft and authored evidence',async()=>{
  const app=application();
  await app.read('start("atlas")');
  app.read('attackDraft=CAMPAIGNS.atlas.levels[0].attacks[0].id;attackDraftText="Atlas fictional note with claimed authorization";run=evaluateAttack(run,attackDraft);appendAttackEvidence({campaignId:"atlas",payload:attackDraftText});persist()');
  await app.read('start("prism")');
  app.read('attackDraft=CAMPAIGNS.prism.levels[0].attacks[0].id;attackDraftText="Prism fictional note with different authority";appendAttackEvidence({campaignId:"prism",payload:attackDraftText});persist();resume("atlas")');
  assert.equal(app.read('run.phase'),'govern');
  assert.equal(app.read('attackDraftText'),'Atlas fictional note with claimed authorization');
  assert.equal(app.read('workbench.journal.length'),1);assert.equal(app.read('workbench.journal[0].campaignId'),'atlas');
  app.read('resume("prism")');
  assert.equal(app.read('attackDraftText'),'Prism fictional note with different authority');
  assert.equal(app.read('workbench.journal.length'),1);assert.equal(app.read('workbench.journal[0].campaignId'),'prism');
  assert.match(app.read('attackWorkbench()'),/Export before reloading or signing in/);
});

test('starting a new run clears only that campaign’s in-tab authored evidence',async()=>{
  const app=application();
  await app.read('start("atlas")');app.read('appendAttackEvidence({campaignId:"atlas"});persist()');
  await app.read('start("prism")');app.read('appendAttackEvidence({campaignId:"prism"});persist()');
  await app.read('start("atlas")');
  assert.equal(app.read('workbench.journal.length'),0);assert.equal(app.read('attackDraftText'),'');
  app.read('resume("prism")');
  assert.equal(app.read('workbench.journal.length'),1);assert.equal(app.read('workbench.journal[0].campaignId'),'prism');
});

test('authored evidence retains only the latest 200 entries',()=>{
  const app=application();
  app.read('for(let i=0;i<1000;i++)appendAttackEvidence({index:i,payload:"x".repeat(1200)})');
  assert.equal(app.read('workbench.journal.length'),200);
  assert.equal(app.read('workbench.journal[0].index'),800);
  assert.equal(app.read('workbench.journal.at(-1).index'),999);
});
