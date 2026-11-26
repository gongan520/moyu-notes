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
    { id: 'a3l', name: 'A3 横', w: 1587, h: 1123 },
    { id: 'a2l', name: 'A2 横', w: 2245, h: 1587 },
    { id: 'board', name: '大画板', w: 3000, h: 2000 },
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
    lassoMode: 'freeform',
    twoFinger: null,      // 双指轻点撤销的计时状态
    penSeen: false,
    penOnly: true,   // true = 只有触控笔能写字，手指只做平移/手势
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
    ruler: { on: false, y: 260, angle: 0 },
    picking: false,
    tapTape: null,        // 胶带点按判定：{ id, s, pt, moved }
    playT: null,          // 录音回放进度；null 表示正常显示全部笔迹
    selScale: null,       // 选区缩放状态
    layer: 0,             // 当前作图图层
    textFont: 'system',   // 新文字框默认字体
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
    D.laserCv = A.$('#laserCv');
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
    D.recBar = A.$('#recBar');
    D.recTime = A.$('#recTime');
    D.recFill = A.$('#recFill');
    D.recDot = A.$('#recDot');
    D.recPlay = A.$('#recPlay');
    D.recTrack = A.$('#recTrack');
  }

  /* ═════════════ 页面构造 ═════════════ */

  /* 图层：每页一张列表，笔画用 layer 记住归属 */
  function defaultLayers() {
    return [{ id: 'l0', name: '图层 1', visible: true, locked: false }];
  }

  function ensureLayers(p) {
    if (!p) return [];
    if (!Array.isArray(p.layers) || !p.layers.length) p.layers = defaultLayers();
    p.layers.forEach(l => { if (l.visible == null) l.visible = true; });
    return p.layers;
  }

  function layerOf(p, id) {
    const ls = ensureLayers(p);
    return ls.find(l => l.id === id) || ls[0];
  }

  function blankPage(bookId, order, preset) {
    // 没指定纸张时，按当前屏幕方向智能选，让纸张铺满屏幕（对齐 Notability）
    const p = preset || autoPreset();
    return {
      id: A.uid('pg'),
      bookId: bookId,
      order: order,
      type: 'blank',
      w: p.w, h: p.h,
      preset: p.id,
      paper: 'lined',
      paperColor: '#ffffff',
      layers: defaultLayers(),
      strokes: [],
      texts: [],
      images: []
    };
  }

  // 让纸张宽高比精确匹配当前屏幕可用区域，铺满整屏（对齐 Notability 无边距体验）
  function autoPreset() {
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    // 顶部栏约 60px + 底部工具坞约 100px，纸张填满这两者之间
    const availW = Math.max(600, vw - 8);
    // 横屏时工具坞更矮，竖屏时更高，据此估算顶部栏+底部工具坞总高
    const chrome = vw >= vh ? 156 : 165;
    const availH = Math.max(500, vh - chrome);
    return { id: 'auto', w: Math.round(availW), h: Math.round(availH) };
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
      layers: defaultLayers(),
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
    // Notability 式：工具坞默认收起，只留右下角小把手，纸张铺满
    D.dock.classList.add('is-collapsed');

    D.docTitle.value = book.name || '未命名';
    await loadPage(0, true);
    requestAnimationFrame(() => {
      // HTML 笔记默认进「编辑模式」：HTML 作为底稿背景铺满，可在上面直接手写批注
      // （阅读模式改为用户手动点顶栏「阅读」进入，纯看时才用）
      fitPage();   // 整页铺满屏幕
      S.ready = true;
      if (book.isHtml) {
        showHint('可直接手写批注 · 点顶栏「阅读」切换纯阅读', 3400);
      } else {
        const tip = S.pages.length > 1
          ? '双指缩放 · 两指拖动移动画面 · 两侧箭头翻页'
          : '双指缩放 · 两指拖动移动画面';
        setTimeout(() => showHint(tip, 3400), 500);
      }
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
    // 录音中翻页：录音属于原来那一页，先落盘再走
    if (!first && A.Record && A.Record.isRecording() && S.page) {
      await stopRecording();
      A.toast('已切换页面，录音保存到了上一页');
    }
    if (!first && S.page) {
      await persistPage(true);
    }
    if (!first) stopRecPlay();
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
    syncRecBar();
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
          onLink: (href) => followLink(href),
          onHash: (name) => jumpToAnchor(name)
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
    if (S.ruler.on) {
      S.ruler.y = A.clamp(S.ruler.y, 40, p.h - 40);
      placeRuler();
    }
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

  /* ═════════════ 网页链接与跳转 ═════════════ */

  /** 外部链接：交给系统浏览器 / 分享面板，绝不在应用内导航 */
  function followLink(href) {
    if (!href) return;
    if (href === 'form') { A.toast('表单提交已禁用'); return; }
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      A.openUrl(href);
      return;
    }
    if (/^#/.test(href)) { jumpToAnchor(decodeURIComponent(href.slice(1))); return; }
    A.toast('相对链接需要原文的目录结构，暂不支持：' + href.slice(0, 30));
  }

  /** 锚点跳转：算出目标在整篇文档里的绝对位置，换到对应页再挪视野 */
  function jumpToAnchor(name) {
    const p = S.page;
    if (!p || p.type !== 'html') { A.toast('当前页没有网页内容'); return; }
    const doc = D.frame && D.frame.contentDocument;
    if (!doc) { A.toast('网页还没准备好，稍后再试'); return; }
    if (!name || name === 'top') {
      goPage(0);
      flashAnchor(0, 0, 0);
      return;
    }
    let el = null;
    try {
      el = doc.getElementById(name) || doc.getElementsByName(name)[0] || null;
    } catch (e) { el = null; }
    if (!el) { A.toast('页内找不到「' + name + '」这个位置'); return; }

    const r = el.getBoundingClientRect();
    const docY = r.top + (p.sliceTop || 0);   // 文档内的绝对纵坐标

    // 找出这个纵坐标落在哪一页
    let idx = S.idx;
    for (let i = 0; i < S.pages.length; i++) {
      const pp = S.pages[i];
      if (pp.type !== 'html') continue;
      const top = pp.sliceTop || 0;
      const bot = top + (pp.h || HTML_SLICE_H);
      if (docY >= top && docY < bot) { idx = i; break; }
    }
    if (idx !== S.idx) goPage(idx);

    const pageY = docY - (S.pages[idx].sliceTop || 0);
    // 把目标挪到视野上方 1/6 处，留出上下文
    const st = stageRect();
    S.view.y = Math.min(st.height * 0.16, 120) - pageY * S.view.scale;
    clampView();
    flashAnchor(0, pageY, pageSize().w, r.height || 28);
    A.toast('已跳到「' + name + '」');
  }

  /** 在页面上闪一个框，告诉用户目标在哪 */
  function flashAnchor(x, y, w, h) {
    if (!D.selSvg) return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x - 6);
    rect.setAttribute('y', y - 4);
    rect.setAttribute('width', Math.max(20, w + 12));
    rect.setAttribute('height', Math.max(18, h + 8));
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', 'rgba(224,178,99,.16)');
    rect.setAttribute('stroke', '#e0b263');
    rect.setAttribute('stroke-width', '1.6');
    rect.setAttribute('class', 'anchor-flash');
    D.selSvg.appendChild(rect);
    setTimeout(() => { try { rect.remove(); } catch (e) { } }, 1700);
  }

  /** 轻点（不是画）落在链接上时，跟随链接而不是留一个墨点 */
  function probeLinkAt(pt) {
    const p = S.page;
    if (!p || p.type !== 'html' || !S.htmlVisible) return null;
    const doc = D.frame && D.frame.contentDocument;
    if (!doc || !doc.elementFromPoint) return null;
    let el = null;
    try { el = doc.elementFromPoint(pt.x, pt.y); } catch (e) { return null; }
    if (!el || !el.closest) return null;
    const a = el.closest('a[href]');
    if (!a) return null;
    return a.getAttribute('href') || null;
  }

  function tryTapLink(stroke) {
    if (!stroke || !stroke.pts || stroke.pts.length > 6) return false;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const pt of stroke.pts) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    if (maxX - minX > 8 || maxY - minY > 8) return false;
    const href = probeLinkAt({ x: minX, y: minY });
    if (!href) return false;
    followLink(href);
    return true;
  }

  function pageSize() {
    const p = S.page;
    return { w: (p && p.w) || 794, h: (p && p.h) || 1123 };
  }

  /* ═════════════ 阅读模式 ═════════════ */

  let readerOpen = false, readerScale = 1, readerStartY = 0, readerScrolled = false;

  /* ───── 阅读模式手写批注 ───── */
  let rInk = null, rInkCtx = null, rTool = 'pen';
  let rStrokes = [];        // 已完成笔迹 [{tool,color,size,pts}]
  let rCur = null;          // 当前绘制中
  let rUndoStack = [];

  function initReaderInk() {
    rInk = A.$('#readerInk');
    if (!rInk) return;
    rInkCtx = rInk.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    rInk._dpr = dpr;
    bindReaderInk();
    // iframe 滚动时，笔迹（内容坐标）要跟着内容一起走 → 重绘
    const frame = A.$('#readerFrame');
    if (frame) {
      frame.addEventListener('load', () => {
        try {
          frame.contentWindow.addEventListener('scroll', () => repaintReaderInk(), { passive: true });
        } catch (e) { }
      });
    }
  }

  function readerInkSize() {
    const frame = A.$('#readerFrame');
    if (!rInk || !frame) return;
    const w = frame.clientWidth, h = frame.clientHeight;
    const dpr = rInk._dpr || 1;
    rInk.width = Math.max(1, Math.round(w * dpr));
    rInk.height = Math.max(1, Math.round(h * dpr));
    rInk.style.width = w + 'px';
    rInk.style.height = h + 'px';
    rInkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    repaintReaderInk();
  }

  function readerScrollOffset() {
    const frame = A.$('#readerFrame');
    if (!frame || !frame.contentWindow) return 0;
    try { return frame.contentWindow.scrollY || 0; } catch (e) { return 0; }
  }

  function repaintReaderInk() {
    if (!rInkCtx) return;
    const w = rInk.width / (rInk._dpr || 1), h = rInk.height / (rInk._dpr || 1);
    const off = readerScrollOffset();
    rInkCtx.clearRect(0, 0, w, h);
    rInkCtx.save();
    rInkCtx.translate(0, -off);   // 笔迹存内容坐标，绘制时减去当前滚动偏移
    rStrokes.forEach(s => drawReaderStroke(rInkCtx, s));
    if (rCur) drawReaderStroke(rInkCtx, rCur);
    rInkCtx.restore();
  }

  function drawReaderStroke(ctx, s) {
    const pts = s.pts;
    if (!pts || pts.length < 1) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.tool === 'marker') {
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = s.color || '#f2c14e';
      ctx.lineWidth = (s.size || 14);
    } else if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = (s.size || 24);
    } else {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color || '#1c1c1e';
      ctx.lineWidth = (s.size || 3);
    }
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = s.tool === 'eraser' ? 'rgba(0,0,0,1)' : (s.color || '#1c1c1e');
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function readerPoint(e) {
    const r = rInk.getBoundingClientRect();
    const off = readerScrollOffset();
    // 笔迹存「内容坐标」：屏幕坐标 + 当前滚动偏移，这样内容滚动时笔迹跟着内容走
    return { x: e.clientX - r.left, y: e.clientY - r.top + off };
  }

  function bindReaderInk() {
    if (!rInk) return;
    rInk.addEventListener('pointerdown', (e) => {
      if (rTool === 'undo') return;
      const pt = readerPoint(e);
      rCur = {
        tool: rTool,
        color: S.color || '#1c1c1e',
        size: rTool === 'marker' ? 14 : (rTool === 'eraser' ? 24 : Math.max(2.5, S.size || 3)),
        pts: [pt]
      };
      try { rInk.setPointerCapture(e.pointerId); } catch (err) { }
      repaintReaderInk();
      e.preventDefault();
    });
    rInk.addEventListener('pointermove', (e) => {
      if (!rCur) return;
      rCur.pts.push(readerPoint(e));
      repaintReaderInk();
      e.preventDefault();
    });
    rInk.addEventListener('pointerup', (e) => {
      if (!rCur) return;
      if (rCur.pts.length === 1) {
        rCur.pts.push({ x: rCur.pts[0].x + 0.1, y: rCur.pts[0].y + 0.1 });
      }
      rStrokes.push(rCur);
      rCur = null;
      repaintReaderInk();
      e.preventDefault();
    });
    rInk.addEventListener('pointercancel', () => { rCur = null; });
  }

  function setReaderTool(t) {
    if (t === 'undo') {
      rStrokes.pop();
      repaintReaderInk();
      return;
    }
    rTool = t;
    A.$$('.rtool').forEach(b => b.classList.toggle('is-on', b.dataset.rt === t));
  }


  /* ═════════════ 图层面板 ═════════════ */

  function openLayersPanel() {
    const p = S.page;
    if (!p) return;
    const layers = ensureLayers(p);

    function build(node) {
      const counts = {};
      (p.strokes || []).forEach(s => {
        const k = s.layer || 'l0';
        counts[k] = (counts[k] || 0) + 1;
      });

      node.innerHTML = '<div class="ly-list"></div>';
      const list = node.querySelector('.ly-list');

      // 顶层显示在最上面
      layers.slice().reverse().forEach(l => {
        const row = A.el('div', 'ly-row' + (l.id === S.layer ? ' is-cur' : ''));
        const eye = A.el('button', 'ly-eye' + (l.visible === false ? ' is-off' : ''));
        eye.innerHTML = l.visible === false
          ? '<svg viewBox="0 0 24 24" class="ico"><path d="M4 4l16 16"/><path d="M9.5 5.4A10 10 0 0112 5c5.5 0 9.5 6 9.5 6a17 17 0 01-2.6 3.3"/><path d="M6.3 7.2A17 17 0 002.5 11S6.5 17 12 17a9.6 9.6 0 003.6-.7"/></svg>'
          : '<svg viewBox="0 0 24 24" class="ico"><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/></svg>';
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          l.visible = l.visible === false;
          markDirty();
          repaintInk();
          build(node);
        });
        row.appendChild(eye);

        const name = A.el('span', 'ly-name');
        name.textContent = l.name;
        name.contentEditable = 'true';
        name.spellcheck = false;
        name.addEventListener('blur', () => {
          l.name = (name.textContent || '').trim().slice(0, 20) || '图层';
          name.textContent = l.name;
          markDirty();
        });
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        row.appendChild(name);

          const num = A.el('span', 'ly-count');
        num.textContent = (counts[l.id] || 0) + ' 笔';
        row.appendChild(num);

        const lock = A.el('button', 'ly-mini' + (l.locked ? ' is-on' : ''));
        lock.textContent = l.locked ? '锁' : '开';
        lock.title = '锁定后这一层不会被误画';
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          l.locked = !l.locked;
          markDirty();
          build(node);
        });
        row.appendChild(lock);

        if (layers.length > 1) {
          const del = A.el('button', 'ly-mini ly-mini--danger');
          del.textContent = '×';
          del.title = '删除图层（层里的笔迹会被删掉）';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            const at = layers.indexOf(l);
            if (at < 0) return;
            const before = p.strokes.slice();
            const removed = p.strokes.filter(s => (s.layer || 'l0') === l.id);
            p.strokes = p.strokes.filter(s => (s.layer || 'l0') !== l.id);
            layers.splice(at, 1);
            if (S.layer === l.id) S.layer = layers[layers.length - 1].id;
            pushUndo({ t: 'lydel', layer: l, at: at, strokes: removed, before: before });
            markDirty();
            repaintInk();
            build(node);
            A.toast('已删除图层，可撤销');
          });
          row.appendChild(del);
        }

        row.addEventListener('click', () => {
          S.layer = l.id;
          markDirty();
          build(node);
        });

        list.appendChild(row);
      });

      const subEl = document.querySelector('#sheet .sheet-title .sub');
      if (subEl) subEl.textContent = '第 ' + (p.order + 1) + ' 页 · 共 ' + layers.length + ' 层';
    }

    const node = A.el('div', 'ly-wrap');
    build(node);

    const acts = A.el('div', 'ly-acts');
    const addBtn = A.el('button', 'chip-f');
    addBtn.textContent = '＋ 新建图层';
    addBtn.addEventListener('click', () => {
      const n = layers.length + 1;
      const nl = { id: A.uid('ly'), name: '图层 ' + n, visible: true, locked: false };
      layers.push(nl);
      S.layer = nl.id;
      pushUndo({ t: 'lyadd', layer: nl });
      markDirty();
      build(node);
    });
    const mergeBtn = A.el('button', 'chip-f');
    mergeBtn.textContent = '合并到底层';
    mergeBtn.addEventListener('click', () => {
      if (layers.length < 2) { A.toast('只有一个图层'); return; }
      const base = layers[0];
      const before = p.strokes.slice();
      p.strokes.forEach(s => { if ((s.layer || 'l0') !== base.id) s.layer = base.id; });
      const keep = layers[0];
      p.layers = [keep];
      S.layer = keep.id;
      pushUndo({ t: 'lymerge', before: before, layersBefore: layers.slice() });
      markDirty();
      repaintInk();
      build(node);
      A.toast('已合并为一个图层');
    });
    acts.appendChild(addBtn);
    acts.appendChild(mergeBtn);
    node.appendChild(acts);

    A.sheet.open({
      title: '图层',
      sub: '第 ' + (p.order + 1) + ' 页 · 共 ' + layers.length + ' 层',
      node: node
    });
  }

  /* ═════════════ 录音与回放 ═════════════ */

  function recBar() {
    if (!D.recBar) D.recBar = A.$('#recBar');
    return D.recBar;
  }

  function showRecBar(on) {
    const bar = recBar();
    if (!bar) return;
    bar.hidden = !on;
  }

  function paintRecUI(ms, dur) {
    if (D.recTime) D.recTime.textContent = A.Record.fmt(ms);
    const pct = dur ? Math.min(100, ms / dur * 100) : 0;
    if (D.recFill) D.recFill.style.width = pct + '%';
  }

  async function stopRecording() {
    const p = S.page;
    const b = S.book;
    if (!p || !b) return null;
    const info = await A.Record.stop(b.id, p.id);
    const bar = recBar();
    if (bar) bar.classList.remove('is-rec');
    if (D.recPlay) D.recPlay.disabled = false;
    if (info) {
      p.rec = { key: info.key, dur: info.dur, at: A.now() };
      paintRecUI(info.dur, info.dur);
      markDirty();
      await persistPage(true);
      A.toast('录音已保存，' + A.Record.fmt(info.dur) + '（回放时笔迹会跟着重现）', 3600);
    }
    // 录完不能把浮条一起收掉，否则用户找不到 ▶ 回放
    if (p && p.rec) { showRecBar(true); if (D.recPlay) D.recPlay.disabled = false; }
    return info;
  }

  /* ■ 按钮：录音中就停录音，否则停回放 */
  function stopRecOrPlay() {
    if (A.Record && A.Record.isRecording()) { stopRecording(); return; }
    stopRecPlay();
    A.toast('已停止回放');
  }

  async function toggleRec() {
    if (!A.Record) { A.toast('录音模块未加载'); return; }

    if (A.Record.isRecording()) {
      await stopRecording();
      return;
    }

    if (!S.page) return;
    const started = await A.Record.start(S.page);
    if (!started) return;

    showRecBar(true);
    const bar = recBar();
    if (bar) bar.classList.add('is-rec');
    if (D.recPlay) D.recPlay.disabled = true;
    A.Record.onTick = (ms) => paintRecUI(ms, 0);
    A.toast('正在录音 · 现在写的每一笔都会记住时间', 2800);
  }

  async function playRec() {
    const p = S.page;
    if (!p || !p.rec || !p.rec.key) {
      A.toast('这一页还没有录音');
      return;
    }
    showRecBar(true);
    const dur = p.rec.dur || 0;
    A.toast('回放中 · 笔迹会按当时的节奏重写一遍', 2600);

    S.playT = 0;
    S._lastVisible = -1;
    repaintInk();

    const tickRedraw = () => {
      if (S.playT == null) { S._playRaf = 0; return; }
      const n = visibleStrokes().length;
      if (n !== S._lastVisible) {
        S._lastVisible = n;
        repaintInk();
      }
      S._playRaf = requestAnimationFrame(tickRedraw);
    };
    S._playRaf = requestAnimationFrame(tickRedraw);

    await A.Record.play(p.rec.key, 0,
      (t, total) => {
        S.playT = t;
        paintRecUI(t, total > 0 && isFinite(total) ? total : dur);
      },
      () => {
        if (S._playRaf) { cancelAnimationFrame(S._playRaf); S._playRaf = 0; }
        S.playT = null;
        S._lastVisible = -1;
        repaintInk();
        paintRecUI(dur, dur);
        const bar = recBar();
        if (bar) bar.classList.remove('is-rec');
      }
    );
  }

  function stopRecPlay() {
    A.Record.pause();
    if (S._playRaf) { cancelAnimationFrame(S._playRaf); S._playRaf = 0; }
    S.playT = null;
    S._lastVisible = -1;
    repaintInk();
    const p = S.page;
    if (p && p.rec) paintRecUI(0, p.rec.dur || 0);
    const bar = recBar();
    if (bar) bar.classList.remove('is-rec');
  }

  /* 切页时把该页录音状态同步到浮条 */
  function syncRecBar() {
    const p = S.page;
    if (!p || !p.rec) {
      stopRecPlay();
      showRecBar(false);
      return;
    }
    showRecBar(true);
    paintRecUI(0, p.rec.dur || 0);
    if (D.recPlay) D.recPlay.disabled = false;
  }

  function openReader() {
    const p = S.page;
    if (!p) return;
    const src = p.type === 'html' ? currentSrc() : null;
    if (!src) { A.toast('只有导入的 HTML 笔记才有阅读模式'); return; }

    const ov = A.$('#reader'), frame = A.$('#readerFrame');
    const docBox = A.$('#readerDoc'), scroll = A.$('#readerScroll');
    if (!ov || !frame || !docBox) return;

    const title = A.$('#readerTitle');
    if (title) title.textContent = (S.book && S.book.name) || '阅读';

    const pw = p.w || 794;
    // iframe 内部滚动（高度=视口高），这样 HTML 里的 position:fixed 目录栏能固定在左侧不跟着滚
    const avail = window.innerWidth - 24;
    readerScale = 1;
    readerStartY = p.sliceTop || 0;
    readerScrolled = false;

    frame.style.width = avail + 'px';
    frame.style.transform = 'none';
    frame.style.transformOrigin = '0 0';
    frame.style.height = '100%';
    docBox.style.height = '100%';
    docBox.style.width = avail + 'px';
    if (scroll) scroll.scrollTop = 0;

    readerOpen = true;
    ov.hidden = false;
    ov.classList.add('is-on');
    frame.srcdoc = A.HtmlPage.prepare(src, { reader: true });
    initReaderInk();

    setTimeout(readerFit, 350);
    setTimeout(readerFit, 1100);
    setTimeout(readerFit, 2400);
  }

  function readerFit() {
    if (!readerOpen) return;
    const frame = A.$('#readerFrame');
    if (!frame) return;
    readerInkSize();   // 同步 ink 画布尺寸到视口
    if (!readerScrolled) {
      readerScrolled = true;
      // iframe 内部滚动：定位到导入时的起始位置
      if (readerStartY > 0) {
        try { frame.contentWindow.scrollTo(0, readerStartY); } catch (e) { }
      }
    }
  }

  /** 阅读模式下的锚点：滚动 iframe 内部 */
  function readerScrollTo(name) {
    const frame = A.$('#readerFrame');
    if (!frame) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    let el = null;
    try { el = doc.getElementById(name) || doc.getElementsByName(name)[0] || null; } catch (e) { el = null; }
    if (!el) return;
    const y = el.getBoundingClientRect().top + (frame.contentWindow.scrollY || 0);   // 文档内绝对偏移
    try { frame.contentWindow.scrollTo({ top: Math.max(0, y - 12), behavior: 'smooth' }); } catch (e) { }
  }

  function closeReader() {    const ov = A.$('#reader'), frame = A.$('#readerFrame');
    readerOpen = false;
    readerScrolled = false;
    if (ov) { ov.hidden = true; ov.classList.remove('is-on'); }
    if (frame) frame.srcdoc = '<!doctype html><html><body style="background:#fff"></body></html>';
  }

  function qualityFor(w, h) {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    // 用真实视图缩放算采样率：放到 400% 还按 1.4 倍备份，笔迹一定发虚
    const z = A.clamp(S.view.scale, 1, 3);
    const area = w * h;
    // 面积越大，质量倍数越低，控制内存（iPad 上三层画布很吃内存）
    let q = dpr * z;
    const maxArea = 8.5e6;
    if (area * q * q > maxArea) q = Math.sqrt(maxArea / area);
    return A.clamp(q, 1, 3);
  }

  function resizeCanvases() {
    const { w, h } = pageSize();
    const q = qualityFor(w, h);
    S.quality = q;
    D.pageEl.style.width = w + 'px';
    D.pageEl.style.height = h + 'px';
    [D.paperCv, D.baseCv, D.liveCv, D.laserCv].forEach(cv => {
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

    // PDF / 图片底图：画在纸张之上、笔迹之下，笔迹坐标就是页面坐标
    if (p.bgKey) paintBg(g, p, w, h);
  }

  /* 底图位图缓存：翻页/重绘不重复解码 */
  const bgCache = new Map();

  function paintBg(g, p, w, h) {
    const key = p.bgKey;
    const hit = bgCache.get(key);
    if (hit && hit.complete && hit.naturalWidth) {
      g.drawImage(hit, 0, 0, w, h);
      return;
    }
    if (hit) return; // 正在加载
    const img = new Image();
    bgCache.set(key, img);
    img.onload = () => {
      if (S.page && S.page.bgKey === key) paintPaper();
    };
    img.onerror = () => {
      bgCache.delete(key);
    };
    (async () => {
      try {
        const data = await A.db.getAsset(key);
        if (data) img.src = data;
      } catch (e) { }
    })();
  }

  function repaintInk() {
    const cv = D.baseCv;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(S.quality, 0, 0, S.quality, 0, 0);
    if (S.page) A.Ink.drawAll(g, visibleStrokes());
  }

  /* 回放录音时只显示「已经写出来」的笔画；隐藏图层的笔也不画 */
  function visibleStrokes() {
    const p = S.page;
    const list = (p && p.strokes) || [];
    const layers = p ? ensureLayers(p) : null;
    const hidden = layers ? new Set(layers.filter(l => l.visible === false).map(l => l.id)) : null;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (S.playT != null && s.t != null && s.t > S.playT) continue;
      if (hidden && s.layer && hidden.has(s.layer)) continue;
      out.push(s);
    }
    return out;
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
    // 手柄是按屏幕尺寸算的，缩放后要跟着重画
    if (S.sel && S.mode !== 'selXform') drawSelectionBox();
    const zv = A.$('#btnZoomReset');
    if (zv) zv.textContent = Math.round(v.scale * 100) + '%';
  }

  function stageRect() { return D.stage.getBoundingClientRect(); }

  function fitWidth(instant) {
    const { w } = pageSize();
    const r = stageRect();
    const pad = 12;   // 减小留白，让纸张尽量贴满屏幕
    const s = A.clamp((r.width - pad * 2) / w, 0.2, 3);
    S.view.scale = s;
    S.view.x = (r.width - w * s) / 2;
    S.view.y = pad;
    S.view.fit = 'w';
    applyView();
    scheduleQuality();
  }

  function fitPage() {
    const { w, h } = pageSize();
    const r = stageRect();
    const pad = 12;   // 减小留白，让纸张尽量铺满屏幕
    const s = A.clamp(Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h), 0.15, 3);
    S.view.scale = s;
    S.view.x = (r.width - w * s) / 2;
    S.view.y = Math.max(pad, (r.height - h * s) / 2);
    S.view.fit = 'p';
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
    S.view.fit = null;
    applyView();
    clampView();
    scheduleQuality();
  }

  function scheduleQuality() {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      const { w, h } = pageSize();
      const q = qualityFor(w, h);
      if (Math.abs(q - S.quality) > 0.18) {
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
    if (t === S.tool && t !== 'image' && t !== 'text' && t !== 'laser') {
      // 套索：再点一次在「自由 / 矩形」间切换（Notability 同款操作）
      if (t === 'lasso') {
        S.lassoMode = S.lassoMode === 'freeform' ? 'rect' : 'freeform';
        cancelSelection();   // 清掉旧选区，避免切换后起始点落在旧框内误触发移动
        const btn = A.$$('.tool[data-tool="lasso"] span', D.toolRow)[0];
        if (btn) btn.textContent = S.lassoMode === 'rect' ? '矩形框选' : '套索';
        showHint(S.lassoMode === 'rect' ? '矩形套索：拖出方框选中内容' : '自由套索：随手圈选内容');
        return;
      }
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
    if (t === 'tape') {
      showHint('胶带：拖动画出遮挡 · 点一下揭开 · 再点盖回');
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

  /* ───────────── 长按取词（英语阅读） ───────────── */
  let lpTimer = 0, lpStart = null, lpFired = false;

  function clearLookupTimer() { clearTimeout(lpTimer); lpTimer = 0; lpStart = null; }

  function wordAtPoint(pt, cx, cy) {
    const p = S.page;
    if (!p) return null;
    if (Array.isArray(p.pdfWords) && p.pdfWords.length) {
      let best = null, bestA = 1e9;
      for (const w of p.pdfWords) {
        if (pt.x >= w.x - 3 && pt.x <= w.x + w.w + 4 && pt.y >= w.y - 3 && pt.y <= w.y + w.h + 4) {
          const a = w.w * w.h;   // 命中多个时取面积最小的，避免大字块盖住小词
          if (a < bestA) { best = w; bestA = a; }
        }
      }
      if (best) return best.t;
    }
    if (p.type === 'html' && D.frame) {
      try {
        const doc = D.frame.contentDocument;
        if (!doc) return null;
        const r = D.frame.getBoundingClientRect();
        const x = cx - r.left, y = cy - r.top;
        let node = null, off = 0;
        if (doc.caretPositionFromPoint) {
          const c = doc.caretPositionFromPoint(x, y);
          if (c) { node = c.offsetNode; off = c.offset; }
        } else if (doc.caretRangeFromPoint) {
          const c = doc.caretRangeFromPoint(x, y);
          if (c) { node = c.startContainer; off = c.startOffset; }
        }
        if (node && node.nodeType === 3) {
          const txt = node.nodeValue || '';
          const ok = ch => /[A-Za-z'’-]/.test(ch);
          let a = off, b = off;
          while (a > 0 && ok(txt[a - 1])) a--;
          while (b < txt.length && ok(txt[b])) b++;
          const w = txt.slice(a, b).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
          if (w.length > 1) return w;
        }
      } catch (err) { }
    }
    return null;
  }

  function armLookup(e, pt) {
    const p = S.page;
    if (!p) return;
    const hasWords = Array.isArray(p.pdfWords) && p.pdfWords.length;
    if (!hasWords && p.type !== 'html') return;
    if (S.tool === 'shape' || S.tool === 'text' || S.tool === 'hand' || S.tool === 'tape' || S.tool === 'laser') return;
    lpFired = false;
    lpStart = { x: e.clientX, y: e.clientY, pt: pt, cx: e.clientX, cy: e.clientY };
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      const st = lpStart;
      lpTimer = 0;
      if (!st) return;
      const w = wordAtPoint(st.pt, st.cx, st.cy);
      if (!w) return;
      lpFired = true;
      if (S.stroke) discardStroke();
      A.Words && A.Words.lookup(w, {
        bookName: S.book && S.book.name, pageId: p.id, speak: true
      });
    }, 520);
  }

  function isTouchPan(e) {
    // 手指触屏一律当「平移画面」，只有触控笔(pen)才能写字
    return e.pointerType === 'touch';
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

    // 两指 → 手势（先记录双指落下时间/位置，用于区分「双指轻点撤销」和「双指捏合缩放」）
    if (S.pointers.size === 2) {
      const arr = Array.from(S.pointers.values());
      S.twoFinger = { t: Date.now(), x: (arr[0].x + arr[1].x) / 2, y: (arr[0].y + arr[1].y) / 2, moved: false };
      beginGesture();
      return;
    }
    if (S.pointers.size > 2) return;

    const inside = isInsidePage(e.clientX, e.clientY);
    const pt = toPage(e.clientX, e.clientY);
    if (inside) armLookup(e, pt);

    // 取色器：点一下取色，不落笔
    if (S.picking) {
      if (inside) {
        const hex = probeColorAt(pt);
        if (hex) {
          setColor(hex);
          A.toast('已取色 ' + hex.toUpperCase());
        }
      }
      setPicking(false);
      return;
    }

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
    } else if (t === 'laser') {
      startLaser(pt);
    } else if (t === 'text') {
      addTextBox(pt);
      S.mode = null;
    } else if (t === 'tape') {
      // 胶带：先记录按下点，拖动才画遮挡；原地抬起则是点按显隐
      S.mode = 'tapePending';
      S.tapTape = { id: e.pointerId, s: hitTapeAt(pt), pt: pt, moved: false };
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
    if (lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 8) clearLookupTimer();
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
        S.sel.strokes.forEach(s => {
          s.pts.forEach(q => { q.x += dx; q.y += dy; });
          s._sm = null;   // 不清缓存的密化点，画面会原地不动
        });
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

    if (S.mode === 'tapePending' && S.tapTape && S.tapTape.id === e.pointerId) {
      const pt = toPage(e.clientX, e.clientY);
      const tt = S.tapTape;
      if (Math.hypot(pt.x - tt.pt.x, pt.y - tt.pt.y) > 4) {
        // 移动超过阈值 → 转为画新胶带，从按下点起笔
        tt.moved = true;
        startStroke(tt.pt, e.pressure, 'tape');
        appendPoint(S.stroke, pt, e.pressure);
        paintLive(S.stroke);
      }
      return;
    }

    if (S.mode === 'draw' && S.stroke) {
      const pt = toPage(e.clientX, e.clientY);
      // 预测点只用来"提前画"，但它会落进笔迹数据，收笔时多出一小段甩尾尖刺
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

    if (S.mode === 'laser') {
      const pt = toPage(e.clientX, e.clientY);
      moveLaser(pt);
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
    // 长按已经弹了查词，这一下不算笔迹
    if (lpFired) {
      lpFired = false;
      clearLookupTimer();
      if (S.stroke) discardStroke();
      S.mode = null; S.drawId = null;
      return;
    }
    clearLookupTimer();

    if (S.gesture) {
      if (S.pointers.size < 2) {
        // 双指几乎同时落下、很快抬起、且几乎没移动 → 双指轻点 = 撤销（Notability 标志性手势）
        const tf = S.twoFinger;
        const dt = tf ? Date.now() - tf.t : Infinity;
        if (tf && !tf.moved && dt < 320) {
          undo();
          if (A.haptic) A.haptic(8);
        }
        S.twoFinger = null;
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

    // 胶带原地抬起（没拖）→ 切换显隐
    if (S.mode === 'tapePending') {
      const tt = S.tapTape;
      S.tapTape = null;
      if (tt && !tt.moved && tt.s) {
        tt.s.hidden = !tt.s.hidden;
        repaintInk();
        markDirty();
        if (A.haptic) A.haptic(6);
      }
      S.mode = null;
      S.drawId = null;
      return;
    }

    if (S.drawId !== e.pointerId) { S.mode = null; return; }

    if (S.mode === 'draw' && S.stroke) {
      if (tryTapLink(S.stroke)) {
        // 轻点命中链接：跟随链接，不留墨点
        discardStroke();
        S.mode = null; S.drawId = null;
        return;
      }
      finishStroke();
    } else if (S.mode === 'eraseStroke') {
      S.mode = null;
    } else if (S.mode === 'lasso') {
      finishLasso();
    } else if (S.mode === 'laser') {
      finishLaser();
    } else if (S.mode === 'shape' && S.stroke) {
      finishShape();
    }
    S.mode = null;
    S.drawId = null;
  }

  function onPointerCancel(e) {
    S.pointers.delete(e.pointerId);
    if (S.gesture) { S.gesture = null; S.twoFinger = null; return; }
    if (S.stroke && S.mode === 'shape') { S.stroke = null; clearLive(); }
    if (S.mode === 'laser') finishLaser();
    S.tapTape = null;
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
    // 双指移动超过阈值 → 判定为缩放，取消「双指轻点撤销」候选
    if (S.twoFinger && Math.abs(d - S.gesture.d0) > 4) S.twoFinger.moved = true;
    S.view.scale = s;
    S.view.x = (mid.x - r.left) - S.gesture.px * s;
    S.view.y = (mid.y - r.top) - S.gesture.py * s;
    applyView();
  }

  /* ═════════════ 书写 ═════════════ */

  /* ───────────── 激光笔（临时指示，不落墨、不进撤销） ───────────── */
  let laserPts = null;   // 当前激光轨迹点（页面坐标）
  let laserFadeT = 0;    // 淡出定时器

  function clearLaserCanvas() {
    const cv = D.laserCv;
    if (!cv) return;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(S.quality, 0, 0, S.quality, 0, 0);
  }

  function resetLaserFade() {
    clearTimeout(laserFadeT);
    laserFadeT = 0;
    if (D.laserCv) {
      D.laserCv.style.transition = 'none';
      D.laserCv.style.opacity = '1';
    }
  }

  function paintLaser(pts) {
    const cv = D.laserCv;
    if (!cv) return;
    clearLaserCanvas();
    if (!pts || !pts.length) return;
    const g = cv.getContext('2d');
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (pts.length === 1) {
      const p = pts[0];
      g.beginPath(); g.arc(p.x, p.y, 9, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,60,60,.32)'; g.fill();
      g.beginPath(); g.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,140,140,.95)'; g.fill();
      g.restore();
      return;
    }
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    // 外圈光晕
    g.strokeStyle = 'rgba(255,60,60,.28)';
    g.lineWidth = 15;
    g.shadowColor = 'rgba(255,45,45,.9)';
    g.shadowBlur = 18;
    g.stroke();
    g.shadowBlur = 0;
    // 高亮亮核
    g.strokeStyle = 'rgba(255,140,140,.95)';
    g.lineWidth = 4.5;
    g.stroke();
    g.restore();
  }

  function startLaser(pt) {
    resetLaserFade();
    laserPts = [{ x: pt.x, y: pt.y }];
    S.mode = 'laser';
    paintLaser(laserPts);
  }

  function moveLaser(pt) {
    if (!laserPts) return;
    laserPts.push({ x: pt.x, y: pt.y });
    paintLaser(laserPts);
  }

  function finishLaser() {
    if (!laserPts) return;
    laserPts = null;
    const cv = D.laserCv;
    if (cv) {
      cv.style.transition = 'opacity 1.9s ease-out';
      cv.style.opacity = '0';
    }
    clearTimeout(laserFadeT);
    laserFadeT = setTimeout(() => {
      clearLaserCanvas();
      if (D.laserCv) { D.laserCv.style.transition = 'none'; D.laserCv.style.opacity = '1'; }
      laserFadeT = 0;
    }, 2050);
  }

  function startStroke(pt, pressure, forceTool) {
    const tool = forceTool || (S.tool === 'marker' ? 'marker' : (S.tool === 'pen' && S.kind === 'pencil' ? 'pencil' : 'pen'));
    const q = S.ruler.on ? snapToRuler(pt) : pt;
    // 起笔点在尺线附近 → 整笔都锁到尺线上，画长直线不会中途跑偏
    const rulerLock = S.ruler.on && (Math.abs(q.x - pt.x) > 0.01 || Math.abs(q.y - pt.y) > 0.01);
    // 当前层锁住了就不让画，避免误覆盖
    const cur = layerOf(S.page, S.layer);
    if (cur && cur.locked) {
      A.toast('「' + cur.name + '」已锁定，换个图层再写');
      return;
    }
    if (cur && cur.visible === false) {
      // 藏在看不见的层上写字会让人以为笔坏了
      cur.visible = true;
      A.toast('「' + cur.name + '」原本是隐藏的，已自动显示');
    }
    const s = {
      id: A.uid('sk'),
      tool: tool,
      kind: tool === 'pen' ? S.kind : (tool === 'pencil' ? 'pencil' : 'ball'),
      color: tool === 'eraser' ? '#000' : (tool === 'tape' ? tapeColor() : S.color),
      size: tool === 'tape' ? Math.max(6, S.size) : S.size,
      layer: (cur && cur.id) || 'l0',
      pts: [{ x: q.x, y: q.y, p: pressure || 0.5 }],
      _committed: 0,
      _rl: rulerLock
    };
    S.stroke = s;
    S.mode = 'draw';
    clearLive();
    paintLive(s);
  }

  function appendPoint(s, pt, pressure) {
    const p = (typeof pressure === 'number' && pressure > 0) ? A.clamp(pressure, 0.05, 1) : 0.5;
    const q = (S.ruler.on && s && s._rl) ? snapToRuler(pt, true) : (S.ruler.on ? snapToRuler(pt) : pt);
    A.Ink.addPoint(s, { x: q.x, y: q.y, p: p });
    s._sm = null;
  }

  /* ═════════════ 标尺 ═════════════ */

  function snapToRuler(pt, force) {
    const R = S.ruler;
    const cx = pageSize().w / 2, cy = R.y;
    const a = R.angle * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const t = (pt.x - cx) * dx + (pt.y - cy) * dy;
    const nx = cx + dx * t, ny = cy + dy * t;
    // 只有笔尖离尺线足够近才吸附，否则尺子会"吸住"整页；
    // force = 这一笔是从尺线附近起笔的，中途手抖也要继续按尺线画
    const keep = Math.max(10, S.size * 1.5);
    if (!force && Math.hypot(pt.x - nx, pt.y - ny) > keep) return pt;
    return { x: nx, y: ny };
  }

  function placeRuler() {
    const el = A.$('#ruler');
    if (!el) return;
    if (!S.ruler.on) { el.hidden = true; return; }
    el.hidden = false;
    el.style.top = S.ruler.y + 'px';
    el.style.transform = 'translate(-50%,-50%) rotate(' + S.ruler.angle + 'deg)';
  }

  function toggleRuler(force) {
    S.ruler.on = (typeof force === 'boolean') ? force : !S.ruler.on;
    const btn = A.$('#btnRuler');
    if (btn) btn.classList.toggle('is-on', S.ruler.on);
    placeRuler();
    if (S.ruler.on) A.toast('标尺已开：笔迹会贴着尺面走，拖圆钮可移动/旋转');
  }

  function bindRuler() {
    const el = A.$('#ruler');
    if (!el) return;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      const k = e.target && e.target.dataset ? e.target.dataset.k : null;
      if (!k) return;
      e.stopPropagation();
      e.preventDefault();
      const start = toPage(e.clientX, e.clientY);
      drag = { k, start, y0: S.ruler.y, a0: S.ruler.angle };
      try { e.target.setPointerCapture(e.pointerId); } catch (err) { }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.stopPropagation();
      const pt = toPage(e.clientX, e.clientY);
      const { h } = pageSize();
      if (drag.k === 'move') {
        S.ruler.y = A.clamp(drag.y0 + (pt.y - drag.start.y), 40, h - 40);
      } else {
        const cx = pageSize().w / 2;
        const ang = Math.atan2(pt.y - S.ruler.y, pt.x - cx) * 180 / Math.PI;
        S.ruler.angle = e.shiftKey ? ang : Math.round(ang / 5) * 5;
      }
      placeRuler();
    });
    const end = (e) => { if (drag) { drag = null; try { e.target.releasePointerCapture(e.pointerId); } catch (err) { } } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /* ═════════════ 取色器 ═════════════ */

  function rgbToHex(r, g, b) {
    const h = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2);
    return '#' + h(r) + h(g) + h(b);
  }

  function cssColorToHex(v) {
    const m = String(v || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return /^#[0-9a-f]{3,8}$/i.test(String(v)) ? String(v).slice(0, 7) : null;
    const parts = m[1].split(',').map(s => parseFloat(s));
    if (parts.length >= 4 && parts[3] < 0.08) return null;
    return rgbToHex(parts[0], parts[1], parts[2]);
  }

  /** 吸取颜色：优先网页元素的背景/文字色，其次笔迹像素，最后纸色 */
  function probeColorAt(pt) {
    const p = S.page;
    if (!p) return null;

    if (p.type === 'html' && S.htmlVisible && D.frame && D.frame.contentDocument) {
      try {
        const doc = D.frame.contentDocument;
        const win = doc.defaultView;
        let el = doc.elementFromPoint(pt.x, pt.y);
        let textColor = null;
        let guard = 0;
        while (el && el !== doc.documentElement && guard++ < 24) {
          if (el.nodeType === 1) {
            const cs = win.getComputedStyle(el);
            const bg = cssColorToHex(cs.backgroundColor);
            if (bg) return bg;
            if (!textColor) {
              const col = cssColorToHex(cs.color);
              if (col && !/^#(0{3}|fff{1,3})$/i.test(col.replace('#ffffff', '#fff'))) textColor = col;
            }
          }
          el = el.parentElement;
        }
        if (textColor) return textColor;
      } catch (e) { }
    }

    // 笔迹像素
    try {
      const sc = D.baseCv.width / (p.w || 1);
      const x = Math.round(pt.x * sc);
      const y = Math.round(pt.y * (D.baseCv.height / (p.h || 1)));
      if (x >= 0 && y >= 0 && x < D.baseCv.width && y < D.baseCv.height) {
        const d = D.baseCv.getContext('2d').getImageData(x, y, 1, 1).data;
        if (d[3] > 30) return rgbToHex(d[0], d[1], d[2]);
      }
    } catch (e) { }

    return p.paperColor || '#ffffff';
  }

  function setPicking(on) {
    S.picking = !!on;
    const btn = A.$('#btnPick');
    if (btn) btn.classList.toggle('is-picking', S.picking);
    if (S.picking) A.toast('取色器：点一下要取的颜色');
  }

  function paintLive(s) {
    const g = D.liveCv.getContext('2d');
    if (s.tool === 'pen') {
      // 不透明笔（钢笔/圆珠笔）渐进提交，避免每帧重画整笔
      const sm = (s._sm || (s._sm = A.Ink.densify(A.Ink.smoothPressure(s.pts))));
      const n = sm.length;
      if (n - s._committed > 46) {
        const to = n - 10;
        const bg = D.baseCv.getContext('2d');
        bg.save();
        bg.globalCompositeOperation = 'source-over';
        bg.globalAlpha = 1;
        A.Ink.drawPartial(bg, s, Math.max(0, s._committed - 1), to);
        bg.restore();
        s._committed = to;
      }
      clearLive();
      g.save();
      g.globalAlpha = 1;
      A.Ink.drawPartial(g, s, Math.max(0, s._committed - 1), sm.length);
      g.restore();
      return;
    }
    if (s.tool === 'eraser') {
      // 像素橡皮必须边拖边把墨迹层擦掉，否则手指底下毫无反馈
      const sm = (s._sm || (s._sm = A.Ink.densify(A.Ink.smoothPressure(s.pts))));
      const bg = D.baseCv.getContext('2d');
      bg.save();
      bg.globalCompositeOperation = 'destination-out';
      bg.globalAlpha = 1;
      A.Ink.drawPartial(bg, s, Math.max(0, (s._committed || 0) - 1), sm.length);
      bg.restore();
      s._committed = sm.length;
      clearLive();
      return;
    }
    // 半透明笔（荧光笔/铅笔）整笔重绘：分片提交会在切片重叠处叠出深色接缝
    clearLive();
    A.Ink.drawStroke(g, s);
  }

  function finishStroke() {
    const s = S.stroke;
    if (!s) return;
    S.stroke = null;
    clearLive();
    if (s.pts.length < 2 && s.tool !== 'eraser') {
      // 单点 → 画一个点
      s.pts.push({ x: s.pts[0].x + 0.01, y: s.pts[0].y + 0.01, p: s.pts[0].p });
      s._sm = null;
    }

    // 形状识别（perfect shape）：仅钢笔、未开标尺时尝试，识别保守
    if (s.tool === 'pen' && !S.ruler.on) {
      const rec = A.Ink.recognizeShape(s);
      if (rec) {
        const shape = {
          id: s.id,
          tool: 'shape',
          shape: rec.shape,
          color: s.color,
          size: Math.max(1.5, s.size),
          layer: s.layer || 'l0',
          pts: rec.pts.map(p => ({ x: p.x, y: p.y, p: 0.5 }))
        };
        S.page.strokes.push(shape);
        pushUndo({ t: 'shapeify', raw: s, shape: shape });
        repaintInk();
        markDirty();
        addStrokeCount();
        const label = rec.shape === 'line' ? '直线' : (rec.shape === 'rect' ? '矩形' : '椭圆');
        A.toast('已识别为' + label + ' · 撤销可还原手写');
        if (A.haptic) A.haptic(6);
        return;
      }
    }

    const bg = D.baseCv.getContext('2d');
    if (s.tool === 'pen') {
      const sm = (s._sm || (s._sm = A.Ink.densify(A.Ink.smoothPressure(s.pts))));
      bg.save();
      bg.globalAlpha = 1;
      A.Ink.drawPartial(bg, s, Math.max(0, s._committed - 1), sm.length);
      bg.restore();
    } else {
      A.Ink.drawStroke(bg, s);
    }
    delete s._committed;
    // 录音中记下这一笔的相对时间，回放时按进度重现（Notability 的做法）
    if (A.Record && A.Record.isRecording()) s.t = A.Record.stamp();
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

  /* ───────────── 胶带（背诵遮挡） ───────────── */
  function tapeColor() {
    return (S.page && S.page.paperColor) || '#ffffff';
  }

  /* 命中最上层胶带（含已揭开的，揭开状态仍要能点回盖住） */
  function hitTapeAt(pt) {
    const list = (S.page && S.page.strokes) || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.tool !== 'tape') continue;
      if (A.Ink.strokeHit(s, pt.x, pt.y, 6)) return s;
    }
    return null;
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
    S.lassoStart = pt;
    cancelSelection();
    drawLasso();
  }

  function drawLasso() {
    const pts = S.lassoPts || [];
    if (pts.length < 2) { D.selSvg.innerHTML = ''; return; }
    if (S.lassoMode === 'rect') {
      const a = S.lassoStart, b = pts[pts.length - 1];
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      D.selSvg.innerHTML = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
        '" fill="rgba(224,178,99,.10)" stroke="#e0b263" stroke-width="1.4" stroke-dasharray="5 4" />';
      return;
    }
    let d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (let i = 1; i < pts.length; i++) d += ' L' + pts[i].x + ' ' + pts[i].y + '';
    D.selSvg.innerHTML = '<path d="' + d + '" fill="rgba(224,178,99,.10)" stroke="#e0b263" stroke-width="1.4" stroke-dasharray="5 4" />';
  }

  function finishLasso() {
    const poly = S.lassoPts || [];
    D.selSvg.innerHTML = '';
    S.lassoPts = null;
    if (poly.length < 3 && S.lassoMode !== 'rect') { S.mode = null; return; }
    if (S.lassoMode === 'rect' && poly.length < 2) { S.mode = null; return; }
    let hits;
    if (S.lassoMode === 'rect') {
      const a = S.lassoStart, b = poly[poly.length - 1];
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      hits = S.page.strokes.filter(s => s.tool !== 'eraser' && A.Ink.strokeInRect(s, r));
      if (!hits.length) { A.toast('没有选中笔迹'); S.mode = null; return; }
      S.sel = { strokes: hits, bbox: A.Ink.bboxOf(hits, 8), poly: null, angle: 0 };
    } else {
      hits = S.page.strokes.filter(s => s.tool !== 'eraser' && A.Ink.strokeInPoly(s, poly));
      if (!hits.length) { A.toast('没有选中笔迹'); S.mode = null; return; }
      S.sel = { strokes: hits, bbox: A.Ink.bboxOf(hits, 8), poly: poly, angle: 0 };
    }
    drawSelectionBox();
    showCtxFloat();
    S.mode = null;
  }

  function drawSelectionBox() {
    if (!S.sel) { D.selSvg.innerHTML = ''; return; }
    const b = S.sel.bbox;
    const ang = S.sel.angle || 0;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    // 手柄要跟着视图缩放反向放大，否则缩小视图后点不中
    const R = A.clamp(9 / Math.max(0.3, S.view.scale), 7, 46);
    const cur = {
      nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize',
      n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab'
    };
    const hs = [
      ['nw', b.x, b.y], ['n', b.x + b.w / 2, b.y], ['ne', b.x + b.w, b.y],
      ['w', b.x, b.y + b.h / 2], ['e', b.x + b.w, b.y + b.h / 2],
      ['sw', b.x, b.y + b.h], ['s', b.x + b.w / 2, b.y + b.h], ['se', b.x + b.w, b.y + b.h]
    ];
    // 选框很窄/很扁时，边中点手柄会盖住中心，手指一拖就变成缩放
    const thinH = b.h < R * 4.2, thinW = b.w < R * 4.2;

    let svg = '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
      '" fill="rgba(224,178,99,.06)" stroke="#e0b263" stroke-width="1.2" stroke-dasharray="6 4" rx="4"/>';

    // 旋转手柄挂在顶部中间
    const rx = cx, ry = b.y - R * 3;
    svg += '<line x1="' + cx + '" y1="' + b.y + '" x2="' + rx + '" y2="' + ry +
      '" stroke="#e0b263" stroke-width="1.2" stroke-dasharray="3 3"/>';
    svg += '<circle data-h="rot" cx="' + rx + '" cy="' + ry + '" r="' + R +
      '" fill="rgba(224,178,99,.92)" stroke="rgba(20,20,22,.55)" stroke-width="1.2" style="pointer-events:auto;cursor:' + cur.rot + '"/>';

    hs.forEach(([k, x, y]) => {
      if (thinH && (k === 'n' || k === 's')) return;
      if (thinW && (k === 'e' || k === 'w')) return;
      svg += '<circle data-h="' + k + '" cx="' + x + '" cy="' + y + '" r="' + R +
        '" fill="#e0b263" stroke="rgba(20,20,22,.55)" stroke-width="1.2" style="pointer-events:auto;cursor:' + cur[k] + '"/>';
    });
    // 选区有角度时整框一起转，否则框和墨迹对不上
    D.selSvg.innerHTML = ang
      ? '<g transform="rotate(' + (ang * 180 / Math.PI) + ' ' + cx + ' ' + cy + ')">' + svg + '</g>'
      : svg;
  }

  /* ── 选区缩放 / 旋转 ── */

  function rotAbout(p, c, a) {
    if (!a) return { x: p.x, y: p.y };
    const cos = Math.cos(a), sin = Math.sin(a);
    const ox = p.x - c.x, oy = p.y - c.y;
    return { x: c.x + ox * cos - oy * sin, y: c.y + ox * sin + oy * cos };
  }

  /* 形状只存两个定义点，直接转点只会得到"轴对齐的矩形"。
     做变换前先按真实轮廓展开成普通笔迹，旋转才是真旋转。 */
  function bakeShapeInPlace(s) {
    if (!s || s.tool !== 'shape') return;
    const out = A.Ink.shapeOutline(s);
    if (!out || out.length < 2) return;
    s.tool = 'pen';
    s.kind = 'ball';
    s.shape = null;
    s.pts = out.map(q => ({ x: q.x, y: q.y, p: .5 }));
    s._sm = null;
  }

  function beginSelXform(handle, pt) {
    // 先留全原始信息：撤销时形状要按两个定义点原样还原
    const orig = S.sel.strokes.map(s => ({
      tool: s.tool, kind: s.kind, shape: s.shape,
      pts: s.pts.map(p => ({ x: p.x, y: p.y, p: p.p }))
    }));
    S.sel.strokes.forEach(bakeShapeInPlace);
    const a0 = S.sel.angle || 0;
    // 选区有角度时，bbox 已经是"内容坐标"里的框；此时再用世界坐标 AABB
    // 会让第一次拖手柄框突然放大 1.3 倍（旋转 45° 时最明显）
    const b = a0 ? { x: S.sel.bbox.x, y: S.sel.bbox.y, w: S.sel.bbox.w, h: S.sel.bbox.h }
      : A.Ink.bboxOf(S.sel.strokes, 8);
    S.sel.bbox = b;
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    S.selXform = {
      h: handle,
      b0: { x: b.x, y: b.y, w: b.w, h: b.h },
      c: c, a0: a0,
      rotA0: Math.atan2(pt.y - c.y, pt.x - c.x),
      start: rotAbout(pt, c, -a0),
      snap: S.sel.strokes.map(s => s.pts.map(p => ({ x: p.x, y: p.y }))),
      sizes: S.sel.strokes.map(s => s.size),
      orig: orig
    };
    S.mode = 'selXform';
  }

  function updateSelXform(ptPage) {
    const xf = S.selXform;
    if (!xf || !S.sel) return;
    const b0 = xf.b0, c = xf.c, a0 = xf.a0;

    if (xf.h === 'rot') {
      let ang = a0 + (Math.atan2(ptPage.y - c.y, ptPage.x - c.x) - xf.rotA0);
      // 只贴着 15° 整倍数时吸附，其余角度允许自由微调
      const STEP = Math.PI / 12;
      const near = Math.round(ang / STEP) * STEP;
      if (Math.abs(ang - near) < 0.055) ang = near;
      const d = ang - a0;
      const cos = Math.cos(d), sin = Math.sin(d);
      S.sel.strokes.forEach((s, si) => {
        const snap = xf.snap[si];
        s.pts.forEach((p, pi) => {
          const ox = snap[pi].x - c.x, oy = snap[pi].y - c.y;
          p.x = c.x + ox * cos - oy * sin;
          p.y = c.y + ox * sin + oy * cos;
        });
        s._sm = null;
      });
      S.sel.angle = ang;
      S.sel.rotated = true;
      drawSelectionBox();
      repaintInk();
      return;
    }

    // 缩放：先转回选区本地坐标系，缩完再转回去。
    // 轴对齐缩放在旋转之后一定会把角度压变形，所以必须按本地轴来拉。
    const pt = rotAbout(ptPage, c, -a0);
    let ax = b0.x, ay = b0.y;
    if (xf.h.indexOf('e') >= 0) ax = b0.x;
    if (xf.h.indexOf('w') >= 0) ax = b0.x + b0.w;
    if (xf.h.indexOf('s') >= 0) ay = b0.y;
    if (xf.h.indexOf('n') >= 0) ay = b0.y + b0.h;

    let sx = 1, sy = 1;
    if (xf.h.indexOf('e') >= 0 || xf.h.indexOf('w') >= 0) {
      const den = xf.start.x - ax;
      if (Math.abs(den) > 0.5) sx = A.clamp((pt.x - ax) / den, 0.05, 24);
    }
    if (xf.h.indexOf('n') >= 0 || xf.h.indexOf('s') >= 0) {
      const den = xf.start.y - ay;
      if (Math.abs(den) > 0.5) sy = A.clamp((pt.y - ay) / den, 0.05, 24);
    }
    // 按住不动的方向不缩放，避免意外拉扁
    if (xf.h === 'n' || xf.h === 's') sx = 1;
    if (xf.h === 'e' || xf.h === 'w') sy = 1;

    S.sel.strokes.forEach((s, si) => {
      const snap = xf.snap[si];
      s.pts.forEach((p, pi) => {
        const l = rotAbout(snap[pi], c, -a0);
        const back = rotAbout({ x: ax + (l.x - ax) * sx, y: ay + (l.y - ay) * sy }, c, a0);
        p.x = back.x; p.y = back.y;
      });
      const base = (xf.sizes && xf.sizes[si] != null) ? xf.sizes[si] : s.size;
      s.size = Math.max(0.6, base * Math.abs((sx + sy) / 2));
      s._sm = null;
    });

    // 锚点在哪边，框就从锚点往反方向长；直接拿 ax+宽 算会让 w/n/nw/sw 四个手柄反向
    const horiz = xf.h.indexOf('w') >= 0 ? -1 : (xf.h.indexOf('e') >= 0 ? 1 : 0);
    const vert = xf.h.indexOf('n') >= 0 ? -1 : (xf.h.indexOf('s') >= 0 ? 1 : 0);
    const x1 = horiz === 0 ? b0.x : (horiz > 0 ? ax : ax - b0.w * sx);
    const x2 = horiz === 0 ? b0.x + b0.w : (horiz > 0 ? ax + b0.w * sx : ax);
    const y1 = vert === 0 ? b0.y : (vert > 0 ? ay : ay - b0.h * sy);
    const y2 = vert === 0 ? b0.y + b0.h : (vert > 0 ? ay + b0.h * sy : ay);
    S.sel.bbox = {
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)
    };
    S.sel.angle = a0;
    drawSelectionBox();
    repaintInk();
  }

  function endSelXform() {
    const xf = S.selXform;
    S.selXform = null;
    S.mode = null;
    if (!xf || !S.sel) return;
    const after = S.sel.strokes.map(s => s.pts.map(p => ({ x: p.x, y: p.y })));
    let moved = Math.abs((S.sel.angle || 0) - xf.a0) > 0.008;
    for (let i = 0; i < after.length && !moved; i++) {
      for (let j = 0; j < after[i].length; j++) {
        if (Math.abs(after[i][j].x - xf.snap[i][j].x) > 0.4 ||
          Math.abs(after[i][j].y - xf.snap[i][j].y) > 0.4) { moved = true; break; }
      }
    }
    if (moved) {
      pushUndo({
        t: 'xform', strokes: S.sel.strokes.slice(),
        before: xf.snap, after: after,
        sizeBefore: xf.sizes || null,
        sizeAfter: S.sel.strokes.map(s => s.size),
        angleBefore: xf.a0 || 0,
        angleAfter: S.sel.angle || 0,
        boxBefore: { x: xf.b0.x, y: xf.b0.y, w: xf.b0.w, h: xf.b0.h },
        boxAfter: { x: S.sel.bbox.x, y: S.sel.bbox.y, w: S.sel.bbox.w, h: S.sel.bbox.h },
        orig: xf.orig || null
      });
      markDirty();
      showCtxFloat();
    }
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
    const ang = S.sel.angle || 0;
    let bx = b.x, by = b.y, bw = b.w, bh = b.h;
    if (ang) {
      // 旋转后的框，四个角决定的才是屏幕上真正的范围
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const cs = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
        .map(([x, y]) => rotAbout({ x: x, y: y }, c, ang));
      bx = Math.min.apply(null, cs.map(p => p.x));
      by = Math.min.apply(null, cs.map(p => p.y));
      bw = Math.max.apply(null, cs.map(p => p.x)) - bx;
      bh = Math.max.apply(null, cs.map(p => p.y)) - by;
    }
    const r = stageRect();
    const host = D.viewStu.getBoundingClientRect();
    const px = r.left + S.view.x + (bx + bw / 2) * S.view.scale;
    // 工具条放选区下方：上方要留给旋转手柄，否则手柄被盖住点不到
    const below = r.top + S.view.y + (by + bh) * S.view.scale + 14;
    const py = below;
    const el = D.ctxFloat;
    // 记下滚动位置：浮条挪到位时浏览器会把它滚进视口，画面会"跳一下"
    const sl = { x: D.stage.scrollLeft, y: D.stage.scrollTop };
    el.style.left = (px - host.left) + 'px';
    el.style.top = (py - host.top) + 'px';
    // 下方放不下（贴着工具栏）时翻到上方更远处
    requestAnimationFrame(() => {
      D.stage.scrollLeft = sl.x; D.stage.scrollTop = sl.y;
      const er = el.getBoundingClientRect();
      if (er.bottom > window.innerHeight - 8) {
        el.style.top = (r.top + S.view.y + by * S.view.scale - 56 - host.top) + 'px';
      }
    });
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
          // i 必须在删除前取，-1 会让撤销回来的笔迹全跑到最上层，遮挡关系就变了
          const items = sel.strokes.map(s => ({ s: s, i: S.page.strokes.indexOf(s) }));
          S.page.strokes = S.page.strokes.filter(s => sel.strokes.indexOf(s) < 0);
          pushUndo({ t: 'del', items: items });
          cancelSelection();
          repaintInk(); markDirty();
        } else if (a === 'copy') {
          const copies = sel.strokes.map(s => {
            const c = JSON.parse(JSON.stringify(slimStroke(s)));
            c.id = A.uid('sk');
            return c;
          });
          copies.forEach(c => S.page.strokes.push(c));
          // 复制出来是整组，撤销要一次全部收回（记成 del 会反过来"恢复"，永远撤不掉）
          pushUndo({ t: 'addmany', strokes: copies });
          // 原位叠一份会看不见，直接把选区切到副本上，用户可以立刻拖走
          S.sel = { strokes: copies, bbox: A.Ink.bboxOf(copies, 8), angle: 0 };
          repaintInk(); drawSelectionBox(); showCtxFloat(); markDirty();
          A.toast('已复制到原位，可直接拖走');
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
  const TEXT_FONTS = [
    { id: 'system', name: '系统黑体', cls: '' },
    { id: 'wenkai', name: '手写楷体', cls: 'font-wenkai' },
    { id: 'song', name: '宋体', cls: 'font-song' },
    { id: 'shr', name: '思源宋体', cls: 'font-shr' },
    { id: 'shr-b', name: '思源宋体 粗', cls: 'font-shr-b' },
    { id: 'shr-l', name: '思源宋体 细', cls: 'font-shr-l' },
    { id: 'shs', name: '思源黑体', cls: 'font-shs' },
    { id: 'shs-b', name: '思源黑体 粗', cls: 'font-shs-b' },
    { id: 'shs-l', name: '思源黑体 细', cls: 'font-shs-l' },
    { id: 'kai', name: '楷体', cls: 'font-kai' },
    { id: 'yuan', name: '圆体', cls: 'font-yuan' },
    { id: 'round', name: '丸体', cls: 'font-round' }
  ];

  function addTextBox(pt) {
    const t = {
      id: A.uid('tx'),
      x: pt.x, y: pt.y, w: 240,
      size: 20,
      font: S.textFont || 'system',
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
      const f = TEXT_FONTS.find(x => x.id === (t.font || 'system'));
      if (f && f.cls) el.classList.add(f.cls);
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
      // 按住拖动位置；长按不动 560ms 弹样式面板
      let pressT = 0, moved = false, drag = null;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        moved = false;
        drag = { x: e.clientX, y: e.clientY, ox: t.x, oy: t.y, active: false };
        clearTimeout(pressT);
        pressT = setTimeout(() => {
          if (moved) return;
          drag = null;
          el.blur();
          openTextOptions(t);
        }, 560);
        try { el.setPointerCapture(e.pointerId); } catch (err) { }
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.active && Math.abs(dx) + Math.abs(dy) > 5) {
          drag.active = true;
          moved = true;
          clearTimeout(pressT);
          el.blur();
        }
        if (!drag.active) return;
        e.preventDefault();
        // 屏幕位移换算成页面坐标
        t.x = Math.max(0, drag.ox + dx / S.view.scale);
        t.y = Math.max(0, drag.oy + dy / S.view.scale);
        el.style.left = t.x + 'px';
        el.style.top = t.y + 'px';
      });
      const endDrag = () => {
        clearTimeout(pressT);
        if (drag && drag.active) markDirty();
        drag = null;
      };
      el.addEventListener('pointerup', endDrag);
      el.addEventListener('pointercancel', endDrag);
      D.textLayer.appendChild(el);
    });
  }

  function openTextOptions(t) {
    const node = A.el('div', 'tx-opt');
    node.innerHTML =
      '<div class="field"><span>字体</span></div>' +
      '<div class="font-grid">' +
      TEXT_FONTS.map(f => '<button class="font-chip' + ((t.font || 'system') === f.id ? ' is-on' : '') +
        '" data-f="' + f.id + '"><span class="fc-sample ' + f.cls + '">Aa 字</span><em>' + f.name + '</em></button>').join('') +
      '</div>' +
      '<label class="field"><span>字号 <b id="txSizeVal">' + (t.size || 20) + '</b></span>' +
      '<input type="range" id="txSize" min="10" max="96" value="' + (t.size || 20) + '"></label>' +
      '<div class="field"><span>颜色</span></div>' +
      '<div class="opt-grid">' + COLORS.map(c =>
        '<button class="opt" data-c="' + c + '" style="display:flex;align-items:center;justify-content:center' +
        ((t.color || '#1c1c1e') === c ? ';box-shadow:inset 0 0 0 2px var(--accent)' : '') + '">' +
        '<span style="width:22px;height:22px;border-radius:50%;background:' + c + ';border:1px solid rgba(255,255,255,.2)"></span></button>'
      ).join('') + '</div>' +
      '<div class="list-sep"></div>' +
      '<button class="list-item is-danger" id="txDel"><span class="li-grow">删除这段文字</span></button>';

    A.sheet.open({
      title: '文字样式',
      node: node,
      onMount: (body, sh) => {
        A.$$('.font-chip', body).forEach(btn => btn.addEventListener('click', () => {
          t.font = btn.dataset.f;
          S.textFont = btn.dataset.f;
          A.$$('.font-chip', body).forEach(x => x.classList.toggle('is-on', x === btn));
          renderTexts();
          markDirty();
          // 内置字体第一次用到时会有个解码等待，给个提示
          if (t.font === 'wenkai') A.toast('正在加载手写字体，首次会慢一点', 1800);
        }));
        const sz = body.querySelector('#txSize');
        sz.addEventListener('input', () => {
          t.size = parseInt(sz.value, 10);
          body.querySelector('#txSizeVal').textContent = t.size;
          renderTexts();
          markDirty();
        });
        A.$$('.opt', body).forEach(b => b.addEventListener('click', () => {
          t.color = b.dataset.c;
          A.$$('.opt', body).forEach(x => x.style.boxShadow = '');
          b.style.boxShadow = 'inset 0 0 0 2px var(--accent)';
          renderTexts();
          markDirty();
        }));
        body.querySelector('#txDel').addEventListener('click', () => {
          S.page.texts = S.page.texts.filter(x => x !== t);
          renderTexts();
          markDirty();
          sh.close();
        });
      }
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
    } else if (op.t === 'shapeify') {
      // 形状识别：撤销时把规整形状还原成原始手写，重做时再换回形状
      if (reverse) {
        const i = list.indexOf(op.shape);
        if (i >= 0) list.splice(i, 1, op.raw);
      } else {
        const i = list.indexOf(op.raw);
        if (i >= 0) list.splice(i, 1, op.shape);
      }
    } else if (op.t === 'addmany') {
      if (reverse) {
        op.strokes.forEach(s => {
          const i = list.indexOf(s);
          if (i >= 0) list.splice(i, 1);
        });
      } else {
        op.strokes.forEach(s => { if (list.indexOf(s) < 0) list.push(s); });
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
      op.strokes.forEach(s => {
        s.pts.forEach(p => { p.x += op.dx * k; p.y += op.dy * k; });
        s._sm = null;   // 不清缓存：撤销后墨迹留在原处，只有数据回去了
      });
      if (S.sel) {
        S.sel.bbox = moveBBox(S.sel.bbox, op.dx * k, op.dy * k);
        drawSelectionBox();
      }
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
    } else if (op.t === 'xform') {
      const data = reverse ? op.before : op.after;
      const sizes = reverse ? op.sizeBefore : op.sizeAfter;
      op.strokes.forEach((s, si) => {
        const d = data[si];
        if (!d) return;
        s.pts.forEach((p, pi) => {
          if (d[pi]) { p.x = d[pi].x; p.y = d[pi].y; }
        });
        if (sizes && sizes[si] != null) s.size = sizes[si];
        // 形状被展开过：撤销要按原始两个定义点还原（矩形轮廓首尾是同一点，取首尾会塌掉）
        const o = op.orig && op.orig[si];
        if (o && o.tool === 'shape') {
          if (reverse) {
            s.tool = 'shape'; s.kind = o.kind; s.shape = o.shape;
            s.pts = o.pts.map(p => ({ x: p.x, y: p.y, p: p.p }));
          } else {
            s.tool = 'pen'; s.kind = 'ball'; s.shape = null;
          }
        }
        s._sm = null;
      });
      if (S.sel) {
        S.sel.angle = reverse ? (op.angleBefore || 0) : (op.angleAfter || 0);
        const bb = reverse ? op.boxBefore : op.boxAfter;
        S.sel.bbox = bb ? { x: bb.x, y: bb.y, w: bb.w, h: bb.h } : A.Ink.bboxOf(S.sel.strokes, 8);
        drawSelectionBox();
      }
    } else if (op.t === 'lydel') {
      if (reverse) {
        if (S.page.layers.indexOf(op.layer) < 0) {
          S.page.layers.splice(Math.min(op.at, S.page.layers.length), 0, op.layer);
        }
        S.page.strokes = op.before.slice();
        S.layer = op.layer.id;
      } else {
        const i = S.page.layers.indexOf(op.layer);
        if (i >= 0) S.page.layers.splice(i, 1);
        op.strokes.forEach(s => {
          const j = list.indexOf(s);
          if (j >= 0) list.splice(j, 1);
        });
        if (S.layer === op.layer.id && S.page.layers.length) {
          S.layer = S.page.layers[S.page.layers.length - 1].id;
        }
      }
    } else if (op.t === 'lyadd') {
      if (reverse) {
        const i = S.page.layers.indexOf(op.layer);
        if (i >= 0) S.page.layers.splice(i, 1);
        if (S.layer === op.layer.id) S.layer = (S.page.layers[0] || {}).id || 'l0';
      } else if (S.page.layers.indexOf(op.layer) < 0) {
        S.page.layers.push(op.layer);
        S.layer = op.layer.id;
      }
    } else if (op.t === 'lymerge') {
      if (reverse) {
        S.page.strokes = op.before.slice();
        S.page.layers = op.layersBefore.slice();
        S.layer = op.layersBefore[0].id;
      } else {
        const base = S.page.layers[0];
        S.page.strokes.forEach(s => { s.layer = base.id; });
        S.page.layers = [base];
        S.layer = base.id;
      }
    }
  }

  /* ═════════════ 保存 ═════════════ */

  function slimStroke(s) {
    const o = {
      id: s.id, tool: s.tool, kind: s.kind, shape: s.shape,
      color: s.color, size: s.size,
      pts: s.pts.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, p: Math.round((p.p || .5) * 1000) / 1000 }))
    };
    // 录音时间戳与图层归属必须一起存下来，否则重开就丢了
    if (s.t != null) o.t = s.t;
    if (s.layer != null) o.layer = s.layer;
    // 胶带被「揭开」的显隐状态也要落盘，重开笔记后保持原样
    if (s.hidden) o.hidden = true;
    return o;
  }

  function markDirty() {
    clearTimeout(saveTimer);
    if (A.backup) A.backup.setState('saving');
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
      bgKey: p.bgKey, pdfPage: p.pdfPage, pdfTotal: p.pdfTotal, pdfText: p.pdfText,
      heading: p.heading, headingLevel: p.headingLevel,
      layers: p.layers || null,
      rec: p.rec || null,
      strokes: (p.strokes || []).map(slimStroke),
      texts: p.texts || [],
      images: (p.images || []).map(im => ({ id: im.id, src: im.src, x: im.x, y: im.y, w: im.w, h: im.h }))
    };
    await A.db.savePage(copy);
    if (A.Search) A.Search.invalidate();
    if (S.book) {
      S.book.updatedAt = A.now();
      S.book.pageCount = S.pages.length;
      await A.db.saveBook(S.book);
    }
    // ① 立即回执：IndexedDB 已落盘
    if (A.backup) {
      A.backup.setState(A.db.memoryOnly ? 'local' : 'saved');
      A.backup.schedule();
    }
  }

  /* 立即落盘：当前页写入 IndexedDB，再推一次原生快照 */
  async function saveNow() {
    await persistPage(true);
    if (A.backup) await A.backup.flush();
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
        heading: S.page.heading, headingLevel: S.page.headingLevel,
        layers: JSON.parse(JSON.stringify(S.page.layers || defaultLayers())),
        strokes: (S.page.strokes || []).map(slimStroke),
        texts: JSON.parse(JSON.stringify(S.page.texts || [])),
        images: JSON.parse(JSON.stringify(S.page.images || []))
      }));
    } else {
      page = blankPage(S.page.bookId, order, { w: S.page.w, h: S.page.h, id: S.page.preset });
      // 新页沿用当前页的纸张与纸色，否则连写几页要反复设模板
      page.paper = S.page.paper || 'lined';
      page.paperColor = S.page.paperColor || '#ffffff';
    }
    await A.db.savePage(page);
    S.pages.push(page);
    await loadPage(S.pages.length - 1);
    A.toast(kind === 'copy' ? '已复制为新页' : '已添加一页');
  }

  /* 调整页序：整本重排 order 再落库，缩略图/指示器/IndexedDB 才一致 */
  async function movePage(from, to) {
    if (from === to || to < 0 || to >= S.pages.length) return;
    await persistPage(true);
    const cur = S.page;
    const [p] = S.pages.splice(from, 1);
    S.pages.splice(to, 0, p);
    for (let i = 0; i < S.pages.length; i++) {
      S.pages[i].order = i;
      await A.db.savePage(S.pages[i]);
    }
    const ni = S.pages.indexOf(cur);
    if (ni >= 0 && ni !== S.idx) { S.idx = ni; updatePageIndicator(); }
    A.toast('已移到第 ' + (to + 1) + ' 页');
  }

  async function deletePage(idx) {
    if (S.pages.length <= 1) { A.toast('至少保留一页'); return; }
    const p = S.pages[idx];
    // 关键：先把当前页指针摘掉，否则后面 loadPage 的 persistPage
    // 会把刚删掉的那一页又写回库里，刷新后"复活"
    const wasCurrent = S.page === p;
    if (wasCurrent) {
      S.page = null;
      S.sel = null;
      if (S.stroke) { S.stroke = null; S.mode = null; }
    }
    S.pages.splice(idx, 1);
    await A.db.deletePage(p.id);
    if (p.bgKey) { try { await A.db.deleteAsset(p.bgKey); } catch (e) { } }
    if (p.rec && p.rec.key) { try { await A.db.deleteAsset(p.rec.key); } catch (e) { } }
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
      // 触屏上拖拽排序太容易误触翻页，给两个明确的挪页按钮
      const mv = A.el('div');
      mv.style.cssText = 'display:flex;gap:5px;justify-content:center;margin-top:5px';
      const bs = 'width:26px;height:22px;border:0;border-radius:6px;background:rgba(255,255,255,.09);color:#ddd;font-size:14px;line-height:1;cursor:pointer';
      mv.innerHTML = '<button data-m="-1" style="' + bs + (i === 0 ? ';opacity:.3' : '') + '">‹</button>' +
        '<button data-m="1" style="' + bs + (i === S.pages.length - 1 ? ';opacity:.3' : '') + '">›</button>';
      A.$$('button', mv).forEach(b => b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const to = i + Number(b.dataset.m);
        if (to < 0 || to >= S.pages.length) return;
        A.sheet.close();
        setTimeout(() => { movePage(i, to).then(() => openPagesPanel()); }, 200);
      }));
      chip.appendChild(mv);
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
    } else {
      // 走和正式渲染同一套纸张绘制，缩略图才不会所有模板长一样
      try { drawPaperPattern(g, p); } catch (e) { }
    }
    g.save();
    g.scale(1, 1);
    A.Ink.drawAll(g, p.strokes || []);
    g.restore();

    // PDF 页缩略图：底图可能还没解码，异步补上再重画一遍笔迹
    if (p.bgKey) {
      const hit = bgCache.get(p.bgKey);
      if (hit && hit.complete && hit.naturalWidth) {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(hit, 0, 0, cv.width, cv.height);
        g.restore();
        // 底图盖住了笔迹，重画一次
        A.Ink.drawAll(g, p.strokes || []);
      } else {
        A.db.getAsset(p.bgKey).then((data) => {
          if (!data) return;
          const img = new Image();
          img.onload = () => {
            bgCache.set(p.bgKey, img);
            g.save();
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, cv.width, cv.height);
            g.scale(scale * 2, scale * 2);
            g.fillStyle = '#fff';
            g.fillRect(0, 0, p.w, p.h);
            g.drawImage(img, 0, 0, p.w, p.h);
            g.restore();
            A.Ink.drawAll(g, p.strokes || []);
          };
          img.src = data;
        }).catch(() => { });
      }
    }
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
      '<button class="list-item" data-a="pdf"><svg class="ico" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/></svg><span class="li-grow">导入 PDF 批注<span class="li-sub">新建一本 PDF 笔记</span></span></button>' +
      '<button class="list-item" data-a="outline"><svg class="ico" viewBox="0 0 24 24"><path d="M4 6h3M4 12h3M4 18h3"/><path d="M10 6h10M10 12h7M10 18h9"/></svg><span class="li-grow">大纲 / 脑图<span class="li-sub">按页面内容自动生成</span></span></button>' +
      '<button class="list-item" data-a="flash"><svg class="ico" viewBox="0 0 24 24"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 9h4v9a2 2 0 01-2 2h-2"/><path d="M8 12h4"/></svg><span class="li-grow">闪卡复习<span class="li-sub">间隔重复排程</span></span></button>' +
      '<button class="list-item" data-a="learn"><svg class="ico" viewBox="0 0 24 24"><path d="M9 4l7 7-7 7"/><path d="M4 4h3M4 20h3"/></svg><span class="li-grow">学习测验<span class="li-sub">填空 / 选择 / 配对</span></span></button>' +
      '<button class="list-item" data-a="layers"><svg class="ico" viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg><span class="li-grow">图层<span class="li-sub">分层画、分别隐藏</span></span></button>' +
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
          if (a === 'pdf') setTimeout(() => A.PdfImport && A.PdfImport.pick(), 200);
          if (a === 'outline') setTimeout(() => A.Outline && A.Outline.open('outline'), 200);
          if (a === 'flash') setTimeout(() => A.Flashcard && A.Flashcard.open(), 200);
          if (a === 'learn') setTimeout(() => A.Learn && A.Learn.open(), 200);
          if (a === 'layers') setTimeout(openLayersPanel, 200);
          if (a === 'rename') setTimeout(() => { D.docTitle.focus(); D.docTitle.select(); }, 200);
          if (a === 'help') setTimeout(() => { A.$('#footHelp') && A.$('#footHelp').click(); }, 200);
        }));
      }
    });
  }

  /* ═════════════ 导出 ═════════════ */

  async function renderPageToCanvas(p, scale) {
    scale = scale || 1;
    const cv = document.createElement('canvas');
    cv.width = Math.round(p.w * scale);
    cv.height = Math.round(p.h * scale);
    const g = cv.getContext('2d');
    // 之后所有绘制都用页面坐标，由这层变换负责放大
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = p.paperColor || '#ffffff';
    g.fillRect(0, 0, p.w, p.h);
    drawPaperPattern(g, p);

    // PDF / 图片底图：必须合成进去，否则批注导出来只剩笔迹
    if (p.bgKey) {
      try {
        const data = await A.db.getAsset(p.bgKey);
        if (data) {
          const bg = await A.loadImage(data);
          // 用底图自身的高分辨率铺满整页，别按页面点尺寸缩水
          g.drawImage(bg, 0, 0, p.w, p.h);
        }
      } catch (e) { }
    }

    // 笔迹先画在透明层上，这样橡皮只擦墨不擦纸
    const hidden = new Set((p.layers || []).filter(l => l.visible === false).map(l => l.id));
    const inkStrokes = (p.strokes || []).filter(s => !s.layer || !hidden.has(s.layer));
    const ink = document.createElement('canvas');
    ink.width = cv.width; ink.height = cv.height;
    const ig = ink.getContext('2d');
    ig.setTransform(scale, 0, 0, scale, 0, 0);
    A.Ink.drawAll(ig, inkStrokes);
    g.drawImage(ink, 0, 0, p.w, p.h);

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
      const fam = {
        system: '-apple-system,"PingFang SC",sans-serif',
        wenkai: '"MoYu WenKai","PingFang SC",serif',
        wenkaigb: '"MoYu WenKai","PingFang SC",serif',
        song: '"Songti SC","SimSun",serif',
        shr: '"MoYu Serif SC","Songti SC",serif',
        'shr-b': '"MoYu Serif SC","Songti SC",serif',
        'shr-l': '"MoYu Serif SC","Songti SC",serif',
        shs: '"MoYu Sans SC","PingFang SC",sans-serif',
        'shs-b': '"MoYu Sans SC","PingFang SC",sans-serif',
        'shs-l': '"MoYu Sans SC","PingFang SC",sans-serif',
        kai: '"Kaiti SC","STKaiti",serif',
        yuan: '"Yuanti SC","PingFang SC",sans-serif',
        round: '"Hiragino Maru Gothic ProN","PingFang SC",sans-serif'
      }[t.font || 'system'] || '-apple-system,"PingFang SC",sans-serif';
      g.font = (t.size || 20) + 'px ' + fam;
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
        const cv = await renderPageToCanvas(p, 2);
        const url = cv.toDataURL('image/jpeg', 0.9);
        // PDF 页的 w/h 本来就是 pt，不能再乘 0.75，否则整页缩成 3/4
        const isPt = p.type === 'pdf';
        const k = isPt ? 1 : 0.75;
        data.push({
          b64: url.split(',')[1],
          w: cv.width, h: cv.height,
          ptW: p.w * k, ptH: p.h * k
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
      const cv = await renderPageToCanvas(S.page, 2);
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

  /* 选区手柄：缩放 + 旋转。事件绑在 svg 上，手柄本身 pointer-events:auto */
  function bindSelectionHandles() {
    const svg = D.selSvg;
    if (!svg) return;

    svg.addEventListener('pointerdown', (e) => {
      const h = e.target && e.target.dataset ? e.target.dataset.h : null;
      if (!h || !S.sel) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = toPage(e.clientX, e.clientY);
      beginSelXform(h, pt);
      try { svg.setPointerCapture(e.pointerId); } catch (err) { }
    }, { passive: false });

    svg.addEventListener('pointermove', (e) => {
      if (S.mode !== 'selXform') return;
      e.preventDefault();
      updateSelXform(toPage(e.clientX, e.clientY));
    }, { passive: false });

    const end = (e) => {
      if (S.mode !== 'selXform') return;
      endSelXform();
      try { svg.releasePointerCapture(e.pointerId); } catch (err) { }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  function bind() {
    const on = (sel, ev, fn) => { const n = A.$(sel); if (n) n.addEventListener(ev, fn); };

    bindRuler();
    bindSelectionHandles();
    on('#btnBack', 'click', closeBook);
    on('#btnUndo', 'click', undo);
    on('#btnRedo', 'click', redo);
    on('#btnPages', 'click', openPagesPanel);
    on('#btnExport', 'click', openExportPanel);
    on('#btnMore', 'click', openMorePanel);
    on('#btnSpeak', 'click', speakPage);
    on('#btnRead', 'click', openReader);
    on('#btnOutline', 'click', () => { if (A.Outline) A.Outline.open('outline'); });
    on('#btnRec', 'click', toggleRec);
    on('#recPlay', 'click', playRec);
    on('#recStop', 'click', stopRecOrPlay);
    on('#recClose', 'click', () => {
      if (A.Record && A.Record.isRecording()) { A.toast('先停止录音'); return; }
      showRecBar(false);
    });
    on('#btnRuler', 'click', () => toggleRuler());
    on('#btnPick', 'click', () => setPicking(!S.picking));
    on('#btnReaderClose', 'click', closeReader);
    on('#btnReaderTop', 'click', () => { const f = A.$('#readerFrame'); if (f && f.contentWindow) { try { f.contentWindow.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { } } });
    // 阅读模式手写工具
    A.$$('.rtool').forEach(b => b.addEventListener('click', () => setReaderTool(b.dataset.rt)));

    // 阅读视图里的高度回报与外部链接
    window.addEventListener('message', (e) => {
      const f = A.$('#readerFrame');
      if (!f || !e.source || e.source !== f.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (typeof d.__moyu_h === 'number') readerFit();
      else if (d.__moyu_hash) readerScrollTo(d.__moyu_hash);
      else if (d.__moyu_link) followLink(d.__moyu_link);
    });
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
      if (!document.body.classList.contains('in-studio')) return;
      // 旋屏 / 不同 iPad 尺寸：处于自动适配的，重新贴合新视口；
      // 用户手动缩放过则保持原缩放，只做边界夹取
      if (S.view.fit === 'w') fitWidth(true);
      else if (S.view.fit === 'p') fitPage();
      else if (S.page && S.view.scale > 0) { clampView(); scheduleQuality(); }
      else fitWidth();
    }, 220));

    // 滚轮缩放（桌面/iPad 接鼠标：Ctrl+滚轮或直接滚轮）
    if (D.stage) D.stage.addEventListener('wheel', (e) => {
      if (!document.body.classList.contains('in-studio') || S.gesture) return;
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.0045 : 0.0016));
      zoomAt(e.clientX, e.clientY, A.clamp(f, 0.7, 1.4));
    }, { passive: false });
  }

  /* 朗读本页：PDF 用抽取出的正文，HTML 用 iframe 里的可见文字 */
  function speakPage() {
    if (!A.Words) return;
    const p = S.page;
    if (!p) return;
    let text = (p.pdfText || '').trim();
    if (!text && p.type === 'html' && D.frame) {
      try {
        const doc = D.frame.contentDocument;
        text = doc && doc.body ? (doc.body.innerText || '').trim() : '';
      } catch (e) { }
    }
    if (!text) { A.toast('这一页没有可朗读的文字'); return; }
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      A.Words.stopSpeak();
      A.toast('已停止朗读');
      return;
    }
    A.Words.speak(text.slice(0, 8000));
    A.toast('开始朗读 · 再点一次停止', 2400);
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
    const m = await measureHtmlFull(text, HTML_PAGE_W);
    const h = m.h;
    const heads = m.heads || [];
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
      const top = i * HTML_SLICE_H;
      const bot = top + HTML_SLICE_H;
      // 每页挂上落在这一页范围内的第一个标题，大纲就有真实结构了
      const hit = heads.find(hd => hd[0] >= top && hd[0] < bot);
      const p = htmlPage(book.id, i, srcKey, top, HTML_SLICE_H, h);
      if (hit) {
        p.heading = hit[2];
        p.headingLevel = hit[1];
      }
      pages.push(p);
    }
    // 整本书的标题清单留给大纲做初值。
    // 原来一页只取第一个标题，长文里的 h2/h3 全被吞掉 → 大纲永远只有几条
    if (heads.length) {
      book.outline = [];
      const seen = new Set();
      heads.forEach((hd, k) => {
        const txt = (hd[2] || '').trim();
        if (!txt || seen.has(txt)) return;
        seen.add(txt);
        const i = Math.max(0, Math.min(pages.length - 1, Math.floor(hd[0] / HTML_SLICE_H)));
        const pg = pages[i];
        if (!pg) return;
        book.outline.push({
          id: 'ol_' + pg.id + '_' + k,
          text: txt,
          pageId: pg.id,
          level: Math.min(4, Math.max(1, hd[1] || 1))
        });
      });
      await A.db.saveBook(book);
    }
    await A.db.savePages(pages);
    return book.id;
  }

  function measureHtml(src, width) {
    return measureHtmlFull(src, width).then(r => r.h);
  }

  /* 除了高度，顺带把原文的标题结构捞出来，给大纲用 */
  function measureHtmlFull(src, width) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + width + 'px;height:1000px;border:0;visibility:hidden;';
      document.body.appendChild(f);
      let best = 0, settle = 0, done = false, heads = [];
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(settle);
        try { f.remove(); } catch (e) { }
        resolve({ h: Math.max(best, 600), heads: heads });
      };
      // 高度是逐步长出来的（字体、图片、布局回填），取稳定后的最大值
      const bump = (h) => {
        if (typeof h === 'number' && h > best) best = h;
        clearTimeout(settle);
        settle = setTimeout(finish, 500);
      };
      A.HtmlPage.mount(f, src, {
        onHeight: (h) => bump(h),
        onHeads: (list) => { if (Array.isArray(list) && list.length > heads.length) heads = list; }
      })
        .then((h) => bump(h || 0))
        .catch(() => bump(0));
      setTimeout(finish, 7000);
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
    openPagesPanel, openPaperPanel, openExportPanel, insertImage, saveNow,
    openLayersPanel, toggleRec, playRec, stopRecPlay, repaintInk,
    ensureLayers, layerOf, drawSelectionBox, visibleStrokes, renderPageToCanvas,
    deletePage, flashAnchor, speakPage
  };
})(window.MY);
