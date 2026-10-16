import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGNS,createRun,evaluateAttack,applyGovernance,replay,useOperatorAbility} from './dist/engine.js';
import {OPERATORS} from './dist/operators.js';
import {renderWorkbench,renderWorkbenchFocus} from './dist/workbench-ui.js';

function stage(operatorId,phase='evaluate'){
  let run=createRun('atlas',operatorId);
  if(phase!=='evaluate')run=evaluateAttack(run,'l1-provenance');
  if(['assure','debrief'].includes(phase))run=applyGovernance(run,phase==='debrief'?'l1-cosmetic':'l1-targeted');
  if(phase==='debrief')run=replay(run);
  return run;
}
const activeButton=html=>html.match(/<button[^>]*data-action="operator-ability"[^>]*>/)?.[0];

test('each specialist has a distinct workbench question and stage-appropriate functional kit',()=>{
  const questions=new Set();
  for(const operator of OPERATORS){
    const initial=stage(operator.id);
    const early=renderWorkbench(initial,{attackId:'l1-provenance',payload:'A fictional source asks the agent to release a disputed record.'});
    assert.match(early,/RED-TEAM WORKBENCH \/ SIMULATION/);
    assert.ok(early.includes(operator.abilityName),operator.id);
    assert.equal((early.match(/id="attack-payload"/g)||[]).length,1);
    questions.add(renderWorkbenchFocus(initial).match(/<h3>(.*?)<\/h3>/)[1]);
    if(operator.phase!=='evaluate'){
      assert.match(early,/workbench-upcoming/);
      assert.equal(activeButton(early),undefined);
    }
    const run=stage(operator.id,operator.phase);
    const options=operator.id==='cipher'?{edge:'action'}:operator.id==='relay'?{verified:'run',contested:'review'}:{};
    const ready=renderWorkbench(run,{attackId:'l1-provenance',tacticOptions:options});
    assert.equal((ready.match(/class="operator-console"/g)||[]).length,1,operator.id);
    assert.ok(activeButton(ready),operator.id+' has its tool at its actual gameplay stage');
    assert.doesNotMatch(activeButton(ready),/\bdisabled\b/,operator.id);
    assert.doesNotMatch(activeButton(renderWorkbench(run,{attackId:'l1-provenance',tacticOptions:options})),/\bdisabled\b/);
    assert.match(activeButton(renderWorkbench(run,{attackId:'l1-provenance',tacticOptions:options,busy:true})),/\bdisabled\b/);
  }
  assert.equal(questions.size,9,'all nine roles focus the red-team hypothesis differently');
});

test('workbench source editing ends after evaluation and the recorded route stays authoritative',()=>{
  const payload='The fictional supplier note requests an unauthorized payment export.';
  for(const phase of ['govern','assure','debrief']){
    const run=stage('cipher',phase);
    const html=renderWorkbench(run,{attackId:'l1-noise',payload});
    assert.match(html,/RECORDED ATTACK ROUTE/);
    const route=html.match(/<div class="workbench-route">(.*?)<\/div>/s)[1];
    assert.ok(route.includes(CAMPAIGNS.atlas.levels[0].attacks.find(x=>x.id==='l1-provenance').name));
    assert.doesNotMatch(html,/<textarea/);
    assert.match(html,/<pre>The fictional supplier note/);
    assert.match(html,/Drafts and authored evidence stay in this tab/);
  }
  const resumed=renderWorkbench(stage('null','govern'));
  assert.match(resumed,/Source draft is not available in this tab/);
  assert.match(resumed,/saved run does not restore the authored text/);
});

test('workbench escapes authored text, audit output, and contextual warnings',()=>{
  const injection='</textarea><script>alert("source")</script><img src=x onerror=alert(1)>';
  for(const phase of ['evaluate','govern']){
    const html=renderWorkbench(stage('null',phase),{attackId:'l1-provenance',payload:injection,audit:injection,contextStatus:injection});
    assert.doesNotMatch(html,/<script>|<img src=x|onerror=alert\(1\)>/);
    assert.ok(html.includes('&lt;script&gt;alert(&quot;source&quot;)&lt;/script&gt;'));
  }
});

test('Null preview stays bound to its captured route when a different hypothesis is selected',()=>{
  const run=useOperatorAbility(stage('null'),{attackId:'l1-provenance'});
  const original=JSON.stringify(run);
  const different=renderWorkbench(run,{attackId:'l1-noise',payload:'A revised fictional note now tests a different route.'});
  assert.match(different,/SANDBOX SNAPSHOT:/);
  assert.match(different,/current route is different/);
  assert.match(different,/applies only to the route selected when SANDBOX was activated/);
  assert.match(different,/TACTIC COMMITTED/);
  assert.equal(activeButton(different),undefined);
  const same=renderWorkbench(run,{attackId:'l1-provenance',payload:'Edited source on the same route.'});
  assert.match(same,/Editing text does not rerun or change that preview/);
  assert.equal(JSON.stringify(run),original,'rendering a hypothetical route cannot mutate a preview or finding');
});

test('Glitch identifies the actual boostable route and Null requires a valid target',()=>{
  const glitch=stage('glitch');
  assert.match(renderWorkbench(glitch,{attackId:'l1-consensus'}),/OVERDRIVE CAN BOOST THIS CONSENSUS TEST/);
  assert.match(renderWorkbench(glitch,{attackId:'l1-provenance'}),/OVERDRIVE DOES NOT BOOST THIS ATTACK TYPE/);
  const noTarget=renderWorkbench(stage('null'),{attackId:'not-a-route'});
  assert.match(noTarget,/Choose a route to begin/);
  assert.match(activeButton(noTarget),/\bdisabled\b/);
  assert.doesNotMatch(noTarget,/id="attack-payload"/);
});

test('Bastion never offers recovery as a substitute for a reproduced failure',()=>{
  let run=evaluateAttack(createRun('atlas','bastion'),'l1-noise');
  run=replay(applyGovernance(run,'l1-targeted'));
  assert.equal(run.result.passed,false);
  assert.match(activeButton(renderWorkbench(run)),/\bdisabled\b/);
  assert.match(renderWorkbench(run),/needs a failed replay with a reproduced original failure/);
});
