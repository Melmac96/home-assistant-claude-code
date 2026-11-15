/* my10: text size + font, remembered per device (localStorage). Runs in <head> so there is no flash. */
(function () {
  var K1 = 'ccui-ts', K2 = 'ccui-font', K3 = 'ccui-reply-ts', root = document.documentElement;
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function apply(ts, font) {
    root.style.setProperty('--chat-ts', String(ts / 100));   // my38: only the chat area reads this
    if (font) root.style.setProperty('--ui-font', font + ', system-ui, sans-serif');
    else root.style.removeProperty('--ui-font');
  }
  var ts = parseInt(get(K1, '100'), 10) || 100, font = get(K2, '');
  apply(ts, font);
  // my110 (Michael 15 Nov, Q1 C): Claude's replies keep ONE size he picks in Settings; pinching never changes it.
  // First run: starts at the size the chat has on this device now, so nothing jumps.
  var rts = parseInt(get(K3, ''), 10);
  if (!rts) { rts = ts; put(K3, rts); }
  function applyReply() { root.style.setProperty('--reply-ts', String(rts / 100)); }
  applyReply();
  document.addEventListener('DOMContentLoaded', function () {
    var r = document.getElementById('ts-range'), v = document.getElementById('ts-val'),
        s = document.getElementById('font-select'), p = document.getElementById('ts-preview');
    if (!r || !s) return;
    function show() {
      r.value = ts; v.textContent = ts + '%'; s.value = font;
      p.style.fontFamily = font ? font + ', system-ui, sans-serif' : '';
    }
    function set(n) { ts = Math.max(80, Math.min(250, n)); put(K1, ts); apply(ts, font); show(); }
    r.addEventListener('input', function () { set(parseInt(r.value, 10)); });
    document.getElementById('ts-down').addEventListener('click', function () { set(ts - 10); });
    document.getElementById('ts-up').addEventListener('click', function () { set(ts + 10); });
    var rr = document.getElementById('rts-range'), rv = document.getElementById('rts-val');
    function showReply() { if (rr) { rr.value = rts; rv.textContent = rts + '%'; } }
    function setReply(n) { rts = Math.max(80, Math.min(250, n)); put(K3, rts); applyReply(); showReply(); }
    if (rr) {
      rr.addEventListener('input', function () { setReply(parseInt(rr.value, 10)); });
      document.getElementById('rts-down').addEventListener('click', function () { setReply(rts - 10); });
      document.getElementById('rts-up').addEventListener('click', function () { setReply(rts + 10); });
      showReply();
    }
    s.addEventListener('change', function () { font = s.value; put(K2, font); apply(ts, font); show(); });
    show();
    window.ccuiShowTs = show;
  });
  // my11: two-finger pinch changes the text size (same setting as the slider), remembered per device
  var pd = 0, p0 = 100, raf = 0, pt = 0;
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  // my115: the blocking move listener is only on while two fingers are down, so normal one-finger scrolling never
  // waits for the page script (it juddered on the phone and tablet); a cancelled pinch is tidied up too
  function onMove(e) {
    if (e.touches.length !== 2 || !pd) return;
    e.preventDefault();
    var n = Math.max(80, Math.min(250, Math.round(p0 * dist(e.touches) / pd / 5) * 5));
    if (n === ts || raf) return;
    raf = requestAnimationFrame(function () { raf = 0; ts = n; apply(ts, font); });
  }
  var moveOn = false;
  function watchMove(on) {
    if (on === moveOn) return;
    moveOn = on;
    if (on) document.addEventListener('touchmove', onMove, { passive: false });
    else document.removeEventListener('touchmove', onMove, { passive: false });
  }
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { pd = dist(e.touches); p0 = ts; clearTimeout(pt); window.ccuiPinching = true; watchMove(true); } else pd = 0;
  }, { passive: true });
  function endPinch() {
    watchMove(false);
    if (!pd) return;
    pd = 0; put(K1, ts); if (window.ccuiShowTs) window.ccuiShowTs();
    pt = setTimeout(function () { window.ccuiPinching = false; }, 500);   // my39: lets the chat settle first
  }
  document.addEventListener('touchend', endPinch, { passive: true });
  document.addEventListener('touchcancel', endPinch, { passive: true });
})();
