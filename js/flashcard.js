/* ══════════════════════════════════════════════════════════
   flashcard.js — 闪卡与间隔重复（MarginNote / Anki 的学习闭环）
   卡片挂在书上，用 SM-2 排程；复习界面翻卡 → 评分 → 自动排下次
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const DAY = 86400000;
  let host = null;
  let queue = [];
  let qi = 0;
  let flipped = false;
  let session = { done: 0, again: 0 };

  /* ───────────── 数据 ───────────── */
  function cardsOf(book) {
    if (!book) return [];
    if (!Array.isArray(book.cards)) book.cards = [];
    return book.cards;
  }

  function save() {
    const b = A.Studio.S.book;
    if (b) { try { A.db.saveBook(b); } catch (e) { } }
  }

  function dueCards() {
    const now = Date.now();
    return cardsOf(A.Studio.S.book).filter(c => !c.due || c.due <= now);
  }

  /* ───────────── SM-2 ───────────── */
  function schedule(card, grade) {
    // grade: 0 忘了 / 1 困难 / 2 一般 / 3 简单
    const q = grade === 0 ? 2 : (grade === 1 ? 3 : (grade === 2 ? 4 : 5));
    // 兼容历史遗留字段（早期 makeCards 写的是 n/ef/ivl），统一迁移到 ease/reps/interval
    if (card.ef != null && card.ease == null) card.ease = card.ef;
    if (card.ivl != null && card.interval == null) card.interval = card.ivl;
    if (card.n != null && card.reps == null) card.reps = card.n;
    let ease = card.ease || 2.5;
    let reps = card.reps || 0;
    let interval = card.interval || 0;

    if (q < 3) {
      reps = 0;
      interval = 0;
      card.lapses = (card.lapses || 0) + 1;
      card.due = Date.now() + 10 * 60 * 1000; // 10 分钟后再来
    } else {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.max(1, Math.round(interval * ease));
      ease = A.clamp(ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 1.3, 3.2);
      card.due = Date.now() + interval * DAY;
    }
    card.ease = ease;
    card.reps = reps;
    card.interval = interval;
    card.lastGrade = grade;
    card.lastAt = Date.now();
    return card;
  }

  /* ───────────── 全屏界面 ───────────── */
  function ensureHost() {
    if (host) return host;
    host = A.el('div', 'fc');
    host.id = 'flashView';
    host.hidden = true;
    host.innerHTML =
      '<div class="ov-bar">' +
      '<button class="icon-btn" id="fcClose"><svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="fc-progress" id="fcProg">0 / 0</div>' +
      '<button class="ov-act" id="fcAdd">＋ 从本页出题</button>' +
      '</div>' +
      '<div class="fc-stage" id="fcStage"></div>' +
      '<div class="fc-bar" id="fcBar" hidden>' +
      '<button class="fc-grade fc-grade--0" data-g="0">忘了<em>10 分钟</em></button>' +
      '<button class="fc-grade fc-grade--1" data-g="1">困难</button>' +
      '<button class="fc-grade fc-grade--2" data-g="2">一般</button>' +
      '<button class="fc-grade fc-grade--3" data-g="3">简单</button>' +
      '</div>';
    document.body.appendChild(host);

    host.querySelector('#fcClose').addEventListener('click', close);
    host.querySelector('#fcAdd').addEventListener('click', addFromPage);
    host.querySelectorAll('.fc-grade').forEach(b => {
      b.addEventListener('click', () => grade(parseInt(b.dataset.g, 10)));
    });
    return host;
  }

  function open() {
    const h = ensureHost();
    const b = A.Studio.S.book;
    if (!b) { A.toast('先打开一本书'); return; }
    queue = dueCards();
    if (!queue.length) {
      const total = cardsOf(b).length;
      h.hidden = false;
      h.querySelector('#fcStage').innerHTML =
        '<div class="fc-empty">' +
        (total
          ? '<b>今天的卡都复习完了</b><p>共 ' + total + ' 张卡在库里，下次到期会自动排进来。</p>'
          : '<b>还没有闪卡</b><p>点右上角「从本页出题」，把这一页的标题和笔记变成一张卡。</p>') +
        '<button class="ov-act" id="fcAll">查看全部卡片（' + total + '）</button>' +
        '</div>';
      h.querySelector('#fcBar').hidden = true;
      h.querySelector('#fcProg').textContent = '0 / 0';
      const allBtn = h.querySelector('#fcAll');
      if (allBtn) allBtn.onclick = () => { queue = cardsOf(b).slice(); qi = 0; renderCard(); };
      return;
    }
    qi = 0;
    flipped = false;
    session = { done: 0, again: 0 };
    h.hidden = false;
    renderCard();
  }

  function close() { if (host) host.hidden = true; }

  function renderCard() {
    const h = ensureHost();
    const stage = h.querySelector('#fcStage');
    const bar = h.querySelector('#fcBar');
    const prog = h.querySelector('#fcProg');

    if (qi >= queue.length) {
      stage.innerHTML =
        '<div class="fc-empty"><b>本轮完成</b>' +
        '<p>复习 ' + session.done + ' 张，其中标记「忘了」' + session.again + ' 次。</p>' +
        '<button class="ov-act" id="fcAgain">再来一轮</button></div>';
      bar.hidden = true;
      prog.textContent = session.done + ' / ' + queue.length;
      const again = h.querySelector('#fcAgain');
      if (again) again.onclick = () => { qi = 0; renderCard(); };
      return;
    }

    const c = queue[qi];
    flipped = false;
    prog.textContent = (qi + 1) + ' / ' + queue.length;
    bar.hidden = true;

    stage.innerHTML =
      '<div class="fc-card" id="fcCard">' +
      '<div class="fc-side fc-q"><span class="fc-tag">问题</span><div class="fc-txt">' + esc(c.q || '（空）') + '</div>' +
      (c.pageId ? '<button class="fc-jump" id="fcJump">跳到出处</button>' : '') + '</div>' +
      '<div class="fc-side fc-a" hidden><span class="fc-tag">答案</span><div class="fc-txt">' + esc(c.a || '（没写答案）') + '</div></div>' +
      '<div class="fc-hint" id="fcHint">点一下卡片看答案</div>' +
      '</div>';

    const card = stage.querySelector('#fcCard');
    const ans = stage.querySelector('.fc-a');
    card.addEventListener('click', (e) => {
      if (e.target.closest('.fc-jump')) return;
      if (flipped) return;
      flipped = true;
      ans.hidden = false;
      stage.querySelector('#fcHint').hidden = true;
      card.classList.add('is-flipped');
      bar.hidden = false;
    });

    const jump = stage.querySelector('#fcJump');
    if (jump) jump.addEventListener('click', () => {
      const idx = A.Studio.S.pages.findIndex(p => p.id === c.pageId);
      if (idx >= 0) { A.Studio.goPage(idx); close(); }
    });
  }

  function grade(g) {
    if (qi >= queue.length) return;
    const c = queue[qi];
    schedule(c, g);
    session.done++;
    if (g === 0) session.again++;
    save();
    qi++;
    renderCard();
  }

  /* ───────────── 从当前页出题 ───────────── */
  function addFromPage() {
    const St = A.Studio;
    const p = St.S.page;
    const b = St.S.book;
    if (!p || !b) return;

    // 优先用这页最大的文字框做问题，其余文字做答案
    const texts = (p.texts || []).filter(t => t.text && t.text.trim());
    let q = '';
    let a = '';
    if (texts.length) {
      const sorted = texts.slice().sort((x, y) => (y.size || 18) - (x.size || 18));
      q = sorted[0].text.trim().split('\n')[0].slice(0, 120);
      a = sorted.slice(1).map(t => t.text.trim()).join('\n').slice(0, 400);
    }
    if (!q) {
      const ol = A.Outline.autoExtract();
      const hit = ol.find(o => o.pageId === p.id);
      q = hit ? hit.text : '第 ' + (p.order + 1) + ' 页讲了什么？';
    }

    const node = A.el('div', 'fc-add');
    node.innerHTML =
      '<label class="field"><span>问题</span><textarea id="fcQ" rows="2"></textarea></label>' +
      '<label class="field"><span>答案</span><textarea id="fcA" rows="4"></textarea></label>' +
      '<div class="field-hint">答案可以留空，复习时自己回忆；卡片会绑定到第 ' + (p.order + 1) + ' 页，方便跳回来。</div>';

    const sheet = A.sheet.open({
      title: '新建闪卡',
      sub: '第 ' + (p.order + 1) + ' 页',
      node: node,
      onMount: (body, sh) => {
        const qi2 = body.querySelector('#fcQ');
        const ai = body.querySelector('#fcA');
        qi2.value = q;
        ai.value = a;
        const btn = A.el('button', 'list-item');
        btn.innerHTML = '<span class="li-grow">保存这张卡</span>';
        btn.addEventListener('click', () => {
          const Q = qi2.value.trim();
          if (!Q) { A.toast('问题不能为空'); return; }
          cardsOf(b).push({
            id: A.uid('fc'),
            q: Q,
            a: ai.value.trim(),
            pageId: p.id,
            created: Date.now(),
            ease: 2.5, reps: 0, interval: 0, due: Date.now()
          });
          save();
          sh.close();
          A.toast('已加入闪卡库');
          if (host && !host.hidden) { queue = dueCards(); qi = 0; renderCard(); }
        });
        body.appendChild(btn);
      }
    });
    void sheet;
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  A.Flashcard = {
    open, close, addFromPage, cardsOf, dueCards, schedule,
    get isOpen() { return !!(host && !host.hidden); }
  };
})(window.MY);
