// OAuth tokens remain server-side. Browser sessions require both a signed bearer and a live DB row.
export class AuthError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
const authFail=(status,code,message)=>{throw new AuthError(status,code,message);};
const authObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const authExact=(x,keys)=>authObject(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const authValue=(env,key)=>typeof env[key]==='string'?env[key].trim():'';
const authNow=()=>Math.floor(Date.now()/1000);
const AUTH_SESSION_SECONDS=900, AUTH_FLOW_SECONDS=600, AUTH_EXCHANGE_SECONDS=60;
const authEncoder=new TextEncoder();
const authBase64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
function authBytes(text){if(typeof text!=='string'||!/^[A-Za-z0-9_-]+$/.test(text))authFail(401,'invalid_session','Sign in again to continue.');try{return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}catch{authFail(401,'invalid_session','Sign in again to continue.');}}
const authRandom=()=>authBase64(crypto.getRandomValues(new Uint8Array(32)));
const authHash=async text=>authBase64(await crypto.subtle.digest('SHA-256',authEncoder.encode(text)));
const authProof=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const authJSON=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
function authURLs(env){
  try{
    const base=new URL(authValue(env,'AUTH_BASE_URL')),frontend=new URL(authValue(env,'AUTH_FRONTEND_URL'));
    for(const u of [base,frontend])if((u.protocol!=='https:'&&!(authValue(env,'ARENA_LOCAL_TEST')==='true'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))||u.username||u.password||u.search||u.hash)throw new Error();
    if(base.pathname!=='/')throw new Error();
    return {base:base.origin,frontend:frontend.href};
  }catch{authFail(503,'auth_unavailable','Sign-in is not configured by the host.');}
}
function authSecret(env){const secret=authValue(env,'AUTH_SESSION_SECRET');if(secret.length<32||secret.length>512)authFail(503,'auth_unavailable','Sign-in is not configured by the host.');return secret;}
async function authKey(env){return crypto.subtle.importKey('raw',authEncoder.encode(authSecret(env)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function authProvider(env,id){
  const records={
    microsoft:{label:'Microsoft',authorize:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',jwks:'https://login.microsoftonline.com/common/discovery/v2.0/keys',scope:'openid profile'},
    google:{label:'Google',authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',jwks:'https://www.googleapis.com/oauth2/v3/certs',scope:'openid profile'},
    github:{label:'GitHub',authorize:'https://github.com/login/oauth/authorize',token:'https://github.com/login/oauth/access_token',scope:'read:user'},
  };
  if(!Object.hasOwn(records,id))return null;
  return {...records[id],id,clientId:authValue(env,id.toUpperCase()+'_CLIENT_ID'),secret:authValue(env,id.toUpperCase()+'_CLIENT_SECRET')};
}
export async function authReady(env){
  try{
    authURLs(env);authSecret(env);if(!env.DB?.prepare)return false;
    await Promise.all(['SELECT count FROM arena_quota LIMIT 1','SELECT state_hash FROM arena_oauth_states LIMIT 1','SELECT code_hash FROM arena_auth_exchanges LIMIT 1','SELECT session_hash FROM arena_sessions LIMIT 1'].map(sql=>env.DB.prepare(sql).first()));
    return true;
  }catch{return false;}
}
export async function authProviders(env){
  const ready=await authReady(env);
  return ['github','microsoft','google'].map(id=>{const p=authProvider(env,id),available=ready&&!!p.clientId&&!!p.secret;return {id,label:p.label,available,reason:available?'Sign in to access the challenge.':'Sign-in provider is not connected.'};});
}
async function authRequireReady(env){if(!await authReady(env))authFail(503,'auth_unavailable','Sign-in is temporarily unavailable.');}
async function authReadJSON(response,limit=65536,signal){
  const reader=response.body?.getReader();if(!reader)authFail(502,'auth_provider_response','The sign-in provider returned an invalid response.');
  let size=0;const chunks=[];const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{while(true){if(signal?.aborted)throw new Error('aborted');const {done,value}=await reader.read();if(signal?.aborted)throw new Error('aborted');if(done)break;size+=value.length;if(size>limit){await reader.cancel();authFail(502,'auth_provider_response','The sign-in provider returned an invalid response.');}chunks.push(value);}}
  finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{authFail(502,'auth_provider_response','The sign-in provider returned an invalid response.');}
}
async function authFetchJSON(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const result=await globalThis.fetch(url,{...options,redirect:'manual',signal:controller.signal});
    if(!result.ok||result.status>=300&&result.status<400)authFail(502,'auth_provider_response','The sign-in provider could not complete authentication.');
    return await authReadJSON(result,65536,controller.signal);
  }catch(error){if(error instanceof AuthError)throw error;authFail(502,'auth_provider_unavailable','The sign-in provider could not be reached.');}finally{clearTimeout(timer);}
}
const authCookieName=state=>'__Host-arena_oauth_'+state.slice(0,16);
function authCookie(request,name){const matches=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):null;}
const authCookieHeader=(state,value,maxAge)=>`${authCookieName(state)}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const authCleanName=(name,fallback)=>typeof name==='string'&&name.trim()?name.replace(/[\u0000-\u001F\u007F]/g,'').trim().slice(0,100)||fallback:fallback;
async function authCleanup(env){for(const [table,column] of [['arena_quota','window_key'],['arena_oauth_states','state_hash'],['arena_auth_exchanges','code_hash'],['arena_sessions','session_hash']])await env.DB.prepare(`DELETE FROM ${table} WHERE ${column} IN (SELECT ${column} FROM ${table} WHERE expires_at < ? LIMIT 100)`).bind(authNow()).run();}
async function authReserveStart(request,env){
  const host=new URL(request.url).hostname;
  if(authValue(env,'ARENA_LOCAL_TEST')==='true'&&['localhost','127.0.0.1','[::1]'].includes(host))return;
  const edgeIP=request.headers.get('CF-Connecting-IP');
  if(!edgeIP||edgeIP.length>64||!/^[a-fA-F0-9:.]+$/.test(edgeIP))authFail(503,'auth_identity_unavailable','Sign-in is temporarily unavailable.');
  const identity=authBase64(await crypto.subtle.sign('HMAC',await authKey(env),authEncoder.encode(edgeIP))),now=new Date(),expiry=authNow()+172800;
  const sql='INSERT INTO arena_quota (window_key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(window_key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count';
  const result=await env.DB.batch([
    env.DB.prepare(sql).bind('auth-global:'+now.toISOString().slice(0,10),expiry,1000),
    env.DB.prepare(sql).bind('auth-visitor:'+identity+':'+now.toISOString().slice(0,13),expiry,20),
  ]);
  if(result.some(row=>!row.results?.length))authFail(429,'sign_in_limit','Too many sign-in attempts. Try again later.');
}
async function authLogin(request,env,id){
  await authRequireReady(env);const p=authProvider(env,id);
  if(!p||!p.clientId||!p.secret)authFail(503,'provider_unavailable','This sign-in provider is not connected.');
  const url=new URL(request.url),challenge=url.searchParams.get('challenge');
  if(url.searchParams.size!==1||!authProof(challenge))authFail(400,'invalid_login','Start sign-in from the challenge page.');
  await authReserveStart(request,env);
  const {base}=authURLs(env),state=authRandom(),binding=authRandom(),verifier=authRandom(),nonce=authRandom();
  await authCleanup(env);
  await env.DB.prepare('INSERT INTO arena_oauth_states (state_hash, provider, verifier, nonce, binding_hash, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await authHash(state),id,verifier,nonce,await authHash(binding),challenge,authNow()+AUTH_FLOW_SECONDS).run();
  const dest=new URL(p.authorize);
  for(const [key,value] of Object.entries({client_id:p.clientId,redirect_uri:base+'/auth/callback/'+id,response_type:'code',scope:p.scope,state,code_challenge:await authHash(verifier),code_challenge_method:'S256',...(id!=='github'?{nonce,response_mode:'query'}:{})}))dest.searchParams.set(key,value);
  return new Response(null,{status:302,headers:{Location:dest.href,'Set-Cookie':authCookieHeader(state,binding,AUTH_FLOW_SECONDS),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
async function authOIDCIdentity(p,token,nonce){
  if(typeof token!=='string'||token.length>16000)authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  const parts=token.split('.');if(parts.length!==3)authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  let header,claims;
  try{header=JSON.parse(new TextDecoder().decode(authBytes(parts[0])));claims=JSON.parse(new TextDecoder().decode(authBytes(parts[1])));}catch{authFail(401,'invalid_identity','The sign-in identity could not be verified.');}
  if(!authObject(header)||header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||header.crit||!authObject(claims))authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  const now=authNow();
  if(claims.aud!==p.clientId||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||!Number.isInteger(claims.exp)||claims.exp<=now||!Number.isInteger(claims.iat)||claims.iat>now+60||claims.iat<now-3600||claims.exp>now+86400||(claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>now+60))||(claims.azp!==undefined&&claims.azp!==p.clientId))authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  if(p.id==='microsoft'){
    if(claims.ver!=='2.0'||typeof claims.tid!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.tid)||claims.iss!==`https://login.microsoftonline.com/${claims.tid}/v2.0`)authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  }else if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss))authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  const keys=await authFetchJSON(p.jwks);
  if(!Array.isArray(keys?.keys)||keys.keys.length>100)authFail(502,'auth_provider_response','The sign-in provider returned invalid signing keys.');
  const matches=keys.keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(matches.length!==1)authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  const jwk=matches[0];
  if(p.id==='microsoft'&&jwk.issuer&&jwk.issuer.replace('{tenantid}',claims.tid)!==claims.iss)authFail(401,'invalid_identity','The sign-in identity could not be verified.');
  try{const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,authBytes(parts[2]),authEncoder.encode(parts[0]+'.'+parts[1])))throw new Error();}catch{authFail(401,'invalid_identity','The sign-in identity could not be verified.');}
  return {subject:claims.sub,issuer:p.id==='google'?'https://accounts.google.com':claims.iss,name:authCleanName(claims.name,p.label+' user')};
}
async function authCallback(request,env,id){
  await authRequireReady(env);const p=authProvider(env,id),url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!p||!p.clientId||!p.secret)authFail(503,'provider_unavailable','This sign-in provider is not connected.');
  if(!authProof(state)||url.searchParams.getAll('state').length!==1)authFail(400,'invalid_state','Start sign-in again from the challenge page.');
  const binding=authCookie(request,authCookieName(state));
  if(!authProof(binding))authFail(400,'invalid_state','Start sign-in again from the challenge page.');
  const flow=await env.DB.prepare('DELETE FROM arena_oauth_states WHERE state_hash = ? AND provider = ? AND binding_hash = ? AND expires_at > ? RETURNING *').bind(await authHash(state),id,await authHash(binding),authNow()).first();
  if(!flow)authFail(400,'invalid_state','Start sign-in again from the challenge page.');
  const {base,frontend}=authURLs(env),clearCookie=authCookieHeader(state,'',0);
  if(url.searchParams.has('error'))return new Response(null,{status:302,headers:{Location:frontend+'#auth_error=cancelled','Set-Cookie':clearCookie,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  if(typeof code!=='string'||!code||code.length>8192||url.searchParams.getAll('code').length!==1)authFail(400,'invalid_code','Start sign-in again from the challenge page.');
  const body=new URLSearchParams({client_id:p.clientId,client_secret:p.secret,code,code_verifier:flow.verifier,grant_type:'authorization_code',redirect_uri:base+'/auth/callback/'+id});
  const tokens=await authFetchJSON(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:body.toString()});
  let identity;
  if(id==='github'){
    if(typeof tokens.access_token!=='string'||tokens.access_token.length<1||tokens.access_token.length>8000||String(tokens.token_type).toLowerCase()!=='bearer')authFail(401,'invalid_identity','The sign-in identity could not be verified.');
    const profile=await authFetchJSON('https://api.github.com/user',{headers:{Authorization:'Bearer '+tokens.access_token,Accept:'application/vnd.github+json','User-Agent':'Syntony-Arena','X-GitHub-Api-Version':'2022-11-28'}});
    if(!Number.isSafeInteger(profile.id)||profile.id<=0||typeof profile.login!=='string'||!/^[a-zA-Z0-9-]{1,39}$/.test(profile.login))authFail(401,'invalid_identity','The sign-in identity could not be verified.');
    identity={subject:String(profile.id),issuer:'https://github.com',name:authCleanName(profile.name,profile.login)};
  }else identity=await authOIDCIdentity(p,tokens.id_token,flow.nonce);
  const user={id:await authHash(id+'\n'+identity.issuer+'\n'+identity.subject),name:identity.name,provider:id},exchange=authRandom();
  await env.DB.prepare('INSERT INTO arena_auth_exchanges (code_hash, user_id, user_name, provider, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)').bind(await authHash(exchange),user.id,user.name,id,flow.challenge,authNow()+AUTH_EXCHANGE_SECONDS).run();
  return new Response(null,{status:302,headers:{Location:frontend+'#auth_code='+exchange,'Set-Cookie':clearCookie,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
export async function authCreateSession(env,user){
  const now=authNow(),jti=authRandom(),expiresAt=now+AUTH_SESSION_SECONDS;
  const payload={iss:authURLs(env).base,aud:'syntony-arena',sub:user.id,jti,iat:now,exp:expiresAt};
  const data=authBase64(authEncoder.encode(JSON.stringify({alg:'HS256',typ:'JWT'})))+'.'+authBase64(authEncoder.encode(JSON.stringify(payload)));
  const token=data+'.'+authBase64(await crypto.subtle.sign('HMAC',await authKey(env),authEncoder.encode(data)));
  await env.DB.prepare('INSERT INTO arena_sessions (session_hash, user_id, user_name, provider, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await authHash(jti),user.id,user.name,user.provider,expiresAt).run();
  return {token,expiresAt,user};
}
export async function authAuthenticate(request,env,required=true){
  const authorization=request.headers.get('Authorization');
  if(!authorization){if(required)authFail(401,'sign_in_required','Sign in to use the hosted challenge.');return null;}
  if(!authorization.startsWith('Bearer ')||authorization.length>4096)authFail(401,'invalid_session','Sign in again to continue.');
  const parts=authorization.slice(7).split('.');if(parts.length!==3)authFail(401,'invalid_session','Sign in again to continue.');
  let header,claims;try{header=JSON.parse(new TextDecoder().decode(authBytes(parts[0])));claims=JSON.parse(new TextDecoder().decode(authBytes(parts[1])));}catch{authFail(401,'invalid_session','Sign in again to continue.');}
  const now=authNow();
  if(!authExact(header,['alg','typ'])||header.alg!=='HS256'||header.typ!=='JWT'||!authExact(claims,['iss','aud','sub','jti','iat','exp'])||claims.iss!==authURLs(env).base||claims.aud!=='syntony-arena'||!authProof(claims.sub)||!authProof(claims.jti)||!Number.isInteger(claims.iat)||claims.iat>now+60||!Number.isInteger(claims.exp)||claims.exp<=now||claims.exp-claims.iat!==AUTH_SESSION_SECONDS)authFail(401,'invalid_session','Sign in again to continue.');
  if(!await crypto.subtle.verify('HMAC',await authKey(env),authBytes(parts[2]),authEncoder.encode(parts[0]+'.'+parts[1])))authFail(401,'invalid_session','Sign in again to continue.');
  await authRequireReady(env);
  const sessionHash=await authHash(claims.jti),row=await env.DB.prepare('SELECT user_id, user_name, provider, expires_at FROM arena_sessions WHERE session_hash = ? AND expires_at > ?').bind(sessionHash,now).first();
  if(!row||row.user_id!==claims.sub||row.expires_at!==claims.exp||!authProvider(env,row.provider))authFail(401,'invalid_session','Sign in again to continue.');
  return {user:{id:row.user_id,name:row.user_name,provider:row.provider},expiresAt:claims.exp,sessionHash};
}
async function authBody(request){
  if((request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase()!=='application/json')authFail(415,'content_type','Use application/json.');
  if(Number(request.headers.get('Content-Length'))>2048)authFail(413,'body_too_large','The sign-in request is too large.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{return await authReadJSON(request,2048,controller.signal);}catch{authFail(400,'invalid_auth_request','The sign-in request is invalid.');}finally{clearTimeout(timer);}
}
export async function authHandleRequest(request,env){
  const path=new URL(request.url).pathname.replace(/\/$/,'');
  if(path==='/auth/session'&&request.method==='GET'){
    const providers=await authProviders(env);let session=null;
    try{session=await authAuthenticate(request,env,false);}catch(error){if(!(error instanceof AuthError)||error.status!==401)throw error;}
    return authJSON({authenticated:!!session,user:session?.user||null,providers,...(session?{expiresAt:session.expiresAt}:{})});
  }
  if(path==='/auth/exchange'&&request.method==='POST'){
    await authRequireReady(env);const body=await authBody(request);
    if(!authExact(body,['code','verifier'])||!authProof(body.code)||!authProof(body.verifier))authFail(400,'invalid_exchange','Restart sign-in from the challenge page.');
    const row=await env.DB.prepare('DELETE FROM arena_auth_exchanges WHERE code_hash = ? AND challenge = ? AND expires_at > ? RETURNING *').bind(await authHash(body.code),await authHash(body.verifier),authNow()).first();
    if(!row)authFail(401,'invalid_exchange','The sign-in exchange expired or was already used. Start sign-in again.');
    return authJSON(await authCreateSession(env,{id:row.user_id,name:row.user_name,provider:row.provider}));
  }
  if(path==='/auth/logout'&&request.method==='POST'){
    const session=await authAuthenticate(request,env,false);
    if(session)await env.DB.prepare('DELETE FROM arena_sessions WHERE session_hash = ?').bind(session.sessionHash).run();
    return authJSON({authenticated:false});
  }
  const login=path.match(/^\/auth\/login\/(github|microsoft|google)$/);if(login&&request.method==='GET')return authLogin(request,env,login[1]);
  const callback=path.match(/^\/auth\/callback\/(github|microsoft|google)$/);if(callback&&request.method==='GET')return authCallback(request,env,callback[1]);
  return null;
}
