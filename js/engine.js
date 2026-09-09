/* STARBOUND — Engine: physics, camera, entities, bosses, particles, rendering */
(function(global){
  'use strict';
  /* Mobile-safe audio: js/audio.js defines window.SP_Audio first in
     index.html order, plus an inline no-op guard covers a failed fetch.
     Still, a stale cached bundle must never crash gameplay, so every SFX
     goes through this guarded helper — a missing/blocked audio manager is
     silently skipped instead of throwing (no ReferenceError/TypeError). */
  function sfx(name){
    try{
      var a=global.SP_Audio;
      if(a&&typeof a.sfx==='function') a.sfx(name);
    }catch(e){}
  }
  const TILE=32, VIEW_W=960, VIEW_H=540, GRAV=2400;
  const ENEMY_DEF={
    walker:{w:30,h:26,speed:55,hp:1,score:100,color:'#7ed957',eye:'#123'},
    runner:{w:28,h:24,speed:170,hp:1,score:150,color:'#FFB066'},
    flyer:{w:32,h:24,speed:110,hp:1,score:150,color:'#B388FF',fly:true},
    hopper:{w:30,h:28,speed:60,hp:1,score:150,color:'#5DF2C8',hop:true},
    brute:{w:40,h:34,speed:40,hp:2,score:250,color:'#8a8ab8',armored:true},
    spitter:{w:30,h:34,speed:45,hp:1,score:200,color:'#FF6B9D',shoot:true},
    patroller:{w:34,h:26,speed:90,hp:1,score:150,color:'#FFD166',patrol:true}
  };
  function aabb(a,b){ return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y; }

  const Game={
    canvas:null,ctx:null,running:false,paused:false,level:null,levelNum:1,
    player:null,cam:{x:0,y:0,shake:0},time:0,timeLeft:0,score:0,coinCount:0,coinTotal:0,
    lives:3,cb:{},parts:[],shots:[],eshots:[],floaters:[],weather:[],tGlobal:0,
    checkpoint:null,relicGot:false,secretCount:0,completed:false,dead:false,
    settings:{shake:true,reducedMotion:false},
    charImg:null,charReady:false, // custom Character.png sprite (visual only; hitbox untouched)
    init(canvas,cb){ this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.cb=cb||{};
      if(this._inited) return; this._inited=true; // single game loop, never duplicated
      this.last=performance.now();
      this.fitCanvas();
      this.loadCharacter(); // preload player sprite (relative path: Pages-subpath safe)
      // recalc viewport on rotation, browser-chrome show/hide, fullscreen, window resize
      let rT=null;
      const refit=()=>{ clearTimeout(rT); rT=setTimeout(()=>this.fitCanvas(),80); };
      window.addEventListener('resize',refit);
      window.addEventListener('orientationchange',refit);
      document.addEventListener('fullscreenchange',refit);
      const loop=(now)=>{ if(this.running){ let dt=Math.min(0.033,(now-this.last)/1000); this.last=now; if(!this.paused) this.update(dt); this.render(); } else this.last=now; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    },
    /* DPR-aware backing store: world stays exactly 960x540 (no stretch,
       no squash, camera untouched) while output stays crisp on hidpi and
       cheap on small screens. */
    fitCanvas(){
      const cv=this.canvas; if(!cv) return;
      let cssW=cv.clientWidth, cssH=cv.clientHeight;
      if(!cssW||!cssH){ const r=cv.getBoundingClientRect(); cssW=r.width; cssH=r.width*VIEW_H/VIEW_W; }
      if(!cssW||!cssH) return;
      const coarse=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
      this.lowFX=!!(coarse||cssW<700); // mobile: fewer particles, same gameplay
      const dpr=Math.min(window.devicePixelRatio||1,this.lowFX?1.75:2);
      const bw=Math.min(1920,Math.max(320,Math.round(cssW*dpr)));
      const bh=Math.min(1080,Math.max(180,Math.round(cssH*dpr)));
      if(cv.width!==bw||cv.height!==bh){ cv.width=bw; cv.height=bh; }
    },
    /* Custom player sprite: loads ./Character.png ONCE (local file,
       versioned ?v=13 for cache-busting). Visual only — never physics. */
    loadCharacter(){
      try{
        if(this.charImg||typeof Image==='undefined') return;
        const self=this, im=new Image();
        im.onload=function(){ self.charReady=true; };
        im.onerror=function(){ self.charReady=false; };
        im.src='./Character.png?v=13';
        this.charImg=im;
      }catch(e){}
    },
    start(){ this.running=true; this.paused=false; },
    stop(){ this.running=false; },
    setPaused(p){ this.paused=p; },
    loadLevel(num){
      const L=global.SP_Levels.buildLevel(num);
      // deep copy runtime state
      L.solids=L.solids.map(s=>Object.assign({hit:false,fallT:0,falling:false,gone:false,vy:0,y0:s.y,revealed:s.type!=='hidden'},s));
      L.coins.forEach(c=>c.taken=false); L.powerups.forEach(p=>p.taken=false);
      L.checkpoints.forEach(c=>{c.on=false;});
      L.enemies=L.enemies.map(e=>Object.assign({w:ENEMY_DEF[e.kind].w,h:ENEMY_DEF[e.kind].h,vy:0,alive:true,shootT:1+Math.random()*2,hp:ENEMY_DEF[e.kind].hp,flash:0,groundY:e.y},e));
      if(L.boss){ L.boss=Object.assign({vx:0,vy:0,hurtT:0,shootT:2,dead:false,w:64+num/4,h:56+num/5,dir:-1},L.boss); }
      this.level=L; this.levelNum=num; this.time=0; this.timeLeft=L.timeLimit;
      this.score=(this.cb.getCarryScore?this.cb.getCarryScore():0)||0; this.coinCount=0; this.levelCoins=0; this.coinTotal=L.coins.length;
      this.lives=3; this.completed=false; this.dead=false; this.relicGot=false; this.secretCount=0;
      this.parts=[]; this.shots=[]; this.eshots=[]; this.floaters=[];
      this.player={x:L.spawn.x,y:L.spawn.y,w:28,h:42,vx:0,vy:0,face:1,onGround:false,coyote:0,jbuf:0,
        hp:3,maxhp:3,iframes:0,state:'idle',anim:0,crouch:false,shield:false,speedT:0,jumpT:0,starT:0,magnetT:0,invT:0,shootCd:0,dead:0,win:0,landed:0};
      this.checkpoint=this.sanitizeCheckpoint({x:L.spawn.x,y:L.spawn.y});
      this.cam.x=0; this.cam.y=0;
      this._run=(this._run||0)+1;
      this.bossMode=false; // UI (audio state) notified when the arena is actually entered
      this.initWeather();
      if(this.cb.onLevelLoad) this.cb.onLevelLoad(L);
      // NOTE: engine never starts music itself; UI owns audio states (silent website, level/boss only in gameplay)
    },
    initWeather(){
      this.weather=[]; const w=this.level.theme.weather; const n=this.settings.reducedMotion?15:(this.lowFX?36:70);
      for(let i=0;i<n;i++) this.weather.push({x:Math.random()*VIEW_W,y:Math.random()*VIEW_H,s:1+Math.random()*3,v:20+Math.random()*80,ph:Math.random()*6.28,kind:w});
    },
    hurtPlayer(fromX){
      const p=this.player; if(!p||p.iframes>0||p.dead||this.completed) return;
      if(!isFinite(fromX)) fromX=p.x+p.w/2; // defensive: never inherit NaN knockback
      if(p.invT>0){ this.burst(p.x+p.w/2,p.y+p.h/2,'#FFC94D',6); return; } // invincible: no damage, no knockback
      if(p.shield){ p.shield=false; p.iframes=1.5; sfx('hurt'); this.burst(p.x,p.y,'#5DF2C8',14); this.floater(p.x,p.y-20,'SHIELD!', '#5DF2C8'); return; }
      p.hp--; p.iframes=1.5; sfx('hurt'); this.cam.shake=8;
      this.burst(p.x+p.w/2,p.y+p.h/2,'#FF6B6B',16);
      p.vy=-420; p.vx=(p.x+p.w/2<fromX?-1:1)*220;
      if(p.hp<=0) this.killPlayer();
      if(this.cb.onHud) this.cb.onHud(this.hud());
    },
    killPlayer(){
      const p=this.player; if(p.dead) return; p.dead=1.2; p.vy=-550;
      sfx('death'); this.burst(p.x,p.y,'#FFC94D',24);
      const run=this._run, lv=this.levelNum;
      setTimeout(()=>{
        if(this._run!==run||this.levelNum!==lv||!this.level) return;
        this.lives--;
        if(this.lives<=0){ this.gameOver(); }
        else{ this.respawnAtCheckpoint(); p.hp=p.maxhp;p.iframes=2;p.dead=0;p.shield=false; this.cam.x=Math.max(0,Math.min(this.level.width-VIEW_W,p.x-VIEW_W/2)); if(this.cb.onHud) this.cb.onHud(this.hud()); }
      },1100);
      if(this.cb.onHud) this.cb.onHud(this.hud());
    },
    gameOver(){ this.dead=true; if(this.cb.onGameOver) this.cb.onGameOver({score:this.score}); },
    completeLevel(){
      if(this.completed) return; this.completed=true;
      const timeBonus=Math.max(0,Math.floor(this.timeLeft))*10;
      this.score+=1000+timeBonus+this.lives*200;
      sfx('goal');
      this.confetti(this.player.x,this.player.y-40);
      const res={score:this.score,coins:this.coinCount,collected:this.coinCount,spent:this.coinCount-this.levelCoins,remaining:this.levelCoins,totalCoins:this.coinTotal,relic:this.relicGot,time:this.time,best:timeBonus,secrets:this.secretCount,lives:this.lives};
      const run=this._run, lv=this.levelNum;
      setTimeout(()=>{ if(this._run!==run||this.levelNum!==lv) return; if(this.cb.onComplete) this.cb.onComplete(res); },900);
    },
    hud(){ return {score:this.score,coins:this.levelCoins,collected:this.coinCount,total:this.coinTotal,lives:this.lives,hp:this.player?this.player.hp:3,time:this.timeLeft,power:this.player?(this.player.invT>0?'✦ INVINCIBLE':this.player.starT>0?'✦ STAR':this.player.shield?'🛡 SHIELD':this.player.speedT>0?'🍃 SWIFT':this.player.jumpT>0?'🍄 SPRING':this.player.magnetT>0?'🧲 MAGNET':'✦'):'✦',level:this.levelNum,world:this.level?this.level.world+1:1}; },
    floater(x,y,text,color){ this.floaters.push({x,y,text,color:color||'#FFC94D',t:1.2}); },
    burst(x,y,color,n){ if(this.settings.reducedMotion) n=Math.min(4,n); else if(this.lowFX) n=Math.ceil(n*0.6); for(let i=0;i<n;i++){ const a=Math.random()*6.28,s=60+Math.random()*220; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-120,t:0.5+Math.random()*0.5,color,sz:2+Math.random()*4}); } },
    confetti(x,y){ const cols=['#FFC94D','#5DF2C8','#FF6B6B','#B388FF','#4DA6FF']; const cn=this.lowFX?40:70; for(let i=0;i<cn;i++){ const a=Math.random()*6.28,s=100+Math.random()*300; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-260,t:1+Math.random(),color:cols[i%5],sz:3+Math.random()*4,grav:900}); } },
    /* ---------------- UPDATE ---------------- */
    update(dt){
      const In=global.SP_Input; In.pollGamepad();
      this.tGlobal+=dt; this.time+=dt; this.timeLeft=Math.max(0,this.level.timeLimit-this.time);
      if(this.timeLeft<=0){ this.killPlayer(); this.timeLeft=this.level.timeLimit; this.time=0; }
      this.updatePlayer(dt,In);
      this.updateEnemies(dt);
      this.updateBoss(dt);
      // boss-arena music trigger: world theme until Pip enters the arena, then boss theme
      const BL=this.level;
      if(BL&&BL.isBoss&&BL.boss&&this.player&&!this.completed){
        if(!BL.boss.dead&&!this.bossMode&&this.player.x>BL.width-760){ this.bossMode=true; if(this.cb.onBossMode) this.cb.onBossMode(true); }
        if(BL.boss.dead&&this.bossMode){ this.bossMode=false; if(this.cb.onBossMode) this.cb.onBossMode(false); }
      }
      this.updateShots(dt);
      this.updateSolids(dt);
      this.updateParts(dt);
      this.updateCamera(dt);
      // weather drift
      for(const w of this.weather){ w.y+=w.v*dt; w.x+=Math.sin(this.tGlobal+w.ph)*20*dt; if(w.y>VIEW_H+10){w.y=-10;w.x=Math.random()*VIEW_W;} }
      if(this.cb.onHudTick) this.cb.onHudTick(this.hud());
    },
    solidsAt(){ return this.level.solids.filter(s=>!s.gone); },
    collideMove(p,dt){
      // horizontal
      p.x+=p.vx*dt;
      for(const s of this.solidsAt()){
        if(s.type==='oneway'||(!s.revealed)) continue;
        if(aabb(p,s)){
          if(p.vx>0) p.x=s.x-p.w; else if(p.vx<0) p.x=s.x+s.w;
          // NOTE: moving-platform carry is applied once in the vertical pass
          // below (it used to be applied twice, shoving the player into walls).
          p.vx=0;
        }
      }
      // vertical (landing tolerance scales with this frame's travel so fast
      // falls at low fps can't tunnel through thin platforms and drop the
      // player into a surprise checkpoint respawn)
      const prevBottom=p.y+p.h;
      const fallDist=Math.max(0,p.vy*dt);
      const landTol=Math.max(18,fallDist+4), oneTol=Math.max(8,fallDist+2);
      p.y+=p.vy*dt; p.onGround=false;
      for(const s of this.solidsAt()){
        if(s.gone) continue;
        if(s.type==='oneway'){
          if(p.vy>=0&&prevBottom<=s.y+oneTol&&aabb(p,s)){ p.y=s.y-p.h; p.vy=0; p.onGround=true; p.ground=s; }
          continue;
        }
        if(!s.revealed){
          // bump hidden from below
          if(p.vy<0&&aabb(p,s)){ s.revealed=true; s.hit=true; sfx('secret'); this.floater(s.x+s.w/2,s.y-16,'SECRET!','#B388FF'); this.score+=200; this.secretCount++; this.burst(s.x+s.w/2,s.y,'#B388FF',12); p.vy=120; }
          continue;
        }
        if(aabb(p,s)){
          if(p.vy>0&&prevBottom<=s.y+landTol){
            p.y=s.y-p.h; p.vy=0; p.onGround=true; p.ground=s;
            if(s.type==='bouncy'){ p.vy=-950; sfx('spring'); this.burst(p.x,p.y+p.h,'#5DF2C8',10); }
            if(s.type==='fall'){ s.fallT+=dt; }
            if(s.type==='break'&&!s.hit){ s.hit=true; s.gone=true; sfx('break'); this.burst(s.x+s.w/2,s.y,'#c98a4d',12); }
            if(s.type==='move'&&s.axis==='x') p.x+=(s.dx||0);
            if(s.type==='move'&&s.axis==='y') p.y+=(s.dy||0);
          } else if(p.vy<0){
            p.y=s.y+s.h; p.vy=0;
            if(s.type==='break'&&!s.hit){ s.hit=true; s.gone=true; sfx('break'); this.burst(s.x+s.w/2,s.y+s.h,'#c98a4d',12); }
          }
        }
      }
      // defensive: a corrupted coordinate must never fling the player across
      // the level — clamp to the world, and recover to the checkpoint if broken
      if(!isFinite(p.x)||!isFinite(p.y)){ this.respawnAtCheckpoint(); return; }
      p.x=Math.max(-30,Math.min(this.level.width-10,p.x));
      if(p.y>620){ // fell below the world
        this.hurtPlayer(p.x); const pl=this.player;
        if(pl.hp>0&&!pl.dead){ this.respawnAtCheckpoint(); }
        else if(!pl.dead) { pl.y=600; }
      }
    },
    /* Resolve the highest ground top under x (used for safe checkpoints). */
    groundTopAt(x){
      let best=Infinity;
      for(const s of this.level.solids){
        if(s.gone||s.type!=='ground') continue;
        if(x>=s.x&&x<=s.x+s.w&&s.y<best) best=s.y;
      }
      return best===Infinity?470:best;
    },
    /* Clamp a checkpoint into the world and onto solid ground so respawns
       never materialize inside a wall or in mid-air. */
    sanitizeCheckpoint(cp){
      const w=this.level?this.level.width:3000;
      let x=Math.max(20,Math.min(w-40,cp.x));
      let y=isFinite(cp.y)?cp.y:440;
      y=Math.max(60,Math.min(560,y));
      // relocate onto supported ground: groundTopAt() defaults to 470 over
      // gaps, which used to materialize respawns above holes (fall straight
      // back down -> hurt -> respawn -> fall = death loop). Scan nearby for
      // the closest stance with real ground under it and no hazard in it.
      const sup=xx=>{
        if(!this.level) return null;
        let top=null;
        for(const s of this.level.solids){ if(s.gone||s.type!=='ground') continue; if(xx>=s.x&&xx<=s.x+s.w&&(top===null||s.y<top)) top=s.y; }
        return top;
      };
      const clear=(xx,gy)=>{
        const L=this.level; if(!L||gy===null) return false;
        for(const h of (L.hazards||[])){ if(xx-14<h.x+h.w&&xx+14>h.x&&gy-42<h.y+h.h&&gy>h.y) return false; }
        return true;
      };
      if(sup(x)===null||!clear(x,sup(x))){
        for(let d=20;d<=240;d+=20){
          if(x-d>=20&&sup(x-d)!==null&&clear(x-d,sup(x-d))){ x=x-d; break; }
          if(x+d<=w-40&&sup(x+d)!==null&&clear(x+d,sup(x+d))){ x=x+d; break; }
        }
        // else keep x (previous behavior) — level data now snaps flags away
        // from holes, so this is only a last-resort fallback
      }
      const gy=this.level?this.groundTopAt(x):470;
      // rest just above the ground, but never above where the player stood
      y=Math.min(y,gy-44);
      // nudge up out of any solid we might still overlap
      const probe={w:28,h:42};
      for(let i=0;i<8;i++){
        probe.x=x; probe.y=y;
        let inside=false;
        for(const s of this.solidsAt()){
          if(s.type==='oneway'||!s.revealed) continue;
          if(aabb(probe,s)){ inside=true; break; }
        }
        if(!inside) break;
        y-=14;
      }
      return {x,y:Math.max(40,y)};
    },
    respawnAtCheckpoint(){
      const p=this.player; if(!p) return;
      const cp=this.sanitizeCheckpoint(this.checkpoint||{x:60,y:390});
      this.checkpoint=cp;
      p.x=cp.x; p.y=cp.y; p.vx=0; p.vy=0;
    },
    updatePlayer(dt,In){
      const p=this.player; if(!p||this.completed) return;
      // defensive: corrupted physics state recovers at the checkpoint instead
      // of flinging the player across (or out of) the level
      if(!isFinite(p.x)||!isFinite(p.y)||!isFinite(p.vx)||!isFinite(p.vy)){ this.respawnAtCheckpoint(); return; }
      if(p.dead>0){ p.dead-=dt; p.vy+=GRAV*dt; p.y+=p.vy*dt; return; }
      if(p.win>0){ p.win-=dt; p.vx*=0.9; p.vy+=GRAV*dt; p.y+=p.vy*dt; return; }
      p.anim+=dt; p.iframes=Math.max(0,p.iframes-dt);
      p.speedT=Math.max(0,p.speedT-dt); p.jumpT=Math.max(0,p.jumpT-dt); p.starT=Math.max(0,p.starT-dt); p.magnetT=Math.max(0,(p.magnetT||0)-dt); p.invT=Math.max(0,(p.invT||0)-dt); p.shootCd=Math.max(0,p.shootCd-dt);
      p.crouch=false;
      const run=In.down('run')||p.speedT>0;
      const max=run?330:210;
      const acc=p.onGround?2200:1500;
      let move=0;
      if(In.down('left')) move-=1; if(In.down('right')) move+=1;
      if(move!==0){ p.vx+=move*acc*dt; p.face=move; if(p.onGround&&Math.abs(p.vx)>240&&Math.random()<0.2&&!this.settings.reducedMotion) this.parts.push({x:p.x+p.w/2,y:p.y+p.h,vx:-move*40,vy:-60,t:0.4,color:'#ffffff88',sz:3}); }
      else { const f=p.onGround?1800:500; p.vx-=Math.sign(p.vx)*Math.min(Math.abs(p.vx),f*dt); }
      p.vx=Math.max(-max,Math.min(max,p.vx));
      // jumping: buffer + coyote
      if(In.consumeJumpBuffer()) p.jbuf=0.14; else p.jbuf=Math.max(0,p.jbuf-dt);
      p.coyote=p.onGround?0.11:Math.max(0,p.coyote-dt);
      if(p.jbuf>0&&p.coyote>0){
        const boost=p.jumpT>0?1.35:1;
        p.vy=-(745)*boost; p.onGround=false; p.coyote=0; p.jbuf=0;
        sfx('jump');
        this.burst(p.x+p.w/2,p.y+p.h,'#ffffff',6);
      }
      // variable jump
      if(!In.down('jump')&&p.vy<-260) p.vy+=GRAV*2.2*dt;
      p.vy+=GRAV*dt; p.vy=Math.min(1100,p.vy);
      const wasAir=!p.onGround, fallV=p.vy;
      this.collideMove(p,dt);
      if(p.onGround&&wasAir&&fallV>500){ this.burst(p.x+p.w/2,p.y+p.h,'#fff',8); }
      // ride moving platform vertical
      if(p.ground&&p.ground.type==='move'&&p.ground.axis==='y'){ /* carried in collide */ }
      p.ground=null;
      // state
      p.state=!p.onGround?(p.vy<0?'jump':'fall'):(Math.abs(p.vx)>250?'run':Math.abs(p.vx)>20?'walk':'idle');
      // interactions
      const L=this.level, me={x:p.x-4,y:p.y-4,w:p.w+8,h:p.h+8};
      const magR=p.magnetT>0?150:0, pcx=p.x+p.w/2, pcy=p.y+p.h/2;
      for(const c of L.coins){
        if(c.taken) continue;
        // magnet: drift nearby shards toward Pip (positions stay level-local)
        if(magR){
          const dx=pcx-c.x, dy=pcy-c.y, d=Math.sqrt(dx*dx+dy*dy);
          if(d<magR&&d>4){ const step=Math.min(d,460*dt); c.x+=dx/d*step; c.y+=dy/d*step; }
        }
        if(Math.abs(c.x-pcx)<26&&Math.abs(c.y-pcy)<34){ c.taken=true; this.coinCount++; this.levelCoins++; this.score+=c.secret?200:50; sfx('coin'); this.burst(c.x,c.y,'#FFC94D',8); this.floater(c.x,c.y-14,'+'+(c.secret?200:50),'#FFC94D'); }
      }
      if(L.relic&&!L.relic.taken&&Math.abs(L.relic.x-(p.x+p.w/2))<28&&Math.abs(L.relic.y-(p.y+p.h/2))<36){ L.relic.taken=true; this.relicGot=true; this.score+=500; sfx('relic'); this.floater(L.relic.x,L.relic.y-20,'★ RELIC +500','#B388FF'); this.confetti(L.relic.x,L.relic.y); }
      for(const u of L.powerups){ if(!u.taken&&Math.abs(u.x-(p.x+p.w/2))<28&&Math.abs(u.y-(p.y+p.h/2))<36){ u.taken=true; this.applyPower(u.kind); } }
      for(const c of L.checkpoints){ if(!c.on&&Math.abs(c.x-(p.x+p.w/2))<30&&(p.y<500)){ c.on=true; this.checkpoint=this.sanitizeCheckpoint({x:c.x,y:this.groundTopAt(c.x)-p.h-2}); this.score+=50; sfx('checkpoint'); this.floater(c.x,300,'CHECKPOINT!','#5DF2C8'); this.burst(c.x,340,'#5DF2C8',14);} }
      // checkpoint y resolve: stored ground-resolved at trigger time (see above)
      // hazards: every hazard only deals damage + knockback. Checkpoint
      // respawns happen exclusively through the death path (killPlayer) or a
      // genuine fall below the world — touching lava edges must never fling
      // the player backwards across the level.
      for(const h of L.hazards){
        const hb={x:h.x,y:h.y,w:h.w,h:h.h};
        if(h.kind==='pit') continue;
        if(aabb(me,hb)){ this.hurtPlayer(h.x+h.w/2); }
      }
      // enemies: stomp vs hurt
      for(const e of L.enemies){
        if(!e.alive) continue;
        const eb={x:e.x,y:e.y,w:e.w,h:e.h};
        if(!aabb(me,eb)) continue;
        const stomping=p.vy>120&&(p.y+p.h-e.y)<24;
        const def=ENEMY_DEF[e.kind];
        if(stomping){
          if(def.armored&&e.hp>1&&!p.starT){ this.hurtPlayer(e.x+e.w/2); continue; }
          e.alive=false; p.vy=-520; p.onGround=false;
          this.score+=def.score; sfx('stomp'); this.burst(e.x,e.y,'#fff',12); this.floater(e.x,e.y-14,'+'+def.score,'#fff');
        } else {
          this.hurtPlayer(e.x+e.w/2);
        }
      }
      // enemy shots
      for(const s of this.eshots){ if(aabb(me,s)){ s.t=0; this.hurtPlayer(s.x); } }
      // player shots vs enemies/boss
      // (handled in updateShots)
      // goal
      const g=L.goal;
      if(Math.abs(g.x-(p.x+p.w/2))<40&&Math.abs((g.y)-(p.y))<90){
        if(!L.isBoss||!L.boss||L.boss.dead){ p.win=2; this.completeLevel(); }
      }
      if(this.cb.onHud) this.cb.onHud(this.hud());
    },
    /* ---------------- POWER-UP SHOP (per-level coins) ----------------
       levelCoins is runtime-only: reset to 0 on every loadLevel, deducted on
       purchase, never persisted to saves, never carried into the next level.
       coinCount (collection records) is intentionally left untouched by
       spending. Balances inspected against the real level economy: typical
       levels hold 60–100 shards, a decent run banks ~25–40, so prices force
       real choices (small haul → boost, good haul → shield/life, big haul →
       invincibility) without ever being farmable across levels. */
    SHOP:[
      {id:'jump', icon:'🦘', name:'JUMP BOOST', desc:'Higher jumps · 30s', price:15},
      {id:'speed',icon:'⚡', name:'SPEED BOOST',desc:'Move faster · 30s',   price:20},
      {id:'magnet',icon:'🧲',name:'MAGNET',     desc:'Coins fly to you · 30s',price:20},
      {id:'shield',icon:'🛡',name:'SHIELD',     desc:'Blocks one hit',      price:25},
      {id:'life', icon:'❤', name:'EXTRA LIFE', desc:'+1 life · max 5',     price:30},
      {id:'star', icon:'✦', name:'INVINCIBILITY',desc:'No damage · 15s',   price:40},
    ],
    buyPower(id){
      const p=this.player, L=this.level;
      if(!p||!L||this.completed||p.dead) return {ok:false,msg:'Finish the moment first!'};
      const item=this.SHOP.find(i=>i.id===id);
      if(!item) return {ok:false,msg:'Unknown power-up.'};
      if(id==='life'&&this.lives>=5) return {ok:false,msg:'Already at max lives!'};
      if(id==='shield'&&p.shield) return {ok:false,msg:'Shield already active!'};
      if(this.levelCoins<item.price) return {ok:false,msg:'Need '+item.price+' 🪙 (have '+this.levelCoins+')'};
      this.levelCoins-=item.price;
      if(id==='jump') p.jumpT=30;
      if(id==='speed') p.speedT=30;
      if(id==='magnet') p.magnetT=30;
      if(id==='shield') p.shield=true;
      if(id==='life') this.lives=Math.min(5,this.lives+1);
      if(id==='star') p.invT=15;
      sfx('power');
      this.burst(p.x+p.w/2,p.y+p.h/2,'#FFC94D',14);
      this.floater(p.x,p.y-24,item.name+'!','#FFC94D');
      if(this.cb.onHud) this.cb.onHud(this.hud());
      return {ok:true,msg:item.name+' active!',remaining:this.levelCoins};
    },
    applyPower(kind){
      const p=this.player; sfx('power');
      if(kind==='heart'){ p.hp=Math.min(p.maxhp,p.hp+1); this.floater(p.x,p.y-20,'+HEART','#FF6B6B'); }
      if(kind==='shield'){ p.shield=true; this.floater(p.x,p.y-20,'SHIELD!','#5DF2C8'); }
      if(kind==='speed'){ p.speedT=12; this.floater(p.x,p.y-20,'SWIFT!','#FFD166'); }
      if(kind==='spring'){ p.jumpT=12; this.floater(p.x,p.y-20,'SPRING!','#5DF2C8'); }
      if(kind==='star'){ p.starT=25; this.floater(p.x,p.y-20,'STARBOLT!','#FFC94D'); }
      this.score+=100; this.burst(p.x,p.y,'#fff',12);
      if(this.cb.onHud) this.cb.onHud(this.hud());
    },
    updateSolids(dt){
      for(const s of this.level.solids){
        if(s.type==='move'){
          const t=this.tGlobal*s.speed+(s.phase||0);
          let nx=s.ox,ny=s.oy;
          if(s.axis==='x') nx=s.ox+Math.sin(t)*s.range; else ny=s.oy+Math.sin(t)*s.range;
          s.dx=nx-s.x; s.dy=ny-s.y; s.x=nx; s.y=ny;
        }
        if(s.type==='fall'&&s.fallT>0&&!s.gone){
          if(s.fallT>0.45){ s.y+=900*dt; if(s.y>640){ s.gone=true; s.fallT=0; setTimeout(()=>{ if(this.level){ s.gone=false; s.y=s.y0; s.fallT=0; } },3500); } }
        }
      }
    },
    updateEnemies(dt){
      const L=this.level,p=this.player;
      for(const e of L.enemies){
        if(!e.alive) continue;
        e.flash=Math.max(0,(e.flash||0)-dt); e.t=(e.t||0)+dt;
        const def=ENEMY_DEF[e.kind];
        // gravity (except flyer)
        if(!def.fly){ e.vy=Math.min(1000,(e.vy||0)+GRAV*dt); }
        let vx=0;
        if(e.kind==='walker') vx=e.dir*def.speed;
        if(e.kind==='runner') vx=e.dir*def.speed*(0.8+0.4*Math.sin(e.t*0.7));
        if(e.kind==='patroller') vx=e.dir*def.speed;
        if(e.kind==='brute') vx=e.dir*def.speed;
        if(e.kind==='spitter') vx=e.dir*def.speed*0.6;
        if(e.kind==='hopper'){ vx=e.dir*def.speed; if(e.onG){ e.vy=-560; e.onG=false; } }
        if(e.kind==='flyer'){ e.ph+=dt*2; vx=e.dir*def.speed; e.vy=Math.sin(e.ph)*90; e.y+=e.vy*dt; }
        e.x+=vx*dt;
        if(!def.fly){ e.y+=(e.vy||0)*dt; e.onG=false;
          for(const s of this.solidsAt()){ if(s.type==='oneway'||!s.revealed) continue;
            if(aabb({x:e.x,y:e.y,w:e.w,h:e.h},s)){
              if((e.vy||0)>=0&&e.y+e.h-s.y<26){ e.y=s.y-e.h; e.vy=0; e.onG=true; }
              else { e.dir*=-1; e.x+=e.dir*2; }
            } }
          if(e.y>640) e.alive=false;
        }
        // turn at edges/level bounds
        if(e.x<10){e.x=10;e.dir=1;} if(e.x>this.level.width-40){e.x=this.level.width-40;e.dir=-1;}
        // spitter shooting
        if(def.shoot){ e.shootT-=dt; if(e.shootT<=0&&Math.abs(e.x-p.x)<420&&e.alive){ e.shootT=2.2; this.eshots.push({x:e.x,y:e.y,vx:(p.x>e.x?1:-1)*200,vy:-80,w:10,h:10,t:3}); sfx('shoot'); } }
        // hop sound-less
      }
      // enemy projectiles gravity
      for(const s of this.eshots){ s.vy=(s.vy||0)+900*dt; s.x+=s.vx*dt; s.y+=s.vy*dt; s.t-=dt;
        for(const g of this.solidsAt()){ if(g.revealed!==false&&aabb(s,g)){ s.t=0; break; } } }
      this.eshots=this.eshots.filter(s=>s.t>0&&s.y<640);
    },
    updateBoss(dt){
      const B=this.level&&this.level.boss; if(!B||B.dead) return;
      const p=this.player; B.t+=dt; B.hurtT=Math.max(0,B.hurtT-dt);
      const phase=B.hp<=Math.ceil(B.maxhp/3)?3:(B.hp<=Math.ceil(B.maxhp*2/3)?2:1);
      B.phase=phase;
      const speed=(60+this.levelNum*4)*(1+phase*0.35);
      B.dir=p.x>B.x?-1:1; if(p.x<B.x) B.dir=1; if(p.x>B.x+ B.w) B.dir=-1;
      // hop toward player
      B.vy=Math.min(1000,(B.vy||0)+GRAV*0.8*dt);
      if(B.onG){ B.vy=-(380+phase*90); B.onG=false; if(Math.abs(p.x-B.x)<60) B.vx=(p.x>B.x?1:-1)*speed*1.6; else B.vx=(p.x>B.x?1:-1)*speed; }
      B.x+=(B.vx||0)*dt; B.y+=(B.vy||0)*dt; B.onG=false;
      for(const s of this.solidsAt()){ if(s.type==='oneway'||!s.revealed) continue;
        if(aabb({x:B.x,y:B.y,w:B.w,h:B.h},s)){
          if((B.vy||0)>=0&&B.y+B.h-s.y<34){ B.y=s.y-B.h; B.vy=0; B.onG=true; }
          else { B.vx=-(B.vx||0); B.x+=Math.sign(B.vx||1)*3; }
        } }
      B.x=Math.max(this.level.width-760,B.x); B.x=Math.min(this.level.width-60,B.x);
      // attacks
      B.shootT-=dt;
      if(B.shootT<=0){ B.shootT=Math.max(0.7,2.2-phase*0.4);
        const n=phase>=2?2:1;
        for(let i=0;i<n;i++) this.eshots.push({x:B.x+B.w/2,y:B.y+10,vx:(p.x>B.x?-1:1)*(220+phase*40)+(i-0.5)*60,vy:-160,w:12,h:12,t:3.5});
        sfx('shoot');
      }
      // contact with player
      const me={x:p.x-4,y:p.y-4,w:p.w+8,h:p.h+8}, bb={x:B.x,y:B.y,w:B.w,h:B.h};
      if(aabb(me,bb)){
        const stomping=p.vy>120&&(p.y+p.h-B.y)<30;
        if(stomping){ this.hitBoss(); p.vy=-620; }
        else this.hurtPlayer(B.x+B.w/2);
      }
    },
    hitBoss(){
      const B=this.level.boss; if(!B||B.dead||B.hurtT>0) return;
      B.hp--; B.hurtT=0.8; sfx('bossHit'); this.cam.shake=12;
      this.burst(B.x+B.w/2,B.y+B.h/2,'#FFC94D',22); this.score+=500;
      this.floater(B.x,B.y-20,'BOSS -1 ('+B.hp+')','#FF6B6B');
      if(B.hp<=0){ B.dead=true; sfx('bossDie'); this.confetti(B.x,B.y); this.score+=2000; this.floater(B.x,B.y-40,'BOSS DOWN! +2000','#FFC94D'); if(this.cb.onHud) this.cb.onHud(this.hud()); }
      if(this.cb.onHud) this.cb.onHud(this.hud());
    },
    updateShots(dt){
      for(const s of this.shots){ s.x+=s.vx*dt; s.t-=dt;
        const sb={x:s.x,y:s.y,w:s.w,h:s.h};
        for(const e of this.level.enemies){ if(!e.alive) continue;
          if(aabb(sb,{x:e.x,y:e.y,w:e.w,h:e.h})){ e.hp--; e.flash=0.15; s.t=0;
            if(e.hp<=0){ e.alive=false; this.score+=ENEMY_DEF[e.kind].score+50; sfx('stomp'); this.burst(e.x,e.y,'#FFC94D',12); }
            else sfx('bossHit');
            break; } }
        const B=this.level.boss;
        if(B&&!B.dead&&aabb(sb,{x:B.x,y:B.y,w:B.w,h:B.h})){ s.t=0; this.hitBoss(); }
        for(const g of this.solidsAt()){ if(g.revealed!==false&&aabb(sb,g)){ s.t=0; this.burst(s.x,s.y,'#fff',4); break; } }
      }
      this.shots=this.shots.filter(s=>s.t>0&&s.x>0&&s.x<this.level.width);
    },
    updateParts(dt){
      for(const q of this.parts){ q.t-=dt; q.vy+=(q.grav||700)*dt; q.x+=q.vx*dt; q.y+=q.vy*dt; }
      this.parts=this.parts.filter(q=>q.t>0);
      for(const f of this.floaters){ f.t-=dt; f.y-=40*dt; }
      this.floaters=this.floaters.filter(f=>f.t>0);
    },
    updateCamera(dt){
      const p=this.player; if(!p) return;
      const target=Math.max(0,Math.min(this.level.width-VIEW_W,p.x+p.w/2-VIEW_W*0.42));
      this.cam.x+=(target-this.cam.x)*Math.min(1,dt*6);
      if(Math.abs(target-this.cam.x)<0.5) this.cam.x=target;
      this.cam.shake=Math.max(0,(this.cam.shake||0)-dt*30);
    },
    /* ---------------- RENDER ---------------- */
    render(){
      const c=this.ctx; if(!c||!this.level) return;
      // map the fixed 960x540 world onto whatever backing store fitCanvas chose
      if(this.canvas&&this.canvas.width) c.setTransform(this.canvas.width/VIEW_W,0,0,this.canvas.height/VIEW_H,0,0);
      const L=this.level, th=L.theme;
      const shx=this.settings.shake?(Math.random()-0.5)*(this.cam.shake||0):0;
      const shy=this.settings.shake?(Math.random()-0.5)*(this.cam.shake||0):0;
      // sky
      const g=c.createLinearGradient(0,0,0,VIEW_H); g.addColorStop(0,th.sky[0]); g.addColorStop(0.6,th.sky[1]); g.addColorStop(1,th.sky[2]);
      c.fillStyle=g; c.fillRect(0,0,VIEW_W,VIEW_H);
      this.drawParallax(c,th);
      c.save(); c.translate(-Math.round(this.cam.x+shx),Math.round(shy));
      this.drawHazardsBack(c);
      this.drawSolids(c);
      this.drawCheckpoints(c);
      this.drawGoal(c);
      this.drawCoins(c);
      this.drawPowerups(c);
      this.drawEnemies(c);
      this.drawBoss(c);
      this.drawShots(c);
      this.drawPlayer(c);
      this.drawParts(c);
      c.restore();
      this.drawWeather(c);
      this.drawBossBar(c);
      if(this.player&&this.player.iframes>0&&Math.floor(this.tGlobal*12)%2===0){ /* blink handled in player */ }
    },
    drawParallax(c,th){
      const cx=this.cam.x;
      c.save(); c.globalAlpha=0.5;
      // far hills
      c.fillStyle='rgba(0,0,0,0.18)';
      for(let i=0;i<3;i++){ const off=(cx*(0.15+i*0.12))%700;
        for(let x=-off;x<VIEW_W+700;x+=700){ c.beginPath(); c.ellipse(x+350,560-i*30,360,140-i*20,0,Math.PI,0); c.fill(); } }
      // stars / motes
      c.globalAlpha=0.9; c.fillStyle='#ffffff';
      const n=this.settings.reducedMotion?20:(this.lowFX?30:60);
      for(let i=0;i<n;i++){ const sx=((i*173.3-cx*0.3)%VIEW_W+VIEW_W)%VIEW_W, sy=(i*97.7)%300; c.globalAlpha=0.25+0.55*Math.abs(Math.sin(this.tGlobal*1.5+i)); c.fillRect(sx,sy,2.4,2.4); }
      c.restore();
    },
    drawSolids(c){
      const x0=this.cam.x-60,x1=this.cam.x+VIEW_W+60;
      for(const s of this.level.solids){
        if(s.gone||s.x+s.w<x0||s.x>x1) continue;
        if(!s.revealed){ // subtle shimmer hint
          c.fillStyle='rgba(255,255,255,0.06)'; c.fillRect(s.x,s.y,s.w,s.h);
          continue;
        }
        const th=this.level.theme;
        if(s.type==='ground'){
          c.fillStyle=th.ground; c.fillRect(s.x,s.y,s.w,s.h);
          c.fillStyle=th.groundTop; c.fillRect(s.x,s.y,s.w,10);
          c.fillStyle='rgba(0,0,0,0.15)';
          for(let x=s.x+12;x<s.x+s.w;x+=36) c.fillRect(x,s.y+26,5,10);
        } else {
          let col=th.plat, top='rgba(255,255,255,0.35)';
          if(s.type==='move') col='#4DA6FF';
          if(s.type==='fall') col='#c9a24d';
          if(s.type==='bouncy') col='#5DF2C8';
          if(s.type==='break') col='#a86b3f';
          if(s.type==='oneway') col='#B388FF';
          if(s.type==='hidden') col='#8a8ab8';
          c.fillStyle=col; this.rr(c,s.x,s.y,s.w,s.h,7); c.fill();
          c.fillStyle=top; c.fillRect(s.x+3,s.y+3,s.w-6,4);
          c.fillStyle='rgba(0,0,0,0.3)'; c.fillRect(s.x+3,s.y+s.h-5,s.w-6,3);
          if(s.type==='bouncy'){ c.fillStyle='#fff'; c.font='bold 13px sans-serif'; c.fillText('≈',s.x+s.w/2-5,s.y+16); }
          if(s.type==='fall'&&s.fallT>0){ c.fillStyle='rgba(255,80,80,'+Math.min(0.7,s.fallT)+')'; c.fillRect(s.x,s.y,s.w,s.h); }
          if(s.type==='move'){ c.fillStyle='#fff'; c.beginPath(); c.arc(s.x+s.w/2,s.y+s.h/2,4,0,7); c.fill(); }
        }
      }
    },
    rr(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); },
    drawHazardsBack(c){
      for(const h of this.level.hazards){
        if(h.kind==='pit') continue;
        if(h.x+h.w<this.cam.x-60||h.x>this.cam.x+VIEW_W+60) continue;
        const cols={spikes:'#c7cede',sandspikes:'#e8b34d',icicles:'#cfeaff',thorns:'#7ed957',poison:'#7CFF6B',lightning:'#FFE95c',lava:'#FF5A2B',void:'#B388FF',starfire:'#FFC94D'};
        c.fillStyle=cols[h.kind]||'#ff5a5a';
        if(h.kind==='lava'||h.kind==='poison'){ const w2=Math.sin(this.tGlobal*3)*3; c.fillRect(h.x,h.y+w2,h.w,h.h); c.fillStyle='rgba(255,255,255,0.5)'; for(let x=h.x+6;x<h.x+h.w;x+=22){ c.beginPath(); c.arc(x,h.y+8+Math.sin(this.tGlobal*4+x)*3,4,0,7); c.fill(); } }
        else if(h.kind==='lightning'){ c.fillRect(h.x,h.y,h.w,h.h); c.fillStyle='#fff'; if(Math.floor(this.tGlobal*3)%2===0) c.fillRect(h.x+8,h.y-40,6,40); }
        else { // spikes row
          const n=Math.max(1,Math.floor(h.w/16));
          for(let i=0;i<n;i++){ const sx=h.x+i*(h.w/n); c.beginPath(); c.moveTo(sx,h.y+h.h); c.lineTo(sx+h.w/n/2,h.y); c.lineTo(sx+h.w/n,h.y+h.h); c.closePath(); c.fill(); }
        }
      }
    },
    drawCheckpoints(c){
      for(const k of this.level.checkpoints){
        // find ground y
        let gy=470; for(const s of this.level.solids){ if(s.type==='ground'&&k.x>=s.x&&k.x<=s.x+s.w){ gy=s.y; break; } }
        c.strokeStyle=k.on?'#5DF2C8':'#8a93b8'; c.lineWidth=5;
        c.beginPath(); c.moveTo(k.x,gy); c.lineTo(k.x,gy-90); c.stroke();
        c.fillStyle=k.on?'#5DF2C8':'#3a457e';
        const wave=Math.sin(this.tGlobal*4)*3;
        c.fillRect(k.x,gy-90,k.on?44:30,22);
        c.fillStyle='#0B1026'; c.font='bold 11px sans-serif'; c.fillText(k.on?'✔':'?',k.x+8,gy-74);
        if(k.on&&!this.settings.reducedMotion){ c.fillStyle='#5DF2C8'; c.globalAlpha=0.5+0.3*Math.sin(this.tGlobal*5); c.beginPath(); c.arc(k.x+10,gy-100+wave,6,0,7); c.fill(); c.globalAlpha=1; }
      }
    },
    drawGoal(c){
      const g=this.level.goal; let gy=g.y+90;
      for(const s of this.level.solids){ if(s.type==='ground'&&g.x>=s.x&&g.x<=s.x+s.w){ gy=s.y; break; } }
      const open=!this.level.isBoss||!this.level.boss||this.level.boss.dead;
      c.strokeStyle=open?'#FFC94D':'#555'; c.lineWidth=6;
      c.beginPath(); c.moveTo(g.x,gy); c.lineTo(g.x,gy-150); c.stroke();
      const glow=open?(0.6+0.4*Math.sin(this.tGlobal*4)):0.25;
      c.save(); c.globalAlpha=glow; c.fillStyle='#FFC94D'; c.beginPath(); c.arc(g.x,gy-160,26+Math.sin(this.tGlobal*3)*4,0,7); c.fill(); c.restore();
      c.fillStyle=open?'#FFE9A8':'#666'; this.rr(c,g.x-24,gy-186,64,34,8); c.fill();
      c.fillStyle=open?'#7a3c00':'#222'; c.font='bold 11px sans-serif'; c.fillText(open?'GOAL':'LOCK',g.x-16,gy-165);
      // flag
      c.fillStyle=open?'#5DF2C8':'#444'; c.fillRect(g.x+6,gy-150,44,26);
    },
    drawCoins(c){
      for(const co of this.level.coins){ if(co.taken) continue; if(co.x<this.cam.x-40||co.x>this.cam.x+VIEW_W+40) continue;
        const sq=Math.abs(Math.sin(this.tGlobal*4+co.x*0.05));
        c.save(); c.translate(co.x,co.y+Math.sin(this.tGlobal*2+co.x)*3); c.scale(0.35+0.65*sq,1);
        c.fillStyle=co.secret?'#B388FF':'#FFC94D'; c.beginPath(); c.arc(0,0,11,0,7); c.fill();
        c.fillStyle='#fff6c8'; c.beginPath(); c.arc(-2,-3,4,0,7); c.fill();
        c.restore();
      }
      const r=this.level.relic;
      if(r&&!r.taken){ const bob=Math.sin(this.tGlobal*3)*6;
        c.save(); c.shadowColor='#B388FF'; c.shadowBlur=18; c.fillStyle='#fff';
        c.translate(r.x,r.y+bob);
        c.beginPath(); for(let i=0;i<5;i++){ const a=-Math.PI/2+i*Math.PI*2/5, a2=a+Math.PI/5; c.lineTo(Math.cos(a)*14,Math.sin(a)*14); c.lineTo(Math.cos(a2)*6,Math.sin(a2)*6); } c.closePath(); c.fill(); c.restore();
      }
    },
    drawPowerups(c){
      const icons={heart:['#FF6B6B','♥'],shield:['#5DF2C8','◈'],speed:['#FFD166','≫'],spring:['#7ed957','↥'],star:['#FFC94D','✦']};
      for(const u of this.level.powerups){ if(u.taken) continue; if(u.x<this.cam.x-40||u.x>this.cam.x+VIEW_W+40) continue;
        const bob=Math.sin(this.tGlobal*3+u.x)*5;
        c.fillStyle='rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(u.x,u.y+22,16,6,0,0,7); c.fill();
        c.fillStyle=icons[u.kind][0]; c.beginPath(); c.arc(u.x,u.y+bob,15,0,7); c.fill();
        c.lineWidth=3; c.strokeStyle='#fff'; c.stroke();
        c.fillStyle='#1a1030'; c.font='bold 15px sans-serif'; c.textAlign='center'; c.fillText(icons[u.kind][1],u.x,u.y+bob+5); c.textAlign='left';
      }
    },
    drawEnemies(c){
      for(const e of this.level.enemies){ if(!e.alive) continue; if(e.x<this.cam.x-80||e.x>this.cam.x+VIEW_W+80) continue;
        const def=ENEMY_DEF[e.kind]; const hop=e.kind==='hopper'&&!e.onG?-8:0;
        const flash=e.flash>0;
        c.save(); if(flash) c.globalAlpha=0.5+0.5*Math.sin(this.tGlobal*30);
        // shadow
        c.fillStyle='rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(e.x+e.w/2,e.y+e.h+4,e.w/2,5,0,0,7); c.fill();
        // body
        c.fillStyle=def.color; this.rr(c,e.x,e.y+hop,e.w,e.h,9); c.fill();
        c.lineWidth=2.5; c.strokeStyle='rgba(0,0,0,0.5)'; c.stroke();
        // details per kind
        c.fillStyle='#fff';
        const ex=e.dir>0?e.x+e.w-14:e.x+6;
        if(e.kind==='flyer'){ c.fillStyle='rgba(255,255,255,0.85)'; const f=Math.sin(e.t*14)*6; c.beginPath(); c.ellipse(e.x+4,e.y+8+f,10,5,-0.5,0,7); c.fill(); c.beginPath(); c.ellipse(e.x+e.w-4,e.y+8-f,10,5,0.5,0,7); c.fill(); c.fillStyle='#fff'; }
        if(e.kind==='brute'){ c.fillStyle='#4a4a66'; c.fillRect(e.x+4,e.y+2,e.w-8,8); }
        if(e.kind==='spitter'){ c.fillStyle='#2b0012'; c.beginPath(); c.arc(e.x+e.w/2,e.y+8,6,0,7); c.fill(); }
        c.beginPath(); c.arc(ex,e.y+11,5,0,7); c.fill(); c.beginPath(); c.arc(ex+(e.dir>0?10:-10)*0+e.dir*2,e.y+11,5,0,7); c.fill();
        c.fillStyle='#14102a'; c.beginPath(); c.arc(ex+e.dir*2,e.y+12,2.4,0,7); c.fill();
        if(e.kind==='hopper'){ c.strokeStyle='#0c4a37'; c.lineWidth=3; c.beginPath(); c.moveTo(e.x+6,e.y+e.h); c.lineTo(e.x+2,e.y+e.h+8); c.moveTo(e.x+e.w-6,e.y+e.h); c.lineTo(e.x+e.w-2,e.y+e.h+8); c.stroke(); }
        c.restore();
      }
    },
    drawBoss(c){
      const B=this.level.boss; if(!B) return; if(B.dead){ return; }
      if(B.x<this.cam.x-160||B.x>this.cam.x+VIEW_W+160) return;
      const blink=B.hurtT>0&&Math.floor(this.tGlobal*16)%2===0;
      c.save(); if(blink) c.globalAlpha=0.55;
      c.fillStyle='rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(B.x+B.w/2,B.y+B.h+6,B.w/2,8,0,0,7); c.fill();
      const grad=c.createLinearGradient(0,B.y,0,B.y+B.h); grad.addColorStop(0,this.levelNum===50?'#2b0d3a':'#5a1e2b'); grad.addColorStop(1,this.levelNum===50?'#0d0018':'#2b0d12');
      c.fillStyle=grad; this.rr(c,B.x,B.y,B.w,B.h,16); c.fill();
      c.lineWidth=4; c.strokeStyle=this.levelNum===50?'#B388FF':'#FF6B6B'; c.stroke();
      // crown / horns
      c.fillStyle=this.levelNum===50?'#FFC94D':'#FFD166';
      for(let i=0;i<4;i++){ const hx=B.x+8+i*(B.w-16)/3; c.beginPath(); c.moveTo(hx-8,B.y+4); c.lineTo(hx,B.y-16-(B.phase*4)); c.lineTo(hx+8,B.y+4); c.closePath(); c.fill(); }
      // eyes
      const look=Math.sign(this.player.x-B.x)*4;
      c.fillStyle='#fff'; c.beginPath(); c.arc(B.x+B.w*0.32+look,B.y+B.h*0.4,9,0,7); c.fill(); c.beginPath(); c.arc(B.x+B.w*0.68+look,B.y+B.h*0.4,9,0,7); c.fill();
      c.fillStyle='#f00'; c.beginPath(); c.arc(B.x+B.w*0.32+look,B.y+B.h*0.42,4,0,7); c.fill(); c.beginPath(); c.arc(B.x+B.w*0.68+look,B.y+B.h*0.42,4,0,7); c.fill();
      // mouth
      c.fillStyle='#000'; this.rr(c,B.x+B.w*0.25,B.y+B.h*0.62,B.w*0.5,14,7); c.fill();
      c.fillStyle='#fff'; for(let i=0;i<4;i++) c.fillRect(B.x+B.w*0.28+i*12,B.y+B.h*0.62+2,6,6);
      c.restore();
      // name tag
      c.fillStyle='rgba(0,0,0,0.55)'; this.rr(c,B.x-10,B.y-30,B.w+20,20,8); c.fill();
      c.fillStyle='#FFC94D'; c.font='bold 11px sans-serif'; c.textAlign='center'; c.fillText(B.name,B.x+B.w/2,B.y-16); c.textAlign='left';
    },
    drawBossBar(c){
      const B=this.level&&this.level.boss; if(!B) return;
      c.fillStyle='rgba(0,0,0,0.5)'; c.fillRect(180,12,600,26);
      c.fillStyle='#3a0d16'; c.fillRect(184,15,592,20);
      const w=592*Math.max(0,B.hp/B.maxhp);
      const gr=c.createLinearGradient(0,0,600,0); gr.addColorStop(0,'#FF6B6B'); gr.addColorStop(1,'#FFC94D');
      c.fillStyle=gr; c.fillRect(184,15,w,20);
      c.fillStyle='#fff'; c.font='bold 12px sans-serif'; c.textAlign='center'; c.fillText((B.dead?'DEFEATED — reach the GOAL!':B.name+'  ·  phase '+B.phase),480,30); c.textAlign='left';
    },
    drawShots(c){
      c.fillStyle='#FFE9A8';
      for(const s of this.shots){ c.save(); c.shadowColor='#FFC94D'; c.shadowBlur=12; c.fillStyle='#FFE9A8'; this.rr(c,s.x,s.y,s.w,s.h,4); c.fill(); c.restore(); }
      c.fillStyle='#FF6B9D';
      for(const s of this.eshots){ c.beginPath(); c.arc(s.x,s.y,6,0,7); c.fill(); c.fillStyle='#fff'; c.beginPath(); c.arc(s.x,s.y,2.5,0,7); c.fill(); c.fillStyle='#FF6B9D'; }
    },
    drawPlayer(c){
      const p=this.player; if(!p) return;
      const blink=p.iframes>0&&Math.floor(this.tGlobal*14)%2===0;
      c.save(); if(blink) c.globalAlpha=0.45;
      const cx=p.x+p.w/2, feet=p.y+p.h;
      c.fillStyle='rgba(0,0,0,0.32)'; c.beginPath(); c.ellipse(cx,feet+4,p.w/2,5,0,0,7); c.fill();
      const squash=p.state==='jump'?0.92:(p.state==='fall'?1.06:1+Math.sin(p.anim*10)*0.02);
      c.translate(cx,feet); c.scale(p.face,1); c.scale(1,squash); c.translate(-cx,-feet);
      // Custom character sprite (Character.png, 500x500): aspect-preserved,
      // height fitted to the hitbox (p.h), centered on cx, feet-anchored.
      // Hitbox (p.x/p.y/p.w/p.h), physics and mirroring logic are unchanged.
      if(this.charImg&&this.charReady){
        try{ c.drawImage(this.charImg,cx-p.h/2,p.y,p.h,p.h); }catch(e){}
      }
      // shield / powers aura
      if(p.shield){ c.strokeStyle='#5DF2C8'; c.lineWidth=3; c.globalAlpha=0.8; c.beginPath(); c.arc(cx,p.y+p.h/2,30+Math.sin(this.tGlobal*5)*3,0,7); c.stroke(); c.globalAlpha=blink?0.45:1; }
      if(p.starT>0){ c.fillStyle='#FFC94D'; c.font='bold 12px sans-serif'; c.fillText('✦',p.x-14,p.y-6); }
      if(p.invT>0){ c.strokeStyle='#FFC94D'; c.lineWidth=3; c.globalAlpha=0.9; c.beginPath(); c.arc(cx,p.y+p.h/2,34+Math.sin(this.tGlobal*7)*4,0,7); c.stroke(); c.fillStyle='#FFE9A8'; c.font='bold 12px sans-serif'; c.fillText('✦',p.x+p.w+2,p.y-6); c.globalAlpha=blink?0.45:1; }
      if(p.magnetT>0){ c.strokeStyle='rgba(255,201,77,0.5)'; c.lineWidth=2; c.beginPath(); c.arc(cx,p.y+p.h/2,24,0,7); c.stroke(); }
      c.restore();
      // hp hearts above
      c.fillStyle='rgba(0,0,0,0.45)'; this.rr(c,p.x-6,p.y-24,40,14,7); c.fill();
      for(let i=0;i<p.maxhp;i++){ c.fillStyle=i<p.hp?'#FF6B6B':'#3a3a52'; c.font='11px sans-serif'; c.fillText('♥',p.x-2+i*13,p.y-13); }
    },
    drawParts(c){
      for(const q of this.parts){ c.globalAlpha=Math.min(1,q.t*2); c.fillStyle=q.color; c.fillRect(q.x,q.y,q.sz,q.sz); }
      c.globalAlpha=1;
      c.font='bold 13px Nunito,sans-serif'; c.textAlign='center';
      for(const f of this.floaters){ c.globalAlpha=Math.min(1,f.t); c.fillStyle='#000'; c.fillText(f.text,f.x+1,f.y+1); c.fillStyle=f.color; c.fillText(f.text,f.x,f.y); }
      c.globalAlpha=1; c.textAlign='left';
    },
    drawWeather(c){
      if(this.settings.reducedMotion) return;
      const kinds={petals:'#ffb7d5',drips:'#5DA6FF',sand:'#e8b34d',snow:'#fff',fireflies:'#FFE95c',bubbles:'#5DF2C8',rain:'#7fb2dd',embers:'#FF8A3D',ash:'#8a8ab8',stardust:'#FFE9A8'};
      c.fillStyle=kinds[this.level.theme.weather]||'#fff';
      for(const w of this.weather){ c.globalAlpha=0.5; if(w.kind==='rain'){ c.fillRect(w.x,w.y,2,12); } else if(w.kind==='snow'||w.kind==='stardust'){ c.beginPath(); c.arc(w.x,w.y,w.s,0,7); c.fill(); } else { c.beginPath(); c.arc(w.x,w.y,w.s*0.8,0,7); c.fill(); } }
      c.globalAlpha=1;
    }
  };
  global.SP_Engine=Game;
})(window);
