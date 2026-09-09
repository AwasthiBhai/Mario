/* STARBOUND — Profile + Leaderboard UI (SP_ProfileUI).
   ---------------------------------------------------------------------------
   Views rendered here (skeletons live in index.html):
     - Profile:     create-account form | owner profile card + editor
     - Leaderboard: segmented tabs [ Player Leaderboard | Global Leaderboard ],
                    ranked public rows, click-through public profiles.
   Discipline: textContent for ALL user data (never innerHTML of it), toasts
   via SP_UI.notify, blocking prompts via SP_UI.confirmDialog — zero alert /
   prompt / confirm. Every open performs a genuine backend read (server is
   the source of truth); localStorage is session/cache/outbox only.
   Game hooks (called from SP_UI, guarded): onLevelStart → attempt + outbox
   flush; onLevelComplete → merged stats sync. Both fire-and-forget: the game
   never waits on, and never breaks from, profile sync. */
(function(global){
  'use strict';

  function $(s, r){ return (r || document).querySelector(s); }
  function el(tag, cls, text){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function num(n){ try{ return Number(n || 0).toLocaleString('en-US'); }catch(e){ return String(n || 0); } }
  function P(){ return global.SP_Profiles; }
  function UI(){ return global.SP_UI; }
  function AV(){ return global.SP_Avatars; }

  var state = {
    tab: 'player',            // 'player' | 'global'
    publicId: null,           // open public profile (global tab detail)
    pendingAvatar: null,      // picker selection for create/edit forms
    customPreview: null,      // processed custom dataURL awaiting confirm
    editing: false,
    noAcctModalShown: false,  // once-per-session auto popup
    offlineNotified: false,   // once-per-session sync notice
    busy: false
  };

  /* ================= no-account gate ================= */
  function needAccount(auto){
    if(P().hasAccount()) return false;
    if(auto){
      if(state.noAcctModalShown) return true;
      state.noAcctModalShown = true;
      UI().confirmDialog({
        title: 'No account yet',
        message: "You haven't created your account.\nYour data will not be stored.",
        okText: 'Create an Account',
        cancelText: 'Not now'
      }).then(function(ok){ if(ok) UI().show('profile'); });
    }
    return true;
  }

  /* ================= shared bits ================= */
  function statusLine(kind, text){
    var p = el('p', 'rev-status ' + kind);
    p.setAttribute('role', 'status');
    p.textContent = text;
    return p;
  }

  function avatarEl(avatar, size, cls){
    var w = AV().element(avatar, size, cls);
    if(w) return w;
    var f = el('span', 'avatar-circle' + (cls ? ' ' + cls : ''));
    f.textContent = '✦';
    return f;
  }

  /* Per-level records block. rows: {n, s, c, a, t} — unplayed → "Not Played". */
  function recordsBlock(records, playedSet){
    var wrap = el('div', 'myrec');
    var head = el('div', 'myrec-row myrec-head');
    ['Level', 'Score', 'Coins', 'Attempts', 'Best time'].forEach(function(h){
      head.appendChild(el('span', '', h));
    });
    wrap.appendChild(head);
    for(var n = 1; n <= 50; n++){
      var r = records[String(n)];
      var row = el('div', 'myrec-row');
      row.appendChild(el('span', 'myrec-lv', 'Level ' + String(n).padStart(2, '0')));
      if(r){
        var cScore = el('span', '', num(r.s)); cScore.setAttribute('data-l', 'Score');
        var cCoins = el('span', '', num(r.c) + ' 🪙'); cCoins.setAttribute('data-l', 'Coins');
        var cAtt = el('span', '', num(r.a)); cAtt.setAttribute('data-l', 'Attempts');
        var cTime = el('span', '', r.t > 0 ? P().fmtTime(r.t) : '—'); cTime.setAttribute('data-l', 'Best');
        row.appendChild(cScore); row.appendChild(cCoins); row.appendChild(cAtt); row.appendChild(cTime);
      } else {
        var np = el('span', 'myrec-np', 'Not Played');
        np.setAttribute('data-span', '4');
        row.appendChild(np);
        void playedSet;
      }
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* Avatar picker: 20 presets + custom upload with preview + confirm. */
  function avatarPicker(root, current, onPick){
    state.pendingAvatar = current;
    state.customPreview = null;
    var wrap = el('div', 'av-pick');
    var grid = el('div', 'av-grid');
    var mark = null;
    function select(v){
      state.pendingAvatar = v;
      if(mark) mark.forEach(function(b){ b.classList.remove('sel'); });
      onPick(v);
    }
    mark = AV().PRESETS.map(function(p){
      var b = el('button', 'av-cell');
      b.type = 'button';
      b.title = p.name;
      b.setAttribute('aria-label', 'Use icon ' + p.name);
      b.appendChild(avatarEl(p.id, 56));
      if(current === p.id) b.classList.add('sel');
      b.addEventListener('click', function(){
        Array.from(grid.querySelectorAll('.av-cell')).forEach(function(x){ x.classList.remove('sel'); });
        b.classList.add('sel');
        var prev = $('.av-custom-preview', wrap);
        if(prev) prev.remove();
        state.customPreview = null;
        select(p.id);
      });
      grid.appendChild(b);
      return b;
    });
    wrap.appendChild(grid);

    var customRow = el('div', 'av-custom-row');
    var fileInput = el('input', 'hidden');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    var upBtn = el('button', 'btn btn-ghost btn-sm', '⬆ Upload Custom Image');
    upBtn.type = 'button';
    var upHint = el('small', 'muted', 'PNG/JPEG/WEBP/GIF · max 5 MB · stored tiny & circular');
    upBtn.addEventListener('click', function(){ fileInput.click(); });
    fileInput.addEventListener('change', function(){
      var f = fileInput.files && fileInput.files[0];
      if(!f) return;
      upBtn.disabled = true;
      upBtn.textContent = 'Reading image…';
      AV().processCustomFile(f).then(function(res){
        upBtn.disabled = false;
        upBtn.textContent = '⬆ Upload Custom Image';
        fileInput.value = '';
        if(!res.ok){ UI().notify(res.error, 'error'); return; }
        state.customPreview = res.dataUrl;
        var old = $('.av-custom-preview', wrap);
        if(old) old.remove();
        var pv = el('div', 'av-custom-preview');
        pv.appendChild(avatarEl({ custom: res.dataUrl }, 72));
        var okBtn = el('button', 'btn btn-gold btn-sm', 'Use this photo');
        okBtn.type = 'button';
        okBtn.addEventListener('click', function(){
          Array.from(grid.querySelectorAll('.av-cell')).forEach(function(x){ x.classList.remove('sel'); });
          pv.remove();
          select({ custom: state.customPreview });
          UI().notify('Custom photo selected. Save your profile to keep it.', 'success');
        });
        pv.appendChild(okBtn);
        wrap.appendChild(pv);
        try{ pv.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }catch(e){}
      });
    });
    customRow.appendChild(upBtn);
    customRow.appendChild(upHint);
    customRow.appendChild(fileInput);
    wrap.appendChild(customRow);
    root.appendChild(wrap);
  }

  /* ================= PROFILE VIEW ================= */
  function renderProfile(){
    var root = $('#profileRoot');
    if(!root) return;
    root.innerHTML = '';
    state.editing = false;
    if(!P().hasAccount()){ renderCreate(root); return; }
    renderOwnerLoading(root);
  }

  function renderOwnerLoading(root){
    root.appendChild(statusLine('loading', '⟳ Loading your profile…'));
    P().load().then(function(res){
      root.innerHTML = '';
      if(!res.ok || !res.doc){
        root.appendChild(statusLine('error', '⚠ ' + (res.error || 'Unable to load profile.')));
        var retry = el('button', 'btn btn-ghost btn-sm', '↻ Retry');
        retry.addEventListener('click', renderProfile);
        var c = el('div', 'center'); c.appendChild(retry); root.appendChild(c);
        return;
      }
      var me = P().me(res.doc);
      if(!me){ // session no longer matches any server record
        renderCreate(root);
        return;
      }
      if(res.stale) root.appendChild(statusLine('stale', '⚠ ' + res.error));
      if(state.editing) renderEdit(root, me);
      else renderOwner(root, me, res.doc);
      P().flushOutbox();
    });
  }

  function profileHero(root, user, isOwner, rank){
    var card = el('div', 'card prof-hero');
    card.appendChild(avatarEl(user.avatar, 96, 'prof-avatar'));
    var nm = el('h2', 'prof-name', user.name);
    card.appendChild(nm);
    var t = P()._totalsOf(user.levels ? { levels: user.levels } : user);
    var totals = el('div', 'prof-totals');
    var cells = [
      [num(t.levelsCompleted) + ' / 50', 'levels completed'],
      [num(user.totalCoins || 0), 'total coins collected'],
      [num(t.totalScore), 'total best score']
    ];
    if(rank) cells.push(['#' + num(rank), 'global rank']);
    cells.forEach(function(x){
      var d = el('div', '');
      d.appendChild(el('strong', '', x[0]));
      d.appendChild(el('span', '', x[1]));
      totals.appendChild(d);
    });
    card.appendChild(totals);
    if(isOwner){
      var pid = el('p', 'prof-pid');
      pid.appendChild(el('span', 'muted', 'Private player ID (only you can see this): '));
      pid.appendChild(el('strong', '', user.privateId));
      card.appendChild(pid);
    }
    root.appendChild(card);
    return card;
  }

  function renderOwner(root, me, doc){
    var rank = P().rankOf(doc, me.id);
    profileHero(root, me, true, rank);
    var actions = el('div', 'prof-actions');
    var edit = el('button', 'btn btn-gold', '✎ Edit Profile');
    edit.addEventListener('click', function(){ state.editing = true; renderProfile(); });
    var lb = el('button', 'btn btn-ghost', '🏆 Leaderboard');
    lb.addEventListener('click', function(){ UI().show('leaderboard'); });
    var out = el('button', 'btn btn-ghost btn-sm', 'Sign out on this device');
    out.addEventListener('click', function(){
      UI().confirmDialog({
        title: 'Sign out on this device?',
        message: 'Your global account stays saved. This only removes the sign-in from this device.',
        okText: 'Sign out', cancelText: 'Stay signed in'
      }).then(function(ok){
        if(!ok) return;
        P().signOutThisDevice();
        UI().notify('Signed out on this device.', 'info');
        renderProfile();
      });
    });
    actions.appendChild(edit); actions.appendChild(lb); actions.appendChild(out);
    root.appendChild(actions);
    var h = el('h3', '', 'My level records');
    root.appendChild(h);
    root.appendChild(recordsBlock(me.levels || {}));
  }

  function renderEdit(root, me){
    profileHero(root, me, true, 0);
    var card = el('div', 'card');
    card.appendChild(el('h3', '', 'Edit profile'));
    var pickLabel = el('label', 'rev-label', 'Profile icon');
    card.appendChild(pickLabel);
    var pickRoot = el('div', '');
    card.appendChild(pickRoot);
    var chosen = me.avatar;
    avatarPicker(pickRoot, me.avatar, function(v){ chosen = v; });
    var nameLabel = el('label', 'rev-label', 'Display name');
    var nameIn = el('input', '');
    nameIn.type = 'text'; nameIn.maxLength = P().MAX_NAME; nameIn.value = me.name;
    nameIn.autocomplete = 'nickname';
    nameLabel.appendChild(nameIn);
    card.appendChild(nameLabel);
    var pidLabel = el('label', 'rev-label', 'Private player ID (only you see this)');
    var pidIn = el('input', '');
    pidIn.type = 'text'; pidIn.maxLength = P().MAX_PID; pidIn.value = me.privateId;
    pidIn.autocomplete = 'off'; pidIn.spellcheck = false;
    pidLabel.appendChild(pidIn);
    card.appendChild(pidLabel);
    var err = el('p', 'rev-errors'); err.setAttribute('role', 'alert');
    var okm = el('p', 'rev-ok'); okm.setAttribute('role', 'status');
    card.appendChild(err); card.appendChild(okm);
    var row = el('div', 'row2');
    var save = el('button', 'btn btn-gold', 'Save changes');
    var cancel = el('button', 'btn btn-ghost', 'Cancel');
    save.addEventListener('click', function(){
      err.textContent = ''; okm.textContent = '';
      var patch = { name: nameIn.value, avatar: chosen };
      if(String(pidIn.value).trim() !== String(me.privateId)) patch.privateId = pidIn.value;
      save.disabled = true; save.textContent = 'Saving…';
      P().updateProfile(patch).then(function(res){
        save.disabled = false; save.textContent = 'Save changes';
        if(!res.ok){ err.textContent = res.error; UI().notify(res.error, 'error'); return; }
        UI().notify('Profile updated successfully.', 'success');
        state.editing = false;
        renderProfile();
      });
    });
    cancel.addEventListener('click', function(){ state.editing = false; renderProfile(); });
    row.appendChild(save); row.appendChild(cancel);
    card.appendChild(row);
    root.appendChild(card);
  }

  function renderCreate(root){
    var hero = el('div', 'card prof-hero');
    hero.appendChild(avatarEl(AV().defaultId(), 96, 'prof-avatar'));
    hero.appendChild(el('h2', 'prof-name', 'Create your account'));
    var warn = el('p', 'prof-warn', "You haven't created your account.\nYour data will not be stored.");
    hero.appendChild(warn);
    var sub = el('p', 'muted', 'No account = local play on this device only. Account = persistent global statistics on every device.');
    hero.appendChild(sub);
    root.appendChild(hero);

    var card = el('div', 'card');
    var pickLabel = el('label', 'rev-label', 'Profile icon — choose from 20 icons or upload your own');
    card.appendChild(pickLabel);
    var pickRoot = el('div', '');
    card.appendChild(pickRoot);
    var chosen = AV().defaultId();
    avatarPicker(pickRoot, chosen, function(v){ chosen = v; });
    var nameLabel = el('label', 'rev-label', 'Display name (seen by everyone)');
    var nameIn = el('input', '');
    nameIn.type = 'text'; nameIn.maxLength = P().MAX_NAME;
    nameIn.placeholder = 'e.g. Karan';
    nameIn.autocomplete = 'nickname';
    nameLabel.appendChild(nameIn);
    card.appendChild(nameLabel);
    var pidLabel = el('label', 'rev-label', 'Private player ID (only you see this)');
    var pidIn = el('input', '');
    pidIn.type = 'text'; pidIn.maxLength = P().MAX_PID;
    pidIn.placeholder = 'e.g. karan853';
    pidIn.autocomplete = 'off'; pidIn.spellcheck = false;
    pidLabel.appendChild(pidIn);
    var pidHint = el('small', 'muted', '3–20 characters: letters, numbers, dot, underscore, hyphen. Unique across all players.');
    card.appendChild(pidLabel);
    card.appendChild(pidHint);
    var err = el('p', 'rev-errors'); err.setAttribute('role', 'alert');
    card.appendChild(err);
    var go = el('button', 'btn btn-gold btn-block', '✦ Create Account ✦');
    go.addEventListener('click', function(){
      err.textContent = '';
      go.disabled = true; go.textContent = 'Creating…';
      P().createAccount(nameIn.value, pidIn.value, chosen).then(function(res){
        go.disabled = false; go.textContent = '✦ Create Account ✦';
        if(!res.ok){ err.textContent = res.error; UI().notify(res.error, 'error'); return; }
        UI().notify('Welcome to the global leaderboard, ' + res.user.name + '!', 'success');
        renderProfile();
      });
    });
    card.appendChild(go);
    root.appendChild(card);
  }

  /* ================= LEADERBOARD VIEW ================= */
  function renderLeaderboard(){
    var root = $('#leaderboardRoot');
    if(!root) return;
    root.innerHTML = '';
    var seg = el('div', 'lb-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Leaderboard sections');
    var bP = el('button', 'lb-seg-btn' + (state.tab === 'player' ? ' active' : ''), '◉ Player Leaderboard');
    var bG = el('button', 'lb-seg-btn' + (state.tab === 'global' ? ' active' : ''), '🌍 Global Leaderboard');
    bP.setAttribute('aria-pressed', String(state.tab === 'player'));
    bG.setAttribute('aria-pressed', String(state.tab === 'global'));
    bP.addEventListener('click', function(){ state.tab = 'player'; state.publicId = null; renderLeaderboard(); });
    bG.addEventListener('click', function(){ state.tab = 'global'; state.publicId = null; renderLeaderboard(); });
    seg.appendChild(bP); seg.appendChild(bG);
    root.appendChild(seg);
    var body = el('div', 'lb-body');
    root.appendChild(body);
    if(state.tab === 'player') renderPlayerTab(body);
    else renderGlobalTab(body);
  }

  function renderPlayerTabGuest(body){
    var card = el('div', 'card center');
    card.appendChild(el('h3', '', 'No records yet'));
    card.appendChild(el('p', 'prof-warn', "You haven't created your account.\nYour data will not be stored."));
    var go = el('button', 'btn btn-gold', '✦ Create an Account ✦');
    go.addEventListener('click', function(){ UI().show('profile'); });
    card.appendChild(go);
    // Local-only preview: honest about what lives on this device.
    var d = (global.SP_Save && SP_Save.data) ? SP_Save.data : { levels: {} };
    var local = {};
    Object.keys(d.levels || {}).forEach(function(k){
      var L = d.levels[k] || {};
      if(L.done) local[k] = { s: L.bestScore || 0, c: L.coins || 0, a: 0, t: L.bestTime || 0 };
    });
    if(Object.keys(local).length){
      card.appendChild(el('p', 'muted', 'On this device only (not global):'));
      card.appendChild(recordsBlock(local));
    }
    body.appendChild(card);
  }

  function renderPlayerTab(body){
    if(needAccount(true)){ renderPlayerTabGuest(body); return; }
    body.appendChild(statusLine('loading', '⟳ Loading your records…'));
    P().load().then(function(res){
      body.innerHTML = '';
      if(!res.ok || !res.doc){
        body.appendChild(statusLine('error', '⚠ ' + (res.error || 'Unable to load records.')));
        var retry = el('button', 'btn btn-ghost btn-sm', '↻ Retry');
        retry.addEventListener('click', renderLeaderboard);
        var c = el('div', 'center'); c.appendChild(retry); body.appendChild(c);
        return;
      }
      var me = P().me(res.doc);
      if(!me){
        // Session no longer matches any server record (e.g. data restored
        // from backup): drop the dead session and fall back to guest view.
        try{ P().signOutThisDevice(); }catch(e){}
        UI().notify('Your sign-in on this device expired. Create an account to sync again.', 'warning');
        renderPlayerTabGuest(body);
        return;
      }
      if(res.stale) body.appendChild(statusLine('stale', '⚠ ' + res.error));
      var h = el('h3', '', 'My records — ' + me.name);
      body.appendChild(h);
      if(!Object.keys(me.levels || {}).length){
        body.appendChild(statusLine('loading', "You haven't played any levels yet. Finish a level to set your first record!"));
      } else {
        body.appendChild(recordsBlock(me.levels));
      }
      P().flushOutbox();
    });
  }

  function renderGlobalTab(body){
    if(state.publicId){ renderPublicProfile(body, state.publicId); return; }
    body.appendChild(statusLine('loading', '⟳ Loading global leaderboard…'));
    P().load().then(function(res){
      if(state.tab !== 'global' || state.publicId) return; // user moved on
      body.innerHTML = '';
      if(!res.ok || !res.doc){
        body.appendChild(statusLine('error', '⚠ ' + (res.error || 'Unable to load leaderboard. Please try again.')));
        var retry = el('button', 'btn btn-ghost btn-sm', '↻ Retry');
        retry.addEventListener('click', renderLeaderboard);
        var c = el('div', 'center'); c.appendChild(retry); body.appendChild(c);
        return;
      }
      if(res.stale) body.appendChild(statusLine('stale', '⚠ ' + res.error));
      var rows = P().leaderboard(res.doc, 100);
      if(!rows.length){
        body.appendChild(statusLine('loading', 'No players have joined yet. Create an account, finish a level, and claim #1!'));
        return;
      }
      var list = el('div', 'lb-list');
      rows.forEach(function(p){
        var b = el('button', 'lb-row');
        b.setAttribute('aria-label', 'View public profile of ' + p.name + ', rank ' + p.rank);
        var rk = el('span', 'lb-rank r' + (p.rank <= 3 ? p.rank : 'x'), '#' + p.rank);
        b.appendChild(rk);
        b.appendChild(avatarEl(p.avatar, 48));
        var mid = el('span', 'lb-mid');
        mid.appendChild(el('strong', 'lb-name', p.name));
        mid.appendChild(el('small', 'muted', num(p.levelsCompleted) + ' levels · ' + num(p.totalCoins) + ' 🪙'));
        b.appendChild(mid);
        b.appendChild(el('span', 'lb-pts', num(p.totalScore)));
        b.addEventListener('click', function(){
          state.publicId = p.id;
          renderLeaderboard();
        });
        list.appendChild(b);
      });
      body.appendChild(list);
      var note = el('p', 'muted center');
      var small = el('small', '', 'Showing top ' + rows.length + ' · ranked by total best score');
      note.appendChild(small);
      body.appendChild(note);
    });
  }

  function renderPublicProfile(body, publicId){
    body.appendChild(statusLine('loading', '⟳ Loading player profile…'));
    P().load().then(function(res){
      if(state.tab !== 'global' || state.publicId !== publicId) return;
      body.innerHTML = '';
      var back = el('button', 'btn btn-ghost btn-sm', '← Back to leaderboard');
      back.addEventListener('click', function(){ state.publicId = null; renderLeaderboard(); });
      body.appendChild(back);
      if(!res.ok || !res.doc){
        body.appendChild(statusLine('error', '⚠ ' + (res.error || 'Unable to load this profile.')));
        return;
      }
      var p = P().getPublic(res.doc, publicId);
      if(!p || !Object.keys(p.levels || {}).length){
        body.appendChild(statusLine('error', 'This player has no public records yet.'));
        return;
      }
      if(res.stale) body.appendChild(statusLine('stale', '⚠ ' + res.error));
      // Public shape only: icon, name, totals, per-level stats. Never privateId.
      profileHero(body, p, false, P().rankOf(res.doc, p.id));
      body.appendChild(el('h3', '', 'Level records — ' + p.name));
      body.appendChild(recordsBlock(p.levels));
    });
  }

  /* ================= game sync hooks ================= */
  function runId(level){
    var me = P().myPublicId() || 'anon';
    return 'r_' + me.slice(-8) + '_' + level + '_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }

  function onLevelStart(level){
    try{
      P().flushOutbox();
      if(!P().hasAccount()) return;
      P().recordAttempt(level); // fire-and-forget; failures queue silently
    }catch(e){}
  }

  function onLevelComplete(level, res){
    try{
      if(!P().hasAccount()){
        needAccount(true); // first completion per session explains local-only play
        return;
      }
      P().recordCompletion(level, {
        score: res.score || 0,
        coins: (res.coins != null ? res.coins : res.collected) || 0,
        time: res.time || 0,
        runId: runId(level)
      }).then(function(r){
        if(r.ok){
          if(r.improved) UI().notify('★ Global records synced!', 'success');
        } else if(r.queued && !state.offlineNotified){
          state.offlineNotified = true;
          UI().notify('Profile server unreachable — stats will sync when back online.', 'warning');
        }
      });
      P().flushOutbox();
    }catch(e){}
  }

  /* ================= boot wiring ================= */
  var api = {
    renderProfile: renderProfile,
    renderLeaderboard: renderLeaderboard,
    onLevelStart: onLevelStart,
    onLevelComplete: onLevelComplete,
    needAccount: needAccount,
    init: function(){
      try{
        var u = UI();
        if(!u || this._wired) return;
        this._wired = true;
        var self = this;
        var origShow = u.show.bind(u);
        u.show = function(view){
          origShow(view);
          try{
            if(view === 'profile') self.renderProfile();
            else if(view === 'leaderboard') self.renderLeaderboard();
          }catch(e){}
        };
        var origComplete = u.onComplete.bind(u);
        u.onComplete = function(res){
          origComplete(res);
          try{ self.onLevelComplete(u.currentLevel, res || {}); }catch(e){}
        };
        var origStart = u.startLevel.bind(u);
        u.startLevel = function(n, keep){
          var r = origStart(n, keep);
          try{ self.onLevelStart(n); }catch(e){}
          return r;
        };
      }catch(e){}
    }
  };

  global.SP_ProfileUI = api;
  if(typeof document !== 'undefined' && document.addEventListener){
    document.addEventListener('DOMContentLoaded', function(){ try{ api.init(); }catch(e){} });
  }
})(window);
