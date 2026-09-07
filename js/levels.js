/* STARBOUND — Worlds + deterministic 50-level builder (data-driven, no hardcoded maps) */
(function(global){
  'use strict';
  const WORLDS=[
    {name:'Ember Meadow',icon:'🌿',sky:['#7ec8ff','#cdeec0','#5da85f'],ground:'#4c8a3f',groundTop:'#7ed957',plat:'#8a5a2b',hazard:'spikes',weather:'petals',music:0,tip:'Welcome home, Pip! Hold SHIFT to run.'},
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
        for(let i=0;i<nArc;i++) coins.push({x:gx+10+i*(gw-20)/Math.max(1,nArc-1),y:GROUND_Y-70-Math.sin(i/(nArc-1)*Math.PI)*50,taken:false});
        x+=gap;
      }
      const gw2=last?560:segW;
      const gy=GROUND_Y+(r()-0.5)*(diff*70);
      const gyC=Math.max(380,Math.min(490,gy));
      solids.push({x,y:gyC,w:gw2,h:200,type:'ground'});
      const cx=x+gw2/2;
      // platforms above
      const nPlat=1+Math.floor(r()*(1+diff*3));
      for(let p=0;p<nPlat;p++){
        const px=x+20+r()*(gw2-120), py=gyC-90-r()*(60+diff*110);
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
        const s2={x:px,y:py,w,h:22,type};
        if(type==='move'){ s2.axis=r()<0.7?'x':'y'; s2.range=50+r()*90; s2.speed=0.7+r()*1.4+diff; s2.phase=r()*6.28; s2.ox=px; s2.oy=py; }
        if(type==='fall'){ s2.respawn=4; }
        solids.push(s2);
        if(r()<0.55) coins.push({x:px+w/2,y:py-34,taken:false});
        if(!secretPlaced&&r()<0.10&&type==='hidden'){ // secret cache above hidden block
          secretPlaced=true;
          for(let k=0;k<5;k++) coins.push({x:px-40+k*26,y:py-90,taken:false,secret:true});
          powerups.push({x:px+w/2,y:py-120,kind:pick(r,['shield','heart','star']),secret:true,taken:false});
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
      // relic: hide in one segment (higher / off-path in later levels)
      if(!relic&&((s===Math.floor(nSeg/2)&&r()<0.6)||s===nSeg-2)){
        relic={x:x+gw2/2,y:gyC-170-(diff*60),taken:false};
      }
      x+=gw2;
    }
    // checkpoints every ~quarter
    const nCp=2+Math.floor(diff*2);
    for(let i=1;i<=nCp;i++){ const px2=(width-700)*i/(nCp+1)+200; checkpoints.push({x:px2,y:0,on:false}); }
    // powerups: one early, one mid; boss levels get star before arena
    powerups.push({x:560,y:GROUND_Y-120,kind:num<4?'heart':pick(r,['heart','shield']),taken:false});
    powerups.push({x:width*0.5,y:GROUND_Y-200,kind:pick(r,['star','spring','speed','shield']),taken:false});
    if(isBoss) powerups.push({x:width-900,y:GROUND_Y-140,kind:'star',taken:false});
    if(!relic) relic={x:width*0.6,y:GROUND_Y-220,taken:false};
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
