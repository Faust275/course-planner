/* ==========================================================
 * Store 记账域（v1.4.1 从 store.js 拆出）
 * ----------------------------------------------------------
 * 账目 CRUD、按月/分类统计、预算与预警。
 * 依赖 store.js 暴露的内部上下文 Store._ctx（state / defaultState / uid /
 * normalizeTags / ledgerCat），只通过 Object.assign 挂回 Store，
 * 不改变任何对外 API。
 * ========================================================== */
(function (global) {
  'use strict';
  var Store = global.Store;
  if (!Store || !Store._ctx) return;
  var ctx = Store._ctx;
  // store.js 会把 DateUtil 挂到全局；这里显式取一次，单测沙箱里也能用
  var DateUtil = global.DateUtil;
  var tagParts = ctx.tagParts;

  Object.assign(Store, {
  /* ===== 记账 ===== */
  getLastLedgerDate: function () {
    return (Store.state && Store.state.settings && Store.state.settings.lastLedgerDate) || '';
  },

  clearLastLedgerDate: function () {
    if (Store.state && Store.state.settings) {
      Store.state.settings.lastLedgerDate = '';
      this.save();
    }
  },

  addLedger: function (data) {
    var e = {
      id: ctx.uid('lg'),
      type: data.type === 'income' ? 'income' : 'expense',
      amount: Math.round((Number(data.amount) || 0) * 100) / 100,
      category: data.category || (data.type === 'income' ? 'other_in' : 'other'),
      note: (data.note || '').trim(),
      date: data.date || DateUtil.toStr(DateUtil.today()),
      time: data.time !== undefined ? String(data.time || '').trim() : DateUtil.nowHM(),
      source: data.source || 'manual',
      refId: data.refId || '',
      courseId: String(data.courseId || ''),
      courseName: String(data.courseName || ''),
      tags: ctx.normalizeTags(data.tags),
      createdAt: new Date().toISOString()
    };
    if (e.amount <= 0) return null;
    Store.state.ledger.push(e);
    if (e.source === 'manual' && Store.state.settings) {
      Store.state.settings.lastLedgerDate = e.date;
    }
    if (this.markAction) this.markAction('ledger', 1);
    this.bumpUsage('ledger');
    if (e.type === 'expense') {
      this.checkLedgerBudgetAlert(e);
    }
    this.settleKRs();
    this.emit();
    return e;
  },

  /** 记账后检查当日支出是否突破月预算日均额度或分类预警，返回温和轻提示文本 */
  checkLedgerBudgetAlert: function (entry) {
    this.lastBudgetAlert = '';
    if (!entry || entry.type !== 'expense' || !entry.date) return '';
    var ym = String(entry.date).slice(0, 7);
    var bStatus = this.ledgerBudgetStatus(ym);
    if (!bStatus) return '';
    var parts = ym.split('-');
    var daysInMonth = (parts.length === 2) ? new Date(Number(parts[0]), Number(parts[1]), 0).getDate() : 30;
    var daySpent = 0;
    (Store.state.ledger || []).forEach(function (x) {
      if (x && x.type === 'expense' && x.date === entry.date) {
        daySpent += Number(x.amount) || 0;
      }
  });
  daySpent = Math.round(daySpent * 100) / 100;
  if (bStatus.monthly > 0 && daysInMonth > 0) {
    var avgDaily = Math.round((bStatus.monthly / daysInMonth) * 10) / 10;
    var prevDaySpent = Math.max(0, daySpent - (Number(entry.amount) || 0));
    if (daySpent > avgDaily && prevDaySpent <= avgDaily) {
      this.lastBudgetAlert = '💡 今日支出 ¥' + daySpent + ' 已超本月日均预算（¥' + avgDaily + '/天）';
      return this.lastBudgetAlert;
    }
  }
  return this.lastBudgetAlert;
},

/** 判断一条待办是否属于消费/采购/缴费类待办 */
isExpenseTask: function (t) {
  if (!t) return false;
  var title = String(t.title || '');
  var expRe = /买|购|缴费|交费|报名费|书费|资料费|打印|聚餐|团建|报销|充值|续费|水电|网费|话费|快递|车票|机票|门票|礼物|红包|打车|外卖|电影|[¥￥]\s*\d+|\d+(?:\.\d+)?\s*(?:元|块)/;
  if (expRe.test(title)) return true;
  var tags = Array.isArray(t.tags) ? t.tags : [];
  return tags.some(function (tg) {
    return /购物|消费|餐饮|记账|缴费|报销|采购/.test(tg);
  });
},

/** 从待办中智能提取预填账目信息（金额、分类、备注、标签） */
extractTaskExpense: function (t) {
  if (!t) return { amount: 0, category: 'other', note: '', tags: [] };
  var title = String(t.title || '');
  var noteStr = String(t.note || '');
  var combined = title + ' ' + noteStr;
  var amt = 0;
  var m = combined.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/) ||
          combined.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块|rmb|RMB)/);
  if (m) amt = parseFloat(m[1]) || 0;
  var cat = 'other';
  if (/聚餐|外卖|饭|奶茶|咖啡|零食|水果|食堂|早餐|午餐|晚餐/.test(combined)) cat = 'food';
  else if (/书|教材|资料|打印|复印|报名费|考试|文具|网课/.test(combined)) cat = 'study';
  else if (/车票|机票|打车|地铁|公交|高铁|火车/.test(combined)) cat = 'transport';
  else if (/电影|门票|会员|游戏|演出|聚会|礼物/.test(combined)) cat = 'fun';
  else if (/买|购|水电|网费|话费|快递|洗衣|日用|纸巾|洗发/.test(combined)) cat = 'daily';
  return {
    amount: amt,
    category: cat,
    note: title,
    date: DateUtil.toStr(DateUtil.today()),
    tags: Array.isArray(t.tags) && t.tags.length ? t.tags.slice() : ['待办转化']
  };
},

/** 将待办一键转化为账目记录 */
createLedgerFromTask: function (taskIdOrObj, overrides) {
  var t = typeof taskIdOrObj === 'string' ? this.getTask(taskIdOrObj) : taskIdOrObj;
  if (!t) return null;
  var base = this.extractTaskExpense(t);
  var payload = Object.assign({}, base, overrides || {}, {
    type: (overrides && overrides.type) || 'expense',
    source: 'task',
    refId: t.id || ''
  });
  if (!(Number(payload.amount) > 0)) return null;
  return this.addLedger(payload);
},

updateLedger: function (id, data) {
  var e = this.getLedgerEntry(id);
  if (!e) return null;
  Object.keys(data).forEach(function (k) {
    if (k === 'amount') e[k] = Math.round((Number(data[k]) || 0) * 100) / 100;
    else if (k === 'tags') e[k] = ctx.normalizeTags(data.tags);
    else e[k] = typeof data[k] === 'string' ? data[k].trim() : data[k];
  });
  if (e.source === 'manual' && data.date && Store.state.settings) {
    Store.state.settings.lastLedgerDate = e.date;
  }
  this.emit();
  return e;
},

removeLedger: function (id) {
  Store.state.ledger = Store.state.ledger.filter(function (e) { return e.id !== id; });
  this.emit();
},

removeLedgerEntries: function (ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  var idSet = {};
  ids.forEach(function (x) { if (x) idSet[x] = true; });
  var before = Store.state.ledger.length;
  Store.state.ledger = Store.state.ledger.filter(function (e) { return !idSet[e.id]; });
  var removed = before - Store.state.ledger.length;
  if (removed > 0) {
    this.save();
    this.emit();
  }
  return removed;
},

getLedgerEntry: function (id) {
  for (var i = 0; i < Store.state.ledger.length; i++) {
    if (Store.state.ledger[i].id === id) return Store.state.ledger[i];
  }
  return null;
},

/**
 * 解析记账 CSV / TSV / 微信或支付宝导出账单文本
 * 支持：
 *  1) 微信支付账单 CSV（含前导说明行，自动识别「交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态」）
 *  2) 支付宝账单 CSV（含前导说明行，自动识别「交易时间,交易分类,交易对方,...,商品说明,收/支,金额,...,交易状态」）
 *  3) 通用有表头 CSV / TSV（支持 日期/date、时间/time、收支/类型/type、分类/category、金额/amount、备注/说明/商品/note、标签/tags）
 *  4) 通用无表头 CSV / TSV（支持「日期, 分类, 金额, 备注」或「日期, 收支, 分类, 金额, 备注, 时间, 标签」）
 */
parseLedgerCsv: function (csvText) {
  var out = [];
  if (!csvText || typeof csvText !== 'string') return out;
  var text = csvText.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var rawLines = text.split('\n');

  function splitCsvRow(line, sep) {
    var res = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === sep && !inQ) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    res.push(cur.trim());
    return res;
  }

  function parseDateTimeStr(s) {
    s = String(s || '').trim().replace(/^["']|["']$/g, '');
    if (!s) return null;
    var m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日]?(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        var ds = y + '-' + (mo < 10 ? '0' + mo : mo) + '-' + (d < 10 ? '0' + d : d);
        var hm = (m[4] != null && m[5] != null)
          ? ((+m[4] < 10 ? '0' + (+m[4]) : m[4]) + ':' + (+m[5] < 10 ? '0' + (+m[5]) : m[5]))
          : '';
        return { date: ds, time: hm };
      }
    }
    return null;
  }

  function inferCategory(type, rawCat, noteText) {
    var s = (String(rawCat || '') + ' ' + String(noteText || '')).toLowerCase();
    var rawTrim = String(rawCat || '').trim();
    var list = ctx.LEDGER_CATS[type] || ctx.LEDGER_CATS.expense;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === rawTrim || list[i].name === rawTrim) return list[i].key;
    }
    if (type === 'income') {
      if (/奖学金|助学金|竞赛|国奖|励志|scholarship/.test(s)) return 'scholarship';
      if (/兼职|家教|劳务|工资|实习|稿费|助研|助教|parttime/.test(s)) return 'parttime';
      if (/生活费|家里|父母|妈妈|爸爸|红包|转账|allowance/.test(s)) return 'allowance';
      return 'other_in';
    }
    if (/餐饮|食堂|外卖|美团|饿了么|饭|面|粉|粥|奶茶|咖啡|瑞幸|星巴克|库迪|喜茶|霸王茶姬|蜜雪|肯德基|麦当劳|零食|水果|烧烤|火锅|早餐|午餐|晚餐|夜宵|food|meal/.test(s)) return 'food';
    if (/交通|出行|地铁|公交|滴滴|打车|高德|哈啰|青桔|美团单车|单车|火车|高铁|12306|机票|加油|车票|transport/.test(s)) return 'transport';
    if (/学习|书|教材|文具|打印|复印|知网|考试|报名|四级|六级|考研|网课|课程|学费|study/.test(s)) return 'study';
    if (/娱乐|电影|游戏|steam|腾讯|网易|米哈游|明日方舟|b站|哔哩|会员|音乐|演出|ktv|桌游|旅游|景点|fun/.test(s)) return 'fun';
    if (/医疗|医院|校医院|药|诊所|挂号|体检|牙科|眼镜|medical/.test(s)) return 'medical';
    if (/购物|日用|服饰|数码|淘宝|天猫|京东|拼多多|超市|便利店|罗森|全家|7-11|快递|话费|水电|网费|校园卡|shopping/.test(s)) return 'shopping';
    return 'other';
  }

  var lines = [];
  for (var i = 0; i < rawLines.length; i++) {
    var ln = rawLines[i].trim();
    if (!ln || /^[-=,;\s]+$/.test(ln)) continue;
    lines.push(ln);
  }
  if (!lines.length) return out;

  var headerIdx = -1;
  var sep = ',';
  for (var h = 0; h < Math.min(lines.length, 35); h++) {
    var cand = lines[h];
    var cSep = cand.indexOf('\t') >= 0 && cand.indexOf(',') < 0 ? '\t' : ',';
    var cols = splitCsvRow(cand, cSep).map(function (c) { return c.replace(/^["']|["']$/g, '').trim(); });
    if (cols.length < 2) continue;
    var joined = cols.join('|');
    if ((/日期|时间|date|time/i.test(joined)) && (/金额|元|花费|价格|amount|money|price|cost/i.test(joined))) {
      headerIdx = h;
      sep = cSep;
      break;
    }
  }

  var todayStr = DateUtil.toStr(DateUtil.today());

  if (headerIdx >= 0) {
    var headers = splitCsvRow(lines[headerIdx], sep).map(function (c) {
      return c.replace(/^["']|["']$/g, '').trim().toLowerCase();
    });
    var idxDate = -1, idxTime = -1, idxType = -1, idxCat = -1, idxAmt = -1;
    var idxPeer = -1, idxGoods = -1, idxNote = -1, idxStatus = -1, idxTags = -1;

    headers.forEach(function (hd, idx) {
      if (idxDate < 0 && (/^(日期|交易日期|交易时间|记账日期|创建时间|付款时间|date|datetime|created_at)$/.test(hd) || hd.indexOf('交易时间') >= 0 || hd.indexOf('日期') >= 0)) idxDate = idx;
      else if (idxTime < 0 && /^(时间|time)$/.test(hd)) idxTime = idx;
      if (idxType < 0 && (/^(收\/支|收支|类型|收支类型|交易方向|type|direction)$/.test(hd))) idxType = idx;
      if (idxCat < 0 && (/^(分类|类别|交易分类|交易类型|账目分类|category|cat)$/.test(hd))) idxCat = idx;
      if (idxAmt < 0 && (/^(金额|金额\(元\)|金额（元）|交易金额|花费|数值|amount|money|price|cost|value)$/.test(hd) || hd.indexOf('金额') >= 0)) idxAmt = idx;
      if (idxPeer < 0 && (/^(交易对方|商户|商家|对方|counterparty|merchant)$/.test(hd))) idxPeer = idx;
      if (idxGoods < 0 && (/^(商品|商品说明|商品名称|item|goods|product)$/.test(hd))) idxGoods = idx;
      if (idxNote < 0 && (/^(备注|说明|摘要|描述|内容|note|memo|desc|description|title)$/.test(hd))) idxNote = idx;
      if (idxStatus < 0 && (/^(当前状态|交易状态|状态|status)$/.test(hd))) idxStatus = idx;
      if (idxTags < 0 && (/^(标签|tag|tags)$/.test(hd))) idxTags = idx;
    });

    for (var r = headerIdx + 1; r < lines.length; r++) {
      var row = splitCsvRow(lines[r], sep).map(function (c) { return c.replace(/^["']|["']$/g, '').trim(); });
      if (row.length < 2) continue;

      var dtInfo = idxDate >= 0 ? parseDateTimeStr(row[idxDate]) : null;
      if (!dtInfo) continue;

      if (idxStatus >= 0 && row[idxStatus]) {
        var stTxt = row[idxStatus];
        if (/退款成功|已全额退款|交易关闭|已关闭|未支付|失败/.test(stTxt)) continue;
      }

      var rawType = idxType >= 0 ? row[idxType] : '';
      if (rawType && /不计收支|中性交易|\/|--/.test(rawType) && !/支出|收入|expense|income/i.test(rawType)) continue;

      var rawAmtStr = idxAmt >= 0 ? String(row[idxAmt] || '') : '';
      var isNeg = /^\s*-/.test(rawAmtStr);
      var cleanAmt = parseFloat(rawAmtStr.replace(/[¥￥$,，元\s+]/g, ''));
      if (isNaN(cleanAmt) || Math.abs(cleanAmt) <= 0) continue;
      var amt = Math.round(Math.abs(cleanAmt) * 100) / 100;

      var type = 'expense';
      if (/收入|转入|收款|income|in/i.test(rawType)) type = 'income';
      else if (/支出|转出|付款|消费|expense|out/i.test(rawType)) type = 'expense';
      else if (isNeg) type = 'expense';
      else if (idxCat >= 0 && /奖学金|兼职|生活费|工资|收入/.test(row[idxCat])) type = 'income';

      var timeStr = (idxTime >= 0 && /^\d{1,2}:\d{2}/.test(row[idxTime])) ? row[idxTime].slice(0, 5) : (dtInfo.time || '12:00');
      if (/^\d:\d{2}$/.test(timeStr)) timeStr = '0' + timeStr;

      var noteParts = [];
      if (idxPeer >= 0 && row[idxPeer] && row[idxPeer] !== '/') noteParts.push(row[idxPeer]);
      if (idxGoods >= 0 && row[idxGoods] && row[idxGoods] !== '/' && row[idxGoods] !== row[idxPeer]) noteParts.push(row[idxGoods]);
      if (idxNote >= 0 && row[idxNote] && row[idxNote] !== '/' && noteParts.indexOf(row[idxNote]) < 0) noteParts.push(row[idxNote]);
      var note = noteParts.join(' · ');

      var rawCat = idxCat >= 0 ? row[idxCat] : '';
      var catKey = inferCategory(type, rawCat, note);

      var tags = [];
      if (idxTags >= 0 && row[idxTags]) {
        tags = ctx.normalizeTags(row[idxTags].split(/[|,;，；\s]+/).filter(Boolean));
      }

      out.push({
        date: dtInfo.date,
        time: timeStr || '12:00',
        type: type,
        category: catKey,
        amount: amt,
        note: note || rawCat || '',
        tags: tags,
        source: 'csv'
      });
    }
    return out;
  }

  for (var k = 0; k < lines.length; k++) {
    var rSep = lines[k].indexOf('\t') >= 0 && lines[k].indexOf(',') < 0 ? '\t' : ',';
    var cols = splitCsvRow(lines[k], rSep).map(function (c) { return c.replace(/^["']|["']$/g, '').trim(); });
    if (cols.length < 2) continue;
    var dt = parseDateTimeStr(cols[0]);
    if (!dt) continue;

    var type = 'expense', rawCat = '', amt = 0, note = '', time = dt.time || '12:00', tags = [];
    var amtIdx = -1;
    for (var cIdx = 1; cIdx < cols.length; cIdx++) {
      var cleaned = cols[cIdx].replace(/[¥￥$,，元\s+]/g, '');
      if (/^-?\d+(\.\d+)?$/.test(cleaned) && parseFloat(cleaned) !== 0) {
        amtIdx = cIdx;
        if (/^\s*-/.test(cols[cIdx])) type = 'expense';
        amt = Math.round(Math.abs(parseFloat(cleaned)) * 100) / 100;
        break;
      }
    }
    if (amtIdx < 0 || amt <= 0) continue;

    for (var pre = 1; pre < amtIdx; pre++) {
      var token = cols[pre];
      if (/^(支出|收入|expense|income)$/i.test(token)) {
        type = /收入|income/i.test(token) ? 'income' : 'expense';
      } else if (!rawCat) {
        rawCat = token;
      }
    }
    if (rawCat && /奖学金|兼职|生活费|收入/.test(rawCat) && type === 'expense') {
      type = 'income';
    }

    var rest = cols.slice(amtIdx + 1);
    if (rest.length > 0) note = rest[0] || '';
    if (rest.length > 1 && /^\d{1,2}:\d{2}$/.test(rest[1])) {
      time = rest[1].length === 4 ? '0' + rest[1] : rest[1];
      if (rest.length > 2 && rest[2]) tags = ctx.normalizeTags(rest[2].split(/[|;；\s]+/).filter(Boolean));
    } else if (rest.length > 1 && rest[1]) {
      tags = ctx.normalizeTags(rest[1].split(/[|;；\s]+/).filter(Boolean));
    }

    var catKey = inferCategory(type, rawCat, note);
    out.push({
      date: dt.date || todayStr,
      time: time || '12:00',
      type: type,
      category: catKey,
      amount: amt,
      note: note || rawCat || '',
      tags: tags,
      source: 'csv'
    });
  }

  return out;
},

/**
 * 批量导入记账 CSV 文本并自动去重
 */
importLedgerCsv: function (csvText) {
  var items = this.parseLedgerCsv(csvText);
  var added = 0, skipped = 0, expenseCount = 0, incomeCount = 0, expenseTotal = 0, incomeTotal = 0;
  var addedIds = [];
  items.forEach(function (it) {
    var dup = Store.state.ledger.some(function (e) {
      return e.date === it.date &&
             e.type === it.type &&
             Math.abs((Number(e.amount) || 0) - it.amount) < 0.005 &&
             (e.note || '') === (it.note || '') &&
             (e.time || '') === (it.time || '');
    });
    if (dup) { skipped++; return; }
    var newId = ctx.uid('lg');
    Store.state.ledger.push({
      id: newId,
      type: it.type,
      amount: it.amount,
      category: it.category || (it.type === 'income' ? 'other_in' : 'other'),
      note: it.note || '',
      date: it.date,
      time: it.time || '12:00',
      source: 'csv',
      refId: '',
      tags: ctx.normalizeTags(it.tags),
      createdAt: new Date().toISOString()
    });
    addedIds.push(newId);
    added++;
    if (it.type === 'income') { incomeCount++; incomeTotal += it.amount; }
    else { expenseCount++; expenseTotal += it.amount; }
  });
  if (added > 0) {
    if (this.markAction) this.markAction('ledger', 1);
    this.bumpUsage('ledger');
    this.save();
    this.emit();
  }
  return {
    ok: items.length > 0,
    total: items.length,
    added: added,
    addedIds: addedIds,
    skipped: skipped,
    expenseCount: expenseCount,
    incomeCount: incomeCount,
    expenseTotal: Math.round(expenseTotal * 100) / 100,
    incomeTotal: Math.round(incomeTotal * 100) / 100,
    items: items
  };
},

/** 由饮食记录生成的那条账目 */
ledgerByRef: function (refId) {
  for (var i = 0; i < Store.state.ledger.length; i++) {
    if (Store.state.ledger[i].refId === refId && Store.state.ledger[i].source === 'meal') {
      return Store.state.ledger[i];
    }
  }
  return null;
},

/** 某月（YYYY-MM）流水；不传则全部 */
ledgerOfMonth: function (ym) {
  return Store.state.ledger.filter(function (e) {
    return !ym || e.date.slice(0, 7) === ym;
  }).sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
},

/** 收支汇总 */
ledgerStats: function (ym) {
  var income = 0, expense = 0;
  this.ledgerOfMonth(ym).forEach(function (e) {
    if (e.type === 'income') income += e.amount;
    else expense += e.amount;
  });
  return {
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    balance: Math.round((income - expense) * 100) / 100
  };
},

/** 按标签汇总金额：[{ full, lv1, lv2, amount, count }] */
ledgerByTag: function (ym) {
  var map = {};
  this.ledgerOfMonth(ym).forEach(function (e) {
    var tags = (e.tags && e.tags.length) ? e.tags : ['未打标签'];
    tags.forEach(function (t) {
      if (!map[t]) map[t] = { amount: 0, count: 0 };
      map[t].amount += e.amount;
      map[t].count += 1;
    });
  });
  return Object.keys(map).map(function (k) {
    var parts = tagParts(k);
    return {
      full: k, lv1: parts.lv1, lv2: parts.lv2,
      amount: Math.round(map[k].amount * 100) / 100, count: map[k].count
    };
  }).sort(function (a, b) { return b.amount - a.amount; });
},

/** 分类统计（支出） */
ledgerByCategory: function (ym) {
  var map = {};
  this.ledgerOfMonth(ym).forEach(function (e) {
    if (e.type !== 'expense') return;
    map[e.category] = (map[e.category] || 0) + e.amount;
  });
  return Object.keys(map).map(function (k) {
    return { key: k, total: Math.round(map[k] * 100) / 100, cat: ctx.ledgerCat('expense', k) };
  }).sort(function (a, b) { return b.total - a.total; });
},

/** 最近 n 天每日支出 */
ledgerByDay: function (n) {
  n = n || 7;
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    var d = DateUtil.addDays(DateUtil.today(), -i);
    var ds = DateUtil.toStr(d);
    var sum = 0;
    Store.state.ledger.forEach(function (e) {
      if (e.date === ds && e.type !== 'income') sum += e.amount;
    });
      out.push({ date: ds, d: d, amount: Math.round(sum * 100) / 100 });
  }
  return out;
},

/* ===== 记账预算 ===== */
/** 读取预算（含合法性兜底，老数据缺字段时回退默认值） */
getBudget: function () {
  var ds = ctx.defaultState();
  var b = (Store.state.settings && Store.state.settings.ledgerBudget) || ds.settings.ledgerBudget;
  var cats = (b && typeof b.categories === 'object' && b.categories) ? b.categories : {};
  var out = { monthly: Number(b && b.monthly) > 0 ? Number(b.monthly) : 0, categories: {} };
  Object.keys(cats).forEach(function (k) {
    var v = Number(cats[k]);
    if (v > 0) out.categories[k] = v;
  });
  return out;
},

/** 保存预算：data = { monthly, categories:{...} }（只保留正数，0 视为不限） */
setBudget: function (data) {
  if (!Store.state.settings.ledgerBudget) Store.state.settings.ledgerBudget = { monthly: 0, categories: {} };
  var next = { monthly: 0, categories: {} };
  if (data && Number(data.monthly) > 0) next.monthly = Math.round(Number(data.monthly) * 100) / 100;
  if (data && data.categories) {
    Object.keys(data.categories).forEach(function (k) {
      var v = Number(data.categories[k]);
      if (v > 0) next.categories[k] = Math.round(v * 100) / 100;
    });
  }
  Store.state.settings.ledgerBudget = next;
  this.emit();
  return next;
},

/**
 * 预算执行状态（默认当月）
 * @returns {
 *   ym, spent, budget, remaining, pct, over,
 *   daysLeft, dailyAvg, dailyLeft, estMonth,
 *   cats:[{key,name,color,budget,spent,pct,over}]
 * }
 */
ledgerBudgetStatus: function (ym) {
  ym = ym || DateUtil.toStr(DateUtil.today()).slice(0, 7);
  var budget = this.getBudget();
  var spent = this.ledgerStats(ym).expense;
  var B = budget.monthly;
  var today = DateUtil.today();
  var ymNow = DateUtil.toStr(today).slice(0, 7);
  // 当月天数 & 剩余天数（只看"今天之后到月底"）
  var ymParts = ym.split('-');
  var daysInMonth = new Date(Number(ymParts[0]), Number(ymParts[1]), 0).getDate();
  var daysLeft = (ym === ymNow) ? Math.max(0, daysInMonth - today.getDate()) : 0;
  var dailyAvg = Math.round((spent / Math.max(1, (ym === ymNow ? today.getDate() : daysInMonth))) * 100) / 100;
  var dailyLeft = (B > 0 && daysLeft > 0) ? Math.round((B - spent) / daysLeft * 100) / 100 : null;
  var estMonth = (ym === ymNow && dailyAvg > 0) ? Math.round(dailyAvg * daysInMonth * 100) / 100 : null;

  var catMap = {};
  this.ledgerByCategory(ym).forEach(function (c) { catMap[c.key] = c.total; });
  var cats = Object.keys(budget.categories).map(function (k) {
    var cb = budget.categories[k];
    var cs = catMap[k] || 0;
    return {
      key: k,
      name: ctx.ledgerCat('expense', k).name,
      color: ctx.ledgerCat('expense', k).color,
      budget: cb,
      spent: cs,
      pct: Math.min(1.5, cb > 0 ? cs / cb : 0),
      over: cb > 0 && cs > cb
    };
  }).sort(function (a, b) { return b.spent - a.spent; });

  return {
    ym: ym,
    spent: Math.round(spent * 100) / 100,
    budget: B,
    remaining: B > 0 ? Math.round((B - spent) * 100) / 100 : null,
    pct: B > 0 ? Math.min(1.5, spent / B) : null,
    over: B > 0 && spent > B,
    daysLeft: daysLeft,
    dailyAvg: dailyAvg,
    dailyLeft: dailyLeft,
    estMonth: estMonth,
    cats: cats
  };
},
  });
})(window);
