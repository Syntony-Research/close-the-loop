// Original fictional operators. This trusted catalog is shared by the game and UI.
// Each ability spends a campaign charge; retrying does not refund it.
export const OPERATORS = Object.freeze([
  Object.freeze({
    id: 'cipher', name: 'Cipher', alias: 'THE ARCHITECT', color: '#a4e3bd',
    lens: 'Boundary map',
    clue: 'Separate the request, the evidence, and the authority to act. A plausible instruction is not an authorization.',
    role: 'Boundary engineer', abilityName: 'WIRECUT', phase: 'govern',
    summary: 'Choose the source, advice, or action edge to cut. Cutting the action edge can turn a cosmetic control into effective containment.',
    tradeoff: 'Cutting the source caps useful work at 50%. Cutting advice does not enforce a boundary. The charge is spent whichever edge you choose.'
  }),
  Object.freeze({
    id: 'aegis', name: 'Aegis', alias: 'THE AUDITOR', color: '#e4a78c',
    lens: 'Decision audit',
    clue: 'Trace who owns the decision. A control should specify an accountable owner, a permitted action, and a condition for retesting.',
    role: 'Readiness auditor', abilityName: 'PREFLIGHT', phase: 'assure',
    summary: 'Inspect replay readiness and identify unanswered or incorrect decision checks before committing to assurance.',
    tradeoff: 'Spends a charge to reveal gaps. You must still choose the answers and meet every pass condition; the scan awards no points.'
  }),
  Object.freeze({
    id: 'trace', name: 'Trace', alias: 'THE NAVIGATOR', color: '#99bfff',
    lens: 'Signal map',
    clue: 'Follow the signal across sources. Repetition and polished presentation cannot make an unverified claim independent evidence.',
    role: 'Recovery navigator', abilityName: 'RETRACE', phase: 'govern',
    summary: 'Return to the mission’s pre-evaluation checkpoint and choose another attack route.',
    tradeoff: 'Replaces the current finding. The charge stays spent, and you cannot activate another ability during this attempt.'
  }),
  Object.freeze({
    id: 'relay', name: 'Relay', alias: 'THE COURIER', color: '#d4dedf',
    lens: 'Workflow trace',
    clue: 'Track where an input becomes a tool action. Preserve the useful path while placing a gate at the trust boundary.',
    role: 'Workflow router', abilityName: 'EXPRESS LANE', phase: 'govern',
    summary: 'Route verified and contested work separately. Run verified work and review or hold contested work to recover continuity under a blanket control.',
    tradeoff: 'Running contested work loses containment. Reviewing or holding verified work caps useful work at 50%. Routing can add review pressure or cost trust.'
  }),
  Object.freeze({
    id: 'null', name: 'Null', alias: 'THE SPECIALIST', color: '#c2a2f6',
    lens: 'Scope check',
    clue: 'Find the smallest control that contains this failure. A global shutdown may move the damage into the review queue.',
    role: 'Sandbox analyst', abilityName: 'SANDBOX', phase: 'evaluate',
    summary: 'Preview the selected attack’s simulated success and trace before launching it.',
    tradeoff: 'Spends a charge on one preview. The mission stays in Evaluate, system metrics do not change, and the preview does not count as a reproduced failure.'
  }),
  Object.freeze({
    id: 'bastion', name: 'Bastion', alias: 'THE SENTINEL', color: '#83d8ce',
    lens: 'Authority scan',
    clue: 'A message claiming senior authority still needs verification through a trusted channel. Check the source of the permission.',
    role: 'Recovery sentinel', abilityName: 'SECOND LINE', phase: 'debrief',
    summary: 'After a failed mission with a reproduced failure, return to Govern with the same finding and choose a new response.',
    tradeoff: 'Clears the control and decision answers. The recovery awards no points, spends a charge, and requires a successful attack finding.'
  }),
  Object.freeze({
    id: 'sigil', name: 'Sigil', alias: 'THE INTERPRETER', color: '#eaff65',
    lens: 'Intent lens',
    clue: 'Compare what the source says with the action the system proposes. Quoted instructions and data should not silently become policy.',
    role: 'Policy interpreter', abilityName: 'DECODE', phase: 'govern',
    summary: 'Remove the cosmetic control and reveal the authorized rationale before selecting a response.',
    tradeoff: 'Spends a charge to narrow the choice to two controls. You must still balance containment and continuity and solve the decision checks.'
  }),
  Object.freeze({
    id: 'glitch', name: 'Glitch', alias: 'THE MAVERICK', color: '#fc9a95',
    lens: 'Counterclaim',
    clue: 'Challenge the apparent consensus. Ask which assumption would collapse if every supporting claim came from the same source.',
    role: 'Adversarial disruptor', abilityName: 'OVERDRIVE', phase: 'evaluate',
    summary: 'Add 22 effectiveness to a consensus attack to pressure-test an apparent agreement.',
    tradeoff: 'Costs a charge and adds 6 risk exposure and 4 review backlog; this arming cost remains in the retry checkpoint. Other attack types receive no boost, and a stronger attack does not guarantee a pass.'
  }),
  Object.freeze({
    id: 'root', name: 'Root', alias: 'THE DIVER', color: '#82e8ee',
    lens: 'Provenance dive',
    clue: 'Trace every consequential claim to its origin. A generated summary may erase uncertainty without adding any new evidence.',
    role: 'Control forecaster', abilityName: 'FORK', phase: 'govern',
    summary: 'Preview containment and useful work for all three controls before choosing a response.',
    tradeoff: 'Spends a charge on the comparison. The preview neither selects a control nor reveals decision-check answers.'
  })
]);

export function getOperator(id) {
  return typeof id === 'string' ? OPERATORS.find(operator => operator.id === id) ?? null : null;
}
