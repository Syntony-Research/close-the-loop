import {OPERATORS, getOperator} from './operators.js?v=operators-1';
import {getOperatorStatus} from './engine.js?v=operators-1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phaseName=phase=>({evaluate:'EVALUATE',govern:'GOVERN',assure:'ASSURE',debrief:'FAILED REPLAY'})[phase]||String(phase).toUpperCase();
function portrait(operator){
  const index=OPERATORS.findIndex(item=>item.id===operator.id);
  return `<div class="operator-portrait" style="--px:${index%3*50}%;--py:${Math.floor(index/3)*50}%;--operator:${esc(operator.color)}" aria-hidden="true"></div>`;
}
function charges(remaining){return `<div class="op-charge-bank" aria-label="${remaining} of 3 tactical charges remaining">${Array.from({length:3},(_,i)=>`<span class="${i<remaining?'charged':''}" aria-hidden="true"></span>`).join('')}<b>${remaining}/3</b></div>`;}

export function renderOperatorDossier(operator){
  return `<section class="operator-dossier" style="--operator:${esc(operator.color)}" aria-label="${esc(operator.name)} tactical kit">
    <div class="dossier-portrait">${portrait(operator)}<span>OPERATOR ${String(OPERATORS.findIndex(item=>item.id===operator.id)+1).padStart(2,'0')}</span></div>
    <div class="dossier-main"><div class="operator-role">${esc(operator.role)}</div><h3>${esc(operator.name)}<span>${esc(operator.alias)}</span></h3><p>${esc(operator.tagline||operator.clue)}</p><small>BOUND TO YOUR CAMPAIGN · EITHER MISSION STREAM</small></div>
    <div class="dossier-kit"><span class="kit-stage">SIGNATURE TOOL / ${phaseName(operator.phase)}</span><h4>${esc(operator.abilityName)}</h4><p>${esc(operator.summary)}</p><div class="kit-tradeoff">${esc(operator.tradeoff)}</div><div class="kit-charges">${charges(3)}<span>Three activations per campaign.<br>Choose your moment.</span></div></div>
  </section>`;
}

export function renderTacticalReport(action){
  if(!action)return '';
  const rows=action.report||[];
  const root=action.operatorId==='root';
  return `<div class="tactical-report"><header><span>TACTICAL RECORD / ${esc(action.abilityName)}</span><span>LEVEL ${String(action.level).padStart(2,'0')} · ATTEMPT ${esc(action.attempt)}</span></header><p>${esc(action.summary)}</p><div class="${root?'fork-grid':'report-lines'}">${rows.map(row=>`<article class="${root?'fork-card':row.value==='READY'?'tactical-check pass':row.value==='GAP'?'tactical-check fail':'tactical-check'}"><h4>${esc(row.label)}</h4><strong class="${root?'fork-metric':''}">${esc(row.value)}</strong><p>${esc(row.detail)}</p></article>`).join('')}</div></div>`;
}

export function renderOperatorConsole(run,{attackId=null,options={},busy=false}={}){
  const operator=getOperator(run.operatorId),status=getOperatorStatus(run);
  const used=status.used,locked=!status.available||busy;
  const picked=used?(run.operatorAction?.options||{}):options;
  let body='',needsInput=false;
  if(operator.id==='cipher'&&!used){
    body=`<fieldset class="wire-path"><legend>Place one gate on the action path</legend>${[['source','SOURCE → AGENT','Block the input'],['advice','AGENT → DECISION','Annotate the advice'],['action','DECISION → ACTION','Enforce at execution']].map(([value,label,detail])=>`<button class="wire-node ${picked.edge===value?'selected':''}" data-action="tactic-pick" data-key="edge" data-value="${value}" aria-pressed="${picked.edge===value}" ${locked?'disabled':''}><b>${label}</b><span>${detail}</span></button>`).join('')}</fieldset>`;
    needsInput=!['source','advice','action'].includes(picked.edge);
  }else if(operator.id==='relay'&&!used){
    body=`<div class="routing-board" aria-label="Allocate the work queues">${[['verified','VERIFIED WORK'],['contested','DISPUTED ACTIONS']].map(([key,label])=>`<div class="routing-row"><span class="route-label">${label}</span><div class="route-options" role="group" aria-label="${label}">${[['run','EXECUTE'],['review','REVIEW'],['hold','HOLD']].map(([value,title])=>`<button data-action="tactic-pick" data-key="${key}" data-value="${value}" aria-pressed="${picked[key]===value}" class="${picked[key]===value?'selected':''}" ${locked?'disabled':''}>${title}</button>`).join('')}</div></div>`).join('')}</div>`;
    needsInput=!picked.verified||!picked.contested;
  }else if(operator.id==='null'&&!used){
    body=`<p class="op-target">${attackId?'Selected attack ready for an isolated preview.':'Select an attack route below to load the sandbox.'}</p>`;
    needsInput=!attackId;
  }
  const reason=used?'TACTIC COMMITTED':status.available?'TOOL READY':status.reason;
  return `<section class="operator-console" style="--operator:${esc(operator.color)}" aria-label="${esc(operator.name)} operator console"><div class="op-console-head"><div class="op-identity">${portrait(operator)}<div class="op-title"><span>${esc(operator.role)} / ${esc(operator.name)}</span><h3>${esc(operator.abilityName)}</h3></div></div>${charges(status.remaining)}</div><div class="op-console-copy"><p>${esc(operator.summary)}</p><span class="op-status">${phaseName(operator.phase)} TOOL</span></div>${body}${!used?`<div class="op-action-body"><button class="op-activate" data-action="operator-ability" ${locked||needsInput?'disabled':''}>ACTIVATE ${esc(operator.abilityName)} <span>↗</span></button><p class="op-availability">${esc(reason)}${status.available&&needsInput?' · Choose the tool’s inputs first.':''}</p></div><p class="kit-tradeoff">${esc(operator.tradeoff)} One charge per activation; retries do not refund charges.</p>`:`<p class="op-availability">${esc(reason)} · ${status.remaining} CHARGES IN RESERVE</p>`}${renderTacticalReport(run.operatorAction)}</section>`;
}

export function renderOperatorResult(run){
  const operator=getOperator(run.operatorId);
  return `<section class="operator-result" style="--operator:${esc(operator.color)}"><div><span>${esc(operator.name)} / TACTICAL CONTRIBUTION</span><h3>${run.operatorAction?esc(operator.abilityName):'Charge conserved.'}</h3><p>${run.operatorAction?esc(run.operatorAction.summary):'This attempt used the standard mission tools. No tactical charge was spent.'}</p></div>${charges(getOperatorStatus(run).remaining)}</section>`;
}
