/* PLAYNOVA — RIFTSTRIKE engine (original action platformer-fighter).
   Delta-time physics · deterministic levels · 8 enemy AIs · 8 bosses (2-phase) ·
   melee/ranged/special weapons · particles · checkpoints · mobile+desktop. */
(function(global){
'use strict';
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function rnd(seed){ var x=(seed*1664525+1013904223)>>>0; return function(){ x=(x*1664525+1013904223)>>>0; return x/4294967296; }; }

var E = {
  canvas:null, ctx:null, running:false, paused:true,
  W:960, H:540, camX:0, time:0, level:null, player:null,
  enemies:[], shots:[], eshots:[], parts:[], floats:[], pickups:[],
  plats:[], checks:[], boss:null, bossDefeated:[], levelCoins:0, levelKills:0, levelElites:0,
  shake:0, playT:0, checkpoint:null, tookDamage:false,
  cb:{}, keys:{}, touch:{left:0,right:0},
  settings:{reducedMotion:false, shake:true}
};

function D(){ return global.RS_Data; }
function SV(){ return global.RS_Save; }
function AU(){ try{ return global.SP_Audio; }catch(e){ return null; } }
function sfx(n){ try{ var a=AU(); if(a&&a.sfx) a.sfx(n); }catch(e){} }

function upgrades(){
  try{ return SV().data.upgrades||{}; }catch(e){ return {}; }
}
function upMult(){
  var u=upgrades();
  return {
    hp: 100 + 18*(u.vitality|0),
    dmg: 1 + 0.12*(u.edge|0),
    dashCd: Math.max(0.45, 1.1*(1-0.12*(u.windstep|0))),
    en: 100 + 20*(u.focus|0), enRegen: 14*(1+0.25*(u.focus|0)),
    spd: 1+0.07*(u.stride|0),
    surge: 1+0.18*(u.surge|0), surgeCd: 1-0.08*(u.surge|0)
  };
}
function weapon(){ var d=D(); try{ return d.weaponById(SV().data.equippedWeapon)||d.WEAPONS[0]; }catch(e){ return D().WEAPONS[0]; } }

E.init=function(cv, cb){
  E.canvas=cv; E.ctx=cv.getContext('2d'); E.cb=cb||{};
  E.fitCanvas();
  window.addEventListener('resize', E.fitCanvas);
  E.bindKeys(); E.bindTouch();
  E.reduced();
};
E.fitCanvas=function(){
  try{
    var wrap=document.getElementById('fightWrap');
    if(!wrap||!E.canvas) return;
    var r=wrap.getBoundingClientRect();
    var w=Math.max(320, r.width-4);
    var h=clamp(w*9/16, 300, Math.max(320, window.innerHeight*0.62));
    E.canvas.style.width=w+'px'; E.canvas.style.height=h+'px';
  }catch(e){}
};
E.reduced=function(){
  try{
    var a = SV()&&SV().data&&SV().data.settings&&SV().data.settings.reducedMotion;
    var b = false;
    try{ b = global.SP_Save&&global.SP_Save.data.settings.reducedMotion; }catch(e){}
    try{ b = b || (window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){}
    E.settings.reducedMotion = !!(a||b);
    E.settings.shake = !E.settings.reducedMotion;
  }catch(e){}
};

/* ---------------- input ---------------- */
E.bindKeys=function(){
  if(E._bound) return; E._bound=true;
  document.addEventListener('keydown', function(e){
    if(!E.running||E.paused) return;
    if(!E.inFightView()) return;
    var c=e.code;
    if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(c)>=0) e.preventDefault();
    E.keys[c]=true;
    if(c==='ShiftLeft'||c==='ShiftRight'||c==='KeyL') E.tryDash();
    if(c==='KeyJ'||c==='KeyZ') E.tryAttack();
    if(c==='KeyK'||c==='KeyX') E.trySpecial();
    if(c==='KeyQ') E.cycleWeapon(-1);
    if(c==='KeyE') E.cycleWeapon(1);
    if(/^Digit[1-8]$/.test(c)) E.setWeapon(parseInt(c.slice(5),10)-1);
    if(c==='Escape'||c==='KeyP'){ try{ global.RS_UI.togglePause(); }catch(err){} }
  });
  document.addEventListener('keyup', function(e){ E.keys[e.code]=false; });
};
E.inFightView=function(){
  try{ var v=document.getElementById('view-fighting'); return v&&v.classList.contains('active'); }catch(e){ return true; }
};
E.bindTouch=function(){
  document.querySelectorAll('#fightTouch [data-f]').forEach(function(b){
    if(b._fb) return; b._fb=true;
    var k=b.getAttribute('data-f');
    var dn=function(e){ e.preventDefault(); handle(k,true); };
    var up=function(e){ e.preventDefault(); handle(k,false); };
    b.addEventListener('pointerdown',dn); b.addEventListener('pointerup',up);
    b.addEventListener('pointerleave',function(e){ handle(k,false); });
    b.addEventListener('pointercancel',function(e){ handle(k,false); });
  });
  function handle(k,down){
    if(k==='left') E.touch.left=down?1:0;
    else if(k==='right') E.touch.right=down?1:0;
    else if(!down) return;
    else if(k==='jump') E.keys._tj=true, setTimeout(function(){E.keys._tj=false;},160);
    else if(k==='atk') E.tryAttack();
    else if(k==='dash') E.tryDash();
    else if(k==='spec') E.trySpecial();
    else if(k==='wnext') E.cycleWeapon(1);
    else if(k==='wprev') E.cycleWeapon(-1);
  }
};
function moveAxis(){
  var l = E.keys.KeyA||E.keys.ArrowLeft||E.touch.left;
  var r = E.keys.KeyD||E.keys.ArrowRight||E.touch.right;
  return (r?1:0)-(l?1:0);
}
function jumpHeld(){ return !!(E.keys.Space||E.keys.KeyW||E.keys.ArrowUp||E.keys._tj); }

/* ---------------- level build (deterministic) ---------------- */
E.buildLevel=function(wi,li){
  var d=D(), spec=d.levelSpec(wi,li), W=d.WORLDS[wi], R=rnd(spec.seed);
  E.spec=spec; E.wi=wi; E.li=li;
  E.enemies=[]; E.shots=[]; E.eshots=[]; E.parts=[]; E.floats=[]; E.pickups=[];
  E.plats=[]; E.checks=[]; E.boss=null; E.bossDefeated=[];
  E.levelCoins=0; E.levelKills=0; E.levelElites=0; E.tookDamage=false; E.playT=0;
  var m=upMult();
  var len = 3000 + wi*350 + li*200;
  E.level={ w:len, h:540, ground:470, world:W, spec:spec };
  // platforms: deterministic gaps, always reachable (dx<=220, dy<=130)
  var x=260, y=380;
  var nPlat = 9+wi+li;
  for(var i=0;i<nPlat;i++){
    var w=110+R()*130;
    E.plats.push({x:x,y:y,w:w,h:16});
    if(i%3===1) E.checks.push({x:x+w/2,y:y-30,got:false});
    x += w+90+R()*130; y = clamp(y+(R()*220-110), 200, 420);
    if(x>len-700) break;
  }
  // coins along platforms + ground
  for(var c=0;c<spec.coins;c++){
    var p=E.plats[c%E.plats.length];
    E.pickups.push({t:'coin', x:p.x+20+(c*37)%(p.w-30), y:p.y-22, vx:0, vy:0, got:false, ph:R()*6});
  }
  for(var s2=0;s2<spec.shards;s2++) E.pickups.push({t:'shard', x:400+R()*(len-1200), y:140+R()*120, got:false, ph:R()*6});
  E.pickups.push({t:'heart', x:len*0.45, y:380, got:false, ph:0});
  // enemies spread across level (not in spawn safe zone x<300)
  for(var ei=0; ei<spec.enemies.length; ei++){
    var id=spec.enemies[ei];
    var ex=500+ (ei/(spec.enemies.length))*(len-1400) + R()*160;
    E.spawnEnemy(id, ex, 300, false);
  }
  for(var el=0; el<spec.elites; el++) E.spawnEnemy(spec.enemies[el%spec.enemies.length], len*0.5+el*300, 300, true);
  // boss gate near end
  E.bossGate={x:len-420};
  E.checkpoint={x:60,y:400};
  var p0={ x:60, y:380, vx:0, vy:0, w:26, h:44, face:1, onG:false, coyote:0, jbuf:0,
    hp:m.hp, maxHp:m.hp, en:m.en, maxEn:m.en, atkCd:0, dashCd:0, dashT:0, ifr:0,
    wardT:0, specCd:0, state:'idle', animT:0, dead:false };
  E.player=p0;
  E.camX=0;
  E.emitHud();
  if(E.cb.onLevel) E.cb.onLevel({wi:wi,li:li,spec:spec});
};
E.spawnEnemy=function(id,x,y,elite){
  var d=D(), base=d.ENEMIES[id]||d.ENEMIES.cinder_imp;
  var wi=E.wi||0;
  var hp=Math.round(base.hp*(1+wi*0.35)*(elite?2.2:1));
  E.enemies.push({ id:id, base:base, x:x, y:y, vx:0, vy:0, w:30, h:36,
    hp:hp, maxHp:hp, dmg:Math.round(base.dmg*(1+wi*0.12)*(elite?1.5:1)),
    elite:!!elite, t:Math.random()*5, atkT:1+Math.random()*2, state:'idle',
    burrow:0, dead:false, flash:0, slow:0, summoned:false });
};
E.spawnBoss=function(bid){
  var d=D(), b=d.bossById(bid);
  var gx=E.bossGate?E.bossGate.x:2600;
  var m={ bid:bid, def:b, x:gx+160, y:340, vx:0, vy:0, w:64, h:84,
    hp:b.hp, maxHp:b.hp, t:0, atkT:2, pat:0, dead:false, flash:0, phase:1, summonCd:6 };
  E.enemies.push(m); E.boss=m;
  try{ if(E.cb.onBoss) E.cb.onBoss(b); }catch(e){}
  sfx('goal');
  E.toast(b.icon+' '+b.name+' — '+b.phases[0]);
};
E.toast=function(msg){
  try{ var t=document.getElementById('fightToast'); if(!t) return;
    t.textContent=msg; t.classList.add('show'); clearTimeout(E._tt);
    E._tt=setTimeout(function(){t.classList.remove('show');},2400);
  }catch(e){}
};

/* ---------------- combat ---------------- */
E.cycleWeapon=function(dir){
  try{
    var list=SV().data.weapons, cur=SV().data.equippedWeapon;
    var i=list.indexOf(cur); i=(i+dir+list.length)%list.length;
    SV().equipWeapon(list[i]); E.emitHud();
    E.toast(D().weaponById(list[i]).icon+' '+D().weaponById(list[i]).name);
    sfx('click');
  }catch(e){}
};
E.setWeapon=function(i){
  try{ var list=SV().data.weapons; if(list[i]){ SV().equipWeapon(list[i]); E.emitHud(); sfx('click'); } }catch(e){}
};
E.tryDash=function(){
  var p=E.player; if(!p||p.dead||E.paused) return;
  var m=upMult();
  if(p.dashCd>0) return;
  var ax=moveAxis(); p.dashT=0.18; p.dashCd=m.dashCd; p.ifr=Math.max(p.ifr,0.25);
  p.vx=(ax!==0?ax:p.face)*520*m.spd; p.vy=0;
  E.dust(p.x,p.y+p.h,8); sfx('whoosh');
};
E.tryAttack=function(){
  var p=E.player; if(!p||p.dead||E.paused||p.atkCd>0) return;
  var w=weapon(), m=upMult();
  if(w.cls!=='melee' && p.en<w.cost){ E.toast('Not enough energy ⚡'); sfx('hurt'); return; }
  p.atkCd=w.cd; p.face=p.face||1; p.state='attack'; p.animT=0;
  var dmg=Math.round(w.dmg*m.dmg);
  if(w.cls==='melee'){
    var crit=Math.random()<0.15;
    if(crit) dmg=Math.round(dmg*1.8);
    var hx=p.x+p.w/2+p.face*(w.range/2+10), hy=p.y+p.h/2;
    E.slash(hx,hy,w.range,p.face,w);
    var hitAny=false;
    E.enemies.forEach(function(e){
      if(e.dead) return;
      var ex=e.x+e.w/2, ey=e.y+e.h/2;
      if(Math.abs(ex-hx)<w.range/2+24 && Math.abs(ey-hy)<60){
        if(e.kind2==='shield'||e.base.kind==='shielded'){
          var fromLeft = hx<ex;
          var facing = (e.vx>=0)?1:-1;
          // frontal block unless flurry-crit or shockwave weapon or attacking from behind
          if(((e.face||facing)=== (fromLeft? -1: 1)) && w.special!=='flurry' && w.special!=='shockwave'){ E.float(ex,ey-30,'BLOCKED','#9aa'); sfx('click'); return; }
        }
        E.damageEnemy(e, dmg*(crit?1:1), p.face*260, crit, w);
        hitAny=true;
        if(w.special==='shockwave'&&crit) E.ring(ex,ey,90,'#ffb03d');
      }
    });
    if(w.special==='flurry'){ p._flurry=(p._flurry||0)+1; }
    if(hitAny){ sfx('hit'); E.shake=Math.min(6,E.shake+2); } else sfx('whoosh');
  } else {
    p.en-=w.cost;
    var bx=p.x+p.w/2, by=p.y+p.h/2-6;
    if(w.special==='spread'){ for(var k=-1;k<=1;k++) E.shots.push({x:bx,y:by,vx:p.face*460,vy:k*90,dmg:dmg,w:w,life:1.4,pierce:false,slow:false}); }
    else if(w.special==='slow'){ E.shots.push({x:bx,y:by,vx:p.face*520,vy:0,dmg:dmg,w:w,life:1.6,pierce:true,slow:true}); }
    else if(w.special==='rapid'){ E.shots.push({x:bx,y:by,vx:p.face*560,vy:(Math.random()*40-20),dmg:dmg,w:w,life:1.0,pierce:false,slow:false}); }
    else if(w.special==='beam'){ E.beam(bx,by,p.face,dmg); E.enemies.forEach(function(e){ if(!e.dead&&((p.face>0&&e.x>bx)||(p.face<0&&e.x<bx))&&Math.abs(e.y-by)<70) E.damageEnemy(e,dmg* (upMult().surge),p.face*180,false,w); }); E.shake=8; }
    else if(w.special==='nova_heal'){
      var sd=upMult().surge;
      E.ring(bx,by,150*w.range/150,'#5df2c8');
      E.enemies.forEach(function(e){ if(!e.dead&&Math.abs(e.x-bx)<170) E.damageEnemy(e,Math.round(dmg*sd), (e.x>bx?1:-1)*300,false,w); });
      p.wardT=Math.max(p.wardT,2.5); p.hp=Math.min(p.maxHp,p.hp+12*sd);
    } else { E.shots.push({x:bx,y:by,vx:p.face*520,vy:0,dmg:dmg,w:w,life:1.4,pierce:false,slow:false}); }
    sfx('shoot');
  }
  E.emitHud();
};
E.trySpecial=function(){ // K = offensive special on cooldown (nova), costs energy
  var p=E.player; if(!p||p.dead||E.paused) return;
  if(p.specCd>0){ E.toast('Special recharging…'); return; }
  var m=upMult();
  if(p.en<25){ E.toast('Not enough energy ⚡'); return; }
  p.en-=25; p.specCd=6*m.surgeCd;
  var dmg=Math.round(22*m.dmg*m.surge);
  var bx=p.x+p.w/2, by=p.y+p.h/2;
  E.ring(bx,by,190,'#b388ff'); E.boom(bx,by,14); E.shake=7; sfx('goal');
  E.enemies.forEach(function(e){ if(!e.dead&&Math.abs(e.x-bx)<210) E.damageEnemy(e,dmg,(e.x>bx?1:-1)*340,true,null); });
  E.emitHud();
};
E.ward=function(){ var p=E.player; if(p&&p.en>=15&&p.wardT<=0){ p.en-=15; p.wardT=2; sfx('click'); } };
E.damageEnemy=function(e,dmg,kb,crit,w){
  if(e.dead) return;
  e.hp-=dmg; e.flash=0.12;
  if(w&&w.special==='slow') e.slow=2.5;
  e.vx+=kb*0.4;
  E.float(e.x+e.w/2, e.y-8, (crit?'CRIT ':'')+dmg, crit?'#ffd97a':'#fff');
  E.spark(e.x+e.w/2, e.y+e.h/2, crit?10:5);
  if(e.hp<=0){
    e.dead=true; e.dieT=0;
    E.levelKills++; if(e.elite) E.levelElites++;
    var sc=(e.def?500:e.base.score)*(e.elite?2:1);
    E.score=(E.score||0)+sc;
    E.levelCoins+= e.def? 20 : e.base.coins*(e.elite?2:1);
    E.coinBank=(E.coinBank||0)+(e.def?20:e.base.coins*(e.elite?2:1));
    E.boom(e.x+e.w/2,e.y+e.h/2, e.def?26:(e.elite?16:8));
    // drops
    if(Math.random()<0.3||e.elite) E.pickups.push({t:'coin',x:e.x,y:e.y-10,vx:(Math.random()*120-60),vy:-160,got:false,ph:0});
    if(Math.random()<0.12) E.pickups.push({t:'heart',x:e.x,y:e.y-10,vx:0,vy:-140,got:false,ph:0});
    if(Math.random()<0.2) E.pickups.push({t:'energy',x:e.x,y:e.y-10,vx:0,vy:-140,got:false,ph:0});
    sfx(e.def?'goal':'hit');
    if(e===E.boss) E.onBossDown(e);
    else {
      try{ var S=SV(); S.data.kills++; if(e.elite){S.data.elites++; S.achAdd('elite_hunter_check');} }catch(err){}
      E.checkKillAch();
    }
    E.emitHud();
  }
};
E.checkKillAch=function(){
  try{ var S=SV(); var k=S.data.kills;
    if(k>=1) S.achAdd('first_blood');
    if(k>=50) S.achAdd('skirmisher');
    if(k>=300) S.achAdd('warhost');
    if(S.data.elites>=5) S.achAdd('elite_hunter');
  }catch(e){}
};
E.onBossDown=function(b){
  E.bossDefeated.push(b.bid);
  E.slowmo=0.6; E.shake=10;
  E.toast('✦ '+b.def.name+' FELLED — '+b.def.reward+' unlocked ✦');
  try{
    var S=SV(), Dd=D();
    if(S.data.bossesDown.indexOf(b.bid)<0) S.data.bossesDown.push(b.bid);
    Dd.WEAPONS.forEach(function(w){ if(w.unlock&&w.unlock.type==='boss'&&w.unlock.boss===b.bid) S.grantWeapon(w.id); });
    Dd.SKINS.forEach(function(sk){ if(sk.unlock&&sk.unlock.type==='boss'&&sk.unlock.boss===b.bid) S.grantSkin(sk.id); });
    if(S.data.bossesDown.length>=1) S.achAdd('giantslayer');
    if(S.data.bossesDown.length>=4) S.achAdd('half_sealed');
    if(b.bid==='riftfather_vaul'){ S.achAdd('riftsealed'); S.grantSkin('dawnwarden'); }
    S.checkUnlocks(); S.write();
  }catch(e){}
  try{ if(E.cb.onBossDown) E.cb.onBossDown(b); }catch(e){}
  E.boss=null;
  try{ if(E.cb.onBoss) E.cb.onBoss(null); }catch(e){}
};
E.hurtPlayer=function(dmg,fromX){
  var p=E.player; if(!p||p.dead||p.ifr>0||E.paused) return;
  if(p.dashT>0) return; // dash i-frames
  if(p.wardT>0){ dmg=Math.ceil(dmg*0.35); }
  p.hp-=dmg; p.ifr=0.7; E.tookDamage=true; E.shake=Math.min(8,E.shake+3);
  p.vx=(p.x<fromX?-1:1)*220; p.vy=-160; p.onG=false;
  E.spark(p.x+p.w/2,p.y+p.h/2,6); sfx('hurt');
  E.float(p.x+p.w/2,p.y-10,'-'+dmg,'#ff6b6b');
  if(p.hp<=0){ p.hp=0; p.dead=true; p.dieT=0; sfx('over'); try{ if(E.cb.onDeath) E.cb.onDeath(); }catch(e){} }
  E.emitHud();
};

/* ---------------- particles ---------------- */
E.spark=function(x,y,n){ if(E.settings.reducedMotion) n=Math.min(2,n); for(var i=0;i<n;i++) E.parts.push({x:x,y:y,vx:Math.random()*300-150,vy:Math.random()*300-150,t:0.4,c:'#ffd97a'}); };
E.dust=function(x,y,n){ if(E.settings.reducedMotion) return; for(var i=0;i<n;i++) E.parts.push({x:x,y:y,vx:Math.random()*120-60,vy:-Math.random()*80,t:0.5,c:'#cbb'}); };
E.boom=function(x,y,n){ if(E.settings.reducedMotion) n=4; for(var i=0;i<n;i++) E.parts.push({x:x,y:y,vx:Math.random()*420-210,vy:Math.random()*420-210,t:0.6,c:['#ffd97a','#ff6b6b','#fff'][i%3]}); };
E.ring=function(x,y,r,c){ E.parts.push({ring:true,x:x,y:y,r:8,max:r||150,t:0.45,c:c||'#fff'}); };
E.beam=function(x,y,dir,dmg){ E.parts.push({beam:true,x:x,y:y,dir:dir,t:0.25}); };
E.slash=function(x,y,range,face,w){ E.parts.push({slash:true,x:x,y:y,range:range,face:face,t:0.14,c:w?'#ffe9b8':'#fff'}); };
E.float=function(x,y,txt,c){ E.floats.push({x:x,y:y,txt:String(txt),c:c||'#fff',t:0.9}); };

/* ---------------- update ---------------- */
E.start=function(){ E.running=true; E.paused=false; E.last=performance.now(); cancelAnimationFrame(E._raf); E._raf=requestAnimationFrame(E.loop); };
E.stop=function(){ E.running=false; E.paused=true; cancelAnimationFrame(E._raf); };
E.setPaused=function(p){ E.paused=!!p; if(!p&&E.running){ E.last=performance.now(); } };
E.loop=function(now){
  if(!E.running) return;
  E._raf=requestAnimationFrame(E.loop);
  if(E.paused){ E.last=now; return; }
  var dt=Math.min(0.033,(now-E.last)/1000); E.last=now;
  if(E.slowmo>0){ E.slowmo-=dt; dt*=0.35; }
  E.update(dt);
  E.draw();
};
E.groundAt=function(x){
  var g=E.level.ground;
  for(var i=0;i<E.plats.length;i++){ var p=E.plats[i]; if(x>=p.x&&x<=p.x+p.w&&g>p.y) { /* candidate */ } }
  return g;
};
E.solidAt=function(x,y,w,h){
  // ground plane
  if(y+h>=E.level.ground) return {x:0,y:E.level.ground,w:E.level.w,h:200,ground:true};
  for(var i=0;i<E.plats.length;i++){ var p=E.plats[i];
    if(x+w>p.x&&x<p.x+p.w&&y+h>p.y&&y+h<p.y+p.h+14) return p;
  }
  return null;
};
E.update=function(dt){
  var p=E.player; if(!p) return;
  E.time+=dt; E.playT+=dt;
  try{ SV().data.playtimeS+=dt; }catch(e){}
  var m=upMult();
  if(!p.dead){
    // move
    var ax=moveAxis();
    var spd=250*m.spd;
    var acc=p.onG?1800:1200;
    var want=ax*spd;
    p.vx += clamp(want-p.vx, -acc*dt, acc*dt);
    if(ax!==0) p.face=ax;
    // gravity + variable jump
    p.vy+=1500*dt;
    if(p.vy>900) p.vy=900;
    if(jumpHeld()) p.jbuf=0.12; else p.jbuf-=dt;
    if(p.onG) p.coyote=0.1; else p.coyote-=dt;
    if(p.jbuf>0&&p.coyote>0){ p.vy=-560*(1+0.07*((upgrades().stride|0))); p.onG=false; p.coyote=0; p.jbuf=0; E.dust(p.x+p.w/2,p.y+p.h,4); sfx('jump'); }
    if(!jumpHeld()&&p.vy<-220) p.vy=-220;
    if(p.dashT>0){ p.dashT-=dt; if(!E.settings.reducedMotion) E.parts.push({x:p.x+p.w/2,y:p.y+p.h/2,vx:0,vy:0,t:0.3,c:'#b388ff'}); }
    // integrate + collide
    p.x+=p.vx*dt; p.x=clamp(p.x,0,E.level.w-p.w);
    p.y+=p.vy*dt; p.onG=false;
    var s=E.solidAt(p.x,p.y,p.w,p.h);
    if(s&&p.vy>=0&&p.y+p.h-s.y<30){ p.y=s.y-p.h; p.vy=0; p.onG=true; }
    if(p.y>620){ E.hurtPlayer(15,p.x-10); p.y=380; p.x=Math.max(0,p.x-120); p.vy=0; }
    // timers
    p.atkCd-=dt; p.dashCd-=dt; p.ifr-=dt; p.wardT-=dt; p.specCd-=dt;
    p.en=clamp(p.en+m.enRegen*dt,0,m.en);
    p.animT+=dt;
    p.state = !p.onG ? (p.vy<0?'jump':'fall') : (Math.abs(p.vx)>20?'run':'idle');
    // checkpoints
    E.checks.forEach(function(c){ if(!c.got&&Math.abs(p.x-c.x)<40){ c.got=true; E.checkpoint={x:c.x,y:c.y}; E.toast('⚑ Checkpoint'); sfx('click'); } });
    // pickups
    E.pickups.forEach(function(pk){
      if(pk.got) return;
      if(pk.vx||pk.vy){ pk.vy+=900*dt; pk.x+=pk.vx*dt; pk.y+=pk.vy*dt; var g2=E.solidAt(pk.x,pk.y,10,10); if(g2&&pk.vy>0){pk.y=g2.y-10;pk.vy=0;pk.vx*=0.9;} }
      if(Math.abs(p.x-pk.x)<30&&Math.abs(p.y-pk.y)<50){
        pk.got=true;
        if(pk.t==='coin'){ E.levelCoins++; E.coinBank=(E.coinBank||0)+1; E.score=(E.score||0)+10; sfx('coin'); }
        if(pk.t==='shard'){ E.levelCoins+=5; E.coinBank=(E.coinBank||0)+5; E.score=(E.score||0)+60; E.toast('+5 shards ◆'); sfx('goal'); }
        if(pk.t==='heart'){ p.hp=Math.min(p.maxHp,p.hp+25); E.toast('+25 HP ❤'); sfx('click'); }
        if(pk.t==='energy'){ p.en=Math.min(p.maxEn,p.en+40); sfx('click'); }
        E.emitHud();
      }
    });
    // boss trigger
    if(E.spec.bosses.length&&!E.boss&&E.bossDefeated.length<E.spec.bosses.length&&p.x>E.bossGate.x){
      var next=E.spec.bosses[E.bossDefeated.length];
      if(next) E.spawnBoss(next);
    }
    // hazard tiles: simple lava/element strips at gaps
    E.hazardTick(dt);
    // level exit: walk past end after bosses dead
    var needBoss=E.spec.bosses.length;
    if(p.x>E.level.w-120&&E.bossDefeated.length>=needBoss){ E.winLevel(); return; }
  } else {
    p.dieT=(p.dieT||0)+dt;
  }
  E.updateEnemies(dt);
  E.updateShots(dt);
  // particles
  for(var i=E.parts.length-1;i>=0;i--){ var q=E.parts[i]; q.t-=dt; if(q.t<=0){E.parts.splice(i,1);continue;} if(!q.ring&&!q.beam&&!q.slash){q.x+=(q.vx||0)*dt;q.y+=(q.vy||0)*dt;q.vy=(q.vy||0)+500*dt;} }
  for(var f=E.floats.length-1;f>=0;f--){ var fl=E.floats[f]; fl.t-=dt; fl.y-=40*dt; if(fl.t<=0) E.floats.splice(f,1); }
  if(E.shake>0) E.shake=Math.max(0,E.shake-30*dt);
  E.camX=clamp(p.x+p.w/2-480,0,Math.max(0,E.level.w-960));
  E.emitHudThrottled();
};
E.hazardTick=function(dt){
  var p=E.player, hz=E.spec.hazard;
  // lava pools / electric fields near fixed x positions (deterministic)
  var zones=[0.3,0.62,0.85], hurt=false;
  for(var i=0;i<zones.length;i++){
    var zx=E.level.w*zones[i];
    if(Math.abs(p.x-zx)<46&&p.onG&&p.y+p.h>=E.level.ground-4){
      E._hzT=(E._hzT||0)+dt;
      if(E._hzT>0.5){ E._hzT=0; E.hurtPlayer(hz==='lava'?12:8, p.x+(i%2?50:-50)); }
      hurt=true;
    }
  }
  if(!hurt) E._hzT=0;
};
E.updateEnemies=function(dt){
  var p=E.player;
  E.enemies.forEach(function(e){
    if(e.dead) return;
    e.t+=dt; e.flash-=dt; e.atkT-=dt;
    if(e.slow>0){ e.slow-=dt; }
    var sp=(e.slow>0?0.5:1);
    if(e.def){ E.updateBoss(e,dt,sp); return; }
    var dx=(p.x-e.x), dy=(p.y-e.y);
    var dist=Math.hypot(dx,dy);
    switch(e.base.kind){
      case 'chaser': e.vx=clamp(dx*2,-e.base.speed*sp,e.base.speed*sp); break;
      case 'ranged':
        if(dist>260) e.vx=(dx>0?1:-1)*e.base.speed*sp;
        else if(dist<170) e.vx=(dx>0?-1:1)*e.base.speed*sp;
        else e.vx*=0.9;
        if(e.atkT<=0&&dist<420){ e.atkT=2.2; E.eshots.push({x:e.x,y:e.y,vx:(dx/dist)*220,vy:-60,dmg:e.dmg,life:2.5}); sfx('shoot'); }
        break;
      case 'dasher':
        if(e.state==='windup'){ e.vx*=0.9; if(e.t>e.windT){ e.state='lunge'; e.vx=(dx>0?1:-1)*340*sp; e.t=0; sfx('whoosh'); } }
        else if(e.state==='lunge'){ if(e.t>0.4){ e.state='idle'; e.t=0; e.atkT=1.6; } }
        else { e.vx=(dx>0?1:-1)*e.base.speed*0.5*sp; if(e.atkT<=0&&dist<300){ e.state='windup'; e.windT=0.5; e.t=0; } }
        break;
      case 'flyer': e.vx=(dx>0?1:-1)*e.base.speed*sp; e.vy=Math.sin(e.t*3)*60-20; e.y+=e.vy*dt; break;
      case 'shielded': e.face=(dx>0?1:-1); e.vx=(dx>0?1:-1)*e.base.speed*sp; break;
      case 'heavy':
        e.vx=(dx>0?1:-1)*e.base.speed*sp;
        if(e.atkT<=0&&dist<130){ e.atkT=2.6; E.ring(e.x+e.w/2,e.y+e.h,90,'#ff6b6b'); if(dist<120) E.hurtPlayer(e.dmg,e.x); E.shake+=2; sfx('hit'); }
        break;
      case 'ambush':
        if(e.burrow>0){ e.burrow-=dt; e.vx=0; if(e.burrow<=0){ e.x=p.x+(Math.random()*80-40); e.y=p.y; E.dust(e.x,e.y,8); sfx('whoosh'); } }
        else { e.vx=(dx>0?1:-1)*e.base.speed*sp; if(e.atkT<=0){ e.atkT=3.2; e.burrow=1.2; E.dust(e.x,e.y,6); } }
        break;
      case 'summoner':
        if(dist>300) e.vx=(dx>0?1:-1)*e.base.speed*sp; else e.vx*0.9;
        if(e.atkT<=0){ e.atkT=4;
          if(!e.summoned&&E.enemies.length<14){ e.summoned=true; E.spawnEnemy('cinder_imp',e.x+40,e.y,false); E.toast('🔮 The acolyte calls for aid!'); }
          else { E.eshots.push({x:e.x,y:e.y,vx:(dx/dist)*200,vy:(dy/dist)*200,dmg:e.dmg,life:2.5}); }
          if(Math.random()<0.4){ e.x+=(dx>0?-120:120); } // blink
        }
        break;
      default: e.vx=(dx>0?1:-1)*e.base.speed*sp;
    }
    if(e.base.kind!=='flyer'){ e.vy+=1500*dt; }
    e.x+=e.vx*dt; e.y+=e.vy*dt;
    var s=E.solidAt(e.x,e.y,e.w,e.h);
    if(s&&e.vy>=0){ e.y=s.y-e.h; e.vy=0; }
    // touch damage
    if(!p.dead&&Math.abs(p.x-e.x)<(p.w+e.w)/2-4&&Math.abs(p.y-e.y)<(p.h+e.h)/2-4){
      if(e.burrow<=0) E.hurtPlayer(e.dmg,e.x);
    }
  });
  // enemy shots
  for(var i=E.eshots.length-1;i>=0;i--){ var sh=E.eshots[i]; sh.life-=dt; sh.x+=sh.vx*dt; sh.y+=(sh.vy||0)*dt+120*dt;
    if(sh.life<=0){E.eshots.splice(i,1);continue;}
    if(!p.dead&&Math.abs(p.x-sh.x)<24&&Math.abs(p.y-sh.y)<34){ E.hurtPlayer(sh.dmg,sh.x-10); E.eshots.splice(i,1); }
  }
};
E.updateBoss=function(b,dt,sp){
  var p=E.player;
  b.t+=0; b.atkT-=dt; b.summonCd-=dt;
  if(b.hp<b.maxHp/2&&b.phase===1){ b.phase=2; E.toast('☠ '+b.def.name+' — '+b.def.phases[1]); E.shake=8; sfx('goal'); }
  var dx=p.x-b.x, dist=Math.abs(dx);
  var speed=(60+b.wi0||60)*(b.phase===2?1.5:1)*sp;
  b.vx=(dx>0?1:-1)*Math.min(120,speed);
  b.x+=b.vx*dt;
  if(b.atkT>0) return;
  var id=b.bid, atk=b.def.attacks[b.pat%b.def.attacks.length]; b.pat++;
  b.atkT = b.phase===2? 1.6 : 2.4;
  if(atk==='bite_lunge'||atk==='pounce_combo'||atk==='dive_bomb'){ b.vx=(dx>0?1:-1)*380; E.toast('❗ '+b.def.name+' lunges!'); sfx('whoosh'); }
  else if(atk==='magma_spit'||atk==='note_volley'||atk==='howl_shards'||atk==='ore_shower'||atk==='starfall'){
    var n=b.phase===2?5:3;
    for(var i=0;i<n;i++) E.eshots.push({x:b.x,y:b.y-20,vx:(dx/dist||1)*(160+i*30),vy:-140+ i*40,dmg:b.def.dmg,life:3});
    sfx('shoot');
  }
  else if(atk==='tide_pull'||atk==='gale_push'||atk==='gravity_well'){ p.vx+=(dx>0?-260:260); E.ring(b.x,b.y,220,'#5df2c8'); sfx('whoosh'); }
  else if(atk==='summon_imps'||atk==='summon_wings'||atk==='summon_crawlers'||atk==='summon_all'){
    var pool=id==='summon_all'?'rift_acolyte':'cinder_imp';
    // summon_all defined inline:
    var sid = atk==='summon_wings'?'gloomwing':(atk==='summon_crawlers'?'aegis_crawler':(atk==='summon_all'?'gust_darter':'cinder_imp'));
    for(var k=0;k<(b.phase===2?2:1);k++) E.spawnEnemy(sid,b.x+(k?80:-80),b.y,false);
    sfx('hit');
  }
  else if(atk==='slam_ring'||atk==='void_beam'||atk==='mirror_slash'||atk==='flame_sweep'||atk==='storm_call'||atk==='ice_patch'||atk==='rift_echo'||atk==='steal_dash'||atk==='twin_swap'){
    E.ring(b.x+b.w/2,b.y+b.h/2,200,b.def.color);
    if(dist<220) E.hurtPlayer(b.def.dmg,b.x);
    E.shake+=3; sfx('hit');
  }
};
E.updateShots=function(dt){
  var p=E.player;
  for(var i=E.shots.length-1;i>=0;i--){ var s=E.shots[i]; s.life-=dt; s.x+=s.vx*dt; s.y+=s.vy*dt;
    var kill=s.life<=0;
    if(!kill) for(var j=0;j<E.enemies.length;j++){ var e=E.enemies[j]; if(e.dead) continue;
      if(Math.abs(e.x-s.x)<30&&Math.abs(e.y-s.y)<40){ E.damageEnemy(e,s.dmg,(s.vx>0?1:-1)*160,false,s.w); if(!s.pierce){kill=true;} break; }
    }
    if(kill) E.shots.splice(i,1);
  }
};
E.respawn=function(){
  var p=E.player, c=E.checkpoint||{x:60,y:380};
  var m=upMult();
  p.x=c.x; p.y=c.y-40; p.vx=0; p.vy=0; p.hp=p.maxHp; p.en=p.maxEn; p.dead=false; p.ifr=1.5;
  // reset non-boss enemies to fresh spawns (keep boss progress if boss dead)
  var dead=E.bossDefeated.slice();
  E.buildLevelKeepPlayer(E.wi,E.li,dead);
  try{ var S=SV(); S.data.deaths++; S.write(); }catch(e){}
  try{ if(E.cb.onRespawn) E.cb.onRespawn(); }catch(e){}
};
E.buildLevelKeepPlayer=function(wi,li,deadBosses){
  var keepHp=null;
  E.buildLevel(wi,li);
  // restore defeated bosses so multi-boss worlds don't reset
  (deadBosses||[]).forEach(function(b){ if(E.bossDefeated.indexOf(b)<0) E.bossDefeated.push(b); });
};
E.winLevel=function(){
  E.setPaused(true);
  var time=E.playT, score=(E.score||0)+Math.max(0,Math.round((E.spec.time-time)))*5 + E.levelCoins*10;
  if(!E.tookDamage){ try{SV().achAdd('untouched');}catch(e){} }
  if(time<90){ try{SV().achAdd('speedwarden');}catch(e){} }
  var bosses=E.bossDefeated.slice();
  var res={score:score,time:Math.round(time*10)/10,coins:E.coinBank||E.levelCoins,kills:E.levelKills,elites:E.levelElites,bosses:bosses};
  try{
    SV().recordLevel(E.wi,E.li,res);
    if(SV().data.coins>=1000) SV().achAdd('hoarder');
    if(Object.keys(SV().data.done).length>=5){} // collector handled in checkUnlocks
    var nSk=SV().data.skins.length; if(nSk>=5) SV().achAdd('collector');
    if(SV().data.weapons.length>=4) SV().achAdd('armorer');
  }catch(e){}
  sfx('goal');
  try{ if(E.cb.onWin) E.cb.onWin(res); }catch(e){}
  E.score=0; E.coinBank=0;
};
E.emitHud=function(){
  try{ if(E.cb.onHud) E.cb.onHud(E.hud()); }catch(e){}
};
E._hudT=0;
E.emitHudThrottled=function(){ var n=performance.now(); if(n-E._hudT>120){ E._hudT=n; E.emitHud(); } };
E.hud=function(){
  var p=E.player||{hp:0,maxHp:100,en:100,maxEn:100};
  var w=null; try{ w=weapon(); }catch(e){}
  return { hp:Math.ceil(p.hp), maxHp:p.maxHp, en:Math.ceil(p.en), maxEn:p.maxEn,
    weapon:w?w.name:'—', wicon:w?w.icon:'', dashCd:Math.max(0,p.dashCd||0),
    coins:E.coinBank||0, score:(E.score||0), boss:E.boss?{name:E.boss.def.name,hp:E.boss.hp,max:E.boss.maxHp}:null,
    specCd:Math.max(0,p.specCd||0) };
};

/* ---------------- draw ---------------- */
E.draw=function(){
  var c=E.ctx, Wl=E.level.world;
  c.save();
  var sx=0,sy=0;
  if(E.settings.shake&&E.shake>0&&!E.settings.reducedMotion){ sx=(Math.random()-0.5)*E.shake; sy=(Math.random()-0.5)*E.shake; }
  c.translate(-E.camX+sx,sy);
  // sky
  var g=c.createLinearGradient(0,0,0,540); g.addColorStop(0,Wl.sky[0]); g.addColorStop(1,Wl.sky[1]);
  c.fillStyle=g; c.fillRect(E.camX-20,-20,1000,580);
  // parallax silhouettes
  c.fillStyle='rgba(0,0,0,.35)';
  for(var i=0;i<8;i++){ var mx=((i*340-E.camX*0.3)%1400+1400)%1400+E.camX-200; c.beginPath(); c.moveTo(mx,470); c.lineTo(mx+90,300+((i*67)%90)); c.lineTo(mx+180,470); c.fill(); }
  // fog band
  c.fillStyle=Wl.fog; c.fillRect(E.camX-20,300,1000,180);
  // ground
  c.fillStyle=Wl.ground; c.fillRect(E.camX-20,E.level.ground,1000,120);
  c.fillStyle=Wl.accent; c.fillRect(E.camX-20,E.level.ground,1000,4);
  // hazard zones
  var zones=[0.3,0.62,0.85];
  c.font='16px sans-serif'; c.textAlign='center';
  zones.forEach(function(z){
    var zx=E.level.w*z; var lbl=E.spec.hazard==='lava'?'🔥':(E.spec.hazard==='electric'?'⚡':(E.spec.hazard==='ice'?'🧊':'🕳'));
    c.fillStyle=E.spec.hazard==='lava'?'rgba(255,90,30,.5)':'rgba(180,120,255,.35)';
    c.fillRect(zx-46,E.level.ground-6,92,10);
    c.fillText(lbl,zx,E.level.ground-14);
  });
  // platforms
  E.plats.forEach(function(p){ c.fillStyle='#241a30'; c.fillRect(p.x,p.y,p.w,p.h); c.fillStyle=Wl.accent; c.fillRect(p.x,p.y,p.w,3); });
  // checkpoints
  E.checks.forEach(function(ch){ c.fillText(ch.got?'⚑':'⚐',ch.x,ch.y); });
  // boss gate
  if(E.bossGate){ c.fillStyle='rgba(255,80,80,.25)'; c.fillRect(E.bossGate.x,120,8,350); c.fillStyle='#fff'; c.font='13px sans-serif'; c.fillText('⚔',E.bossGate.x+4,110); }
  // exit
  c.fillStyle='#5df2c8'; c.fillRect(E.level.w-100,330,40,140); c.fillStyle='#062'; c.font='20px sans-serif'; c.fillText('🌀',E.level.w-80,320);
  // pickups
  E.pickups.forEach(function(pk){ if(pk.got) return; var bob=Math.sin(E.time*3+pk.ph)*3;
    c.font='16px sans-serif'; c.fillText(pk.t==='coin'?'🪙':pk.t==='shard'?'◆':pk.t==='heart'?'❤':'⚡', pk.x, pk.y+bob); });
  // enemies
  E.enemies.forEach(function(e){ if(e.dead) return; E.drawEnemy(c,e); });
  // player
  if(E.player) E.drawPlayer(c,E.player);
  // shots
  c.fillStyle='#ffe95d'; E.shots.forEach(function(s){ c.beginPath(); c.arc(s.x,s.y,4,0,7); c.fill(); });
  c.fillStyle='#ff6b6b'; E.eshots.forEach(function(s){ c.beginPath(); c.arc(s.x,s.y,5,0,7); c.fill(); });
  // particles
  E.parts.forEach(function(q){
    c.globalAlpha=clamp(q.t*2,0,1);
    if(q.ring){ c.strokeStyle=q.c; c.lineWidth=3; c.beginPath(); c.arc(q.x,q.y,(q.max||150)*(1-q.t/0.45)+10,0,7); c.stroke(); }
    else if(q.beam){ c.fillStyle='#e8e8ff'; c.fillRect(Math.min(q.x,q.x+q.dir*700),q.y-6,700,12); }
    else if(q.slash){ c.strokeStyle=q.c; c.lineWidth=5; c.beginPath(); c.arc(q.x,q.y,q.range/2, q.face>0?-0.9:Math.PI-0.9, q.face>0?0.9:Math.PI+0.9); c.stroke(); }
    else { c.fillStyle=q.c; c.fillRect(q.x,q.y,3,3); }
    c.globalAlpha=1;
  });
  // floats
  c.font='bold 13px sans-serif'; c.textAlign='center';
  E.floats.forEach(function(f){ c.globalAlpha=clamp(f.t,0,1); c.fillStyle=f.c; c.fillText(f.txt,f.x,f.y); c.globalAlpha=1; });
  c.restore();
};
E.skinColors=function(){ try{ var s=D().skinById(SV().data.equippedSkin); return s?s.colors:['#ff9a3d','#3a1c05']; }catch(e){ return ['#ff9a3d','#3a1c05']; } };
E.drawPlayer=function(c,p){
  if(p.dead){ c.globalAlpha=0.5; }
  var col=E.skinColors();
  if(p.ifr>0&&Math.floor(E.time*12)%2===0) c.globalAlpha=0.4;
  c.fillStyle=col[0];
  c.fillRect(p.x,p.y,p.w,p.h);
  c.fillStyle=col[1]; c.fillRect(p.x,p.y,p.w,10); // visor band
  c.fillStyle='#fff'; c.fillRect(p.x+(p.face>0?p.w-10:4),p.y+14,6,6); // eye
  if(p.wardT>0){ c.strokeStyle='#5df2c8'; c.lineWidth=2; c.beginPath(); c.arc(p.x+p.w/2,p.y+p.h/2,34,0,7); c.stroke(); }
  if(p.dashT>0){ c.strokeStyle='#b388ff'; c.beginPath(); c.moveTo(p.x+p.w/2-p.face*30,p.y+p.h/2); c.lineTo(p.x+p.w/2-p.face*70,p.y+p.h/2); c.stroke(); }
  c.globalAlpha=1;
};
E.drawEnemy=function(c,e){
  var flash=e.flash>0;
  c.fillStyle=flash?'#fff':(e.elite?'#ffd97a':(e.def?e.def.color:'#c96'));
  if(e.def){ c.fillRect(e.x,e.y,e.w,e.h); c.fillStyle='#000'; c.font='28px sans-serif'; c.textAlign='center'; c.fillText(e.def.icon,e.x+e.w/2,e.y+44); }
  else { c.fillRect(e.x,e.y,e.w,e.h); c.fillStyle='#111'; c.font='16px sans-serif'; c.textAlign='center'; c.fillText(e.base.icon,e.x+e.w/2,e.y+24); }
  if(e.elite&&!e.def){ c.fillStyle='#ffd97a'; c.font='12px sans-serif'; c.fillText('👑',e.x+e.w/2,e.y-6); }
  if(e.burrow>0){ c.globalAlpha=0.4; }
  // hp bar
  var w2=e.def?64:32;
  c.fillStyle='rgba(0,0,0,.6)'; c.fillRect(e.x+(e.w-w2)/2,e.y-10,w2,5);
  c.fillStyle=e.def?'#ff3d5a':'#7dff8a'; c.fillRect(e.x+(e.w-w2)/2,e.y-10,w2*clamp(e.hp/e.maxHp,0,1),5);
  c.globalAlpha=1;
  if(e.def&&e.phase===2){ c.fillStyle=e.def.color; c.font='12px sans-serif'; c.fillText('☠ PHASE II',e.x+e.w/2,e.y-16); }
};

global.RS_Engine=E;
})(window);
