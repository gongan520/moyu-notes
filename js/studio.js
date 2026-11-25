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
    ruler: { on: false, y: 260, angle: 0 },
    picking: false,
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
      layers: defaultLayers(),
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

  async function toggleRec() {
    if (!A.Record) { A.toast('录音模块未加载'); return; }

    if (A.Record.isRecording()) {
      const p = S.page;
      const b = S.book;
      if (!p || !b) return;
      const info = await A.Record.stop(b.id, p.id);
      const bar = recBar();
      if (bar) bar.classList.remove('is-rec');
      if (D.recPlay) D.recPlay.disabled = false;
      if (info) {
        p.rec = { key: info.key, dur: info.dur, at: A.now() };
        paintRecUI(info.dur, info.dur);
        markDirty();
        persistPage(true);
        A.toast('录音已保存，' + A.Record.fmt(info.dur) + '（回放时笔迹会跟着重现）', 3600);
      }
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

    let raf = 0;
    const tickRedraw = () => {
      if (S.playT == null) return;
      const n = visibleStrokes().length;
      if (n !== S._lastVisible) {
        S._lastVisible = n;
        repaintInk();
      }
      raf = requestAnimationFrame(tickRedraw);
    };
    raf = requestAnimationFrame(tickRedraw);

    await A.Record.play(p.rec.key, 0,
      (t, total) => {
        S.playT = t;
        paintRecUI(t, total > 0 && isFinite(total) ? total : dur);
      },
      () => {
        cancelAnimationFrame(raf);
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
    readerScale = Math.min(1, (window.innerWidth - 2) / pw);
    readerStartY = p.sliceTop || 0;
    readerScrolled = false;

    frame.style.width = pw + 'px';
    frame.style.transform = 'scale(' + readerScale + ')';
    frame.style.height = '200px';
    docBox.style.height = '200px';
    if (scroll) scroll.scrollTop = 0;

    readerOpen = true;
    ov.hidden = false;
    ov.classList.add('is-on');
    frame.srcdoc = A.HtmlPage.prepare(src, { reader: true });

    setTimeout(readerFit, 350);
    setTimeout(readerFit, 1100);
    setTimeout(readerFit, 2400);
  }

  function readerFit() {
    if (!readerOpen) return;
    const frame = A.$('#readerFrame'), docBox = A.$('#readerDoc');
    if (!frame || !docBox) return;
    let h = 0;
    try {
      const d = frame.contentDocument;
      if (d) {
        h = Math.max(
          d.documentElement ? d.documentElement.scrollHeight : 0,
          d.body ? d.body.scrollHeight : 0
        );
      }
    } catch (e) { }
    if (!h || h < 40) return;
    frame.style.height = h + 'px';
    docBox.style.height = Math.ceil(h * readerScale) + 'px';
    if (!readerScrolled) {
      readerScrolled = true;
      const sc = A.$('#readerScroll');
      if (sc && readerStartY > 0) {
        sc.scrollTop = Math.max(0, readerStartY * readerScale - 8);
      }
    }
  }

  /** 阅读模式下的锚点：滚动外层容器（iframe 自身高度等于全文，没有内滚动） */
  function readerScrollTo(name) {
    const frame = A.$('#readerFrame'), sc = A.$('#readerScroll');
    if (!frame || !sc) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    let el = null;
    try { el = doc.getElementById(name) || doc.getElementsByName(name)[0] || null; } catch (e) { el = null; }
    if (!el) return;
    const y = el.getBoundingClientRect().top;   // iframe 未内滚，即文档内偏移
    sc.scrollTo({ top: Math.max(0, y * readerScale - 12), behavior: 'smooth' });
  }

  function closeReader() {    const ov = A.$('#reader'), frame = A.$('#readerFrame');
    readerOpen = false;
    readerScrolled = false;
    if (ov) { ov.hidden = true; ov.classList.remove('is-on'); }
    if (frame) frame.srcdoc = '<!doctype html><html><body style="background:#fff"></body></html>';
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
    const q = S.ruler.on ? snapToRuler(pt) : pt;
    // 当前层锁住了就不让画，避免误覆盖
    const cur = layerOf(S.page, S.layer);
    if (cur && cur.locked) {
      A.toast('「' + cur.name + '」已锁定，换个图层再写');
      return;
    }
    const s = {
      id: A.uid('sk'),
      tool: tool,
      kind: tool === 'pen' ? S.kind : (tool === 'pencil' ? 'pencil' : 'ball'),
      color: tool === 'eraser' ? '#000' : S.color,
      size: S.size,
      layer: (cur && cur.id) || 'l0',
      pts: [{ x: q.x, y: q.y, p: pressure || 0.5 }],
      _committed: 0
    };
    S.stroke = s;
    S.mode = 'draw';
    clearLive();
    paintLive(s);
  }

  function appendPoint(s, pt, pressure) {
    const p = (typeof pressure === 'number' && pressure > 0) ? A.clamp(pressure, 0.05, 1) : 0.5;
    const q = S.ruler.on ? snapToRuler(pt) : pt;
    A.Ink.addPoint(s, { x: q.x, y: q.y, p: p });
    s._sm = null;
  }

  /* ═════════════ 标尺 ═════════════ */

  function snapToRuler(pt) {
    const R = S.ruler;
    const cx = pageSize().w / 2, cy = R.y;
    const a = R.angle * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const t = (pt.x - cx) * dx + (pt.y - cy) * dy;
    return { x: cx + dx * t, y: cy + dy * t };
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
    let svg = '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
      '" fill="rgba(224,178,99,.06)" stroke="#e0b263" stroke-width="1.2" stroke-dasharray="6 4" rx="4"/>';

    // 旋转手柄挂在顶部中间
    const rx = b.x + b.w / 2, ry = b.y - R * 3;
    svg += '<line x1="' + (b.x + b.w / 2) + '" y1="' + b.y + '" x2="' + rx + '" y2="' + ry +
      '" stroke="#e0b263" stroke-width="1.2" stroke-dasharray="3 3"/>';
    svg += '<circle data-h="rot" cx="' + rx + '" cy="' + ry + '" r="' + R +
      '" fill="rgba(224,178,99,.92)" stroke="rgba(20,20,22,.55)" stroke-width="1.2" style="pointer-events:auto;cursor:' + cur.rot + '"/>';

    hs.forEach(([k, x, y]) => {
      svg += '<circle data-h="' + k + '" cx="' + x + '" cy="' + y + '" r="' + R +
        '" fill="#e0b263" stroke="rgba(20,20,22,.55)" stroke-width="1.2" style="pointer-events:auto;cursor:' + cur[k] + '"/>';
    });
    D.selSvg.innerHTML = svg;
  }

  /* ── 选区缩放 / 旋转 ── */

  function beginSelXform(handle, pt) {
    const b = S.sel.bbox;
    S.selXform = {
      h: handle,
      b0: { x: b.x, y: b.y, w: b.w, h: b.h },
      start: pt,
      snap: S.sel.strokes.map(s => s.pts.map(p => ({ x: p.x, y: p.y })))
    };
    S.mode = 'selXform';
  }

  function updateSelXform(pt) {
    const xf = S.selXform;
    if (!xf || !S.sel) return;
    const b0 = xf.b0;
    const cx = b0.x + b0.w / 2;
    const cy = b0.y + b0.h / 2;

    if (xf.h === 'rot') {
      const a0 = Math.atan2(xf.start.y - cy, xf.start.x - cx);
      let a1 = Math.atan2(pt.y - cy, pt.x - cx);
      let d = a1 - a0;
      // 15° 吸附，画正了更容易
      const snapTo = Math.PI / 12;
      if (Math.abs(d) > 0.02) d = Math.round(d / snapTo) * snapTo;
      const cos = Math.cos(d), sin = Math.sin(d);
      S.sel.strokes.forEach((s, si) => {
        const snap = xf.snap[si];
        s.pts.forEach((p, pi) => {
          const ox = snap[pi].x - cx, oy = snap[pi].y - cy;
          p.x = cx + ox * cos - oy * sin;
          p.y = cy + ox * sin + oy * cos;
        });
        s._sm = null;
      });
      S.sel.bbox = A.Ink.bboxOf(S.sel.strokes, 8);
      S.sel.rotated = true;
      drawSelectionBox();
      repaintInk();
      return;
    }

    // 锚点：拖哪边，对面那条边固定
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
        p.x = ax + (snap[pi].x - ax) * sx;
        p.y = ay + (snap[pi].y - ay) * sy;
      });
      s.size = Math.max(0.6, (s._size0 || (s._size0 = s.size)) * Math.abs((sx + sy) / 2));
      s._sm = null;
    });

    const nx = Math.min(ax, ax + b0.w * sx);
    const ny = Math.min(ay, ay + b0.h * sy);
    S.sel.bbox = { x: nx, y: ny, w: Math.abs(b0.w * sx), h: Math.abs(b0.h * sy) };
    drawSelectionBox();
    repaintInk();
  }

  function endSelXform() {
    const xf = S.selXform;
    S.selXform = null;
    S.mode = null;
    if (!xf || !S.sel) return;
    const after = S.sel.strokes.map(s => s.pts.map(p => ({ x: p.x, y: p.y })));
    // 判断是否真的变了
    let moved = false;
    for (let i = 0; i < after.length && !moved; i++) {
      for (let j = 0; j < after[i].length; j++) {
        if (Math.abs(after[i][j].x - xf.snap[i][j].x) > 0.4 ||
          Math.abs(after[i][j].y - xf.snap[i][j].y) > 0.4) { moved = true; break; }
      }
    }
    if (moved) {
      pushUndo({ t: 'xform', strokes: S.sel.strokes.slice(), before: xf.snap, after: after });
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
    const r = stageRect();
    const host = D.viewStu.getBoundingClientRect();
    const px = r.left + S.view.x + (b.x + b.w / 2) * S.view.scale;
    // 工具条放选区下方：上方要留给旋转手柄，否则手柄被盖住点不到
    const below = r.top + S.view.y + (b.y + b.h) * S.view.scale + 14;
    const py = below;
    const el = D.ctxFloat;
    el.style.left = (px - host.left) + 'px';
    el.style.top = (py - host.top) + 'px';
    // 下方放不下（贴着工具栏）时翻到上方更远处
    requestAnimationFrame(() => {
      const er = el.getBoundingClientRect();
      if (er.bottom > window.innerHeight - 8) {
        el.style.top = (r.top + S.view.y + b.y * S.view.scale - 56 - host.top) + 'px';
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
  const TEXT_FONTS = [
    { id: 'system', name: '系统黑体', cls: '' },
    { id: 'wenkai', name: '手写楷体', cls: 'font-wenkai' },
    { id: 'song', name: '宋体', cls: 'font-song' },
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
      let pressT = 0, moved = false;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        moved = false;
        clearTimeout(pressT);
        pressT = setTimeout(() => {
          if (moved) return;
          el.blur();
          openTextOptions(t);
        }, 560);
      });
      el.addEventListener('pointermove', () => { moved = true; clearTimeout(pressT); });
      el.addEventListener('pointerup', () => clearTimeout(pressT));
      el.addEventListener('pointercancel', () => clearTimeout(pressT));
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
    } else if (op.t === 'xform') {
      const data = reverse ? op.before : op.after;
      op.strokes.forEach((s, si) => {
        const d = data[si];
        if (!d) return;
        s.pts.forEach((p, pi) => {
          if (d[pi]) { p.x = d[pi].x; p.y = d[pi].y; }
        });
        s._sm = null;
      });
      if (S.sel) S.sel.bbox = A.Ink.bboxOf(S.sel.strokes, 8);
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
          if (a === 'layers') setTimeout(openLayersPanel, 200);
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

    // PDF / 图片底图：必须合成进去，否则批注导出来只剩笔迹
    if (p.bgKey) {
      try {
        const data = await A.db.getAsset(p.bgKey);
        if (data) {
          const bg = await A.loadImage(data);
          g.drawImage(bg, 0, 0, p.w, p.h);
        }
      } catch (e) { }
    }

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
      const fam = {
        system: '-apple-system,"PingFang SC",sans-serif',
        wenkai: '"MoYu WenKai","PingFang SC",serif',
        song: '"Songti SC","SimSun",serif',
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
    on('#btnRead', 'click', openReader);
    on('#btnOutline', 'click', () => { if (A.Outline) A.Outline.open('outline'); });
    on('#btnRec', 'click', toggleRec);
    on('#recPlay', 'click', playRec);
    on('#recStop', 'click', stopRecPlay);
    on('#recClose', 'click', () => {
      if (A.Record && A.Record.isRecording()) { A.toast('先停止录音'); return; }
      showRecBar(false);
    });
    on('#btnRuler', 'click', () => toggleRuler());
    on('#btnPick', 'click', () => setPicking(!S.picking));
    on('#btnReaderClose', 'click', closeReader);
    on('#btnReaderTop', 'click', () => { const sc = A.$('#readerScroll'); if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' }); });

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
    // 整本书的标题清单留给大纲做初值
    if (heads.length) {
      book.outline = [];
      pages.forEach(p => {
        if (p.heading) {
          book.outline.push({
            id: 'ol_' + p.id,
            text: p.heading,
            pageId: p.id,
            level: Math.min(4, Math.max(1, p.headingLevel || 1))
          });
        }
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
    ensureLayers, layerOf, drawSelectionBox, visibleStrokes, renderPageToCanvas
  };
})(window.MY);
