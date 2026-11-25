/* ═══════════════════════════════════════════
   idb.js — 本地存储（IndexedDB，失败降级内存）
   书籍：books  页面：pages
   ═══════════════════════════════════════════ */
(function (A) {
  'use strict';

  const DB_NAME = 'moyu_note';
  const DB_VER = 2;
  let db = null;
  let memoryOnly = false;
  const mem = { books: new Map(), pages: new Map(), assets: new Map() };

  function req(r) {
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  function tx(store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  function open() {
    return new Promise((resolve) => {
      let done = false;
      const fail = (e) => {
        if (done) return;
        done = true;
        memoryOnly = true;
        console.warn('[idb] 降级为内存存储', e);
        resolve(false);
      };
      try {
        const r = indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = (ev) => {
          const d = ev.target.result;
          if (!d.objectStoreNames.contains('books')) {
            d.createObjectStore('books', { keyPath: 'id' });
          }
          if (!d.objectStoreNames.contains('pages')) {
            const ps = d.createObjectStore('pages', { keyPath: 'id' });
            ps.createIndex('bookId', 'bookId', { unique: false });
          }
          if (!d.objectStoreNames.contains('assets')) {
            d.createObjectStore('assets', { keyPath: 'key' });
          }
        };
        r.onsuccess = () => {
          if (done) return;
          db = r.result;
          db.onversionchange = () => { try { db.close(); } catch (e) { } };
          done = true;
          resolve(true);
        };
        r.onerror = fail;
        setTimeout(() => { if (!done) fail('timeout'); }, 4000);
      } catch (e) {
        fail(e);
      }
    });
  }

  const DB = {
    get memoryOnly() { return memoryOnly; },

    async allBooks() {
      if (memoryOnly) return Array.from(mem.books.values());
      try { return await req(tx('books', 'readonly').getAll()); } catch (e) { return []; }
    },

    async getBook(id) {
      if (memoryOnly) return mem.books.get(id) || null;
      try { return await req(tx('books', 'readonly').get(id)); } catch (e) { return null; }
    },

    async saveBook(book) {
      if (memoryOnly) { mem.books.set(book.id, book); return book; }
      try { await req(tx('books', 'readwrite').put(book)); } catch (e) { }
      return book;
    },

    async deleteBook(id) {
      if (memoryOnly) {
        mem.books.delete(id);
        for (const [pid, p] of mem.pages) if (p.bookId === id) mem.pages.delete(pid);
        return;
      }
      try {
        const pages = await this.pagesOf(id);
        const t = db.transaction(['books', 'pages'], 'readwrite');
        t.objectStore('books').delete(id);
        const ps = t.objectStore('pages');
        pages.forEach(p => ps.delete(p.id));
        await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
      } catch (e) { }
    },

    async pagesOf(bookId) {
      if (memoryOnly) {
        return Array.from(mem.pages.values())
          .filter(p => p.bookId === bookId)
          .sort((a, b) => a.order - b.order);
      }
      try {
        const idx = tx('pages', 'readonly').index('bookId');
        const list = await req(idx.getAll(bookId));
        return list.sort((a, b) => a.order - b.order);
      } catch (e) { return []; }
    },

    async getPage(id) {
      if (memoryOnly) return mem.pages.get(id) || null;
      try { return await req(tx('pages', 'readonly').get(id)); } catch (e) { return null; }
    },

    async savePage(page) {
      if (memoryOnly) { mem.pages.set(page.id, page); return page; }
      try { await req(tx('pages', 'readwrite').put(page)); } catch (e) { }
      return page;
    },

    async savePages(list) {
      if (!list || !list.length) return;
      if (memoryOnly) { list.forEach(p => mem.pages.set(p.id, p)); return; }
      try {
        const t = db.transaction('pages', 'readwrite');
        const os = t.objectStore('pages');
        list.forEach(p => os.put(p));
        await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
      } catch (e) { }
    },

    async deletePage(id) {
      if (memoryOnly) { mem.pages.delete(id); return; }
      try { await req(tx('pages', 'readwrite').delete(id)); } catch (e) { }
    },

    async countPages(bookId) {
      const ps = await this.pagesOf(bookId);
      return ps.length;
    },

    /* ───── 资源（HTML 源码等大文本） ───── */
    async getAsset(key) {
      if (!key) return null;
      if (memoryOnly) return mem.assets.get(key) || null;
      try {
        const rec = await req(tx('assets', 'readonly').get(key));
        return rec ? rec.data : null;
      } catch (e) { return null; }
    },

    async putAsset(key, data) {
      if (memoryOnly) { mem.assets.set(key, data); return; }
      try { await req(tx('assets', 'readwrite').put({ key, data })); } catch (e) { }
    },

    async deleteAsset(key) {
      if (!key) return;
      if (memoryOnly) { mem.assets.delete(key); return; }
      try { await req(tx('assets', 'readwrite').delete(key)); } catch (e) { }
    },

    /* 全量导出 */
    async dumpAll() {
      const books = await this.allBooks();
      const out = { format: 'moyu-backup', version: 1, exportedAt: Date.now(), books: [] };
      for (const b of books) {
        const pages = await this.pagesOf(b.id);
        out.books.push({ book: b, pages });
      }
      return out;
    }
  };

  A.db = DB;
  A.dbReady = open();
})(window.MY);
