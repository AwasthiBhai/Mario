/* STARBOUND — Input: keyboard (remappable) + touch + gamepad */
(function(global){
  'use strict';
  const DEFAULTS={left:'KeyA',right:'KeyD',jump:'Space',down:'KeyS',run:'ShiftLeft',action:'KeyE',pause:'Escape',altJump:'KeyW'};
  const Input={
    keys:{}, pressed:{}, map:Object.assign({},DEFAULTS),
    touch:{left:false,right:false,jump:false,action:false},
    joy:{x:0,jump:false,action:false,pause:false},
    enabled:true,
    loadMap(custom){ if(custom) for(const k in DEFAULTS) if(custom[k]) this.map[k]=custom[k]; },
    attach(canvas){
      window.addEventListener('keydown',e=>{
        if(e.repeat) return;
        this.keys[e.code]=true; this.pressed[e.code]=true;
        // only hijack scrolling keys during active gameplay; website keeps normal keyboard behavior
        const ui=global.SP_UI;
        const inGameplay=ui&&ui.view==='game'&&ui.inGame;
        if(inGameplay&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
        if(global.SP_UI&&global.SP_UI.onKeyDown) global.SP_UI.onKeyDown(e.code);
      });
      window.addEventListener('keyup',e=>{ this.keys[e.code]=false; });
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
      if(this.keys[c]) return true;
      if(action==='left'&&(this.keys['ArrowLeft'])) return true;
      if(action==='right'&&(this.keys['ArrowRight'])) return true;
      if(action==='jump'&&(this.keys['ArrowUp']||this.keys[this.map.altJump])) return true;
      if(action==='down'&&(this.keys['ArrowDown'])) return true;
      if(action==='run'&&(this.keys['ShiftRight'])) return true;
      if(action==='action'&&(this.keys['KeyJ'])) return true;
      if(action==='pause'&&(this.keys['KeyP'])) return true;
      if(action==='left'&&(this.touch.left||this.joy.x<-0.3)) return true;
      if(action==='right'&&(this.touch.right||this.joy.x>0.3)) return true;
      if(action==='jump'&&(this.touch.jump||this.joy.jump)) return true;
      if(action==='action'&&(this.touch.action||this.joy.action)) return true;
      return false;
    },
    pressedOnce(action){
      const c=this.map[action]||DEFAULTS[action];
      const hit=code=>{ if(this.pressed[code]){this.pressed[code]=false;return true;} return false; };
      if(hit(c)) return true;
      if(action==='jump'&&(hit('ArrowUp')||hit(this.map.altJump)||hit('touch:jump'))) return true;
      if(action==='left'&&(hit('ArrowLeft')||hit('touch:left'))) return true;
      if(action==='right'&&(hit('ArrowRight')||hit('touch:right'))) return true;
      if(action==='down'&&hit('ArrowDown')) return true;
      if(action==='action'&&(hit('KeyJ')||hit('touch:action'))) return true;
      if(action==='pause'&&(hit('Escape')||hit('KeyP')||hit('touch:pause'))) return true;
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
