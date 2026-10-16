import test from 'node:test';
import assert from 'node:assert/strict';
import {OPERATORS,getOperator} from './dist/operators.js';
import {createRun,evaluateAttack,applyGovernance,replay,retryLevel,useOperatorAbility} from './dist/engine.js';
import {renderOperatorDossier,renderOperatorConsole,renderOperatorResult,renderTacticalReport} from './dist/operator-ui.js';

function ready(operatorId){
  const operator=getOperator(operatorId);
  let run=createRun('atlas',operatorId);
  if(operator.phase==='evaluate')return run;
  run=evaluateAttack(run,'l1-provenance');
  if(operator.phase==='govern')return run;
  run=applyGovernance(run,operator.phase==='debrief'?'l1-cosmetic':'l1-targeted');
  return operator.phase==='debrief'?replay(run):run;
}
const inputs=id=>id==='cipher'?{edge:'action'}:id==='relay'?{verified:'run',contested:'review'}:{};
const activation=html=>html.match(/<button[^>]*data-action="operator-ability"[^>]*>/)?.[0]??null;

test('each operator dossier and usable console exposes its own tool, phase, and charge budget',()=>{
  assert.equal(new Set(OPERATORS.map(operator=>operator.abilityName)).size,9);
  for(const operator of OPERATORS){
    const dossier=renderOperatorDossier(operator);
    assert.ok(dossier.includes(operator.abilityName));assert.ok(dossier.includes(operator.role));
    assert.match(dossier,/3 of 3 tactical charges remaining/);
    assert.match(dossier,/BOUND TO YOUR CAMPAIGN/);
    const html=renderOperatorConsole(ready(operator.id),{attackId:'l1-provenance',options:inputs(operator.id)});
    assert.ok(html.includes(operator.abilityName));assert.match(html,/TOOL READY/);
    assert.ok(activation(html));assert.doesNotMatch(activation(html),/\bdisabled\b/);
  }
});

test('Cipher, Relay, and Null require their own inputs before activation',()=>{
  const cipher=ready('cipher');
  assert.match(activation(renderOperatorConsole(cipher)),/\bdisabled\b/);
  assert.match(renderOperatorConsole(cipher),/Choose the tool’s inputs first/);
  assert.doesNotMatch(activation(renderOperatorConsole(cipher,{options:{edge:'action'}})),/\bdisabled\b/);
  const relay=ready('relay');
  assert.match(activation(renderOperatorConsole(relay,{options:{verified:'run'}})),/\bdisabled\b/);
  assert.doesNotMatch(activation(renderOperatorConsole(relay,{options:{verified:'run',contested:'hold'}})),/\bdisabled\b/);
  assert.match(activation(renderOperatorConsole(ready('null'))),/\bdisabled\b/);
  assert.doesNotMatch(activation(renderOperatorConsole(ready('null'),{attackId:'l1-provenance'})),/\bdisabled\b/);
});

test('phase and busy locks disable operator activation and interactive inputs',()=>{
  const wrongPhase=renderOperatorConsole(createRun('atlas','cipher'),{options:{edge:'action'}});
  assert.match(activation(wrongPhase),/\bdisabled\b/);
  assert.match(wrongPhase,/Available during GOVERN/);
  const busy=renderOperatorConsole(ready('relay'),{options:inputs('relay'),busy:true});
  assert.match(activation(busy),/\bdisabled\b/);
  const options=busy.match(/<button[^>]*data-action="tactic-pick"[^>]*>/g);
  assert.equal(options.length,6);assert.ok(options.every(button=>/\bdisabled\b/.test(button)));
});

test('a committed tactic renders its report and remaining charges without a second activation',()=>{
  const run=useOperatorAbility(ready('cipher'),{edge:'action'});
  const html=renderOperatorConsole(run,{options:{edge:'source'}});
  assert.equal(activation(html),null);assert.match(html,/TACTIC COMMITTED/);
  assert.match(html,/2 of 3 tactical charges remaining/);assert.match(html,/TACTICAL RECORD \/ WIRECUT/);
  assert.match(html,/>ACTION<\/strong>/);assert.doesNotMatch(html,/data-action="tactic-pick"/);
  const result=renderOperatorResult(run);
  assert.match(result,/WIRECUT/);assert.match(result,/2 of 3 tactical charges remaining/);
  assert.match(renderOperatorResult(createRun('atlas','root')),/Charge conserved/);
});

test('exhausted campaign budget remains disabled after retry and accurately shows zero charges',()=>{
  let run=createRun('atlas','null');
  for(let attempt=0;attempt<3;attempt++){
    run=useOperatorAbility(run,{attackId:'l1-noise'});
    run=retryLevel(replay(applyGovernance(evaluateAttack(run,'l1-noise'),'l1-cosmetic')));
  }
  const html=renderOperatorConsole(run,{attackId:'l1-provenance'});
  assert.match(html,/0 of 3 tactical charges remaining/);assert.match(html,/All three campaign charges have been spent/);
  assert.match(activation(html),/\bdisabled\b/);assert.equal((html.match(/class="charged"/g)||[]).length,0);
});

test('operator reports escape all dynamic prose, including fork comparison labels and values',()=>{
  const hostile='<img src=x onerror="alert(1)"> & \'quoted\'';
  for(const operatorId of ['aegis','root']){
    const html=renderTacticalReport({operatorId,abilityName:hostile,level:1,attempt:2,summary:hostile,report:[{label:hostile,value:hostile,detail:hostile}]});
    assert.doesNotMatch(html,/<img|<script|onerror="/);
    assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;quoted&#39;/);
    assert.ok(html.includes(operatorId==='root'?'fork-grid':'report-lines'));
  }
  assert.equal(renderTacticalReport(null),'');
});

test('dossier copy is escaped while preserving the operator kit presentation',()=>{
  const html=renderOperatorDossier({...getOperator('cipher'),name:'<svg onload="bad()">',summary:'<script>bad()</script>',tradeoff:'Use "review" & retain ownership.'});
  assert.doesNotMatch(html,/<svg|<script>/);assert.match(html,/&lt;svg onload=&quot;bad\(\)&quot;&gt;/);
  assert.match(html,/Use &quot;review&quot; &amp; retain ownership/);assert.match(html,/SIGNATURE TOOL \/ GOVERN/);
});
