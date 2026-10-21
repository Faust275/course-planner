

/* ==========================================================
 * 外观：主题配色 / 自定义背景
 * ========================================================== */
(function (global) {
  'use strict';

  /* ---------- 预设主题（20 套，与课程调色板共用 palette.js 的同一套色） ---------- */
  var THEMES = (typeof Palette !== 'undefined' && Palette.THEME_PRESETS) || [
    { key: 'indigo', name: '靛蓝', c: '#4f46e5' },
    { key: 'blue', name: '晴空', c: '#0ea5e9' },
    { key: 'teal', name: '青碧', c: '#14b8a6' },
    { key: 'green', name: '竹青', c: '#12b76a' },
    { key: 'amber', name: '琥珀', c: '#e8930c' },
    { key: 'rose', name: '胭脂', c: '#f04438' },
    { key: 'pink', name: '桃粉', c: '#ec4899' },
    { key: 'violet', name: '紫罗兰', c: '#7c3aed' },
    { key: 'graphite', name: '石墨', c: '#475467' }
  ];

  /* ---------- 颜色工具 ---------- */
  function hex2rgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return { r: 79, g: 70, b: 229 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgb2hex(o) {
    function p(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + p(o.r) + p(o.g) + p(o.b);
  }

  /** ratio > 0 变亮，< 0 变暗 */
  function shade(hex, ratio) {
    var c = hex2rgb(hex);
    var t = ratio < 0 ? 0 : 255;
    var p = Math.abs(ratio);
    return rgb2hex({
      r: (t - c.r) * p + c.r,
      g: (t - c.g) * p + c.g,
      b: (t - c.b) * p + c.b
    });
  }

  /** 与白色混合，amount=0 返回原色，1 返回纯白 */
  function mixWhite(hex, amount) {
    var c = hex2rgb(hex);
    return rgb2hex({
      r: (255 - c.r) * amount + c.r,
      g: (255 - c.g) * amount + c.g,
      b: (255 - c.b) * amount + c.b
    });
  }

  /* ---------- 应用主题 ---------- */
  function applyTheme() {
    var s = Store.state.settings || {};
    var key = s.theme || 'indigo';
    var hex = '#4f46e5';

    if (key === 'custom') {
      hex = s.customColor || '#4f46e5';
    } else {
      for (var i = 0; i < THEMES.length; i++) {
        if (THEMES[i].key === key) { hex = THEMES[i].c; break; }
      }
    }

    var root = document.documentElement;
    var rgb = hex2rgb(hex);
    root.style.setProperty('--primary', hex);
    root.style.setProperty('--primary-hover', shade(hex, -0.14));
    root.style.setProperty('--primary-weak', mixWhite(hex, 0.9));
    root.style.setProperty('--primary-light', mixWhite(hex, 0.24));
    root.style.setProperty('--primary-tint', mixWhite(hex, 0.55));
    root.style.setProperty('--primary-shadow', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.28)');
    root.style.setProperty('--primary-shadow-soft', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.20)');
    root.dataset.theme = key;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', hex);
  }

  /* ---------- 应用背景 ---------- */
  function applyBackground() {
    var s = (Store.state && Store.state.settings) || {};
    var bg = s.background || {};
    var layer = document.getElementById('appBg');
    if (!layer) return;

    if (bg.dataUrl) {
      layer.style.backgroundImage = 'url("' + bg.dataUrl + '")';
      layer.classList.add('cp-on');
      document.body.classList.add('cp-has-bg');
    } else {
      layer.style.backgroundImage = '';
      layer.classList.remove('cp-on');
      document.body.classList.remove('cp-has-bg');
    }
    document.documentElement.style.setProperty('--bg-mask', String(
      bg.mask == null ? 0.5 : bg.mask
    ));
  }

  /** 压缩图片为可存入 localStorage 的 dataURL */
  function compressImage(file, cb) {
    if (!file) return cb(null, '未选择文件');
    if (!/^image\//.test(file.type)) return cb(null, '请选择图片文件');

    var reader = new FileReader();
    reader.onerror = function () { cb(null, '读取图片失败'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null, '图片无法解析'); };
      img.onload = function () {
        var MAX = 1280;
        var scale = Math.min(1, MAX / img.width);
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);

        var q = 0.72, out = c.toDataURL('image/jpeg', q);
        var guard = 0;
        while (out.length > 720 * 1024 && q > 0.36 && guard < 6) {
          q -= 0.07;
          out = c.toDataURL('image/jpeg', q);
          guard++;
        }
        if (out.length > 1.4 * 1024 * 1024) return cb(null, '图片太大，换一张小一点的试试');
        cb(out);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  /** 只改视觉、不落盘（拖动取色器时用） */
  function previewColor(hex) {
    var root = document.documentElement;
    var rgb = hex2rgb(hex);
    root.style.setProperty('--primary', hex);
    root.style.setProperty('--primary-hover', shade(hex, -0.14));
    root.style.setProperty('--primary-weak', mixWhite(hex, 0.9));
    root.style.setProperty('--primary-light', mixWhite(hex, 0.24));
    root.style.setProperty('--primary-tint', mixWhite(hex, 0.55));
    root.style.setProperty('--primary-shadow', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.28)');
    root.style.setProperty('--primary-shadow-soft', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.20)');
    root.dataset.theme = 'custom';
  }

  /** 只改遮罩、不落盘（拖动滑块时用） */
  function previewMask(v) {
    document.documentElement.style.setProperty('--bg-mask', String(v));
  }

  function setThemeColor(key, customHex) {
    var patch = { theme: key };
    if (key === 'custom' && customHex) patch.customColor = customHex;
    Store.updateSettings(patch);
    applyTheme();
  }

  function setBackground(dataUrl, mask) {
    var bg = Object.assign({}, Store.state.settings.background || {});
    if (dataUrl !== undefined) bg.dataUrl = dataUrl;
    if (mask !== undefined) bg.mask = mask;
    Store.updateSettings({ background: bg });
    applyBackground();
  }

  global.Theme = {
    THEMES: THEMES,
    apply: applyTheme,
    applyBackground: applyBackground,
    previewColor: previewColor,
    previewMask: previewMask,
    setThemeColor: setThemeColor,
    setBackground: setBackground,
    compressImage: compressImage,
    shade: shade,
    mixWhite: mixWhite
  };
})(window);


