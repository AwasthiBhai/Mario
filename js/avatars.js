/* STARBOUND — Profile avatars: 20 built-in icons + custom upload.
   ---------------------------------------------------------------------------
   The 20 presets are ORIGINAL inline-SVG art bundled in this file (same ethos
   as the rest of STARBOUND: zero binary game assets, all art drawn in code).
   Nothing is hotlinked, nothing can break if an external site changes, and
   there are no licensing/copyright concerns (no third-party characters).
   Presets render as data-URI <img> inside a circular frame — always circular,
   never distorted (SVG scales with preserveAspectRatio).

   CUSTOM UPLOAD (global-safe): raw device photos are NEVER stored. The file
   is validated, center-cover-cropped (no distortion), downscaled to a tiny
   square, and re-encoded as a small JPEG data-URL (≤ ~7.8KB) before it ever
   reaches the shared document — so no huge Base64 blobs land in the DB.
   Validation: image MIME only (png/jpeg/webp/gif), ≤ 5MB source, animated
   GIFs keep their first frame only, filenames are never used. */
(function(global){
  'use strict';

  var PRESETS = [
    { id: 'nova-star', name: 'Nova Star', bg: ['#2A1A00', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4 L37 27 L60 32 L37 37 L32 60 L27 37 L4 32 L27 27 Z" fill="#FFC94D"/><circle cx="32" cy="32" r="5" fill="#FFF6DE"/><circle cx="50" cy="12" r="2.4" fill="#FFE9A8"/><circle cx="12" cy="50" r="2" fill="#FFE9A8"/></svg>' },
    { id: 'astronaut', name: 'Astronaut', bg: ['#12303A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#F2F2EE"/><circle cx="32" cy="32" r="20" fill="none" stroke="#8A8A8A" stroke-width="3"/><rect x="18" y="24" width="28" height="16" rx="8" fill="#12303A"/><rect x="21" y="27" width="14" height="10" rx="5" fill="#9ADBE8"/><circle cx="14" cy="32" r="4" fill="#8A8A8A"/><circle cx="50" cy="32" r="4" fill="#8A8A8A"/></svg>' },
    { id: 'ringed-planet', name: 'Ringed Planet', bg: ['#3A2A10', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><ellipse cx="32" cy="34" rx="26" ry="8" fill="none" stroke="#FFC94D" stroke-width="4"/><circle cx="32" cy="30" r="13" fill="#FF8A3D"/><path d="M22 26 A12 12 0 0 1 36 22" stroke="#FFD9A8" stroke-width="3" fill="none" stroke-linecap="round"/></svg>' },
    { id: 'rocket', name: 'Rocket', bg: ['#3A1A1A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4 C40 12 42 24 38 34 L26 34 C22 24 24 12 32 4 Z" fill="#F2F2EE"/><circle cx="32" cy="20" r="5" fill="#4DA6FF"/><path d="M26 30 L18 42 L26 38 Z" fill="#FF6B6B"/><path d="M38 30 L46 42 L38 38 Z" fill="#FF6B6B"/><path d="M29 38 L35 38 L32 52 Z" fill="#FFC94D"/></svg>' },
    { id: 'alien', name: 'Alien', bg: ['#0F3A24', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><ellipse cx="32" cy="34" rx="17" ry="20" fill="#7ED957"/><ellipse cx="25" cy="32" rx="5" ry="8" fill="#0B2A12" transform="rotate(-18 25 32)"/><ellipse cx="39" cy="32" rx="5" ry="8" fill="#0B2A12" transform="rotate(18 39 32)"/><path d="M24 8 L28 18 M40 8 L36 18" stroke="#7ED957" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="7" r="2.6" fill="#5DF2C8"/><circle cx="40" cy="7" r="2.6" fill="#5DF2C8"/></svg>' },
    { id: 'robot', name: 'Robot', bg: ['#2A2A2A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="14" y="20" width="36" height="30" rx="8" fill="#B8B8B8"/><rect x="20" y="28" width="24" height="12" rx="6" fill="#0B0B0B"/><circle cx="26" cy="34" r="3" fill="#5DF2C8"/><circle cx="38" cy="34" r="3" fill="#5DF2C8"/><path d="M32 20 L32 10" stroke="#B8B8B8" stroke-width="3"/><circle cx="32" cy="8" r="3.4" fill="#FFC94D"/><rect x="24" y="44" width="16" height="3" rx="1.5" fill="#5F5F5F"/></svg>' },
    { id: 'comet', name: 'Comet', bg: ['#0F2A3A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 48 L34 34 M12 56 L38 40 M22 58 L42 44" stroke="#4DA6FF" stroke-width="4" stroke-linecap="round"/><circle cx="44" cy="24" r="12" fill="#FFE9A8"/><circle cx="44" cy="24" r="12" fill="none" stroke="#FFC94D" stroke-width="3"/><circle cx="40" cy="21" r="3" fill="#FF8A3D"/></svg>' },
    { id: 'moon', name: 'Moon', bg: ['#23232E', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M41 6 A25 25 0 1 0 41 58 A20 20 0 1 1 41 6 Z" fill="#EDEDED"/><circle cx="24" cy="26" r="3" fill="#B8B8B8"/><circle cx="20" cy="40" r="2.2" fill="#B8B8B8"/><circle cx="50" cy="14" r="2" fill="#FFE9A8"/></svg>' },
    { id: 'sun', name: 'Sun', bg: ['#3A2408', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#FFC94D" stroke-width="4" stroke-linecap="round"><path d="M32 4 L32 12 M32 52 L32 60 M4 32 L12 32 M52 32 L60 32 M12 12 L18 18 M46 46 L52 52 M52 12 L46 18 M18 46 L12 52"/></g><circle cx="32" cy="32" r="13" fill="#FF8A3D"/><circle cx="32" cy="32" r="8" fill="#FFE9A8"/></svg>' },
    { id: 'ufo', name: 'UFO', bg: ['#1A2E1A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><ellipse cx="32" cy="34" rx="24" ry="10" fill="#8A8A8A"/><ellipse cx="32" cy="30" rx="11" ry="9" fill="#B8E6E0"/><path d="M26 42 L22 54 M32 43 L32 56 M38 42 L42 54" stroke="#5DF2C8" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="34" r="2.4" fill="#FFC94D"/><circle cx="32" cy="37" r="2.4" fill="#FFC94D"/><circle cx="44" cy="34" r="2.4" fill="#FFC94D"/></svg>' },
    { id: 'satellite', name: 'Satellite', bg: ['#12283A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="27" y="25" width="10" height="14" rx="2" fill="#B8B8B8"/><rect x="6" y="28" width="16" height="10" fill="#4DA6FF"/><rect x="42" y="28" width="16" height="10" fill="#4DA6FF"/><path d="M14 28 L14 38 M50 28 L50 38" stroke="#0B0B0B" stroke-width="2"/><path d="M32 25 L44 12" stroke="#B8B8B8" stroke-width="3" stroke-linecap="round"/><circle cx="45" cy="11" r="3" fill="#FF6B6B"/></svg>' },
    { id: 'lantern-fox', name: 'Lantern Fox', bg: ['#3A1F08', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 26 L10 6 L26 16 Z" fill="#FF8A3D"/><path d="M50 26 L54 6 L38 16 Z" fill="#FF8A3D"/><ellipse cx="32" cy="36" rx="19" ry="17" fill="#FFB066"/><ellipse cx="32" cy="42" rx="10" ry="8" fill="#FFF1DE"/><circle cx="25" cy="33" r="3" fill="#1A1A1A"/><circle cx="39" cy="33" r="3" fill="#1A1A1A"/><ellipse cx="32" cy="40" rx="3" ry="2.4" fill="#1A1A1A"/><circle cx="46" cy="50" r="6" fill="#FFC94D"/><circle cx="46" cy="50" r="6" fill="none" stroke="#FFF6DE" stroke-width="2"/></svg>' },
    { id: 'crystal-gem', name: 'Crystal Gem', bg: ['#0F3A3A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 6 L50 24 L32 58 L14 24 Z" fill="#5DF2C8"/><path d="M32 6 L50 24 L14 24 Z" fill="#B8FFF0"/><path d="M32 6 L40 24 L32 58 L24 24 Z" fill="#2EBF9A"/><path d="M14 24 L50 24" stroke="#0B3A30" stroke-width="2"/></svg>' },
    { id: 'black-hole', name: 'Black Hole', bg: ['#000000', '#1A1A1A'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><ellipse cx="32" cy="32" rx="27" ry="10" fill="none" stroke="#FF8A3D" stroke-width="4"/><ellipse cx="32" cy="32" rx="27" ry="10" fill="none" stroke="#FFE9A8" stroke-width="1.4"/><circle cx="32" cy="32" r="11" fill="#000000" stroke="#3A3A3A" stroke-width="2"/></svg>' },
    { id: 'telescope', name: 'Telescope', bg: ['#1E2A3A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="16" y="20" width="30" height="12" rx="6" fill="#8A8A8A" transform="rotate(-24 31 26)"/><circle cx="45" cy="18" r="5" fill="#4DA6FF"/><path d="M28 34 L22 56 M34 35 L36 56 M31 34 L31 56" stroke="#B8B8B8" stroke-width="3" stroke-linecap="round"/><path d="M14 10 L15.6 14 L20 14.4 L16.6 17 L17.8 21.2 L14 18.8 L10.2 21.2 L11.4 17 L8 14.4 L12.4 14 Z" fill="#FFE9A8"/></svg>' },
    { id: 'constellation', name: 'Constellation', bg: ['#23233A', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M12 48 L26 30 L40 36 L52 14" stroke="#8A93B8" stroke-width="2" stroke-dasharray="4 3"/><circle cx="12" cy="48" r="4" fill="#FFE9A8"/><circle cx="26" cy="30" r="3" fill="#FFE9A8"/><circle cx="40" cy="36" r="4.6" fill="#FFC94D"/><circle cx="52" cy="14" r="3" fill="#FFE9A8"/></svg>' },
    { id: 'meteor', name: 'Meteor', bg: ['#3A1414', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 12 L30 30 M14 6 L38 28 M26 8 L44 24" stroke="#FF8A3D" stroke-width="4" stroke-linecap="round"/><circle cx="44" cy="40" r="11" fill="#FF6B6B"/><circle cx="41" cy="37" r="5" fill="#FFE9A8"/><circle cx="48" cy="44" r="2.4" fill="#FFC94D"/></svg>' },
    { id: 'galaxy', name: 'Galaxy', bg: ['#1E1E2E', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 40 A26 26 0 0 1 44 10" stroke="#8A93B8" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M56 24 A26 26 0 0 1 20 54" stroke="#5F6685" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="32" cy="32" r="6" fill="#FFE9A8"/><circle cx="32" cy="32" r="10" fill="none" stroke="#FFC94D" stroke-width="2"/></svg>' },
    { id: 'star-badge', name: 'Star Badge', bg: ['#2E2A08', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M24 4 L32 16 L40 4 L44 4 L36 22 L28 22 L20 4 Z" fill="#FF6B6B"/><circle cx="32" cy="38" r="16" fill="#FFC94D"/><circle cx="32" cy="38" r="12.5" fill="none" stroke="#8A5A00" stroke-width="2"/><path d="M32 28 L34.8 35 L42.4 35.4 L36.4 39.8 L38.4 47 L32 42.8 L25.6 47 L27.6 39.8 L21.6 35.4 L29.2 35 Z" fill="#8A5A00"/></svg>' },
    { id: 'nebula', name: 'Nebula', bg: ['#2A1E2E', '#0B0B0B'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="24" cy="32" r="13" fill="#FF6B9D" opacity=".75"/><circle cx="38" cy="28" r="12" fill="#4DA6FF" opacity=".7"/><circle cx="32" cy="40" r="10" fill="#FFE9A8" opacity=".8"/><circle cx="50" cy="48" r="2" fill="#FFFFFF"/><circle cx="12" cy="16" r="2" fill="#FFFFFF"/></svg>' }
  ];

  var byId = {};
  PRESETS.forEach(function(p){ byId[p.id] = p; });

  var ALLOWED_MIME = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };
  var MAX_SOURCE_BYTES = 5 * 1024 * 1024;
  var MAX_STORED_CHARS = 7800; // keeps the shared doc small (see profiles.js cap)

  function svgUrl(p){
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(p.svg);
  }

  function decodeFile(file){
    if(typeof createImageBitmap === 'function'){
      return createImageBitmap(file).then(function(bmp){
        return { w: bmp.width, h: bmp.height, draw: function(ctx, sx, sy, sw, sh, dx, dy, dw, dh){
          ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
          try{ if(bmp.close) bmp.close(); }catch(e){}
        } };
      });
    }
    return new Promise(function(resolve, reject){
      var url = null;
      try{ url = URL.createObjectURL(file); }catch(e){ reject(new Error('decode')); return; }
      var img = new Image();
      img.onload = function(){
        resolve({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height,
          draw: function(ctx, sx, sy, sw, sh, dx, dy, dw, dh){ ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); } });
        try{ URL.revokeObjectURL(url); }catch(e){}
      };
      img.onerror = function(){ try{ URL.revokeObjectURL(url); }catch(e){} reject(new Error('decode')); };
      img.src = url;
    });
  }

  function renderSquare(src, size, quality){
    var side = Math.min(src.w, src.h);
    var sx = Math.floor((src.w - side) / 2), sy = Math.floor((src.h - side) / 2);
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    if(!ctx) return '';
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, size, size);
    src.draw(ctx, sx, sy, side, side, 0, 0, size, size); // center cover-crop: no distortion
    try{ return cv.toDataURL('image/jpeg', quality); }catch(e){ return ''; }
  }

  var Avatars = {
    PRESETS: PRESETS,
    count: function(){ return PRESETS.length; },
    isPreset: function(id){ return !!(id && byId[id]); },
    preset: function(id){ return byId[id] || null; },
    defaultId: function(){ return 'nova-star'; },

    /* Display URL for any stored avatar value (preset id | {custom} | junk). */
    url: function(avatar){
      if(typeof avatar === 'string' && byId[avatar]) return svgUrl(byId[avatar]);
      if(avatar && typeof avatar === 'object' && typeof avatar.custom === 'string' &&
         /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar.custom)) return avatar.custom;
      return svgUrl(byId['nova-star']);
    },
    bg: function(avatar){
      if(typeof avatar === 'string' && byId[avatar]) return byId[avatar].bg;
      return ['#23232E', '#0B0B0B'];
    },

    /* Builds a circular avatar <span> via DOM APIs (no innerHTML of user data). */
    element: function(avatar, sizePx, cls){
      var doc = (typeof document !== 'undefined') ? document : null;
      var wrap = doc ? doc.createElement('span') : null;
      if(!wrap) return null;
      wrap.className = 'avatar-circle' + (cls ? ' ' + cls : '');
      if(sizePx) wrap.style.width = wrap.style.height = String(sizePx) + 'px';
      var b = this.bg(avatar);
      wrap.style.background = 'linear-gradient(135deg,' + b[0] + ',' + b[1] + ')';
      var img = doc.createElement('img');
      img.className = 'avatar-img';
      img.alt = '';
      img.setAttribute('draggable', 'false');
      try{ img.src = this.url(avatar); }catch(e){}
      // Custom photos fill the circle edge-to-edge; SVG presets sit inset.
      img.style.objectFit = (avatar && typeof avatar === 'object' && avatar.custom) ? 'cover' : 'contain';
      wrap.appendChild(img);
      return wrap;
    },

    /* Validates + downscales a user-chosen file. Resolves
       {ok:true,dataUrl} or {ok:false,error}. Never throws. */
    processCustomFile: function(file){
      if(!file || typeof file !== 'object') return Promise.resolve({ ok: false, error: 'No file selected.' });
      var type = String(file.type || '').toLowerCase();
      if(!ALLOWED_MIME[type]) return Promise.resolve({ ok: false, error: 'Only PNG, JPEG, WEBP or GIF images are allowed.' });
      if(file.size > MAX_SOURCE_BYTES) return Promise.resolve({ ok: false, error: 'That image is too large (max 5 MB).' });
      if(typeof document === 'undefined' || !document.createElement)
        return Promise.resolve({ ok: false, error: 'Image upload is not supported on this device.' });
      return decodeFile(file).then(function(src){
        if(!src.w || !src.h) return { ok: false, error: 'Could not read that image. Try another file.' };
        var steps = [[96, 0.70], [80, 0.68], [64, 0.62]];
        for(var i = 0; i < steps.length; i++){
          var url = renderSquare(src, steps[i][0], steps[i][1]);
          if(url && url.length <= MAX_STORED_CHARS) return { ok: true, dataUrl: url };
        }
        return { ok: false, error: 'That image is too detailed to store. Try a smaller or simpler photo.' };
      }).catch(function(){
        return { ok: false, error: 'Could not read that image. Try another file.' };
      });
    }
  };

  global.SP_Avatars = Avatars;
})(typeof window !== 'undefined' ? window : this);
