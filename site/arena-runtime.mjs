// Hosted transport only. Model credentials and prompt construction stay on the server.
import {ARENA_API_URL} from './arena-config.mjs?v=20261009-3';
import {arenaAuth} from './arena-auth.mjs?v=20261009-3';

export const TARGETS = Object.freeze([
  Object.freeze({id:'openai',label:'OpenAI'}),
  Object.freeze({id:'phi',label:'Microsoft Phi'}),
  Object.freeze({id:'llama',label:'Meta Llama'}),
  Object.freeze({id:'claude',label:'Anthropic Claude'}),
  Object.freeze({id:'mistral',label:'Mistral'}),
  Object.freeze({id:'qwen',label:'Qwen'}),
  Object.freeze({id:'gemini',label:'Google Gemini Flash'}),
]);
const clean = (value, fallback='') => typeof value==='string' ? value.replace(/[\u0000-\u001f]/g,' ').slice(0,300) : fallback;
const unavailable = reason => TARGETS.map(target=>({...target,provider:'',model:'',configured:false,available:false,reason}));

export class HostedAgent {
  constructor(onStatus=()=>{}, apiURL=ARENA_API_URL) {
    this.onStatus=onStatus;
    this.apiURL=apiURL;
    this.targets=unavailable('Hosted service has not been checked.');
    this.ready=false;
    this.pending=new Set();
    this.configLoaded=false;
    this.limits={};
  }
  endpoint(path) {
    if(typeof this.apiURL!=='string'||!this.apiURL.trim())throw new Error('The hosted service is not configured.');
    let url;
    try {url=new URL(this.apiURL,globalThis.location?.href||'https://invalid.local/');}catch{throw new Error('The hosted service address is invalid.');}
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(local&&url.protocol==='http:')))throw new Error('The hosted service requires a secure configured address.');
    url.pathname=`${url.pathname.replace(/\/$/,'')}/${path}`;
    return url.href;
  }
  async request(path,body,timeout=90000) {
    const url=this.endpoint(path),controller=new AbortController();
    this.pending.add(controller);
    const timer=setTimeout(()=>controller.abort(),timeout);
    try {
      const response=await fetch(url,{
        method:body===undefined?'GET':'POST',
        headers:{'Accept':'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...arenaAuth.headers()},
        body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,
      });
      let result;
      try {result=await response.json();}catch{throw new Error('The hosted service returned an unreadable response. No action was applied.');}
      if(response.status===401)arenaAuth.clear('Your session expired. Sign in again before continuing.');
      if(!response.ok)throw new Error(clean(result?.error?.message||result?.error||result?.message,`Hosted request failed (${response.status}). No action was applied.`));
      return result;
    } catch(error) {
      if(error.name==='AbortError')throw new Error('The hosted request was stopped or timed out. No action was applied.');
      if(error instanceof TypeError)throw new Error('The hosted service could not be reached. No action was applied.');
      throw error;
    } finally {clearTimeout(timer);this.pending.delete(controller);}
  }
  async getConfig() {
    try {
      const config=await this.request('config',undefined,15000);
      if(!Array.isArray(config?.targets))throw new Error('The hosted service returned an invalid target configuration.');
      this.targets=TARGETS.map(defaultTarget=>{
        const reported=config.targets.find(t=>t?.id===defaultTarget.id);
        if(!reported)return {...defaultTarget,provider:'',model:'',configured:false,available:false,reason:'Not configured by the host.'};
        return {...defaultTarget,label:clean(reported.label,defaultTarget.label),provider:clean(reported.provider),model:clean(reported.model),configured:reported.configured===true,available:reported.available===true,reason:clean(reported.reason,reported.available===true?'Available for hosted inference.':'Not available from this service.')};
      });
      this.limits=config.limits&&typeof config.limits==='object'?config.limits:{};
      this.configLoaded=true;
      if(!this.targets.some(t=>t.available))this.ready=false;
      return {targets:this.targets,limits:this.limits};
    } catch(error) {
      this.targets=unavailable(error.message||'The hosted service is unavailable.');
      this.ready=false;this.configLoaded=true;
      throw error;
    }
  }
  target(id) {return this.targets.find(t=>t.id===id);}
  async start(targetId) {
    if(!arenaAuth.require())throw new Error('Sign in before starting a hosted AI session.');
    await this.getConfig();
    if(!this.target(targetId)?.available)throw new Error('This target is not available. Choose an available target or guided practice.');
    this.ready=true;
    return this.target(targetId);
  }
  async generate({campaignId,rounds,attackText,targetId}) {
    if(!arenaAuth.require())throw new Error('Sign in before sending a hosted model request.');
    if(!this.ready)throw new Error('Start a live session before sending a model request.');
    if(!this.target(targetId)?.available)throw new Error('The selected hosted target is not available.');
    const result=await this.request('run',{campaignId,rounds,attackText,targetId});
    if(typeof result?.text!=='string'||typeof result?.model!=='string'||!result.model.trim()||typeof result?.provider!=='string'||!result.provider.trim())throw new Error('The hosted service returned incomplete model evidence. No action was applied.');
    return {text:result.text,model:clean(result.model),provider:clean(result.provider),usage:result.usage??null,runId:clean(result.runId),modelDisplayLabel:clean(result.modelDisplayLabel,result.model)};
  }
  end() {this.ready=false;for(const controller of this.pending)controller.abort();this.pending.clear();}
}
