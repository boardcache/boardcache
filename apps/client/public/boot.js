// Runs before the app bundle, as a plain blocking script so the page can
// carry a Content-Security-Policy without 'unsafe-inline' for scripts.
(function () {
  // Pretty share links: nginx serves /s/<id> as this SPA shell; hand off to
  // the standalone share viewer before the app bundle loads. The URL fragment
  // (the decryption key) rides along and never hits the server.
  if (location.pathname.indexOf('/s/') === 0) {
    var sid = location.pathname.slice(3).split('/')[0];
    location.replace('/share.html?id=' + encodeURIComponent(sid) + location.hash);
    return;
  }
  // iOS 27 draws a blurred strip under the status bar of an installed web
  // app (viewport-fit=cover) that the safe-area inset does not report. Flag
  // it before first paint; 02-base.css turns the flag into --safe-top so the
  // top chrome starts below the strip. Only the installed app is affected.
  // The installed app's UA carries no Safari version, and since iOS 26 the
  // OS version is frozen at "18_7" (the Safari tab of the same phone says
  // Version/27.0 beside that same 18_7) — so "18_7", or anything 26+, is
  // read as a modern iPhone. A phone genuinely on 18.7 gets 16px it does
  // not need; that beats every iOS 27 phone getting a blurred toolbar.
  var os = /\b(?:iPhone|iPod)\b.*?\bOS (\d+)_(\d+)/.exec(navigator.userAgent);
  var modern = os && (Number(os[1]) >= 26 || (os[1] === '18' && os[2] === '7'));
  var installed =
    navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (modern && installed) document.documentElement.dataset.iosTopBlur = '';
  // Apply the theme before first paint so there is no flash. The React
  // ThemeToggle takes over after hydration using the same storage key.
  var stored = null;
  try {
    stored = localStorage.getItem('boardcache:theme') || localStorage.getItem('refboard:theme');
  } catch (_e) {
    /* storage unavailable (private mode etc.) — fall back to system */
  }
  var dark =
    stored === 'dark' ||
    ((stored === null || stored === 'system') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  var mode = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = mode;
  // The iOS status bar strip of a home-screen app takes the theme-color: set
  // it to the theme's app background before first paint (the hook refines it
  // once the tokens are in).
  var tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', mode === 'dark' ? '#161618' : '#f5f5f5');
  // Color-family overrides (lib/themes.ts writes this cache): applying them
  // before first paint avoids a flash of the default palette.
  try {
    var boot = JSON.parse(localStorage.getItem('boardcache:themeBoot') || 'null');
    if (boot && boot[mode]) {
      for (var k in boot[mode]) document.documentElement.style.setProperty(k, boot[mode][k]);
    }
  } catch (_e) {
    /* corrupt cache — default palette until React applies the theme */
  }
})();
