/* ══════════════════════════════════════════════════════════
   studio.js — 编辑器
   页面模型 / 视图变换 / 指针手势 / 工具 / 撤销 / 导出
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  /* ───────────── 常量 ───────────── */
  const COLORS = ['#1c1c1e', '#6b6b73', '#b23a2f', '#e8543f', '#e8a33d', '#d8c93a',
    '#3f9e52', '#2f9e9e', '#2f6fc9', '#6a4fb3', '#c95a9a', '#ffffff'];

  const PAPERS = [
    { id: 'blank', name: '空白', sub: '纯手写' },
    { id: 'lined', name: '横线', sub: '28px' },
    { id: 'grid', name: '方格', sub: '28px' },
    { id: 'dot', name: '点阵', sub: '28px' },
    { id: 'cornell', name: '康奈尔', sub: '分区' },
    { id: 'music', name: '五线谱', sub: '谱纸' }
  ];

  const PAGE_PRESETS = [
    { id: 'a4p', name: 'A4 竖', w: 794, h: 1123 },
    { id: 'a4l', name: 'A4 横', w: 1123, h: 794 },
    { id: 'ipad', name: 'iPad 横', w: 1180, h: 820 },
    { id: 'html', name: '网页', w: 1024, h: 1448 }
  ];

  const HTML_PAGE_W = 1024;
  const HTML_SLICE_H = 1448;

  /* ───────────── 状态 ───────────── */
  const S = {
    book: null,
    pages: [],
    idx: 0,
    page: null,
    view: { scale: 1, x: 0, y: 0 },
    tool: 'pen',
    color: '#1c1c1e',
    size: 4,
    kind: 'fountain',
    shape: 'rect',
    eraserMode: 'pixel',
    penSeen: false,
    penOnly: true,
    pointers: new Map(),
    mode: null,
    stroke: null,
    drawId: null,
    gesture: null,
    sel: null,
    dragSel: null,
    undo: [],
    redo: [],
    srcCache: new Map(),
    quality: 2,
    htmlVisible: true,
    ready: false
  };

  const D = {};
  let saveTimer = 0, heightTimer = 0, zoomTimer = 0;

  /* ───────────── DOM ───────────── */
  function cacheDom() {
    D.viewLib = A.$('#viewLibrary');
    D.viewStu = A.$('#viewStudio');
    D.stage = A.$('#stage');
    D.pageEl = A.$('#pageEl');
    D.paperCv = A.$('#paperCanvas');
    D.baseCv = A.$('#inkBase');
    D.liveCv = A.$('#inkLive');
    D.htmlWrap = A.$('#htmlWrap');
    D.frame = A.$('#htmlFrame');
    D.selSvg = A.$('#selSvg');
    D.textLayer = A.$('#textLayer');
    D.imgLayer = A.$('#imgLayer');
    D.dock = A.$('#dock');
    D.dockPanel = A.$('#dockPanel');
    D.palette = A.$('#palette');
    D.sizeRange = A.$('#sizeRange');
    D.sizePrev = A.$('#sizePreview');
    D.docTitle = A.$('#docTitle');
    D.pageIndicator = A.$('#pageIndicator');
    D.ctxFloat = A.$('#ctxFloat');
    D.hint = A.$('#stageHint');
    D.toolRow = A.$('#toolRow');
  }

  /* ═════════════ 页面构造 ═════════════ */

  function blankPage(bookId, order, preset) {
    const p = preset || PAGE_PRESETS[0];
    return {
      id: A.uid('pg'),
      bookId: bookId,
      order: order,
      type: 'blank',
      w: p.w, h: p.h,
      preset: p.id,
      paper: 'lined',
      paperColor: '#ffffff',
      strokes: [],
      texts: [],
      images: []
    };
  }

  function htmlPage(bookId, order, srcKey, sliceTop, sliceH, totalH) {
    return {
      id: A.uid('pg'),
      bookId: bookId,
      order: order,
      type: 'html',
      w: HTML_PAGE_W,
      h: sliceH || HTML_SLICE_H,
      srcKey: srcKey,
      sliceTop: sliceTop || 0,
      docH: totalH || 0,
      paper: 'blank',
      paperColor: '#ffffff',
      strokes: [],
      texts: [],
      images: []
    };
  }

  /* ═════════════ 打开书籍 ═════════════ */

  async function openBook(id) {
    await A.dbReady;
    const book = await A.db.getBook(id);
    if (!book) { A.toast('笔记不存在'); return; }
    const pages = await A.db.pagesOf(id);
    if (!pages.length) {
      const p = blankPage(id, 0);
      await A.db.savePage(p);
      pages.push(p);
    }
    S.book = book;
    S.pages = pages;
    S.idx = 0;
    S.undo.length = 0;
    S.redo.length = 0;
    S.srcCache.clear();
    S.view = { scale: 1, x: 0, y: 0 };
    S.sel = null;
    S.ready = false;
    D.curSrcKey = null;
    D.frameMounted = false;

    D.viewLib.classList.remove('is-active');
    D.viewStu.classList.add('is-active');
    document.body.classList.add('in-studio');

    D.docTitle.value = book.name || '未命名';
    await loadPage(0, true);
    requestAnimationFrame(() => {
      fitWidth();
      S.ready = true;
      const tip = S.pages.length > 1
        ? '双指缩放 · 两指拖动移动画面 · 两侧箭头翻页'
        : '双指缩放 · 两指拖动移动画面';
      setTimeout(() => showHint(tip, 3400), 500);
    });
  }

  async function closeBook() {
    await persistPage(true);
    D.viewStu.classList.remove('is-active');
    D.viewLib.classList.add('is-active');
    document.body.classList.remove('in-studio');
    A.HtmlPage.clear(D.frame);
    D.curSrcKey = null; D.frameMounted = false;
    S.book = null; S.page = null; S.pages = [];
    await A.Library.refresh();
  }

  function currentSrc() {
    const p = S.page;
    if (!p || p.type !== 'html') return '';
    return S.srcCache.get(p.srcKey) || '';
  }

  async function loadPage(idx, first) {
    if (!S.pages.length) return;
    idx = A.clamp(idx, 0, S.pages.length - 1);
    if (!first && S.page) {
      await persistPage(true);
    }
    S.idx = idx;
    const p = S.pages[idx];
    S.page = p;
    S.sel = null;
    hideCtxFloat();
    S.undo.length = 0;
    S.redo.length = 0;
    updatePageIndicator();

    if (p.type === 'html' && p.srcKey && !S.srcCache.has(p.srcKey)) {
      const src = await A.db.getAsset(p.srcKey);
      S.srcCache.set(p.srcKey, src || '');
    }

    await renderPage();
    fitWidth(true);
  }

  function updatePageIndicator() {
    if (D.pageIndicator) D.pageIndicator.textContent = (S.idx + 1) + ' / ' + S.pages.length;
    const prev = A.$('#btnPrevPage'), next = A.$('#btnNextPage');
    if (prev) prev.classList.toggle('is-on', S.idx > 0);
    if (next) next.classList.toggle('is-on', S.idx < S.pages.length - 1);
    updateUndoButtons();
  }

  /* ═════════════ 渲染页面 ═════════════ */

  async function renderPage() {
    const p = S.page;
    if (!p) return;
    p.strokes = p.strokes || [];
    p.texts = p.texts || [];
    p.images = p.images || [];

    D.textLayer.innerHTML = '';
    D.imgLayer.innerHTML = '';
    D.selSvg.innerHTML = '';

    resizeCanvases();

    if (p.type === 'html') {
      D.htmlWrap.style.display = 'block';
      D.htmlWrap.classList.toggle('is-hidden', !S.htmlVisible);
      D.frame.style.width = p.w + 'px';
      D.frame.style.height = p.h + 'px';
      const src = currentSrc();
      // 同一份文档只是换了分片 → 只推偏移，翻页瞬间完成
      if (src && D.curSrcKey === p.srcKey && D.frameMounted) {
        try {
          D.frame.contentWindow.postMessage({ __moyu_offset: p.sliceTop || 0 }, '*');
        } catch (err) { }
      } else {
        A.HtmlPage.mount(D.frame, src, {
          offsetY: p.sliceTop || 0,
          onHeight: (h) => onHtmlHeight(h),
          onLink: (href) => {
            if (/^https?:/i.test(href)) A.toast('外部链接已拦截：' + href.slice(0, 42));
            else if (href === 'form') A.toast('表单提交已禁用');
          }
        });
        D.curSrcKey = p.srcKey;
        D.frameMounted = !!src;
      }
    } else {
      D.htmlWrap.style.display = 'none';
      if (D.frameMounted) {
        A.HtmlPage.clear(D.frame);
        D.curSrcKey = null;
        D.frameMounted = false;
      }
    }

    renderTexts();
    renderImages();
    updateHtmlEye();
    syncToolUI();
  }

  function onHtmlHeight(h) {
    const p = S.page;
    if (!p || p.type !== 'html') return;
    if (!p.docH) return;
    // 内容高度与导入时差异较大 → 提示可重新分页
    if (h > p.docH + 40) {
      p._grew = true;
    }
  }

  function pageSize() {
    const p = S.page;
    return { w: (p && p.w) || 794, h: (p && p.h) || 1123 };
  }

  function qualityFor(w, h) {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const z = A.clamp(S.view.scale, 1, 1.7);
    const area = w * h;
    // 面积越大，质量倍数越低，控制内存（iPad 上三层画布很吃内存）
    let q = dpr * z;
    const maxArea = 6.5e6;
    if (area * q * q > maxArea) q = Math.sqrt(maxArea / area);
    return A.clamp(q, 1, 3);
  }

  function resizeCanvases() {
    const { w, h } = pageSize();
    const q = qualityFor(w, h);
    S.quality = q;
    D.pageEl.style.width = w + 'px';
    D.pageEl.style.height = h + 'px';
    [D.paperCv, D.baseCv, D.liveCv].forEach(cv => {
      cv.width = Math.max(1, Math.round(w * q));
      cv.height = Math.max(1, Math.round(h * q));
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    });
    D.selSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    D.selSvg.style.width = w + 'px';
    D.selSvg.style.height = h + 'px';
    paintPaper();
    repaintInk();
  }

  /* ───────────── 纸张 ───────────── */
  function paintPaper() {
    const p = S.page;
    const cv = D.paperCv;
    const g = cv.getContext('2d');
    const { w, h } = pageSize();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(S.quality, 0, 0, S.quality, 0, 0);
    g.fillStyle = (p && p.paperColor) || '#ffffff';
    g.fillRect(0, 0, w, h);
    if (!p) return;
    const type = p.paper || 'blank';
    const step = 28;
    const lc = 'rgba(70,90,130,.18)';
    g.lineWidth = 1;
    if (type === 'lined') {
      g.strokeStyle = lc;
      for (let y = step * 3; y < h; y += step) {
        g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke();
      }
      g.strokeStyle = 'rgba(200,80,80,.28)';
      g.beginPath(); g.moveTo(56, 0); g.lineTo(56, h); g.stroke();
    } else if (type === 'grid') {
      g.strokeStyle = 'rgba(70,90,130,.13)';
      for (let x = 0; x < w; x += step) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, h); g.stroke(); }
      for (let y = 0; y < h; y += step) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke(); }
    } else if (type === 'dot') {
      g.fillStyle = 'rgba(70,90,130,.30)';
      for (let x = step; x < w; x += step) {
        for (let y = step; y < h; y += step) {
          g.beginPath(); g.arc(x, y, 1.1, 0, Math.PI * 2); g.fill();
        }
      }
    } else if (type === 'cornell') {
      g.strokeStyle = 'rgba(200,80,80,.30)';
      g.beginPath(); g.moveTo(w * 0.28, 0); g.lineTo(w * 0.28, h * 0.78); g.stroke();
      g.beginPath(); g.moveTo(0, h * 0.78); g.lineTo(w, h * 0.78); g.stroke();
      g.strokeStyle = lc;
      for (let y = step * 3; y < h * 0.75; y += step) {
        g.beginPath(); g.moveTo(w * 0.29, y + .5); g.lineTo(w, y + .5); g.stroke();
      }
    } else if (type === 'music') {
      g.strokeStyle = 'rgba(70,90,130,.28)';
      for (let base = 90; base < h; base += 120) {
        for (let i = 0; i < 5; i++) {
          const y = base + i * 12;
          g.beginPath(); g.moveTo(36, y + .5); g.lineTo(w - 36, y + .5); g.stroke();
        }
      }
    }
  }

  function repaintInk() {
    const cv = D.baseCv;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(S.quality, 0, 0, S.quality, 0, 0);
    if (S.page) A.Ink.drawAll(g, S.page.strokes || []);
  }

  function clearLive() {
    const g = D.liveCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, D.liveCv.width, D.liveCv.height);
    g.setTransform(S.quality, 0, 0, S.quality, 0, 0);
  }

  /* ═════════════ 视图 ═════════════ */

  function applyView() {
    const v = S.view;
    D.pageEl.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.scale + ')';
    const zv = A.$('#btnZoomReset');
    if (zv) zv.textContent = Math.round(v.scale * 100) + '%';
  }

  function stageRect() { return D.stage.getBoundingClientRect(); }

  function fitWidth(instant) {
    const { w } = pageSize();
    const r = stageRect();
    const pad = 34;
    const s = A.clamp((r.width - pad * 2) / w, 0.2, 3);
    S.view.scale = s;
    S.view.x = (r.width - w * s) / 2;
    S.view.y = pad;
    applyView();
    scheduleQuality();
  }

  function fitPage() {
    const { w, h } = pageSize();
    const r = stageRect();
    const pad = 30;
    const s = A.clamp(Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h), 0.15, 3);
    S.view.scale = s;
    S.view.x = (r.width - w * s) / 2;
    S.view.y = Math.max(pad, (r.height - h * s) / 2);
    applyView();
    scheduleQuality();
  }

  function zoomAt(cx, cy, factor) {
    const r = stageRect();
    const px = (cx - r.left - S.view.x) / S.view.scale;
    const py = (cy - r.top - S.view.y) / S.view.scale;
    const ns = A.clamp(S.view.scale * factor, 0.15, 6);
    S.view.scale = ns;
    S.view.x = (cx - r.left) - px * ns;
    S.view.y = (cy - r.top) - py * ns;
    applyView();
    clampView();
    scheduleQuality();
  }

  function scheduleQuality() {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      const { w, h } = pageSize();
      const q = qualityFor(w, h);
      if (Math.abs(q - S.quality) > 0.34) {
        resizeCanvases();
      }
    }, 320);
  }

  function toPage(clientX, clientY) {
    const r = D.pageEl.getBoundingClientRect();
    return {
      x: (clientX - r.left) / S.view.scale,
      y: (clientY - r.top) / S.view.scale
    };
  }

  /* 别让纸被拖丢 */
  function clampView() {
    const { w, h } = pageSize();
    const r = stageRect();
    const s = S.view.scale;
    const pw = w * s, ph = h * s;
    const mx = Math.min(150, pw * 0.6);
    const my = Math.min(150, ph * 0.6);
    S.view.x = A.clamp(S.view.x, -(pw - mx), Math.max(-(pw - mx), r.width - mx));
    S.view.y = A.clamp(S.view.y, -(ph - my), Math.max(-(ph - my), r.height - my));
    applyView();
  }

  /* ═════════════ 工具与属性 ═════════════ */

  function setTool(t) {
    if (t === S.tool && t !== 'image' && t !== 'text') {
      // 再点一次已选中的工具：收起/展开笔刷设置
      if (A.sheet.isOpen()) A.sheet.close();
      else openToolOptions(t);
      return;
    }
    S.tool = t;
    // 荧光笔默认用高亮黄，避免深色画出来一片灰
    if (t === 'marker' && (S.color === '#1c1c1e' || S.color === '#6b6b73')) {
      setColor('#f2c14e');
    }
    A.$$('.tool', D.toolRow).forEach(b => {
      b.classList.toggle('is-on', b.dataset.tool === t);
    });
    D.pageEl.classList.toggle('mode-browse', t === 'hand');
    cancelSelection();
    if (t === 'image') {
      A.$('#fileImage').click();
      S.tool = 'pen';
      syncToolUI();
      return;
    }
    if (t === 'text') {
      showHint('点击页面任意位置放置文字');
    }
    syncToolUI();
  }

  function syncToolUI() {
    A.$$('.tool', D.toolRow).forEach(b => {
      b.classList.toggle('is-on', b.dataset.tool === S.tool);
    });
    D.pageEl.classList.toggle('mode-browse', S.tool === 'hand');
    if (D.textLayer) D.textLayer.style.pointerEvents = S.tool === 'text' ? 'auto' : 'none';
    if (D.imgLayer) D.imgLayer.style.pointerEvents = (S.tool === 'lasso' || S.tool === 'image') ? 'auto' : 'none';
  }

  function setColor(c) {
    S.color = c;
    A.$$('.swatch', D.palette).forEach(b => b.classList.toggle('is-on', b.dataset.color === c));
    const ci = A.$('#colorInput');
    if (ci && /^#[0-9a-f]{6}$/i.test(c)) ci.value = c;
    drawSizePreview();
    if (S.sel && S.sel.strokes.length) {
      S.sel.strokes.forEach(s => { s.color = c; s.tool = S.tool === 'marker' ? 'marker' : (S.tool === 'eraser' ? 'pen' : s.tool); });
      repaintInk();
      markDirty();
    }
  }

  function setSize(v) {
    S.size = v;
    D.sizeRange.value = v;
    drawSizePreview();
  }

  function drawSizePreview() {
    const cv = D.sizePrev;
    if (!cv) return;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = S.color;
    const r = A.clamp(S.size * 1.1, 1.2, 11);
    g.beginPath();
    g.arc(cv.width / 2, cv.height / 2, r, 0, Math.PI * 2);
    g.fill();
    if (S.color === '#ffffff') {
      g.strokeStyle = 'rgba(255,255,255,.4)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(cv.width / 2, cv.height / 2, r, 0, Math.PI * 2); g.stroke();
    }
  }

  function buildPalette() {
    D.palette.innerHTML = '';
    COLORS.forEach(c => {
      const b = A.el('button', 'swatch');
      b.style.background = c;
      b.dataset.color = c;
      if (c === S.color) b.classList.add('is-on');
      b.addEventListener('click', () => setColor(c));
      D.palette.appendChild(b);
    });
  }

  function openToolOptions(t) {
    if (t === 'eraser') {
      const node = A.el('div');
      node.innerHTML = '<div class="opt-grid">' +
        '<button class="opt' + (S.eraserMode === 'pixel' ? ' is-on' : '') + '" data-m="pixel">擦除部分<span class="opt-sub">像真实橡皮</span></button>' +
        '<button class="opt' + (S.eraserMode === 'stroke' ? ' is-on' : '') + '" data-m="stroke">整笔删除<span class="opt-sub">点到即消失</span></button>' +
        '</div>';
      A.sheet.open({
        title: '橡皮', node,
        onMount: (body, sh) => {
          A.$$('.opt', body).forEach(b => b.addEventListener('click', () => {
            S.eraserMode = b.dataset.m; sh.close();
            A.toast(S.eraserMode === 'pixel' ? '橡皮：擦除部分' : '橡皮：整笔删除');
          }));
        }
      });
    } else if (t === 'shape') {
      const node = A.el('div');
      const items = [['rect', '矩形'], ['ellipse', '椭圆'], ['line', '直线'], ['arrow', '箭头']];
      node.innerHTML = '<div class="opt-grid">' + items.map(i =>
        '<button class="opt' + (S.shape === i[0] ? ' is-on' : '') + '" data-s="' + i[0] + '">' + i[1] + '</button>'
      ).join('') + '</div>';
      A.sheet.open({
        title: '形状', node,
        onMount: (body, sh) => {
          A.$$('.opt', body).forEach(b => b.addEventListener('click', () => {
            S.shape = b.dataset.s; sh.close();
          }));
        }
      });
    } else if (t === 'pen' || t === 'marker') {
      A.sheet.open({ title: '笔刷', node: buildKindNode() });
    }
  }

  function buildKindNode() {
    const node = A.el('div');
    const kinds = [['fountain', '粗细变化', '压感最明显'], ['ball', '均匀', '线条恒定'], ['pencil', '铅笔', '轻微颗粒']];
    node.innerHTML = '<div class="opt-grid">' + kinds.map(k =>
      '<button class="opt' + (S.kind === k[0] ? ' is-on' : '') + '" data-k="' + k[0] + '">' + k[1] + '<span class="opt-sub">' + k[2] + '</span></button>'
    ).join('') + '</div>';
    A.$$('.opt', node).forEach(b => b.addEventListener('click', () => {
      S.kind = b.dataset.k;
      A.$$('.opt', node).forEach(x => x.classList.toggle('is-on', x === b));
      A.$$('#penKinds .chip').forEach(x => x.classList.toggle('is-on', x.dataset.kind === S.kind));
    }));
    return node;
  }

  function showHint(text, ms) {
    if (!D.hint) return;
    D.hint.textContent = text;
    D.hint.classList.add('is-on');
    clearTimeout(showHint._t);
    showHint._t = setTimeout(() => D.hint.classList.remove('is-on'), ms || 2200);
  }

  /* ═════════════ 指针 / 手势 ═════════════ */

  function isTouchPan(e) {
    return e.pointerType === 'touch' && S.penOnly && S.penSeen;
  }

  function onPointerDown(e) {
    if (e.button != null && e.button > 0 && e.pointerType === 'mouse') return;
    if (A.sheet.isOpen()) return;
    // 划在按钮/浮动控件上时不要抢事件（pointer capture 会吃掉 click）
    if (e.target && e.target.closest && e.target.closest('button,.page-nav,.ctx-float,.stage-hint')) return;
    const st = D.stage;
    try { st.setPointerCapture(e.pointerId); } catch (err) { }

    S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (e.pointerType === 'pen') S.penSeen = true;

    // 两指 → 手势
    if (S.pointers.size === 2) {
      beginGesture();
      return;
    }
    if (S.pointers.size > 2) return;

    const inside = isInsidePage(e.clientX, e.clientY);
    const pt = toPage(e.clientX, e.clientY);

    // 浏览模式
    if (S.tool === 'hand') {
      S.mode = 'pan';
      S.panStart = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y };
      return;
    }

    if (!inside) {
      S.mode = 'pan';
      S.panStart = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y };
      return;
    }

    // 手指平移
    if (isTouchPan(e)) {
      S.mode = 'pan';
      S.panStart = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y };
      return;
    }

    // 若已有选择框且点在框内 → 拖动选择
    if (S.sel && S.sel.bbox && insideBBox(S.sel.bbox, pt)) {
      S.mode = 'moveSel';
      S.dragSel = { id: e.pointerId, last: pt, moved: false, acc: { x: 0, y: 0 } };
      return;
    }

    S.drawId = e.pointerId;

    const t = S.tool;
    if (t === 'pen' || t === 'marker') {
      startStroke(pt, e.pressure);
    } else if (t === 'eraser') {
      if (S.eraserMode === 'stroke') startStrokeErase(pt);
      else startStroke(pt, e.pressure, 'eraser');
    } else if (t === 'lasso') {
      startLasso(pt);
    } else if (t === 'shape') {
      startShape(pt);
    } else if (t === 'text') {
      addTextBox(pt);
      S.mode = null;
    } else {
      startStroke(pt, e.pressure);
    }
  }

  function isInsidePage(cx, cy) {
    const r = D.pageEl.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }

  function insideBBox(b, pt) {
    return pt.x >= b.x - 8 && pt.x <= b.x + b.w + 8 && pt.y >= b.y - 8 && pt.y <= b.y + b.h + 8;
  }

  function onPointerMove(e) {
    if (S.pointers.has(e.pointerId)) {
      const rec = S.pointers.get(e.pointerId);
      rec.x = e.clientX; rec.y = e.clientY;
    }

    if (S.gesture) { updateGesture(); return; }

    if (S.mode === 'pan' && S.panStart) {
      S.view.x = S.panStart.vx + (e.clientX - S.panStart.x);
      S.view.y = S.panStart.vy + (e.clientY - S.panStart.y);
      applyView();
      return;
    }

    if (S.mode === 'moveSel' && S.dragSel) {
      const pt = toPage(e.clientX, e.clientY);
      const dx = pt.x - S.dragSel.last.x, dy = pt.y - S.dragSel.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.01) {
        S.sel.strokes.forEach(s => s.pts.forEach(q => { q.x += dx; q.y += dy; }));
        S.sel.bbox = moveBBox(S.sel.bbox, dx, dy);
        S.dragSel.acc.x += dx;
        S.dragSel.acc.y += dy;
        S.dragSel.last = pt;
        S.dragSel.moved = true;
        repaintInk();
        drawSelectionBox();
      }
      return;
    }

    if (S.drawId !== e.pointerId) return;

    if (S.mode === 'draw' && S.stroke) {
      const pt = toPage(e.clientX, e.clientY);
      const pred = eventPredicted(e);
      if (pred) {
        const pp = toPage(pred.x, pred.y);
        appendPoint(S.stroke, pp, e.pressure);
      }
      appendPoint(S.stroke, pt, e.pressure);
      paintLive(S.stroke);
      return;
    }

    if (S.mode === 'eraseStroke') {
      const pt = toPage(e.clientX, e.clientY);
      eraseStrokeAt(pt);
      return;
    }

    if (S.mode === 'lasso') {
      const pt = toPage(e.clientX, e.clientY);
      S.lassoPts.push(pt);
      drawLasso();
      return;
    }

    if (S.mode === 'shape' && S.stroke) {
      const pt = toPage(e.clientX, e.clientY);
      S.stroke.pts[1] = { x: pt.x, y: pt.y, p: 1 };
      clearLive();
      A.Ink.drawStroke(D.liveCv.getContext('2d'), S.stroke);
      return;
    }
  }

  function eventPredicted(e) {
    if (e.getPredictedEvents) {
      try {
        const list = e.getPredictedEvents();
        if (list && list.length) return { x: list[0].clientX, y: list[0].clientY };
      } catch (err) { }
    }
    return null;
  }

  function onPointerUp(e) {
    S.pointers.delete(e.pointerId);

    if (S.gesture) {
      if (S.pointers.size < 2) {
        S.gesture = null;
        clampView();
        scheduleQuality();
        return;
      }
      return;
    }

    if (S.mode === 'pan') { S.mode = null; S.panStart = null; clampView(); return; }

    if (S.mode === 'moveSel') {
      if (S.dragSel && S.dragSel.moved) {
        pushUndo({ t: 'move', strokes: S.sel.strokes.slice(), dx: S.dragSel.acc.x, dy: S.dragSel.acc.y });
        markDirty();
      }
      S.dragSel = null;
      S.mode = null;
      return;
    }

    if (S.drawId !== e.pointerId) { S.mode = null; return; }

    if (S.mode === 'draw' && S.stroke) {
      finishStroke();
    } else if (S.mode === 'eraseStroke') {
      S.mode = null;
    } else if (S.mode === 'lasso') {
      finishLasso();
    } else if (S.mode === 'shape' && S.stroke) {
      finishShape();
    }
    S.mode = null;
    S.drawId = null;
  }

  function onPointerCancel(e) {
    S.pointers.delete(e.pointerId);
    if (S.gesture) { S.gesture = null; return; }
    if (S.stroke && S.mode === 'shape') { S.stroke = null; clearLive(); }
    S.mode = null; S.drawId = null;
  }

  /* ───────────── 手势 ───────────── */
  function beginGesture() {
    if (S.stroke) { discardStroke(); }
    const arr = Array.from(S.pointers.values());
    if (arr.length < 2) return;
    const [a, b] = arr;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = stageRect();
    S.gesture = {
      d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      s0: S.view.scale,
      px: (mid.x - r.left - S.view.x) / S.view.scale,
      py: (mid.y - r.top - S.view.y) / S.view.scale
    };
    S.mode = null;
  }

  function updateGesture() {
    const arr = Array.from(S.pointers.values());
    if (arr.length < 2 || !S.gesture) return;
    const [a, b] = arr;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const r = stageRect();
    const s = A.clamp(S.gesture.s0 * (d / S.gesture.d0), 0.15, 6);
    S.view.scale = s;
    S.view.x = (mid.x - r.left) - S.gesture.px * s;
    S.view.y = (mid.y - r.top) - S.gesture.py * s;
    applyView();
  }

  /* ═════════════ 书写 ═════════════ */

  function startStroke(pt, pressure, forceTool) {
    const tool = forceTool || (S.tool === 'marker' ? 'marker' : (S.tool === 'pen' && S.kind === 'pencil' ? 'pencil' : 'pen'));
    const s = {
      id: A.uid('sk'),
      tool: tool,
      kind: tool === 'pen' ? S.kind : (tool === 'pencil' ? 'pencil' : 'ball'),
      color: tool === 'eraser' ? '#000' : S.color,
      size: S.size,
      pts: [{ x: pt.x, y: pt.y, p: pressure || 0.5 }],
      _committed: 0
    };
    S.stroke = s;
    S.mode = 'draw';
    clearLive();
    paintLive(s);
  }

  function appendPoint(s, pt, pressure) {
    const p = (typeof pressure === 'number' && pressure > 0) ? A.clamp(pressure, 0.05, 1) : 0.5;
    A.Ink.addPoint(s, { x: pt.x, y: pt.y, p: p });
    s._sm = null;
  }

  function paintLive(s) {
    // 不透明笔用渐进提交，避免每帧重画整笔
    const opaque = (s.tool === 'pen' || s.tool === 'pencil');
    const g = D.liveCv.getContext('2d');
    if (opaque) {
      const sm = (s._sm || (s._sm = A.Ink.densify(A.Ink.smoothPressure(s.pts))));
      const n = sm.length;
      if (n - s._committed > 46) {
        const to = n - 10;
        const bg = D.baseCv.getContext('2d');
        bg.save();
        bg.globalCompositeOperation = 'source-over';
        bg.globalAlpha = s.tool === 'pencil' ? 0.86 : 1;
        bg.fillStyle = s.color;
        A.Ink.drawPartial(bg, s, Math.max(0, s._committed - 1), to);
        bg.restore();
        s._committed = to;
      }
      clearLive();
      g.save();
      g.globalAlpha = s.tool === 'pencil' ? 0.86 : 1;
      g.fillStyle = s.color;
      A.Ink.drawPartial(g, s, Math.max(0, s._committed - 1), sm.length);
      g.restore();
    } else {
      clearLive();
      A.Ink.drawStroke(g, s);
    }
  }

  function finishStroke() {
    const s = S.stroke;
    if (!s) return;
    S.stroke = null;
    clearLive();
    const bg = D.baseCv.getContext('2d');
    if (s.pts.length < 2 && s.tool !== 'eraser') {
      // 单点 → 画一个点
      s.pts.push({ x: s.pts[0].x + 0.01, y: s.pts[0].y + 0.01, p: s.pts[0].p });
      s._sm = null;
    }
    if (s.tool === 'pen' || s.tool === 'pencil') {
      const sm = (s._sm || (s._sm = A.Ink.densify(A.Ink.smoothPressure(s.pts))));
      bg.save();
      bg.globalAlpha = s.tool === 'pencil' ? 0.86 : 1;
      bg.fillStyle = s.color;
      A.Ink.drawPartial(bg, s, Math.max(0, s._committed - 1), sm.length);
      bg.restore();
    } else {
      A.Ink.drawStroke(bg, s);
    }
    delete s._committed;
    S.page.strokes.push(s);
    pushUndo({ t: 'add', stroke: s });
    markDirty();
    addStrokeCount();
  }

  function discardStroke() {
    S.stroke = null;
    clearLive();
    repaintInk();
  }

  /* ───────────── 橡皮 ───────────── */
  function startStrokeErase(pt) {
    S.mode = 'eraseStroke';
    S.erased = [];
    eraseStrokeAt(pt);
  }

  function eraseStrokeAt(pt) {
    const list = S.page.strokes;
    let removed = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.tool === 'eraser') continue;
      if (A.Ink.strokeHit(s, pt.x, pt.y, S.size)) {
        S.erased.push({ s: s, i: i });
        list.splice(i, 1);
        removed = true;
      }
    }
    if (removed) {
      repaintInk();
      markDirty();
    }
  }

  function pushEraseUndo() {
    if (S.erased && S.erased.length) {
      pushUndo({ t: 'del', items: S.erased.slice() });
      S.erased = [];
    }
  }

  /* ───────────── 形状 ───────────── */
  function startShape(pt) {
    const s = {
      id: A.uid('sk'),
      tool: 'shape',
      shape: S.shape,
      color: S.color,
      size: Math.max(1.5, S.size),
      pts: [{ x: pt.x, y: pt.y, p: 1 }, { x: pt.x, y: pt.y, p: 1 }]
    };
    S.stroke = s;
    S.mode = 'shape';
    clearLive();
  }

  function finishShape() {
    const s = S.stroke;
    S.stroke = null;
    clearLive();
    if (!s) return;
    const a = s.pts[0], b = s.pts[1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) { return; }
    A.Ink.drawStroke(D.baseCv.getContext('2d'), s);
    S.page.strokes.push(s);
    pushUndo({ t: 'add', stroke: s });
    markDirty();
  }

  /* ───────────── 套索 ───────────── */
  function startLasso(pt) {
    S.mode = 'lasso';
    S.lassoPts = [pt];
    cancelSelection();
    drawLasso();
  }

  function drawLasso() {
    const pts = S.lassoPts || [];
    if (pts.length < 2) { D.selSvg.innerHTML = ''; return; }
    let d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (let i = 1; i < pts.length; i++) d += ' L' + pts[i].x + ' ' + pts[i].y + '';
    D.selSvg.innerHTML = '<path d="' + d + '" fill="rgba(224,178,99,.10)" stroke="#e0b263" stroke-width="1.4" stroke-dasharray="5 4" />';
  }

  function finishLasso() {
    const poly = S.lassoPts || [];
    D.selSvg.innerHTML = '';
    S.lassoPts = null;
    if (poly.length < 3) { S.mode = null; return; }
    const hits = S.page.strokes.filter(s => s.tool !== 'eraser' && A.Ink.strokeInPoly(s, poly));
    if (!hits.length) { A.toast('没有选中笔迹'); S.mode = null; return; }
    S.sel = { strokes: hits, bbox: A.Ink.bboxOf(hits, 8), poly: poly };
    drawSelectionBox();
    showCtxFloat();
    S.mode = null;
  }

  function drawSelectionBox() {
    if (!S.sel) { D.selSvg.innerHTML = ''; return; }
    const b = S.sel.bbox;
    D.selSvg.innerHTML =
      '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" fill="rgba(224,178,99,.06)" stroke="#e0b263" stroke-width="1.2" stroke-dasharray="6 4" rx="4"/>' +
      ['nw', 'ne', 'sw', 'se'].map(k => {
        const x = (k === 'nw' || k === 'sw') ? b.x : b.x + b.w;
        const y = (k === 'nw' || k === 'ne') ? b.y : b.y + b.h;
        return '<circle cx="' + x + '" cy="' + y + '" r="5" fill="#e0b263" />';
      }).join('');
  }

  function moveBBox(b, dx, dy) {
    return { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
  }

  function cancelSelection() {
    S.sel = null;
    D.selSvg.innerHTML = '';
    hideCtxFloat();
  }

  function showCtxFloat() {
    const b = S.sel.bbox;
    const r = stageRect();
    const px = r.left + S.view.x + (b.x + b.w / 2) * S.view.scale;
    const py = r.top + S.view.y + b.y * S.view.scale - 12;
    const el = D.ctxFloat;
    el.style.left = (px - D.viewStu.getBoundingClientRect().left) + 'px';
    el.style.top = (py - D.viewStu.getBoundingClientRect().top) + 'px';
    el.classList.add('is-on');
    el.innerHTML =
      '<button data-a="copy">复制</button>' +
      '<button data-a="color">上色</button>' +
      '<button data-a="front">置顶</button>' +
      '<div class="cf-sep"></div>' +
      '<button data-a="del" class="cf-danger">删除</button>';
    A.$$('button', el).forEach(btn => {
      btn.onclick = () => {
        const a = btn.dataset.a;
        const sel = S.sel;
        if (!sel) return;
        if (a === 'del') {
          S.page.strokes = S.page.strokes.filter(s => sel.strokes.indexOf(s) < 0);
          pushUndo({ t: 'del', items: sel.strokes.map(s => ({ s: s, i: -1 })) });
          cancelSelection();
          repaintInk(); markDirty();
        } else if (a === 'copy') {
          const copies = sel.strokes.map(s => {
            const c = JSON.parse(JSON.stringify(slimStroke(s)));
            c.id = A.uid('sk');
            c.pts.forEach(p => { p.x += 16; p.y += 16; });
            return c;
          });
          copies.forEach(c => S.page.strokes.push(c));
          pushUndo({ t: 'add', stroke: copies[copies.length - 1] });
          cancelSelection(); repaintInk(); markDirty();
          A.toast('已复制');
        } else if (a === 'front') {
          sel.strokes.forEach(s => {
            const i = S.page.strokes.indexOf(s);
            if (i >= 0) { S.page.strokes.splice(i, 1); S.page.strokes.push(s); }
          });
          repaintInk(); markDirty();
        } else if (a === 'color') {
          A.sheet.open({ title: '换个颜色', node: buildColorNode() });
        }
      };
    });
  }

  function buildColorNode() {
    const node = A.el('div');
    node.innerHTML = '<div class="opt-grid">' + COLORS.map(c =>
      '<button class="opt" data-c="' + c + '" style="display:flex;align-items:center;justify-content:center">' +
      '<span style="width:22px;height:22px;border-radius:50%;background:' + c + ';border:1px solid rgba(255,255,255,.2)"></span></button>'
    ).join('') + '</div>';
    A.$$('.opt', node).forEach(b => b.addEventListener('click', () => {
      const c = b.dataset.c;
      if (S.sel) {
        S.sel.strokes.forEach(s => { s.color = c; if (s.tool === 'eraser') s.tool = 'pen'; });
        repaintInk(); markDirty();
      }
      A.sheet.close();
    }));
    return node;
  }

  function hideCtxFloat() {
    if (D.ctxFloat) D.ctxFloat.classList.remove('is-on');
  }

  /* ───────────── 文字 ───────────── */
  function addTextBox(pt) {
    const t = {
      id: A.uid('tx'),
      x: pt.x, y: pt.y, w: 240,
      size: 20,
      color: '#1c1c1e',
      text: ''
    };
    S.page.texts.push(t);
    renderTexts();
    requestAnimationFrame(() => {
      const el = D.textLayer.querySelector('[data-id="' + t.id + '"]');
      if (el) { el.focus(); }
    });
    markDirty();
  }

  function renderTexts() {
    const p = S.page;
    if (!p) return;
    D.textLayer.innerHTML = '';
    (p.texts || []).forEach(t => {
      const el = A.el('div', 'pg-text');
      el.dataset.id = t.id;
      el.contentEditable = 'true';
      el.style.left = t.x + 'px';
      el.style.top = t.y + 'px';
      el.style.width = t.w + 'px';
      el.style.fontSize = t.size + 'px';
      el.style.color = t.color;
      el.textContent = t.text || '';
      el.addEventListener('blur', () => {
        t.text = el.textContent;
        if (!t.text.trim()) {
          p.texts = p.texts.filter(x => x !== t);
          renderTexts();
        }
        markDirty();
      });
      el.addEventListener('input', () => { t.text = el.textContent; });
      el.addEventListener('pointerdown', (e) => {
        if (S.tool === 'text') { e.stopPropagation(); return; }
        e.stopPropagation();
      });
      D.textLayer.appendChild(el);
    });
  }

  function renderImages() {
    const p = S.page;
    if (!p) return;
    D.imgLayer.innerHTML = '';
    (p.images || []).forEach(im => {
      const el = A.el('div', 'pg-img');
      el.dataset.id = im.id;
      el.style.left = im.x + 'px';
      el.style.top = im.y + 'px';
      el.style.width = im.w + 'px';
      el.style.height = im.h + 'px';
      el.innerHTML = '<img src="' + im.src + '" alt="">';

      let dragging = false, last = null, origin = null, pressTimer = 0, longFired = false;
      el.addEventListener('pointerdown', (e) => {
        if (S.tool !== 'image' && S.tool !== 'lasso') return;
        e.stopPropagation();
        dragging = true;
        longFired = false;
        last = toPage(e.clientX, e.clientY);
        origin = { x: im.x, y: im.y };
        el.setPointerCapture(e.pointerId);
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          longFired = true;
          dragging = false;
          im.x = origin.x; im.y = origin.y;
          el.style.left = im.x + 'px'; el.style.top = im.y + 'px';
          A.haptic(12);
          openImageOptions(im);
        }, 560);
      });
      el.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const pt = toPage(e.clientX, e.clientY);
        im.x += pt.x - last.x; im.y += pt.y - last.y;
        last = pt;
        if (Math.abs(im.x - origin.x) + Math.abs(im.y - origin.y) > 6) clearTimeout(pressTimer);
        el.style.left = im.x + 'px'; el.style.top = im.y + 'px';
      });
      el.addEventListener('pointerup', () => {
        clearTimeout(pressTimer);
        if (longFired) { longFired = false; return; }
        if (!dragging) return;
        dragging = false;
        const dx = im.x - origin.x, dy = im.y - origin.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          pushUndo({ t: 'imgmove', im: im, dx: dx, dy: dy });
        }
        markDirty();
      });
      el.addEventListener('pointercancel', () => {
        clearTimeout(pressTimer);
        if (dragging && origin) { im.x = origin.x; im.y = origin.y; }
        dragging = false;
        renderImages();
      });
      D.imgLayer.appendChild(el);
    });
  }

  function openImageOptions(im) {
    const { w: pw } = pageSize();
    const ar = im.h / im.w || 1;
    const w0 = im.w, h0 = im.h;
    const pct = Math.max(15, Math.min(100, Math.round(im.w / pw * 100)));
    const node = A.el('div');
    node.innerHTML =
      '<div class="field"><div class="field-line"><label>图片宽度</label><span class="val" id="imgPct">' + pct + '%</span></div>' +
      '<input class="rng" type="range" id="imgW" min="15" max="100" step="1" value="' + pct + '"></div>' +
      '<div class="list">' +
      '<button class="list-item" data-a="fit"><svg class="ico" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span class="li-grow">贴合页宽<span class="li-sub">拉满到纸张宽度</span></span></button>' +
      '<button class="list-item" data-a="del"><svg class="ico" viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/><path d="M11 11v6M13 11v6"/></svg><span class="li-grow">删除这张图片<span class="li-sub">删除后仍可撤销</span></span></button>' +
      '</div>';
    A.sheet.open({
      title: '图片',
      dimLight: true,
      node,
      onMount: (body, sh) => {
        let prevW = w0, prevH = h0;
        const apply = (v) => {
          const p = Math.max(15, Math.min(100, v));
          im.w = pw * p / 100;
          im.h = im.w * ar;
          const lab = A.$('#imgPct', body);
          if (lab) lab.textContent = Math.round(p) + '%';
          renderImages();
        };
        const commit = () => {
          if (Math.abs(im.w - prevW) < 0.5 && Math.abs(im.h - prevH) < 0.5) return;
          pushUndo({ t: 'imgsize', im: im, w0: prevW, h0: prevH, w1: im.w, h1: im.h });
          prevW = im.w; prevH = im.h;
          markDirty();
        };
        const rng = A.$('#imgW', body);
        if (rng) {
          rng.addEventListener('input', () => apply(+rng.value));
          rng.addEventListener('change', commit);
        }
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', () => {
          const a = b.dataset.a;
          if (a === 'fit') { apply(100); commit(); sh.close(); return; }
          if (a === 'del') {
            sh.close();
            const at = S.page.images.indexOf(im);
            if (at < 0) return;
            S.page.images.splice(at, 1);
            pushUndo({ t: 'imgdel', items: [{ im: im, i: at }] });
            renderImages();
            markDirty();
            A.toast('图片已删除 · 可撤销');
          }
        }));
      }
    });
  }

  function insertImage(dataUrl) {
    const { w, h } = pageSize();
    A.loadImage(dataUrl).then(img => {
      const iw = Math.min(w * 0.5, img.width);
      const ih = iw * (img.height / img.width);
      const im = {
        id: A.uid('im'),
        src: dataUrl,
        x: (w - iw) / 2,
        y: (h - ih) / 2 - 40,
        w: iw, h: ih
      };
      S.page.images.push(im);
      pushUndo({ t: 'imgadd', im: im });
      renderImages();
      markDirty();
      A.toast('已插入图片 · 套索工具下可拖动或双击删除');
    }).catch(() => A.toast('图片读取失败'));
  }

  /* ═════════════ 撤销 / 重做 ═════════════ */

  function pushUndo(op) {
    S.undo.push(op);
    if (S.undo.length > 160) S.undo.shift();
    S.redo.length = 0;
    updateUndoButtons();
  }

  function addStrokeCount() { }

  function updateUndoButtons() {
    const u = A.$('#btnUndo'), r = A.$('#btnRedo');
    if (u) u.classList.toggle('is-disabled', !S.undo.length);
    if (r) r.classList.toggle('is-disabled', !S.redo.length);
  }

  function undo() {
    const op = S.undo.pop();
    if (!op) return;
    applyOp(op, true);
    S.redo.push(op);
    updateUndoButtons();
    repaintInk();
    renderImages();
    markDirty();
  }

  function redo() {
    const op = S.redo.pop();
    if (!op) return;
    applyOp(op, false);
    S.undo.push(op);
    updateUndoButtons();
    repaintInk();
    renderImages();
    markDirty();
  }

  function applyOp(op, reverse) {
    const list = S.page.strokes;
    if (op.t === 'add') {
      if (reverse) {
        const i = list.indexOf(op.stroke);
        if (i >= 0) list.splice(i, 1);
      } else {
        list.push(op.stroke);
      }
    } else if (op.t === 'del') {
      if (reverse) {
        // 恢复
        op.items.slice().sort((a, b) => a.i - b.i).forEach(it => {
          if (list.indexOf(it.s) < 0) {
            const at = it.i < 0 || it.i > list.length ? list.length : it.i;
            list.splice(at, 0, it.s);
          }
        });
      } else {
        op.items.forEach(it => {
          const i = list.indexOf(it.s);
          if (i >= 0) list.splice(i, 1);
        });
      }
    } else if (op.t === 'move') {
      const k = reverse ? -1 : 1;
      op.strokes.forEach(s => s.pts.forEach(p => { p.x += op.dx * k; p.y += op.dy * k; }));
    } else if (op.t === 'imgadd') {
      const arr = S.page.images;
      if (reverse) {
        const i = arr.indexOf(op.im);
        if (i >= 0) arr.splice(i, 1);
      } else if (arr.indexOf(op.im) < 0) {
        arr.push(op.im);
      }
    } else if (op.t === 'imgdel') {
      const arr = S.page.images;
      if (reverse) {
        op.items.slice().sort((a, b) => a.i - b.i).forEach(it => {
          if (arr.indexOf(it.im) < 0) {
            const at = it.i < 0 || it.i > arr.length ? arr.length : it.i;
            arr.splice(at, 0, it.im);
          }
        });
      } else {
        op.items.forEach(it => {
          const i = arr.indexOf(it.im);
          if (i >= 0) arr.splice(i, 1);
        });
      }
    } else if (op.t === 'imgmove') {
      const k = reverse ? -1 : 1;
      op.im.x += op.dx * k;
      op.im.y += op.dy * k;
    } else if (op.t === 'imgsize') {
      if (reverse) { op.im.w = op.w0; op.im.h = op.h0; }
      else { op.im.w = op.w1; op.im.h = op.h1; }
    }
  }

  /* ═════════════ 保存 ═════════════ */

  function slimStroke(s) {
    return {
      id: s.id, tool: s.tool, kind: s.kind, shape: s.shape,
      color: s.color, size: s.size,
      pts: s.pts.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, p: Math.round((p.p || .5) * 1000) / 1000 }))
    };
  }

  function markDirty() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistPage(false), 800);
  }

  async function persistPage(now) {
    const p = S.page;
    if (!p) return;
    clearTimeout(saveTimer);
    const copy = {
      id: p.id, bookId: p.bookId, order: p.order, type: p.type,
      w: p.w, h: p.h, preset: p.preset,
      paper: p.paper, paperColor: p.paperColor,
      srcKey: p.srcKey, sliceTop: p.sliceTop, docH: p.docH,
      strokes: (p.strokes || []).map(slimStroke),
      texts: p.texts || [],
      images: (p.images || []).map(im => ({ id: im.id, src: im.src, x: im.x, y: im.y, w: im.w, h: im.h }))
    };
    await A.db.savePage(copy);
    if (S.book) {
      S.book.updatedAt = A.now();
      S.book.pageCount = S.pages.length;
      await A.db.saveBook(S.book);
    }
  }

  /* ═════════════ 页面操作 ═════════════ */

  async function addPage(kind) {
    await persistPage(true);
    const order = S.pages.length;
    let page;
    if (kind === 'copy' && S.page) {
      page = JSON.parse(JSON.stringify({
        id: A.uid('pg'), bookId: S.page.bookId, order: order,
        type: S.page.type, w: S.page.w, h: S.page.h, preset: S.page.preset,
        paper: S.page.paper, paperColor: S.page.paperColor,
        srcKey: S.page.srcKey, sliceTop: S.page.sliceTop, docH: S.page.docH,
        strokes: (S.page.strokes || []).map(slimStroke),
        texts: S.page.texts || [], images: S.page.images || []
      }));
    } else {
      page = blankPage(S.page.bookId, order, { w: S.page.w, h: S.page.h, id: S.page.preset });
    }
    await A.db.savePage(page);
    S.pages.push(page);
    await loadPage(S.pages.length - 1);
    A.toast(kind === 'copy' ? '已复制为新页' : '已添加一页');
  }

  async function deletePage(idx) {
    if (S.pages.length <= 1) { A.toast('至少保留一页'); return; }
    const p = S.pages[idx];
    S.pages.splice(idx, 1);
    await A.db.deletePage(p.id);
    for (let i = 0; i < S.pages.length; i++) {
      S.pages[i].order = i;
      await A.db.savePage(S.pages[i]);
    }
    await loadPage(Math.min(idx, S.pages.length - 1));
    A.toast('已删除该页');
  }

  function goPage(idx) {
    if (idx < 0 || idx >= S.pages.length) {
      A.toast(idx < 0 ? '已经是第一页' : '已经是最后一页');
      return;
    }
    loadPage(idx);
  }

  /* ═════════════ 面板 ═════════════ */

  function openPagesPanel() {
    const node = A.el('div');
    const strip = A.el('div', 'page-strip');
    S.pages.forEach((p, i) => {
      const chip = A.el('div', 'page-chip' + (i === S.idx ? ' is-on' : ''));
      const thumb = A.el('div', 'pc-thumb');
      thumb.appendChild(makeThumb(p, 96, 130));
      chip.appendChild(thumb);
      chip.appendChild(A.el('div', 'pc-num', (i + 1) + (p.type === 'html' ? ' · 网页' : '')));
      chip.addEventListener('click', () => { A.sheet.close(); setTimeout(() => goPage(i), 200); });
      strip.appendChild(chip);
    });
    node.appendChild(strip);

    const actions = A.el('div', 'list');
    actions.innerHTML =
      '<button class="list-item" data-a="add"><svg class="ico" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span class="li-grow">新增空白页</span></button>' +
      '<button class="list-item" data-a="copy"><svg class="ico" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg><span class="li-grow">复制当前页</span></button>' +
      '<button class="list-item" data-a="del"><svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4.5h6V7"/></svg><span class="li-grow">删除当前页</span></button>';
    node.appendChild(actions);

    A.sheet.open({
      title: '页面',
      sub: S.pages.length + ' 页',
      node,
      onMount: (body, sh) => {
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', async () => {
          const a = b.dataset.a;
          if (a === 'add') { sh.close(); setTimeout(() => addPage('blank'), 180); }
          if (a === 'copy') { sh.close(); setTimeout(() => addPage('copy'), 180); }
          if (a === 'del') { sh.close(); setTimeout(() => deletePage(S.idx), 180); }
        }));
      }
    });
  }

  function makeThumb(p, tw, th) {
    const cv = document.createElement('canvas');
    const scale = tw / p.w;
    cv.width = tw * 2; cv.height = th * 2;
    cv.style.width = tw + 'px'; cv.style.height = th + 'px';
    const g = cv.getContext('2d');
    g.scale(scale * 2, scale * 2);
    g.fillStyle = p.paperColor || '#fff';
    g.fillRect(0, 0, p.w, p.h);
    if (p.type === 'html') {
      g.fillStyle = '#eef0f4';
      g.fillRect(0, 0, p.w, p.h);
      g.fillStyle = 'rgba(30,40,60,.10)';
      for (let y = 40; y < p.h * 0.9; y += 60) {
        g.fillRect(40, y, p.w * (0.5 + Math.random() * 0.35), 10);
      }
      g.fillStyle = 'rgba(224,178,99,.9)';
      g.fillRect(0, 0, p.w, 8);
    } else if (p.paper !== 'blank') {
      g.strokeStyle = 'rgba(70,90,130,.16)';
      g.lineWidth = 1;
      for (let y = 84; y < p.h; y += 28) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(p.w, y); g.stroke();
      }
    }
    g.save();
    g.scale(1, 1);
    A.Ink.drawAll(g, p.strokes || []);
    g.restore();
    return cv;
  }

  function openPaperPanel() {
    const node = A.el('div');
    node.innerHTML = '<div class="opt-grid" id="paperOpts">' + PAPERS.map(pt =>
      '<button class="opt' + (S.page.paper === pt.id ? ' is-on' : '') + '" data-p="' + pt.id + '">' + pt.name + '<span class="opt-sub">' + pt.sub + '</span></button>'
    ).join('') + '</div>' +
      '<div class="field" style="margin-top:18px"><label>纸张颜色</label><div class="opt-grid" id="paperColors">' +
      ['#ffffff', '#fbf7ee', '#f4f1e8', '#f7f7f9', '#23242a'].map(c =>
        '<button class="opt' + (S.page.paperColor === c ? ' is-on' : '') + '" data-c="' + c + '" style="height:46px;background:' + c + (c === '#23242a' ? ';color:#ddd' : '') + '"></button>'
      ).join('') + '</div></div>';
    A.sheet.open({
      title: '纸张',
      dimLight: true,
      node,
      onMount: (body) => {
        A.$$('#paperOpts .opt', body).forEach(b => b.addEventListener('click', () => {
          S.page.paper = b.dataset.p;
          A.$$('#paperOpts .opt', body).forEach(x => x.classList.toggle('is-on', x === b));
          paintPaper(); markDirty();
        }));
        A.$$('#paperColors .opt', body).forEach(b => b.addEventListener('click', () => {
          S.page.paperColor = b.dataset.c;
          A.$$('#paperColors .opt', body).forEach(x => x.classList.toggle('is-on', x === b));
          paintPaper(); markDirty();
        }));
      }
    });
  }

  function openExportPanel() {
    const node = A.el('div');
    node.innerHTML =
      '<div class="list">' +
      '<button class="list-item" data-a="pdf"><svg class="ico" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg><span class="li-grow">导出 PDF<span class="li-sub">整本笔记，适合打印和分享</span></span></button>' +
      '<button class="list-item" data-a="png"><svg class="ico" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg><span class="li-grow">导出当前页 PNG<span class="li-sub">含纸张底色，可直接打印或贴进文档</span></span></button>' +
      '<div class="list-sep"></div>' +
      '<button class="list-item" data-a="backup"><svg class="ico" viewBox="0 0 24 24"><path d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg><span class="li-grow">备份整库<span class="li-sub">JSON 文件，可恢复</span></span></button>' +
      '</div>' +
      '<p class="sheet-hint">说明：网页底稿由浏览器渲染，无法直接绘制进 PDF。导出的是「纸张 + 手写笔迹」。若需要连网页一起保存，请在浏览模式下用系统的「分享 → 打印」。</p>';
    A.sheet.open({
      title: '导出',
      node,
      onMount: (body, sh) => {
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', async () => {
          const a = b.dataset.a;
          sh.close();
          if (a === 'pdf') setTimeout(exportPdf, 220);
          if (a === 'png') setTimeout(exportPng, 220);
          if (a === 'backup') setTimeout(() => A.$('#footBackup') && A.$('#footBackup').click(), 220);
        }));
      }
    });
  }

  function openMorePanel() {
    const node = A.el('div');
    node.innerHTML =
      '<div class="list">' +
      '<button class="list-item" data-a="paper"><svg class="ico" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg><span class="li-grow">纸张与背景</span></button>' +
      '<button class="list-item" data-a="import"><svg class="ico" viewBox="0 0 24 24"><path d="M12 16V4m0 12l-4-4m4 4l4-4"/><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg><span class="li-grow">把 HTML 追加到这本笔记</span></button>' +
      '<button class="list-item" data-a="rename"><svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg><span class="li-grow">重命名笔记</span></button>' +
      '<button class="list-item" data-a="fit"><svg class="ico" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span class="li-grow">切换到适应整页</span></button>' +
      '<div class="list-sep"></div>' +
      '<button class="list-item" data-a="help"><svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.6-2.5 2-2.5 3.5"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/></svg><span class="li-grow">使用说明</span></button>' +
      '</div>';
    A.sheet.open({
      title: '更多',
      node,
      onMount: (body, sh) => {
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', () => {
          const a = b.dataset.a;
          if (a === 'fit') { sh.close(); setTimeout(fitPage, 200); return; }
          sh.close();
          if (a === 'paper') setTimeout(openPaperPanel, 200);
          if (a === 'import') setTimeout(() => A.$('#fileHtml').click(), 200);
          if (a === 'rename') setTimeout(() => { D.docTitle.focus(); D.docTitle.select(); }, 200);
          if (a === 'help') setTimeout(() => { A.$('#footHelp') && A.$('#footHelp').click(); }, 200);
        }));
      }
    });
  }

  /* ═════════════ 导出 ═════════════ */

  async function renderPageToCanvas(p) {
    const cv = document.createElement('canvas');
    cv.width = p.w; cv.height = p.h;
    const g = cv.getContext('2d');
    g.fillStyle = p.paperColor || '#ffffff';
    g.fillRect(0, 0, p.w, p.h);
    drawPaperPattern(g, p);

    // 笔迹先画在透明层上，这样橡皮只擦墨不擦纸
    const ink = document.createElement('canvas');
    ink.width = p.w; ink.height = p.h;
    A.Ink.drawAll(ink.getContext('2d'), p.strokes || []);
    g.drawImage(ink, 0, 0);

    // 图片
    for (const im of (p.images || [])) {
      try {
        const img = await A.loadImage(im.src);
        g.drawImage(img, im.x, im.y, im.w, im.h);
      } catch (e) { }
    }

    // 文字
    (p.texts || []).forEach(t => {
      g.fillStyle = t.color || '#1c1c1e';
      g.font = (t.size || 20) + 'px -apple-system,"PingFang SC",sans-serif';
      g.textBaseline = 'top';
      const lines = wrapText(g, t.text || '', t.w - 16);
      lines.forEach((ln, i) => g.fillText(ln, t.x + 8, t.y + 8 + i * (t.size || 20) * 1.4));
    });

    return cv;
  }

  function wrapText(g, text, maxW) {
    const out = [];
    text.split('\n').forEach(para => {
      let line = '';
      for (const ch of para) {
        if (g.measureText(line + ch).width > maxW) { out.push(line); line = ch; }
        else line += ch;
      }
      out.push(line);
    });
    return out;
  }

  function drawPaperPattern(g, p) {
    const type = p.paper || 'blank';
    const step = 28, w = p.w, h = p.h;
    const lc = 'rgba(70,90,130,.18)';
    g.lineWidth = 1;
    if (type === 'lined') {
      g.strokeStyle = lc;
      for (let y = step * 3; y < h; y += step) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke(); }
      g.strokeStyle = 'rgba(200,80,80,.28)';
      g.beginPath(); g.moveTo(56, 0); g.lineTo(56, h); g.stroke();
    } else if (type === 'grid') {
      g.strokeStyle = 'rgba(70,90,130,.13)';
      for (let x = 0; x < w; x += step) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, h); g.stroke(); }
      for (let y = 0; y < h; y += step) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke(); }
    } else if (type === 'dot') {
      g.fillStyle = 'rgba(70,90,130,.30)';
      for (let x = step; x < w; x += step) for (let y = step; y < h; y += step) { g.beginPath(); g.arc(x, y, 1.1, 0, 6.283); g.fill(); }
    } else if (type === 'cornell') {
      g.strokeStyle = 'rgba(200,80,80,.30)';
      g.beginPath(); g.moveTo(w * 0.28, 0); g.lineTo(w * 0.28, h * 0.78); g.stroke();
      g.beginPath(); g.moveTo(0, h * 0.78); g.lineTo(w, h * 0.78); g.stroke();
      g.strokeStyle = lc;
      for (let y = step * 3; y < h * 0.75; y += step) { g.beginPath(); g.moveTo(w * 0.29, y + .5); g.lineTo(w, y + .5); g.stroke(); }
    } else if (type === 'music') {
      g.strokeStyle = 'rgba(70,90,130,.28)';
      for (let base = 90; base < h; base += 120) for (let i = 0; i < 5; i++) {
        const y = base + i * 12;
        g.beginPath(); g.moveTo(36, y + .5); g.lineTo(w - 36, y + .5); g.stroke();
      }
    }
  }

  async function exportPdf() {
    A.busy('正在生成 PDF…');
    try {
      await persistPage(true);
      const data = [];
      for (let i = 0; i < S.pages.length; i++) {
        const p = S.pages[i];
        const cv = await renderPageToCanvas(p);
        const url = cv.toDataURL('image/jpeg', 0.9);
        data.push({
          b64: url.split(',')[1],
          w: cv.width, h: cv.height,
          ptW: cv.width * 0.75, ptH: cv.height * 0.75
        });
        cv.width = 1; cv.height = 1;
      }
      const blob = A.PDF.build(data);
      const name = (S.book.name || '笔记').replace(/[\\/:*?"<>|]/g, '_');
      A.download(blob, name + '.pdf');
      A.busy(false);
      A.toast('PDF 已导出（' + data.length + ' 页）');
    } catch (e) {
      A.busy(false);
      console.error(e);
      A.toast('导出失败：' + (e.message || ''));
    }
  }

  async function exportPng() {
    A.busy('正在导出图片…');
    try {
      const cv = await renderPageToCanvas(S.page);
      cv.toBlob((blob) => {
        const name = (S.book.name || '笔记').replace(/[\\/:*?"<>|]/g, '_');
        A.download(blob, name + '-P' + (S.idx + 1) + '.png');
        A.busy(false);
        A.toast('图片已导出');
      }, 'image/png');
    } catch (e) {
      A.busy(false);
      A.toast('导出失败');
    }
  }

  /* ═════════════ 绑定 ═════════════ */

  function bind() {
    const on = (sel, ev, fn) => { const n = A.$(sel); if (n) n.addEventListener(ev, fn); };

    on('#btnBack', 'click', closeBook);
    on('#btnUndo', 'click', undo);
    on('#btnRedo', 'click', redo);
    on('#btnPages', 'click', openPagesPanel);
    on('#btnExport', 'click', openExportPanel);
    on('#btnMore', 'click', openMorePanel);
    on('#pageIndicator', 'click', openPagesPanel);
    on('#btnZoomIn', 'click', () => { const r = stageRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); });
    on('#btnZoomOut', 'click', () => { const r = stageRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); });
    on('#btnZoomReset', 'click', () => fitWidth());
    on('#btnPrevPage', 'click', () => goPage(S.idx - 1));
    on('#btnNextPage', 'click', () => goPage(S.idx + 1));
    on('#btnHtmlEye', 'click', toggleHtml);
    on('#dockToggle', 'click', () => {
      D.dock.classList.toggle('is-collapsed');
      setTimeout(() => applyView(), 340);
    });

    A.$$('.tool[data-tool]', D.toolRow).forEach(b => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });

    A.$$('#penKinds .chip').forEach(c => {
      c.addEventListener('click', () => {
        S.kind = c.dataset.kind;
        A.$$('#penKinds .chip').forEach(x => x.classList.toggle('is-on', x === c));
        if (S.tool !== 'pen') setTool('pen');
      });
    });

    D.sizeRange.addEventListener('input', () => setSize(parseFloat(D.sizeRange.value)));
    D.sizeRange.addEventListener('change', () => { });

    const ci = A.$('#colorInput');
    if (ci) ci.addEventListener('input', () => setColor(ci.value));

    D.docTitle.addEventListener('blur', async () => {
      const v = D.docTitle.value.trim() || '未命名';
      D.docTitle.value = v;
      if (S.book) {
        S.book.name = v;
        S.book.updatedAt = A.now();
        await A.db.saveBook(S.book);
      }
    });
    D.docTitle.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); D.docTitle.blur(); } });

    const st = D.stage;
    st.addEventListener('pointerdown', onPointerDown, { passive: false });
    st.addEventListener('pointermove', onPointerMove, { passive: false });
    st.addEventListener('pointerup', onPointerUp, { passive: false });
    st.addEventListener('pointercancel', onPointerCancel, { passive: false });
    st.addEventListener('contextmenu', e => e.preventDefault());
    st.addEventListener('gesturestart', e => e.preventDefault());

    // 套索结束后若橡皮整笔，补撤销
    st.addEventListener('pointerup', () => { if (S.erased && S.erased.length) pushEraseUndo(); });

    const fi = A.$('#fileImage');
    if (fi) fi.addEventListener('change', async () => {
      const f = (fi.files || [])[0];
      fi.value = '';
      if (!f) return;
      const url = await A.readDataURL(f);
      insertImage(url);
    });

    // HTML 追加
    const fh = A.$('#fileHtml');
    if (fh) fh.addEventListener('change', async () => {
      if (!document.body.classList.contains('in-studio')) return;
      const files = Array.prototype.slice.call(fh.files || []);
      fh.value = '';
      if (!files.length) return;
      for (const f of files) {
        const text = await A.readText(f);
        await appendHtmlDoc(text, f.name.replace(/\.html?$/i, ''));
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('in-studio')) return;
      if (e.target && (e.target.isContentEditable || e.target.tagName === 'INPUT')) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (meta && e.key === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape') { cancelSelection(); A.sheet.close(); }
      else if (e.key === 'ArrowRight' && !meta) goPage(S.idx + 1);
      else if (e.key === 'ArrowLeft' && !meta) goPage(S.idx - 1);
    });

    window.addEventListener('resize', A.debounce(() => {
      if (document.body.classList.contains('in-studio')) fitWidth();
    }, 220));
  }

  function toggleHtml() {
    S.htmlVisible = !S.htmlVisible;
    D.htmlWrap.classList.toggle('is-hidden', !S.htmlVisible);
    updateHtmlEye();
    A.toast(S.htmlVisible ? '已显示底稿' : '已隐藏底稿（只剩纸和笔迹）');
  }

  function updateHtmlEye() {
    const b = A.$('#btnHtmlEye');
    if (!b) return;
    b.classList.toggle('is-off', !S.htmlVisible);
  }

  async function appendHtmlDoc(text, name) {
    A.busy('正在排版…');
    try {
      const h = await measureHtml(text, HTML_PAGE_W);
      const srcKey = A.uid('as');
      await A.db.putAsset(srcKey, text);
      const slices = Math.max(1, Math.ceil(h / HTML_SLICE_H));
      for (let i = 0; i < slices; i++) {
        const page = htmlPage(S.page.bookId, S.pages.length, srcKey, i * HTML_SLICE_H, HTML_SLICE_H, h);
        await A.db.savePage(page);
        S.pages.push(page);
      }
      S.srcCache.set(srcKey, text);
      await loadPage(S.pages.length - slices);
      A.toast('已追加 ' + slices + ' 页');
    } catch (e) {
      A.toast('追加失败');
    } finally { A.busy(false); }
  }

  /* ═════════════ 导入 HTML 成册 ═════════════ */

  async function createHtmlBook(text, name) {
    const now = A.now();
    const srcKey = A.uid('as');
    await A.db.putAsset(srcKey, text);
    const h = await measureHtml(text, HTML_PAGE_W);
    const slices = Math.max(1, Math.min(40, Math.ceil(h / HTML_SLICE_H)));

    const book = {
      id: A.uid('bk'),
      name: name || 'HTML 笔记',
      createdAt: now,
      updatedAt: now,
      accent: ['#e0b263', '#7fa7f5', '#e08a8a', '#8fd0a8', '#b79cf0'][Math.floor(Math.random() * 5)],
      isHtml: true,
      pageCount: slices
    };
    await A.db.saveBook(book);

    const pages = [];
    for (let i = 0; i < slices; i++) {
      pages.push(htmlPage(book.id, i, srcKey, i * HTML_SLICE_H, HTML_SLICE_H, h));
    }
    await A.db.savePages(pages);
    return book.id;
  }

  function measureHtml(src, width) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + width + 'px;height:1000px;border:0;visibility:hidden;';
      document.body.appendChild(f);
      let settled = false;
      A.HtmlPage.mount(f, src, {
        onHeight: (h) => {
          if (!settled && h > 40) {
            settled = true;
            setTimeout(() => { try { f.remove(); } catch (e) { } resolve(h); }, 260);
          }
        }
      }).then(h => {
        if (!settled) {
          settled = true;
          try { f.remove(); } catch (e) { }
          resolve(Math.max(h || 0, 600));
        }
      });
      setTimeout(() => {
        if (!settled) { settled = true; try { f.remove(); } catch (e) { } resolve(1200); }
      }, 5000);
    });
  }

  /* ═════════════ 入口 ═════════════ */

  function init() {
    cacheDom();
    buildPalette();
    drawSizePreview();
    setSize(4);
    bind();
    updateUndoButtons();
  }

  A.Studio = {
    init, openBook, closeBook, blankPage, htmlPage, addPage, goPage,
    exportPdf, exportPng, fitWidth, fitPage, S, createHtmlBook, measureHtml,
    openPagesPanel, openPaperPanel, openExportPanel, insertImage
  };
})(window.MY);
