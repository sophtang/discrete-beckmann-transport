/* DBTM blog: math rendering, navigation, figure players, and interactive explanations. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C = {
    navy: '#05009e', indigo: '#3a3cb1', violet: '#7071e0', violet2: '#6b67ee',
    lavender: '#e4e2fe', lavender2: '#d4d3f8', sky: '#8ad4f0', sky2: '#ddf1fa', blue: '#50b2d7',
    mint: '#7fe5c1', mint2: '#cff5e6', mintDeep: '#3fbf93', slate: '#55537f', muted: '#6c6a92', grid: '#eceafb',
  };
  const VERTEX_COLORS = [C.indigo, C.sky, C.mint];
  const BASIN_RGB = [[228, 226, 254], [221, 241, 250], [207, 245, 230]];

  /* ── Utilities ─────────────────────────────────────────── */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    let u = 0; while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }
  const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  const fmtInt = (x) => Math.round(x).toLocaleString('en-US');

  // Size a canvas for the device pixel ratio; drawing uses its logical (attribute) size.
  function setupCanvas(canvas) {
    const w = +canvas.getAttribute('width'), h = +canvas.getAttribute('height');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.aspectRatio = w + ' / ' + h;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  // Typeset a KaTeX label positioned over a canvas, in the canvas's logical coordinates.
  function texLabel(canvas, key, tex, x, y, ax = 0, ay = 0) {
    const wrap = canvas.parentElement, w = +canvas.getAttribute('width'), h = +canvas.getAttribute('height');
    wrap._labels = wrap._labels || {};
    let el = wrap._labels[key];
    if (!el) { el = document.createElement('span'); el.className = 'tex-label'; wrap.appendChild(el); wrap._labels[key] = el; }
    if (el._tex !== tex) {
      el._tex = tex;
      if (window.katex) window.katex.render(tex, el, { throwOnError: false }); else el.textContent = tex;
    }
    el.style.left = (x / w * 100) + '%'; el.style.top = (y / h * 100) + '%';
    el.style.transform = 'translate(' + (-ax * 100) + '%, ' + (-ay * 100) + '%)';
    return el;
  }
  const tex = (src) => (window.katex ? window.katex.renderToString(src, { throwOnError: false }) : src);
  // Map a pointer event to logical canvas coordinates.
  function canvasPoint(canvas, ev, w, h) {
    const r = canvas.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * w, ((ev.clientY - r.top) / r.height) * h];
  }
  // Run fn once when el first comes near the viewport.
  function whenVisible(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: '250px' });
    io.observe(el);
  }
  function setPressed(buttons, active) {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === active)));
  }

  /* ── Math ──────────────────────────────────────────────── */
  function renderMath() {
    if (typeof window.renderMathInElement !== 'function') return;
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
    });
  }

  /* ── Theme, progress, contents ─────────────────────────── */
  function initChrome() {
    const root = document.documentElement;
    const toggle = $('#themeToggle');
    const isDark = () => root.getAttribute('data-theme') === 'dark' ||
      (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    toggle && toggle.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('dbtm-theme', next); } catch (e) { /* storage unavailable */ }
    });

    const progress = $('#progress');
    const article = $('#article');
    const links = $$('.toc a');
    const targets = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    let ticking = false;
    function update() {
      ticking = false;
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const frac = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      if (progress) progress.style.width = (frac * 100).toFixed(2) + '%';
      let current = null;
      for (const t of targets) { if (t.getBoundingClientRect().top < 140) current = t; else break; }
      links.forEach((a) => a.classList.toggle('active', !!current && a.getAttribute('href') === '#' + current.id));
      $$('.toc > ol > li').forEach((li) => li.classList.toggle('open', !!li.querySelector('a.active')));
    }
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ── Figure players ────────────────────────────────────── */
  const ICON = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>',
    zoom: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg>',
  };

  function initPlayers() {
    const videos = $$('video[data-player]');
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const p = e.target._player;
        if (!p) return;
        p.visible = e.isIntersecting;
        if (e.isIntersecting && !p.userPaused && !reduceMotion) p.play();
        else if (!e.isIntersecting) p.video.pause();
      });
    }, { threshold: 0.35 }) : null;

    videos.forEach((video) => {
      video.removeAttribute('controls');
      const fig = video.closest('.fig');
      const frame = video.closest('.fig-frame');
      const bar = document.createElement('div');
      bar.className = 'player-bar';
      bar.innerHTML =
        '<button class="btn icon-btn" type="button" data-r="pp" aria-label="Play">' + ICON.play + '</button>' +
        '<input class="scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Scrub animation">' +
        '<span class="time">0.0 / 0.0 s</span>' +
        '<button class="chip" type="button" data-r="speed" title="Playback speed">1×</button>';
      frame.after(bar);
      const pp = $('[data-r="pp"]', bar), scrub = $('.scrub', bar), time = $('.time', bar), speed = $('[data-r="speed"]', bar);
      const p = { video, userPaused: reduceMotion, visible: false };
      video._player = p;

      p.play = function () {
        const pr = video.play();
        if (pr && pr.catch) pr.catch(() => {});
      };
      function sync() {
        const d = video.duration || 0;
        if (d) scrub.value = String(Math.round((video.currentTime / d) * 1000));
        time.textContent = video.currentTime.toFixed(1) + ' / ' + d.toFixed(1) + ' s';
      }
      let raf = 0;
      function loop() { sync(); raf = video.paused ? 0 : requestAnimationFrame(loop); }
      video.addEventListener('play', () => { pp.innerHTML = ICON.pause; pp.setAttribute('aria-label', 'Pause'); if (!raf) raf = requestAnimationFrame(loop); });
      video.addEventListener('pause', () => { pp.innerHTML = ICON.play; pp.setAttribute('aria-label', 'Play'); sync(); });
      video.addEventListener('loadedmetadata', sync);
      video.addEventListener('seeked', sync);
      pp.addEventListener('click', () => {
        if (video.paused) { p.userPaused = false; p.play(); } else { p.userPaused = true; video.pause(); }
      });
      scrub.addEventListener('input', () => {
        p.userPaused = true; video.pause();
        if (video.preload === 'none') video.preload = 'auto';
        const d = video.duration;
        if (d) video.currentTime = (scrub.value / 1000) * d;
      });
      const rates = [1, 0.5, 0.25];
      speed.addEventListener('click', () => {
        const i = (rates.indexOf(video.playbackRate) + 1) % rates.length;
        video.playbackRate = rates[i];
        speed.textContent = rates[i] + '×';
      });

      const chapters = video.getAttribute('data-chapters');
      if (chapters) {
        const wrap = document.createElement('div');
        wrap.className = 'chapters';
        chapters.split('|').forEach((c) => {
          const [t, label] = c.split(/:(.+)/);
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'chip'; b.textContent = label;
          b.addEventListener('click', () => {
            p.userPaused = true; video.pause();
            const seek = () => { video.currentTime = Math.min(+t, (video.duration || +t) - 0.05); };
            if (video.readyState >= 1) seek(); else { video.preload = 'auto'; video.addEventListener('loadedmetadata', seek, { once: true }); video.load(); }
            $$('.chip', wrap).forEach((x) => x.classList.toggle('active', x === b));
          });
          wrap.appendChild(b);
        });
        bar.appendChild(wrap);
      }
      addZoom(frame, fig);
      if (io) io.observe(video);
    });

    $$('.fig-frame > img').forEach((img) => addZoom(img.parentElement, img.closest('.fig')));
  }

  /* ── Lightbox ──────────────────────────────────────────── */
  const lightbox = { el: null, media: null, cap: null, last: null };
  function addZoom(frame, fig) {
    if (!lightbox.el || $('.zoom-btn', frame)) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'zoom-btn'; b.innerHTML = ICON.zoom;
    b.setAttribute('aria-label', 'Enlarge figure');
    b.addEventListener('click', () => openLightbox(frame, fig, b));
    frame.appendChild(b);
  }
  function openLightbox(frame, fig, opener) {
    const src = frame.querySelector('video, img');
    lightbox.media.innerHTML = '';
    let node;
    if (src.tagName === 'VIDEO') {
      src.pause();
      node = document.createElement('video');
      node.src = src.currentSrc || src.src;
      node.muted = true; node.loop = true; node.playsInline = true; node.controls = true;
      node.currentTime = src.currentTime || 0;
      node.autoplay = !reduceMotion;
    } else {
      node = document.createElement('img');
      node.src = src.src; node.alt = src.alt;
    }
    lightbox.media.appendChild(node);
    const cap = fig && fig.querySelector('figcaption');
    lightbox.cap.innerHTML = cap ? cap.innerHTML : '';
    lightbox.last = opener;
    lightbox.el.classList.add('open');
    document.body.style.overflow = 'hidden';
    $('[data-role="close"]', lightbox.el).focus();
  }
  function closeLightbox() {
    if (!lightbox.el.classList.contains('open')) return;
    lightbox.el.classList.remove('open');
    lightbox.media.innerHTML = '';
    document.body.style.overflow = '';
    if (lightbox.last) lightbox.last.focus();
  }
  function initLightbox() {
    lightbox.el = $('#lightbox');
    if (!lightbox.el) return;
    lightbox.media = $('[data-role="media"]', lightbox.el);
    lightbox.cap = $('[data-role="cap"]', lightbox.el);
    $('[data-role="close"]', lightbox.el).addEventListener('click', closeLightbox);
    lightbox.el.addEventListener('click', (e) => { if (e.target === lightbox.el) closeLightbox(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  }

  /* ── Toy model: one token, V = 3, linear interpolant ───────
     x0 ~ N(0, σ² I₃), I_t = (1-t) x0 + t e_j with prior π. Everything is computed on the
     invariant plane Σx = 1, parameterized isometrically by 2D coordinates (a, b). */
  const Toy = (function () {
    const PI = [0.45, 0.33, 0.22], SIG = 0.55;
    const LOGPI = PI.map(Math.log);
    const R2 = Math.SQRT2, R6 = Math.sqrt(6);
    const U1 = [0, -1 / R2, 1 / R2], U2 = [2 / R6, -1 / R6, -1 / R6];
    const to3 = (a, b) => [1 / 3 + a * U1[0] + b * U2[0], 1 / 3 + a * U1[1] + b * U2[1], 1 / 3 + a * U1[2] + b * U2[2]];
    const proj = (v) => [v[0] * U1[0] + v[1] * U1[1] + v[2] * U1[2], v[0] * U2[0] + v[1] * U2[1] + v[2] * U2[2]];
    const to2 = (x) => proj([x[0] - 1 / 3, x[1] - 1 / 3, x[2] - 1 / 3]);
    const VERT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(to2);

    function sqDist(x, t, j) {
      const d0 = x[0] - (j === 0 ? t : 0), d1 = x[1] - (j === 1 ? t : 0), d2 = x[2] - (j === 2 ? t : 0);
      return d0 * d0 + d1 * d1 + d2 * d2;
    }
    // Posterior-mean denoiser D_t(x) = Σ_j w_j e_j.
    function denoise(x, t) {
      const s2 = SIG * SIG * (1 - t) * (1 - t);
      const l = [0, 1, 2].map((j) => LOGPI[j] - sqDist(x, t, j) / (2 * s2));
      const m = Math.max(l[0], l[1], l[2]);
      const e = l.map((v) => Math.exp(v - m)), z = e[0] + e[1] + e[2];
      return [e[0] / z, e[1] / z, e[2] / z];
    }
    // Frozen time-dependent field b_t(x) = (D_t(x) - x)/(1 - t), in plane coordinates.
    function bt(a, b, t) {
      const x = to3(a, b), d = denoise(x, t);
      return proj([(d[0] - x[0]) / (1 - t), (d[1] - x[1]) / (1 - t), (d[2] - x[2]) / (1 - t)]);
    }
    // Quadrature in t, concentrated near t = 1 where the densities sharpen.
    const NQ = 220, TQ = new Float64Array(NQ), LQ = new Float64Array(NQ);
    for (let k = 0; k < NQ; k++) {
      const u = (k + 0.5) / NQ, om = 1 - u;
      TQ[k] = 1 - om * om * om;
      const s = SIG * om * om * om;
      LQ[k] = Math.log(3 * om * om / NQ) - 3 * Math.log(s); // quadrature weight × Gaussian normalizer
    }
    const LW = new Float64Array(NQ * 3);
    // Autonomous field b(x) = ∫ Σ_j π_j N_j,t(x) (e_j - x)/(1-t) dt / ∫ μ_t(x) dt.
    function bAuto(a, b) {
      const x = to3(a, b);
      let m = -Infinity;
      for (let k = 0; k < NQ; k++) {
        const t = TQ[k], s = SIG * (1 - t), inv = 1 / (2 * s * s);
        for (let j = 0; j < 3; j++) {
          const v = LQ[k] + LOGPI[j] - sqDist(x, t, j) * inv;
          LW[k * 3 + j] = v; if (v > m) m = v;
        }
      }
      let den = 0, n0 = 0, n1 = 0, n2 = 0;
      for (let k = 0; k < NQ; k++) {
        const r = 1 / (1 - TQ[k]);
        for (let j = 0; j < 3; j++) {
          const w = Math.exp(LW[k * 3 + j] - m);
          if (w < 1e-14) continue;
          den += w;
          n0 += w * ((j === 0 ? 1 : 0) - x[0]) * r;
          n1 += w * ((j === 1 ? 1 : 0) - x[1]) * r;
          n2 += w * ((j === 2 ? 1 : 0) - x[2]) * r;
        }
      }
      return proj([n0 / den, n1 / den, n2 / den]);
    }
    // Stable equilibria of the frozen field: fixed points of x ← D_t(x).
    function attractors(t) {
      const seeds = [[1 / 3, 1 / 3, 1 / 3], PI.slice()];
      for (let j = 0; j < 3; j++) seeds.push([0, 1, 2].map((i) => (i === j ? 0.9 : 0.05)));
      const rand = mulberry32(7);
      for (let i = 0; i < 24; i++) {
        const r1 = rand(), r2 = rand(), r3 = rand(), z = r1 + r2 + r3;
        seeds.push([r1 / z, r2 / z, r3 / z]);
      }
      const found = [];
      seeds.forEach((s) => {
        let x = s;
        for (let it = 0; it < 600; it++) {
          const d = denoise(x, t);
          const diff = Math.abs(d[0] - x[0]) + Math.abs(d[1] - x[1]) + Math.abs(d[2] - x[2]);
          x = d;
          if (diff < 1e-10) break;
        }
        const p = to2(x);
        if (!found.some((f) => Math.hypot(f[0] - p[0], f[1] - p[1]) < 0.03)) found.push(p);
      });
      return found;
    }
    function nearestVertex(p) {
      let best = 0, bd = Infinity;
      VERT.forEach((v, j) => { const d = Math.hypot(p[0] - v[0], p[1] - v[1]); if (d < bd) { bd = d; best = j; } });
      return [best, bd];
    }
    // Autonomous trajectory (Heun steps of fixed spatial length) until absorbed at a vertex.
    function autoPath(p0, field = bAuto) {
      const path = [p0.slice()];
      let p = p0.slice();
      for (let i = 0; i < 2500; i++) {
        const [j, d] = nearestVertex(p);
        if (d < 0.008) { path.push(VERT[j].slice()); return { path, vertex: j }; }
        const v1 = field(p[0], p[1]);
        const sp = Math.hypot(v1[0], v1[1]);
        const ds = Math.min(0.006, d * 0.5) / Math.max(sp, 0.05);
        const q = [p[0] + ds * v1[0], p[1] + ds * v1[1]];
        const v2 = field(q[0], q[1]);
        p = [p[0] + 0.5 * ds * (v1[0] + v2[0]), p[1] + 0.5 * ds * (v1[1] + v2[1])];
        path.push(p.slice());
      }
      return { path, vertex: nearestVertex(p)[0] };
    }
    // Time-dependent trajectory from t = 0 to 1 with an exponential integrator (exact for frozen D).
    function timePath(p0) {
      const N = 320, path = [p0.slice()];
      let x = to3(p0[0], p0[1]);
      for (let k = 0; k < N; k++) {
        const t0 = 1 - Math.pow(1 - k / N, 2), t1 = 1 - Math.pow(1 - (k + 1) / N, 2);
        const d = denoise(x, t0), f = (1 - t1) / (1 - t0);
        x = [d[0] + (x[0] - d[0]) * f, d[1] + (x[1] - d[1]) * f, d[2] + (x[2] - d[2]) * f];
        path.push(to2(x));
      }
      return { path, vertex: nearestVertex(path[path.length - 1])[0] };
    }
    return { PI, SIG, VERT, bt, bAuto, attractors, autoPath, timePath, nearestVertex };
  })();

  // A view maps plane coordinates (a, b) to canvas pixels.
  function makeView(w, h, halfH, cy) {
    const s = h / (2 * halfH);
    return {
      s,
      px: (a, b) => [w / 2 + a * s, h / 2 - (b - cy) * s],
      inv: (x, y) => [(x - w / 2) / s, cy - (y - h / 2) / s],
      bounds: () => [-w / 2 / s, w / 2 / s, cy - halfH, cy + halfH],
    };
  }
  function drawSimplex(ctx, view, opts = {}) {
    const P = Toy.VERT.map((v) => view.px(v[0], v[1]));
    ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
    if (opts.fill !== false) { ctx.fillStyle = 'rgba(212,211,248,0.45)'; ctx.fill(); }
    ctx.lineWidth = 2; ctx.strokeStyle = C.indigo; ctx.stroke();
    const labels = ['e₁', 'e₂', 'e₃'], off = [[0, -16], [-16, 14], [16, 14]];
    P.forEach((p, j) => {
      ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 2 * Math.PI);
      ctx.fillStyle = VERTEX_COLORS[j]; ctx.fill();
      ctx.fillStyle = C.navy; ctx.font = 'italic 16px Volkhov, Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(labels[j], p[0] + off[j][0], p[1] + off[j][1]);
    });
  }
  function drawArrows(ctx, view, w, h, field, color, spacing) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.3;
    for (let y = spacing / 2; y < h; y += spacing) {
      for (let x = spacing / 2; x < w; x += spacing) {
        const [a, b] = view.inv(x, y);
        const v = field(a, b);
        const m = Math.hypot(v[0], v[1]);
        if (!(m > 1e-9)) continue;
        const L = spacing * 0.42, ux = v[0] / m, uy = -v[1] / m;
        ctx.globalAlpha = 0.25 + 0.6 * Math.min(1, m / 1.2);
        const x0 = x - ux * L / 2, y0 = y - uy * L / 2, x1 = x + ux * L / 2, y1 = y + uy * L / 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ux * 4 - uy * 2.6, y1 - uy * 4 + ux * 2.6);
        ctx.lineTo(x1 - ux * 4 + uy * 2.6, y1 - uy * 4 - ux * 2.6); ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawMarker(ctx, p, r) {
    ctx.beginPath(); ctx.arc(p[0], p[1], r + 2.5, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fillStyle = C.indigo; ctx.fill();
  }

  /* ── Interactive 1: frozen time-dependent field vs autonomous field ── */
  function initField(root) {
    const left = setupCanvas($('[data-role="left"]', root));
    const right = setupCanvas($('[data-role="right"]', root));
    const slider = $('[data-role="t"]', root), out = $('[data-role="tval"]', root);
    const sub = $('[data-role="tdsub"]', root), status = $('[data-role="status"]', root);
    const play = $('[data-role="play"]', root);
    const view = makeView(left.w, left.h, 1.25, 0.18);
    // Autonomous panel never changes: draw once to an offscreen buffer.
    function drawRight() {
      const { ctx, w, h } = right;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      drawSimplex(ctx, view);
      drawArrows(ctx, view, w, h, Toy.bAuto, C.violet2, 26);
      Toy.VERT.forEach((v) => drawMarker(ctx, view.px(v[0], v[1]), 5));
    }
    function drawLeft(tOverride) {
      const t = tOverride ?? +slider.value;
      out.textContent = t.toFixed(2); sub.textContent = 'frozen at t = ' + t.toFixed(2);
      const { ctx, w, h } = left;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      drawSimplex(ctx, view);
      drawArrows(ctx, view, w, h, (a, b) => Toy.bt(a, b, t), C.blue, 26);
      const att = Toy.attractors(t);
      att.forEach((p) => drawMarker(ctx, view.px(p[0], p[1]), 5));
      const nearV = att.filter((p) => Toy.nearestVertex(p)[1] < 0.12).length;
      status.textContent = 'At t = ' + t.toFixed(2) + ', the frozen field has ' + att.length + ' stable attractor' + (att.length > 1 ? 's' : '') +
        (nearV ? ' (' + nearV + ' near a vertex)' : ' (in the interior, near the mean p)') + '. The autonomous field always has exactly three, at the vertices.';
    }
    let anim = 0;
    function stop() { cancelAnimationFrame(anim); anim = 0; play.setAttribute('aria-pressed', 'false'); }
    play.addEventListener('click', () => {
      if (anim) { stop(); return; }
      // Track t as a float: the slider's 0.01 step would round small per-frame increments away.
      let t = +slider.value >= 0.96 ? 0 : +slider.value;
      play.setAttribute('aria-pressed', 'true');
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        t = Math.min(0.97, t + dt * 0.14);
        slider.value = String(t); drawLeft(t);
        if (t >= 0.97) stop(); else anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    });
    slider.addEventListener('input', () => { stop(); drawLeft(); });
    drawRight(); drawLeft();
  }

  /* ── Interactive 2: trajectories and basins ────────────── */
  function initPaths(root) {
    const canvas = $('[data-role="canvas"]', root);
    const { ctx, w, h } = setupCanvas(canvas);
    const view = makeView(w, h, 1.3, 0.16);
    const basinsBox = $('[data-role="basins"]', root);
    const ra = $('[data-role="ra"]', root), rt = $('[data-role="rt"]', root), rn = $('[data-role="n"]', root);
    const rand = mulberry32(11);
    let trajectories = [];
    let basinImg = null, basinBusy = false;

    const len = (path) => { let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); return L; };
    const ratio = (path) => {
      const a = path[0], b = path[path.length - 1], ch = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return ch > 0.02 ? len(path) / ch : NaN;
    };

    // Precompute the autonomous field on a grid and integrate every pixel cell to find its basin.
    function computeBasins(done) {
      basinBusy = true;
      const [x0, x1, y0, y1] = view.bounds();
      const GX = 130, GY = Math.round(GX * h / w);
      const FX = 96, FY = Math.round(FX * h / w);
      const fa = new Float64Array(FX * FY), fb = new Float64Array(FX * FY);
      const dx = (x1 - x0) / (FX - 1), dy = (y1 - y0) / (FY - 1);
      let row = 0;
      const field = (a, b) => {
        const gx = Math.min(FX - 1.001, Math.max(0, (a - x0) / dx)), gy = Math.min(FY - 1.001, Math.max(0, (b - y0) / dy));
        const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j;
        const k00 = j * FX + i, k10 = k00 + 1, k01 = k00 + FX, k11 = k01 + 1;
        return [
          (1 - u) * (1 - v) * fa[k00] + u * (1 - v) * fa[k10] + (1 - u) * v * fa[k01] + u * v * fa[k11],
          (1 - u) * (1 - v) * fb[k00] + u * (1 - v) * fb[k10] + (1 - u) * v * fb[k01] + u * v * fb[k11],
        ];
      };
      const img = ctx.createImageData(GX, GY);
      function fieldChunk() {
        const end = Math.min(FY, row + 12);
        for (; row < end; row++) for (let i = 0; i < FX; i++) {
          const v = Toy.bAuto(x0 + i * dx, y0 + row * dy);
          fa[row * FX + i] = v[0]; fb[row * FX + i] = v[1];
        }
        if (row < FY) setTimeout(fieldChunk, 0); else { row = 0; setTimeout(basinChunk, 0); }
      }
      function basinChunk() {
        const end = Math.min(GY, row + 10);
        for (; row < end; row++) for (let i = 0; i < GX; i++) {
          let p = [x0 + (i + 0.5) / GX * (x1 - x0), y1 - (row + 0.5) / GY * (y1 - y0)];
          let vtx = -1;
          for (let s = 0; s < 900; s++) {
            const [j, d] = Toy.nearestVertex(p);
            if (d < 0.07) { vtx = j; break; }
            const v = field(p[0], p[1]), sp = Math.hypot(v[0], v[1]);
            const ds = 0.012 / Math.max(sp, 0.05);
            p = [p[0] + ds * v[0], p[1] + ds * v[1]];
          }
          const c = vtx < 0 ? [240, 240, 246] : BASIN_RGB[vtx], o = (row * GX + i) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
        if (row < GY) setTimeout(basinChunk, 0);
        else {
          const off = document.createElement('canvas'); off.width = GX; off.height = GY;
          off.getContext('2d').putImageData(img, 0, 0);
          basinImg = off; basinBusy = false; done();
        }
      }
      fieldChunk();
    }

    function draw() {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      if (basinsBox.checked && basinImg) {
        ctx.imageSmoothingEnabled = true; ctx.drawImage(basinImg, 0, 0, w, h);
      } else if (basinsBox.checked) {
        ctx.fillStyle = C.muted; ctx.font = '13px Inter, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Computing basins of T…', 12, 22);
      }
      drawSimplex(ctx, view, { fill: !basinsBox.checked });
      trajectories.forEach((tr) => {
        const pathLine = (path, color, dash, width) => {
          ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
          path.forEach((p, i) => { const q = view.px(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
          ctx.stroke(); ctx.setLineDash([]);
        };
        const s = view.px(tr.start[0], tr.start[1]);
        const e = view.px(...tr.auto.path[tr.auto.path.length - 1]);
        ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(85,83,127,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); ctx.setLineDash([]);
        pathLine(tr.time.path, C.blue, [6, 4], 1.8);
        pathLine(tr.auto.path, C.indigo, [], 2);
        ctx.beginPath(); ctx.arc(s[0], s[1], 4, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = C.indigo; ctx.stroke();
      });
      const rA = trajectories.map((t) => ratio(t.auto.path)).filter(Number.isFinite);
      const rT = trajectories.map((t) => ratio(t.time.path)).filter(Number.isFinite);
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      ra.textContent = rA.length ? fmt(mean(rA), 3) : '—';
      rt.textContent = rT.length ? fmt(mean(rT), 3) : '—';
      rn.textContent = String(trajectories.length);
    }
    function add(p) {
      trajectories.push({ start: p, auto: Toy.autoPath(p), time: Toy.timePath(p) });
      if (trajectories.length > 60) trajectories.shift();
    }
    function addAt(ev) {
      const [x, y] = canvasPoint(canvas, ev, w, h);
      add(view.inv(x, y)); draw();
    }
    canvas.addEventListener('click', addAt);
    $('[data-role="random"]', root).addEventListener('click', () => {
      // Starting states drawn from the prior's projection on the plane: centroid + N(0, σ² I₂).
      for (let i = 0; i < 12; i++) add([Toy.SIG * gaussian(rand), Toy.SIG * gaussian(rand)]);
      draw();
    });
    $('[data-role="clear"]', root).addEventListener('click', () => { trajectories = []; draw(); });
    basinsBox.addEventListener('change', () => {
      draw();
      if (basinsBox.checked && !basinImg && !basinBusy) computeBasins(draw);
    });
    for (let i = 0; i < 6; i++) add([Toy.SIG * gaussian(rand), Toy.SIG * gaussian(rand)]);
    draw();
  }

  /* ── Interactive 3: random energy model ────────────────── */
  function initREM(root) {
    const hist = setupCanvas($('[data-role="hist"]', root));
    const curve = setupCanvas($('[data-role="curve"]', root));
    const tS = $('[data-role="t"]', root), sS = $('[data-role="sigma"]', root), aS = $('[data-role="a"]', root);
    const tO = $('[data-role="tval"]', root), sO = $('[data-role="sval"]', root), aO = $('[data-role="aval"]', root);
    const vBtns = $$('[data-v]', root);
    const out = { rho: $('[data-role="rho"]', root), above: $('[data-role="above"]', root), post: $('[data-role="post"]', root), tstar: $('[data-role="tstar"]', root) };
    let V = 30522, seed = 1, g = null, gMax = 0, curvePts = null;

    function sample() {
      const rand = mulberry32(seed * 7919 + V);
      g = new Float64Array(V);
      for (let i = 0; i < V; i++) g[i] = gaussian(rand);
      gMax = -Infinity; for (let i = 1; i < V; i++) if (g[i] > gMax) gMax = g[i];
      curvePts = null;
    }
    const rhoAt = (t, sigma, a) => { const al = Math.pow(1 - t, a); return al > 0 ? (1 - al) / (al * sigma) : Infinity; };
    // Exact posterior of the target (index 0) for this draw.
    function posterior(rho) {
      const uk = rho * rho + rho * g[0];
      let s = 0;
      for (let i = 1; i < V; i++) s += Math.exp(rho * g[i] - uk);
      return 1 / (1 + s);
    }
    function tStar(sigma, a) { return 1 - Math.pow(1 + sigma * Math.sqrt(2 * Math.log(V)), -1 / a); }

    function drawHist(rho) {
      const { ctx, w, h } = hist;
      const L = 46, R = w - 16, T = 22, B = h - 46;
      const xmin = -5, xmax = 10, bw = 0.25, nb = Math.round((xmax - xmin) / bw);
      const counts = new Array(nb).fill(0);
      for (let i = 1; i < V; i++) { const k = Math.floor((g[i] - xmin) / bw); if (k >= 0 && k < nb) counts[k]++; }
      const cmax = Math.max(...counts, 1);
      const X = (v) => L + ((v - xmin) / (xmax - xmin)) * (R - L);
      const target = rho + g[0];
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      for (let v = -4; v <= 10; v += 2) { ctx.beginPath(); ctx.moveTo(X(v), T); ctx.lineTo(X(v), B); ctx.stroke(); }
      counts.forEach((c, k) => {
        const x0 = X(xmin + k * bw), x1 = X(xmin + (k + 1) * bw), bh = (c / cmax) * (B - T - 10);
        ctx.fillStyle = xmin + (k + 0.5) * bw > target ? C.indigo : C.lavender2;
        ctx.fillRect(x0 + 0.5, B - bh, x1 - x0 - 1, bh);
      });
      ctx.strokeStyle = C.slate; ctx.beginPath(); ctx.moveTo(L, B); ctx.lineTo(R, B); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let v = -4; v <= 10; v += 2) ctx.fillText(String(v), X(v), B + 4);
      texLabel(hist.ctx.canvas, 'xaxis', '\\text{competitor logit}/\\rho \\quad (h_j/\\rho \\sim \\mathcal N(0,1))', (L + R) / 2, B + 20, 0.5, 0);
      // Predicted maximum √(2 log V).
      const pm = Math.sqrt(2 * Math.log(V));
      ctx.setLineDash([5, 4]); ctx.strokeStyle = C.blue; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(pm), T); ctx.lineTo(X(pm), B); ctx.stroke(); ctx.setLineDash([]);
      texLabel(hist.ctx.canvas, 'max', '\\sqrt{2\\log V}\\approx ' + pm.toFixed(2), X(pm) + 6, T, 0, 0).style.color = C.blue;
      // Target spike.
      const clipped = target > xmax, tx = X(Math.min(target, xmax - 0.05));
      ctx.strokeStyle = C.navy; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(tx, B); ctx.lineTo(tx, T + 26); ctx.stroke();
      ctx.beginPath(); ctx.arc(tx, T + 26, 5, 0, 2 * Math.PI); ctx.fillStyle = C.navy; ctx.fill();
      const tl = texLabel(hist.ctx.canvas, 'target', clipped ? '\\text{target at } ' + target.toFixed(1) + ' \\rightarrow' : '\\text{target } \\rho + z_k/\\sigma', tx + (target > 7 ? -10 : 10), T + 44, target > 7 ? 1 : 0, 0);
      tl.style.color = C.navy; tl.style.fontWeight = '600';
    }
    function drawCurve(sigma, a, t) {
      const { ctx, w, h } = curve;
      const L = 46, R = w - 16, T = 12, B = h - 34;
      if (!curvePts) {
        curvePts = [];
        for (let i = 0; i <= 160; i++) { const tt = (i / 160) * 0.995; curvePts.push([tt, posterior(rhoAt(tt, sigma, a))]); }
      }
      const X = (v) => L + v * (R - L), Y = (p) => B - p * (B - T);
      const ts = tStar(sigma, a);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(207,245,230,0.7)'; ctx.fillRect(X(ts), T, R - X(ts), B - T);
      ctx.strokeStyle = C.mintDeep; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(ts), T); ctx.lineTo(X(ts), B); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = C.slate; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, B); ctx.lineTo(R, B); ctx.stroke();
      ctx.strokeStyle = C.indigo; ctx.lineWidth = 2; ctx.beginPath();
      curvePts.forEach(([tt, p], i) => (i ? ctx.lineTo(X(tt), Y(p)) : ctx.moveTo(X(tt), Y(p)))); ctx.stroke();
      const pc = posterior(rhoAt(t, sigma, a));
      ctx.beginPath(); ctx.arc(X(t), Y(pc), 5, 0, 2 * Math.PI); ctx.fillStyle = C.navy; ctx.fill();
      ctx.fillStyle = C.muted; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((v) => ctx.fillText(v.toFixed(1), X(v), B + 4));
      texLabel(curve.ctx.canvas, 'xaxis', '\\text{interpolation time } t', (L + R) / 2, B + 15, 0.5, 0);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText('1', L - 6, T); ctx.fillText('0', L - 6, B);
      texLabel(curve.ctx.canvas, 'yaxis', 'p(k\\mid x)', L + 8, T + 2, 0, 0);
      texLabel(curve.ctx.canvas, 'tstar', 't^* = ' + ts.toFixed(3), X(ts) - 18, (T + B) / 2, 1, 0.5).style.color = C.mintDeep;
      return pc;
    }
    function render() {
      const t = +tS.value, sigma = +sS.value, a = +aS.value;
      tO.textContent = t.toFixed(3).replace(/0$/, ''); sO.textContent = sigma.toFixed(2); aO.textContent = a.toFixed(1);
      const rho = rhoAt(t, sigma, a);
      drawHist(rho);
      const p = drawCurve(sigma, a, t);
      const uk = rho * rho + rho * g[0];
      let above = 0; for (let i = 1; i < V; i++) if (rho * g[i] > uk) above++;
      out.rho.textContent = fmt(rho, 2);
      out.above.textContent = fmtInt(above) + ' of ' + fmtInt(V - 1);
      out.post.textContent = p < 0.001 ? p.toExponential(1) : p.toFixed(3);
      out.tstar.textContent = tStar(sigma, a).toFixed(3);
    }
    let pending = 0;
    const schedule = (resetCurve) => {
      if (resetCurve) curvePts = null;
      if (!pending) pending = requestAnimationFrame(() => { pending = 0; render(); });
    };
    tS.addEventListener('input', () => schedule(false));
    sS.addEventListener('input', () => schedule(true));
    aS.addEventListener('input', () => schedule(true));
    vBtns.forEach((b) => b.addEventListener('click', () => { setPressed(vBtns, b); V = +b.dataset.v; sample(); schedule(true); }));
    $('[data-role="resample"]', root).addEventListener('click', () => { seed++; sample(); schedule(true); });
    sample(); render();
  }

  /* ── Interactive 4: t^* across vocabularies ─────────────── */
  function initTstar(root) {
    const { ctx, w, h } = setupCanvas($('[data-role="plot"]', root));
    const sS = $('[data-role="sigma"]', root), vS = $('[data-role="logv"]', root);
    const sO = $('[data-role="sval"]', root), vO = $('[data-role="vval"]', root), ro = $('[data-role="readouts"]', root);
    const DATA = [['Sudoku', 12], ['LM1B', 30522], ['GSM8K', 49152], ['OWT', 50257]];
    const COLORS = [C.indigo, C.sky, C.mint];
    const ts = (V, s, a) => 1 - Math.pow(1 + s * Math.sqrt(2 * Math.log(V)), -1 / a);
    function render() {
      const s = +sS.value, lv = +vS.value, Vc = Math.max(2, Math.round(Math.pow(10, lv)));
      sO.textContent = s.toFixed(2); vO.textContent = fmtInt(Vc);
      const L = 54, R = w - 20, T = 16, B = h - 46, lx0 = 0.5, lx1 = 5.5;
      const X = (l) => L + ((l - lx0) / (lx1 - lx0)) * (R - L), Y = (v) => B - v * (B - T);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      for (let e = 1; e <= 5; e++) { ctx.beginPath(); ctx.moveTo(X(e), T); ctx.lineTo(X(e), B); ctx.stroke(); }
      for (let v = 0.25; v <= 1; v += 0.25) { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(R, Y(v)); ctx.stroke(); }
      ctx.strokeStyle = C.slate; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, B); ctx.lineTo(R, B); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = '12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let e = 1; e <= 5; e++) ctx.fillText('10' + ['', '¹', '²', '³', '⁴', '⁵'][e], X(e), B + 6);
      ctx.fillText('vocabulary size V (log scale)', (L + R) / 2, B + 24);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let v = 0; v <= 1; v += 0.25) ctx.fillText(v.toFixed(2), L - 8, Y(v));
      texLabel(ctx.canvas, 'ylab', '\\text{commitment time } t^*', L + 10, T + 2, 0, 0);
      [1, 2, 3].forEach((a, i) => {
        ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 2.4; ctx.beginPath();
        for (let k = 0; k <= 200; k++) { const l = lx0 + (k / 200) * (lx1 - lx0), y = Y(ts(Math.pow(10, l), s, a)); k ? ctx.lineTo(X(l), y) : ctx.moveTo(X(l), y); }
        ctx.stroke();
        ctx.fillStyle = C.navy; ctx.font = 'italic 13px Volkhov, Georgia, serif'; ctx.textAlign = 'left';
        ctx.fillText('a = ' + a, R - 46, Y(ts(Math.pow(10, lx1), s, a)) - 10);
      });
      DATA.forEach(([name, V], i) => {
        const x = X(Math.log10(V)), y = Y(ts(V, s, 1));
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fillStyle = C.navy; ctx.fill();
        ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'center';
        const dy = name === 'GSM8K' ? 16 : name === 'OWT' ? -28 : name === 'LM1B' ? 16 : -16;
        const dx = name === 'GSM8K' ? 18 : name === 'LM1B' ? -24 : 0;
        ctx.fillText(name, x + dx, y + dy);
      });
      [1, 2, 3].forEach((a, i) => {
        const x = X(Math.log10(Vc)), y = Y(ts(Vc, s, a));
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = C.violet2; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.fillRect(-4.5, -4.5, 9, 9); ctx.strokeRect(-4.5, -4.5, 9, 9); ctx.restore();
      });
      ro.innerHTML = DATA.map(([n, V]) => '<div class="readout">' + n + ' · V = ' + fmtInt(V) + '<b>' + tex('t^* = ' + ts(V, s, 1).toFixed(3)) + '</b></div>').join('') +
        '<div class="readout">your V = ' + fmtInt(Vc) + '<b>' + [1, 2, 3].map((a) => ts(Vc, s, a).toFixed(2)).join(' · ') + '</b></div>';
    }
    sS.addEventListener('input', render); vS.addEventListener('input', render);
    render();
  }

  /* ── Interactive 5: threshold ∪ quota commit rule ──────── */
  function initCommit(root) {
    const WORDS = 'generation reduces to iterating one map until it reaches a fixed point'.split(' ');
    const L = WORDS.length;
    const board = $('[data-role="board"]', root), status = $('[data-role="status"]', root);
    const kS = $('[data-role="kappa"]', root), kO = $('[data-role="kval"]', root);
    const kBtns = $$('[data-k]', root), stepBtn = $('[data-role="step"]', root);
    let rand = mulberry32(5), k = 4, r = 0, committed, newly, q, bias;
    board.innerHTML = WORDS.map(() => '<div class="cpos"><span class="cq"></span><div class="cbar"><span></span><i class="kappa"></i></div><span class="cword"></span></div>').join('');
    const cells = $$('.cpos', board);
    function reset() {
      r = 0; committed = new Array(L).fill(false); newly = new Array(L).fill(false); q = new Array(L).fill(0);
      bias = WORDS.map(() => 0.9 * gaussian(rand));
      status.textContent = 'Fresh noise at every position. Budget k = ' + k + ' rounds.';
      render();
    }
    function step() {
      if (r >= k) return;
      r++;
      const kappa = +kS.value;
      const R = [];
      const frac = committed.filter(Boolean).length / L;
      for (let l = 0; l < L; l++) {
        newly[l] = false;
        if (committed[l]) continue;
        R.push(l);
        // Simulated quality: rises with the amount of clean context already committed.
        q[l] = 1 / (1 + Math.exp(-(1.1 + 3.4 * frac + bias[l] + 0.7 * gaussian(rand))));
      }
      const nr = Math.ceil(R.length / (k - r + 1));
      const thr = R.filter((l) => q[l] >= kappa);
      const top = R.slice().sort((a, b) => q[b] - q[a]).slice(0, nr);
      const add = new Set(thr.concat(top));
      add.forEach((l) => { committed[l] = true; newly[l] = true; });
      const extra = [...add].filter((l) => !thr.includes(l)).length;
      status.innerHTML = '<span class="round-dots">' + Array.from({ length: k }, (_, i) => '<i class="' + (i < r ? 'on' : '') + '"></i>').join('') + '</span>' +
        'Round ' + r + ' of ' + k + ' · |R<sub>' + r + '</sub>| = ' + R.length + ' uncommitted · n<sub>' + r + '</sub> = ⌈' + R.length + '/' + (k - r + 1) + '⌉ = ' + nr +
        ' · threshold keeps ' + thr.length + ', quota adds ' + extra + ' → commit ' + add.size +
        (r === k ? ' · all ' + L + ' positions committed in ' + k + ' NFE.' : '.');
      render();
    }
    function render() {
      const kappa = +kS.value;
      kO.textContent = kappa.toFixed(2);
      cells.forEach((cell, l) => {
        const shown = r > 0;
        cell.classList.toggle('committed', committed[l] && newly[l]);
        cell.classList.toggle('locked', committed[l] && !newly[l]);
        cell.classList.toggle('new', newly[l]);
        $('.cbar span', cell).style.height = (shown ? q[l] * 100 : 0).toFixed(1) + '%';
        $('.kappa', cell).style.bottom = (kappa * 100).toFixed(1) + '%';
        $('.cq', cell).textContent = shown ? q[l].toFixed(2) : '—';
        $('.cword', cell).textContent = committed[l] ? WORDS[l] : '·';
        $('.cword', cell).title = committed[l] ? WORDS[l] : 'renoised';
      });
      stepBtn.disabled = r >= k;
      stepBtn.innerHTML = r >= k ? 'Done' : 'Apply T<sub>θ</sub> · round ' + (r + 1);
    }
    stepBtn.addEventListener('click', step);
    $('[data-role="reset"]', root).addEventListener('click', reset);
    kS.addEventListener('input', () => { if (r === 0) render(); else reset(); });
    kBtns.forEach((b) => b.addEventListener('click', () => { setPressed(kBtns, b); k = +b.dataset.k; reset(); }));
    reset();
  }

  /* ── Interactives 6–7: results explorers ───────────────── */
  // Table 1: [method, group, LM1B [ppl, ent] × NFE 1/2/4, OWT [ppl, ent] × NFE 1/2/4]; null = not reported.
  const TABLE1 = [
    ['Duo + DCD', 'dd', [[1224.52, 4.33], [520.08, 4.20], [210.88, 4.23]], [[5743.29, 6.02], [891.16, 5.41], [250.86, 5.37]]],
    ['Duo + Di4C', 'dd', [[292.94, 3.79], [247.69, 3.87], [150.67, 4.00]], [[370.51, 3.92], [210.22, 4.63], [154.67, 4.85]]],
    ['MDLM + SDTT', 'dd', [[1429.48, 4.31], [602.14, 4.28], [241.01, 4.28]], [[1260.86, 5.26], [877.22, 5.34], [339.73, 5.38]]],
    ['MDLM + Di4C', 'dd', [[1217.10, 4.38], [621.59, 4.37], [247.32, 4.00]], [[1298.80, 5.29], [758.23, 5.35], [239.27, 5.40]]],
    ['CFM', 'dd', [[269.72, 3.10], [267.39, 3.15], [267.97, 3.28]], [null, null, null]],
    ['FMLM', 'fm', [[119.34, 4.16], [110.19, 4.21], [98.76, 4.21]], [[168.30, 5.17], [133.29, 5.25], [111.31, 5.26]]],
    ['FMLM+', 'fm', [null, null, null], [[378.53, 5.34], [114.46, 5.14], [41.16, 4.77]]],
    ['DFM (PSD)', 'fm', [[94.08, 4.06], [87.42, 4.08], [78.89, 4.10]], [[180.29, 4.91], [152.83, 5.03], [122.32, 5.10]]],
    ['DFM (ESD)', 'fm', [[68.11, 3.79], [77.60, 4.11], [71.53, 4.13]], [[5.33, 0.26], [108.91, 5.15], [77.08, 5.27]]],
    ['DBTM', 'ours', [[201.20, 4.03], [167.05, 4.19], [119.99, 4.20]], [[188.2, 4.97], [76.2, 5.14], [52.2, 5.26]]],
    ['DBTM + ril', 'ours', [[85.50, 3.92], [81.00, 4.05], [73.54, 4.04]], [[65.2, 4.95], [62.2, 5.38], [57.5, 5.52]]],
  ];
  function initLanguage(root) {
    const bars = $('[data-role="bars"]', root);
    const dsBtns = $$('[data-ds]', root), nfeBtns = $$('[data-nfe]', root);
    let ds = 'lm1b', nfe = 0;
    const lo = Math.log10(3), hi = Math.log10(8000);
    function render() {
      const rows = TABLE1.map(([name, grp, lm, owt]) => ({ name, grp, v: (ds === 'lm1b' ? lm : owt)[nfe] }));
      rows.sort((a, b) => (a.v ? a.v[0] : Infinity) - (b.v ? b.v[0] : Infinity));
      bars.innerHTML = rows.map(({ name, grp, v }) => {
        const cls = 'brow' + (grp === 'ours' ? ' ours' : grp === 'fm' ? ' flowmap' : '') + (v && v[1] < 2 ? ' warn' : '');
        if (!v) return '<div class="' + cls + '"><span class="bname">' + name + '</span><span class="btrack"><span class="bnote" style="color:#a3a1c4">not reported</span></span><span class="bval">—</span></div>';
        const wpct = ((Math.log10(v[0]) - lo) / (hi - lo)) * 100;
        const note = v[1] < 2 ? '<span class="bnote" style="left:calc(' + wpct.toFixed(1) + '% + 6px)">collapsed · entropy ' + v[1].toFixed(2) + '</span>' : '';
        return '<div class="' + cls + '"><span class="bname" title="' + name + '">' + name + '</span><span class="btrack"><span class="bfill" style="width:' + wpct.toFixed(1) + '%"></span>' + note +
          '</span><span class="bval">' + v[0].toFixed(v[0] < 100 ? 1 : 0) + ' <span class="ent">' + v[1].toFixed(2) + '</span></span></div>';
      }).join('');
    }
    dsBtns.forEach((b) => b.addEventListener('click', () => { setPressed(dsBtns, b); ds = b.dataset.ds; render(); }));
    nfeBtns.forEach((b) => b.addEventListener('click', () => { setPressed(nfeBtns, b); nfe = +b.dataset.nfe; render(); }));
    render();
  }

  // Table 2: [method, group, Sudoku NFE, easy, medium, hard, GSM8K NFE, GSM8K acc].
  const TABLE2 = [
    ['AR (sample)', 'base', 128, 13.9, 5.1, 0.6, 512, 53.9],
    ['AR (greedy)', 'base', 128, 14.6, 5.1, 1.0, 512, 63.3],
    ['MDLM', 'base', 128, 92.0, 77.1, 30.2, 1024, 18.0],
    ['Duo', 'base', 128, 96.3, 84.7, 58.4, 1024, 17.2],
    ['CANDI', 'base', 128, 79.3, 45.9, 16.7, 1024, 0.2],
    ['FLM', 'base', 128, 94.2, 82.7, 44.5, 1024, 0.3],
    ['S-FLM', 'base', 128, 94.8, 85.2, 45.0, 1024, 18.0],
    ['FMLM+', 'fm', 4, 97.9, 92.0, 71.2, 1, 0],
    ['FMLM+', 'fm', 16, 97.8, 92.6, 81.4, 32, 16.6],
    ['DBTM + ril', 'ours', 4, 99.5, 97.3, 84.6, 1, 0.8],
    ['DBTM + ril', 'ours', 16, 99.9, 99.4, 97.5, 32, 16.8],
  ];
  function initReasoning(root) {
    const bars = $('[data-role="bars"]', root);
    const btns = $$('[data-task]', root), sortBox = $('[data-role="sort"]', root);
    let task = 'hard';
    function render() {
      const col = { easy: 3, med: 4, hard: 5, gsm: 7 }[task];
      let rows = TABLE2.map((r) => ({ name: r[0], grp: r[1], nfe: task === 'gsm' ? r[6] : r[2], v: r[col] }));
      if (sortBox.checked) rows.sort((a, b) => b.v - a.v);
      bars.innerHTML = rows.map(({ name, grp, nfe, v }) => {
        const cls = 'brow' + (grp === 'ours' ? ' ours' : grp === 'fm' ? ' flowmap' : '');
        return '<div class="' + cls + '"><span class="bname">' + name + '</span><span class="btrack"><span class="bfill" style="width:' + v + '%"></span>' +
          '<span class="bnote" style="left:calc(' + Math.min(v, 82) + '% + 6px)">' + nfe + ' NFE</span></span><span class="bval">' + v.toFixed(1) + '%</span></div>';
      }).join('');
    }
    btns.forEach((b) => b.addEventListener('click', () => { setPressed(btns, b); task = b.dataset.task; render(); }));
    sortBox.addEventListener('change', render);
    render();
  }

  /* ── Boot ──────────────────────────────────────────────── */
  const WIDGETS = {
    field: initField, paths: initPaths, rem: initREM,
    tstar: initTstar, commit: initCommit, language: initLanguage, reasoning: initReasoning,
  };
  function initWidgets() {
    $$('[data-widget]').forEach((root) => {
      const init = WIDGETS[root.dataset.widget];
      if (!init) return;
      whenVisible(root, () => {
        try { init(root); } catch (err) {
          console.error(err);
          const body = $('.widget-body', root);
          if (body) body.insertAdjacentHTML('beforeend', '<p class="hint">This interactive could not start in your browser.</p>');
        }
      });
    });
  }

  function boot() {
    renderMath();
    initChrome();
    initLightbox();
    initPlayers();
    initWidgets();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
