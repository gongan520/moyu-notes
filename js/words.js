/* ══════════════════════════════════════════════════════════
   words.js — 查词 / 生词本 / AI 小窗 / 朗读
   面向英语阅读：长按取词 → 看释义、听发音、存生词、问 AI
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const LS_WORDS = 'moyu_words';
  const LS_AI = 'moyu_ai';
  const LS_RATE = 'moyu_tts_rate';

  const PROVIDERS = [
    {
      id: 'youdao', name: '有道词典', kind: 'dict',
      url: w => 'https://dict.youdao.com/result?word=' + encodeURIComponent(w) + '&lang=en',
      embeddable: true
    },
    {
      id: 'bing', name: '必应词典', kind: 'dict',
      url: w => 'https://cn.bing.com/dict/search?q=' + encodeURIComponent(w),
      embeddable: true
    },
    {
      id: 'translate', name: '整句翻译', kind: 'dict',
      url: w => 'https://fanyi.baidu.com/#en/zh/' + encodeURIComponent(w),
      embeddable: true
    },
    {
      id: 'chatgpt', name: 'ChatGPT', kind: 'ai',
      url: w => 'https://chat.openai.com/?q=' + encodeURIComponent(aiPrompt(w)),
      embeddable: false
    },
    {
      id: 'deepseek', name: 'DeepSeek', kind: 'ai',
      url: w => 'https://chat.deepseek.com/',
      embeddable: false
    },
    {
      id: 'claude', name: 'Claude', kind: 'ai',
      url: w => 'https://claude.ai/new?q=' + encodeURIComponent(aiPrompt(w)),
      embeddable: false
    },
    {
      id: 'gemini', name: 'Gemini', kind: 'ai',
      url: w => 'https://gemini.google.com/app',
      embeddable: false
    }
  ];

  function aiPrompt(w) {
    return '请用中英双语解释这个词/句，给出音标、词性、例句，并说明在英语阅读中的常见用法：' + w;
  }

  function loadJSON(k, def) {
    try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (e) { return def; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  let words = loadJSON(LS_WORDS, []);
  let aiId = loadJSON(LS_AI, 'youdao');
  let rate = Number(loadJSON(LS_RATE, 0.95)) || 0.95;

  function provider(id) { return PROVIDERS.find(p => p.id === id) || PROVIDERS[0]; }

  /* ───────────── 生词本 ───────────── */
  function list() { return words.slice().sort((a, b) => b.at - a.at); }

  function has(w) { return words.some(x => x.w.toLowerCase() === String(w || '').toLowerCase()); }

  function add(word, ctx) {
    const w = String(word || '').trim();
    if (!w) return false;
    const ex = words.find(x => x.w.toLowerCase() === w.toLowerCase());
    if (ex) { ex.at = Date.now(); if (ctx && ctx.note) ex.note = ctx.note; saveJSON(LS_WORDS, words); return false; }
    words.push({
      w: w,
      note: (ctx && ctx.note) || '',
      bookId: (ctx && ctx.bookId) || null,
      bookName: (ctx && ctx.bookName) || '',
      pageId: (ctx && ctx.pageId) || null,
      at: Date.now()
    });
    saveJSON(LS_WORDS, words);
    updateBadge();
    return true;
  }

  function remove(w) {
    words = words.filter(x => x.w !== w);
    saveJSON(LS_WORDS, words);
    updateBadge();
  }

  function clear() {
    words = [];
    saveJSON(LS_WORDS, words);
    updateBadge();
  }

  function updateBadge() {
    const b = A.$('#wordBadge');
    if (b) {
      b.textContent = words.length > 99 ? '99+' : String(words.length);
      b.style.display = words.length ? '' : 'none';
    }
  }

  /* ───────────── 朗读 ───────────── */
  function speak(text, lang) {
    if (!window.speechSynthesis) { A.toast('这台设备不支持朗读'); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text || ''));
      u.lang = lang || (/^[\x00-\x7f\s]+$/.test(text) ? 'en-US' : 'zh-CN');
      u.rate = rate;
      // 优先选英文语音，发音更准
      const vs = window.speechSynthesis.getVoices() || [];
      const pick = vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang));
      if (pick && lang !== 'zh-CN') u.voice = pick;
      window.speechSynthesis.speak(u);
    } catch (e) { }
  }

  function stopSpeak() { try { window.speechSynthesis.cancel(); } catch (e) { } }

  /* ───────────── 查词浮层 ───────────── */
  let bar = null;
  let cur = null;

  function ensureBar() {
    if (bar) return bar;
    bar = A.el('div', 'lookup');
    bar.hidden = true;
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      const w = cur && cur.word;
      if (!w) return;
      if (k === 'speak') speak(w);
      else if (k === 'add') {
        const ok = add(w, cur.ctx);
        A.toast(ok ? '已加入生词本：' + w : '这个词已经在生词本里了');
        renderBar();
      } else if (k === 'copy') {
        copy(w);
      } else if (k === 'dict') openProvider(null, w);
      else if (k === 'ai') openProvider(aiId, w);
      else if (k === 'close') hideLookup();
    });
    return bar;
  }

  function renderBar() {
    const b = ensureBar();
    const w = cur && cur.word;
    if (!w) { b.hidden = true; return; }
    const p = provider(aiId);
    b.innerHTML =
      '<div class="lk-word"><b>' + esc(w) + '</b>' +
      '<span>' + (cur.ctx && cur.ctx.bookName ? esc(cur.ctx.bookName) : '查词') + '</span>' +
      '<button class="lk-x" data-k="close" style="margin-left:auto;color:#8a8a96">✕</button></div>' +
      '<div class="lk-acts">' +
      '<button data-k="speak">🔊 朗读</button>' +
      '<button data-k="add">＋ 生词本</button>' +
      '<button class="primary" data-k="dict">词典释义</button>' +
      '<button data-k="ai">问 ' + esc(p.name) + '</button>' +
      '<button data-k="copy">复制</button>' +
      '</div>';
    b.hidden = false;
  }

  function lookup(word, ctx) {
    const w = String(word || '').replace(/^[^\w'’-]+|[^\w'’-]+$/g, '');
    if (!w) return;
    cur = { word: w, ctx: ctx || {} };
    renderBar();
    // 长按取词后顺手读一遍，阅读时更连贯
    if (ctx && ctx.speak) speak(w);
  }

  function hideLookup() { if (bar) bar.hidden = true; cur = null; }

  /* ───────────── AI / 词典小窗 ───────────── */
  let win = null;

  function ensureWindow() {
    if (win) return win;
    win = A.el('div', 'ai-win');
    win.hidden = true;
    win.innerHTML =
      '<div class="aw-head">' +
      '<select id="awProvider"></select>' +
      '<div style="flex:1"></div>' +
      '<button class="aw-mini" id="awOpen" title="在浏览器打开">↗</button>' +
      '<button class="aw-mini" id="awClose" title="关闭">✕</button>' +
      '</div>' +
      '<div class="aw-body"><iframe id="awFrame" referrerpolicy="no-referrer"></iframe></div>' +
      '<div class="aw-foot">' +
      '<input id="awInput" placeholder="输入要查的单词或句子…" />' +
      '<button class="aw-go" id="awGo">查询</button>' +
      '</div>';
    document.body.appendChild(win);

    win.querySelector('#awProvider').innerHTML = PROVIDERS.map(p => '<option value="' + p.id + '">' + p.name + '</option>').join('');
    win.querySelector('#awProvider').addEventListener('change', (e) => {
      aiId = e.target.value; saveJSON(LS_AI, aiId);
      const w = win.querySelector('#awInput').value.trim();
      if (w) load(aiId, w);
      renderBar();
    });
    win.querySelector('#awClose').addEventListener('click', closeWindow);
    win.querySelector('#awOpen').addEventListener('click', () => {
      const w = win.querySelector('#awInput').value.trim() || (cur && cur.word) || '';
      const url = provider(win.querySelector('#awProvider').value).url(w);
      if (A.openUrl) A.openUrl(url); else window.open(url, '_blank', 'noopener');
    });
    const go = () => {
      const w = win.querySelector('#awInput').value.trim();
      if (!w) return;
      lookup(w);
      load(win.querySelector('#awProvider').value, w);
    };
    win.querySelector('#awGo').addEventListener('click', go);
    win.querySelector('#awInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    return win;
  }

  function load(id, text) {
    const p = provider(id);
    const f = win.querySelector('#awFrame');
    f.style.display = 'block';
    f.src = p.url(text);
    win.dataset.pending = p.embeddable ? '' : '1';
  }

  function openProvider(id, text) {
    const w = ensureWindow();
    const use = id || aiId;
    w.querySelector('#awProvider').value = use;
    w.querySelector('#awInput').value = text || '';
    w.hidden = false;
    load(use, text || '');
    A.busy(false);
  }

  function closeWindow() {
    if (!win) return;
    win.hidden = true;
    const f = win.querySelector('#awFrame');
    if (f) f.src = 'about:blank';
  }

  /* ───────────── 生词本抽屉 ───────────── */
  function renderDrawer() {
    const listEl = A.$('#wdList');
    const dr = A.$('#wordDrawer');
    if (!listEl || !dr) return;
    dr.hidden = false;
    const arr = list();
    if (!arr.length) {
      listEl.innerHTML = '<div style="padding:40px 12px;text-align:center;color:#8a8a96;font-size:13px;line-height:1.9">' +
        '生词本还是空的。<br>在 PDF 或网页页面上<b>长按单词</b>，<br>就能查词并存进来。</div>';
      return;
    }
    listEl.innerHTML = arr.map(x =>
      '<div class="wd-row" data-w="' + escAttr(x.w) + '">' +
      '<div style="flex:1;min-width:0"><div class="w">' + esc(x.w) + '</div>' +
      '<div class="m">' + esc(x.note || (x.bookName ? '来自《' + x.bookName + '》' : '手动添加')) + '</div></div>' +
      '<button class="go" data-a="say">🔊</button>' +
      '<button class="go" data-a="del">删</button>' +
      '</div>'
    ).join('');
    A.$$('.wd-row', listEl).forEach(row => {
      const w = row.dataset.w;
      A.$$('button', row).forEach(b => b.addEventListener('click', () => {
        if (b.dataset.a === 'say') speak(w);
        else if (b.dataset.a === 'del') { remove(w); renderDrawer(); }
      }));
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        lookup(w, {});
      });
    });
  }

  function openDrawer() { renderDrawer(); }
  function closeDrawer() { const d = A.$('#wordDrawer'); if (d) d.hidden = true; }

  /* 生词本一键变闪卡：写进当前笔记的 cards，沿用原有 SM-2 排程 */
  function makeCards() {
    const arr = list();
    if (!arr.length) { A.toast('生词本是空的'); return; }
    const bk = A.Studio && A.Studio.S && A.Studio.S.book;
    if (!bk) { A.toast('先打开一本笔记，再把生词变成闪卡'); return; }
    if (!Array.isArray(bk.cards)) bk.cards = [];
    let n = 0;
    arr.forEach(x => {
      if (bk.cards.some(c => (c.q || '').toLowerCase() === x.w.toLowerCase())) return;
      bk.cards.push({
        id: A.uid ? A.uid('fc') : 'fc_' + Math.random().toString(36).slice(2, 8),
        q: x.w,
        a: x.note || '',
        due: 0, n: 0, ef: 2.5, ivl: 0,
        from: '生词本'
      });
      n++;
    });
    if (A.db && A.db.saveBook) A.db.saveBook(bk);
    A.toast(n ? ('已生成 ' + n + ' 张闪卡，打开「闪卡复习」即可开始') : '这些词都已经有卡片了');
  }

  function copy(text) {
    const done = () => A.toast('已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch (e) { A.toast('复制失败'); }
    }
  }

  A.Words = {
    lookup, hideLookup, speak, stopSpeak, openProvider, closeWindow,
    list, add, has, remove, clear,
    openDrawer, closeDrawer, renderDrawer, makeCards, updateBadge,
    get aiId() { return aiId; },
    set aiId(v) { aiId = v; saveJSON(LS_AI, v); },
    get rate() { return rate; },
    set rate(v) { rate = Math.max(0.5, Math.min(1.6, Number(v) || 0.95)); saveJSON(LS_RATE, rate); },
    PROVIDERS
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
  function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

  document.addEventListener('DOMContentLoaded', () => { updateBadge(); });
  setTimeout(updateBadge, 400);
})(window.MY);
