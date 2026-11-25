/* ═══════════════════════════════════════════
   boot.js — 启动
   ═══════════════════════════════════════════ */
(function (A) {
  'use strict';

  function boot() {
    A.Library.init();
    A.Studio.init();

    (async () => {
      try { await A.dbReady; } catch (e) { }
      // 本地库为空时，尝试从原生快照 / localStorage 快照回灌
      try { await A.backup.restore(); } catch (e) { }
      await A.Library.refresh();
      if (A.db.memoryOnly) {
        A.toast('当前环境不支持本地存储，请用 Safari 打开并「添加到主屏幕」', 4600);
      } else {
        A.backup.push();
      }
    })();

    document.addEventListener('dragstart', e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());

    // 点遮罩关闭底部面板
    const scrim = A.$('#sheetScrim');
    if (scrim) scrim.addEventListener('click', () => A.sheet.close());

    // 防止双击放大与文本选择放大镜
    let lastEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      const t = e.target;
      const editing = t && t.closest && t.closest('input,textarea,[contenteditable="true"]');
      if (!editing && now - lastEnd < 320) e.preventDefault();
      lastEnd = now;
    }, { passive: false });

    // 离线缓存
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(() => { });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window.MY);
