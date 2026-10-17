/* ============================================================================
 * tview.js · 牌桌共享渲染层（2026-10-05）
 * ----------------------------------------------------------------------------
 * 为什么有这个文件：
 *   以前「机器人练习桌」（table.js，本地引擎）和「好友房」（table_rt.html，服务端权威）
 *   各写了一套牌桌渲染代码。视觉已经一样（同用 css/table.css），但**代码是两套**，
 *   以后改个座位尺寸/加个元素要改两处，很容易一边改一边漏。
 *   现在把「牌桌主体」抽到这里，两边都调同一份 → 永远不会不一致。
 *
 * 抽进来的（纯视觉，两边完全相同）：
 *   seatPos / cardHTML / avatarHTML / streetName / cdHTML
 *   renderSeats / renderCenter / renderTopbar
 *
 * 留在各自页面里的（业务差异，必须不同）：
 *   底部操作条 —— 机器人桌用本地练习币（买入/加码走本地），
 *                 好友房用真钱 USDT（买入/加码走服务端 /papi/table/join）。
 *                 按钮长相一样（同一套 CSS class），文案/逻辑各自实现。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- 座位椭圆分布：长轴垂直，hero 永远在底部正中（相对视角旋转） ---------- */
  /* 两边座位上限统一 8（用户要求：最多 8 人 8 椅） */
  var MAX_SEATS = 8;
  function seatPos(i, cap, heroIdx) {
    var n = Math.max(2, Math.min(MAX_SEATS, cap || MAX_SEATS));
    var cx = 50, cy = 50, rx = 44, ry = 45;
    /* 以 heroIdx 为基准做相对视角旋转：hero 永远在底部正中（90°）。
       heroIdx 缺省为 0，与旧版（idx 0 永远在底部）完全等价 → 零回归；
       仅在玩家换座位（moveSeat）后，hero 仍稳定停在底部，第一视角不破功。 */
    var rel = (((i - (heroIdx || 0)) % n) + n) % n;
    var a = (90 + (360 / n) * rel) * Math.PI / 180;
    return { x: +(cx + rx * Math.cos(a)).toFixed(2), y: +(cy + ry * Math.sin(a)).toFixed(2) };
  }

  /* 小盲/大盲座位：在「非空」座位里，按 idx 递增（= 行动顺序/顺时针）找庄位下一位/下下位。
     ★ 必须用「非空座位」跳过空位 —— 否则 (dealerSeat+1)%cap 会指到空气（2026-10-05 巡检发现）。
     ★ 2 人 heads-up 特例：庄家即小盲，另一人为大盲。 */
  function blindSeats(seats, dealerSeat) {
    var occ = (seats || []).filter(function (s) { return !s.empty; })
      .map(function (s) { return s.idx; }).sort(function (a, b) { return a - b; });
    if (!occ.length) return { sb: -1, bb: -1 };
    function next(from) {
      for (var k = 0; k < occ.length; k++) if (occ[k] > from) return occ[k];
      return occ[0];
    }
    if (occ.length === 2) return { sb: dealerSeat, bb: next(dealerSeat) };
    var sb = next(dealerSeat);
    return { sb: sb, bb: next(sb) };
  }

  /* ---------- 卡牌（与 game.js cardHTML 同结构 .pcard） ---------- */
  var RANK_CH = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  var SUIT_CH = { s: '♠', h: '♥', d: '♦', c: '♣' };
  function cardHTML(c, opt) {
    opt = opt || {};
    var size = opt.size || 'md';
    if (!c || opt.hidden) return '<div class="pcard ' + size + ' back ' + (opt.back || 'red') + '"><span class="pcard-logo"></span></div>';
    var red = (c.s === 'h' || c.s === 'd');
    var col = (c.s === 'd') ? 'blue' : (c.s === 'c') ? 'green' : red ? 'red' : 'black';
    return '<div class="pcard ' + size + ' ' + col + (opt.win ? ' win' : '') + '">' +
      '<span class="pc-r">' + (RANK_CH[c.r] || '') + '</span>' +
      '<span class="pc-s">' + (SUIT_CH[c.s] || '') + '</span>' +
      '<span class="pc-big">' + (SUIT_CH[c.s] || '') + '</span></div>';
  }

  /* ---------- 头像 ----------
     优先级：u.avatar（玩家上传/后台指定 URL） > bot 内置真人 SVG > 字母色块兜底 */
  var BOT_AVATARS = [
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzNiOGNmZiIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjIyIiBmaWxsPSIjZjVjNmE1Ii8+PHBhdGggZD0iTTI4IDM2IFEzMiAyMiA1MCAyMiBRNjggMjIgNzIgMzYgTDc0IDQ0IFE2OCAzNiA1MCAzNiBRMzIgMzYgMjYgNDQgWiIgZmlsbD0iIzJjMWIxOCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjI4IiBmaWxsPSIjMmMxYjE4Ii8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2ZmN2E1OSIvPjxwYXRoIGQ9Ik0yNiAzNCBRMzAgMTYgNTAgMTYgUTcwIDE2IDc0IDM0IEw3NiA2MCBRNTYgNTIgNTAgNTIgUTQ0IDUyIDI0IDYwIFoiIGZpbGw9IiMzZTI3MjMiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjQ0IiByPSIyMCIgZmlsbD0iI2ZmZGZjNCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODUiIHI9IjI2IiBmaWxsPSIjM2UyNzIzIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzc4N2M4ZCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjIyIiBmaWxsPSIjZTBhYzY5Ii8+PHBhdGggZD0iTTI4IDM0IFEzMiAyMiA1MCAyMiBRNjggMjIgNzIgMzQgTDc0IDQwIFE2OCAzNCA1MCAzNCIgZmlsbD0iIzllOWU5ZSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjI4IiBmaWxsPSIjOWU5ZTllIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzIxMjEyMSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjIyIiBmaWxsPSIjZjVjNmE1Ii8+PHBhdGggZD0iTTI0IDM4IFEzMCAxOCA1MCAxOCBRNzAgMTggNzYgMzggTDc4IDQ2IFE3MCAzNiA1MCAzNiBRMzAgMzYgMjIgNDYgWiIgZmlsbD0iIzIxMjEyMSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjI4IiBmaWxsPSIjMjEyMTIxIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2Y1OWUwYiIvPjxwYXRoIGQ9Ik0yNiAzNCBRMzAgMTYgNTAgMTYgUTcwIDE2IDc0IDM0IEw3NCA1NiBRNTYgNDYgNTAgNDYgUTQ0IDQ2IDI2IDU2IFoiIGZpbGw9IiM1ZDQwMzciLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjQ0IiByPSIyMCIgZmlsbD0iI2ZmZGZjNCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODUiIHI9IjI2IiBmaWxsPSIjNWQ0MDM3Ii8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2Q3YTAxYSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjI0IiBmaWxsPSIjZDdhMTdhIi8+PHBhdGggZD0iTTI0IDM2IFEzMCAyMCA1MCAyMCBRNzAgMjAgNzYgMzYgTDc4IDQ4IFE3MCAzOCA1MCAzOCBRMzAgMzggMjIgNDggWiIgZmlsbD0iIzNlMjcyMyIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjMwIiBmaWxsPSIjM2UyNzIzIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzIyYzU1ZSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjIyIiBmaWxsPSIjZTBhYzY5Ii8+PHBhdGggZD0iTTI4IDM0IFEzMiAyMiA1MCAyMiBRNjggMjIgNzIgMzQgTDc0IDQyIFE2OCAzNCA1MCAzNCIgZmlsbD0iIzIxMjEyMSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjI4IiBmaWxsPSIjZmZmIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2E4NTVmNyIvPjxwYXRoIGQ9Ik0yNiAzNCBRMzAgMTYgNTAgMTYgUTcwIDE2IDc0IDM0IEw3NCA1NiBRNTYgNDYgNTAgNDYgUTQ0IDQ2IDI2IDU2IFoiIGZpbGw9IiMyMTIxMjEiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjQ0IiByPSIyMCIgZmlsbD0iI2ZmZGZjNCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODUiIHI9IjI2IiBmaWxsPSIjMjEyMTIxIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2ZmOGEwMCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjIyIiBmaWxsPSIjZjVjNmE1Ii8+PHBhdGggZD0iTTIyIDM0IFEzMiAxNCA1MCAxNCBRNjggMTQgNzggMzQgTDgwIDQyIFE2OCAzNCA1MCAzNCBBNTAgNTAgMCAwIDAgMjAgNDIgWiIgZmlsbD0iI2ZmOGEwMCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjI4IiBmaWxsPSIjZmY4YTAwIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzIyYzU1ZSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjIyIiBmaWxsPSIjZTBhYzY5Ii8+PHBhdGggZD0iTTI4IDM0IFEzMiAyMiA1MCAyMiBRNjggMjIgNzIgMzQgTDc0IDQwIFE2OCAzNCA1MCAzNCIgZmlsbD0iIzIxMjEyMSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjI4IiBmaWxsPSIjMjEyMTIxIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzNiOGNmZiIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDIiIHI9IjIyIiBmaWxsPSIjZjVjNmE1Ii8+PHBhdGggZD0iTTI2IDM2IFEzNCAyMCA1MCAyMCBRNjYgMjAgNzQgMzYgTDc2IDQ0IFE2OCAzNiA1MCAzNiBRMzIgMzYgMjQgNDQgWiIgZmlsbD0iIzRlMzQyZSIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODIiIHI9IjI4IiBmaWxsPSIjNGUzNDJlIi8+PC9zdmc+',
    'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI2Y1YzY0YyIvPjxwYXRoIGQ9Ik0yNCAzNCBRMzAgMTIgNTAgMTIgUTcwIDEyIDc2IDM0IEw3NiA2MiBRNTYgNTAgNTAgNTAgUTQ0IDUwIDI0IDYyIFoiIGZpbGw9IiM2ZDRjNDEiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjQ0IiByPSIyMCIgZmlsbD0iI2ZmZGZjNCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iODUiIHI9IjI2IiBmaWxsPSIjNmQ0YzQxIi8+PC9zdmc+'
  ];
  function botAvatar(name) {
    var n = String(name || '?');
    var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
    return BOT_AVATARS[Math.abs(h) % BOT_AVATARS.length];
  }
  function avatarHTML(u, size) {
    var name = (u && u.name) || '?';
    var cls = 'avatar ' + (size || 'sm');
    /* 2026-10-06：英文界面下头像首字改用「英文昵称」的首字母，
       否则中文昵称（机器人名）会在英文版里残留一个孤零零的汉字 */
    var ch = String(name).slice(0, 1);
    try {
      if (window.I18N && I18N.get && I18N.get() === 'en') {
        var _en = I18N.t(name);
        if (_en && /^[A-Za-z]/.test(_en)) ch = _en.charAt(0).toUpperCase();
      }
    } catch (e) { }
    var url = (u && u.avatar) || ((u && u.isBot) ? botAvatar(name) : '');
    if (url) return '<div class="' + cls + '"><img src="' + esc(url) + '" alt="' + esc(name) + '" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + esc(ch) + '\'"></div>';
    return '<div class="' + cls + '" style="background:' + ((u && u.color) || '#3b8cff') + ';color:#fff;font-weight:700">' + esc(ch) + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 街位名 ---------- */
  function streetName(s) { return ['翻牌前', '翻牌', '转牌', '河牌', '摊牌'][s] || '等待'; }

  /* ---------- 赢家皇冠（2026-10-05）---------- */
  function crownHTML(size) {
    var w = size || 15, h = size || 15;
    return '<svg class="seat-crown" width="' + w + '" height="' + h + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M2.5 7.2l4.6 3.3L12 3.6l4.9 6.9 4.6-3.3-1.9 11.6H4.4L2.5 7.2z" fill="#ffd76a" stroke="#8a6412" stroke-width="1.1" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="5.4" r="1.5" fill="#fff3c4" stroke="#8a6412" stroke-width=".8"/>' +
      '<circle cx="5.3" cy="8.4" r="1.4" fill="#fff3c4" stroke="#8a6412" stroke-width=".8"/>' +
      '<circle cx="18.7" cy="8.4" r="1.4" fill="#fff3c4" stroke="#8a6412" stroke-width=".8"/>' +
      '</svg>';
  }

  /* ---------- 头像上的倒计时环 ----------
     state.cd = { on:bool, left:秒, total:秒 } —— 由调用方每帧算好传进来 */
  var CD_R = 19, CD_C = 2 * Math.PI * CD_R;
  function cdHTML(cd) {
    cd = cd || {};
    var on = !!cd.on;
    var left = Math.max(0, cd.left || 0);
    var total = Math.max(1, cd.total || 15);
    var frac = on ? Math.max(0, Math.min(1, left / total)) : 1;
    return '<div class="cd-ring' + (on ? ' on' : '') + (on && left <= 5 ? ' urgent' : '') + '">' +
      '<svg viewBox="0 0 44 44"><circle class="cd-bg" cx="22" cy="22" r="' + CD_R + '"/>' +
      '<circle class="cd-fg" cx="22" cy="22" r="' + CD_R + '" stroke-dasharray="' + CD_C.toFixed(1) + '" ' +
      'stroke-dashoffset="' + (CD_C * (1 - frac)).toFixed(1) + '"/></svg>' +
      '<span class="cd-num">' + (on ? Math.ceil(left) : '') + '</span></div>';
  }

  /* ==========================================================================
   * 状态规整：把「机器人桌的 TT.t」和「好友房的 ST」统一成同一形状
   *   actSeat  轮到行动的座位 idx（两边都换算成这个）
   *   cdMap    { seatIdx: {on,left,total} }
   * ========================================================================== */
  function normalize(raw, opt) {
    opt = opt || {};
    var seats = raw.seats || [];
    /* ★ cap 优先取 opt.cap：机器人桌 renderSeat 是「单座位」逐个渲染，
       seats.length=1 会把 cap 钳成 2 → seatPos(i,2) 让 8 个座位全叠在上下两个点（2026-10-05 P0） */
    var cap = Math.max(2, Math.min(MAX_SEATS, opt.cap || seats.length || MAX_SEATS));
    var cdMap = opt.cdMap || {};
    return {
      cap: cap,
      seats: seats,
      heroSeat: raw.heroSeat != null ? raw.heroSeat : -1,
      dealerSeat: raw.dealerSeat,
      actSeat: opt.actSeat != null ? opt.actSeat : -1,
      street: raw.street || 0,
      phase: raw.phase || raw.status || 'waiting',
      pot: raw.pot || 0,
      rake: raw.rake || 0,
      rakeTotal: raw.rakeTotal || 0,
      sidePots: raw.sidePots || null,
      community: raw.community || [],
      cdMap: cdMap,
      result: raw.result || null,
      handNo: raw.handNo || 0,
      modeName: (raw.mode && raw.mode.name) || raw.modeName || '德州扑克',
      betType: (raw.mode && raw.mode.bet) || raw.betType || 'nolimit',
      sb: raw.sb || 0, bb: raw.bb || 0
    };
  }

  /* ==========================================================================
   * 座位渲染（两边完全一致）
   *   opts: { heroIdx, actSeat, showdown, cdMap, nameSuffix, tags }
   * ========================================================================== */
  function renderSeats(st, opts) {
    opts = opts || {};
    var blinds = blindSeats(st.seats || [], st.dealerSeat);
    return (st.seats || []).map(function (s) {
      var pos = seatPos(s.idx, st.cap, opts.heroIdx);
      var style = 'left:' + pos.x + '%;top:' + pos.y + '%';
      if (s.empty) {
        return '<div class="seat empty-slot" style="' + style + '" data-seat="' + s.idx + '">' +
          '<div class="who"><div style="font-size:18px;color:var(--txt3)">+</div><div class="tiny txt3">空位</div></div></div>';
      }
      var isHero = s.idx === opts.heroIdx;
      var showHole = isHero || opts.showdown;
      var cls = 'seat'
        + (s.idx === opts.actSeat ? ' active' : '')
        + (s.folded ? ' folded' : '')
        + (s.win > 0 ? ' winner' : '')
        + (isHero ? ' hero' : '');

      var cards = '';
      if (s.hole && s.hole.length) {
        if (showHole) {
          cards = s.hole.map(function (c) { return cardHTML(c, { size: isHero ? 'md' : 'sm' }); }).join('');
        } else {
          cards = cardHTML(null, { size: isHero ? 'md' : 'sm', hidden: true }) +
            cardHTML(null, { size: isHero ? 'md' : 'sm', hidden: true });
        }
      }

      var role = (s.idx === st.dealerSeat) ? 'D'
        : (s.idx === blinds.sb) ? 'SB'
        : (s.idx === blinds.bb) ? 'BB' : '';
      var badge = role
        ? '<span class="dealer-btn' + (role === 'D' ? '' : ' ' + role.toLowerCase()) + '"'
          + (role === 'D' ? '' : ' style="background:' + (role === 'SB' ? '#2f7bff' : '#ff8a1e') + '"')
          + '>' + role + '</span>'
        : '';
      /* ★ 2026-10-08：动作气泡默认静态常驻（本手内一直可见，显示该玩家本手做了什么）。
         只有调用方通过 opts.actPopSeats[idx] 标记「这是刚发生的新动作」时才加 .pop 播一次动画，
         避免每次 render 重建 DOM 都把动画重播一遍，导致在玩家头顶反复跳动。 */
      var isNewAct = opts.actPopSeats && opts.actPopSeats[s.idx];
      var bubble = (s.lastAct && !s.folded) ? '<div class="act-bubble' + (isNewAct ? ' pop' : '') + '">' + esc(s.lastAct) + '</div>' : '';
      var bet = s.bet > 0 ? '<div class="bet"><span class="chip-ico"></span>' + (opts.fmt ? opts.fmt(s.bet) : s.bet) + '</div>' : '';
      /* 赢家：头顶小皇冠 + 本手赢得的金额（win 由服务端按 result 汇总下发） */
      var winTag = s.win > 0 ? '<div class="seat-win">' + crownHTML() +
        '+' + (opts.fmt ? opts.fmt(s.win) : s.win) + '</div>' : '';
      var emo = (opts.emoMap && opts.emoMap[s.idx]) ? '<div class="emo-pop">' + opts.emoMap[s.idx] + '</div>' : '';
      var cd = cdHTML((opts.cdMap || {})[s.idx]);

      /* 座位小标签：机器人桌显示「未入座/下手上桌/ALL-IN」，好友房显示「已弃牌/全下/旁观」 */
      var tags = '';
      if (typeof opts.tags === 'function') tags = opts.tags(s, isHero) || '';
      else if (s.allin) tags = '<div class="tag red" style="margin-top:2px;font-size:10px">ALL-IN</div>';

      return '<div class="' + cls + '" style="' + style + '" data-seat="' + s.idx + '">' +
        badge + bubble + emo + winTag +
        '<div class="hole">' + cards + '</div>' +
        '<div class="who">' +
        '<div class="row gap6" style="justify-content:center"><div class="av-wrap">' +
        avatarHTML(s.user, 'sm') + cd + '</div></div>' +
        '<div class="nm">' + esc((s.user && s.user.name) || '玩家') + (opts.nameSuffix ? opts.nameSuffix(s, isHero) : '') + '</div>' +
        /* ★ 2026-10-05：0 USDT且未参与本手的座位（没买入/输光旁观）不再显示「0.00」，
           改成分隔线；旁观身份由 tags 里的「旁观」标签说明。全下输光的玩家本手内仍正常显示 0.00。 */
        (s.usdt === 0 && !s.bet && !s.allin && !s.folded && !(s.hole && s.hole.length)
          ? '<div class="usdt" style="opacity:.45">—</div>'
          : '<div class="usdt">' + (opts.fmt ? opts.fmt(s.usdt) : s.usdt) + '</div>') +
        tags +
        '</div>' + bet + '</div>';
    }).join('');
  }

  /* ==========================================================================
   * 中央信息（公共牌 + 底池 + 街位）—— 两边完全一致
   * ========================================================================== */
  function renderCenter(st, opt) {
    opt = opt || {};
    var fmt = opt.fmt || function (n) { return n; };
    var comm = '';
    for (var i = 0; i < 5; i++) {
      comm += st.community[i] ? cardHTML(st.community[i], { size: 'lg' }) :
        '<div class="pcard lg" style="background:rgba(255,255,255,.06);box-shadow:none"></div>';
    }
    var side = opt.sideText;
    if (side == null) {
      side = '';
      if (st.rakeTotal) side += '平台抽水 ' + fmt(st.rakeTotal);
      if (st.sidePots && st.sidePots.length > 1) side += (side ? ' · ' : '') + '边池×' + st.sidePots.length;
    }
    return '<div class="center-cards">' + comm + '</div>' +
      '<div class="pot-box"><span class="lbl">底池 POT</span><span class="val">' + fmt(st.pot) + '</span>' +
      (side ? '<span class="side">' + esc(side) + '</span>' : '') + '</div>' +
      '<div class="street-lbl">' + esc(opt.streetText != null ? opt.streetText : streetName(st.street)) + '</div>';
  }

  /* ==========================================================================
   * 顶栏副标题（牌名 / 盲注 / 手牌 / 街位）—— 两边完全一致
   * ========================================================================== */
  function topbarMeta(st, opt) {
    opt = opt || {};
    var fmt = opt.fmt || function (n) { return n; };
    return st.modeName + ' · ' + fmt(st.sb) + '/' + fmt(st.bb) + ' U · ' + (opt.betText || betTypeText(st.betType)) +
      ' · 第 ' + st.handNo + ' 手 · ' + (opt.streetText != null ? opt.streetText : streetName(st.street));
  }
  function betTypeText(b) {
    return { nolimit: '无限注', potlimit: '底池限注', aof: 'All-in or Fold' }[b] || '无限注';
  }

  global.TView = {
    MAX_SEATS: MAX_SEATS,
    seatPos: seatPos, cardHTML: cardHTML, avatarHTML: avatarHTML, crownHTML: crownHTML,
    streetName: streetName, cdHTML: cdHTML, esc: esc,
    normalize: normalize, renderSeats: renderSeats, renderCenter: renderCenter,
    topbarMeta: topbarMeta, betTypeText: betTypeText
  };
})(window);




