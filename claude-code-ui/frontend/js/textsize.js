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
  });
})();
