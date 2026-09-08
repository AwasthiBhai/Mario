/* STARBOUND — UI: navigation, menus, HUD, level select, settings, reviews, overlays.
   NOTE: show('game') <-> openMenu() must NEVER call each other recursively
   (that cycle caused a stack overflow that made PLAY do nothing). */
(function(global){
  'use strict';
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const UI={
    view:'home', currentLevel:1, carryScore:0, paused:false, inGame:false, completeRes:null,
    suspended:false, reviewRating:0,
    init(){
      try{ if(global.SP_Theme&&SP_Theme.init) SP_Theme.init(); }catch(e){}
      this.bindNav(); this.bindActions(); this.bindSettings(); this.bindReviews(); this.bindTheme(); this._bindConfirm();
      this.renderWorldsHome(); this.renderLevelSelect(); this.refreshHero(); this.applySettingsToDom(); this.renderReviews(); this.renderShop();
      window.addEventListener('resize',()=>this.fitTouch());
      window.addEventListener('orientationchange',()=>{ this.fitTouch(); if(global.SP_Engine&&SP_Engine.fitCanvas) SP_Engine.fitCanvas(); });
      document.addEventListener('fullscreenchange',()=>{ this.fitTouch(); if(global.SP_Engine&&SP_Engine.fitCanvas) SP_Engine.fitCanvas(); });
      // First-touch fallback: hybrid touch laptops may report a fine pointer with
      // zero touch points until the first tap. Respect an explicit user opt-out.
      window.addEventListener('touchstart',()=>{ if(!this._hadTouch){ this._hadTouch=true; this.fitTouch(); this._syncTouchChecks(); } },{passive:true});
      this.fitTouch();
      this.fitControlsCard();
      // Re-evaluate if the device environment changes (mouse plugged in/out,
      // devtools emulation toggled, hybrid docked/undocked, etc.).
      try{
        ['(pointer:fine)','(hover:hover)'].forEach(q=>{
          const m=window.matchMedia&&window.matchMedia(q);
          if(m&&m.addEventListener) m.addEventListener('change',()=>this.fitControlsCard());
        });
      }catch(e){}
      $('#qMusic').addEventListener('input',e=>{ SP_Save.data.settings.music=+e.target.value; SP_Save.write(); SP_Audio.setVolumes(SP_Save.data.settings); });
      $('#qSfx').addEventListener('input',e=>{ SP_Save.data.settings.sfx=+e.target.value; SP_Save.write(); SP_Audio.setVolumes(SP_Save.data.settings); });
      $('#qTouch').addEventListener('change',e=>{ const v=e.target.checked, s=SP_Save.data.settings; s.touch=v; s.touchOff=!v; SP_Save.write(); this._syncTouchChecks(); this.fitTouch(); });
      $('#qMotion').addEventListener('change',e=>{ SP_Save.data.settings.reducedMotion=e.target.checked; SP_Save.write(); SP_Engine.settings.reducedMotion=e.target.checked; });
      $('#btnPauseTop').addEventListener('click',()=>this.togglePause());
      const pauseHud=$('#btnPauseHud'); if(pauseHud) pauseHud.addEventListener('click',()=>this.togglePause());
      $('#btnMuteGame').addEventListener('click',e=>{ const s=SP_Save.data.settings; s.muted=!s.muted; SP_Save.write(); SP_Audio.setVolumes(s); e.target.textContent=s.muted?'🔇':'🔊'; $('#hdrMute').textContent=s.muted?'🔇':'🔊'; });
      $('#hdrMute').addEventListener('click',e=>{ const s=SP_Save.data.settings; s.muted=!s.muted; SP_Save.write(); SP_Audio.setVolumes(s); e.target.textContent=s.muted?'🔇':'🔊'; $('#btnMuteGame').textContent=s.muted?'🔇':'🔊'; });
      $('#btnFull').addEventListener('click',()=>this.fullscreen());
      $('#hdrMenuBtn').addEventListener('click',()=>this.toggleMobileNav());
      const chip=$('#rotateChip');
      if(chip) chip.addEventListener('click',()=>{ this._chipHide=true; this.updateRotateChip(); });
      // close mobile nav on outside tap
      document.addEventListener('pointerdown',e=>{
        const mn=$('#mobileNav');
        if(mn&&!mn.classList.contains('hidden')&&!mn.contains(e.target)&&!(e.target.closest&&e.target.closest('#hdrMenuBtn'))) this.toggleMobileNav(false);
      });
      document.addEventListener('pointerdown',()=>SP_Audio.resume(),{once:true});
      // small screens start with side panels collapsed (game first); user can expand
      if(window.matchMedia&&window.matchMedia('(max-width: 768px)').matches){ $$('.game-side details').forEach(d=>{ d.open=false; }); }
    },
    bindTheme(){
      // Header / mobile icon toggles flip Light <-> Dark.
      $$('[data-theme-toggle]').forEach(b=>{
        if(b._themeBound) return; b._themeBound=true;
        b.addEventListener('click',e=>{
          e.preventDefault(); e.stopPropagation();
          try{ SP_Audio.init(SP_Save.data.settings); SP_Audio.resume(); }catch(err){}
          try{ SP_Theme.toggle(); }catch(err){}
          try{
            var manual=SP_Theme.get();
            if(global.localStorage) global.localStorage.setItem(SP_Theme.KEY,manual);
          }catch(err){}
        });
      });
      // Settings segmented control sets an explicit choice (persisted).
      $$('[data-theme-option]').forEach(b=>{
        if(b._themeBound) return; b._themeBound=true;
        b.addEventListener('click',()=>{
          try{ SP_Audio.init(SP_Save.data.settings); SP_Audio.resume(); }catch(err){}
          try{ SP_Theme.set(b.getAttribute('data-theme-option')); }catch(err){}
        });
      });
      try{ if(global.SP_Theme&&SP_Theme.syncControls) SP_Theme.syncControls(); }catch(e){}
    },
    onKeyDown(code){
      if(this._confirmOpen) return; // modal owns Escape; never toggle pause under it
      if(code==='Escape'||code==='KeyP'){
        if(this.isMobileNavOpen()){ this.toggleMobileNav(false); return; }
        this.togglePause();
      }
    },
    bindNav(){
      $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>{ SP_Audio.init(SP_Save.data.settings); SP_Audio.resume(); SP_Audio.sfx('click'); this.show(b.getAttribute('data-nav')); }));
    },
    bindActions(){
      $$('[data-action]').forEach(b=>b.addEventListener('click',()=>this.action(b.getAttribute('data-action'))));
    },
    _allOverlaysHidden(){
      return ['#menuOverlay','#pauseOverlay','#completeOverlay','#overOverlay','#endingOverlay']
        .every(s=>{ const el=$(s); return !el||el.classList.contains('hidden'); });
    },
    _endOverlayVisible(){
      return ['#completeOverlay','#overOverlay','#endingOverlay','#menuOverlay']
        .some(s=>{ const el=$(s); return el&&!el.classList.contains('hidden'); });
    },
    toggleMobileNav(force){
      const mn=$('#mobileNav'); if(!mn) return;
      const want=typeof force==='boolean'?force:mn.classList.contains('hidden');
      clearTimeout(this._navT);
      if(want){ mn.classList.remove('hidden'); requestAnimationFrame(()=>requestAnimationFrame(()=>mn.classList.add('open'))); }
      else { mn.classList.remove('open'); this._navT=setTimeout(()=>mn.classList.add('hidden'),230); }
    },
    isMobileNavOpen(){ const mn=$('#mobileNav'); return !!(mn&&!mn.classList.contains('hidden')); },
    show(view){
      this.view=view;
      // gameplay scroll-lock gate: set ONLY while the game view is active,
      // so every menu/page keeps normal scrolling (see body.playing CSS).
      document.body.classList.toggle('playing',view==='game');
      $$('.view').forEach(v=>v.classList.remove('active'));
      const el=$('#view-'+view); if(el) el.classList.add('active');
      $$('.site-nav .nav-link').forEach(n=>n.classList.toggle('active',n.getAttribute('data-nav')===view));
      this.toggleMobileNav(false);
      window.scrollTo({top:0});
      if(view==='levels') this.renderLevelSelect();
      if(view==='home') this.refreshHero();
      if(view==='reviews') this.renderReviews();
      if(view==='game'){
        if(!this.inGame){
          // first visit: land on the in-canvas main menu (NO recursion: _menuOverlay never calls show)
          this.inGame=true; this.hideOverlays(); this._menuOverlay();
        } else if(this.suspended&&this.paused&&this._allOverlaysHidden()){
          this.showPauseShop(false);
          $('#pauseOverlay').classList.remove('hidden');
        }
        this.suspended=false;
      } else {
        // leaving gameplay for any website screen: freeze gameplay, silence music
        if(this.inGame&&global.SP_Engine&&SP_Engine.running&&SP_Engine.level&&!this._endOverlayVisible()&&!this.paused){
          SP_Engine.setPaused(true); this.paused=true; this.suspended=true;
        }
        // Fullscreen shows ONLY the game wrapper: without exiting, the target
        // page (Settings, Levels, …) would sit underneath it, unreachable and
        // looking frozen on mobile. Exit so the page is visible + touchable.
        if(document.fullscreenElement){
          try{ const ex=document.exitFullscreen(); if(ex&&ex.catch) ex.catch(()=>{}); }catch(e){}
        }
        if(!global.SP_Intro||SP_Intro.done) SP_Audio.setState('website');
      }
      // viewport just became visible/chrome changed: refit crisp canvas + touch/hints
      if(view==='game'&&global.SP_Engine&&SP_Engine.fitCanvas) SP_Engine.fitCanvas();
      // mobile portrait: game first — keep secondary accordions collapsed by default
      if(view==='game'&&window.matchMedia){
        try{
          if(window.matchMedia('(max-width: 600px) and (orientation: portrait)').matches){
            $$('.game-side details[open]').forEach(d=>{ d.open=false; });
          }
        }catch(e){}
      }
      this.fitTouch();
    },
    action(a){
      SP_Audio.init(SP_Save.data.settings); SP_Audio.resume(); SP_Audio.sfx('click');
      if(a==='play'){ this.startLevel(this.highestPlayable()); }
      if(a==='continue'){
        if(SP_Save.completedCount()===0&&SP_Save.data.maxUnlocked<=1) this.toast('No saved adventure yet — starting Level 1!');
        this.startLevel(this.highestPlayable());
      }
      if(a==='newgame'){ this.confirmDialog({title:'Start a new game?',message:'Progress resets (settings are kept).',okText:'Start over'}).then(ok=>{ if(!ok) return; const keepSet=SP_Save.data.settings, keepIntro=SP_Save.data.introSeen; SP_Save.reset(); SP_Save.data.settings=keepSet; SP_Save.data.introSeen=keepIntro; SP_Save.write(); this.carryScore=0; this.renderLevelSelect(); this.refreshHero(); this.startLevel(1); }); }
      if(a==='resume'){ this.togglePause(false); }
      if(a==='restart'){ this.hideOverlays(); SP_Engine.setPaused(false); this.paused=false; this.suspended=false; SP_Audio.setState('resumed'); this.startLevel(this.currentLevel,true); }
      if(a==='powershop'){ this.showPauseShop(true); }
      if(a==='pauseback'){ this.showPauseShop(false); }
      if(a==='next'){ const n=Math.min(50,this.currentLevel+1); if(!SP_Save.isUnlocked(n)){ this.openMenu(); return; } this.hideOverlays(); this.startLevel(n); }
      if(a==='tomenu'){ this.hideOverlays(); this.inGame=true; this.suspended=false; this._menuOverlay(); }
      if(a==='credits'){ $('#endingOverlay').classList.add('hidden'); this.show('credits'); }
    },
    highestPlayable(){
      const d=SP_Save.data; let n=d.maxUnlocked;
      for(let i=1;i<=50;i++){ if(!d.levels[String(i)]||!d.levels[String(i)].done){ n=i; break; } n=50; }
      return Math.min(50,Math.max(1,n));
    },
    _menuOverlay(){
      $('#menuOverlay').classList.remove('hidden');
      SP_Engine.setPaused(true); this.paused=true;
      SP_Audio.setState('website'); // menus are silent
    },
    openMenu(){
      // NOT recursive: flag first, then plain view switch (show() sees inGame===true and stops)
      this.inGame=true; this.suspended=false;
      this.show('game'); this.hideOverlays(); this._menuOverlay();
    },
    hideOverlays(){ ['#menuOverlay','#pauseOverlay','#completeOverlay','#overOverlay','#endingOverlay'].forEach(s=>{ const el=$(s); if(el) el.classList.add('hidden'); }); this.showPauseShop(false); },
    /* Pause menu sub-screens: main options <-> Power-Ups shop, both inside the
       in-canvas overlay so fullscreen is never disturbed. Game stays paused. */
    showPauseShop(open){
      const m=$('#pauseMain'), s=$('#pauseShop');
      if(m) m.classList.toggle('hidden',!!open);
      if(s) s.classList.toggle('hidden',!open);
      if(open) this.updateShopBalances(true);
    },
    /* In-game notification center (replaces browser alert()): non-blocking,
       queued (max 3, oldest dropped), auto-dismissing. Renders into BOTH the
       page toast and the in-canvas toast so messages stay visible in game
       fullscreen (page-level fixed elements are hidden under fullscreen). */
    notify(msg,type){
      this._toastQ=this._toastQ||[];
      this._toastQ.push({msg:String(msg),type:type||'info'});
      while(this._toastQ.length>3) this._toastQ.shift();
      if(!this._toastBusy) this._nextToast();
    },
    _nextToast(){
      const nx=(this._toastQ||[]).shift();
      if(!nx){ this._toastBusy=false; return; }
      this._toastBusy=true;
      const icons={success:'★',info:'✦',warning:'⚠',error:'✖'};
      const text=(icons[nx.type]||icons.info)+'  '+nx.msg;
      const cls='t-'+(icons[nx.type]?nx.type:'info');
      const els=[$('#toast'),$('#gameToast')].filter(Boolean);
      if(!els.length){ this._toastBusy=false; return; }
      els.forEach(el=>{
        el.textContent=text; // textContent: never interpret message HTML
        el.classList.remove('show','t-success','t-info','t-warning','t-error');
        void el.offsetWidth; // restart the slide/fade transition
        el.classList.add('show',cls);
      });
      clearTimeout(this._toastT);
      this._toastT=setTimeout(()=>{
        els.forEach(el=>el.classList.remove('show'));
        clearTimeout(this._toastT);
        this._toastT=setTimeout(()=>this._nextToast(),280);
      },2600);
    },
    toast(msg){ this.notify(msg,'info'); }, // back-compat alias for older callers
    /* Blocking-style confirm dialog (replaces confirm()): explicit buttons
       only — no timeouts, no Enter shortcut, Escape/backdrop = cancel, and the
       game state is never touched by the dialog itself. Resolves true only on
       an explicit Confirm click. The single node is moved into #canvasWrap
       while the game itself is fullscreened so it stays visible. */
    confirmDialog(opts){
      opts=opts||{};
      const modal=$('#confirmModal');
      const title=$('#confirmTitle'), msg=$('#confirmMsg');
      const okBtn=$('#confirmOk'), cancelBtn=$('#confirmCancel');
      if(!modal||!title||!msg||!okBtn||!cancelBtn) return Promise.resolve(false);
      if(this._confirmResolve) this._finishConfirm(false); // never stack: prior request cancels
      title.textContent=opts.title||'Are you sure?';
      msg.textContent=opts.message||'';
      okBtn.textContent=opts.okText||'Confirm';
      cancelBtn.textContent=opts.cancelText||'Cancel';
      try{
        const wrap=document.getElementById('canvasWrap');
        const fs=document.fullscreenElement;
        const host=(fs&&wrap&&(fs===wrap||(wrap.contains&&wrap.contains(fs))))?wrap:document.body;
        if(host&&modal.parentNode!==host) host.appendChild(modal);
      }catch(e){}
      this._confirmOpen=true;
      modal.classList.remove('hidden');
      try{ cancelBtn.focus(); }catch(e){} // safe default: keyboard lands on Cancel
      return new Promise(resolve=>{ this._confirmResolve=resolve; });
    },
    _finishConfirm(val){
      const modal=$('#confirmModal');
      this._confirmOpen=false;
      const r=this._confirmResolve; this._confirmResolve=null;
      try{ if(modal) modal.classList.add('hidden'); }catch(e){}
      if(r) r(!!val);
    },
    _bindConfirm(){
      if(this._confirmBound) return; this._confirmBound=true;
      const modal=$('#confirmModal'); if(!modal) return;
      const okBtn=$('#confirmOk'), cancelBtn=$('#confirmCancel');
      if(okBtn) okBtn.addEventListener('click',()=>this._finishConfirm(true));
      if(cancelBtn) cancelBtn.addEventListener('click',()=>this._finishConfirm(false));
      modal.addEventListener('click',e=>{ if(e.target===modal) this._finishConfirm(false); });
      // capture-phase: runs before gameplay input so Escape cancels instead of pausing
      this._confirmKeyH=e=>{ if(e&&(e.code==='Escape'||e.code==='Esc')&&this._confirmOpen){ try{e.preventDefault(); e.stopPropagation();}catch(err){} this._finishConfirm(false); } };
      document.addEventListener('keydown',this._confirmKeyH,true);
    },
    /* Touch capable? coarse pointer OR multi-touch points OR legacy touch event
       OR an observed first touch (hybrid laptops). Desktop keyboard/mouse: false. */
    isTouchDevice(){
      try{ if(window.matchMedia&&window.matchMedia('(pointer:coarse)').matches) return true; }catch(e){}
      try{ if(navigator&&(navigator.maxTouchPoints>0||navigator.msMaxTouchPoints>0)) return true; }catch(e){}
      try{ if('ontouchstart' in window) return true; }catch(e){}
      if(this._hadTouch) return true;
      return false;
    },
    /* Effective preference ignoring the in-game view gate (drives the checkboxes):
       forced ON wins, explicit OFF hides, otherwise auto = ON for touch devices. */
    touchPrefOn(){
      const s=SP_Save.data.settings;
      if(s.touch) return true;
      if(s.touchOff) return false;
      return this.isTouchDevice();
    },
    _syncTouchChecks(){
      const v=this.touchPrefOn();
      const a=$('#qTouch'), b=$('#setTouch');
      if(a) a.checked=v;
      if(b) b.checked=v;
    },
    /* Desktop-only Controls card: key remapping needs a physical keyboard, so
       the section shows only where a precise pointer exists (fine pointer OR
       hover-capable). Touch-only phones/tablets hide it; hybrid laptops
       (fine + hover + touch) stay visible since the keyboard is present.
       Toggling .hidden (display:none) leaves no gap. */
    fitControlsCard(){
      const card=document.getElementById('controlsCard'); if(!card) return;
      let fine=false, hover=false, touch=false;
      try{ fine=!!(window.matchMedia&&window.matchMedia('(pointer:fine)').matches); }catch(e){}
      try{ hover=!!(window.matchMedia&&window.matchMedia('(hover:hover)').matches); }catch(e){}
      try{ touch=!!((navigator&&(navigator.maxTouchPoints>0||navigator.msMaxTouchPoints>0))||('ontouchstart' in window)); }catch(e){}
      const show=(fine||hover)&&!(touch&&!fine&&!hover);
      card.classList.toggle('hidden',!show);
    },
    fitTouch(){
      const s=SP_Save.data.settings;
      // Forced ON = always show. Explicit OFF = always hide. Otherwise auto:
      // touch-capable device AND game view active. Desktop stays untouched.
      const on=!!(s.touch||(!s.touchOff&&this.isTouchDevice()&&this.view==='game'));
      document.body.classList.toggle('show-touch',on);
      const hk=$('#hintKbd'), ht=$('#hintTouch');
      if(hk) hk.classList.toggle('hidden',on);
      if(ht) ht.classList.toggle('hidden',!on);
      this.updateRotateChip();
    },
    updateRotateChip(){
      const chip=$('#rotateChip'); if(!chip) return;
      const portrait=window.innerHeight>=window.innerWidth;
      if(!portrait) this._chipHide=false; // re-arm when rotated back
      const touchCapable=this.isTouchDevice();
      const show=!!(touchCapable&&portrait&&this.view==='game'&&this.inGame&&!this._chipHide);
      chip.classList.toggle('hidden',!show);
    },
    /* Fullscreen target depends on context (freeze fix): the game view keeps the
       game wrapper (existing behavior); any other view (e.g. Settings) uses the
       document, otherwise the browser would paint the hidden game layer over
       the page and it would look frozen and uninteractable. */
    fullscreen(){
      const wrap=this.view==='game'?document.getElementById('canvasWrap'):null;
      const el=(wrap&&wrap.requestFullscreen)?wrap:document.documentElement;
      try{ if(!document.fullscreenElement){ const p=el.requestFullscreen(); if(p&&p.catch) p.catch(()=>{}); } else document.exitFullscreen(); }catch(e){}
    },
    /* ----- game flow ----- */
    startLevel(n,keepScore){
      n=Math.max(1,Math.min(50,n));
      if(!SP_Save.isUnlocked(n)){ this.notify('Level '+n+' is locked. Clear Level '+(n-1)+' first!','warning'); return; }
      this.currentLevel=n; this.inGame=true; this.paused=false; this.suspended=false; this.completeRes=null;
      this.show('game'); this.hideOverlays();
      if(!keepScore) this.carryScore=0;
      // Build FIRST: everything gameplay needs is ready before the reveal,
      // held paused so the par timer can't tick behind the loader.
      SP_Engine.loadLevel(n); SP_Engine.start(); SP_Engine.setPaused(true);
      const L=SP_Engine.level;
      $('#gameTitleLabel').textContent='World '+(L.world+1)+' · Level '+n+' — '+L.worldName+(L.isBoss?' · BOSS':'');
      $('#levelInfo').innerHTML='<strong>'+L.name+'</strong><br>'+L.tip+'<br>⏱ par '+L.timeLimit+'s · 🪙 '+L.coins.length+' shards · ★ 1 relic'+(L.isBoss?'<br>☠ BOSS: '+L.boss.name+' ('+L.boss.hp+' HP)':'');
      const nx=n<50?SP_Levels.levelName(n+1):'— you finished! —';
      $('#upNext').textContent=n<50?nx:'Final level complete!';
      this.renderShop(); // fresh per-level coins + cleared effects
      const tips=['Run to jump farther.','Stomp = bounce high. Hold jump!','Bump suspicious walls — secrets hide.','Starbolts beat Shellyhorns.','Checkpoints save you. Touch them!','Relics are worth 500 + bragging rights.','Falling platforms respawn. Keep calm.','Bosses telegraph hops — bait, dodge, stomp.'];
      $('#loaderTip').textContent='Tip: '+tips[n%tips.length];
      $('#loader').classList.remove('hidden');
      // Smooth deterministic loader (~2.6s): time-based eased progress, so it
      // feels identical on every device instead of coarse timer ticks bunching
      // behind main-thread work (fonts/canvases/audio) on mobile hardware.
      $('#loaderFill').style.width='0%';
      const DUR=2600, t0=performance.now();
      const token=(this._loadToken=(this._loadToken||0)+1);
      cancelAnimationFrame(this._loadRaf);
      const step=(now)=>{
        if(token!==this._loadToken) return; // superseded by a newer startLevel
        const k=Math.min(1,(now-t0)/DUR);
        const eased=1-Math.pow(1-k,3);
        $('#loaderFill').style.width=(eased*100).toFixed(1)+'%';
        if(k<1){ this._loadRaf=requestAnimationFrame(step); return; }
        $('#loader').classList.add('hidden');
        SP_Engine.setPaused(this.paused); // stays paused if the user paused mid-load
        if(!this.paused) SP_Audio.setState('level',{world:L.world}); // level music fades in
      };
      this._loadRaf=requestAnimationFrame(step);
    },
    togglePause(force){
      if(!this.inGame||!SP_Engine.running) return;
      if(!$('#completeOverlay').classList.contains('hidden')||!$('#overOverlay').classList.contains('hidden')||!$('#endingOverlay').classList.contains('hidden')) return;
      if(!$('#menuOverlay').classList.contains('hidden')) return;
      const want=(typeof force==='boolean')?(force):(!this.paused);
      this.paused=want;
      SP_Engine.setPaused(this.paused);
      if(this.paused){ this.showPauseShop(false); this.updateShopBalances(true); } // pause menu always opens on main options
      $('#pauseOverlay').classList.toggle('hidden',!this.paused);
      SP_Audio.setState(this.paused?'paused':'resumed'); // duck / unduck level music
      SP_Audio.sfx('click');
    },
    onBossMode(on){
      if(!this.inGame||this.paused) return;
      if(this._endOverlayVisible()) return;
      if(on) SP_Audio.setState('boss');
      else if(SP_Engine.level) SP_Audio.setState('level',{world:SP_Engine.level.world});
    },
    onHud(h){
      $('#hudScore').textContent=h.score; $('#hudCoins').textContent=h.coins+'/'+h.total;
      $('#hudLives').textContent=h.lives+' ('+h.hp+'♥)'; $('#hudTime').textContent=this.fmtTime(h.time);
      $('#hudLevel').textContent=h.world+'-'+(((h.level-1)%5)+1)+' · Lv'+h.level;
      this.updateShopBalances(); // cheap: cached signature, DOM only on change
    },
    fmtTime(s){ s=Math.max(0,Math.ceil(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); },
    onComplete(res){
      const n=this.currentLevel;
      const rec=SP_Save.recordLevel(n,{score:res.score,coins:res.coins,totalCoins:res.totalCoins,relic:res.relic,time:res.time});
      this.renderLevelSelect(); this.refreshHero();
      $('#completeStats').innerHTML='<div>⭐ Score<b>'+res.score+'</b></div><div>🪙 Collected<b>'+res.coins+'/'+res.totalCoins+'</b></div><div>🛒 Spent<b>'+(res.spent||0)+' (left '+(res.remaining||0)+')</b></div><div>★ Relic<b>'+(res.relic?'FOUND':'missed')+'</b></div><div>🕵 Secrets<b>'+res.secrets+'</b></div><div>⏱ Time<b>'+this.fmtTime(res.time)+'</b></div><div>❤ Lives left<b>'+res.lives+'</b></div>';
      $('#newBest').classList.toggle('hidden',!rec.isBest);
      SP_Audio.setState('complete'); // music fades out + completion jingle, then silence
      if(n>=50){ this.showEnding(res); return; }
      $('#completeOverlay').classList.remove('hidden');
      SP_Engine.setPaused(true); this.paused=true;
    },
    onGameOver(res){
      $('#overOverlay').classList.remove('hidden');
      SP_Engine.setPaused(true); this.paused=true;
      SP_Audio.setState('gameover'); // short cue, then silence
    },
    showEnding(res){
      SP_Audio.setState('ending');
      SP_Save.recalcTotals(); const d=SP_Save.data;
      $('#endingText').textContent='Pip raises the last lantern.\nThe Voidstar cracks like burnt sugar — and dawn pours back into all ten worlds.\n\nEvery beacon you lit is a star someone wished on. Thank you for playing.';
      $('#endingStats').innerHTML='<div>⭐ Total best<b>'+d.totalScore+'</b></div><div>🪙 Shards banked<b>'+d.totalCoins+'</b></div><div>★ Relics<b>'+d.totalRelics+'/50</b></div><div>🏁 Levels<b>'+SP_Save.completedCount()+'/50</b></div>';
      $('#endingOverlay').classList.remove('hidden');
      SP_Engine.setPaused(true); this.paused=true;
    },
    /* ----- renders ----- */
    renderWorldsHome(){
      const g=$('#worldGridHome'); g.innerHTML='';
      SP_Levels.WORLDS.forEach((w,i)=>{
        const b=document.createElement('button'); b.className='world-card';
        b.style.background='linear-gradient(135deg,'+w.sky[0]+','+w.sky[1]+')';
        b.innerHTML='<strong>'+w.icon+' '+(i+1)+'. '+w.name+'</strong><small>Levels '+(i*5+1)+'–'+(i*5+5)+' · boss inside</small>';
        b.addEventListener('click',()=>{ this.show('levels'); });
        g.appendChild(b);
      });
    },
    renderLevelSelect(){
      const wrap=$('#levelWorlds'); wrap.innerHTML='';
      const d=SP_Save.data;
      SP_Levels.WORLDS.forEach((w,wi)=>{
        const block=document.createElement('div'); block.className='world-block';
        const doneCount=[1,2,3,4,5].filter(k=>{const L=d.levels[String(wi*5+k)];return L&&L.done;}).length;
        block.innerHTML='<div class="world-head"><div class="world-dot" style="background:linear-gradient(135deg,'+w.sky[0]+','+w.sky[2]+')">'+w.icon+'</div><div><h3>World '+(wi+1)+' — '+w.name+'</h3><small>'+doneCount+'/5 cleared</small></div></div>';
        const row=document.createElement('div'); row.className='level-row';
        for(let k=1;k<=5;k++){
          const n=wi*5+k, rec=d.levels[String(n)], locked=!SP_Save.isUnlocked(n), isBoss=(k===5);
          const b=document.createElement('button'); b.className='level-card'+(isBoss?' boss':'')+(rec&&rec.done?' done':'');
          b.disabled=locked;
          b.innerHTML='<div class="lv">'+(locked?'🔒':(rec&&rec.done?'✅':'▶'))+' Level '+n+(isBoss?' ☠':'')+(rec&&rec.relic?' ★':'')+'</div><div class="meta">'+(locked?'Clear Level '+(n-1)+' to unlock':(rec&&rec.done?('best '+rec.bestScore+' · '+this.fmtTime(rec.bestTime)+' · 🪙'+rec.coins+'/'+rec.totalCoins):'unplayed · tap to play'))+'</div>';
          if(!locked) b.addEventListener('click',()=>{ this.startLevel(n); });
          row.appendChild(b);
        }
        block.appendChild(row); wrap.appendChild(block);
      });
    },
    refreshHero(){
      SP_Save.recalcTotals(); const d=SP_Save.data;
      $('#statProgress').textContent=SP_Save.completedCount()+'/50';
      $('#statCoins').textContent=d.totalCoins;
      $('#statRelics').textContent=d.totalRelics+'/50';
    },
    /* ----- power-up shop (per-level coins, runtime only) ----- */
    renderShop(){
      const E=global.SP_Engine;
      const catalog=(E&&E.SHOP)||[];
      ['#shopPauseGrid'].forEach(sel=>{ // single in-game shop lives in the pause menu (fullscreen-safe)
        const g=$(sel); if(!g) return;
        g.innerHTML='';
        catalog.forEach(item=>{
          const card=document.createElement('div'); card.className='shop-card'; card.setAttribute('data-shop',item.id);
          const ico=document.createElement('div'); ico.className='shop-ico'; ico.textContent=item.icon;
          const nm=document.createElement('div'); nm.className='shop-name'; nm.textContent=item.name;
          const ds=document.createElement('div'); ds.className='shop-desc'; ds.textContent=item.desc;
          const pr=document.createElement('div'); pr.className='shop-price'; pr.textContent=item.price+' 🪙';
          const btn=document.createElement('button'); btn.className='btn btn-gold btn-sm shop-buy'; btn.type='button';
          btn.setAttribute('aria-label','Buy '+item.name+' for '+item.price+' coins');
          btn.textContent='BUY';
          btn.addEventListener('click',()=>this.buyShop(item.id));
          card.appendChild(ico); card.appendChild(nm); card.appendChild(ds); card.appendChild(pr); card.appendChild(btn);
          g.appendChild(card);
        });
      });
      this._shopCache=null;
      this.updateShopBalances(true);
    },
    updateShopBalances(force){
      const E=global.SP_Engine;
      if(!E||!E.SHOP) return;
      const coins=E.levelCoins||0;
      const shieldOn=!!(E.player&&E.player.shield);
      const sig=coins+'|'+E.lives+'|'+(shieldOn?1:0);
      if(!force&&sig===this._shopCache) return; // onHud ticks every frame: no DOM churn
      const prevCoins=this._shopCache?parseInt(String(this._shopCache).split('|')[0],10)||0:coins;
      this._shopCache=sig;
      const s2=$('#shopCoinsPause');
      if(s2) s2.textContent=String(coins);
      Array.from(document.querySelectorAll('.shop-card')).forEach(card=>{
        const id=card.getAttribute('data-shop');
        const item=E.SHOP.find(i=>i.id===id); if(!item) return;
        const btn=card.querySelector('button'); if(!btn) return;
        let owned=false;
        if(id==='shield'&&shieldOn) owned=true;
        if(id==='life'&&E.lives>=5) owned=true;
        const afford=coins>=item.price;
        btn.disabled=!afford||owned;
        btn.textContent=owned?'ACTIVE ✓':('BUY · '+item.price+' 🪙');
        card.classList.toggle('owned',owned);
      });
      if(prevCoins>coins){ // a purchase just landed: lightweight bump, no layout shift
        Array.from(document.querySelectorAll('.shop-balance')).forEach(b=>{
          b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
        });
      }
    },
    buyShop(id){
      try{ SP_Audio.init(SP_Save.data.settings); SP_Audio.resume(); }catch(e){}
      const res=SP_Engine.buyPower(id);
      if(res.ok){ this.toast('★ '+res.msg+' ('+res.remaining+' 🪙 left)'); }
      else { this.toast(res.msg); try{ SP_Audio.sfx('hurt'); }catch(e){} }
      this.updateShopBalances(true);
    },
    /* ----- reviews (GLOBAL shared database) ----- */
    bindReviews(){
      const stars=Array.from(document.querySelectorAll('#starPick button'));
      stars.forEach(btn=>btn.addEventListener('click',()=>{
        this.reviewRating=parseInt(btn.getAttribute('data-v'),10)||0;
        stars.forEach(b=>b.classList.toggle('lit',(parseInt(b.getAttribute('data-v'),10)||0)<=this.reviewRating));
        const err=$('#revErrors'); if(err) err.textContent='';
      }));
      const form=$('#revForm');
      if(form) form.addEventListener('submit',e=>{
        e.preventDefault();
        const btn=form.querySelector('button[type="submit"]');
        const name=$('#revName').value, text=$('#revText').value;
        const err=$('#revErrors'), ok=$('#revOk');
        if(err) err.textContent=''; if(ok) ok.textContent='';
        const v=SP_Reviews.validate(name,this.reviewRating,text);
        if(!v.ok){ if(err) err.textContent=v.errors.join(' '); SP_Audio.sfx('hurt'); return; }
        // Only show success AFTER the shared backend confirms the write.
        if(btn){ btn.disabled=true; btn.textContent='Submitting…'; }
        SP_Reviews.submit(name,this.reviewRating,text).then(res=>{
          if(btn){ btn.disabled=false; btn.textContent='Submit review'; }
          if(!res.ok){ if(err) err.textContent=res.errors; SP_Audio.sfx('hurt'); return; }
          $('#revName').value=''; $('#revText').value=''; this.reviewRating=0;
          stars.forEach(b=>b.classList.remove('lit'));
          if(ok) ok.textContent='★ Review shared with players everywhere! ★';
          SP_Audio.sfx('goal');
          this.renderReviews();
        });
      });
      const retry=$('#revRetry');
      if(retry) retry.addEventListener('click',()=>this.renderReviews());
      const list=$('#revList');
      if(list) list.addEventListener('click',e=>{
        const btn=e.target.closest?e.target.closest('[data-del-legacy]'):null;
        if(!btn) return;
        this.confirmDialog({title:'Delete review?',message:'This removes the review stored on this device.',okText:'Delete'}).then(ok=>{ if(!ok) return; SP_Reviews.legacyRemove(btn.getAttribute('data-del-legacy')); this.renderReviews(); });
      });
    },
    _stars(n){
      let s=''; for(let i=1;i<=5;i++) s+=i<=n?'★':'☆'; return s;
    },
    renderReviews(){
      const sum=$('#revSummary'), list=$('#revList'), status=$('#revStatus');
      if(!sum||!list) return;
      if(status){ status.className='rev-status loading'; status.textContent='⟳ Loading global reviews…'; }
      const retry=$('#revRetry'); if(retry) retry.classList.add('hidden');
      sum.innerHTML='<div class="rev-avg"><strong>…</strong><span class="rev-stars">☆☆☆☆☆</span><span class="muted">Loading…</span></div><div class="rev-dist"></div>';
      list.innerHTML='';
      SP_Reviews.load().then(res=>{
        const arr=res.reviews, st=SP_Reviews.statsOf(arr);
        let dist=''; for(let r=5;r>=1;r--){ const c=st.dist[r-1]||0, pct=st.count?Math.round(c/st.count*100):0;
          dist+='<div class="dist-row"><span>'+r+'★</span><div class="dist-bar"><i style="width:'+pct+'%"></i></div><span>'+c+'</span></div>'; }
        sum.innerHTML='';
        const avg=document.createElement('div'); avg.className='rev-avg';
        const big=document.createElement('strong'); big.textContent=st.count?String(st.avg):'—';
        const starSpan=document.createElement('span'); starSpan.className='rev-stars'; starSpan.textContent=st.count?this._stars(Math.round(st.avg)):'☆☆☆☆☆';
        const cnt=document.createElement('span'); cnt.className='muted';
        cnt.textContent=st.count?('Based on '+st.count+' global review'+(st.count>1?'s':'')):'No reviews yet';
        avg.appendChild(big); avg.appendChild(starSpan); avg.appendChild(cnt);
        const distWrap=document.createElement('div'); distWrap.className='rev-dist'; distWrap.innerHTML=dist;
        sum.appendChild(avg); sum.appendChild(distWrap);
        if(status){
          if(!res.ok){ status.className='rev-status error'; status.textContent='⚠ '+res.error; if(retry) retry.classList.remove('hidden'); }
          else if(res.stale){ status.className='rev-status stale'; status.textContent='⚠ '+res.error; if(retry) retry.classList.remove('hidden'); }
          else { status.className='rev-status live'; status.textContent=''; status.classList.add('hidden'); }
        }
        list.innerHTML='';
        if(!arr.length){
          const p=document.createElement('p'); p.className='muted center';
          p.textContent=res.ok?'Be the first to review this game!':'Reviews could not be loaded. Please retry.';
          list.appendChild(p);
        }
        for(const r of arr){
          const card=document.createElement('article'); card.className='card rev-card';
          const head=document.createElement('div'); head.className='rev-head';
          const who=document.createElement('strong'); who.textContent=r.name; // textContent: no HTML injection
          const stars=document.createElement('span'); stars.className='rev-stars'; stars.textContent=this._stars(r.rating);
          const when=document.createElement('span'); when.className='muted'; when.textContent=new Date(r.createdAt).toLocaleDateString();
          head.appendChild(who); head.appendChild(stars); head.appendChild(when);
          const body=document.createElement('p'); body.textContent=r.text;
          card.appendChild(head); card.appendChild(body);
          list.appendChild(card);
        }
        // Legacy device-only reviews (pre-global), clearly labeled, never merged.
        const legacy=SP_Reviews.legacyList();
        if(legacy.length){
          const det=document.createElement('details'); det.className='card rev-legacy';
          const sm=document.createElement('summary');
          sm.textContent='Earlier reviews on this device only ('+legacy.length+', not shared)';
          det.appendChild(sm);
          for(const r of legacy){
            const row=document.createElement('div'); row.className='rev-legacy-row';
            const t=document.createElement('span'); t.textContent=r.name+' · '+this._stars(r.rating)+' · '+r.text;
            const del=document.createElement('button'); del.className='btn btn-ghost btn-sm';
            del.setAttribute('data-del-legacy',r.id); del.textContent='Delete';
            row.appendChild(t); row.appendChild(del); det.appendChild(row);
          }
          list.appendChild(det);
        }
      });
    },
    /* ----- settings ----- */
    applySettingsToDom(){
      const s=SP_Save.data.settings;
      $('#setMaster').value=s.master; $('#setMusic').value=s.music; $('#setSfx').value=s.sfx;
      $('#setMasterV').textContent=s.master; $('#setMusicV').textContent=s.music; $('#setSfxV').textContent=s.sfx;
      $('#setMute').checked=!!s.muted;
      $('#qMusic').value=s.music; $('#qSfx').value=s.sfx; this._syncTouchChecks(); $('#qMotion').checked=!!s.reducedMotion;
      this.renderKeymap();
      SP_Engine.settings.shake=s.shake!==false; SP_Engine.settings.reducedMotion=!!s.reducedMotion;
      document.body.classList.toggle('reduced-motion',!!s.reducedMotion);
    },
    bindSettings(){
      const s=()=>SP_Save.data.settings;
      $('#setMaster').addEventListener('input',e=>{ s().master=+e.target.value; $('#setMasterV').textContent=e.target.value; SP_Save.write(); SP_Audio.setVolumes(s()); });
      $('#setMusic').addEventListener('input',e=>{ s().music=+e.target.value; $('#setMusicV').textContent=e.target.value; SP_Save.write(); SP_Audio.setVolumes(s()); });
      $('#setSfx').addEventListener('input',e=>{ s().sfx=+e.target.value; $('#setSfxV').textContent=e.target.value; SP_Save.write(); SP_Audio.setVolumes(s()); });
      $('#setMute').addEventListener('change',e=>{ s().muted=e.target.checked; SP_Save.write(); SP_Audio.setVolumes(s()); });
      $('#setTouch').addEventListener('change',e=>{ const v=e.target.checked, st=s(); st.touch=v; st.touchOff=!v; SP_Save.write(); this._syncTouchChecks(); this.fitTouch(); });
      $('#btnFullscreen').addEventListener('click',()=>this.fullscreen());
      $('#btnReplayIntro').addEventListener('click',()=>{ SP_Intro.replay(); });
      $('#btnResetSave').addEventListener('click',()=>{ this.confirmDialog({title:'Reset all progress?',message:'Unlocks, scores, coins, relics and settings are wiped.',okText:'Reset everything'}).then(ok=>{ if(!ok) return; SP_Save.reset(); SP_Save.write(); this.carryScore=0; this.applySettingsToDom(); this.renderLevelSelect(); this.refreshHero(); this.renderReviews(); this.notify('Progress wiped. Fresh adventure awaits!','success'); }); });
      $('#btnResetKeys').addEventListener('click',()=>{ s().keys=null; SP_Input.map=Object.assign({},SP_Input.map={left:'KeyA',right:'KeyD',jump:'Space',down:'KeyS',run:'ShiftLeft',action:'KeyE',pause:'Escape',altJump:'KeyW'}); SP_Save.write(); this.renderKeymap(); });
    },
    renderKeymap(){
      const labels={left:'Move left',right:'Move right',jump:'Jump',down:'Crouch',run:'Run',action:'Action',pause:'Pause'};
      const km=$('#keymap'); km.innerHTML='';
      for(const k in labels){
        const row=document.createElement('div');
        row.innerHTML='<span>'+labels[k]+'</span>';
        const btn=document.createElement('button'); btn.textContent=(SP_Input.map[k]||'').replace('Key','');
        btn.addEventListener('click',()=>{
          btn.textContent='press…';
          const h=e=>{ e.preventDefault(); SP_Input.map[k]=e.code; SP_Save.data.settings.keys=Object.assign({},SP_Input.map); SP_Save.write(); this.renderKeymap(); window.removeEventListener('keydown',h,true); };
          window.addEventListener('keydown',h,true);
        });
        row.appendChild(btn); km.appendChild(row);
      }
    }
  };
  global.SP_UI=UI;
})(window);
