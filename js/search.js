/* ══════════════════════════════════════════════════════════
   search.js — 整库全文搜索（Goodnotes / Notion 的基础能力）
   覆盖：书名 / 文字框 / HTML 原文 / PDF 提取文字 / 大纲条目
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  let host = null;
  let index = [];          // [{ bookId, bookName, pageId, pageOrder, src, text }]
  let built = false;
  let building = false;

  const MAX_HTML = 60000;

  function stripTags(h) {
    return String(h || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function build() {
    if (building) return;
    building = true;
    index = [];
    try {
      const books = await A.db.allBooks();
      for (const b of books) {
        const pages = await A.db.pagesOf(b.id);
        // 书名本身可搜
        index.push({ bookId: b.id, bookName: b.name || '未命名', pageId: null, pageOrder: -1, src: '书名', text: b.name || '' });

        // HTML 原文只读一次，整本共用
        let htmlText = '';
        const first = pages.find(p => p.type === 'html' && p.srcKey);
        if (first) {
          try {
            const src = await A.db.getAsset(first.srcKey);
            htmlText = stripTags(src).slice(0, MAX_HTML);
          } catch (e) { }
        }

        for (const p of pages) {
          const bits = [];
          if (p.heading) bits.push({ src: '标题', text: p.heading });
          (p.texts || []).forEach(t => { if (t.text) bits.push({ src: '文字', text: t.text }); });
          if (p.pdfText) bits.push({ src: 'PDF', text: p.pdfText });
          bits.forEach(x => index.push({
            bookId: b.id, bookName: b.name || '未命名',
            pageId: p.id, pageOrder: p.order, src: x.src, text: x.text
          }));
        }

        if (htmlText) {
          index.push({
            bookId: b.id, bookName: b.name || '未命名',
            pageId: pages.length ? pages[0].id : null,
            pageOrder: 0, src: '网页', text: htmlText
          });
        }

        (b.outline || []).forEach(o => {
          if (o.text) index.push({
            bookId: b.id, bookName: b.name || '未命名',
            pageId: o.pageId, pageOrder: -1, src: '大纲', text: o.text
          });
        });
      }
      built = true;
    } catch (e) {
      A.toast('建立搜索索引失败：' + e.message);
    }
    building = false;
    return index;
  }

  function query(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const it of index) {
      const at = it.text.toLowerCase().indexOf(q);
      if (at < 0) continue;
      const pad = 26;
      const s = Math.max(0, at - pad);
      const frag = it.text.slice(s, at + q.length + pad).replace(/\s+/g, ' ');
      out.push({
        bookId: it.bookId, bookName: it.bookName, pageId: it.pageId,
        pageOrder: it.pageOrder, src: it.src,
        frag: (s > 0 ? '…' : '') + frag + '…'
      });
      if (out.length >= 80) break;
    }
    return out;
  }

  /* ───────────── 界面 ───────────── */
  function ensureHost() {
    if (host) return host;
    host = A.el('div', 'sr');
    host.id = 'searchView';
    host.hidden = true;
    host.innerHTML =
      '<div class="ov-bar">' +
      '<button class="icon-btn" id="srClose"><svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="sr-field"><svg viewBox="0 0 24 24" class="ico sr-ico"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' +
      '<input id="srInput" placeholder="搜索书名、笔记、网页或 PDF 里的文字" autocomplete="off" spellcheck="false"></div>' +
      '</div>' +
      '<div class="sr-body"><div class="sr-hint" id="srHint">输入关键词开始搜索</div><div class="sr-list" id="srList"></div></div>';
    document.body.appendChild(host);

    host.querySelector('#srClose').addEventListener('click', close);
    const inp = host.querySelector('#srInput');
    let t = 0;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => run(inp.value), 180);
    });
    return host;
  }

  async function open(prefill) {
    const h = ensureHost();
    h.hidden = false;
    const hint = h.querySelector('#srHint');
    const list = h.querySelector('#srList');
    list.innerHTML = '';

    if (!built) {
      hint.textContent = '正在建立索引…';
      await build();
      hint.textContent = '已索引 ' + index.length + ' 条内容，输入关键词开始搜索';
    } else {
      hint.textContent = '已索引 ' + index.length + ' 条内容';
    }
    const inp = h.querySelector('#srInput');
    inp.value = prefill || '';
    setTimeout(() => inp.focus(), 120);
    if (prefill) run(prefill);
  }

  function close() { if (host) host.hidden = true; }

  function run(q) {
    const h = ensureHost();
    const hint = h.querySelector('#srHint');
    const list = h.querySelector('#srList');
    const hits = query(q);

    if (!q.trim()) {
      hint.textContent = '已索引 ' + index.length + ' 条内容';
      list.innerHTML = '';
      return;
    }
    if (!hits.length) {
      hint.textContent = '没找到「' + q + '」';
      list.innerHTML = '';
      return;
    }
    hint.textContent = '找到 ' + hits.length + ' 处';
    list.innerHTML = '';
    hits.forEach(hit => {
      const row = A.el('button', 'sr-row');
      row.innerHTML =
        '<div class="sr-top"><span class="sr-book">' + esc(hit.bookName) + '</span>' +
        (hit.pageOrder >= 0 ? '<span class="sr-page">第 ' + (hit.pageOrder + 1) + ' 页</span>' : '') +
        '<span class="sr-src">' + hit.src + '</span></div>' +
        '<div class="sr-frag">' + esc(hit.frag) + '</div>';
      row.addEventListener('click', () => {
        close();
        const St = A.Studio;
        if (St.S.book && St.S.book.id === hit.bookId) {
          const idx = St.S.pages.findIndex(p => p.id === hit.pageId);
          if (idx >= 0) { St.goPage(idx); return; }
        }
        A.Studio.openBook(hit.bookId).then(() => {
          if (!hit.pageId) return;
          setTimeout(() => {
            const idx = A.Studio.S.pages.findIndex(p => p.id === hit.pageId);
            if (idx >= 0) A.Studio.goPage(idx);
          }, 500);
        });
      });
      list.appendChild(row);
    });
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  A.Search = {
    open, close, build, query,
    invalidate() { built = false; },
    get size() { return index.length; }
  };
})(window.MY);
