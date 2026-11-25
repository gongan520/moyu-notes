/* ══════════════════════════════════════════════════════════
   htmlpage.js — HTML 笔记页的导入与渲染
   目标：让任何 AI 生成的 .html 在纸面上都「按原样」正确显示
   · 补全文档骨架 / viewport
   · 注入最小基线样式（不改动原设计）
   · 高度自适应回报（内容多高，纸就多长）
   · 拦截外链跳转，避免版面被带走
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const BASE_CSS = `
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
html,body{margin:0;}
body{min-height:1px;}
img,video,canvas,svg{max-width:100%;}
img{-webkit-user-drag:none;}
::selection{background:rgba(224,178,99,.35);}
::-webkit-scrollbar{width:0;height:0;}
`;

  const HEIGHT_SCRIPT = `
<script id="__moyu_bridge">
(function(){
  var last=-1, timer=0, sent=0;
  // 收集文档里的标题层级，供大纲使用（相对 body 顶部，不受分页偏移影响）
  function heads(){
    var out=[];
    var hs;
    try{ hs=document.querySelectorAll('h1,h2,h3,h4'); }catch(e){ return out; }
    var bt=document.body? document.body.getBoundingClientRect().top : 0;
    for(var i=0;i<hs.length && out.length<240;i++){
      var el=hs[i];
      var txt=(el.textContent||'').replace(/\\s+/g,' ').trim();
      if(!txt) continue;
      var r=el.getBoundingClientRect();
      out.push([Math.round(r.top-bt), parseInt(el.tagName.charAt(1),10)||1, txt.slice(0,70)]);
    }
    return out;
  }
  function measure(){
    var d=document.documentElement, b=document.body;
    if(!d||!b) return;
    // 文档刚开解析时 body 还是空的，此时 scrollHeight 等于视口高度，
    // 会把「1000」当成内容高度报出去，导致分页算错。等有内容再量。
    if(!b.firstElementChild) return;
    var h=Math.max(
      d?d.scrollHeight:0, d?d.offsetHeight:0,
      b?b.scrollHeight:0, b?b.offsetHeight:0,
      b?b.getBoundingClientRect().height:0
    );
    h=Math.ceil(h||0);
    if(h>0 && Math.abs(h-last)>1){
      last=h;
      try{ parent.postMessage({__moyu_h:h, __moyu_heads:heads()},'*'); }catch(e){}
    }
  }
  function schedule(){
    if(timer) return;
    timer=setTimeout(function(){ timer=0; measure(); }, 90);
  }
  window.addEventListener('load', measure);
  document.addEventListener('DOMContentLoaded', measure);
  window.addEventListener('resize', schedule);
  document.addEventListener('load', schedule, true);
  document.addEventListener('error', schedule, true);
  try{
    if(window.ResizeObserver){
      var ro=new ResizeObserver(schedule);
      ro.observe(document.documentElement);
      document.addEventListener('DOMContentLoaded', function(){
        if(document.body) ro.observe(document.body);
      });
    }
  }catch(e){}
  try{
    if(window.MutationObserver){
      var mo=new MutationObserver(schedule);
      document.addEventListener('DOMContentLoaded', function(){
        mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true});
      });
    }
  }catch(e){}
  [60,200,600,1200,2200].forEach(function(t){ setTimeout(measure,t); });
  // 同一份文档翻页时，只移动内容，不必重新加载
  window.addEventListener('message', function(e){
    var d=e.data;
    if(d && typeof d.__moyu_offset === 'number'){
      document.body.style.position='relative';
      document.body.style.top=(-d.__moyu_offset)+'px';
      setTimeout(measure, 30);
    }
  });
  // 拦截外链与表单，避免把笔记页导航走；锚点交给父页面做跨页跳转
  document.addEventListener('click', function(ev){
    var a=ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if(!a) return;
    var href=a.getAttribute('href')||'';
    if(href==='') return;
    if(href.charAt(0)==='#'){
      // 锚点统一交给父页面处理：编辑模式换页，阅读模式滚容器
      ev.preventDefault();
      try{ parent.postMessage({__moyu_hash:decodeURIComponent(href.slice(1))},'*'); }catch(e){}
      return;
    }
    ev.preventDefault();
    try{ parent.postMessage({__moyu_link:href},'*'); }catch(e){}
  }, true);
  document.addEventListener('submit', function(ev){ ev.preventDefault(); try{ parent.postMessage({__moyu_link:'form'},'*'); }catch(e){} }, true);
  measure();
})();
<\/script>`;

  const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

  /* 让 HTML 变成「能安全种在纸上的」完整文档 */
  function prepare(source, opts) {
    opts = opts || {};
    let html = String(source || '');
    if (!html.trim()) html = '<!doctype html><html><body><p style="padding:24px;font-family:sans-serif;color:#888">（空文档）</p></body></html>';

    // 去掉 BOM
    html = html.replace(/^\uFEFF/, '');

    const inject = [];
    if (!/<meta[^>]+name=["']?viewport/i.test(html)) inject.push(VIEWPORT);
    inject.push('<style id="__moyu_base">' + BASE_CSS + '</style>');
    // 阅读模式：整篇连续显示，锚点/链接走浏览器原生行为
    if (opts.reader) inject.push('<script>window.__MOYU_READER__=true;<\/script>');
    // 分页偏移：把整份文档往上推，让本页只露出自己的那一段
    if (opts.offsetY && opts.offsetY > 0) {
      inject.push('<style id="__moyu_offset">body{position:relative;top:-' + opts.offsetY + 'px;}</style>');
    }
    inject.push(HEIGHT_SCRIPT);

    // 确保有 html/body 骨架
    const hasHtml = /<html[\s>]/i.test(html);
    const hasHead = /<head[\s>]/i.test(html);
    const hasBody = /<body[\s>]/i.test(html);

    if (hasHead) {
      html = html.replace(/<\/head\s*>/i, inject.join('') + '</head>');
    } else if (hasHtml) {
      html = html.replace(/<html([^>]*)>/i, '<html$1><head>' + inject.join('') + '</head>');
    } else if (hasBody) {
      html = html.replace(/<body([^>]*)>/i, '<head>' + inject.join('') + '</head><body$1>');
    } else {
      html = '<!doctype html><html><head><meta charset="utf-8">' + inject.join('') + '</head><body>' + html + '</body></html>';
    }

    // 补 charset（中文乱码高发点）
    if (!/<meta[^>]+charset/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
    }
    return html;
  }

  /**
   * 挂载到 iframe
   * @param {HTMLIFrameElement} frame
   * @param {string} source 原始 HTML
   * @param {{onHeight:Function,onLink:Function,onHash:Function,onReady:Function}} cbs
   */
  // 常驻路由：同一份文档在写笔记期间会一直发消息（高度、链接、锚点），
  // 不能像以前那样 mount 完成后就把监听摘掉，否则之后的点击全部失效。
  const routed = new Map();

  window.addEventListener('message', (e) => {
    const entry = routed.get(e.source);
    if (!entry) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (typeof d.__moyu_h === 'number') {
      if (entry.onHeight) entry.onHeight(d.__moyu_h);
      if (Array.isArray(d.__moyu_heads) && entry.onHeads) entry.onHeads(d.__moyu_heads);
    } else if (d.__moyu_link) {
      if (entry.onLink) entry.onLink(d.__moyu_link);
    } else if (d.__moyu_hash) {
      if (entry.onHash) entry.onHash(d.__moyu_hash);
    }
  });

  function mount(frame, source, cbs) {
    cbs = cbs || {};
    return new Promise((resolve) => {
      let done = false;
      let lastH = 0;
      function finish() {
        if (done) return;
        done = true;
        frame.removeEventListener('load', onLoad);
        if (cbs.onReady) cbs.onReady();
        resolve(lastH || 0);
      }
      function onLoad() {
        // 兜底：直接读一次（同源 srcdoc 可访问）
        try {
          const doc = frame.contentDocument;
          if (doc) {
            const h = Math.max(
              doc.documentElement.scrollHeight,
              doc.body ? doc.body.scrollHeight : 0
            );
            if (h && Math.abs(h - lastH) > 1) {
              lastH = h;
              if (cbs.onHeight) cbs.onHeight(h);
            }
          }
        } catch (e) { }
        setTimeout(finish, 320);
      }

      // 注册常驻路由（覆盖同一 frame 上的上一次注册）
      try {
        const win = frame.contentWindow;
        if (win) {
          routed.set(win, {
            frame: frame,
            onHeight: (h) => { lastH = h; if (cbs.onHeight) cbs.onHeight(h); },
            onLink: cbs.onLink,
            onHash: cbs.onHash
          });
        }
      } catch (e) { }

      frame.addEventListener('load', onLoad);
      frame.srcdoc = prepare(source, { offsetY: cbs.offsetY || 0 });
      // 极端情况下 load 不触发
      setTimeout(() => { if (!done) finish(); }, 6000);
    });
  }

  function clear(frame) {
    try {
      frame.removeAttribute('srcdoc');
      frame.srcdoc = '<!doctype html><html><body style="background:#fff"></body></html>';
    } catch (e) { }
  }

  A.HtmlPage = { prepare, mount, clear };
})(window.MY);
