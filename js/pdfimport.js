/* ══════════════════════════════════════════════════════════
   pdfimport.js — PDF 导入与批注底图
   用本地化的 pdf.js 把每一页渲染成位图，作为页面底图，
   手写笔迹叠在上面批注（Goodnotes / Notability / MarginNote 的核心场景）
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  let libReady = null;

  /* 惰性加载 pdf.js：只有真的导入 PDF 才付出这 1.4MB 的解析代价 */
  function ensureLib() {
    if (libReady) return libReady;
    libReady = new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const s = document.createElement('script');
      s.src = './vendor/pdf.min.js';
      s.onload = () => {
        const lib = window.pdfjsLib;
        if (!lib) { reject(new Error('pdf.js 载入失败')); return; }
        try { lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js'; } catch (e) { }
        resolve(lib);
      };
      s.onerror = () => reject(new Error('找不到 vendor/pdf.min.js'));
      document.head.appendChild(s);
    });
    return libReady;
  }

  /* 渲染倍率：1.7 倍在 iPad 上足够清晰，单页 JPEG 约 120KB，100 页约 12MB */
  const SCALE = 1.7;
  const QUALITY = 0.78;

  /* ───────────── 文件选择 ───────────── */
  function pick(onFile) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf,.pdf';
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      try { inp.remove(); } catch (e) { }
      if (f) onFile(f);
    });
    inp.click();
  }

  /* ───────────── 进度浮层 ───────────── */
  function progressNode() {
    const node = A.el('div', 'pdf-prog');
    node.innerHTML =
      '<div class="pdf-prog-title">正在解析 PDF…</div>' +
      '<div class="pdf-prog-bar"><i></i></div>' +
      '<div class="pdf-prog-note">页面会转成可手写的底图</div>';
    return node;
  }

  function setProgress(node, done, total, label) {
    if (!node) return;
    const pct = total ? Math.round(done / total * 100) : 0;
    const bar = node.querySelector('.pdf-prog-bar i');
    const title = node.querySelector('.pdf-prog-title');
    const note = node.querySelector('.pdf-prog-note');
    if (bar) bar.style.width = pct + '%';
    if (title) title.textContent = '正在导入 ' + done + ' / ' + total + ' 页 · ' + pct + '%';
    if (note && label) note.textContent = label;
  }

  /* ───────────── 主流程 ───────────── */
  async function importFile(file) {
    if (!file) return null;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      A.toast('请选择 PDF 文件');
      return null;
    }

    const sheet = A.sheet.open({
      title: '导入 PDF',
      sub: file.name.replace(/\.pdf$/i, ''),
      node: progressNode(),
      locked: true
    });
    const node = sheet && sheet.body ? sheet.body.querySelector('.pdf-prog') : null;

    let lib;
    try {
      lib = await ensureLib();
    } catch (e) {
      sheet && sheet.close();
      A.toast('PDF 引擎载入失败：' + e.message, 3600);
      return null;
    }

    const buf = await file.arrayBuffer();
    let doc;
    try {
      doc = await lib.getDocument({
        data: new Uint8Array(buf),
        isEvalSupported: false,
        // 中文 PDF 必须带 cmap，否则文字会渲染成空白方块
        cMapUrl: './vendor/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: './vendor/standard_fonts/',
        useSystemFonts: true
      }).promise;
    } catch (e) {
      sheet && sheet.close();
      A.toast('PDF 打不开，可能已加密或损坏', 3600);
      return null;
    }

    const total = doc.numPages;
    setProgress(node, 0, total, '第 1 页');

    const now = A.now();
    const book = {
      id: A.uid('bk'),
      name: (file.name.replace(/\.pdf$/i, '') || '导入的 PDF').slice(0, 60),
      createdAt: now,
      updatedAt: now,
      accent: '#b23a2f',
      isPdf: true,
      isHtml: false,
      pageCount: total
    };

    const pages = [];
    const ASSET_PREFIX = 'pdf_' + book.id + '_';

    for (let i = 1; i <= total; i++) {
      setProgress(node, i - 1, total, '第 ' + i + ' / ' + total + ' 页');
      let page;
      try {
        page = await doc.getPage(i);
      } catch (e) {
        continue;
      }
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: SCALE });

      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      const g = cv.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, cv.width, cv.height);
      try {
        await page.render({ canvasContext: g, viewport: vp, intent: 'display' }).promise;
      } catch (e) { }

      const dataUrl = cv.toDataURL('image/jpeg', QUALITY);
      // 立刻释放位图，避免大 PDF 把内存顶爆
      cv.width = 1; cv.height = 1;

      const key = ASSET_PREFIX + i;
      await A.db.putAsset(key, dataUrl);

      // 顺手抽出这一页的文字，整库搜索就能搜到 PDF 里的内容；
      // 同时记下每个单词的坐标，长按取词才能定位到"手指底下那个词"
      let pageText = '';
      let pageWords = [];
      try {
        const tc = await page.getTextContent();
        pageText = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
        for (const it of (tc.items || [])) {
          const str = it.str || '';
          if (!str.trim() || !isFinite(it.width) || it.width <= 0) continue;
          const m = lib.Util.transform(vp1.transform, it.transform);
          const bx = m[4];
          const by = m[5] - (it.height || 10);
          const per = it.width / Math.max(1, str.length);
          const re = /[A-Za-z][A-Za-z'’-]*/g;
          let mm;
          while ((mm = re.exec(str))) {
            pageWords.push({
              t: mm[0],
              x: Math.round(bx + per * mm.index),
              y: Math.round(by),
              w: Math.max(4, Math.round(per * mm[0].length)),
              h: Math.round((it.height || 10) * 1.4)
            });
            if (pageWords.length > 1500) break;
          }
          if (pageWords.length > 1500) break;
        }
      } catch (e) { }

      pages.push({
        id: A.uid('pg'),
        bookId: book.id,
        order: i - 1,
        type: 'pdf',
        w: Math.round(vp1.width),
        h: Math.round(vp1.height),
        preset: 'pdf',
        paper: 'blank',
        paperColor: '#ffffff',
        bgKey: key,
        pdfPage: i,
        pdfTotal: total,
        pdfText: pageText,
        pdfWords: pageWords,
        strokes: [],
        texts: [],
        images: []
      });

      // 每处理几页让出一次主线程，让进度条真的能画出来
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
    }

    try { doc.destroy(); } catch (e) { }

    if (!pages.length) {
      sheet && sheet.close();
      A.toast('这个 PDF 没有可用的页面');
      return null;
    }

    book.pageCount = pages.length;
    await A.db.saveBook(book);
    await A.db.savePages(pages);

    sheet && sheet.close();
    await A.Library.refresh();
    A.toast('已导入 ' + pages.length + ' 页 PDF，可以直接在上面写字', 3200);
    A.Studio.openBook(book.id);
    return book.id;
  }

  A.PdfImport = {
    pick: (cb) => pick((f) => { if (cb) cb(f); else importFile(f); }),
    importFile,
    ensureLib,
    get SCALE() { return SCALE; }
  };
})(window.MY);
