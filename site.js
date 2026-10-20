(function () {
  var root = document.documentElement;

  /* theme toggle, remembered per browser */
  var btn = document.getElementById('themeBtn');
  if (btn) {
    btn.addEventListener('click', function () {
      var explicit = root.getAttribute('data-theme');
      var isDark = explicit ? explicit === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = isDark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  /* copy email */
  var copyBtn = document.getElementById('copyBtn');
  var mail = document.getElementById('mailText');
  if (copyBtn && mail) {
    copyBtn.addEventListener('click', function () {
      var done = function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1600); };
      var fallback = function () {
        var r = document.createRange(); r.selectNodeContents(mail);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        copyBtn.textContent = 'Selected';
      };
      try { navigator.clipboard.writeText(mail.textContent).then(done, fallback); } catch (e) { fallback(); }
    });
  }

  /* latest posts on the home page */
  var latest = document.getElementById('latest');
  if (latest) {
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    fetch('/posts.json').then(function (r) { return r.json(); }).then(function (posts) {
      if (!posts.length) return;
      latest.innerHTML = posts.slice(0, 3).map(function (p) {
        var d = new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
        return '<li class="row"><a href="/blog/' + esc(p.slug) + '/"><div><h3>' + esc(p.title) + '</h3><p>' + esc(p.excerpt) + '</p></div>' +
          '<div class="meta mono"><span>' + esc(d) + '</span><span class="arrow">↗</span></div></a></li>';
      }).join('');
      latest.hidden = false;
      var empty = document.getElementById('latestEmpty'); if (empty) empty.hidden = true;
      var more = document.getElementById('latestMore'); if (more) more.hidden = false;
    }).catch(function () {});
  }

  /* Rorschach plate: half the nodes are generated, then mirrored across the axis */
  var cv = document.getElementById('blot');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seed = 20260419, pts = [], pairs = [], raf = 0, W = 0, H = 0;

  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { var u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function build() {
    var r = rng(seed); pts = []; pairs = [];
    var n = 46;
    for (var i = 0; i < n; i++) {
      var x = Math.abs(gauss(r)) * 0.3 + 0.01;
      var y = gauss(r) * 0.3;
      var d = Math.sqrt(x * x + y * y);
      var rad = Math.max(0.018, (0.1 - d * 0.1) * (0.5 + r()));
      pts.push({ x: x, y: y, r: rad, s: 0.4 + r() * 0.7, ph: r() * 6.28 });
    }
    for (var a = 0; a < n; a++) for (var b = a + 1; b < n; b++) {
      var dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < 0.26) pairs.push([a, b, dd]);
    }
  }

  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    var cs = getComputedStyle(root);
    var ink = cs.getPropertyValue('--ink').trim() || '#12141C';
    var net = cs.getPropertyValue('--net').trim() || '#9BA5FF';
    var accent = cs.getPropertyValue('--accent').trim() || '#2B39F0';
    ctx.clearRect(0, 0, W, H);
    var sc = Math.min(W, H) * 0.95, cx = W / 2, cy = H / 2;
    var pos = pts.map(function (p) {
      return { x: p.x + Math.sin(t * p.s + p.ph) * 0.012, y: p.y + Math.cos(t * p.s * 0.8 + p.ph) * 0.012 };
    });
    [1, -1].forEach(function (side) {
      ctx.fillStyle = ink;
      pts.forEach(function (p, i) {
        ctx.beginPath(); ctx.arc(cx + side * pos[i].x * sc, cy + pos[i].y * sc, p.r * sc, 0, 6.2832); ctx.fill();
      });
    });
    ctx.lineWidth = 1;
    [1, -1].forEach(function (side) {
      ctx.strokeStyle = net;
      pairs.forEach(function (q) {
        var a = pos[q[0]], b = pos[q[1]];
        ctx.globalAlpha = 0.25 + 0.75 * (1 - q[2] / 0.26);
        ctx.beginPath();
        ctx.moveTo(cx + side * a.x * sc, cy + a.y * sc);
        ctx.lineTo(cx + side * b.x * sc, cy + b.y * sc);
        ctx.stroke();
      });
    });
    ctx.globalAlpha = 1;
    [1, -1].forEach(function (side) {
      ctx.fillStyle = accent;
      pos.forEach(function (p) {
        ctx.beginPath(); ctx.arc(cx + side * p.x * sc, cy + p.y * sc, 2.2, 0, 6.2832); ctx.fill();
      });
    });
  }

  function loop(ms) { draw(ms / 1000); raf = requestAnimationFrame(loop); }
  function start() { cancelAnimationFrame(raf); if (reduce) draw(0); else raf = requestAnimationFrame(loop); }

  build(); size(); start();
  window.addEventListener('resize', function () { size(); if (reduce) draw(0); });
  new MutationObserver(function () { if (reduce) draw(0); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  var again = document.getElementById('again');
  if (again) again.addEventListener('click', function () {
    seed = (seed * 1664525 + 1013904223) | 0; build(); start();
  });
})();
