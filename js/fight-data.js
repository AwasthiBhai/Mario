/* PLAYNOVA — RIFTSTRIKE data (100% original: names, designs, stats).
   6 worlds · 18 levels (3/world) · 8 enemies + elites · 8 bosses ·
   8 weapons (3 melee / 3 ranged / 2 special) · 10 skins · 6 upgrade tracks. */
(function(global){
'use strict';

var WORLDS = [
  { id:0, name:'Ember Dunes', icon:'🏜', desc:'Glass deserts and half-buried furnaces. Learn to dash through cinder imps.',
    sky:['#2a0e04','#7a2d08'], ground:'#3d1c0a', accent:'#ffb03d', fog:'rgba(255,150,50,.10)',
    hazards:['spike','lava'], enemies:['cinder_imp','slag_brute','shard_slinger'], coins:'ember' },
  { id:1, name:'Tideglass Reef', icon:'🪸', desc:'A drowned mirror-city. Ranged foes punish standing still — keep moving.',
    sky:['#02141f','#0a3a4a'], ground:'#0d2b33', accent:'#5df2c8', fog:'rgba(90,240,200,.08)',
    hazards:['spike','water'], enemies:['shard_slinger','gloomwing','mire_lurker'], coins:'pearl' },
  { id:2, name:'Volt Canopy', icon:'🌩', desc:'Storm-tangled treetops. Fast darters and shielded crawlers guard the branches.',
    sky:['#0a0a24','#2a3a6a'], ground:'#1a2438', accent:'#ffe95d', fog:'rgba(255,230,90,.07)',
    hazards:['spike','electric'], enemies:['gust_darter','aegis_crawler','gloomwing'], coins:'spark' },
  { id:3, name:'Frosthowl Peaks', icon:'❄', desc:'Wind-cut ridges. Thin air, heavy brutes, and lurkers under the snow.',
    sky:['#0a1420','#3a5a7a'], ground:'#22394a', accent:'#bfe9ff', fog:'rgba(190,230,255,.10)',
    hazards:['spike','ice'], enemies:['slag_brute','mire_lurker','cinder_imp'], coins:'frost' },
  { id:4, name:'Hollow Foundry', icon:'⚙', desc:'A dead machine that dreams. Elites patrol here — save energy for twin furnaces.',
    sky:['#12060a','#3a1020'], ground:'#241016', accent:'#ff6b6b', fog:'rgba(255,90,90,.08)',
    hazards:['lava','electric'], enemies:['aegis_crawler','rift_acolyte','gust_darter'], coins:'cog' },
  { id:5, name:'Rift Citadel', icon:'🌀', desc:'The wound in the sky. Everything you learned, at once. Seal it.',
    sky:['#05030f','#241a4a'], ground:'#17122b', accent:'#b388ff', fog:'rgba(170,130,255,.10)',
    hazards:['lava','spike','electric'], enemies:['rift_acolyte','aegis_crawler','slag_brute','gloomwing'], coins:'rift' }
];

/* Enemy bestiary: kind drives AI in the engine. All original. */
var ENEMIES = {
  cinder_imp:   { name:'Cinder Imp',   icon:'👺', hp:30,  dmg:8,  speed:70,  kind:'chaser',  score:50,  coins:2, desc:'Melee chaser. Hops toward you.' },
  shard_slinger:{ name:'Shard Slinger',icon:'🗿', hp:26,  dmg:9,  speed:45,  kind:'ranged',  score:70,  coins:3, desc:'Keeps distance, lobs shards.' },
  gust_darter:  { name:'Gust Darter',  icon:'💨', hp:22,  dmg:7,  speed:150, kind:'dasher',  score:80,  coins:3, desc:'Fast. Telegraphs, then lunges.' },
  gloomwing:    { name:'Gloomwing',    icon:'🦇', hp:24,  dmg:8,  speed:90,  kind:'flyer',   score:80,  coins:3, desc:'Flying sine-wave swooper.' },
  aegis_crawler:{ name:'Aegis Crawler',icon:'🛡', hp:55,  dmg:10, speed:40,  kind:'shielded',score:120, coins:4, desc:'Frontal shell blocks slashes.' },
  slag_brute:   { name:'Slag Brute',   icon:'🦍', hp:90,  dmg:16, speed:32,  kind:'heavy',   score:150, coins:5, desc:'Slow, unstoppable, shockwave slam.' },
  mire_lurker:  { name:'Mire Lurker',  icon:'🕳', hp:34,  dmg:12, speed:95,  kind:'ambush',  score:130, coins:4, desc:'Burrows, surfaces beneath you.' },
  rift_acolyte: { name:'Rift Acolyte', icon:'🔮', hp:44,  dmg:11, speed:55,  kind:'summoner',score:180, coins:6, desc:'Blinks away, summons imps.' }
};
var ENEMY_IDS = Object.keys(ENEMIES);

/* 8 warlords — each: 2+ attacks, phase 2 at 50%, unique arena tint + reward. */
var BOSSES = [
  { id:'cinder_maw', name:'Cinder Maw', world:0, icon:'🌋', hp:420, dmg:14, color:'#ff7a3d',
    arena:'Glass Bowl', attacks:['bite_lunge','magma_spit','summon_imps'],
    phases:['Hungry','Furnace-heart (fire trails + faster lunges)'], reward:'Tidecleaver',
    desc:'A furnace that learned to bite. Dodge the lunge, punish the landing.' },
  { id:'abyssal_choir', name:'Abyssal Choir', world:1, icon:'🐚', hp:520, dmg:15, color:'#5df2c8',
    arena:'Sunken Choir', attacks:['note_volley','tide_pull','summon_wings'],
    phases:['Harmony','Dissonance (spiral volleys + pull)'], reward:'Stormcaster',
    desc:'Three voices, one drowning song. Jump the pull-wave.' },
  { id:'stormherald_vex', name:'Stormherald Vex', world:2, icon:'🦅', hp:620, dmg:16, color:'#ffe95d',
    arena:'Crown of Branches', attacks:['dive_bomb','storm_call','gale_push'],
    phases:['Circling','Thunderhead (lightning rods + dives)'], reward:'Frostbite Bow',
    desc:'Owns the sky. Watch the shadow before the dive.' },
  { id:'pale_howl', name:'Pale Howl', world:3, icon:'🐺', hp:740, dmg:18, color:'#bfe9ff',
    arena:'White Throat', attacks:['howl_shards','pounce_combo','ice_patch'],
    phases:['Stalking','Blizzard (slippery ground + shard storm)'], reward:'Wardbell',
    desc:'The mountain\'s hunger. Ice patches persist — lure, don\'t chase.' },
  { id:'furnace_twins_a', name:'Ash Twin — Cinder', world:4, icon:'🔥', hp:480, dmg:16, color:'#ff6b6b',
    arena:'Twin Hearths', attacks:['flame_sweep','twin_swap','summon_crawlers'],
    phases:['Apart','Fused rhythm (swaps + sweeps sync)'], reward:'Foundry Repeater',
    desc:'One of two. They swap arenas when hurt — follow the heat.' },
  { id:'furnace_twins_b', name:'Ash Twin — Slag', world:4, icon:'🪨', hp:480, dmg:17, color:'#ffa53d',
    arena:'Twin Hearths', attacks:['slam_ring','twin_swap','ore_shower'],
    phases:['Apart','Fused rhythm (rings + showers sync)'], reward:'Voltneedle',
    desc:'The heavy twin. Slam rings expand — jump late, not early.' },
  { id:'mirror_of_nyx', name:'Mirror of Nyx', world:5, icon:'🪞', hp:700, dmg:18, color:'#b388ff',
    arena:'Still Water', attacks:['mirror_slash','rift_echo','steal_dash'],
    phases:['Reflection','Shattered (echoes of YOUR weapon)'], reward:'Riftlance',
    desc:'You, with the mercy removed. It copies your equipped weapon.' },
  { id:'riftfather_vaul', name:'Riftfather Vaul', world:5, icon:'🌀', hp:980, dmg:20, color:'#8a4dff',
    arena:'The Wound', attacks:['void_beam','summon_all','gravity_well','starfall'],
    phases:['Waking','Unbound (beams + wells together)'], reward:'Dawnwarden skin',
    desc:'The wound that dreams it is a god. Final exam. No cheap hits — everything is telegraphed.' }
];

/* 8 weapons: 3 melee / 3 ranged / 2 special. Behavior differs, not just numbers. */
var WEAPONS = [
  { id:'emberbrand', name:'Emberbrand', icon:'🗡', cls:'melee', rarity:'common', dmg:14, rate:2.6, range:64, cd:0.38, cost:0,
    desc:'Balanced slash. Wide arc, reliable.', special:'arc', unlock:{type:'start'} },
  { id:'voltneedle', name:'Voltneedle', icon:'🤺', cls:'melee', rarity:'rare', dmg:9, rate:4.2, range:52, cd:0.24, cost:0,
    desc:'Rapier flurry: 3rd hit critically pierces shields.', special:'flurry', unlock:{type:'boss', boss:'furnace_twins_b'} },
  { id:'tidecleaver', name:'Tidecleaver', icon:'🪓', cls:'melee', rarity:'rare', dmg:26, rate:1.4, range:70, cd:0.7, cost:0,
    desc:'Slow greataxe. Shockwave on crit, breaks shields.', special:'shockwave', unlock:{type:'boss', boss:'cinder_maw'} },
  { id:'stormcaster', name:'Stormcaster', icon:'🌩', cls:'ranged', rarity:'rare', dmg:10, rate:2.2, range:420, cd:0.45, cost:6,
    desc:'3-bolt spread. Eats energy, shreds flyers.', special:'spread', unlock:{type:'boss', boss:'abyssal_choir'} },
  { id:'frostbow', name:'Frostbite Bow', icon:'🏹', cls:'ranged', rarity:'epic', dmg:13, rate:1.8, range:520, cd:0.55, cost:8,
    desc:'Piercing arrow that slows whatever it touches.', special:'slow', unlock:{type:'boss', boss:'stormherald_vex'} },
  { id:'repeater', name:'Foundry Repeater', icon:'🔫', cls:'ranged', rarity:'epic', dmg:6, rate:5.0, range:380, cd:0.2, cost:4,
    desc:'Bullet-hose sidearm. Weak per shot, terrifying per second.', special:'rapid', unlock:{type:'boss', boss:'furnace_twins_a'} },
  { id:'wardbell', name:'Wardbell', icon:'🔔', cls:'special', rarity:'epic', dmg:8, rate:1.0, range:150, cd:6.0, cost:30,
    desc:'Nova + brief shield + small heal. The panic button.', special:'nova_heal', unlock:{type:'boss', boss:'pale_howl'} },
  { id:'riftlance', name:'Riftlance', icon:'🌠', cls:'special', rarity:'legend', dmg:40, rate:0.8, range:700, cd:8.0, cost:45,
    desc:'Piercing void beam through everything. Boss-melter.', special:'beam', unlock:{type:'boss', boss:'mirror_of_nyx'} }
];
var WEAPON_IDS = WEAPONS.map(function(w){return w.id;});

/* 10 cosmetic skins. Never pay-to-win: palette + icon only. */
var SKINS = [
  { id:'ember_apprentice', name:'Ember Apprentice', icon:'🧥', rarity:'common', colors:['#ff9a3d','#3a1c05'], unlock:{type:'start'}, desc:'Default warden garb.' },
  { id:'moss_runner', name:'Moss Runner', icon:'🌿', rarity:'common', colors:['#5df2c8','#0a2a1a'], unlock:{type:'levels', n:3}, desc:'Clear 3 levels.' },
  { id:'tideglass_scout', name:'Tideglass Scout', icon:'🐚', rarity:'rare', colors:['#4dd2ff','#0a1a2a'], unlock:{type:'world', world:1}, desc:'Clear Tideglass Reef.' },
  { id:'volt_striker', name:'Volt Striker', icon:'⚡', rarity:'rare', colors:['#ffe95d','#2a2a05'], unlock:{type:'kills', n:150}, desc:'Defeat 150 enemies.' },
  { id:'frosthowl_pelt', name:'Frosthowl Pelt', icon:'❄', rarity:'rare', colors:['#bfe9ff','#10202e'], unlock:{type:'world', world:3}, desc:'Clear Frosthowl Peaks.' },
  { id:'foundry_plate', name:'Foundry Plate', icon:'⚙', rarity:'epic', colors:['#ff6b6b','#1c0a0a'], unlock:{type:'elites', n:10}, desc:'Defeat 10 elites.' },
  { id:'gloomwing_cloak', name:'Gloomwing Cloak', icon:'🦇', rarity:'epic', colors:['#8a4dff','#0d0a1c'], unlock:{type:'coins', n:1500}, desc:'Collect 1500 shards.' },
  { id:'choir_silk', name:'Choir Silk', icon:'🎐', rarity:'epic', colors:['#5df2c8','#3a0a3a'], unlock:{type:'bosses', n:4}, desc:'Fell 4 warlords.' },
  { id:'mirror_shard', name:'Mirror Shard', icon:'🪞', rarity:'legend', colors:['#e8e8ff','#1a1a2e'], unlock:{type:'boss', boss:'mirror_of_nyx'}, desc:'Shatter the Mirror of Nyx.' },
  { id:'dawnwarden', name:'Dawnwarden', icon:'🌅', rarity:'legend', colors:['#ffd97a','#fff3d0'], unlock:{type:'boss', boss:'riftfather_vaul'}, desc:'Seal the Rift. Finish the game.' }
];
var SKIN_IDS = SKINS.map(function(s){return s.id;});

/* 6 upgrade tracks × 5 ranks. Costs in shards. */
var UPGRADES = [
  { id:'vitality', name:'Vitality', icon:'❤', desc:'+18 max HP per rank.', max:5, base:60, growth:1.8 },
  { id:'edge', name:'Edge', icon:'🗡', desc:'+12% attack damage per rank.', max:5, base:80, growth:1.9 },
  { id:'windstep', name:'Windstep', icon:'💨', desc:'Dash cooldown −12% per rank.', max:5, base:70, growth:1.8 },
  { id:'focus', name:'Focus', icon:'⚡', desc:'+20 max energy, +25% regen per rank.', max:5, base:70, growth:1.8 },
  { id:'stride', name:'Stride', icon:'🥾', desc:'+7% move speed & jump per rank.', max:5, base:50, growth:1.7 },
  { id:'surge', name:'Surge', icon:'★', desc:'Specials +18% power, −8% cooldown per rank.', max:5, base:90, growth:2.0 }
];

var ACHIEVEMENTS = [
  { id:'first_blood', name:'First Blood', icon:'🩸', desc:'Defeat your first foe.' },
  { id:'skirmisher', name:'Skirmisher', icon:'⚔', desc:'Defeat 50 enemies.' },
  { id:'warhost', name:'Warhost Bane', icon:'💀', desc:'Defeat 300 enemies.' },
  { id:'giantslayer', name:'Giantslayer', icon:'👑', desc:'Fell your first warlord.' },
  { id:'half_sealed', name:'Half Sealed', icon:'🌓', desc:'Fell 4 warlords.' },
  { id:'riftsealed', name:'Riftsealed', icon:'🌅', desc:'Defeat Riftfather Vaul.' },
  { id:'hoarder', name:'Shard Hoarder', icon:'💰', desc:'Hold 1000 shards at once.' },
  { id:'elite_hunter', name:'Elite Hunter', icon:'🎯', desc:'Defeat 5 elites.' },
  { id:'untouched', name:'Untouched', icon:'🛡', desc:'Clear a level without taking damage.' },
  { id:'speedwarden', name:'Speedwarden', icon:'⏱', desc:'Clear any level in under 90 seconds.' },
  { id:'collector', name:'Collector', icon:'🎨', desc:'Unlock 5 skins.' },
  { id:'armorer', name:'Armorer', icon:'🗡', desc:'Unlock 4 weapons.' }
];

function worldAt(world, level){ // level 0..2 within world
  return { world: world, level: level, index: world*3+level };
}
function totalLevels(){ return 18; }

/* Deterministic per-level composition (engine builds geometry from seed). */
function levelSpec(wi, li){
  var W = WORLDS[wi];
  var seed = wi*100+li*17+7;
  var pool = W.enemies;
  var count = 4 + wi*2 + li*2;           // 4..~16 foes
  var comp = [];
  for(var i=0;i<count;i++){
    var id = pool[(seed + i*3 + (i>4?1:0)) % pool.length];
    comp.push(id);
  }
  var elites = (wi>=2 && li===2) ? 1 : (wi>=4 ? 1 : 0);
  var bossIds = BOSSES.filter(function(b){return b.world===wi;}).map(function(b){return b.id;});
  var isBoss = (li===2);
  return {
    wi:wi, li:li, seed:seed, enemies:comp, elites:elites,
    bosses: isBoss ? bossIds : [],
    coins: 14 + wi*4 + li*3,
    shards: 2 + Math.floor(wi/2),
    hazard: W.hazards[li % W.hazards.length],
    time: 150 + wi*20
  };
}

global.RS_Data = {
  WORLDS:WORLDS, ENEMIES:ENEMIES, ENEMY_IDS:ENEMY_IDS, BOSSES:BOSSES,
  WEAPONS:WEAPONS, WEAPON_IDS:WEAPON_IDS, SKINS:SKINS, SKIN_IDS:SKIN_IDS,
  UPGRADES:UPGRADES, ACHIEVEMENTS:ACHIEVEMENTS,
  worldAt:worldAt, totalLevels:totalLevels, levelSpec:levelSpec,
  weaponById:function(id){ for(var i=0;i<WEAPONS.length;i++) if(WEAPONS[i].id===id) return WEAPONS[i]; return null; },
  skinById:function(id){ for(var i=0;i<SKINS.length;i++) if(SKINS[i].id===id) return SKINS[i]; return null; },
  bossById:function(id){ for(var i=0;i<BOSSES.length;i++) if(BOSSES[i].id===id) return BOSSES[i]; return null; }
};
})(window);
