/* STARBOUND — Cinematic studio intro (multi-phase).
   PHASES: 0 atmosphere → 1 light reveal → 2 studio title → 3 hold →
   4 disappear → 5 world reveal → 6 logo reveal → 7 logo hold → 8 transition.
   Website stays silent except intro's own cinematic audio; skipping or
   finishing always lands in the silent 'website' audio state. */
(function(global){
  'use strict';
  // pure timeline map (testable): cinematic seconds -> phase index.
  // Total runtime is ~10s: every threshold below is scaled from the original
  // ~14.6s cut so all phases keep their relative pacing and visuals.
  function phaseAt(t){
    if(t<1.1) return 0;
    if(t<1.6) return 1;
    if(t<3.8) return 2; // studio visible (with hold)
    if(t<4.7) return 4;
    if(t<7.0) return 5;
    if(t<9.0) return 6; // logo visible (with hold)
    return 8;
  }
  const Intro={
    done:false, skipped:false, t:0, raf:0, parts:[], clouds:[], flies:[],
    init(){
      this.el=document.getElementById('intro');
      this.cv=document.getElementById('introCanvas');
      this.ctx=this.cv.getContext('2d');
      this.resize(); window.addEventListener('resize',()=>this.resize());
      for(let i=0;i<150;i++) this.parts.push({x:Math.random(),y:Math.random(),s:0.5+Math.random()*2.5,v:0.008+Math.random()*0.03,ph:Math.random()*6.28});
      for(let i=0;i<7;i++) this.clouds.push({x:Math.random(),y:0.08+Math.random()*0.3,s:0.5+Math.random()*1.2,v:0.004+Math.random()*0.008});
      for(let i=0;i<40;i++) this.flies.push({x:Math.random(),y:0.4+Math.random()*0.5,ph:Math.random()*6.28,sp:0.3+Math.random()*0.7});
      document.getElementById('introSkip').addEventListener('click',()=>this.skip());
      document.addEventListener('keydown',e=>{ if(!this.done&&['Space','Enter','Escape'].includes(e.code)){ e.preventDefault(); this.skip(); } });
      // MANDATE: the cinematic plays on EVERY page load. No already-watched
      // gate — localStorage / sessionStorage / cookies / prior visits are
      // never consulted here. finish() still records completion for stats.
      this.play();
    },
    resize(){ if(this.el&&this.cv){ this.cv.width=this.el.clientWidth||960; this.cv.height=this.el.clientHeight||540; } },
    reduced(){ return !!(global.SP_Save&&global.SP_Save.data.settings.reducedMotion); },
    play(){
      cancelAnimationFrame(this.raf); // never stack two cinematic loops
      this.done=false; this.skipped=false; this.t=0; this._loopErr=false;
      this._s1=this._s2=this._s3=this._s4=false;
      document.getElementById('introSkip').classList.remove('hidden');
      try{ global.SP_Audio.init(global.SP_Save?global.SP_Save.data.settings:null); }catch(e){}
      const clickBox=document.getElementById('introClick');
      const startBtn=document.getElementById('introStartBtn');
      clickBox.classList.remove('hidden');
      this.awaiting=true;
      const begin=()=>{
        if(!this.awaiting) return;
        clickBox.classList.add('hidden'); this.awaiting=false;
        try{ global.SP_Audio.resume(); global.SP_Audio.setState('intro'); global.SP_Audio.sfx('whoosh'); }catch(e){}
        this.t0=performance.now();
        cancelAnimationFrame(this.raf);
        // A single bad frame must never freeze the cinematic: the timeline and
        // the next frame are scheduled even if a draw call throws once.
        const loop=(now)=>{ if(this.done) return;
          try{ this.t=(now-this.t0)/1000; this.draw(); this.timeline(); }
          catch(err){ if(!this._loopErr){ this._loopErr=true; try{ console.error('intro frame error (continuing):',err); }catch(e){} } }
          this.raf=requestAnimationFrame(loop); };
        this.raf=requestAnimationFrame(loop);
      };
      startBtn.onclick=(e)=>{ e.stopPropagation(); begin(); };
      this.t0=performance.now();
      const idle=(now)=>{ if(this.done||!this.awaiting) return;
        try{ this.t=(now-this.t0)/1000; this.drawIdle(); }
        catch(err){ if(!this._loopErr){ this._loopErr=true; try{ console.error('intro idle error (continuing):',err); }catch(e){} } }
        this.raf=requestAnimationFrame(idle); };
      this.raf=requestAnimationFrame(idle);
      this._begin=begin;
    },
    /* ---------------- drawing ---------------- */
    drawIdle(){
      const c=this.ctx,W=this.cv.width,H=this.cv.height;
      c.fillStyle='#000'; c.fillRect(0,0,W,H);
      c.fillStyle='#FFD97A';
      for(const p of this.parts){
        const y=((p.y-this.t*p.v)%1+1)%1;
        c.globalAlpha=0.2+0.3*Math.abs(Math.sin(this.t*0.8+p.ph));
        c.beginPath(); c.arc(p.x*W,y*H,p.s,0,7); c.fill();
      }
      c.globalAlpha=1;
    },
    draw(){
      const c=this.ctx,W=this.cv.width,H=this.cv.height,t=this.t;
      const rm=this.reduced();
      const ph=phaseAt(t);
      c.fillStyle='#000'; c.fillRect(0,0,W,H);
      c.save();
      // subtle cinematic push-in (camera slowly entering the world)
      if(!rm){
        const z=1+Math.min(0.09,t*0.009);
        c.translate(W/2,H/2); c.scale(z,z); c.translate(-W/2,-H/2+Math.min(14,t*1.6));
      }
      const worldA=this.smooth((t-4.5)/2.0); // world reveal alpha
      if(worldA>0) this.drawWorld(c,W,H,t,worldA);
      else { this.drawFog(c,W,H,t,1); this.drawGlow(c,W,H,t); }
      if(worldA>0&&worldA<1){ this.drawFog(c,W,H,t,1-worldA); }
      this.drawDust(c,W,H,t);
      if(ph>=6) this.drawBurst(c,W,H,t);
      c.restore();
      this.drawVignette(c,W,H);
      if(!rm) this.drawGrain(c,W,H);
    },
    smooth(x){ x=Math.max(0,Math.min(1,x)); return x*x*(3-2*x); },
    drawGlow(c,W,H,t){
      const g=this.smooth((t-1.1)/1.2);
      if(g<=0) return;
      const gr=c.createRadialGradient(W/2,H*0.55,10,W/2,H*0.55,Math.max(W,H)*0.7);
      gr.addColorStop(0,'rgba(255,180,80,'+(0.4*g)+')');
      gr.addColorStop(0.5,'rgba(120,90,255,'+(0.2*g)+')');
      gr.addColorStop(1,'rgba(0,0,0,0)');
      c.fillStyle=gr; c.fillRect(-W*0.1,-H*0.1,W*1.2,H*1.2);
      // slow light sweep across the studio title
      if(!this.reduced()&&t>1.6&&t<4.7){
        const sx=W*((t-1.6)/3.1);
        const sw=c.createLinearGradient(sx-140,0,sx+140,0);
        sw.addColorStop(0,'rgba(255,240,200,0)'); sw.addColorStop(0.5,'rgba(255,240,200,'+(0.10*g)+')'); sw.addColorStop(1,'rgba(255,240,200,0)');
        c.fillStyle=sw; c.fillRect(0,0,W,H);
      }
    },
    drawFog(c,W,H,t,alpha){
      c.save(); c.globalAlpha=0.5*alpha;
      for(let i=0;i<4;i++){
        const y=H*(0.3+i*0.16)+Math.sin(t*0.24+i*1.7)*10;
        const fg=c.createLinearGradient(0,y-36,0,y+36);
        fg.addColorStop(0,'rgba(140,150,220,0)'); fg.addColorStop(0.5,'rgba(140,150,220,0.16)'); fg.addColorStop(1,'rgba(140,150,220,0)');
        c.fillStyle=fg;
        const off=this.reduced()?0:Math.sin(t*0.1+i)*60;
        c.fillRect(-80+off,y-36,W+160,72);
      }
      // faint light rays
      if(!this.reduced()){
        c.globalAlpha=0.10*alpha;
        c.fillStyle='#ffe9b8';
        for(let i=0;i<3;i++){
          const rx=W*(0.3+i*0.2)+Math.sin(t*0.15+i)*30;
          c.save(); c.translate(rx,0); c.rotate(0.22); c.fillRect(-24,-H*0.1,48,H*1.3); c.restore();
        }
      }
      c.restore();
    },
    drawDust(c,W,H,t){
      const rm=this.reduced();
      c.fillStyle='#FFD97A';
      const boost=phaseAt(t)>=6?1.4:0.8;
      for(const p of this.parts){
        const y=((p.y-t*p.v)%1+1)%1;
        c.globalAlpha=(0.2+0.55*Math.abs(Math.sin(t*0.8+p.ph)))*boost;
        c.beginPath(); c.arc(p.x*W,y*H,rm?1:p.s,0,7); c.fill();
      }
      c.globalAlpha=1;
    },
    drawWorld(c,W,H,t,a){
      // Ember Meadow at dawn — original establishing shot of Pip's home
      c.save(); c.globalAlpha=a;
      const horizon=H*0.62;
      const sky=c.createLinearGradient(0,0,0,horizon*1.15);
      sky.addColorStop(0,'#060818'); sky.addColorStop(0.55,'#2b1f5e'); sky.addColorStop(0.85,'#b3541e'); sky.addColorStop(1,'#ffb35c');
      c.fillStyle=sky; c.fillRect(-W*0.1,-H*0.15,W*1.2,horizon*1.2);
      // moon + glow
      const mx=W*0.72,my=H*0.24;
      const mg=c.createRadialGradient(mx,my,4,mx,my,90);
      mg.addColorStop(0,'rgba(255,244,214,0.95)'); mg.addColorStop(0.25,'rgba(255,220,150,0.5)'); mg.addColorStop(1,'rgba(255,220,150,0)');
      c.fillStyle=mg; c.beginPath(); c.arc(mx,my,90,0,7); c.fill();
      c.fillStyle='#fff3d0'; c.beginPath(); c.arc(mx,my,26,0,7); c.fill();
      // drifting clouds (parallax)
      c.fillStyle='rgba(20,16,48,0.85)';
      for(const cl of this.clouds){
        const cx=((cl.x+(this.reduced()?0:t*cl.v))%1.2-0.1)*W;
        const cy=cl.y*H, s=cl.s;
        c.beginPath(); c.ellipse(cx,cy,90*s,16*s,0,0,7); c.ellipse(cx+50*s,cy+6*s,60*s,13*s,0,0,7); c.ellipse(cx-52*s,cy+7*s,55*s,12*s,0,0,7); c.fill();
      }
      // mountain layers
      this.ridge(c,W,horizon,0.9,'#3a2a66',0.35);
      this.ridge(c,W,horizon,0.55,'#241b4a',0.6);
      // pine forest silhouette
      c.fillStyle='#0d1428';
      const n=Math.ceil(W/46);
      for(let i=0;i<=n;i++){
        const x=i*46+((i*37)%23), h=34+((i*53)%30), y=horizon+26;
        c.beginPath(); c.moveTo(x,y-h-16); c.lineTo(x-13,y-h+12); c.lineTo(x-6,y-h+12); c.lineTo(x-16,y-h+30); c.lineTo(x+16,y-h+30); c.lineTo(x+6,y-h+12); c.lineTo(x+13,y-h+12); c.closePath(); c.fill();
        c.fillRect(x-3,y-h+28,6,14);
      }
      // meadow hills
      const hg=c.createLinearGradient(0,horizon,0,H);
      hg.addColorStop(0,'#2f6b3a'); hg.addColorStop(1,'#0c2416');
      c.fillStyle=hg;
      c.beginPath(); c.ellipse(W*0.2,H*1.02,W*0.55,H*0.3,0,Math.PI,0); c.fill();
      c.beginPath(); c.ellipse(W*0.85,H*1.05,W*0.5,H*0.26,0,Math.PI,0); c.fill();
      // lantern posts (Pip's beacons) with warm halos
      const posts=[[0.18,0.78],[0.5,0.84],[0.82,0.76]];
      for(const [px,py] of posts){
        const x=W*px,y=H*py;
        const halo=c.createRadialGradient(x,y-46,2,x,y-46,54);
        halo.addColorStop(0,'rgba(255,210,120,0.85)'); halo.addColorStop(1,'rgba(255,210,120,0)');
        c.fillStyle=halo; c.beginPath(); c.arc(x,y-46,54,0,7); c.fill();
        c.fillStyle='#1a0f00'; c.fillRect(x-3,y-44,6,52);
        c.fillStyle='#ffe9a8'; c.beginPath(); c.arc(x,y-50,9,0,7); c.fill();
      }
      // fireflies
      if(!this.reduced()){
        c.fillStyle='#d8ff9e';
        for(const f of this.flies){
          const fx=(f.x+Math.sin(t*f.sp+f.ph)*0.02)*W, fy=(f.y+Math.cos(t*f.sp*0.8+f.ph)*0.03)*H;
          c.globalAlpha=0.35+0.65*Math.abs(Math.sin(t*2+f.ph));
          c.beginPath(); c.arc(fx,fy,2.2,0,7); c.fill();
        }
        c.globalAlpha=a;
      }
      c.restore();
    },
    ridge(c,W,base,seed,color,alpha){
      c.save(); c.globalAlpha=alpha; c.fillStyle=color; c.beginPath(); c.moveTo(-W*0.1,base+80);
      for(let x=-W*0.1;x<=W*1.1;x+=W/16){
        const y=base-40-alpha*120*(0.5+0.5*Math.sin(x*0.008+seed*9))-seed*30;
        c.lineTo(x,y);
      }
      c.lineTo(W*1.1,base+80); c.closePath(); c.fill(); c.restore();
    },
    drawBurst(c,W,H,t){
      const k=this.smooth((t-7.0)/0.8);
      if(k<=0||k>=1) return;
      const r=(1-k);
      const g=c.createRadialGradient(W/2,H*0.42,10,W/2,H*0.42,Math.max(W,H)*0.6);
      g.addColorStop(0,'rgba(255,240,200,'+(0.5*r)+')'); g.addColorStop(1,'rgba(255,240,200,0)');
      c.fillStyle=g; c.fillRect(0,0,W,H);
    },
    drawVignette(c,W,H){
      const v=c.createRadialGradient(W/2,H/2,Math.min(W,H)*0.35,W/2,H/2,Math.max(W,H)*0.75);
      v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,0.55)');
      c.fillStyle=v; c.fillRect(0,0,W,H);
    },
    drawGrain(c,W,H){
      c.fillStyle='#fff'; c.globalAlpha=0.05;
      for(let i=0;i<90;i++) c.fillRect(Math.random()*W,Math.random()*H,1.4,1.4);
      c.globalAlpha=1;
    },
    timeline(){
      const studio=document.getElementById('introStudio'), logo=document.getElementById('introLogo');
      if(this.t>1.6&&!this._s1){ this._s1=true; studio.classList.add('show'); try{global.SP_Audio.sfx('sting');}catch(e){} }
      if(this.t>3.8&&!this._s2){ this._s2=true; studio.classList.add('hide'); }
      if(this.t>4.7&&!this._s3){ this._s3=true; studio.classList.add('hidden'); logo.classList.remove('hidden'); }
      if(this.t>7.0&&!this._s4){ this._s4=true; const l2=document.getElementById('introLogo'); requestAnimationFrame(()=>l2.classList.add('show')); try{global.SP_Audio.sfx('sting'); global.SP_Audio.sfx('whoosh');}catch(e){} }
      if(this.t>10.0){ this.finish(false); }
    },
    skip(){ if(this.done) return; this.finish(true); },
    replay(){
      this.done=false; this.skipped=false;
      const studio=document.getElementById('introStudio'), logo=document.getElementById('introLogo');
      studio.classList.remove('hidden','show','hide'); logo.classList.add('hidden'); logo.classList.remove('show');
      this.el.classList.remove('hidden'); this.el.setAttribute('aria-hidden','false');
      this.el.style.opacity='';
      this.play();
    },
    finish(instant){
      if(this.done) return; this.done=true; this.awaiting=false;
      cancelAnimationFrame(this.raf);
      try{ if(global.SP_Save){ global.SP_Save.data.introSeen=true; global.SP_Save.write(); } }catch(e){}
      // clean handoff: no intro audio left running; website is silent
      try{ global.SP_Audio.setState('website'); }catch(e){}
      try{ if(!instant) global.SP_Audio.sfx('whoosh'); }catch(e){}
      this.el.style.transition='opacity 0.8s'; this.el.style.opacity='0';
      setTimeout(()=>{ this.el.classList.add('hidden'); this.el.setAttribute('aria-hidden','true'); this.el.style.opacity=''; },instant?60:750);
    }
  };
  Intro.phaseAt=phaseAt;
  global.SP_Intro=Intro;
})(window);
