// Transparent teaching model; dimensionless synthetic cycles, not a forecast.
export function simulateDynamics({pressure=18,delay=3,policy='adaptive'}={}) {
  if(!Number.isInteger(pressure)||pressure<6||pressure>24||!Number.isInteger(delay)||delay<0||delay>6||!['adaptive','block-all','observe'].includes(policy))throw new RangeError('Invalid teaching-model inputs.');
  const capacity=12,target=6,steps=12;
  let baseline=target,controlled=target,deferred=0,completed=0;
  const points=[{step:0,baseline,controlled,deferred,completed}];
  for(let step=1;step<=steps;step++){
    let admitted=pressure;
    if(step>delay){
      if(policy==='block-all')admitted=0;
      if(policy==='adaptive')admitted=Math.min(pressure,controlled>target?capacity-3:capacity);
    }
    baseline=Math.max(0,baseline+pressure-capacity);
    const done=Math.min(capacity,controlled+admitted);
    controlled=Math.max(0,controlled+admitted-done);
    deferred+=pressure-admitted;completed+=done;
    points.push({step,baseline,controlled,deferred,completed});
  }
  return {capacity,target,steps,points,final:points.at(-1)};
}
export function mountSystems(){
  const $=id=>document.getElementById(id);if(!$('dynamics-chart'))return;
  function render(){
    const pressure=Number($('pressure').value),delay=Number($('delay').value),policy=$('response-policy').value;
    const model=simulateDynamics({pressure,delay,policy});
    $('pressure-value').textContent=`${pressure} tasks / cycle`;$('delay-value').textContent=`${delay} cycles`;
    $('queue-value').textContent=String(model.final.controlled);$('uncontrolled-value').textContent=String(model.final.baseline);$('deferred-value').textContent=String(model.final.deferred);
    const max=Math.max(24,...model.points.flatMap(p=>[p.baseline,p.controlled]));
    const path=key=>model.points.map((p,i)=>`${i?'L':'M'}${36+p.step/12*524},${174-p[key]/max*140}`).join(' ');
    $('baseline-line').setAttribute('d',path('baseline'));$('controlled-line').setAttribute('d',path('controlled'));
    $('chart-max').textContent=String(max);$('delay-marker').setAttribute('x1',String(36+delay/12*524));$('delay-marker').setAttribute('x2',String(36+delay/12*524));
    $('dynamics-chart').setAttribute('aria-label',`After 12 synthetic cycles: unchecked backlog ${model.final.baseline}, selected response backlog ${model.final.controlled}, deferred arrivals ${model.final.deferred}.`);
    $('model-conclusion').textContent=policy==='block-all'?'The queue falls, but access is curtailed: every new arrival is deferred after the response starts. A local metric can hide a cost elsewhere.':policy==='observe'?'Observation alone does not change the flow. If arrivals exceed review capacity, unresolved work keeps accumulating.':'The capacity response contains the queue by deferring new work. Those deferred arrivals still need an owner and an explicit service decision.';
    $('causal-map').dataset.policy=policy;
  }
  ['pressure','delay','response-policy'].forEach(id=>$(id).addEventListener('input',render));
  $('reset-dynamics').addEventListener('click',()=>{$('pressure').value=18;$('delay').value=3;$('response-policy').value='adaptive';render();});
  render();
}
