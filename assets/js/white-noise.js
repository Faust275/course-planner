/* ==========================================================
 * 模块：原生离线白噪音引擎 (Web Audio Ambient Sound Generator)
 * 采用浏览器纯原生 Web Audio API 算法合成，零外部资源依赖，完全离线运行。
 * 提供雨声、粉噪、褐噪、白噪音等多种音效及音量渐变控制。
 * ========================================================== */
(function (global) {
  'use strict';

  var SOUNDS = {
    rain: { id: 'rain', name: '淅沥雨声', desc: '轻柔雨声与低频水滴，助眠与深度阅读', icon: '🌧️' },
    pink: { id: 'pink', name: '粉红噪音', desc: '频谱均匀柔和，平衡环境杂音', icon: '🌸' },
    brown: { id: 'brown', name: '深沉褐噪', desc: '低频滚滚如远海与微风，极致专注', icon: '🌊' },
    white: { id: 'white', name: '全频白噪', desc: '全频段能量均等，遮蔽突发声响', icon: '⚡' }
  };

  var ctx = null;
  var currentSource = null;
  var gainNode = null;
  var activeType = 'rain';
  var volume = 0.5;
  var isPlaying = false;
  var bufferCache = {};
  /* 睡眠定时：到点自动淡出停止。timerMin=0 表示没开 */
  var timerMin = 0;
  var timerEnd = 0;
  var timerHandle = null;

  function clearTimer() {
    if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
    timerMin = 0;
    timerEnd = 0;
  }

  function getAudioContext() {
    var AudioCtx = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) {
      try {
        ctx = new AudioCtx();
      } catch (e) {
        return null;
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }
    return ctx;
  }

  /** 生成指定类型的无缝循环音频缓冲区（5秒，首尾淡入淡出消除卡顿） */
  function createBuffer(c, type) {
    if (bufferCache[type]) return bufferCache[type];
    var sampleRate = c.sampleRate || 44100;
    var duration = 5;
    var length = sampleRate * duration;
    var buffer = c.createBuffer(1, length, sampleRate);
    var data = buffer.getChannelData(0);

    if (type === 'white') {
      for (var i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.4;
      }
    } else if (type === 'pink') {
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (var i = 0; i < length; i++) {
        var white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    } else if (type === 'brown') {
      var lastOut = 0.0;
      for (var i = 0; i < length; i++) {
        var white = Math.random() * 2 - 1;
        lastOut = (lastOut + (0.02 * white)) / 1.02;
        data[i] = lastOut * 3.5;
      }
    } else {
      // 默认 rain：褐噪低频基底 + 粉噪水流感 + 随机轻雨滴脉冲
      var rLast = 0.0;
      var rb0 = 0, rb1 = 0;
      for (var i = 0; i < length; i++) {
        var white = Math.random() * 2 - 1;
        rLast = (rLast + (0.02 * white)) / 1.02;
        rb0 = 0.99886 * rb0 + white * 0.0555179;
        rb1 = 0.99332 * rb1 + white * 0.0750759;
        var pink = (rb0 + rb1) * 0.4;
        var drop = (Math.random() < 0.0018) ? (Math.random() * 0.5) : 0;
        data[i] = (rLast * 2.2 + pink * 0.45 + drop) * 0.35;
      }
    }

    // 首尾 0.1s 平滑交叉淡入淡出，确保循环时零爆音 (click/pop)
    var fadeLen = Math.floor(sampleRate * 0.1);
    for (var f = 0; f < fadeLen; f++) {
      var ratio = f / fadeLen;
      data[f] = data[f] * ratio + data[length - fadeLen + f] * (1 - ratio);
    }

    bufferCache[type] = buffer;
    return buffer;
  }

  var WhiteNoise = {
    SOUNDS: SOUNDS,

    play: function (type, vol) {
      if (type && SOUNDS[type]) activeType = type;
      if (typeof vol === 'number') volume = Math.max(0, Math.min(1, vol));

      var c = getAudioContext();
      if (!c) return false;

      this.stop();

      try {
        var buf = createBuffer(c, activeType);
        var src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        var gain = c.createGain();
        gain.gain.setValueAtTime(0.001, c.currentTime);
        // 0.3秒平滑淡入
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), c.currentTime + 0.3);

        src.connect(gain);
        gain.connect(c.destination);

        src.start(0);
        currentSource = src;
        gainNode = gain;
        isPlaying = true;
        this.emitChange();
        return true;
      } catch (e) {
        isPlaying = false;
        return false;
      }
    },

    stop: function () {
      clearTimer();
      if (!currentSource) {
        isPlaying = false;
        this.emitChange();
        return;
      }
      try {
        if (gainNode && ctx) {
          gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
        }
        var s = currentSource;
        currentSource = null;
        setTimeout(function () {
          try { s.stop(0); s.disconnect(); } catch (err) {}
        }, 220);
      } catch (e) {
        currentSource = null;
      }
      isPlaying = false;
      this.emitChange();
    },

    toggle: function (type, vol) {
      if (isPlaying && (!type || type === activeType)) {
        this.stop();
        return false;
      }
      return this.play(type || activeType, vol);
    },

    setVolume: function (v) {
      volume = Math.max(0, Math.min(1, v));
      if (gainNode && ctx) {
        try {
          gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
          gainNode.gain.linearRampToValueAtTime(Math.max(0.001, volume), ctx.currentTime + 0.05);
        } catch (e) {}
      }
      this.emitChange();
    },

    setType: function (type) {
      if (!SOUNDS[type]) return;
      activeType = type;
      if (isPlaying) {
        this.play(type, volume);
      } else {
        this.emitChange();
      }
    },

    /**
     * 睡眠定时（分钟）。min<=0 取消。
     * 播放中才起效——没声音就不必计时。定时到点会自动停止并通知一次。
     */
    setTimer: function (min) {
      min = Number(min) || 0;
      clearTimer();
      if (min <= 0 || !isPlaying) { this.emitChange(); return 0; }
      timerMin = min;
      timerEnd = Date.now() + min * 60000;
      timerHandle = setTimeout(function () {
        timerHandle = null;
        var m = timerMin;
        timerMin = 0; timerEnd = 0;
        WhiteNoise.stop();
        if (typeof WhiteNoise.onTimerEnd === 'function') {
          try { WhiteNoise.onTimerEnd(m); } catch (e) {}
        }
        try {
          if (global.UI && global.UI.toast) global.UI.toast('睡眠定时到了，伴音已关', 'ok');
        } catch (e) {}
      }, min * 60000);
      this.emitChange();
      return min;
    },

    timerLeft: function () {
      if (!timerEnd) return 0;
      return Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
    },
  
    state: function () {
      return {
        playing: isPlaying,
        type: activeType,
        volume: volume,
        timerMin: timerMin,
        timerLeft: this.timerLeft(),
        sound: SOUNDS[activeType] || SOUNDS.rain
      };
    },

    _listeners: [],
    onChange: function (fn) {
      if (typeof fn === 'function') this._listeners.push(fn);
    },
    emitChange: function () {
      var st = this.state();
      this._listeners.forEach(function (fn) {
        try { fn(st); } catch (e) {}
      });
    }
  };

  global.WhiteNoise = WhiteNoise;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
