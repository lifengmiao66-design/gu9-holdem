/* ===== core.js · 基础库、图标、全局状态、通用组件、路由 ===== */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

/* ===== 计价货币：USDT。全站单一币种，账户与牌桌一律以 USDT 计价（内部单位「分」：1 USDT = 100 分） ===== */
/* 金额显示：1234 → "1,234 USDT" */
function uv(n) { return fmt(n) + ' USDT'; }
/* 内部单位换算：1 USDT = 100 分（cent）。CHIP_PER_USDT 仅为兼容旧字段保留，新代码一律用 uStr() */
var CHIP_PER_USDT = 100;
/* ★ 2026-10-03：邀请好友奖励（分 / 人），由服务端 econ.inviteReward 下发（100 = 1 USDT）；2026-10-05 起在被邀请人首充到账后由 chain.js 发放 */
var INVITE_REWARD = 10;
/* ★ 2026-10-02：大厅顶栏展示的 APP 名称。
   顶栏已不再显示玩家头像 / 昵称 / VIP / ID（截图外发会泄露账号），只显示它。
   默认 GU9，可由后台「参数配置 → 应用名称」覆盖（服务端 CONFIG.app.name）。 */
var APP_NAME = 'GU9';
/* ★ 2026-10-03：APP 主 Logo。空 = 用前端内置默认图（登录页 logo-full-light.png / 顶栏 logo-mark.png）；
   有值 = 后台「参数配置 → 品牌设置」上传的图片地址（/assets/brand/logo-xxx.png），两处一起换。 */
var APP_LOGO = '';

/* ★ 2026-10-04：PWA 添加到主屏幕 */
var A2HS_PROMPT = null;
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
function isInStandaloneMode() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function canAddToHome() { return !isInStandaloneMode() && (A2HS_PROMPT || isIOS()); }
function promptAddToHome() {
  if (isInStandaloneMode()) { toast('已经添加到主屏幕', 'ok'); return; }
  if (A2HS_PROMPT) {
    A2HS_PROMPT.prompt();
    A2HS_PROMPT.userChoice.then(function (choice) {
      if (choice.outcome === 'accepted') toast('已添加到主屏幕', 'ok');
      else toast('已取消添加', 'info');
      A2HS_PROMPT = null;
    });
    return;
  }
  if (isIOS()) { showIOSAddToHomeGuide(); return; }
  /* 非 iOS（Android 等）但浏览器没给安装 prompt：说明站点未满足可安装条件，
     引导用户走浏览器菜单。Android Chrome 地址栏通常也会出现「安装」图标。 */
  openModal({
    title: '添加到主屏幕',
    buttons: false,
    body: '<div class="center col" style="padding:8px 0;gap:12px">' +
      '<div style="width:72px;height:72px;border-radius:18px;overflow:hidden;background:#f8fafc;display:flex;align-items:center;justify-content:center;border:1px solid #e4e9f0">' +
      '<img src="' + esc(APP_LOGO || 'assets/logo-mark.png?v=20261004l') + '" style="width:64px;height:64px;object-fit:contain"></div>' +
      '<div class="b" style="font-size:15px">在浏览器里安装 GU9 德州扑克</div>' +
      '<div class="tiny txt2" style="text-align:left;width:100%;line-height:1.9">' +
      '① 点浏览器右上角的 <b>⋮ 菜单</b>（或地址栏右侧的安装图标）<br>' +
      '② 选择 <b>「安装应用」/「添加到主屏幕」</b><br>' +
      '③ 点 <b>安装</b> 完成' +
      '</div>' +
      '<div class="tiny txt3" style="margin-top:2px">若该菜单项未出现，请确认用 Chrome 打开且已联网。</div>' +
      '</div>'
  });
}
function showIOSAddToHomeGuide() {
  var logo = APP_LOGO || 'assets/logo-mark.png?v=20261004l';
  /* ★ 2026-10-04：iOS 限制 —— 苹果禁止网页用代码直接把图标加到主屏幕，
     只能由用户在 Safari 里手动「分享 → 添加到主屏幕」。这里用可视化示意图，
     标出 Safari 底栏的分享按钮位置，让操作一目了然。 */
  openModal({
    title: '添加到主屏幕',
    buttons: false,
    body:
    '<div class="center col" style="padding:6px 0;gap:14px">' +
      '<div style="width:72px;height:72px;border-radius:18px;overflow:hidden;background:#f8fafc;display:flex;align-items:center;justify-content:center;border:1px solid #e4e9f0">' +
      '<img src="' + esc(logo) + '" style="width:64px;height:64px;object-fit:contain">' +
      '</div>' +
      '<div class="b" style="font-size:15px">把 GU9 德州扑克放到手机桌面</div>' +
      /* 模拟 Safari 底栏 */
      '<div style="width:100%;background:#e9e9ec;border-radius:14px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;color:#222">' +
        '<span style="font-size:20px">‹</span>' +
        '<div style="text-align:center;flex:1">' +
          '<div style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:11px;background:#2ecc71;color:#fff;font-size:20px;box-shadow:0 0 0 4px rgba(46,204,113,.25)">⤴</div>' +
          '<div style="font-size:11px;margin-top:3px;color:#1a7a45;font-weight:700">① 点此分享</div>' +
        '</div>' +
        '<span style="font-size:18px">◰</span>' +
      '</div>' +
      '<div style="color:#2ecc71;font-size:22px;line-height:1">↓</div>' +
      /* 模拟分享菜单中的「添加到主屏幕」项 */
      '<div style="width:100%;background:#fff;border-radius:14px;overflow:hidden;color:#222;box-shadow:0 6px 20px rgba(0,0,0,.18)">' +
        '<div style="padding:12px 14px;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0">分享菜单</div>' +
        '<div style="padding:13px 14px;display:flex;align-items:center;gap:12px;background:#eafff3;border-left:4px solid #2ecc71">' +
          '<div style="width:34px;height:34px;border-radius:9px;background:#2ecc71;color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px">＋</div>' +
          '<div style="flex:1"><div style="font-weight:700;font-size:14px">② 添加到主屏幕</div><div style="font-size:11px;color:#888">Add to Home Screen</div></div>' +
        '</div>' +
        '<div style="padding:11px 14px;font-size:13px;color:#444">③ 点右上角「添加」即可</div>' +
      '</div>' +
      '<div class="tiny txt3" style="margin-top:2px;line-height:1.6">添加后手机桌面会出现 GU9 图标，下次直接点开就是全屏 App。<br>（iOS 系统限制：此步骤需手动操作，无法一键自动）</div>' +
    '</div>'
  });
}
/* ★ 2026-10-02：任务 / 签到奖励（全部由后台配置驱动）。
   这里是「服务端拉不到配置时」的兜底默认档，必须与 server.js 的 CONFIG.tasks 保持一致。
   applyAdmin() 会用它 + 服务端值合并出最终的 TASK_REWARD。 */
var TASK_REWARD_DEFAULT = {
  /* ★ 每日签到：第 N 天送 N USDT（内部单位是「分」，故 100 = 1.00 U）。 */
  signin: [100, 200, 300, 400, 500, 600, 700],
  /* 「连续签到累计 X USDT」文案里的 X（1+2+…+7 = 28 USDT → 2800 分） */
  signinTotal: 2800,
  /* ★ 空表 = 已下线的任务奖励（服务端 rewards 也同步清空，领奖接口会拒绝） */
  rewards: {}
};
var TASK_REWARD = Object.assign({}, TASK_REWARD_DEFAULT, { signin: TASK_REWARD_DEFAULT.signin.slice(), rewards: Object.assign({}, TASK_REWARD_DEFAULT.rewards) });
function chipsToUsdt(c) { return Math.round((Number(c) || 0) / CHIP_PER_USDT * 100) / 100; }
/* ★ 2026-10-06：全站唯一单位 = USDT（1 USDT = 1 USDT，无「分」、无「USDT」）。
   uStr(usdt) → "12.34"（两位小数，带千分位）；uShow(usdt) → "12.34 USDT"。 */
function uStr(c) {
  var v = Math.round((Number(c) || 0) * 100) / 100;
  var neg = v < 0; if (neg) v = -v;
  var parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + parts.join('.');
}
function uShow(c) { return uStr(c) + ' USDT'; }
function usdtToChips(u) { return Math.round((Number(u) || 0) * CHIP_PER_USDT); }
/* ★ USDT 化：入参是「分」，显示成 USDT 元。例：1200 → "12.00 U" */
function cv(n) { return uStr(n) + ' U'; }
function cvu(n) { return uStr(n) + ' U'; }
/* 复制文本（链上收款地址 / 订单号）：优先异步剪贴板，降级 textarea+execCommand */
function copyText(t) {
  t = String(t == null ? '' : t);
  if (!t) return Promise.resolve(false);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
  }
  return Promise.resolve(legacyCopy(t));
}
function legacyCopy(t) {
  try {
    var ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
    var ok = document.execCommand && document.execCommand('copy');
    ta.remove(); return !!ok;
  } catch (e) { return false; }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
function fmt(n) { var v = Math.round((+n || 0) * 100) / 100, p = v.toFixed(2).split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); }   /* ★ 2026-10-06 USDT：金额两位小数 */
function fmtInt(n) { n = Math.round(Number(n) || 0); return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }   /* 整数计数（手数等非金额） */
function short(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(Math.abs(n) >= 1000000 ? 0 : 1) + '万';
  return fmt(n);
}
function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function timeAgo(ts) {  var d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return d + '秒前'; if (d < 3600) return Math.floor(d / 60) + '分钟前';
  if (d < 86400) return Math.floor(d / 3600) + '小时前';
  if (d < 86400 * 30) return Math.floor(d / 86400) + '天前';
  var t = new Date(ts); return (t.getMonth() + 1) + '-' + t.getDate();
}
function nowTime() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
/* 日期时间：时间戳 → "2026-10-01 20:30" / 短式 "10-01 20:30" */
function dateStr(ts, shortFmt) {
  var d = new Date(Number(ts) || 0);
  var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  var md = p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  var hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
  return shortFmt ? (md + ' ' + hm) : (d.getFullYear() + '-' + md + ' ' + hm);
}
/* 秒 → "28:35"（订单有效期倒计时） */
function mmss(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  return p2(Math.floor(s / 60)) + ':' + p2(s % 60);
}

/* ---------- 图标 ---------- */
var ICONS = {
  close: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', check: 'M4 12.5l5 5L20 6.5',
  back: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4.3-4.3', home: 'M3 11l9-8 9 8M5.5 10v10h13V10',
  cards: 'M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2zM12 8l2.5 3-2.5 3-2.5-3z',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c0-3.6 2.9-5.5 6.5-5.5S15.5 16.4 15.5 20M17 4.5a3.5 3.5 0 010 7M18.5 14.5c2.2.5 3.5 2.2 3.5 5.5',
  user: 'M12 11.5a4 4 0 100-8 4 4 0 000 8zM4.5 20.5c0-4 3.4-6 7.5-6s7.5 2 7.5 6',
  chat: 'M4 5h16v11H9l-5 4V5z', send: 'M3.5 11.5L21 4l-8 17-2.5-6.5z', mail: 'M3 6h18v12H3zM3 6.5l9 6.5 9-6.5',
  wallet: 'M3 7.5h18V19H3zM3 7.5l3.5-4h11L21 7.5M16.5 13h2',
  exchange: 'M4 8.5h14M15 5l3.5 3.5L15 12M20 15.5H6M9 12l-3.5 3.5L9 19',
  gift: 'M3.5 9.5h17V20h-17zM12 9.5V20M3.5 9.5L6 5h12l2.5 4.5M12 5c-.8-2-4.5-2-4.5.8 0 1.6 2.6 2.1 4.5 3.7 1.9-1.6 4.5-2.1 4.5-3.7C16.5 3 12.8 3 12 5z',
  trophy: 'M8 4h8v5.5a4 4 0 01-8 0V4zM8 6H5a3 3 0 003 3M16 6h3a3 3 0 01-3 3M10 15h4M9.5 20h5M12 15v5',
  task: 'M6 4h9l3 3v13H6zM9 12l2 2 4-4M9 18h6', fire: 'M12 3s5 4 5 9a5 5 0 01-10 0c0-2 1-3.5 2-4.5C10 9 12 8 12 3z',
  settings: 'M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM12 3v2.5M12 18.5V21M4.9 7.5l2.2 1.2M16.9 15.3l2.2 1.2M4.9 16.5l2.2-1.2M16.9 8.7l2.2-1.2',
  help: 'M12 4a8 8 0 100 16 8 8 0 000-16zM9.6 9.6a2.5 2.5 0 113.2 2.4c-.7.3-1.1.9-1.1 1.7v.3M12 17.2h.01',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 7.5V12l3.5 2', play: 'M8 5l11 7-11 7z', pause: 'M9.5 5v14M15 5v14',
  next: 'M6 5l9 7-9 7zM18.5 5v14', prev: 'M18 5l-9 7 9 7zM6 5v14', repeat: 'M4 12a8 8 0 018-8 8 8 0 017 4M20 12a8 8 0 01-8 8 8 8 0 01-7-4M17 3v4h-4M7 21v-4h4',
  star: 'M12 3.5l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.6 6.4 20.7l1.1-6.2L3 10.1l6.2-.9z',
  crown: 'M4 18.5h16M4 18.5L3 9l5 4 4-7 4 7 5-4-1 9.5', coin: 'M12 4a8 8 0 100 16 8 8 0 000-16zM9 10h6M9 14h6M12 7v10',
  diamond: 'M12 3l9 6-9 12-9-12zM3 9h18', eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12S18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  volume: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11',
  mute: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4zM16 9.5l5 5M21 9.5l-5 5', music: 'M9 18V6l11-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM20 16a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
  lock: 'M5.5 11h13v9h-13zM8.5 11V8a3.5 3.5 0 017 0v3', shield: 'M12 3.5l8 3v5.5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6.5z',
  phone: 'M6 3h3l2 5-2.2 1.8a12.5 12.5 0 005.4 5.4L16 13l5 2v3a2 2 0 01-2 2A17 17 0 014 5a2 2 0 012-2z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  filter: 'M3.5 5h17l-6.5 7.5V19l-4 2v-8.5z', flag: 'M5.5 4v17M5.5 5h13l-3 4.5 3 4.5h-13',
  more: 'M6 12h.01M12 12h.01M18 12h.01', edit: 'M4 20h4.5L20 8.5 15.5 4 4 15.5z',
  trash: 'M5 7h14M9.5 7V4h5v3M6.5 7l1 13h9l1-13', ban: 'M12 4a8 8 0 100 16 8 8 0 000-16zM5.5 5.5l13 13',
  stats: 'M4 20V11M10 20V4M16 20v-7M22 20H2', dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  smile: 'M12 4a8 8 0 100 16 8 8 0 000-16zM9 14a4 4 0 006 0M9.5 9.5h.01M14.5 9.5h.01',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  logout: 'M15 8V5.5A1.5 1.5 0 0013.5 4h-8A1.5 1.5 0 004 5.5v13A1.5 1.5 0 005.5 20h8a1.5 1.5 0 001.5-1.5V16M9 12h11M17 8l3.5 4-3.5 4',
  refresh: 'M20 12a8 8 0 11-2.3-5.6M20 4v4h-4', info: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 11v5M12 8h.01',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  history: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 7.5V12l3 2', transfer: 'M4 9h13l-3-3M20 15H7l3 3',
  invite: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 20c0-3.5 3.1-5.5 7-5.5 1.2 0 2.3.2 3.3.5M19 8v6M16 11h6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1', share: 'M4 12v7h16v-7M12 3v11M8 7l4-4 4 4',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z', target: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11.5a.5.5 0 100 1 .5.5 0 000-1z',
  seat: 'M6 9h12v3H6zM7 12v7M17 12v7M5 20h14', table: 'M3 12c0-4 4-7 9-7s9 3 9 7-4 7-9 7-9-3-9-7zM3 12c0 2 4 3.5 9 3.5S21 14 21 12',
  card: 'M6 3h9l3 3v15H6z', list: 'M4 6h16M4 12h16M4 18h16', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  dice2: 'M4 4h16v16H4z', mic: 'M12 4a3 3 0 013 3v5a3 3 0 01-6 0V7a3 3 0 013-3zM6 11a6 6 0 0012 0M12 17v3M9 20h6'
};
function icon(name, size, cls, style) {
  var d = ICONS[name] || ICONS.info;
  return '<svg class="' + (cls || 'ico') + '" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="' + (style || '') + '"><path d="' + d + '"/></svg>';
}

/* ---------- 状态 ---------- */
var NAMES = ['牌桌浪人', 'Allin小王子', '河牌杀手', '德州老炮', '葫芦娃', '慢打大师', '翻牌之神', '坚果猎人', '底牌刺客', '澳门赌神',
  '拉斯维加斯', '冷静的AK', '同花顺制造机', '偷盲狂魔', '鱼塘霸主', '诈唬艺术家', '位置大师', 'USDT收割机', '皇家同花顺', '紧凶玩家',
  '深夜牌神', '三bet狂人', '跟注站', '石头玩家', '运气选手', '扑克教授', '概率信徒', '读牌高手', '小盲终结者', '河牌奇迹'];
var AV_COLORS = ['#f5c352', '#3b8cff', '#2ecc71', '#ff5a5f', '#a06bff', '#ff9f43', '#00c2d1', '#ff6ba8', '#7bd44b', '#e0b0ff'];

function mkUser(i, opt) {
  opt = opt || {};
  var name = opt.name || NAMES[i % NAMES.length];
  return {
    id: String(1000000 + i * 137171 % 8999999), name: name, color: AV_COLORS[i % AV_COLORS.length],
    /* ★ 2026-10-03：真人成员带上自己的头像；机器人（不传 opt.avatar）留空 → 程序化生成 */
    avatar: opt.avatar || '',
    /* 2026-10-06：等级/VIP 一律真实 —— 等级由累计充值决定，演示数据不再随机刷高等级 */
    level: opt.level != null ? opt.level : 0, vip: opt.vip != null ? opt.vip : 0,
    status: opt.status || pick(['online', 'playing', 'offline', 'online', 'playing']),
    chips: opt.chips != null ? opt.chips : rnd(20000, 9000000), table: opt.table || '',
    country: opt.country || pick(['中国', '中国香港', '中国澳门', '新加坡', '马来西亚']),
    note: opt.note || '', blocked: false, intimate: opt.intimate || rnd(0, 100), last: Date.now() - rnd(0, 86400000 * 6)
  };
}

var S = {
  logged: false,
  user: null,
  settings: {
    sound: true, music: false, vibrate: true, fourColor: true, showOdds: true, showPotOdds: true, voice: true,
    autoBuyIn: true, autoRebuy: false, autoMuck: true, hideChat: false, tableTheme: 'green',
    cardBack: 'red', lang: 'zh', allowInvite: true, allowTransfer: true, privateMsg: true
  },
  friends: [], requests: [], outgoing: [], blocked: [],
  /* 服务端真实房间（/rooms/mine + /rooms/list 同步下来的）与「谁邀请了我」的收件箱
     ★ 2026-10-03：大厅以前只认本地现造的随机桌，建好的房间一刷新就没了；
       受邀的房间在好友端更是完全不出现。这两份缓存就是给大厅和导航栏红点用的。 */
  roomInvites: [],
  chats: { world: [], table: [], p2p: {} },
  mails: [], tasks: [], inventory: [], history: [], tables: [], rank: [], transferLogs: [], achievements: [],
  curTable: null, unread: { world: 0, mail: 0 },   /* 未读数由轮询/打开后按真实数据计算，不再写死 */
  admin: null, adminLog: []
};

/* ---------- 机器人总开关（后台可配；关时前端不安排机器人、强制关控水） ---------- */
var BOTS = { on: true };

/* ---------- 后台配置（默认档位） ---------- */
function defaultAdmin() {
  return {
    house: { on: false, rate: 0.30, strength: 0.85, gain: 1, capProfit: 2000000, capLoss: 1000000, perTable: {} },
    think: { min: 3000, max: 11000, fast: false },
    ai: { iters: 260, vbetEq: 0.55, vbetStep: 0.04, semiBluff: 0.32, steal: 0.12, raiseEq: 0.70, raiseStep: 0.04, semiRaiseEq: 0.56, semiRaiseFreq: 0.32, reqBase: 0.03, reqOpp: 0.01, reqFacingRaise: 0, bigBetPenalty: 0, riverPenalty: 0, airFold: 0.18, drawCall: 0.25, allinCallEq: 0.66, adapt: 0 },
    /* ★ 2026-10-04：机器人总开关；默认开（公共桌照常安排机器人陪坐） */
    bots: { on: true },
    econ: { chipPerUsdt: 1, rakePct: 0.05, rakeCapBB: 3, rebate: [0, 0, 0, 0, 0, 1, 2, 3, 4] },   /* ★ VIP5 起才有返水 */
    lobby: { quick: { quick: true, room: true, mtt: true }, banners: { b1: true, b2: true, b3: true } },
    modes: (typeof MODES !== 'undefined' ? (function () { var m = {}; Object.keys(MODES).forEach(function (k) { m[k] = true; }); return m; })() : {}),
    tables: { count: 26 },
    sim: { hands: 60 },
    app: { name: 'GU9' },
    tasks: JSON.parse(JSON.stringify(TASK_REWARD_DEFAULT))
  };
}
/* 把配置推到各运行时的全局变量上（启动 / 拉到服务端配置后调用）
   ★ 优先级：服务端配置 S.serverCfg > 本地 S.admin > 默认。
   ★ 控水不在服务端能力内，永远保持关闭。 */
function applyAdmin() {
  var c = S.serverCfg || null;
  var a = S.admin || (S.admin = defaultAdmin());
  var think = (c && c.think) || a.think;
  var ai = (c && c.ai) || a.ai;
  var econ = (c && c.econ) || a.econ;
  var modes = (c && c.modes) || a.modes;
  /* ★ 2026-10-02：控水（机器人赢面调节）—— 严格执行服务端下发值，前端不得自己打开。
     与「透视」的区别：控水只倾斜发牌结果，不额外给机器人信息，是常规运营手段；
     透视则是给机器人完整的未来牌序，只能用于测试 / 演示房。两者互斥：开启透视时强制关控水，
     否则两边都在改牌序，机器人拿到的是错的未来牌。 */
  if (typeof HOUSE !== 'undefined') {
    var hc = (c && c.house) || {};
    HOUSE.on = !!hc.on; HOUSE.perTable = {};
    HOUSE.botWinRate = (+hc.botWinRate > 0 && +hc.botWinRate <= 0.9) ? +hc.botWinRate : 0.30;
    HOUSE.strength = (+hc.strength >= 0 && +hc.strength <= 1) ? +hc.strength : 0.85;
    HOUSE.capProfit = +hc.capProfit > 0 ? +hc.capProfit : 2000000;
    HOUSE.capLoss = +hc.capLoss > 0 ? +hc.capLoss : 1000000;
  }
  /* ★ 2026-10-04：机器人总开关 —— 严格执行服务端下发值，前端不得自己打开。
     关时：公共牌桌不安排任何机器人陪坐（变成等真人的空桌），并强制关控水（没有机器人，控水也无从作用）。 */
  BOTS.on = !!(c && c.bots && c.bots.on !== false);
  if (!BOTS.on && typeof HOUSE !== 'undefined') HOUSE.on = false;
  if (typeof AI_THINK_MIN !== 'undefined') { AI_THINK_MIN = think.min; AI_THINK_MAX = Math.max(think.min + 200, think.max); }
  S.settings.fastAI = !!a.think.fast;
  if (typeof AI_CFG !== 'undefined') {
    Object.assign(AI_CFG, ai);
    /* ★ 2026-10-02：AI 强度档位（1 娱乐 ∼ 5 高压）由后台下发，skillCfg() 负责派生实际阈值 */
    var sk = Math.round(+((c && c.ai && c.ai.skill) || (a && a.ai && a.ai.skill) || AI_CFG.skill || 3));
    AI_CFG.skill = Math.max(1, Math.min(5, isFinite(sk) ? sk : 3));
  }
  /* ★★ 透视（天眼）开关：严格执行服务端下发值，前端不得自己打开。
     这是内部压测 / 演示能力，任何涉及真实资金的房间必须保持关闭。 */
  if (typeof ORACLE !== 'undefined') {
    var oc = (c && c.oracle) || {};
    ORACLE.on = !!oc.on;
    ORACLE.board = oc.board !== false;
    ORACLE.holes = oc.holes !== false;
    ORACLE.ally = !!oc.ally;
    var ur = +oc.useRate;
    ORACLE.useRate = (isFinite(ur) && ur > 0 && ur <= 1) ? ur : 0.85;
    if (!ORACLE.diag) ORACLE.diag = { used: 0, mc: 0, last: null };
  }
  /* 透视与控水互斥：两边都改牌序会让机器人拿到错的未来牌，开透视时强制关控水 */
  if (typeof HOUSE !== 'undefined' && typeof ORACLE !== 'undefined' && ORACLE.on) HOUSE.on = false;
  CHIP_PER_USDT = econ.chipPerUsdt;
  if (typeof MODES !== 'undefined') {
    Object.keys(MODES).forEach(function (k) {
      if (!MODES[k].rake) MODES[k].rake = { pct: 0.05, capBB: 3 };
      MODES[k].rake.pct = econ.rakePct; MODES[k].rake.capBB = econ.rakeCapBB;
      MODES[k].off = modes[k] === false;
    });
  }
  if (typeof RAKEBACK !== 'undefined') for (var i = 0; i < RAKEBACK.length; i++) RAKEBACK[i] = econ.rebate[i] != null ? econ.rebate[i] : RAKEBACK[i];
  /* ★ 2026-10-03：邀请好友奖励（USDT/人），后台「参数配置 → 邀请好友奖励」可调，默认 10 */
  INVITE_REWARD = Math.max(0, Math.round(+econ.inviteReward || 100));
  if (c && c.lobby) S.admin.lobby = Object.assign(S.admin.lobby || {}, c.lobby);
  applyAppAndTasks(c, a);
}
/* ★ 2026-10-02：把「APP 名称」与「任务 / 签到奖励」落到运行时。
   APP_NAME → 大厅顶栏；TASK_REWARD → 任务页展示。
   ★★ 任务奖励是**直接写回 `S.tasks[].reward`** 的 —— 领奖走的是同一个字段
     （见 misc.js：`S.user.chips += t.reward`），所以后台改完数值，玩家领到的就是新数值，
     不需要再改领奖代码，也避免了「显示 5 万、实际发 3 万」这种两套口径。 */
function applyAppAndTasks(c, a) {
  var appc = (c && c.app) || (a && a.app) || {};
  APP_NAME = String(appc.name || 'GU9').slice(0, 24) || 'GU9';
  /* ★ 2026-10-03：主 Logo —— 只接受本站 /assets/brand/logo-xxx 的地址，
     防止配置被塞进外链（加载别人的图 = 泄漏访问来源 / 被植入追踪像素）。 */
  var lg = String(appc.logo || '');
  APP_LOGO = /^\/?assets\/brand\/logo-[\w-]+\.(png|jpe?g|webp)$/i.test(lg) ? (lg.charAt(0) === '/' ? lg : lg) : '';
  /* 浏览器标签标题也跟着改，改名后一眼能看出来 */
  try { document.title = APP_NAME + ' · 德州扑克'; } catch (e) { }
  /* ★ 配置是异步拉到的，登录页可能已经渲染完了（/papi/config 回来得晚一点）。
     这里就地更新登录页的图与名字，不整屏重渲染（重渲染会清掉玩家已经输入的内容）。 */
  try {
    var logoUrl = APP_LOGO ? APP_LOGO + '?v=20261004l' : '';
    var limg = document.querySelector('.logo-mark img');
    if (limg) limg.src = logoUrl || 'assets/logo-full-light.png';
    var lt1 = document.querySelector('.logo-t1');
    if (lt1) lt1.textContent = APP_NAME + ' · TEXAS HOLD\'EM';
    var bim = document.querySelector('.brand-mark img');
    if (bim) bim.src = logoUrl || 'assets/logo-mark.png';
    /* ★ 大厅顶栏名字：大厅可能已先渲染（用默认 GU9），配置晚到后要就地同步，否则名字不更新 */
    var nms = document.querySelectorAll('[data-app-name]');
    Array.prototype.forEach.call(nms, function (el) { el.textContent = APP_NAME; });
  } catch (e) { }
  var tc = (c && c.tasks) || (a && a.tasks) || null;
  var signin = TASK_REWARD_DEFAULT.signin.slice();
  var rewards = Object.assign({}, TASK_REWARD_DEFAULT.rewards);
  var total = TASK_REWARD_DEFAULT.signinTotal;
  if (tc) {
    if (Array.isArray(tc.signin) && tc.signin.length) {
      signin = tc.signin.map(function (v) { var n = Math.round(+v); return (isFinite(n) && n >= 0) ? n : 0; });
    }
    if (tc.rewards && typeof tc.rewards === 'object') {
      Object.keys(tc.rewards).forEach(function (k) {
        var n = Math.round(+tc.rewards[k]);
        if (isFinite(n) && n >= 0) rewards[k] = n;
      });
    }
    var tn = Math.round(+tc.signinTotal);
    if (isFinite(tn) && tn >= 0) total = tn;
  }
  TASK_REWARD = { signin: signin, signinTotal: total, rewards: rewards };
  /* ★ 2026-10-03：任务已下线（rewards 为空表）—— 老玩家本地存档里残留的任务也一并清掉，
     否则旧数据会继续渲染出「每日任务 / 成长任务」区块。 */
  if (!Object.keys(rewards).length) { S.tasks = []; return; }
  if (Array.isArray(S.tasks)) {
    S.tasks.forEach(function (t) { if (rewards[String(t.id)] != null) t.reward = rewards[String(t.id)]; });
  }
}
function admLog(text) {
  if (!S.adminLog) S.adminLog = [];
  S.adminLog.unshift({ t: Date.now(), text: text });
  if (S.adminLog.length > 200) S.adminLog.length = 200;
}

/* ---------- 服务端 API（真实后端，配置/账号一律以服务端为准） ---------- */
var API_BASE = '/papi';
function apiTokenGet() { try { return localStorage.getItem('gu9_token') || ''; } catch (e) { return ''; } }
function apiTokenSet(t) { try { if (t) localStorage.setItem('gu9_token', t); else localStorage.removeItem('gu9_token'); } catch (e) { } }

function apiCall(path, opt) {
  opt = opt || {};
  var headers = { 'Content-Type': 'application/json' };
  var tk = apiTokenGet(); if (tk) headers.Authorization = 'Bearer ' + tk;
  if (typeof fetch !== 'function') return Promise.resolve({ code: 0, j: { ok: false, msg: 'no fetch' } });
  return fetch(API_BASE + path, {
    method: opt.method || 'GET', headers: headers,
    body: opt.body ? JSON.stringify(opt.body) : undefined
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) { return { code: r.status, j: j || {} }; });
  }).catch(function () { return { code: 0, j: { ok: false, msg: '网络不可用' } }; });   /* 0 = 离线 */
}
/* 登录 / 注册：成功则写 token 并把服务端用户资料灌进 S.user */
function apiLogin(acc, pwd) {
  return apiCall('/auth/login', { method: 'POST', body: { acc: acc, pwd: pwd } }).then(function (r) {
    if (r.code === 200 && r.j && r.j.token) {
      apiTokenSet(r.j.token); applyServerUser(r.j.user); S.logged = true;
      /* ★ 2026-10-03 修「建房间时好友列表是空的」：以前只有「带着 token 启动页面」
         这一条路径会拉好友（app.js boot），本次会话里现登录进来的账号永远不拉 ——
         于是建房第 2 步一个好友都列不出来，勾不到人 → 一条邀请都发不出去，
         界面还照样弹「房间创建成功」。登录成功必须立刻拉好友 + 挂上邀请轮询。 */
      /* ★ 2026-10-03 多语言：账号自身带的语言优先于本机上次的选择 */
      if (window.I18N) I18N.fromUser(r.j.user);
      return loadFriends().then(function () { startFriendPoll(); refreshRoomInvites(); return r; });
    }
    return r;
  });
}
/* ★ 2026-10-03：ref = 推荐人 ID/账号（选填），服务端据此给推荐人发邀请奖励 */
function apiRegister(acc, pwd, name, ref, cc, phone) {
  /* ★ 2026-10-03：注册新增手机号（cc=区号 +86/+1，phone=纯数字），服务端存 user.phone */
  /* ★ 2026-10-03 多语言：美国手机号（+1）注册的账号默认英文，其它跟随当前界面语言 */
  var _lang = (window.I18N && I18N.fromPhone(cc)) || (window.I18N ? I18N.get() : 'zh-CN');
  /* ★ 2026-10-07：设备指纹（localStorage gu9_did，首次生成后长期不变）随注册上报 ——
     服务端据此做「同一设备最多发 N 次注册赠送」的防刷口径。拿不到（隐私模式等）不影响注册。 */
  var _did = '';
  try {
    _did = localStorage.getItem('gu9_did') || '';
    if (!_did) { _did = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('gu9_did', _did); }
  } catch (e) { _did = ''; }
  return apiCall('/auth/register', { method: 'POST', body: { acc: acc, pwd: pwd, name: name || acc, ref: ref || '', cc: cc || '', phone: phone || '', lang: _lang, did: _did } }).then(function (r) {
    if (r.code === 200 && r.j && r.j.token) {
      apiTokenSet(r.j.token); applyServerUser(r.j.user); S.logged = true;
      if (window.I18N) I18N.fromUser(r.j.user);
      return loadFriends().then(function () { startFriendPoll(); refreshRoomInvites(); return r; });
    }
    return r;
  });
}
/* 把界面语言写回服务端账号（换手机 / 清缓存后还能保持） */
function apiSetLang(lang) {
  if (!apiTokenGet()) return Promise.resolve({ code: 0 });
  return apiCall('/me/lang', { method: 'POST', body: { lang: String(lang || '') } });
}
/* 玩家每次切换语言都同步到服务端账号（已登录时），换设备也能保持 */
if (window.I18N) {
  I18N.onChange(function (lang) { try { if (S && S.logged) apiSetLang(lang); } catch (e) { } });
}
function applyServerUser(u) {
  if (!u) return;
  if (!S.user) initData();
  S.user = Object.assign({}, S.user, {
    id: u.id, name: u.name, color: u.color, level: u.level, vip: u.vip,
    /* ★ 2026-10-03：头像（玩家上传的图片 URL 或 sys:N 预设）；空 = 用程序化头像 */
    avatar: u.avatar || '',
    /* ★ 2026-10-05 USDT 化：bal = USDT 余额（单位「分」），usdt = 元（展示用），两者同源。 */
    bal: Math.max(0, Math.round(+u.bal || 0)),
    chips: Math.max(0, Math.round(+u.bal || 0)),
    usdt: Math.round((+u.usdt || 0) * 100) / 100,
    practice: Math.max(0, Math.round(+u.practice || 0)),
    diamonds: u.diamonds, vipExpire: u.vipExpire || 0,
    tablePaid: Math.max(0, Math.round(+u.tablePaid || 0)),
    tableCashed: Math.max(0, Math.round(+u.tableCashed || 0)),
    tableBank: Math.max(0, Math.round(+u.tableBank || 0)),
    cashable: Math.max(0, Math.round(+u.cashable || 0)),
    riskFlag: Math.max(0, Math.round(+u.riskFlag || 0)),
    hasPaypwd: u.hasPaypwd !== undefined ? !!u.hasPaypwd : (S.user ? S.user.hasPaypwd : true),
    /* ★ 2026-10-05：手机号 / 注册天数一律用服务端真实值。
       以前这两项沿用 initData() 的本地兜底假数据（138****6621 / 431 天），
       新注册的号会显示「注册 431 天」「已绑定手机」，属于明显的假数据。 */
    phone: (typeof u.phone === 'string' && u.phone) ? u.phone : '',
    createdAt: Math.max(0, Math.round(+u.createdAt || 0)),
    regDays: Math.max(0, Math.round(+u.createdAt || 0)) ? Math.max(0, Math.floor((Date.now() - Math.round(+u.createdAt)) / 86400000)) : 0,
    /* ★ 2026-10-03：签到进度（连续第几天 / 上次签到日 0 点时间戳），任务页用来点亮格子 */
    signin: (u.signin && typeof u.signin === 'object') ? { day: +u.signin.day || 0, last: +u.signin.last || 0 } : (S.user && S.user.signin) || { day: 0, last: 0 },
    /* ★ 2026-10-03：已成功邀请人数（邀请页展示） */
    inviteCount: Math.max(0, Math.round(+u.inviteCount || 0)),
    /* ★ 2026-10-05：手数 / 净盈亏 / 赢下底池 用服务端真实统计，
       替换掉 initData() 里写死的 18462 手 / 3862400 盈利 这类假数据。 */
    stat: (u.stat && typeof u.stat === 'object')
      ? { hands: Math.max(0, Math.round(+u.stat.hands || 0)), net: Math.round(+u.stat.net || 0), win: Math.max(0, Math.round(+u.stat.win || 0)), daily: (u.stat.daily && typeof u.stat.daily === 'object') ? u.stat.daily : {}, log: Array.isArray(u.stat.log) ? u.stat.log : [] }
      : { hands: 0, net: 0, win: 0, daily: {}, log: [] },
    hands: (u.stat && typeof u.stat === 'object') ? Math.max(0, Math.round(+u.stat.hands || 0)) : 0,
    profit: (u.stat && typeof u.stat === 'object') ? Math.round(+u.stat.net || 0) : 0
  });
  /* 服务端发货的物品（赛事门票）同步进背包；按 id 去重，避免每次 /me 重复插入 */
  if (Array.isArray(u.items) && u.items.length) {
    if (!S.inventory) S.inventory = [];
    var seen = {};
    S.inventory.forEach(function (it) { seen[it.id] = 1; });
    u.items.forEach(function (it) {
      if (!it || seen[it.id]) return;
      seen[it.id] = 1;
      S.inventory.push({
        id: it.id, name: it.name || '赛事门票', icon: '🎫',
        n: it.n || 1, type: it.type || 'item', desc: it.desc || '订单发货'
      });
    });
  }
  S.logged = true;
  saveState();
}
function apiMe() {
  return apiCall('/me').then(function (r) { if (r.code === 200 && r.j && r.j.user) applyServerUser(r.j.user); return r; });
}
/* 把本机余额 / 统计回写到服务端（节流 2 秒） */
var __syncTimer = null;
function apiSync() {
  if (!apiTokenGet() || !S.user) return;
  clearTimeout(__syncTimer);
  __syncTimer = setTimeout(function () {
    apiCall('/me/sync', {
      method: 'POST',
      /* ★★ 2026-10-02：牌桌余额一并回写。apiSync() 以前「只定义、零调用」，
         牌桌赢的钱只躺在 localStorage 里，换台设备就蒸发、服务端也无从校验。 */
      body: {
        /* ★ 2026-10-05：全站 USDT 化 —— 余额 / 牌桌账一律服务端权威，客户端不得上报。
           练习币（practice）已全站下线，这里也不再回写，避免把客户端本地的脏数字刷进服务端。 */
        diamonds: S.user.diamonds || 0,
        tablePaid: Math.max(0, Math.round(+S.user.tablePaid || 0)),
        tableCashed: Math.max(0, Math.round(+S.user.tableCashed || 0)),
        tableBank: Math.max(0, Math.round(+S.user.tableBank || 0)),
        stat: { hands: (S.user.stat && S.user.stat.hands) || 0, net: (S.user.stat && S.user.stat.net) || 0, win: (S.user.stat && S.user.stat.win) || 0 }
      }
    });
  }, 2000);
}
/* 启动拉取服务端配置（机器人 / 经济 / 大厅 / 玩法开关 / 支付风控），覆盖本地默认值 */
function fetchServerConfig() {
  return apiCall('/config').then(function (r) {
    if (r.code === 200 && r.j && r.j.config) {
      S.serverCfg = r.j.config;
      if (r.j.config.pay) S.payCfg = r.j.config.pay;   /* 支付与风控参数（不含任何地址/密钥） */
      applyAdmin();
      /* ★ 2026-10-04：服务端配置晚于首屏到达时（先按本地旧开关画了内置三张 Banner），
         原地重画轮播，换成后台「Banner 管理」配的图。lobby.js 已抽成 lobbyRepaintBanner()。 */
      if (typeof lobbyRepaintBanner === 'function') lobbyRepaintBanner();
      return true;
    }
    return false;
  });
}

/* ---------- 好友（真实玩家） ----------
   后端 /papi/friends* 全部要求玩家会话，返回的每一项都是公开信息（**不含余额**）。
   S.friends / S.requests / S.outgoing / S.blocked 是四个列表的本地镜像：
   界面只读镜像；任何增删一律「先调接口，成功后整体刷新」，不在本地自己改数组，
   否则本地和服务端会各说各话。 */
function friendFromApi(f) {
  return {
    id: f.id, name: f.name, color: f.color, level: f.level, vip: f.vip,
    status: f.online ? 'online' : 'offline',
    last: f.lastLogin || 0, hands: f.hands || 0,
    regDays: f.createdAt ? Math.max(0, Math.floor((Date.now() - f.createdAt) / 86400000)) : 0,
    note: f.note || '', rel: f.rel || 'friend'
  };
}
function apiFriends() { return apiCall('/friends'); }
function apiFriendSearch(q) { return apiCall('/friends/search?q=' + encodeURIComponent(q)); }
function apiFriendReq(id, note) { return apiCall('/friends/req', { method: 'POST', body: { to: String(id), note: note || '' } }); }
function apiFriendAccept(id) { return apiCall('/friends/accept', { method: 'POST', body: { id: String(id) } }); }
function apiFriendReject(id) { return apiCall('/friends/reject', { method: 'POST', body: { id: String(id) } }); }
function apiFriendDel(id) { return apiCall('/friends/del', { method: 'POST', body: { id: String(id) } }); }
function apiFriendBlock(id, on) { return apiCall('/friends/block', { method: 'POST', body: { id: String(id), on: on !== false } }); }
/* ★ 2026-10-03：好友私信（真实消息）。服务端存到对方收件箱，对方客户端随好友轮询拉到并弹提示。 */
function apiFriendMsg(to, text) { return apiCall('/friends/msg', { method: 'POST', body: { to: String(to), text: String(text || '') } }); }
/* 私信「已读」水位：localStorage 持久化（uid → 已见到的最大 ts），刷新后不重播老消息 */
function p2pSeenGet() { try { return JSON.parse(localStorage.getItem('poker_p2p_seen') || '{}') || {}; } catch (e) { return {}; } }
function p2pSeenSet(o) { try { localStorage.setItem('poker_p2p_seen', JSON.stringify(o || {})); } catch (e) { } }
function p2pMarkSeen(uid, ts) {
  var s = p2pSeenGet(); if ((s[uid] || 0) >= ts) return;
  s[uid] = ts; p2pSeenSet(s);
}

/* ===== 房间：真实房间 + 邀请必须同意（2026-10-02）=====
   ★★ 2026-10-03 修：这行注释头原本少了收口符（星号斜杠），把下面整段 apiRoom* 函数
   （apiRoomCreate / apiRoomInvite / apiRoomAccept …）全部吞进注释里了 ——
   语法检查能过（注释在后面才闭合），但运行时报 apiRoomCreate is not defined，
   点「创建并进入」永远卡在「创建中…」，且服务端根本收不到请求。 */
function apiRoomCreate(o) { return apiCall('/rooms/create', { method: 'POST', body: o || {} }); }
/* ★ 2026-10-05：机器人房入口。全站没有「练习币」——机器人桌也是真钱 USDT，
   由服务端发牌 + 服务端 bot 陪打（客户端改不了任何数字）。
   只会匹配 botFill=true 的房间，真人的自建房 / 好友房永不参与。 */
function apiQuickStart(o) { return apiCall('/rooms/quickstart', { method: 'POST', body: o || {} }); }
function apiRoomList() { return apiCall('/rooms/list'); }
function apiRoomMine() { return apiCall('/rooms/mine'); }
function apiRoomInvites() { return apiCall('/rooms/invites'); }
function apiRoomDetail(no) { return apiCall('/rooms/detail?no=' + encodeURIComponent(no)); }
function apiRoomJoin(no, pwd) { return apiCall('/rooms/join', { method: 'POST', body: { no: String(no), passwd: pwd || '' } }); }
function apiRoomLeave(no) { return apiCall('/rooms/leave', { method: 'POST', body: { no: String(no) } }); }
function apiRoomClose(no) { return apiCall('/rooms/close', { method: 'POST', body: { no: String(no) } }); }
function apiRoomInvite(no, uid) { return apiCall('/rooms/invite', { method: 'POST', body: { no: String(no), uid: String(uid) } }); }
function apiRoomAccept(no) { return apiCall('/rooms/invite/accept', { method: 'POST', body: { no: String(no) } }); }
function apiRoomDecline(no) { return apiCall('/rooms/invite/decline', { method: 'POST', body: { no: String(no) } }); }
/* 房主管理（2026-10-02）：以前这四件事全在本地做 —— 改密码改的是界面上的字符串、
   转让房主只是自己走了、踢人对方还稳稳坐在服务端座位上、解散只是自己退出房间。
   现在一律打到服务端，房间形态以服务端为准。 */
/* ===== 大厅房间同步（2026-10-03）=====
   ★ 修「我建好的房间在大厅里不显示」：S.tables 是 initData() 现造的 26 张本地随机桌，
     而且**不落盘**（saveState 没存 tables）→ 页面一刷新就重新随机一套，
     建好的房间只在创建那一刻被 unshift 进去，刷新后凭空消失，
     但它在服务端还好好的（/rooms/mine 一直能查到）。
   现在：进大厅 / 点刷新 / 从牌桌返回都拉一次
     · /rooms/mine —— 我建的、我在里面的、**别人邀请我的**（含 pending）
     · /rooms/list —— 别人的公开房
   同步进 S.tables；服务端已经没有的房间号从列表里剔掉，免得留下一堆
   点进去就 404 的幽灵房。 */
var ROOM_SYNC_AT = 0;
function syncServerRooms(cb) {
  var done = function (v) { if (cb) cb(v); return v; };
  if (!apiTokenGet()) return Promise.resolve(done(false));
  return Promise.all([apiRoomMine(), apiRoomList()]).then(function (rs) {
    var mine = (rs[0].code === 200 && rs[0].j && rs[0].j.list) ? rs[0].j.list : null;
    var pub = (rs[1].code === 200 && rs[1].j && rs[1].j.list) ? rs[1].j.list : [];
    if (!mine) return done(false);                 /* 拉不到就别动本地列表（离线降级） */
    var all = mine.concat(pub), seen = {};
    all.forEach(function (rm) {
      if (!rm) return;
      seen[String(rm.no)] = 1;
      upsertRoomTable(rm);                          /* 已存在则更新（座位/人数会变） */
    });
    /* 剔掉服务端已经没有的房间（解散 / 过期 / 我退出了） */
    S.tables = (S.tables || []).filter(function (t) { return !t.roomNo || seen[String(t.roomNo)]; });
    ROOM_SYNC_AT = Date.now();
    return done(true);
  });
}
/* 房间邀请收件箱（好友端「谁邀请了我」）—— 供导航栏红点 / 大厅横幅用 */
function refreshRoomInvites() {
  if (!apiTokenGet()) { S.roomInvites = []; return Promise.resolve([]); }
  return apiRoomInvites().then(function (r) {
    return applyRoomInvites((r.code === 200 && r.j && r.j.list) ? r.j.list : [], { toast: false });
  });
}
/* ★★ 2026-10-03 夜修「邀请了但好友那边不显示」的最后一环：
   以前邀请拉回来只是往 S.roomInvites 一塞就完事，界面（大厅横幅 / 底栏红点 / 牌桌列表）
   全靠「进大厅那一瞬间」渲染一次。好友端如果已经停在大厅，邀请到达后
   只会闪一条 3 秒的 toast，横幅永远不再出现 —— 玩家看到的就是「根本没收到」。
   现在所有入口统一走这里：更新数据 → 刷红点 → 有新条目就 toast + 立刻重画大厅横幅和列表。 */
function applyRoomInvites(list, opt) {
  opt = opt || {};
  var prev = S.roomInvites || [], seen = {};
  prev.forEach(function (it) { seen[String(it.no)] = 1; });
  S.roomInvites = list || [];
  navBadgeRefresh();
  var fresh = S.roomInvites.filter(function (it) { return !seen[String(it.no)]; });
  /* 重画大厅横幅（不在大厅就自动跳过） */
  lobbyRenderInvites();
  if (!fresh.length) return S.roomInvites;
  if (opt.toast !== false) {
    toast((fresh[0].fromName || '好友') + ' 邀请你进房间 ' + fresh[0].no +
      (fresh.length > 1 ? ' 等 ' + fresh.length + ' 条' : ''), 'ok', 4200);
  }
  /* 被邀请的房间要立刻出现在大厅列表里（以前只躺在好友页，大厅完全看不到） */
  syncServerRooms(function () {
    if (Route.cur === 'lobby') { lobbyRenderTables(); lobbyRenderInvites(); }
  });
  if (Route.cur === 'friends' && !frSearching()) go('friends', {}, { noHist: true });
  return S.roomInvites;
}
/* 邀请是强实时需求（建房的人正等着你进来），但服务端没有 WS 推送。
   好友列表/私信 45 秒一轮太慢，这里给邀请单独开一条 8 秒的轻轮询：
   只打 /rooms/invites（一个几百字节的接口），页面不可见时不打，切回前台立刻打一次。 */
var RI_POLL_MS = 8000;
var RI_POLL_ON = false;
function roomInvitePoll(opt) {
  if (!S.logged || !S.user || !apiTokenGet()) return Promise.resolve([]);
  if (document.visibilityState && document.visibilityState !== 'visible') return Promise.resolve(S.roomInvites || []);
  return apiRoomInvites().then(function (r) {
    if (r.code !== 200) return S.roomInvites || [];
    return applyRoomInvites((r.j && r.j.list) ? r.j.list : [], opt);
  });
}
function startRoomInvitePoll() {
  if (RI_POLL_ON) return; RI_POLL_ON = true;
  setInterval(function () { roomInvitePoll(); }, RI_POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') roomInvitePoll();
  });
}

function apiRoomKick(no, uid) { return apiCall('/rooms/kick', { method: 'POST', body: { no: String(no), uid: String(uid) } }); }
function apiRoomOwner(no, uid) { return apiCall('/rooms/owner', { method: 'POST', body: { no: String(no), uid: String(uid) } }); }
function apiRoomSettings(no, o) { return apiCall('/rooms/settings', { method: 'POST', body: Object.assign({ no: String(no) }, o || {}) }); }

/* ===== 转账 / 邮件 / 工单 / 举报 / 流水 / 牌局（2026-10-02 补齐服务端能力）=====
   ★ 以前转账只扣自己的USDT（对方一分收不到，手续费凭空蒸发）、任务奖励本地加钱，
     配上 /me/sync 信任客户端余额，是一条零成本刷USDT的路子。现在全部走服务端记账。 */
function apiTransfer(uid, chips, note) { return apiCall('/wallet/transfer', { method: 'POST', body: { to: String(uid), chips: chips, note: note || '' } }); }
function apiPaypwdSet(pwd) { return apiCall('/paypwd/set', { method: 'POST', body: { pwd: String(pwd) } }); }
function apiLedger() { return apiCall('/ledger'); }
function apiMails() { return apiCall('/mails'); }
function apiMailRead(id) { return apiCall('/mails/read', { method: 'POST', body: { id: String(id) } }); }
function apiMailClaim(id) { return apiCall('/mails/claim', { method: 'POST', body: { id: String(id) } }); }
function apiTaskClaim(id) { return apiCall('/tasks/claim', { method: 'POST', body: { id: String(id) } }); }
function apiSignin() { return apiCall('/signin', { method: 'POST' }); }
/* ★ 2026-10-03：头像（选系统预设 / 上传图片，服务端存文件并回写 user.avatar）与改名（服务端校验重名） */
function apiSetAvatarSys(sel) { return apiCall('/me/avatar', { method: 'POST', body: { avatar: sel } }); }
function apiSetAvatarUpload(name, data) { return apiCall('/me/avatar', { method: 'POST', body: { name: name, data: data } }); }
function apiRename(name) { return apiCall('/me/rename', { method: 'POST', body: { name: name } }); }
function apiRank(by) { return apiCall('/rank?by=' + encodeURIComponent(by || 'net')); }
function apiHandReport(o) { return apiCall('/hands/report', { method: 'POST', body: o || {} }); }
function apiTicketCreate(o) { return apiCall('/tickets/create', { method: 'POST', body: o || {} }); }
function apiTicketsMine() { return apiCall('/tickets/mine'); }
function apiTicketReply(id, text) { return apiCall('/tickets/reply', { method: 'POST', body: { id: String(id), text: text } }); }
function apiReportCreate(o) { return apiCall('/reports/create', { method: 'POST', body: o || {} }); }

/* 拉取四个列表写进本地镜像；cb(ok) 用来触发界面重绘 */
function loadFriends(cb) {
  if (!apiTokenGet()) { if (cb) cb(false); return Promise.resolve(false); }
  return apiFriends().then(function (r) {
    var done = function (okv) { if (cb) cb(okv); return okv; };
    if (r.code !== 200 || !r.j || !r.j.ok) return done(false);
    S.friends = (r.j.friends || []).map(friendFromApi);
    S.requests = (r.j.incoming || []).map(friendFromApi);
    S.outgoing = (r.j.outgoing || []).map(friendFromApi);
    S.blocked = (r.j.blocked || []).map(friendFromApi);
    /* ★ 2026-10-03：把服务端收件箱里的好友私信并进本地会话。
       key = from|ts 去重；超过「已读水位」的算新消息 → 弹 toast + 点亮聊天红点。
       轮询（friendPoll → loadFriends，45 秒/次 + 切前台立刻拉）就承担了「在线提示」：
       不用 WebSocket，最多延迟一个轮询周期。 */
    var inbox = r.j.inbox || [], fresh = [];
    inbox.forEach(function (m) {
      var uid = String(m.from), key = uid + '|' + m.ts;
      var arr = S.chats.p2p[uid] = S.chats.p2p[uid] || [];
      var dup = arr.some(function (x) { return x.key === key; });
      if (!dup) arr.push({ id: m.ts, key: key, uid: uid, name: m.fromName || '好友', color: m.fromColor || '#3b8cff', text: m.text, ts: m.ts });
      if ((p2pSeenGet()[uid] || 0) < m.ts && !dup) fresh.push({ uid: uid, name: m.fromName || '好友', text: m.text, ts: m.ts });
    });
    if (fresh.length) {
      fresh.sort(function (a, b) { return a.ts - b.ts; });
      var f0 = fresh[0];
      toast(f0.name + '：' + String(f0.text).slice(0, 24) + (fresh.length > 1 ? '（共 ' + fresh.length + ' 条新消息）' : ''), 'ok', 3600);
      var dot = $('#tb-chat-dot'); if (dot) dot.style.display = 'block';
    }
    return done(true);
  });
}

/* ===== 好友 / 邀请「到达即提示」（2026-10-02）=====
   ★★ 服务端没有 WS 推送，以前只有「点进好友页」那一刻才拉一次列表。
   于是好友挂在前台时，别人发来申请 / 邀请，界面纹丝不动 ——
   用户实测就是「加了好友，对方那边不显示」（其实对方根本不知道有事发生）。
   这里每 45 秒（**仅页面可见时**）拉一次，只对**新出现**的条目弹 toast，
   老条目绝不重播；要重画也只在不搜索的时候重画，免得把搜索框里打了一半的字清掉。 */
var FR_POLL_MS = 45000;
var FR_POLL_ON = false;                 /* 幂等开关：见 startFriendPoll */
var FR_SEEN = { req: {}, room: {} };
function friendMarkSeen() {
  FR_SEEN.req = {}; (S.requests || []).forEach(function (f) { FR_SEEN.req[String(f.id)] = 1; });
  FR_SEEN.room = {};
}
function friendPoll() {
  if (!S.logged || !S.user || !apiTokenGet()) return Promise.resolve(false);
  return loadFriends().then(function (ok) {
    if (!ok) return false;
    var news = (S.requests || []).filter(function (f) { return !FR_SEEN.req[String(f.id)]; });
    news.forEach(function (f) {
      FR_SEEN.req[String(f.id)] = 1;
      toast((f.name || '有人') + ' 想加你为好友', 'ok', 3200);
    });
    /* ★ 搜索框里有字就别整页重建（会把输入清掉），只让 tab 计数跟上 */
    if (news.length && Route.cur === 'friends' && !frSearching()) {
      go('friends', {}, { noHist: true });
    }
    /* 邀请统一交给 applyRoomInvites（刷红点 + toast + 重画大厅横幅），
       这条 45 秒的链路只当兜底，实时性由 8 秒的 startRoomInvitePoll 负责。 */
    return roomInvitePoll();
  });
}
function frSearching() {
  var el = document.querySelector('#fr-kw');
  return !!el && String(el.value || '').trim() !== '';
}
function startFriendPoll() {
  /* ★ 2026-10-03：以前只有「带 token 启动」这一条路径才挂轮询。
     本次会话里现注册 / 现登录进来的账号（最常见的两个号互测场景）永远不会挂上，
     于是好友端永远收不到邀请提示。改成幂等：谁先调谁挂，重复调用直接返回。 */
  if (FR_POLL_ON) return; FR_POLL_ON = true;
  startRoomInvitePoll();        /* 邀请单独 8 秒一轮，不等这边的 45 秒 */
  friendMarkSeen();
  setInterval(function () { if (document.visibilityState === 'visible') friendPoll(); }, FR_POLL_MS);
  /* 从微信/后台切回前台立刻拉一次 —— 真机上这才是「及时」的主要来源 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') friendPoll();
  });
}

/* ---------- 钱包 / 订单：充值 · 提现 · 六态订单 ----------
   ★ 后端只做业务骨架（下单、六态、审批、限额、审计）。
     收款地址由持牌运营方的 PSP / 托管钱包下发，本前端不生成、不显示任何写死的资金地址。 */
function apiWalletQuote() {
  return apiCall('/wallet/quote').then(function (r) {
    if (r.code === 200 && r.j) { S.walletQuote = r.j; if (r.j.pay) S.payCfg = r.j.pay; }
    return r;
  });
}
function apiDeposit(chips, net) {
  return apiCall('/wallet/deposit', { method: 'POST', body: { chips: chips, net: net } });
}
/* ★ 提现提交的是「USDT 金额」—— USDT必须先兑换成 USDT 余额才能提 */
function apiWithdraw(usdt, address, net, pwd) {
  return apiCall('/wallet/withdraw', { method: 'POST', body: { usdt: usdt, address: address, net: net, pwd: String(pwd || '') } });
}
/* ★ USDT兑 USDT（免费，1 USDT = CHIP_PER_USDT USDT）→ 进 USDT 余额，才能提现 */
function apiExchange(chips) {
  return apiCall('/wallet/exchange', { method: 'POST', body: { chips: chips } });
}
/* ★ USDT 余额 → USDT（U 兑USDT）：把账户里已有的 USDT 余额转成可玩USDT，免费、即时 */
function apiUsdt2Chips(usdt) {
  return apiCall('/wallet/usdt2chips', { method: 'POST', body: { usdt: usdt } });
}
function apiMyOrders() { return apiCall('/wallet/orders'); }
function apiSetTxid(id, txid) { return apiCall('/wallet/txid', { method: 'POST', body: { id: id, txid: txid } }); }
function apiCancelOrder(id) { return apiCall('/wallet/order/' + id + '/cancel', { method: 'POST' }); }
/* 订单六态文案（与后端 OSTATES 保持一致） */
var ORDER_STATUS = {
  pending: '待审核', frozen: '已冻结', approved: '已通过',
  rejected: '已驳回', refunded: '已退回', completed: '已完成'
};

var STORE_KEY = 'poker_ui_state_v1';
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      user: S.user, settings: S.settings, friends: S.friends, inventory: S.inventory,
      transferLogs: S.transferLogs, tasks: S.tasks, admin: S.admin, adminLog: S.adminLog
    }));
  } catch (e) { }
}
function loadState() {
  try {
    var raw = localStorage.getItem(STORE_KEY); if (!raw) return false;
    var o = JSON.parse(raw); if (!o || !o.user) return false;
    S.user = o.user; if (o.settings) S.settings = Object.assign(S.settings, o.settings);
    if (o.friends) S.friends = o.friends; if (o.inventory) S.inventory = o.inventory;
    if (o.transferLogs) S.transferLogs = o.transferLogs; if (o.tasks) S.tasks = o.tasks;
    if (o.admin) S.admin = Object.assign(defaultAdmin(), o.admin);
    if (o.adminLog) S.adminLog = o.adminLog;
    S.logged = true; return true;
  } catch (e) { return false; }
}

function initData() {
  S.user = {
    id: '8827361', name: '牌桌浪人', color: '#f5c352', level: 0, vip: 0, vipExp: 0, vipNext: 0,
    /* ★ 2026-10-03：本地兜底账号也不再自带USDT —— 一律 0 起步（注册不送USDT） */
    /* ★ 2026-10-05：兜底账号不再自带任何「热闹」的假数据（门票/经验一律 0） */
    chips: 0, usdt: 0, tickets: 0, exp: 0, avatar: '',
    /* 牌桌独立记账：买入桌上的本金 / 已从桌取回 / 当前桌上余额（见 table.js 的 tbCanCash） */
    tablePaid: 0, tableCashed: 0, tableBank: 0,
    phone: '', country: '中国', signature: '',
    vpip: 0, pfr: 0, wtsd: 0, wsd: 0, hands: 0, winRate: 0, profit: 0,
    avatarFrame: 'gold', gender: '', regDays: 0, stat: { hands: 0, net: 0, win: 0 }
  };
  /* ★ 好友不再是本地假数据。
     以前这里会凭空造 22 个好友 + 3 条申请 + 1 个黑名单（mkUser 随机生成），
     点「加好友」也是当场变一个人出来 —— 看着热闹，其实一个真人都没有。
     现在四个列表一律由 /papi/friends 的真实玩家填充（见 loadFriends）。
     新账号就是空的：空状态比假好友诚实。 */
  S.friends = []; S.requests = []; S.outgoing = []; S.blocked = [];

  S.chats.world = [];   /* ★ 不再灌假的世界频道消息（以前 5 条假人聊天） */
  S.chats.table = [];

  S.mails = [];   /* ★ 邮件由服务端 inbox 驱动，本地不再造假邮件（含假附件） */

  /* ★ 2026-10-03：任务列表清空 —— 「我的 → 任务」页只保留每日签到，不再有任何任务奖励。 */
  S.tasks = [];

  S.achievements = [
    { id: 1, name: '初出茅庐', desc: '完成 100 手牌', got: false, icon: 'star' },
    { id: 2, name: '同花顺大师', desc: '做出 10 次同花顺', got: false, icon: 'cards' },
    { id: 3, name: '百万富翁', desc: '累计盈利 100 万', got: false, icon: 'coin' },
    { id: 4, name: '万人斩', desc: '赢下 1000 个底池', got: false, icon: 'trophy' },
    { id: 5, name: '皇家同花顺', desc: '做出皇家同花顺', got: false, icon: 'crown' },
    { id: 6, name: '扑克之神', desc: '连赢 10 局', got: false, icon: 'bolt' },
    { id: 7, name: '社交达人', desc: '添加 50 位好友', got: false, icon: 'users' },
    { id: 8, name: '赛事冠军', desc: '获得一次 MTT 冠军', got: false, icon: 'fire' }
  ];

  S.inventory = [];

  S.transferLogs = [];

  var modeKeys = ['nlh', 'nlh', 'plo', 'nlh', 'short', 'omaha8', 'aof', 'rush', 'plo5', 'nlh', 'hu', 'pineapple', 'nlh', 'plo', 'sng', 'mtt', 'spin', 'nlh'];
  /* ★ 2026-10-07：大厅桌的盲注也走后台配置的档位（后台 → 参数配置 → 盲注级别）。
     以前这里写死 [0.05,0.1,0.25,0.5,1,2,5]，于是「快速开始」按这张表建的机器人房
     还是旧的小额盲注（改了档位却看不到变化）—— 现在跟后台配置同源。 */
  var sbList = (typeof blindLevels === 'function')
    ? blindLevels().map(function (b) { return b.sb; })
    : (typeof BLINDS_FALLBACK !== 'undefined'
      ? BLINDS_FALLBACK.map(function (s) { return parseFloat(String(s).split('/')[0]); })
      : [1, 2, 5, 10, 25, 50, 100]);
  S.tables = [];
  for (var t = 0; t < 26; t++) {
    var key = modeKeys[t % modeKeys.length];
    S.tables.push(mkTableData(key, pick(sbList)));
  }
  S.rank = [];   /* ★ 排行榜不再造 20 个假玩家（服务端没有排行榜接口） */
}

/* ---------- 头像 ----------
   ★ 2026-10-03（用户要求）：机器人也要有头像。
     方案：任何没有自定义图片的账号，都用**按名字哈希程序化生成的卡通头像**（零外部资源、
     不联网、同一个名字永远同一张脸），机器人因此各自有稳定且不重样的头像；
     玩家可以上传自己的图片（u.avatar = `/assets/avatars/xxx.jpg`），
     也可以选系统预设（u.avatar = `sys:3`，即用固定种子生成第 3 号脸）。 */
var AV_SKIN = ['#f6d3b3', '#eab391', '#d99a6c', '#b97a4e', '#8d5730', '#fbe3cb'];
var AV_HAIR = ['#241a12', '#4a3020', '#7c4f24', '#c9a02a', '#5b5f66', '#8e2f2f'];
var AV_SHIRT = ['#3b8cff', '#2ecc71', '#ff5a5f', '#a06bff', '#ff9f43', '#00c2d1', '#f5c352', '#7bd44b', '#e06ba8', '#5b6bff'];
var AV_BG = ['#2b3a4d', '#3a3350', '#2f4a3f', '#4a3a3a', '#33475c', '#3d3b2f', '#2c3f52', '#453049'];
function avHash(s) {
  s = String(s || 'gu9');
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h >>> 0;
}
/* 生成 40×40 的卡通头像 SVG（seed 决定五官/发色/衣服，同 seed 永远同一张脸） */
function botAvatarSVG(u, seed) {
  var h = avHash(seed || (u && (u.name || u.id)) || 'gu9');
  /* ★ 位移一律用无符号右移 >>>：h 可能 ≥ 2^31，用 >> 会得到负数 → 负数取模 → 索引越界 → undefined 颜色 */
  var skin = AV_SKIN[h % AV_SKIN.length];
  var hair = AV_HAIR[(h >>> 4) % AV_HAIR.length];
  var shirt = AV_SHIRT[(h >>> 8) % AV_SHIRT.length];
  var bg = AV_BG[(h >>> 12) % AV_BG.length];
  var style = (h >>> 16) % 4;          /* 0 短发 · 1 板寸 · 2 长发 · 3 帽子 */
  var glasses = ((h >>> 18) % 3) === 0;
  var beard = ((h >>> 20) % 4) === 0;
  var cap = AV_SHIRT[(h >>> 22) % AV_SHIRT.length];
  var s = '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">';
  s += '<circle cx="20" cy="20" r="20" fill="' + bg + '"/>';
  s += '<path d="M0 20a20 20 0 0 0 40 0z" fill="#000" opacity=".12"/>';
  /* 肩膀 / 衣服 */
  s += '<path d="M6.5 41c0-8.2 6-12.6 13.5-12.6S33.5 32.8 33.5 41z" fill="' + shirt + '"/>';
  s += '<path d="M17 28.4h6v12.6h-6z" fill="#ffffff" opacity=".14"/>';    /* 衣领 */
  /* 脖子 + 头 */
  s += '<rect x="17.6" y="22.5" width="4.8" height="6" rx="2.4" fill="' + shade(skin, -28) + '"/>';
  s += '<circle cx="20" cy="17" r="8" fill="' + skin + '"/>';
  /* 发型 */
  if (style === 0) {
    s += '<path d="M12 16.8a8 8 0 0 1 16 0c-1.4-3.6-4.4-5.6-8-5.6s-6.6 2-8 5.6z" fill="' + hair + '"/>';
    s += '<path d="M12.2 16.5c-.4 2.4-.2 4 .4 4.8.9-1.3 1.3-3 1.5-4.7z" fill="' + hair + '"/>';
    s += '<path d="M27.8 16.5c.4 2.4.2 4-.4 4.8-.9-1.3-1.3-3-1.5-4.7z" fill="' + hair + '"/>';
  } else if (style === 1) {
    s += '<path d="M12.6 14.8a8 8 0 0 1 14.8 0c-2.1-2.6-4.6-3.9-7.4-3.9s-5.3 1.3-7.4 3.9z" fill="' + hair + '"/>';
  } else if (style === 2) {
    s += '<path d="M12 16.8a8 8 0 0 1 16 0c-1.4-3.6-4.4-5.6-8-5.6s-6.6 2-8 5.6z" fill="' + hair + '"/>';
    s += '<path d="M11.7 15.6c-.9 5.4-.6 9 .8 10.8 1-3.8 1.4-7.2 1.7-10.6z" fill="' + hair + '"/>';
    s += '<path d="M28.3 15.6c.9 5.4.6 9-.8 10.8-1-3.8-1.4-7.2-1.7-10.6z" fill="' + hair + '"/>';
  } else {
    s += '<path d="M11.4 15.2a8.6 8.6 0 0 1 17.2 0z" fill="' + cap + '"/>';
    s += '<rect x="9.6" y="14.8" width="20.8" height="2.2" rx="1.1" fill="' + shade(cap, -35) + '"/>';
  }
  /* 五官 */
  s += '<circle cx="16.9" cy="17.6" r="1.05" fill="#20262e"/><circle cx="23.1" cy="17.6" r="1.05" fill="#20262e"/>';
  s += '<path d="M17.4 21.3q2.6 1.8 5.2 0" stroke="#20262e" stroke-width=".9" fill="none" stroke-linecap="round"/>';
  if (beard) s += '<path d="M15.6 20.2c.8 3 3.6 4.4 8.8 4.4 5.2 0 8-1.4 8.8-4.4-1.6 4.6-5 6.8-8.8 6.8s-7.2-2.2-8.8-6.8z" fill="' + hair + '" opacity=".85"/>';
  if (glasses) s += '<g fill="none" stroke="#20262e" stroke-width=".7"><circle cx="16.9" cy="17.6" r="2.7"/><circle cx="23.1" cy="17.6" r="2.7"/><path d="M19.6 17.6h.8"/></g>';
  s += '</svg>';
  return s;
}
/* 系统预设头像：sys:0 ~ sys:11 —— 不想上传图片的玩家可以直接挑一张 */
function sysAvatarCount() { return 12; }
function sysAvatarSVG(n) { return botAvatarSVG(null, 'sys#' + n); }
function avatarHTML(u, size, opt) {
  opt = opt || {};
  u = u || {};
  var sz = size || 'md';
  var cls = 'avatar ' + sz + ' ' + (opt.status ? (u.status === 'online' || u.status === 'playing' ? 'online' : 'offline') : '');
  var av = String(u.avatar || '');
  var face;
  if (/^(https?:)?\/\//.test(av) || /^\//.test(av)) {
    /* 玩家自己上传的图片 */
    face = '<img src="' + esc(av) + '" alt="" onerror="this.style.display=\'none\'">';
  } else if (/^sys:(\d+)$/.test(av)) {
    face = sysAvatarSVG(+av.slice(4));
  } else {
    face = botAvatarSVG(u);           /* 机器人 / 还没设头像的玩家：程序化头像 */
  }
  var inner = '<div class="' + cls + '" style="background:' + shade(u.color || '#33404f', -20) + '">' + face + '</div>';
  if (opt.frame) inner = '<span class="avatar-frame' + (opt.frame === 'plain' ? ' plain' : '') + '">' + inner + '</span>';
  return inner;
}
function shade(hex, p) {
  hex = (hex || '#33404f').replace('#', '');
  var n = parseInt(hex.length === 3 ? hex.split('').map(function (c) { return c + c; }).join('') : hex, 16);
  var r = (n >> 16) + p, g = ((n >> 8) & 255) + p, b = (n & 255) + p;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* ---------- Toast ---------- */
function toast(msg, type, ms) {
  var root = $('#toast-root');
  var d = document.createElement('div');
  d.className = 'toast ' + (type || '');
  d.innerHTML = (type === 'ok' ? icon('check', 16) : type === 'err' ? icon('warn', 16) : type === 'gold' ? icon('coin', 16) : icon('info', 16)) + '<span>' + msg + '</span>';
  root.appendChild(d);
  setTimeout(function () { d.style.transition = '.3s'; d.style.opacity = '0'; d.style.transform = 'translateY(-10px)'; setTimeout(function () { d.remove(); }, 320); }, ms || 2000);
}

/* ---------- 弹窗 ---------- */
function openModal(o) {
  o = o || {};
  var root = document.createElement('div');
  root.className = 'mask';
  var footHTML = '';
  if (o.buttons !== false) {
    footHTML = '<div class="modal-foot">' +
      (o.cancelText === null ? '' : '<button class="btn ghost" data-a="cancel">' + esc(o.cancelText || '取消') + '</button>') +
      '<button class="btn ' + (o.okClass || 'gold') + '" data-a="ok">' + esc(o.okText || '确定') + '</button></div>';
  }
  root.innerHTML = '<div class="modal ' + (o.size || '') + '" style="position:relative">' +
    (o.closable === false ? '' : '<div class="modal-close icon-btn" data-a="cancel" style="position:absolute;top:10px;right:10px">' + icon('close', 16) + '</div>') +
    (o.title || o.sub ? '<div class="modal-head"><h3>' + esc(o.title || '') + '</h3>' + (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div>' : '') +
    '<div class="modal-body">' + (o.body || '') + '</div>' + footHTML + '</div>';
  $('#modal-root').appendChild(root);
  function close() { root.style.animation = 'fade .2s reverse'; setTimeout(function () { root.remove(); }, 160); }
  /* ★ 必须用原生 addEventListener，不能用 bindClick：
     root 是每次新建的元素，不存在监听器叠加问题；
     而页面 onReady 里普遍会再调一次 bindClick(root, ...)，bindClick 会把这一个（关闭/确定）handler 摘掉
     —— 表现就是弹窗右上角 × 和「确定」点了没反应。 */
  root.addEventListener('click', function (e) {
    if (e.target === root && o.closeOnMask !== false) { close(); o.onClose && o.onClose(); return; }
    var b = e.target.closest('[data-a]'); if (!b) return;
    var a = b.getAttribute('data-a');
    if (a === 'cancel') { close(); o.onClose && o.onClose(); }
    if (a === 'ok') { if (o.onOk && o.onOk(root, close) === false) return; if (o.autoClose !== false) close(); }
  });
  if (o.onReady) o.onReady(root, close);
  return { root: root, close: close };
}
/* ★ 2026-10-08：任意浮层（sheet/modal）打开时隐藏大厅顶栏的「简」语言钮，
   避免它从大厅顶栏透到「我的」等以浮层形式打开的页面。配合 go() 里的 .on-lobby 一起生效。 */
(function () {
  function _syncLangBtn() {
    var sr = document.getElementById('sheet-root'), mr = document.getElementById('modal-root');
    var has = (sr && sr.children.length) || (mr && mr.children.length);
    document.body.classList.toggle('overlay-open', !!has);
  }
  ['sheet-root', 'modal-root'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { try { new MutationObserver(_syncLangBtn).observe(el, { childList: true }); } catch (e) { } }
  });
  _syncLangBtn();
})();

function confirmBox(title, msg, okText, danger) {
  return new Promise(function (res) {
    openModal({
      title: title, sub: msg, okText: okText || '确定', okClass: danger ? 'red' : 'gold',
      onOk: function () { res(true); }, onClose: function () { res(false); }
    });
  });
}
function promptBox(title, o) {
  o = o || {};
  return new Promise(function (res) {
    openModal({
      title: title, sub: o.sub || '', size: o.size, okText: o.okText || '提交',
      body: '<div class="field"><div class="lb">' + esc(o.label || '') + '</div>' +
        '<div class="input-wrap"><input id="__pv" type="' + (o.type || 'text') + '" placeholder="' + esc(o.placeholder || '') + '" value="' + esc(o.value || '') + '"></div></div>',
      onReady: function (root) { setTimeout(function () { var i = $('#__pv', root); i && i.focus(); }, 60); },
      onOk: function (root) { var v = $('#__pv', root).value.trim(); if (!v && o.required) { toast('请输入内容', 'err'); return false; } res(v); },
      onClose: function () { res(null); }
    });
  });
}
/* 底部抽屉 */
function openSheet(o) {
  o = o || {};
  /* ★ key：同一个 key 的弹层重新打开时「就地替换」而不是层层叠加。
     必须同步 remove（不能走 close() 的 160ms 动画），否则动画期间 DOM 里会同时存在
     两个 .sheet，document.querySelector('#sheet-root .sheet') 会先命中外层那个旧壳，
     表现就是「点档位没反应 / 文案还是上一步」。 */
  if (o.key) {
    var old = $('#sheet-root').querySelector('[data-sheet-key="' + o.key + '"]');
    if (old) old.remove();
  }
  var root = document.createElement('div');
  root.className = 'sheet-mask';
  if (o.key) root.setAttribute('data-sheet-key', o.key);
  root.innerHTML = '<div class="sheet"><div class="sheet-head"><h3>' + esc(o.title || '') + '</h3>' +
    '<div class="icon-btn" data-a="close">' + icon('close', 16) + '</div></div><div class="sheet-body">' + (o.body || '') + '</div></div>';
  $('#sheet-root').appendChild(root);
  function close() { root.style.animation = 'fade .2s reverse'; setTimeout(function () { root.remove(); }, 160); }
  /* 同 openModal：用原生事件，避免被页面 onReady 里的 bindClick(root) 摘掉关闭 handler */
  root.addEventListener('click', function (e) {
    if (e.target === root) { close(); o.onClose && o.onClose(); return; }
    if (e.target.closest('[data-a="close"]')) { close(); o.onClose && o.onClose(); }
  });
  if (o.onReady) o.onReady(root, close);
  return { root: root, close: close };
}

/* 金币飞入动画 */
function flyText(txt, x, y, cls) {
  var d = document.createElement('div');
  d.className = 'fx ' + (cls || '');
  d.textContent = txt; d.style.left = x + 'px'; d.style.top = y + 'px';
  $('#fx-root').appendChild(d); setTimeout(function () { d.remove(); }, 1150);
}
function flyFromEl(el, txt) {
  if (!el) return; var r = el.getBoundingClientRect();
  flyText(txt, r.left + r.width / 2 - 20, r.top - 10);
}

/* ---------- 路由 ---------- */
var Screens = {}, Route = { cur: null, hist: [] };
function go(name, params, opt) {
  opt = opt || {};
  var fn = Screens[name];
  if (!fn) { console.warn('no screen', name); return; }
  if (Route.cur && !opt.noHist) Route.hist.push({ name: Route.cur, params: Route.lastParams });
  Route.cur = name; Route.lastParams = params;
  document.body.classList.toggle('on-lobby', name === 'lobby');
  var root = $('#screen-root');
  if (root.__cleanup) { try { root.__cleanup(); } catch (e) { } root.__cleanup = null; }
  /* 切换屏幕时清空遗留浮层（保险面板/弹窗），避免泄漏到其它页面挡住操作 */
  try {
    var mr = $('#modal-root'), sr = $('#sheet-root');
    if (mr) mr.innerHTML = '';
    if (sr) sr.innerHTML = '';
  } catch (e) { }
  /* ★ 2026-10-05 兜底：任何页面渲染抛错都不许让屏幕卡死（历史上出现过钱包页因一个未定义变量整体点不动）。
     渲染失败时给一个可返回的提示页，并把错误打到控制台，便于定位。 */
  var html = '';
  try {
    html = fn(params || {});
  } catch (err) {
    console.error('[go] screen render failed:', name, err);
    html = '<div class="app-shell"><div class="topbar"><div class="icon-btn" data-act="back">' + icon('back', 18) + '</div>' +
      '<div class="title grow">页面出错</div></div>' +
      '<div class="body"><div class="empty-state"><div class="txt2">这个页面开小差了</div>' +
      '<div class="tiny txt3 mt8">' + esc((err && err.message) || String(err)) + '</div>' +
      '<button class="btn ghost block mt16" data-act="back">返回上一页</button></div></div></div>';
    try { toast('页面加载出错，请返回重试', 'err', 2600); } catch (e2) { }
  }
  if (typeof html !== 'string') html = '';
  root.innerHTML = html;
  root.scrollTop = 0;
  root.style.animation = 'none'; void root.offsetWidth;
  root.style.animation = (opt.anim || 'fade') === 'fade' ? 'fade .22s' : 'slideUp .24s';
  if (fn.after) fn.after(params || {}, root);
  document.dispatchEvent(new CustomEvent('screen:render', { detail: { name: name } }));
}
function back() {
  var h = Route.hist.pop();
  if (h) go(h.name, h.params, { noHist: true }); else go(Route.cur === 'login' ? 'login' : 'lobby');
}

/* ---------- 顶部资产条 ---------- */
function assetBarHTML(withAdd) {
  var u = S.user;
  /* ★ 单一币种：账户余额即 USDT（内部「分」，÷100 显示） */
  return '<div class="asset-bar">' +
    '<div class="chip-pill" title="USDT 余额"><span class="coin">' + 'U' + '</span><span class="mono">' + uStr(u.bal != null ? u.bal : u.chips) + '</span>' +
    (withAdd === false ? '' : '<span class="plus" data-act="recharge">+</span>') + '</div>' +
    '</div>';
}

/* ---------- 全局点击代理：data-act ---------- */
var ACTS = {};
function bindAct(name, fn) { ACTS[name] = fn; }
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]'); if (!el) return;
  var a = el.getAttribute('data-act'); if (ACTS[a]) { e.stopPropagation(); ACTS[a](el, el.dataset); }
}, true);

/* ---------- 点击绑定：同一元素只保留最新一个 handler ----------
   背景：#action-bar 这类元素是「持久容器」，每次 renderActions() 只换 innerHTML，
   用 addEventListener 会一层层叠加 —— 点一次「确认加注」会执行十几次 doAction，
   表现就是「系统在替我操作」。bindClick 先摘掉旧的再挂新的，既防叠加又保证用的是最新闭包。 */
function bindClick(el, fn, cap) {
  if (!el) return;
  if (el.__gu9ClickFn) { try { el.removeEventListener('click', el.__gu9ClickFn, el.__gu9ClickCap); } catch (e) { } }
  el.__gu9ClickFn = fn; el.__gu9ClickCap = !!cap;
  el.addEventListener('click', fn, !!cap);
}

/* ---------- 音效占位 ---------- */
var SFX = {
  click: function () { }, chip: function () { }, win: function () { }, fold: function () { }
};
function sfx(n) { if (S.settings.sound && SFX[n]) SFX[n](); }

/* ---------- 牌桌人声播报（sfx-voice.js 的安全包装） ----------
   在 game.js 的 doAction() 里调用：所有座位（玩家 + 机器人）的自然动作都会播报。
   无头环境（Node vm 评测）没有 SfxVoice，这里静默跳过，不会影响引擎。 */
function voiceSfx(kind, tag) {
  try {
    if (typeof SfxVoice === 'undefined' || !SfxVoice) return;
    if (typeof S !== 'undefined' && S.settings && S.settings.sound === false) return;  /* 总开关联动 */
    SfxVoice.play(kind, tag != null ? { tag: tag } : undefined);
  } catch (e) { }
}
/* 设置项切换后的联动 */
function applySetting(k, val) {
  if (typeof SfxVoice === 'undefined' || !SfxVoice) return;
  if (k === 'voice') SfxVoice.setEnabled(val);
  if (k === 'sound' && !val) SfxVoice.stopAll();
}
/* 首次触摸/点击时点亮音频通道，之后机器人自动行动才播得出声 */
(function () {
  function once() {
    try { if (typeof SfxVoice !== 'undefined' && SfxVoice) SfxVoice.unlock(); } catch (e) { }
    document.removeEventListener('pointerdown', once, true);
    document.removeEventListener('touchstart', once, true);
    document.removeEventListener('click', once, true);
  }
  document.addEventListener('pointerdown', once, true);
  document.addEventListener('touchstart', once, true);
  document.addEventListener('click', once, true);
})();

/* ---------- 全局通用动作 ---------- */
bindAct('back', function () { back(); });
bindAct('logout', function () {
  confirmBox('退出登录', '确定要退出当前账号吗？', '退出', true).then(function (ok) {
    if (ok) { S.logged = false; try { localStorage.removeItem(STORE_KEY); } catch (e) { } go('login'); toast('已退出登录'); }
  });
});
bindAct('toast-demo', function (el) { toast(el.dataset.msg || '功能演示中'); });










