/* STARBOUND — ThemeManager: Light / True-Black Dark.
   Separate storage key so game saves are never touched.
   First visit: prefers-color-scheme. Manual choice wins forever. */
(function (global) {
  'use strict';
  var KEY = 'starboundThemeV1';
  var Theme = {
    KEY: KEY,
    current: 'dark',
    init: function () {
      var stored = null;
      try { stored = global.localStorage ? global.localStorage.getItem(KEY) : null; } catch (e) { stored = null; }
      if (stored === 'light' || stored === 'dark') {
        this.current = stored;
      } else if (global.matchMedia) {
        try {
          this.current = global.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        } catch (e) { this.current = 'dark'; }
      } else {
        this.current = 'dark';
      }
      this.apply(this.current, true);
      // If OS preference changes and user never chose manually, follow it.
      try {
        var mq = global.matchMedia ? global.matchMedia('(prefers-color-scheme: light)') : null;
        if (mq && mq.addEventListener) {
          mq.addEventListener('change', function (e) {
            var manual = null;
            try { manual = global.localStorage ? global.localStorage.getItem(KEY) : null; } catch (err) { manual = null; }
            if (manual !== 'light' && manual !== 'dark') Theme.apply(e.matches ? 'light' : 'dark', false);
          });
        }
      } catch (e) {}
    },
    get: function () { return this.current; },
    isDark: function () { return this.current === 'dark'; },
    apply: function (mode, silent) {
      if (mode !== 'light' && mode !== 'dark') mode = 'dark';
      this.current = mode;
      try { document.documentElement.setAttribute('data-theme', mode); } catch (e) {}
      try {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', mode === 'dark' ? '#000000' : '#F7F7F5');
      } catch (e) {}
      try {
        document.body.classList.toggle('theme-dark', mode === 'dark');
        document.body.classList.toggle('theme-light', mode === 'light');
      } catch (e) {}
      this.syncControls();
      if (!silent) {
        try { if (global.SP_Audio && SP_Audio.sfx) SP_Audio.sfx('click'); } catch (e) {}
      }
    },
    set: function (mode) {
      this.apply(mode, false);
      try { if (global.localStorage) global.localStorage.setItem(KEY, this.current); } catch (e) {}
      this.syncControls();
    },
    toggle: function () {
      this.set(this.current === 'dark' ? 'light' : 'dark');
    },
    syncControls: function () {
      try {
        var icon = this.current === 'dark' ? '\u2600' : '\uD83C\uDF19'; // sun in dark, moon in light
        var label = this.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
          var ic = b.querySelector('.theme-ico');
          if (ic) ic.textContent = icon;
          b.setAttribute('aria-label', label);
          b.setAttribute('title', label);
          b.setAttribute('aria-pressed', String(Theme.current === 'dark'));
        });
        document.querySelectorAll('[data-theme-option]').forEach(function (b) {
          var v = b.getAttribute('data-theme-option');
          var on = v === Theme.current;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      } catch (e) {}
    }
  };
  global.SP_Theme = Theme;
})(window);
