import test from 'node:test';
import assert from 'node:assert/strict';
import service from '../worker/service.mjs';
import {authAuthenticate,authCreateSession} from '../worker/auth.mjs';
import {AUTH_ENV,AUTH_SESSION,AUTH_USER,fixtureDB} from './auth-fixtures.mjs';
const ORIGIN='https://challenge.example',CLIENT='synthetic-client-id',SECRET='SYNTHETIC_OAUTH_CLIENT_SECRET_NOT_REAL';
const b64=x=>Buffer.from(x).toString('base64url');
const hash=async text=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
const verifier='v'.repeat(43);
const tenant='11111111-2222-4333-8444-555555555555';
const issuer=`https://login.microsoftonline.com/${tenant}/v2.0`;
const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',key.publicKey),kid:'fixture-key',alg:'RS256',use:'sig',issuer:'https://login.microsoftonline.com/{tenantid}/v2.0'};
const environment=(overrides={})=>({...AUTH_ENV,DB:fixtureDB({session:false}),ARENA_ALLOWED_ORIGINS:ORIGIN,MICROSOFT_CLIENT_ID:CLIENT,MICROSOFT_CLIENT_SECRET:SECRET,...overrides});
const request=(path,{method='GET',headers={},body}={})=>new Request(AUTH_ENV.AUTH_BASE_URL+path,{method,headers:{Origin:ORIGIN,'CF-Connecting-IP':'192.0.2.10',...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function sign(claims,header={alg:'RS256',kid:'fixture-key'}){const text=b64(JSON.stringify(header))+'.'+b64(JSON.stringify(claims));return text+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,new TextEncoder().encode(text)));}
async function start(env,id='microsoft'){
  const response=await service.fetch(request(`/auth/login/${id}?challenge=${await hash(verifier)}`),env);
  assert.equal(response.status,302,await response.clone().text());
  return {response,url:new URL(response.headers.get('Location')),cookie:response.headers.get('Set-Cookie').split(';')[0]};
}
async function identityMock(t,flow,{id='microsoft',claims={},header,keys=[jwk],tamper=false,tokenStatus=200}={}){
  const now=Math.floor(Date.now()/1000);
  let token=await sign({iss:id==='google'?'https://accounts.google.com':issuer,aud:CLIENT,sub:'immutable-provider-subject',nonce:flow.url.searchParams.get('nonce'),iat:now,exp:now+3600,ver:'2.0',tid:tenant,name:'Fixture Person',...claims},header);
  if(tamper)token=token.slice(0,-20)+'A'.repeat(20);
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});assert.equal(options.redirect,'manual');
    if(url.includes('/token'))return json({id_token:token,access_token:'PROVIDER_TOKEN_MUST_STAY_SERVER_SIDE',token_type:'Bearer'},tokenStatus);
    if(url.includes('/keys')||url.includes('/certs'))return json({keys});
    assert.fail('Unexpected external request: '+url);
  });
  return calls;
}
const callback=(flow,id='microsoft',cookie=flow.cookie)=>request(`/auth/callback/${id}?state=${flow.url.searchParams.get('state')}&code=synthetic-code`,{headers:{Cookie:cookie}});
async function exchange(env,code,proof=verifier){return service.fetch(request('/auth/exchange',{method:'POST',body:{code,verifier:proof}}),env);}

test('public auth configuration is honest, secret-free, and fails closed without durable tables',async()=>{
  const env=environment();
  const data=await (await service.fetch(request('/api/config'),env)).json();
  assert.equal(data.auth.required,true);
  assert.deepEqual(data.auth.providers.map(p=>[p.id,p.available]),[['github',false],['microsoft',true],['google',false]]);
  for(const secret of [SECRET,AUTH_ENV.AUTH_SESSION_SECRET,CLIENT])assert.equal(JSON.stringify(data).includes(secret),false);
  for(const broken of [{DB:undefined},{AUTH_SESSION_SECRET:'short'},{AUTH_BASE_URL:'https://evil.example/path'},{AUTH_FRONTEND_URL:'https://example.com/#injected'}]){
    const response=await service.fetch(request('/auth/session'),environment(broken));
    assert.equal(response.status,200);assert.ok((await response.json()).providers.every(p=>!p.available));
    assert.equal((await service.fetch(request('/auth/login/microsoft?challenge='+'c'.repeat(43)),environment(broken))).status,503);
  }
});

test('login sets secure browser binding, independent PKCE and nonce, with no return URL override',async()=>{
  const env=environment(),flow=await start(env),cookie=flow.response.headers.get('Set-Cookie');
  for(const flag of ['__Host-arena_oauth_','Secure','HttpOnly','SameSite=Lax','Path=/'])assert.ok(cookie.includes(flag));
  assert.equal(flow.url.origin,'https://login.microsoftonline.com');
  assert.equal(flow.url.searchParams.get('redirect_uri'),AUTH_ENV.AUTH_BASE_URL+'/auth/callback/microsoft');
  assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
  assert.notEqual(flow.url.searchParams.get('code_challenge'),await hash(verifier));
  assert.equal(flow.url.searchParams.get('nonce').length,43);
  assert.equal(flow.url.searchParams.get('scope'),'openid profile');
  assert.equal(flow.url.searchParams.has('client_secret'),false);
  const row=env.DB.raw.prepare('SELECT * FROM arena_oauth_states').get();
  assert.notEqual(row.state_hash,flow.url.searchParams.get('state'));
  assert.equal(row.challenge,await hash(verifier));
  assert.equal(row.binding_hash.includes(flow.cookie.split('=')[1]),false);
  assert.equal((await service.fetch(request('/auth/login/microsoft?challenge='+'c'.repeat(43)+'&returnTo=https://evil.example'),env)).status,400);
  assert.equal((await service.fetch(request('/auth/login/github?challenge='+'c'.repeat(43)),env)).status,503);
  assert.equal((await service.fetch(request('/auth/login/unknown?challenge='+'c'.repeat(43)),env)).status,404);
});

test('auth start limits are durable and identity headers cannot replace the required edge address',async()=>{
  const env=environment(),url='/auth/login/microsoft?challenge='+'c'.repeat(43);
  for(let i=0;i<20;i++)assert.equal((await service.fetch(request(url),env)).status,302);
  assert.equal((await service.fetch(request(url),env)).status,429);
  assert.equal(env.DB.raw.prepare('SELECT count(*) AS n FROM arena_oauth_states').get().n,20);
  assert.ok(env.DB.raw.prepare('SELECT window_key FROM arena_quota').all().every(r=>!r.window_key.includes('192.0.2.10')));
  const missing=request(url,{headers:{'oai-authenticated-user-id':'spoofed'}});missing.headers.delete('CF-Connecting-IP');
  assert.equal((await service.fetch(missing,environment())).status,503);
  const localFlag=environment({ARENA_LOCAL_TEST:'true'});assert.equal((await service.fetch(missing,localFlag)).status,503);
});

test('state is bound to the callback browser and provider and can only be consumed once',async t=>{
  const env=environment({GOOGLE_CLIENT_ID:CLIENT,GOOGLE_CLIENT_SECRET:SECRET}),flow=await start(env);const calls=await identityMock(t,flow);
  assert.equal((await service.fetch(callback(flow,'google'),env)).status,400);
  for(const cookie of ['',flow.cookie.replace(/=.*/, '='+'x'.repeat(43)),flow.cookie+'; '+flow.cookie])assert.equal((await service.fetch(callback(flow,'microsoft',cookie),env)).status,400);
  assert.equal(env.DB.raw.prepare('SELECT count(*) AS n FROM arena_oauth_states').get().n,1);
  assert.equal(calls.length,0);
  const valid=await service.fetch(callback(flow),env);assert.equal(valid.status,302);
  assert.equal((await service.fetch(callback(flow),env)).status,400);
  assert.equal(calls.length,2);
});

test('Microsoft callback checks issuer/signature and returns only a proof-bound opaque exchange; logout revokes bearer',async t=>{
  const env=environment(),flow=await start(env),calls=await identityMock(t,flow);
  const response=await service.fetch(callback(flow),env);
  assert.equal(response.status,302);
  const location=new URL(response.headers.get('Location'));
  assert.equal(location.origin+location.pathname,AUTH_ENV.AUTH_FRONTEND_URL);assert.equal(location.search,'');
  const code=new URLSearchParams(location.hash.slice(1)).get('auth_code');assert.equal(code.length,43);
  assert.equal(location.href.includes('PROVIDER_TOKEN'),false);
  const sent=new URLSearchParams(calls[0].options.body);
  assert.equal(sent.get('client_secret'),SECRET);assert.ok(sent.get('code_verifier'));assert.equal(sent.get('redirect_uri'),AUTH_ENV.AUTH_BASE_URL+'/auth/callback/microsoft');
  assert.equal((await exchange(env,code,'x'.repeat(43))).status,401);
  const exchanged=await exchange(env,code);assert.equal(exchanged.status,200);const session=await exchanged.json();
  assert.equal(session.user.name,'Fixture Person');assert.equal(session.user.provider,'microsoft');assert.equal(session.user.id.length,43);
  for(const secret of [SECRET,'PROVIDER_TOKEN_MUST_STAY_SERVER_SIDE','immutable-provider-subject'])assert.equal(JSON.stringify(session).includes(secret),false);
  assert.equal((await exchange(env,code)).status,401);
  const headers={Authorization:'Bearer '+session.token};
  assert.equal((await (await service.fetch(request('/auth/session',{headers}),env)).json()).authenticated,true);
  assert.equal((await service.fetch(request('/auth/logout',{method:'POST',headers}),env)).status,200);
  assert.equal((await (await service.fetch(request('/auth/session',{headers}),env)).json()).authenticated,false);
  await assert.rejects(authAuthenticate(request('/api/run',{headers}),env),e=>e.status===401);
});

test('OIDC rejects wrong audience, issuer, tenant, nonce, timing, algorithm, signature and signing-key issuer',async t=>{
  const now=Math.floor(Date.now()/1000);
  const variants=[{claims:{aud:'attacker-app'}},{claims:{iss:'https://login.microsoftonline.com/common/v2.0'}},{claims:{tid:'not-a-tenant'}},{claims:{nonce:'attacker-nonce'}},{claims:{exp:now-1}},{claims:{iat:now+120}},{claims:{nbf:now+120}},{claims:{azp:'other-app'}},{header:{alg:'none',kid:'fixture-key'}},{tamper:true},{keys:[{...jwk,issuer:'https://attacker.example'}]},{keys:[{...jwk,kid:'unknown'}]}];
  for(const variant of variants){
    const env=environment(),flow=await start(env);await identityMock(t,flow,variant);
    const response=await service.fetch(callback(flow),env);assert.equal(response.status,401,JSON.stringify(variant));
    assert.equal(env.DB.raw.prepare('SELECT count(*) AS n FROM arena_auth_exchanges').get().n,0);
    assert.equal((await response.text()).includes(SECRET),false);
  }
});

test('expired state or exchange code cannot create a session and cancellation stays on the fixed frontend',async t=>{
  let env=environment(),flow=await start(env);await identityMock(t,flow);
  env.DB.raw.exec('UPDATE arena_oauth_states SET expires_at=1');assert.equal((await service.fetch(callback(flow),env)).status,400);
  env=environment();flow=await start(env);await identityMock(t,flow);
  const success=await service.fetch(callback(flow),env),code=new URLSearchParams(new URL(success.headers.get('Location')).hash.slice(1)).get('auth_code');
  env.DB.raw.exec('UPDATE arena_auth_exchanges SET expires_at=1');assert.equal((await exchange(env,code)).status,401);
  env=environment();flow=await start(env);
  const denied=await service.fetch(request('/auth/callback/microsoft?state='+flow.url.searchParams.get('state')+'&error=access_denied&error_description=secret',{headers:{Cookie:flow.cookie}}),env);
  assert.equal(denied.headers.get('Location'),AUTH_ENV.AUTH_FRONTEND_URL+'#auth_error=cancelled');
});

test('Google validates its signed OIDC identity and GitHub uses authenticated immutable user ID',async t=>{
  let env=environment({GOOGLE_CLIENT_ID:CLIENT,GOOGLE_CLIENT_SECRET:SECRET}),flow=await start(env,'google');await identityMock(t,flow,{id:'google',keys:[jwk]});
  assert.equal((await service.fetch(callback(flow,'google'),env)).status,302);
  env=environment({GITHUB_CLIENT_ID:CLIENT,GITHUB_CLIENT_SECRET:SECRET});flow=await start(env,'github');
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});if(url==='https://github.com/login/oauth/access_token')return json({access_token:'synthetic-github-token',token_type:'bearer'});assert.equal(url,'https://api.github.com/user');assert.equal(options.headers.Authorization,'Bearer synthetic-github-token');return json({id:12345,login:'fixture-user',name:'Fixture GitHub'});});
  const response=await service.fetch(callback(flow,'github'),env);assert.equal(response.status,302);assert.equal(calls.length,2);
  assert.equal(new URLSearchParams(calls[0].options.body).get('code_verifier').length,43);
  const row=env.DB.raw.prepare('SELECT * FROM arena_auth_exchanges').get();assert.equal(row.provider,'github');assert.equal(row.user_name,'Fixture GitHub');assert.notEqual(row.user_id,'12345');
});

test('provider redirects, errors and oversized responses fail closed without exposing token data',async t=>{
  for(const kind of ['redirect','oversize','error']){
    const env=environment(),flow=await start(env);let calls=0;
    t.mock.method(globalThis,'fetch',async(_,options)=>{calls++;assert.equal(options.redirect,'manual');if(kind==='redirect')return new Response(SECRET,{status:302,headers:{Location:'https://attacker.example'}});if(kind==='oversize')return new Response('x'.repeat(65537));return json({error:SECRET},401);});
    const response=await service.fetch(callback(flow),env);assert.equal(response.status,502);assert.equal((await response.text()).includes(SECRET),false);assert.equal(calls,1);assert.equal(env.DB.raw.prepare('SELECT count(*) AS n FROM arena_auth_exchanges').get().n,0);
  }
});

test('session tokens require exact claims, correct signature, expiry and a live row',async()=>{
  const env=environment({DB:fixtureDB()}),headers={Authorization:'Bearer '+AUTH_SESSION.token};
  assert.equal((await authAuthenticate(request('/api/run',{headers}),env)).user.name,AUTH_USER.name);
  const [h,p,s]=AUTH_SESSION.token.split('.'),claims=JSON.parse(Buffer.from(p,'base64url').toString());
  for(const payload of [{...claims,sub:'X'.repeat(43)},{...claims,exp:1},{...claims,iss:'https://attacker.example'},{...claims,admin:true}])await assert.rejects(authAuthenticate(request('/api/run',{headers:{Authorization:`Bearer ${h}.${b64(JSON.stringify(payload))}.${s}`}}),env),e=>e.status===401);
  const fresh=await authCreateSession(env,AUTH_USER);env.DB.raw.exec('DELETE FROM arena_sessions');
  await assert.rejects(authAuthenticate(request('/api/run',{headers:{Authorization:'Bearer '+fresh.token}}),env),e=>e.status===401);
});

test('auth requests enforce exact bounded JSON, origin policy, and bearer preflight without cookies',async()=>{
  const env=environment();
  for(const body of [{code:'c'.repeat(43),verifier,extra:true},{code:'short',verifier},' '.repeat(2049),'{bad'])assert.equal((await service.fetch(request('/auth/exchange',{method:'POST',body}),env)).status,400);
  assert.equal((await service.fetch(request('/auth/exchange',{method:'POST',headers:{'Content-Type':'text/plain'},body:{code:'c'.repeat(43),verifier}}),env)).status,415);
  assert.equal((await service.fetch(request('/auth/exchange',{method:'POST',headers:{Origin:'https://attacker.example'},body:{code:'c'.repeat(43),verifier}}),env)).status,403);
  const preflight=await service.fetch(request('/auth/exchange',{method:'OPTIONS'}),env);assert.equal(preflight.status,204);assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Authorization/);assert.equal(preflight.headers.has('Access-Control-Allow-Credentials'),false);
});
