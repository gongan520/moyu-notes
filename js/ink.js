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

  function taperFactor(kind, i, n) {
    if (kind === 'ball' || kind === 'marker') return 1;
    const head = Math.min(1, (i + 1) / 5);
    const tail = Math.min(1, (n - i) / 4);
    const t = Math.min(head, tail);
    return 0.45 + 0.55 * (t < 0 ? 0 : t);
  }

  /* ───── 变宽 ribbon 填充 ───── */
  function fillRibbon(ctx, pts, size, kind, fixedAlpha) {
    const n = pts.length;
    if (n === 0) return;
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
      let w = halfBase * widthFactor(kind, p.p) * taperFactor(kind, i, n);
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

  /* ───── 单笔绘制（完整） ───── */
  function drawStroke(ctx, s) {
    const pts = s._sm || (s._sm = densify(smoothPressure(s.pts), SAMPLE_STEP));
    if (!pts.length) return;
    ctx.save();
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

    if (s.tool === 'shape') {
      drawShape(ctx, s);
    } else {
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
    if (slice.length === 1) {
      const w = Math.max(0.45, s.size * 0.5);
      ctx.beginPath();
      ctx.arc(slice[0].x, slice[0].y, w, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const kind = s.tool === 'eraser' ? 'ball' : (s.kind || 'fountain');
    fillRibbon(ctx, slice, s.size, kind, 1);
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
      const pts = s._sm && s._sm.length ? s._sm : s.pts;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      const hw = s.size * 0.5 + 1;
      x0 -= 0; // 已含点坐标，统一在末尾加 pad+宽度
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
    const pts = s._sm && s._sm.length ? s._sm : s.pts;
    const r = (s.size * 0.5) + (tol || 0);
    if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= r;
    for (let i = 1; i < pts.length; i++) {
      if (segDist(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= r) return true;
    }
    return false;
  }

  /* 笔画是否落在套索多边形内 */
  function strokeInPoly(s, poly) {
    const pts = s._sm && s._sm.length ? s._sm : s.pts;
    let inside = 0;
    for (const p of pts) {
      if (pointInPoly(p.x, p.y, poly)) inside++;
    }
    return pts.length ? (inside / pts.length) > 0.62 : false;
  }

  A.Ink = {
    densify, smoothPressure, drawStroke, drawAll, drawPartial,
    addPoint, bboxOf, strokeHit, strokeInPoly, pointInPoly, fillRibbon, drawShape,
    SAMPLE_STEP
  };
})(window.MY);
