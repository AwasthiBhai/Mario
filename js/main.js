/* STARBOUND — boot */
(function(){
  'use strict';
  window.addEventListener('DOMContentLoaded',()=>{
    try{
      SP_Save.load();
      // Mobile-safe: audio must NEVER abort boot. If js/audio.js (or the
      // inline guard) failed to provide SP_Audio, skip silently and let the
      // ui/engine fallbacks keep gameplay running without sound.
      // No setTimeout — synchronous guarded call in deterministic order.
      try{ if(window.SP_Audio&&typeof window.SP_Audio.init==='function') window.SP_Audio.init(SP_Save.data.settings); }catch(e){ try{ console.warn('audio init skipped:',e); }catch(_){} }
      SP_Input.loadMap(SP_Save.data.settings.keys);
      SP_Engine.settings.shake=SP_Save.data.settings.shake!==false;
      SP_Engine.settings.reducedMotion=!!SP_Save.data.settings.reducedMotion;
      const canvas=document.getElementById('game');
      SP_Input.attach(canvas);
      SP_Engine.init(canvas,{
        onHud:h=>SP_UI.onHud(h),
        onHudTick:h=>{ /* throttle: update every frame is fine */ SP_UI.onHud(h); },
        onLevelLoad:L=>SP_UI.onHud(SP_Engine.hud()),
        onComplete:res=>SP_UI.onComplete(res),
        onGameOver:res=>SP_UI.onGameOver(res),
        onPauseKey:()=>SP_UI.togglePause(),
        onBossMode:on=>SP_UI.onBossMode(on),
        getCarryScore:()=>0
      });
      SP_UI.init();
      SP_Intro.init();
      // preload first level silently so PLAY is instant
      SP_Engine.loadLevel(SP_UI.highestPlayable());
      SP_Engine.start(); SP_Engine.setPaused(true);
      SP_UI.inGame=false; SP_UI.currentLevel=SP_UI.highestPlayable();
      // hero canvas starfield
      heroAnim();
      // mute icons
      const muted=SP_Save.data.settings.muted;
      document.getElementById('hdrMute').textContent=muted?'🔇':'🔊';
      document.getElementById('btnMuteGame').textContent=muted?'🔇':'🔊';
    }catch(err){
      console.error('Boot failed:',err);
      document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;bottom:8px;left:8px;right:8px;background:#3a0d16;color:#fff;padding:10px;border-radius:10px;z-index:999">Something failed to load, but the game tried to continue. Error: '+String(err).slice(0,200)+'</div>');
    }
  });
  function heroAnim(){
    const cv=document.getElementById('heroCanvas'); if(!cv) return;
    const c=cv.getContext('2d'); let stars=[];
    function rs(){ cv.width=cv.clientWidth; cv.height=cv.clientHeight; stars=[]; for(let i=0;i<90;i++) stars.push({x:Math.random()*cv.width,y:Math.random()*cv.height,s:Math.random()*2+0.5,v:10+Math.random()*30}); }
    rs(); window.addEventListener('resize',rs);
    let last=performance.now();
    (function loop(now){
      const dt=Math.min(0.05,(now-last)/1000); last=now;
      c.clearRect(0,0,cv.width,cv.height);
      for(const s of stars){ s.y+=s.v*dt*0.3; if(s.y>cv.height){s.y=-4;s.x=Math.random()*cv.width;} c.globalAlpha=0.5; c.fillStyle='#FFE9A8'; c.fillRect(s.x,s.y,s.s,s.s); }
      c.globalAlpha=1;
      requestAnimationFrame(loop);
    })(last);
  }
})();
