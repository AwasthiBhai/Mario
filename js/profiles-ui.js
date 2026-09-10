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
    authMode: 'create',       // signed-out view: 'create' | 'signin'
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

  /* Avatar picker: 20 presets + custom upload with preview + confirm.
   * Single-select, state keyed by avatar ID (reselecting the same ID is a
   * no-op visually). Selected cell gets .sel + aria-pressed + check badge;
   * custom uploads highlight the preview card while active. Keyboard: every
   * option is a real <button>, focus-visible ring via CSS. */
  function avatarIdOf(v){
    if(typeof v === 'string') return 'preset:' + v;
    if(v && typeof v.custom === 'string') return 'custom:' + v.custom.slice(-32);
    return '';
  }
  function avatarPicker(root, current, onPick){
    state.pendingAvatar = current;
    state.customPreview = null;
    var wrap = el('div', 'av-pick');
    var grid = el('div', 'av-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Choose a profile icon');
    var currentId = avatarIdOf(current);
    var customBtn = null, customCard = null;
    function paint(){
      var want = avatarIdOf(state.pendingAvatar);
      Array.from(grid.querySelectorAll('.av-cell')).forEach(function(x){
        var on = x.getAttribute('data-av') === want;
        x.classList.toggle('sel', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if(customCard){
        var cOn = want.indexOf('custom:') === 0;
        customCard.classList.toggle('sel', cOn);
        customCard.setAttribute('aria-pressed', cOn ? 'true' : 'false');
      }
    }
    function select(v){
      state.pendingAvatar = v;
      paint();
      onPick(v);
    }
    AV().PRESETS.map(function(p){
      var b = el('button', 'av-cell');
      b.type = 'button';
      b.title = p.name;
      b.setAttribute('data-av', 'preset:' + p.id);
      b.setAttribute('aria-label', 'Use icon ' + p.name);
      b.setAttribute('aria-pressed', ('preset:' + p.id) === currentId ? 'true' : 'false');
      b.appendChild(avatarEl(p.id, 56));
      var check = el('span', 'av-check', '✓');
      check.setAttribute('aria-hidden', 'true');
      b.appendChild(check);
      if(('preset:' + p.id) === currentId) b.classList.add('sel');
      b.addEventListener('click', function(){
        var prev = $('.av-custom-preview', wrap);
        if(prev) prev.remove();
        customCard = null;
        state.customPreview = null;
        select(p.id);
      });
      grid.appendChild(b);
    });
    // A saved CUSTOM avatar counts as "current": show it pre-highlighted.
    if(currentId.indexOf('custom:') === 0 && current && current.custom){
      customCard = el('button', 'av-custom-preview sel');
      customCard.type = 'button';
      customCard.setAttribute('data-av', currentId);
      customCard.setAttribute('aria-pressed', 'true');
      customCard.setAttribute('aria-label', 'Current custom photo (selected)');
      customCard.appendChild(avatarEl(current, 72));
      var cc = el('span', 'av-check', '✓');
      cc.setAttribute('aria-hidden', 'true');
      customCard.appendChild(cc);
      customCard.addEventListener('click', function(){ select(current); });
      wrap.appendChild(customCard);
    }
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
        customCard = null;
        var pv = el('div', 'av-custom-preview');
        pv.appendChild(avatarEl({ custom: res.dataUrl }, 72));
        var okBtn = el('button', 'btn btn-gold btn-sm', 'Use this photo');
        okBtn.type = 'button';
        okBtn.addEventListener('click', function(){
          var val = { custom: state.customPreview };
          select(val);
          // Persist the choice as a highlighted card (state keyed by ID).
          pv.innerHTML = '';
          pv.appendChild(avatarEl(val, 72));
          var badge = el('span', 'av-check', '✓');
          badge.setAttribute('aria-hidden', 'true');
          pv.appendChild(badge);
          var cap = el('small', 'muted', 'Custom photo selected');
          pv.appendChild(cap);
          customCard = pv;
          pv.setAttribute('data-av', avatarIdOf(val));
          paint();
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

  /* World sync: after every FRESH (non-stale) profiles read, align local
   * gameplay with the server's world resetVersion. A wiped world leaves old
   * unlocks stranded in this browser; the version gap triggers a
   * gameplay-only reset (settings/theme/sessions preserved). */
  function syncWorld(doc, stale){
    try{
      if(stale || !doc) return false;
      if(global.SP_Save && typeof global.SP_Save.applyServerReset === 'function'){
        return !!global.SP_Save.applyServerReset(doc.resetVersion);
      }
    }catch(e){}
    return false;
  }

  /* Re-render Reviews immediately when auth state flips (no page refresh:
   * the reviews form enables/disables live). */
  function refreshReviewsIfVisible(){
    try{
      var u = UI();
      if(u && u.view === 'reviews' && typeof u.renderReviews === 'function') u.renderReviews();
    }catch(e){}
  }

  /* Dead-session cleanup: the server definitively no longer knows this
   * device's account (world wipe or removed record) — drop local sessions,
   * wipe stranded gameplay + sync state, and land on the signed-out view.
   * Transient network failures NEVER trigger this (validateSession reports
   * dead:false for them). */
  function cleanupDeadSession(root, showNotice){
    try{ P().signOutThisDevice(); }catch(e){}
    try{
      if(global.SP_Save && typeof global.SP_Save.resetAfterWorldWipe === 'function'){
        global.SP_Save.resetAfterWorldWipe();
      }
    }catch(e){}
    try{
      if(showNotice) UI().notify('Your previous game world was reset. Starting fresh — Level 1 awaits!', 'warning');
    }catch(e){}
    renderSignedOut(root);
    refreshReviewsIfVisible();
  }

  /* ================= PROFILE VIEW ================= */
  function renderProfile(){
    var root = $('#profileRoot');
    if(!root) return;
    root.innerHTML = '';
    state.editing = false;
    if(!P().hasAccount()){ renderSignedOut(root); return; }
    renderOwnerLoading(root);
  }

  function renderOwnerLoading(root){
    root.appendChild(statusLine('loading', '⟳ Loading your profile…'));
    var hadLocal = false;
    try{ hadLocal = !!(P().session() || P().authSession()); }catch(e){}
    P().load().then(function(res){
      root.innerHTML = '';
      if(!res.ok || !res.doc){
        root.appendChild(statusLine('error', '⚠ ' + (res.error || 'Unable to load profile.')));
        var retry = el('button', 'btn btn-ghost btn-sm', '↻ Retry');
        retry.addEventListener('click', renderProfile);
        var c = el('div', 'center'); c.appendChild(retry); root.appendChild(c);
        return;
      }
      syncWorld(res.doc, res.stale);
      var me = P().me(res.doc);
      if(!me){
        if(hadLocal){
          // Local session exists but the server has no such account: confirm
          // before wiping (a network blip on the owner read must not nuke).
          root.appendChild(statusLine('loading', '⟳ Checking your sign-in…'));
          P().validateSession().then(function(v){
            root.innerHTML = '';
            if(v && v.dead) cleanupDeadSession(root, true);
            else renderSignedOut(root);
          });
          return;
        }
        renderSignedOut(root);
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
    var out = el('button', 'btn btn-ghost btn-sm', 'Sign Out');
    out.addEventListener('click', function(){
      UI().confirmDialog({
        title: 'Sign out?',
        message: 'Your global account and progress stay saved. This only removes the sign-in from this device — sign in again anytime to recover the same account.',
        okText: 'Sign Out', cancelText: 'Stay signed in'
      }).then(function(ok){
        if(!ok) return;
        out.disabled = true;
        P().signOut().then(function(){
          UI().notify('Signed out. Your account and progress are safe.', 'info');
          renderProfile();
          refreshReviewsIfVisible();
        });
      });
    });
    actions.appendChild(edit); actions.appendChild(lb); actions.appendChild(out);
    root.appendChild(actions);
    renderPasswordCard(root, me);
    var h = el('h3', '', 'My level records');
    root.appendChild(h);
    root.appendChild(recordsBlock(me.levels || {}));
  }

  /* Password card: pre-password accounts get "Set password" (migration);
   * password accounts get "Change password" (current required). */
  function renderPasswordCard(root, me){
    var card = el('div', 'card');
    card.appendChild(el('h3', '', me.hasPassword ? 'Change password' : 'Set a password'));
    var sub = el('p', 'muted', me.hasPassword
      ? 'Change your sign-in password. You will stay signed in on this device.'
      : 'Add a password so you can sign out and sign back in on any device to recover this same account and progress.');
    card.appendChild(sub);
    if(me.hasPassword){
      var curLabel = el('label', 'rev-label', 'Current password');
      var curIn = el('input', '');
      curIn.type = 'password'; curIn.autocomplete = 'current-password';
      curLabel.appendChild(curIn);
      card.appendChild(curLabel);
    }
    var nwLabel = el('label', 'rev-label', me.hasPassword ? 'New password' : 'Password');
    var nwIn = el('input', '');
    nwIn.type = 'password'; nwIn.autocomplete = 'new-password';
    nwIn.placeholder = 'At least ' + P().MIN_PASSWORD + ' characters';
    nwLabel.appendChild(nwIn);
    card.appendChild(nwLabel);
    var err = el('p', 'rev-errors'); err.setAttribute('role', 'alert');
    var okm = el('p', 'rev-ok'); okm.setAttribute('role', 'status');
    card.appendChild(err); card.appendChild(okm);
    var go = el('button', 'btn btn-ghost', me.hasPassword ? 'Change password' : 'Set password');
    go.addEventListener('click', function(){
      err.textContent = ''; okm.textContent = '';
      var v = P().validatePassword(nwIn.value);
      if(!v.ok){ err.textContent = v.error; return; }
      go.disabled = true;
      P().setPassword(nwIn.value, me.hasPassword ? curIn.value : undefined).then(function(res){
        go.disabled = false;
        if(!res.ok){ err.textContent = res.error; UI().notify(res.error, 'error'); return; }
        nwIn.value = '';
        if(me.hasPassword && curIn) curIn.value = '';
        okm.textContent = 'Password saved. Use it to sign in on any device.';
        UI().notify('Password saved.', 'success');
        me.hasPassword = true;
      });
    });
    card.appendChild(go);
    root.appendChild(card);
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

  /* Signed-out Profile: Create Account | Sign In tabs in the existing
   * STARBOUND card style. Sign-in needs display name + private ID +
   * password, all matching one account; failures are one generic message. */
  function renderSignedOut(root){
    var hero = el('div', 'card prof-hero');
    hero.appendChild(avatarEl(AV().defaultId(), 96, 'prof-avatar'));
    hero.appendChild(el('h2', 'prof-name', state.authMode === 'signin' ? 'Welcome back' : 'Create your account'));
    hero.appendChild(el('p', 'prof-warn', "You haven't created your account.\nYour data will not be stored."));
    hero.appendChild(el('p', 'muted', 'No account = local play on this device only. Account = persistent global statistics on every device.'));
    root.appendChild(hero);
    var seg = el('div', 'lb-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Account actions');
    var bC = el('button', 'lb-seg-btn' + (state.authMode === 'create' ? ' active' : ''), '✦ Create Account');
    var bS = el('button', 'lb-seg-btn' + (state.authMode === 'signin' ? ' active' : ''), 'Sign In');
    bC.setAttribute('aria-pressed', String(state.authMode === 'create'));
    bS.setAttribute('aria-pressed', String(state.authMode === 'signin'));
    bC.addEventListener('click', function(){ state.authMode = 'create'; renderProfile(); });
    bS.addEventListener('click', function(){ state.authMode = 'signin'; renderProfile(); });
    seg.appendChild(bC); seg.appendChild(bS);
    root.appendChild(seg);
    if(state.authMode === 'signin') renderSigninForm(root);
    else renderCreateForm(root);
  }

  function renderCreateForm(root){
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
    var pwLabel = el('label', 'rev-label', 'Password (for signing in on any device)');
    var pwIn = el('input', '');
    pwIn.type = 'password'; pwIn.autocomplete = 'new-password';
    pwIn.placeholder = 'At least ' + P().MIN_PASSWORD + ' characters';
    pwLabel.appendChild(pwIn);
    card.appendChild(pwLabel);
    var err = el('p', 'rev-errors'); err.setAttribute('role', 'alert');
    card.appendChild(err);
    var go = el('button', 'btn btn-gold btn-block', '✦ Create Account ✦');
    go.addEventListener('click', function(){
      err.textContent = '';
      go.disabled = true; go.textContent = 'Creating…';
      P().signUp(nameIn.value, pidIn.value, chosen, pwIn.value).then(function(res){
        go.disabled = false; go.textContent = '✦ Create Account ✦';
        if(!res.ok){ err.textContent = res.error; UI().notify(res.error, 'error'); return; }
        pwIn.value = '';
        UI().notify('Welcome to the global leaderboard, ' + res.user.name + '!', 'success');
        renderProfile();
        refreshReviewsIfVisible();
      });
    });
    card.appendChild(go);
    root.appendChild(card);
  }

  function renderSigninForm(root){
    var card = el('div', 'card');
    card.appendChild(el('h3', '', 'Sign in'));
    card.appendChild(el('p', 'muted', 'Enter the display name, private player ID, and password for the SAME account.'));
    var nameLabel = el('label', 'rev-label', 'Display name');
    var nameIn = el('input', '');
    nameIn.type = 'text'; nameIn.maxLength = P().MAX_NAME;
    nameIn.placeholder = 'e.g. Karan';
    nameIn.autocomplete = 'username';
    nameLabel.appendChild(nameIn);
    card.appendChild(nameLabel);
    var pidLabel = el('label', 'rev-label', 'Private player ID');
    var pidIn = el('input', '');
    pidIn.type = 'text'; pidIn.maxLength = P().MAX_PID;
    pidIn.placeholder = 'e.g. karan853';
    pidIn.autocomplete = 'off'; pidIn.spellcheck = false;
    pidLabel.appendChild(pidIn);
    card.appendChild(pidLabel);
    var pwLabel = el('label', 'rev-label', 'Password');
    var pwIn = el('input', '');
    pwIn.type = 'password'; pwIn.autocomplete = 'current-password';
    pwLabel.appendChild(pwIn);
    card.appendChild(pwLabel);
    var err = el('p', 'rev-errors'); err.setAttribute('role', 'alert');
    card.appendChild(err);
    var go = el('button', 'btn btn-gold btn-block', 'Sign In');
    function attempt(){
      err.textContent = '';
      go.disabled = true; go.textContent = 'Signing in…';
      P().signIn(nameIn.value, pidIn.value, pwIn.value).then(function(res){
        go.disabled = false; go.textContent = 'Sign In';
        pwIn.value = '';
        if(!res.ok){ err.textContent = res.error; return; }
        UI().notify('Welcome back, ' + res.user.name + '!', 'success');
        renderProfile();
        refreshReviewsIfVisible();
      });
    }
    go.addEventListener('click', attempt);
    [nameIn, pidIn, pwIn].forEach(function(inp){
      inp.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){ e.preventDefault(); attempt(); }
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
        // Local session but no server record: confirm a dead session before
        // wiping (a network blip on the owner read must not nuke progress).
        body.appendChild(statusLine('loading', '⟳ Checking your sign-in…'));
        P().validateSession().then(function(v){
          body.innerHTML = '';
          if(v && v.dead){
            try{ P().signOutThisDevice(); }catch(e){}
            try{
              if(global.SP_Save && typeof global.SP_Save.resetAfterWorldWipe === 'function'){
                global.SP_Save.resetAfterWorldWipe();
              }
            }catch(e){}
            UI().notify('Your sign-in on this device expired. Starting fresh!', 'warning');
          }
          renderPlayerTabGuest(body);
        });
        return;
      }
      syncWorld(res.doc, res.stale);
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
      syncWorld(res.doc, res.stale);
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
