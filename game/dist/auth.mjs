// Sign-in transport. Provider credentials remain on the hosted service.
import {ARENA_API_URL} from './auth-config.mjs?v=blackline-2';
const SESSION_KEY='syntony-arena-session-v1';
const VERIFIER_KEY='syntony-arena-auth-verifier-v1';
const PROVIDERS=[{id:'google',label:'Google'},{id:'microsoft',label:'Microsoft'},{id:'github',label:'GitHub'}];
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
        this.status='signed-in';this.message=`Signed in as ${this.user.name}. Your BLACKLINE session is ready.`;
      }else{this.token='';this.expiresAt=0;this.authenticated=false;this.user=null;storage.remove(SESSION_KEY);this.status='signed-out';this.message=callbackMessage||'Sign in to play. The challenge code and kit remain public.';}
    }catch(error){this.token='';this.expiresAt=0;this.authenticated=false;this.user=null;storage.remove(SESSION_KEY);this.status='unavailable';this.message=callbackMessage||error.message;this.providers=this.providers.map(p=>({...p,available:false,reason:'Sign-in service is unavailable.'}));}
    this.scheduleExpiry();this.notify();return this.snapshot();
  }
  async login(provider){
    if(this.status==='redirecting'||!this.providers.find(p=>p.id===provider)?.available)return;
    try{
      this.status='redirecting';this.message=`Opening ${PROVIDERS.find(p=>p.id===provider).label} sign-in…`;this.notify();
      if(!globalThis.crypto?.subtle)throw new Error('Sign-in needs a secure HTTPS connection.');
      const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
      if(!storage.set(VERIFIER_KEY,verifier))throw new Error('Your browser must allow session storage to complete sign-in.');
      const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      if(!document.dispatchEvent(new Event('syntony:before-signin',{cancelable:true})))throw new Error('The browser could not preserve your campaign. Free some session storage and try again.');
      location.assign(`${this.endpoint(`login/${provider}`)}?challenge=${encodeURIComponent(challenge)}`);
    }catch(error){storage.remove(VERIFIER_KEY);this.status='signed-out';this.message=error.message;this.notify();}
  }
  async logout(){
    let message='Signed out. Your interactive session is closed.';
    try{await this.request('logout',{});}catch{message='Signed out on this device. The service could not confirm remote revocation; the session will expire automatically.';}
    this.clear(message);
  }
  require({practice=false}={}){if(practice&&this.localPractice)return true;if(this.authenticated&&this.expiresAt>Date.now())return true;if(this.authenticated)this.clear('Your session expired. Sign in again to continue.');if(this.openLogin){this.openLogin();return false;}document.getElementById('sign-in')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});document.querySelector('#sign-in button:not(:disabled):not([hidden])')?.focus({preventScroll:true});return false;}
}
export const arenaAuth=new ArenaAuth();

// Static provider marks contain no remote assets or participant data.
function providerIcon(provider){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('auth-provider-icon');
  const shapes={
    google:[['path',{fill:'#4285F4',d:'M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.88-1.73 2.99-4.28 2.99-7.36Z'}],['path',{fill:'#34A853',d:'M12 22c2.7 0 4.96-.9 6.61-2.41l-3.22-2.51c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.09v2.59A10 10 0 0 0 12 22Z'}],['path',{fill:'#FBBC05',d:'M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.09A10 10 0 0 0 2 12c0 1.61.39 3.14 1.09 4.51l3.32-2.59Z'}],['path',{fill:'#EA4335',d:'M12 5.96c1.47 0 2.79.51 3.82 1.52l2.86-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.91 5.49l3.32 2.59C7.2 7.72 9.4 5.96 12 5.96Z'}]],
    microsoft:[['rect',{x:'2',y:'2',width:'9.5',height:'9.5',fill:'#F25022'}],['rect',{x:'12.5',y:'2',width:'9.5',height:'9.5',fill:'#7FBA00'}],['rect',{x:'2',y:'12.5',width:'9.5',height:'9.5',fill:'#00A4EF'}],['rect',{x:'12.5',y:'12.5',width:'9.5',height:'9.5',fill:'#FFB900'}]],
    github:[['path',{fill:'currentColor',d:'M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.95 0-1.09.39-1.98 1.03-2.68-.11-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.21 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z'}]]
  };
  for(const [tag,attributes] of shapes[provider]){const shape=document.createElementNS(svg.namespaceURI,tag);for(const [name,value] of Object.entries(attributes))shape.setAttribute(name,value);svg.append(shape);}
  return svg;
}

export function mountAuthPanel(mount){
  if(!mount||document.getElementById('auth-dialog'))return;
  const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  mount.id='sign-in';mount.classList.add('auth-panel');mount.setAttribute('aria-labelledby','auth-title');
  const heading=make('div',undefined,'auth-heading'),copy=make('div');copy.append(make('span','CHALLENGE ACCESS','auth-eyebrow'));
  const title=make('h2','Sign in to the challenge');title.id='auth-title';copy.append(title,make('p','Sign in to enter BLACKLINE. Campaign progress stays in this browser; the source code and public kit are open to everyone.'));heading.append(copy);
  const publicLink=make('a','Explore the public kit ↗','auth-public-link');publicLink.href='https://github.com/Syntony-Research/close-the-loop';publicLink.target='_blank';publicLink.rel='noopener noreferrer';heading.append(publicLink);
  const login=make('button','Login','auth-login');login.type='button';login.setAttribute('aria-haspopup','dialog');login.setAttribute('aria-controls','auth-dialog');
  const status=make('p','Checking your arena session…','auth-status');status.id='auth-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const account=make('div',undefined,'auth-account');account.hidden=true;const identity=make('p'),logout=make('button','Sign out','auth-signout');logout.type='button';logout.addEventListener('click',()=>arenaAuth.logout());account.append(identity,logout);
  const note=make('p','BLACKLINE is a fictional AI security simulation. No live AI model is called during play.','auth-note');
  mount.replaceChildren(heading,login,account,status,note);

  const dialog=make('dialog',undefined,'auth-dialog');dialog.id='auth-dialog';dialog.setAttribute('aria-labelledby','auth-dialog-title');dialog.setAttribute('aria-describedby','auth-dialog-description');
  const dialogBody=make('div',undefined,'auth-dialog-body');
  const close=make('button',undefined,'auth-dialog-close');close.type='button';close.setAttribute('aria-label','Close login');
  const closeIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');closeIcon.setAttribute('viewBox','0 0 24 24');closeIcon.setAttribute('aria-hidden','true');closeIcon.setAttribute('focusable','false');const closePath=document.createElementNS(closeIcon.namespaceURI,'path');closePath.setAttribute('d','m6 6 12 12M18 6 6 18');closeIcon.append(closePath);close.append(closeIcon);
  const dialogTitle=make('h2','Login');dialogTitle.id='auth-dialog-title';
  const description=make('p','Choose an account to access the challenge.','auth-dialog-description');description.id='auth-dialog-description';
  const providerList=make('div',undefined,'auth-providers');providerList.setAttribute('role','group');providerList.setAttribute('aria-label','Login provider');
  for(const provider of PROVIDERS){
    const button=make('button',undefined,`auth-provider auth-provider-${provider.id}`);button.type='button';button.dataset.authProvider=provider.id;button.disabled=true;
    button.append(providerIcon(provider.id),make('span',`Continue with ${provider.label}`,'auth-provider-label'),make('span','Checking…','auth-provider-state'));
    button.addEventListener('click',()=>arenaAuth.login(provider.id));providerList.append(button);
  }
  const dialogStatus=make('p','Checking sign-in availability…','auth-dialog-status');dialogStatus.setAttribute('role','status');dialogStatus.setAttribute('aria-live','polite');
  const privacy=make('p','Your provider handles sign-in. The challenge never receives your account password.','auth-dialog-note');
  dialogBody.append(close,make('span','SYNTONY / CHALLENGE ACCESS','auth-eyebrow'),dialogTitle,description,providerList,dialogStatus,privacy);dialog.append(dialogBody);document.body.append(dialog);
  let opener=null;
  const openLogin=()=>{
    if(dialog.open)return;
    opener=document.activeElement;status.setAttribute('aria-live','off');dialog.showModal();
    (providerList.querySelector('button:not(:disabled)')||close).focus({preventScroll:true});
  };
  arenaAuth.openLogin=openLogin;
  login.addEventListener('click',openLogin);close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
  dialog.addEventListener('close',()=>{status.setAttribute('aria-live','polite');if(opener?.isConnected&&!opener.closest('[inert]')&&!opener.hidden)opener.focus({preventScroll:true});else if(!login.hidden)login.focus({preventScroll:true});});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const focusable=[...dialog.querySelectorAll('button:not(:disabled),a[href]')].filter(node=>!node.hidden);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  document.addEventListener('click',event=>{
    const playLink=event.target.closest?.('[data-auth-play-link]');
    if(playLink&&!arenaAuth.canPractice){event.preventDefault();openLogin();return;}
    if(!arenaAuth.canPractice&&event.target.closest?.('[data-auth-required]')){event.preventDefault();event.stopImmediatePropagation();arenaAuth.require();}
  },true);
  arenaAuth.subscribe(state=>{
    mount.dataset.authState=state.status;
    status.textContent=state.localPractice&&!state.authenticated?'Local development practice is available. The Syntony site uses provider sign-in.':state.message;
    login.hidden=state.authenticated;account.hidden=!state.authenticated;
    title.textContent=state.authenticated?'Your session is ready':state.localPractice?'Your local practice lab is ready.':'Sign in to the challenge';
    identity.textContent=state.user?`${state.user.name} · ${PROVIDERS.find(p=>p.id===state.user.provider)?.label||state.user.provider}`:'';
    for(const provider of state.providers){
      const button=providerList.querySelector(`[data-auth-provider="${provider.id}"]`),providerStatus=button.querySelector('.auth-provider-state');
      button.disabled=!provider.available||state.status==='redirecting';button.title=provider.reason;
      providerStatus.textContent=state.status==='checking'?'Checking…':provider.available?'':'Unavailable';providerStatus.hidden=provider.available&&state.status!=='checking';
    }
    dialogStatus.textContent=state.status==='checking'?'Checking sign-in availability…':state.status==='signed-out'&&state.message==='Sign in to play. The challenge code and kit remain public.'?'':state.message;
    if(state.authenticated&&dialog.open)dialog.close();
    document.querySelectorAll('[data-auth-required]').forEach(section=>{section.inert=!(state.authenticated||state.localPractice);section.classList.toggle('auth-locked',!(state.authenticated||state.localPractice));});
    document.querySelectorAll('[data-auth-play-link]').forEach(link=>{
      link.href=state.authenticated||state.localPractice?(link.dataset.authPlayLink||'#arena'):'#sign-in';
      const label=link.dataset.authPlayLabel||'Enter the arena';link.firstChild.textContent=state.authenticated?`${label} `:state.localPractice?'Enter local practice ':'Login ';
      if(state.authenticated||state.localPractice){link.removeAttribute('aria-haspopup');link.removeAttribute('aria-controls');}else{link.setAttribute('aria-haspopup','dialog');link.setAttribute('aria-controls','auth-dialog');}
    });
  });
}
