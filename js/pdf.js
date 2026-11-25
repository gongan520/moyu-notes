/* ══════════════════════════════════════════════════════════
   pdf.js — 轻量 PDF 生成器（无依赖）
   每页把 canvas 编码为 JPEG，再按 PDF 规范拼装
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  function strBytes(s) {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const n = bin.length;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /**
   * @param {Array<{jpeg:Uint8Array,b64?:string,w:number,h:number,ptW:number,ptH:number}>} pages
   * @returns {Blob}
   */
  function build(pages) {
    const parts = [];
    let pos = 0;
    const offsets = [];
    let objNo = 0;

    function put(data) {
      const u = typeof data === 'string' ? strBytes(data) : data;
      parts.push(u);
      pos += u.length;
    }
    function beginObj() {
      objNo++;
      offsets[objNo] = pos;
      put(objNo + ' 0 obj\n');
    }
    function endObj() { put('\nendobj\n'); }

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const n = pages.length;
    const pageObjNums = [];
    for (let i = 0; i < n; i++) pageObjNums.push(3 + i * 3);

    // 1 — Catalog
    beginObj();
    put('<< /Type /Catalog /Pages 2 0 R >>');
    endObj();

    // 2 — Pages
    beginObj();
    put('<< /Type /Pages /Count ' + n + ' /Kids [' + pageObjNums.map(o => o + ' 0 R').join(' ') + '] >>');
    endObj();

    // 每页三对象
    for (let i = 0; i < n; i++) {
      const p = pages[i];
      const pageNo = 3 + i * 3;
      const contentNo = pageNo + 1;
      const imgNo = pageNo + 2;
      const ptW = p.ptW || (p.w * 0.75);
      const ptH = p.ptH || (p.h * 0.75);

      // Page
      beginObj();
      put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptW.toFixed(2) + ' ' + ptH.toFixed(2) + ']' +
        ' /Resources << /XObject << /Im0 ' + imgNo + ' 0 R >> /ProcSet [/PDF /ImageC] >>' +
        ' /Contents ' + contentNo + ' 0 R >>');
      endObj();

      // Contents
      const content = 'q\n' + ptW.toFixed(2) + ' 0 0 ' + ptH.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';
      beginObj();
      put('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
      endObj();

      // Image
      const bytes = p.jpeg || b64ToBytes(p.b64);
      beginObj();
      put('<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bytes.length + ' >>\nstream\n');
      put(bytes);
      put('\nendstream');
      endObj();
    }

    // xref
    const xrefPos = pos;
    let xref = 'xref\n0 ' + (objNo + 1) + '\n';
    xref += '0000000000 65535 f\r\n';
    for (let i = 1; i <= objNo; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n\r\n';
    }
    put(xref);
    put('trailer\n<< /Size ' + (objNo + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF');

    return new Blob(parts, { type: 'application/pdf' });
  }

  /**
   * 从 canvas 数组直接生成 PDF
   * @param {HTMLCanvasElement[]} canvases
   * @param {number} quality 0~1
   */
  function fromCanvases(canvases, quality) {
    quality = quality || 0.9;
    const pages = canvases.map(cv => {
      const dataUrl = cv.toDataURL('image/jpeg', quality);
      const b64 = dataUrl.split(',')[1];
      return {
        b64: b64,
        w: cv.width,
        h: cv.height,
        ptW: cv.width * 0.75,
        ptH: cv.height * 0.75
      };
    });
    return build(pages);
  }

  A.PDF = { build, fromCanvases, b64ToBytes };
})(window.MY);
