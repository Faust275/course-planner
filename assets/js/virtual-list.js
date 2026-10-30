/* ==========================================================
 * VirtualList 通用视口虚拟滚动组件 (virtual-list.js)
 * ========================================================== */
(function (global) {
  'use strict';

  var DEFAULT_ITEM_HEIGHT = 68;
  var OVERSCAN = 4;
  var VIRTUAL_THRESHOLD = 20;

  function VirtualList(opts) {
    this.opts = opts || {};
    this.container = opts.container;
    this.items = opts.items || [];
    this.itemHeight = Number(opts.itemHeight) || DEFAULT_ITEM_HEIGHT;
    this.overscan = Number(opts.overscan) || OVERSCAN;
    this.threshold = Number(opts.threshold) || VIRTUAL_THRESHOLD;
    this.renderItem = opts.renderItem || function () { return document.createElement('div'); };
    this.onMount = opts.onMount || null;

    this.spacer = null;
    this.pool = null;
    this.rafId = null;
    this.lastStart = -1;
    this.lastEnd = -1;
    this._boundOnScroll = this._onScroll.bind(this);

    this.init();
  }

  VirtualList.prototype.init = function () {
    if (!this.container) return;

    if (this.items.length <= this.threshold) {
      this._renderFull();
      return;
    }

    this.container.innerHTML = '';
    var cs = window.getComputedStyle ? window.getComputedStyle(this.container) : null;
    if (cs && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && this.container.tagName !== 'BODY') {
      this.container.style.overflowY = 'auto';
      if (!this.container.style.maxHeight && !this.container.style.height) {
        this.container.style.maxHeight = '72vh';
      }
    }

    this.spacer = document.createElement('div');
    this.spacer.className = 'cp-virtual-spacer';
    this.spacer.style.position = 'relative';
    this.spacer.style.width = '100%';
    this.spacer.style.minHeight = '100%';
    this.spacer.style.overflow = 'hidden';

    this.pool = document.createElement('div');
    this.pool.className = 'cp-virtual-pool';
    this.pool.style.position = 'absolute';
    this.pool.style.top = '0px';
    this.pool.style.left = '0px';
    this.pool.style.width = '100%';
    this.pool.style.willChange = 'transform';

    this.spacer.appendChild(this.pool);
    this.container.appendChild(this.spacer);

    this.container.addEventListener('scroll', this._boundOnScroll, { passive: true });
    window.addEventListener('scroll', this._boundOnScroll, { passive: true });

    this.update(this.items);

    var self = this;
    setTimeout(function () {
      if (self.pool && self.container && self.container.isConnected) {
        self._renderChunk();
      }
    }, 16);
  };

  VirtualList.prototype._renderFull = function () {
    this.container.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < this.items.length; i++) {
      var node = this.renderItem(this.items[i], i);
      if (node) frag.appendChild(node);
    }
    this.container.appendChild(frag);
    if (this.onMount) this.onMount(this.container);
  };

  VirtualList.prototype._onScroll = function () {
    if (this.rafId) return;
    var self = this;
    this.rafId = requestAnimationFrame(function () {
      self.rafId = null;
      self._renderChunk();
    });
  };

  VirtualList.prototype._getScrollTop = function () {
    if (this.container && this.container.scrollTop > 0) {
      return this.container.scrollTop;
    }
    return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  };

  VirtualList.prototype._getViewportHeight = function () {
    var h = 0;
    if (this.container && this.container.clientHeight > 0) {
      h = this.container.clientHeight;
    } else if (window.innerHeight > 0) {
      h = window.innerHeight;
    } else if (document.documentElement && document.documentElement.clientHeight > 0) {
      h = document.documentElement.clientHeight;
    }
    return h > 0 ? h : 600;
  };

  VirtualList.prototype._renderChunk = function () {
    if (!this.pool || !this.spacer) return;

    var total = this.items.length;
    var totalHeight = total * this.itemHeight;
    this.spacer.style.height = totalHeight + 'px';

    var scrollTop = this._getScrollTop();
    var viewH = this._getViewportHeight();

    var rawStart = Math.floor(scrollTop / this.itemHeight);
    var visibleCount = Math.ceil(viewH / this.itemHeight);

    var start = Math.max(0, rawStart - this.overscan);
    var end = Math.min(total, rawStart + visibleCount + this.overscan);

    if (start === this.lastStart && end === this.lastEnd) return;

    this.lastStart = start;
    this.lastEnd = end;

    var offsetY = start * this.itemHeight;
    this.pool.style.transform = 'translate3d(0px,' + offsetY + 'px,0px)';
    this.pool.innerHTML = '';

    var frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) {
      var itemNode = this.renderItem(this.items[i], i);
      if (itemNode) frag.appendChild(itemNode);
    }
    this.pool.appendChild(frag);

    if (this.onMount) this.onMount(this.pool);
  };

  VirtualList.prototype.update = function (newItems) {
    this.items = Array.isArray(newItems) ? newItems : [];
    if (this.items.length <= this.threshold) {
      this.container.removeEventListener('scroll', this._boundOnScroll);
      window.removeEventListener('scroll', this._boundOnScroll);
      this.spacer = null;
      this.pool = null;
      this._renderFull();
      return;
    }

    this.lastStart = -1;
    this.lastEnd = -1;
    this._renderChunk();
  };

  VirtualList.prototype.destroy = function () {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.container) {
      this.container.removeEventListener('scroll', this._boundOnScroll);
      this.container.innerHTML = '';
    }
    window.removeEventListener('scroll', this._boundOnScroll);
    this.spacer = null;
    this.pool = null;
    this.items = [];
  };

  VirtualList.mount = function (container, opts) {
    opts = opts || {};
    opts.container = container;
    return new VirtualList(opts);
  };

  global.VirtualList = VirtualList;
  if (global.UI) global.UI.VirtualList = VirtualList;
  if (global.CP && global.CP.register) global.CP.register('VirtualList', VirtualList);
})(typeof window !== 'undefined' ? window : globalThis);
