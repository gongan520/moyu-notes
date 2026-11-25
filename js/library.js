/* ══════════════════════════════════════════════════════════
   library.js — 笔记库（书架）
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const S = {
    books: [],
    folders: [],
    folderId: 'root',
    starOnly: false,
    sort: 'updated',
    q: '',
    ready: false
  };

  const ACCENTS = ['#e0b263', '#7fa7f5', '#e08a8a', '#8fd0a8', '#b79cf0', '#e8a06a'];

  /* ───── 封面绘制 ───── */
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function paintCover(cv, book) {
    const W = 300, H = 400;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const accent = book.accent || ACCENTS[0];

    // 背景
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#242329');
    bg.addColorStop(0.55, '#1b1a1f');
    bg.addColorStop(1, '#121215');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // 场景光
    const gl = g.createRadialGradient(W * 0.18, H * 0.06, 10, W * 0.18, H * 0.06, W * 0.9);
    gl.addColorStop(0, hexA(accent, 0.16));
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gl;
    g.fillRect(0, 0, W, H);

    // 纸
    const px = W * 0.115, py = H * 0.075, pw = W * 0.77, ph = H * 0.85;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 22;
    g.shadowOffsetY = 10;
    g.fillStyle = '#fbfaf6';
    rr(g, px, py, pw, ph, 3);
    g.fill();
    g.restore();

    // 纸面内容
    g.save();
    rr(g, px, py, pw, ph, 3);
    g.clip();

    if (book.isHtml) {
      // 网页缩略：色块布局感
      g.fillStyle = 'rgba(20,20,26,.06)';
      g.fillRect(px + pw * 0.08, py + ph * 0.07, pw * 0.84, ph * 0.05);
      g.fillStyle = hexA(accent, 0.22);
      g.fillRect(px + pw * 0.08, py + ph * 0.16, pw * 0.42, ph * 0.035);
      g.fillStyle = 'rgba(20,20,26,.10)';
      let yy = py + ph * 0.24;
      for (let i = 0; i < 9; i++) {
        const wLine = pw * (0.84 - (i % 4 === 3 ? 0.3 : 0));
        g.fillRect(px + pw * 0.08, yy, wLine, 5);
        yy += ph * 0.055;
      }
      g.fillStyle = 'rgba(20,20,26,.05)';
      g.fillRect(px + pw * 0.08, py + ph * 0.78, pw * 0.6, ph * 0.09);
    } else {
      // 横线纸 + 手写感线条
      g.strokeStyle = 'rgba(30,40,60,.09)';
      g.lineWidth = 1;
      for (let y = py + ph * 0.14; y < py + ph * 0.95; y += 22) {
        g.beginPath();
        g.moveTo(px + 14, y);
        g.lineTo(px + pw - 14, y);
        g.stroke();
      }
      g.strokeStyle = 'rgba(28,28,32,.72)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(px + 24, py + ph * 0.30);
      for (let i = 0; i < 9; i++) {
        g.bezierCurveTo(
          px + 24 + i * 18 + 6, py + ph * 0.30 - 12,
          px + 24 + i * 18 + 12, py + ph * 0.30 + 14,
          px + 34 + i * 18, py + ph * 0.30 + (i % 2 ? -4 : 3)
        );
      }
      g.stroke();
    }

    // 书脊压印
    g.fillStyle = hexA(accent, 0.7);
    g.fillRect(px, py, 5, ph);

    // 纸右侧阴影
    const sh = g.createLinearGradient(px + pw - 26, 0, px + pw, 0);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,.07)');
    g.fillStyle = sh;
    g.fillRect(px + pw - 26, py, 26, ph);
    g.restore();

    // 类型角标
    if (book.isHtml) {
      g.fillStyle = hexA(accent, 0.9);
      g.font = '600 10px -apple-system,"PingFang SC",sans-serif';
      g.textAlign = 'right';
      g.fillText('HTML', W * 0.87, py - 8);
      g.textAlign = 'left';
    }

  }

  function hexA(hex, a) {
    let h = (hex || '#e0b263').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ───── 渲染列表 ───── */
  function inFolder(b) {
    const f = b.folderId || 'root';
    return f === S.folderId;
  }

  function subFolders() {
    return S.folders
      .filter(f => (f.parentId || 'root') === S.folderId)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  }

  /* 统计文件夹里的笔记：含所有子文件夹，否则上层文件夹永远显示 0 */
  function countIn(id) {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of S.folders) {
        const p = f.parentId || 'root';
        if (ids.has(p) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
      }
    }
    return S.books.filter(b => ids.has(b.folderId || 'root')).length;
  }

  function sorted() {
    let list = S.books.filter(inFolder);
    if (S.starOnly) list = list.filter(b => b.starred);
    if (S.q) {
      const q = S.q.toLowerCase();
      list = list.filter(b => {
        if ((b.name || '').toLowerCase().indexOf(q) >= 0) return true;
        return (b.tags || []).some(t => String(t).toLowerCase().indexOf(q) >= 0);
      });
    }
    if (S.sort === 'updated') list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    else if (S.sort === 'created') list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    else list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
    return list;
  }

  /* ───── 面包屑 ───── */
  function trail() {
    const out = [];
    let cur = S.folders.find(f => f.id === S.folderId);
    let guard = 0;
    while (cur && guard++ < 20) {
      out.unshift(cur);
      cur = S.folders.find(f => f.id === (cur.parentId || 'root'));
      if (cur && cur.id === S.folderId) break;
    }
    return out;
  }

  function renderNav() {
    const nav = A.$('#libNav');
    if (!nav) return;
    const t = trail();
    let html = '<div class="crumb-trail">';
    html += '<button class="crumb-seg" data-fid="root">书架</button>';
    t.forEach((f, i) => {
      html += '<span class="crumb-sep">/</span>';
      html += i === t.length - 1
        ? '<span class="crumb-cur">' + esc(f.name) + '</span>'
        : '<button class="crumb-seg" data-fid="' + f.id + '">' + esc(f.name) + '</button>';
    });
    html += '</div><div class="lib-nav-acts">';
    html += '<button class="chip-f" id="btnNewFolder">新建文件夹</button>';
    html += '<button class="chip-f' + (S.starOnly ? ' is-on' : '') + '" id="btnStarFilter">★ 收藏</button>';
    html += '</div>';
    nav.innerHTML = html;

    A.$$('.crumb-seg', nav).forEach(b => b.addEventListener('click', () => {
      S.folderId = b.dataset.fid;
      render();
    }));
    const nf = A.$('#btnNewFolder', nav);
    if (nf) nf.addEventListener('click', newFolder);
    const sf = A.$('#btnStarFilter', nav);
    if (sf) sf.addEventListener('click', () => {
      S.starOnly = !S.starOnly;
      render();
    });
  }

  function render() {
    const grid = A.$('#libGrid');
    const empty = A.$('#libEmpty');
    if (!grid) return;
    renderNav();
    const list = sorted();
    const subs = subFolders();

    if (!S.books.length && !S.folders.length) {
      grid.innerHTML = '';
      empty.classList.add('is-on');
      return;
    }
    empty.classList.remove('is-on');
    if (!list.length && !subs.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:60px 0;text-align:center;color:#70707c;font-size:14px">' +
        (S.q ? '没有匹配的笔记' : '这个文件夹是空的') + '</div>';
      return;
    }

    grid.innerHTML = '';
    const frag = document.createDocumentFragment();

    subs.forEach(f => {
      const card = A.el('div', 'book is-folder');
      card.dataset.fid = f.id;
      card.innerHTML =
        '<div class="folder-tile"><div class="folder-shape">' +
        '<svg viewBox="0 0 24 24" class="ico"><path d="M3.5 7.5A1.5 1.5 0 015 6h4.2l1.6 2h8.2a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5v-10z"/></svg>' +
        '</div><div class="folder-count">' + countIn(f.id) + ' 本</div></div>' +
        '<div class="book-meta"><div class="book-name">' + esc(f.name) + '</div>' +
        '<div class="book-time">文件夹</div></div>';
      // iPad 上没有右键：长按 560ms 弹菜单，短按进入
      let pT = 0, pMoved = false, pFired = false;
      card.addEventListener('pointerdown', (e) => {
        pMoved = false; pFired = false;
        clearTimeout(pT);
        pT = setTimeout(() => {
          if (pMoved) return;
          pFired = true;
          if (A.haptic) A.haptic(10);
          folderMenu(f);
        }, 560);
      });
      card.addEventListener('pointermove', () => { pMoved = true; clearTimeout(pT); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
        card.addEventListener(ev, () => clearTimeout(pT)));
      card.addEventListener('click', (e) => {
        if (pFired) { e.preventDefault(); e.stopPropagation(); pFired = false; return; }
        S.folderId = f.id; render();
      });
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); folderMenu(f); });
      frag.appendChild(card);
    });

    list.forEach((book) => {
      const card = A.el('div', 'book');
      card.dataset.id = book.id;
      const cover = A.el('div', 'book-cover');
      const cv = document.createElement('canvas');
      cover.appendChild(cv);
      cover.appendChild(A.el('div', 'cover-spine'));
      if (book.isHtml) {
        const badge = A.el('div', 'cover-badge');
        badge.textContent = 'HTML';
        cover.appendChild(badge);
      }
      if (book.starred) {
        const st = A.el('div', 'cover-star');
        st.textContent = '★';
        cover.appendChild(st);
      }
      card.appendChild(cover);
      const meta = A.el('div', 'book-meta');
      const tags = (book.tags || []).slice(0, 2).map(t => '<span class="tag-mini">' + esc(t) + '</span>').join('');
      meta.innerHTML = '<div class="book-name">' + esc(book.name || '未命名') + '</div>' +
        (tags ? '<div class="book-tags">' + tags + '</div>' : '') +
        '<div class="book-time">' + A.fmtAgo(book.updatedAt || book.createdAt || Date.now()) + ' · ' + (book.pageCount || 1) + ' 页</div>';
      card.appendChild(meta);
      frag.appendChild(card);

      requestAnimationFrame(() => paintCover(cv, book));
    });
    grid.appendChild(frag);

    bindCards();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ───── 交互 ───── */
  function bindCards() {
    A.$$('.book', document.getElementById('libGrid')).forEach(card => {
      const id = card.dataset.id;
      if (!id) return;
      let pressTimer = 0, longFired = false;

      card.addEventListener('pointerdown', (e) => {
        longFired = false;
        pressTimer = setTimeout(() => {
          longFired = true;
          A.haptic(12);
          openBookMenu(id);
        }, 620);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => {
        card.addEventListener(ev, () => clearTimeout(pressTimer));
      });
      card.addEventListener('click', (e) => {
        clearTimeout(pressTimer);
        if (longFired) { e.preventDefault(); return; }
        if (A.sheet.isOpen()) return;
        A.Studio.openBook(id);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openBookMenu(id);
      });
    });
  }

  /* ───── 书籍菜单 ───── */
  function openBookMenu(id) {
    const book = S.books.find(b => b.id === id);
    if (!book) return;
    const node = A.el('div');
    node.innerHTML = [
      '<div class="list">',
      '<button class="list-item" data-act="open"><svg class="ico" viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5v-13z"/><path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5A1.5 1.5 0 0020 18.5v-13z"/></svg><span class="li-grow">打开</span></button>',
      '<button class="list-item" data-act="star"><svg class="ico" viewBox="0 0 24 24"><path d="M12 4l2.5 5.3 5.5.8-4 3.9 1 5.5-5-2.8-5 2.8 1-5.5-4-3.9 5.5-.8z"/></svg><span class="li-grow">' + (book.starred ? '取消收藏' : '收藏') + '</span></button>',
      '<button class="list-item" data-act="move"><svg class="ico" viewBox="0 0 24 24"><path d="M3.5 7.5A1.5 1.5 0 015 6h4.2l1.6 2h8.2a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5v-10z"/></svg><span class="li-grow">移动到文件夹</span></button>',
      '<button class="list-item" data-act="tags"><svg class="ico" viewBox="0 0 24 24"><path d="M4 6h9l7 6-7 6H4z"/><circle cx="8" cy="12" r="1.4"/></svg><span class="li-grow">编辑标签</span></button>',
      '<button class="list-item" data-act="rename"><svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg><span class="li-grow">重命名</span></button>',
      '<button class="list-item" data-act="dup"><svg class="ico" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg><span class="li-grow">复制一本</span></button>',
      '<button class="list-item" data-act="export"><svg class="ico" viewBox="0 0 24 24"><path d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg><span class="li-grow">导出 PDF</span></button>',
      '<div class="list-sep"></div>',
      '<button class="list-item is-danger" data-act="del"><svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/></svg><span class="li-grow">删除</span></button>',
      '</div>'
    ].join('');

    A.sheet.open({
      title: esc(book.name),
      sub: (book.pageCount || 1) + ' 页' + ((book.tags || []).length ? ' · ' + book.tags.join(' / ') : ''),
      node: node,
      onMount: (body, sheet) => {
        A.$$('.list-item', body).forEach(btn => {
          btn.addEventListener('click', async () => {
            const act = btn.dataset.act;
            if (act === 'tags') { sheet.close(); setTimeout(() => editTags(book), 220); return; }
            if (act === 'move') { sheet.close(); setTimeout(() => moveBookTo(book), 220); return; }
            sheet.close();
            if (act === 'open') A.Studio.openBook(id);
            else if (act === 'star') {
              book.starred = !book.starred;
              await A.db.saveBook(book);
              await refresh();
              A.toast(book.starred ? '已收藏' : '已取消收藏');
            }
            else if (act === 'rename') renameBook(book);
            else if (act === 'dup') dupBook(book);
            else if (act === 'export') {
              A.Studio.openBook(id).then(() => A.Studio.exportPdf());
            } else if (act === 'del') delBook(book);
          });
        });
      }
    });
  }

  function renameBook(book) {
    const node = A.el('div');
    node.innerHTML = '<div class="field"><label>笔记名称</label><input type="text" id="rname" value="' + esc(book.name) + '"></div>' +
      '<div class="sheet-actions"><button class="btn btn--ghost" id="rCancel">取消</button><button class="btn btn--solid" id="rOk">保存</button></div>';
    A.sheet.open({
      title: '重命名',
      node,
      onMount: (body) => {
        const input = A.$('#rname', body);
        setTimeout(() => { input.focus(); input.select(); }, 260);
        const ok = async () => {
          const v = input.value.trim() || '未命名';
          book.name = v; book.updatedAt = A.now();
          await A.db.saveBook(book);
          A.sheet.close();
          await refresh();
        };
        A.$('#rOk', body).addEventListener('click', ok);
        A.$('#rCancel', body).addEventListener('click', () => A.sheet.close());
        input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      }
    });
  }

  async function dupBook(book) {
    A.busy('正在复制…');
    try {
      const pages = await A.db.pagesOf(book.id);
      const nb = Object.assign({}, book, {
        id: A.uid('bk'),
        name: book.name + ' 副本',
        createdAt: A.now(),
        updatedAt: A.now()
      });
      await A.db.saveBook(nb);
      const list = pages.map(p => Object.assign({}, p, { id: A.uid('pg'), bookId: nb.id }));
      await A.db.savePages(list);
      await refresh();
      A.toast('已复制');
    } finally { A.busy(false); }
  }

  function delBook(book) {
    const node = A.el('div');
    node.innerHTML = '<p style="margin:0 0 6px;font-size:14px;line-height:1.7;color:#a8a8b4">确定删除《' + esc(book.name) + '》？此操作不可撤销。</p>' +
      '<div class="sheet-actions"><button class="btn btn--ghost" id="dCancel">取消</button><button class="btn btn--danger" id="dOk">删除</button></div>';
    A.sheet.open({
      title: '删除笔记',
      node,
      onMount: (body) => {
        A.$('#dCancel', body).addEventListener('click', () => A.sheet.close());
        A.$('#dOk', body).addEventListener('click', async () => {
          A.sheet.close();
          await A.db.deleteBook(book.id);
          await refresh();
          A.toast('已删除');
        });
      }
    });
  }

  /* ── 文件夹 ── */
  function promptText(title, label, value, okText) {
    return new Promise((resolve) => {
      let settled = false;
      const node = A.el('div');
      node.innerHTML = '<div class="field"><label>' + label + '</label><input type="text" id="txtIn" value="' + esc(value || '') + '"></div>' +
        '<div class="sheet-actions"><button class="btn btn--ghost" id="txtCancel">取消</button><button class="btn btn--solid" id="txtOk">' + (okText || '保存') + '</button></div>';
      const done = (v) => { if (settled) return; settled = true; resolve(v); };
      A.sheet.open({
        title,
        node,
        onClose: () => done(null),
        onMount: (body) => {
          const input = A.$('#txtIn', body);
          setTimeout(() => { input.focus(); input.select(); }, 260);
          const ok = () => {
            const v = input.value.trim();
            done(v || null);
            A.sheet.close();
          };
          A.$('#txtOk', body).addEventListener('click', ok);
          A.$('#txtCancel', body).addEventListener('click', () => { done(null); A.sheet.close(); });
          input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
        }
      });
    });
  }

  async function newFolder() {
    const name = await promptText('新建文件夹', '文件夹名称', '新文件夹', '创建');
    if (!name) return;
    await A.db.saveFolder({ id: A.uid('fd'), name, parentId: S.folderId, createdAt: A.now() });
    await refresh();
    A.toast('已创建文件夹');
  }

  function confirmAction(title, sub, okText) {
    return new Promise((res) => {
      const node = A.el('div');
      node.innerHTML = '<div class="list">' +
        '<button class="list-item is-danger" data-a="y"><span class="li-grow">' + okText + '</span></button>' +
        '<button class="list-item" data-a="n"><span class="li-grow">取消</span></button>' +
        '</div>';
      A.sheet.open({
        title: title, sub: sub, node: node,
        onMount: (body, sh) => {
          A.$$('.list-item', body).forEach(b => b.addEventListener('click', () => {
            sh.close();
            res(b.dataset.a === 'y');
          }));
        },
        onClose: () => res(false)
      });
    });
  }

  function folderMenu(f) {
    const node = A.el('div');
    node.innerHTML = '<div class="list">' +
      '<button class="list-item" data-act="rename"><svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg><span class="li-grow">重命名</span></button>' +
      '<button class="list-item is-danger" data-act="del"><svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/></svg><span class="li-grow">删除文件夹<span class="li-sub">里面的笔记会退回上一级</span></span></button>' +
      '</div>';
    A.sheet.open({
      title: esc(f.name),
      node,
      onMount: (body, sheet) => {
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', async () => {
          const act = b.dataset.act;
          sheet.close();
          if (act === 'rename') {
            const name = await promptText('重命名文件夹', '文件夹名称', f.name);
            if (!name) return;
            f.name = name;
            await A.db.saveFolder(f);
            await refresh();
          } else if (act === 'del') {
            const nBooks = S.books.filter(x => (x.folderId || 'root') === f.id).length;
            const okDel = await confirmAction(
              '删除「' + f.name + '」？',
              nBooks ? '文件夹里的 ' + nBooks + ' 本笔记不会删，会退回上一级' : '这个文件夹是空的',
              nBooks ? '删除文件夹，笔记保留' : '删除文件夹'
            );
            if (!okDel) return;
            for (const bk of S.books.filter(x => (x.folderId || 'root') === f.id)) {
              bk.folderId = f.parentId || 'root';
              await A.db.saveBook(bk);
            }
            for (const sub of S.folders.filter(x => (x.parentId || 'root') === f.id)) {
              sub.parentId = f.parentId || 'root';
              await A.db.saveFolder(sub);
            }
            await A.db.deleteFolder(f.id);
            if (S.folderId === f.id) S.folderId = f.parentId || 'root';
            await refresh();
            A.toast('文件夹已删除');
          }
        }));
      }
    });
  }

  async function moveBookTo(book) {
    const options = [{ id: 'root', name: '全部笔记' }].concat(S.folders.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh')));
    const node = A.el('div');
    node.innerHTML = '<div class="list">' + options.map(f =>
      '<button class="list-item" data-fid="' + f.id + '"><svg class="ico" viewBox="0 0 24 24"><path d="M3.5 7.5A1.5 1.5 0 015 6h4.2l1.6 2h8.2a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5v-10z"/></svg><span class="li-grow">' +
      esc(f.name) + (book.folderId === f.id || (!book.folderId && f.id === 'root') ? '<span class="li-sub">当前位置</span>' : '') + '</span></button>'
    ).join('') + '</div>';
    A.sheet.open({
      title: '移动到',
      node,
      onMount: (body, sheet) => {
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', async () => {
          book.folderId = b.dataset.fid;
          book.updatedAt = A.now();
          await A.db.saveBook(book);
          sheet.close();
          await refresh();
          A.toast('已移动');
        }));
      }
    });
  }

  async function editTags(book) {
    const name = await promptText('笔记标签', '用逗号分隔多个标签', (book.tags || []).join('，'), '保存');
    if (name === null) return;
    book.tags = String(name).split(/[,，\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 6);
    book.updatedAt = A.now();
    await A.db.saveBook(book);
    await refresh();
  }

  /* ───── 新建 / 导入 ───── */
  async function newBook(preset) {
    const now = A.now();
    const book = {
      id: A.uid('bk'),
      name: '未命名笔记',
      createdAt: now,
      updatedAt: now,
      accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
      isHtml: false,
      pageCount: 1,
      folderId: S.folderId
    };
    const page = A.Studio.blankPage(book.id, 0, preset);
    await A.db.saveBook(book);
    await A.db.savePage(page);
    await refresh();
    A.Studio.openBook(book.id);
  }

  /* ───── 模板库：开篇就是排版好的成品页（Pages / GoodNotes 的做法） ───── */
  const TPL_CSS = '<style>'
    + 'body{margin:0;padding:54px 58px;font:16px/1.9 -apple-system,"PingFang SC","Songti SC",serif;color:#1f1f29;background:#fff}'
    + 'h1{font-size:29px;margin:0 0 6px;letter-spacing:.4px}'
    + 'h2{font-size:18px;margin:26px 0 10px;padding-left:10px;border-left:3px solid #c9a227}'
    + '.sub{color:#8a8a96;font-size:13px;margin:0 0 20px}'
    + 'hr{border:0;border-top:1px solid #e6e6ee;margin:20px 0}'
    + '.grid2{display:grid;grid-template-columns:34% 1fr;gap:16px}'
    + '.box{border:1px solid #e6e6ee;border-radius:10px;padding:14px 16px;min-height:110px}'
    + '.box h3{margin:0 0 8px;font-size:14px;color:#6a6a78;font-weight:600}'
    + '.line{height:1.85em;border-bottom:1px dashed #dcdce6}'
    + 'table{width:100%;border-collapse:collapse;font-size:14px}'
    + 'th,td{border:1px solid #e2e2ea;padding:9px 11px;text-align:left;vertical-align:top}'
    + 'th{background:#f7f5ee;font-weight:600}'
    + '.tag{display:inline-block;font-size:12px;padding:2px 9px;border-radius:99px;background:#f4efe0;color:#96762a;margin-right:6px}'
    + '.ck{display:inline-block;width:13px;height:13px;border:1.4px solid #b9b9c6;border-radius:3px;margin-right:8px;vertical-align:-2px}'
    + '</style>';

  const TEMPLATES = [
    {
      id: 'cornell', name: '康奈尔笔记', sub: '提示栏 / 笔记 / 总结',
      body: '<h1>康奈尔笔记</h1><p class="sub">左边记要点和问题，右边写正文，最后底部三句话总结</p>'
        + '<table><tr><th style="width:32%">线索 / 问题</th><th>笔记</th></tr>'
        + '<tr><td style="height:150px"><span class="line"></span><span class="line"></span><span class="line"></span></td>'
        + '<td><span class="line"></span><span class="line"></span><span class="line"></span><span class="line"></span></td></tr>'
        + '<tr><td style="height:150px"><span class="line"></span><span class="line"></span></td>'
        + '<td><span class="line"></span><span class="line"></span><span class="line"></span></td></tr>'
        + '<tr><td style="height:150px"><span class="line"></span><span class="line"></span></td>'
        + '<td><span class="line"></span><span class="line"></span><span class="line"></span></td></tr></table>'
        + '<h2>总结</h2><div class="box"><span class="line"></span><span class="line"></span><span class="line"></span></div>'
    },
    {
      id: 'meeting', name: '会议纪要', sub: '议题 / 决议 / 待办',
      body: '<h1>会议纪要</h1><p class="sub"><span class="tag">日期</span><span class="tag">地点</span><span class="tag">主持</span><span class="tag">记录</span></p>'
        + '<table><tr><th style="width:22%">参会人</th><td></td></tr>'
        + '<tr><th>会议目标</th><td></td></tr></table>'
        + '<h2>议题与讨论</h2><div class="box"><span class="line"></span><span class="line"></span><span class="line"></span><span class="line"></span></div>'
        + '<h2>结论 / 决议</h2><div class="box"><span class="line"></span><span class="line"></span></div>'
        + '<h2>待办</h2><table><tr><th style="width:46%">事项</th><th style="width:18%">负责人</th><th>截止</th></tr>'
        + '<tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr>'
        + '<tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></table>'
    },
    {
      id: 'reading', name: '读书笔记', sub: '摘录 / 想法 / 行动',
      body: '<h1>读书笔记</h1><p class="sub"><span class="tag">书名</span><span class="tag">作者</span><span class="tag">读完日期</span></p>'
        + '<h2>一句话概括</h2><div class="box" style="min-height:64px"><span class="line"></span></div>'
        + '<h2>摘录</h2><div class="box"><span class="line"></span><span class="line"></span><span class="line"></span><span class="line"></span><span class="line"></span></div>'
        + '<h2>我的想法</h2><div class="box"><span class="line"></span><span class="line"></span><span class="line"></span></div>'
        + '<h2>可以立刻做的事</h2><div class="box"><span class="ck"></span><span class="line"></span><span class="ck"></span><span class="line"></span></div>'
    },
    {
      id: 'week', name: '周计划', sub: '七天 / 优先级',
      body: '<h1>本周计划</h1><p class="sub">先写三件最重要的事，其余排进格子</p>'
        + '<table><tr><th style="width:16%">周一</th><td style="height:74px"></td></tr>'
        + '<tr><th>周二</th><td style="height:74px"></td></tr>'
        + '<tr><th>周三</th><td style="height:74px"></td></tr>'
        + '<tr><th>周四</th><td style="height:74px"></td></tr>'
        + '<tr><th>周五</th><td style="height:74px"></td></tr>'
        + '<tr><th>周六</th><td style="height:74px"></td></tr>'
        + '<tr><th>周日</th><td style="height:74px"></td></tr></table>'
        + '<h2>本周最重要三件事</h2><div class="box"><span class="ck"></span>1.<span class="line"></span><span class="ck"></span>2.<span class="line"></span><span class="ck"></span>3.<span class="line"></span></div>'
    },
    {
      id: 'okr', name: 'OKR 目标', sub: '目标 / 关键结果 / 进度',
      body: '<h1>OKR</h1><p class="sub"><span class="tag">周期</span><span class="tag">负责人</span></p>'
        + '<h2>O · 目标</h2><div class="box" style="min-height:60px"><span class="line"></span></div>'
        + '<h2>KR · 关键结果</h2><table><tr><th style="width:62%">关键结果</th><th style="width:16%">目标值</th><th>当前</th></tr>'
        + '<tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></table>'
        + '<h2>动作拆解</h2><div class="box"><span class="ck"></span><span class="line"></span><span class="ck"></span><span class="line"></span><span class="ck"></span><span class="line"></span></div>'
    },
    {
      id: 'travel', name: '旅行清单', sub: '行前 / 行程 / 花费',
      body: '<h1>旅行清单</h1><p class="sub"><span class="tag">目的地</span><span class="tag">日期</span><span class="tag">同行</span></p>'
        + '<div class="grid2"><div class="box"><h3>行前要办</h3>'
        + '<div><span class="ck"></span>证件 / 签证</div><div><span class="ck"></span>机票 / 车票</div>'
        + '<div><span class="ck"></span>住宿</div><div><span class="ck"></span>保险</div><div><span class="ck"></span>换汇</div></div>'
        + '<div class="box"><h3>行李</h3><div><span class="ck"></span>充电器 / 转换头</div><div><span class="ck"></span>常用药</div>'
        + '<div><span class="ck"></span>雨具</div><div><span class="ck"></span>相机</div><div><span class="ck"></span></div></div></div>'
        + '<h2>行程</h2><table><tr><th style="width:18%">日期</th><th>安排</th><th style="width:22%">备注</th></tr>'
        + '<tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></table>'
    }
  ];

  function openTemplates() {
    const node = A.el('div');
    const list = A.el('div', 'list');
    TEMPLATES.forEach(t => {
      const b = A.el('button', 'list-item');
      b.dataset.t = t.id;
      b.innerHTML = '<svg class="ico" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>'
        + '<span class="li-grow" style="text-align:left"><b style="font-weight:600">' + t.name + '</b>'
        + '<span style="display:block;font-size:12px;color:#8a8a96;margin-top:2px">' + t.sub + '</span></span>';
      list.appendChild(b);
    });
    node.appendChild(list);
    A.sheet.open({
      title: '模板库',
      sub: '选一个版式，直接开始写',
      node,
      onMount: (body, sh) => {
        A.$$('[data-t]', body).forEach(b => b.addEventListener('click', async () => {
          const t = TEMPLATES.find(x => x.id === b.dataset.t);
          if (!t) return;
          sh.close();
          A.busy('正在排版…');
          try {
            const html = '<!doctype html><html><head><meta charset="utf-8">' + TPL_CSS + '</head><body>' + t.body + '</body></html>';
            const id = await A.Studio.createHtmlBook(html, t.name);
            A.busy(false);
            await refresh();
            if (id) A.Studio.openBook(id);
          } catch (e) { A.busy(false); A.toast('模板创建失败：' + (e.message || '')); }
        }));
      }
    });
  }

  async function importFiles(files) {
    if (!files || !files.length) return;
    A.busy('正在导入 HTML…');
    try {
      let opened = null;
      let ok = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (!/\.html?$/i.test(f.name) && f.type !== 'text/html') {
          A.toast('已跳过非 HTML 文件：' + f.name);
          continue;
        }
        const text = await A.readText(f);
        if (!text || !text.trim()) { A.toast('文件为空：' + f.name); continue; }
        const name = f.name.replace(/\.html?$/i, '') || 'HTML 笔记';
        const id = await A.Studio.createHtmlBook(text, name);
        if (!opened) opened = id;
        ok++;
      }
      await refresh();
      A.busy(false);
      if (opened) {
        A.toast(ok > 1 ? '已导入 ' + ok + ' 个文件' : '导入完成');
        A.Studio.openBook(opened);
      } else {
        A.toast('没有可导入的文件');
      }
    } catch (err) {
      A.busy(false);
      console.error(err);
      A.toast('导入失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  /* ───── 刷新 ───── */
  async function refresh() {
    await A.dbReady;
    const list = await A.db.allBooks();
    for (const b of list) {
      if (b.pageCount == null) {
        b.pageCount = await A.db.countPages(b.id);
      }
    }
    S.books = list;
    try { S.folders = await A.db.allFolders(); } catch (e) { S.folders = []; }
    if (S.folderId !== 'root' && !S.folders.some(f => f.id === S.folderId)) S.folderId = 'root';
    if (A.backup) A.backup.writeMeta(list);
    render();
    updateFoot();
  }

  function updateFoot() {
    const sub = A.$('#libSub');
    if (sub) sub.textContent = S.books.length ? (S.books.length + ' 本笔记') : '本地存储 · 不上传云端';
    const foot = A.$('#libFoot');
    if (!foot) return;
    foot.innerHTML =
      '<span>共 ' + S.books.length + ' 本 · ' + S.books.reduce((a, b) => a + (b.pageCount || 1), 0) + ' 页' + (A.db.memoryOnly ? ' · 临时存储（刷新会丢失）' : '') + '</span>' +
      '<span class="foot-links">' +
      '<button id="footBackup">备份全部</button>' +
      '<button id="footRestore">恢复备份</button>' +
      '<button id="footHelp">使用说明</button>' +
      '</span>';
    const bk = A.$('#footBackup', foot), rs = A.$('#footRestore', foot), hp = A.$('#footHelp', foot);
    if (bk) bk.addEventListener('click', backupAll);
    if (rs) rs.addEventListener('click', () => A.$('#fileRestore').click());
    if (hp) hp.addEventListener('click', help);
  }

  async function backupAll() {
    A.busy('正在打包…');
    try {
      const data = await A.db.dumpAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const d = new Date();
      A.download(blob, '墨屿备份-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json');
      A.toast('备份已导出');
    } catch (e) {
      A.toast('备份失败');
    } finally { A.busy(false); }
  }

  async function restore(file) {
    A.busy('正在恢复…');
    try {
      const text = await A.readText(file);
      const data = JSON.parse(text);
      if (!data || data.format !== 'moyu-backup') throw new Error('格式不正确');
      // ① 文件夹（跳过已存在的同名 id）
      const folders = Array.isArray(data.folders) ? data.folders : [];
      for (const f of folders) {
        if (!f || !f.id) continue;
        const ex = await A.db.getFolder(f.id);
        if (!ex) await A.db.saveFolder(f);
      }

      // ② 原始资源（HTML 源码 / PDF 底图 / 录音）先入池
      const pool = data.assets || {};
      const remap = new Map();
      async function copyAsset(oldKey) {
        if (!oldKey) return null;
        if (remap.has(oldKey)) return remap.get(oldKey);
        let payload = pool[oldKey];
        if (payload === undefined) payload = await A.db.getAsset(oldKey);
        if (payload == null) { remap.set(oldKey, null); return null; }
        const nk = A.uid('as');
        await A.db.putAsset(nk, payload);
        remap.set(oldKey, nk);
        return nk;
      }

      let n = 0;
      for (const item of data.books) {
        const book = item.book;
        if (!book || !book.id) continue;
        const exist = await A.db.getBook(book.id);
        if (exist) { book.id = A.uid('bk'); book.name = book.name + ' (恢复)'; }
        await A.db.saveBook(book);

        const pages = [];
        for (const raw of (item.pages || [])) {
          const p2 = Object.assign({}, raw);
          p2.bookId = book.id;
          if (exist) p2.id = A.uid('pg');
          if (p2.srcKey) p2.srcKey = await copyAsset(p2.srcKey) || p2.srcKey;
          if (p2.bgKey) p2.bgKey = await copyAsset(p2.bgKey) || p2.bgKey;
          if (p2.rec && p2.rec.key) p2.rec = Object.assign({}, p2.rec, { key: await copyAsset(p2.rec.key) || p2.rec.key });
          pages.push(p2);
        }
        await A.db.savePages(pages);
        n++;
      }
      // 文件夹 id 悬空的书会从书架直接消失：落到根目录，至少能看见
      const allF = await A.db.allFolders();
      const fset = new Set((allF || []).map(f => f.id));
      for (const item of data.books) {
        const b = item.book;
        if (!b || !b.id) continue;
        if (b.folderId && !fset.has(b.folderId)) {
          b.folderId = null;
          await A.db.saveBook(b);
        }
      }
      await refresh();
      if (A.Search) A.Search.invalidate();
      A.toast('已恢复 ' + n + ' 本笔记' + (folders.length ? '、' + folders.length + ' 个文件夹' : ''));
    } catch (e) {
      A.toast('恢复失败：' + (e.message || ''));
    } finally { A.busy(false); }
  }

  function help() {
    const node = A.el('div');
    node.innerHTML =
      '<div style="font-size:14px;line-height:1.85;color:#b9b9c4">' +
      '<p style="margin:0 0 12px"><b style="color:#e0b263">1. 导入 HTML</b><br>点击「导入 HTML」，选一个 .html 文件。它会像一张无限长的纸铺开，原样式完整保留。</p>' +
      '<p style="margin:0 0 12px"><b style="color:#e0b263">2. 手写</b><br>用 Apple Pencil 直接在页面上写。手指按住拖拽是移动画面，两指捏合缩放。</p>' +
      '<p style="margin:0 0 12px"><b style="color:#e0b263">3. 浏览网页内容</b><br>点工具栏的「浏览」，页面上链接和交互就能点了；再点一次回到手写。</p>' +
      '<p style="margin:0 0 12px"><b style="color:#e0b263">4. 橡皮</b><br>点按擦除整笔，拖拽擦除部分（像素擦）。</p>' +
      '<p style="margin:0 0 0"><b style="color:#e0b263">5. 数据在自己设备上</b><br>所有内容存在本机。建议定期「备份全部」，导出 JSON 存到 iCloud Drive。</p>' +
      '</div>';
    A.sheet.open({ title: '使用说明', node });
  }

  /* ───── 绑定 ───── */
  function init() {
    const bind = (sel, fn) => { const n = A.$(sel); if (n) n.addEventListener('click', fn); };
    bind('#btnNewBook', () => newBook());
    bind('#btnEmptyNew', () => newBook());
    bind('#btnImportHtml', () => A.$('#fileHtml').click());
    bind('#btnEmptyImport', () => A.$('#fileHtml').click());
    bind('#btnTemplates', openTemplates);
    bind('#btnImportPdf', () => {
      if (A.PdfImport) A.PdfImport.pick();
      else A.toast('PDF 模块未加载');
    });

    // 书架搜索框：回车直接进整库全文搜索（书名没命中时也能搜到内容）
    const sb = A.$('#libSearch');
    if (sb) {
      sb.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sb.blur();
          if (A.Search) A.Search.open(sb.value.trim());
        }
      });
    }

    const fi = A.$('#fileHtml');
    if (fi) fi.addEventListener('change', async () => {
      const files = Array.prototype.slice.call(fi.files || []);
      fi.value = '';
      await importFiles(files);
    });

    const fr = A.$('#fileRestore');
    if (fr) fr.addEventListener('change', async () => {
      const f = (fr.files || [])[0];
      fr.value = '';
      if (f) await restore(f);
    });

    A.$$('#libSortSeg .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        A.$$('#libSortSeg .seg-btn').forEach(b => b.classList.remove('is-on'));
        btn.classList.add('is-on');
        S.sort = btn.dataset.sort;
        render();
      });
    });

    const search = A.$('#libSearch');
    if (search) {
      search.addEventListener('input', A.debounce(() => {
        S.q = search.value.trim();
        render();
      }, 160));
    }

    // 拖拽 html 文件到窗口
    ['dragover', 'drop'].forEach(ev => {
      window.addEventListener(ev, (e) => {
        if (!document.getElementById('viewLibrary').classList.contains('is-active')) return;
        e.preventDefault();
        if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          importFiles(Array.prototype.slice.call(e.dataTransfer.files));
        }
      });
    });
  }

  A.Library = { init, refresh, paintCover, openBookMenu, S };
})(window.MY);
