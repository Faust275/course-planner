
/* ==========================================================
 * 调色板：课程颜色 + 外观主题预设（纯数据，无 DOM / Store 依赖）
 * 放在 store.js 之前加载，store / theme / plans 都从这里取颜色，
 * 保证课程表、外观、计划三处用的是同一套 20 色，不会出现两套色卡。
 * ========================================================== */
(function (global) {
  'use strict';

  /* 20 色，按色相环铺开，彼此区分度高，浅色背景上文字都看得清 */
  var PRESETS = [
    { key: 'indigo',   name: '靛蓝', c: '#4f46e5' },
    { key: 'blue',     name: '晴空', c: '#0ea5e9' },
    { key: 'sky',      name: '天青', c: '#06b6d4' },
    { key: 'teal',     name: '青碧', c: '#14b8a6' },
    { key: 'emerald',  name: '翠绿', c: '#10b981' },
    { key: 'green',    name: '草绿', c: '#22c55e' },
    { key: 'lime',     name: '青柠', c: '#84cc16' },
    { key: 'yellow',   name: '明黄', c: '#eab308' },
    { key: 'amber',    name: '琥珀', c: '#f59e0b' },
    { key: 'orange',   name: '橘橙', c: '#f97316' },
    { key: 'red',      name: '朱红', c: '#ef4444' },
    { key: 'rose',     name: '玫红', c: '#f43f5e' },
    { key: 'pink',     name: '桃粉', c: '#ec4899' },
    { key: 'fuchsia',  name: '品紫', c: '#d946ef' },
    { key: 'purple',   name: '紫罗兰', c: '#a855f7' },
    { key: 'violet',   name: '深紫', c: '#7c3aed' },
    { key: 'indigo2',  name: '蓝紫', c: '#6366f1' },
    { key: 'cobalt',   name: '宝蓝', c: '#3b82f6' },
    { key: 'ocean',    name: '深海', c: '#0891b2' },
    { key: 'slate',    name: '石墨', c: '#64748b' }
  ];

  /* 课程表选色就是上面这 20 个十六进制，平铺成数组方便 colorPicker 遍历 */
  var COURSE_COLORS = PRESETS.map(function (p) { return p.c; });

  global.Palette = {
    PRESETS: PRESETS,
    THEME_PRESETS: PRESETS,
    COURSE_COLORS: COURSE_COLORS,
    count: PRESETS.length
  };
})(typeof window !== 'undefined' ? window : globalThis);
