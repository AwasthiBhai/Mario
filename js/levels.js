/* STARBOUND — Worlds + deterministic 50-level builder (data-driven, no hardcoded maps) */
(function(global){
  'use strict';
  const WORLDS=[
    {name:'Ember Meadow',icon:'🌿',sky:['#7ec8ff','#cdeec0','#5da85f'],ground:'#4c8a3f',groundTop:'#7ed957',plat:'#8a5a2b',hazard:'spikes',weather:'petals',music:0,tip:'Welcome home, Pip! Run and explore.'},
    {name:'Dewdrop Caverns',icon:'💧',sky:['#0b1e4b','#1c3f7a','#0e2a5e'],ground:'#2c3f66',groundTop:'#5DA6FF',plat:'#3f5a8a',hazard:'spikes',weather:'drips',music:1,tip:'Dark in here — relics glow. Look up!'},
    {name:'Cinder Dunes',icon:'🏜',sky:['#ffd98a','#ff9a5c','#c76b2b'],ground:'#b07a3a',groundTop:'#ffd98a',plat:'#7a4a1e',hazard:'sandspikes',weather:'sand',music:2,tip:'Sand gaps are wide — run before you leap.'},
    {name:'Frostfall Peaks',icon:'❄',sky:['#bfe6ff','#e8f6ff','#7fb2dd'],ground:'#5f7fa6',groundTop:'#ffffff',plat:'#3d5a7a',hazard:'icicles',weather:'snow',music:3,tip:'Icy and slippery. Tap, don\'t hold, on thin ridges.'},
    {name:'Treetop Lanterns',icon:'🏮',sky:['#123524','#1f6b4a','#0d2b1f'],ground:'#3d5a2b',groundTop:'#7ed957',plat:'#6b4a1f',hazard:'thorns',weather:'fireflies',music:4,tip:'Up we go! Bouncy mushrooms are your friends.'},
    {name:'Tideglow Reef',icon:'🪸',sky:['#062a4a','#0e5a8a','#123'],ground:'#1f6b7a',groundTop:'#5DF2C8',plat:'#14424e',hazard:'poison',weather:'bubbles',music:5,tip:'Glowing tide hurts — time the moving shells.'},
    {name:'Thunderhead Skyway',icon:'⛈',sky:['#3a3f66','#6b6fb8','#23264a'],ground:'#4a4f7a',groundTop:'#B388FF',plat:'#2c2f52',hazard:'lightning',weather:'rain',music:6,tip:'Sky bridges crumble. Keep moving!'},
    {name:'Magma Hollow',icon:'🌋',sky:['#2b0d12','#7a1e12','#ff5c2b'],ground:'#4a1e1e',groundTop:'#ff8a3d',plat:'#2b1212',hazard:'lava',weather:'embers',music:7,tip:'Floor is lava. Platforms are life.'},
    {name:'Gloomspire Ruins',icon:'🏚',sky:['#14141f','#2c2c44','#0a0a12'],ground:'#3a3a52',groundTop:'#8a8ab8',plat:'#23232f',hazard:'void',weather:'ash',music:8,tip:'The ruins lie — bump suspicious walls.'},
    {name:'Starfall Citadel',icon:'✦',sky:['#060818','#2b1f5e','#FF8A3D'],ground:'#2c2f6b',groundTop:'#FFC94D',plat:'#1a1c44',hazard:'starfire',weather:'stardust',music:9,tip:'The final climb. Everything you learned. Go, Pip!'}
  ];
  const BOSS_NAMES={5:'Gloomcap the Grumbler',10:'Maw of the Deep',15:'Dune Tyrant Sssara',20:'Frost Maw Ymir',25:'Canopy Warden',30:'Reef Siren Coralia',35:'Storm Herald Tempest',40:'Magma Colossus Ignar',45:'Gloomspire King Nox',50:'VOIDSTAR, the Star-Eater'};
  const ENEMY_POOL=[['walker'],['walker','hopper'],['walker','flyer','hopper'],['runner','flyer','hopper'],['runner','spitter','patroller'],['flyer','spitter','brute','patroller'],['runner','spitter','brute','hopper','patroller']];
  function rng32(seed){ let a=seed>>>0; return function(){ a|=0;a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function pick(r,arr){ return arr[Math.floor(r()*arr.length)]; }
  /* Coin layout sanitizer: repositions (never deletes) coins so formations look
     designed — no overlaps, nothing inside solids/hazards/flags, all reachable.
     Jump height ≈115px (745²/2·2400), collection radius 26px x / 34px y. */
  const COIN_R=11, COIN_MIN_D=28;
  function _coinHitsSolid(cx,cy,solids){
    const x0=cx-COIN_R,y0=cy-COIN_R,x1=cx+COIN_R,y1=cy+COIN_R;
    for(const s of solids){
      if(x0<s.x+s.w&&x1>s.x&&y0<s.y+s.h&&y1>s.y) return s;
    }
    return null;
  }
  function _coinHitsHazard(cx,cy,hazards){
    const x0=cx-COIN_R,y0=cy-COIN_R,x1=cx+COIN_R,y1=cy+COIN_R;
    for(const h of hazards){
      if(h.kind==='pit') continue;
      if(x0<h.x+h.w&&x1>h.x&&y0<h.y+h.h&&y1>h.y) return h;
    }
    return null;
  }
  function _flagBoxFor(cp,solids){
    let gy=470;
    for(const s of solids){ if(s.type==='ground'&&cp.x>=s.x&&cp.x<=s.x+s.w){ gy=s.y; break; } }
    return {x:cp.x-16,y:gy-120,w:68,h:120};
  }
  function _coinHitsFlag(cx,cy,checkpoints,solids){
    const x0=cx-COIN_R,y0=cy-COIN_R,x1=cx+COIN_R,y1=cy+COIN_R;
    for(const cp of checkpoints){
      const f=_flagBoxFor(cp,solids);
      if(x0<f.x+f.w&&x1>f.x&&y0<f.y+f.h&&y1>f.y) return f;
    }
    return null;
  }
  function sanitizeCoins(coins,solids,hazards,checkpoints,width,goal){
    if(!coins.length) return;
    const clampX=x=>Math.max(30,Math.min(width-30,x));
    const clampY=y=>Math.max(60,Math.min(490,y));
    function clearOfGeometry(x,y){
      const x0=x-COIN_R,y0=y-COIN_R,x1=x+COIN_R,y1=y+COIN_R;
      for(const s of solids){ if(x0<s.x+s.w&&x1>s.x&&y0<s.y+s.h&&y1>s.y) return false; }
      return true;
    }
    function groundTopAt(px){
      let best=null;
      for(const s of solids){ if(s.type==='ground'&&px>=s.x&&px<=s.x+s.w&&(best===null||s.y<best)) best=s.y; }
      return best;
    }
    // Fully free? bounds + solids + hazards + flags + coin spacing.
    function isFree(x,y,selfIdx){
      if(x<40||x>width-40||y<70||y>470) return false;
      if(!clearOfGeometry(x,y)) return false;
      if(_coinHitsHazard(x,y,hazards)) return false;
      if(_coinHitsFlag(x,y,checkpoints,solids)) return false;
      for(let k=0;k<coins.length;k++){
        if(k===selfIdx) continue;
        const o=coins[k];
        if(o.x<40||o.x>width-40||o.y<70||o.y>470) continue;
        const dx=o.x-x, dy=o.y-y;
        if(dx*dx+dy*dy<COIN_MIN_D*COIN_MIN_D) return false;
      }
      return true;
    }
    // Nearest free spot within maxR (deterministic spiral, formation-preserving:
    // tries small moves first, preferring axis-aligned nudges).
    function findFreeNear(x,y,selfIdx,maxR){
      if(isFree(x,y,selfIdx)) return {x,y};
      const dirs=[[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1]];
      for(let r2=10;r2<=maxR;r2+=10){
        for(const d of dirs){
          const nx=x+d[0]*r2, ny=y+d[1]*r2;
          if(isFree(nx,ny,selfIdx)) return {x:nx,y:ny};
        }
        // also try pure horizontal/vertical at half steps for tight lines
        for(const xx of [x-r2,x+r2]){
          if(isFree(xx,y,selfIdx)) return {x:xx,y};
        }
        for(const yy of [y-r2,y+r2]){
          if(isFree(x,yy,selfIdx)) return {x,y:yy};
        }
      }
      return null;
    }
    // Bounds-aware minimal push out of a solid (avoids edge piling).
    function pushOutOfSolid(c,s){
      const x0=c.x-COIN_R,y0=c.y-COIN_R,x1=c.x+COIN_R,y1=c.y+COIN_R;
      const cands=[
        {dx:0,dy:(s.y-COIN_R-4)-c.y},
        {dx:0,dy:(s.y+s.h+COIN_R+4)-c.y},
        {dx:(s.x-COIN_R-4)-c.x,dy:0},
        {dx:(s.x+s.w+COIN_R+4)-c.x,dy:0}
      ];
      let best=null,bestD=Infinity;
      for(const k of cands){
        const nx=c.x+k.dx, ny=c.y+k.dy;
        if(nx<30||nx>width-30||ny<60||ny>490) continue;
        const d=Math.abs(k.dx)+Math.abs(k.dy);
        if(d<bestD){ bestD=d; best=k; }
      }
      if(best){ c.x+=best.dx; c.y+=best.dy; }
      else{ c.y=s.y-COIN_R-4; c.x=clampX(c.x); c.y=clampY(c.y); }
    }
    // 1) clear solids / hazards / checkpoint flags (minimal, bounds-aware)
    // Out-of-bounds shards (generation can overflow past `width` on long
    // levels) are NOT clamped to the edge pixel (that manufactures exact
    // duplicates) — they are relocated below to free reachable spots.
    const oob=[];
    for(let idx=0;idx<coins.length;idx++){
      const c=coins[idx];
      if(c.x<40||c.x>width-40||c.y<70||c.y>470) oob.push(idx);
      else{ c.x=clampX(c.x); c.y=clampY(c.y); }
    }
    for(let idx=0;idx<coins.length;idx++){
      const c=coins[idx];
      if(c.x<40||c.x>width-40||c.y<70||c.y>470) continue; // relocated later
      for(let k=0;k<4;k++){
        const s=_coinHitsSolid(c.x,c.y,solids);
        if(!s) break;
        const spot=findFreeNear(c.x,c.y,idx,90);
        if(spot){ c.x=spot.x; c.y=spot.y; break; }
        else break;
      }
      for(let k=0;k<3;k++){
        const h=_coinHitsHazard(c.x,c.y,hazards);
        if(!h) break;
        // prefer just above the hazard; fallback to nearby free search
        const ny=h.y-COIN_R-4;
        if(isFree(c.x,ny,idx)){ c.y=ny; }
        else{
          const spot=findFreeNear(c.x,c.y,idx,80);
          if(spot){ c.x=spot.x; c.y=spot.y; break; }
          else break;
        }
      }
      for(let k=0;k<3;k++){
        const f=_coinHitsFlag(c.x,c.y,checkpoints,solids);
        if(!f) break;
        const leftX=f.x-COIN_R-4, rightX=f.x+f.w+COIN_R+4;
        if(isFree(leftX,c.y,idx)) c.x=leftX;
        else if(isFree(rightX,c.y,idx)) c.x=rightX;
        else{
          const spot=findFreeNear(c.x,c.y,idx,80);
          if(spot){ c.x=spot.x; c.y=spot.y; break; }
          else break;
        }
      }
    }
    // Relocate out-of-bounds shards to free reachable spots (never edge-clamp).
    // Scans ground lines left→right, trying walkable height first (-70) then
    // jump height (-100), keeping 34px lanes so relocated shards form clean
    // intentional lines instead of stacks.
    function spotFree(x,y,selfIdx){
      if(x<50||x>width-50||y<70||y>470) return false;
      if(!clearOfGeometry(x,y)) return false;
      if(_coinHitsHazard(x,y,hazards)) return false;
      if(_coinHitsFlag(x,y,checkpoints,solids)) return false;
      for(let k=0;k<coins.length;k++){
        if(k===selfIdx) continue;
        const o=coins[k];
        if(o.x<40||o.x>width-40||o.y<70||o.y>470) continue; // other pending OOB, ignore
        const dx=o.x-x, dy=o.y-y;
        if(dx*dx+dy*dy<COIN_MIN_D*COIN_MIN_D) return false;
      }
      return true;
    }
    for(const idx of oob){
      const c=coins[idx];
      let done=false;
      for(let x=100;x<=width-100&&!done;x+=34){
        const gy=groundTopAt(x);
        if(gy===null) continue;
        const tries=[gy-70,gy-100,gy-90,gy-60];
        for(const ty of tries){
          if(spotFree(x,ty,idx)){ c.x=x; c.y=ty; done=true; break; }
        }
      }
      if(!done){
        // last resort: clamp inside (should be rare; spacing pass keeps it free)
        c.x=clampX(Math.min(Math.max(c.x,50),width-50)); c.y=clampY(c.y);
      }
    }
    // 2) coin-to-coin spacing: conservative sweep, moves ONLY the later coin.
    // Prefers the formation-preserving push along the pair axis, but only into
    // fully free space (solids/hazards/flags/spacing/bounds); otherwise searches
    // nearby free so no new overlap is ever manufactured.
    for(let i=0;i<coins.length;i++){
      for(let j=i+1;j<coins.length;j++){
        const a=coins[i], b=coins[j];
        const dx=b.x-a.x, dy=b.y-a.y;
        const d=Math.sqrt(dx*dx+dy*dy);
        if(d>=COIN_MIN_D) continue;
        if(d<0.001){
          const spot=findFreeNear(b.x,b.y,j,80);
          if(spot){ b.x=spot.x; b.y=spot.y; }
          continue;
        }
        const need=COIN_MIN_D-d;
        const nx=dx/d, ny=dy/d;
        const tx=b.x+nx*need, ty=b.y+ny*need;
        if(isFree(tx,ty,j)){ b.x=tx; b.y=ty; continue; }
        const spot=findFreeNear(b.x,b.y,j,70);
        if(spot){ b.x=spot.x; b.y=spot.y; }
      }
    }
    for(const c of coins){ c.x=clampX(c.x); c.y=clampY(c.y); }
    // re-clear geometry after spacing (free-searching, never manufactures)
    for(let idx=0;idx<coins.length;idx++){
      const c=coins[idx];
      for(let k=0;k<3;k++){
        const s=_coinHitsSolid(c.x,c.y,solids);
        if(!s) break;
        const spot=findFreeNear(c.x,c.y,idx,80);
        if(spot){ c.x=spot.x; c.y=spot.y; break; }
        else break;
      }
      const f=_coinHitsFlag(c.x,c.y,checkpoints,solids);
      if(f){
        const leftX=f.x-COIN_R-4, rightX=f.x+f.w+COIN_R+4;
        if(isFree(leftX,c.y,idx)) c.x=leftX;
        else if(isFree(rightX,c.y,idx)) c.x=rightX;
        else{
          const spot=findFreeNear(c.x,c.y,idx,70);
          if(spot){ c.x=spot.x; c.y=spot.y; }
        }
      }
      if(_coinHitsHazard(c.x,c.y,hazards)){
        const spot=findFreeNear(c.x,c.y,idx,70);
        if(spot){ c.x=spot.x; c.y=spot.y; }
      }
    }
    // 3) reachability guard — every coin must sit within a normal jump
    // (≈115px up, generous horizontal) of some standable solid. Gap-arc coins
    // over pits are reachable via the jump across, so allow 160px side reach.
    // Moves land on fully free spots so reachability never manufactures overlap.
    for(let idx=0;idx<coins.length;idx++){
      const c=coins[idx];
      let best=null, bestDy=Infinity;
      for(const s of solids){
        if(s.type==='hidden') continue;
        const dy=s.y-c.y;
        if(dy<-20||dy>200) continue;
        if(c.x>=s.x-100&&c.x<=s.x+s.w+100){
          if(dy<bestDy){ bestDy=dy; best=s; }
        }
      }
      if(!best){
        let gy=null;
        for(const s of solids){
          if(s.type!=='ground') continue;
          if(c.x>=s.x-160&&c.x<=s.x+s.w+160){ if(gy===null||s.y<gy) gy=s.y; }
        }
        if(gy!==null){
          const ty=clampY(gy-80);
          if(isFree(c.x,ty,idx)) c.y=ty;
          else{
            const spot=findFreeNear(c.x,ty,idx,70);
            if(spot){ c.x=spot.x; c.y=spot.y; }
          }
        }
      } else if(bestDy>150){
        const ty=clampY(best.y-110);
        if(isFree(c.x,ty,idx)) c.y=ty;
        else{
          const spot=findFreeNear(c.x,ty,idx,70);
          if(spot){ c.x=spot.x; c.y=spot.y; }
        }
      }
    }
    // 4) final light pass for residuals after reachability (same conservative
    // rule: move later coin only, into fully free space)
    for(let i=0;i<coins.length;i++) for(let j=i+1;j<coins.length;j++){
      const a=coins[i], b=coins[j];
      const dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy);
      if(d>=COIN_MIN_D||d<0.001) continue;
      const need=COIN_MIN_D-d, nx=dx/d, ny=dy/d;
      const tx=b.x+nx*need, ty=b.y+ny*need;
      if(isFree(tx,ty,j)){ b.x=tx; b.y=ty; continue; }
      const spot=findFreeNear(b.x,b.y,j,60);
      if(spot){ b.x=spot.x; b.y=spot.y; }
    }
    for(const c of coins){ c.x=clampX(c.x); c.y=clampY(c.y); }
    // keep clear of geometry after final nudges (free-searching)
    for(let idx=0;idx<coins.length;idx++){
      const c=coins[idx];
      for(let k=0;k<3;k++){
        const s=_coinHitsSolid(c.x,c.y,solids);
        if(!s) break;
        const spot=findFreeNear(c.x,c.y,idx,80);
        if(spot){ c.x=spot.x; c.y=spot.y; break; }
        else break;
      }
      if(_coinHitsHazard(c.x,c.y,hazards)||_coinHitsFlag(c.x,c.y,checkpoints,solids)){
        const spot=findFreeNear(c.x,c.y,idx,70);
        if(spot){ c.x=spot.x; c.y=spot.y; }
      }
    }
  }

  function buildLevel(num){
    const world=Math.min(9,Math.floor((num-1)/5));
    const idx=(num-1)%5; // 0..4 within world; 4 = boss level
    const W=WORLDS[world];
    const diff=Math.min(1,(num-1)/49); // 0..1
    const r=rng32(num*7919+world*131+7);
    const isBoss=(idx===4);
    const GROUND_Y=470;
    const width=isBoss?3400:2400+Math.floor(num*55+r()*300);
    const solids=[],coins=[],enemies=[],powerups=[],checkpoints=[],hazards=[];
    // checkpoint columns first: plates placed below must keep these clear so
    // no platform ever crosses a checkpoint flag (pole at x, pennant to x+44)
    const nCp=2+Math.floor(diff*2);
    const cpRawXs=[];
    for(let i=1;i<=nCp;i++) cpRawXs.push((width-700)*i/(nCp+1)+200);
    const placedPlats=[]; // non-ground solids, for overlap checks
    // continuous start ground
    let x=0;
    const segs=[];
    // spawn flat
    solids.push({x:-40,y:GROUND_Y,w:520,h:140,type:'ground'});
    x=480;
    const gapBase=70+diff*90;
    const nSeg=Math.max(6,Math.floor(width/260));
    let secretPlaced=false, relic=null;
    for(let s=0;s<nSeg;s++){
      const last=s===nSeg-1;
      const segW=170+r()*130;
      const gap=last?0:(r()<0.75?Math.min(165,gapBase*(0.6+r()*0.9)):0);
      if(gap>4){
        // hazard pit or coins arc over gap — clean spacing without deleting:
        // keep the designed 3-5 shard arc, widen onto the lips so even tiny
        // gaps achieve 30px center spacing; smooth sin arc preserved.
        const gx=x, gw=gap;
        const hk=W.hazard;
        if(r()<0.6) hazards.push({x:gx+8,y:GROUND_Y+44,w:gw-16,h:30,kind:(hk==='lava'||hk==='poison')?hk:'pit'});
        const nArc=3+Math.floor(r()*3);
        const spanW=Math.max(gw+40,(nArc-1)*30);
        const x0=gx-(spanW-gw)/2;
        for(let i=0;i<nArc;i++){
          const t=nArc===1?0.5:i/(nArc-1);
          coins.push({x:x0+t*spanW,y:GROUND_Y-58-Math.sin(t*Math.PI)*38,taken:false});
        }
        x+=gap;
      }
      const gw2=last?560:segW;
      const gy=GROUND_Y+(r()-0.5)*(diff*70);
      const gyC=Math.max(380,Math.min(490,gy));
      solids.push({x,y:gyC,w:gw2,h:200,type:'ground'});
      const cx=x+gw2/2;
      // platforms above — capped so every platform is reachable with a normal
      // full-hold jump (jump height ≈115px: 745²/2·2400). Max rise is 95px,
      // so the tallest rolls still need a good jump without ever requiring
      // glitches, springs or pixel-perfect runs. Jump physics untouched.
      const nPlat=1+Math.floor(r()*(1+diff*3));
      for(let p=0;p<nPlat;p++){
        const kindRoll=r();
        let type='block';
        if(kindRoll<0.30-0.1*diff) type='block';
        else if(kindRoll<0.52) type='move';
        else if(kindRoll<0.64) type='fall';
        else if(kindRoll<0.74) type='bouncy';
        else if(kindRoll<0.82) type='break';
        else if(kindRoll<0.90) type='oneway';
        else type='hidden';
        const w=type==='oneway'?110:70+r()*70;
        // a few candidate spots: never stack on another plate (8px pad) and
        // never cross a checkpoint flag column; skip instead of overlapping
        let px=0,py=0,spot=false;
        for(let t=0;t<8&&!spot;t++){
          px=x+20+r()*(gw2-120); py=gyC-58-r()*(22+diff*15);
          spot=true;
          for(const o of placedPlats){
            if(px<o.x+o.w+8&&px+w>o.x-8&&py<o.y+o.h+8&&py+22>o.y-8){ spot=false; break; }
          }
          if(spot) for(const fx of cpRawXs){
            if(px<fx+50&&px+w>fx-14){ spot=false; break; }
          }
        }
        if(!spot) continue;
        const s2={x:px,y:py,w,h:22,type};
        if(type==='move'){ s2.axis=r()<0.7?'x':'y'; s2.range=s2.axis==='y'?25+r()*35:35+r()*45; s2.speed=0.7+r()*1.4+diff; s2.phase=r()*6.28; s2.ox=px; s2.oy=py; }
        if(type==='fall'){ s2.respawn=4; }
        s2._coin=-1; // attached-coin index for later de-conflict moves
        placedPlats.push(s2);
        solids.push(s2);
        if(r()<0.55){ s2._coin=coins.length; coins.push({x:px+w/2,y:py-34,taken:false}); }
        if(!secretPlaced&&r()<0.10&&type==='hidden'){ // secret cache above hidden block
          secretPlaced=true; s2._secret=true; // secret carriers never move
          // standing on the revealed block (jump ≈115px),
          // both the coins and the gift stay comfortably in reach.
          // 30px spacing = clean line, no visual overlap (coin Ø22).
          for(let k=0;k<5;k++) coins.push({x:px+w/2-60+k*30,y:py-80,taken:false,secret:true});
          powerups.push({x:px+w/2,y:py-95,kind:pick(r,['shield','heart','star']),secret:true,taken:false});
        }
      }
      // enemies on this ground
      const pool=ENEMY_POOL[Math.min(ENEMY_POOL.length-1,Math.floor(diff*ENEMY_POOL.length+r()*2))];
      const nE=(world===0&&num<=3)?(s%2===0?1:0):(1+Math.floor(r()*(1+diff*2.2)));
      for(let e=0;e<nE;e++){
        const kind=pick(r,pool.concat(diff>0.5?['brute','spitter']:[]));
        enemies.push({x:x+40+r()*(gw2-90),y:gyC-40,kind,vx:0,vy:0,dir:r()<0.5?-1:1,t: r()*5,alive:true,ph:r()*6.28});
      }
      // ground hazards (spikes etc.)
      if(num>4&&r()<0.25+diff*0.4){
        hazards.push({x:x+30+r()*(gw2-80),y:gyC-24,w:34,h:24,kind:W.hazard});
      }
      // coin lines / arcs on ground — candidates avoid platform bodies so shards
      // never spawn inside geometry; final sanitize pass enforces spacing.
      // NOTE: candidate offsets are deterministic (no extra rng) so the level
      // seed sequence — and therefore coin counts/difficulty — never shifts.
      if(r()<0.7){
        const n=3+Math.floor(r()*4);
        const bx0=x+20+r()*Math.max(10,gw2-120);
        const maxShift=Math.max(0,gw2-30*(n-1)-40);
        let bx=bx0;
        for(let attempt=0;attempt<8;attempt++){
          const tx=(attempt===0)?bx0:(x+20+((attempt*67+n*13)%Math.max(10,maxShift+10)));
          let clean=true;
          for(let i=0;i<n&&clean;i++){
            const cx=tx+i*30, cy=gyC-50-Math.abs(i-(n-1)/2)*6;
            const box={x:cx-13,y:cy-13,w:26,h:26};
            for(const o of placedPlats){
              if(box.x<o.x+o.w&&box.x+box.w>o.x&&box.y<o.y+o.h&&box.y+box.h>o.y){ clean=false; break; }
            }
          }
          if(clean){ bx=tx; break; }
          if(attempt===7) bx=tx; // last candidate even if imperfect (sanitizer fixes)
        }
        for(let i=0;i<n;i++) coins.push({x:bx+i*30,y:gyC-50-Math.abs(i-(n-1)/2)*6,taken:false});
      }
      // relic: hide in one segment — always within a normal jump of the ground
      if(!relic&&((s===Math.floor(nSeg/2)&&r()<0.6)||s===nSeg-2)){
        relic={x:x+gw2/2,y:gyC-88-r()*14,taken:false};
      }
      x+=gw2;
    }
    // checkpoints every ~quarter, snapped to safe ground: supported stance,
    // clear of hazards and plates, inside the world and off the goal / boss
    // approach — so flags never float over holes and respawns never loop
    function stanceTop(px){
      let best=null;
      for(const s of solids){ if(s.type!=='ground') continue; if(px>=s.x&&px<=s.x+s.w&&(best===null||s.y<best)) best=s.y; }
      return best;
    }
    function boxHitsHazard(bx,by,bw,bh){
      for(const h of hazards){ if(bx<h.x+h.w&&bx+bw>h.x&&by<h.y+h.h&&by+bh>h.y) return true; }
      return false;
    }
    function plateCrossesFlag(px,gy){
      for(const s of placedPlats){ if(px<s.x+s.w+14&&px+50>s.x-14&&gy-118<s.y+s.h&&gy>s.y) return true; }
      return false;
    }
    function snapCheckpoint(x0){
      const lo=isBoss?60:40, hi=isBoss?width-760:width-320;
      const okX=x=>x>=lo&&x<=hi;
      const good=x=>{
        if(!okX(x)) return false;
        const gy=stanceTop(x); if(gy===null) return false;
        if(boxHitsHazard(x-14,gy-42,28,42)) return false;
        if(plateCrossesFlag(x,gy)) return false;
        return true;
      };
      if(good(x0)) return x0;
      for(let d=20;d<=260;d+=20){ if(good(x0-d)) return x0-d; if(good(x0+d)) return x0+d; }
      // fallback: supported + hazard-clear even if a plate is near, else clamp
      const sup=x=>{ if(!okX(x)) return false; const gy=stanceTop(x); return gy!==null&&!boxHitsHazard(x-14,gy-42,28,42); };
      if(sup(x0)) return x0;
      for(let d=20;d<=400;d+=20){ if(sup(x0-d)) return x0-d; if(sup(x0+d)) return x0+d; }
      return Math.max(lo,Math.min(hi,x0));
    }
    for(let i=0;i<cpRawXs.length;i++){ checkpoints.push({x:snapCheckpoint(cpRawXs[i]),y:0,on:false}); }
    // resolve leftover flag/plate crossings by shifting the plate itself (with
    // its attached coin, same height, so reachability never changes) or, with
    // no room, dropping that one plate+coin. Secret carriers never move and
    // flags stay on their safe snapped ground.
    for(const c of checkpoints){
      const gy=stanceTop(c.x); if(gy===null) continue;
      for(let pi=placedPlats.length-1;pi>=0;pi--){
        const s=placedPlats[pi];
        if(!(c.x<s.x+s.w+14&&c.x+50>s.x-14&&gy-118<s.y+s.h&&gy>s.y)) continue;
        if(s._secret) continue;
        const hitsFlag=(nx,w2)=>{ for(const c2 of checkpoints){ const fx=c2.x; if(nx<fx+50&&nx+w2>fx-14) return true; } return false; };
        let done=false;
        for(const dir of [-1,1]){
          for(let d=20;d<=140&&!done;d+=20){
            const nx=s.x+dir*d;
            if(nx<20||nx+s.w>width-40) continue;
            let clash=false;
            for(const o of placedPlats){ if(o===s) continue; if(nx<o.x+o.w+8&&nx+s.w>o.x-8&&s.y<o.y+o.h+8&&s.y+22>o.y-8){ clash=true; break; } }
            if(clash||hitsFlag(nx,s.w)) continue;
            s.x=nx;
            if(s.type==='move') s.ox=nx;
            if(s._coin>=0&&coins[s._coin]) coins[s._coin].x=nx+s.w/2;
            done=true;
          }
          if(done) break;
        }
        if(!done){
          const si=solids.indexOf(s); if(si>=0) solids.splice(si,1);
          if(s._coin>=0){ coins.splice(s._coin,1); for(const o of placedPlats) if(o._coin>s._coin) o._coin--; }
          placedPlats.splice(pi,1);
        }
      }
    }
    for(const s of placedPlats){ delete s._secret; delete s._coin; }
    // powerups: snapped 70px above the actual ground beneath them, so every
    // gift is collectible with a normal jump (jump height ≈115px)
    function groundTopAtX(px){
      let best=GROUND_Y;
      for(const s of solids){ if(s.type==='ground'&&px>=s.x&&px<=s.x+s.w&&s.y<best) best=s.y; }
      return best;
    }
    powerups.push({x:560,y:groundTopAtX(560)-70,kind:num<4?'heart':pick(r,['heart','shield']),taken:false});
    powerups.push({x:width*0.5,y:groundTopAtX(width*0.5)-70,kind:pick(r,['star','spring','speed','shield']),taken:false});
    if(isBoss) powerups.push({x:width-900,y:groundTopAtX(width-900)-70,kind:'star',taken:false});
    if(!relic) relic={x:width*0.6,y:groundTopAtX(width*0.6)-95,taken:false};
    // goal
    const goal={x:width-260,y:GROUND_Y-160};
    // boss arena: flatten end + walls
    let boss=null;
    if(isBoss){
      const ax=width-700;
      solids.push({x:ax,y:GROUND_Y,w:760,h:200,type:'ground'});
      boss={name:BOSS_NAMES[num]||('Boss '+num),hp:3+Math.floor(num/6)+(num===50?6:0),maxhp:3+Math.floor(num/6)+(num===50?6:0),x:width-380,y:GROUND_Y-90,phase:1,t:0};
    }
    // Clean coin layout: reposition only (never delete) so shards look designed —
    // no coin-to-coin overlaps, nothing inside solids/hazards/flags, all reachable.
    try{ sanitizeCoins(coins,solids,hazards,checkpoints,width,goal); }catch(e){}
    return {
      num,world,worldName:W.name,theme:W,tip:W.tip,width,height:540,
      spawn:{x:60,y:GROUND_Y-80},solids,coins,enemies,powerups,checkpoints,hazards,goal,relic,
      timeLimit:isBoss?420:120+Math.floor(width/22),isBoss,boss,
      name:'Level '+num+(isBoss?(' — BOSS: '+(BOSS_NAMES[num]||'')):'')
    };
  }
  function levelName(num){ const w=Math.floor((num-1)/5); return 'Level '+num+' · '+WORLDS[w].name; }
  global.SP_Levels={WORLDS,BOSS_NAMES,buildLevel,levelName};
})(window);
