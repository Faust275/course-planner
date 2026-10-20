

/* ==========================================================
 * 语音输入：本地优先（浏览器原生）→ 云端（讯飞 / 自定义）兜底
 * 另含中文口语的时间/日期解析
 * ========================================================== */
(function (global) {
  'use strict';

  var CN_NUM = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

  /** 中文数字 → 阿拉伯数字（支持 1-99） */
  function cnToNum(str) {
    str = String(str || '').trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    if (str === '十') return 10;
    if (str.indexOf('十') >= 0) {
      var parts = str.split('十');
      var a = parts[0] ? (CN_NUM[parts[0]] != null ? CN_NUM[parts[0]] : NaN) : 1;
      var b = parts[1] ? (CN_NUM[parts[1]] != null ? CN_NUM[parts[1]] : NaN) : 0;
      if (isNaN(a) || isNaN(b)) return NaN;
      return a * 10 + b;
    }
    var n = CN_NUM[str];
    return n == null ? NaN : n;
  }

  /** 从口语文本中解析出日期与时间，并剥离这些词得到纯标题 */
  function parseSpoken(text) {
    var src = String(text || '').trim();
    var res = { title: src, dueDate: '', dueTime: '', priority: 'normal' };

    if (!src) return res;

    var today = DateUtil.today();
    var dateStr = '';
    var timeStr = '';
    var removed = [];

    /* ---------- 时间 ---------- */
    // 晚上八点 / 下午3点半 / 9点20 / 十点
    var timePat = new RegExp(
      '(上午|早上|早晨|下午|中午|晚上|傍晚|夜里|凌晨)?\\s*' +
      '([0-9]{1,2}|[零〇一二两三四五六七八九十]{1,3})\\s*[点時时]\\s*' +
      '(半|[0-9]{1,2}\\s*分?|[零〇一二两三四五六七八九十]{1,3}\\s*分?)?',
      'g');
    var mt = timePat.exec(src);
    if (mt) {
      var h = /^\d+$/.test(mt[2]) ? parseInt(mt[2], 10) : cnToNum(mt[2]);
      var m = 0;
      if (mt[3]) {
        if (mt[3] === '半') m = 30;
        else {
          var mm = mt[3].replace(/分/g, '').trim();
          m = /^\d+$/.test(mm) ? parseInt(mm, 10) : cnToNum(mm);
        }
      }
      var ampm = mt[1] || '';
      if (!isNaN(h)) {
        if (ampm === '下午' || ampm === '傍晚' || ampm === '晚上' || ampm === '夜里') {
          if (h < 12) h += 12;
        } else if (ampm === '中午' && h < 12) {
          h = 12;
        } else if (!ampm && h <= 7) {
          h += 12;      // 没说上/下午，「三点」默认下午三点
        }
        h = Math.max(0, Math.min(23, h));
        m = isNaN(m) ? 0 : Math.max(0, Math.min(59, m));
        timeStr = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
        removed.push(mt[0]);
      }
    }

    // 只说了「晚上/中午/早上」没说几点
    if (!timeStr) {
      var vague = /(晚上|傍晚)/.exec(src);
      if (vague) { timeStr = '20:00'; removed.push(vague[0]); }
      else if (/(中午)/.test(src)) { timeStr = '12:00'; removed.push('中午'); }
      else if (/(早上|早晨)/.test(src)) { timeStr = '09:00'; removed.push(/早上|早晨/.exec(src)[0]); }
    }

    /* ---------- 日期 ---------- */
    var relMap = [
      [/大后天/, 3], [/大大后天/, 4], [/后天/, 2], [/明天|明日|明儿/, 1], [/今天|今日|今晚/, 0]
    ];
    for (var i = 0; i < relMap.length; i++) {
      if (relMap[i][0].test(src)) {
        dateStr = DateUtil.toStr(DateUtil.addDays(today, relMap[i][1]));
        removed.push(relMap[i][0].exec(src)[0]);
        break;
      }
    }

    // 下周X / 本周X / 周X / 星期X / 礼拜X
    if (!dateStr) {
      var wm = /(下下?周|本?周|星期|礼拜)\s*([一二三四五六日天1-7])/.exec(src);
      if (wm) {
        var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };
        var want = map[wm[2]];
        if (want) {
          var cur = DateUtil.isoDow(today);
          var diff = want - cur;
          if (wm[1].indexOf('下下') === 0) diff += 14;
          else if (wm[1].indexOf('下') === 0) diff += 7;
          if (diff <= 0 && wm[1].indexOf('下') !== 0) diff += 7;
          dateStr = DateUtil.toStr(DateUtil.addDays(today, diff));
          removed.push(wm[0]);
        }
      }
    }

    // 10月25日 / 10/25 / 10-25
    if (!dateStr) {
      var dm = /([0-9]{1,2})\s*[月\/\-]\s*([0-9]{1,2})\s*[日号]?/.exec(src);
      if (dm) {
        var mo = parseInt(dm[1], 10), dd = parseInt(dm[2], 10);
        if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
          var y = today.getFullYear();
          if (mo < today.getMonth() + 1) y += 1;   // 已过月份算明年
          dateStr = y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dd < 10 ? '0' : '') + dd;
          removed.push(dm[0]);
        }
      }
    }

    /* ---------- 优先级 ---------- */
    if (/(重要|紧急|必须|一定要|优先)/.test(src)) {
      res.priority = 'high';
    }

    /* ---------- 生成标题 ---------- */
    var title = src;
    removed.forEach(function (r) {
      if (r) title = title.replace(r, ' ');
    });
    title = title
      .replace(/(记得|提醒我|提醒我一下|帮我|给我|请|麻烦)/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[的，,、。. ]+/, '')
      .replace(/[，,、。. ]+$/, '')
      .trim();

    res.title = title || src;
    res.dueDate = dateStr;
    res.dueTime = timeStr;
    return res;
  }

  /* ==========================================================
   * 本地识别（浏览器原生 Web Speech API）
   * ========================================================== */
  function nativeSupported() {
    return !!(global.SpeechRecognition || global.webkitSpeechRecognition);
  }

  function startNative(opts) {
    var Ctor = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!Ctor) {
      opts.onError && opts.onError({ code: 'unsupported', message: '当前浏览器不支持语音识别' });
      return null;
    }

    var rec = new Ctor();
    rec.lang = opts.lang || 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    var finished = false;

    rec.onstart = function () { opts.onStart && opts.onStart(); };

    rec.onresult = function (e) {
      var interim = '', finalText = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      opts.onResult && opts.onResult({ text: (finalText || interim).trim(), final: !!finalText });
    };

    rec.onerror = function (e) {
      finished = true;
      var msgMap = {
        'not-allowed': '麦克风权限被拒绝，请在浏览器设置里允许',
        'service-not-allowed': '语音服务不可用（国内网络可能无法连接 Google 服务）',
        'network': '网络连接失败，语音识别需要联网',
        'no-speech': '没有听到声音，再试一次',
        'audio-capture': '找不到麦克风',
        'aborted': '已取消'
      };
      opts.onError && opts.onError({
        code: e.error || 'unknown',
        message: msgMap[e.error] || ('识别失败：' + (e.error || '未知错误'))
      });
    };

    rec.onend = function () {
      if (!finished) { finished = true; opts.onEnd && opts.onEnd(); }
    };

    try {
      rec.start();
    } catch (err) {
      opts.onError && opts.onError({ code: 'start-failed', message: '无法启动录音：' + err.message });
      return null;
    }

    return {
      stop: function () { try { rec.stop(); } catch (e) {} },
      abort: function () { try { rec.abort(); } catch (e) {} }
    };
  }

  /* ==========================================================
   * 云端兜底（讯飞语音听写，WebSocket 直连）
   * ========================================================== */
  function md5hex(str) {
    // 简易 MD5（用于讯飞签名）
    function safeAdd(x, y) {
      var lsw = (x & 0xffff) + (y & 0xffff);
      var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
      return (msw << 16) | (lsw & 0xffff);
    }
    function rol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
    function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

    function utf8(s) {
      return unescape(encodeURIComponent(s));
    }
    var str2 = utf8(str);
    var len = str2.length;
    var words = [];
    for (var i = 0; i < len; i++) words[i >> 2] |= (str2.charCodeAt(i) & 0xff) << ((i % 4) * 8);
    words[len >> 2] |= 0x80 << ((len % 4) * 8);
    words[(((len + 8) >> 6) + 1) * 16 - 1] = len * 8;

    var a0 = 1732584193, b0 = -271733879, c0 = -1732584194, d0 = 271733878;
    for (var j = 0; j < words.length; j += 16) {
      var A = a0, B = b0, C = c0, D = d0;
      var w = words.slice(j, j + 16);
      for (var k = 0; k < 16; k++) w[k] = w[k] || 0;

      var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
      for (var q = 0; q < 16; q++) {
        var t = 0, s = S[q % 16];
        if (q < 4) t = ff(A, B, C, D, w[q], s, Math.floor(Math.abs(Math.sin(q + 1)) * 4294967296));
        else if (q < 8) t = gg(A, B, C, D, w[q], s, Math.floor(Math.abs(Math.sin(q + 1)) * 4294967296));
        else if (q < 12) t = hh(A, B, C, D, w[q], s, Math.floor(Math.abs(Math.sin(q + 1)) * 4294967296));
        else t = ii(A, B, C, D, w[q], s, Math.floor(Math.abs(Math.sin(q + 1)) * 4294967296));
        var tmp = D; D = C; C = B;
        B = safeAdd(B, rol(safeAdd(A, t), s));
        A = tmp;
      }
      a0 = safeAdd(a0, A); b0 = safeAdd(b0, B); c0 = safeAdd(c0, C); d0 = safeAdd(d0, D);
    }
    function hex(n) {
      var s2 = '';
      for (var i2 = 0; i2 < 4; i2++) {
        var b = (n >> (i2 * 8)) & 0xff;
        s2 += ('0' + b.toString(16)).slice(-2);
      }
      return s2;
    }
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  function hmacSha1(keyStr, msgStr) {
    // 用 Web Crypto 的同步替代实现（简化 SHA-1 + HMAC）
    function sha1(bytes) {
      var ml = bytes.length * 8;
      var words = [];
      for (var i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
      words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length % 4) * 8);
      words[(((bytes.length + 8) >> 6) + 1) * 16 - 1] = ml;

      var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
      for (var j = 0; j < words.length; j += 16) {
        var w = [];
        for (var t = 0; t < 80; t++) {
          if (t < 16) w[t] = words[j + t] || 0;
          else w[t] = rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        }
        var A = h0, B = h1, C = h2, D = h3, E = h4;
        for (var t2 = 0; t2 < 80; t2++) {
          var f, k;
          if (t2 < 20) { f = (B & C) | (~B & D); k = 0x5a827999; }
          else if (t2 < 40) { f = B ^ C ^ D; k = 0x6ed9eba1; }
          else if (t2 < 60) { f = (B & C) | (B & D) | (C & D); k = 0x8f1bbcdc; }
          else { f = B ^ C ^ D; k = 0xca62c1d6; }
          var temp = (rol(A, 5) + f + E + k + w[t2]) >>> 0;
          E = D; D = C; C = rol(B, 30); B = A; A = temp;
        }
        h0 = (h0 + A) >>> 0; h1 = (h1 + B) >>> 0; h2 = (h2 + C) >>> 0;
        h3 = (h3 + D) >>> 0; h4 = (h4 + E) >>> 0;
      }
      return [h0, h1, h2, h3, h4];
    }
    function rol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }

    var key = utf8Bytes(keyStr), msg = utf8Bytes(msgStr);
    var ipad = [], opad = [];
    for (var i = 0; i < 64; i++) {
      var kb = i < key.length ? key[i] : 0;
      ipad[i] = kb ^ 0x36; opad[i] = kb ^ 0x5c;
    }
    var inner = ipad.concat(msg);
    var innerHash = sha1(inner);
    var innerBytes = [];
    innerHash.forEach(function (h) {
      innerBytes.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
    });
    var outer = opad.concat(innerBytes);
    return sha1(outer);
  }

  function utf8Bytes(str) {
    var out = [];
    var s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  function bytesToBase64(bytes) {
    var s = '';
    bytes.forEach(function (b) { s += String.fromCharCode(b); });
    return btoa(s);
  }

  function hmacSha1Base64(key, msg) {
    var words = hmacSha1(key, msg);
    var bytes = [];
    words.forEach(function (h) {
      bytes.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
    });
    return bytesToBase64(bytes);
  }

  /** 讯飞语音听写（WebSocket 直连，纯前端可完成） */
  function startXunfei(opts) {
    var cfg = (Store.state.settings && Store.state.settings.asr) || {};
    var appid = cfg.appId, apiKey = cfg.apiKey, apiSecret = cfg.apiSecret;
    if (!appid || !apiKey || !apiSecret) {
      opts.onError && opts.onError({ code: 'no-config', message: '还没填写讯飞的 AppID / APIKey / APISecret' });
      return null;
    }

    var ts = Math.floor(Date.now() / 1000);
    var baseString = appid + ts;
    var md5 = md5hex(baseString);
    var signature = hmacSha1Base64(apiSecret, md5);
    var url = 'wss://iat-api.xfyun.cn/v2/iat?authorization=' +
      encodeURIComponent(hmacSha1Base64(apiSecret, md5)) +
      '&date=' + isoDate() +
      '&host=' + 'iat-api.xfyun.cn';

    // 官方签名参数：authorization = base64(hmac_sha1(apiSecret, md5(appid+ts)))
    url = 'wss://iat-api.xfyun.cn/v2/iat?authorization=' + encodeURIComponent(signature) +
      '&date=' + encodeURIComponent(isoDate()) + '&host=iat-api.xfyun.cn';

    var ws = null;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      opts.onError && opts.onError({ code: 'ws-failed', message: '无法连接讯飞服务' });
      return null;
    }

    var mediaStream = null, ctx = null, processor = null, source = null;
    var finished = false;
    var acc = '';

    ws.onopen = function () {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        mediaStream = stream;
        var AudioCtx = global.AudioContext || global.webkitAudioContext;
        ctx = new AudioCtx();
        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = function (e) {
          if (ws.readyState !== 1) return;
          var input = e.inputBuffer.getChannelData(0);
          var pcm = floatTo16BitPCM(input);
          ws.send(JSON.stringify({
            data: {
              status: 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio: bytesToBase64(pcm)
            }
          }));
        };
        source.connect(processor);
        processor.connect(ctx.destination);

        // 首帧：业务参数
        ws.send(JSON.stringify({
          common: { app_id: appid },
          business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', dwa: 'wpgs' },
          data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: '' }
        }));

        opts.onStart && opts.onStart();
      }).catch(function (err) {
        opts.onError && opts.onError({ code: 'mic-denied', message: '麦克风权限被拒绝' });
      });
    };

    ws.onmessage = function (evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.code !== 0) {
          opts.onError && opts.onError({ code: 'xunfei-' + data.code, message: '识别失败：' + (data.message || data.code) });
          return;
        }
        var wsArr = (data.data && data.data.result && data.data.result.ws) || [];
        var text = '';
        wsArr.forEach(function (w) { w.cw.forEach(function (c) { text += c.w; }); });
        acc += text;
        opts.onResult && opts.onResult({ text: acc, final: data.data.status === 2 });
        if (data.data.status === 2) cleanup();
      } catch (e) {}
    };

    ws.onerror = function () {
      opts.onError && opts.onError({ code: 'ws-error', message: '讯飞连接出错，检查 AppID 与网络' });
    };

    function cleanup() {
      if (finished) return;
      finished = true;
      try { if (processor) processor.disconnect(); } catch (e) {}
      try { if (source) source.disconnect(); } catch (e) {}
      try { if (ctx && ctx.close) ctx.close(); } catch (e) {}
      try {
        if (mediaStream) mediaStream.getTracks().forEach(function (t) { t.stop(); });
      } catch (e) {}
      try { if (ws && ws.readyState === 1) ws.close(); } catch (e) {}
      opts.onEnd && opts.onEnd();
    }

    function floatTo16BitPCM(input) {
      var bytes = [];
      for (var i = 0; i < input.length; i++) {
        var s = Math.max(-1, Math.min(1, input[i]));
        var v = s < 0 ? s * 0x8000 : s * 0x7fff;
        var lo = v & 0xff, hi = (v >> 8) & 0xff;
        bytes.push(lo, hi);
      }
      return bytes;
    }

    return { stop: cleanup, abort: cleanup };
  }

  function isoDate() {
    var d = new Date();
    // GMT 格式，例如 Mon, 19 Oct 2026 10:00:00 GMT
    return d.toUTCString();
  }

  /* ==========================================================
   * 对外接口
   * ========================================================== */
  global.Speech = {
    parse: parseSpoken,
    cnToNum: cnToNum,

    nativeSupported: nativeSupported,

    /** 当前可用方案：native / xunfei / none */
    mode: function () {
      var cfg = (Store.state.settings && Store.state.settings.asr) || {};
      var prefer = cfg.prefer || 'auto';
      if (prefer === 'native') return nativeSupported() ? 'native' : 'none';
      if (prefer === 'xunfei') {
        return (cfg.appId && cfg.apiKey && cfg.apiSecret) ? 'xunfei' : 'none';
      }
      // auto：优先本地；本地不支持但配了讯飞就用讯飞
      if (nativeSupported()) return 'native';
      if (cfg.appId && cfg.apiKey && cfg.apiSecret) return 'xunfei';
      return 'none';
    },

    /** 开始识别，返回句柄（含 stop） */
    start: function (opts) {
      opts = opts || {};
      var m = this.mode();
      if (m === 'native') return startNative(opts);
      if (m === 'xunfei') return startXunfei(opts);
      opts.onError && opts.onError({
        code: 'unavailable',
        message: nativeSupported()
          ? '语音不可用'
          : '当前浏览器不支持语音识别（安卓 Chrome 需要访问 Google 服务）。可在设置里配置讯飞语音。'
      });
      return null;
    }
  };
})(window);


