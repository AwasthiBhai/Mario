/* STARLIT PIP — Reviews: local persistent store (localStorage).
   Designed so it can later be swapped for a server database:
   all access goes through this module's load/add/remove/stats API. */
(function(global){
  'use strict';
  const KEY='starlitPipReviewsV1';
  const MAX_NAME=40, MAX_TEXT=600;
  function uid(){
    try{
      if(global.crypto&&global.crypto.getRandomValues){
        const b=new Uint8Array(12); global.crypto.getRandomValues(b);
        return 'r_'+Date.now().toString(36)+'_'+Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('');
      }
    }catch(e){}
    return 'r_'+Date.now().toString(36)+'_'+Math.floor(Math.random()*1e12).toString(36);
  }
  function readRaw(){
    try{
      const raw=(global.localStorage&&global.localStorage.getItem(KEY))||'[]';
      const arr=JSON.parse(raw);
      return Array.isArray(arr)?arr:[];
    }catch(e){ return []; }
  }
  function writeRaw(arr){
    try{ if(global.localStorage) global.localStorage.setItem(KEY,JSON.stringify(arr)); return true; }
    catch(e){ return false; }
  }
  function sanitizeOne(r){
    if(!r||typeof r!=='object') return null;
    const name=String(r.name||'').trim().slice(0,MAX_NAME);
    const text=String(r.text||'').trim().slice(0,MAX_TEXT);
    const rating=Math.min(5,Math.max(1,parseInt(r.rating,10)||0));
    if(!name||!text||!(rating>=1&&rating<=5)) return null;
    return { id:String(r.id||uid()), name, rating, text,
      createdAt:(typeof r.createdAt==='number'&&r.createdAt>0)?r.createdAt:Date.now() };
  }
  const Reviews={
    MAX_NAME, MAX_TEXT,
    list(){
      return readRaw().map(sanitizeOne).filter(Boolean)
        .sort((a,b)=>b.createdAt-a.createdAt);
    },
    validate(name,rating,text){
      const errors=[];
      name=String(name||'').trim(); text=String(text||'').trim();
      rating=parseInt(rating,10);
      if(!name) errors.push('Please enter a display name.');
      else if(name.length>MAX_NAME) errors.push('Name must be '+MAX_NAME+' characters or fewer.');
      if(!(rating>=1&&rating<=5)) errors.push('Please choose a star rating (1–5).');
      if(!text) errors.push('Please write a review.');
      else if(text.length>MAX_TEXT) errors.push('Review must be '+MAX_TEXT+' characters or fewer.');
      return { ok:errors.length===0, errors };
    },
    add(name,rating,text){
      const v=this.validate(name,rating,text);
      if(!v.ok) return v;
      const review={ id:uid(), name:String(name).trim().slice(0,MAX_NAME),
        rating:parseInt(rating,10), text:String(text).trim().slice(0,MAX_TEXT), createdAt:Date.now() };
      const arr=readRaw(); arr.push(review);
      if(!writeRaw(arr)) return { ok:false, errors:['Could not save the review (storage unavailable).'] };
      return { ok:true, review };
    },
    remove(id){
      const arr=readRaw().filter(r=>r&&r.id!==id);
      return writeRaw(arr);
    },
    stats(){
      const arr=this.list();
      const dist=[0,0,0,0,0];
      let sum=0;
      for(const r of arr){ dist[r.rating-1]++; sum+=r.rating; }
      return { count:arr.length, avg:arr.length?+(sum/arr.length).toFixed(1):0, dist };
    }
  };
  global.SP_Reviews=Reviews;
})(window);
