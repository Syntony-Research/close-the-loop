import {CAMPAIGNS, getOperatorStatus} from './engine.js?v=operators-1';
import {getOperator} from './operators.js?v=operators-1';
import {renderOperatorConsole} from './operator-ui.js?v=workbench-1';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phaseLabel=phase=>({evaluate:'EVALUATE',govern:'GOVERN',assure:'ASSURE',debrief:'DEBRIEF',completed:'COMPLETE'})[phase]||String(phase).toUpperCase();
const toolPhase=operator=>operator.id==='bastion'?'AFTER A FAILED REPLAY':`DURING ${phaseLabel(operator.phase)}`;

const FOCUS=Object.freeze({
  cipher:{title:'Where does a claim become an action?',prompt:'In your draft, distinguish the source’s claim from the consequential action it asks the system to take. WIRECUT lets you choose which edge to gate after evaluation.'},
  aegis:{title:'What would make this decision ready to ship?',prompt:'Name the permission the source claims and the work that must stay available. After you choose a control and decision answers, PREFLIGHT can expose gaps before replay.'},
  trace:{title:'Which assumption would another test challenge?',prompt:'Make one failure hypothesis explicit in the draft. If the route misses the boundary, RETRACE reopens evaluation so you can choose another test without completing a failed loop.'},
  relay:{title:'Which work should move, and which should wait?',prompt:'Identify the legitimate work alongside the disputed instruction. After evaluation, EXPRESS LANE lets you route verified and contested work separately.'},
  null:{title:'What evidence would justify running this test?',prompt:'Select a route and make its claimed authority explicit in the draft. SANDBOX previews that route without recording a finding; compare its trace before you commit.'},
  bastion:{title:'Which finding must survive a failed response?',prompt:'Describe the unauthorized action precisely enough to investigate again. If replay fails after you reproduce it, SECOND LINE preserves that finding and reopens the control decision.'},
  sigil:{title:'Is this source describing policy or inventing it?',prompt:'Locate the sentence that asks the agent to treat source text as an operating rule. After evaluation, DECODE removes a cosmetic response and surfaces the authorized rule.'},
  glitch:{title:'Could one source be masquerading as many?',prompt:'Draft the apparent agreement and identify whether its sources are independent. OVERDRIVE strengthens the consensus route only; it adds exposure and review pressure before evaluation.'},
  root:{title:'What could each control break while fixing this?',prompt:'State the harmful action and the useful work you need to preserve. After evaluation, FORK compares all three control paths before you commit to one.'}
});

function routeFor(run,attackId){
  const level=CAMPAIGNS[run.campaignId]?.levels[run.level];
  const id=run.phase==='evaluate'?attackId:run.selectedAttack;
  return level?.attacks.find(attack=>attack.id===id)||null;
}

export function renderWorkbenchFocus(run,{attackId=null}={}){
  const operator=getOperator(run.operatorId),focus=FOCUS[operator.id],route=routeFor(run,attackId);
  return `<section class="workbench-focus" aria-label="${esc(operator.name)} test focus"><span>${esc(operator.name.toUpperCase())} / FIELD QUESTION</span><h3>${esc(focus.title)}</h3><p>${esc(focus.prompt)}</p>${operator.id==='glitch'&&route?`<small>${route.id.endsWith('-consensus')?'SELECTED ROUTE: OVERDRIVE CAN BOOST THIS CONSENSUS TEST.':'SELECTED ROUTE: OVERDRIVE DOES NOT BOOST THIS ATTACK TYPE.'}</small>`:''}</section>`;
}

function renderUpcoming(operator,status,run){
  const phaseOrder=['evaluate','govern','assure','debrief','completed'];
  const closed=run.phase==='completed'||(run.phase==='debrief'&&run.result?.passed);
  const missed=phaseOrder.indexOf(run.phase)>phaseOrder.indexOf(operator.phase);
  const availability=closed?'This mission is closed. Unspent charges carry into the next mission.':missed?'This tool’s phase has closed for this attempt. Keep the charge for a later mission, or a new attempt if replay fails.':operator.id==='bastion'?'Recovery requires a failed replay and a reproduced original failure.':'Your tool becomes available at this stage of the loop. Standard mission tools remain available without spending a charge.';
  return `<section class="workbench-upcoming" aria-label="${esc(operator.name)} upcoming tool"><div class="workbench-tool-status"><span>${esc(operator.role)} / ${esc(operator.name)}</span><b>${status.remaining}/3 CHARGES</b></div><h3>${esc(operator.abilityName)}</h3><p>${esc(operator.summary)}</p><span class="workbench-tool-phase">${esc(toolPhase(operator))}</span><small>${status.remaining?esc(availability):'No tactical charges remain. Complete the mission with the standard evaluation, governance, and assurance tools.'}</small></section>`;
}

function renderRoute(run,route){
  return `<div class="workbench-route"><span>${run.phase==='evaluate'?'SELECTED ATTACK ROUTE':'RECORDED ATTACK ROUTE'}</span><strong>${route?esc(route.name):'Choose a route to begin'}</strong><p>${route?esc(route.description):'The selected route defines the simulated test. Your source text records the hypothesis you want to investigate.'}</p></div>`;
}

function renderPayload(run,route,payload,audit,busy){
  if(run.phase==='evaluate'){
    if(!route)return '<div class="workbench-empty"><b>Load an attack route.</b><p>Choose a route in the evaluation choices to open the source editor. Then write the fictional message and use your operator’s tool when its stage is ready.</p></div>';
    return `<div class="workbench-payload"><label for="attack-payload">INJECTED SOURCE TEXT · 20–1,200 CHARACTERS</label><textarea id="attack-payload" rows="5" minlength="20" maxlength="1200" spellcheck="false" ${busy?'disabled':''}>${esc(payload)}</textarea><div class="workbench-actions"><button class="text-button" data-action="audit-payload" ${busy?'disabled':''}>REVIEW ATTACK ELEMENTS ↗</button><button class="text-button" data-action="reset-payload" ${busy?'disabled':''}>RESTORE EXAMPLE ↻</button></div>${audit?`<p class="workbench-audit" role="status">${esc(audit)}</p>`:''}</div>`;
  }
  if(payload)return `<details class="workbench-source"><summary>VIEW CAPTURED SOURCE TEXT <span>OPERATOR-AUTHORED HYPOTHESIS</span></summary><pre>${esc(payload)}</pre><p>This is the draft captured for this evaluation. The route determines the simulated outcome.</p></details>`;
  return '<div class="workbench-empty workbench-captured"><b>Source draft is not available in this tab.</b><p>Draft text stays in the original tab and its evidence export. The recorded attack route and mission finding are still available; a saved run does not restore the authored text.</p></div>';
}

function renderSnapshot(run,route){
  if(run.operatorAction?.operatorId!=='null')return '';
  const level=CAMPAIGNS[run.campaignId].levels[run.level];
  const preview=level.attacks.find(attack=>attack.id===run.operatorAction.options.attackId);
  if(!preview)return '';
  return `<p class="workbench-snapshot-note"><b>SANDBOX SNAPSHOT: ${esc(preview.name)}</b> ${route&&route.id!==preview.id?'The current route is different. The preview below applies only to the route selected when SANDBOX was activated.':'The preview below records the route selected when SANDBOX was activated. Editing text does not rerun or change that preview.'}</p>`;
}

export function renderWorkbench(run,{attackId=null,payload='',audit='',tacticOptions={},busy=false,contextStatus=''}={}){
  const operator=getOperator(run.operatorId),status=getOperatorStatus(run),route=routeFor(run,attackId);
  const activePhase=run.phase===operator.phase&&(operator.id!=='bastion'||run.result?.passed===false);
  const fullConsole=activePhase||Boolean(run.operatorAction);
  return `<section class="redteam-workbench" style="--operator:${esc(operator.color)}" aria-label="Red-team workbench"><header class="workbench-header"><div class="workbench-identity"><span>RED-TEAM WORKBENCH / SIMULATION</span><h2>${esc(operator.name)} at the controls.</h2></div><span class="workbench-phase">${phaseLabel(run.phase)} / LEVEL ${String(run.level+1).padStart(2,'0')}</span></header><div class="workbench-layout"><div class="workbench-editor">${renderWorkbenchFocus(run,{attackId})}${renderRoute(run,route)}${renderPayload(run,route,String(payload??''),audit,busy)}</div><div class="workbench-tool ${fullConsole?'':'workbench-tool--standby'}">${renderSnapshot(run,route)}${fullConsole?renderOperatorConsole(run,{attackId:route?.id||null,options:tacticOptions,busy}):renderUpcoming(operator,status,run)}${contextStatus?`<p class="workbench-context" role="status">${esc(contextStatus)}</p>`:''}</div></div><p class="workbench-footnote">BLACKLINE simulates the selected attack route; your text is not AI-graded or sent to an AI. Drafts and authored evidence stay in this tab. Export before reloading or signing in. Evidence exports retain the latest 200 entries per campaign. Operator abilities spend campaign charges; no tool skips the required replay.</p></section>`;
}
