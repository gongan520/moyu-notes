/* ═══════════════════════════════════════════
   backup.js — 三层持久化 / 自动保存
   ① IndexedDB（主存储，快）
   ② 原生 Documents 快照（iOS 壳，抗 WebKit 清缓存 / 换 origin）
   ③ localStorage 元数据索引（轻量，用于开机秒显书架）
   ═══════════════════════════════════════════ */
(function (A) {
  'use strict';

  const LS_META = 'moyu_meta_v2';
  const LS_SNAP = 'moyu_snap_v2';
  const PUSH_GAP = 6000;

  let pushTimer = 0;
  let lastPush = 0;
  let pushing = false;
  let pending = false;
  let allowEmptyOnce = false;

  function bridge() {
    return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.moyuBackup;
  }

  /* ───────── 保存状态指示 ───────── */
  let stateTimer = 0;
  function setState(s, text) {
    const el = A.$('#saveState');
    if (!el) return;
    clearTimeout(stateTimer);
    el.dataset.state = s;
    const label = el.querySelector('span');
    if (label) label.textContent = text || ({ saving: '保存中', saved: '已保存', local: '未落盘', error: '保存失败' }[s] || '');
    el.classList.add('is-on');
    if (s === 'saved') {
      stateTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
    }
  }

  /* ───────── 元数据索引（localStorage） ───────── */
  function writeMeta(books) {
    try {
      localStorage.setItem(LS_META, JSON.stringify({
        at: Date.now(),
        books: (books || []).map(b => ({
          id: b.id, name: b.name, updatedAt: b.updatedAt,
          pageCount: b.pageCount, folderId: b.folderId || 'root'
        }))
      }));
    } catch (e) { }
  }

  function readMeta() {
    try {
      const raw = localStorage.getItem(LS_META);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ───────── 原生快照 ───────── */
  async function doPush() {
    const b = bridge();

    let snap;
    try {
      snap = await A.db.dumpAll();
    } catch (e) {
      setState('error');
      return;
    }

    // 防呆：本地库莫名其妙空了，绝不用空快照覆盖掉已有的好数据。
    // 只有用户真的删过东西（noteDelete 打过标记）才允许写空。
    if (!snap.books.length && !allowEmptyOnce) {
      const meta = readMeta();
      if (meta && meta.books && meta.books.length) {
        setState('local');
        return;
      }
    }
    allowEmptyOnce = false;

    if (!b) {
      // 没有原生壳：退化为 localStorage 快照（容量小，但聊胜于无）
      try {
        const json = JSON.stringify(snap);
        if (json.length < 3.5e6) {
          localStorage.setItem(LS_SNAP, json);
          lastPush = Date.now();
          setState('saved');
        } else {
          setState('local');
        }
      } catch (e) { setState('local'); }
      return;
    }

    if (pushing) { pending = true; return; }
    pushing = true;
    setState('saving');
    try {
      b.postMessage({ action: 'save', json: JSON.stringify(snap) });
      lastPush = Date.now();
      setState('saved');
    } catch (e) {
      setState('error');
    } finally {
      pushing = false;
      if (pending) { pending = false; schedule(); }
    }
  }

  function schedule() {
    clearTimeout(pushTimer);
    const wait = Math.max(400, PUSH_GAP - (Date.now() - lastPush));
    pushTimer = setTimeout(doPush, wait);
  }

  async function flush() {
    clearTimeout(pushTimer);
    await doPush();
  }

  /* ───────── 启动恢复 ───────── */
  async function restore() {
    if (A.db.memoryOnly) return 0;

    let snap = null;
    const raw = window.__MOYU_BACKUP__;
    if (raw) {
      try { snap = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { snap = null; }
    }
    if (!snap) {
      try {
        const s = localStorage.getItem(LS_SNAP);
        if (s) snap = JSON.parse(s);
      } catch (e) { snap = null; }
    }
    if (!snap || !Array.isArray(snap.books)) return 0;

    const existing = await A.db.allBooks();
    // 只在本地库为空、或备份明显更新时才回灌，避免覆盖新数据
    const backupAt = snap.exportedAt || 0;
    if (existing.length) {
      const newest = existing.reduce((m, b) => Math.max(m, b.updatedAt || 0), 0);
      if (backupAt <= newest) return 0;
      const existingIds = new Set(existing.map(b => b.id));
      const missing = snap.books.filter(e => e && e.book && !existingIds.has(e.book.id));
      if (!missing.length) return 0;
      const n = await A.db.restoreAll({ books: missing, assets: snap.assets || {} });
      if (n) A.toast('已补回 ' + n + ' 本缺失的笔记', 3000);
      return n;
    }

    const n = await A.db.restoreAll(snap);
    if (n) A.toast('已从本地快照恢复 ' + n + ' 本笔记', 3200);
    return n;
  }

  A.backup = {
    schedule,
    push: doPush,
    flush,
    restore,
    setState,
    writeMeta,
    readMeta,
    noteDelete() { allowEmptyOnce = true; },
    get lastPush() { return lastPush; }
  };

  /* 离开页面 / 切后台时立刻落盘 */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', () => { flush(); });
  window.addEventListener('beforeunload', () => { flush(); });
})(window.MY);
