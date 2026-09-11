/* PLAYNOVA — RIFTSTRIKE UI: menu tabs, HUD, dashboards, Games hub, progress.
   Skin selection mirrors avatar selection: single-equipped, border+glow+check. */
(function(global){
'use strict';
function $(s){ return document.querySelector(s); }
function $$ (s){ return Array.from(document.querySelectorAll(s)); }
function el(t,c,txt){ var n=document.createElement(t); if(c)n.className=c; if(txt!==undefined&&txt!==null)n.textContent=txt; return n; }
function D(){ return global.RS_Data; }
function SV(){ return global.RS_Save; }
function UI(){ return global.SP_UI; }

var U = {
  tab:'play', wi:0, li:0, inGame:false,
  init:function(){
    var self=this;
    try{ SV().load(); }catch(e){}
    // menu tabs
    $$('#fightMenu [data-ftab]').forEach(function(b){
      b.addEventListener('click', function(){ self.tab=b.getAttribute('data-ftab'); self.renderTab(); });
    });
    ['fightResume','fightPauseTop','fightPauseHud'].forEach(function(id){
      var b=document.getElementById(id); if(b) b.addEventListener('click', function(){ self.togglePause(false); });
    });
    var fr=document.getElementById('fightRestart'); if(fr) fr.addEventListener('click', function(){ self.startLevel(self.wi,self.li); self.togglePause(false); });
    var fq=document.getElementById('fightQuit'); if(fq) fq.addEventListener('click', function(){ self.toMenu(); });
    var rt=document.getElementById('fightRetry'); if(rt) rt.addEventListener('click', function(){ self.respawn(); });
    var om=document.getElementById('fightOverMenu'); if(om) om.addEventListener('click', function(){ self.toMenu(); });
    var nx=document.getElementById('fightNext'); if(nx) nx.addEventListener('click', function(){ self.next(); });
    var rp=document.getElementById('fightReplay'); if(rp) rp.addEventListener('click', function(){ self.startLevel(self.wi,self.li); });
    var wm=document.getElementById('fightWinMenu'); if(wm) wm.addEventListener('click', function(){ self.toMenu(); });
    var mf=document.getElementById('fightMute'); if(mf) mf.addEventListener('click', function(){
      try{ var s=global.SP_Save.data.settings; s.muted=!s.muted; global.SP_Save.write(); if(global.SP_Audio) global.SP_Audio.setVolumes(s); mf.textContent=s.muted?'🔇':'🔊'; }catch(e){}
    });
    var ff=document.getElementById('fightFull'); if(ff) ff.addEventListener('click', function(){
      try{ var w=document.getElementById('fightWrap'); if(!document.fullscreenElement) w.requestFullscreen(); else document.exitFullscreen(); }catch(e){}
    });
    // engine hooks
    try{
      global.RS_Engine.init(document.getElementById('fightGame'), {
        onHud:function(h){ self.onHud(h); },
        onLevel:function(){ self.onHud(global.RS_Engine.hud()); },
        onBoss:function(b){ self.onBoss(b); },
        onBossDown:function(){ self.onHud(global.RS_Engine.hud()); },
        onDeath:function(){ self.onDeath(); },
        onRespawn:function(){ self.hideOverlays(); },
        onWin:function(res){ self.onWin(res); }
      });
    }catch(e){}
    this.renderTab(); this.renderGamesGrid();
  },
  /* ---------- menu ---------- */
  toMenu:function(){
    this.inGame=false;
    try{ global.RS_Engine.setPaused(true); }catch(e){}
    this.hideOverlays();
    $('#fightMenu').classList.remove('hidden');
    this.renderTab(); this.renderSide();
  },
  hideOverlays:function(){ ['#fightMenu','#fightPause','#fightOver','#fightWin'].forEach(function(s){ var n=$(s); if(n) n.classList.add('hidden'); }); },
  togglePause:function(force){
    if(!this.inGame) return;
    var p=$('#fightPause'); if(!p) return;
    var want = typeof force==='boolean' ? force : p.classList.contains('hidden');
    try{ global.RS_Engine.setPaused(want); }catch(e){}
    p.classList.toggle('hidden', !want);
  },
  startLevel:function(wi,li){
    this.wi=wi; this.li=li; this.inGame=true;
    this.hideOverlays();
    try{
      global.RS_Engine.score=0; global.RS_Engine.coinBank=0;
      global.RS_Engine.buildLevel(wi,li);
      global.RS_Engine.start(); global.RS_Engine.setPaused(false);
    }catch(e){}
    var W=D().WORLDS[wi];
    $('#fightTitleLabel').textContent='RIFTSTRIKE · '+W.name+' '+(li+1)+'/3';
    $('#fightInfo').innerHTML='';
    $('#fightInfo').appendChild(el('div','',W.icon+' '+W.name+' — Level '+(li+1)));
    var sp=D().levelSpec(wi,li);
    $('#fightInfo').appendChild(el('div','muted','Foes: '+sp.enemies.length+(sp.elites?' +'+sp.elites+' elite':'')+(sp.bosses.length?' · ☠ '+sp.bosses.map(function(b){return D().bossById(b).name;}).join(' + '):'')+' · hazard: '+sp.hazard));
    this.renderSide();
  },
  respawn:function(){
    $('#fightOver').classList.add('hidden');
    try{ global.RS_Engine.respawn(); global.RS_Engine.setPaused(false); }catch(e){}
  },
  next:function(){
    var here=this.wi*3+this.li;
    if(here>=17){ UI().show('games'); return; }
    var nx=here+1;
    this.startLevel(Math.floor(nx/3), nx%3);
  },
  onDeath:function(){
    var self=this;
    setTimeout(function(){
      if(!global.RS_Engine.player||!global.RS_Engine.player.dead) return;
      $('#fightOver').classList.remove('hidden');
      try{ global.RS_Engine.setPaused(true); }catch(e){}
    }, 900);
  },
  onWin:function(res){
    $('#fightWinStats').innerHTML='';
    [['★ Score',res.score],['🪙 Shards',res.coins],['⚔ Kills',res.kills],['👑 Elites',res.elites],['⏱ Time',fmtT(res.time)],['☠ Warlords',res.bosses.length]]
      .forEach(function(kv){ var d=el('div','',kv[0]); d.appendChild(el('b','',String(kv[1]))); $('#fightWinStats').appendChild(d); });
    var un=$('#fightWinUnlock');
    if(res.bosses.length){ un.classList.remove('hidden'); un.textContent='☠ Warlord reward unlocked — check Weapons/Skins!'; }
    else un.classList.add('hidden');
    var here=this.wi*3+this.li;
    $('#fightWinTitle').textContent = here>=17 ? '🌅 THE RIFT IS SEALED 🌅' : '✦ LEVEL CLEAR ✦';
    $('#fightNext').textContent = here>=17 ? 'BACK TO GAMES →' : 'NEXT →';
    $('#fightWin').classList.remove('hidden');
    this.renderSide(); this.renderProgress(); this.renderHomeProgress();
  },
  onHud:function(h){
    var g=function(id,v){ var n=document.getElementById(id); if(n) n.textContent=v; };
    g('fightHp','❤ '+h.hp+'/'+h.maxHp); g('fightEn','⚡ '+h.en+'/'+h.maxEn);
    g('fightWeapon',h.wicon+' '+h.weapon);
    g('fightDash', h.dashCd>0?('💨 '+h.dashCd.toFixed(1)+'s'):'💨 ready');
    var c=document.getElementById('fightCoins'); if(c) c.textContent=h.coins;
    var s=document.getElementById('fightScore'); if(s) s.textContent=h.score;
    var bb=$('#fightBossBar');
    if(h.boss&&bb){ bb.classList.remove('hidden'); $('#fightBossName').textContent='☠ '+h.boss.name; $('#fightBossFill').style.width=(100*h.boss.hp/h.boss.max)+'%'; }
    else if(bb) bb.classList.add('hidden');
  },
  onBoss:function(b){
    var bb=$('#fightBossBar');
    if(b&&bb){ bb.classList.remove('hidden'); }
    else if(bb) bb.classList.add('hidden');
  },
  /* ---------- tabs ---------- */
  renderTab:function(){
    var self=this;
    $$('#fightMenu [data-ftab]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-ftab')===self.tab); });
    var body=$('#fightTabBody'); if(!body) return; body.innerHTML='';
    if(this.tab==='play') this.tabPlay(body);
    else if(this.tab==='skins') this.tabSkins(body);
    else if(this.tab==='weapons') this.tabWeapons(body);
    else if(this.tab==='upgrades') this.tabUpgrades(body);
    else this.tabHelp(body);
  },
  tabPlay:function(body){
    var self=this, d=SV().data;
    body.appendChild(el('p','muted','Worlds unlock in order. Finish a level (or fell its warlord) to advance. Boss gates glow red.'));
    var wrap=el('div','rs-worlds');
    D().WORLDS.forEach(function(W,wi){
      var box=el('div','rs-world');
      var locked = wi*3 > d.unlockedWorld*3+d.unlockedLevel;
      box.appendChild(el('h4','',W.icon+' '+(wi+1)+'. '+W.name+(locked?' 🔒':'')));
      box.appendChild(el('div','muted',W.desc));
      var row=el('div','rs-levels');
      for(var li=0;li<3;li++){
        (function(li){
          var b=el('button','',(SV().isDone(wi,li)?'✅ ':'▶ ')+(li+1)+(D().levelSpec(wi,li).bosses.length?' ☠':''));
          if(SV().isDone(wi,li)) b.classList.add('done');
          b.disabled=!SV().isUnlocked(wi,li);
          b.setAttribute('aria-label','Play '+W.name+' level '+(li+1));
          b.addEventListener('click',function(){ self.startLevel(wi,li); });
          row.appendChild(b);
        })(li);
      }
      box.appendChild(row); wrap.appendChild(box);
    });
    body.appendChild(wrap);
    var c=el('div','center'); c.style.marginTop='10px';
    var btn=el('button','btn btn-gold','▶ Continue — '+D().WORLDS[d.unlockedWorld].name+' '+(d.unlockedLevel+1)+'/3');
    btn.addEventListener('click',function(){ self.startLevel(d.unlockedWorld,d.unlockedLevel); });
    c.appendChild(btn); body.appendChild(c);
  },
  tabSkins:function(body){
    var self=this, d=SV().data;
    var info=el('p','muted','Cosmetic only — never pay-to-win. Click to equip; equipped skin glows gold with ✓.');
    body.appendChild(info);
    var grid=el('div','rs-skins');
    D().SKINS.forEach(function(sk){
      var owned=d.skins.indexOf(sk.id)>=0, eq=d.equippedSkin===sk.id;
      var card=el('div','rs-skin'+(eq?' equipped':'')+(owned?'':' locked'));
      card.setAttribute('role','button'); card.setAttribute('tabindex','0');
      card.setAttribute('aria-label',sk.name+(owned?(eq?' (equipped)':''):' (locked)'));
      card.setAttribute('aria-pressed',eq?'true':'false');
      var prev=el('div','rs-prev',sk.icon);
      prev.style.background='linear-gradient(135deg,'+sk.colors[0]+','+sk.colors[1]+')';
      card.appendChild(prev);
      card.appendChild(el('div','',sk.name));
      var rar=el('small','rar-'+sk.rarity,sk.rarity.toUpperCase()); card.appendChild(rar);
      card.appendChild(el('div','muted',owned?(eq?'✓ EQUIPPED':'Tap to equip'):('🔒 '+unlockText(sk))));
      if(eq){ var ch=el('span','check','✓'); card.appendChild(ch); }
      function pick(){ if(!owned){ try{UI().notify('Locked — '+unlockText(sk),'warning');}catch(e){} return; } SV().equipSkin(sk.id); self.renderTab(); self.renderProgress(); }
      card.addEventListener('click',pick);
      card.addEventListener('keydown',function(e){ if(e.code==='Enter'||e.code==='Space'){e.preventDefault();pick();} });
      grid.appendChild(card);
    });
    body.appendChild(grid);
  },
  tabWeapons:function(body){
    var self=this, d=SV().data;
    body.appendChild(el('p','muted','Desktop: 1–8 or Q/E. Mobile: ⚔− / ⚔+ buttons. Each weapon fights differently.'));
    var grid=el('div','rs-weapons');
    D().WEAPONS.forEach(function(w){
      var owned=d.weapons.indexOf(w.id)>=0, eq=d.equippedWeapon===w.id;
      var card=el('div','rs-wep'+(eq?' equipped':''));
      card.setAttribute('role','button'); card.setAttribute('tabindex','0');
      var t=el('div','',w.icon+' '+w.name+'  ·  '+w.cls.toUpperCase()+'  ·  '+w.rarity.toUpperCase()+(eq?'  ✓ EQUIPPED':''));
      card.appendChild(t);
      card.appendChild(el('div','muted','DMG '+w.dmg+' · rate '+w.rate+'/s · range '+w.range+(w.cost?' · ⚡'+w.cost:'')+' — '+w.desc));
      if(!owned) card.appendChild(el('div','muted','🔒 '+weaponUnlockText(w)));
      function pick(){ if(!owned){ try{UI().notify('Locked — '+weaponUnlockText(w),'warning');}catch(e){} return; } SV().equipWeapon(w.id); self.renderTab(); if(global.RS_Engine) global.RS_Engine.emitHud(); }
      card.addEventListener('click',pick);
      card.addEventListener('keydown',function(e){ if(e.code==='Enter'||e.code==='Space'){e.preventDefault();pick();} });
      grid.appendChild(card);
    });
    body.appendChild(grid);
  },
  tabUpgrades:function(body){
    var self=this, d=SV().data;
    body.appendChild(el('p','muted','Spend shards (🪙 '+d.coins+'). Balanced: each rank costs more.'));
    var grid=el('div','rs-ups');
    D().UPGRADES.forEach(function(u){
      var rank=d.upgrades[u.id]|0;
      var cost=rank>=u.max?0:Math.round(u.base*Math.pow(u.growth,rank));
      var row=el('div','rs-up');
      row.appendChild(el('div','',u.icon+' '+u.name+'  ·  '+rank+'/'+u.max+' — '+u.desc));
      var b=el('button','btn btn-gold btn-sm',rank>=u.max?'MAX':('Buy · '+cost+' 🪙'));
      b.disabled=rank>=u.max||d.coins<cost;
      b.addEventListener('click',function(){
        if(SV().spend(cost)){ d.upgrades[u.id]=rank+1; SV().write(); try{UI().notify('★ '+u.name+' → rank '+(rank+1),'success');}catch(e){} self.renderTab(); self.renderProgress(); }
      });
      row.appendChild(b); grid.appendChild(row);
    });
    body.appendChild(grid);
  },
  tabHelp:function(body){
    var d=el('div','muted');
    d.innerHTML='';
    [['Move','A/D or ←/→ · touch ◀ ▶'],['Jump','Space / W / ↑ · touch ▲ (hold = higher)'],['Attack','J / Z · touch ✦ (melee arc or fire)'],['Special nova','K / X · touch ★ (costs 25⚡, 6s cooldown)'],['Dash','Shift / L · touch 💨 (brief invulnerability)'],['Ward (defense)','auto on Wardbell nova; specials differ per weapon'],['Weapons','1–8 or Q/E · touch ⚔−/⚔+'],['Pause','Esc / P or ⏸ button']].forEach(function(r){
      var p=el('div','','• '+r[0]+' — '+r[1]); d.appendChild(p);
    });
    d.appendChild(el('p','','Tip: shielded crawlers block frontal slashes — hit them from behind, or use Tidecleaver / Voltneedle crits. Flyers hate Stormcaster spread.'));
    body.appendChild(d);
  },
  /* ---------- side / dashboards ---------- */
  renderSide:function(){
    var n=$('#fightSide'); if(!n) return;
    var d=SV().data;
    n.textContent='World '+(d.unlockedWorld+1)+'/6 · Level '+(d.unlockedLevel+1)+'/3 · Kills '+d.kills+' · Warlords '+d.bossesDown.length+'/8 · Shards '+d.coins;
  },
  renderProgress:function(){
    var root=$('#fightProgressCards'); if(!root||!D()) return;
    var d=SV().data;
    var cards=[
      ['WORLD',(d.unlockedWorld+1)+' / 6'],['LEVEL',(d.unlockedLevel+1)+' / 3'],
      ['COMPLETED',SV().levelsCompleted()+' / 18'],['ENEMIES',d.kills],
      ['ELITES',d.elites],['BOSSES',d.bossesDown.length+' / 8'],
      ['KILLS (total)',d.kills],['SHARDS',d.coins],
      ['WEAPONS',d.weapons.length+' / 8'],['SKINS',d.skins.length+' / 10'],
      ['UPGRADES',Object.keys(d.upgrades).reduce(function(a,k){return a+(d.upgrades[k]|0);},0)],
      ['BEST SCORE',d.bestScore],['BEST TIME',d.bestTime?fmtT(d.bestTime):'—'],
      ['PLAYTIME',fmtT(d.playtimeS|0)],['EQUIPPED',(D().skinById(d.equippedSkin)||{}).name||'—'],
      ['WEAPON',(D().weaponById(d.equippedWeapon)||{}).name||'—']
    ];
    root.innerHTML='';
    cards.forEach(function(kv){ var s=el('div','stat'); s.appendChild(el('strong','',String(kv[1]))); s.appendChild(el('span','',kv[0])); root.appendChild(s); });
    var note=$('#fightProgressNote');
    if(note){ var has=false; try{ has=global.SP_Profiles.hasAccount(); }catch(e){} note.textContent = has?'Signed in — progress syncs to your PLAYNOVA account.':'Guest — progress stays on this device this visit. Create a free account to sync.'; }
    var ach=$('#fightAch');
    if(ach){ ach.innerHTML=''; D().ACHIEVEMENTS.forEach(function(a){
      var got=d.ach.indexOf(a.id)>=0;
      var r=el('div','ach-row'+(got?'':' locked'),(got?'✅ ':'🔒 ')+a.icon+' '+a.name+' — '+a.desc); ach.appendChild(r);
    });}
    var ar=$('#fightArsenal');
    if(ar){ ar.innerHTML=''; D().WEAPONS.forEach(function(w){
      var owned=d.weapons.indexOf(w.id)>=0;
      ar.appendChild(el('div','ach-row'+(owned?'':' locked'),(owned?'✅ ':'🔒 ')+w.icon+' '+w.name+' ('+w.cls+')'));
    });}
    var wr=$('#fightWardrobe');
    if(wr){ wr.innerHTML=''; D().SKINS.forEach(function(s){
      var owned=d.skins.indexOf(s.id)>=0;
      wr.appendChild(el('div','ach-row'+(owned?'':' locked'),(owned?(d.equippedSkin===s.id?'✓ ':'✅ '):'🔒 ')+s.icon+' '+s.name));
    });}
    this.renderSide();
  },
  renderPlatProgress:function(){
    var root=$('#platProgressCards'); if(!root) return;
    var S=null; try{ S=global.SP_Save; }catch(e){} if(!S) return;
    S.recalcTotals(); var d=S.data;
    var cards=[
      ['CURRENT LEVEL',highestPlayable()],['UNLOCKED',d.maxUnlocked+' / 50'],
      ['COMPLETED',S.completedCount()+' / 50'],['STAR SHARDS',d.totalCoins],
      ['RELICS',d.totalRelics+' / 50'],['TOTAL SCORE',d.totalScore]
    ];
    root.innerHTML='';
    cards.forEach(function(kv){ var s=el('div','stat'); s.appendChild(el('strong','',String(kv[1]))); s.appendChild(el('span','',kv[0])); root.appendChild(s); });
    var w=$('#platProgressWorlds');
    if(w){ w.innerHTML=''; var worlds=(global.SP_Levels&&global.SP_Levels.WORLDS)||[];
      worlds.forEach(function(W,wi){
        var block=el('div','world-block');
        var done=[1,2,3,4,5].filter(function(k){var L=d.levels[String(wi*5+k)];return L&&L.done;}).length;
        block.appendChild(el('h3','',W.icon+' World '+(wi+1)+' — '+W.name+' · '+done+'/5'));
        var row=el('div','level-row');
        for(var k=1;k<=5;k++){ (function(k){
          var n=wi*5+k, rec=d.levels[String(n)], locked=!S.isUnlocked(n);
          var b=el('button','level-card'+(k===5?' boss':'')+(rec&&rec.done?' done':''),(locked?'🔒':(rec&&rec.done?'✅':'▶'))+' L'+n+(rec&&rec.relic?' ★':''));
          b.disabled=locked;
          if(!locked) b.addEventListener('click',function(){ UI().startLevel(n); });
          row.appendChild(b);
        })(k);}
        block.appendChild(row); w.appendChild(block);
      });
    }
    function highestPlayable(){ try{ return UI().highestPlayable(); }catch(e){ return d.maxUnlocked; } }
  },
  /* ---------- games hub + home ---------- */
  renderGamesGrid:function(){
    var g=$('#gamesGrid'); if(!g||!D()) return;
    g.innerHTML='';
    var defs=[
      {id:'platformer', icon:'✦', art:'art-starbound', name:'✦ STARBOUND', genre:'Platformer', diff:'Cozy-hard',
       desc:'Light every beacon. Reclaim the sky. 50 levels · 10 worlds · 10 bosses as Pip the lantern-fox.',
       meta:['★ 50 levels','🌍 10 worlds','☠ 10 bosses'], play:'game', prog:'progress-starbound', progLabel:'View Progress'},
      {id:'fighting', icon:'⚔', art:'art-rift', name:'⚔ RIFTSTRIKE', genre:'Action / Combat', diff:'Challenging',
       desc:'Seal the Rift across 6 worlds. 8 weapons · 10 skins · 8 warlords · upgrades · elites.',
       meta:['⚔ 8 weapons','👾 8 enemies + elites','☠ 8 warlords'], play:'fighting', prog:'progress-fighting', progLabel:'View Progress'}
    ];
    defs.forEach(function(gd){
      var card=el('article','game-card'); card.setAttribute('tabindex','0'); card.setAttribute('role','button');
      card.setAttribute('aria-label','Play '+gd.name);
      var art=el('div','game-card-art '+gd.art); art.setAttribute('aria-hidden','true');
      art.appendChild(el('span','gc-ico',gd.icon));
      for(var i=0;i<3;i++) art.appendChild(el('i'));
      card.appendChild(art);
      var body=el('div','game-card-body');
      var tags=el('div','gc-tags'); tags.appendChild(el('span','',gd.genre)); tags.appendChild(el('span','',gd.diff)); body.appendChild(tags);
      body.appendChild(el('h3','',gd.name));
      var dp=el('p','',gd.desc); dp.className='muted'; body.appendChild(dp);
      var meta=el('div','gc-meta'); gd.meta.forEach(function(m){meta.appendChild(el('span','',m));}); body.appendChild(meta);
      var acts=el('div','gc-actions');
      var pb=el('button','btn btn-gold','Play Now →'); pb.addEventListener('click',function(ev){ev.stopPropagation();UI().show(gd.play);});
      var vb=el('button','btn btn-ghost btn-sm',gd.progLabel); vb.addEventListener('click',function(ev){ev.stopPropagation();UI().show(gd.prog);});
      acts.appendChild(pb); acts.appendChild(vb); body.appendChild(acts);
      card.appendChild(body);
      function go(){ UI().show(gd.play); }
      card.addEventListener('click',go);
      card.addEventListener('keydown',function(e){ if(e.code==='Enter'||e.code==='Space'){e.preventDefault();go();} });
      g.appendChild(card);
    });
  },
  renderHomeProgress:function(){
    var root=$('#homeProgress'); if(!root) return;
    root.innerHTML='';
    var plat=null, fight=null;
    try{ if(global.SP_Save){ global.SP_Save.recalcTotals(); plat={done:global.SP_Save.completedCount(),coins:global.SP_Save.data.totalCoins,relics:global.SP_Save.data.totalRelics}; } }catch(e){}
    try{ if(SV()){ fight={done:SV().levelsCompleted(),kills:SV().data.kills,bosses:SV().data.bossesDown.length}; } }catch(e){}
    var signed=false; try{ signed=global.SP_Profiles.hasAccount(); }catch(e){}
    var c1=el('div','prog-card');
    c1.appendChild(el('h3','','✦ STARBOUND'));
    c1.appendChild(el('p','muted',plat?('✅ '+plat.done+'/50 levels · 🪙 '+plat.coins+' · ★ '+plat.relics+'/50 relics'):'—'));
    var b1=el('div','gc-actions');
    var p1=el('button','btn btn-gold btn-sm','Play'); p1.addEventListener('click',function(){UI().show('game');});
    var v1=el('button','btn btn-ghost btn-sm','Progress'); v1.addEventListener('click',function(){UI().show('progress-starbound');});
    b1.appendChild(p1); b1.appendChild(v1); c1.appendChild(b1); root.appendChild(c1);
    var c2=el('div','prog-card');
    c2.appendChild(el('h3','','⚔ RIFTSTRIKE'));
    c2.appendChild(el('p','muted',fight?('✅ '+fight.done+'/18 levels · ⚔ '+fight.kills+' kills · ☠ '+fight.bosses+'/8 warlords'):'—'));
    var b2=el('div','gc-actions');
    var p2=el('button','btn btn-gold btn-sm','Play'); p2.addEventListener('click',function(){UI().show('fighting');});
    var v2=el('button','btn btn-ghost btn-sm','Progress'); v2.addEventListener('click',function(){UI().show('progress-fighting');});
    b2.appendChild(p2); b2.appendChild(v2); c2.appendChild(b2); root.appendChild(c2);
    if(!signed){
      var c3=el('div','prog-card');
      c3.appendChild(el('h3','','💾 Keep your progress'));
      c3.appendChild(el('p','muted','Guest play works fully, but progress stays on this device. Create a free account to sync both games.'));
      var cb=el('button','btn btn-gold btn-sm','Create free account'); cb.addEventListener('click',function(){UI().show('profile');});
      c3.appendChild(cb); root.appendChild(c3);
    }
  }
};

function unlockText(sk){
  var u=sk.unlock;
  if(u.type==='levels') return 'Clear '+u.n+' levels';
  if(u.type==='world') return 'Clear '+D().WORLDS[u.world].name;
  if(u.type==='kills') return 'Defeat '+u.n+' enemies';
  if(u.type==='coins') return 'Earn '+u.n+' shards total';
  if(u.type==='bosses') return 'Fell '+u.n+' warlords';
  if(u.type==='elites') return 'Defeat '+u.n+' elites';
  if(u.type==='boss') return 'Defeat '+D().bossById(u.boss).name;
  return 'Keep playing';
}
function weaponUnlockText(w){
  if(!w.unlock||w.unlock.type==='start') return 'Available from the start';
  if(w.unlock.type==='boss') return 'Fell '+D().bossById(w.unlock.boss).name;
  return 'Keep playing';
}
function fmtT(s){ s=Math.max(0,Math.ceil(Number(s)||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

global.RS_UI=U;
})(window);
