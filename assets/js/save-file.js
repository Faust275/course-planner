/* ==========================================================
 * save-file.js — 统一的「保存文件」通道
 *
 * 为什么要有它：应用里有 5 处互相抄的下载实现（备份、同步、成绩单、
 * 提醒 .ics、课表 PNG），逻辑重复、参数顺序还不一致，且在 WebView /
 * iOS PWA 里 a[download] 会静默失败却仍提示「已保存」，属于假成功。
 *
 * 统一后的能力探测顺序：
 *   1. showSaveFilePicker   —— 桌面 Chrome/Edge，真存盘
 *   2. navigator.share(files) —— 手机一键发给微信/QQ/iCloud
 *   3. a[download]          —— 常规浏览器可靠；WebView/iOS PWA 静默无效
 *   4. 复制文本兜底面板      —— 弱网/WebView 唯一可靠通道
 *
 * 诚实反馈原则：下载/WebView 一律弹诚实面板告知「可能没存到」并给复制兜底 + 平台引导，
 * 不再无条件下「已保存」；原生选择框/分享被取消或无法弹出时一律回落下载 + 复制兜底，
 * 保证用户永远能拿到文件，绝不死在「已取消」。
 * ========================================================== */
(function () {
  'use strict';

  // el 被封装在 ui.js 的 IIFE 内，仅以 UI.el 形式暴露，本模块单独内联拿不到裸 el
  var el = (typeof UI !== 'undefined' && UI && UI.el) ? UI.el : null;

  function has(obj, fn) { return !!(obj && obj[fn]); }

  /** 是否运行在内嵌 WebView（微信/QQ/WorkBuddy/iOS WKWebView）—— 这里 a[download] 几乎必然静默失效 */
  function isWebView() {
    var ua = navigator.userAgent || '';
    if (/MicroMessenger/i.test(ua)) return true;
    if (/QQ\//i.test(ua)) return true;
    if (/workbuddy/i.test(ua)) return true;
    if (/\bwv\b/i.test(ua)) return true;
    // iOS 加了「添加到主屏幕」的 PWA，UA 带 Version/ 但无 Safari 字样，WKWebView 内核
    if (/iPhone|iPad|iPod/i.test(ua) && /Version\//.test(ua) && !/Safari/.test(ua)) return true;
    return false;
  }

  /** 按平台给出「没存到文件时怎么办」的引导文案 */
  function platformHint() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua))
      return '若没看到保存提示，请在 Safari 中打开本页，或用「复制内容」后在「文件」App 里新建文件粘贴保存。';
    if (/Android/i.test(ua))
      return '若没看到保存提示，请用「复制内容」后在系统「文件管理 / 下载」里新建文件粘贴保存。';
    return '若没看到保存提示，请用「复制内容」自行粘贴保存。';
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (has(navigator, 'clipboard') && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(false); });
        return;
      }
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        resolve(ok);
      } catch (e) { resolve(false); }
    });
  }

  /** 兜底面板：复制内容 + 平台引导。二进制内容不提供复制（无意义）。 */
  function copyFallbackPanel(filename, content, opts) {
    opts = opts || {};
    var isBinary = content instanceof Blob;
    var bodyParts = [];
    if (opts.panelHint) bodyParts.push(el('p', { class: 'ocr-hint', text: opts.panelHint }));
    var fileLine = '文件名「' + filename + '」' + (opts.sizeText ? '（' + opts.sizeText + '）' : '');
    bodyParts.push(el('p', { class: 'ocr-hint', text: fileLine }));

    var ta = null;
    if (!isBinary) {
      ta = document.createElement('textarea');
      ta.value = content;
      ta.readOnly = true;
      ta.style.cssText = 'width:100%;height:150px;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box;';
      bodyParts.push(ta);
    }
    bodyParts.push(el('p', { class: 'ocr-hint', text: isBinary ? '当前环境不支持直接保存图片，请用系统浏览器打开本页后再导出。' : platformHint() }));

    var copied = false;
    var m = UI.modal({
      title: opts.panelTitle || '已生成文件',
      width: opts.panelWidth || '460px',
      body: bodyParts,
      footer: el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn', text: '关闭', onclick: function () { m.close(); } }),
        isBinary ? null : el('button', {
          class: 'btn btn-primary', text: '复制内容',
          onclick: function () {
            copyText(content).then(function (ok) {
              UI.toast(ok ? '已复制，去粘贴保存' : '复制失败，请长按文本框手动复制', ok ? 'ok' : 'err');
              if (ok) copied = true;
            });
          }
        })
      ].filter(Boolean))
    });
    return { method: 'copy-fallback', ok: true, copied: function () { return copied; } };
  }

  function triggerDownload(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function toBlob(content, mime) {
    if (content instanceof Blob) return content;
    return new Blob([content], { type: (mime || 'application/json') + ';charset=utf-8' });
  }

  /**
   * 兜底保存：优先 a[download]（常规浏览器可靠），WebView/iOS PWA 静默无效则只弹
   * 复制兜底面板。无论哪种，都保证用户最终能拿到文件或内容，绝不死在「已取消」。
   * @returns {Promise<{method:string, ok:boolean}>}
   */
  function fallbackToDownload(filename, content, isBinary, blob, opts) {
    if (!isWebView()) {
      try { triggerDownload(filename, blob); } catch (e) { /* 忽略，交给面板兜底 */ }
      // 下载成功与否无从感知，弹诚实面板：复制内容 + 平台引导
      copyFallbackPanel(filename, isBinary ? blob : content,
        Object.assign({}, opts, { panelTitle: opts.panelTitle || '文件已尝试保存' }));
      return Promise.resolve({ method: 'download', ok: true });
    }
    // WebView：下载必然无效，复制兜底
    copyFallbackPanel(filename, isBinary ? blob : content, opts);
    return Promise.resolve({ method: 'copy-fallback', ok: true });
  }

  /**
   * 统一保存入口。
   * @param {string} filename 文件名（含扩展名）
   * @param {string|Blob} content 文本或二进制内容
   * @param {object} [opts] { mime, ext, panelTitle, panelHint, panelWidth, sizeText }
   * @returns {Promise<{method:string, ok:boolean, canceled?:boolean}>}
   *   method: 'picker' | 'share' | 'download' | 'copy-fallback'
   */
  function save(filename, content, opts) {
    opts = opts || {};
    var isBinary = content instanceof Blob;
    var mime = opts.mime ||
      (isBinary ? (content.type || 'application/octet-stream') : 'application/json');
    var ext = opts.ext ||
      (filename.indexOf('.') >= 0 ? filename.split('.').pop()
        : (mime.indexOf('json') >= 0 ? 'json' : 'txt'));
    var blob = toBlob(content, mime);

    // 自动化 / 无头环境（如 Playwright，navigator.webdriver 为真）里
    // showSaveFilePicker 会抛 AbortError、navigator.share 不可用，且无法弹出原生
    // 选择框。直接走 a[download] 保证行为可预期，不依赖原生弹窗；真实用户无感知。
    var automated = !!(navigator.webdriver);

    // 1) 文件系统访问 API（桌面 Chrome/Edge，真存盘，最可靠）
    //    注：file://、沙箱、非安全上下文等环境下 showSaveFilePicker 虽存在却会被浏览器
    //    「自动 Abort」，无法可靠区分是否用户主动取消。此类情况一律回落下载 + 复制兜底，
    //    保证用户始终能拿到文件，而不是卡在「已取消」。
    if (!automated && has(window, 'showSaveFilePicker')) {
      return window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'file', accept: (function () { var o = {}; o[mime] = ['.' + ext]; return o; })() }]
      }).then(function (h) {
        return h.createWritable().then(function (w) {
          return w.write(blob).then(function () { return w.close(); });
        });
      }).then(function () { return { method: 'picker', ok: true }; })
        .catch(function () { return fallbackToDownload(filename, content, isBinary, blob, opts); });
    }

    // 2) Web Share（带文件，手机一键发给微信/QQ/iCloud）
    var file = null;
    try { file = new File([blob], filename, { type: mime }); } catch (e) {}
    if (!automated && file && has(navigator, 'canShare') && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: filename, text: opts.shareText || filename })
        .then(function () { return { method: 'share', ok: true }; })
        // 分享被取消 / 不可用：回落兜底（复制面板），不报告「已取消」死路
        .catch(function () { return fallbackToDownload(filename, content, isBinary, blob, opts); });
    }

    // 3) 下载 / 4) WebView 兜底
    return fallbackToDownload(filename, content, isBinary, blob, opts);
  }

  // 暴露到全局
  window.SaveFile = {
    save: save,
    isWebView: isWebView,
    copyText: copyText
  };
})();
