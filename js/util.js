/* ═══════════════════════════════════════════
   util.js — 基础工具、Toast、底部面板
   ═══════════════════════════════════════════ */
window.MY = window.MY || {};

(function (A) {
  'use strict';

  A.$ = (sel, root) => (root || document).querySelector(sel);
  A.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  A.el = function (tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  let seq = 0;
  A.uid = function (p) {
    seq = (seq + 1) % 100000;
    return (p || 'id') + '_' + Date.now().toString(36) + '_' + seq.toString(36) + Math.random().toString(36).slice(2, 6);
  };

  A.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  A.lerp = (a, b, t) => a + (b - a) * t;
  A.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  A.round = (v, n) => { const m = Math.pow(10, n || 0); return Math.round(v * m) / m; };

  A.now = () => Date.now();

  A.fmtAgo = function (ts) {
    const d = Date.now() - ts;
    const min = 60000, hr = 3600000, day = 86400000;
    if (d < min) return '刚刚';
    if (d < hr) return Math.floor(d / min) + ' 分钟前';
    if (d < day) return Math.floor(d / hr) + ' 小时前';
    if (d < day * 2) return '昨天';
    if (d < day * 7) return Math.floor(d / day) + ' 天前';
    const dt = new Date(ts);
    return (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日';
  };

  A.fmtFull = function (ts) {
    const d = new Date(ts);
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  A.debounce = function (fn, ms) {
    let t = 0;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  };

  A.throttle = function (fn, ms) {
    let last = 0, timer = 0, lastArgs = null;
    return function () {
      const now = Date.now(), self = this;
      lastArgs = arguments;
      if (now - last >= ms) {
        last = now;
        fn.apply(self, lastArgs);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = 0; last = Date.now();
          fn.apply(self, lastArgs);
        }, ms - (now - last));
      }
    };
  };

  /* ───────── Toast ───────── */
  let toastTimer = 0;
  A.toast = function (msg, ms) {
    const t = A.$('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), ms || 1900);
  };

  /* ───────── Sheet 底部面板 ───────── */
  const Sheet = {
    _onClose: null,
    open(opts) {
      const sheet = A.$('#sheet'), body = A.$('#sheetBody'), scrim = A.$('#sheetScrim');
      if (!sheet) return;
      sheet.classList.toggle('is-wide', !!opts.wide);
      body.innerHTML = '';
      if (opts.title != null) {
        const head = A.el('div', 'sheet-title');
        head.innerHTML = '<h3>' + opts.title + '</h3>' + (opts.sub ? '<span class="sub">' + opts.sub + '</span>' : '');
        body.appendChild(head);
      }
      if (opts.node) body.appendChild(opts.node);
      if (opts.html) {
        const wrap = A.el('div');
        wrap.innerHTML = opts.html;
        body.appendChild(wrap);
      }
      scrim.classList.toggle('is-light', !!opts.dimLight);
      this._onClose = opts.onClose || null;
      scrim.classList.add('is-on');
      sheet.classList.add('is-on');
      this._locked = !!opts.locked;
      if (opts.onMount) requestAnimationFrame(() => opts.onMount(body, this));
      return { body: body, close: () => this.close() };
    },
    close() {
      const sheet = A.$('#sheet'), scrim = A.$('#sheetScrim');
      if (!sheet) return;
      sheet.classList.remove('is-on');
      scrim.classList.remove('is-on');
      const cb = this._onClose; this._onClose = null;
      if (cb) setTimeout(cb, 260);
    },
    isOpen() {
      const sheet = A.$('#sheet');
      return !!(sheet && sheet.classList.contains('is-on'));
    },
    isLocked() { return !!this._locked; }
  };
  A.sheet = Sheet;

  /* ───────── 打开外部链接 ───────── */
  A.openUrl = function (url) {
    if (!url) return;
    const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.moyuOpen;
    if (bridge) {
      try { bridge.postMessage({ url }); return; } catch (e) { }
    }
    try {
      const w = window.open(url, '_blank');
      if (w) return;
    } catch (e) { }
    // 弹窗被拦截时用临时 <a target="_blank"> 兜底，
    // 千万不要退回 location.href —— 那会把笔记应用本身导航走
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { a.remove(); } catch (e) { } }, 0);
    } catch (e) { }
  };

  /* ───────── 文件 ───────── */
  A.download = function (blob, filename) {
    // iOS 原生壳：走系统分享面板（存到「文件」、发邮件等）
    const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.moyuSave;
    if (bridge) {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result || '');
        const i = s.indexOf(',');
        const b64 = i >= 0 ? s.slice(i + 1) : '';
        try { bridge.postMessage({ name: filename, data: b64 }); } catch (e) { }
      };
      fr.onerror = () => A.toast('文件读取失败');
      fr.readAsDataURL(blob);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
  };

  A.readText = function (file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => rej(fr.error);
      fr.readAsText(file, 'utf-8');
    });
  };

  A.readDataURL = function (file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result || ''));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  };

  A.loadImage = function (src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('image load failed'));
      img.src = src;
    });
  };

  /* ───────── 忙碌遮罩 ───────── */
  A.busy = function (text) {
    let b = A.$('#busyMask');
    if (!b) {
      b = A.el('div', 'busy');
      b.id = 'busyMask';
      b.innerHTML = '<div class="busy-card"><div class="spinner"></div><p></p></div>';
      document.body.appendChild(b);
    }
    if (text === false) { b.classList.remove('is-on'); return; }
    b.querySelector('p').textContent = text || '处理中…';
    b.classList.add('is-on');
  };

  A.haptic = function (ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { }
  };

  /* 指针事件归一 */
  A.pt = function (e) {
    return { x: e.clientX, y: e.clientY, p: (typeof e.pressure === 'number' && e.pressure > 0) ? e.pressure : 0.5, type: e.pointerType };
  };
})(window.MY);
