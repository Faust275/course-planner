// OCR 基准的「版面」定义：一份 case.json 同时喂给三个地方
//   1) run.mjs   —— 算出「理想词表」（假设字都认对了），测结构还原算法
//   2) record.mjs —— 用同一套坐标把课表画成 PNG，喂真 Tesseract 录真实词表
//   3) 新增真实样本时 —— 直接把真机录的 words 放进 words.real.json，跳过这里
// 三者共用坐标，才能保证「图上画的」和「词表里写的」是同一张课表。

// 画布尺寸按「教务系统 1440 宽的截图」取，格子足够宽，22px 的课程名放得下。
// 字号太小的合成图 Tesseract 会识别成碎片，那是合成图不像真实截图的问题，不是算法的问题。
export const CANVAS = { W: 1400, H: 900, left: 180, right: 1360, top: 90, bottom: 830 };
export const DAY_WORDS = ['一', '二', '三', '四', '五', '六', '日'];

export function colCenter(i, days) {
  const step = (CANVAS.right - CANVAS.left) / days;
  return CANVAS.left + step * (i + 0.5);
}
export function colStep(days) {
  return (CANVAS.right - CANVAS.left) / days;
}
export function rowCenter(i, periods) {
  const step = (CANVAS.bottom - CANVAS.top) / periods;
  return CANVAS.top + step * (i + 0.5);
}
export function rowStep(periods) {
  return (CANVAS.bottom - CANVAS.top) / periods;
}

/** 一格的矩形范围，画图用 */
export function cellBox(day, period, days, periods) {
  const cw = colStep(days), rh = rowStep(periods);
  return {
    x: CANVAS.left + cw * (day - 1), y: CANVAS.top + rh * (period - 1),
    w: cw, h: rh
  };
}

/* 稳定的伪随机：同样的输入永远得同样的抖动，方便 diff 基线 */
function hashNoise(seed, i) {
  const x = Math.sin((seed + 1) * 12.9898 + (i + 1) * 78.233) * 43758.5453;
  return x - Math.floor(x);          // 0..1
}

/**
 * 一个词（内部格式，与 Ocr.parseResult 的输出一致：除 bbox 四角外还带 cx/cy）。
 * 词表一律用这个格式存，buildGrid 直接吃，不用再做一次转换。
 */
function makeWord(text, cx, cy, fs, conf) {
  const w = text.length * fs * 0.98;
  const h = fs * 1.28;
  return {
    text, conf: Math.round(conf),
    x0: Math.round(cx - w / 2), x1: Math.round(cx + w / 2),
    y0: Math.round(cy - h / 2), y1: Math.round(cy + h / 2),
    cx: Math.round(cx), cy: Math.round(cy)
  };
}

/**
 * 按 Tesseract 的习惯把一串文字切成词：
 * 纯中文按 2 字一组（真实 chi_sim 输出常见形态）；
 * 含数字/字母的串（如「教三201」）整体是一个词，否则拆开拼回去会多出空格。
 */
export function splitWords(text, cx, cy, fs, conf) {
  const out = [];
  if (/[A-Za-z0-9]/.test(text)) {
    out.push(makeWord(text, cx, cy, fs, conf));
    return out;
  }
  const chars = [...text];
  const total = chars.length * fs * 0.98;
  let x = cx - total / 2;
  for (let i = 0; i < chars.length; i += 2) {
    const seg = chars.slice(i, i + 2).join('');
    const w = seg.length * fs * 0.98;
    out.push(makeWord(seg, x + w / 2, cy, fs, conf));
    x += w;
  }
  return out;
}

/** case.json → 理想词表（等价于「字都认对了」时 Tesseract 的输出） */
export function buildWords(c) {
  const fs = (c.style && c.style.fontSize) || 14;
  const base = typeof c.reliability === 'number' ? c.reliability : 94;
  const days = c.days || 7;
  const periods = c.periods || 5;
  const words = [];
  const jitter = (i) => (hashNoise(c.id.length + (c.cells ? c.cells.length : 0), i) - 0.5) * 4;

  // 表头「周一…周日」
  for (let i = 0; i < days; i++) {
    words.push(makeWord('周' + DAY_WORDS[i], colCenter(i, days), CANVAS.top * 0.55, fs + 2, base + 2));
  }
  // 左侧节次「第N节」
  for (let i = 0; i < periods; i++) {
    words.push(makeWord('第' + (i + 1) + '节', CANVAS.left * 0.45, rowCenter(i, periods), fs, base + 1));
  }
  // 正文：每个格子若干行，每行切成若干词
  let k = 0;
  c.cells.forEach((cell) => {
    const cx = colCenter((cell.day || 1) - 1, days);
    const cy = rowCenter((cell.period || 1) - 1, periods);
    const lines = cell.lines || [];
    const gap = fs * 1.62;
    lines.forEach((line, li) => {
      const y = cy + (li - (lines.length - 1) / 2) * gap + jitter(k++) * 0.3;
      // 每行置信度略有出入，模拟真实 OCR 的波动（越靠后越低）
      const conf = Math.max(40, base - li * 4 - Math.abs(jitter(k++)) * 2);
      splitWords(line, cx, y, fs, conf).forEach((w) => words.push(w));
    });
  });
  return words;
}

/** case.json → 期望的课程列表（默认取每格第一行当课程名） */
export function buildExpected(c) {
  if (Array.isArray(c.expect)) return c.expect;
  return c.cells.map((cell) => ({
    day: cell.day,
    period: cell.period,
    name: (cell.lines || [])[0] || ''
  }));
}
