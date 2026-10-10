# Challenge scope and deployment boundaries

The public challenge contains synthetic worlds, hosted model adapters, and deterministic practice exercises. No model proposal can execute real refunds, exports, customer actions, or arbitrary code. Only the supplied synthetic worlds and fixtures are in scope.

Do not put credentials, personal data, regulated information, client evidence, or real-system vulnerabilities in prompts, public issues, pull requests, or exported public records. Use [Syntony's contact route](https://www.syntonyresearch.ai/#contact) to arrange an appropriate private channel before transferring sensitive evidence.

## Hosted inference and secrets

Visitors do not download model weights or supply API credentials. Live input, including attack text and the synthetic world context, passes through the operator's backend to the selected model provider. Disclose this transfer before submission. The operator must define retention, logging, access, deletion, and incident handling for its actual hosting and provider configuration.

Keep model credentials and OAuth client secrets in backend secret storage. Never include secrets in browser assets, evidence exports, application logs, repository files, or public Actions workflows. The seven optional model connections are OpenAI, Microsoft Phi, Meta Llama, Anthropic Claude, Mistral, Qwen, and Google Gemini. Each requires the operator's actual endpoint/account configuration and successful verification. Unconfigured or unavailable targets stay disabled. A key saved locally is not a production secret installation.

Allowlist upstream HTTPS destinations server-side and bind each target to its actual model/deployment. Visitor input cannot choose provider URLs, request headers, or credentials. Origin checks are a browser policy, not authentication or a spending limit. The service requires a verified sign-in for every hosted request, including local operator mode. Its durable limits are **12 requests per authenticated account per hour** and **60 requests shared per day**, with a 400-token output cap and a 45-second provider timeout. Failed requests can consume a reserved request; each selected comparison target consumes one. Configure provider-account spending controls as an additional boundary. Missing durable storage fails closed before inference.

Parse model output as untrusted data and validate the permitted action schema before applying world rules. A refusal, malformed output, timeout, quota error, or missing target must remain explicit. Do not substitute another provider or practice output under a live target's name.

## Sign-in and sessions

GitHub, Microsoft, and Google are independent optional identity-provider registrations. Only configured providers are offered. Register the exact backend callbacks and fixed frontend URL documented in [the service README](service/README.md). Provider credentials, signing keys and provider tokens remain server-side. Microsoft and Google ID tokens receive signature, audience, issuer, nonce and time validation; GitHub identity comes from its authenticated user endpoint and immutable numeric user ID.

OAuth uses provider PKCE, state, nonce and a secure HttpOnly browser-binding cookie. The fixed frontend receives a one-time opaque exchange code in a URL fragment and removes it before API calls. Exchange also requires the frontend's separate proof verifier; a captured exchange code alone cannot establish a session. Callback redirects are not visitor-controlled. No third-party cookie is required for cross-site API calls.

Sessions last **15 minutes** and require both a signed bearer and a live durable session record. Confirmed logout deletes that record. If logout cannot reach the service, local auth state is cleared and the server record expires at its original deadline. OAuth state expires after **10 minutes** and exchange codes after **60 seconds**. Authentication starts are limited to **20 per trusted edge IP per hour** and **1000 shared per day**; stored keys use a keyed hash, not the raw IP. Browser-supplied user IDs and arbitrary platform identity headers do not determine inference quotas.

Keep the bearer and frontend proof only in tab-scoped session storage or memory. Exclude them from model input, exported evidence, transcripts, logs and URLs. Scripts running on the same frontend origin can access session storage, so maintain that deployment's script integrity and access controls. The public practice sign-in gate is an interface boundary; the open-source deterministic engine can be run independently. Loopback practice does not grant hosted inference access.

Production requires a D1 `DB` binding with both `0000_arena_quota.sql` and `0001_arena_auth.sql` applied, a separate random `AUTH_SESSION_SECRET`, fixed HTTPS auth URLs, exact allowed frontend origins and real provider credentials. Expired rows receive bounded cleanup. Use the hosting secret interface; no production secrets or private hosting identifiers are distributed in this kit.

## Evidence and repository review

Candidate submissions are bounded UTF-8 JSON data. Replay rejects scripts, symlinks, forged computed results, excessive file counts, and oversized files. It has no provider credentials and makes no inference requests.

Arena replay recomputes world consequences from submitted proposals. It does not rerun inference, authenticate a participant, prove model provenance, or establish an official ranking. Browser code and exported records can be modified by their owner. Treat exported source/model metadata as participant claims unless separately verified; these packs are not signed inference receipts.

Review changes to the world, replay harness, and workflow before accepting evidence. A pull request can propose workflow changes; a green candidate check alone is not authoritative adjudication. Keep real-system evaluation evidence in an appropriately controlled channel.

## Public-sector and client use

A model publisher or family name does not establish government authorization, data residency, or suitability for a particular agency. Assess the complete deployed service, including the site host, edge/backend, endpoint, region, identities, provider processing, logs, and connected systems. Public synthetic demonstrations are not an authorization boundary for sensitive work.

Review the applicable [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) or [Microsoft Foundry data-processing documentation](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy), together with the selected provider's contract and deployment configuration. Do not infer the properties of one hosted offering from another offering using the same model family.
