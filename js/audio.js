/* STARBOUND — AudioManager: 100% original generative WebAudio. No external assets.
   Centralized audio STATE MANAGER. Website screens are SILENT; music plays
   only during active gameplay states (level / boss / ending / jingles). */
(function(global){
  'use strict';
  const AudioMan = {
    ctx:null, master:null, musicGain:null, duckGain:null, fadeGain:null, sfxGain:null,
    settings:{master:80,music:70,sfx:80,muted:false},
    musicTimer:null, musicStep:0, musicKind:null, started:false,
    state:'boot', ducked:false, _wantMusic:null,
    init(settings){
      if(settings) Object.assign(this.settings, settings);
      const AC = (typeof window!=='undefined')&&(window.AudioContext||window.webkitAudioContext);
      if(!AC){ this.disabled=true; return; }
      if(!this.ctx){
        this.ctx=new AC();
        this.master=this.ctx.createGain(); this.master.connect(this.ctx.destination);
        // chain: musicGain (user volume) -> duckGain (pause ducking) -> fadeGain (state fades) -> master
        this.musicGain=this.ctx.createGain(); this.duckGain=this.ctx.createGain();
        this.fadeGain=this.ctx.createGain(); this.fadeGain.gain.value=0;
        this.musicGain.connect(this.duckGain); this.duckGain.connect(this.fadeGain); this.fadeGain.connect(this.master);
        this.sfxGain=this.ctx.createGain(); this.sfxGain.connect(this.master);
        this.applyVolumes();
      }
    },
    resume(){ try{ if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume(); }catch(e){} },
    applyVolumes(){
      if(!this.ctx) return;
      const m=this.settings.muted?0:this.settings.master/100;
      try{
        this.master.gain.value=m*m;
        this.musicGain.gain.value=Math.pow(this.settings.music/100,1.4)*0.5;
        this.sfxGain.gain.value=Math.pow(this.settings.sfx/100,1.2);
      }catch(e){}
    },
    setVolumes(s){
      Object.assign(this.settings,s); this.applyVolumes();
      // if user unmutes mid-gameplay, (re)start the wanted music; if muted, silence now
      try{
        if(this.settings.muted){ this._ramp(this.fadeGain.gain,0,0.15); }
        else if(this._wantMusic&&!this.musicTimer&&this.ctx){ this._startSequencer(this._wantMusic); this._ramp(this.fadeGain.gain,1,1.0); }
      }catch(e){}
    },
    _ramp(param,v,secs){
      if(!this.ctx) return;
      try{
        const t=this.ctx.currentTime;
        param.cancelScheduledValues(t);
        param.setValueAtTime(Math.max(0.0001,param.value),t);
        param.linearRampToValueAtTime(Math.max(0.0001,v),t+Math.max(0.05,secp(secs)));
      }catch(e){ try{ param.value=v; }catch(_){} }
      function secp(s){ return s; }
    },
    /* ---------------- STATE MANAGER ----------------
       States: intro | website | level | boss | paused | complete | gameover | ending
       - website/paused-silent states: no looping music (paused ducks in-engine music instead)
       - complete/gameover: one-shot cue, then silence                                    */
    setState(state,data){
      data=data||{};
      this.state=state;
      if(!this.ctx||this.disabled){ this._wantMusicFor(state,data); if(state==='paused') this.ducked=true; if(state==='resumed') this.ducked=false; return; }
      this.resume();
      switch(state){
        case 'intro':
          this._wantMusic='intro'; this._playKind('intro',1.5); break;
        case 'website':
          this._wantMusic=null; this.stopMusic(0.6); this.duck(false); break;
        case 'level': {
          const kind='world'+(data.world||0);
          this._wantMusic=kind; this._playKind(kind,1.4); this.duck(false); break;
        }
        case 'boss':
          this._wantMusic='boss'; this._playKind('boss',0.9); this.duck(false); break;
        case 'paused':
          this.duck(true); break;
        case 'resumed':
          this.duck(false); break;
        case 'complete':
          this._wantMusic=null; this.stopMusic(0.8); this.jingle('victory'); break;
        case 'gameover':
          this._wantMusic=null; this.stopMusic(0.8); this.jingle('gameover'); break;
        case 'ending':
          this._wantMusic='ending'; this._playKind('ending',1.6); break;
        default:
          this._wantMusic=null; this.stopMusic(0.6);
      }
    },
    _wantMusicFor(state,data){
      // headless / no-AudioContext: still track intent so logic stays testable
      if(state==='level') this._wantMusic='world'+(data.world||0);
      else if(state==='boss') this._wantMusic='boss';
      else if(state==='intro') this._wantMusic='intro';
      else if(state==='ending') this._wantMusic='ending';
      else this._wantMusic=null;
    },
    duck(on){
      this.ducked=!!on;
      if(!this.ctx||!this.duckGain) return;
      this._ramp(this.duckGain.gain,on?0.22:1,0.4);
    },
    _playKind(kind,fadeSecs){
      // never stack two sequencers; restarting the same kind is a no-op
      if(this.musicTimer&&this.musicKind===kind) return;
      this._startSequencer(kind);
      if(this.ctx&&this.fadeGain) this._ramp(this.fadeGain.gain,this.settings.muted?0.0001:1,fadeSecs||1.2);
    },
    jingle(which){
      if(!this.ctx||this.settings.muted) return;
      try{
        if(which==='victory'){ [523,659,784,1046,1318].forEach((f,i)=>this.tone(f,0.3,'triangle',0.22,i*0.12)); }
        else { [330,262,196,131].forEach((f,i)=>this.tone(f,0.32,'sawtooth',0.16,i*0.16)); }
      }catch(e){}
    },
    tone(freq,dur,type,vol,when,slideTo,dest){
      if(!this.ctx||this.settings.muted) return;
      try{
        const t=this.ctx.currentTime+(when||0);
        const o=this.ctx.createOscillator(), g=this.ctx.createGain();
        o.type=type||'sine'; o.frequency.setValueAtTime(freq,t);
        if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,slideTo),t+dur);
        g.gain.setValueAtTime(0.0001,t);
        g.gain.exponentialRampToValueAtTime(vol||0.25,t+0.012);
        g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
        o.connect(g); g.connect(dest||this.sfxGain);
        o.start(t); o.stop(t+dur+0.05);
      }catch(e){}
    },
    noise(dur,vol,when,filterFreq){
      if(!this.ctx||this.settings.muted) return;
      try{
        const t=this.ctx.currentTime+(when||0);
        const len=Math.floor(this.ctx.sampleRate*dur);
        const buf=this.ctx.createBuffer(1,len,this.ctx.sampleRate);
        const d=buf.getChannelData(0);
        for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
        const src=this.ctx.createBufferSource(); src.buffer=buf;
        const f=this.ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=filterFreq||1200;
        const g=this.ctx.createGain(); g.gain.value=vol||0.2;
        src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t);
      }catch(e){}
    },
    /* ------- SFX (allowed on any screen; still muted-aware) ------- */
    sfx(name){
      if(!this.ctx) return; this.resume();
      switch(name){
        case 'jump': this.tone(300,0.18,'square',0.16,0,620); break;
        case 'run': this.tone(200,0.08,'square',0.07,0,300); break;
        case 'coin': this.tone(950,0.09,'sine',0.22); this.tone(1420,0.16,'sine',0.2,0.07); break;
        case 'relic': [660,830,990,1320].forEach((f,i)=>this.tone(f,0.22,'triangle',0.22,i*0.09)); break;
        case 'power': [440,560,680,880].forEach((f,i)=>this.tone(f,0.14,'square',0.12,i*0.06)); break;
        case 'stomp': this.noise(0.14,0.3,0,700); this.tone(220,0.14,'sine',0.25,0,60); break;
        case 'shoot': this.tone(880,0.12,'sawtooth',0.12,0,220); break;
        case 'hurt': this.tone(300,0.3,'sawtooth',0.22,0,90); break;
        case 'death': [400,300,220,140].forEach((f,i)=>this.tone(f,0.2,'sawtooth',0.18,i*0.12)); break;
        case 'checkpoint': this.tone(520,0.14,'triangle',0.22); this.tone(780,0.2,'triangle',0.22,0.1); break;
        case 'goal': [523,659,784,1046,1318].forEach((f,i)=>this.tone(f,0.28,'triangle',0.22,i*0.11)); break;
        case 'click': this.tone(700,0.06,'square',0.12); break;
        case 'bossHit': this.noise(0.2,0.3,0,500); this.tone(150,0.25,'square',0.25,0,70); break;
        case 'bossDie': [300,250,200,150,100,70].forEach((f,i)=>this.tone(f,0.3,'sawtooth',0.2,i*0.14)); this.noise(0.8,0.25,0.2,400); break;
        case 'spring': this.tone(200,0.25,'sine',0.25,0,900); break;
        case 'splash': this.noise(0.25,0.2,0,900); break;
        case 'sting': [220,277,330,440,554,659].forEach((f,i)=>this.tone(f,0.6,'triangle',0.16,i*0.13)); break;
        case 'whoosh': this.noise(0.5,0.15,0,2500); break;
        case 'secret': [880,1108,1318,1760].forEach((f,i)=>this.tone(f,0.18,'sine',0.18,i*0.08)); break;
        case 'break': this.noise(0.18,0.28,0,600); break;
        default: this.tone(500,0.08,'square',0.1);
      }
    },
    /* ------- MUSIC: tiny step sequencer, different scale/tempo per world ------- */
    playMusic(kind){
      // legacy entry (engine/UI): route through the state manager's guarded starter
      this.musicKind=kind||'menu';
      this._wantMusic=this.musicKind;
      this._startSequencer(this.musicKind);
      if(this.ctx&&this.fadeGain) this._ramp(this.fadeGain.gain,1,1.0);
    },
    _startSequencer(kind){
      this.stopTimerOnly();
      this.musicKind=kind;
      if(!this.ctx||this.settings.muted||this.disabled) return;
      this.resume();
      const themes={
        menu:{bpm:96,bass:[130,130,164,196],arp:[261,329,392,523,392,329],wave:'triangle'},
        intro:{bpm:60,bass:[110,98,87,98],arp:[220,261,329,440],wave:'sine'},
        boss:{bpm:150,bass:[82,82,98,73],arp:[164,196,155,185,164,147],wave:'sawtooth'},
        ending:{bpm:100,bass:[132,174,196,147],arp:[264,352,440,528,440,352],wave:'triangle'},
        victory:{bpm:120,bass:[131,165,196,262],arp:[523,659,784,1046],wave:'triangle'}
      };
      const wThemes=[];
      const roots=[196,174,146,131,156,185,165,147,123,220];
      for(let w=0;w<10;w++) wThemes.push({bpm:100+w*6,bass:[roots[w],roots[w],roots[w]*1.25,roots[w]*1.5],arp:[roots[w]*2,roots[w]*2.5,roots[w]*3,roots[w]*4,roots[w]*3,roots[w]*2.5],wave:w%3===2?'square':'triangle'});
      let th=themes[this.musicKind];
      if(!th&&this.musicKind.indexOf('world')===0){ const wi=parseInt(this.musicKind.slice(5),10)||0; th=wThemes[Math.min(9,Math.max(0,wi))]; }
      if(!th) th=themes.menu;
      const stepDur=60/th.bpm/2;
      this.musicStep=0;
      const loop=()=>{
        if(!this.ctx) return;
        if(this.settings.muted){ this.musicTimer=setTimeout(loop,200); return; }
        const i=this.musicStep%8;
        const bar=Math.floor(this.musicStep/8)%4;
        try{
          const t=this.ctx.currentTime;
          const b=th.bass[bar%th.bass.length]/2;
          const o=this.ctx.createOscillator(),g=this.ctx.createGain();
          o.type='sine'; o.frequency.value=b;
          g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.5,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+stepDur*1.8);
          o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t+stepDur*2);
          if(i%2===0){
            const f=th.arp[(i/2+bar)%th.arp.length];
            const o2=this.ctx.createOscillator(),g2=this.ctx.createGain();
            o2.type=th.wave; o2.frequency.value=f;
            g2.gain.setValueAtTime(0.0001,t); g2.gain.exponentialRampToValueAtTime(0.5,t+0.015); g2.gain.exponentialRampToValueAtTime(0.0001,t+stepDur*1.4);
            o2.connect(g2); g2.connect(this.musicGain); o2.start(t); o2.stop(t+stepDur*1.6);
          }
          if(i%2===1){
            const len=Math.floor(this.ctx.sampleRate*0.03);
            const buf=this.ctx.createBuffer(1,len,this.ctx.sampleRate);
            const d=buf.getChannelData(0); for(let k=0;k<len;k++) d[k]=(Math.random()*2-1)*(1-k/len)*0.4;
            const s=this.ctx.createBufferSource(); s.buffer=buf; s.connect(this.musicGain); s.start(t);
          }
        }catch(e){}
        this.musicStep++;
        this.musicTimer=setTimeout(loop,stepDur*1000);
      };
      loop();
    },
    stopTimerOnly(){ if(this.musicTimer){clearTimeout(this.musicTimer); this.musicTimer=null;} },
    stopMusic(fadeSecs){
      this.stopTimerOnly();
      if(this.ctx&&this.fadeGain) this._ramp(this.fadeGain.gain,0.0001,fadeSecs==null?0.6:fadeSecs);
    }
  };
  global.SP_Audio=AudioMan;
})(window);
