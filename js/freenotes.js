/* ══════════════════════════════════════════════════════════
   freenotes.js — 自由笔记式界面：左侧文档抽屉 / 顶部胶囊增强
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  let drawer, scrim, edge, pagesBox, docTitle, fnTitle;
  let lastSig = '';

  function $(s) { return document.querySelector(s); }
  function inStudio() { return document.body.classList.contains('in-studio'); }

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('is-on');
    if (scrim) scrim.classList.add('is-on');
    render();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('is-on');
    if (scrim) scrim.classList.remove('is-on');
  }

  function toggleDrawer() {
    if (drawer && drawer.classList.contains('is-on')) closeDrawer();
    else openDrawer();
  }

  function renderFolders() {
    const host = $('#fnFolderTree');
    if (!host || !A.Library || !A.Library.S) return;
    const folders = (A.Library.S.folders || []).filter(f => f.type !== 'divider').slice(0, 30);
    const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const html = '<button class="fn-folder is-on" data-folder="all"><svg viewBox="0 0 24 24" class="ico"><path d="M3 6h7l2 2h9v10H3z"/></svg><span>所有笔记</span></button>' +
      '<button class="fn-folder" data-folder="inbox"><svg viewBox="0 0 24 24" class="ico"><path d="M3 6h7l2 2h9v10H3z"/></svg><span>未归档笔记</span></button>' +
      folders.map(f => '<button class="fn-folder" data-folder="' + esc(f.id) + '"><svg viewBox="0 0 24 24" class="ico"><path d="M3 6h7l2 2h9v10H3z"/></svg><span>' + esc(f.name || '文件夹') + '</span></button>').join('') +
      '<button class="fn-folder" data-folder="trash"><svg viewBox="0 0 24 24" class="ico"><path d="M4 7h16M6 7l1 13h10l1-13M9 7V4.5h6V7"/></svg><span>回收站</span></button>';
    if (host.innerHTML !== html) {
      host.innerHTML = html;
      A.$$('.fn-folder', host).forEach(b => b.addEventListener('click', () => {
        A.$$('.fn-folder', host).forEach(x => x.classList.toggle('is-on', x === b));
        const fid = b.dataset.folder;
        if (fid === 'all' || fid === 'inbox' || fid === 'trash') return;
        if (A.Library) { A.Library.S.folderId = fid; A.Library.refresh(); }
      }));
    }
  }

  function render() {
    if (!inStudio()) return;
    const S = A.Studio && A.Studio.S;
    if (!S) return;
    if (docTitle && fnTitle && document.activeElement !== fnTitle) fnTitle.value = docTitle.value || '未命名';
    renderFolders();
    if (!pagesBox) return;
    const sig = (S.pages || []).map((p, i) => i + ':' + (p.heading || p.type || '') + ':' + (p.strokes || []).length).join('|') + '@' + S.idx;
    if (sig === lastSig) return;
    lastSig = sig;
    pagesBox.innerHTML = (S.pages || []).map((p, i) =>
      '<button class="fn-page' + (i === S.idx ? ' is-on' : '') + '" data-page="' + i + '">' +
      '<b>' + String(i + 1).padStart(2, '0') + '</b>' +
      '<span>' + (p.heading || (p.type === 'html' ? 'HTML 原文' : (i === 0 ? '第 1 页' : '第 ' + (i + 1) + ' 页'))) + '</span>' +
      '</button>'
    ).join('') || '<div style="padding:12px;font-size:12px;color:#8a8f9a">暂无页面</div>';
    A.$$('.fn-page', pagesBox).forEach(b => {
      b.addEventListener('click', () => {
        closeDrawer();
        A.Studio.goPage(+b.dataset.page);
      });
    });
  }

  function bind() {
    drawer = $('#fnDrawer');
    scrim = $('#fnScrim');
    edge = $('#fnEdge');
    pagesBox = $('#fnPages');
    docTitle = $('#docTitle');
    fnTitle = $('#fnDocTitle');
    if (!drawer) return;

    if (scrim) scrim.addEventListener('click', closeDrawer);
    const dc = $('#fnDrawerClose'); if (dc) dc.addEventListener('click', closeDrawer);
    if (edge) edge.addEventListener('click', openDrawer);
    const dt = $('#btnDrawerToggle'); if (dt) dt.addEventListener('click', openDrawer);

    A.$$('.fn-tab').forEach(b => b.addEventListener('click', () => {
      A.$$('.fn-tab').forEach(x => x.classList.toggle('is-on', x === b));
      const sub = $('#fnDrawerSub');
      if (sub) sub.textContent = b.dataset.tab === 'books' ? '教材中心' : '资料中心';
      toast(b.dataset.tab === 'books' ? '教材中心：可在这里导入 PDF / HTML 学习资料' : '资料中心');
    }));

    A.$$('.fn-funcs [data-tool]').forEach(b => b.addEventListener('click', () => {
      closeDrawer();
      if (A.Studio) A.Studio.setTool(b.dataset.tool);
    }));

    // 左边缘右滑呼出文档列表，自由笔记同款
    let sx = 0, sy = 0, tracking = false;
    document.addEventListener('pointerdown', (e) => {
      if (!inStudio()) return;
      sx = e.clientX; sy = e.clientY;
      tracking = sx <= 18;
    }, { passive: true });
    document.addEventListener('pointerup', (e) => {
      if (!tracking || !inStudio()) { tracking = false; return; }
      tracking = false;
      if (e.clientX - sx > 56 && Math.abs(e.clientY - sy) < 80) openDrawer();
    }, { passive: true });

    const pageBtn = $('#btnPagePanel');
    if (pageBtn) pageBtn.addEventListener('click', () => { closeDrawer(); if (A.Studio) A.Studio.openPagesPanel(); });

    const ai = $('#btnAI');
    if (ai) ai.addEventListener('click', () => {
      closeDrawer();
      if (A.Words) A.Words.openDrawer();
      else A.toast('AI 学习面板未加载');
    });

    const theme = $('#fnThemeBtn');
    if (theme) theme.addEventListener('click', () => {
      const b = $('#btnThemeMode'); if (b) b.click();
    });
    const nf = $('#fnNewFolderBtn');
    if (nf) nf.addEventListener('click', async () => {
      closeDrawer();
      if (A.Library && A.Library.newFolder) {
        await A.Library.newFolder();
        openDrawer();
      }
    });


    if (fnTitle && docTitle) {
      fnTitle.addEventListener('blur', () => { docTitle.value = fnTitle.value.trim() || '未命名'; docTitle.blur(); });
      fnTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') fnTitle.blur(); });
    }

    window.addEventListener('keydown', (e) => {
      if (!inStudio()) return;
      if (e.key === 'Escape') closeDrawer();
    });
    window.addEventListener('resize', A.debounce(render, 200));
    setInterval(render, 900);
  }

  A.FreeNotesUI = { init: bind, openDrawer, closeDrawer, toggleDrawer, render };
})(window.MY);
