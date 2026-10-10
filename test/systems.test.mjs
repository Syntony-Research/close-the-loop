import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateDynamics } from '../src/systems.mjs';
test('delayed controls preserve the conservation of work and show displaced costs',()=>{
  const m=simulateDynamics({pressure:18,delay:3,policy:'adaptive'});
  assert.equal(m.final.baseline,78);
  assert.ok(m.final.controlled<m.final.baseline);
  assert.ok(m.final.deferred>0);
  assert.equal(6+18*12,m.final.controlled+m.final.completed+m.final.deferred);
});
test('longer delays increase the maximum queue before intervention',()=>{
  const peak=delay=>Math.max(...simulateDynamics({pressure:18,delay,policy:'adaptive'}).points.map(p=>p.controlled));
  assert.ok(peak(6)>peak(1));
});
test('stopping intake shifts work to deferred arrivals',()=>{
  const m=simulateDynamics({pressure:18,delay:0,policy:'block-all'});
  assert.equal(m.final.controlled,0);assert.equal(m.final.deferred,216);
});
test('below-capacity demand clears the queue without deferral',()=>{
  const m=simulateDynamics({pressure:6,delay:0,policy:'adaptive'});
  assert.equal(m.final.controlled,0);assert.equal(m.final.deferred,0);
});
