/* ============================================================================
 * props.js · 牌桌互动道具（2026-10-05）
 * ----------------------------------------------------------------------------
 * 交互：点对手头像/座位 → 底部弹出道具条 → 选一个 → 道具从自己头像飞过去砸中
 *       对方 → 冲击波 + 粒子 + 目标抖动 + 音效，同时广播给全桌（服务端 /papi/table/prop）
 *
 * 设计约束：
 *   1) 纯视觉/音效，**完全不涉及资金**（不扣钱、不消耗、不入背包）。
 *   2) 素材优先走真实文件：assets/props/<key>.gif（命中动图）与 assets/props/<key>.mp3（音效）。
 *      文件不存在时自动回退到本文件内置的 SVG 图标 + WebAudio 合成音效，
 *      所以以后只要把素材包丢进 assets/props/ 就会自动升级，不用改代码。
 *   3) 音效遵守全站声音总开关（localStorage 'gu9_sound'）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var LIST = [
    {
      key: 'bomb', color: '#ff8a3d',
      nm: { c: '炸弹', t: '炸彈', e: 'Bomb' }, ds: { c: '轰一下', t: '轟一下', e: 'Boom!' },
      svg: '<svg viewBox="0 0 32 32" width="100%" height="100%">' +
        '<circle cx="15" cy="21" r="9.5" fill="#2b3440" stroke="#0d1117" stroke-width="1.2"/>' +
        '<rect x="13.5" y="9.5" width="4" height="4" rx="1.2" fill="#6b7280"/>' +
        '<path d="M17.5 9.5c1.8-2.1 4.8-1.6 6.2.6" stroke="#c9893a" stroke-width="1.7" fill="none" stroke-linecap="round"/>' +
        '<circle cx="25" cy="7.5" r="3.4" fill="#ffb020"/><circle cx="25" cy="7.5" r="1.6" fill="#fff4cd"/>' +
        '<circle cx="11" cy="18" r="1.7" fill="#5b6673"/></svg>'
    },
    {
      key: 'egg', color: '#9fd356',
      nm: { c: '臭鸡蛋', t: '臭雞蛋', e: 'Rotten Egg' }, ds: { c: '啪唧糊上去', t: '啪唧糊上去', e: 'Splat!' },
      svg: '<svg viewBox="0 0 32 32" width="100%" height="100%">' +
        '<ellipse cx="15" cy="20" rx="9" ry="11" fill="#f6ecd8" stroke="#c8b89a" stroke-width="1.2"/>' +
        '<path d="M11 15l3.4 2.6-2.2 3.2 4.4 1.2" stroke="#c0ab88" stroke-width="1.4" fill="none" stroke-linejoin="round"/>' +
        '<path d="M14 8c-.4-2 1.4-3.4 3-3M19 9.4c1.6-1 2.4-2.6 1.6-4" stroke="#8fbf6a" stroke-width="1.7" fill="none" stroke-linecap="round"/>' +
        '<circle cx="23" cy="4.4" r="1.6" fill="#8fbf6a" opacity=".85"/>' +
        '<circle cx="12" cy="24" r="1.5" fill="#e2d3b4"/></svg>'
    },
    {
      key: 'chicken', color: '#ffd166',
      nm: { c: '捏鸡脖子', t: '捏雞脖子', e: 'Chicken' }, ds: { c: '一顿惨叫', t: '一頓慘叫', e: 'Squawk!' },
      svg: '<svg viewBox="0 0 32 32" width="100%" height="100%">' +
        '<ellipse cx="16" cy="21" rx="10" ry="8.5" fill="#f0c26a" stroke="#b98d34" stroke-width="1.2"/>' +
        '<circle cx="21" cy="11" r="6" fill="#f7d489" stroke="#b98d34" stroke-width="1.2"/>' +
        '<path d="M20 3.6c1.2-1.4 3-1.2 3.6.4.7 1.6-.6 2.8-1.8 2.4" fill="#e2483c"/>' +
        '<path d="M26.6 11.6l4 1.6-4 1.6z" fill="#f08a24"/>' +
        '<circle cx="22.4" cy="10" r="1.5" fill="#2b2118"/>' +
        '<path d="M9 22c-2-1.6-2-4 .4-5" stroke="#b98d34" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>'
    },
    {
      key: 'shoe', color: '#9fb3c8',
      nm: { c: '飞鞋子', t: '飛鞋子', e: 'Shoe' }, ds: { c: '啪的一声拍脸', t: '啪的一聲拍臉', e: 'Whack!' },
      svg: '<svg viewBox="0 0 32 32" width="100%" height="100%">' +
        '<path d="M3.5 12.5c0-2.6 1.7-4 4-4h6.5l6.5 3.4c3.4 1.8 5.5 3.6 5.5 6v4.6H3.5z" fill="#41546a" stroke="#1b2430" stroke-width="1.2"/>' +
        '<path d="M3 22.5h25.5v3.4H3z" fill="#e6d6a4" stroke="#a8945f" stroke-width="1"/>' +
        '<path d="M12 12.6l4.6 3.2M16.4 10.4l4 3" stroke="#cfdae6" stroke-width="1.5" stroke-linecap="round"/>' +
        '<circle cx="24" cy="18.5" r="1.6" fill="#cfdae6" opacity=".8"/></svg>'
    },
    {
      key: 'cake', color: '#ffb0c0',
      nm: { c: '蛋糕砸脸', t: '蛋糕砸臉', e: 'Cake' }, ds: { c: '奶油糊一脸', t: '奶油糊一臉', e: 'Smoosh!' },
      svg: '<svg viewBox="0 0 32 32" width="100%" height="100%">' +
        '<rect x="5.5" y="16" width="21" height="12" rx="2" fill="#c9704b" stroke="#8e4526" stroke-width="1.2"/>' +
        '<path d="M5.5 16c0-2.2 1.8-3 2.8-1.2.9-2 2.9-2 3.8 0 .9-2 2.9-2 3.8 0 1-2 2.9-1.2 2.9.8z" fill="#fff3e0"/>' +
        '<rect x="15" y="7.5" width="2.2" height="6.5" rx="1" fill="#f2e2b8"/>' +
        '<circle cx="16.1" cy="5.6" r="2.4" fill="#ffb020"/><circle cx="16.1" cy="5.6" r="1.1" fill="#fff4cd"/>' +
        '<circle cx="11" cy="23" r="1.3" fill="#fff3e0"/><circle cx="21" cy="23" r="1.3" fill="#fff3e0"/></svg>'
    },
    {
      key: 'tomato', color: '#ff5a4a',
      nm: { c: '番茄', t: '番茄', e: 'Tomato' }, ds: { c: '汁水四溅', t: '汁水四濺', e: 'Squish!' },
      svg: '<svg viewBox="0 0 32 32" width="100%" height="100%">' +
        '<circle cx="16" cy="19.5" r="9.5" fill="#e23b32" stroke="#a52219" stroke-width="1.2"/>' +
        '<path d="M16 10c-3.2 0-5.2-1.6-5.2-3.2 2.1 0 4 .6 5.2 1.7 1.2-1.1 3.1-1.7 5.2-1.7 0 1.6-2 3.2-5.2 3.2z" fill="#3f9b52"/>' +
        '<rect x="15.2" y="6.4" width="1.6" height="3.6" rx=".8" fill="#2f7a41"/>' +
        '<ellipse cx="12" cy="16" rx="2.2" ry="1.5" fill="#ff9182" opacity=".85" transform="rotate(-25 12 16)"/>' +
        '<circle cx="24" cy="27" r="1.8" fill="#e23b32" opacity=".9"/><circle cx="27.5" cy="24" r="1.2" fill="#e23b32" opacity=".8"/></svg>'
    }
  ];

  var MAP = {};
  LIST.forEach(function (p) { MAP[p.key] = p; });
  function find(k) { return MAP[k] || null; }

  /* ---------- 三语：zh-CN 简体 / zh-TW·HK·MO 繁体 / 其它 英文 ---------- */
  function langTag() {
    var l = '';
    try {
      l = (global.I18N && typeof global.I18N.get === 'function' && global.I18N.get()) ||
        global.localStorage.getItem('gu9.lang') || 'zh-CN';
    } catch (e) { l = 'zh-CN'; }
    if (!/^zh/i.test(l)) return 'e';
    if (/^(zh-tw|zh-hk|zh-mo|zh-hant)/i.test(l)) return 't';
    return 'c';
  }
  function nm(p) { var k = langTag(); return (p.nm && p.nm[k]) || p.nm.c; }
  function ds(p) { var k = langTag(); return (p.ds && p.ds[k]) || p.ds.c; }
  /* 服务端下发的固定文案跟着语言走 */
  var MSG = {
    c: { to: '扔给 ', fast: '扔得太快了，歇一下', err: '道具发送失败', item: '道具', self: '不能给自己扔道具', seated: '买入入座后才能扔道具' },
    t: { to: '扔給 ', fast: '扔得太快了，歇一下', err: '道具發送失敗', item: '道具', self: '不能給自己扔道具', seated: '買入入座後才能扔道具' },
    e: { to: 'Throw at ', fast: 'Too fast — take it easy', err: 'Failed to send', item: 'a prop', self: "You can't throw at yourself", seated: 'Buy in and take a seat first' }
  };
  function msg() { return MSG[langTag()] || MSG.c; }
  /* 「A 向 B 扔了 炸弹」三语组装（英文语序不同：A threw Bomb at B） */
  function toastText(fromName, toName, key) {
    var p = find(key), k = langTag(), m = MSG[k] || MSG.c;
    var n = p ? nm(p) : m.item;
    if (k === 'e') return (fromName || 'Someone') + ' threw ' + n + ' at ' + (toName || 'someone');
    return (fromName || '有人') + ' 向 ' + (toName || '对手') + ' 扔了 ' + n;
  }

  /* ---------- 素材探测：有真实 gif / mp3 就用真实的，没有就用内置 ----------
     ★ 只用异步 HEAD 预热一次（页面加载时），icon()/sfx() 只读缓存，
       绝不在渲染路径上跑同步 XHR（会卡主线程、浏览器已废弃）。 */
  var ASSET = 'assets/props/';
  var probe = {};   /* url -> true(可用) / false(不可用) */
  function has(url) { return probe[url] === true; }

  var probing = null;
  function probeAll() {
    if (probing) return probing;
    var urls = [];
    LIST.forEach(function (p) { urls.push(ASSET + p.key + '.gif'); urls.push(ASSET + p.key + '.mp3'); });
    probing = new Promise(function (done) {
      var left = urls.length;
      function fin(u, ok) { probe[u] = ok; if (--left <= 0) done(); }
      urls.forEach(function (u) {
        var x = null;
        try { x = new XMLHttpRequest(); } catch (e) { fin(u, false); return; }
        x.open('HEAD', u, true);
        x.onload = function () { fin(u, x.status >= 200 && x.status < 400); };
        x.onerror = function () { fin(u, false); };
        try { x.send(); } catch (e) { fin(u, false); }
      });
    });
    return probing;
  }

  function icon(key, size) {
    var p = find(key); if (!p) return '';
    var s = size || 40;
    var gif = ASSET + key + '.gif';
    if (has(gif)) {
      return '<img src="' + gif + '" alt="' + p.name + '" style="width:' + s + 'px;height:' + s + 'px;object-fit:contain;display:block">';
    }
    return '<span style="display:block;width:' + s + 'px;height:' + s + 'px">' + p.svg + '</span>';
  }

  /* ---------- 音效：优先真实 mp3，否则 WebAudio 合成 ---------- */
  var AC = null;
  function ac() {
    if (!AC) {
      try { AC = new (global.AudioContext || global.webkitAudioContext)(); } catch (e) { AC = null; }
    }
    if (AC && AC.state === 'suspended') { try { AC.resume(); } catch (e) { } }
    return AC;
  }
  function soundOn() {
    try { return global.localStorage.getItem('gu9_sound') !== '0'; } catch (e) { return true; }
  }
  function noiseBuf(c, dur) {
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var b = c.createBuffer(1, len, c.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  /* 噪声 + 滤波 + 包络，一句话造一个音效 */
  function hit_(c, t0, o) {
    var src = c.createBufferSource(); src.buffer = noiseBuf(c, o.dur);
    var f = c.createBiquadFilter(); f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
    if (o.q) f.Q.value = o.q;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + o.dur + 0.02);
  }
  /* 音调（振荡器）*/
  function tone_(c, t0, o) {
    var osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + o.dur + 0.02);
  }

  var SYNTH = {
    bomb: function (c, t0) {   /* 低频轰鸣 + 碎裂噪声 */
      hit_(c, t0, { dur: 0.55, type: 'lowpass', f0: 900, f1: 70, vol: 0.85 });
      tone_(c, t0, { dur: 0.5, type: 'sine', f0: 120, f1: 32, vol: 0.55 });
    },
    egg: function (c, t0) {    /* 啪唧：闷响 + 黏糊尾巴 */
      hit_(c, t0, { dur: 0.26, type: 'bandpass', f0: 700, f1: 300, q: 1.1, vol: 0.8 });
      hit_(c, t0 + 0.09, { dur: 0.22, type: 'lowpass', f0: 400, f1: 160, vol: 0.4 });
    },
    chicken: function (c, t0) { /* 咯咯两声 */
      [0, 0.16].forEach(function (d) {
        tone_(c, t0 + d, { dur: 0.13, type: 'sawtooth', f0: 900, f1: 1500, vol: 0.16 });
        tone_(c, t0 + d + 0.07, { dur: 0.1, type: 'sawtooth', f0: 1400, f1: 850, vol: 0.13 });
      });
    },
    shoe: function (c, t0) {   /* 啪：极短脆响 */
      hit_(c, t0, { dur: 0.09, type: 'highpass', f0: 1400, vol: 0.9 });
      tone_(c, t0, { dur: 0.07, type: 'triangle', f0: 260, f1: 90, vol: 0.35 });
    },
    cake: function (c, t0) {   /* 黏糊糊：闷 + 二次拍击 */
      hit_(c, t0, { dur: 0.32, type: 'lowpass', f0: 340, f1: 120, vol: 0.8 });
      hit_(c, t0 + 0.14, { dur: 0.2, type: 'lowpass', f0: 220, f1: 90, vol: 0.35 });
    },
    tomato: function (c, t0) { /* 汁水四溅：中频爆 + 短尾 */
      hit_(c, t0, { dur: 0.2, type: 'bandpass', f0: 1100, f1: 500, q: 0.8, vol: 0.8 });
      hit_(c, t0 + 0.07, { dur: 0.18, type: 'lowpass', f0: 700, f1: 300, vol: 0.35 });
    }
  };

  function sfx(key) {
    if (!soundOn()) return;
    var p = find(key); if (!p) return;
    var mp3 = ASSET + key + '.mp3';
    if (has(mp3)) {
      try {
        var a = global.__propAudio && global.__propAudio[key];
        if (!a) {
          global.__propAudio = global.__propAudio || {};
          a = global.__propAudio[key] = new Audio(mp3);
        }
        a.currentTime = 0; a.play().catch(function () { });
        return;
      } catch (e) { /* 回退合成 */ }
    }
    var c = ac(); if (!c) return;
    try { (SYNTH[key] || SYNTH.bomb)(c, c.currentTime); } catch (e) { }
  }

  /* ---------- 全屏特效层（fixed，坐标直接用视口坐标，不用换算） ---------- */
  function layer() {
    var el = global.document.getElementById('fxLayer');
    if (!el) {
      el = global.document.createElement('div');
      el.id = 'fxLayer';
      el.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:9400;pointer-events:none;overflow:hidden';
      global.document.body.appendChild(el);
    }
    return el;
  }
  function center(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ---------- 命中特效：冲击波 + 粒子 + 抖动 + 飘字 ---------- */
  function burst(pt, p, toEl) {
    var L = layer();
    var ring = global.document.createElement('div');
    ring.style.cssText = 'position:absolute;left:' + pt.x + 'px;top:' + pt.y + 'px;width:22px;height:22px;' +
      'margin:-11px 0 0 -11px;border-radius:50%;border:3px solid ' + p.color + ';pointer-events:none';
    L.appendChild(ring);
    if (ring.animate) ring.animate([{ transform: 'scale(.3)', opacity: .95 }, { transform: 'scale(4.2)', opacity: 0 }],
      { duration: 520, easing: 'ease-out', fill: 'forwards' });
    setTimeout(function () { ring.remove(); }, 560);

    for (var i = 0; i < 8; i++) {
      var d = global.document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + pt.x + 'px;top:' + pt.y + 'px;width:7px;height:7px;' +
        'margin:-3.5px 0 0 -3.5px;border-radius:50%;background:' + p.color + ';pointer-events:none';
      L.appendChild(d);
      var ang = (Math.PI * 2) * (i / 8) + Math.random() * 0.7, dist = 32 + Math.random() * 30;
      if (d.animate) d.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + Math.cos(ang) * dist + 'px,' + Math.sin(ang) * dist + 'px) scale(.2)', opacity: 0 }
      ], { duration: 500 + Math.random() * 200, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
      (function (n) { setTimeout(function () { n.remove(); }, 760); })(d);
    }

    if (toEl && toEl.animate) {
      try {
        toEl.animate([
          { transform: 'translate(0,0)' }, { transform: 'translate(-4px,2px)' },
          { transform: 'translate(4px,-2px)' }, { transform: 'translate(-3px,-2px)' },
          { transform: 'translate(3px,2px)' }, { transform: 'translate(0,0)' }
        ], { duration: 420, easing: 'ease-in-out' });
      } catch (e) { }
    }

    var tip = global.document.createElement('div');
    tip.textContent = nm(p);
    tip.style.cssText = 'position:absolute;left:' + pt.x + 'px;top:' + (pt.y - 30) + 'px;transform:translateX(-50%);' +
      'font-size:13px;font-weight:800;color:' + p.color + ';text-shadow:0 2px 8px rgba(0,0,0,.75);' +
      'pointer-events:none;white-space:nowrap;font-family:inherit';
    L.appendChild(tip);
    if (tip.animate) tip.animate([
      { opacity: 0, transform: 'translate(-50%,8px)' },
      { opacity: 1, transform: 'translate(-50%,-10px)', offset: .35 },
      { opacity: 0, transform: 'translate(-50%,-24px)' }
    ], { duration: 900, easing: 'ease-out', fill: 'forwards' });
    setTimeout(function () { tip.remove(); }, 950);
  }

  /* ---------- 飞行：外层走 X（线性），内层走 Y（抛物线） ---------- */
  function fly(fromEl, toEl, key) {
    if (!fromEl || !toEl || !global.document.body) return;
    var p = find(key); if (!p) return;
    var L = layer(), a = center(fromEl), b = center(toEl);
    var size = 54, dur = 520;
    var wrap = global.document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:' + a.x + 'px;top:' + a.y + 'px;width:' + size + 'px;height:' + size + 'px;' +
      'margin:-' + (size / 2) + 'px 0 0 -' + (size / 2) + 'px;pointer-events:none;will-change:transform';
    var inner = global.document.createElement('div');
    inner.style.cssText = 'width:100%;height:100%;will-change:transform';
    inner.innerHTML = icon(key, size);
    wrap.appendChild(inner); L.appendChild(wrap);

    var dx = b.x - a.x, dy = b.y - a.y;
    var arc = Math.min(130, 46 + Math.abs(dx) * 0.28);
    if (wrap.animate) {
      wrap.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(' + dx + 'px)' }],
        { duration: dur, easing: 'linear', fill: 'forwards' });
      inner.animate([
        { transform: 'translateY(0px) scale(.65) rotate(0deg)', offset: 0 },
        { transform: 'translateY(-' + arc + 'px) scale(1.08) rotate(200deg)', offset: .5 },
        { transform: 'translateY(' + dy + 'px) scale(1) rotate(400deg)', offset: 1 }
      ], { duration: dur, easing: 'cubic-bezier(.35,.05,.6,.95)', fill: 'forwards' });
    } else {
      wrap.style.transition = 'transform ' + dur + 'ms linear';
      wrap.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    setTimeout(function () { wrap.remove(); burst(b, p, toEl); sfx(key); }, dur);
  }

  /* ---------- 道具选择面板（3 列 × 2 行） ---------- */
  function cellsHTML() {
    return LIST.map(function (p) {
      return '<div class="prop-cell" data-prop="' + p.key + '">' +
        '<div class="prop-ico">' + icon(p.key, 38) + '</div>' +
        '<div class="prop-nm">' + nm(p) + '</div>' +
        '<div class="prop-ds">' + ds(p) + '</div></div>';
    }).join('');
  }

  /* 页面加载就异步预热素材探测，之后渲染面板时直接查缓存 */
  try { probeAll(); } catch (e) { }

  global.Props = {
    list: LIST,
    find: find,
    icon: icon,
    cells: cellsHTML,
    fly: fly,
    sfx: sfx,
    soundOn: soundOn,
    unlock: function () { try { ac(); } catch (e) { } },
    /* 三语支持：面板/toast 文案跟界面语言走 */
    nm: function (key) { var p = find(key); return p ? nm(p) : ''; },
    langTag: langTag,
    msg: msg,
    toastText: toastText
  };
})(window);

