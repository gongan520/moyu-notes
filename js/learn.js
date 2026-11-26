/* ══════════════════════════════════════════════════════════
   learn.js — 学习测验（Notability「Learn」式三种题型）
   填空 / 选择 / 配对，全部基于 book.cards 的 q/a 自动生成，
   评分复用 flashcard.js 的 schedule()，走 SM-2 排程。
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  let host = null;
  let tab = 'cloze';           // cloze | choice | match
  let items = [];              // 当前题型待做题目（match 时为配对组）
  let qi = 0;
  let stat = { done: 0, wrong: 0 };
  let mp = null;               // 配对局状态

  function FC() { return A.Flashcard; }
  function book() { return A.Studio.S.book; }
  function cards() { return FC().cardsOf(book()); }
  function save() { const b = book(); if (b) { try { A.db.saveBook(b); } catch (e) { } } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  // 归一化用于判分：小写、去空白与常见标点
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s，。,.!?;:'"“”‘’()（）[\]【】\-—_·、：]/g, '');
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function gradeCard(card, g) {
    FC().schedule(card, g);
    save();
  }

  /* ───────────── 出题 ───────────── */

  // 从答案里挑一段挖空：英文挑最长单词；中文挑最长词块（过长则取中间 2~3 字）
  function pickBlank(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return { before: '', blank: '', after: '' };
    const en = s.match(/[A-Za-z][A-Za-z0-9'.-]*/g);
    if (en && en.length) {
      let best = en[0];
      for (const w of en) if (w.length > best.length) best = w;
      const i = s.indexOf(best);
      return { before: s.slice(0, i), blank: best, after: s.slice(i + best.length) };
    }
    const runs = s.match(/[\u4e00-\u9fff]+/g);
    if (runs && runs.length) {
      let best = runs[0];
      for (const r of runs) if (r.length > best.length) best = r;
      let blank = best;
      let idx = s.indexOf(best);
      if (blank.length > 4) {
        const start = Math.floor((blank.length - 2) / 2);
        const len = Math.min(3, blank.length - start);
        const slice = blank.slice(start, start + len);
        idx = s.indexOf(slice);
        return { before: s.slice(0, idx), blank: slice, after: s.slice(idx + slice.length) };
      }
      return { before: s.slice(0, idx), blank: blank, after: s.slice(idx + blank.length) };
    }
    return { before: '', blank: s, after: '' };
  }

  function buildCloze(list) {
    return list
      .filter(c => String(c.a || '').trim())
      .map(c => {
        const pb = pickBlank(c.a);
        const bank = [pb.blank];
        const others = shuffle(list.filter(o => o !== c));
        for (const o of others) {
          const t = pickBlank(o.a).blank;
          if (!t) continue;
          if (bank.some(b => norm(b) === norm(t))) continue;
          bank.push(t);
          if (bank.length >= 4) break;
        }
        return { card: c, before: pb.before, blank: pb.blank, after: pb.after, full: String(c.a || '').trim(), bank: shuffle(bank) };
      });
  }

  function buildChoice(list) {
    const out = [];
    for (const c of list) {
      const correct = String(c.a == null ? '' : c.a).trim();
      if (!correct) continue;
      const dist = [];
      const pool = shuffle(list.filter(o => o !== c));
      for (const o of pool) {
        const t = String(o.a == null ? '' : o.a).trim();
        if (!t) continue;
        if (norm(t) === norm(correct)) continue;
        if (dist.some(d => norm(d) === norm(t))) continue;
        dist.push(t);
        if (dist.length === 3) break;
      }
      if (!dist.length) continue; // 组不出干扰项就跳过这张卡
      out.push({ card: c, options: shuffle([correct].concat(dist)) });
    }
    return out;
  }

  function buildMatch(list) {
    const pool = shuffle(list.filter(c => String(c.a == null ? '' : c.a).trim()));
    if (pool.length < 2) return [];
    return pool.slice(0, Math.min(pool.length, 6));
  }

  /* ───────────── 界面 ───────────── */

  function ensureHost() {
    if (host) return host;
    host = A.el('div', 'learn');
    host.id = 'learnView';
    host.hidden = true;
    host.innerHTML =
      '<div class="learn-bar">' +
      '<button class="icon-btn" id="lnClose" title="关闭"><svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="learn-title">学习测验</div>' +
      '<div class="learn-tabs">' +
      '<button class="learn-tab" data-t="cloze">填空</button>' +
      '<button class="learn-tab" data-t="choice">选择</button>' +
      '<button class="learn-tab" data-t="match">配对</button>' +
      '</div>' +
      '</div>' +
      '<div class="learn-progress" id="learnProg"></div>' +
      '<div class="learn-body" id="learnBody"></div>';
    document.body.appendChild(host);
    host.querySelector('#lnClose').addEventListener('click', close);
    host.querySelectorAll('.learn-tab').forEach(b => {
      b.addEventListener('click', () => setTab(b.dataset.t));
    });
    return host;
  }

  function open() {
    if (!book()) { A.toast('先打开一本书'); return; }
    const h = ensureHost();
    h.hidden = false;
    setTab('cloze');
  }

  function close() { if (host) host.hidden = true; }

  function setTab(t) {
    tab = t;
    const list = cards();
    if (t === 'cloze') items = buildCloze(list);
    else if (t === 'choice') items = buildChoice(list);
    else {
      items = buildMatch(list);
      mp = {
        pairs: items,
        leftOrder: shuffle(items.map((_, i) => i)),
        rightOrder: shuffle(items.map((_, i) => i)),
        matched: new Set(),
        selL: -1,
        mistakes: {}
      };
    }
    qi = 0;
    stat = { done: 0, wrong: 0 };
    host.querySelectorAll('.learn-tab').forEach(b => b.classList.toggle('is-on', b.dataset.t === t));
    render();
  }

  function emptyHtml() {
    const total = cards().length;
    if (!total) return '<div class="ln-empty"><b>还没有卡片</b><p>到「闪卡复习」里点右上角「从本页出题」，手动录入问题与答案，这里会自动生成测验。</p></div>';
    if (tab === 'choice') return '<div class="ln-empty"><b>暂无可生成的选择题</b><p>选择题需要至少 2 张答案不同的卡片来组成干扰项。</p></div>';
    if (tab === 'match') return '<div class="ln-empty"><b>暂无可配对的卡片</b><p>配对需要至少 2 张带答案的卡片。</p></div>';
    return '<div class="ln-empty"><b>暂无题目</b></div>';
  }

  function render() {
    const body = host.querySelector('#learnBody');
    if (!items.length) {
      host.querySelector('#learnProg').textContent = '';
      body.innerHTML = emptyHtml();
      return;
    }
    if (tab === 'match') { renderMatch(body); return; }
    host.querySelector('#learnProg').textContent = (qi + 1) + ' / ' + items.length;
    if (tab === 'cloze') renderCloze(body, items[qi]);
    else renderChoice(body, items[qi]);
  }

  function next() {
    qi++;
    if (qi >= items.length) {
      const body = host.querySelector('#learnBody');
      host.querySelector('#learnProg').textContent = '';
      const right = stat.done - stat.wrong;
      body.innerHTML =
        '<div class="ln-empty"><b>本轮完成</b><p>答对 ' + right + ' / ' + stat.done + ' 题，错 ' + stat.wrong + ' 题。</p>' +
        '<button class="btn btn--ghost" id="lnAgain">再来一轮</button></div>';
      body.querySelector('#lnAgain').addEventListener('click', () => setTab(tab));
      return;
    }
    render();
  }

  /* ───────────── 填空 ───────────── */

  function renderCloze(body, item) {
    body.innerHTML =
      '<div class="ln-card">' +
      '<span class="ln-tag">问题</span>' +
      '<div class="ln-q">' + esc(item.card.q || '（空）') + '</div>' +
      '</div>' +
      '<div class="ln-card">' +
      '<span class="ln-tag">填空</span>' +
      '<div class="ln-q">' + esc(item.before) + '<span class="ln-blank">______</span>' + esc(item.after) + '</div>' +
      '<div class="ln-bank" id="lnBank"></div>' +
      '<input class="ln-input" id="lnInput" type="text" placeholder="输入答案，或点上面的词" autocomplete="off" spellcheck="false" />' +
      '<div class="ln-acts"><button class="btn btn--solid" id="lnCheck">检查</button></div>' +
      '<div class="ln-fb" id="lnFb" hidden></div>' +
      '</div>';

    const bank = body.querySelector('#lnBank');
    item.bank.forEach(b => {
      if (!b) return;
      const chip = A.el('button', 'ln-chip');
      chip.textContent = b;
      chip.addEventListener('click', () => {
        const input = body.querySelector('#lnInput');
        input.value = b;
        input.focus();
      });
      bank.appendChild(chip);
    });

    const input = body.querySelector('#lnInput');
    const fb = body.querySelector('#lnFb');
    const check = body.querySelector('#lnCheck');
    let judged = false;

    input.addEventListener('keydown', e => { if (e.key === 'Enter') check.click(); });

    check.addEventListener('click', () => {
      if (judged) { next(); return; }
      judged = true;
      const val = norm(input.value);
      const ok = !!val && (val === norm(item.blank) || val === norm(item.full));
      stat.done++;
      if (!ok) stat.wrong++;
      gradeCard(item.card, ok ? 3 : 0);
      fb.hidden = false;
      fb.className = 'ln-fb ' + (ok ? 'is-ok' : 'is-no');
      fb.textContent = ok ? '回答正确' : '答错了，正确答案：' + (item.blank || '（无）');
      input.disabled = true;
      bank.querySelectorAll('.ln-chip').forEach(ch => { ch.disabled = true; });
      check.textContent = '下一题';
    });
  }

  /* ───────────── 选择 ───────────── */

  function renderChoice(body, item) {
    const letters = ['A', 'B', 'C', 'D'];
    let optsHtml = '';
    item.options.forEach((o, i) => {
      optsHtml += '<button class="ln-opt" data-i="' + i + '"><span class="ln-let">' + letters[i] + '</span><span class="ln-opt-t">' + esc(o) + '</span></button>';
    });
    body.innerHTML =
      '<div class="ln-card">' +
      '<span class="ln-tag">选择题</span>' +
      '<div class="ln-q">' + esc(item.card.q || '（空）') + '</div>' +
      '</div>' +
      '<div class="ln-opts">' + optsHtml + '</div>' +
      '<div class="ln-fb" id="lnFb" hidden></div>' +
      '<div class="ln-acts"><button class="btn btn--solid" id="lnNext" hidden>下一题</button></div>';

    const correctText = norm(String(item.card.a || '').trim());
    let judged = false;

    body.querySelectorAll('.ln-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (judged) return;
        judged = true;
        const i = parseInt(btn.dataset.i, 10);
        const ok = norm(item.options[i]) === correctText;
        stat.done++;
        if (!ok) stat.wrong++;
        gradeCard(item.card, ok ? 3 : 0);

        body.querySelectorAll('.ln-opt').forEach((b, k) => {
          b.disabled = true;
          if (norm(item.options[k]) === correctText) b.classList.add('is-correct');
          else if (k === i) b.classList.add('is-wrong');
        });

        const fb = body.querySelector('#lnFb');
        fb.hidden = false;
        fb.className = 'ln-fb ' + (ok ? 'is-ok' : 'is-no');
        fb.textContent = ok ? '回答正确' : '答错了，正确答案已标绿';
        body.querySelector('#lnNext').hidden = false;
      });
    });

    body.querySelector('#lnNext').addEventListener('click', next);
  }

  /* ───────────── 配对 ───────────── */

  function renderMatch(body) {
    const total = mp.pairs.length;
    const matched = mp.matched.size;
    host.querySelector('#learnProg').textContent = matched + ' / ' + total;

    if (matched >= total) {
      body.innerHTML =
        '<div class="ln-empty"><b>配对完成</b><p>共 ' + total + ' 对，中途答错 ' + stat.wrong + ' 次。</p>' +
        '<button class="btn btn--ghost" id="lnAgain">再来一轮</button></div>';
      body.querySelector('#lnAgain').addEventListener('click', () => setTab('match'));
      return;
    }

    let left = '', right = '';
    mp.leftOrder.forEach((pi, i) => {
      if (mp.matched.has(pi)) return;
      left += '<button class="ln-pair" data-l="' + i + '">' + esc(mp.pairs[pi].q || '（空）') + '</button>';
    });
    mp.rightOrder.forEach((pi, j) => {
      if (mp.matched.has(pi)) return;
      right += '<button class="ln-pair" data-r="' + j + '">' + esc(mp.pairs[pi].a || '（空）') + '</button>';
    });

    body.innerHTML =
      '<div class="ln-card"><span class="ln-tag">混搭配对</span><div class="ln-q">先点左边的问题，再点右边的答案进行配对。</div></div>' +
      '<div class="ln-match">' +
      '<div class="ln-col"><div class="ln-col-h">问题</div>' + left + '</div>' +
      '<div class="ln-col"><div class="ln-col-h">答案</div>' + right + '</div>' +
      '</div>';

    body.querySelectorAll('.ln-pair[data-l]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.l, 10);
        mp.selL = i;
        body.querySelectorAll('.ln-pair[data-l]').forEach(b => b.classList.toggle('is-sel', parseInt(b.dataset.l, 10) === i));
      });
    });

    body.querySelectorAll('.ln-pair[data-r]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (mp.selL < 0) { A.toast('先点左边的一个问题'); return; }
        const li = mp.selL;
        const piL = mp.leftOrder[li];
        const rj = parseInt(btn.dataset.r, 10);
        const piR = mp.rightOrder[rj];
        const leftBtn = body.querySelector('.ln-pair[data-l="' + li + '"]');

        if (piL === piR) {
          mp.matched.add(piL);
          gradeCard(mp.pairs[piL], mp.mistakes[piL] ? 1 : 3);
          stat.done++;
          mp.selL = -1;
          renderMatch(body);
        } else {
          mp.mistakes[piL] = (mp.mistakes[piL] || 0) + 1;
          stat.wrong++;
          mp.selL = -1;
          leftBtn.classList.remove('is-sel');
          leftBtn.classList.add('is-bad');
          btn.classList.add('is-bad');
          setTimeout(() => {
            leftBtn.classList.remove('is-bad');
            btn.classList.remove('is-bad');
          }, 420);
        }
      });
    });
  }

  A.Learn = {
    open, close,
    get isOpen() { return !!(host && !host.hidden); }
  };
})(window.MY);
