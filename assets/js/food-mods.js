/* ==========================================================
 * 食物修饰：把「看不见的变量」交给用户勾，而不是让 AI 猜
 *
 * 炒菜的大头是油，奶茶的大头是糖和小料——这两样都看不出来，
 * 但用户自己知道答案。所以拆成离散勾选：
 *   做法：按「每 100g 食材额外吸入的油/糖/粉」计
 *   杯型：相对标准杯的整体系数
 *   糖度：绝对减糖（碳水同减，钳到 0）
 *   小料：绝对加量
 *
 * 计算约定（与 Store.sumItem 一致）：
 *   kind='mul'    → 整体乘系数 v（杯型）
 *   kind='add'    → 绝对增量（糖度、小料）
 *   kind='per100' → 每 100g 食材的增量（做法），× (克数/100)
 * ========================================================== */
(function (global) {
  'use strict';

  /** 杯型：相对「标准 500ml」的整体系数 */
  var SIZES = [
    { id: 'small', label: '小杯', k: 'mul', v: 0.8, note: '约 400ml' },
    { id: 'std', label: '标准', k: 'mul', v: 1, note: '约 500ml' },
    { id: 'large', label: '大杯', k: 'mul', v: 1.2, note: '约 600ml' }
  ];

  /** 糖度：相对「库里那条标准糖」的绝对减量（1g 糖 ≈ 4kcal） */
  var SUGAR = [
    { id: 'full', label: '全糖', k: 'add', kcal: 0, p: 0, f: 0, c: 0 },
    { id: 'seven', label: '七分', k: 'add', kcal: -50, p: 0, f: 0, c: -12 },
    { id: 'half', label: '半糖', k: 'add', kcal: -100, p: 0, f: 0, c: -24 },
    { id: 'none', label: '无糖', k: 'add', kcal: -200, p: 0, f: 0, c: -40 }
  ];

  /** 小料：绝对加量（一份的参考值） */
  var TOPPINGS = [
    { id: 'pearl', label: '珍珠', k: 'add', kcal: 100, p: 1, f: 0, c: 22 },
    { id: 'cheese', label: '奶盖', k: 'add', kcal: 130, p: 2, f: 13, c: 3 },
    { id: 'coco', label: '椰果', k: 'add', kcal: 60, p: 0, f: 0, c: 15 },
    { id: 'taroball', label: '芋圆', k: 'add', kcal: 120, p: 1, f: 1, c: 28 },
    { id: 'taro', label: '芋泥', k: 'add', kcal: 180, p: 2, f: 5, c: 30 },
    { id: 'pudding', label: '布丁', k: 'add', kcal: 90, p: 2, f: 2, c: 15 },
    { id: 'grass', label: '仙草', k: 'add', kcal: 40, p: 0, f: 0, c: 9 },
    { id: 'redbean', label: '红豆', k: 'add', kcal: 110, p: 3, f: 0, c: 22 },
    { id: 'oat', label: '燕麦', k: 'add', kcal: 90, p: 2, f: 1, c: 15 }
  ];

  /**
   * 做法：每 100g 生食材额外增加的量。
   * 1g 油 ≈ 9kcal。清炒约吸 6g 油/100g，家常炒约 12g，油炸约 18g 外加裹粉。
   * 校验：200g 茄子（生 50kcal）+ 家常炒 = 50 + 112×2 = 274kcal，接近实测 ~275。
   */
  var COOK = [
    { id: 'plain', label: '不额外加油', k: 'per100', kcal: 0, p: 0, f: 0, c: 0, note: '生吃/白灼' },
    { id: 'steam', label: '清蒸水煮', k: 'per100', kcal: 8, p: 0, f: 0.6, c: 1, note: '加酱汁' },
    { id: 'light', label: '少油清炒', k: 'per100', kcal: 54, p: 0, f: 6, c: 0, note: '约 +6g 油/100g' },
    { id: 'home', label: '家常炒', k: 'per100', kcal: 112, p: 0, f: 12, c: 1, note: '约 +12g 油/100g' },
    { id: 'braise', label: '红烧', k: 'per100', kcal: 114, p: 1, f: 10, c: 6, note: '油 + 糖 + 酱' },
    { id: 'deep', label: '油炸', k: 'per100', kcal: 194, p: 1, f: 18, c: 8, note: '吸油 + 裹粉' }
  ];

  /** 甜饮（可调糖度 + 杯型 + 小料） */
  var TEA_RE = /奶茶|奶绿|奶盖|果茶|星冰乐|摩卡|蜂蜜|柠檬|柚子|百香|杨枝|珍珠|椰|芋/;
  /** 咖啡（多数只能调杯型，糖浆不常见） */
  var COFFEE_RE = /拿铁|卡布|美式|咖啡/;
  /** 名称里已带做法的，不再让选做法（否则重复叠加） */
  var COOKED_RE = /炒|炸|煎|烤|红烧|蒸|煮|炖|酱|卤|熏|干锅|糖醋|宫保|鱼香|烧|焖|拌|焗|煸|爆/;
  /** 名称里已带糖度的，不再让调糖度 */
  var SUGARED_RE = /无糖|半糖|全糖|少糖|三分|五分|七分/;
  /** 可以选做法的生食材分类 */
  var RAW_CATS = { '蔬菜': 1, '肉蛋': 1, '水产': 1, '豆奶': 1 };

  /**
   * 判断一条食物该给哪些修饰选项。
   * @param {{n:string, cat:string}} f
   * @returns {{size:Array, sugar:Array, toppings:Array, cook:Array}}
   */
  function specFor(f) {
    var out = { size: [], sugar: [], toppings: [], cook: [] };
    if (!f) return out;
    var n = String(f.n || '');
    var cat = String(f.cat || '');

    if (cat === '饮品') {
      if (TEA_RE.test(n)) {
        out.size = SIZES;
        out.toppings = TOPPINGS;
        // 库里「奶茶（全糖/半糖/无糖）」已经把糖度算进去了，再调就重复扣
        if (!SUGARED_RE.test(n)) out.sugar = SUGAR;
      } else if (COFFEE_RE.test(n)) {
        out.size = SIZES;
      }
      return out;
    }

    if (RAW_CATS[cat] && !COOKED_RE.test(n)) out.cook = COOK;
    return out;
  }

  /** 把选中的修饰转成可持久化的紧凑结构 */
  function normMod(m) {
    if (!m || typeof m !== 'object') return null;
    var k = m.k === 'mul' || m.k === 'per100' ? m.k : 'add';
    var out = {
      id: String(m.id || ''),
      label: String(m.label || ''),
      k: k
    };
    if (k === 'mul') out.v = Number(m.v) > 0 ? Number(m.v) : 1;
    else {
      out.kcal = Number(m.kcal) || 0;
      out.p = Number(m.p) || 0;
      out.f = Number(m.f) || 0;
      out.c = Number(m.c) || 0;
    }
    return out;
  }

  /** 校验并规范化一个明细项的修饰列表 */
  function normMods(list) {
    if (!Array.isArray(list)) return [];
    return list.map(normMod).filter(Boolean).slice(0, 16);
  }

  /** 修饰摘要，如「大杯·半糖·珍珠/奶盖」或「家常炒」，用于列表展示 */
  function summary(mods) {
    var list = normMods(mods);
    if (!list.length) return '';
    var extra = [];
    list.forEach(function (m) {
      if (m.k === 'mul') {
        if (m.v > 1.05) extra.push('大份');
        else if (m.v < 0.95) extra.push('小份');
      } else if (m.id !== 'full') extra.push(m.label);
    });
    return extra.join('·');
  }

  global.FoodMods = {
    SIZES: SIZES,
    SUGAR: SUGAR,
    TOPPINGS: TOPPINGS,
    COOK: COOK,
    specFor: specFor,
    normMod: normMod,
    normMods: normMods,
    summary: summary
  };
})(typeof window !== 'undefined' ? window : this);
