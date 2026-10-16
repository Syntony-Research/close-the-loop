import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun} from './dist/engine.js';
import {readSavedState} from './dist/saved-state.mjs';

const operators=['cipher','aegis'];
test('saved progress is validated and detached before it can enter the renderer',()=>{
  const run=createRun('atlas');
  const {saved,rejected}=readSavedState(JSON.stringify({modelId:'aegis',atlas:{run,modelId:'cipher'}}),operators);
  assert.deepEqual(rejected,[]);assert.equal(saved.modelId,'aegis');
  assert.deepEqual(saved.atlas.run,run);assert.notEqual(saved.atlas.run,run);
});
test('invalid saved HTML and prototype-shaped data never reach a resume card',()=>{
  const attack='<img src=x onerror=alert(1)>';
  for(const field of ['level','score','metrics','history']){
    const run={...createRun('atlas'),[field]:attack};
    const raw=JSON.stringify({modelId:attack,atlas:{run},['__proto__']:{prism:{run}}});
    assert.equal(Object.hasOwn(JSON.parse(raw),'__proto__'),true);
    const result=readSavedState(raw,operators);
    assert.equal(result.saved.atlas,undefined);assert.equal(result.saved.prism,undefined);
    assert.equal(result.saved.modelId,'cipher');assert.deepEqual(result.rejected,['atlas']);
    assert.equal(JSON.stringify(result.saved).includes(attack),false);
    assert.equal(Object.hasOwn(result.saved,'__proto__'),false);
    assert.equal(Object.getPrototypeOf(result.saved),Object.prototype);
  }
});
test('corrupt stream recovery preserves the other valid campaign',()=>{
  const valid=createRun('prism','aegis');
  const result=readSavedState(JSON.stringify({atlas:{run:{version:2}},prism:{run:valid,modelId:'aegis'}}),operators);
  assert.deepEqual(result.rejected,['atlas']);assert.equal(result.saved.prism.run.campaignId,'prism');
  assert.equal(result.saved.prism.modelId,'aegis');
});
test('malformed, oversized and mismatched save envelopes recover safely',()=>{
  for(const raw of ['{','null','[]','true','"value"',' '.repeat(2_000_001)]){
    assert.deepEqual(readSavedState(raw,operators),{saved:{mode:'game',modelId:'cipher'},rejected:['storage']});
  }
  const mismatch=readSavedState(JSON.stringify({atlas:{run:createRun('prism')}}),operators);
  assert.equal(mismatch.saved.atlas,undefined);assert.deepEqual(mismatch.rejected,['atlas']);
  assert.deepEqual(readSavedState(null,operators).rejected,[]);
});

 test('legacy campaigns keep their selected operator and new campaigns keep their bound operator',()=>{
  const legacy=createRun('atlas');delete legacy.operatorId;delete legacy.operatorState;delete legacy.operatorAction;
  const migrated=readSavedState(JSON.stringify({atlas:{run:legacy,modelId:'aegis'}}),operators);
  assert.equal(migrated.saved.atlas.run.operatorId,'aegis');
  assert.equal(migrated.saved.atlas.run.operatorState.remaining,3);
  const current=readSavedState(JSON.stringify({atlas:{run:createRun('atlas','cipher'),modelId:'aegis'}}),operators);
  assert.equal(current.saved.atlas.modelId,'cipher');
  assert.equal(current.saved.atlas.run.operatorId,'cipher');
});
