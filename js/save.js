/* STARBOUND — SaveSystem (localStorage, corruption-safe) */
(function(global){
  'use strict';
  const KEY='starlitPipSaveV1';
  /* One-time global gameplay reset (RESET_VERSION=1): every pre-reset local
     save is moved to a fresh Level-1 gameplay state exactly once, mirroring
     the server-side wipe of per-level records/coins/attempts/times. Identity
     and preferences are NEVER touched here: theme lives under its own key,
     the profile session under its own key — only pre-reset *gameplay deltas*
     (the sync outbox + the profiles read cache) are dropped so stale numbers
     can neither resurface nor be re-uploaded after the reset. */
  const RESET_VERSION=1;
  const OUTBOX_KEY='starboundProfileOutboxV1';
  const PROFILES_CACHE_KEY='starboundProfilesCacheV1';
  const defaults=()=>({
    version:1, introSeen:false, maxUnlocked:1,
    levels:{}, // "3": {done, bestScore, bestTime, coins, totalCoins, relic}
    totalCoins:0, totalRelics:0, totalScore:0,
    gameDataResetVersion:RESET_VERSION, // one-time migration marker (see load)
    // touch:false = auto (ON for touch devices, OFF for desktop); touch:true = always show.
    // touchOff:true = user explicitly disabled (hides even on touch devices). Old saves merge to false = auto.
    settings:{master:80,music:70,sfx:80,muted:false,touch:false,touchOff:false,reducedMotion:false,shake:true,keys:null}
  });
  function sanitize(s){
    const d=defaults();
    if(!s||typeof s!=='object') return d;
    // A save predating the reset has NO marker: force 0 so load() migrates
    // it exactly once. (Defaults carry the current marker, so this check must
    // inspect the raw object — assign-first would mask pre-reset saves.)
    const hadMarker=Number.isInteger(s.gameDataResetVersion);
    const o=Object.assign(d,s);
    o.gameDataResetVersion=hadMarker?s.gameDataResetVersion:0;
    o.maxUnlocked=Math.min(50,Math.max(1,parseInt(o.maxUnlocked,10)||1));
    o.levels=(o.levels&&typeof o.levels==='object')?o.levels:{};
    o.settings=Object.assign(defaults().settings,o.settings||{});
    return o;
  }
  const Save={
    data:defaults(),
    RESET_VERSION,
    load(){
      try{
        const raw=localStorage.getItem(KEY);
        if(!raw){ this.data=defaults(); return this.data; }
        this.data=sanitize(JSON.parse(raw));
      }catch(e){ this.data=defaults(); }
      this.migrateResetOnce();
      return this.data;
    },
    /* One-time migration: pre-reset saves (no marker) lose ONLY gameplay
       progress — unlocks, per-level bests, coins, relics, totals — and land
       on a fresh Level-1 state. Settings, introSeen, theme (own key) and the
       profile session (own key) are preserved. Post-reset progress is never
       touched again (marker check). Never localStorage.clear(). */
    migrateResetOnce(){
      try{
        if(this.data.gameDataResetVersion===RESET_VERSION) return false;
        this.data.maxUnlocked=1;
        this.data.levels={};
        this.data.totalCoins=0; this.data.totalRelics=0; this.data.totalScore=0;
        this.data.gameDataResetVersion=RESET_VERSION;
        this.write();
        try{ localStorage.removeItem(OUTBOX_KEY); }catch(e){}
        try{ localStorage.removeItem(PROFILES_CACHE_KEY); }catch(e){}
        return true;
      }catch(e){ return false; }
    },
    write(){ try{ localStorage.setItem(KEY,JSON.stringify(this.data)); }catch(e){} },
    reset(){ this.data=defaults(); this.write(); },
    isUnlocked(n){ return n<=this.data.maxUnlocked; },
    recordLevel(n,result){
      const k=String(n), prev=this.data.levels[k]||{};
      const bestScore=Math.max(prev.bestScore||0,result.score||0);
      const bestTime=(prev.bestTime&&prev.bestTime<result.time)?prev.bestTime:result.time;
      this.data.levels[k]={done:true,bestScore,bestTime,
        coins:Math.max(prev.coins||0,result.coins||0),totalCoins:result.totalCoins||prev.totalCoins||0,
        relic:!!(prev.relic||result.relic)};
      if(n>=this.data.maxUnlocked&&n<50) this.data.maxUnlocked=n+1;
      if(n===50) this.data.maxUnlocked=50;
      this.recalcTotals(); this.write();
      return {isBest:(result.score||0)>=(prev.bestScore||0)&&result.score>0};
    },
    recalcTotals(){
      let c=0,r=0,s=0;
      for(const k in this.data.levels){ const L=this.data.levels[k]; c+=L.coins||0; s+=L.bestScore||0; if(L.relic) r++; }
      this.data.totalCoins=c; this.data.totalRelics=r; this.data.totalScore=s;
    },
    completedCount(){ let n=0; for(const k in this.data.levels) if(this.data.levels[k].done) n++; return n; }
  };
  global.SP_Save=Save;
})(window);
