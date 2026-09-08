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
        // hazard pit or coins arc over gap
        const gx=x, gw=gap;
        const hk=W.hazard;
        if(r()<0.6) hazards.push({x:gx+8,y:GROUND_Y+44,w:gw-16,h:30,kind:(hk==='lava'||hk==='poison')?hk:'pit'});
        const nArc=3+Math.floor(r()*3);
        for(let i=0;i<nArc;i++) coins.push({x:gx+10+i*(gw-20)/Math.max(1,nArc-1),y:GROUND_Y-58-Math.sin(i/(nArc-1)*Math.PI)*38,taken:false});
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
          // both the coins and the gift stay comfortably in reach
          for(let k=0;k<5;k++) coins.push({x:px-40+k*26,y:py-80,taken:false,secret:true});
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
      // coin lines / arcs on ground
      if(r()<0.7){ const n=3+Math.floor(r()*4); const bx=x+20+r()*Math.max(10,gw2-120);
        for(let i=0;i<n;i++) coins.push({x:bx+i*30,y:gyC-50-Math.abs(i-(n-1)/2)*6,taken:false}); }
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
