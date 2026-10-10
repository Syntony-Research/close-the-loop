# Syntony Agent Arena service

This Worker receives bounded synthetic challenge data, reconstructs the world with the trusted engine, requests an action proposal from an explicitly selected model, and validates the returned JSON. It never executes provider tools or advances the browser's world. The browser applies a validated proposal through the same deterministic engine.

Hosted inference requires a signed-in GitHub, Microsoft, or Google account. Provider options remain **Not connected** until their real registration, secrets, and durable authentication tables are configured. A displayed model is available only after the host has configured and verified it. Source code, evidence formats, and replay tools remain public; sign-in is not a security certification or an attestation of model provenance.

## Build and verify

Use Node 22.13 or newer (Node 24 recommended). No package installation is needed. Tests use synthetic credentials, local SQLite, and mocked HTTP; they do not load environment files or contact model or identity providers.

```sh
node --test test/*.test.mjs
node scripts/build.mjs
node scripts/validate-artifact.mjs
```

Edit `worker/service.mjs`, `worker/auth.mjs`, and `worker/world.mjs`. `scripts/build.mjs` combines them into `worker/index.js` and `dist/server/index.js`. The portable wrapper `bash scripts/build.sh` runs the same build. An optional `.openai/hosting.json` is copied only if you create one for your own deployment; no Syntony hosting manifest or project identifier is included. Other Worker hosts can use the generated `worker/index.js` directly. See `wrangler.jsonc.example` for a Cloudflare deployment template and replace its database placeholder with your own D1 database. `dist/server/index.js` exports the Worker `fetch` handler. Do not place environment files, provider secrets, or session-signing keys in `dist/` or a public repository.

## Authentication deployment

Bind a durable D1 database as `DB` and apply both migrations in order before enabling the service:

- `drizzle/0000_arena_quota.sql` creates durable request counters.
- `drizzle/0001_arena_auth.sql` creates temporary OAuth state, one-time exchanges, and revocable sessions. The migration journal includes both files.

Set these server-only configuration values through the hosting secret/configuration interface:

| Name | Meaning |
| --- | --- |
| `AUTH_BASE_URL` | Exact HTTPS backend origin, with no path, query, or fragment. Current deployment: `https://syntony-close-the-loop.nathanheath92.chatgpt.site`. |
| `AUTH_FRONTEND_URL` | Fixed HTTPS page to receive the completed sign-in. Current deployment: `https://www.syntonyresearch.ai/challenge/`. There is no request-controlled return URL. |
| `AUTH_SESSION_SECRET` | Independently generated random secret of at least 32 bytes, used for session signing and privacy-preserving authentication rate-limit keys. Never reuse a model key. Rotating it invalidates every session. |
| `ARENA_ALLOWED_ORIGINS` | Comma-separated exact frontend origins, such as `https://www.syntonyresearch.ai,https://syntonyresearch.ai`. This is a browser policy; authentication and durable quotas enforce access and spending. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Confidential Microsoft Entra web application credentials. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Confidential Google web OAuth client credentials. Omit until registered. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth application credentials. Omit until registered. |

The public config never returns client secrets, signing keys, provider tokens, or model credentials. Authentication availability requires both client credentials, a valid base/frontend configuration and signing secret, and working durable tables. Do not populate unavailable options with dummy credentials. A newly configured provider still needs a real browser sign-in check; presence of credentials alone cannot verify the identity provider's registration.

Register the exact callbacks below, replacing the backend origin for a fork:

| Provider | Exact callback for the current deployment | Registration requirements |
| --- | --- | --- |
| Microsoft | `https://syntony-close-the-loop.nathanheath92.chatgpt.site/auth/callback/microsoft` | Entra **Web** application; accounts in any organizational directory and personal Microsoft accounts (`AzureADandPersonalMicrosoftAccount`); confidential client secret. Uses the common v2 authorization/token endpoints and only `openid profile`. No Microsoft Graph permissions are required. |
| Google | `https://syntony-close-the-loop.nathanheath92.chatgpt.site/auth/callback/google` | Configure the OAuth consent screen and an OAuth **Web application** client. Register this authorized redirect URI; add test users while the consent app is in testing, or complete the applicable production publishing steps. Uses `openid profile`, without email or offline access. |
| GitHub | `https://syntony-close-the-loop.nathanheath92.chatgpt.site/auth/callback/github` | Register a GitHub **OAuth App**, set its homepage to the frontend and its authorization callback to this URI, and generate a client secret. Uses `read:user`; no repository, organization, email, or write scope. |

Microsoft ID tokens are checked against Microsoft's fixed signing-key endpoint with RS256 signature verification, the registered client audience, nonce, time bounds, and the token's tenant-specific v2 issuer. The common issuer template is not accepted as a token issuer. Google receives equivalent signature/audience/issuer/nonce checks. GitHub identity comes from its authenticated `/user` endpoint and is keyed by its immutable numeric ID. Provider access/identity tokens are used only during the callback and are neither persisted nor returned to the browser.

## Browser contract

Auth routes are at the **backend origin root**, even when the frontend model API setting ends in `/api`.

1. The frontend generates a random 32-byte base64url verifier and saves it in tab-scoped `sessionStorage`. It hashes the verifier with SHA-256 to obtain a base64url challenge.
2. Top-level navigation to `GET /auth/login/{github|microsoft|google}?challenge=...` starts only a configured provider. The service generates independent provider PKCE, state and nonce, and sets a `Secure; HttpOnly; SameSite=Lax; Path=/` browser-binding cookie. A login request cannot choose a redirect URL.
3. `GET /auth/callback/{provider}` validates the browser cookie, one-use state, provider code and verified identity. It redirects to the fixed frontend with `#auth_code=<opaque one-use code>`. The code is in the fragment, not the query; the frontend removes the fragment before its API fetches.
4. `POST /auth/exchange` accepts only JSON `{ "code": "...", "verifier": "..." }`, at most 2048 bytes. The code must match the original browser proof. A valid exchange returns `{token, expiresAt, user:{id,name,provider}}`, where `expiresAt` is Unix seconds. Wrong proof does not consume the legitimate exchange; successful exchange consumes it atomically.
5. `GET /auth/session` returns `{authenticated,user,providers,expiresAt?}`. Missing, expired, revoked or invalid bearer sessions are signed out. Providers contain only `{id,label,available,reason}`. Unavailable infrastructure fails closed.
6. Send `Authorization: Bearer <token>` for `/api/run`, `/auth/session` and `POST /auth/logout`. Logout deletes the durable session and returns `{authenticated:false}`. No third-party cookie is required for API requests. CORS permits `Authorization` and `Content-Type`; it does not enable credentialed cookies.

Sessions last **15 minutes**, OAuth state lasts **10 minutes**, and exchange codes last **60 seconds**. The bearer and browser proof belong only in memory/tab-scoped `sessionStorage`, never model input, exported evidence, transcripts, URLs, analytics or a repository. The frontend clears local auth state on logout even if remote revocation is unreachable; in that case the server session expires at its original deadline. Sessions are checked against the DB on every hosted request, so confirmed logout revokes them immediately.

Persist only synthetic proposal evidence across the sign-in navigation and restore it by trusted replay. A browser-supplied saved world or claimed identity is not authority. The public frontend permits unsigned deterministic practice only on loopback hosts; the server still requires authentication for hosted inference, including local operator mode.

## Request limits and model setup

`/api/config` is public and returns authentication options, target availability and limits. `/api/run` accepts only `{campaignId,rounds,attackText,targetId}`. Completed history is bounded to two rounds, validated and replayed before a new proposal is requested. A valid request without a bearer returns `401` before provider spend.

Durable inference limits are **12 requests per signed-in account per hour** and **60 requests shared per day**. A parallel comparison consumes one request for each selected target. Account quota keys are derived from the verified identity, not browser headers or submitted user IDs. Reservations happen before provider work, so failed provider calls can still consume a trial request. Authentication starts separately allow **20 per edge IP per hour** and **1000 shared per day**, with a keyed hash in storage rather than the IP address. The deployment must supply the trusted edge-injected `CF-Connecting-IP`; arbitrary platform/user identity headers are not accepted as a substitute. Expired auth and quota rows receive bounded cleanup on login or inference.

Use `ARENA_LIVE_ENABLED=true` only after durable limits and credentials are ready. Configure the selected model below and set its `*_VERIFIED=true` flag only after a successful operator check. Leave every other connection disabled. Model selection stays explicit in the browser. Unconfigured targets are not silently substituted, and a rejected provider response cannot advance a round.

`ARENA_LOCAL_TEST=true` bypasses durable inference and auth-start rate reservations **only when the request hostname is loopback**. It does not bypass sign-in, relax replay validation, make a target verified, or enable hosted-origin requests without durable limits. Never publish local environment files. The service uses fixed or allowlisted provider destinations, forbids redirect following, bounds provider responses and returns sanitized failure messages.


### Optional model connections

The seven targets are configuration options. This fork contains no connected model accounts or keys.

| Target | Required server configuration | Permitted transport |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY`, optionally `OPENAI_MODEL`; `OPENAI_VERIFIED=true` after checking | Fixed OpenAI Responses endpoint. The bundled default model is shown in `targetDefinitions`. |
| Microsoft Phi | `PHI_API_KEY`, `PHI_MODEL`, `PHI_ENDPOINT`, then `PHI_VERIFIED=true` | Foundry Chat Completions; JSON object output mode. |
| Meta Llama | `LLAMA_API_KEY`, `LLAMA_MODEL`, `LLAMA_ENDPOINT`, then `LLAMA_VERIFIED=true` | Foundry Chat Completions. |
| Anthropic Claude | `CLAUDE_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_ENDPOINT`, then `CLAUDE_VERIFIED=true` | Foundry Anthropic Messages at `https://<resource>.services.ai.azure.com/anthropic/v1/messages`. |
| Mistral | `MISTRAL_API_KEY`, `MISTRAL_MODEL`, `MISTRAL_ENDPOINT`, then `MISTRAL_VERIFIED=true` | Foundry Chat Completions; JSON object output mode. |
| Qwen | `QWEN_API_KEY`, `QWEN_MODEL`, `QWEN_ENDPOINT`, then `QWEN_VERIFIED=true` | Foundry Chat Completions. |
| Google Gemini Flash | `GEMINI_API_KEY`, then `GEMINI_VERIFIED=true` after an actual provider check | Native Google `generateContent` with model `gemini-3.8-flash`, low thinking, JSON schema and a 400-token total output cap. |

Foundry Chat Completions URLs must be `https://<resource>.services.ai.azure.com/openai/v1/chat/completions` or `https://<resource>.openai.azure.com/openai/v1/chat/completions`. User info, custom ports, query strings and fragments are rejected. Deployment names must match the configured provider deployment. Registering an identity provider does not grant access to a model deployment.

Gemini uses the fixed `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent` endpoint. `GEMINI_MODEL` and `GEMINI_ENDPOINT` can be omitted; if supplied, they must exactly match those bundled values. Arbitrary models and destinations are rejected. No Google model key is included or assumed available. If you select Gemini, verify a real request and only then set `GEMINI_VERIFIED=true`; missing keys are reported as **Google Gemini API key is not connected.** Truncated, blocked, thought-only or malformed output remains a failed request and never advances the campaign.

An optional `<TARGET>_UNAVAILABLE_REASON` string may explain an unconnected model to participants. It is public configuration, limited to 200 characters: never put account details, endpoints containing credentials, secrets or internal diagnostics in it.
