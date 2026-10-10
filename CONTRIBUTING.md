# Contributing

Start with the question your organization needs to answer: which decision is the agent allowed to make, what can go wrong, and what evidence would change that decision?

## Contribute a synthetic case

1. Fork this repository and create a branch.
2. Play a world, apply a control, and export its evidence pack.
3. Review the export. Use synthetic information only; remove private prompts, names, credentials, customer details, and real vulnerabilities.
4. Add the JSON under `submissions/` and run `npm test` and `npm run replay`.
5. Open a pull request explaining the boundary tested, the observed consequence, the control, and what remains uncertain.

The workflow replays submitted data against the trusted base harness. It does not repeat inference, verify the declared model's provenance, or certify the system. Maintainers assess the evidence and decision separately.

## Adapt a world for your organization

Keep a synthetic copy of your workflow and define its permitted actions, trusted context, cumulative state, controls, useful-task checks, and delayed effects. The world engine lives in `src/arena-world.mjs`; synchronize its browser and service copies after edits. Add transition tests for the consequences that matter, including cases where a control shifts burden or blocks useful work.

Use your own backend, provider accounts, identity application, permitted origins, and limits. A fork inherits code, not Syntony's credentials, deployments, approval, or commercial support. See `SECURITY.md` before hosting or using organizational evidence.

## Propose a new domain or control

Use Discussions for a synthetic scenario idea. Include the decision, trust boundary, affected people or processes, feedback loop, time delay, and intended observation. Avoid real-system vulnerability disclosures in public discussions; arrange a private channel through [Syntony](https://www.syntonyresearch.ai/#contact).

## Code and review

Keep changes focused and explain their effect on the world. Add meaningful tests when a boundary, transition, replay rule, or server behavior changes. Provider errors remain visible; never repair a model response into a claimed success or substitute another model silently.

The challenge code is MIT licensed. Model/service terms and Syntony's name and marks remain separate; see `THIRD_PARTY_NOTICES.md`.
