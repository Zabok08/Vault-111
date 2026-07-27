// ==UserScript==
// @name         Vault 111 Mobile Diagnostic
// @namespace    https://www.torn.com/
// @version      1.0.0
// @description  Temporary visible check that confirms whether a mobile userscript manager is running on Torn.
// @author       Vault 111
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @match        https://*.torn.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function mountDiagnostic() {
    if (document.getElementById('v111-mobile-diagnostic')) return;
    var badge = document.createElement('button');
    badge.id = 'v111-mobile-diagnostic';
    badge.type = 'button';
    badge.textContent = 'Vault 111 script is running';
    badge.setAttribute('aria-label', 'Vault 111 mobile diagnostic is running. Tap for page details.');
    badge.style.cssText = [
      'position:fixed!important',
      'left:8px!important',
      'bottom:12px!important',
      'z-index:2147483647!important',
      'display:block!important',
      'visibility:visible!important',
      'opacity:1!important',
      'max-width:calc(100vw - 16px)!important',
      'padding:10px 12px!important',
      'border:2px solid #f2c94c!important',
      'border-radius:8px!important',
      'background:#174b7e!important',
      'color:#fff!important',
      'font:700 13px/1.3 Arial,sans-serif!important',
      'box-shadow:0 6px 24px rgba(0,0,0,.75)!important'
    ].join(';');
    badge.onclick = function () {
      window.alert('Vault 111 diagnostic passed.\\n\\nPage: ' + window.location.href + '\\n\\nSend the page address and the name of your mobile browser/userscript app if the full Control Center is still missing.');
    };
    (document.body || document.documentElement).appendChild(badge);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountDiagnostic);
  } else {
    mountDiagnostic();
  }
})();
