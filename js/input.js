/* STARBOUND — Input: keyboard (remappable) + touch + gamepad */
(function(global){
  'use strict';
  const DEFAULTS={left:'KeyA',right:'KeyD',jump:'Space',down:'KeyS',run:'ShiftLeft',action:'KeyE',pause:'Escape',altJump:'KeyW'};
  /* Normalize a keyboard event to its engine code (event.code based).
     Handles legacy names (Esc/Spacebar) and falls back to event.key when
     event.code is missing. Display names are NEVER used as codes. */
  function normCode(code,key){
    if(!code||code===''){
      if(!key) return '';
      if(key===' '||key==='Spacebar') return 'Space';
      if(key==='Esc') return 'Escape';
      if(key==='Shift') return 'ShiftLeft';
      if(key==='Left') return 'ArrowLeft';
      if(key==='Right') return 'ArrowRight';
      if(key==='Up') return 'ArrowUp';
      if(key==='Down') return 'ArrowDown';
      if(typeof key==='string'&&key.length===1){
        const u=key.toUpperCase();
        if(u>='A'&&u<='Z') return 'Key'+u;
        if(u>='0'&&u<='9') return 'Digit'+u;
        if(key===' ') return 'Space';
      }
      return key;
    }
    if(code==='Esc') return 'Escape';
    if(code==='Spacebar') return 'Space';
    return code;
  }
  function isShiftCode(c){ return c==='ShiftLeft'||c==='ShiftRight'||c==='Shift'; }
  /* Human-readable display only — never used for gameplay matching. */
  function prettyCode(c){
    if(!c) return '';
    if(c==='ShiftLeft'||c==='ShiftRight'||c==='Shift') return 'Shift';
    if(c==='Space'||c==='Spacebar') return 'Space';
    if(c==='Escape'||c==='Esc') return 'Escape';
    if(c==='ArrowLeft') return '◀';
    if(c==='ArrowRight') return '▶';
    if(c==='ArrowUp') return '▲';
    if(c==='ArrowDown') return '▼';
    if(c==='Enter') return 'Enter';
    if(c==='Tab') return 'Tab';
    if(c==='Backspace') return 'Backspace';
    if(c.indexOf('Key')===0&&c.length===4) return c.slice(3);
    if(c.indexOf('Digit')===0&&c.length===6) return c.slice(5);
    return c;
  }
  /* Convert a stored/display value back to a real event.code (for
     forward-compat with old saves that may hold pretty names). */
  function storedToCode(v){
    if(!v||typeof v!=='string') return '';
    const n=normCode(v,null);
    if(n!==v) return n;
    if(v==='Shift') return 'ShiftLeft';
    if(v==='Esc') return 'Escape';
    if(v==='Left'||v==='◀'||v==='←') return 'ArrowLeft';
    if(v==='Right'||v==='▶'||v==='→') return 'ArrowRight';
    if(v==='Up'||v==='▲'||v==='↑') return 'ArrowUp';
    if(v==='Down'||v==='▼'||v==='↓') return 'ArrowDown';
    if(v.length===1){
      const u=v.toUpperCase();
      if(u>='A'&&u<='Z') return 'Key'+u;
      if(u>='0'&&u<='9') return 'Digit'+u;
      if(v===' ') return 'Space';
    }
    return v;
  }
  const Input={
    keys:{}, pressed:{}, map:Object.assign({},DEFAULTS),
    touch:{left:false,right:false,jump:false,action:false},
    joy:{x:0,jump:false,action:false,pause:false},
    enabled:true,
    DEFAULTS:DEFAULTS, normCode:normCode, prettyCode:prettyCode, isShiftCode:isShiftCode, storedToCode:storedToCode,
    loadMap(custom){ if(custom) for(const k in DEFAULTS) if(custom[k]&&typeof custom[k]==='string') this.map[k]=storedToCode(normCode(custom[k],null)); },
    resetToDefaults(){ this.map=Object.assign({},DEFAULTS); },
    attach(canvas){
      window.addEventListener('keydown',e=>{
        if(e.repeat) return;
        const code=normCode(e.code,e.key);
        this.keys[code]=true; this.pressed[code]=true;
        // only hijack keys during active gameplay; website keeps normal keyboard behavior.
        // Prevent scrolling/focus loss for the CURRENTLY MAPPED actions plus the
        // fixed movement alternates (arrows/space) and Tab/Enter/Backspace when mapped.
        const ui=global.SP_UI;
        const inGameplay=ui&&ui.view==='game'&&ui.inGame;
        if(inGameplay){
          let mapped=false;
          try{
            for(const k in this.map){ if(this.map[k]===code){ mapped=true; break; } }
            if(isShiftCode(code)){
              for(const k in this.map){ if(isShiftCode(this.map[k])){ mapped=true; break; } }
            }
          }catch(_){}
          const fixed=(code==='Space'||code==='ArrowUp'||code==='ArrowDown'||code==='ArrowLeft'||code==='ArrowRight');
          if(mapped||fixed) e.preventDefault();
          else if((code==='Tab'||code==='Enter'||code==='Backspace')&&mapped) e.preventDefault();
        }
        if(global.SP_UI&&global.SP_UI.onKeyDown) global.SP_UI.onKeyDown(code);
      });
      window.addEventListener('keyup',e=>{ const code=normCode(e.code,e.key); this.keys[code]=false; });
      window.addEventListener('blur',()=>{ this.keys={}; this.touch={left:false,right:false,jump:false,action:false}; });
      // touch buttons
      document.querySelectorAll('#touch [data-t]').forEach(btn=>{
        const k=btn.getAttribute('data-t');
        const on=e=>{e.preventDefault(); if(k==='pause'){if(global.SP_UI)global.SP_UI.togglePause();return;} this.touch[k]=true; this.pressed['touch:'+k]=true; btn.classList.add('on');};
        const off=e=>{e.preventDefault(); this.touch[k]=false; btn.classList.remove('on');};
        btn.addEventListener('pointerdown',on); btn.addEventListener('pointerup',off);
        btn.addEventListener('pointercancel',off); btn.addEventListener('pointerleave',off);
      });
      // Scoped scroll-lock fallback: a few mobile browsers ignore CSS
      // touch-action. While gameplay is active, drags starting inside the game
      // viewport must not scroll the page. Overlay panels (pause/shop) are
      // exempt so they keep scrolling; outside gameplay this does nothing.
      const wrap=document.getElementById('canvasWrap');
      if(wrap&&!this._scrollLockBound){
        this._scrollLockBound=true;
        wrap.addEventListener('touchmove',e=>{
          if(!document.body.classList.contains('playing')) return;
          if(e.target&&e.target.closest&&e.target.closest('.panel')) return;
          if(e.cancelable) e.preventDefault();
        },{passive:false});
      }
    },
    pollGamepad(){
      this.joy={x:0,jump:false,action:false,pause:false};
      try{
        const gps=navigator.getGamepads?navigator.getGamepads():[];
        for(const gp of gps){
          if(!gp||!gp.connected) continue;
          const ax=gp.axes[0]||0;
          if(Math.abs(ax)>0.25) this.joy.x=ax;
          if(gp.buttons[14]&&gp.buttons[14].pressed) this.joy.x=-1;
          if(gp.buttons[15]&&gp.buttons[15].pressed) this.joy.x=1;
          const b=i=>gp.buttons[i]&&gp.buttons[i].pressed;
          if(b(0)||b(1)) this.joy.jump=true;
          if(b(2)||b(3)||b(5)||b(7)) this.joy.action=true;
          if(b(9)){ if(!this._gpPauseHeld){ this.joy.pause=true; this._gpPauseHeld=true; } }
          else this._gpPauseHeld=false;
          break;
        }
      }catch(e){}
      if(this.joy.pause&&global.SP_UI) global.SP_UI.togglePause();
    },
    down(action){
      const c=this.map[action]||DEFAULTS[action];
      // Single mapping source: the saved map. ShiftLeft/ShiftRight are the same
      // physical control — either one satisfies a Shift mapping.
      if(isShiftCode(c)){
        if(this.keys['ShiftLeft']||this.keys['ShiftRight']||this.keys['Shift']) return true;
      } else if(this.keys[c]) return true;
      // Fixed movement alternates (not remappable, always available):
      // arrows for directions + W as alt-jump. Run/Action/Pause have NO hidden
      // alternates — they use ONLY the saved mapping (+ touch/gamepad below).
      if(action==='left'&&(this.keys['ArrowLeft'])) return true;
      if(action==='right'&&(this.keys['ArrowRight'])) return true;
      if(action==='jump'&&(this.keys['ArrowUp']||this.keys[this.map.altJump])) return true;
      if(action==='down'&&(this.keys['ArrowDown'])) return true;
      if(action==='left'&&(this.touch.left||this.joy.x<-0.3)) return true;
      if(action==='right'&&(this.touch.right||this.joy.x>0.3)) return true;
      if(action==='jump'&&(this.touch.jump||this.joy.jump)) return true;
      if(action==='action'&&(this.touch.action||this.joy.action)) return true;
      return false;
    },
    pressedOnce(action){
      const c=this.map[action]||DEFAULTS[action];
      const hit=code=>{ if(this.pressed[code]){this.pressed[code]=false;return true;} return false; };
      if(isShiftCode(c)){
        if(hit('ShiftLeft')||hit('ShiftRight')||hit('Shift')) return true;
      } else if(hit(c)) return true;
      if(action==='jump'&&(hit('ArrowUp')||hit(this.map.altJump)||hit('touch:jump'))) return true;
      if(action==='left'&&(hit('ArrowLeft')||hit('touch:left'))) return true;
      if(action==='right'&&(hit('ArrowRight')||hit('touch:right'))) return true;
      if(action==='down'&&hit('ArrowDown')) return true;
      if(action==='action'&&hit('touch:action')) return true;
      if(action==='pause'&&hit('touch:pause')) return true;
      return false;
    },
    consumeJumpBuffer(){
      // edge-trigger jump incl. gamepad (held polling): detect rising edge
      const now=this.down('jump');
      const edge=now&&!this._jumpHeld;
      this._jumpHeld=now;
      return edge||this.pressedOnce('jump');
    },
    endFrame(){ /* pressed map persists for once-checks; clear stale touch edges */ }
  };
  global.SP_Input=Input;
})(window);
