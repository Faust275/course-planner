

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

  /** 两色按比例混合（t=0 → a，t=1 → b） */
  function mixHex(a, b, t) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return rgb2hex({
      r: x.r + (y.r - x.r) * t,
      g: x.g + (y.g - x.g) * t,
      b: x.b + (y.b - x.b) * t
    });
  }

  /** 当前生效的明暗：auto 跟随系统 */
  function effectiveMode() {
    var s = (Store.state && Store.state.settings) || {};
    var m = s.themeMode || 'auto';
    if (m === 'light' || m === 'dark') return m;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  /** 写入主色及派生色；深色下弱底 / 浅底向深色表面混合，避免亮色块 */
  function applyPrimary(hex, mode) {
    var root = document.documentElement;
    var rgb = hex2rgb(hex);
    var dark = mode === 'dark';
    root.style.setProperty('--primary', hex);
    root.style.setProperty('--primary-hover', dark ? mixHex(hex, '#ffffff', 0.14) : shade(hex, -0.14));
    root.style.setProperty('--primary-weak', dark ? mixHex(hex, '#181b21', 0.86) : mixWhite(hex, 0.9));
    root.style.setProperty('--primary-light', dark ? mixHex(hex, '#ffffff', 0.22) : mixWhite(hex, 0.24));
    root.style.setProperty('--primary-tint', dark ? mixHex(hex, '#1f232b', 0.72) : mixWhite(hex, 0.55));
    root.style.setProperty('--primary-shadow', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (dark ? '.45' : '.28') + ')');
    root.style.setProperty('--primary-shadow-soft', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (dark ? '.30' : '.20') + ')');
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
    var mode = effectiveMode();
    root.dataset.mode = mode;
    applyPrimary(hex, mode);
    root.dataset.theme = key;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0f1115' : hex);

    applyMech();
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
    applyPrimary(hex, effectiveMode());
    document.documentElement.dataset.theme = 'custom';
  }

  /** 只改遮罩、不落盘（拖动滑块时用） */
  function previewMask(v) {
    document.documentElement.style.setProperty('--bg-mask', String(v));
  }

  function setThemeColor(key, customHex) {
    // 用户手动选色 → 关闭「自动跟随强调色」，让其颜色覆盖机制默认色
    var patch = { theme: key, themeSkinAuto: false };
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

  /* ---------- 机制主题皮肤（种树 / 抽卡）---------- */
  // 自然意象主题预设（完全解耦，不带任何方舟元素）
  var NATURE_THEMES = {
    pine: {
      key: 'pine',
      name: '晨雾松林',
      desc: '鼠尾草绿与白桦木，清新静谧',
      color: '#2e7d32',
      primary: { light: '#2e7d32', dark: '#4caf50' }
    },
    aurora: {
      key: 'aurora',
      name: '极光苍穹',
      desc: '冰川霜雪与极夜幽绿，深邃灵动',
      color: '#0891b2',
      primary: { light: '#0891b2', dark: '#10b981' }
    },
    sunset: {
      key: 'sunset',
      name: '暮霞熔金',
      desc: '暮云暖杏与落日余晖，温暖治愈',
      color: '#ea580c',
      primary: { light: '#ea580c', dark: '#f59e0b' }
    },
    slate: {
      key: 'slate',
      name: '山岚青黛',
      desc: '远山水墨与夜泊玄石，清雅沉稳',
      color: '#475569',
      primary: { light: '#475569', dark: '#64748b' }
    }
  };

  // 明日方舟战术主题预设（抽卡寻访专属）
  var ARK_THEMES = {
    terminal: {
      key: 'terminal',
      name: '经典罗德岛终端',
      desc: '浅色舰桥雾白磨砂 / 深色经典碳灰终端（参考图2）',
      color: '#0099d8',
      primary: { light: '#0099d8', dark: '#00a2d8' }
    },
    roguelike: {
      key: 'roguelike',
      name: '集成战略水墨秘符',
      desc: '赤红与墨蓝双色水墨涂鸦，远古秘符印记（参考图1）',
      color: '#c92a2a',
      primary: { light: '#c92a2a', dark: '#d32f2f' }
    }
  };

  var MECH = {
    tree:    { primary: { light: '#2e7d32', dark: '#4caf50' } },
    factory: { primary: { light: '#0099d8', dark: '#00a2d8' } }
  };

  /** 当前应套用的机制皮肤：关闭则返回 null；开启时按奖励机制推导 */
  function mechOf() {
    var s = (Store.state && Store.state.settings) || {};
    if (!s.themeSkin) return null;
    var mode = (Store.state.pomodoro && Store.state.pomodoro.mode) || 'forest';
    return mode === 'gacha' ? 'factory' : 'tree';
  }

  /** 套用机制皮肤：设置 data-mech 并（自动模式下）按当前明暗覆盖强调色 */
  function applyMech() {
    var root = document.documentElement;
    var mech = mechOf();
    if (!mech) {
      root.removeAttribute('data-mech');
      root.removeAttribute('data-nature-theme');
      root.removeAttribute('data-ark-theme');
      return;
    }
    root.setAttribute('data-mech', mech);

    var s = (Store.state && Store.state.settings) || {};
    var mode = effectiveMode();

    if (mech === 'factory') {
      var arkKey = s.arkTheme || 'terminal';
      root.setAttribute('data-ark-theme', arkKey);
      root.removeAttribute('data-nature-theme');
      if (s.themeSkinAuto) {
        var aCfg = ARK_THEMES[arkKey] || ARK_THEMES.terminal;
        var aHex = aCfg.primary[mode] || aCfg.primary.light;
        applyPrimary(aHex, mode);
        var meta1 = document.querySelector('meta[name="theme-color"]');
        if (meta1) meta1.setAttribute('content', mode === 'dark' ? '#13161b' : '#edf0f5');
      }
    } else if (mech === 'tree') {
      var natKey = s.natureTheme || 'pine';
      root.setAttribute('data-nature-theme', natKey);
      root.removeAttribute('data-ark-theme');
      if (s.themeSkinAuto) {
        var nCfg = NATURE_THEMES[natKey] || NATURE_THEMES.pine;
        var nHex = nCfg.primary[mode] || nCfg.primary.light;
        applyPrimary(nHex, mode);
        var meta2 = document.querySelector('meta[name="theme-color"]');
        if (meta2) meta2.setAttribute('content', mode === 'dark' ? '#0f1712' : '#f2f6f2');
      }
    }
  }

  function setNatureTheme(key) {
    if (!NATURE_THEMES[key]) return;
    Store.updateSettings({ natureTheme: key, themeSkinAuto: true });
    applyTheme();
  }

  function setArkTheme(key) {
    if (!ARK_THEMES[key]) return;
    Store.updateSettings({ arkTheme: key, themeSkinAuto: true });
    applyTheme();
  }

  /** 开关机制皮肤：开启时重置为「自动跟随强调色」，让机制默认色先呈现 */
  function setThemeSkin(on) {
    var patch = { themeSkin: !!on };
    if (on) patch.themeSkinAuto = true;
    Store.updateSettings(patch);
    applyTheme();
  }

  /** 切换明暗：auto / light / dark */
  function setThemeMode(mode) {
    if (['auto', 'light', 'dark'].indexOf(mode) < 0) mode = 'auto';
    Store.updateSettings({ themeMode: mode });
    applyTheme();
  }

  // 系统明暗变化时，auto 模式自动跟随
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () {
      var s = (Store.state && Store.state.settings) || {};
      if ((s.themeMode || 'auto') === 'auto') applyTheme();
    };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  } catch (e) { /* ignore */ }

  global.Theme = {
    THEMES: THEMES,
    NATURE_THEMES: NATURE_THEMES,
    ARK_THEMES: ARK_THEMES,
    setNatureTheme: setNatureTheme,
    setArkTheme: setArkTheme,
    apply: applyTheme,
    applyMech: applyMech,
    setThemeSkin: setThemeSkin,
    setThemeMode: setThemeMode,
    effectiveMode: effectiveMode,
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
