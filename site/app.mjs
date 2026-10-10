import { SCENARIOS, CONTROLS, evaluate, makePack, markdownReport } from './engine.mjs?v=20261009-3';
import { createSignal } from './signal.mjs?v=20261009-3';
import { mountSystems } from './systems.mjs?v=20261009-3';
import {arenaAuth,mountAuthPanel} from './arena-auth.mjs?v=20261009-3';
mountSystems();

const $=id=>document.getElementById(id);
const signal=createSignal($('signal-canvas'));
const formIds=['payload','control','owner','decision','retest','notes'];
const storeKey='syntony-close-the-loop-v1';
let drafts={},current=SCENARIOS[0].id,completed={},lastRun=null,running=false,runToken=0;
try { const saved=JSON.parse(localStorage.getItem(storeKey)||'{}');drafts=saved.drafts||{};completed=saved.completed||{};if(typeof saved.repo==='string')$('repo').value=saved.repo; } catch {}
const selected=()=>SCENARIOS.find(s=>s.id===current);
function persist(){
  const draft=Object.fromEntries(formIds.map(id=>[id,$(id).value]));drafts[current]=draft;
  try{localStorage.setItem(storeKey,JSON.stringify({drafts,completed,repo:$('repo').value}));}catch{}
}
function setText(id,value){if($(id))$(id).textContent=value;}
function tag(text,className=''){const span=document.createElement('span');span.textContent=text;span.className=className;return span;}
function emptyResult(){
  lastRun=null;if($('score-ring-progress'))$('score-ring-progress').style.strokeDashoffset='163.36';setText('score-value','—');setText('score-caption','80 points for test evidence · 20 for record completeness');setText('run-status','Ready to evaluate');
  $('run-status').dataset.state='ready';
  $('trace').replaceChildren(tag('Run your payload to inspect how the simulated workflow handles it.','empty-state'));
  $('comparison').replaceChildren();$('regression-list').replaceChildren(tag('Control checks and useful-task tests will appear here.','empty-state'));
  ['export-json','export-md','github-draft'].forEach(id=>$(id).disabled=true);
}
function switchMission(id,initial=false){
  if(!initial)persist();runToken++;running=false;$('run-btn').disabled=false;
  current=id;const s=selected(),draft=drafts[id]||{};
  setText('mission-title',s.title);setText('mission-description',s.description);
  setText('systems-lens',s.systemsLens);setText('affected-people',s.affected);setText('feedback-insight',s.feedback);
  setText('mission-objective',s.objective);setText('mission-policy',s.policy);setText('mission-surface',s.surface);
  $('payload').value=typeof draft.payload==='string'?draft.payload:s.defaultPayload;
  $('control').value=CONTROLS.some(c=>c.id===draft.control)?draft.control:'none';
  for(const key of ['owner','decision','retest','notes'])$(key).value=draft[key]||'';
  document.querySelectorAll('[data-scenario]').forEach(el=>{const yes=el.dataset.scenario===id;el.classList.toggle('active',yes);el.setAttribute('aria-pressed',String(yes));});
  signal.setMission(SCENARIOS.findIndex(x=>x.id===id));emptyResult();updateProgress();
}
function updateProgress(){
  document.querySelectorAll('[data-scenario]').forEach(el=>{
    const isComplete=Boolean(completed[el.dataset.scenario]);el.classList.toggle('completed',isComplete);
    el.setAttribute('aria-label',`${SCENARIOS.find(s=>s.id===el.dataset.scenario)?.title}${isComplete?' — loop completed':''}`);
  });
  const count=SCENARIOS.filter(s=>completed[s.id]).length;
  setText('mission-progress',`${count} / ${SCENARIOS.length} loops completed`);
}
function readPack(){return makePack({scenarioId:current,payload:$('payload').value,controlId:$('control').value,owner:$('owner').value,decision:$('decision').value,retest:$('retest').value,notes:$('notes').value});}
function updateScore(){
  if(!lastRun)return;
  const pack=readPack();setText('score-value',String(pack.totalScore));
  if($('score-ring-progress'))$('score-ring-progress').style.strokeDashoffset=String(163.36*(1-pack.totalScore/100));
  setText('score-caption',`${pack.evidence.technicalScore}/80 test evidence · ${pack.governance.completenessScore}/20 record completeness`);
  const closed=pack.evidence.before.breached&&!pack.evidence.after.breached&&pack.evidence.regression.passed===pack.evidence.regression.total&&pack.governance.completenessScore===20;
  if(closed){completed[current]=true;signal.pulse('sealed');}
  updateProgress();persist();
}
function renderComparison(result){
  const before=document.createElement('div');before.className='comparison-item before';
  before.append(tag('BASELINE','eyebrow'),tag(result.before.breached?'Boundary crossed':result.before.recognized?'Boundary held':'No tool call found','comparison-state'),tag(result.before.summary,'comparison-detail'));
  const after=document.createElement('div');after.className='comparison-item after';
  after.append(tag('WITH YOUR CONTROL','eyebrow'),tag(result.after.breached?'Still vulnerable':result.after.recognized?'Boundary held':'No tool call found','comparison-state'),tag(result.after.summary,'comparison-detail'));
  $('comparison').replaceChildren(before,after);
  $('regression-list').replaceChildren(...result.regression.cases.map(c=>{
    const row=document.createElement('div');row.className=`regression-row ${c.passed?'passed':'failed'}`;
    row.append(tag(c.passed?'✓':'×','case-icon'),tag(c.name,'case-name'),tag(c.kind==='benign'?'USEFUL TASK':'ATTACK VARIANT','case-kind'));
    return row;
  }));
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  if(!arenaAuth.require({practice:true}))return;
  if(running)return;const token=++runToken;running=true;$('run-btn').disabled=true;
  for(const id of ['export-json','export-md','github-draft'])$(id).disabled=true;
  setText('run-status','Tracing the workflow…');$('run-status').dataset.state='running';$('trace').replaceChildren();
  try{
    const result=evaluate(current,$('payload').value,$('control').value);
    const events=[...result.before.events.map(e=>({...e,phase:'Baseline'})),...result.after.events.map(e=>({...e,phase:'Controlled'}))];
    for(let i=0;i<events.length;i++){
      if(token!==runToken)return;
      const e=events[i],row=document.createElement('div');row.className=`trace-event ${e.status}`;
      row.append(tag(String(i+1).padStart(2,'0'),'trace-number'));
      const content=document.createElement('div');content.append(tag(`${e.phase} / ${e.stage}`,'trace-stage'),tag(e.detail,'trace-detail'));row.append(content,tag(e.status,'trace-badge'));$('trace').append(row);
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)await pause(100);
    }
    if(token!==runToken)return;lastRun=result;renderComparison(result);
    const useful=result.regression.cases.filter(c=>c.kind==='benign').every(c=>c.passed);
    const variantsHeld=result.regression.cases.filter(c=>c.kind==='attack').every(c=>c.passed);
    const verified=result.before.breached&&!result.after.breached&&variantsHeld&&useful;
    let status=!result.before.recognized?'No valid tool call — try the example format':!result.before.breached?'No failure reproduced — strengthen your test':result.after.breached?'Failure reproduced. Choose a control and re-test.':!variantsHeld?'Submitted action held, but attack variants still breach. Try another control.':!useful?'Attack blocked, but useful work broke. Try a narrower control.':'Boundary restored. Complete the decision record.';
    setText('run-status',status);$('run-status').dataset.state=result.after.breached||!variantsHeld?'breach':verified?'held':'ready';
    if(verified)signal.pulse('sealed');else if(result.after.breached||!variantsHeld)signal.pulse('breach');
    ['export-json','export-md','github-draft'].forEach(id=>$(id).disabled=false);updateScore();
  }catch(error){setText('run-status',error.message||'Unable to evaluate this payload.');$('run-status').dataset.state='error';}
  finally{if(token===runToken){running=false;$('run-btn').disabled=false;}}
}
function invalidate(){runToken++;running=false;$('run-btn').disabled=false;emptyResult();setText('run-status','Inputs changed — run to refresh evidence');persist();}
$('control').replaceChildren(...CONTROLS.map(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=c.label;option.title=c.description;return option;}));
$('run-btn').addEventListener('click',run);
$('sample-btn').addEventListener('click',()=>{$('payload').value=selected().defaultPayload;invalidate();$('payload').focus();});
for(const id of ['payload','control'])$(id).addEventListener('input',invalidate);
for(const id of ['owner','decision','retest','notes'])$(id).addEventListener('input',()=>{persist();updateScore();});
$('payload').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}});
document.querySelectorAll('[data-scenario]').forEach(el=>el.addEventListener('click',()=>switchMission(el.dataset.scenario)));
document.querySelectorAll('[data-stage]').forEach(el=>el.addEventListener('click',()=>{
  document.querySelectorAll('[data-stage]').forEach(x=>{x.classList.toggle('active',x===el);x.setAttribute('aria-pressed',String(x===el));});const panel=$(el.dataset.stage+'-panel');if(panel){panel.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});const field=panel.querySelector('textarea,input,select,button');field?.focus({preventScroll:true});}
}));
function download(type){
  if(!lastRun)return;const pack=readPack();
  const content=type==='json'?JSON.stringify(pack,null,2):markdownReport(pack);
  const blob=new Blob([content],{type:type==='json'?'application/json':'text/markdown'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`syntony-${current}.${type==='json'?'json':'md'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  setText('export-status',`${type==='json'?'Replayable JSON':'Evidence report'} downloaded. Review the record before sharing.`);
}
$('export-json').addEventListener('click',()=>download('json'));$('export-md').addEventListener('click',()=>download('md'));
$('repo').addEventListener('input',persist);
$('github-draft').addEventListener('click',()=>{
  const repo=$('repo').value.trim().replace(/^https:\/\/github\.com\//,'').replace(/\/$/,'');
  if(!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(repo)||repo.split('/')[1].endsWith('.git')){setText('github-status','Enter a repository as owner/repository. No access token is needed.');$('repo').focus();return;}
  if(!lastRun){setText('github-status','Run a challenge first to prepare its evidence summary.');return;}
  const p=readPack();
  const body=`## Syntony: Close the Loop\n\nDeterministic training simulation; synthetic data; not a real-system security finding.\n\nMission: ${selected().title}\nControl: ${p.controlId}\nTechnical score: ${p.evidence.technicalScore}/80\nRegression checks: ${p.evidence.regression.passed}/${p.evidence.regression.total}\nRecord completeness: ${p.governance.completenessScore}/20 (human review required)\n\n### Evidence\nDownload the JSON Evidence Pack and add it under submissions/ in a pull request to replay it in Actions. Attach a reviewed Markdown report here if useful.\n\n### Reviewer decision\n- [ ] Confirm reproduction and scope\n- [ ] Review owner, control, decision, and re-test plan\n- [ ] Record limitations\n\nNo sensitive payloads or organization details are included in this draft.`;
  const url=`https://github.com/${repo}/issues/new?title=${encodeURIComponent('[Challenge] '+selected().title)}&body=${encodeURIComponent(body)}`;
  const opened=window.open(url,'_blank','noopener,noreferrer');
  setText('github-status','GitHub draft requested in a new tab. Review and submit there; nothing is posted automatically.');persist();
});
switchMission(current,true);

mountAuthPanel($('auth-mount'));
arenaAuth.init();

document.addEventListener('syntony:before-signin',()=>persist());
