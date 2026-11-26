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
    ready: false,
    collapsed: new Set()
  };

  const ACCENTS = ['#e0b263', '#7fa7f5', '#e08a8a', '#8fd0a8', '#b79cf0', '#e8a06a'];

  /* Notability 式分隔线分组：div_all/div_recent/div_inbox 为内置，用户可新建 custom 分组 */
  const DIVIDERS = [
    { id: 'div_all', name: '所有笔记', role: 'all' },
    { id: 'div_recent', name: '近期笔记', role: 'recent' },
    { id: 'div_inbox', name: '未归档', role: 'inbox' }
  ];
  const LS_COLLAPSED = 'moyu_collapsed_divs';
  const RECENT_LIMIT = 8;

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

  /* 分隔线（Divider）本身不是可进入的文件夹，是书架的"总目录" */
  function isDivider(f) { return !!(f && f.type === 'divider'); }
  function realFolders() { return S.folders.filter(f => !isDivider(f)); }

  function dividerList() {
    const order = { all: 0, recent: 1, inbox: 2 };
    return S.folders.filter(isDivider).sort((a, b) => {
      const oa = order[a.role] != null ? order[a.role] : 3;
      const ob = order[b.role] != null ? order[b.role] : 3;
      if (oa !== ob) return oa - ob;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  /* 顶层文件夹归属的分组；无标记或分组已被删则回落到「所有笔记」 */
  function dividerOf(f) {
    const d = f.dividerId || 'div_all';
    return S.folders.some(x => x.id === d && isDivider(x)) ? d : 'div_all';
  }

  function subFolders() {
    return realFolders()
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
        if (isDivider(f)) continue;
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
    let cur = realFolders().find(f => f.id === S.folderId);
    let guard = 0;
    while (cur && guard++ < 20) {
      out.unshift(cur);
      cur = realFolders().find(f => f.id === (cur.parentId || 'root'));
      if (cur && cur.id === S.folderId) break;
    }
    return out;
  }

  function rootEntry() {
    return '<button class="side-folder' + (S.folderId === 'root' ? ' is-on' : '') + '" data-fid="root">' +
      '<span class="dot"></span><span>全部笔记</span><span class="cnt">' + S.books.length + '</span></button>';
  }

  /* 递归渲染真实文件夹，缩进最多三级（复用原 side-folder 的 ind-1/2/3） */
  function walkFolders(list, depth, out) {
    list.forEach(f => {
      const n = S.books.filter(b => (b.folderId || 'root') === f.id).length;
      out.push('<button class="side-folder ind-' + Math.min(3, depth) + (S.folderId === f.id ? ' is-on' : '') +
        '" data-fid="' + f.id + '"><span class="dot"></span><span>' + esc(f.name) + '</span>' +
        '<span class="cnt">' + n + '</span></button>');
      walkFolders(realFolders().filter(x => (x.parentId || 'root') === f.id), depth + 1, out);
    });
  }

  function noteItem(b) {
    return '<button class="side-note" data-id="' + b.id + '">' +
      '<span class="dot"></span><span>' + esc(b.name || '未命名') + '</span>' +
      '<span class="cnt">' + (b.starred ? '★' : (b.pageCount || 1) + '页') + '</span></button>';
  }

  function recentChildren() {
    const list = S.books.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, RECENT_LIMIT);
    if (!list.length) return '<div class="side-empty">还没有笔记</div>';
    return list.map(noteItem).join('');
  }

  function inboxChildren() {
    const list = S.books.filter(b => (b.folderId || 'root') === 'root');
    if (!list.length) return '<div class="side-empty">没有未归档的笔记</div>';
    return list.map(noteItem).join('');
  }

  function folderChildren(d) {
    const out = [];
    if (d.role === 'all') out.push(rootEntry());
    const top = realFolders().filter(f => (f.parentId || 'root') === 'root' && dividerOf(f) === d.id);
    walkFolders(top, 1, out);
    if (d.role === 'custom' && !out.length) out.push('<div class="side-empty">暂无文件夹</div>');
    return out.join('');
  }

  function dividerChildren(d) {
    if (d.role === 'recent') return recentChildren();
    if (d.role === 'inbox') return inboxChildren();
    return folderChildren(d);
  }

  function dividerCount(d) {
    if (d.role === 'all') return S.books.length;
    if (d.role === 'recent') return Math.min(RECENT_LIMIT, S.books.length);
    if (d.role === 'inbox') return S.books.filter(b => (b.folderId || 'root') === 'root').length;
    return realFolders().filter(f => (f.parentId || 'root') === 'root' && dividerOf(f) === d.id).length;
  }

  function renderNav() {
    const nav = A.$('#libNav');
    if (!nav) return;
    const t = trail();
    const curF = t.length ? t[t.length - 1] : null;
    const title = A.$('#libTitle');
    if (title) title.textContent = curF ? curF.name : '我';

    let html = '';
    dividerList().forEach(d => {
      const collapsed = S.collapsed.has(d.id);
      html += '<button class="side-divider' + (collapsed ? '' : ' is-open') + '" data-div="' + d.id + '">' +
        '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
        '<span class="dv-dot"></span>' +
        '<span class="dv-name">' + esc(d.name) + '</span>' +
        '<span class="dv-cnt">' + dividerCount(d) + '</span></button>';
      if (!collapsed) html += dividerChildren(d);
    });
    nav.innerHTML = html;

    // 分组：轻触折叠/展开，长按重命名/删除
    A.$$('.side-divider', nav).forEach(b => {
      const id = b.dataset.div;
      let pT = 0, pMoved = false, pFired = false;
      b.addEventListener('pointerdown', () => {
        pMoved = false; pFired = false;
        clearTimeout(pT);
        pT = setTimeout(() => {
          if (pMoved) return;
          pFired = true;
          const d = S.folders.find(f => f.id === id);
          if (d) { if (A.haptic) A.haptic(10); dividerMenu(d); }
        }, 560);
      });
      b.addEventListener('pointermove', () => { pMoved = true; clearTimeout(pT); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => clearTimeout(pT)));
      b.addEventListener('click', (e) => {
        if (pFired) { e.preventDefault(); e.stopPropagation(); pFired = false; return; }
        if (S.collapsed.has(id)) S.collapsed.delete(id); else S.collapsed.add(id);
        persistCollapsed();
        renderNav();
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const d = S.folders.find(f => f.id === id);
        if (d) dividerMenu(d);
      });
    });

    // 文件夹进入
    A.$$('.side-folder', nav).forEach(b => b.addEventListener('click', () => {
      S.folderId = b.dataset.fid;
      S.starOnly = false;
      setNavActive('notes');
      render();
    }));

    // 分组下的笔记直接打开
    A.$$('.side-note', nav).forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (id && A.Studio) A.Studio.openBook(id);
    }));
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
      // Notability 式空文件夹：圆形灰底图标 + 引导文案
      grid.innerHTML =
        '<div class="folder-empty" style="grid-column:1/-1;padding:70px 20px;text-align:center;color:var(--tx-3)">' +
        '<div class="folder-empty-ico"><svg viewBox="0 0 24 24" class="ico" style="width:54px;height:54px">' +
        '<path d="M3.5 7.5A1.5 1.5 0 015 6h4.2l1.6 2h8.2a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5v-10z"/></svg></div>' +
        '<div style="margin-top:16px;font-size:15px;color:var(--tx-2)">' + (S.q ? '没有匹配的笔记' : '这个文件夹还是空的') + '</div>' +
        '<div style="margin-top:8px;font-size:13px;line-height:1.8">轻触「新建」按钮，创建新笔记。<br>长按「新建」按钮，导入文件或从模板开始。</div>' +
        '</div>';
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
    await A.db.saveFolder({ id: A.uid('fd'), name, parentId: S.folderId, dividerId: 'div_all', createdAt: A.now() });
    await refresh();
    A.toast('已创建文件夹');
  }

  async function newDivider() {
    const name = await promptText('新建分组', '分组名称', '新分组', '创建');
    if (!name) return;
    await A.db.saveFolder({ id: A.uid('dv'), name, type: 'divider', role: 'custom', parentId: 'root', createdAt: A.now() });
    await refresh();
    A.toast('已创建分组');
  }

  /* 把顶层文件夹挂到某个分组下（内置 recent/inbox 是自动分组，不可选） */
  function moveFolderToDivider(f) {
    const divs = dividerList().filter(d => d.role !== 'recent' && d.role !== 'inbox');
    const node = A.el('div');
    node.innerHTML = '<div class="list">' + divs.map(d =>
      '<button class="list-item" data-div="' + d.id + '"><span class="li-grow">' + esc(d.name) +
      (dividerOf(f) === d.id ? '<span class="li-sub">当前位置</span>' : '') + '</span></button>'
    ).join('') + '</div>';
    A.sheet.open({
      title: '移动到分组',
      node,
      onMount: (body, sheet) => {
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', async () => {
          f.dividerId = b.dataset.div;
          await A.db.saveFolder(f);
          sheet.close();
          await refresh();
          A.toast('已移动');
        }));
      }
    });
  }

  function dividerMenu(d) {
    const node = A.el('div');
    node.innerHTML = '<div class="list">' +
      '<button class="list-item" data-act="rename"><svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg><span class="li-grow">重命名分组</span></button>' +
      (d.role === 'custom' ? '<button class="list-item is-danger" data-act="del"><svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/></svg><span class="li-grow">删除分组</span></button>' : '') +
      '</div>';
    A.sheet.open({
      title: esc(d.name),
      node,
      onMount: (body, sheet) => {
        A.$$('.list-item', body).forEach(b => b.addEventListener('click', async () => {
          const act = b.dataset.act;
          sheet.close();
          if (act === 'rename') {
            const name = await promptText('重命名分组', '分组名称', d.name);
            if (!name) return;
            d.name = name;
            await A.db.saveFolder(d);
            await refresh();
          } else if (act === 'del') {
            for (const f of realFolders().filter(x => (x.parentId || 'root') === 'root' && dividerOf(x) === d.id)) {
              f.dividerId = 'div_all';
              await A.db.saveFolder(f);
            }
            await A.db.deleteFolder(d.id);
            if (S.collapsed.has(d.id)) S.collapsed.delete(d.id);
            await refresh();
            A.toast('分组已删除');
          }
        }));
      }
    });
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
    const isTop = (f.parentId || 'root') === 'root';
    const node = A.el('div');
    node.innerHTML = '<div class="list">' +
      '<button class="list-item" data-act="rename"><svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg><span class="li-grow">重命名</span></button>' +
      (isTop ? '<button class="list-item" data-act="group"><svg class="ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span class="li-grow">移动到分组</span></button>' : '') +
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
          } else if (act === 'group') {
            setTimeout(() => moveFolderToDivider(f), 220);
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
    const options = [{ id: 'root', name: '全部笔记' }].concat(realFolders().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh')));
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
  /* 首次启动时补种内置分组（所有笔记/近期笔记/未归档） */
  async function ensureDividers() {
    let changed = false;
    for (const d of DIVIDERS) {
      if (!S.folders.some(f => f.id === d.id && isDivider(f))) {
        await A.db.saveFolder({ id: d.id, name: d.name, type: 'divider', role: d.role, parentId: 'root', createdAt: A.now() });
        changed = true;
      }
    }
    if (changed) {
      try { S.folders = await A.db.allFolders(); } catch (e) { }
    }
  }

  function persistCollapsed() {
    try { localStorage.setItem(LS_COLLAPSED, JSON.stringify(Array.from(S.collapsed))); } catch (e) { }
  }

  function loadCollapsed() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_COLLAPSED) || '[]');
      if (Array.isArray(raw)) raw.forEach(x => S.collapsed.add(x));
    } catch (e) { }
  }

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
    await ensureDividers();
    if (S.folderId !== 'root' && !realFolders().some(f => f.id === S.folderId)) S.folderId = 'root';
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

  /* ───── 主题：深色 / 浅色 / 跟随系统 ───── */
  const LS_THEME = 'moyu_theme';
  const THEMES = [
    { id: 'dark', name: '深色' },
    { id: 'light', name: '浅色' },
    { id: 'auto', name: '跟随系统' }
  ];
  let themeMode = 'dark';
  try { themeMode = localStorage.getItem(LS_THEME) || 'dark'; } catch (e) { }

  function applyTheme(mode) {
    themeMode = mode;
    try { localStorage.setItem(LS_THEME, mode); } catch (e) { }
    document.documentElement.setAttribute('data-theme', mode);
    const t = THEMES.find(x => x.id === mode) || THEMES[0];
    const lab = A.$('#themeLabel');
    if (lab) lab.textContent = t.name;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const light = mode === 'light' ||
        (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
      meta.setAttribute('content', light ? '#f2f2f5' : '#111113');
    }
  }

  function cycleTheme() {
    const i = THEMES.findIndex(t => t.id === themeMode);
    applyTheme(THEMES[(i + 1) % THEMES.length].id);
    A.toast('主题：' + (THEMES.find(t => t.id === themeMode) || THEMES[0]).name);
  }

  function setNavActive(key) {
    A.$$('#sideNav .side-item').forEach(b => b.classList.toggle('is-on', b.dataset.nav === key));
  }

  /* ───── 新建：轻触空白笔记，长按出更多入口 ───── */
  function newSheet() {
    const node = A.el('div');
    const items = [
      { a: 'blank', t: '空白笔记', s: 'A4 横线纸，直接开始写', i: 'M12 5v14M5 12h14' },
      { a: 'tpl', t: '从模板开始', s: '康奈尔 / 会议 / 读书 / 周计划…', i: 'M4 3h16v18H4z M8 8h8M8 12h8' },
      { a: 'import', t: '导入文件', s: 'HTML / PDF / Markdown / 图片，自动识别', i: 'M12 16V4m0 12l-4-4m4 4l4-4' },
      { a: 'folder', t: '新建文件夹', s: '整理当前书架', i: 'M3.5 7.5h17v10h-17z' },
      { a: 'divider', t: '新建分组', s: 'Notability 式分隔线分组', i: 'M4 6h16M4 12h16M4 18h10' }
    ];
    node.innerHTML = '<div class="list">' + items.map(x =>
      '<button class="list-item" data-a="' + x.a + '"><svg class="ico" viewBox="0 0 24 24"><path d="' + x.i + '"/></svg>' +
      '<span class="li-grow" style="text-align:left">' + x.t +
      '<span style="display:block;font-size:12px;color:#8a8a96;margin-top:2px">' + x.s + '</span></span></button>'
    ).join('') + '</div>';
    A.sheet.open({ title: '新建', sub: '选一种开始方式', node, onMount: (body, sh) => {
      A.$$('[data-a]', body).forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.a;
        sh.close();
        setTimeout(() => {
          if (a === 'blank') newBook();
          else if (a === 'tpl') openTemplates();
          else if (a === 'import') { const inp = A.$('#fileAny'); if (inp) inp.click(); }
          else if (a === 'folder') newFolder();
          else if (a === 'divider') newDivider();
        }, 180);
      }));
    } });
  }

  function bindNewButton() {
    const btn = A.$('#btnNewBook');
    if (!btn) return;
    let timer = null, fired = false;
    btn.addEventListener('pointerdown', () => {
      fired = false;
      timer = setTimeout(() => { fired = true; newSheet(); }, 520);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
      btn.addEventListener(ev, () => clearTimeout(timer)));
    btn.addEventListener('click', (e) => {
      if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; return; }
      newBook();
    });
  }

  /* ───── 导入：一个入口按扩展名自动分流 ───── */
  function mdToHtml(text, name) {
    const esc2 = t => t.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inList = false, inCode = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    lines.forEach(raw => {
      let l = raw;
      if (/^```/.test(l)) { closeList(); inCode = !inCode; out.push(inCode ? '<pre><code>' : '</code></pre>'); return; }
      if (inCode) { out.push(esc2(l)); return; }
      const h = l.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); out.push('<h' + h[1].length + '>' + esc2(h[2]) + '</h' + h[1].length + '>'); return; }
      if (/^\s*[-*+]\s+/.test(l)) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + esc2(l.replace(/^\s*[-*+]\s+/, '')) + '</li>'); return; }
      closeList();
      if (!l.trim()) return;
      out.push('<p>' + esc2(l) + '</p>');
    });
    closeList();
    return '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
      '<style>body{margin:0;padding:52px 56px;font:16px/1.85 -apple-system,"PingFang SC",serif;color:#222}h1,h2,h3,h4{line-height:1.4;margin:24px 0 10px}h1{font-size:28px}p{margin:10px 0}pre{background:#f5f5f7;padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Menlo,monospace;font-size:13px}li{margin:4px 0}</style>' +
      out.join('\n') + '</body></html>';
  }

  async function importAny(files) {
    if (!files || !files.length) return;
    A.busy('正在识别文件…');
    let opened = null, n = 0;
    try {
      for (const f of files) {
        const name = f.name || 'file';
        const ext = (name.split('.').pop() || '').toLowerCase();
        if (ext === 'html' || ext === 'htm' || f.type === 'text/html') {
          const text = await A.readText(f);
          if (text && text.trim()) {
            const id = await A.Studio.createHtmlBook(text, name.replace(/\.html?$/i, '') || 'HTML 笔记');
            opened = opened || id; n++;
          }
        } else if (ext === 'pdf' || f.type === 'application/pdf') {
          if (!A.PdfImport) { A.toast('PDF 模块未加载'); continue; }
          A.busy('正在导入 PDF…');
          const id = await A.PdfImport.importFile(f);
          A.busy('正在识别文件…');
          if (id) { opened = opened || id; n++; }
        } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
          const text = await A.readText(f);
          if (text && text.trim()) {
            const id = await A.Studio.createHtmlBook(mdToHtml(text, name), name.replace(/\.[^.]+$/, '') || '文本笔记');
            opened = opened || id; n++;
          }
        } else if (/^image\//.test(f.type || '')) {
          const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
          const html = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">' +
            '<img src="' + dataUrl + '" style="display:block;width:1024px;height:auto"></body></html>';
          const id = await A.Studio.createHtmlBook(html, name.replace(/\.[^.]+$/, '') || '图片笔记');
          opened = opened || id; n++;
        } else {
          A.toast('暂不支持这种文件：' + name);
        }
      }
      A.busy(false);
      await refresh();
      if (opened) {
        A.toast(n > 1 ? ('已导入 ' + n + ' 个文件') : '导入完成');
        A.Studio.openBook(opened);
      } else if (!n) {
        A.toast('没有可导入的文件');
      }
    } catch (e) {
      A.busy(false);
      A.toast('导入失败：' + (e.message || ''));
    }
  }

  /* ───── 绑定 ───── */
  function init() {
    const bind = (sel, fn) => { const n = A.$(sel); if (n) n.addEventListener('click', fn); };
    applyTheme(themeMode);
    loadCollapsed();
    bindNewButton();
    bind('#btnShelfMore', newSheet);
    // 收藏筛选（原先是导航里的 chip，现在收进侧栏"笔记"再点一次）
    bind('#btnStarFilter', () => { S.starOnly = !S.starOnly; render(); });
    bind('#btnEmptyNew', () => newBook());
    bind('#btnEmptyImport', () => { const inp = A.$('#fileAny'); if (inp) inp.click(); });
    bind('#btnTemplates', openTemplates);
    bind('#btnThemeMode', cycleTheme);
    bind('#btnHelp', help);
    bind('#btnNewFolderSide', newFolder);
    bind('#btnNewDivider', newDivider);
    bind('#btnSettings', () => {
      // 设置：目前汇聚帮助、主题、朗读语速等入口，先给一个简明说明
      A.toast('设置：主题、朗读语速可在编辑页顶部调节');
      if (A.Words) A.Words.openProvider(A.Words.aiId, '');
    });
    bind('#btnNotify', () => A.toast('暂无新通知'));
    bind('#btnSideToggle', () => {
      document.body.classList.toggle('side-hidden');
      const o = A.$('#btnSideOpen');
      if (o) o.hidden = !document.body.classList.contains('side-hidden');
    });
    bind('#btnSideOpen', () => {
      document.body.classList.remove('side-hidden');
      const o = A.$('#btnSideOpen'); if (o) o.hidden = true;
    });
    bind('#wdClose', () => A.Words && A.Words.closeDrawer());
    bind('#wdCards', () => A.Words && A.Words.makeCards());
    bind('#wdClear', () => {
      if (!A.Words) return;
      A.Words.clear(); A.Words.renderDrawer();
      A.toast('生词本已清空');
    });
    bind('#btnImportHtml', () => { const inp = A.$('#fileAny'); if (inp) inp.click(); });
    bind('#btnImportPdf', () => {
      if (A.PdfImport) A.PdfImport.pick();
      else A.toast('PDF 模块未加载');
    });

    // 左侧导航
    A.$$('#sideNav .side-item').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.nav;
      setNavActive(k);
      if (k === 'words') { if (A.Words) A.Words.openDrawer(); return; }
      S.folderId = 'root';
      S.starOnly = (k === 'star');
      render();
    }));

    // 自动识别导入
    const fa = A.$('#fileAny');
    if (fa) fa.addEventListener('change', async () => {
      const files = Array.prototype.slice.call(fa.files || []);
      fa.value = '';
      await importAny(files);
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
          importAny(Array.prototype.slice.call(e.dataTransfer.files));
        }
      });
    });
  }

  A.Library = { init, refresh, paintCover, openBookMenu, S };
})(window.MY);
