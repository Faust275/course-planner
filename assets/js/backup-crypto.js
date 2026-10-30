/* ==========================================================
 * 备份加密（可选）
 * ----------------------------------------------------------
 * 导出时用密码派生密钥（PBKDF2-SHA256, 12 万次）加密整份 JSON，
 * 算法 AES-GCM 256；文件头 CPENC1: 用来识别。
 * 只在安全上下文（App / https / localhost）可用；file:// 下禁用并提示。
 * ========================================================== */
(function (global) {
  'use strict';

  var MAGIC = 'CPENC1:';
  var subtle = (global.crypto && global.crypto.subtle) || null;

  function b64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return global.btoa(s);
  }

  function unb64(str) {
    var s = global.atob(str), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  async function deriveKey(pw, salt) {
    var base = await subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(text, password) {
    if (!subtle) throw new Error('当前环境不支持加密（需要 App 内或 https 打开）');
    if (!password || String(password).length < 6) throw new Error('密码至少 6 位');
    var salt = global.crypto.getRandomValues(new Uint8Array(16));
    var iv = global.crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveKey(String(password), salt);
    var data = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
    return MAGIC + JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) });
  }

  async function decrypt(payload, password) {
    if (!subtle) throw new Error('当前环境不支持解密');
    var raw = String(payload || '');
    if (raw.indexOf(MAGIC) !== 0) throw new Error('不是加密备份');
    var obj = JSON.parse(raw.slice(MAGIC.length));
    var key = await deriveKey(String(password), unb64(obj.salt));
    var buf = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.data));
    return new TextDecoder().decode(buf);
  }

  function isEncrypted(text) {
    return String(text || '').indexOf(MAGIC) === 0;
  }

  global.BackupCrypto = {
    supported: !!subtle,
    isEncrypted: isEncrypted,
    encrypt: encrypt,
    decrypt: decrypt
  };
})(typeof window !== 'undefined' ? window : globalThis);
