import {MISSION_CONTEXT} from './mission-context.js';

const BASE = 'https://www.syntonyresearch.ai';
export const SYNTONY_LINKS = Object.freeze({
  services: `${BASE}/services/`,
  evaluate: `${BASE}/services/#red-teaming`,
  govern: `${BASE}/services/#governance`,
  assure: `${BASE}/services/#continuous-assurance`,
  resonance: `${BASE}/assets/interactive/resonance.html`,
  govtune: `${BASE}/products/govtune-ai/#waitlist`,
  contact: `${BASE}/#contact`,
  government: `${BASE}/sectors/defense-government/`
});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = (key, label, className = '') => `<a class="${className}" href="${SYNTONY_LINKS[key]}" target="_blank" rel="noopener noreferrer">${label} <span aria-hidden="true">↗</span></a>`;

function productCards() {
  return `<div class="syntony-offerings">
    <article class="offering human-offering"><div class="offering-type">01 / HUMAN-LED SERVICES</div><div class="offering-visual human-visual" aria-hidden="true"><span>Evaluate</span><i>→</i><span>Govern</span><i>→</i><span>Assure</span></div><h3>Expertise for the<br>decision ahead.</h3><p>We work with your technical and decision teams to define the question, test the whole workflow, and turn findings into a response people can carry out.</p><ul class="service-links"><li>${link('evaluate','Red Teaming &amp; Evaluation')}</li><li>${link('govern','Governance &amp; Decision Support')}</li><li>${link('assure','Continuous Evaluation &amp; Assurance')}</li></ul>${link('services','EXPLORE SERVICES','offering-cta')}</article>
    <article class="offering resonance-offering"><div class="offering-type">02 / SOFTWARE · PUBLIC PREVIEW</div><div class="offering-visual map-visual" aria-hidden="true"><span>INPUT</span><i></i><span>AGENT</span><i></i><span>ACTION</span><b>TRACE THE PATH. TEST THE BOUNDARY.</b></div><h3>Resonance</h3><p>See how a failure could travel through an AI system. Connect attack paths to test evidence, controls, responsible teams, and the next decision.</p><span class="offering-status">In development · Explore an illustrative risk map</span>${link('resonance','EXPLORE RESONANCE','offering-cta')}</article>
    <article class="offering govtune-offering"><div class="offering-type">03 / SOFTWARE · JOIN THE WAITLIST</div><div class="offering-visual record-visual" aria-hidden="true"><span>TRACE <b>01</b></span><i>→</i><span>FINDING <b>02</b></span><i>→</i><span>DECISION <b>03</b></span></div><h3>GovTune AI</h3><p>From red-team traces to governance records. Being built to draft findings, candidate controls, ownership, and verification steps while keeping the source evidence connected.</p><span class="offering-status">In development · Human review stays in the loop</span>${link('govtune','JOIN THE GOVTUNE AI WAITLIST','offering-cta')}</article>
  </div>`;
}

export function renderAssuranceQuestion() {
  return `<details class="assurance-question"><summary><span class="micro">THE ASSURANCE QUESTION</span><strong>“We have SOC 2. Are we good?”</strong><span class="expand-symbol" aria-hidden="true">+</span></summary><div class="assurance-answer"><div><h3>Start with the assurance you have.<br>Test the decisions it needs to support.</h3><p>A SOC 2 report provides evidence about controls within its defined scope. Your AI deployment still needs evidence for its particular uses, failure modes, and consequences. Check what the report actually covers, then test the remaining questions.</p><a class="source-link" href="https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services" target="_blank" rel="noopener noreferrer">About SOC reports · AICPA &amp; CIMA ↗</a></div><ol><li><b>Can the workflow be redirected?</b><span>Test model behavior together with data, tools, vendors, permissions, and handoffs.</span></li><li><b>What happens to people when it fails?</b><span>Examine reliability, misuse, unequal impacts, incentives, escalation, and service continuity.</span></li><li><b>Who decides—and when do we test again?</b><span>Keep ownership, release conditions, uncertainty, and material changes tied to replayable evidence.</span></li></ol></div></details>`;
}

export function renderSyntony({compact = false, campaign = null} = {}) {
  const government = campaign === 'prism';
  return `<section class="syntony-section ${compact ? 'syntony-compact' : ''}" ${compact ? '' : 'id="syntony"'} aria-label="Syntony services and software products"><div class="syntony-intro"><div><div class="eyebrow">SYNTONY / BEYOND THE SIMULATION</div><h2>Human judgment.<br><em>Connected evidence.</em></h2></div><p>A finding is useful when someone can act on it. Syntony brings human-led evaluation, governance, and assurance together with software that keeps the evidence connected—from the first test to the next release.</p></div>${productCards()}${compact ? '' : renderAssuranceQuestion()}<div class="syntony-handoff"><div><span class="micro">${government ? 'FOR MISSION OWNERS, ACQUISITION & AUTHORIZATION TEAMS' : 'FOR AI, SECURITY, PRODUCT & GOVERNANCE LEADERS'}</span><h3>${government ? 'Which mission decision needs stronger evidence?' : 'Bring the decision your team needs to make.'}</h3><p>${government ? 'Scope mission evaluation, vendor evidence, decision rights, and retesting around the system you intend to use.' : 'Preparing a release, choosing a vendor, responding to a finding, or reviewing AI already in use? Start with that question.'}</p></div>${link(government ? 'government' : 'contact',government ? 'EXPLORE GOVERNMENT SERVICES' : 'DISCUSS YOUR SYSTEM','primary')}</div><p class="syntony-scope">BLACKLINE is a fictional learning exercise. A real engagement defines the system, evidence, scope, and limits with your team. Software supports the work; accountable people make the decisions.</p></section>`;
}

export function renderMissionContext(campaign, index) {
  const context = MISSION_CONTEXT[campaign][index];
  return `<div class="mission-context"><span class="micro">THE HUMAN STAKES / ${esc(context.focus)}</span><p>${esc(context.question)}</p></div>`;
}

export function renderRealWorldDebrief(campaign, index) {
  const context = MISSION_CONTEXT[campaign][index];
  return `<aside class="real-world-debrief"><div class="eyebrow">FROM THIS MISSION TO YOUR SYSTEM</div><h3>The next step takes people and evidence.</h3><p>${esc(context.practice)}</p><p class="evidence-needed"><b>Evidence to bring into the room</b>${esc(context.evidence)}</p><div class="debrief-links">${link('services','HUMAN-LED SERVICES')}${link('resonance','RESONANCE')}${link('govtune','GOVTUNE AI WAITLIST')}</div><span class="debrief-limit">Your game result is a learning record. It does not establish assurance for a real deployment.</span></aside>`;
}

export function renderPracticeNote(phase) {
  const notes = {
    evaluate: ['START WITH THE QUESTION','Human-led red teaming tests the workflow in its intended use: the technology, the people, and the consequences.', 'evaluate', 'EXPLORE EVALUATION', 'resonance', 'Map the paths with Resonance'],
    govern: ['MAKE THE FINDING ACTIONABLE','Bring engineers and decision-makers to the same evidence. Agree the owner, response, and limits of the decision.', 'govern', 'EXPLORE GOVERNANCE', 'govtune', 'Join the GovTune AI waitlist'],
    assure: ['KEEP THE LOOP RUNNING','Version the test. Revisit the release decision when the model, tools, policy, or operating context changes.', 'assure', 'EXPLORE ASSURANCE', 'resonance', 'Explore Resonance'],
    debrief: ['ONE RECORD. ACCOUNTABLE PEOPLE.','Finding → evidence → owner → control → decision → retest. Keep the chain intact in your operational pipeline.', 'services', 'EXPLORE SYNTONY SERVICES', 'govtune', 'Join the GovTune AI waitlist']
  };
  const n = notes[phase] || notes.debrief;
  return `<section class="panel practice-note"><div class="micro">SYNTONY / ${n[0]}</div><p>${n[1]}</p>${link(n[2],n[3])}${link(n[4],n[5],'practice-product')}</section>`;
}

export function realWorldHandoff(campaign, index) {
  return {purpose:'Learning record for a fictional scenario; not a real-system assurance finding.', question:MISSION_CONTEXT[campaign][index].question, evidenceNeeded:MISSION_CONTEXT[campaign][index].evidence, nextStep:'Define the intended use, system boundary, responsible decision-makers, evidence, and retest conditions with your team.', services:SYNTONY_LINKS.services, products:{Resonance:SYNTONY_LINKS.resonance,GovTuneAIWaitlist:SYNTONY_LINKS.govtune}};
}
