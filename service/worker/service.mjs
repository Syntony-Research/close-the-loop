import {AuthError, authAuthenticate, authProviders, authHandleRequest} from './auth.mjs';
import {CAMPAIGNS, MAX_ATTACK_LENGTH, createWorld, applyRound, buildAgentMessages, validateProposal} from './world.mjs';

const MAX_BODY_BYTES=32768, MAX_PROVIDER_BYTES=65536;
const GEMINI_FLASH_MODEL='gemini-3.6-flash';
const GEMINI_FLASH_ENDPOINT=`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent`;
const serverObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const serverExact=(x,keys)=>serverObject(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export class ArenaError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new ArenaError(status,code,message);};
const value=(env,key)=>typeof env[key]==='string'?env[key].trim():'';
const enabled=(env,key)=>value(env,key)==='true';
// BLACKLINE uses this service for identity only. Legacy model routes require a
// separate, deliberate host opt-in; an old live flag or retained key is not enough.
const inferenceEnabled=env=>env.ARENA_INFERENCE_ENABLED==='true';

export function reconstructRun(input){
  if(!serverExact(input,['campaignId','rounds','attackText','targetId']))fail(400,'invalid_request','Send only campaignId, rounds, attackText and targetId.');
  if(!CAMPAIGNS.some(c=>c.id===input.campaignId)||!['openai','phi','llama','claude','mistral','qwen','grok','deepseek','gemini'].includes(input.targetId))fail(400,'unknown_target','Unknown campaign or model target.');
  if(!Array.isArray(input.rounds)||input.rounds.length>2)fail(400,'invalid_rounds','A live request requires zero, one or two completed rounds.');
  if(typeof input.attackText!=='string'||input.attackText.length>MAX_ATTACK_LENGTH)fail(400,'invalid_attack',`Limit the untrusted message to ${MAX_ATTACK_LENGTH} characters.`);
  let world=createWorld(input.campaignId);
  try{
    for(const round of input.rounds){
      if(!serverExact(round,['proposal','controlId','attackText','source','modelId']))fail(400,'invalid_history','Round history contains unsupported fields.');
      world=applyRound(world,round);
    }
  }catch(error){if(error instanceof ArenaError)throw error;fail(400,'invalid_history','Round history failed trusted replay.');}
  const messages=buildAgentMessages(world,input.attackText);
  return {world,messages,campaign:CAMPAIGNS.find(c=>c.id===input.campaignId)};
}

function azureEndpoint(raw,path='/openai/v1/chat/completions'){
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||!(/^[a-z0-9-]+\.(services\.ai\.azure\.com|openai\.azure\.com)$/.test(url.hostname))||url.pathname!==path)return null;
    if(path==='/anthropic/v1/messages'&&!url.hostname.endsWith('.services.ai.azure.com'))return null;
    return url.href;
  }catch{return null;}
}

export function targetDefinitions(env){
  const targets=[{id:'openai',label:'OpenAI',provider:'OpenAI Responses',model:value(env,'OPENAI_MODEL')||'gpt-5.6-terra',endpoint:'https://api.openai.com/v1/responses',key:value(env,'OPENAI_API_KEY'),verified:enabled(env,'OPENAI_VERIFIED')}];
  for(const [id,label] of [['phi','Microsoft Phi'],['llama','Meta Llama'],['claude','Anthropic Claude'],['mistral','Mistral'],['qwen','Qwen'],['grok','xAI Grok'],['deepseek','DeepSeek']]){
    const prefix=id.toUpperCase();
    targets.push({id,label,provider:id==='claude'?'Microsoft Foundry Anthropic Messages':'Microsoft Foundry Chat Completions',model:value(env,`${prefix}_MODEL`),endpoint:azureEndpoint(value(env,`${prefix}_ENDPOINT`),id==='claude'?'/anthropic/v1/messages':'/openai/v1/chat/completions'),key:value(env,`${prefix}_API_KEY`),verified:enabled(env,`${prefix}_VERIFIED`)});
  }
  // A host setting cannot redirect the Google key to another origin or model route.
  const geminiModel=value(env,'GEMINI_MODEL')||GEMINI_FLASH_MODEL;
  const geminiEndpoint=value(env,'GEMINI_ENDPOINT')||GEMINI_FLASH_ENDPOINT;
  targets.push({id:'gemini',label:'Google Gemini Flash',provider:'Google Gemini generateContent',model:geminiModel,endpoint:geminiModel===GEMINI_FLASH_MODEL&&geminiEndpoint===GEMINI_FLASH_ENDPOINT?GEMINI_FLASH_ENDPOINT:null,key:value(env,'GEMINI_API_KEY'),verified:enabled(env,'GEMINI_VERIFIED')});
  return targets;
}

function publicTargets(env,quotaReady){
  if(!inferenceEnabled(env))return [];
  return targetDefinitions(env).map(t=>{
    const configured=!!(t.key&&t.endpoint&&t.model);
    const available=configured&&t.verified&&enabled(env,'ARENA_LIVE_ENABLED')&&quotaReady;
    const unavailableReason=value(env,`${t.id.toUpperCase()}_UNAVAILABLE_REASON`).slice(0,200);
    const reason=!configured?(unavailableReason||(t.id==='gemini'&&!t.key?'Google Gemini API key is not connected.':'Hosted endpoint is not connected.')):!t.verified?(unavailableReason||'Hosted target awaits a successful operator verification.'):!enabled(env,'ARENA_LIVE_ENABLED')?'Live inference is paused by the host.':!quotaReady?'Durable request limits are not ready.':'Available for hosted inference. Synthetic data only.';
    return {id:t.id,label:t.label,provider:t.provider,model:t.model,configured,available,reason};
  });
}

function localTest(request,env){return enabled(env,'ARENA_LOCAL_TEST')&&['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);}
async function quotaReady(request,env){
  if(localTest(request,env))return true;
  if(!env.DB?.prepare)return false;
  try{await env.DB.prepare('SELECT count FROM arena_quota LIMIT 1').first();return true;}catch{return false;}
}

async function reserveQuota(request,env,session){
  // Local operator checks never run on a hosted hostname and cannot be enabled by request data.
  if(localTest(request,env))return;
  if(!env.DB?.prepare)fail(503,'quota_unavailable','Live inference is unavailable until durable limits are configured.');
  const now=new Date(),day=now.toISOString().slice(0,10),hour=now.toISOString().slice(0,13);
  const anonymousId=session.user.id; // Derived only from a verified provider subject, never request headers.
  const sql='INSERT INTO arena_quota (window_key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(window_key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count';
  try{
    const expiry=Math.floor(now.getTime()/1000)+172800;
    const result=await env.DB.batch([
      env.DB.prepare(sql).bind(`global:${day}`,expiry,60),
      env.DB.prepare(sql).bind(`visitor:${anonymousId}:${hour}`,expiry,12),
    ]);
    if(result.some(r=>!r.results?.length))fail(429,'trial_limit','This shared trial has reached its request limit. Guided practice remains available.');
    // Bounded cleanup; no raw prompts, provider responses, or IP addresses are stored.
    await env.DB.prepare('DELETE FROM arena_quota WHERE window_key IN (SELECT window_key FROM arena_quota WHERE expires_at < ? LIMIT 100)').bind(Math.floor(now.getTime()/1000)).run();
  }catch(error){if(error instanceof ArenaError)throw error;fail(503,'quota_unavailable','Durable request limits are unavailable. No model request was sent.');}
}

async function boundedText(response,limit,signal){
  const reader=response.body?.getReader();
  if(!reader)return '';
  let size=0;const chunks=[];
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    while(true){const {done,value}=await reader.read();if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,'body_too_large','The response exceeds the allowed size.');}chunks.push(value);}
  }finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

function publicUsage(usage){
  if(!serverObject(usage))return null;
  const safe={};
  for(const key of ['input_tokens','output_tokens','total_tokens','prompt_tokens','completion_tokens']){
    if(Number.isSafeInteger(usage[key])&&usage[key]>=0)safe[key]=usage[key];
  }
  return Object.keys(safe).length?safe:null;
}

function geminiUsage(usage){
  if(!serverObject(usage))return null;
  const safe={};
  // Keep Google candidate and thought counts separate; total includes both.
  for(const [source,destination] of [['promptTokenCount','input_tokens'],['candidatesTokenCount','candidate_tokens'],['thoughtsTokenCount','reasoning_tokens'],['totalTokenCount','total_tokens']]){
    if(Number.isSafeInteger(usage[source])&&usage[source]>=0)safe[destination]=usage[source];
  }
  if(Object.hasOwn(safe,'candidate_tokens')&&Object.hasOwn(safe,'reasoning_tokens')&&Number.isSafeInteger(safe.candidate_tokens+safe.reasoning_tokens))safe.output_tokens=safe.candidate_tokens+safe.reasoning_tokens;
  return Object.keys(safe).length?safe:null;
}

export async function requestModel(target,messages,schema,signal,fetchImpl=(...args)=>globalThis.fetch(...args)){
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();
  const timer=setTimeout(abort,45000);
  try{
    const body=target.id==='openai'?{
      model:target.model,input:messages,store:false,max_output_tokens:400,
      reasoning:{effort:'none'},text:{format:{type:'json_schema',name:'arena_proposal',strict:true,schema}},
    }:target.id==='claude'?{
      model:target.model,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),messages:messages.filter(m=>m.role!=='system'),max_tokens:400,temperature:0,
    }:target.id==='gemini'?{
      systemInstruction:{parts:messages.filter(m=>m.role==='system').map(m=>({text:m.content}))},
      contents:messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),
      // REST TextResponseFormat uses a protobuf enum, unlike legacy responseMimeType.
      generationConfig:{maxOutputTokens:1024,thinkingConfig:{thinkingLevel:'minimal',includeThoughts:false},responseFormat:{text:{mimeType:'APPLICATION_JSON',schema}}},
    }:{model:target.model,messages,max_tokens:400,temperature:0,...(['phi','mistral'].includes(target.id)?{response_format:{type:'json_object'}}:{})};
    const headers=target.id==='claude'?{'x-api-key':target.key,'anthropic-version':'2023-06-01','Content-Type':'application/json'}:target.id==='gemini'?{'x-goog-api-key':target.key,'Content-Type':'application/json'}:{'Authorization':`Bearer ${target.key}`,'Content-Type':'application/json'};
    const response=await fetchImpl(target.endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'manual'});
    if(response.status>=300&&response.status<400)fail(502,'provider_redirect','The model endpoint redirected unexpectedly. No action was applied.');
    const raw=await boundedText(response,MAX_PROVIDER_BYTES,controller.signal);
    if(response.status===402)fail(503,'provider_credit','This provider has no available inference credits. Choose another connected model.');
    let data;try{data=JSON.parse(raw);}catch{fail(502,'provider_response','The model provider returned an unreadable response. No action was applied.');}
    if(!response.ok){
      const code=data?.error?.code;
      if(code==='insufficient_quota')fail(503,'provider_quota','The model account has no available API quota. Guided practice remains available.');
      if(response.status===401||response.status===403)fail(503,'provider_access','The host must verify this model endpoint and its credentials.');
      if(response.status===429)fail(429,'provider_limit','The model provider is at its request limit. Try again later.');
      fail(502,'provider_error','The model provider could not complete this request. No action was applied.');
    }
    let text;
    if(target.id==='openai'){
      if(data.status!=='completed')fail(502,'incomplete_output','The model response was incomplete. No action was applied.');
      const content=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]);
      if(content.some(x=>x.type==='refusal'))fail(422,'model_refusal','The model declined this request. No action was applied.');
      text=content.filter(x=>x.type==='output_text').map(x=>x.text).join('');
    }else if(target.id==='claude'){
      if(data.stop_reason==='refusal')fail(422,'model_refusal','The model declined this request. No action was applied.');
      if(data.stop_reason!=='end_turn')fail(502,'incomplete_output','The model response was incomplete. No action was applied.');
      text=(data.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('');
    }else if(target.id==='gemini'){
      const candidate=data.candidates?.[0];
      const blockReason=data.promptFeedback?.blockReason;
      if((blockReason&&blockReason!=='BLOCK_REASON_UNSPECIFIED')||['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY','IMAGE_PROHIBITED_CONTENT','IMAGE_RECITATION','ESCALATION','PUP_LIMITED_DISABLED'].includes(candidate?.finishReason)||candidate?.safetyRatings?.some(r=>r.blocked===true))fail(422,'model_refusal','The model declined this request. No action was applied.');
      if(!Array.isArray(data.candidates)||data.candidates.length!==1||candidate?.finishReason!=='STOP')fail(502,'incomplete_output','The model response was incomplete. No action was applied.');
      const parts=candidate.content?.parts;
      if(!Array.isArray(parts)||parts.some(p=>!serverObject(p)||(p.thought!==undefined&&typeof p.thought!=='boolean')||(p.thought!==true&&typeof p.text!=='string')))fail(502,'provider_response','The model provider returned an unreadable response. No action was applied.');
      text=parts.filter(p=>p.thought!==true).map(p=>p.text).join('');
    }else{
      if(data.choices?.[0]?.finish_reason!=='stop')fail(502,'incomplete_output','The model response was incomplete. No action was applied.');
      text=data.choices?.[0]?.message?.content;
    }
    if(typeof text!=='string'||!text.trim()||text.length>8000)fail(502,'empty_output','The model returned no usable proposal. No action was applied.');
    return {text,usage:target.id==='gemini'?geminiUsage(data.usageMetadata):publicUsage(data.usage)};
  }catch(error){
    if(error instanceof ArenaError)throw error;
    if(controller.signal.aborted)fail(504,'provider_timeout','The model request was stopped or timed out. No action was applied.');
    const diagnostic=String(error?.message||'Unknown transport failure').split(target.key).join('[redacted]').slice(0,500);
    console.error('Arena provider transport:',String(error?.name||'Error').slice(0,40),diagnostic);
    fail(502,'provider_network','The model provider could not be reached. No action was applied.');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function corsOrigin(request,env){
  const origin=request.headers.get('Origin');
  const allowed=(value(env,'ARENA_ALLOWED_ORIGINS')||'https://www.syntonyresearch.ai,https://syntonyresearch.ai').split(',').map(x=>x.trim()).filter(Boolean);
  if(localTest(request,env))allowed.push('http://127.0.0.1:8767','http://localhost:8767');
  if(origin&&!allowed.includes(origin))fail(403,'origin_denied','This origin is not enabled for the arena service.');
  return origin;
}
const response=(data,status,origin)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'}});

export default {
  async fetch(request,env){
    let origin;
    try{
      origin=corsOrigin(request,env);
      const path=new URL(request.url).pathname.replace(/\/$/,'');
      if(path==='/api/run'&&!inferenceEnabled(env))return response({error:{code:'inference_disabled',message:'Hosted model inference is disabled. BLACKLINE runs as a local simulation.'}},410,origin);
      if(request.method==='OPTIONS'&&['/api/config','/api/run','/auth/session','/auth/exchange','/auth/logout'].includes(path))return new Response(null,{status:204,headers:response({},200,origin).headers});
      if(path.startsWith('/auth/')){
        const authResult=await authHandleRequest(request,env);
        if(authResult){const headers=new Headers(authResult.headers);for(const [key,value] of response({},200,origin).headers)if(key.toLowerCase().startsWith('access-control-')||key.toLowerCase()==='vary')headers.set(key,value);return new Response(authResult.body,{status:authResult.status,headers});}
      }
      if(path==='/api/config'&&request.method==='GET'){
        const inference=inferenceEnabled(env);
        return response({auth:{required:true,providers:await authProviders(env)},inference:{enabled:inference},targets:inference?publicTargets(env,await quotaReady(request,env)):[],limits:inference?{maxAttackLength:MAX_ATTACK_LENGTH,maxRounds:3,requestsPerVisitorHour:12,sharedRequestsPerDay:60}:null,notice:inference?'Synthetic trial. Inference is hosted; replay does not authenticate model provenance.':'Identity service for BLACKLINE. Gameplay is a local simulation; hosted model inference is disabled.'},200,origin);
      }
      if(path==='/api/run'&&request.method==='POST'){
        if((request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'content_type','Use application/json.');
        if(Number(request.headers.get('Content-Length'))>MAX_BODY_BYTES)fail(413,'body_too_large','The request exceeds 32 KiB.');
        const raw=await boundedText(request,MAX_BODY_BYTES);
        let input;try{input=JSON.parse(raw);}catch{fail(400,'invalid_json','The request must be a JSON object.');}
        const {world,messages,campaign}=reconstructRun(input);
        const session=await authAuthenticate(request,env);
        const availability=publicTargets(env,await quotaReady(request,env)).find(t=>t.id===input.targetId);
        if(!availability.available)fail(503,'target_unavailable',availability.reason);
        await reserveQuota(request,env,session);
        const target=targetDefinitions(env).find(t=>t.id===input.targetId);
        const result=await requestModel(target,messages,campaign.proposalSchema,request.signal);
        const parsed=validateProposal(world.campaignId,result.text);
        if(!parsed.valid)fail(422,'invalid_proposal','The model response did not match the permitted proposal format. No action was applied.');
        return response({...result,text:JSON.stringify(parsed.proposal),model:target.model,provider:target.provider,modelDisplayLabel:target.label,runId:crypto.randomUUID()},200,origin);
      }
      if(path===''&&request.method==='GET')return response({service:'Syntony challenge identity service',version:'1.0.1',endpoints:['/api/config','/auth/session',...(inferenceEnabled(env)?['/api/run']:[])],data:inferenceEnabled(env)?'Synthetic challenge inputs only.':'BLACKLINE gameplay is a local simulation. Hosted model inference is disabled.'},200,origin);
      return response({error:{code:'not_found',message:'Endpoint not found.'}},404,origin);
    }catch(error){
      const known=error instanceof ArenaError||error instanceof AuthError;
      return response({error:{code:known?error.code:'service_error',message:known?error.message:'The service could not complete this request. No action was applied.'}},known?error.status:500,origin);
    }
  },
};
