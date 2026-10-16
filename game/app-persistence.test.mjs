import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as engine from './dist/engine.js';
import {readSavedState} from './dist/saved-state.mjs';
import {OPERATORS,getOperator} from './dist/operators.js';
import {renderOperatorDossier,renderOperatorConsole,renderOperatorResult} from './dist/operator-ui.js';
import {renderWorkbench} from './dist/workbench-ui.js';

// Run the actual application handlers with small DOM/auth adapters. Storage
// failure and auth expiry can therefore exercise the save-to-redirect boundary.
const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function application({stored=null,failWrites=false}={}){
  const elements=new Map();
  function element(selector){
    if(!elements.has(selector)){
      const node=new EventTarget();
      Object.assign(node,{innerHTML:'',textContent:'',open:false,style:{},classList:{toggle(){},add(){},remove(){}},
        setAttribute(){},removeAttribute(){},querySelector(){return null;},getContext(){return null;},
        focus(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;}});
      elements.set(selector,node);
    }
    return elements.get(selector);
  }
  const document=new EventTarget();
  Object.assign(document,{querySelector:element,body:element('body')});
  const listeners=new Map(),addListener=document.addEventListener.bind(document);
  document.addEventListener=(type,listener,options)=>{listeners.set(type,[...(listeners.get(type)||[]),listener]);addListener(type,listener,options);};
  const storage={value:stored,failWrites,getItem(){return this.value;},setItem(key,value){
    if(this.failWrites)throw new Error('QuotaExceededError');
    this.value=value;
  }};
  const auth={canPractice:true,require(){return this.canPractice;},subscribe(listener){this.listener=listener;listener({authenticated:false});},init(){}};
  const errors=[];
  const context=vm.createContext({...engine,OPERATORS,getOperator,renderWorkbench,renderOperatorDossier,renderOperatorConsole,renderOperatorResult,readSavedState,document,localStorage:storage,arenaAuth:auth,
    // App and ESM execute in different realms only in this harness. Transfer
    // plain options to the engine realm so its prototype checks stay meaningful.
    useOperatorAbility:(run,options)=>engine.useOperatorAbility(run,structuredClone(options)),
    mountAuthPanel(){},renderSyntony(){return '';},renderMissionContext(){return '';},
    renderRealWorldDebrief(){return '';},renderPracticeNote(){return '';},renderAssuranceQuestion(){return '';},
    console:{...console,error(error){errors.push(error);}},structuredClone,setTimeout,clearTimeout,CSS:{escape:value=>String(value)},window:{scrollTo(){},scrollY:0}});
  vm.runInContext(source,context,{filename:'app.js'});
  return {storage,auth,element,errors,read:code=>vm.runInContext(code,context),async click(action,data={}){
    const button={dataset:{action,...data}};
    for(const listener of listeners.get('click')||[])await listener({target:{closest:()=>button}});
  },input(id,value){
    for(const listener of listeners.get('input')||[])listener({target:{id,value}});
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


test('BLACKLINE authored prompt editor keeps deterministic simulation and has no model calls',()=>{
  const app=application();
  for(const campaign of ['atlas','prism']){
    app.read('run=createRun("'+campaign+'");attackDraft=CAMPAIGNS[run.campaignId].levels[0].attacks[0].id;attackDraftText=CAMPAIGNS[run.campaignId].levels[0].attacks[0].payload');
    const html=app.read('missionWorkbench()');
    assert.match(html,/id="attack-payload"/);
    assert.match(html,/RED-TEAM WORKBENCH/);
    assert.match(html,/SIMULATION/);
    assert.match(html,/not AI-graded or sent to an AI/i);
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
  assert.match(app.read('missionWorkbench()'),/Export before reloading or signing in/);
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

test('resuming a campaign uses its bound operator despite later roster selection or stale save wrapper',async()=>{
  const app=application();
  app.read('modelId="relay"');await app.read('start("atlas")');
  app.read('modelId="null"');await app.read('start("prism")');
  app.read('saved.atlas.modelId="glitch";modelId="root";resume("atlas")');
  assert.equal(app.read('run.operatorId'),'relay');assert.equal(app.read('modelId'),'relay');assert.equal(app.read('character().id'),'relay');
  assert.match(app.element('#app').innerHTML,/EXPRESS LANE/);
  app.read('resume("prism")');
  assert.equal(app.read('run.operatorId'),'null');assert.equal(app.read('character().id'),'null');
  assert.match(app.element('#app').innerHTML,/SANDBOX/);
});

test('tactical inputs reach the ability and persist its charge and report through reload',async()=>{
  const app=application();await app.read('start("atlas")');
  app.read('run=evaluateAttack(run,"l1-provenance");render()');
  await app.click('tactic-pick',{key:'edge',value:'action'});
  assert.equal(app.read('tacticDraft.edge'),'action');
  assert.match(app.element('#app').innerHTML,/data-key="edge" data-value="action" aria-pressed="true"/);
  await app.click('operator-ability');
  assert.equal(app.read('run.operatorAction.options.edge'),'action');
  assert.equal(app.read('run.operatorState.remaining'),2);
  assert.match(app.element('#announcer').textContent,/WIRECUT activated\. 2 tactical charges remain/);
  const restored=application({stored:app.storage.value});restored.read('resume("atlas")');
  assert.equal(restored.read('run.operatorState.remaining'),2);
  assert.equal(restored.read('run.operatorState.used'),true);
  assert.match(restored.element('#app').innerHTML,/TACTIC COMMITTED/);
  assert.doesNotMatch(restored.element('#app').innerHTML,/data-action="operator-ability"/);
});

test('Relay keeps both queue choices and Null previews the selected attack without consuming its authored draft',async()=>{
  const relay=application();relay.read('modelId="relay"');await relay.read('start("atlas")');
  relay.read('run=evaluateAttack(run,"l1-provenance")');
  await relay.click('tactic-pick',{key:'verified',value:'run'});
  await relay.click('tactic-pick',{key:'contested',value:'review'});
  await relay.click('operator-ability');
  assert.equal(relay.read('run.operatorAction.options.verified'),'run');
  assert.equal(relay.read('run.operatorAction.options.contested'),'review');
  assert.equal(relay.read('run.phase'),'govern');
  const sandbox=application();sandbox.read('modelId="null"');await sandbox.read('start("prism")');
  await sandbox.click('attack',{id:'l1-provenance'});
  sandbox.input('attack-payload','My fictional submission claims permission without the original authority.');
  const before=sandbox.read('JSON.stringify(run.metrics)');
  await sandbox.click('operator-ability');
  assert.equal(sandbox.read('run.operatorAction.options.attackId'),'l1-provenance');
  assert.equal(sandbox.read('run.phase'),'evaluate');assert.equal(sandbox.read('run.finding'),undefined);
  assert.equal(sandbox.read('JSON.stringify(run.metrics)'),before);
  assert.equal(sandbox.read('attackDraft'),'l1-provenance');
  assert.equal(sandbox.read('attackDraftText'),'My fictional submission claims permission without the original authority.');
});

test('Trace phase recovery clears stale drafts but retains authored evidence and spent charge',async()=>{
  const app=application();app.read('modelId="trace"');await app.read('start("atlas")');
  await app.click('attack',{id:'l1-noise'});await app.click('evaluate');
  app.read('controlDraft="l1-cosmetic"');await app.click('operator-ability');
  assert.equal(app.read('run.phase'),'evaluate');assert.equal(app.read('attackDraft'),null);
  assert.equal(app.read('attackDraftText'),'');assert.equal(app.read('controlDraft'),null);
  assert.equal(app.read('Object.keys(tacticDraft).length'),0);
  assert.equal(app.read('run.operatorState.remaining'),2);assert.equal(app.read('workbench.journal.length'),2);
  assert.equal(app.read('workbench.journal[1].type'),'operator-tactic-context');
  assert.equal(app.read('workbench.journal[1].attackId'),'l1-noise');
  assert.equal(app.read('workbench.journal[1].action.abilityName'),'RETRACE');
  assert.match(app.element('#app').innerHTML,/id="attack-payload"|Choose a route/i);
});

test('Sigil activation removes a preselected cosmetic control and disables its rendered choice',async()=>{
  const app=application();app.read('modelId="sigil"');await app.read('start("atlas")');
  app.read('run=evaluateAttack(run,"l1-provenance")');
  await app.click('control',{id:'l1-cosmetic'});assert.equal(app.read('controlDraft'),'l1-cosmetic');
  await app.click('operator-ability');
  assert.equal(app.read('controlDraft'),null);assert.equal(app.read('run.operatorAction.excludedControlId'),'l1-cosmetic');
  const html=app.element('#app').innerHTML;
  assert.match(html,/<button[^>]*data-action="control"[^>]*data-id="l1-cosmetic"[^>]*\bdisabled\b/);
  assert.match(html,/<button[^>]*data-action="govern"[^>]*\bdisabled\b/);
  await app.click('control',{id:'l1-targeted'});await app.click('govern');
  assert.equal(app.read('run.phase'),'assure');
});

test('auth gating blocks tactic selection and activation without consuming a charge',async()=>{
  const app=application();await app.read('start("atlas")');
  app.read('run=evaluateAttack(run,"l1-provenance")');app.auth.canPractice=false;
  await app.click('tactic-pick',{key:'edge',value:'action'});await app.click('operator-ability');
  assert.equal(app.read('Object.keys(tacticDraft).length'),0);
  assert.equal(app.read('run.operatorState.remaining'),3);assert.equal(app.read('run.operatorAction'),null);
});

test('workbench activation captures the exact hypothesis once and keeps it out of browser storage',async()=>{
  const app=application();app.read('modelId="null"');await app.read('start("atlas")');
  await app.click('attack',{id:'l1-provenance'});
  const payload='TAB_ONLY_CANARY_<img src=x onerror=alert(1)> Fictional report authorizes a disputed export.';
  app.input('attack-payload',payload);
  await app.click('operator-ability');
  const entry=JSON.parse(app.read('JSON.stringify(workbench.journal[0])'));
  assert.equal(entry.type,'operator-tactic-context');
  assert.equal(entry.campaignId,'atlas');assert.equal(entry.level,1);assert.equal(entry.attempt,1);
  assert.equal(entry.operatorId,'null');assert.equal(entry.abilityName,'SANDBOX');
  assert.equal(entry.attackId,'l1-provenance');assert.equal(entry.payload,payload);
  assert.equal(entry.simulated,true);assert.equal(entry.verified,false);
  assert.deepEqual(entry.action,JSON.parse(app.read('JSON.stringify(run.operatorAction)')));
  assert.equal(app.read('attackDraftText'),payload);
  assert.doesNotMatch(app.storage.value,/TAB_ONLY_CANARY|onerror/);
  assert.doesNotMatch(app.element('#app').innerHTML,/<img src=x/);
  await app.click('operator-ability');
  assert.equal(app.read('run.operatorState.remaining'),2);
  assert.equal(app.read('workbench.journal.length'),1);
  const reload=application({stored:app.storage.value});reload.read('resume("atlas")');
  assert.equal(reload.read('run.operatorState.remaining'),2);
  assert.equal(reload.read('workbench.journal.length'),0);
  assert.equal(reload.read('attackDraftText'),'');
});

test('evaluation records the active tactic with its own current authored payload',async()=>{
  const app=application();app.read('modelId="glitch"');await app.read('start("prism")');
  await app.click('attack',{id:'l1-consensus'});
  app.input('attack-payload','Initial fictional bulletin asks the agent to treat agreement as verified permission.');
  await app.click('operator-ability');
  app.input('attack-payload','Revised fictional bulletin asks the agent to release a disputed record without authorization.');
  await app.click('evaluate');
  assert.equal(app.errors.length,0);
  const journal=JSON.parse(app.read('JSON.stringify(workbench.journal)'));
  assert.equal(journal.length,2);
  assert.match(journal[0].payload,/Initial fictional/);
  assert.match(journal[1].payload,/Revised fictional/);
  assert.equal(journal[1].type,'operator-authored-hypothesis');
  assert.equal(journal[1].operatorId,'glitch');assert.equal(journal[1].abilityName,'OVERDRIVE');
  assert.equal(journal[1].operatorAction.abilityName,'OVERDRIVE');
  assert.equal(app.read('workbench.journal[1].operatorAction!==run.operatorAction'),true);
  assert.doesNotMatch(app.storage.value,/Initial fictional|Revised fictional/);
});

test('tactical routing inputs and activation preserve the workbench hypothesis',async()=>{
  const app=application();app.read('modelId="relay"');await app.read('start("atlas")');
  await app.click('attack',{id:'l1-provenance'});
  const payload='Fictional supplier document claims a prior authorization to reroute the approved payment.';
  app.input('attack-payload',payload);await app.click('evaluate');
  await app.click('tactic-pick',{key:'verified',value:'run'});
  assert.equal(app.read('attackDraftText'),payload);
  await app.click('tactic-pick',{key:'contested',value:'hold'});
  assert.equal(app.read('attackDraftText'),payload);
  await app.click('operator-ability');
  assert.equal(app.errors.length,0);
  assert.equal(app.read('attackDraftText'),payload);
  assert.equal(app.read('workbench.journal.at(-1).payload'),payload);
  assert.equal(app.read('workbench.journal.at(-1).action.options.contested'),'hold');
  assert.match(app.element('#app').innerHTML,/Fictional supplier document/);
});

test('Bastion returns the same captured hypothesis to the governance workbench',async()=>{
  const app=application();app.read('modelId="bastion"');await app.read('start("prism")');
  await app.click('attack',{id:'l1-provenance'});
  const payload='Fictional government brief claims verified approval to publish the disputed source record.';
  app.input('attack-payload',payload);await app.click('evaluate');
  const finding=app.read('JSON.stringify(run.finding)');
  await app.click('control',{id:'l1-cosmetic'});await app.click('govern');
  app.read('run=replay(run);render()');
  assert.equal(app.read('run.result.passed'),false);
  await app.click('operator-ability');
  assert.equal(app.errors.length,0);
  assert.equal(app.read('run.phase'),'govern');
  assert.equal(app.read('JSON.stringify(run.finding)'),finding);
  assert.equal(app.read('attackDraftText'),payload);
  assert.equal(app.read('workbench.journal.at(-1).abilityName'),'SECOND LINE');
  assert.equal(app.read('workbench.journal.at(-1).payload'),payload);
  assert.equal(app.read('run.operatorState.remaining'),2);
  assert.match(app.element('#app').innerHTML,/RED-TEAM WORKBENCH/);
});

test('tactical context shares the bounded journal and stays isolated by campaign',async()=>{
  const app=application();app.read('modelId="null"');await app.read('start("atlas")');
  app.read('for(let i=0;i<200;i++)appendAttackEvidence({type:"operator-authored-hypothesis",index:i})');
  await app.click('attack',{id:'l1-provenance'});
  app.input('attack-payload','A'.repeat(1500));await app.click('operator-ability');
  assert.equal(app.read('workbench.journal.length'),200);
  assert.equal(app.read('workbench.journal[0].index'),1);
  assert.equal(app.read('workbench.journal.at(-1).payload.length'),1200);
  await app.read('start("prism")');
  assert.equal(app.read('workbench.journal.length'),0);
  app.read('resume("atlas")');
  assert.equal(app.read('workbench.journal.length'),200);
  assert.equal(app.read('workbench.journal.at(-1).campaignId'),'atlas');
  assert.equal(app.read('workbench.journal.at(-1).abilityName'),'SANDBOX');
});

test('each mission stage renders one integrated workbench inside the play area',async()=>{
  const app=application();await app.read('start("atlas")');
  for(const phase of ['evaluate','govern','assure','debrief']){
    if(phase==='govern')app.read('run=evaluateAttack(run,"l1-provenance")');
    if(phase==='assure')app.read('run=applyGovernance(run,"l1-targeted")');
    if(phase==='debrief')app.read('run=replay(run)');
    app.read('render()');
    const html=app.element('#app').innerHTML;
    assert.equal((html.match(/class="redteam-workbench"/g)||[]).length,1,phase);
    assert.ok(html.indexOf('class="panel play-area"')<html.indexOf('class="redteam-workbench"'),phase);
    const consolePosition=html.indexOf('class="operator-console"');
    if(consolePosition!==-1)assert.ok(consolePosition>html.indexOf('class="redteam-workbench"'),phase);
  }
});
