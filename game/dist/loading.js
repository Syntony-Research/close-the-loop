// A short asset-backed boot sequence. Never blocks entry if an asset is slow.
const boot=document.createElement('dialog');
boot.id='blackline-boot';boot.setAttribute('aria-labelledby','boot-title');
boot.innerHTML=`<div class="boot-grid" aria-hidden="true"></div><div class="boot-top"><span>// SYNTONY RESEARCH</span><span>MERIDIAN / 2089</span></div><div class="boot-center"><div class="boot-core" aria-hidden="true"><i></i><i></i><i></i><b>//</b></div><p class="boot-eyebrow">CLOSE THE LOOP / OPERATOR CONNECTION</p><h1 id="boot-title">BLACKLINE</h1><p class="boot-subtitle">A city runs on intelligence. Yours.</p><div class="boot-track" role="progressbar" aria-label="Loading game assets" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><div class="boot-readout"><span id="boot-status" role="status">LOADING CITY ENVIRONMENT</span><b id="boot-percent">00%</b></div><div class="boot-signals" aria-hidden="true">${Array.from({length:32},(_,i)=>`<i style="--n:${i};--h:${12+(i*17)%35}px"></i>`).join('')}</div></div><div class="boot-bottom"><span>EVALUATE <b>→</b> GOVERN <b>→</b> ASSURE <b>↻</b></span><button type="button" id="boot-skip">ENTER NOW ↗</button></div>`;
document.body.append(boot);
const priorFocus=document.activeElement,priorOverflow=document.body.style.overflow;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let closed=false,loaded=0;
const finish=()=>{if(closed)return;closed=true;clearTimeout(deadline);document.body.style.overflow=priorOverflow;boot.close();boot.remove();if(priorFocus?.isConnected&&priorFocus!==document.body)priorFocus.focus({preventScroll:true});};
const deadline=setTimeout(finish,3400);
boot.querySelector('#boot-skip').addEventListener('click',finish);
boot.addEventListener('cancel',event=>{event.preventDefault();finish();});
boot.showModal();document.body.style.overflow='hidden';
function progress(label){if(closed)return;loaded++;const value=Math.round(loaded/3*100);boot.querySelector('.boot-track').setAttribute('aria-valuenow',String(value));boot.querySelector('.boot-track span').style.width=value+'%';boot.querySelector('#boot-percent').textContent=String(value).padStart(2,'0')+'%';boot.querySelector('#boot-status').textContent=label;}
async function asset(url,label){const image=new Image();image.src=url;try{await image.decode();}catch{}progress(label);}
await Promise.allSettled([asset('assets/city.webp','LOADING OPERATOR ARCHIVE'),asset('assets/nine-characters.webp','ASSEMBLING MISSION INTERFACE'),(document.fonts?.ready||Promise.resolve()).then(()=>progress('OPERATOR CONNECTION READY'))]);
if(!closed){boot.querySelector('#boot-status').textContent='MERIDIAN IS WAITING';await new Promise(resolve=>setTimeout(resolve,reduced?0:1300));finish();}
