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
    var c=e.code;
    // Pause must work (and unpause) even while paused — handle before the guard.
    if(c==='Escape'||c==='KeyP'){ if(E.inFightView()&&E.running){ e.preventDefault(); try{ global.RS_UI.togglePause(); }catch(err){} } return; }
    if(!E.running||E.paused) return;
    if(!E.inFightView()) return;
    if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(c)>=0) e.preventDefault();
    E.keys[c]=true;
    if(c==='ShiftLeft'||c==='ShiftRight'||c==='KeyL') E.tryDash();
    if(c==='KeyJ'||c==='KeyZ') E.tryAttack();
    if(c==='KeyK'||c==='KeyX') E.trySpecial();
    if(c==='KeyQ') E.cycleWeapon(-1);
    if(c==='KeyE') E.cycleWeapon(1);
    if(/^Digit[1-8]$/.test(c)) E.setWeapon(parseInt(c.slice(5),10)-1);
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

/* ---------------- arena level build (deterministic) ----------------
   Layout grammar (no skippable platform chains — gates enforce combat):
     START → arena → gate → arena → [gate → arena] → checkpoint → boss gate
     → boss arena → exit. Ground is solid throughout; low ledges flank arenas
     for combat verticality only (never a bypass: gates are full-height). */
E.buildLevel=function(wi,li){
  var d=D(), spec=d.levelSpec(wi,li), W=d.WORLDS[wi], R=rnd(spec.seed);
  E.spec=spec; E.wi=wi; E.li=li;
  E.enemies=[]; E.shots=[]; E.eshots=[]; E.parts=[]; E.floats=[]; E.pickups=[];
  E.plats=[]; E.checks=[]; E.boss=null; E.bossDefeated=[];
  E.arenas=[]; E.gates=[];
  E.levelCoins=0; E.levelKills=0; E.levelElites=0; E.tookDamage=false; E.playT=0;
  var m=upMult();
  var isBoss=(li===2);
  var nArena=isBoss?3:2;
  var arenaW=760+wi*30, gap=420;
  var len=560+nArena*(arenaW+gap)+760;
  E.level={ w:len, h:540, ground:470, world:W, spec:spec };
  // arena zones + gates between them (+ boss gate before the last arena on boss levels)
  var x=560;
  for(var a=0;a<nArena;a++){
    var last=(a===nArena-1);
    E.arenas.push({x0:x, x1:x+arenaW, req:[], cleared:false, bossArena:isBoss&&last, idx:a});
    x+=arenaW;
    if(!last){
      // gate between arena a and a+1; the one before a boss arena is a warlord gate
      var nextIsBoss=isBoss&&E.arenas.length<nArena&&(a+1===nArena-1);
      E.gates.push({x:x+gap/2-20, w:26, arena:a, open:false, bossGate:nextIsBoss, announced:false});
      E.checks.push({x:x+gap/2, y:E.level.ground-30, got:false, gateIdx:E.gates.length-1});
      x+=gap;
    }
  }
  // boss gate sits just before the boss arena entrance
  E.bossGate={x:E.arenas[nArena-1].x0-60};
  // combat ledges: low, flanking arena edges — high ground for fights, never a bypass
  E.arenas.forEach(function(ar,ai){
    var nL=1+(ai%2);
    for(var k=0;k<nL;k++){
      var lx=ar.x0+90+k*((ar.x1-ar.x0-260)/Math.max(1,nL))+R()*40;
      var lw=120+R()*60, ly=E.level.ground-(70+R()*40);
      // keep ledges clear of gates so they can't bridge over one
      var clear=true;
      E.gates.forEach(function(g){ if(Math.abs(lx-g.x)<200||Math.abs(lx+lw-g.x)<200) clear=false; });
      if(!clear) return;
      E.plats.push({x:lx,y:ly,w:lw,h:16,ledge:true});
      E.pickups.push({t:'coin', x:lx+20, y:ly-22, vx:0, vy:0, got:false, ph:R()*6});
      if(R()<0.5) E.pickups.push({t:'energy', x:lx+lw-24, y:ly-22, vx:0, vy:0, got:false, ph:R()*6});
    }
  });
  // ground coins sprinkled through arenas
  for(var c=0;c<spec.coins;c++){
    var ar=E.arenas[c%E.arenas.length];
    E.pickups.push({t:'coin', x:ar.x0+40+((c*53)%(ar.x1-ar.x0-80)), y:E.level.ground-22, vx:0, vy:0, got:false, ph:R()*6});
  }
  for(var s2=0;s2<spec.shards;s2++){ var ar2=E.arenas[s2%E.arenas.length]; E.pickups.push({t:'shard', x:ar2.x0+120+R()*(ar2.x1-ar2.x0-240), y:150+R()*120, got:false, ph:R()*6}); }
  E.pickups.push({t:'heart', x:E.arenas[0].x0+60, y:E.level.ground-24, got:false, ph:0});
  // enemies: dealt round-robin into NON-boss arenas as REQUIRED encounters;
  // a couple of OPTIONAL ledge-guards per level can be skipped for coins.
  var fields=E.arenas.filter(function(a){return !a.bossArena;});
  var comp=spec.enemies.slice();
  var nOpt=(isBoss||comp.length<6)?0:2;
  var optIds=comp.splice(0,nOpt);
  comp.forEach(function(id,ei){
    var ar=fields[ei%fields.length];
    var e=E.spawnEnemy(id, ar.x0+120+((ei*197)%(ar.x1-ar.x0-240)), 300, false);
    e.arena=ar.idx; e.required=true; ar.req.push(e);
  });
  for(var el=0; el<spec.elites; el++){
    var arE=fields[fields.length-1];
    var ee=E.spawnEnemy(comp[el%Math.max(1,comp.length)]||'slag_brute', arE.x0+200+el*160, 300, true);
    ee.arena=arE.idx; ee.required=true; arE.req.push(ee);
  }
  optIds.forEach(function(id){
    var lp=E.plats.length?E.plats[(R()*E.plats.length)|0]:null;
    var e2=E.spawnEnemy(id, lp?lp.x+lp.w/2:E.arenas[0].x0+100, 300, false);
    e2.required=false; e2.optional=true;
  });
  E.checkpoint={x:60,y:400};
  var p0={ x:60, y:380, vx:0, vy:0, w:26, h:44, face:1, onG:false, coyote:0, jbuf:0,
    hp:m.hp, maxHp:m.hp, en:m.en, maxEn:m.en, atkCd:0, dashCd:0, dashT:0, ifr:0,
    wardT:0, specCd:0, state:'idle', animT:0, dead:false,
    windup:0, windur:0, wpend:null, hitSet:null, atkBuf:0, atkAnim:0 };
  E.player=p0;
  E.camX=0;
  E.emitHud();
  if(E.cb.onLevel) E.cb.onLevel({wi:wi,li:li,spec:spec});
};
/* Gates: a gate opens once every REQUIRED enemy of its arena is dead
   (boss gates additionally need all prior arenas cleared). */
E.arenaAlive=function(ar){ var n=0; for(var i=0;i<ar.req.length;i++) if(!ar.req[i].dead) n++; return n; };
E.updateGates=function(){
  var p=E.player;
  E.gates.forEach(function(g,i){
    if(g.open) return;
    var ar=E.arenas[g.arena];
    var left=E.arenaAlive(ar);
    if(left<=0){
      if(g.bossGate){
        // boss gate needs every earlier arena cleared too
        for(var k=0;k<E.arenas.length;k++){ if(k!==g.arena&&E.arenaAlive(E.arenas[k])>0) return; }
      }
      g.open=true; ar.cleared=true;
      E.toast(g.bossGate?'⚔ WARLORD GATE OPEN':'✦ GATE OPEN — path clear');
      E.ring(g.x,E.level.ground-120,120,'#5df2c8'); sfx('goal');
      // checkpoint at every opened gate
      E.checkpoint={x:g.x-60,y:E.level.ground-40};
      try{ if(E.cb.onHud) E.cb.onHud(E.hud()); }catch(e){}
    } else if(p&&Math.abs(p.x-g.x)<190&&!g.announced){
      g.announced=true;
      E.toast('🔒 CLEAR THE RIFT — '+left+' foe'+(left>1?'s':'')+' left');
      sfx('click');
      setTimeout(function(){ g.announced=false; },6000);
    }
  });
};
/* Full-height energy walls: clamp the player, never jumpable. */
E.blockGates=function(p){
  for(var i=0;i<E.gates.length;i++){
    var g=E.gates[i]; if(g.open) continue;
    var top=E.level.ground-280;
    if(p.y+p.h>top){
      if(p.x+p.w>g.x&&p.x<g.x+g.w){
        if(p.vx>0) p.x=g.x-p.w-1; else if(p.vx<0) p.x=g.x+g.w+1;
        else p.x=(p.x+p.w/2<g.x+g.w/2)?g.x-p.w-1:g.x+g.w+1;
        p.vx=0;
      }
    }
  }
};
E.spawnEnemy=function(id,x,y,elite){
  var d=D(), base=d.ENEMIES[id]||d.ENEMIES.cinder_imp;
  var wi=E.wi||0;
  var hp=Math.round(base.hp*(1+wi*0.35)*(elite?2.2:1));
  var foe={ id:id, base:base, x:x, y:y, vx:0, vy:0, w:30, h:36,
    hp:hp, maxHp:hp, dmg:Math.round(base.dmg*(1+wi*0.12)*(elite?1.5:1)),
    elite:!!elite, t:Math.random()*5, atkT:1+Math.random()*2, state:'idle',
    burrow:0, dead:false, flash:0, slow:0, summoned:false,
    arena:-1, required:true, optional:false, slot:0, hitBy:0 };
  E.enemies.push(foe);
  E._slot=((E._slot||0)+1)%6; foe.slot=E._slot;
  return foe;
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
/* Attack state machine: WINDUP (anticipation) → ACTIVE (one hit application)
   → RECOVER (cooldown). Damage is applied exactly once per swing (hitSet),
   so animation timing can never multi-hit or whiff unfairly. */
E.WINDUP={ arc:0.10, flurry:0.07, shockwave:0.17, spread:0.07, slow:0.08, rapid:0.05, nova_heal:0.22, beam:0.26, default:0.09 };
E.tryAttack=function(){
  var p=E.player; if(!p||p.dead||E.paused) return;
  if(p.atkCd>0||p.windup>0){ p.atkBuf=0.18; return; } // input buffer: no dropped presses
  var w=weapon();
  if(w.cls!=='melee' && p.en<w.cost){ E.toast('Not enough energy ⚡'); sfx('hurt'); return; }
  p.face=p.face||1;
  p.windup=E.WINDUP[w.special||'default']||E.WINDUP.default;
  p.windur=p.windup; p.wpend=w; p.hitSet={};
  p.state='attack'; p.animT=0; p.atkAnim=0.24+p.windup;
  if(w.special==='shockwave'||w.special==='beam'||w.special==='nova_heal') sfx('whoosh'); // heavy anticipation
};
E.releaseAttack=function(p){
  if(!p||!p.wpend) return; // stray call safety: only a wound-up swing can release
  p.hitSet=p.hitSet||{};
  var w=p.wpend||weapon(), m=upMult();
  p.wpend=null; p.atkCd=w.cd;
  var dmg=Math.round(w.dmg*m.dmg);
  if(w.cls==='melee'){
    var combo=(p._flurry|0)+1; p._flurry=(combo%3===0)?0:combo;
    var crit=(Math.random()<0.15)||(w.special==='flurry'&&combo%3===0);
    if(crit) dmg=Math.round(dmg*1.8);
    var hx=p.x+p.w/2+p.face*(w.range/2+10), hy=p.y+p.h/2;
    E.slash(hx,hy,w.range,p.face,w);
    var hitAny=false;
    E.enemies.forEach(function(e){
      if(e.dead||p.hitSet[e.slot+'_'+(e.bid||e.id)]) return;
      var ex=e.x+e.w/2, ey=e.y+e.h/2;
      if(Math.abs(ex-hx)<w.range/2+24 && Math.abs(ey-hy)<60){
        if(e.base&&e.base.kind==='shielded'){
          var fromLeft = hx<ex;
          var facing = (e.vx>=0)?1:-1;
          if(((e.face||facing)===(fromLeft?-1:1)) && w.special!=='flurry' && w.special!=='shockwave'){ E.float(ex,ey-30,'BLOCKED','#9aa'); sfx('click'); return; }
        }
        p.hitSet[e.slot+'_'+(e.bid||e.id)]=1;
        E.damageEnemy(e, dmg, p.face*(w.special==='shockwave'?420:260), crit, w);
        hitAny=true;
        E.impact(ex,ey,w); // weapon-specific impact identity
        if(w.special==='shockwave'){ E.ring(ex,ey,110,'#4dd2ff'); E.wave(hx,hy,p.face,dmg); }
        if(w.special==='flurry'&&combo%3===0){ E.chainTo(hx,hy,e,dmg); }
      }
    });
    if(hitAny){ sfx('hit'); E.hitstop=Math.max(E.hitstop||0, w.special==='shockwave'?0.09:0.045); E.shake=Math.min(8,E.shake+(w.special==='shockwave'?5:2)); }
    else sfx('whoosh');
  } else {
    p.en-=w.cost;
    var bx=p.x+p.w/2, by=p.y+p.h/2-6;
    E.muzzle(bx+p.face*14,by,w);
    if(w.special==='spread'){ for(var k=-1;k<=1;k++) E.shots.push({x:bx,y:by,vx:p.face*460,vy:k*90,dmg:dmg,w:w,life:1.4,pierce:false,slow:false,zig:true}); }
    else if(w.special==='slow'){ E.shots.push({x:bx,y:by,vx:p.face*520,vy:0,dmg:dmg,w:w,life:1.6,pierce:true,slow:true,frost:true}); }
    else if(w.special==='rapid'){ E.shots.push({x:bx,y:by,vx:p.face*560,vy:(Math.random()*40-20),dmg:dmg,w:w,life:1.0,pierce:false,slow:false,tracer:true}); E.shell(bx,by); }
    else if(w.special==='beam'){ E.chargeBeam(bx,by,p.face,dmg,w); }
    else if(w.special==='nova_heal'){
      var sd=upMult().surge;
      E.ring(bx,by,150,'#5df2c8'); E.boom(bx,by,10);
      E.enemies.forEach(function(e){ if(!e.dead&&Math.abs(e.x-bx)<170) E.damageEnemy(e,Math.round(dmg*sd), (e.x>bx?1:-1)*300,false,w); });
      p.wardT=Math.max(p.wardT,2.5); p.hp=Math.min(p.maxHp,p.hp+12*sd);
      E.hitstop=Math.max(E.hitstop||0,0.06);
    } else { E.shots.push({x:bx,y:by,vx:p.face*520,vy:0,dmg:dmg,w:w,life:1.4,pierce:false,slow:false}); }
    sfx('shoot');
  }
  E.emitHud();
};
/* ---- weapon impact identity (feel, not numbers) ---- */
E.impact=function(x,y,w){
  var sp=(w&&w.special)||'';
  if(sp==='arc'){ E.spark(x,y,8); E.ring(x,y,44,'#ffb03d'); }
  else if(sp==='flurry'){ E.spark(x,y,5); E.parts.push({x:x,y:y,vx:0,vy:-60,t:0.25,c:'#ffe95d'}); }
  else if(sp==='shockwave'){ E.boom(x,y,10); E.ring(x,y,90,'#4dd2ff'); }
  else { E.spark(x,y,6); }
};
E.muzzle=function(x,y,w){
  var c={spread:'#ffe95d',slow:'#bfe9ff',rapid:'#ffb03d',beam:'#e8e8ff',nova_heal:'#5df2c8'}[(w&&w.special)||'']||'#fff';
  E.parts.push({x:x,y:y,vx:0,vy:0,t:0.12,c:c,flash:true});
  if(w&&w.special==='rapid') E.dust(x,y-6,2);
};
E.shell=function(x,y){ E.parts.push({x:x,y:y+6,vx:-60,vy:-120,t:0.4,c:'#c90'}); };
E.chainTo=function(x,y,from,dmg){
  // arc lightning to the nearest other live enemy: small bonus, big feel
  var best=null,bd=1e9;
  E.enemies.forEach(function(o){ if(o.dead||o===from) return;
    var d=Math.hypot(o.x-from.x,o.y-from.y); if(d<190&&d<bd){bd=d;best=o;} });
  if(best){ E.parts.push({bolt:true,x:x,y:y,x2:best.x+best.w/2,y2:best.y,t:0.18,c:'#ffe95d'});
    E.damageEnemy(best,Math.max(3,Math.round(dmg*0.5)),0,false,null); sfx('shoot'); }
};
E.wave=function(x,y,dir,dmg){
  E.shots.push({x:x,y:y+18,vx:dir*300,vy:0,dmg:Math.round(dmg*0.6),w:{special:'shockwave',icon:'🌊'},life:0.55,pierce:true,slow:false,wave:true,id:E._shotId=(E._shotId||0)+1});
  E.dust(x,y+24,6);
};
E.chargeBeam=function(bx,by,dir,dmg,w){
  E.beam(bx,by,dir,dmg); E.boom(bx+dir*60,by,8);
  E.enemies.forEach(function(e){ if(!e.dead&&((dir>0&&e.x>bx)||(dir<0&&e.x<bx))&&Math.abs(e.y-by)<70) E.damageEnemy(e,Math.round(dmg*upMult().surge),dir*180,false,w); });
  E.hitstop=Math.max(E.hitstop||0,0.1); E.shake=8;
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
  var raw=Math.min(0.05,(now-E.last)/1000); E.last=now;
  var dt=Math.min(0.033,raw);
  if(E.slowmo>0){ E.slowmo-=raw; dt*=0.35; }
  if(E.hitstop>0){ E.hitstop-=raw; dt*=0.1; } // impact freeze: everything (incl. timers) slows together
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
    // attack windup → release (anticipation before the active frame)
    if(p.windup>0){ p.windup-=dt; if(p.windup<=0){ p.windup=0; E.releaseAttack(p); } }
    else if(p.atkBuf>0){ p.atkBuf-=dt; if(p.atkCd<=0){ p.atkBuf=0; E.tryAttack(); } if(p.atkBuf<0) p.atkBuf=0; }
    if(p.atkAnim>0) p.atkAnim-=dt;
    // move (damped while winding up a swing)
    var ax=moveAxis();
    var spd=250*m.spd*(p.windup>0?0.35:1);
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
    E.blockGates(p); // sealed energy walls: combat first, progress after
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
    // arena gates: required clears open the way forward
    E.updateGates();
    // hazard tiles: simple lava/element strips at gaps
    E.hazardTick(dt);
    // level exit: walk past end once gates + bosses are cleared
    if(p.x>E.level.w-120&&E.exitOpen()){ E.winLevel(); return; }
  } else {
    p.dieT=(p.dieT||0)+dt;
  }
  E.updateEnemies(dt);
  E.updateShots(dt);
  // particles (capped: no runaway allocation on long fights)
  if(E.parts.length>420) E.parts.splice(0,E.parts.length-420);
  for(var i=E.parts.length-1;i>=0;i--){ var q=E.parts[i]; q.t-=dt; if(q.t<=0){E.parts.splice(i,1);continue;} if(!q.ring&&!q.beam&&!q.slash&&!q.bolt&&!q.flash){q.x+=(q.vx||0)*dt;q.y+=(q.vy||0)*dt;q.vy=(q.vy||0)+500*dt;} }
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
  E.separateEnemies();
  E.enemies.forEach(function(e){
    if(e.dead) return;
    e.t+=dt; e.flash-=dt; e.atkT-=dt;
    if(e.slow>0){ e.slow-=dt; }
    var sp=(e.slow>0?0.5:1);
    if(e.def){ E.updateBoss(e,dt,sp); return; }
    var dx=(p.x-e.x), dy=(p.y-e.y);
    var dist=Math.hypot(dx,dy);
    // Dormant until the player nears the arena: quiet, breathing, no attacks.
    var dormant=Math.abs((e.x+e.w/2)-(p.x+p.w/2))>820;
    if(!dormant){
    switch(e.base.kind){
      case 'chaser': e.vx=clamp(dx*2,-e.base.speed*sp,e.base.speed*sp); break;
      case 'ranged':
        if(dist>260) e.vx=(dx>0?1:-1)*e.base.speed*sp;
        else if(dist<170) e.vx=(dx>0?-1:1)*e.base.speed*sp;
        else { e.vx*=0.9; e.vx+=((e.slot%2)?1:-1)*22*sp; } // strafe the band: surround, don't stack
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
    } // !dormant
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
/* ---------------- enemy separation (lightweight boids-lite) ----------------
   Root cause of the stacking bug: every chaser steered to the identical
   player point with no peer awareness. Each pair now keeps a minimum
   spacing (44px); the push is positional + a small velocity bias, scaled by
   overlap so settled enemies don't jitter. Result: packs surround instead
   of piling. O(n^2) over a tiny n (<= ~18). */
E.separateEnemies=function(){
  var list=E.enemies, MIN=44;
  for(var i=0;i<list.length;i++){
    var a=list[i]; if(a.dead) continue;
    for(var j=i+1;j<list.length;j++){
      var b=list[j]; if(b.dead) continue;
      if(a.base&&a.base.kind==='ambush'&&a.burrow>0) continue;
      if(b.base&&b.base.kind==='ambush'&&b.burrow>0) continue;
      var dx=(b.x+b.w/2)-(a.x+a.w/2), dy=(b.y+b.h/2)-(a.y+a.h/2);
      var d=Math.hypot(dx,dy);
      if(d>=MIN) continue;
      var nx, ny;
      if(d<0.01){ nx=(((a.slot||0)<=(b.slot||0))?-1:1); ny=0; d=0; } // exact overlap: pick a side
      else { nx=dx/d; ny=dy/d*0.4; } // mostly horizontal fanning
      var push=(MIN-d)/MIN; // 0..1 overlap
      var immA=!!a.def, immB=!!b.def;
      var sa=immA?0:(immB?1:0.5), sb=immB?0:(immA?1:0.5);
      var amt=26*push; // px/sec positional rate, applied below as *dt-ish nudge
      a.x-=nx*amt*sa*0.16; a.vx-=nx*60*push*sa;
      b.x+=nx*amt*sb*0.16; b.vx+=nx*60*push*sb;
      // surround bias: nudge the pair to opposite sides of the player
      var p=E.player;
      if(p){
        var ma=((a.x+a.w/2)<p.x)?-1:1, mb=((b.x+b.w/2)<p.x)?-1:1;
        if(ma===mb){ a.vx+=ma*24*push*sa; b.vx-=mb*24*push*sb; }
      }
    }
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
    if(s.zig) s.y+=Math.sin(E.time*30+s.x*0.05)*60*dt;
    if(!E.settings.reducedMotion){
      if(s.frost&&Math.random()<0.5) E.parts.push({x:s.x,y:s.y,vx:0,vy:-20,t:0.3,c:'#bfe9ff'});
      if(s.tracer&&Math.random()<0.6) E.parts.push({x:s.x,y:s.y,vx:0,vy:0,t:0.18,c:'#ffb03d'});
    }
    var kill=s.life<=0;
    if(!kill) for(var j=0;j<E.enemies.length;j++){ var e=E.enemies[j]; if(e.dead) continue;
      if(Math.abs(e.x-s.x)<30&&Math.abs(e.y-s.y)<40){
        if(s.wave){ if(e.hitBy===s.id) continue; e.hitBy=s.id; E.damageEnemy(e,s.dmg,(s.vx>0?1:-1)*220,false,s.w); E.impact(e.x,e.y,s.w); continue; }
        E.damageEnemy(e,s.dmg,(s.vx>0?1:-1)*160,false,s.w); if(!s.pierce){kill=true;} break;
      }
    }
    if(kill){ if(s.wave) E.dust(s.x,s.y,3); E.shots.splice(i,1); }
  }
};
/* Exit is open only when every gate is open and all bosses are felled. */
E.exitOpen=function(){
  for(var i=0;i<E.gates.length;i++) if(!E.gates[i].open) return false;
  return E.bossDefeated.length>=(E.spec?E.spec.bosses.length:0);
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
  var left=0;
  try{ for(var i=0;i<E.arenas.length;i++) left+=E.arenaAlive(E.arenas[i]); }catch(e){}
  return { hp:Math.ceil(p.hp), maxHp:p.maxHp, en:Math.ceil(p.en), maxEn:p.maxEn,
    weapon:w?w.name:'—', wicon:w?w.icon:'', dashCd:Math.max(0,p.dashCd||0),
    coins:E.coinBank||0, score:(E.score||0), boss:E.boss?{name:E.boss.def.name,hp:E.boss.hp,max:E.boss.maxHp}:null,
    specCd:Math.max(0,p.specCd||0),
    objective: E.boss ? ('☠ Fell '+E.boss.def.name) : (left>0?('⚔ Clear the rift — '+left+' left'):'✦ Path open — push forward') };
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
  // combat gates: red sealed wall + remaining counter → green open shimmer
  E.gates.forEach(function(g){
    var top=E.level.ground-280, hgt=280, pulse=E.settings.reducedMotion?0:Math.sin(E.time*5)*0.15;
    if(g.open){
      c.fillStyle='rgba(93,242,200,'+(0.10)+')'; c.fillRect(g.x,top,g.w,hgt);
      c.fillStyle='rgba(93,242,200,.5)'; c.fillRect(g.x,top,2,hgt); c.fillRect(g.x+g.w-2,top,2,hgt);
    } else {
      var ar=E.arenas[g.arena], left=E.arenaAlive(ar);
      var grd=c.createLinearGradient(g.x,0,g.x+g.w,0);
      grd.addColorStop(0,'rgba(255,61,90,'+(0.12+pulse)+')');
      grd.addColorStop(0.5,'rgba(255,61,90,'+(0.45+pulse)+')');
      grd.addColorStop(1,'rgba(255,61,90,'+(0.12+pulse)+')');
      c.fillStyle=grd; c.fillRect(g.x,top,g.w,hgt);
      c.fillStyle=g.bossGate?'#ffd97a':'#ff6b6b';
      c.font='bold 13px sans-serif'; c.textAlign='center';
      c.fillText(g.bossGate?'☠':'🔒',g.x+g.w/2,top-24);
      c.fillStyle='#fff'; c.font='bold 12px sans-serif';
      c.fillText('⚔ '+left, g.x+g.w/2, top-8);
    }
  });
  // boss gate marker (approach line)
  if(E.bossGate){ c.fillStyle='rgba(255,80,80,.20)'; c.fillRect(E.bossGate.x,120,8,350); c.fillStyle='#fff'; c.font='13px sans-serif'; c.fillText('⚔',E.bossGate.x+4,110); }
  // exit rift: sealed red until requirements met, open cyan after
  var exitOpen=E.exitOpen();
  c.fillStyle=exitOpen?'#5df2c8':'rgba(255,61,90,.55)'; c.fillRect(E.level.w-100,330,40,140);
  if(!E.settings.reducedMotion&&exitOpen){ c.strokeStyle='rgba(93,242,200,.7)'; c.lineWidth=2;
    c.beginPath(); c.ellipse(E.level.w-80,400,26,60,0,0,7); c.stroke(); }
  c.fillStyle=exitOpen?'#062':'#fff'; c.font='20px sans-serif'; c.fillText(exitOpen?'🌀':'🔒',E.level.w-80,320);
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
    else if(q.bolt){ c.strokeStyle=q.c||'#ffe95d'; c.lineWidth=2; c.beginPath();
      var segs=4; c.moveTo(q.x,q.y);
      for(var bi=1;bi<=segs;bi++){ var bx=q.x+(q.x2-q.x)*bi/segs+((bi%2)?6:-6), by=q.y+(q.y2-q.y)*bi/segs; c.lineTo(bx,by); }
      c.stroke(); }
    else if(q.flash){ var fg=c.createRadialGradient(q.x,q.y,1,q.x,q.y,26);
      fg.addColorStop(0,q.c||'#fff'); fg.addColorStop(1,'rgba(255,255,255,0)');
      c.fillStyle=fg; c.beginPath(); c.arc(q.x,q.y,26,0,7); c.fill(); }
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
  var cx=p.x+p.w/2, feet=p.y+p.h;
  var runPh=Math.abs(p.vx)>20&&p.onG?Math.sin(E.time*14)*3:0;
  var wind=p.windup>0?1-p.windup/Math.max(0.001,p.windur):0; // 0→1 anticipation
  // shadow
  c.fillStyle='rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(cx,feet+3,12,4,0,0,7); c.fill();
  // legs
  c.fillStyle='#1c1426';
  c.fillRect(p.x+5,feet-12+runPh,p.w/2-6,12-runPh);
  c.fillRect(p.x+p.w/2+1,feet-12-runPh,p.w/2-6,12+runPh);
  // torso (warden coat)
  var lean=clamp(p.vx/500,-1,1)*3;
  c.fillStyle=col[0];
  c.fillRect(p.x+2+lean,p.y+12,p.w-4,p.h-24);
  c.fillStyle=col[1]; c.fillRect(p.x+2+lean,p.y+12,p.w-4,7); // collar
  // head + visor eye
  c.fillStyle='#e8b98a'; c.fillRect(cx-8+lean,p.y-2,16,13);
  c.fillStyle=col[1]; c.fillRect(cx-8+lean,p.y+2,16,4);
  c.fillStyle='#fff'; c.fillRect(cx+(p.face>0?1:-7)+lean,p.y+3,6,5);
  c.fillStyle='#123'; c.fillRect(cx+(p.face>0?3:-5)+lean,p.y+4,3,3);
  // scarf flutter
  c.strokeStyle=col[0]; c.lineWidth=3; c.beginPath();
  c.moveTo(cx-p.face*8,p.y+14);
  c.quadraticCurveTo(cx-p.face*20,p.y+16+Math.sin(E.time*9)*4,cx-p.face*30,p.y+12+Math.sin(E.time*7)*6);
  c.stroke();
  // weapon: anticipation raise → sweeping arc during atkAnim
  E.drawWeapon(c,p,cx,p.y+22,wind);
  if(p.wardT>0){ c.strokeStyle='#5df2c8'; c.lineWidth=2; c.beginPath(); c.arc(cx,p.y+p.h/2,34+Math.sin(E.time*6)*2,0,7); c.stroke(); }
  if(p.dashT>0){ c.strokeStyle='#b388ff'; c.lineWidth=3; c.beginPath(); c.moveTo(cx-p.face*30,p.y+p.h/2); c.lineTo(cx-p.face*70,p.y+p.h/2); c.stroke(); }
  c.globalAlpha=1;
};
/* Weapon in hand: pulled back while winding up, sweeping while active. */
E.drawWeapon=function(c,p,cx,cy,wind){
  var w=null; try{ w=weapon(); }catch(e){}
  var sw=(p.atkAnim>0)?clamp(p.atkAnim/0.3,0,1):0; // 1→0 through the swing
  var ang;
  if(p.windup>0) ang=p.face>0?(-1.9+wind*0.7):(Math.PI+1.9-wind*0.7); // raised back
  else if(sw>0) ang=(p.face>0?-1.2:Math.PI+1.2)+(1-sw)*(p.face>0?2.3:-2.3); // sweep
  else ang=p.face>0?-0.5:Math.PI+0.5; // rest
  var len=w?(18+w.range*0.22):26;
  var ex=cx+Math.cos(ang)*len, ey=cy+Math.sin(ang)*len;
  var cols={arc:'#ffb03d',flurry:'#ffe95d',shockwave:'#4dd2ff',spread:'#ffe95d',slow:'#bfe9ff',rapid:'#ff9a3d',nova_heal:'#5df2c8',beam:'#e8e8ff'};
  c.strokeStyle=(w&&cols[w.special])||'#fff'; c.lineWidth=w&&w.cls==='melee'?4:3;
  c.beginPath(); c.moveTo(cx,cy); c.lineTo(ex,ey); c.stroke();
  if(w&&w.special==='beam'){ c.fillStyle='#e8e8ff'; c.beginPath(); c.arc(ex,ey,4,0,7); c.fill(); }
  if(sw>0&&w&&w.cls==='melee'){ c.globalAlpha=0.35*sw; c.lineWidth=8; c.beginPath(); c.arc(cx,cy,len*0.9,ang-(p.face>0?0.7:-0.7),ang); c.stroke(); c.globalAlpha=1; }
};
/* Original per-kind enemy art: distinct silhouettes, eyes, armor, glow.
   Nothing copied — all shapes drawn here from scratch. */
E.drawEnemy=function(c,e){
  var flash=e.flash>0;
  var cx=e.x+e.w/2, feet=e.y+e.h;
  var bob=e.base&&e.base.kind==='flyer'?Math.sin(e.t*5)*4:(Math.abs(e.vx)>10?Math.sin(e.t*10)*1.5:Math.sin(e.t*3)*1);
  var elite=e.elite;
  // shadow
  c.fillStyle='rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(cx,feet+2,e.w*0.42,3.5,0,0,7); c.fill();
  if(e.def){ // warlords get their own silhouette, not a minion body
    E.drawBoss(c,e,cx);
    var w2=64;
    c.fillStyle='rgba(0,0,0,.6)'; c.fillRect(cx-w2/2,e.y-12,w2,5);
    c.fillStyle='#ff3d5a'; c.fillRect(cx-w2/2,e.y-12,w2*clamp(e.hp/e.maxHp,0,1),5);
    c.globalAlpha=1;
    return;
  }
  // elite aura
  if(elite&&!E.settings.reducedMotion){ c.strokeStyle='rgba(255,217,122,'+(0.5+0.3*Math.sin(e.t*6))+')'; c.lineWidth=2;
    c.beginPath(); c.arc(cx,e.y+e.h/2,e.w*0.75+Math.sin(e.t*6)*2,0,7); c.stroke(); }
  var K=(e.base&&e.base.kind)||'chaser';
  c.save();
  if(flash){ c.fillStyle='#fff'; c.strokeStyle='#fff'; }
  if(K==='chaser'){ // Cinder Imp: squat ember body, horns, fangs
    c.fillStyle=flash?'#fff':'#b33a1e'; c.beginPath(); c.ellipse(cx,e.y+22+bob,15,14,0,0,7); c.fill();
    c.fillStyle=flash?'#fff':'#ff7a3d'; c.beginPath(); c.ellipse(cx,e.y+26+bob,9,8,0,0,7); c.fill();
    c.fillStyle=flash?'#fff':'#5a1408';
    c.beginPath(); c.moveTo(cx-12,e.y+12+bob); c.lineTo(cx-17,e.y+1+bob); c.lineTo(cx-6,e.y+9+bob); c.fill();
    c.beginPath(); c.moveTo(cx+12,e.y+12+bob); c.lineTo(cx+17,e.y+1+bob); c.lineTo(cx+6,e.y+9+bob); c.fill();
    c.fillStyle='#ffe95d'; c.fillRect(cx-7,e.y+17+bob,5,6); c.fillRect(cx+2,e.y+17+bob,5,6);
    c.fillStyle='#fff'; c.fillRect(cx-5,e.y+29+bob,3,4); c.fillRect(cx+2,e.y+29+bob,3,4);
    if(!E.settings.reducedMotion&&Math.random()<0.1) E.parts.push({x:cx+(Math.random()*16-8),y:e.y+10,vx:0,vy:-30,t:0.4,c:'#ff7a3d'});
  } else if(K==='ranged'){ // Shard Slinger: robed caster, floating shards
    c.fillStyle=flash?'#fff':'#3a4a6a'; c.beginPath(); c.moveTo(cx-13,feet); c.lineTo(cx-6,e.y+8+bob); c.lineTo(cx+6,e.y+8+bob); c.lineTo(cx+13,feet); c.fill();
    c.fillStyle=flash?'#fff':'#7a8fc0'; c.beginPath(); c.arc(cx,e.y+10+bob,8,0,7); c.fill();
    c.fillStyle='#bfe9ff'; c.fillRect(cx-4,e.y+8+bob,8,3);
    var ch=e.atkT<0.5; // telegraph glow before firing
    c.fillStyle=ch?'#fff':'#4dd2ff';
    for(var s3=0;s3<3;s3++){ var a3=e.t*2+s3*2.09; c.beginPath(); c.arc(cx+Math.cos(a3)*14,e.y+22+Math.sin(a3)*8,ch?4:2.5,0,7); c.fill(); }
  } else if(K==='dasher'){ // Gust Darter: angular arrowhead, windup flash
    var wind=e.state==='windup';
    c.fillStyle=flash?'#fff':(wind?'#fff':'#2a8a7a');
    var dir=(e.vx>=0)?1:-1;
    c.beginPath(); c.moveTo(cx+dir*17,e.y+18); c.lineTo(cx-dir*12,e.y+6+bob); c.lineTo(cx-dir*5,e.y+18); c.lineTo(cx-dir*12,e.y+30+bob); c.fill();
    c.fillStyle=wind?'#ff3d5a':'#d8ffef'; c.fillRect(cx+dir*2-2,e.y+15,4,6);
    if(wind){ c.strokeStyle='rgba(255,61,90,.7)'; c.lineWidth=2; c.beginPath(); c.moveTo(cx-dir*20,e.y+18); c.lineTo(cx-dir*30,e.y+18); c.stroke(); }
  } else if(K==='flyer'){ // Gloomwing: bat wings + hanging body
    var flap=Math.sin(e.t*12)*0.7;
    c.fillStyle=flash?'#fff':'#4a2a6a';
    c.save(); c.translate(cx,e.y+14+bob); c.rotate(-0.5-flap*0.4);
    c.beginPath(); c.ellipse(-13,0,13,5,0,0,7); c.fill(); c.restore();
    c.save(); c.translate(cx,e.y+14+bob); c.rotate(0.5+flap*0.4);
    c.beginPath(); c.ellipse(13,0,13,5,0,0,7); c.fill(); c.restore();
    c.fillStyle=flash?'#fff':'#6a3a8a'; c.beginPath(); c.ellipse(cx,e.y+20+bob,7,10,0,0,7); c.fill();
    c.fillStyle='#ff6b6b'; c.fillRect(cx-5,e.y+16+bob,4,4); c.fillRect(cx+1,e.y+16+bob,4,4);
  } else if(K==='shielded'){ // Aegis Crawler: plated dome + big frontal scute
    var f=e.face||((e.vx>=0)?1:-1);
    c.fillStyle=flash?'#fff':'#5a6a7a'; c.beginPath(); c.ellipse(cx,e.y+24,16,12,0,0,7); c.fill();
    c.fillStyle=flash?'#fff':'#39434e';
    for(var pl=0;pl<3;pl++){ c.fillRect(cx-10+pl*7,e.y+15,4,3); }
    c.fillStyle=flash?'#fff':'#9ab4cc'; // the shield itself
    c.beginPath(); c.ellipse(cx+f*15,e.y+24,6,13,0,0,7); c.fill();
    c.strokeStyle='#e8f4ff'; c.lineWidth=1.5; c.beginPath(); c.ellipse(cx+f*15,e.y+24,6,13,0,0,7); c.stroke();
    c.fillStyle='#ffd97a'; c.fillRect(cx-f*4-2,e.y+20,4,4);
  } else if(K==='heavy'){ // Slag Brute: hulking slabs, pauldrons, slam telegraph
    var tel=e.atkT<0.6;
    c.fillStyle=flash?'#fff':'#6a3a22'; c.fillRect(cx-14,e.y+8,28,26);
    c.fillStyle=flash?'#fff':'#8a4a2a'; c.fillRect(cx-19,e.y+6,10,10); c.fillRect(cx+9,e.y+6,10,10);
    c.fillStyle=flash?'#fff':'#3a1c0e'; c.fillRect(cx-8,e.y+2,16,10);
    c.fillStyle=tel?'#ff3d5a':'#ffb03d'; c.fillRect(cx-5,e.y+5,4,4); c.fillRect(cx+1,e.y+5,4,4);
    c.fillStyle=flash?'#fff':'#4a2412'; c.fillRect(cx-12,feet-8,10,8); c.fillRect(cx+2,feet-8,10,8);
    if(tel){ c.strokeStyle='rgba(255,61,90,.8)'; c.lineWidth=2; c.beginPath(); c.arc(cx,feet,26+Math.sin(e.t*20)*3,Math.PI,0); c.stroke(); }
  } else if(K==='ambush'){ // Mire Lurker: dark wisp, visible eyes only when hunting
    if(e.burrow>0){ c.globalAlpha=0.25; }
    c.fillStyle=flash?'#fff':'rgba(20,16,30,1)';
    c.beginPath(); c.ellipse(cx,e.y+22+bob,12,13,0,0,7); c.fill();
    c.fillStyle='rgba(120,80,200,.5)'; c.beginPath(); c.ellipse(cx,e.y+30+bob,8,5,0,0,7); c.fill();
    c.fillStyle='#c09aff'; c.fillRect(cx-6,e.y+16+bob,4,5); c.fillRect(cx+2,e.y+16+bob,4,5);
  } else if(K==='summoner'){ // Rift Acolyte: hooded figure, rift orb staff
    c.fillStyle=flash?'#fff':'#2a1a4a'; c.beginPath(); c.moveTo(cx-11,feet); c.lineTo(cx,e.y+4+bob); c.lineTo(cx+11,feet); c.fill();
    c.fillStyle=flash?'#fff':'#120a24'; c.beginPath(); c.arc(cx,e.y+10+bob,7,0,7); c.fill();
    c.fillStyle='#b388ff'; c.fillRect(cx-3,e.y+8+bob,6,2);
    var ox=cx+12, oy=e.y+22+Math.sin(e.t*4)*3;
    c.strokeStyle=flash?'#fff':'#6a4a9a'; c.lineWidth=2; c.beginPath(); c.moveTo(cx+6,feet-6); c.lineTo(ox,oy); c.stroke();
    var og=c.createRadialGradient(ox,oy,1,ox,oy,9);
    og.addColorStop(0,'#fff'); og.addColorStop(0.5,'#b388ff'); og.addColorStop(1,'rgba(179,136,255,0)');
    c.fillStyle=og; c.beginPath(); c.arc(ox,oy,9,0,7); c.fill();
  } else { c.fillStyle=flash?'#fff':'#c96'; c.fillRect(e.x,e.y,e.w,e.h); }
  c.restore();
  if(elite&&!e.def){ c.fillStyle='#221a05'; c.font='bold 10px sans-serif'; c.textAlign='center'; c.fillText('👑',cx,e.y-8); }
  if(e.burrow>0){ c.globalAlpha=1; }
  // hp bar (minions)
  var w2=32;
  c.fillStyle='rgba(0,0,0,.6)'; c.fillRect(cx-w2/2,e.y-12,w2,5);
  c.fillStyle='#7dff8a'; c.fillRect(cx-w2/2,e.y-12,w2*clamp(e.hp/e.maxHp,0,1),5);
  c.globalAlpha=1;
};
/* Warlords: big silhouettes in their signature color + icon + phase drama. */
E.drawBoss=function(c,b,cx){
  var flash=b.flash>0, col=flash?'#fff':b.def.color;
  var breathe=Math.sin(b.t*3)*3, wob=E.settings.reducedMotion?0:Math.sin(b.t*7)*1.5;
  // horned silhouette
  c.fillStyle=col;
  c.beginPath(); c.moveTo(cx-30,b.y+84); c.lineTo(cx-26,b.y+20+breathe); c.lineTo(cx-38,b.y+2); c.lineTo(cx-16,b.y+12);
  c.lineTo(cx,b.y+4+breathe+wob); c.lineTo(cx+16,b.y+12); c.lineTo(cx+38,b.y+2); c.lineTo(cx+26,b.y+20+breathe);
  c.lineTo(cx+30,b.y+84); c.closePath(); c.fill();
  c.fillStyle='rgba(0,0,0,.45)'; c.fillRect(cx-18,b.y+40+breathe,36,30);
  // burning eyes
  var eg=b.phase===2?'#ff3d5a':'#fff';
  c.fillStyle=eg; c.fillRect(cx-12,b.y+46+breathe,8,7); c.fillRect(cx+4,b.y+46+breathe,8,7);
  // icon sigil
  c.font='26px sans-serif'; c.textAlign='center'; c.fillText(b.def.icon,cx,b.y+72);
  if(b.elite||b.phase===2){ c.fillStyle='#ff3d5a'; c.font='bold 12px sans-serif'; c.fillText('☠ PHASE II',cx,b.y-18); }
  if(b.atkT<0.5&&!E.settings.reducedMotion){ c.strokeStyle=col; c.globalAlpha=0.6; c.lineWidth=2;
    c.beginPath(); c.arc(cx,b.y+42,44+((0.5-b.atkT)*40),0,7); c.stroke(); c.globalAlpha=1; } // attack telegraph ring
};

global.RS_Engine=E;
})(window);
