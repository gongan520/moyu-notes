/* ══════════════════════════════════════════════════════════
   version.js — 版本信息与更新日志
   每次发布新版本时在这里追加一条记录
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const VERSION = '2.0.0';
  const BUILD = '1';
  const VERSION_KEY = 'moyu_seen_version';

  const CHANGELOG = [
    {
      version: '2.0.0',
      date: '2026-11-26',
      title: '自由笔记式大改版 + 新功能',
      items: [
        '按国产「自由笔记」重新设计：顶部悬浮胶囊、满屏白纸、无底部工具栏',
        '浅灰背景 + 圆角纸张，彩色笔尖快捷切换（黑/蓝/红/橙）',
        '左侧资料中心抽屉：文件夹树 + 页面列表 + 功能入口',
        '新增：贴纸（12 种本地贴纸）、全屏文字输入、计时器',
        '新增：自定义笔盒（4 槽位保存笔刷参数）、页面书签',
        '新增：截图粘贴到笔记页、素材中心',
        'HTML 笔记修复：Apple Pencil 在原文上写字、手指上下滚动、目录点击跳转',
        '书写性能：合并高频采样 + 增量平滑 + GPU 加速，显著提升丝滑度',
        '掌托防误触：写字时掌根触碰不再丢笔画或误撤销',
        '手指只能平移，只有 Apple Pencil 能写字（严格 pen-only）'
      ]
    },
    {
      version: '1.2.0',
      date: '2026-11-25',
      title: 'HTML 连续阅读 + 批注',
      items: [
        'HTML 笔记默认直接进阅读模式，原始 HTML 连续显示不分页',
        '左侧目录固定显示，点击跳转对应小节',
        '目录和正文独立滚动，互不干扰',
        '顶部批注工具条：钢笔 / 荧光笔 / 橡皮 / 撤销',
        '批注持久化：关掉再打开笔迹还在'
      ]
    },
    {
      version: '1.1.0',
      date: '2026-11-25',
      title: 'Notability 式界面 + 学习功能',
      items: [
        'Notability 式书架：左侧栏、文件夹彩色圆点、主题三档',
        '英语 PDF 长按查词 + AI 小窗 + 生词本',
        '闪卡 SM-2 间隔重复',
        '胶带遮挡背诵、激光笔、形状识别',
        '分隔线分组、Learn 面板（填空/选择/配对）'
      ]
    },
    {
      version: '1.0.0',
      date: '2026-11-24',
      title: '首个发布版',
      items: [
        '手写笔记：压感钢笔 / 圆珠笔 / 铅笔 / 荧光笔',
        'PDF 导入批注（中文 PDF 正常显示，导出 144 dpi）',
        '录音 + 笔迹时间轴同步回放',
        '大纲 / 一键转思维导图',
        '图层（显隐 / 锁定 / 合并）',
        '套索缩放旋转、全文搜索',
        '六种内置中文字体',
        'iPad 全尺寸适配（mini 到 Pro 13）'
      ]
    }
  ];

  function checkAndUpdate() {
    try {
      const seen = localStorage.getItem(VERSION_KEY);
      if (seen === VERSION) return false;
      localStorage.setItem(VERSION_KEY, VERSION);
      if (seen && seen !== VERSION) {
        // 从旧版本升级 → 延迟弹出更新日志
        setTimeout(() => showWhatNew(seen), 800);
        return true;
      }
      return false;
    } catch (e) { return false; }
  }

  function showWhatNew(fromVersion) {
    const entry = CHANGELOG.find(c => c.version === VERSION);
    if (!entry) return;
    const isNew = !fromVersion;
    A.sheet.open({
      title: isNew ? '欢迎使用墨屿' : '墨屿已更新',
      sub: 'v' + entry.version + ' · ' + entry.title,
      html: '<div style="line-height:1.9;font-size:13.5px">' +
        '<ul style="padding-left:20px;margin:8px 0">' +
        entry.items.map(i => '<li>' + i + '</li>').join('') +
        '</ul></div>',
      onMount: (body, sh) => {
        const btn = A.el('button', 'btn btn--solid');
        btn.textContent = '开始使用';
        btn.style.cssText = 'width:100%;margin-top:16px;height:42px';
        btn.addEventListener('click', () => sh.close());
        body.appendChild(btn);
      }
    });
  }

  function showHistory() {
    const html = CHANGELOG.map(c =>
      '<div class="fn-changelog-item">' +
      '<div class="fn-changelog-head"><b>v' + c.version + '</b><span>' + c.date + '</span></div>' +
      '<div class="fn-changelog-title">' + c.title + '</div>' +
      '<ul>' + c.items.map(i => '<li>' + i + '</li>').join('') + '</ul>' +
      '</div>'
    ).join('');
    A.sheet.open({
      title: '版本历史', sub: '共 ' + CHANGELOG.length + ' 个版本',
      wide: true, html: '<div class="fn-changelog">' + html + '</div>'
    });
  }

  function init() {
    // 延迟检查更新，避免阻塞首屏
    setTimeout(checkAndUpdate, 1200);
    // 抽屉里加"版本历史"按钮
    const foot = document.querySelector('#fnDrawerFoot') || document.querySelector('.fn-drawer-foot');
    if (foot) {
      const btn = document.createElement('button');
      btn.id = 'fnVersionBtn';
      btn.textContent = 'v' + VERSION;
      btn.title = '查看版本历史';
      btn.style.cssText = 'color:var(--accent,#2f7cf6);font-weight:600';
      btn.addEventListener('click', () => showHistory());
      foot.insertBefore(btn, foot.firstChild);
    }
  }

  A.Version = {
    VERSION, BUILD, CHANGELOG,
    init, showHistory, showWhatNew, checkAndUpdate
  };
})(window.MY);
