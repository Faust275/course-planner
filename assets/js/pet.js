window.Pet = (function () {
    var layer = null, box = null, rafId = null;
    var x = 0, y = 0, vx = 0, vy = 0, dir = 1, st = 'walk';
    var dragging = false, dragDX = 0, dragDY = 0, lastT = 0, idleTimer = null;
    var paused = false, downX = 0, downY = 0;

    function cfg() { return Store.settings.pet; }

    function ensureStyle() {
      if (document.getElementById('pet-style')) return;
      var s = document.createElement('style');
      s.id = 'pet-style';
      s.textContent = [
        '.pet-layer{position:fixed;inset:0;z-index:99990;pointer-events:none;overflow:hidden}',
        '.pet-sprite{position:absolute;left:0;top:0;pointer-events:auto;cursor:grab;will-change:transform;touch-action:none;user-select:none;z-index:1}',
        '.pet-sprite.drag{cursor:grabbing}',
        '@keyframes petWalk{from{background-position:0 0}to{background-position:calc(var(--pet-total,99999px)*-1) 0}}',
        '@media (prefers-reduced-motion: reduce){.pet-sprite{animation:none!important}}'
      ].join('');
      document.head.appendChild(s);
    }

    function build() {
      stop();
      var c = cfg();
      if (!c.enabled || !c.src || c.frameW <= 0 || c.frameH <= 0) return;
      ensureStyle();
      layer = document.createElement('div');
      layer.className = 'pet-layer';
      box = document.createElement('div');
      box.className = 'pet-sprite';
      var ds = Math.max(0.2, c.scale || 1);
      var w = c.frameW * ds, h = c.frameH * ds;
      var total = c.frameW * (c.frames || 1) * ds;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      box.style.backgroundImage = 'url(' + c.src + ')';
      box.style.backgroundRepeat = 'no-repeat';
      box.style.backgroundSize = total + 'px ' + h + 'px';
      box.style.backgroundPositionY = (-(c.rowWalk || 0) * h) + 'px';
      box.style.setProperty('--pet-total', total + 'px');
      if (c.frames > 1) box.style.animation = 'petWalk ' + (c.frames / (c.fps || 8)) + 's steps(' + c.frames + ') infinite';
      layer.appendChild(box);
      document.body.appendChild(layer);
      bind();
      x = Math.random() * (window.innerWidth - w);
      y = window.innerHeight - h - (c.bottomMargin || 10);
      dir = Math.random() < 0.5 ? -1 : 1;
      vx = (c.speed || 70) * dir;
      vy = 0; st = 'walk';
      lastT = performance.now();
      rafId = requestAnimationFrame(loop);
      scheduleIdle();
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVisibility);
    }

    function onResize() {
      if (!box) return;
      var bm = (cfg().bottomMargin || 10);
      if (x > window.innerWidth - box.offsetWidth) x = Math.max(0, window.innerWidth - box.offsetWidth);
      if (y > window.innerHeight - box.offsetHeight - bm) y = window.innerHeight - box.offsetHeight - bm;
    }

    function onVisibility() {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null; paused = true;
      } else if (paused && box) {
        paused = false; lastT = performance.now();
        rafId = requestAnimationFrame(loop);
      }
    }

    function loop(t) {
      rafId = requestAnimationFrame(loop);
      var dt = Math.min(50, t - lastT) / 1000; lastT = t;
      if (dragging || st === 'react') { apply(); return; }
      var c = cfg();
      if (st === 'fall') {
        vy += (c.gravity || 1400) * dt;
        y += vy * dt;
        var floor = window.innerHeight - box.offsetHeight - (c.bottomMargin || 10);
        if (y >= floor) { y = floor; vy = 0; st = 'walk'; vx = (c.speed || 70) * dir; scheduleIdle(); }
        apply(); return;
      }
      if (st === 'idle') { apply(); return; }
      x += vx * dt;
      var w = box.offsetWidth, minX = 0, maxX = window.innerWidth - w;
      if (x <= minX) { x = minX; dir = 1; vx = Math.abs(vx); }
      else if (x >= maxX) { x = maxX; dir = -1; vx = -Math.abs(vx); }
      apply();
    }

    function apply() {
      if (!box) return;
      box.style.transform = 'translate(' + x + 'px,' + y + 'px) scaleX(' + dir + ')';
    }

    function scheduleIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        if (st !== 'walk') return;
        st = 'idle'; box.style.animationPlayState = 'paused';
        idleTimer = setTimeout(function () {
          if (st !== 'idle') return;
          st = 'walk'; box.style.animationPlayState = 'running'; scheduleIdle();
        }, 3000 + Math.random() * 3000);
      }, 6000 + Math.random() * 6000);
    }

    function bind() {
      box.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        dragging = true; box.classList.add('drag');
        try { box.setPointerCapture(e.pointerId); } catch (_) {}
        var r = box.getBoundingClientRect();
        dragDX = e.clientX - r.left; dragDY = e.clientY - r.top;
        downX = e.clientX; downY = e.clientY;
        box.style.animationPlayState = 'paused';
        clearTimeout(idleTimer);
      });
      box.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        x = e.clientX - dragDX; y = e.clientY - dragDY; apply();
      });
      function end(e) {
        if (!dragging) return;
        dragging = false; box.classList.remove('drag');
        var c = cfg();
        var floor = window.innerHeight - box.offsetHeight - (c.bottomMargin || 10);
        if (y < floor - 4) { st = 'fall'; vy = 0; }
        else { st = 'walk'; vx = (c.speed || 70) * dir; scheduleIdle(); }
        if (c.frames > 1) box.style.animationPlayState = 'running';
        if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6 && c.rowReact >= 0 && c.reactFrames > 0) react();
      }
      box.addEventListener('pointerup', end);
      box.addEventListener('pointercancel', end);
    }

    function react() {
      var c = cfg();
      st = 'react';
      box.style.animation = 'none';
      var ds = Math.max(0.2, c.scale || 1), h = c.frameH * ds;
      box.style.backgroundPositionY = (-(c.rowReact) * h) + 'px';
      box.style.backgroundPositionX = '0px';
      var i = 0, n = c.reactFrames || 1;
      var fw = c.frameW * ds;
      var iv = setInterval(function () {
        i = (i + 1) % n;
        box.style.backgroundPositionX = (-i * fw) + 'px';
        if (i === n - 1) { clearInterval(iv); setTimeout(resumeWalk, 220); }
      }, 1000 / (c.fps || 8));
    }

    function resumeWalk() {
      var c = cfg();
      st = 'walk';
      var h = c.frameH * Math.max(0.2, c.scale || 1);
      box.style.backgroundPositionY = (-(c.rowWalk || 0) * h) + 'px';
      box.style.backgroundPositionX = '0px';
      box.style.animation = c.frames > 1 ? ('petWalk ' + (c.frames / (c.fps || 8)) + 's steps(' + c.frames + ') infinite') : 'none';
      vx = (c.speed || 70) * dir;
      scheduleIdle();
    }

    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      clearTimeout(idleTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layer = null; box = null;
    }

    function refresh() { build(); }
    function init() { build(); }

    return { init: init, refresh: refresh, stop: stop, build: build, ensureStyle: ensureStyle };
  })();