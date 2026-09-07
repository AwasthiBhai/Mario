/* STARLIT PIP — SaveSystem (localStorage, corruption-safe) */
(function(global){
  'use strict';
  const KEY='starlitPipSaveV1';
  const defaults=()=>({
    version:1, introSeen:false, maxUnlocked:1,
    levels:{}, // "3": {done, bestScore, bestTime, coins, totalCoins, relic}
    totalCoins:0, totalRelics:0, totalScore:0,
    settings:{master:80,music:70,sfx:80,muted:false,touch:false,reducedMotion:false,shake:true,keys:null}
  });
  function sanitize(s){
    const d=defaults();
    if(!s||typeof s!=='object') return d;
    const o=Object.assign(d,s);
    o.maxUnlocked=Math.min(50,Math.max(1,parseInt(o.maxUnlocked,10)||1));
    o.levels=(o.levels&&typeof o.levels==='object')?o.levels:{};
    o.settings=Object.assign(defaults().settings,o.settings||{});
    return o;
  }
  const Save={
    data:defaults(),
    load(){
      try{
        const raw=localStorage.getItem(KEY);
        if(!raw){ this.data=defaults(); return this.data; }
        this.data=sanitize(JSON.parse(raw));
      }catch(e){ this.data=defaults(); }
      return this.data;
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
