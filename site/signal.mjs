// A procedural signal sculpture. No external rendering library or network requests.
export function createSignal(canvas) {
  if (!canvas) return { pulse() {}, setMission() {} };
  const ctx = canvas.getContext('2d');
  if (!ctx) return { pulse() {}, setMission() {} };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let width=0,height=0,frame=0,last=0,active=true;
  let mouse={x:0,y:0}, phase=0, impulse=0, mode='idle';
  let mission=0;
  const points=[];
  for(let u=0;u<160;u++) for(let v=0;v<15;v++) {
    const a=u/160*Math.PI*2, b=v/15*Math.PI*2;
    points.push({a,b,band:v});
  }
  const resize=()=>{
    const r=canvas.getBoundingClientRect();width=r.width;height=r.height;
    const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);draw(0);
  };
  function draw(time) {
    if(!width || !height)return;
    ctx.clearRect(0,0,width,height);
    const t=reduced.matches?0:time*.00012;
    const centerX=width*.51,centerY=height*.48,scale=Math.min(width,height)*.205;
    const rotation=.26+t+mouse.x*.13, tilt=.78+mouse.y*.1;
    const cosR=Math.cos(rotation),sinR=Math.sin(rotation),cosT=Math.cos(tilt),sinT=Math.sin(tilt);
    const pulse=reduced.matches?0:impulse;
    const color=mode==='sealed'?[159,229,211]:[255,131,109];
    const glow=ctx.createRadialGradient(centerX,centerY,20,centerX,centerY,scale*2.65);
    glow.addColorStop(0,`rgba(${color.join(',')},.055)`);glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
    ctx.lineWidth=.65;ctx.strokeStyle='rgba(165,191,192,.09)';
    [2.12,2.55].forEach(r=>{ctx.beginPath();ctx.ellipse(centerX,centerY,scale*r,scale*r*.68,-.3,0,Math.PI*2);ctx.stroke();});
    const projected=points.map(({a,b,band})=>{
      const twist=b+Math.sin(a*3+phase)*.27;
      const tube=.40+.11*Math.sin(a*3+mission*.8);
      const warp=mode==='breach'?pulse*Math.sin(a*8+t*20)*.23:0;
      const radius=1.42+tube*Math.cos(twist)+warp;
      let x=radius*Math.cos(a),y=radius*Math.sin(a),z=tube*Math.sin(twist)+.24*Math.sin(a*3+phase);
      const xx=x*cosR-z*sinR,zz=x*sinR+z*cosR;
      const yy=y*cosT-zz*sinT,depth=y*sinT+zz*cosT;
      const persp=4.8/(4.8-depth);
      return {x:centerX+xx*scale*persp,y:centerY+yy*scale*persp,z:depth,band,a,alpha:.2+(depth+2)/4*.65};
    });
    // Fine longitudinal threads give the sculpture depth without a heavy wireframe.
    for(let band=0;band<15;band+=3){
      ctx.beginPath();let start=true;
      projected.forEach(p=>{if(p.band!==band)return;if(start){ctx.moveTo(p.x,p.y);start=false;}else ctx.lineTo(p.x,p.y);});
      ctx.closePath();ctx.strokeStyle=`rgba(${color.join(',')},.13)`;ctx.lineWidth=.55;ctx.stroke();
    }
    projected.sort((a,b)=>a.z-b.z);
    for(const p of projected){
      const mint=mode==='sealed'||(mode==='idle'&&Math.sin(p.a*2+phase)>.79);
      const c=mint?[160,226,211]:color;
      const r=.6+(p.z+2)*.28+(pulse*.18);
      ctx.fillStyle=`rgba(${c.join(',')},${Math.max(.12,p.alpha)})`;
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    }
    if(pulse>.05){ctx.beginPath();ctx.ellipse(centerX,centerY,scale*(2.5-pulse*.45),scale*(2.5-pulse*.45)*.68,-.3,0,Math.PI*2);ctx.strokeStyle=`rgba(${color.join(',')},${pulse*.4})`;ctx.stroke();}
    // Sparse telemetry ticks outside the shape.
    ctx.strokeStyle='rgba(196,208,205,.28)';ctx.lineWidth=1;
    [[.14,.21],[.86,.21],[.14,.78],[.86,.78]].forEach(([x,y])=>{ctx.beginPath();ctx.moveTo(width*x-4,height*y);ctx.lineTo(width*x+4,height*y);ctx.moveTo(width*x,height*y-4);ctx.lineTo(width*x,height*y+4);ctx.stroke();});
  }
  function animate(now){
    frame=requestAnimationFrame(animate);
    if(!active||document.hidden||reduced.matches)return;
    if(now-last<32)return;last=now;impulse*=.964;draw(now);
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  const visibility=new IntersectionObserver(entries=>{active=entries[0].isIntersecting;});visibility.observe(canvas);
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();mouse.x=(e.clientX-r.left)/r.width-.5;mouse.y=(e.clientY-r.top)/r.height-.5;});
  canvas.addEventListener('pointerleave',()=>{mouse={x:0,y:0};});
  reduced.addEventListener('change',()=>draw(0));
  resize();frame=requestAnimationFrame(animate);
  return {pulse(next){mode=next;impulse=1;draw(performance.now());},setMission(index){mission=index;phase=index*1.2;mode='idle';draw(performance.now());},destroy(){cancelAnimationFrame(frame);observer.disconnect();visibility.disconnect();}};
}
