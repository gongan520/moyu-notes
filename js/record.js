/* ══════════════════════════════════════════════════════════
   record.js — 录音 + 笔迹时间轴同步（Notability 的招牌）
   录课时每写一笔都记下相对时间戳，回放时笔迹按录音进度重现
   ══════════════════════════════════════════════════════════ */
(function (A) {
  'use strict';

  const R = {
    rec: null,          // MediaRecorder
    stream: null,
    chunks: [],
    startedAt: 0,
    elapsed: 0,
    timer: 0,
    audio: null,        // HTMLAudioElement
    playing: false,
    pageId: null,
    supported: !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  };

  /* ───────────── 计时 ───────────── */
  function tick() {
    R.elapsed = Date.now() - R.startedAt;
    if (R.onTick) R.onTick(R.elapsed);
  }

  /* 当前录音进度（毫秒）；没在录时返回 0，用于给笔画打时间戳 */
  function stamp() {
    return R.rec && R.rec.state === 'recording' ? (Date.now() - R.startedAt) : 0;
  }

  function isRecording() {
    return !!(R.rec && R.rec.state === 'recording');
  }

  async function start(page) {
    if (!R.supported) {
      A.toast('这个环境不支持录音（需要麦克风权限）', 3200);
      return false;
    }
    if (isRecording()) return true;
    try {
      R.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
      });
    } catch (e) {
      A.toast('麦克风权限被拒绝，请在系统设置里允许', 3600);
      return false;
    }

    let mime = '';
    const cands = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac'];
    for (const m of cands) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m)) { mime = m; break; }
    }
    try {
      R.rec = new MediaRecorder(R.stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    } catch (e) {
      A.toast('录音初始化失败：' + e.message, 3600);
      R.stream.getTracks().forEach(t => t.stop());
      return false;
    }

    R.chunks = [];
    R.pageId = page ? page.id : null;
    R.rec.ondataavailable = (e) => { if (e.data && e.data.size) R.chunks.push(e.data); };
    R.rec.start(1000);
    R.startedAt = Date.now();
    R.elapsed = 0;
    clearInterval(R.timer);
    R.timer = setInterval(tick, 200);
    if (R.onState) R.onState('recording');
    if (A.haptic) A.haptic(8);
    return true;
  }

  /* 停止并返回 { key, dur }，音频写进 assets */
  function stop(bookId, pageId) {
    return new Promise((resolve) => {
      if (!R.rec || R.rec.state === 'inactive') { resolve(null); return; }
      const dur = Date.now() - R.startedAt;
      R.rec.onstop = async () => {
        const type = R.rec.mimeType || 'audio/mp4';
        const blob = new Blob(R.chunks, { type: type });
        const key = 'rec_' + bookId + '_' + (pageId || R.pageId) + '_' + Date.now();
        const b64 = await blobToDataURL(blob);
        try { await A.db.putAsset(key, b64); } catch (e) { }
        cleanup();
        resolve({ key, dur: dur, mime: type, size: blob.size });
      };
      try { R.rec.stop(); } catch (e) { cleanup(); resolve(null); }
    });
  }

  function cleanup() {
    clearInterval(R.timer);
    R.timer = 0;
    if (R.stream) R.stream.getTracks().forEach(t => t.stop());
    R.stream = null;
    R.rec = null;
    if (R.onState) R.onState('idle');
  }

  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }

  /* ───────────── 播放 ───────────── */
  async function load(key) {
    if (!key) return null;
    if (R.audio && R.audio.dataset.key === key) return R.audio;
    const data = await A.db.getAsset(key);
    if (!data) return null;
    const ad = new Audio();
    ad.dataset.key = key;
    ad.src = data;
    ad.preload = 'auto';
    R.audio = ad;
    return ad;
  }

  function play(key, from, onTime, onEnd) {
    return load(key).then((ad) => {
      if (!ad) { A.toast('录音数据缺失'); return null; }
      try { ad.currentTime = Math.max(0, (from || 0) / 1000); } catch (e) { }
      ad.ontimeupdate = () => { if (onTime) onTime(ad.currentTime * 1000, ad.duration * 1000); };
      ad.onended = () => { R.playing = false; if (onEnd) onEnd(); };
      ad.play().then(() => { R.playing = true; }).catch(() => {
        A.toast('播放失败，请再点一次');
      });
      return ad;
    });
  }

  function pause() {
    if (R.audio) {
      try { R.audio.pause(); } catch (e) { }
      // 必须解绑，否则停掉以后 ontimeupdate 还在把旧的 playT 往回写
      R.audio.ontimeupdate = null;
      R.audio.onended = null;
    }
    R.playing = false;
  }

  function stopPlay() {
    if (R.audio) {
      try { R.audio.pause(); R.audio.currentTime = 0; } catch (e) { }
      R.audio.onended = null;
      R.audio.ontimeupdate = null;
    }
    R.playing = false;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  A.Record = {
    start, stop, stamp, isRecording, play, pause, stopPlay, load, fmt,
    get elapsed() { return R.elapsed; },
    get playing() { return R.playing; },
    get supported() { return R.supported; },
    set onTick(fn) { R.onTick = fn; },
    set onState(fn) { R.onState = fn; }
  };
})(window.MY);
