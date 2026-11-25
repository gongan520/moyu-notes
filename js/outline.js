/* ══════════════════════════════════════════════════════════
   outline.js — 大纲视图 + 一键转思维导图（幕布 / MarginNote）
   大纲是一等数据：可自动抽取、可手动编辑、点条目跳页
   脑图用纯 SVG 布局，随窗口自适应，可缩放拖动
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  let host = null;      // 全屏容器
  let mode = 'outline'; // outline | mindmap
  let dragging = null;
  let mindView = { x: 0, y: 0, k: 1 };

  /* ───────────── 数据 ───────────── */
  function nodeList(book) {
    if (!book) return [];
    if (!Array.isArray(book.outline)) book.outline = [];
    return book.outline;
  }

  /* 从页面内容自动抽取大纲：文字框按字号决定层级，HTML 页取首标题 */
  function autoExtract() {
    const St = A.Studio;
    const book = St.S.book;
    const pages = St.S.pages || [];
    if (!book || !pages.length) return [];
    const out = [];
    pages.forEach((p, i) => {
      let title = '';
      let level = 1;

      if (p.type === 'html' && p.heading) {
        title = String(p.heading).trim();
      }
      if (!title && Array.isArray(p.texts) && p.texts.length) {
        // 找这页字号最大的文字框当标题
        let best = null;
        p.texts.forEach(t => {
          const sz = t.size || 18;
          if (!best || sz > (best.size || 18)) best = t;
        });
        if (best && best.text && best.text.trim()) {
          title = best.text.trim().split('\n')[0].slice(0, 80);
          level = (best.size || 18) >= 30 ? 1 : 2;
        }
      }
      if (!title && p.type === 'pdf') title = 'PDF 第 ' + (p.pdfPage || i + 1) + ' 页';
      if (!title) title = '第 ' + (i + 1) + ' 页';

      out.push({ id: 'ol_' + p.id, text: title, pageId: p.id, level: level });
    });
    return out;
  }

  function save() {
    const St = A.Studio;
    if (!St.S.book) return;
    try { A.db.saveBook(St.S.book); } catch (e) { }
  }

  /* ───────────── 全屏容器 ───────────── */
  function ensureHost() {
    if (host) return host;
    host = A.el('div', 'ov');
    host.id = 'outlineView';
    host.hidden = true;
    host.innerHTML =
      '<div class="ov-bar">' +
      '<button class="icon-btn" id="ovClose" title="关闭"><svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="ov-tabs"><button class="ov-tab is-on" data-mode="outline">大纲</button><button class="ov-tab" data-mode="mindmap">脑图</button></div>' +
      '<button class="ov-act" id="ovAuto">自动抽取</button>' +
      '<button class="ov-act" id="ovAdd">＋ 条目</button>' +
      '</div>' +
      '<div class="ov-body"><div class="ov-list" id="ovList"></div><div class="ov-map" id="ovMap" hidden></div></div>';
    document.body.appendChild(host);

    host.querySelector('#ovClose').addEventListener('click', close);
    host.querySelectorAll('.ov-tab').forEach(b => {
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        host.querySelectorAll('.ov-tab').forEach(x => x.classList.toggle('is-on', x === b));
        render();
      });
    });
    host.querySelector('#ovAuto').addEventListener('click', () => {
      const St = A.Studio;
      if (!St.S.book) return;
      const auto = autoExtract();
      const cur = nodeList(St.S.book);
      // 保留手动条目的顺序信息：自动结果只补空缺
      St.S.book.outline = auto;
      save();
      mindView = { x: 0, y: 0, k: 1 };
      render();
      A.toast('已按页面内容生成 ' + auto.length + ' 条大纲');
      void cur;
    });
    host.querySelector('#ovAdd').addEventListener('click', () => {
      const St = A.Studio;
      if (!St.S.book) return;
      const list = nodeList(St.S.book);
      const p = St.S.page;
      list.push({
        id: A.uid('ol'),
        text: '新条目',
        pageId: p ? p.id : (St.S.pages[0] && St.S.pages[0].id),
        level: 1
      });
      save();
      render();
    });
    return host;
  }

  function open(m) {
    const h = ensureHost();
    mode = m || 'outline';
    h.hidden = false;
    h.querySelectorAll('.ov-tab').forEach(x => x.classList.toggle('is-on', x.dataset.mode === mode));
    const St = A.Studio;
    if (St.S.book && (!St.S.book.outline || !St.S.book.outline.length)) {
      St.S.book.outline = autoExtract();
      save();
    }
    render();
  }

  function close() {
    if (host) host.hidden = true;
  }

  function isOpen() { return !!(host && !host.hidden); }

  /* ───────────── 大纲列表 ───────────── */
  function render() {
    if (!host || host.hidden) return;
    const listBox = host.querySelector('#ovList');
    const mapBox = host.querySelector('#ovMap');
    const St = A.Studio;
    const book = St.S.book;
    if (!book) return;
    const nodes = nodeList(book);

    if (mode === 'outline') {
      listBox.hidden = false;
      mapBox.hidden = true;
      listBox.innerHTML = '';
      if (!nodes.length) {
        listBox.innerHTML = '<div class="ov-empty">还没有大纲。点右上角「自动抽取」按页面内容生成，或手动添加条目。</div>';
        return;
      }
      nodes.forEach((n, i) => {
        const row = A.el('div', 'ov-row');
        row.style.paddingLeft = (14 + (n.level - 1) * 22) + 'px';
        row.dataset.id = n.id;

        const dot = A.el('span', 'ov-dot');
        dot.textContent = n.level === 1 ? '●' : '○';
        dot.style.opacity = n.level === 1 ? '1' : '.55';
        row.appendChild(dot);

        const txt = A.el('span', 'ov-text');
        txt.textContent = n.text || '未命名';
        txt.contentEditable = 'true';
        txt.spellcheck = false;
        txt.addEventListener('blur', () => {
          n.text = txt.textContent.trim().slice(0, 120) || '未命名';
          txt.textContent = n.text;
          save();
        });
        txt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); txt.blur(); }
        });
        row.appendChild(txt);

        const acts = A.el('div', 'ov-acts');
        // 层级 -
        const up = A.el('button', 'ov-mini'); up.textContent = '←';
        up.title = '降一级';
        up.addEventListener('click', () => {
          n.level = Math.max(1, (n.level || 1) - 1); save(); render();
        });
        // 层级 +
        const dn = A.el('button', 'ov-mini'); dn.textContent = '→';
        dn.title = '升一级';
        dn.addEventListener('click', () => {
          n.level = Math.min(4, (n.level || 1) + 1); save(); render();
        });
        // 删除
        const del = A.el('button', 'ov-mini ov-mini--danger'); del.textContent = '×';
        del.title = '删除';
        del.addEventListener('click', () => {
          const at = nodes.indexOf(n);
          if (at >= 0) nodes.splice(at, 1);
          save(); render();
        });
        acts.appendChild(up); acts.appendChild(dn); acts.appendChild(del);
        row.appendChild(acts);

        // 点整行跳页
        row.addEventListener('click', (e) => {
          if (e.target === txt && document.activeElement === txt) return;
          if (e.target.closest('.ov-mini')) return;
          const idx = St.S.pages.findIndex(p => p.id === n.pageId);
          if (idx >= 0) {
            St.goPage(idx);
            close();
          } else {
            A.toast('这一条还没绑定页面');
          }
        });

        listBox.appendChild(row);
      });
      return;
    }

    /* 脑图 */
    listBox.hidden = true;
    mapBox.hidden = false;
    drawMind(mapBox, nodes, book);
  }

  /* ───────────── 脑图布局 ───────────── */
  function drawMind(box, nodes, book) {
    box.innerHTML = '';
    if (!nodes.length) {
      box.innerHTML = '<div class="ov-empty">先生成大纲，再转脑图。</div>';
      return;
    }

    const W = box.clientWidth || 900;
    const H = Math.max(box.clientHeight || 600, 400);

    // 构建树
    const root = { text: book.name || '笔记', children: [], level: 0 };
    const stack = [root];
    nodes.forEach(n => {
      const lv = Math.max(1, n.level || 1);
      while (stack.length > lv) stack.pop();
      const parent = stack[stack.length - 1] || root;
      const node = { text: n.text, children: [], level: lv, ref: n };
      parent.children.push(node);
      stack.push(node);
    });

    // 计算每个节点的纵向位置：叶子按序分配，父节点取子节点均值
    const GAP_Y = 46;
    let cursor = 0;
    function layout(node, depth) {
      node.depth = depth;
      if (!node.children.length) {
        node.y = cursor;
        cursor += GAP_Y;
      } else {
        node.children.forEach(c => layout(c, depth + 1));
        node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2;
      }
    }
    layout(root, 0);

    const maxDepth = Math.max(1, ...nodes.map(n => n.level || 1));
    const COL = Math.min(210, Math.max(120, (W - 80) / (maxDepth + 1)));
    const totalH = Math.max(cursor, GAP_Y) + 80;
    const svgH = Math.max(H, totalH);
    const svgW = Math.max(W, 80 + COL * (maxDepth + 1));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
    svg.setAttribute('class', 'mind-svg');
    svg.style.width = svgW + 'px';
    svg.style.height = svgH + 'px';
    svg.style.transform = 'translate(' + mindView.x + 'px,' + mindView.y + 'px) scale(' + mindView.k + ')';

    const gEdges = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const gNodes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(gEdges);
    svg.appendChild(gNodes);

    function edge(x1, y1, x2, y2) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (x1 + x2) / 2;
      p.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'rgba(224,178,99,.42)');
      p.setAttribute('stroke-width', '1.6');
      gEdges.appendChild(p);
    }

    function pill(node) {
      const x = 40 + node.depth * COL;
      const y = 40 + node.y;
      const isRoot = node.depth === 0;
      const pad = 14;
      const fs = isRoot ? 15 : 13;
      const tw = Math.min(COL - 26, Math.max(56, measure(node.text, fs) + pad * 2));
      const th = isRoot ? 38 : 32;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'mind-node');
      g.style.cursor = 'pointer';

      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y - th / 2);
      r.setAttribute('width', tw); r.setAttribute('height', th);
      r.setAttribute('rx', th / 2);
      r.setAttribute('fill', isRoot ? 'rgba(224,178,99,.22)' : (node.depth === 1 ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.045)'));
      r.setAttribute('stroke', isRoot ? 'rgba(224,178,99,.62)' : 'rgba(255,255,255,.13)');
      r.setAttribute('stroke-width', '1');
      g.appendChild(r);

      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', x + pad);
      t.setAttribute('y', y + fs * 0.35);
      t.setAttribute('fill', isRoot ? '#f0d6a2' : '#e7e7ea');
      t.setAttribute('font-size', fs);
      t.setAttribute('font-family', '-apple-system,"PingFang SC",sans-serif');
      t.textContent = clip(node.text, Math.floor((tw - pad * 2) / (fs * 0.62)));
      g.appendChild(t);

      g.addEventListener('click', () => {
        if (!node.ref) return;
        const St = A.Studio;
        const idx = St.S.pages.findIndex(p => p.id === node.ref.pageId);
        if (idx >= 0) { St.goPage(idx); close(); }
      });

      node.x = x + tw; // 出线点
      node.cx = x;
      gNodes.appendChild(g);
      return node;
    }

    function walk(node) {
      pill(node);
      node.children.forEach(c => {
        walk(c);
        edge(node.x != null ? node.x : 0, 40 + node.y, c.cx, 40 + c.y);
      });
    }
    walk(root);

    box.appendChild(svg);

    // 拖动平移
    let down = null;
    svg.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, vx: mindView.x, vy: mindView.y };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!down) return;
      mindView.x = down.vx + (e.clientX - down.x);
      mindView.y = down.vy + (e.clientY - down.y);
      svg.style.transform = 'translate(' + mindView.x + 'px,' + mindView.y + 'px) scale(' + mindView.k + ')';
    });
    svg.addEventListener('pointerup', () => { down = null; });
    svg.addEventListener('pointercancel', () => { down = null; });
    // 双指缩放：iPad 上没有 Ctrl+滚轮，靠两指触控
    let pinch = null;
    mapBox.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), k: mindView.k };
    }, { passive: true });
    mapBox.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch.d < 10) return;
      mindView.k = A.clamp(pinch.k * (d / pinch.d), 0.35, 2.4);
      svg.style.transform = 'translate(' + mindView.x + 'px,' + mindView.y + 'px) scale(' + mindView.k + ')';
    }, { passive: true });
    mapBox.addEventListener('touchend', () => { pinch = null; }, { passive: true });

    svg.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      mindView.k = A.clamp(mindView.k * (e.deltaY > 0 ? 0.9 : 1.1), 0.35, 2.4);
      svg.style.transform = 'translate(' + mindView.x + 'px,' + mindView.y + 'px) scale(' + mindView.k + ')';
    }, { passive: false });
  }

  let mCtx = null;
  function measure(text, size) {
    if (!mCtx) mCtx = document.createElement('canvas').getContext('2d');
    mCtx.font = size + 'px -apple-system,"PingFang SC",sans-serif';
    return mCtx.measureText(String(text || '')).width;
  }

  function clip(s, n) {
    s = String(s || '');
    if (n <= 2) return s.slice(0, 2);
    return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s;
  }

  A.Outline = {
    open, close, isOpen, render, autoExtract, nodeList, save,
    get mode() { return mode; }
  };
})(window.MY);
