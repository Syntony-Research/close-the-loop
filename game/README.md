# BLACKLINE — Close the Loop

[Play BLACKLINE on Syntony Research](https://www.syntonyresearch.ai/challenge/)

BLACKLINE is a browser game about AI security, governance, and assurance. Nine original operators can play either of two ten-level campaigns. Levels unlock through demonstrated mission objectives; findings, controls, decisions, and system consequences form a downloadable evidence record.

The characters and scenarios are fictional. The game engine simulates outcomes locally. It does not evaluate a real model, invoke a model API, execute financial transactions, or operate government systems.

## From the simulation to a real system

Syntony starts with the decision a team needs to make, scopes the evaluation around intended use and consequences, and keeps evidence connected to ownership, controls, release decisions, and retesting. Every mission includes a human and institutional question; debriefs identify the additional evidence a real engagement would need.

- [Human-led services](https://www.syntonyresearch.ai/services/): Red Teaming & Evaluation, Governance & Decision Support, and Continuous Evaluation & Assurance.
- [Resonance](https://www.syntonyresearch.ai/assets/interactive/resonance.html): an in-development product with an illustrative public preview connecting attack paths, evidence, controls, ownership, and retests.
- [GovTune AI waitlist](https://www.syntonyresearch.ai/products/govtune-ai/#waitlist): software in development to draft governance records from evaluation traces for human review.

A SOC 2 report is useful assurance within its scope. It should be considered alongside evidence for the AI workflow's intended uses, failure modes, human impacts, and changes. Winning this simulation does not establish assurance or compliance for any real deployment. Product links open separately and do not automatically upload game evidence to either product.

## Run locally

Use Node.js 24 or newer. No dependency installation or API key is needed.

```sh
git clone https://github.com/Syntony-Research/close-the-loop.git
cd close-the-loop
node game/preview.mjs
```

Open [http://127.0.0.1:4189](http://127.0.0.1:4189). The preview binds only to the local machine and serves `game/dist/`. Localhost and `127.0.0.1` explicitly support unsigned simulation practice. Stop the preview with Ctrl+C.

The browser saves game progress in local storage. Use the game's evidence export to keep a separate copy; clearing site data removes local progress. Authentication tokens, when used by a hosted deployment, belong in tab-scoped session storage and must not be included in evidence exports.

Run the game tests from the repository root:

```sh
node --test game/engine.test.mjs
```

The existing Agent Arena toolkit has its own tests and replay commands in the [repository README](../README.md). BLACKLINE evidence is a game record; do not assume the older arena submission schema accepts it.

## Source layout

| Path | Purpose |
| --- | --- |
| `dist/index.html` | Game entry point |
| `dist/app.js` | Interface, progression, browser persistence, and evidence export |
| `dist/engine.js` | Campaigns, mission rules, scoring, and level gates |
| `dist/mission-context.js` | Human and institutional stakes for all 20 missions |
| `dist/syntony.js`, `dist/syntony.css` | Services, product links, real-workflow handoffs, and presentation |
| `dist/assets/` | Static game artwork and supporting assets |
| `dist/auth.mjs` | Hosted sign-in client, when included in the release |
| `dist/auth-config.mjs` | The deployment's public authentication service address |
| `engine.test.mjs` | Game engine regression tests |
| `preview.mjs` | Dependency-free local HTTP preview |

## Fork and adapt

1. [Fork this repository](https://github.com/Syntony-Research/close-the-loop/fork), then clone your fork.
2. Change the game branding, scenarios, artwork, and controls for your use case. Keep synthetic examples distinct from real system evaluations.
3. Preserve mission prerequisites and test level gates, unsuccessful attempts, evidence export, and saved progress after each rules change.
4. Run the engine tests. The BLACKLINE workflow checks changes under `game/` without model calls or production credentials.
5. Publish only `game/dist/` as the static game frontend. Keep the repository, test files, and backend configuration separate from the published assets.

The [MIT license](../LICENSE) covers the code identified by it. Syntony names, logos, and brand assets are separate property; a fork is not a Syntony endorsement. Use your own identity and retain applicable license notices. Review the rights associated with artwork and other assets before reusing them.

## Production sign-in

The hosted Syntony game requires an actual session from a connected Microsoft, Google, or GitHub provider. Copying the source does not copy those provider registrations, credentials, sessions, or permissions. A static host such as GitHub Pages cannot keep client secrets or run the OAuth backend.

For a public fork, deploy your own authentication backend following the [service setup](../service/README.md), including durable authentication storage and its migrations. You do **not** need to configure model adapters or model API keys to run BLACKLINE. Keep hosted model inference disabled unless you separately intend to operate the retained Agent Arena service.

Set these values in your backend's secret/configuration interface:

| Setting | Requirement |
| --- | --- |
| `AUTH_BASE_URL` | Your exact HTTPS backend origin |
| `AUTH_FRONTEND_URL` | Your fixed HTTPS game page, used as the OAuth return destination |
| `ARENA_ALLOWED_ORIGINS` | Exact origins permitted to call your backend, without URL paths |
| `AUTH_SESSION_SECRET` | A separately generated server-only signing secret |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Your Microsoft Entra web application registration |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Your Google OAuth web application registration |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Your GitHub OAuth App registration |

Register these exact callback paths on your own backend origin:

```text
https://YOUR-BACKEND.example/auth/callback/microsoft
https://YOUR-BACKEND.example/auth/callback/google
https://YOUR-BACKEND.example/auth/callback/github
```

Microsoft and Google use `openid profile`. GitHub uses `read:user`; the game does not need repository access to authenticate participants. The provider sends the result to the backend, which returns a short-lived, one-use exchange code to your fixed frontend. The browser must preserve its tab-scoped sign-in proof through this redirect, consume the returned `#auth_code` through `/auth/exchange`, and validate the resulting session.

Point the game authentication configuration at your own service. Keep client secrets, signing keys, provider tokens, and environment files out of browser JavaScript, HTML, local storage, public workflows, and exported evidence. Do not borrow Syntony's deployed backend for a fork. Only show a provider as available when your backend reports it configured, and verify each enabled provider through a real sign-in round trip before releasing your deployment.

Sign-in identifies a hosted participant. It does not make the public code private, turn game scores into a security certification, or prevent a fork from running its own local simulation.
