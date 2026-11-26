/* ══════════════════════════════════════════════════════════
   ink.js — 墨迹渲染内核
   · Catmull-Rom 平滑采样
   · 压感驱动的变宽笔画（ribbon 多边形填充，单次 fill，性能好）
   · 钢笔 / 圆珠笔 / 铅笔 / 荧光笔 / 橡皮
   · 矢量存储，缩放不失真
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const SAMPLE_STEP = 1.35;     // 平滑后点间距（px）
  const MIN_RAW_STEP = 0.9;     // 原始采样最小间距
  const MAX_POINTS = 6000;

  /* ───── Catmull-Rom 插值 ───── */
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return {
      x: f(p0.x, p1.x, p2.x, p3.x),
      y: f(p0.y, p1.y, p2.y, p3.y),
      p: f(p0.p, p1.p, p2.p, p3.p)
    };
  }

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  /* 压感低通，避免抖 */
  function smoothPressure(pts) {
    const n = pts.length;
    if (n < 3) return pts;
    const out = new Array(n);
    out[0] = pts[0];
    out[n - 1] = pts[n - 1];
    for (let i = 1; i < n - 1; i++) {
      out[i] = { x: pts[i].x, y: pts[i].y, p: (pts[i - 1].p + pts[i].p * 2 + pts[i + 1].p) / 4 };
    }
    return out;
  }

  /* 原始点 → 密集平滑点 */
  function densify(raw, step) {
    step = step || SAMPLE_STEP;
    const pts = densifyRaw(raw, step);
    return relax(pts);
  }

  /* 轻量松弛：让笔画拐角更圆润，手感更"墨" */
  function relax(pts) {
    const n = pts.length;
    if (n < 4) return pts;
    const out = new Array(n);
    out[0] = pts[0];
    out[n - 1] = pts[n - 1];
    for (let i = 1; i < n - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      out[i] = {
        x: a.x * 0.2 + b.x * 0.6 + c.x * 0.2,
        y: a.y * 0.2 + b.y * 0.6 + c.y * 0.2,
        p: a.p * 0.2 + b.p * 0.6 + c.p * 0.2
      };
    }
    return out;
  }

  function densifyRaw(raw, step) {
    step = step || SAMPLE_STEP;
    const n = raw.length;
    if (n === 0) return [];
    if (n === 1) return [{ x: raw[0].x, y: raw[0].y, p: raw[0].p }];
    if (n === 2) {
      const a = raw[0], b = raw[1];
      const d = dist(a, b);
      const k = Math.max(1, Math.ceil(d / step));
      const out = [];
      for (let i = 0; i <= k; i++) {
        const t = i / k;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });
      }
      return out;
    }
    const P = [raw[0], raw[0]];
    for (let i = 0; i < n; i++) P.push(raw[i]);
    P.push(raw[n - 1], raw[n - 1]);

    const out = [];
    let budget = MAX_POINTS;
    for (let i = 2; i < P.length - 2; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      const d = dist(p1, p2);
      const segs = Math.max(1, Math.min(120, Math.ceil(d / step)));
      for (let j = 0; j < segs && budget > 0; j++, budget--) {
        out.push(cr(p0, p1, p2, p3, j / segs));
      }
      if (budget <= 0) break;
    }
    out.push({ x: raw[n - 1].x, y: raw[n - 1].y, p: raw[n - 1].p });
    return out;
  }

  /* ───── 宽度函数 ───── */
  function widthFactor(kind, p) {
    switch (kind) {
      case 'ball': return 1;
      case 'marker': return 1;
      case 'pencil': return 0.62 + 0.55 * p;
      case 'fountain':
      default: return 0.30 + 0.70 * Math.pow(p, 0.8);
    }
  }

  function taperFactor(kind, i, n, headOn, tailOn) {
    if (kind === 'ball' || kind === 'marker') return 1;
    // 分片绘制时，只有整笔的第一片要收笔头、最后一片要收笔尾，
    // 否则每 46 点切一次就会每片都收一次，整条线变成周期性的"香肠"
    const head = headOn === false ? 1 : Math.min(1, (i + 1) / 5);
    const tail = tailOn === false ? 1 : Math.min(1, (n - i) / 4);
    const t = Math.min(head, tail);
    return 0.45 + 0.55 * (t < 0 ? 0 : t);
  }

  /* ───── 变宽 ribbon 填充 ───── */
  function fillRibbon(ctx, pts, size, kind, fixedAlpha, opt) {
    const n = pts.length;
    if (n === 0) return;
    const taperHead = !(opt && opt.head === false);
    const taperTail = !(opt && opt.tail === false);
    const halfBase = size * 0.5;

    if (n === 1) {
      const w = Math.max(0.45, halfBase * widthFactor(kind, pts[0].p));
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, w, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // 等宽笔（圆珠笔 / 荧光笔 / 橡皮）走描边路径：
    // 圆头圆角一次成型，不会在半透明时冒出端点叠色的圆斑
    if (kind === 'ball' || kind === 'marker' || kind === 'eraser') {
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.9, size);
      // 描边路径必须显式给颜色：调用方可能只设了 fillStyle，
      // 少了这一行圆珠笔会退回 canvas 默认的黑色
      if (!ctx.strokeStyle || ctx.strokeStyle === '#000000') ctx.strokeStyle = opt && opt.color ? opt.color : ctx.fillStyle;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) * 0.5;
        const my = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
      ctx.stroke();
      return;
    }

    const L = new Array(n), R = new Array(n), W = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      let w = halfBase * widthFactor(kind, p.p) * taperFactor(kind, i, n, taperHead, taperTail);
      w = Math.max(0.42, w);
      W[i] = w;
      let ax, ay;
      if (i === 0) { ax = pts[1].x - p.x; ay = pts[1].y - p.y; }
      else if (i === n - 1) { ax = p.x - pts[n - 2].x; ay = p.y - pts[n - 2].y; }
      else { ax = pts[i + 1].x - pts[i - 1].x; ay = pts[i + 1].y - pts[i - 1].y; }
      const len = Math.hypot(ax, ay) || 1;
      const nx = -ay / len, ny = ax / len;
      L[i] = { x: p.x + nx * w, y: p.y + ny * w };
      R[i] = { x: p.x - nx * w, y: p.y - ny * w };
    }

    ctx.beginPath();
    ctx.moveTo(L[0].x, L[0].y);
    for (let i = 1; i < n - 1; i++) {
      const mx = (L[i].x + L[i + 1].x) * 0.5, my = (L[i].y + L[i + 1].y) * 0.5;
      ctx.quadraticCurveTo(L[i].x, L[i].y, mx, my);
    }
    ctx.lineTo(L[n - 1].x, L[n - 1].y);

    for (let i = n - 1; i > 0; i--) {
      const mx = (R[i].x + R[i - 1].x) * 0.5, my = (R[i].y + R[i - 1].y) * 0.5;
      if (i === n - 1) ctx.lineTo(mx, my);
      else ctx.quadraticCurveTo(R[i].x, R[i].y, mx, my);
    }
    ctx.lineTo(R[0].x, R[0].y);
    ctx.closePath();
    ctx.fill();

    // 两端圆帽
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, W[0], 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pts[n - 1].x, pts[n - 1].y, W[n - 1], 0, Math.PI * 2);
    ctx.fill();
  }

  /* 形状绘制 */
  function drawShape(ctx, s) {
    const a = s.pts[0], b = s.pts[s.pts.length - 1];
    if (!a || !b) return;
    let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
    const lw = s.size;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    switch (s.shape) {
      case 'line':
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        break;
      case 'arrow': {
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const hl = Math.max(9, lw * 3.4);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - hl * Math.cos(ang - 0.42), y1 - hl * Math.sin(ang - 0.42));
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - hl * Math.cos(ang + 0.42), y1 - hl * Math.sin(ang + 0.42));
        ctx.stroke();
        break;
      }
      case 'rect': {
        const x = Math.min(x0, x1), y = Math.min(y0, y1);
        const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        const r = Math.min(lw * 2, w / 2, h / 2);
        roundRect(ctx, x, y, w, h, r);
        ctx.stroke();
        break;
      }
      case 'ellipse': {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        ctx.ellipse(cx, cy, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      default:
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ───── 形状识别（perfect shape）───── */
  /* 用 RDP 抽稀折点：eps 越大越激进 */
  function rdpSimplify(pts, eps) {
    const n = pts.length;
    if (n < 3) return pts.slice();
    const a = pts[0], b = pts[n - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let idx = -1, maxD = eps;
    for (let i = 1; i < n - 1; i++) {
      const t = ((pts[i].x - a.x) * dx + (pts[i].y - a.y) * dy) / len2;
      const qx = a.x + dx * t, qy = a.y + dy * t;
      const d = Math.hypot(pts[i].x - qx, pts[i].y - qy);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx < 0) return [a, b];
    const left = rdpSimplify(pts.slice(0, idx + 1), eps);
    const right = rdpSimplify(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }

  function polygonArea(pts) {
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return s / 2;
  }

  /* 保守识别：只在置信度高时返回 { shape, pts }，否则 null。
     判定顺序：直线 → 矩形 → 椭圆。 */
  function recognizeShape(s) {
    const pts = s.pts;
    const n = pts.length;
    if (n < 3) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    const w = x1 - x0, h = y1 - y0;
    const diag = Math.hypot(w, h);
    if (diag < 22) return null;
    const a = pts[0], b = pts[n - 1];
    const startEnd = Math.hypot(b.x - a.x, b.y - a.y);
    let path = 0;
    for (let i = 1; i < n; i++) path += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));

    // ── 直线：长宽比大、首尾跨度接近对角线、路径不绕弯、偏离弦线小 ──
    if (aspect > 4 && startEnd / diag > 0.8 && path / diag < 1.5 && diag >= 35) {
      const dx = b.x - a.x, dy = b.y - a.y, len2 = startEnd * startEnd || 1;
      let maxDev = 0;
      for (let i = 0; i < n; i++) {
        const t = ((pts[i].x - a.x) * dx + (pts[i].y - a.y) * dy) / len2;
        const qx = a.x + dx * t, qy = a.y + dy * t;
        const d = Math.hypot(pts[i].x - qx, pts[i].y - qy);
        if (d > maxDev) maxDev = d;
      }
      if (maxDev / diag < 0.09) {
        return { shape: 'line', pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] };
      }
    }

    // ── 矩形：近似闭合 + RDP 抽到 4 个拐角 + 拐角对齐包围盒四角 ──
    if (diag >= 30 && startEnd / diag < 0.3) {
      const poly = rdpSimplify(pts, Math.max(5, diag * 0.045));
      const P = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        if (!P.length || Math.hypot(p.x - P[P.length - 1].x, p.y - P[P.length - 1].y) > Math.max(5, diag * 0.03)) P.push(p);
      }
      if (P.length >= 2 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < Math.max(6, diag * 0.05)) P.pop();
      if (P.length === 4) {
        const tol = diag * 0.15;
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        let ok = true;
        for (let c = 0; c < 4 && ok; c++) {
          let best = Infinity;
          for (let p = 0; p < P.length; p++) best = Math.min(best, Math.hypot(P[p].x - corners[c][0], P[p].y - corners[c][1]));
          if (best > tol) ok = false;
        }
        if (ok) return { shape: 'rect', pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }] };
      }
    }

    // ── 椭圆：近似闭合、绕了一圈、包围盒填充率接近 π/4、长宽比不极端 ──
    if (n >= 8 && diag >= 24 && startEnd / diag < 0.25 && aspect < 4 && path / diag >= 1.8) {
      const fill = Math.abs(polygonArea(pts)) / (w * h);
      if (fill > 0.58 && fill < 0.90) {
        return { shape: 'ellipse', pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }] };
      }
    }

    return null;
  }

  /* ───── 单笔绘制（完整） ───── */
  /* 形状的外形折线：包围盒与命中都按真实轮廓算，不能只算两个定义点 */
  function shapeOutline(s) {
    const a = s.pts[0], b = s.pts[s.pts.length - 1];
    if (!a || !b) return [];
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const out = [];
    if (s.shape === 'rect') {
      out.push({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 });
    } else if (s.shape === 'ellipse') {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
      for (let i = 0; i <= 48; i++) {
        const t = i / 48 * Math.PI * 2;
        out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
      }
    } else {
      out.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    }
    return out;
  }

  function drawStroke(ctx, s) {
    // 胶带被点按「揭开」后不绘制，露出下方内容；再点一次恢复绘制
    if (s.tool === 'tape' && s.hidden) return;
    if (s.tool === 'shape') {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color;
      ctx.strokeStyle = s.color;
      drawShape(ctx, s);
      ctx.restore();
      return;
    }
    const pts = s._sm || (s._sm = densify(smoothPressure(s.pts), SAMPLE_STEP));
    if (!pts.length) return;
    ctx.save();
    if (s.tool === 'tape') {
      // 胶带：不透明遮挡条，颜色取纸底色，等宽圆角一笔成型
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.color;
      ctx.strokeStyle = s.color;
      fillRibbon(ctx, pts, s.size, 'ball', 1);
      ctx.restore();
      return;
    }
    if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#000';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = s.tool === 'marker' ? 0.34 : (s.tool === 'pencil' ? 0.86 : 1);
      ctx.fillStyle = s.color;
      ctx.strokeStyle = s.color;
    }

    {
      const kind = s.tool === 'eraser' ? 'ball' : (s.kind || 'fountain');
      if (s.tool === 'marker') {
        ctx.fillStyle = s.color;
        fillRibbon(ctx, pts, s.size, 'marker', 1);
      } else {
        fillRibbon(ctx, pts, s.size, kind, 1);
      }
    }
    ctx.restore();
  }

  /* ───── 全部绘制 ───── */
  function drawAll(ctx, strokes) {
    for (let i = 0; i < strokes.length; i++) drawStroke(ctx, strokes[i]);
  }

  /* ───── 逐段渐进绘制（实时书写优化） ───── */
  function drawPartial(ctx, s, from, to) {
    const sm = s._sm || (s._sm = densify(smoothPressure(s.pts), SAMPLE_STEP));
    if (!sm.length) return;
    const a = Math.max(0, from), b = Math.min(sm.length, to);
    if (b - a < 1) return;
    const slice = sm.slice(a, b);

    // 颜色和透明度在这里统一兜住，避免调用方漏设导致变黑/变淡
    const color = s.tool === 'eraser' ? '#000' : s.color;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    if (slice.length === 1) {
      const w = Math.max(0.45, s.size * 0.5);
      ctx.beginPath();
      ctx.arc(slice[0].x, slice[0].y, w, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const kind = s.tool === 'eraser' ? 'ball' : (s.kind || 'fountain');
    fillRibbon(ctx, slice, s.size, kind, 1, {
      head: a === 0,
      tail: b >= sm.length,
      color: color
    });
  }

  /* ───── 采样过滤 ───── */
  function addPoint(stroke, pt) {
    const pts = stroke.pts;
    const last = pts[pts.length - 1];
    if (last) {
      const d = Math.hypot(pt.x - last.x, pt.y - last.y);
      if (d < MIN_RAW_STEP) return false;
    }
    pts.push(pt);
    return true;
  }

  /* ───── 包围盒 ───── */
  function bboxOf(strokes, pad) {
    pad = pad || 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) {
      const pts = (s.tool === 'shape') ? shapeOutline(s)
        : (s._sm && s._sm.length ? s._sm : s.pts);
      if (!pts || !pts.length) continue;
      const hw = (s.size || 0) * 0.5;
      for (const p of pts) {
        if (p.x - hw < x0) x0 = p.x - hw;
        if (p.y - hw < y0) y0 = p.y - hw;
        if (p.x + hw > x1) x1 = p.x + hw;
        if (p.y + hw > y1) y1 = p.y + hw;
      }
    }
    if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2 };
  }

  /* 点是否在多边形内 */
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x1 + t * dx, qy = y1 + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  /* 笔画是否与点/圆相交（整笔橡皮用） */
  function strokeHit(s, x, y, tol) {
    const pts = (s.tool === 'shape') ? shapeOutline(s)
      : (s._sm && s._sm.length ? s._sm : s.pts);
    if (!pts || !pts.length) return false;
    const r = (s.size * 0.5) + (tol || 0);
    if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= r;
    for (let i = 1; i < pts.length; i++) {
      if (segDist(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= r) return true;
    }
    return false;
  }

  /* 笔画是否落在套索多边形内 */
  function strokeInPoly(s, poly) {
    const pts = (s.tool === 'shape') ? shapeOutline(s)
      : (s._sm && s._sm.length ? s._sm : s.pts);
    if (!pts || !pts.length) return false;
    let inside = 0;
    for (const p of pts) {
      if (pointInPoly(p.x, p.y, poly)) inside++;
    }
    // 门槛从 62% 放到 35%：框住大半条线就能选中，
    // 端点露在框外一点不该直接判失败
    if (inside / pts.length > 0.35) return true;
    // 细笔迹点数少时，全在框内也算（否则 2 个点只进 1 个就 50% 失败）
    return inside > 0 && inside === pts.length;
  }

  /* 笔画是否落在矩形套索内 */
  function strokeInRect(s, r) {
    const pts = (s.tool === 'shape') ? shapeOutline(s)
      : (s._sm && s._sm.length ? s._sm : s.pts);
    if (!pts || !pts.length) return false;
    let inside = 0;
    for (const p of pts) {
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) inside++;
    }
    if (inside / pts.length > 0.35) return true;
    return inside > 0 && inside === pts.length;
  }

  A.Ink = {
    densify, smoothPressure, drawStroke, drawAll, drawPartial,
    addPoint, bboxOf, strokeHit, strokeInPoly, strokeInRect, pointInPoly, fillRibbon, drawShape, shapeOutline,
    recognizeShape, rdpSimplify, polygonArea,
    SAMPLE_STEP
  };
})(window.MY);
