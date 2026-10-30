/* my10: text size + font, remembered per device (localStorage). Runs in <head> so there is no flash. */
(function () {
  var K1 = 'ccui-ts', K2 = 'ccui-font', root = document.documentElement;
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function apply(ts, font) {
    root.style.setProperty('--ts', String(ts / 100));
    if (font) root.style.setProperty('--ui-font', font + ', system-ui, sans-serif');
    else root.style.removeProperty('--ui-font');
  }
  var ts = parseInt(get(K1, '100'), 10) || 100, font = get(K2, '');
  apply(ts, font);
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
    s.addEventListener('change', function () { font = s.value; put(K2, font); apply(ts, font); show(); });
    show();
    window.ccuiShowTs = show;
  });
  // my11: two-finger pinch changes the text size (same setting as the slider), remembered per device
  var pd = 0, p0 = 100, raf = 0;
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) { pd = dist(e.touches); p0 = ts; } else pd = 0;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (e.touches.length !== 2 || !pd) return;
    e.preventDefault();
    var n = Math.max(80, Math.min(250, Math.round(p0 * dist(e.touches) / pd / 5) * 5));
    if (n === ts || raf) return;
    raf = requestAnimationFrame(function () { raf = 0; ts = n; apply(ts, font); });
  }, { passive: false });
  document.addEventListener('touchend', function () {
    if (!pd) return;
    pd = 0; put(K1, ts); if (window.ccuiShowTs) window.ccuiShowTs();
  }, { passive: true });
})();
