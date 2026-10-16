import test from 'node:test';
import assert from 'node:assert/strict';
import {OPERATORS, getOperator} from './dist/operators.js';
import {
  CAMPAIGNS, createRun, validateRun, evaluateAttack, applyGovernance,
  answerChallenge, replay, retryLevel, nextLevel, useOperatorAbility, getOperatorStatus
} from './dist/engine.js';

const current = run => CAMPAIGNS[run.campaignId].levels[run.level];
const attackFor = (run, type = 'provenance') => current(run).attacks.find(a => a.id.endsWith('-' + type)).id;
const controlFor = (run, quality = 'targeted') => current(run).controls.find(c => c.quality === quality).id;
const copy = value => JSON.parse(JSON.stringify(value));
const correct = (key, level) => ({
  authority: ['policy'], evidence: ['record'], owner: ['owner'], trigger: ['change'],
  release: level >= 7 ? ['lineage','scope','continuity'] : ['lineage','scope'],
  pipeline: ['evidence','govern','control','retest','release'], handoff: ['refresh']
})[key];
function answerAll(run) {
  for (const field of current(run).challenge.fields) run = answerChallenge(run, field.key, correct(field.key, run.level));
  return run;
}
function evaluated(run, attack = 'provenance') { return evaluateAttack(run, attackFor(run, attack)); }
function governed(run, quality = 'targeted') { return applyGovernance(run, controlFor(run, quality)); }
function finish(run, quality = 'targeted') { return replay(answerAll(governed(run, quality))); }
function win(run) { return finish(evaluated(run)); }
function atLevel(operatorId, level, campaignId = 'atlas') {
  let run = createRun(campaignId, operatorId);
  while (run.level < level) run = nextLevel(win(run));
  return run;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function immutableCall(operation, input) {
  const before = structuredClone(input);
  const result = operation(freeze(input));
  assert.deepEqual(input, before, 'the supplied run must not be mutated');
  assert.notEqual(result, input, 'a transition returns a new run');
  return result;
}
function optionsFor(run) {
  if (run.operatorId === 'cipher') return {edge:'action'};
  if (run.operatorId === 'relay') return {verified:'run', contested:'review'};
  if (run.operatorId === 'null') return {attackId:attackFor(run)};
  return {};
}
function ready(run) {
  switch (run.operatorId) {
    case 'null': case 'glitch': return run;
    case 'aegis': return governed(evaluated(run));
    case 'trace': return evaluated(run, 'noise');
    case 'bastion': return finish(evaluated(run), 'cosmetic');
    default: return evaluated(run);
  }
}
function activate(run, options = optionsFor(run)) {
  return useOperatorAbility(run, options);
}
function finishActivated(run) {
  if (run.phase === 'evaluate') run = evaluated(run, run.operatorId === 'glitch' ? 'consensus' : 'provenance');
  if (run.phase === 'govern') run = governed(run, run.operatorId === 'cipher' ? 'cosmetic' : run.operatorId === 'relay' ? 'blanket' : 'targeted');
  return replay(answerAll(run));
}
function reportText(run) {
  return run.operatorAction.report.map(row => `${row.label} ${row.value} ${row.detail}`).join('\n');
}
function assertAction(run, operatorId, level = run.level + 1) {
  const operator = getOperator(operatorId);
  assert.equal(run.operatorAction.operatorId, operatorId);
  assert.equal(run.operatorAction.abilityName, operator.abilityName);
  assert.equal(run.operatorAction.level, level);
  assert.equal(run.operatorAction.attempt, run.attempt);
  assert.equal(typeof run.operatorAction.summary, 'string');
  assert.ok(run.operatorAction.summary.length > 0);
  assert.ok(Array.isArray(run.operatorAction.report));
  assert.ok(run.operatorAction.report.length > 0);
  for (const row of run.operatorAction.report) {
    assert.equal(typeof row.label, 'string');
    assert.equal(typeof row.value, 'string');
    assert.equal(typeof row.detail, 'string');
  }
  for (const key of ['continuity','trust','exposure','review']) assert.ok(Number.isFinite(run.operatorAction.metricDeltas[key]));
  assert.deepEqual(run.operatorState.logs.at(-1), run.operatorAction);
}

test('the operator catalog is immutable and rejects unknown and prototype identities', () => {
  assert.deepEqual(OPERATORS.map(o => o.id), ['cipher','aegis','trace','relay','null','bastion','sigil','glitch','root']);
  assert.ok(Object.isFrozen(OPERATORS));
  assert.equal(new Set(OPERATORS.map(o => o.abilityName)).size, 9);
  for (const operator of OPERATORS) {
    assert.ok(Object.isFrozen(operator));
    assert.equal(getOperator(operator.id), operator);
    for (const key of ['name','alias','color','lens','clue','role','abilityName','phase','summary','tradeoff']) assert.ok(operator[key]);
  }
  for (const id of ['unknown','__proto__','constructor','prototype',null,{},1]) {
    assert.equal(getOperator(id), null);
    assert.throws(() => createRun('atlas', id));
  }
});

test('new runs have three charges; known legacy operators migrate without mutating the saved input', () => {
  for (const operator of OPERATORS) {
    const run = createRun('atlas', operator.id);
    assert.equal(run.operatorId, operator.id);
    assert.equal(run.operatorName, operator.name);
    assert.deepEqual(run.operatorState, {remaining:3,used:false,logs:[]});
    assert.equal(run.operatorAction, null);
    const legacy = {...run};
    delete legacy.operatorState;
    delete legacy.operatorAction;
    const migrated = immutableCall(validateRun, legacy);
    assert.deepEqual(migrated.operatorState, run.operatorState);
    assert.equal(migrated.operatorAction, null);
    assert.equal(migrated.operatorId, operator.id);
  }
  const unknown = {...createRun('atlas','cipher'),operatorId:'__proto__'};
  assert.throws(() => validateRun(unknown));
});

test('Cipher changes containment only at the action edge and pays for overbroad source cuts', () => {
  const run = evaluated(createRun('atlas','cipher'));
  const baseline = finish(run, 'cosmetic');
  assert.equal(baseline.result.blocked, 0);
  const action = finish(activate(run, {edge:'action'}), 'cosmetic');
  assert.equal(action.result.blocked, 3);
  assert.equal(action.result.useful, 88 - action.result.loadPenalty);
  assert.equal(action.result.passed, true);
  const advice = finish(activate(run, {edge:'advice'}), 'cosmetic');
  assert.equal(advice.result.blocked, 0);
  assert.equal(advice.result.passed, false);
  const source = finish(activate(run, {edge:'source'}));
  assert.ok(source.result.useful <= 50);
  assert.equal(source.result.passed, false);
  assert.equal(source.operatorState.remaining, 2);
});

test('Aegis reports unanswered and incorrect decisions without solving or scoring them', () => {
  const unanswered = governed(evaluated(atLevel('aegis',2)));
  const wrong = answerChallenge(unanswered,'authority',['external']);
  const correctRun = answerAll(unanswered);
  const scans = [unanswered,wrong,correctRun].map(run => activate(run));
  for (const [index, scan] of scans.entries()) {
    const original = [unanswered,wrong,correctRun][index];
    assert.equal(scan.phase, 'assure');
    assert.equal(scan.score, original.score);
    assert.deepEqual(scan.answers, original.answers);
    assert.deepEqual(scan.metrics, original.metrics);
    assert.equal(scan.result, original.result);
  }
  assert.notEqual(reportText(scans[0]), reportText(scans[2]), 'readiness distinguishes missing answers');
  assert.notEqual(reportText(scans[1]), reportText(scans[2]), 'readiness distinguishes wrong answers');
  assert.equal(replay(scans[0]).result.passed, false);
  assert.equal(replay(scans[1]).result.passed, false);
  assert.equal(replay(scans[2]).result.passed, true);
});

test('Trace restores the pre-evaluation checkpoint while retaining its spent charge', () => {
  const initial = createRun('prism','trace');
  const failedProbe = evaluated(initial,'noise');
  assert.equal(failedProbe.finding.successful, false);
  const retraced = activate(failedProbe);
  assert.equal(retraced.phase, 'evaluate');
  assert.deepEqual(retraced.metrics, initial.metrics);
  assert.equal(retraced.score, initial.score);
  for (const key of ['selectedAttack','selectedControl','finding','governance','result','levelStartMetrics']) assert.equal(retraced[key], null);
  assert.equal(retraced.operatorState.remaining, 2);
  assert.equal(retraced.operatorState.used, true);
  const replacement = evaluated(retraced);
  assert.equal(replacement.finding.successful, true);
  assert.throws(() => activate(replacement), 'rewinding does not grant another activation');
  assert.equal(finish(replacement).result.passed, true);
});

test('Relay requires a useful verified lane and a contained contested lane', () => {
  const initial = evaluated(createRun('atlas','relay'));
  assert.ok(finish(initial,'blanket').result.useful < 80);
  for (const verified of ['run','review','hold']) for (const contested of ['run','review','hold']) {
    const run = finish(activate(initial,{verified,contested}),'blanket');
    if (contested === 'run') {
      assert.equal(run.result.blocked, 0, `${verified}/${contested} leaves the contested lane open`);
      assert.equal(run.result.passed, false);
    }
    if (verified !== 'run') {
      assert.ok(run.result.useful <= 50, `${verified}/${contested} loses verified throughput`);
      assert.equal(run.result.passed, false);
    }
    if (verified === 'run' && contested !== 'run') {
      assert.equal(run.result.blocked, 3);
      assert.equal(run.result.useful, 88-run.result.loadPenalty);
      assert.equal(run.result.passed, true);
    }
  }
});

test('Null previews one attack without creating a finding, advancing the phase, or moving metrics', () => {
  const initial = createRun('atlas','null');
  const threat = activate(initial,{attackId:attackFor(initial)});
  const noise = activate(initial,{attackId:attackFor(initial,'noise')});
  assert.notEqual(reportText(threat), reportText(noise));
  for (const run of [threat,noise]) {
    assert.equal(run.phase, 'evaluate');
    assert.equal(run.selectedAttack, null);
    assert.equal(run.finding ?? null, null);
    assert.equal(run.score, 0);
    assert.deepEqual(run.metrics, initial.metrics);
    assert.deepEqual(run.history, []);
    assert.throws(() => governed(run));
  }
  assert.equal(evaluated(threat).finding.successful, true);
  assert.equal(evaluated(noise,'noise').finding.successful, false);
});

test('Bastion recovers a failed response, clears its decisions, and keeps the reproduced finding', () => {
  const checkpoint = atLevel('bastion',2,'prism');
  const finding = evaluated(checkpoint);
  const failure = finish(finding,'cosmetic');
  assert.equal(failure.result.passed, false);
  assert.ok(Object.keys(failure.answers).length > 0);
  const recovered = activate(failure);
  assert.equal(recovered.phase, 'govern');
  assert.deepEqual(recovered.finding, finding.finding);
  assert.deepEqual(recovered.metrics, finding.metrics);
  assert.deepEqual(recovered.levelStartMetrics, finding.levelStartMetrics);
  assert.deepEqual(recovered.history, checkpoint.history);
  assert.deepEqual(recovered.answers, {});
  assert.equal(recovered.selectedControl, null);
  assert.equal(recovered.governance, null);
  assert.equal(recovered.result, null);
  assert.equal(recovered.score, checkpoint.score);
  assert.equal(recovered.operatorState.remaining, 2);
  assert.equal(finish(recovered).result.passed, true);
  const unproven = finish(evaluated(createRun('prism','bastion'),'noise'));
  assert.equal(getOperatorStatus(unproven).available, false);
  assert.throws(() => activate(unproven));
  assert.throws(() => activate(win(createRun('prism','bastion'))));
});

test('Sigil excludes the cosmetic control while leaving the player responsible for the remaining choice', () => {
  const initial = evaluated(createRun('atlas','sigil'));
  const run = activate(initial);
  assert.equal(run.phase, 'govern');
  assert.equal(run.operatorAction.excludedControlId, controlFor(run,'cosmetic'));
  assert.throws(() => governed(run,'cosmetic'));
  assert.equal(finish(run,'targeted').result.passed, true);
  assert.equal(finish(run,'blanket').result.passed, false);
  assert.ok(reportText(run).includes(current(run).controls.find(c => c.quality === 'targeted').rationale));
  assert.deepEqual(run.answers, {});
});

test('Glitch boosts only consensus attacks and its arming cost survives a retry', () => {
  const initial = createRun('atlas','glitch');
  const armed = activate(initial);
  assert.equal(armed.phase, 'evaluate');
  assert.equal(armed.score, 0);
  assert.deepEqual(armed.metrics, {...initial.metrics,exposure:6,review:4});
  for (const type of ['provenance','noise','consensus']) {
    const baseline = evaluated(initial,type);
    const boosted = evaluated(armed,type);
    assert.equal(boosted.finding.effectiveness-baseline.finding.effectiveness, type === 'consensus' ? 22 : 0);
    if (type === 'consensus') {
      assert.equal(baseline.finding.successful, false);
      assert.equal(boosted.finding.successful, true);
    }
  }
  const failed = finish(evaluated(armed,'consensus'),'cosmetic');
  assert.equal(failed.result.passed, false, 'attack effectiveness cannot bypass containment');
  const retried = retryLevel(failed);
  assert.deepEqual(retried.metrics, armed.metrics);
  assert.equal(retried.operatorState.remaining, 2);
  assert.equal(retried.operatorState.used, false);
  assert.equal(retried.operatorAction, null);
  assert.equal(evaluated(retried,'consensus').finding.successful, false, 'retry clears the armed boost');
});

test('Root previews all controls without selecting one or revealing completed decisions', () => {
  const initial = evaluated(atLevel('root',2));
  const run = activate(initial);
  assert.equal(run.phase, 'govern');
  assert.equal(run.selectedControl, null);
  assert.equal(run.governance, null);
  assert.deepEqual(run.answers, {});
  assert.equal(run.score, initial.score);
  assert.deepEqual(run.metrics, initial.metrics);
  for (const control of current(run).controls) assert.ok(reportText(run).includes(control.name), `preview covers ${control.quality}`);
  assert.equal(replay(governed(run)).result.passed, false, 'the preview does not answer the mission decision');
  assert.equal(finish(run).result.passed, true);
});

test('reinforced control records preserve the base policy and explicitly record the tactical amendment',()=>{
  for(const [id,options,quality,amendment] of [
    ['cipher',{edge:'action'},'cosmetic',/enforcing action gate/],
    ['relay',{verified:'run',contested:'review'},'blanket',/verified work uses an 88%/]
  ]){
    const run=governed(activate(evaluated(createRun('atlas',id)),options),quality);
    assert.match(run.governance.operatorAdjustment,amendment);
    assert.equal(run.governance.quality,quality);
    const finished=replay(answerAll(run));
    assert.equal(finished.result.passed,true);
    assert.equal(finished.history[0].governance.operatorAdjustment,run.governance.operatorAdjustment);
    assert.deepEqual(validateRun(copy(finished)),finished);
    assert.throws(()=>validateRun({...run,governance:{...run.governance,operatorAdjustment:{text:'unbounded schema'}}}));
  }
  const sandbox=activate(createRun('atlas','null'));
  assert.ok(reportText(sandbox).includes(current(sandbox).attacks.find(attack=>attack.id===sandbox.operatorAction.options.attackId).name));
});

test('all abilities are immutable, preserve their audit report, and allow only one activation per attempt', () => {
  for (const operator of OPERATORS) {
    const initial = ready(createRun('atlas',operator.id));
    const statusBefore = getOperatorStatus(initial);
    assert.deepEqual(Object.keys(statusBefore).sort(), ['operatorId','abilityName','phase','remaining','used','available','reason'].sort());
    assert.equal(statusBefore.operatorId, operator.id);
    assert.equal(statusBefore.abilityName, operator.abilityName);
    assert.equal(statusBefore.phase, operator.phase);
    assert.equal(statusBefore.available, true);
    const run = immutableCall(input => activate(input), initial);
    assert.equal(run.operatorState.remaining, 2);
    assert.equal(run.operatorState.used, true);
    assert.equal(run.operatorState.logs.length, 1);
    assertAction(run,operator.id);
    assert.deepEqual(validateRun(copy(run)),run, `${operator.id} ability output survives saved-state validation`);
    const statusAfter = getOperatorStatus(run);
    assert.equal(statusAfter.available, false);
    assert.equal(statusAfter.remaining, 2);
    assert.equal(statusAfter.used, true);
    assert.ok(statusAfter.reason.length > 0);
    let reusablePhase = run;
    if (operator.id === 'trace') reusablePhase = evaluated(run);
    if (operator.id === 'bastion') reusablePhase = finish(run,'cosmetic');
    assert.throws(() => activate(reusablePhase), `${operator.id} cannot activate twice in one attempt`);
    const finished = finishActivated(run);
    assert.equal(finished.result.passed,true,operator.id);
    assert.deepEqual(finished.history.at(-1).operatorAction,run.operatorAction);
    assert.deepEqual(finished.operatorState.logs.at(-1),run.operatorAction);
    assert.deepEqual(validateRun(copy(finished)),finished);
  }
});

test('wrong phases and malformed ability options reject without spending a charge', () => {
  for (const operator of OPERATORS) {
    const initial = createRun('atlas',operator.id);
    const wrongPhase = operator.phase === 'evaluate' ? evaluated(initial) : initial;
    const snapshot = copy(wrongPhase);
    assert.equal(getOperatorStatus(wrongPhase).available,false);
    assert.throws(() => activate(wrongPhase));
    assert.deepEqual(wrongPhase,snapshot);
    const prepared = ready(initial);
    for (const options of [null,[],{extra:'forged'}]) assert.throws(() => activate(prepared,options),operator.id);
    assert.equal(prepared.operatorState.remaining,3);
    assert.deepEqual(prepared.operatorState.logs,[]);
  }
  const cipher = ready(createRun('atlas','cipher'));
  for (const edge of ['unknown','__proto__',null,1]) assert.throws(() => activate(cipher,{edge}));
  const relay = ready(createRun('atlas','relay'));
  for (const options of [{verified:'run'},{contested:'review'},{verified:'unknown',contested:'hold'},{verified:'run',contested:'__proto__'}]) assert.throws(() => activate(relay,options));
  const sandbox = createRun('atlas','null');
  for (const attackId of ['l2-provenance','unknown','__proto__',null]) assert.throws(() => activate(sandbox,{attackId}));
});

test('retry resets the attempt activation but never refunds a charge or erases the audit log', () => {
  let run = activate(createRun('atlas','null'));
  const firstAction = copy(run.operatorAction);
  run = finish(evaluated(run,'noise'));
  assert.equal(run.result.passed,false);
  run = retryLevel(run);
  assert.equal(run.attempt,2);
  assert.equal(run.operatorState.remaining,2);
  assert.equal(run.operatorState.used,false);
  assert.equal(run.operatorAction,null);
  assert.deepEqual(run.operatorState.logs,[firstAction]);
  run = activate(run);
  assert.equal(run.operatorState.remaining,1);
  assert.equal(run.operatorAction.attempt,2);
  const secondAction = copy(run.operatorAction);
  run = nextLevel(win(run));
  assert.equal(run.level,1);
  assert.equal(run.attempt,1);
  assert.equal(run.operatorState.remaining,1);
  assert.equal(run.operatorState.used,false);
  assert.equal(run.operatorAction,null);
  assert.deepEqual(run.operatorState.logs,[firstAction,secondAction]);
  assert.deepEqual(run.history[0].operatorAction,secondAction);
  assert.deepEqual(validateRun(copy(run)),run);
});

test('forged operator state and oversized or accessor-bearing audit records are rejected', () => {
  const activated = activate(createRun('atlas','null'));
  const forgeries = [
    run => {run.operatorState.remaining=-1;},
    run => {run.operatorState.remaining=4;},
    run => {run.operatorState.remaining=1.5;},
    run => {run.operatorState.remaining=3;},
    run => {run.operatorState.used='yes';},
    run => {run.operatorState.logs=Array.from({length:201},()=>copy(run.operatorAction));},
    run => {run.operatorAction.operatorId='__proto__';},
    run => {run.operatorAction.operatorId='cipher';},
    run => {run.operatorAction.abilityName='FREE CHARGE';},
    run => {run.operatorAction.level=11;},
    run => {run.operatorAction.attempt=0;},
    run => {run.operatorAction.options={attackId:'l2-provenance'};},
    run => {run.operatorAction.metricDeltas.exposure=Infinity;},
    run => {run.operatorAction.report=Array.from({length:201},()=>({label:'x',value:'y',detail:'z'}));},
    run => {run.operatorAction.summary='x'.repeat(4097);},
    run => {run.operatorState.logs[0].report.push({label:'x',value:'y',detail:'z'.repeat(4097)});}
  ];
  for (const forge of forgeries) {
    const run=copy(activated);forge(run);
    assert.throws(() => validateRun(run));
    assert.throws(() => evaluateAttack(run,attackFor(activated)));
  }
  let reads=0;
  const getterRun=copy(activated);
  Object.defineProperty(getterRun.operatorState,'remaining',{enumerable:true,get(){reads++;return 2;}});
  assert.throws(() => validateRun(getterRun));
  assert.equal(reads,0,'validation must reject accessors without invoking them');
  const cyclic=copy(activated);
  cyclic.operatorState.logs.push(cyclic.operatorState);
  assert.throws(() => validateRun(cyclic));
  const prototype=copy(activated);
  Object.defineProperty(prototype.operatorAction.options,'__proto__',{enumerable:true,value:{remaining:99}});
  assert.throws(() => validateRun(prototype));
});

for (const campaignId of ['atlas','prism']) for (const operator of OPERATORS) {
  test(`${campaignId}/${operator.id}: three distinct ability uses still require ten complete winning loops`, () => {
    let run=createRun(campaignId,operator.id);
    const actions=[];
    for (let level=0;level<10;level++) {
      assert.equal(run.level,level);
      assert.equal(run.history.length,level);
      assert.equal(run.operatorState.remaining,3-Math.min(level,3));
      assert.equal(run.operatorState.used,false);
      assert.equal(run.operatorAction,null);
      if (level<3) {
        run=activate(ready(run));
        assertAction(run,operator.id,level+1);
        actions.push(copy(run.operatorAction));
        run=finishActivated(run);
      } else {
        const prepared=ready(run);
        assert.equal(getOperatorStatus(prepared).available,false);
        assert.equal(getOperatorStatus(prepared).remaining,0);
        assert.throws(() => activate(prepared),'an exhausted kit cannot activate at its valid phase');
        run=win(run);
      }
      assert.equal(run.result.passed,true,`level ${level+1}`);
      assert.equal(run.result.blocked,3);
      assert.ok(run.result.useful>=80);
      assert.ok(run.result.criteria.every(c=>c.passed));
      assert.equal(run.history.length,level+1);
      assert.equal(run.history.at(-1).result.passed,true);
      assert.deepEqual(run.history.at(-1).operatorAction??null,actions[level]??null);
      assert.equal(run.score,run.history.reduce((sum,entry)=>sum+entry.score,0));
      assert.deepEqual(validateRun(copy(run)),run);
      assert.throws(() => replay(run),'abilities never permit duplicate score awards');
      run=nextLevel(run);
      assert.equal(run.phase,level===9?'completed':'evaluate');
    }
    assert.equal(run.operatorState.remaining,0);
    assert.deepEqual(run.operatorState.logs,actions);
    assert.equal(run.history.length,10);
    assert.ok(run.score>0 && run.score<=1000);
    assert.equal(getOperatorStatus(run).available,false);
    assert.throws(() => activate(run));
    assert.deepEqual(validateRun(copy(run)),run);
  });
}
