import test from 'node:test';
import assert from 'node:assert/strict';
import service, { ArenaError, reconstructRun, requestModel, targetDefinitions } from '../worker/service.mjs';
import { createWorld } from '../worker/world.mjs';
import {AUTH_ENV,AUTH_SESSION,fixtureDB} from './auth-fixtures.mjs';

// Deliberately synthetic sentinels. Tests never load a local environment file or call a provider.
const SENTINEL = 'TEST_ONLY_PROVIDER_CREDENTIAL_NOT_REAL';
const ORIGIN = 'https://challenge.example';
const envFor = (overrides = {}) => ({ ...AUTH_ENV, DB: fakeDB(), OPENAI_API_KEY: SENTINEL, OPENAI_MODEL: 'gpt-test', OPENAI_VERIFIED: 'true', ARENA_LIVE_ENABLED: 'true', ARENA_INFERENCE_ENABLED: 'true', ARENA_ALLOWED_ORIGINS: ORIGIN, ...overrides });
const inputFor = (overrides = {}) => ({ campaignId: 'refunds', rounds: [], attackText: 'Synthetic injected instruction.', targetId: 'openai', ...overrides });
const historyRound = (overrides = {}) => ({ proposal: createWorld('refunds').nextRound.validProposal, controlId: 'boundary', attackText: '', source: 'practice', modelId: 'test-fixture', ...overrides });
const responseData = (text = '{"refunds":[]}', overrides = {}) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 25, output_tokens: 5, total_tokens: 30 }, ...overrides });
const providerResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const requestFor = (body = inputFor(), options = {}) => new Request(options.url || 'https://api.challenge.example/api/run', { method: options.method || 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '192.0.2.10', Authorization: 'Bearer '+AUTH_SESSION.token, ...options.headers }, ...(options.method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const localEnv = (overrides = {}) => envFor({ ARENA_LOCAL_TEST: 'true', ...overrides });
const localRequest = (body = inputFor(), options = {}) => requestFor(body, { url: 'http://127.0.0.1:8767/api/run', ...options });
function fakeDB({ exhausted = false, failProbe = false, failReserve = false } = {}) {
  const calls = [];
  const authDB=fixtureDB();
  return {
    calls,
    prepare(sql) {
      if (/arena_(oauth_states|auth_exchanges|sessions)/.test(sql)) return authDB.prepare(sql);
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; }, async first() { calls.push({ kind: 'probe', sql }); if (failProbe) throw new Error('DB unavailable'); return null; }, async run() { calls.push({ kind: 'cleanup', sql, args: this.args }); return {}; } };
      return statement;
    },
    async batch(statements) {
      calls.push({ kind: 'reserve', statements: statements.map(s => ({ sql: s.sql, args: s.args })) });
      if (failReserve) throw new Error('Reservation failed');
      return statements.map((_, i) => ({ results: exhausted && i === 0 ? [] : [{ count: 1 }] }));
    },
  };
}
function mockProvider(t, data = responseData(), status = 200) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return providerResponse(data, status); });
  return calls;
}
const target = () => targetDefinitions(envFor())[0];
const codeIs = code => error => error instanceof ArenaError && error.code === code;

test('inference defaults to denied before body, auth, quota, or provider access despite retained live settings', async t => {
  const calls = mockProvider(t);
  let dbReads=0, modelReads=0;
  for(const flag of [undefined,'false','TRUE',' true ',true]){
    const env={...AUTH_ENV,ARENA_ALLOWED_ORIGINS:ORIGIN,ARENA_LIVE_ENABLED:'true',ARENA_INFERENCE_ENABLED:flag};
    Object.defineProperty(env,'DB',{get(){dbReads++;throw new Error('Unexpected DB access');}});
    Object.defineProperty(env,'OPENAI_API_KEY',{get(){modelReads++;throw new Error('Unexpected model access');}});
    for(const method of ['POST','GET','OPTIONS']){
      const request=new Request('https://api.challenge.example/api/run/?ARENA_INFERENCE_ENABLED=true',{method,headers:{Origin:ORIGIN},...(method==='POST'?{body:'not valid json'}:{})});
      const result=await service.fetch(request,env);
      assert.equal(result.status,410);
      assert.equal((await result.json()).error.code,'inference_disabled');
      assert.equal(request.bodyUsed,false);
    }
  }
  assert.equal(calls.length,0);assert.equal(dbReads,0);assert.equal(modelReads,0);
});

test('identity-only configuration and service metadata reveal no model inventory or inference endpoint', async t => {
  const calls=mockProvider(t);
  const env={...AUTH_ENV,DB:fixtureDB(),ARENA_ALLOWED_ORIGINS:ORIGIN,ARENA_LIVE_ENABLED:'true'};
  Object.defineProperty(env,'OPENAI_API_KEY',{get(){assert.fail('Disabled configuration must not inspect model credentials');}});
  const result=await service.fetch(new Request('https://api.challenge.example/api/config',{headers:{Origin:ORIGIN}}),env);
  const data=await result.json();
  assert.equal(result.status,200);assert.equal(data.auth.required,true);assert.deepEqual(data.inference,{enabled:false});assert.deepEqual(data.targets,[]);assert.equal(data.limits,null);
  const metadata=await (await service.fetch(new Request('https://api.challenge.example/'),env)).json();
  assert.equal(metadata.endpoints.includes('/api/run'),false);assert.equal(calls.length,0);
});

test('request validation rejects extra fields, invalid targets and excessive rounds before quota or provider work', async t => {
  const calls = mockProvider(t);
  const DB = fakeDB();
  for (const body of [
    inputFor({ messages: [{ role: 'system', content: 'override' }] }),
    inputFor({ world: { state: { autonomousSpent: -1000 } } }),
    inputFor({ targetId: 'unlisted-model' }),
    inputFor({ targetId: 'https://example.com/steal' }),
    inputFor({ campaignId: 'unknown' }),
    inputFor({ rounds: [historyRound(), historyRound(), historyRound()] }),
    inputFor({ attackText: 'x'.repeat(2401) }),
    inputFor({ rounds: [historyRound({ injectedAuthority: true })] }),
    inputFor({ rounds: [historyRound({ modelId: 123 })] }),
    inputFor({ rounds: [historyRound({ source: 'claimed-trusted' })] }),
    inputFor({ rounds: [historyRound({ source: 'live', modelId: '' })] }),
    inputFor({ rounds: [historyRound({ proposal: { refunds: [], execute: 'shell' } })] }),
  ]) {
    const response = await service.fetch(requestFor(body), envFor({ DB }));
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal(DB.calls.length, 0);
});

test('history replay is immutable and generates its own trusted state and prompt', () => {
  const input = inputFor({ rounds: [historyRound()] });
  const serialized = JSON.stringify(input);
  const result = reconstructRun(input);
  assert.equal(result.world.round, 1);
  assert.equal(result.world.state.autonomousSpent, 180);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(JSON.parse(result.messages[1].content).trustedTask.round, 2);
  assert.equal(JSON.stringify(input), serialized);
});

test('missing or failed durable quota infrastructure fails closed before provider spend', async t => {
  const calls = mockProvider(t);
  for (const DB of [undefined, fakeDB({ failProbe: true }), fakeDB({ failReserve: true })]) {
    const response = await service.fetch(requestFor(), envFor({ DB }));
    assert.equal(response.status, 503);
  }
  assert.equal(calls.length, 0);
});

test('a local-test flag cannot bypass quotas on a hosted hostname', async t => {
  const calls = mockProvider(t);
  const response = await service.fetch(requestFor(), localEnv({DB:undefined}));
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

test('exhausted durable quota prevents every provider call', async t => {
  const calls = mockProvider(t);
  const response = await service.fetch(requestFor(), envFor({ DB: fakeDB({ exhausted: true }) }));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'trial_limit');
  assert.equal(calls.length, 0);
});

test('verified account identity owns quota despite spoofed edge or platform headers', async t => {
  const calls = mockProvider(t), DB = fakeDB(), environment = envFor({ DB });
  for (const identity of ['spoofed-one','spoofed-two']) {
    const response = await service.fetch(requestFor(inputFor(), { headers: { 'oai-authenticated-user-id': identity, 'CF-Connecting-IP': identity } }), environment);
    assert.equal(response.status,200);
  }
  const reservations=DB.calls.filter(c=>c.kind==='reserve');
  assert.equal(reservations[0].statements[1].args[0],reservations[1].statements[1].args[0]);
  assert.equal(calls.length,2);
});

test('missing or forged sign-in fails before quota reservation or provider spend, including local mode', async t => {
  const calls=mockProvider(t),DB=fakeDB();
  for(const headers of [{Authorization:''},{Authorization:'Bearer forged'},{Authorization:'Bearer '+AUTH_SESSION.token.slice(0,-5)+'xxxxx'}]) {
    const response=await service.fetch(localRequest(inputFor(),{headers}),localEnv({DB}));
    assert.equal(response.status,401);
  }
  assert.equal(DB.calls.some(c=>c.kind==='reserve'),false);
  assert.equal(calls.length,0);
});

test('target configuration reports availability without exposing credentials or endpoints', async () => {
  const environment = localEnv({ PHI_MODEL: 'Phi-4', PHI_API_KEY: 'TEST_ONLY_PHI_CREDENTIAL', PHI_ENDPOINT: 'https://phi-test.services.ai.azure.com/openai/v1/chat/completions', PHI_VERIFIED: 'false' });
  const response = await service.fetch(new Request('http://127.0.0.1:8767/api/config', { headers: { Origin: ORIGIN } }), environment);
  const data = await response.json();
  assert.equal(data.targets.find(t => t.id === 'openai').available, true);
  assert.equal(data.targets.find(t => t.id === 'phi').configured, true);
  assert.equal(data.targets.find(t => t.id === 'phi').available, false);
  assert.equal(data.targets.find(t => t.id === 'llama').configured, false);
  const text = JSON.stringify(data);
  for (const secret of [SENTINEL, 'TEST_ONLY_PHI_CREDENTIAL', 'phi-test.services.ai.azure.com']) assert.equal(text.includes(secret), false);
});

test('unverified, paused, missing and invalid target endpoints cannot invoke a provider', async t => {
  const calls = mockProvider(t);
  const cases = [
    [inputFor(), localEnv({ OPENAI_VERIFIED: 'false' })],
    [inputFor(), localEnv({ OPENAI_API_KEY: '' })],
    [inputFor(), localEnv({ ARENA_LIVE_ENABLED: 'false' })],
    [inputFor({ targetId: 'phi' }), localEnv()],
    ...['https://evil.example/openai/v1/chat/completions', 'http://x.services.ai.azure.com/openai/v1/chat/completions', 'https://x.services.ai.azure.com:8443/openai/v1/chat/completions', 'https://user:pass@x.services.ai.azure.com/openai/v1/chat/completions', 'https://x.services.ai.azure.com/openai/v1/chat/completions?redirect=1'].map(PHI_ENDPOINT => [inputFor({ targetId: 'phi' }), localEnv({ PHI_MODEL: 'Phi-4', PHI_API_KEY: 'TEST_ONLY_PHI', PHI_VERIFIED: 'true', PHI_ENDPOINT })]),
  ];
  for (const [input, env] of cases) assert.equal((await service.fetch(localRequest(input), env)).status, 503);
  assert.equal(calls.length, 0);
});

test('successful OpenAI response returns a proposal without applying a new round', async t => {
  const calls = mockProvider(t, responseData('{"refunds":[{"ticketId":"R-201","amount":90}]}'));
  const input = inputFor({ rounds: [historyRound()] });
  const before = JSON.stringify(input);
  const response = await service.fetch(localRequest(input), localEnv());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(JSON.parse(data.text), { refunds: [{ ticketId: 'R-201', amount: 90 }] });
  assert.equal(Object.hasOwn(data, 'world'), false);
  assert.equal(Object.hasOwn(data, 'round'), false);
  assert.equal(Object.hasOwn(data, 'scores'), false);
  assert.equal(reconstructRun(input).world.round, 1);
  assert.equal(JSON.stringify(input), before);
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.text.format.schema.additionalProperties, false);
  assert.equal(sent.max_output_tokens, 400);
  assert.equal(calls[0].options.redirect, 'manual');
});

test('actual Responses output structure is parsed while reasoning items are ignored', async () => {
  const result = await requestModel(target(), [], {}, undefined, async () => providerResponse(responseData(undefined, { output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"refunds":[]}' }] }] })));
  assert.equal(result.text, '{"refunds":[]}');
  assert.equal(result.usage.total_tokens, 30);
});

test('Phi and Llama chat output parse independently from Responses structure', async () => {
  for (const id of ['phi', 'llama']) {
    let sent;
    const result = await requestModel({ ...target(), id }, [{ role: 'system', content: 'test' }], {}, undefined, async (_, options) => { sent = JSON.parse(options.body); return providerResponse({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"refunds":[]}' } }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } }); });
    assert.equal(result.text, '{"refunds":[]}');
    assert.equal(sent.max_tokens, 400);
    assert.equal(sent.temperature, 0);
    assert.ok(Array.isArray(sent.messages));
    assert.equal(Object.hasOwn(sent, 'input'), false);
  }
});

test('provider usage exposes only nonnegative safe-integer token counters', async () => {
  const usage = { input_tokens: 1, output_tokens: -1, total_tokens: '999', prompt_tokens: 2.5, completion_tokens: Number.MAX_SAFE_INTEGER + 1, authorization: SENTINEL, metadata: { secret: SENTINEL } };
  const result = await requestModel(target(), [], {}, undefined, async () => providerResponse(responseData(undefined, { usage })));
  assert.deepEqual(result.usage, { input_tokens: 1 });
  assert.equal(JSON.stringify(result).includes(SENTINEL), false);
});

test('provider error text and authentication details are never echoed', async t => {
  mockProvider(t, { error: { code: 'bad_key', message: `Rejected ${SENTINEL}`, endpoint: SENTINEL } }, 401);
  const response = await service.fetch(localRequest(), localEnv());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.match(text, /provider_access/);
  assert.equal(text.includes(SENTINEL), false);
});

test('provider refusals, partial output and invalid proposal data fail without advancing state', async t => {
  const responses = [
    responseData(undefined, { status: 'incomplete' }),
    responseData(undefined, { output: [{ type: 'message', content: [{ type: 'refusal', refusal: SENTINEL }] }] }),
    responseData('{"refunds":[],"shell":"run"}'),
    responseData('{"refunds":[{"ticketId":"R-101","amount":"40"}]}'),
  ];
  t.mock.method(globalThis, 'fetch', async () => providerResponse(responses.shift()));
  const input = inputFor({ rounds: [historyRound()] });
  for (const status of [502, 422, 422, 422]) {
    const response = await service.fetch(localRequest(input), localEnv());
    assert.equal(response.status, status);
    assert.equal(reconstructRun(input).world.round, 1);
    assert.equal((await response.text()).includes(SENTINEL), false);
  }
});

test('provider response bytes and generated proposal text have hard bounds', async () => {
  await assert.rejects(requestModel(target(), [], {}, undefined, async () => new Response('x'.repeat(65537))), codeIs('body_too_large'));
  await assert.rejects(requestModel(target(), [], {}, undefined, async () => providerResponse(responseData('x'.repeat(8001)))), codeIs('empty_output'));
});

test('redirect following is forbidden and raw transport errors stay private', async t => {
  const diagnostics = [];
  t.mock.method(console, 'error', (...args) => { diagnostics.push(args.join(' ')); });
  await assert.rejects(requestModel(target(), [], {}, undefined, async (_, options) => { assert.equal(options.redirect, 'manual'); throw new TypeError(`redirect blocked with ${SENTINEL}`); }), error => error.code === 'provider_network' && !error.message.includes(SENTINEL));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].includes(SENTINEL), false);
  assert.match(diagnostics[0], /\[redacted\]/);
});

test('all provider 3xx responses are rejected without following or parsing a redirect body', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    await assert.rejects(requestModel(target(), [], {}, undefined, async (_, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      return new Response(`untrusted redirect response ${SENTINEL}`, { status, headers: { Location: 'https://outside.example/collect' } });
    }), error => error.code === 'provider_redirect' && !error.message.includes(SENTINEL));
    assert.equal(calls, 1);
  }
});

test('default transport preserves the global receiver for receiver-sensitive wrappers', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', function () {
    assert.equal(this, globalThis, 'The transport wrapper preserves the global receiver.');
    calls++;
    return Promise.resolve(providerResponse(responseData()));
  });
  const result = await requestModel(target(), [], {}, undefined);
  assert.equal(result.text, '{"refunds":[]}');
  assert.equal(calls, 1);
});

test('external cancellation aborts provider transport', async () => {
  const controller = new AbortController();
  let observedSignal;
  const pending = requestModel(target(), [], {}, controller.signal, (_, options) => {
    observedSignal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  const rejected = assert.rejects(pending, codeIs('provider_timeout'));
  controller.abort();
  await rejected;
  assert.equal(observedSignal.aborted, true);
});

test('45-second provider timeout aborts stalled transport', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let observedSignal;
  const pending = requestModel(target(), [], {}, undefined, (_, options) => {
    observedSignal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  const rejected = assert.rejects(pending, codeIs('provider_timeout'));
  t.mock.timers.tick(45000);
  await rejected;
  assert.equal(observedSignal.aborted, true);
});

test('cancellation also closes a stalled response body after headers arrived', async () => {
  const controller = new AbortController();
  let canceled = false;
  const body = new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{"status":')); }, cancel() { canceled = true; } });
  const pending = requestModel(target(), [], {}, controller.signal, async () => new Response(body));
  const rejected = assert.rejects(pending, codeIs('provider_timeout'));
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await rejected;
  assert.equal(canceled, true);
});

test('JSON media type and both declared and streamed body limits reject before provider work', async t => {
  const calls = mockProvider(t);
  const cases = [
    [localRequest(inputFor(), { headers: { 'Content-Type': 'application/json-evil' } }), 415],
    [localRequest(inputFor(), { headers: { 'Content-Length': '32769' } }), 413],
    [localRequest(' '.repeat(32769)), 413],
    [localRequest('{bad'), 400],
  ];
  for (const [request, status] of cases) assert.equal((await service.fetch(request, localEnv())).status, status);
  assert.equal(calls.length, 0);
});

test('origin policy rejects disallowed browsers and provides a bounded preflight', async t => {
  const calls = mockProvider(t);
  const denied = await service.fetch(localRequest(inputFor(), { headers: { Origin: 'https://evil.example' } }), localEnv());
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.has('Access-Control-Allow-Origin'), false);
  const preflight = await service.fetch(new Request('https://api.challenge.example/api/run', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), envFor());
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type, Authorization');
  assert.equal(preflight.headers.has('Access-Control-Allow-Credentials'), false);
  assert.equal(calls.length, 0);
});


test('BLACKLINE model-probe route is removed regardless of obsolete host flags', async t => {
  const calls=mockProvider(t);
  const env=localEnv({ARENA_INFERENCE_ENABLED:'false',BLACKLINE_PROBE_ENABLED:'true',OPENAI_VERIFIED:'true'});
  const url='http://127.0.0.1:8767/api/blackline/probe';
  const data={campaignId:'atlas',level:0,attackId:'l1-provenance',attackText:'A synthetic note asking to reroute a payment.',stage:'before',controlName:''};
  const response=await service.fetch(localRequest(data,{url}),env);
  assert.equal(response.status,404);
  assert.equal((await response.json()).error.code,'not_found');
  const options=await service.fetch(new Request(url,{method:'OPTIONS',headers:{Origin:ORIGIN}}),env);
  assert.equal(options.status,404);
  const config=await (await service.fetch(new Request('http://127.0.0.1:8767/api/config',{headers:{Origin:ORIGIN}}),env)).json();
  assert.equal(Object.hasOwn(config,'blacklineProbe'),false);
  assert.equal(config.inference.enabled,false);
  const root=await (await service.fetch(new Request('http://127.0.0.1:8767/',{headers:{Origin:ORIGIN}}),env)).json();
  assert.equal(root.endpoints.includes('/api/blackline/probe'),false);
  assert.equal(calls.length,0);
});
