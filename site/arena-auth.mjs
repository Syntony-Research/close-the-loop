// Sign-in transport. Provider credentials remain on the hosted service.
import {ARENA_API_URL} from './arena-config.mjs';
const SESSION_KEY='syntony-arena-session-v1';
const VERIFIER_KEY='syntony-arena-auth-verifier-v1';
const PROVIDERS=[{id:'github',label:'GitHub'},{id:'microsoft',label:'Microsoft'},{id:'google',label:'Google'}];
const clean=(value,fallback='')=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,220):fallback;
const storage={get(key){try{return sessionStorage.getItem(key);}catch{return null;}},set(key,value){try{sessionStorage.setItem(key,value);return true;}catch{return false;}},remove(key){try{sessionStorage.removeItem(key);}catch{}}};
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function expiry(value){if(typeof value==='number')return value<1e12?value*1000:value;const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:0;}

class ArenaAuth {
  constructor(){
    this.localPractice=['localhost','127.0.0.1'].includes(globalThis.location?.hostname);
    this.authenticated=false;this.user=null;this.providers=PROVIDERS.map(p=>({...p,available:false,reason:'Checking sign-in availability.'}));
    this.status='checking';this.message='Checking your arena session…';this.token='';this.expiresAt=0;this.listeners=new Set();
    try{const saved=JSON.parse(storage.get(SESSION_KEY)||'null');if(saved?.token&&expiry(saved.expiresAt)>Date.now()){this.token=saved.token;this.expiresAt=expiry(saved.expiresAt);}else storage.remove(SESSION_KEY);}catch{storage.remove(SESSION_KEY);}
    this.callback=new URLSearchParams(globalThis.location?.hash?.slice(1)||'');
    if(this.callback.has('auth_code')||this.callback.has('auth_error')){
      const cleanURL=new URL(location.href);cleanURL.hash='';history.replaceState(history.state,'',cleanURL.pathname+cleanURL.search);
    }
  }
  endpoint(path){
    let url;try{url=new URL(ARENA_API_URL,globalThis.location?.href);}catch{throw new Error('Sign-in is not configured for this site.');}
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(!ARENA_API_URL||url.username||url.password||(url.protocol!=='https:'&&!(local&&url.protocol==='http:')))throw new Error('Sign-in is not configured for this site.');
    return `${url.origin}/auth/${path}`;
  }
  get canPractice(){return (this.authenticated&&this.expiresAt>Date.now())||this.localPractice;}
  scheduleExpiry(){clearTimeout(this.expiryTimer);if(!this.authenticated)return;this.expiryTimer=setTimeout(()=>this.clear('Your session expired. Your campaign is preserved; sign in again to continue.'),Math.max(0,this.expiresAt-Date.now()));this.expiryTimer.unref?.();}
  snapshot(){return {authenticated:this.authenticated,localPractice:this.localPractice,user:this.user,providers:this.providers,status:this.status,message:this.message,expiresAt:this.expiresAt};}
  notify(){for(const listener of this.listeners)listener(this.snapshot());}
  subscribe(listener){this.listeners.add(listener);listener(this.snapshot());return()=>this.listeners.delete(listener);}
  headers(){return this.token&&this.expiresAt>Date.now()?{Authorization:`Bearer ${this.token}`}:{ };}
  clear(message='Sign in to enter the interactive challenge.'){
    clearTimeout(this.expiryTimer);this.token='';this.expiresAt=0;this.authenticated=false;this.user=null;this.status='signed-out';this.message=message;storage.remove(SESSION_KEY);storage.remove(VERIFIER_KEY);this.notify();
  }
  async request(path,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(this.endpoint(path),{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...this.headers()},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
      let data;try{data=await response.json();}catch{throw new Error('The sign-in service returned an unreadable response.');}
      if(!response.ok)throw new Error(clean(data?.error?.message||data?.error||data?.message,'Sign-in could not be completed. Please try again.'));
      return data;
    }catch(error){if(error.name==='AbortError')throw new Error('The sign-in service timed out. Please try again.');if(error instanceof TypeError)throw new Error('The sign-in service could not be reached. The public code and kit are still available.');throw error;}
    finally{clearTimeout(timer);}
  }
  setProviders(providers){
    if(!Array.isArray(providers))return;
    this.providers=PROVIDERS.map(defaultProvider=>{const p=providers.find(p=>p?.id===defaultProvider.id);return {...defaultProvider,available:p?.available===true,reason:clean(p?.reason,p?.available?'Ready to sign in.':'Provider registration is not connected.')};});
  }
  async init(){
    let callbackMessage='';
    const code=this.callback.get('auth_code');
    if(this.callback.has('auth_error'))callbackMessage='Sign-in was not completed. Choose an available provider to try again.';
    if(code){
      const verifier=storage.get(VERIFIER_KEY);storage.remove(VERIFIER_KEY);
      try{
        if(!verifier||!/^[-_A-Za-z0-9]{43}$/.test(verifier))throw new Error('This sign-in attempt expired or started in another browser tab. Please start again.');
        const result=await this.request('exchange',{code,verifier});
        if(typeof result.token!=='string'||!result.token||!expiry(result.expiresAt))throw new Error('The sign-in service returned an incomplete session.');
        this.token=result.token;this.expiresAt=expiry(result.expiresAt);storage.set(SESSION_KEY,JSON.stringify({token:this.token,expiresAt:this.expiresAt}));
      }catch(error){this.token='';this.expiresAt=0;storage.remove(SESSION_KEY);callbackMessage=error.message;}
    }
    this.callback=new URLSearchParams();
    try{
      const result=await this.request('session');this.setProviders(result.providers);
      if(result.authenticated===true&&result.user&&this.token){
        this.authenticated=true;this.user={id:clean(result.user.id),name:clean(result.user.name,'Arena participant'),provider:clean(result.user.provider)};
        if(expiry(result.expiresAt))this.expiresAt=expiry(result.expiresAt);
        storage.set(SESSION_KEY,JSON.stringify({token:this.token,expiresAt:this.expiresAt}));
        this.status='signed-in';this.message=`Signed in as ${this.user.name}. Your interactive session is ready.`;
      }else{this.token='';this.expiresAt=0;this.authenticated=false;this.user=null;storage.remove(SESSION_KEY);this.status='signed-out';this.message=callbackMessage||'Sign in to play. The challenge code and kit remain public.';}
    }catch(error){this.token='';this.expiresAt=0;this.authenticated=false;this.user=null;storage.remove(SESSION_KEY);this.status='unavailable';this.message=callbackMessage||error.message;this.providers=this.providers.map(p=>({...p,available:false,reason:'Sign-in service is unavailable.'}));}
    this.scheduleExpiry();this.notify();return this.snapshot();
  }
  async login(provider){
    if(!this.providers.find(p=>p.id===provider)?.available)return;
    try{
      if(!globalThis.crypto?.subtle)throw new Error('Sign-in needs a secure HTTPS connection.');
      const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
      if(!storage.set(VERIFIER_KEY,verifier))throw new Error('Your browser must allow session storage to complete sign-in.');
      const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      this.status='redirecting';this.message=`Opening ${PROVIDERS.find(p=>p.id===provider).label} sign-in…`;this.notify();
      if(!document.dispatchEvent(new Event('syntony:before-signin',{cancelable:true})))throw new Error('The browser could not preserve your campaign. Free some session storage and try again.');
      location.assign(`${this.endpoint(`login/${provider}`)}?challenge=${encodeURIComponent(challenge)}`);
    }catch(error){storage.remove(VERIFIER_KEY);this.status='signed-out';this.message=error.message;this.notify();}
  }
  async logout(){
    let message='Signed out. Your interactive session is closed.';
    try{await this.request('logout',{});}catch{message='Signed out on this device. The service could not confirm remote revocation; the session will expire automatically.';}
    this.clear(message);
  }
  require({practice=false}={}){if(practice&&this.localPractice)return true;if(this.authenticated&&this.expiresAt>Date.now())return true;if(this.authenticated)this.clear('Your session expired. Sign in again to continue.');document.getElementById('sign-in')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});document.querySelector('#sign-in button:not(:disabled):not([hidden])')?.focus({preventScroll:true});return false;}
}
export const arenaAuth=new ArenaAuth();

export function mountAuthPanel(mount){
  if(!mount)return;
  const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  mount.id='sign-in';mount.classList.add('auth-panel');mount.setAttribute('aria-labelledby','auth-title');
  const heading=make('div',undefined,'auth-heading');const copy=make('div');copy.append(make('span','CHALLENGE ACCESS','auth-eyebrow'));
  const title=make('h2','Sign in to the challenge');title.id='auth-title';copy.append(title,make('p','Sign in to play the arena and guided practice. Explore the worlds, read the code, and fork the public kit at any time.'));heading.append(copy);
  const publicLink=make('a','Explore the public kit ↗','auth-public-link');publicLink.href='https://github.com/Syntony-Research/close-the-loop';publicLink.target='_blank';publicLink.rel='noopener noreferrer';heading.append(publicLink);
  const providerList=make('div',undefined,'auth-providers');providerList.setAttribute('role','group');providerList.setAttribute('aria-label','Sign-in provider');
  for(const provider of PROVIDERS){const button=make('button',undefined,`auth-provider auth-provider-${provider.id}`);button.type='button';button.dataset.authProvider=provider.id;button.disabled=true;button.hidden=true;const icon=make('span',provider.id==='github'?'⌘':provider.id==='microsoft'?'⊞':'G','auth-provider-icon');icon.setAttribute('aria-hidden','true');button.append(icon,make('span',`Continue with ${provider.label}`,'auth-provider-label'),make('span','Checking…','auth-provider-state'));button.addEventListener('click',()=>arenaAuth.login(provider.id));providerList.append(button);}
  const status=make('p','Checking your arena session…','auth-status');status.id='auth-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const account=make('div',undefined,'auth-account');account.hidden=true;const identity=make('p');const logout=make('button','Sign out','auth-signout');logout.type='button';logout.addEventListener('click',()=>arenaAuth.logout());account.append(identity,logout);
  const note=make('p','Sign-in identifies your arena session. Hosted play sends synthetic input to the model provider named in the interface. Do not use sensitive or client data.','auth-note');
  mount.replaceChildren(heading,providerList,account,status,note);
  document.addEventListener('click',event=>{if(!arenaAuth.canPractice&&event.target.closest?.('[data-auth-required]')){event.preventDefault();event.stopImmediatePropagation();arenaAuth.require();}},true);
  arenaAuth.subscribe(state=>{
    mount.dataset.authState=state.status;status.textContent=state.localPractice&&!state.authenticated?'Local deterministic practice is available without sign-in. Hosted AI still requires sign-in. '+(state.status==='unavailable'?'The local sign-in service is not connected.':''):state.message;providerList.hidden=state.authenticated;account.hidden=!state.authenticated;
    title.textContent=state.authenticated?'Your session is ready':state.localPractice?'Your local practice lab is ready.':'Sign in to the challenge';
    identity.textContent=state.user?`${state.user.name} · ${PROVIDERS.find(p=>p.id===state.user.provider)?.label||state.user.provider}`:'';
    providerList.dataset.count=String(state.providers.filter(p=>p.available).length);
    for(const provider of state.providers){const button=providerList.querySelector(`[data-auth-provider="${provider.id}"]`);button.hidden=!provider.available;button.disabled=!provider.available||state.status==='redirecting';button.querySelector('.auth-provider-state').textContent=provider.available?'Sign in ↗':'Not connected';button.title=provider.reason;}
    document.querySelectorAll('[data-auth-required]').forEach(section=>{section.inert=!(state.authenticated||state.localPractice);section.classList.toggle('auth-locked',!(state.authenticated||state.localPractice));});
    document.querySelectorAll('[data-auth-play-link]').forEach(link=>{link.href=state.authenticated||state.localPractice?(link.dataset.authPlayLink||'#arena'):'#sign-in';link.firstChild.textContent=state.authenticated?'Enter the arena ':state.localPractice?'Enter local practice ':'Sign in to play ';});
  });
}
