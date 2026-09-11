/* PLAYNOVA — RIFTSTRIKE save (separate from STARBOUND platformer save).
   KEY: playnovaRiftSaveV1 — NEVER touches starlitPipSaveV1.
   Guests: session-only (progress works this visit, never restored next visit,
   never uploaded). Signed-in: local persist + best-effort cloud sync via the
   existing account system (no second auth). resetVersion mirrors platformer. */
(function(global){
'use strict';
var KEY = 'playnovaRiftSaveV1';
var OUTBOX = 'playnovaRiftOutboxV1';
var RESET_VERSION = 1; // same world-reset epoch as platformer

function hasAccount(){
  try{ var P=global.SP_Profiles; if(P&&typeof P.hasAccount==='function') return !!P.hasAccount(); }catch(e){}
  return true; // fail-safe: preserve
}
function defaults(){
  return {
    v:1, gameDataResetVersion: RESET_VERSION,
    unlockedWorld:0, unlockedLevel:0,       // progress cursor (world 0..5, level 0..2)
    done:{},                                // "w-l": {score,time,coins}
    kills:0, elites:0, bossesDown:[], deaths:0,
    coins:0, totalEarned:0, bestScore:0, bestTime:0,
    weapons:['emberbrand'], equippedWeapon:'emberbrand',
    skins:['ember_apprentice'], equippedSkin:'ember_apprentice',
    upgrades:{vitality:0,edge:0,windstep:0,focus:0,stride:0,surge:0},
    ach:[], playtimeS:0,
    settings:{reducedMotion:false, shake:true}
  };
}
function num(v,lo,hi,fb){ v=Number(v); if(!isFinite(v)) return fb; v=Math.floor(v); return v<lo?lo:(v>hi?hi:v); }
function sanitize(s){
  var d = defaults();
  if(!s||typeof s!=='object') return d;
  var o = Object.assign(d, s);
  o.gameDataResetVersion = Number.isInteger(s.gameDataResetVersion) ? s.gameDataResetVersion : 0;
  o.unlockedWorld = num(o.unlockedWorld,0,5,0);
  o.unlockedLevel = num(o.unlockedLevel,0,2,0);
  if(!o.done||typeof o.done!=='object') o.done={};
  o.kills=num(o.kills,0,999999,0); o.elites=num(o.elites,0,99999,0); o.deaths=num(o.deaths,0,99999,0);
  o.coins=num(o.coins,0,9999999,0); o.totalEarned=num(o.totalEarned,0,99999999,0);
  o.bestScore=num(o.bestScore,0,99999999,0); o.bestTime=num(o.bestTime,0,99999,0);
  var D = global.RS_Data;
  o.weapons = Array.isArray(o.weapons)? o.weapons.filter(function(w){return D&&D.weaponById(w);}) : ['emberbrand'];
  if(!o.weapons.length) o.weapons=['emberbrand'];
  if(!D||!D.weaponById(o.equippedWeapon)) o.equippedWeapon='emberbrand';
  o.skins = Array.isArray(o.skins)? o.skins.filter(function(x){return D&&D.skinById(x);}) : ['ember_apprentice'];
  if(!o.skins.length) o.skins=['ember_apprentice'];
  if(!D||!D.skinById(o.equippedSkin)) o.equippedSkin='ember_apprentice';
  o.upgrades = Object.assign(defaults().upgrades, o.upgrades||{});
  for(var k in o.upgrades) o.upgrades[k]=num(o.upgrades[k],0,5,0);
  if(!Array.isArray(o.bossesDown)) o.bossesDown=[];
  if(!Array.isArray(o.ach)) o.ach=[];
  o.playtimeS=num(o.playtimeS,0,9999999,0);
  return o;
}
function clearProgress(d){
  var f = defaults();
  d.unlockedWorld=0; d.unlockedLevel=0; d.done={};
  d.kills=0; d.elites=0; d.bossesDown=[]; d.deaths=0;
  d.coins=0; d.totalEarned=0; d.bestScore=0; d.bestTime=0;
  d.weapons=['emberbrand']; d.equippedWeapon='emberbrand';
  d.skins=['ember_apprentice']; d.equippedSkin='ember_apprentice';
  d.upgrades=f.upgrades; d.ach=[]; d.playtimeS=0;
  return d;
}
var S = {
  KEY:KEY, RESET_VERSION:RESET_VERSION, data:defaults(),
  load:function(){
    try{
      var raw=null; try{ raw=localStorage.getItem(KEY); }catch(e){}
      this.data = raw ? sanitize(JSON.parse(raw)) : defaults();
    }catch(e){ this.data=defaults(); }
    if(this.data.gameDataResetVersion!==RESET_VERSION){
      clearProgress(this.data);
      this.data.gameDataResetVersion=RESET_VERSION;
      try{ localStorage.removeItem(OUTBOX); }catch(e){}
      this.write();
    }
    if(!hasAccount()) clearProgress(this.data); // guest: session-only
    return this.data;
  },
  write:function(){
    try{
      var payload=this.data;
      if(!hasAccount()){ payload=Object.assign({},this.data); clearProgress(payload); }
      localStorage.setItem(KEY, JSON.stringify(payload));
    }catch(e){}
  },
  applyServerReset:function(rv){
    try{
      rv=Math.floor(Number(rv)); if(!isFinite(rv)||rv<0||rv>99) return false;
      if(this.data.gameDataResetVersion===rv) return false;
      clearProgress(this.data); this.data.gameDataResetVersion=rv;
      try{ localStorage.removeItem(OUTBOX); }catch(e){}
      this.write(); return true;
    }catch(e){ return false; }
  },
  resetAfterWorldWipe:function(){ try{ clearProgress(this.data); try{localStorage.removeItem(OUTBOX);}catch(e){} this.write(); return true; }catch(e){ return false; } },
  resetAll:function(){ this.data=defaults(); this.write(); },
  key:function(w,l){ return w+'-'+l; },
  isUnlocked:function(w,l){
    var c=this.data.unlockedWorld*3+this.data.unlockedLevel;
    return (w*3+l)<=c;
  },
  isDone:function(w,l){ return !!this.data.done[this.key(w,l)]; },
  levelsCompleted:function(){ return Object.keys(this.data.done).length; },
  recordLevel:function(w,l,res){
    var k=this.key(w,l), prev=this.data.done[k]||{};
    var score=Math.max(prev.score||0, res.score||0);
    var time=(prev.time&&prev.time<res.time)?prev.time:res.time;
    this.data.done[k]={score:score,time:time,coins:Math.max(prev.coins||0,res.coins||0)};
    var cursor=this.data.unlockedWorld*3+this.data.unlockedLevel;
    var here=w*3+l;
    if(here>=cursor && here<17){ var nx=here+1; this.data.unlockedWorld=Math.floor(nx/3); this.data.unlockedLevel=nx%3; }
    this.data.kills+=res.kills||0; this.data.elites+=res.elites||0;
    this.data.coins+=res.coins||0; this.data.totalEarned+=res.coins||0;
    if(score>this.data.bestScore) this.data.bestScore=score;
    if(res.time>0&&(this.data.bestTime===0||res.time<this.data.bestTime)) this.data.bestTime=res.time;
    if(res.bosses) for(var i=0;i<res.bosses.length;i++){ if(this.data.bossesDown.indexOf(res.bosses[i])<0) this.data.bossesDown.push(res.bosses[i]); }
    this.checkUnlocks();
    this.write();
    this.sync({level:w*3+l+1, score:score, coins:Math.min(99999,res.coins||0), time:res.time||0,
      world:w, bosses:this.data.bossesDown.length, kills:this.data.kills,
      weapons:this.data.weapons, skins:this.data.skins,
      equippedWeapon:this.data.equippedWeapon, equippedSkin:this.data.equippedSkin,
      upgrades:this.data.upgrades});
    return true;
  },
  addCoins:function(n){ this.data.coins=Math.max(0,this.data.coins+(n|0)); this.write(); },
  spend:function(n){ if(this.data.coins<n) return false; this.data.coins-=n; this.write(); return true; },
  grantWeapon:function(id){ if(this.data.weapons.indexOf(id)<0){ this.data.weapons.push(id); this.achAdd('armorer_check'); this.write(); return true; } return false; },
  grantSkin:function(id){ if(this.data.skins.indexOf(id)<0){ this.data.skins.push(id); this.write(); return true; } return false; },
  equipWeapon:function(id){ var D=global.RS_Data; if(D&&D.weaponById(id)&&this.data.weapons.indexOf(id)>=0){ this.data.equippedWeapon=id; this.write(); return true; } return false; },
  equipSkin:function(id){ var D=global.RS_Data; if(D&&D.skinById(id)&&this.data.skins.indexOf(id)>=0){ this.data.equippedSkin=id; this.write(); return true; } return false; },
  achAdd:function(id){
    if(this.data.ach.indexOf(id)>=0) return false;
    this.data.ach.push(id); this.write();
    try{ if(global.SP_UI&&global.SP_UI.notify) global.SP_UI.notify('🏆 '+id,'success'); }catch(e){}
    return true;
  },
  checkUnlocks:function(){
    var D=global.RS_Data, d=this.data, me=this;
    if(!D) return;
    D.SKINS.forEach(function(sk){
      if(d.skins.indexOf(sk.id)>=0) return;
      var u=sk.unlock, ok=false;
      if(u.type==='levels') ok = Object.keys(d.done).length>=u.n;
      else if(u.type==='world') ok = d.unlockedWorld>u.world || (d.unlockedWorld===u.world&&false) || bossWorldCleared(u.world);
      else if(u.type==='kills') ok = d.kills>=u.n;
      else if(u.type==='coins') ok = d.totalEarned>=u.n;
      else if(u.type==='bosses') ok = d.bossesDown.length>=u.n;
      else if(u.type==='elites') ok = d.elites>=u.n;
      else if(u.type==='boss') ok = d.bossesDown.indexOf(u.boss)>=0;
      if(ok){ d.skins.push(sk.id); me.achAdd('collector_check'); }
    });
    // boss weapon rewards
    d.bossesDown.forEach(function(bid){
      D.WEAPONS.forEach(function(w){
        if(w.unlock&&w.unlock.type==='boss'&&w.unlock.boss===bid&&d.weapons.indexOf(w.id)<0) d.weapons.push(w.id);
      });
    });
    function bossWorldCleared(w){
      // world cleared = its last level done
      return !!d.done[w+'-2'];
    }
  },
  /* ---- cloud sync through existing account (best-effort, never throws) ---- */
  sync:function(payload){
    try{
      var P=global.SP_Profiles;
      if(!P||typeof P.recordFighting!=='function') return Promise.resolve({ok:false});
      if(!hasAccount()) return Promise.resolve({ok:false,error:'guest'});
      return P.recordFighting(payload);
    }catch(e){ return Promise.resolve({ok:false}); }
  },
  pull:function(){
    try{
      var P=global.SP_Profiles;
      if(!P||typeof P.loadFighting!=='function') return Promise.resolve(null);
      if(!hasAccount()) return Promise.resolve(null);
      var me=this;
      return P.loadFighting().then(function(cloud){
        if(!cloud) return null;
        // max-wins merge: cloud never deletes local bests
        if((cloud.kills|0)>(me.data.kills|0)) me.data.kills=cloud.kills|0;
        if((cloud.bestScore|0)>(me.data.bestScore|0)) me.data.bestScore=cloud.bestScore|0;
        (cloud.weapons||[]).forEach(function(w){ if(me.data.weapons.indexOf(w)<0 && global.RS_Data.weaponById(w)) me.data.weapons.push(w); });
        (cloud.skins||[]).forEach(function(x){ if(me.data.skins.indexOf(x)<0 && global.RS_Data.skinById(x)) me.data.skins.push(x); });
        (cloud.bosses||[]).forEach(function(b){ if(me.data.bossesDown.indexOf(b)<0) me.data.bossesDown.push(b); });
        me.write();
        return cloud;
      });
    }catch(e){ return Promise.resolve(null); }
  }
};
global.RS_Save=S;
})(window);
