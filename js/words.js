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
      id: 'bing', name: '必应词典', kind: 'dict',
      url: w => 'https://cn.bing.com/dict/search?q=' + encodeURIComponent(w),
      embeddable: true
    },
    {
      id: 'youdao', name: '有道词典', kind: 'dict',
      url: w => 'https://dict.youdao.com/result?word=' + encodeURIComponent(w) + '&lang=en',
      embeddable: false
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
      url: w => 'https://chat.deepseek.com/',   // 无带词参数，走外部打开
      embeddable: false
    },
    {
      id: 'claude', name: 'Claude', kind: 'ai',
      url: w => 'https://claude.ai/new?q=' + encodeURIComponent(aiPrompt(w)),
      embeddable: false
    },
    {
      id: 'gemini', name: 'Gemini', kind: 'ai',
      url: w => 'https://gemini.google.com/app',   // 无带词参数，走外部打开
      embeddable: false
    }
  ];

  function aiPrompt(w) {
    return '请用中英双语解释这个词/句，给出音标、词性、例句，并说明在英语阅读中的常见用法：' + w;
  }

  /* ───────────── 离线词典：本地常用词表 + 网络词典兜底 ───────────── */
  // 精简高频词表（英文阅读常见词），查不到再走在线接口
  const MINI_DICT = {
    'the': 'art. 这；那（定冠词）',
    'a': 'art. 一；一个（不定冠词）',
    'an': 'art. 一；一个（元音前）',
    'and': 'conj. 和；与；而且',
    'or': 'conj. 或者；否则',
    'but': 'conj. 但是；prep. 除…以外',
    'of': 'prep. …的；关于',
    'to': 'prep. 到；向；对于',
    'in': 'prep. 在…里面；在…期间',
    'on': 'prep. 在…上；关于',
    'at': 'prep. 在（某处/某时）',
    'for': 'prep. 为了；给；因为',
    'with': 'prep. 和…一起；带有',
    'by': 'prep. 通过；被；在…旁边',
    'from': 'prep. 从；来自',
    'as': 'conj. 当…时；如同；prep. 作为',
    'is': 'v. 是（be 的第三人称单数）',
    'are': 'v. 是（be 的复数/第二人称）',
    'was': 'v. 是（be 的过去式）',
    'were': 'v. 是（be 的过去式复数）',
    'be': 'v. 是；存在',
    'have': 'v. 有；已经',
    'has': 'v. 有（have 的第三人称单数）',
    'had': 'v. 有（have 的过去式）',
    'do': 'v. 做；aux. 助动词',
    'does': 'v. 做（do 的第三人称单数）',
    'did': 'v. 做（do 的过去式）',
    'not': 'adv. 不；没有',
    'no': 'adv. 不；adj. 没有的',
    'yes': 'adv. 是；是的',
    'this': 'pron. 这；这个',
    'that': 'pron. 那；那个',
    'these': 'pron. 这些',
    'those': 'pron. 那些',
    'it': 'pron. 它',
    'he': 'pron. 他',
    'she': 'pron. 她',
    'they': 'pron. 他们；她们；它们',
    'we': 'pron. 我们',
    'you': 'pron. 你；你们',
    'i': 'pron. 我',
    'me': 'pron. 我（宾格）',
    'my': 'pron. 我的',
    'your': 'pron. 你的；你们的',
    'his': 'pron. 他的',
    'her': 'pron. 她的；她（宾格）',
    'its': 'pron. 它的',
    'our': 'pron. 我们的',
    'their': 'pron. 他们的',
    'what': 'pron. 什么',
    'which': 'pron. 哪个；哪些',
    'who': 'pron. 谁',
    'whom': 'pron. 谁（宾格）',
    'where': 'adv. 哪里',
    'when': 'adv. 何时',
    'why': 'adv. 为什么',
    'how': 'adv. 怎样；如何',
    'all': 'adj. 所有的；pron. 全部',
    'some': 'adj. 一些；某个',
    'any': 'adj. 任何；一些',
    'each': 'adj. 每个',
    'every': 'adj. 每个；所有的',
    'many': 'adj. 许多',
    'much': 'adj. 许多（不可数）',
    'few': 'adj. 很少的',
    'little': 'adj. 小的；很少的',
    'more': 'adj. 更多的',
    'most': 'adj. 最多的；大多数',
    'one': 'num. 一；pron. 一个',
    'two': 'num. 二',
    'three': 'num. 三',
    'first': 'num. 第一；adv. 首先',
    'last': 'adj. 最后的；上一个',
    'new': 'adj. 新的',
    'old': 'adj. 旧的；老的',
    'good': 'adj. 好的',
    'bad': 'adj. 坏的',
    'big': 'adj. 大的',
    'small': 'adj. 小的',
    'long': 'adj. 长的',
    'short': 'adj. 短的；矮的',
    'high': 'adj. 高的',
    'low': 'adj. 低的',
    'right': 'adj. 正确的；右边的',
    'left': 'adj. 左边的；剩下的',
    'up': 'adv. 向上',
    'down': 'adv. 向下',
    'out': 'adv. 在外；出去',
    'over': 'prep. 在…上方；越过',
    'under': 'prep. 在…下面',
    'about': 'prep. 关于；大约',
    'into': 'prep. 进入',
    'through': 'prep. 穿过；通过',
    'between': 'prep. 在…之间',
    'before': 'prep. 在…之前',
    'after': 'prep. 在…之后',
    'now': 'adv. 现在',
    'then': 'adv. 那时；然后',
    'here': 'adv. 这里',
    'there': 'adv. 那里',
    'can': 'aux. 能；可以',
    'could': 'aux. 能（过去式）；可能',
    'will': 'aux. 将；愿意',
    'would': 'aux. 将会；愿意（过去式）',
    'should': 'aux. 应该',
    'may': 'aux. 可以；也许',
    'might': 'aux. 可能；也许',
    'must': 'aux. 必须',
    'say': 'v. 说',
    'said': 'v. 说（say 的过去式）',
    'go': 'v. 去；走',
    'come': 'v. 来',
    'get': 'v. 得到；变得',
    'make': 'v. 制造；使得',
    'know': 'v. 知道',
    'think': 'v. 想；认为',
    'see': 'v. 看见',
    'look': 'v. 看',
    'want': 'v. 想要',
    'give': 'v. 给',
    'take': 'v. 拿；带；花费',
    'use': 'v. 使用',
    'find': 'v. 找到；发现',
    'tell': 'v. 告诉',
    'ask': 'v. 问；请求',
    'work': 'v. 工作；n. 工作',
    'try': 'v. 尝试',
    'need': 'v. 需要',
    'feel': 'v. 感觉',
    'become': 'v. 变成',
    'leave': 'v. 离开；留下',
    'call': 'v. 打电话；称呼',
    'world': 'n. 世界',
    'life': 'n. 生活；生命',
    'time': 'n. 时间',
    'day': 'n. 天；日',
    'year': 'n. 年',
    'people': 'n. 人们；人民',
    'man': 'n. 男人；人',
    'woman': 'n. 女人',
    'child': 'n. 孩子',
    'hand': 'n. 手',
    'eye': 'n. 眼睛',
    'head': 'n. 头',
    'way': 'n. 路；方式',
    'thing': 'n. 东西；事情',
    'word': 'n. 单词；话语',
    'water': 'n. 水',
    'book': 'n. 书',
    'school': 'n. 学校',
    'read': 'v. 阅读',
    'write': 'v. 写',
    'study': 'v. 学习',
    'learn': 'v. 学习；学会',
    'teach': 'v. 教',
    'understand': 'v. 理解；明白',
    'remember': 'v. 记得',
    'forget': 'v. 忘记',
    'like': 'v. 喜欢；prep. 像',
    'love': 'v. 爱；喜欢',
    'help': 'v. 帮助',
    'important': 'adj. 重要的',
    'great': 'adj. 伟大的；很棒的',
    'beautiful': 'adj. 美丽的',
    'happy': 'adj. 快乐的',
    'sad': 'adj. 悲伤的',
    'easy': 'adj. 容易的',
    'difficult': 'adj. 困难的',
    'hard': 'adj. 硬的；困难的',
    'because': 'conj. 因为',
    'so': 'conj. 所以；如此',
    'if': 'conj. 如果',
    'while': 'conj. 当…时；然而',
    'though': 'conj. 虽然',
    'although': 'conj. 虽然；尽管',
    'but': 'conj. 但是'
  };

  // 在线词典接口（dictionaryapi.dev，免费、支持 CORS、含音标/词性/释义）
  function fetchDictOnline(word, cb) {
    if (typeof fetch !== 'function') { cb(null); return; }
    const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word);
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (!Array.isArray(data) || !data[0]) { cb(null); return; }
        const e = data[0];
        const meanings = [];
        (e.meanings || []).forEach(m => {
          const defs = (m.definitions || []).slice(0, 2).map(d => d.definition);
          if (defs.length) meanings.push('<b>' + esc(m.partOfSpeech) + '</b> ' + defs.map(esc).join('；'));
        });
        // dictionaryapi.dev 的 phonetic 可能自带首尾斜杠，统一剥离，显示层再包一层
        let ph = (e.phonetic || (e.phonetics && e.phonetics[0] && e.phonetics[0].text)) || '';
        ph = ph.replace(/^\/|\/$/g, '');
        cb({
          phonetic: ph,
          html: meanings.slice(0, 3).join('<br>')
        });
      })
      .catch(() => cb(null));
  }

  function loadJSON(k, def) {
    try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (e) { return def; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  let words = loadJSON(LS_WORDS, []);
  let aiId = loadJSON(LS_AI, 'bing');
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
      } else if (k === 'dict') openProvider('bing', w);
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
      '<div class="lk-def" id="lkDef">正在查询释义…</div>' +
      '<div class="lk-acts">' +
      '<button data-k="speak">🔊 朗读</button>' +
      '<button data-k="add">＋ 生词本</button>' +
      '<button class="primary" data-k="dict">词典释义</button>' +
      '<button data-k="ai">问 ' + esc(p.name) + '</button>' +
      '<button data-k="copy">复制</button>' +
      '</div>';
    b.hidden = false;
    // 填充内联释义：先查本地词表，再走在线词典
    const key = w.toLowerCase().replace(/\s+/g, ' ');
    const defEl = b.querySelector('#lkDef');
    const local = MINI_DICT[key] || MINI_DICT[key.replace(/s$/, '')] || MINI_DICT[key.replace(/ed$/, '')] || MINI_DICT[key.replace(/ing$/, '')];
    if (local) {
      defEl.innerHTML = esc(local);
    } else {
      fetchDictOnline(w, (r) => {
        if (!defEl.isConnected) return;
        if (r && r.html) {
          defEl.innerHTML = (r.phonetic ? '<span class="lk-ipa">/' + esc(r.phonetic) + '/</span> ' : '') + r.html;
        } else {
          defEl.innerHTML = '<span class="lk-hint">本地词典未收录，点「词典释义」或「问 AI」查看完整解释</span>';
        }
      });
    }
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
    const w = text || '';
    if (!p.embeddable) {
      // 不可内嵌（登录墙 / CSP 拦截 / 无带词参数）→ 直接在系统浏览器打开，不显示空 iframe
      f.style.display = 'none';
      const url = p.url(w);
      if (w) A.toast('正在浏览器打开「' + p.name + '」');
      if (A.openUrl) A.openUrl(url); else window.open(url, '_blank', 'noopener');
      return;
    }
    f.style.display = 'block';
    f.src = p.url(w);
    win.dataset.pending = '';
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
        due: 0, ease: 2.5, reps: 0, interval: 0,
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
