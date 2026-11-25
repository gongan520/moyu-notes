/* ══════════════════════════════════════════════════════════
   library.js — 笔记库（书架）
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const S = {
    books: [],
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
  function sorted() {
    let list = S.books.slice();
    if (S.q) {
      const q = S.q.toLowerCase();
      list = list.filter(b => (b.name || '').toLowerCase().indexOf(q) >= 0);
    }
    if (S.sort === 'updated') list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    else if (S.sort === 'created') list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    else list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
    return list;
  }

  function render() {
    const grid = A.$('#libGrid');
    const empty = A.$('#libEmpty');
    if (!grid) return;
    const list = sorted();

    if (!S.books.length) {
      grid.innerHTML = '';
      empty.classList.add('is-on');
      return;
    }
    empty.classList.remove('is-on');
    if (!list.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:60px 0;text-align:center;color:#70707c;font-size:14px">没有匹配的笔记</div>';
      return;
    }

    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((book, idx) => {
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
      card.appendChild(cover);
      const meta = A.el('div', 'book-meta');
      meta.innerHTML = '<div class="book-name">' + esc(book.name || '未命名') + '</div>' +
        '<div class="book-time">' + A.fmtAgo(book.updatedAt || book.createdAt || Date.now()) + ' · ' + (book.pageCount || 1) + ' 页</div>';
      card.appendChild(meta);
      frag.appendChild(card);

      // 绘制封面
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
      '<button class="list-item" data-act="rename"><svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg><span class="li-grow">重命名</span></button>',
      '<button class="list-item" data-act="dup"><svg class="ico" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg><span class="li-grow">复制一本</span></button>',
      '<button class="list-item" data-act="export"><svg class="ico" viewBox="0 0 24 24"><path d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg><span class="li-grow">导出 PDF</span></button>',
      '<div class="list-sep"></div>',
      '<button class="list-item is-danger" data-act="del"><svg class="ico" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/></svg><span class="li-grow">删除</span></button>',
      '</div>'
    ].join('');

    A.sheet.open({
      title: esc(book.name),
      sub: (book.pageCount || 1) + ' 页',
      node: node,
      onMount: (body, sheet) => {
        A.$$('.list-item', body).forEach(btn => {
          btn.addEventListener('click', async () => {
            const act = btn.dataset.act;
            sheet.close();
            if (act === 'open') A.Studio.openBook(id);
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
      pageCount: 1
    };
    const page = A.Studio.blankPage(book.id, 0, preset);
    await A.db.saveBook(book);
    await A.db.savePage(page);
    await refresh();
    A.Studio.openBook(book.id);
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
      let n = 0;
      for (const item of data.books) {
        const book = item.book;
        if (!book || !book.id) continue;
        const exist = await A.db.getBook(book.id);
        if (exist) { book.id = A.uid('bk'); book.name = book.name + ' (恢复)'; }
        await A.db.saveBook(book);
        const pages = (item.pages || []).map(p => Object.assign({}, p, { bookId: book.id, id: exist ? A.uid('pg') : p.id }));
        await A.db.savePages(pages);
        n++;
      }
      await refresh();
      A.toast('已恢复 ' + n + ' 本笔记');
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
