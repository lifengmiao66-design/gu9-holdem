/* ==========================================================================
 * GU9 牌桌人声音效管理器（poker-ui 版）
 * --------------------------------------------------------------------------
 * 多语言语音包
 *   · 华语地区（语言以 zh 开头：中国 / 香港 / 台湾 / 新加坡华人等）使用中文女声
 *     female_{check,fold,call,raise,allin}.mp3
 *   · 非华语地区（美国及其他国家）使用英文人声
 *     en_{check,fold,call,allin}.mp3
 *     —— 跟注（call）有 3 种音色随机切换：en_call / en_call_jenny / en_call_emma
 *     —— 加注（raise）暂无专属英文音，复用跟注主音 en_call.mp3
 *   判断依据：运行时读取当前界面语言 I18N.get()（geo + 手动选择），zh 开头=华语。
 *
 * 音频文件：poker-ui/assets/audio/<文件名>
 * 线上地址：https://<域名>/assets/audio/<文件名>
 * 由 tools/tts/make_sfx.py 生成（Edge TTS，免费无 Key）。
 *
 * 开关
 *   复用现有的音效总开关（SET.settings.sound / localStorage 'gu9_sound'）——
 *   总开关关闭时人声联动静音（由 core.js 的 voiceSfx 判断）。
 *   人声比合成音刺耳，所以额外受一个独立子开关控制（localStorage 'gu9_voice'），默认开。
 * ========================================================================== */
(function (global) {
  'use strict';

  var BASE = 'assets/audio/';      // 相对 poker-ui/index.html
  var VOICE_ONLY = false;          // 预留：true = 只出声人（本项目无合成音，暂无实际差异）

  // 动作 → 文件名（华语：中文女声）
  var ZH_FILES = {
    check:     'female_check.mp3',    // 过牌
    fold:      'female_fold.mp3',     // 弃牌
    call:      'female_call.mp3',     // 跟注
    raise:     'female_raise.mp3',    // 加注
    allin:     'female_allin.mp3',    // 全下
    allinCall: 'female_allin.mp3'     // 全下跟注，共用"全下"
  };

  // 动作 → 文件名（非华语：英文人声）
  //   call 为数组 → 播放时随机挑一种音色，制造自然变化
  var EN_FILES = {
    check:     'en_check.mp3',                 // Check
    fold:      'en_fold.mp3',                  // Fold
    call:      ['en_call.mp3', 'en_call_jenny.mp3', 'en_call_emma.mp3'], // Call ×3 音色
    raise:     'en_call.mp3',                  // 加注暂无专属音 → 复用跟注主音
    allin:     'en_allin.mp3',                 // All-in
    allinCall: 'en_allin.mp3'                  // 全下跟注
  };

  // 同一个动作瞬发时，最短重叠间隔（毫秒）。防止快速连续行动糊成一片
  var MIN_GAP = 120;

  var pool = {};      // name -> HTMLAudioElement
  var lastAt = {};    // kind -> 上次播放时间戳
  var ready = false;
  var enabled = true; // 子开关

  /* ---------------- 语言判定 ---------------- */

  // 当前是否为华语地区：语言以 zh 开头（zh-CN / zh-TW / zh-HK ...）
  function isChinese() {
    try {
      var lang = '';
      if (global.I18N && typeof global.I18N.get === 'function') lang = global.I18N.get() || '';
      if (!lang && global.localStorage) lang = global.localStorage.getItem('gu9.lang') || '';
      if (lang) return /^zh/i.test(lang);
    } catch (e) { /* ignore */ }
    return true; // 兜底：华语（默认中文）
  }

  function activeFiles() { return isChinese() ? ZH_FILES : EN_FILES; }

  // 取某个动作对应的文件名（EN 的 call 可能是数组 → 随机挑一个）
  function fileOf(kind) {
    var f = activeFiles()[kind];
    if (!f) return null;
    if (Array.isArray(f)) return f[Math.floor(Math.random() * f.length)];
    return f;
  }

  /* ---------------- 开关 ---------------- */

  var LS_KEY = 'gu9_voice';
  try {
    var saved = localStorage.getItem(LS_KEY);
    if (saved === '0') enabled = false;
  } catch (e) { /* 隐私模式忽略 */ }

  function isEnabled() { return enabled; }

  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(LS_KEY, enabled ? '1' : '0'); } catch (e) { }
    if (!enabled) stopAll();
    return enabled;
  }

  function toggle() { return setEnabled(!enabled); }

  /* ---------------- 预加载 ---------------- */

  // 提前把两套 MP3 都建好并解码，第一次点的时候才不会"先说半句"；
  // 也保证中途切换语言时即时生效。
  function preload() {
    if (ready) return;
    ready = true;
    var names = {};
    [ZH_FILES, EN_FILES].forEach(function (set) {
      for (var k in set) {
        var v = set[k];
        if (Array.isArray(v)) v.forEach(function (x) { names[x] = 1; });
        else names[v] = 1;
      }
    });
    for (var name in names) {
      if (pool[name]) continue;
      try {
        var a = new Audio(BASE + name);
        a.preload = 'auto';
        a.volume = 1.0;
        pool[name] = a;
      } catch (e) { /* 不支持就静默降级，不阻断游戏 */ }
    }
  }

  /* ---------------- 播放 ---------------- */

  // 真正发声。audio 用 clone -> 允许同一条音效重叠播放，互不打断
  function fire(name, vol) {
    var proto = pool[name];
    if (!proto) {
      // 极端情况：未预加载到（比如中途切语言后第一次触发）——补建
      try {
        var b = new Audio(BASE + name);
        b.preload = 'auto'; b.volume = 1.0; pool[name] = b; proto = b;
      } catch (e) { return false; }
    }
    var node;
    try {
      node = (typeof proto.cloneNode === 'function')
        ? proto.cloneNode(true)
        : new Audio(proto.src);
    } catch (e) {
      node = new Audio(proto.src);
    }
    node.volume = (vol == null) ? 1.0 : vol;
    try {
      var p = node.play();
      if (p && typeof p.catch === 'function') p.catch(function () { /* 自动播放被拦，忽略 */ });
    } catch (e) { return false; }
    return true;
  }

  /**
   * 播一个动作的人声。
   * @param {string} kind  check | fold | call | raise | allin | allinCall
   * @param {object} [opt] { volume: 0~1, force: 忽略开关 }
   * @returns {boolean} 是否真的发了声
   */
  function play(kind, opt) {
    opt = opt || {};
    if (!opt.force && !enabled) return false;
    var name = fileOf(kind);
    if (!name) return false;

    var now = Date.now();
    /* ★ 2026-10-08：去重键加上调用方传入的 tag（座位/玩家标识），
       否则同一轮里多个玩家做相同动作（如多人过牌/跟注）只会播第一个、其余被吞，
       表现为「气泡有、语音有时候没有」。现在不同座位互不影响，只有同一座位 120ms 内重复才抑制。 */
    var gapKey = name + '#' + (opt && opt.tag != null ? opt.tag : '');
    if (lastAt[gapKey] && (now - lastAt[gapKey]) < MIN_GAP) return false;
    lastAt[gapKey] = now;

    preload();
    return fire(name, opt.volume);
  }

  function stopAll() {
    for (var name in pool) {
      try { pool[name].pause(); pool[name].currentTime = 0; } catch (e) { }
    }
  }

  /* ---------------- 音频解锁（移动端 / Telegram WebView / iOS Safari） ----------------
   * 浏览器不允许"没交互就出声"。第一次触碰屏幕时把音频通道点亮，
   * 之后牌桌上的自动播报（机器人行动）才响得出来。 */
  var unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    preload();
    for (var name in pool) {
      try {
        var a = pool[name];
        a.muted = true;
        var p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(function () { a.pause(); a.currentTime = 0; a.muted = false; })
            .catch(function () { a.muted = false; });
        } else {
          a.pause(); a.currentTime = 0; a.muted = false;
        }
      } catch (e) { }
    }
  }

  /* ---------------- 对外接口 ---------------- */

  global.SfxVoice = {
    play: play,
    preload: preload,
    unlock: unlock,
    stopAll: stopAll,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    toggle: toggle,
    isChinese: isChinese,
    ZH_FILES: ZH_FILES,
    EN_FILES: EN_FILES,
    VOICE_ONLY: VOICE_ONLY,
    FILES: ZH_FILES
  };
})(window);


