/* ==========================================================
 * 中国法定节假日 + 调休补班（课表中国化）
 * ----------------------------------------------------------
 * 数据来源：国务院办公厅《关于 2026 年部分节假日安排的通知》
 *          （国办发明电〔2025〕7 号，2025-11-04 发布）
 *
 * 结构：CN_HOLIDAYS[年份] = { 'MM-DD': { type, name } }
 *   type:
 *     'holiday' —— 法定放假日（课表视为停课）
 *     'work'    —— 调休补班（周末上班，课表视为上课日）
 *
 * 说明：
 *   - 仅内置已由国务院正式公布的年份。新一年数据通常在前一年
 *     11 月前后公布，届时往 CN_HOLIDAYS 里补一个年份对象即可。
 *   - 各高校/单位对「调休补班当天上哪一天的课」规定不一，本模块
 *     只负责标记「班」并保留课表原样（不自动替换成某工作日课表），
 *     具体调课仍由用户用「单次调课」功能处理。
 * ========================================================== */
(function (global) {
  'use strict';

  var CN_HOLIDAYS = {
    '2026': {
      // 元旦
      '01-01': { type: 'holiday', name: '元旦' },
      '01-02': { type: 'holiday', name: '元旦' },
      '01-03': { type: 'holiday', name: '元旦' },
      '01-04': { type: 'work', name: '元旦调休补班' },

      // 春节：2/15(腊月廿八)–2/23(正月初七) 放假，2/14、2/28 补班
      '02-14': { type: 'work', name: '春节调休补班' },
      '02-15': { type: 'holiday', name: '春节' },
      '02-16': { type: 'holiday', name: '春节' },
      '02-17': { type: 'holiday', name: '春节' },
      '02-18': { type: 'holiday', name: '春节' },
      '02-19': { type: 'holiday', name: '春节' },
      '02-20': { type: 'holiday', name: '春节' },
      '02-21': { type: 'holiday', name: '春节' },
      '02-22': { type: 'holiday', name: '春节' },
      '02-23': { type: 'holiday', name: '春节' },
      '02-28': { type: 'work', name: '春节调休补班' },

      // 清明节：4/4–4/6
      '04-04': { type: 'holiday', name: '清明节' },
      '04-05': { type: 'holiday', name: '清明节' },
      '04-06': { type: 'holiday', name: '清明节' },

      // 劳动节：5/1–5/5 放假，5/9 补班
      '05-01': { type: 'holiday', name: '劳动节' },
      '05-02': { type: 'holiday', name: '劳动节' },
      '05-03': { type: 'holiday', name: '劳动节' },
      '05-04': { type: 'holiday', name: '劳动节' },
      '05-05': { type: 'holiday', name: '劳动节' },
      '05-09': { type: 'work', name: '劳动节调休补班' },

      // 端午节：6/19–6/21
      '06-19': { type: 'holiday', name: '端午节' },
      '06-20': { type: 'holiday', name: '端午节' },
      '06-21': { type: 'holiday', name: '端午节' },

      // 中秋节：9/25–9/27；国庆节 10/1–10/7，9/20、10/10 补班
      '09-20': { type: 'work', name: '国庆调休补班' },
      '09-25': { type: 'holiday', name: '中秋节' },
      '09-26': { type: 'holiday', name: '中秋节' },
      '09-27': { type: 'holiday', name: '中秋节' },
      '10-01': { type: 'holiday', name: '国庆节' },
      '10-02': { type: 'holiday', name: '国庆节' },
      '10-03': { type: 'holiday', name: '国庆节' },
      '10-04': { type: 'holiday', name: '国庆节' },
      '10-05': { type: 'holiday', name: '国庆节' },
      '10-06': { type: 'holiday', name: '国庆节' },
      '10-07': { type: 'holiday', name: '国庆节' },
      '10-10': { type: 'work', name: '国庆调休补班' }
    }
  };

  /** 查某天（'YYYY-MM-DD'）的节假日信息；无则返回 null */
  function lookup(dateStr) {
    if (!dateStr || typeof dateStr !== 'string' || dateStr.length < 10) return null;
    var y = dateStr.slice(0, 4);
    var md = dateStr.slice(5, 10);
    var yr = CN_HOLIDAYS[y];
    if (!yr) return null;
    return yr[md] || null;
  }

  /** 某年全部节假日（按日期升序），用于设置页/图例展示 */
  function yearHolidays(year) {
    var yr = CN_HOLIDAYS[String(year)];
    if (!yr) return [];
    return Object.keys(yr).sort().map(function (md) {
      return { date: String(year) + '-' + md, type: yr[md].type, name: yr[md].name };
    });
  }

  /** 是否已有某年数据（没有数据的年份不显示任何标记） */
  function hasYear(year) {
    return !!CN_HOLIDAYS[String(year)];
  }

  global.HolidayCN = {
    lookup: lookup,
    yearHolidays: yearHolidays,
    hasYear: hasYear,
    data: CN_HOLIDAYS
  };
})(typeof window !== 'undefined' ? window : globalThis);
