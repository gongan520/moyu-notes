/* ══════════════════════════════════════════════════════════
   freenotes.js — 自由笔记式界面：左侧文档抽屉 / 顶部胶囊增强
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  let drawer, scrim, edge, pagesBox, docTitle, fnTitle;
  let lastSig = '';
  const PENBOX_KEY = 'moyu_penbox_v1';
  const timer = { sec: 0, running: false, endAt: 0, interval: 0, pill: null, dismissed: false };

  function $(s, root) { return (root || document).querySelector(s); }
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
    const sig = (S.pages || []).map((p, i) => i + ':' + (p.heading || p.type || '') + ':' + (p.strokes || []).length + ':' + (p.bookmarked ? '1' : '0')).join('|') + '@' + S.idx;
    if (sig === lastSig) return;
    lastSig = sig;
    pagesBox.innerHTML = (S.pages || []).map((p, i) =>
      '<div class="fn-page' + (i === S.idx ? ' is-on' : '') + '">' +
      '<button class="fn-page-main" data-page="' + i + '">' +
      '<b>' + String(i + 1).padStart(2, '0') + '</b>' +
      '<span>' + (p.heading || (p.type === 'html' ? 'HTML 原文' : (i === 0 ? '第 1 页' : '第 ' + (i + 1) + ' 页'))) + '</span>' +
      '</button>' +
      '<button class="fn-bookmark' + (p.bookmarked ? ' is-on' : '') + '" data-bookmark="' + i + '" title="书签">' + (p.bookmarked ? '★' : '☆') + '</button>' +
      '</div>'
    ).join('') || '<div style="padding:12px;font-size:12px;color:#8a8f9a">暂无页面</div>';
    A.$$('.fn-page-main', pagesBox).forEach(b => {
      b.addEventListener('click', () => {
        closeDrawer();
        A.Studio.goPage(+b.dataset.page);
      });
    });
    A.$$('.fn-bookmark', pagesBox).forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const i = +b.dataset.bookmark;
        const p = S.pages[i];
        if (!p) return;
        p.bookmarked = !p.bookmarked;
        try { await A.db.savePage(p); } catch (err) { }
        lastSig = ''; render();
        A.toast(p.bookmarked ? '已加书签' : '已取消书签');
      });
    });
  }

  function svgURL(body) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' + body + '</svg>'
    );
  }

  const STICKERS = [
    ['星标', '<path d="M60 12l14 30 33 4-24 23 6 33-29-16-29 16 6-33-24-23 33-4z" fill="#f5c451" stroke="#8a6412" stroke-width="4" stroke-linejoin="round"/>'],
    ['爱心', '<path d="M60 100C20 75 12 50 24 35c11-14 30-9 36 6 6-15 25-20 36-6 12 15 4 40-36 65z" fill="#ff7a8a" stroke="#a43b4c" stroke-width="4"/>'],
    ['完成', '<circle cx="60" cy="60" r="42" fill="#5dd39e" stroke="#277a58" stroke-width="4"/><path d="M40 61l14 14 28-31" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'],
    ['灯泡', '<path d="M42 72a26 26 0 1136 0c-6 5-8 10-8 18H50c0-8-2-13-8-18z" fill="#ffe27a" stroke="#8a6a12" stroke-width="4"/><rect x="50" y="90" width="20" height="10" rx="3" fill="#9aa0a6"/>'],
    ['箭头', '<path d="M25 80l60-45M60 35h25v25" fill="none" stroke="#2f7cf6" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'],
    ['便签', '<path d="M24 22h72v52l-24 24H24z" fill="#fff1a8" stroke="#9a8b33" stroke-width="4"/><path d="M72 98v-24h24" fill="none" stroke="#9a8b33" stroke-width="4"/><path d="M40 46h40M40 64h28" stroke="#8a7d3a" stroke-width="5" stroke-linecap="round"/>'],
    ['笑脸', '<circle cx="60" cy="60" r="42" fill="#ffd66b" stroke="#9a7412" stroke-width="4"/><circle cx="46" cy="52" r="4" fill="#5a4310"/><circle cx="74" cy="52" r="4" fill="#5a4310"/><path d="M43 72c10 12 24 12 34 0" fill="none" stroke="#5a4310" stroke-width="5" stroke-linecap="round"/>'],
    ['书签', '<path d="M36 16h48v88L60 86 36 104z" fill="#7ca9ff" stroke="#2f5fa8" stroke-width="4" stroke-linejoin="round"/>'],
    ['重要', '<circle cx="60" cy="60" r="42" fill="#ff8a6b" stroke="#a3442d" stroke-width="4"/><path d="M60 34v38" stroke="#fff" stroke-width="10" stroke-linecap="round"/><circle cx="60" cy="86" r="6" fill="#fff"/>'],
    ['花朵', '<g fill="#ff9ec4" stroke="#a64b76" stroke-width="3"><circle cx="60" cy="34" r="15"/><circle cx="86" cy="60" r="15"/><circle cx="60" cy="86" r="15"/><circle cx="34" cy="60" r="15"/></g><circle cx="60" cy="60" r="13" fill="#f6c453" stroke="#9a7412" stroke-width="3"/>'],
    ['勾号', '<rect x="18" y="18" width="84" height="84" rx="18" fill="#e9f5ff" stroke="#2f7cf6" stroke-width="4"/><path d="M38 62l16 16 30-36" fill="none" stroke="#2f7cf6" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'],
    ['问号', '<circle cx="60" cy="60" r="42" fill="#d8c4ff" stroke="#6a4aa3" stroke-width="4"/><path d="M48 46c3-9 21-11 25 0 3 9-9 12-12 19" fill="none" stroke="#4b3578" stroke-width="7" stroke-linecap="round"/><circle cx="61" cy="82" r="5" fill="#4b3578"/>']
  ];

  function openStickers() {
    closeDrawer();
    const node = A.el('div');
    node.className = 'fn-sticker-grid';
    node.innerHTML = STICKERS.map((s, i) =>
      '<button data-sticker="' + i + '" title="' + s[0] + '"><img src="' + svgURL(s[1]) + '" alt="' + s[0] + '"><span>' + s[0] + '</span></button>'
    ).join('');
    A.sheet.open({
      title: '贴纸', sub: '本地素材 · 点击贴到当前页', node,
      onMount: (body, sh) => {
        A.$$('[data-sticker]', body).forEach(b => b.addEventListener('click', () => {
          const s = STICKERS[+b.dataset.sticker];
          if (!s || !A.Studio) return;
          sh.close();
          A.Studio.insertImage(svgURL(s[1]));
        }));
      }
    });
  }

  function openFullText() {
    closeDrawer();
    const S = A.Studio && A.Studio.S;
    if (!S || !S.page) return;
    const node = A.el('div');
    node.className = 'fn-fulltext';
    node.innerHTML =
      '<textarea id="fnFullTextArea" placeholder="在这里输入整页文字…"></textarea>' +
      '<div class="fn-fulltext-row">' +
      '<label>字号 <input id="fnFullSize" type="number" min="12" max="72" value="24"></label>' +
      '<label>颜色 <input id="fnFullColor" type="color" value="#1c1c1e"></label>' +
      '<button id="fnFullInsert" class="fn-primary">插入到页面</button>' +
      '</div>';
    A.sheet.open({
      title: '全屏输入', sub: '输入后会作为可编辑文字放到当前页', wide: true, node,
      onMount: (body, sh) => {
        const ta = $('#fnFullTextArea', body);
        if (ta) setTimeout(() => ta.focus(), 80);
        const btn = $('#fnFullInsert', body);
        if (btn) btn.addEventListener('click', () => {
          const text = (ta && ta.value || '').trim();
          if (!text) { A.toast('先输入文字'); return; }
          const p = S.page;
          A.Studio.addTextBox({
            x: Math.round(p.w * 0.1), y: Math.round(p.h * 0.12),
            w: Math.round(p.w * 0.8), size: +$('#fnFullSize', body).value || 24,
            color: $('#fnFullColor', body).value || '#1c1c1e',
            text, focus: false
          });
          sh.close();
          A.Studio.saveNow();
          A.toast('已插入文字');
        });
      }
    });
  }

  function fmtTime(sec) {
    const m = Math.floor(Math.max(0, sec) / 60);
    const s = Math.max(0, sec) % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function timerPill() {
    if (timer.pill && document.body.contains(timer.pill)) return timer.pill;
    const el = A.el('div', 'fn-timer-pill');
    el.innerHTML = '<span class="fn-timer-dot"></span><b id="fnTimerTime">00:00</b><button id="fnTimerPause">暂停</button><button id="fnTimerReset">重置</button><button id="fnTimerClose">×</button>';
    el.hidden = !(timer.running || timer.sec > 0);
    document.body.appendChild(el);
    timer.pill = el;
    $('#fnTimerPause', el).addEventListener('click', () => {
      if (timer.running) pauseTimer(); else resumeTimer();
    });
    $('#fnTimerReset', el).addEventListener('click', () => resetTimer());
    $('#fnTimerClose', el).addEventListener('click', () => {
      timer.dismissed = true;
      if (timer.pill) timer.pill.hidden = true;
    });
    return el;
  }

  function updateTimerUI() {
    const el = timerPill();
    if (!timer.dismissed) el.hidden = false;
    const t = $('#fnTimerTime', el);
    if (t) t.textContent = fmtTime(timer.sec);
    const pause = $('#fnTimerPause', el);
    if (pause) pause.textContent = timer.running ? '暂停' : '继续';
    el.classList.toggle('is-running', timer.running);
  }

  function ensureTicker() {
    if (timer.interval) return;
    timer.interval = setInterval(() => {
      if (!timer.running) return;
      timer.sec = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
      updateTimerUI();
      if (timer.sec <= 0) {
        timer.running = false;
        timer.endAt = 0;
        updateTimerUI();
        A.toast('计时结束');
      }
    }, 250);
  }

  function startTimer(seconds) {
    timer.dismissed = false;
    timer.sec = seconds;
    timer.endAt = Date.now() + seconds * 1000;
    timer.running = true;
    ensureTicker();
    updateTimerUI();
  }
  function pauseTimer() {
    if (!timer.running) return;
    timer.sec = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    timer.running = false;
    updateTimerUI();
  }
  function resumeTimer() {
    if (timer.running || timer.sec <= 0) return;
    timer.dismissed = false;
    timer.endAt = Date.now() + timer.sec * 1000;
    timer.running = true;
    ensureTicker();
    updateTimerUI();
  }
  function resetTimer() {
    timer.running = false;
    timer.sec = 0;
    timer.endAt = 0;
    updateTimerUI();
  }

  function openTimer() {
    closeDrawer();
    const node = A.el('div');
    node.className = 'fn-timer';
    node.innerHTML =
      '<div class="fn-timer-display" id="fnTimerDisplay">' + fmtTime(timer.sec) + '</div>' +
      '<div class="fn-timer-presets">' +
      '<button data-min="5">5 分钟</button><button data-min="15">15 分钟</button>' +
      '<button data-min="25">25 分钟</button><button data-min="45">45 分钟</button></div>' +
      '<div class="fn-timer-acts"><button id="fnTimerStart">开始</button><button id="fnTimerPauseSheet">暂停 / 继续</button><button id="fnTimerResetSheet">重置</button></div>';
    A.sheet.open({
      title: '计时器', sub: '背诵、刷题、专注记录', node,
      onMount: (body, sh) => {
        const disp = $('#fnTimerDisplay', body);
        const tick = setInterval(() => {
          if (!document.body.contains(disp)) { clearInterval(tick); return; }
          disp.textContent = fmtTime(timer.sec);
        }, 250);
        A.$$('[data-min]', body).forEach(b => b.addEventListener('click', () => {
          startTimer(+b.dataset.min * 60);
        }));
        $('#fnTimerStart', body).addEventListener('click', () => {
          if (timer.sec <= 0) startTimer(25 * 60); else resumeTimer();
          sh.close();
        });
        $('#fnTimerPauseSheet', body).addEventListener('click', () => {
          if (timer.running) pauseTimer(); else resumeTimer();
        });
        $('#fnTimerResetSheet', body).addEventListener('click', resetTimer);
      }
    });
    timerPill();
  }

  function loadPenbox() {
    try {
      const arr = JSON.parse(localStorage.getItem(PENBOX_KEY) || '[]');
      return Array.isArray(arr) ? arr.slice(0, 4) : [];
    } catch (e) { return []; }
  }
  function savePenbox(arr) {
    try { localStorage.setItem(PENBOX_KEY, JSON.stringify(arr)); } catch (e) { }
  }

  function openPenBox() {
    closeDrawer();
    const S = A.Studio && A.Studio.S;
    if (!S) return;
    const node = A.el('div');
    node.className = 'fn-penbox';
    const renderBox = () => {
      const arr = loadPenbox();
      node.innerHTML = [0, 1, 2, 3].map(i => {
        const p = arr[i];
        const label = p ? (p.tool || 'pen') + ' · ' + (p.size || 4) + 'px · ' + p.color : '空';
        return '<div class="fn-pen-slot" data-slot="' + i + '">' +
          '<div><b>笔盒 ' + (i + 1) + '</b><span>' + label + '</span></div>' +
          '<button data-save="' + i + '">保存当前</button><button data-use="' + i + '"' + (p ? '' : ' disabled') + '>使用</button>' +
          '</div>';
      }).join('');
      A.$$('[data-save]', node).forEach(b => b.addEventListener('click', () => {
        const arr = loadPenbox();
        arr[+b.dataset.save] = { tool: S.tool, color: S.color, size: S.size, kind: S.kind };
        savePenbox(arr); renderBox(); A.toast('已保存笔盒');
      }));
      A.$$('[data-use]', node).forEach(b => b.addEventListener('click', () => {
        const p = loadPenbox()[+b.dataset.use];
        if (!p || !A.Studio) return;
        if (p.tool) A.Studio.setTool(p.tool);
        if (p.color) A.Studio.setColor(p.color);
        if (p.size) A.Studio.setSize(p.size);
        if (p.kind) A.Studio.setKind(p.kind);
        A.toast('已切换笔盒');
      }));
    };
    renderBox();
    A.sheet.open({ title: '自定义笔盒', sub: '保存常用笔刷参数', node });
  }

  function openMaterials() {
    closeDrawer();
    const node = A.el('div');
    node.className = 'fn-materials';
    node.innerHTML =
      '<button id="fnMatStickers"><b>贴纸</b><span>本地贴纸，点击即贴</span></button>' +
      '<button id="fnMatTemplates"><b>纸张模板</b><span>空白 / 横线 / 方格 / 康奈尔</span></button>' +
      '<button id="fnMatColors"><b>色卡</b><span>常用学习配色</span></button>' +
      '<button id="fnMatPenbox"><b>笔盒</b><span>保存自己的笔刷参数</span></button>';
    A.sheet.open({
      title: '素材中心', sub: '本地素材 · 无需联网', node,
      onMount: (body, sh) => {
        $('#fnMatStickers', body).addEventListener('click', () => { sh.close(); openStickers(); });
        $('#fnMatTemplates', body).addEventListener('click', () => { sh.close(); if (A.Studio) A.Studio.openPaperPanel(); });
        $('#fnMatPenbox', body).addEventListener('click', () => { sh.close(); openPenBox(); });
        $('#fnMatColors', body).addEventListener('click', () => {
          sh.close();
          const colors = ['#1c1c1e', '#2f6fc9', '#b23a2f', '#3f9e52', '#e8a33d', '#6a4fb3'];
          const n = A.el('div'); n.className = 'fn-color-cards';
          n.innerHTML = colors.map(c => '<button data-c="' + c + '" style="background:' + c + '"></button>').join('');
          A.sheet.open({ title: '色卡', node: n, onMount: (b, s2) => {
            A.$$('[data-c]', b).forEach(x => x.addEventListener('click', () => {
              if (A.Studio) A.Studio.setColor(x.dataset.c);
              s2.close(); A.toast('已换色');
            }));
          }});
        });
      }
    });
  }

  function openAIAssistant() {
    closeDrawer();
    const node = A.el('div');
    node.className = 'fn-ai-panel';
    node.innerHTML =
      '<input id="fnAIInput" placeholder="输入英文单词或中文词语" autocomplete="off" />' +
      '<div class="fn-ai-acts"><button id="fnAILookup">查词 / 释义</button><button id="fnAISpeak">朗读</button><button id="fnAIWords">生词本</button></div>' +
      '<p class="fn-ai-note">AI 问答需要联网服务；这里先提供本地查词、朗读和生词本，数据只留在设备上。</p>';
    A.sheet.open({
      title: 'AI 助手', sub: '学习辅助', node,
      onMount: (body, sh) => {
        const input = $('#fnAIInput', body);
        if (input) setTimeout(() => input.focus(), 80);
        $('#fnAILookup', body).addEventListener('click', () => {
          const w = (input.value || '').trim();
          if (!w) { A.toast('先输入内容'); return; }
          sh.close();
          if (A.Words) A.Words.lookup(w, { speak: false });
        });
        $('#fnAISpeak', body).addEventListener('click', () => {
          const w = (input.value || '').trim();
          if (!w) { A.toast('先输入内容'); return; }
          if (A.Words) A.Words.speak(w);
        });
        $('#fnAIWords', body).addEventListener('click', () => {
          sh.close(); if (A.Words) A.Words.openDrawer();
        });
      }
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

    // 彩色笔尖快捷切换
    A.$$('.fn-pen-tip').forEach(b => b.addEventListener('click', () => {
      A.$$('.fn-pen-tip').forEach(x => x.classList.toggle('is-on', x === b));
      if (A.Studio) {
        A.Studio.setTool('pen');
        if (b.dataset.color) A.Studio.setColor(b.dataset.color);
      }
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

    const acts = {
      '#fnStickerBtn': openStickers,
      '#fnFullTextBtn': openFullText,
      '#fnTimerBtn': openTimer,
      '#fnPenBoxBtn': openPenBox,
      '#fnMaterialBtn': openMaterials,
      '#fnAIAssistantBtn': openAIAssistant
    };
    Object.keys(acts).forEach(sel => {
      const el = $(sel);
      if (el) el.addEventListener('click', acts[sel]);
    });

    // 截图 / 复制图片直接粘贴到当前页（PPT、网课截图学习笔记）
    document.addEventListener('paste', async (e) => {
      if (!inStudio() || !A.Studio || !A.Studio.S.page) return;
      const items = Array.prototype.slice.call((e.clipboardData && e.clipboardData.items) || []);
      const img = items.find(x => x.type && x.type.indexOf('image/') === 0);
      if (!img) return;
      e.preventDefault();
      try {
        const file = img.getAsFile();
        if (!file) return;
        const data = await A.readDataURL(file);
        A.Studio.insertImage(data);
        A.toast('截图已贴入当前页');
      } catch (err) { A.toast('截图粘贴失败'); }
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
