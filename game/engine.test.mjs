import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGNS, createRun, validateRun, evaluateAttack, applyGovernance, answerChallenge, replay, retryLevel, nextLevel} from './dist/engine.js';

const current = run => CAMPAIGNS[run.campaignId].levels[run.level];
const attackFor = (run, type = 'provenance') => current(run).attacks.find(a => a.id.endsWith('-' + type)).id;
const controlFor = (run, quality = 'targeted') => current(run).controls.find(c => c.quality === quality).id;
const expectedAnswer = (key, level) => ({authority:['policy'], evidence:['record'], owner:['owner'], trigger:['change'], release:level >= 7 ? ['lineage','scope','continuity'] : ['lineage','scope'], pipeline:['evidence','govern','control','retest','release'], handoff:['refresh']})[key];
const fieldKeys = [[],[],['authority'],['authority','evidence'],['authority','evidence','owner'],['authority','evidence','owner','trigger'],['authority','evidence','owner','trigger','release'],['authority','evidence','owner','trigger','release'],['authority','evidence','owner','trigger','release','pipeline'],['authority','evidence','owner','trigger','release','pipeline','handoff']];

function toAssure(run, quality = 'targeted', attack = 'provenance') {
  return applyGovernance(evaluateAttack(run, attackFor(run, attack)), controlFor(run, quality));
}
function answerAll(run) {
  for (const field of current(run).challenge.fields) run = answerChallenge(run, field.key, expectedAnswer(field.key, run.level));
  return run;
}
function win(run) { return replay(answerAll(toAssure(run))); }
function atLevel(campaignId, level) {
  let run = createRun(campaignId,'bastion');
  for (let i = 0; i < level; i++) run = nextLevel(win(run));
  return run;
}
const saved = run => JSON.parse(JSON.stringify(run));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function unchanged(operation, input) {
  const before = structuredClone(input);
  const result = operation(freeze(input));
  assert.deepEqual(input, before);
  assert.notEqual(result, input);
  return result;
}

test('version 2 starts a locked ten-level campaign without inherited wins or answers', () => {
  for (const id of ['atlas','prism']) {
    const run = createRun(id);
    assert.equal(run.version, 2);
    assert.equal(run.phase, 'evaluate');
    assert.equal(run.level, 0);
    assert.equal(run.score, 0);
    assert.equal(run.attempt, 1);
    assert.deepEqual(run.history, []);
    assert.deepEqual(run.attempts, []);
    assert.deepEqual(run.answers, {});
    assert.deepEqual(run.metrics, {continuity:100,trust:100,exposure:0,review:0});
  }
  assert.throws(() => createRun('unknown'));
  assert.throws(() => createRun('__proto__'));
  assert.throws(() => evaluateAttack({...createRun('atlas'),version:1},'l1-provenance'));
});

test('twenty unique missions introduce the specified progressive decision requirements', () => {
  const titles = new Set();
  for (const campaign of Object.values(CAMPAIGNS)) {
    assert.equal(campaign.levels.length, 10);
    for (const [index, level] of campaign.levels.entries()) {
      titles.add(level.title);
      assert.deepEqual(level.challenge.fields.map(f => f.key), fieldKeys[index]);
      assert.ok(level.challenge.tier);
      assert.equal(level.evidence.length, 3);
      assert.equal(level.variants.length, 3);
      assert.equal(level.attacks.length, 3);
      assert.equal(level.controls.length, 3);
      assert.deepEqual(new Set(level.controls.map(c => c.quality)), new Set(['targeted','blanket','cosmetic']));
      assert.ok(level.brief.includes('fictional'));
      for (const field of level.challenge.fields) {
        assert.deepEqual(field.answer, expectedAnswer(field.key,index));
        assert.equal(new Set(field.options.map(o => o.id)).size, field.options.length);
        assert.ok(field.answer.every(a => field.options.some(o => o.id === a)));
      }
    }
  }
  assert.equal(titles.size, 20);
});

for (const campaignId of ['atlas','prism']) {
  test(`${campaignId}: all ten correct solves unlock exactly one level and require ten wins to finish`, () => {
    let run = createRun(campaignId,'aegis');
    for (let i = 0; i < 10; i++) {
      assert.equal(run.level, i);
      assert.equal(run.history.length, i);
      run = win(run);
      assert.equal(run.result.passed, true, `level ${i+1}`);
      assert.equal(run.result.score, 100);
      assert.ok(run.result.criteria.every(c => c.passed));
      assert.equal(run.result.decisions.length, fieldKeys[i].length);
      assert.equal(run.result.blocked, 3);
      assert.equal(run.result.useful, 100);
      assert.equal(run.history.length, i+1);
      assert.equal(run.history[i].level, i+1);
      assert.equal(run.history[i].result.passed, true);
      assert.equal(run.score, (i+1)*100);
      assert.equal(run.attempts.length, i+1);
      assert.throws(() => replay(run), 'a replay cannot award the same win twice');
      assert.throws(() => retryLevel(run), 'a won level cannot be retried for points');
      run = nextLevel(run);
      assert.equal(run.phase, i === 9 ? 'completed' : 'evaluate');
      if (i < 9) {
        assert.deepEqual(run.answers, {});
        assert.equal(run.attempt, 1);
        assert.equal(run.result, null);
      }
    }
    assert.equal(run.score, 1000);
    assert.equal(run.history.length, 10);
    assert.equal(run.operatorId, 'aegis');
    assert.equal(run.operatorName, 'Aegis');
    assert.throws(() => nextLevel(run));
    assert.throws(() => retryLevel(run));
  });

  test(`${campaignId}: wrong probes, blanket freezes, and cosmetic warnings cannot unlock any level`, () => {
    for (let i = 0; i < 10; i++) {
      const checkpoint = atLevel(campaignId,i);
      for (const [quality,attack] of [['targeted','noise'],['targeted','consensus'],['blanket','provenance'],['cosmetic','provenance']]) {
        const result = replay(answerAll(toAssure(checkpoint,quality,attack)));
        assert.equal(result.result.passed, false, `level ${i+1}: ${quality}/${attack}`);
        assert.equal(result.level, i);
        assert.equal(result.score, checkpoint.score);
        assert.deepEqual(result.history, checkpoint.history);
        assert.equal(result.attempts.at(-1).passed, false);
        assert.ok(result.result.criteria.some(c => !c.passed));
        assert.throws(() => nextLevel(result));
        assert.throws(() => replay(result));
        if (quality === 'blanket') {
          assert.equal(result.result.blocked, 3);
          assert.ok(result.result.useful < 80);
          assert.ok(result.metrics.continuity < checkpoint.metrics.continuity);
        }
        if (quality === 'cosmetic') {
          assert.equal(result.result.blocked, 0);
          assert.ok(result.metrics.exposure > checkpoint.metrics.exposure);
        }
        if (attack !== 'provenance') assert.equal(result.finding.successful, false);
      }
    }
  });

  test(`${campaignId}: every required governance decision is a real gate, even with a correct attack and control`, () => {
    for (let i = 2; i < 10; i++) {
      const prepared = answerAll(toAssure(atLevel(campaignId,i)));
      for (const field of current(prepared).challenge.fields) {
        const good = expectedAnswer(field.key,i);
        const bad = field.kind === 'order' ? [...good].reverse() : [field.options.find(o => !good.includes(o.id)).id];
        const result = replay(answerChallenge(prepared,field.key,bad));
        assert.equal(result.result.passed,false, `level ${i+1}: ${field.key}`);
        assert.equal(result.result.decisions.find(d => d.key === field.key).passed,false);
        assert.equal(result.score,prepared.score);
        assert.deepEqual(result.history,prepared.history);
        assert.throws(() => nextLevel(result));
      }
      const unanswered = replay(toAssure(atLevel(campaignId,i)));
      assert.equal(unanswered.result.passed,false);
      assert.ok(unanswered.result.decisions.every(d => !d.passed));
    }
  });

  test(`${campaignId}: final pipeline must be complete and ordered, not merely contain the right steps`, () => {
    for (const i of [8,9]) {
      const run = answerAll(toAssure(atLevel(campaignId,i)));
      const order = expectedAnswer('pipeline',i);
      for (let position = 0; position < order.length-1; position++) {
        const wrong = [...order];
        [wrong[position],wrong[position+1]] = [wrong[position+1],wrong[position]];
        assert.equal(replay(answerChallenge(run,'pipeline',wrong)).result.passed,false);
      }
      assert.equal(replay(answerChallenge(run,'pipeline',order.slice(0,-1))).result.passed,false);
      assert.equal(replay(answerChallenge(run,'pipeline',order)).result.passed,true);
    }
  });
}

test('multi-select release gates require every condition and reject unrelated conditions', () => {
  for (const i of [6,7,8,9]) {
    const run = answerAll(toAssure(atLevel('atlas',i)));
    const answer = expectedAnswer('release',i);
    assert.equal(replay(answerChallenge(run,'release',[...answer].reverse())).result.passed,true, 'set order is irrelevant');
    assert.equal(replay(answerChallenge(run,'release',answer.slice(1))).result.passed,false, 'omitting a required condition fails');
    assert.equal(replay(answerChallenge(run,'release',[...answer,'urgency'])).result.passed,false, 'adding an unsafe condition fails');
  }
});

test('retries restore the mission checkpoint and cannot farm score or compound retry damage', () => {
  const checkpoint = atLevel('atlas',5);
  let run = checkpoint;
  for (const quality of ['blanket','cosmetic','blanket']) {
    run = replay(answerAll(toAssure(run,quality)));
    assert.equal(run.result.passed,false);
    assert.notDeepEqual(run.metrics,checkpoint.metrics);
    assert.equal(run.score,500);
    const attempts = run.attempts.length;
    run = retryLevel(run);
    assert.equal(run.phase,'evaluate');
    assert.equal(run.level,5);
    assert.deepEqual(run.metrics,checkpoint.metrics);
    assert.deepEqual(run.history,checkpoint.history);
    assert.deepEqual(run.answers,{});
    assert.equal(run.attempts.length,attempts);
    for (const key of ['selectedAttack','selectedControl','finding','governance','result','levelStartMetrics']) assert.equal(run[key],null);
  }
  assert.equal(run.attempt,4);
  run = win(run);
  assert.equal(run.result.attempt,4);
  assert.equal(run.score,600);
  assert.equal(run.history.length,6);
  assert.deepEqual(run.attempts.filter(a => a.level === 6).map(a => a.passed),[false,false,false,true]);
  assert.throws(() => retryLevel(run));
  run = nextLevel(run);
  assert.equal(run.level,6);
  assert.equal(run.attempt,1);
});

test('failed challenges preserve the checkpoint including a non-default valid system state', () => {
  const checkpoint = {...createRun('prism'),metrics:{continuity:84,trust:77,exposure:19,review:14}};
  const failed = replay(toAssure(checkpoint,'cosmetic'));
  const retried = retryLevel(failed);
  assert.deepEqual(retried.metrics,checkpoint.metrics);
  assert.equal(retried.score,0);
  const recovery = win(retried);
  assert.equal(recovery.result.passed,true);
  assert.ok(recovery.result.useful < 100);
  assert.equal(recovery.result.metricDeltas.continuity,recovery.metrics.continuity-checkpoint.metrics.continuity);
});

test('single-answer, multi-answer, and ordering inputs reject invalid IDs or duplicates', () => {
  const run = toAssure(atLevel('prism',9));
  assert.throws(() => answerChallenge(run,'missing',[]));
  assert.throws(() => answerChallenge(run,'authority','policy'));
  assert.throws(() => answerChallenge(run,'authority',['policy','record']));
  assert.throws(() => answerChallenge(run,'authority',['not-an-option']));
  assert.throws(() => answerChallenge(run,'release',['lineage','lineage']));
  assert.throws(() => answerChallenge(run,'pipeline',['evidence','evidence']));
  const input = ['policy'];
  const answered = answerChallenge(run,'authority',input);
  input[0] = 'external';
  assert.deepEqual(answered.answers.authority,['policy'], 'answer arrays are copied');
  assert.deepEqual(answerChallenge(answered,'authority',[]).answers.authority,[], 'the UI may clear a choice');
});

test('phase guards reject skipping evaluation, governance, replay, and retry prerequisites', () => {
  const start = atLevel('atlas',2);
  const evaluated = evaluateAttack(start,attackFor(start));
  const governed = applyGovernance(evaluated,controlFor(evaluated));
  const failed = replay(governed);
  for (const run of [start,evaluated]) {
    assert.throws(() => answerChallenge(run,'authority',['policy']));
    assert.throws(() => replay(run));
    assert.throws(() => nextLevel(run));
    assert.throws(() => retryLevel(run));
  }
  assert.throws(() => applyGovernance(start,controlFor(start)));
  assert.throws(() => evaluateAttack(evaluated,attackFor(evaluated)));
  assert.throws(() => evaluateAttack(governed,attackFor(governed)));
  assert.throws(() => applyGovernance(governed,controlFor(governed)));
  assert.throws(() => answerChallenge(failed,'authority',['policy']));
  assert.throws(() => evaluateAttack(start,'l10-provenance'));
  assert.throws(() => applyGovernance(evaluated,'l10-targeted'));
});

test('save integrity requires sequential successful history with matching score', () => {
  const completeLevel = win(atLevel('atlas',9));
  for (const corrupt of [
    r => r.history.splice(3,1),
    r => {r.history[3] = structuredClone(r.history[2]);},
    r => {r.history[3].result.passed = false;},
    r => {r.history[3].level = 9;},
    r => {r.history[3].id = 'level-9';},
    r => {r.score += 100;}
  ]) {
    const run = saved(completeLevel);
    corrupt(run);
    assert.throws(() => nextLevel(run));
  }
  assert.throws(() => evaluateAttack({...createRun('atlas'),level:9},'l10-provenance'), 'cannot jump to the last mission without nine wins');
  assert.throws(() => evaluateAttack({...createRun('atlas'),metrics:{continuity:100,trust:NaN,exposure:0,review:0}},'l1-provenance'));
  assert.throws(() => evaluateAttack({...createRun('atlas'),level:10},'l10-provenance'));
  const failed = replay(toAssure(createRun('atlas'),'cosmetic'));
  for (const changed of [{result:null},{levelStartMetrics:null},{levelStartMetrics:{continuity:100}},{levelStartMetrics:{...failed.levelStartMetrics,review:-1}}]) {
    assert.throws(() => retryLevel({...failed,...changed}));
  }
});

test('all state transitions leave deeply frozen input untouched', () => {
  const start = atLevel('atlas',2);
  const evaluated = unchanged(r => evaluateAttack(r,attackFor(r)),start);
  const governed = unchanged(r => applyGovernance(r,controlFor(r)),evaluated);
  const answered = unchanged(r => answerChallenge(r,'authority',['policy']),governed);
  const beaten = unchanged(replay,answered);
  unchanged(nextLevel,beaten);
  const failure = replay(toAssure(atLevel('prism',2),'blanket'));
  unchanged(retryLevel,failure);
});

test('JSON save and resume preserves gates, retry history, selected answers, and ten earned wins', () => {
  let run = {...createRun('prism'),operatorId:'cipher',operatorName:'Cipher'};
  for (let i = 0; i < 10; i++) {
    if (i === 4) {
      run = saved(replay(answerAll(toAssure(run,'cosmetic'))));
      assert.equal(run.result.passed,false);
      run = saved(retryLevel(run));
      assert.equal(run.attempt,2);
    }
    run = saved(evaluateAttack(run,attackFor(run)));
    run = saved(applyGovernance(run,controlFor(run)));
    for (const field of current(run).challenge.fields) run = saved(answerChallenge(run,field.key,expectedAnswer(field.key,i)));
    run = saved(replay(run));
    assert.equal(run.result.passed,true);
    run = saved(nextLevel(run));
  }
  assert.equal(run.phase,'completed');
  assert.equal(run.score,1000);
  assert.equal(run.history.length,10);
  assert.equal(run.attempts.length,11);
  assert.equal(run.operatorId,'cipher');
  assert.equal(run.history[4].result.attempt,2);
});

test('correct attack and control placement varies across missions', () => {
  for (const campaign of Object.values(CAMPAIGNS)) {
    assert.equal(new Set(campaign.levels.map(l => l.attacks.findIndex(a => a.id.endsWith('-provenance')))).size,3);
    assert.equal(new Set(campaign.levels.map(l => l.controls.findIndex(c => c.quality === 'targeted'))).size,3);
  }
});

test('persisted-state validation accepts every real phase and returns a detached known-field clone', () => {
  for (const campaign of ['atlas','prism']) {
    let run = createRun(campaign);
    for (let i = 0; i < 10; i++) {
      run = validateRun(saved(run));
      run = validateRun(evaluateAttack(run,attackFor(run)));
      run = validateRun(applyGovernance(run,controlFor(run)));
      for (const field of current(run).challenge.fields) run = validateRun(answerChallenge(run,field.key,expectedAnswer(field.key,i)));
      run = validateRun(replay(run));
      run = validateRun(nextLevel(run));
    }
    assert.equal(run.phase,'completed');
  }
  const original = {...createRun('atlas'),operatorId:'cipher',operatorName:'Cipher',unrecognized:{text:'discard this'}};
  const clean = validateRun(original);
  assert.equal(Object.hasOwn(clean,'unrecognized'),false);
  assert.equal(clean.operatorId,'cipher');
  assert.notEqual(clean,original);
  assert.notEqual(clean.metrics,original.metrics);
  clean.metrics.trust=0;
  assert.equal(original.metrics.trust,100);
});

test('untrusted numeric display fields reject HTML, strings, fractions, and non-finite values', () => {
  for (const [field,values] of [
    ['level',['0','<img src=x onerror=alert(1)>',0.5,-1,10]],
    ['score',['0','<svg onload=alert(1)>',NaN,Infinity,-1,1001]],
    ['attempt',['1','<b>1</b>',0,0.5,Infinity,Number.MAX_SAFE_INTEGER]]
  ]) for (const value of values) assert.throws(() => validateRun({...createRun('atlas'),[field]:value}));
  for (const value of ['100','<img>',NaN,Infinity,100.5,-1,101]) {
    const run=createRun('atlas');run.metrics.trust=value;
    assert.throws(() => validateRun(run));
    assert.throws(() => evaluateAttack(run,'l1-provenance'));
  }
  const complete=win(atLevel('atlas',9));
  const invalid=saved(complete);invalid.history[0].score='<img src=x>';
  assert.throws(() => validateRun(invalid));
});

test('campaign IDs and prototype-backed state must not be coerced or inherited', () => {
  for (const id of [['atlas'],new String('atlas'),null,{},'constructor','toString','__proto__']) {
    assert.throws(() => createRun(id));
    assert.throws(() => validateRun({...createRun('atlas'),campaignId:id}));
  }
  assert.throws(() => validateRun(Object.create(createRun('atlas'))));
  const inherited=createRun('atlas');inherited.metrics=Object.create(inherited.metrics);
  assert.throws(() => validateRun(inherited));
  const extra=createRun('atlas');extra.metrics=JSON.parse('{"continuity":100,"trust":100,"exposure":0,"review":0,"__proto__":{"polluted":true}}');
  assert.throws(() => evaluateAttack(extra,'l1-provenance'));
  assert.equal({}.polluted,undefined);
  const constructorMetric=createRun('atlas');constructorMetric.metrics.constructor=1;
  assert.throws(() => evaluateAttack(constructorMetric,'l1-provenance'));
});

test('malformed answer containers and sparse direct selections fail before replay', () => {
  const run=toAssure(atLevel('atlas',2));
  for (const answers of [null,[],{authority:'policy'},{authority:{length:1}},{authority:[null]},{authority:['policy','policy']},{unknown:[]}]) {
    const damaged={...run,answers};
    assert.throws(() => validateRun(damaged));
    assert.throws(() => replay(damaged));
  }
  assert.throws(() => answerChallenge(run,'authority',new Array(1)));
  const inherited={...run,answers:Object.create({authority:['policy']})};
  assert.throws(() => replay(inherited));
  const huge=new Array(1000000000);
  assert.throws(() => answerChallenge(run,'authority',huge));
});

test('oversized or non-array attempt history is rejected before allocation and spreading', () => {
  const run=toAssure(createRun('atlas'),'cosmetic');
  for (const attempts of ['x'.repeat(10000),{length:200},new Array(1000000000),Array.from({length:201},()=>null)]) {
    assert.throws(() => replay({...run,attempts}));
    assert.throws(() => validateRun({...run,attempts}));
  }
  const failed=replay(run),oldAttempt=failed.attempts[0];
  const retry=retryLevel(failed);
  let ready=toAssure(retry,'cosmetic');
  ready={...ready,attempt:201,attempts:Array.from({length:200},(_,i)=>({...structuredClone(oldAttempt),attempt:i+1}))};
  const replayed=replay(ready);
  assert.equal(replayed.attempts.length,200);
  assert.equal(replayed.attempts[0].attempt,2);
  assert.equal(replayed.attempts.at(-1).attempt,201);
  assert.doesNotThrow(() => validateRun(replayed));
});

test('bounded persisted structures reject cycles, getters, excessive nesting, and oversized text', () => {
  const run=toAssure(atLevel('atlas',2));
  const cycle={...run};cycle.answers={authority:cycle};
  assert.throws(() => validateRun(cycle));
  let calls=0;
  const getter={...run};Object.defineProperty(getter,'score',{enumerable:true,get(){calls++;return 200;}});
  assert.throws(() => validateRun(getter));
  assert.equal(calls,0);
  const hiddenGetter={...run};Object.defineProperty(hiddenGetter,'extra',{enumerable:true,get(){calls++;return 'unused';}});
  assert.throws(() => validateRun(hiddenGetter));
  assert.equal(calls,0);
  const large=saved(run);large.finding.summary='x'.repeat(4097);
  assert.throws(() => validateRun(large));
  const deep=saved(run);let nested={};deep.finding.summary=nested;
  for(let i=0;i<20;i++){nested.next={};nested=nested.next;}
  assert.throws(() => validateRun(deep));
});

test('result and history scores must match their bounded rubric and actual gate results', () => {
  const finished=win(atLevel('prism',9));
  for(const mutate of [
    run=>{run.result.criteria[0].passed='true';},
    run=>{run.result.criteria=null;},
    run=>{run.result.decisions[0].selected='policy';},
    run=>{run.result.variants[0].blocked='false';},
    run=>{run.result.score=99;},
    run=>{run.result.rubric.governance=19;},
    run=>{run.history[0].score=99;run.score=999;},
    run=>{run.history[0].score=-1;run.score=899;},
    run=>{run.history[0].finding.successful='false';},
    run=>{run.result.metricDeltas.review=1;},
    run=>{run.phase='unknown';}
  ]) {
    const damaged=saved(finished);mutate(damaged);
    assert.throws(() => validateRun(damaged));
  }
  assert.throws(() => validateRun({...createRun('atlas'),phase:'completed'}));
});

test('missing checkpoints cannot silently change replay usefulness or produce invalid retry state', () => {
  const run=toAssure(createRun('atlas'));
  for(const checkpoint of [null,{},[],{continuity:100,trust:100,exposure:0,review:'0'}]) {
    assert.throws(() => replay({...run,levelStartMetrics:checkpoint}));
  }
  const failed=replay(toAssure(createRun('atlas'),'cosmetic'));
  const maximum={...failed,attempt:Number.MAX_SAFE_INTEGER-1,result:{...failed.result,attempt:Number.MAX_SAFE_INTEGER-1}};
  assert.doesNotThrow(() => validateRun(maximum));
  assert.throws(() => retryLevel(maximum));
});
