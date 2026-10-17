/* ===== table.js · 牌桌：座位/发牌/操作键/保险/手牌回顾/聊天/菜单 ===== */
/* 竖屏牌桌：座位沿「长轴垂直」的椭圆均匀分布，0 号（hero）固定底部正中。
   按实际人数 cap 动态计算，2/3/6/9 人桌都对称居中。 */
function seatPos(i, cap, heroIdx) {
  var n = Math.max(2, cap || 8);
  var cx = 50, cy = 50, rx = 44, ry = 45;
  var rel = (((i - (heroIdx || 0)) % n) + n) % n;
  var a = (90 + (360 / n) * rel) * Math.PI / 180;
  return { x: +(cx + rx * Math.cos(a)).toFixed(2), y: +(cy + ry * Math.sin(a)).toFixed(2) };
}
var TT = null;
/* 机器人思考时长区间（毫秒）：最少 3 秒，最多 11 秒 */
var AI_THINK_MIN = 3000, AI_THINK_MAX = 11000;
/* ★ 2026-10-03：本手结束到下一局自动开始的间隔（原 3600ms）。
   底部有「继续」按钮，点了立即开下一局，所以自动间隔放宽到 5 秒，给玩家看结算的时间。 */
var NEXT_HAND_DELAY_MS = 5000;
var HERO_SEC = 15;              /* 真人决策主倒计时（秒）；15 秒未操作 → 进入 5 秒宽限；宽限内仍未操作 → 强制弃牌并请出房间 */
var HERO_GRACE_SEC = 5;         /* 主倒计时用完后的额外宽限（秒） */

/* ---------- 牌桌独立记账（2026-10-02 / ★ 2026-10-05 USDT 化重写）----------
   ★★ 全站改为 USDT 计价后，真钱余额 = 账户 USDT（服务端权威）。
   单机 / 机器人练习桌的牌局完全跑在浏览器里，服务端无法逐手核账 ——
   若把它的输赢记进真钱余额，改一下前端数字就能凭空刷出 USDT 去提现。
   所以练习桌一律使用**本地练习币** S.user.practice：与 USDT 账户完全隔离，
   不进任何充值/提现链路，换设备不同步也无所谓（它本来就不是钱）。 */
function tbNum(v) { return Math.max(0, Math.round(+v || 0)); }
/* 练习币余额（单位同样是「分」，1 练习币 = 0.01；显示口径与 USDT 一致） */
function pracBal() { return Math.max(0, Math.round(+((S.user && S.user.practice) || 0))); }
function pracSet(v) { if (S.user) { S.user.practice = Math.max(0, Math.round(+v || 0)); saveState(); apiSync(); } }
/* 免费供应：练习币不足 10 时补到 1000（练习桌永远可玩，且永远不等于真钱） */
function pracTopUp() { if (pracBal() < 1000) pracSet(100000); }
/* 当前允许从桌上取回的最大额（本金口径，且不超过桌上实际余额） */
function tbCanCash() {
  return Math.min(tbNum(S.user.tableBank), tbNum(S.user.tablePaid) - tbNum(S.user.tableCashed));
}
/* 买入：练习币 → 桌上本金 + 桌上余额 */
function tbBuy(n) {
  n = tbNum(n);
  if (n <= 0) return;
  pracSet(pracBal() - n);
  S.user.tablePaid = tbNum(S.user.tablePaid) + n;
  S.user.tableBank = tbNum(S.user.tableBank) + n;
  saveState(); apiSync();
}
/* 取回：桌上 → 账户，只对本金部分生效，返回实际取回额 */
function tbCash(n) {
  n = Math.min(tbNum(n), tbCanCash());
  if (n <= 0) return 0;
  S.user.tableBank = tbNum(S.user.tableBank) - n;
  S.user.tableCashed = tbNum(S.user.tableCashed) + n;
  pracSet(pracBal() + n);
  saveState(); apiSync();
  return n;
}
/* ---------- 资金闸门（2026-10-03）----------
   ★ 以前：账户余额被输成 0 后，牌桌照旧发牌、底部照旧出「ALL-IN」，
     点了就是一个 0 USDT的全下 —— 桌上没钱却还在牌局里，明显不合理。
   现在：桌上余额为 0 的人（且不是本手全下在看戏）一律视为「未买入」：
     · 不发牌给他（startHand 不开局，牌桌停在等待）
     · 底部不出任何下注键，只出「买入」
     · 买入成功（钱从账户划到桌上）后才发牌、才允许下注
   余额也是 0 时，买入面板直接引导去充值。 */
function heroChips() { return (TT && TT.t) ? tbNum(TT.t.seats[TT.t.heroSeat].usdt) : 0; }
function heroNeedsBuy() {
  if (!TT || !TT.t) return false;
  if (!TT.heroSeated) return false;     /* 还没入座 → 不催买入，走「入座」流程 */
  var h = TT.t.seats[TT.t.heroSeat];
  if (!h || h.empty) return false;
  if (h.allin) return false;            /* 本手已全下：桌上余额 0 是正常的，不算没买入 */
  return tbNum(h.usdt) <= 0;
}
/* 买入完成后重新开局（供买入面板的回调使用） */
function startAfterBuy() {
  if (!TT || !TT.t) return;
  if (heroNeedsBuy()) { renderAll(); return; }
  startHand(TT.t); renderAll(); loop();
}
/* ---------- 入座（2026-10-03）----------
   ★ 用户要求：进桌后要先点「入座」才玩牌，不能一进去就发牌；
     而且机器人正在打的这一局要打完，玩家下一手才加入（不能中途插进去）。
   流程：点入座 → 买入（账户余额划到牌桌）→ 若本局正在进行则标记 pendingSit，
        等 settle() 之后 beginNextHand() 把他放上桌发牌。 */
function requestSit() {
  if (!TT || !TT.t) return;
  if (TT.heroSeated) { toast('你已经在座了'); return; }
  var t = TT.t;
  showBuyIn(true, function () {
    if (!TT || !TT.t) return;
    if (tbNum(TT.t.seats[TT.t.heroSeat].usdt) <= 0) { toast('买入后才能入座', 'err'); return; }
    doSitDown();
  });
}
function doSitDown() {
  var t = TT.t;
  TT.heroSeated = true;
  if (t.status === 'playing') {
    /* ★ 这一局已经开始（机器人在打）→ 等他们打完，下一手再上桌 */
    TT.pendingSit = true;
    t.seats[t.heroSeat].sittingOut = true;
    toast('已入座 · 等这一局打完就发牌给你', 'ok', 2800);
    renderAll();
    return;
  }
  TT.pendingSit = false;
  t.seats[t.heroSeat].sittingOut = false;
  if (t.status === 'waiting') { startHand(t); }
  renderAll(); loop();
}
/* 站起（暂不开放给玩家，仅供内部：入座前的状态） */
function heroStandUp() {
  if (!TT || !TT.t) return;
  TT.heroSeated = false; TT.pendingSit = false;
  TT.t.seats[TT.t.heroSeat].sittingOut = true;
  renderAll();
}
function newRuntime(params) {
  var src = S.tables.filter(function (t) { return t.id === params.id; })[0] ||
    { id: params.id || 1000, name: '德州扑克', sb: 0.5, bb: 1, cap: 8, players: 5, insurance: true, modeKey: 'nlh' };
  var t = createTable({
    id: src.id, name: src.name, sb: src.sb, bb: src.bb, cap: src.cap || 8,
    mode: src.modeKey || 'nlh', ante: src.ante, straddle: src.straddle
  });
  /* ★★ 2026-10-03（用户要求）：进桌不再自动上桌自动发牌 ——
     以前这里直接 seatPlayer + tbBuy(buy) + startHand，一进桌钱就被划走、牌也发了，
     看上去像「一桌人在等你」。现在：hero 只占位不参战（sittingOut），
     必须自己点「入座」→ 买入 → 才会在**下一手**（本局打完后）被发牌。 */
  seatPlayer(t, 0, S.user, 0);
  t.seats[0].sittingOut = true;     /* 未入座：activeSeats / nextSeat 都会跳过他 */
  var others = [];
  for (var i = 1; i < t.cap; i++) others.push(i);
  shuffle(others);
  var n = Math.max(1, Math.min(others.length, src.players || 5));
  /* ★★ 2026-10-02 铁律：座位上的人只可能来自**服务端房间成员**（src.members），
     而 members 里全是「已经接受邀请」的真人 —— 没同意的人根本不会出现在这里。
     以前这里是 `invited[k] || mkUser()`：邀请只是本地 push，好友毫不知情就被塞进座位开始打牌。
     现在：成员之外的空位一律用机器人补（mkUser），好友的头像和名字不再被冒用。 */
  var members = (src.members || []).filter(function (m) { return String(m.id) !== String(S.user.id); }).slice(0, others.length);
  /* ★★ 2026-10-02 修「房间一建好里面就有一个机器人」「邀请了好友还有机器人」
     —— 以前这行 `n = Math.max(1, min(空位数, src.players || 5))`，而 src.players 是 tableFromRoom 里
     **由房间已入座人数算出来的**（只有房主 1 人 → players=1），于是硬凑出「至少 1 个座位」去塞机器人；
     邀了 2 个好友时 players=3 也照样再塞 1 个机器人陪坐。
     现在：**房间（有房间号 / 私有房）里只坐真人，一个机器人都不塞**；
     玩家自己开的随机桌 / 快速开局仍然照旧补满。人不够就 waiting，等好友进来再开局。 */
  var isRoom = !!(src.roomNo || src.private);
  /* ★ 2026-10-04：机器人总开关。关时公共桌也不安排机器人陪坐（只留房主/真人，等真人进来），
     私人房本来就不安排机器人，不受影响。 */
  var n = isRoom ? members.length : (BOTS.on ? Math.max(1, Math.min(others.length, src.players || 5)) : 0);
  var friendCount = 0;
  for (var k = 0; k < n; k++) {
    var m = members[k];
    /* ★ 2026-10-03：真人成员带上自己的头像（m.avatar）；机器人走程序化头像 */
    var u = m ? mkUser(k + 11, { name: m.name, color: m.color, level: m.level, vip: m.vip, status: 'online', avatar: m.avatar }) : mkUser(k + 11);
    if (m) { u.id = String(m.id); u.realMember = true; friendCount++; }
    seatPlayer(t, others[k], u, src.bb * rnd(40, 200));
  }
  t.dealerSeat = -1;
  var rt = {
    t: t, src: src, buyIn: 0, raising: false, raiseAmt: 0,
    /* ★ 2026-10-03：heroSeated=false → 只是旁观（没入座）；点了入座并完成买入才 true。
       pendingSit=true → 已请求入座，等桌上这局打完，下一手才发牌给他。 */
    heroSeated: false, pendingSit: false,
    cdSeat: -1, cdLeft: 0, cdTotal: 1, cdEnd: 0, cdTick: null,
    ins: null, insShown: false, timer: null, heroTimer: null, lastResult: null, emo: {}, handLog: [], friendCount: friendCount,
    thinkSeat: -1, thinkMs: 0
  };
  /* 房间里的空话要说在明处：人不够就明说「等你的人」，别让人以为是卡住了 */
  setTimeout(function () {
    if (isRoom && !friendCount) toast('这个房间暂时只有你一个人 · 等好友接受邀请才会开局，这里不安排机器人陪坐', 'ok', 3600);
    else if (friendCount) toast(friendCount + ' 位已同意邀请的好友在座', 'ok', 2600);
  }, 700);
  return rt;
}

Screens.table = function (params) {
  return '<div class="table-screen">' +
    '<div class="table-top">' +
    '<div class="icon-btn" data-act="leave-table">' + icon('back', 18) + '</div>' +
    '<div class="col" style="line-height:1.25">' +
    '<div class="tname" id="tb-name">德州扑克</div>' +
    '<div class="tmeta" id="tb-meta">--</div>' +
    '</div>' +
    '<div class="grow"></div>' +
    /* ★ 2026-10-02 桌面简约化：顶部只留「三个点」。原先的记分牌 / 手牌回顾 / 聊天三个图标，
       连同牌桌左右两列悬浮图标（手牌回顾 / 保险 / 胜率 / 互动 / 音效 / 设置 / 全屏），
       全部收进牌桌菜单 showTableMenu() —— 桌面只留「返回 + 牌名 + ⋯」。
       未读聊天红点随之挪到「⋯」上，id 仍是 tb-chat-dot（social.js 依赖它）。 */
    '<div class="icon-btn" data-act="table-menu" title="牌桌菜单">' + icon('more', 18) +
    '<span class="badge" id="tb-chat-dot" style="display:none">1</span></div>' +
    '</div>' +
    '<div class="table-area">' +
    /* ★ 2026-10-03（第3轮）：回顾=左上角，买入=左下角，聊天/离开=右下角。
       买入/加码任何时刻（包括本手结束后）都能点开；聊天走 openChatPanel()。 */
    '<div class="side-rail left">' +
    '<div class="rail-btn" data-act="hand-history" title="手牌回顾">' + icon('history', 20) + '<span>回顾</span></div>' +
    '</div>' +
    '<div class="side-rail left bottom">' +
    '<div class="rail-btn" data-act="buyin" title="买入 / 加码">' + icon('wallet', 20) + '<span>买入</span></div>' +
    '</div>' +
    '<div class="side-rail right">' +
    '<div class="rail-btn" data-act="chat" title="牌桌聊天">' + icon('chat', 20) + '<span>聊天</span></div>' +
    /* ★ 2026-10-03：底部留白后，中途退出的入口挪到这里 */
    '<div class="rail-btn" data-act="leave-table" title="离开牌桌">' + icon('logout', 20) + '<span>离开</span></div>' +
    '</div>' +
    '<div class="felt ' + (S.settings.tableTheme === 'blue' ? 'blue' : S.settings.tableTheme === 'red' ? 'red' : '') + '" id="felt">' +
    /* ★ 2026-10-02：桌布中央那枚半透明水印徽章已按用户要求移除（牌桌要干净），
       连带它的 CSS 规则一起删掉了，别再加回来。 */
    '<div id="seats"></div>' +
    '<div class="felt-inner"><div id="center-box"></div></div>' +
    '</div>' +
    '</div>' +
    '<div class="action-bar" id="action-bar"></div>' +
    '</div>';
};

Screens.table.after = function (params, root) {
  if (!TT || !TT.t || TT.t.id !== params.id) {
    TT = newRuntime(params);
    /* ★★ 2026-10-05：服务端房间（有房间号）一律交给 table_rt.html，
       这里**绝不**开本地局、也绝不弹本地买入框 —— 本地买入框还是旧的「练习币」口径，
       而全站已经没有练习币（机器人桌也是真钱 USDT）。
       以前这里不判断，房间桌也会先弹一次本地买入框再被 startRoomSync 跳走，
       属于竞态：跳转慢一点玩家就会看到一个「练习币」面板。 */
    if (TT.src && TT.src.roomNo) { startRoomSync(); return; }
    /* ★ 资金闸门：桌上没钱（比如账户余额 0 就进桌）→ 先不开局，弹买入 */
    if (heroNeedsBuy()) {
      TT.t.status = 'waiting';
      setTimeout(function () { showBuyIn(true, startAfterBuy); }, 400);
    } else startHand(TT.t);
  }
  TT.root = root;
  renderAll();
  loop();
  /* ★ 房间：进桌立刻校验服务端还在不在（本地列表可能残留已解散的房间），并开始轮询成员变化 */
  if (TT.src && TT.src.roomNo) startRoomSync();
};
/* 下一手开始前，把「下一手再走 / 下一手再上桌」的标记落实 */
function applyPendingSeatChanges(t) {
  t.seats.forEach(function (s) {
    if (s.empty || s.idx === t.heroSeat) return;
    if (s.leaveNext) {
      s.empty = true; s.user = null; s.hole = []; s.usdt = 0; s.bet = 0; s.contrib = 0;
      s.folded = true; s.allin = false; s.acted = false; s.sittingOut = true; s.leaveNext = false;
      return;
    }
    if (s.sittingOut && s.usdt > 0) s.sittingOut = false;
  });
}

/* ---------- 渲染 ---------- */
function renderAll() {
  if (!TT || !TT.root) return;
  var t = TT.t, root = TT.root;
  /* 当前屏幕已不是牌桌（例如已离开）时，跳过渲染 */
  if (!root.querySelector('.table-screen')) return;
  /* 顶栏不挂任何徽标（用户要求：不管什么房间都不显示） */
  $('#tb-name', root).textContent = t.name + (TT.src.passwd ? ' · 私人房' : '');
  $('#tb-meta', root).textContent = t.mode.name + ' · ' + uStr(t.sb) + '/' + uStr(t.bb) + ' U · ' + betTypeName(t.mode.bet) + ' · 第 ' + t.handNo + ' 手 · ' + streetName(t.street);
  $('#seats', root).innerHTML = t.seats.map(renderSeat).join('');
  $('#center-box', root).innerHTML = renderCenter();
  renderActions();
  bindSeatEvents();
}
function streetName(s) { return ['翻牌前', '翻牌', '转牌', '河牌', '摊牌'][s] || '等待'; }

/* ---------- 座位头像上的倒计时（取代原来的「思考中」气泡 + 细进度条） ----------
   ★ 谁在思考，倒计时就压在谁的头像上。
   ★ 状态放在 TT 上（cdSeat / cdLeft / cdTotal / cdEnd），不是纯 DOM 状态 ——
     renderAll() 会重建 #seats，markup 得自己把「环 + 数字」画回正确进度（cdHTML 读 TT）。
   ★ 100ms 的 interval 只做「就地改数字 + 环的 stroke-dashoffset」，不触发整屏重绘。
   外圈环 = 剩余时间比例（走完 ≈ 归零），剩 5 秒内变红。 */
var CD_R = 19, CD_C = 2 * Math.PI * CD_R;
/* ★ 2026-10-05：环的 markup 抽到共享层 tview.js（好友房同一份），
   这里只负责把「本桌倒计时状态」翻译成 {on,left,total} 喂给它。
   → 顺便维护 TT.cdMap，供 renderSeat 批量渲染时给每个座位用。 */
function cdInfo(idx) {
  var on = TT && TT.cdSeat === idx && TT.cdLeft > 0;
  return { on: on, left: on ? TT.cdLeft : 0, total: TT && TT.cdTotal ? TT.cdTotal : 15 };
}
function cdHTML(idx) { return TView.cdHTML(cdInfo(idx)); }
/* 渲染前刷新一次 cdMap（renderAll 每帧会调） */
function buildCdMap() {
  TT.cdMap = TT.cdMap || {};
  (TT.t.seats || []).forEach(function (s) { TT.cdMap[s.idx] = cdInfo(s.idx); });
  return TT.cdMap;
}
function patchCd() {
  if (!TT || !TT.root || TT.cdSeat < 0) return;
  var seat = TT.root.querySelector('.seat[data-seat="' + TT.cdSeat + '"]');
  var box = seat && seat.querySelector('.cd-ring');
  if (!box) return;
  box.classList.add('on');
  box.classList.toggle('urgent', TT.cdLeft <= 5);
  var num = box.querySelector('.cd-num');
  var v = String(Math.ceil(TT.cdLeft));
  if (num && num.textContent !== v) num.textContent = v;
  var fg = box.querySelector('.cd-fg');
  if (fg) fg.setAttribute('stroke-dashoffset',
    (CD_C * (1 - Math.max(0, Math.min(1, TT.cdLeft / TT.cdTotal)))).toFixed(1));
}
function setCd(seatIdx, ms) {
  if (!TT || seatIdx == null || seatIdx < 0 || !ms) return;
  TT.cdSeat = seatIdx; TT.cdTotal = ms / 1000; TT.cdLeft = ms / 1000; TT.cdEnd = Date.now() + ms;
  patchCd();
  if (TT.cdTick) return;
  var id = setInterval(function () {
    if (!TT) { clearInterval(id); return; }        /* 已离开牌桌，自杀 */
    if (TT.cdSeat < 0) { clearInterval(id); TT.cdTick = null; return; }
    TT.cdLeft = (TT.cdEnd - Date.now()) / 1000;
    if (TT.cdLeft <= 0) { clearCd(); return; }
    patchCd();
  }, 100);
  TT.cdTick = id;
}
function clearCd() {
  if (!TT) return;
  if (TT.cdTick) { clearInterval(TT.cdTick); TT.cdTick = null; }
  TT.cdSeat = -1; TT.cdLeft = 0;
  if (!TT.root) return;
  Array.prototype.forEach.call(TT.root.querySelectorAll('.cd-ring.on'), function (el) {
    el.classList.remove('on', 'urgent');
  });
}

/* ★ 2026-10-05：座位 / 中央信息渲染已抽到共享层 tview.js（与好友房 table_rt.html 同一份代码）。
   这里只准备「本桌特有」的状态：轮到谁（actSeat）、倒计时环、座位小标签、边池/抽水文案。 */
function tvOpts() {
  var t = TT.t;
  return {
    heroIdx: t.heroSeat,
    actSeat: t.toAct,
    showdown: t.street === 4,
    cdMap: buildCdMap(),
    emoMap: TT.emo || {},
    fmt: uStr,
    tags: function (x, isHero) {
      var out = '';
      if (isHero && !TT.heroSeated) out += '<div class="tag" style="margin-top:2px;font-size:10px">未入座</div>';
      else if (isHero && TT.heroSeated && TT.pendingSit) out += '<div class="tag gold" style="margin-top:2px;font-size:10px">下手上桌</div>';
      if (x.allin) out += '<div class="tag red" style="margin-top:2px;font-size:10px">ALL-IN</div>';
      return out;
    }
  };
}
/* 单个座位（外部仍有 renderSeat(x) 的调用点，这里保持签名）
   ★ 必须把本桌真实座位数传过去（opt.cap）—— 否则共享层按 1 个座位算 cap=2，
     8 个座位会全部叠在椭圆上下两个点（2026-10-05 用户截图实锤的 P0） */
/* ★ 2026-10-08：记录每个座位最近一次已展示的动作，让动作气泡只在新动作出现时播一次 pop，
   之后每次重建该座位 DOM 不再重播，避免动作气泡在玩家头顶反复跳动。 */
var SHOWN_ACTS = {};
function renderSeat(s) {
  var t = TT.t;
  var isNewAct = false;
  if (s.idx != null) {
    var key = (s.lastAct && !s.folded) ? s.lastAct : '';
    isNewAct = !!key && key !== (SHOWN_ACTS[s.idx] || '');
    SHOWN_ACTS[s.idx] = key;
  }
  var opts = tvOpts();
  opts.actPopSeats = {};
  if (isNewAct) opts.actPopSeats[s.idx] = true;
  var one = { seats: [s], heroSeat: t.heroSeat, dealerSeat: t.dealerSeat };
  return TView.renderSeats(TView.normalize(one, { actSeat: t.toAct, cap: t.seats.length }), opts);
}

function renderCenter() {
  var t = TT.t;
  var side = '';
  if (t.sidePots && t.sidePots.length > 1) {
    side = t.sidePots.map(function (p, i) { return '边池' + (i + 1) + ' ' + fmt(p.amount); }).join(' · ');
  }
  if (t.rake) side = (side ? side + ' · ' : '') + '平台抽水 ' + fmt(t.rake) + (t.rebate ? '（返水 +' + fmt(t.rebate) + '）' : '');
  return TView.renderCenter(TView.normalize(t, {}), {
    fmt: fmt,
    sideText: side,
    streetText: streetName(t.street) + ' · ' + ((window.I18N && I18N.get && I18N.get() === 'en') ? 'Hand #' : '手牌 #') + t.handNo + ' · ' + rakeText(t)
  });
}

function renderActions() {
  if (!TT || !TT.root) return;
  if (!TT.root.querySelector('.table-screen')) return;
  var t = TT.t, root = TT.root, bar = $('#action-bar', root);
  if (!bar) return;
  var hero = t.seats[t.heroSeat];
  var isTurn = t.toAct === t.heroSeat && t.status === 'playing';
  var call = toCall(t, hero);
  var html = '';

  /* hero 手牌 + 提示 */
  var hint = '';
  if (hero.hole.length) {
    var st = t.street === 0 ? preflopScore(hero.hole) : vStrength(rankOf(t, hero));
    var eq = Math.round(st * 100);
    hint = '手牌强度 <b>' + eq + '%</b>' + (S.settings.showPotOdds && call > 0 ? ' · 底池赔率 <b>' + Math.round(call / (t.pot + call) * 100) + '%</b>' : '') +
      (S.settings.showOdds && t.community.length >= 3 ? ' · 成手：<b>' + handName(rankOf(t, hero), t.modeKey) + '</b>' : '') +
      (t.mode.hilo && hero.hole.length ? ' · 低牌：<b>' + (lowHand(hero.hole.concat(t.community)) ? '有' : '无') + '</b>' : '');
  }
  html += '<div class="hero-info">' +
    '<div class="cards">' + (hero.hole.length ? hero.hole.map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') : '<span class="tiny txt3">等待发牌</span>') + '</div>' +
    '<div class="col"><div class="b">' + esc(S.user.name) + '</div><div class="tiny txt3">余额 ' + uStr(hero.usdt) + (TT.ins ? ' · 已投保 ' + uStr(TT.ins.payout) : '') + '</div></div>' +
    (isTurn ? '<div class="timer-ring' + (TT.heroGrace ? ' grace' : '') + '" id="hero-timer">' + ringSVG(TT.heroLeft || HERO_SEC, TT.heroGrace ? HERO_GRACE_SEC : HERO_SEC, TT.heroGrace) + '</div>' : '') +
    '<div class="hint">' + hint + '</div>' +
    '</div>';

  /* ★ 2026-10-03：还没入座 → 底部只给「入座」，牌桌上的机器人自己打他们的 */
  if (!TT.heroSeated) {
    var acc0 = tbNum(pracBal());
    html += '<div class="btnrow">' +
      '<button class="btn gold grow" data-hero="sit">入座玩牌</button>' +
      '<button class="btn ghost" data-act="leave-table">退出</button>' +
      '</div>' +
      '<div class="tiny txt3 center mt8">' +
      (acc0 > 0
        ? '先入座并买入（账户 ' + fmt(acc0) + '）才会给你发牌'
        : '账户余额为 0 · 入座时会先引导你充值') +
      '</div>';
    bar.innerHTML = html;
    bindActionEvents();
    return;
  }

  /* ★ 已入座但本局正在进行 → 明确告诉他「等这一局打完」，不给任何下注键 */
  if (TT.pendingSit) {
    html += '<div class="tiny txt3 center mt8">已入座 · 等这一局打完，下一手就发牌给你</div>';
    bar.innerHTML = html;
    bindActionEvents();
    return;
  }

  /* ★ 资金闸门：桌上余额 0（非全下）→ 不发牌也不给任何下注键，只给「买入」 */
  if (heroNeedsBuy()) {
    var acc = tbNum(pracBal());
    html += '<div class="btnrow">' +
      '<button class="btn gold grow" data-hero="buyin">' + (acc > 0 ? '买入才能入局' : '去充值') + '</button>' +
      (t.status === 'showdown' ? '<button class="btn ghost" data-act="leave-table">退出</button>' : '') +
      '</div>' +
      '<div class="tiny txt3 center mt8">' +
      (acc > 0
        ? '牌桌余额为 0 · 点「买入」把练习币余额（' + uStr(acc) + ' U）划到桌上才会发牌、才能下注'
        : '牌桌和账户都是 0 · 请先充值，再买入上桌') +
      '</div>';
    bar.innerHTML = html;
    bindActionEvents();
    return;
  }

  if (TT.raising) {
    var maxRaise = t.mode.bet === 'potlimit' ? Math.min(hero.usdt, t.pot + call * 2) : hero.usdt;
    var minRaise = Math.max(t.minRaise, t.bb);
    TT.raiseAmt = Math.min(Math.max(TT.raiseAmt || minRaise, minRaise), maxRaise);
    var pot = t.pot;
    html += '<div class="raise-panel">' +
      '<div class="raise-row">' +
      '<div class="col grow"><div class="tiny txt3">最小 ' + fmt(minRaise) + (t.mode.bet === 'potlimit' ? ' · 底池限注最大 ' + fmt(maxRaise) : '') + '</div>' +
      '<input type="range" id="raise-slider" min="' + minRaise + '" max="' + maxRaise + '" step="' + t.bb / 2 + '" value="' + TT.raiseAmt + '" style="--p:' + Math.round((TT.raiseAmt - minRaise) / Math.max(1, maxRaise - minRaise) * 100) + '%"></div>' +
      '<div class="raise-amt">' + cv(TT.raiseAmt) + '</div>' +
      '</div>' +
      '<div class="raise-presets">' +
      [['1/3 底池', Math.round(pot / 3)], ['1/2 底池', Math.round(pot / 2)], ['2/3 底池', Math.round(pot * 2 / 3)], ['1 倍底池', pot], ['ALL-IN', maxRaise]].map(function (p) {
        return '<div class="btn sm ghost" data-raise="' + p[1] + '">' + p[0] + '</div>';
      }).join('') + '</div>' +
      '<div class="row mt8 gap8">' +
      '<button class="btn ghost grow" data-hero="cancel-raise">取消</button>' +
      '<button class="btn gold grow" data-hero="confirm-raise">确认加注 ' + cv(TT.raiseAmt) + '</button>' +
      '</div></div>';
  } else if (isTurn) {
    if (t.mode.bet === 'aof') {
      html += '<div class="btnrow">' +
        '<button class="btn fold" data-hero="fold">弃牌</button>' +
        '<button class="btn allin" data-hero="allin">ALL-IN<br><span style="font-size:11px">' + short(hero.usdt) + '</span></button>' +
        '</div><div class="tiny txt3 center mt8">All-in or Fold：本玩法只能全下或弃牌</div>';
    } else {
      html += '<div class="btnrow">' +
        '<button class="btn fold" data-hero="fold">弃牌</button>' +
        (call > 0
          ? '<button class="btn call" data-hero="call">跟注 ' + fmt(Math.min(call, hero.usdt)) + '</button>'
          : '<button class="btn check" data-hero="check">过牌</button>') +
        '<button class="btn raise" data-hero="raise">' + (call > 0 ? '加注' : '下注') + '</button>' +
        '<button class="btn allin" data-hero="allin">ALL-IN<br><span style="font-size:11px">' + short(hero.usdt) + '</span></button>' +
        '</div>';
    }
  } else {
    /* ★ 2026-10-03（用户要求）：没轮到自己（等待中 / 已弃牌 / 已全下看戏）时，
       底部完全留白 —— 不再显示「退出牌桌」按钮和「等待其他玩家行动…」提示。
       只有本手结束后才出现「继续 / 退出」。中途想走人走牌桌左侧的「离开」。 */
    var over = t.status === 'showdown';
    if (over) {
      html += '<div class="btnrow">' +
        '<button class="btn gold grow" data-hero="next-hand">继续 ▸</button>' +
        '<button class="btn ghost" data-act="leave-table">退出</button>' +
        '</div>' +
        '<div class="tiny txt3 center mt8">本手已结束 · ' + NEXT_HAND_DELAY_MS / 1000 + ' 秒后自动开始下一局</div>';
    }
  }
  bar.innerHTML = html;
  bindActionEvents();
}

function ringSVG(left, total, danger) {
  var p = Math.max(0, Math.min(1, left / total));
  var r = 18, c = 2 * Math.PI * r;
  var col = danger ? '#ff5a5f' : (p < .3 ? '#ff5a5f' : '#f5c352');
  return '<svg width="44" height="44"><circle cx="22" cy="22" r="' + r + '" fill="none" stroke="#26313f" stroke-width="4"/>' +
    '<circle cx="22" cy="22" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="4" ' +
    'stroke-dasharray="' + (c * p).toFixed(1) + ' ' + c.toFixed(1) + '" stroke-linecap="round"/></svg>' +
    '<span class="tt"' + (danger ? ' style="color:#ff5a5f"' : '') + '>' + Math.ceil(left) + '</span>';
}
/* ★ 只刷新真人倒计时环（不重建整个 action-bar，避免抖动）；danger=红圈警告 */
function updateHeroTimerRing(danger) {
  if (!TT || !TT.root) return;
  var el = $('#hero-timer', TT.root);
  if (!el) return;
  el.innerHTML = ringSVG(Math.max(0, TT.heroLeft || 0), TT.heroGrace ? HERO_GRACE_SEC : HERO_SEC, danger || TT.heroGrace);
}

function bindSeatEvents() {
  var root = TT.root;
  $$('#seats .seat', root).forEach(function (el) {
    el.onclick = function () {
      var i = +el.dataset.seat;
      var s = TT.t.seats[i];
      if (s.empty) { showSeatActions(i); return; }
      /* ★ 2026-10-03：还没入座时点自己的座位 = 入座 */
      if (i === TT.t.heroSeat && !TT.heroSeated) { requestSit(); return; }
      showSeatMenu(s);
    };
  });
}
function bindActionEvents() {
  var root = TT.root, bar = $('#action-bar', root);
  var sl = $('#raise-slider', bar);
  if (sl) sl.oninput = function () {
    TT.raiseAmt = +this.value;
    this.style.setProperty('--p', Math.round((this.value - this.min) / Math.max(1, this.max - this.min) * 100) + '%');
    $('.raise-amt', bar).textContent = cv(TT.raiseAmt);
    $('[data-hero="confirm-raise"]', bar).textContent = '确认加注 ' + cv(TT.raiseAmt);
  };
  $$('[data-raise]', bar).forEach(function (b) {
    b.onclick = function () { TT.raiseAmt = Math.min(+b.dataset.raise, TT.t.seats[TT.t.heroSeat].usdt); renderActions(); };
  });
  bindClick(bar, function (e) {
    var b = e.target.closest('[data-hero]'); if (!b) return;
    var a = b.dataset.hero;
    /* ★ 资金闸门：没买入（桌上 0 USDT）时，任何下注动作一律拦下，先去买 */
    if (a === 'sit') { requestSit(); return; }
    if (a === 'buyin') { showBuyIn(false, startAfterBuy); return; }
    if (heroNeedsBuy()) {
      if (a === 'next-hand') { if (TT.nextTimer) { clearTimeout(TT.nextTimer); TT.nextTimer = null; } beginNextHand(); return; }
      showBuyIn(false, startAfterBuy);
      return;
    }
    if (a === 'raise') { TT.raising = true; TT.raiseAmt = Math.max(TT.t.minRaise, Math.round(TT.t.pot * 0.5)); renderActions(); return; }
    if (a === 'cancel-raise') { TT.raising = false; renderActions(); return; }
    if (a === 'confirm-raise') { heroAction('raise', TT.raiseAmt); return; }
    if (a === 'fold') heroAction('fold');
    if (a === 'check') heroAction('check');
    if (a === 'call') heroAction('call');
    /* ★ 2026-10-03：本手结束后底部「继续」—— 跳过倒计时立即开下一局 */
    if (a === 'next-hand') {
      if (TT.nextTimer) { clearTimeout(TT.nextTimer); TT.nextTimer = null; }
      beginNextHand();
      return;
    }
    if (a === 'allin') heroAction('raise', TT.t.seats[TT.t.heroSeat].usdt);
  });
}

/* ---------- 流程 ---------- */
function loop() {
  if (!TT) return;
  var t = TT.t;
  /* ★ 资金闸门：hero 桌上 0 USDT → 不开局，停在等待，等他买入（底部有「买入」） */
  if (t.status === 'waiting') {
    if (heroNeedsBuy()) { renderAll(); return; }
    setTimeout(function () { startHand(t); renderAll(); loop(); }, 1200); return;
  }
  if (t.status === 'showdown') return;
  var hero = t.seats[t.heroSeat];
  if (t.toAct === t.heroSeat) {
    if (hero.folded || hero.allin || hero.usdt === 0) { setTimeout(function () { stepAdvance(); }, 400); return; }
    /* ★ 2026-10-02 桌面简约化：不再有「自动弃牌 / 跟任何注 / 等待大盲 / 提前操作」。
       轮到玩家一律走真人倒计时；超时托管只过牌或弃牌（见 startHeroTimer）。 */
    startHeroTimer();
    return;
  }
  var s = t.seats[t.toAct];
  if (!s || s.folded) { stepAdvance(); return; }
  /* 机器人思考时间：3 ~ 11 秒随机，越接近决策期限越像真人在长考 */
  var think = S.settings.fastAI ? (600 + Math.random() * 500) : (AI_THINK_MIN + Math.random() * (AI_THINK_MAX - AI_THINK_MIN));
  TT.thinkSeat = t.toAct; TT.thinkMs = think;
  setCd(t.toAct, TT.thinkMs);        /* ★ 倒计时打在正在思考那个人的头像上（时长 = 本次思考毫秒） */
  renderAll();
  TT.timer = setTimeout(function () {
    TT.thinkSeat = -1;
    clearCd();
    var d = aiDecide(t, s);
    doAction(t, s.idx, d.type, d.amt);
    renderAll();
    maybeInsurance();
    setTimeout(stepAdvance, 350);
  }, think);
}
function startHeroTimer() {
  TT.heroLeft = HERO_SEC;
  TT.heroGrace = false;
  clearInterval(TT.heroTimer);
  renderActions();
  TT.heroTimer = setInterval(function () {
    TT.heroLeft -= 0.1;
    if (TT.heroLeft <= 0) {
      if (!TT.heroGrace) {
        /* 第一阶段（15s）用完 → 进入 5 秒宽限：环变红 + 提醒，但不替玩家行动 */
        TT.heroGrace = true;
        TT.heroLeft = HERO_GRACE_SEC;
        toast('决策超时！再不操作将在 ' + HERO_GRACE_SEC + ' 秒后被弃牌并请出房间', 'err', 2600);
        updateHeroTimerRing(true);
        return;
      }
      /* 宽限（5s）也用完 → 强制弃牌 + 请出房间 */
      clearInterval(TT.heroTimer);
      toast('超时未操作，已自动弃牌并离开房间', 'err', 2800);
      heroAction('fold');     /* 先记录弃牌（本手作废） */
      leaveTable(true);       /* 静默离开：本金退回、同步服务端、回大厅（不弹二次确认） */
      return;
    }
    updateHeroTimerRing(TT.heroGrace);
  }, 100);
}
function heroAction(type, amt) {
  clearInterval(TT.heroTimer);
  var t = TT.t;
  /* ★ 资金闸门：桌上没钱就不许下注（全下的情况由 allin 标记放行——那是本手已经押完了） */
  var hs = t.seats[t.heroSeat];
  if (tbNum(hs.usdt) <= 0 && !hs.allin && type !== 'fold') { showBuyIn(false, startAfterBuy); return; }
  doAction(t, t.heroSeat, type, amt);
  TT.raising = false;
  renderAll();
  maybeInsurance();
  setTimeout(stepAdvance, 400);
}
function stepAdvance() {
  if (!TT || !TT.t) return;
  var t = TT.t;
  if (t.status === 'showdown') return;
  var live = t.seats.filter(function (s) { return !s.empty && !s.folded && !s.sittingOut; });
  if (live.length === 1) { settle(); return; }
  if (roundDone(t)) {
    var r = advance(t);
    renderAll();
    maybeInsurance();
    if (r === 'showdown') { setTimeout(settle, 700); return; }
    if (t.modeKey === 'pineapple' && t.street === 1 && !t.discardDone) { doDiscardPhase(); return; }
    setTimeout(loop, 500);
    return;
  }
  t.toAct = nextSeat(t, t.toAct);
  if (t.toAct < 0) { var rr = advance(t); renderAll(); if (rr === 'showdown') setTimeout(settle, 700); else setTimeout(loop, 500); return; }
  renderAll();
  loop();
}
/* 疯狂菠萝：翻牌后弃牌阶段 */
function doDiscardPhase() {
  var t = TT.t, hero = t.seats[t.heroSeat];
  t.seats.forEach(function (s) { if (!s.empty && !s.folded && s !== hero) autoDiscard(t, s); });
  if (hero.folded || hero.hole.length <= 2) { discardAll(t); renderAll(); setTimeout(loop, 400); return; }
  var sel = [0, 1];
  openModal({
    title: '疯狂菠萝 · 弃掉一张底牌',
    sub: '翻牌后必须弃 1 张，用剩余 2 张 + 公共牌组成成手',
    closable: false, cancelText: null, okText: '确认保留这 2 张',
    body: '<div class="ins-cards">' + hero.hole.map(function (c, i) {
      return '<div class="pk' + (i < 2 ? ' on' : '') + '" data-pk="' + i + '">' + cardHTML(c, { size: 'md' }) + '</div>';
    }).join('') + '</div>' +
      '<div class="ins-cards mt12">' + t.community.map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') + '</div>' +
      '<div class="tiny txt3 center mt8">点击选择要保留的 2 张牌</div>',
    onReady: function (root) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-pk]'); if (!b) return;
        var i = +b.dataset.pk, k = sel.indexOf(i);
        if (k >= 0) { if (sel.length <= 1) return; sel.splice(k, 1); }
        else { if (sel.length >= 2) sel.shift(); sel.push(i); }
        $$('[data-pk]', root).forEach(function (x) { x.classList.toggle('on', sel.indexOf(+x.dataset.pk) >= 0); });
      });
    },
    onOk: function () {
      if (sel.length !== 2) { toast('请选择 2 张保留', 'err'); return false; }
      hero.hole = [hero.hole[sel[0]], hero.hole[sel[1]]];
      t.discardDone = true; hero.lastAct = '弃底牌';
      toast('已弃掉 1 张底牌');
      renderAll(); setTimeout(loop, 400);
    }
  });
}
function settle() {
  var t = TT.t;
  if (TT.thinkSeat >= 0) TT.thinkSeat = -1;
  clearCd();                                  /* 清掉可能残留的倒计时环 */
  if (t.street !== 4) showdown(t);
  renderAll();
  /* 保险结算 */
  var hero = t.seats[t.heroSeat];
  var heroWon = (t.result || []).some(function (r) { return r.seat === t.heroSeat && r.amount > 0; });
  if (TT.ins) {
    if (!heroWon) { hero.usdt += TT.ins.payout; toast('保险赔付 +' + uStr(TT.ins.payout), 'ok', 2600); }
    else toast('保险未生效，保费 ' + fmt(TT.ins.premium) + ' 已扣除');
    TT.ins = null;
  }
  /* 结果横幅 */
  var winTxt = (t.result || []).map(function (r) { return r.name + ' 赢得 ' + fmt(r.amount) + (r.hand ? '（' + r.hand + (r.low ? '·低牌' : '') + '）' : ''); }).join(' / ');
  if (t.rake) winTxt += ' · 平台抽水 ' + fmt(t.rake) + (t.rebate ? ' · VIP返水 +' + fmt(t.rebate) : '');
  var felt = $('#felt', TT.root);
  if (felt) {
    var b = document.createElement('div');
    b.className = 'result-banner'; b.textContent = winTxt || '本手结束';
    felt.appendChild(b);
    setTimeout(function () { b.remove(); }, 3200);
  }
  /* 写入手牌历史 */
  saveHandHistory();
  reportHandRemote();          /* ★ 上报服务端：后台「牌局记录」的来源 */
  TT.insShown = false;
  TT.nextTimer = setTimeout(beginNextHand, NEXT_HAND_DELAY_MS);
}
/* ★ 2026-10-03：下一局的开启逻辑从 settle 的匿名 setTimeout 里抽出来 ——
   底部「继续」按钮点了就直接调它（并取消挂着的定时器），不用干等倒计时。 */
function beginNextHand() {
  if (!TT || !TT.t) return;
  if (TT.nextTimer) { TT.nextTimer = null; }
  var t = TT.t;
  t.seats.forEach(function (s) { s.win = 0; s.lastAct = ''; s.bet = 0; });
  if (TT.pendingSeat != null) { var ps = TT.pendingSeat; TT.pendingSeat = null; moveHeroSeat(ps); }
  /* ★ 2026-10-03：上一局已打完 → 兑现「等这局打完就上桌」的承诺，正式取消旁听标记 */
  if (TT.pendingSit) {
    TT.pendingSit = false;
    t.seats[t.heroSeat].sittingOut = false;
    toast('入座成功 · 这手开始给你发牌', 'ok', 2200);
  }
  /* ★ 机器人补码：以前机器人输光就永远空着，几手之后整桌无人可打、直接变空桌。 */
  applyPendingSeatChanges(t);
  botRefill(t);
  var heroS = t.seats[t.heroSeat];
  /* ★ 开了「自动补码」且账户有余额 → 自动补 100BB，输光了也不用每手手动点买入 */
  if (heroNeedsBuy() && S.settings.autoRebuy && tbNum(pracBal()) > 0) {
    var auto = Math.min(t.bb * 100, tbNum(pracBal()));
    tbBuy(auto); heroS.usdt += auto;
    toast('自动补码 +' + fmt(auto), 'ok', 2000);
  }
  if (heroNeedsBuy()) {
    /* ★ 2026-10-02 修「买入后牌桌永久卡死」：这里以前 showBuyIn(true) 之后就结束了，
       买完钱进来了却没人再调 loop()，屏幕一直停在「本手已结束」，只能重进牌桌。
       现在买入完成（钱真的到桌上）才自动重开下一手；没买就停在等待，不再发牌。 */
    toast(tbNum(pracBal()) > 0 ? '牌桌余额已输光，请先买入' : '牌桌和账户都是 0，请先充值再买入', 'err');
    showBuyIn(true, startAfterBuy);
    return;
  }
  if (!startHand(t)) {
    /* ★ 2026-10-03：以前这里 toast 完直接 return —— 定时器已清、loop 也没人调，
       牌桌就死在「玩家不足」。现在交给 waiting 自愈循环（1.2 秒一试），
       成员同步 / 补码到位后自动开下一手。 */
    toast('玩家不足，等待中…');
    renderAll(); loop();
    return;
  }
  renderAll(); loop();
}
/* 机器人补码：座位上的 AI USDT掉到 1BB 以下就带回一注新的。
   ★ 只改桌上余额数字，不碰 S.user / 不碰任何账户记账 —— 机器人不是真钱参与者。 */
function botRefill(t) {
  /* ★ 2026-10-04：机器人总开关关闭时，本桌已无机器人座位，无需补码（直接返回）。 */
  if (!BOTS.on) return;
  var base = t.bb * 60;
  t.seats.forEach(function (s) {
    if (s.empty || s.idx === t.heroSeat) return;
    if (s.user && s.user.realMember) return;      /* 房间里的真人不代为充值 */
    if (s.usdt <= t.bb) s.usdt = Math.round(base * (0.6 + Math.random() * 0.9));
    if (s.usdt > 0) s.sittingOut = false;
  });
}
/* ★ 2026-10-02 新增：把每手结果上报服务端 —— 后台「牌局记录」页的数据来源。
   没有它，查作弊、算抽水、看玩家真实盈亏都无从下手（以前服务端对牌局一无所知）。
   只上报必要的结算信息，不下发任何策略细节。 */
function reportHandRemote() {
  if (!apiTokenGet() || !TT || !TT.t) return;
  var t = TT.t, hero = t.seats[t.heroSeat];
  var won = (t.result || []).filter(function (r) { return r.seat === t.heroSeat; }).reduce(function (a, b) { return a + (b.amount || 0); }, 0);
  apiHandReport({
    table: t.name + ' ' + t.sb + '/' + t.bb, handNo: '#' + t.handNo, mode: t.modeKey,
    pot: t.pot, rake: t.rake || 0, rebate: t.rebate || 0,
    board: t.community.map(cardStr), hole: hero.hole.map(cardStr),
    seat: t.heroSeat, won: won, contrib: hero.contrib || 0,
    roomNo: (TT.src && TT.src.roomNo) ? String(TT.src.roomNo) : '',
    result: (t.result || []).slice(0, 6).map(function (r) { return r.name + '+' + r.amount; }).join('/')
  }).then(function () { });
  /* ★ 2026-10-04：机器人本手收支上报（后台「机器人收支」看板数据源）。
     只统计「非真人、非房主好友」的机器人座位：投入 / 赢得 / 净赢 / 抽水。
     私人房没有机器人，botSeats=0，不会上报；机器人总开关关闭时本桌也无机器人。 */
  var botWon = 0, botContrib = 0, botSeats = 0;
  t.seats.forEach(function (s) {
    if (s.empty || s.idx === t.heroSeat || (s.user && s.user.realMember)) return;
    botSeats++;
    botContrib += (s.contrib || 0);
    botWon += (t.result || []).filter(function (r) { return r.seat === s.idx; }).reduce(function (a, b) { return a + (b.amount || 0); }, 0);
  });
  if (botSeats > 0) {
    apiCall('/hands/botreport', {
      method: 'POST',
      body: {
        table: t.name + ' ' + t.sb + '/' + t.bb, handNo: '#' + t.handNo, mode: t.modeKey,
        pot: t.pot, rake: t.rake || 0, botWon: botWon, botContrib: botContrib, botNet: botWon - botContrib, botSeats: botSeats
      }
    }).then(function () { });
  }
}
function saveHandHistory() {
  var t = TT.t, hero = t.seats[t.heroSeat];
  var players = t.seats.filter(function (s) { return !s.empty && s.hole.length; }).map(function (s) {
    return {
      name: s.user.name, color: s.user.color, hole: s.hole.slice(), contrib: s.contrib,
      rank: evalBest(s.hole.concat(t.community)), win: (t.result || []).some(function (r) { return r.seat === s.idx && r.amount > 0; }), seat: s.idx
    };
  });
  var heroWon = (t.result || []).some(function (r) { return r.seat === t.heroSeat && r.amount > 0; });
  var streets = [0, 1, 2, 3].map(function (st) {
    return {
      name: ['翻牌前', '翻牌', '转牌', '河牌'][st],
      actions: t.log.filter(function (l) { return l.street === st && l.name; }).map(function (l) { return { name: l.name, act: l.act, amt: l.amt || 0 }; })
    };
  });
  S.history.unshift({
    id: Date.now(), ts: Date.now(), table: t.name + ' ' + t.sb + '/' + t.bb, handNo: '#' + t.handNo, pot: t.pot,
    heroHole: hero.hole.slice(), heroRank: evalBest(hero.hole.concat(t.community)), heroWin: heroWon,
    heroNet: heroWon ? (t.result || []).filter(function (r) { return r.seat === t.heroSeat; }).reduce(function (a, b) { return a + b.amount; }, 0) - hero.contrib : -hero.contrib,
    community: t.community.slice(), players: players, streets: streets
  });
  if (S.history.length > 60) S.history.pop();
}

/* 把 hero 从当前座位搬到 idx：桌上余额跟着人走，旧座位清空（避免出现两个 hero）。
   ★ 2026-10-03：不再自动从账户补买入 —— 换座只带桌上现有的钱，补码走买入面板。 */
function moveHeroSeat(idx) {
  if (!TT || !TT.t) return false;
  var t = TT.t, old = t.seats[t.heroSeat], target = idx;
  if (target == null || target < 0 || target >= t.cap) return false;
  if (target === t.heroSeat) return true;
  var carry = 0;
  if (old && !old.empty && old.user && String(old.user.id) === String(S.user.id)) {
    carry = Math.max(0, Math.round(old.usdt || 0));
    old.empty = true; old.user = null; old.hole = []; old.usdt = 0; old.bet = 0;
    old.folded = true; old.allin = false; old.acted = false; old.contrib = 0; old.sittingOut = true;
  }
  /* ★ 2026-10-03 资金闸门：换座位只带走「已经在桌上」的钱，
     不再自动从账户划钱补到 100BB —— 想补码走左侧「买入」面板，
     钱从账户出去必须玩家在面板里亲眼确认，任何路径都不许悄悄扣。 */
  seatPlayer(t, target, S.user, carry);
  t.heroSeat = target;
  renderAll();
  toast('已换到座位 ' + (target + 1) + '（带入 ' + fmt(carry) + '）', 'ok');
  return true;
}

/* ---------- 保险 ---------- */
function maybeInsurance() {
  if (!TT || !S.settings || !TT.src.insurance) return;
  if (!TT.heroSeated) return;          /* ★ 还没入座：别给旁观的人弹保险 */
  var t = TT.t;
  if (TT.insShown || t.street < 0 || t.street >= 3) return;
  var off = insuranceOffer(t, t.heroSeat);
  if (!off) return;
  var hero = t.seats[t.heroSeat];
  if (hero.allin && hero.folded) return;
  TT.insShown = true;
  showInsurance(off);
}
function showInsurance(off) {
  var t = TT.t, hero = t.seats[t.heroSeat];
  var oppCards = '';
  var opp = t.seats.filter(function (s) { return !s.empty && !s.folded && s.idx !== t.heroSeat; })[0];
  if (opp && opp.hole.length) oppCards = '<div class="ins-cards">' + opp.hole.map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') + '</div>';
  var m = openModal({
    title: 'EV 保险', sub: 'All-in 保护 · 亏损可获赔付', size: '',
    closable: false, cancelText: '不投保', okText: '立即投保 ' + cv(off.premium),
    body: '<div class="ins-hero">' +
      '<div class="ins-cards">' + hero.hole.map(function (c) { return cardHTML(c, { size: 'md' }); }).join('') +
      '<span class="vs">VS</span>' + (oppCards || '<span class="tiny txt3">对手</span>') + '</div>' +
      '<div class="ins-cards" style="margin-top:6px">' + t.community.map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') + '</div>' +
      '<div class="ins-stats mt12">' +
      '<div class="ins-stat"><div class="k">获胜概率</div><div class="v green">' + (off.equity * 100).toFixed(1) + '%</div></div>' +
      '<div class="ins-stat"><div class="k">补牌数 OUTS</div><div class="v gold">' + off.outs + ' 张</div></div>' +
      '<div class="ins-stat"><div class="k">最高赔付</div><div class="v gold">' + fmt(off.payout) + '</div></div>' +
      '<div class="ins-stat"><div class="k">保费</div><div class="v">' + fmt(off.premium) + '</div></div>' +
      '</div>' +
      (off.outs ? '<div class="ins-outs">' + off.cards.slice(0, 14).map(function (c) { return cardHTML(c, { size: 'xs' }); }).join('') + '</div>' : '') +
      '<div class="ins-note mt8">若本手未能赢下底池，将获得最高 <b class="gold">' + fmt(off.payout) + '</b> 赔付；若获胜，仅扣除保费。<br>保费已含 6% 手续费</div>' +
      '<div class="ins-timer"><i id="ins-bar" style="width:100%"></i></div>' +
      '</div>',
    onOk: function (root, close) {
      if (hero.usdt < off.premium) { toast('余额不足，无法投保', 'err'); return false; }
      hero.usdt -= off.premium;
      TT.ins = { premium: off.premium, payout: off.payout };
      toast('投保成功，最高赔付 ' + fmt(off.payout), 'ok');
      renderAll();
    },
    onReady: function (root, close) {
      var left = 8;
      var bar = $('#ins-bar', root);
      var iv = setInterval(function () {
        left--; if (bar) bar.style.width = (left / 8 * 100) + '%';
        if (left <= 0) { clearInterval(iv); close(); }
      }, 1000);
    }
  });
}

/* ---------- 座位菜单 ---------- */
function showSeatMenu(s) {
  var isHero = s.idx === TT.t.heroSeat;
  openSheet({
    title: esc(s.user.name) + (isHero ? '（我）' : ''),
    body: '<div class="row" style="gap:12px;margin-bottom:12px">' + avatarHTML(s.user, 'lg') +
      '<div class="col grow"><div class="b">' + esc(s.user.name) + '</div>' +
      '<div class="tiny txt3">ID ' + s.user.id + ' · Lv.' + s.user.level + ' · ' + s.user.country + '</div>' +
      '<div class="tiny txt3">余额 ' + uStr(s.usdt) + ' · 本手投入 ' + uStr(s.contrib) + '</div></div></div>' +
      '<div class="grid g2 gap8">' +
      (isHero ? '' : '<div class="btn ghost" data-sm="gift">赠送金币</div><div class="btn ghost" data-sm="friend">加为好友</div>' +
        '<div class="btn ghost" data-sm="chat">私聊</div><div class="btn ghost" data-sm="block">拉黑</div>' +
        '<div class="btn ghost" data-sm="report">举报</div>') +
      (isHero ? '<div class="btn ghost" data-sm="buyin">买入/加码</div><div class="btn ghost" data-sm="sitout">站起/坐下</div>' +
        '<div class="btn ghost" data-sm="reveal">亮出底牌</div><div class="btn ghost" data-sm="leave">离开牌桌</div>' : '') +
      '</div>' +
      '<div class="section-title">最近数据</div>' +
      '<div class="stat-grid">' +
      '<div class="stat-box"><div class="v">24.8%</div><div class="k">VPIP</div></div>' +
      '<div class="stat-box"><div class="v">19.2%</div><div class="k">PFR</div></div>' +
      '<div class="stat-box"><div class="v">8.4%</div><div class="k">3Bet</div></div>' +
      '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-sm]'); if (!b) return;
        var a = b.dataset.sm;
        close();
        if (a === 'gift') showGift(s.user);
        /* ★ 好友走真实接口。注意：当前牌桌上的对手是**本地模拟**的，
           他们的 uid 在服务端并不存在，所以这里会如实返回「玩家不存在」。
           等真人同桌（真多人）落地后，这一行不用改就能用。 */
        if (a === 'friend') apiFriendReq(s.user.id).then(function (r) {
          if (r.code === 200 && r.j && r.j.ok) toast(r.j.msg || '申请已发送', 'ok');
          else toast((r.j && r.j.msg) || '操作失败，请重试', 'err');
        });
        if (a === 'chat') openPrivateChat(s.user);
        if (a === 'block') apiFriendBlock(s.user.id, true).then(function (r) {
          toast((r.j && r.j.msg) || (r.code === 200 ? '已加入黑名单' : '操作失败'), r.code === 200 ? 'ok' : 'err');
        });
        if (a === 'report') toast('举报已提交，感谢反馈', 'ok');
        if (a === 'buyin') showBuyIn();
        if (a === 'sitout') { s.sittingOut = !s.sittingOut; toast(s.sittingOut ? '已站起，下一手不参与' : '已回到牌桌'); renderAll(); }
        if (a === 'reveal') { TT.emo[s.idx] = '🃏'; toast('已亮牌（仅本手）'); renderAll(); }
        if (a === 'leave') leaveTable();
      });
    }
  });
}

/* ---------- 买入 / 加码 ---------- */
function showBuyIn(force, done) {
  pracTopUp();   /* ★ 练习币免费供应：新号/输光也能继续练习（与真钱 USDT 完全隔离） */
  var t = TT.t, hero = t.seats[t.heroSeat];
  /* cb：买入成功后重开牌局用的回调（见 settle() 里的「余额不足」分支） */
  /* ★ 买入只能从「练习币」出（桌上余额已经在这张桌子上，不需要也不许再加第二份） */
  var acc = tbNum(pracBal());
  var min = t.bb * 20, max = Math.min(t.bb * 200, acc);
  /* ★ 账户余额也是 0（输光了 / 新号）：没得可买，直接引导去充值，别给一个 0 刻度的滑杆 */
  if (max <= 0) {
    openSheet({
      title: '买入 / 加码',
      sub: '账户余额不足',
      body: '<div class="center" style="padding:14px 0">' +
        '<div class="tiny txt3">牌桌余额</div><div class="b gold" style="font-size:22px">' + uStr(hero.usdt) + '</div>' +
        '<div class="tiny txt3 mt12">账户余额</div><div class="b" style="font-size:22px">0</div>' +
        '<div class="tiny txt3 mt12">练习币已补充，可继续练习 · 真钱对局请到大厅开房与好友对战</div></div>' +
        '<button class="btn gold block lg mt12" id="bi-charge">去充值</button>' +
        '<button class="btn ghost block mt8" id="bi-close">稍后再说</button>',
      onReady: function (root, close) {
        $('#bi-charge', root).onclick = function () { close(); showRecharge(); };
        $('#bi-close', root).onclick = function () { close(); renderAll(); };
      }
    });
    return;
  }
  if (min > max) min = max;
  var def = Math.min(t.bb * 100, max);
  openSheet({
    title: '买入 / 加码',
    body: '<div class="row" style="justify-content:space-between;margin-bottom:10px">' +
      '<div class="col"><div class="tiny txt3">牌桌余额</div><div class="b gold" style="font-size:18px">' + uStr(hero.usdt) + '</div></div>' +
      '<div class="col" style="text-align:right"><div class="tiny txt3">练习币</div><div class="b" style="font-size:18px">' + fmt(pracBal()) + '</div></div>' +
      '</div>' +
      '<div class="tiny txt3" style="margin-bottom:10px">桌上可取回本金 ' + fmt(tbCanCash()) + '（赢来的净盈利不可取出）</div>' +
      '<div class="raise-panel">' +
      '<div class="raise-row"><div class="col grow">' +
      '<input type="range" id="bi-slider" min="' + min + '" max="' + max + '" step="' + t.bb + '" value="' + def + '" style="--p:50%">' +
      '<div class="tiny txt3 mt8">最小 ' + fmt(min) + ' · 最大 ' + fmt(max) + ' USDT</div></div>' +
      '<div class="raise-amt" id="bi-amt">' + cv(def) + '</div></div>' +
      '<div class="raise-presets">' + [20, 50, 100, 200].map(function (bb) {
        return '<div class="btn sm ghost" data-bi="' + (t.bb * bb) + '">' + bb + 'BB</div>';
      }).join('') + '</div>' +
      '</div>' +
      '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">自动补码至 100BB</div><div class="li-sub">每手结束后自动补足</div></div><div class="switch' + (S.settings.autoRebuy ? ' on' : '') + '" id="bi-auto"></div></div>' +
      '<button class="btn gold block lg mt12" id="bi-ok">确认买入</button>' +
      (force ? '' : '<button class="btn ghost block mt8" id="bi-cash">取回本金 ' + short(tbCanCash()) + '</button>'),
    onReady: function (root, close) {
      var sl = $('#bi-slider', root), amtEl = $('#bi-amt', root), cur = def;
      sl.oninput = function () { cur = +this.value; amtEl.textContent = cv(cur); this.style.setProperty('--p', Math.round((cur - min) / Math.max(1, max - min) * 100) + '%'); };
      $$('[data-bi]', root).forEach(function (b) { b.onclick = function () { cur = Math.min(+b.dataset.bi, max); sl.value = cur; amtEl.textContent = cv(cur); }; });
      $('#bi-auto', root).onclick = function () { this.classList.toggle('on'); S.settings.autoRebuy = this.classList.contains('on'); saveState(); };
      $('#bi-ok', root).onclick = function () {
        var need = cur - hero.usdt;
        if (need <= 0) { toast('当前余额已足够'); close(); if (done) done(); return; }
        if (need > pracBal()) { toast('练习币不足', 'err'); return; }
        tbBuy(need); hero.usdt += need;
        toast('买入成功 +' + fmt(need), 'ok'); close(); renderAll();
        if (done) setTimeout(done, 260);
      };
      var cash = $('#bi-cash', root);
      if (cash) cash.onclick = function () {
        /* ★★ 只取回「本金」：hero.usdt 可能已经含了净赢的部分，
           tbCanCash() 会把超额那截挡在桌上（不能拿赢来的钱去兑 USDT 提现）。 */
        var back = Math.min(hero.usdt, tbCanCash());
        if (back <= 0) { toast('桌上没有本金可取，桌上没有本金可取', 'err'); return; }
        hero.usdt -= back;
        tbCash(back);
        toast('已取回 ' + fmt(back) + ' U' + (hero.usdt > 0 ? '，剩余 ' + uStr(hero.usdt) + ' 留在桌上（净盈利）' : ''), 'ok');
        close(); renderAll();
      };
    }
  });
}

/* ---------- 互动道具 / 表情 ---------- */
function showProps(seatIdx) {
  var emos = ['👍', '😎', '😂', '😡', '👏', '🤔', '😱', '🔥', '💰', '🎯', '🤝', '🙏'];
  openSheet({
    title: '互动',
    body: '<div class="section-title" style="margin-top:0">表情</div><div class="emo-grid">' +
      emos.map(function (e) { return '<div class="e" data-emo="' + e + '">' + e + '</div>'; }).join('') + '</div>' +
      '<div class="section-title">快捷短语</div><div class="quick-grid">' +
      ['打得不错', '运气真好', '再来一把', '这牌也能跟？', '我弃了', '好运！'].map(function (q) {
        return '<div class="q" data-quick="' + q + '">' + q + '</div>';
      }).join('') + '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var target = seatIdx != null ? seatIdx : TT.t.heroSeat;
        var em = e.target.closest('[data-emo]');
        if (em) {
          TT.emo[target] = em.dataset.emo; close(); renderAll();
          setTimeout(function () { delete TT.emo[target]; renderAll(); }, 1500); return;
        }
        var q = e.target.closest('[data-quick]');
        if (q) { pushChat('table', S.user, q.dataset.quick); toast('已发送'); close(); }
      });
    }
  });
}

/* ---------- 牌桌菜单（桌面上唯一的「⋯」入口） ---------- */
/* ★ 2026-10-02 桌面简约化：桌面上所有零散小功能都收进这里 ——
   记分牌 / 手牌回顾 / 聊天 / 互动表情 / 音效 / 设置 / 全屏 / 保险 / 胜率。
   每行第 5 位为 1 表示这一行是「开关行」（画 .switch 而不是右箭头）。 */
function showTableMenu() {
  var t = TT.t, hero = t.seats[t.heroSeat];
  var isOwner = TT.src.private && TT.src.owner === S.user.id;
  var groups = [
    ['本桌', [
      ['buyin', 'wallet', '买入 / 加码', '当前 ' + uStr(hero.usdt)],
      /* ★ 房间号用服务端发的那个（roomNo）；本地编的 id 不能当房间号给好友 */
      ['invite', 'invite', '邀请好友入座', TT.src.roomNo ? ('房间号 ' + TT.src.roomNo + ' · 对方同意才入座') : '本桌没有服务端房间号'],
      ['invite-friend', 'invite', '邀请好友', '从好友列表邀请'],
      ['owner', 'shield', '房主设置', isOwner ? '你是房主，可管理本桌' : '仅房主可用'],
      ['wait', 'clock', '等待列表', rnd(0, 4) + ' 人排队中'],
      ['mode-rule', 'list', '玩法规则', t.mode.name + ' · ' + betTypeName(t.mode.bet)],
      ['rake', 'info', '抽水规则', rakeText(t)]
    ]],
    ['牌局', [
      ['hand-history', 'history', '手牌回顾', '查看历史牌局'],
      ['scoreboard', 'stats', '记分牌', '本桌数据统计'],
      ['odds', 'target', '胜率 / 赔率', '实时胜率与赔率'],
      ['insurance-info', 'shield', '保险说明', TT.src.insurance ? '本桌已开启' : '本桌未开启']
    ]],
    ['互动与显示', [
      ['emo', 'smile', '互动 / 表情', '表情、快捷短语'],
      ['chat', 'chat', '牌桌聊天', '与同桌玩家交流'],
      ['sound', S.settings.sound ? 'volume' : 'mute', '音效', S.settings.sound ? '已开启' : '已关闭', 1],
      ['table-settings', 'settings', '牌桌设置', '音效 / 牌背 / 桌布'],
      ['fullscreen', 'grid', '全屏', '全屏显示牌桌']
    ]],
    ['其他', [
      ['rule', 'help', '规则说明', '德州扑克规则'],
      ['report', 'warn', '举报', '违规行为举报'],
      ['leave', 'logout', '离开牌桌', '返回大厅']
    ]]
  ];
  openSheet({
    title: '牌桌菜单 · ' + t.name + ' ' + t.sb + '/' + t.bb,
    body: groups.map(function (g, gi) {
      return '<div class="section-title"' + (gi ? '' : ' style="margin-top:0"') + '>' + g[0] + '</div>' +
        '<div class="list">' + g[1].map(function (it) {
          return '<div class="li" data-tm="' + it[0] + '">' +
            '<div class="tm-ico center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2);color:var(--txt2)">' + icon(it[1], 18) + '</div>' +
            '<div class="grow"><div class="li-title">' + it[2] + '</div><div class="li-sub">' + it[3] + '</div></div>' +
            (it[4] ? '<div class="switch' + (S.settings.sound ? ' on' : '') + '"></div>' : icon('right', 16)) +
            '</div>';
        }).join('') + '</div>';
    }).join(''),
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-tm]'); if (!b) return;
        var a = b.dataset.tm;
        /* 音效：就地切换，不关菜单（关掉菜单还得重新翻回来） */
        if (a === 'sound') {
          S.settings.sound = !S.settings.sound;
          saveState(); applySetting('sound', S.settings.sound);
          var sw = b.querySelector('.switch'); if (sw) sw.classList.toggle('on', S.settings.sound);
          var ic = b.querySelector('.tm-ico'); if (ic) ic.innerHTML = icon(S.settings.sound ? 'volume' : 'mute', 18);
          var sub = b.querySelector('.li-sub'); if (sub) sub.textContent = S.settings.sound ? '已开启' : '已关闭';
          return;
        }
        close();
        if (a === 'buyin') showBuyIn();
        /* ★ 两个邀请入口都走服务端（房间号 + pending 邀请）。
           本桌若没有服务端房间号（老房间/快速开始），先引导建房，别再「假邀请」。 */
        /* ★ showTableInvite（不叫 showInvite —— misc.js 里已有一个全局 showInvite（拉新/邀请码面板），
           两个同名函数会互相覆盖，misc.js 后加载会顶掉牌桌的，点「邀请好友」就弹出拉新面板） */
        if (a === 'invite') { if (TT.src.roomNo) inviteFriendsToRoom(TT.src); else showTableInvite(); }
        if (a === 'invite-friend') { if (TT.src.roomNo) inviteFriendsToRoom(TT.src); else showTableInvite(); }
        if (a === 'owner') showOwnerSettings();
        if (a === 'wait') showWaitList();
        if (a === 'mode-rule') showModeDetail(TT.t.modeKey);
        if (a === 'rake') go('rake');
        if (a === 'hand-history') Screens.handHistory();
        if (a === 'scoreboard') showScoreboard();
        if (a === 'odds') showOdds();
        if (a === 'insurance-info') showInsuranceInfo();
        if (a === 'emo') showProps(null);
        if (a === 'chat') openChatPanel();
        if (a === 'table-settings') showTableSettings();
        if (a === 'fullscreen') toast('全屏切换（演示）');
        if (a === 'rule') Screens.rule();
        if (a === 'report') toast('举报入口已打开（演示）');
        if (a === 'leave') leaveTable();
      });
    }
  });
}
function showScoreboard() {
  var t = TT.t;
  openModal({
    title: '记分牌', size: 'wide', buttons: false,
    body: '<div class="scoreboard">' +
      '<div class="hd"><div class="c1">玩家</div><div class="c2">USDT</div><div class="c2">本手投入</div><div class="c2">入池率</div></div>' +
      t.seats.filter(function (s) { return !s.empty; }).map(function (s) {
        return '<div class="rw"><div class="c1">' + avatarHTML(s.user, 'sm') + '<span>' + esc(s.user.name) + '</span>' +
          (s.idx === t.dealerSeat ? '<span class="tag">D</span>' : '') + '</div>' +
          '<div class="c2 gold">' + uStr(s.usdt) + '</div><div class="c2">' + uStr(s.contrib) + '</div><div class="c2">' + rnd(18, 68) + '%</div></div>';
      }).join('') + '</div>' +
      '<div class="section-title">我的本桌数据</div><div class="stat-grid">' +
      '<div class="stat-box"><div class="v">' + t.handNo + '</div><div class="k">手牌数</div></div>' +
      '<div class="stat-box"><div class="v">' + uStr(t.seats[t.heroSeat].usdt - TT.buyIn) + '</div><div class="k">盈亏</div></div>' +
      '<div class="stat-box"><div class="v">' + rnd(20, 40) + '%</div><div class="k">入池率</div></div></div>'
  });
}
function showInsuranceInfo() {
  openModal({
    title: 'EV 保险说明', buttons: false, size: '',
    body: '<div class="ins-note" style="text-align:left;line-height:1.8;font-size:13px">' +
      '<p><b>什么是 EV 保险？</b><br>当牌局中出现 All-in 时，系统会根据你的补牌数（Outs）实时计算获胜概率，并提供保险报价。</p>' +
      '<p><b>如何计算？</b><br>获胜概率 = 1 - (未中补牌概率)<br>保费 = 最高赔付 × (1 - 获胜概率) × 1.06（含 6% 手续费）</p>' +
      '<p><b>赔付规则</b><br>若你未赢下底池，获得最高赔付；若你赢下底池，仅扣除保费。</p>' +
      '<p class="txt3">本桌保险状态：' + (TT.src.insurance ? '<b class="green">已开启</b>' : '<b class="red">未开启</b>') + '</p></div>'
  });
}
/* ★ 本桌没有服务端房间号时（快速开始 / 老房间）不再显示「复制房间号」这种假号码
   —— 以前是 `TT.t.id + '888'`，纯编出来骗人的。现在直接引导去建一个真房间。 */
/* ★★ 2026-10-05（用户要求：机器人练习桌也能邀请好友同桌）
   本桌没有服务端房间号时，点「邀请好友」→ 直接按本桌参数（玩法/盲注/人数上限 8）
   到服务端建一个**真房间**，把 roomNo 绑到本桌对象上，再走正常的邀请流程。
   这样机器人房和好友房用同一套邀请逻辑，好友从大厅搜房间号就能进来。 */
function showTableInvite() {
  if (!TT || !TT.t) { toast('牌桌未就绪', 'err'); return; }
  var t = TT.t;
  openSheet({
    title: '邀请好友同桌',
    body: '<div class="card"><div class="b">给这张桌子建一个真实房间</div>' +
      '<div class="tiny txt3 mt8" style="line-height:1.5">好友要能收到邀请、并且自己同意之后才入座，需要一个<b>真实房间</b>（房间号由服务端生成）。<br>' +
      '按本桌参数创建：' + esc(t.mode.name) + ' · ' + t.sb + '/' + t.bb + ' · 最多 ' + Math.min(8, t.cap) + ' 人。</div></div>' +
      '<button class="btn gold block lg mt12" id="si-create">创建房间并邀请</button>',
    onReady: function (root, close) {
      $('#si-create', root).onclick = function () {
        var b = this; b.disabled = true; b.textContent = '创建中…';
        apiRoomCreate({
          name: (S.user.name || '我') + '的房', modeKey: t.modeKey, sb: t.sb,
          cap: Math.min(8, t.cap), priv: 'public', straddle: !!t.straddle, ante: t.ante || 0
        }).then(function (r) {
          if (r.code !== 200 || !r.j || !r.j.room) {
            b.disabled = false; b.textContent = '创建房间并邀请';
            toast((r.j && r.j.msg) || '创建房间失败，请重试', 'err', 2800); return;
          }
          var room = tableFromRoom(r.j.room);
          S.tables = (S.tables || []).filter(function (x) { return !x.roomNo || String(x.roomNo) === String(room.roomNo); });
          S.tables.unshift(room);
          saveState();
          /* 把真房间号绑到当前这张桌：以后再点「邀请好友」直接走正常邀请流程 */
          TT.src.roomNo = room.roomNo;
          TT.src.owner = room.owner;
          TT.src.invited = [];
          close();
          setTimeout(function () { afterRoomCreated(room); }, 220);
        });
      };
    }
  });
}
/* 建房成功后给明确去向 —— 练习桌（跟机器人打）和真房间（跟好友打）是两张不同的桌子，
   不可能一边跟机器人打一边又让好友坐进来，所以必须让玩家选：进房间 / 只发邀请 / 留在本桌。 */
function afterRoomCreated(room) {
  var no = String(room.roomNo || '');
  openSheet({
    title: '房间已创建',
    body: '<div class="card gold center"><div class="tiny txt3">房间号（好友在大厅搜这个号就能进）</div>' +
      '<div class="b" style="font-size:30px;letter-spacing:4px;margin-top:6px">' + esc(no) + '</div></div>' +
      '<div class="tiny txt3 mt8" style="line-height:1.5">好友也可以凭这个房间号在大厅顶部搜索框直接找到房间。<br>' +
      '要跟好友同桌打，你自己也要进这个房间（点下面第一个按钮）。</div>' +
      '<div class="grid g1 gap8 mt12">' +
      '<div class="btn gold block lg" id="ar-enter">进入房间等好友</div>' +
      '<div class="btn ghost block" id="ar-invite">先邀请好友</div>' +
      '<div class="btn ghost block" id="ar-copy">复制房间号</div>' +
      '<div class="btn ghost block" id="ar-stay">留在本桌继续玩机器人</div></div>',
    onReady: function (root, close) {
      $('#ar-enter', root).onclick = function () {
        close();
        /* ★ 不要用 leaveTable()：它会 apiRoomLeave(roomNo)，把刚建好的房间座位也退掉。
           练习桌是练习币，直接跳页即可；房间里的座位留着，好友进来就能看到房主在座。 */
        if (TT) { clearInterval(TT.heroTimer); clearTimeout(TT.timer); if (TT.nextTimer) clearTimeout(TT.nextTimer); }
        location.href = 'table_rt.html?room=' + encodeURIComponent(no);
      };
      $('#ar-invite', root).onclick = function () { close(); setTimeout(function () { inviteFriendsToRoom(room); }, 200); };
      $('#ar-copy', root).onclick = function () {
        try { navigator.clipboard.writeText(no); toast('房间号已复制：' + no, 'ok'); }
        catch (e) { toast('房间号：' + no, 'ok', 3000); }
      };
      $('#ar-stay', root).onclick = function () { close(); toast('房间 ' + no + ' 已保留，随时可从大厅进入', 'ok', 2600); };
    }
  });
}
/* ---------- 房主设置 / 等待列表 / 空座位 ---------- */
function showOwnerSettings() {
  var src = TT.src, t = TT.t;
  if (!src.private || src.owner !== S.user.id) { toast('你不是本房间的房主', 'err'); return; }
  openSheet({
    title: '房主设置 · 房间 ' + (src.roomNo || src.id),
    body: '<div class="card gold"><div class="row"><div class="grow">' +
      '<div class="b">' + t.mode.name + ' ' + t.sb + '/' + t.bb + '</div>' +
      /* ★ 邀请数按「还在等对方同意」的 pending 数显示，别把本地 push 的假邀请算进去 */
      '<div class="tiny txt3 mt8">' + t.cap + ' 人桌 · ' + (src.passwd ? '密码 ' + esc(src.passwd) : '无需密码') + ' · ' +
      (src.invited || []).filter(function (x) { return x.status === 'pending'; }).length + ' 位待对方同意</div></div>' +
      '<span class="tag gold">房主</span></div></div>' +
      '<div class="section-title">房间管理</div>' +
      '<div class="list">' +
      '<div class="li" data-ow="pwd"><div class="grow"><div class="li-title">修改房间密码</div><div class="li-sub">' + (src.passwd || '当前无需密码') + '</div></div>' + icon('edit', 15) + '</div>' +
      '<div class="li" data-ow="minbuy"><div class="grow"><div class="li-title">最小买入</div><div class="li-sub">当前 ' + fmt(t.bb * 20) + '（20BB）</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-ow="invite"><div class="grow"><div class="li-title">邀请好友入座</div><div class="li-sub">从好友列表选择</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-ow="transfer"><div class="grow"><div class="li-title">转让房主</div><div class="li-sub">把房主身份交给其他玩家</div></div>' + icon('right', 16) + '</div>' +
      '</div>' +
      '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">锁定空座位</div><div class="li-sub">新玩家需房主批准</div></div><div class="switch" id="ow-lock"></div></div>' +
      '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">允许旁观</div><div class="li-sub">好友可观看你的底牌</div></div><div class="switch" id="ow-watch"></div></div>' +
      '<div class="section-title">座位管理（点击踢出）</div>' +
      '<div class="list">' + t.seats.filter(function (s) { return !s.empty && s.idx !== t.heroSeat; }).map(function (s) {
        return '<div class="li" data-ow-kick="' + s.idx + '">' + avatarHTML(s.user, 'sm') +
          '<div class="grow"><div class="li-title">' + esc(s.user.name) + '</div><div class="li-sub">余额 ' + uStr(s.usdt) + '</div></div>' +
          '<span class="tag red">踢出</span></div>';
      }).join('') + '</div>' +
      '<button class="btn red block mt16" data-ow="dismiss">解散房间</button>',
    onReady: function (root, close) {
      $('#ow-lock', root).onclick = function () { this.classList.toggle('on'); toast('已' + (this.classList.contains('on') ? '锁定' : '解锁') + '空座位'); };
      $('#ow-watch', root).onclick = function () { this.classList.toggle('on'); toast('旁观已' + (this.classList.contains('on') ? '开启' : '关闭')); };
      bindClick(root, function (e) {
        var k = e.target.closest('[data-ow-kick]');
        if (k) {
          var s = TT.t.seats[+k.dataset.owKick];
          if (!s || !s.user) return;
          var nm = s.user.name, uid = String(s.user.id);
          confirmBox('踢出玩家', '确定把 ' + nm + ' 移出房间吗？', '踢出', true).then(function (ok) {
            if (!ok) return;
            /* ★ 2026-10-02 修「踢人只是本地清空头像」：以前只动本地座位，
               对方在服务端还稳稳坐着，刷新一下又回来了。现在打到服务端 rooms/kick。 */
            var done = function () {
              s.empty = true; s.user = null; s.hole = []; s.usdt = 0; s.bet = 0; s.contrib = 0;
              s.folded = true; s.allin = false; s.acted = false; s.sittingOut = true;
              toast('已把 ' + nm + ' 移出房间', 'ok'); close(); renderAll();
            };
            if (!src.roomNo) { done(); return; }
            apiRoomKick(src.roomNo, uid).then(function (r) {
              if (r.code !== 200 || !r.j.ok) { toast((r.j && r.j.msg) || '踢出失败', 'err', 2800); return; }
              done();
            });
          });
          return;
        }
        var b = e.target.closest('[data-ow]'); if (!b) return;
        var a = b.dataset.ow;
        if (a === 'pwd') promptBox('修改房间密码', { label: '6 位密码（留空则取消密码）', value: src.passwd || '' }).then(function (v) {
          if (v === null) return;
          if (!src.roomNo) { src.passwd = v; toast(v ? '密码已更新' : '已取消密码', 'ok'); return; }
          /* ★ 密码以前只改本地字符串，别人用旧密码照样进。现在写回服务端。 */
          apiRoomSettings(src.roomNo, { passwd: String(v || '').slice(0, 12) }).then(function (r) {
            if (r.code !== 200 || !r.j.ok) { toast((r.j && r.j.msg) || '保存失败', 'err'); return; }
            src.passwd = String(v || '').slice(0, 12); saveState();
            toast(v ? '房间密码已更新' : '已取消房间密码', 'ok');
          });
        });
        if (a === 'minbuy') promptBox('最小买入（BB）', { label: '请输入 BB 数', value: '20', type: 'number' }).then(function (v) { if (v) toast('最小买入已设为 ' + v + 'BB', 'ok'); });
        if (a === 'invite') { close(); inviteFriendsToRoom(src); }
        if (a === 'transfer') {
          var list = TT.t.seats.filter(function (s) { return !s.empty && s.idx !== TT.t.heroSeat; });
          openSheet({
            title: '转让房主', body: '<div class="list">' + list.map(function (s) {
              return '<div class="li" data-tro="' + s.idx + '">' + avatarHTML(s.user, 'md') +
                '<div class="grow"><div class="li-title">' + esc(s.user.name) + '</div></div><div class="btn xs gold">转让</div></div>';
            }).join('') + '</div>',
            onReady: function (r2, c2) {
              bindClick(r2, function (e2) {
                var x = e2.target.closest('[data-tro]'); if (!x) return;
                var s = TT.t.seats[+x.dataset.tro];
                /* ★ 转让以前只是改本地变量：自己这边显示对方是房主了，服务端房主还是自己，
                   自己一走房间直接被服务端按「房主离开」处理。现在走 rooms/owner。 */
                var apply = function () { src.owner = String(s.user.id); saveState(); c2(); toast('已将房主转让给 ' + s.user.name, 'ok'); };
                if (!src.roomNo) { apply(); return; }
                apiRoomOwner(src.roomNo, String(s.user.id)).then(function (r) {
                  if (r.code !== 200 || !r.j.ok) { toast((r.j && r.j.msg) || '转让失败', 'err', 2800); return; }
                  apply();
                });
              });
            }
          });
        }
        /* ★ 解散以前只是自己 leaveTable 走人 —— 房间在服务端原封不动，
           其他人还在里面打，房主的「解散」按钮是个假动作。现在真的把房间删掉。 */
        if (a === 'dismiss') confirmBox('解散房间', '解散后房间号立即失效，座位上的所有人都会被移出，确定吗？', '解散', true).then(function (ok) {
          if (!ok) return;
          if (!src.roomNo) { toast('这是随机分配的牌桌，无需解散，直接离开即可', 'ok'); close(); leaveTable(true); return; }
          apiRoomClose(src.roomNo).then(function (r) {
            if (r.code !== 200 && r.code !== 404) { toast((r.j && r.j.msg) || '解散失败', 'err', 2800); return; }
            toast('房间已解散', 'ok'); close(); leaveTable(true);
          });
        });
      });
    }
  });
}
function showWaitList() {
  var q = [mkUser(91), mkUser(92), mkUser(93)];
  openSheet({
    title: '等待列表',
    body: '<div class="tiny txt3">玩家需经房主批准或自动分配后入座</div>' +
      '<div class="list mt12">' + q.map(function (u, i) {
        return '<div class="li">' + avatarHTML(u, 'md', { status: 1 }) +
          '<div class="grow"><div class="li-title">' + esc(u.name) + '</div>' +
          '<div class="li-sub">排队 ' + (i + 1) + ' 位 · 等待 ' + rnd(10, 300) + 's · 买入 ' + uStr(u.usdt) + '</div></div>' +
          '<div class="row gap6"><div class="btn xs green" data-wl="ok">批准</div><div class="btn xs ghost" data-wl="no">拒绝</div></div></div>';
      }).join('') + '</div>' +
      '<div class="card mt12"><div class="row"><span class="tiny txt2 grow">自动分配空位</span><div class="switch on"></div></div>' +
      '<div class="tiny txt3 mt8">开启后有空位时按排队顺序自动入座</div></div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-wl]'); if (!b) return;
        toast(b.dataset.wl === 'ok' ? '已批准入座' : '已拒绝', 'ok');
        b.closest('.li').remove();
      });
    }
  });
}
function showSeatActions(idx) {
  openSheet({
    title: '座位 ' + (idx + 1),
    body: '<div class="list">' +
      '<div class="li" data-sa="take"><div class="center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2)">' + icon('seat', 18) + '</div>' +
      '<div class="grow"><div class="li-title">我坐这里</div><div class="li-sub">买入后入座</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-sa="friend"><div class="center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2)">' + icon('users', 18) + '</div>' +
      '<div class="grow"><div class="li-title">邀请好友占座</div><div class="li-sub">从好友列表选择</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-sa="lock"><div class="center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2)">' + icon('lock', 18) + '</div>' +
      '<div class="grow"><div class="li-title">锁定座位</div><div class="li-sub">其他玩家无法入座</div></div>' + icon('right', 16) + '</div>' +
      '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-sa]'); if (!b) return;
        var a = b.dataset.sa; close();
        if (a === 'take') {
          /* ★ 2026-10-03 资金闸门：还没入座时「我坐这里」不许绕过入座/买入面板
             自动从账户划钱 —— 统一走底部「入座」流程（买入面板确认后才算数）。 */
          if (!TT.heroSeated) { toast('请先点底部「入座玩牌」，买入后才能换座位', 'err', 2600); requestSit(); return; }
          /* ★ 2026-10-02 修「换座位出现两个 hero」+「绕过 tbBuy 记账」：
             以前直接 `pracBal() -= buy; seatPlayer(t, idx, S.user, buy)` ——
             ① 旧座位没有被清掉，桌面上同时出现两张「你」的脸（实测复现）；
             ② 走的是账户裸扣不走 tbBuy，这笔钱进不了 tablePaid，离桌时取不回来。
             现在：旧座位的桌上余额原样搬到新座位（不重复买），新加的钱才走 tbBuy；
             本手进行中则排到下一手再换，不影响正在打的一局。 */
          var t = TT.t;
          if (t.status === 'playing') { TT.pendingSeat = idx; toast('本手结束后自动换到座位 ' + (idx + 1), 'ok', 2600); renderAll(); return; }
          moveHeroSeat(idx);
        }
        /* 空座位「邀请好友坐这里」：本桌没真房间号时先建房，别发假邀请 */
        if (a === 'friend') { if (TT.src.roomNo) inviteFriendsToRoom(TT.src); else showTableInvite(); }
        if (a === 'lock') { TT.t.seats[idx].locked = true; toast('座位已锁定'); renderAll(); }
      });
    }
  });
}
function showOdds() {
  var t = TT.t, hero = t.seats[t.heroSeat];
  if (!hero.hole.length) { toast('当前没有手牌'); return; }
  var o = computeOuts(hero.hole, t.community, t.modeKey);
  var eq = equityFromOuts(o.outs, t.community.length);
  var call = toCall(t, hero);
  openModal({
    title: '胜率 / 赔率', buttons: false,
    body: '<div class="ins-hero">' +
      '<div class="ins-cards">' + hero.hole.map(function (c) { return cardHTML(c, { size: 'md' }); }).join('') +
      (t.community.length ? '<span class="vs">+</span>' + t.community.map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') : '') + '</div>' +
      '<div class="ins-stats mt12">' +
      '<div class="ins-stat"><div class="k">当前成手</div><div class="v">' + (t.community.length >= 3 ? handName(rankOf(t, hero), t.modeKey) : '—') + '</div></div>' +
      '<div class="ins-stat"><div class="k">胜率（估算）</div><div class="v green">' + (eq * 100).toFixed(1) + '%</div></div>' +
      '<div class="ins-stat"><div class="k">补牌 OUTS</div><div class="v gold">' + o.outs + '</div></div>' +
      '<div class="ins-stat"><div class="k">底池赔率</div><div class="v">' + (call > 0 ? Math.round(call / (t.pot + call) * 100) + '%' : '—') + '</div></div>' +
      '</div>' +
      '<div class="ins-note mt12">' + (call > 0 ? (eq > call / (t.pot + call) ? '<b class="green">跟注有利可图</b>' : '<b class="red">跟注不划算</b>') : '当前无需跟注') + '</div>' +
      '</div>'
  });
}
function showTableSettings() {
  openSheet({
    title: '牌桌设置',
    body: '<div class="list">' +
      rowSwitch('sound', '音效', S.settings.sound) +
      rowSwitch('voice', '人声播报（过牌/弃牌/跟注/加注/全下）', S.settings.voice !== false) +
      rowSwitch('music', '背景音乐', S.settings.music) +
      rowSwitch('vibrate', '震动反馈', S.settings.vibrate) +
      rowSwitch('fourColor', '四色扑克牌', S.settings.fourColor) +
      rowSwitch('showOdds', '显示成手提示', S.settings.showOdds) +
      rowSwitch('showPotOdds', '显示底池赔率', S.settings.showPotOdds) +
      rowSwitch('autoMuck', '自动盖牌', S.settings.autoMuck) +
      rowSwitch('hideChat', '隐藏聊天', S.settings.hideChat) +
      /* ★ 2026-10-03 多语言：牌桌里悬浮语言钮是隐藏的（挡操作区），这里留一个入口，
         玩家不用退出牌桌也能切 简体 / 繁體 / English。 */
      '<div class="li" data-tm-setting="lang"><div class="grow"><div class="li-title">语言</div></div>' +
      '<span class="tiny txt2" data-i18n-curlang>' + (window.I18N ? (I18N.langs.filter(function (l) { return l.k === I18N.get(); })[0] || I18N.langs[0]).n : '简体中文') + '</span>' + icon('right', 16) + '</div>' +
      '</div>' +
      '<div class="section-title">桌布颜色</div><div class="hscroll">' +
      ['green|经典绿', 'blue|深海蓝', 'red|酒红'].map(function (x) {
        var p = x.split('|');
        return '<div class="tag' + (S.settings.tableTheme === p[0] ? ' gold' : '') + '" data-theme="' + p[0] + '" style="padding:6px 14px">' + p[1] + '</div>';
      }).join('') + '</div>' +
      '<div class="section-title">牌背样式</div><div class="hscroll">' +
      ['red|经典红', 'blue|宝石蓝', 'gold|黄金'].map(function (x) {
        var p = x.split('|');
        return '<div class="tag' + (S.settings.cardBack === p[0] ? ' gold' : '') + '" data-back="' + p[0] + '" style="padding:6px 14px">' + p[1] + '</div>';
      }).join('') + '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var sw = e.target.closest('[data-sw]');
        if (sw) {
          var k = sw.dataset.sw; S.settings[k] = !S.settings[k];
          sw.querySelector('.switch').classList.toggle('on', S.settings[k]);
          applySetting(k, S.settings[k]);
          saveState(); renderAll(); return;
        }
        /* 语言：打开三语选择弹层（选中即时生效，牌桌不用退出） */
        var lg = e.target.closest('[data-tm-setting="lang"]');
        if (lg) {
          if (window.I18N) {
            I18N.open();
            I18N.onChange(function (l) {
              var els = document.querySelectorAll('[data-i18n-curlang]');
              for (var i = 0; i < els.length; i++) {
                var cur = I18N.langs.filter(function (x) { return x.k === l; })[0] || I18N.langs[0];
                els[i].textContent = cur.n;
              }
            });
          } else toast('语言切换（演示）');
          return;
        }
        var th = e.target.closest('[data-theme]');
        if (th) { S.settings.tableTheme = th.dataset.theme; saveState(); close(); go('table', { id: TT.t.id }, { noHist: true }); return; }
        var bk = e.target.closest('[data-back]');
        if (bk) { S.settings.cardBack = bk.dataset.back; saveState(); renderAll(); toast('牌背已切换'); }
      });
    }
  });
}
function rowSwitch(k, label, val) {
  return '<div class="li" data-sw="' + k + '"><div class="grow"><div class="li-title">' + label + '</div></div><div class="switch' + (val ? ' on' : '') + '"></div></div>';
}

/* ===== 牌桌房间同步（2026-10-02）=====
   ★★ 这是「好友同意了邀请，却没进我房间」的根因：
      A 建房进桌那一刻 src.members 只有自己，之后**再也没有任何刷新**；
      B 在服务端成功接受了邀请、坐进了同一间房（端到端实测确认服务端全对），
      但 A 的屏幕上永远看不到他 —— 只能手动重进才更新。
   这里每 ROOM_SYNC_MS 拉一次房间详情（页面可见才拉）：
     · 新增成员   → 安排到空闲座位，下一手生效，并明确告知谁进来了
     · 成员离开   → 座位置空（本手还在打就标记下一手再走）
     · 房间已解散 / 被移出 → 明确提示并退回大厅，顺手清掉本地残留
     · 原先人数不足停在 waiting 的，凑够 2 人自动开局 */
var ROOM_SYNC_MS = 8000;
var ROOM_SYNC_TIMER = null;
function dropLocalRoom(no) {
  if (!no) return;
  S.tables = (S.tables || []).filter(function (x) { return String(x.roomNo) !== String(no); });
  saveState();
}
function startRoomSync() {
  /* 2026-10-04：真人对战房间改用服务端权威牌局（table_rt.html），不再本地跑机器人模拟对打 */
  if (TT && TT.src && TT.src.roomNo) {
    try { window.location.href = 'table_rt.html?room=' + encodeURIComponent(String(TT.src.roomNo)); } catch (e) {}
    return;
  }
  stopRoomSync();
  if (!TT || !TT.src || !TT.src.roomNo) return;
  syncRoomMembers();
  ROOM_SYNC_TIMER = setInterval(function () {
    if (TT && document.visibilityState === 'visible') syncRoomMembers();
  }, ROOM_SYNC_MS);
  document.addEventListener('visibilitychange', onRoomSyncVisible);
}
function stopRoomSync() {
  if (ROOM_SYNC_TIMER) { clearInterval(ROOM_SYNC_TIMER); ROOM_SYNC_TIMER = null; }
  if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', onRoomSyncVisible);
}
function onRoomSyncVisible() { if (document.visibilityState === 'visible') syncRoomMembers(); }
function syncRoomMembers() {
  if (!TT || !TT.t || !TT.src || !TT.src.roomNo) return Promise.resolve();
  var no = TT.src.roomNo;
  return apiRoomDetail(no).then(function (r) {
    if (!TT || !TT.t) return;
    if (r.code === 404 || r.code === 403 || !r.j || !r.j.ok || !r.j.room) {
      stopRoomSync();
      dropLocalRoom(no);
      TT = null;
      toast('房间已解散或你已不在房间成员里', 'err', 3200);
      go('lobby');
      return;
    }
    applyRoomSnapshot(r.j.room);
  });
}
function applyRoomSnapshot(rm) {
  var t = TT.t;
  var seats = rm.seats || [];
  var heroid = String(S.user.id);
  TT.src.roomSeats = seats.slice();
  TT.src.members = seats.map(function (s) {
    return { id: s.uid, name: s.name, color: s.color, level: s.level || 0, vip: s.vip || 0, isOwner: !!s.isOwner };
  });
  if (rm.modeKey && TT.src.modeKey !== rm.modeKey) TT.src.modeKey = rm.modeKey;   /* 房主改了玩法 */
  var changed = 0, inSeat = {};
  t.seats.forEach(function (s) { if (!s.empty && s.user) inSeat[String(s.user.id)] = s; });
  /* ---- 离开的成员 ---- */
  Object.keys(inSeat).forEach(function (id) {
    var still = seats.some(function (x) { return String(x.uid) === id; });
    if (still || id === heroid) return;
    var s = inSeat[id];
    var nm = (s.user && s.user.name) || '好友';
    if (t.status === 'playing' && s.contrib > 0) { s.sittingOut = true; s.leaveNext = true; }
    else {
      s.empty = true; s.user = null; s.hole = []; s.usdt = 0; s.bet = 0;
      s.folded = true; s.allin = false; s.acted = false; s.contrib = 0; s.sittingOut = true;
    }
    changed++;
    toast(nm + ' 已离开房间', 'err', 2400);
  });
  /* ---- 新入座的成员 ---- */
  seats.forEach(function (x) {
    var id = String(x.uid);
    if (id === heroid || inSeat[id]) return;
    var free = -1;
    for (var i = 0; i < t.cap; i++) { var s = t.seats[i]; if (s.empty && !s.locked) { free = i; break; } }
    if (free < 0) return;
    var u = mkUser(free + 11, { name: x.name, color: x.color, level: x.level || 0, vip: x.vip || 0, status: 'online' });
    u.id = id; u.realMember = true;
    seatPlayer(t, free, u, Math.max(t.bb * 40, Math.round(t.bb * rnd(40, 200))));
    t.seats[free].sittingOut = (t.status === 'playing');   /* 打得正酣就下一手再上桌 */
    changed++;
    toast((x.name || '好友') + ' 已入座' + (t.status === 'playing' ? '，下一手开始参与' : ''), 'ok', 2800);
  });
  if (!changed) return;
  saveState();
  renderAll();
  /* 原先因为缺人停在等待 → 现在凑够 2 人了，自动开下一手 */
  if (t.status === 'waiting' || t.status === 'showdown') {
    setTimeout(function () {
      if (!TT || TT.t !== t) return;
      applyPendingSeatChanges(t);
      /* ★ 资金闸门：hero 还没买入（桌上 0 USDT）时别自作主张开局，等他买完再说 */
      if (!heroNeedsBuy() && activeSeats(t).length >= 2) { startHand(t); renderAll(); loop(); }
    }, 900);
  }
}

/* silent=true：跳过二次确认（解散房间这类已经确认过的场景用） */
function leaveTable(silent) {
  var run = function () {
    var left = 0;
    var roomNo = (TT && TT.src && TT.src.roomNo) ? String(TT.src.roomNo) : '';
    if (TT && TT.t) {
      var hero = TT.t.seats[TT.t.heroSeat];
      var back = Math.min(hero.usdt, tbCanCash());
      left = hero.usdt - back;
      hero.usdt = left;                 /* 净盈利留在桌上，不进账户，也就兑不了 USDT */
      if (back > 0) tbCash(back);
      clearInterval(TT.heroTimer); clearTimeout(TT.timer);
      if (TT.nextTimer) { clearTimeout(TT.nextTimer); TT.nextTimer = null; }   /* ★ 别让下一局定时器在人走后还响 */
    }
    /* ★ 2026-10-02 修「人走了座位还在」：leaveTable 以前完全不通知服务端，
       座位一直挂着，房间变成要等 24 小时才自动清掉的僵尸房，好友列表里还看得见你在里面。 */
    stopRoomSync();
    if (roomNo) {
      apiRoomLeave(roomNo).then(function () { });
      dropLocalRoom(roomNo);
    }
    TT = null;
    go('lobby');
    toast('已离开牌桌，本金已退回' + (left > 0 ? '，桌上净盈利 ' + fmt(left) + ' 不可兑现' : ''), 'ok');
  };
  if (silent) run();
  else confirmBox('离开牌桌', '离开后将先退回桌上本金（赢来的净盈利仍留在牌桌），确定吗？', '离开', true).then(function (ok) { if (ok) run(); });
}

/* ---------- 手牌回顾 ---------- */
Screens.handHistory = function () {
  if (!S.history.length) S.history = genHistory(14);
  var list = S.history.slice(0, 30);
  openSheet({
    title: '手牌回顾',
    body: '<div class="list">' + list.map(function (h) {
      return '<div class="hist-item" data-hid="' + h.id + '">' +
        '<div class="res ' + (h.heroWin ? 'w' : 'l') + '">' + (h.heroWin ? '+' : '-') + short(Math.abs(h.heroNet)) + '</div>' +
        '<div class="grow" style="min-width:0">' +
        '<div class="row gap6">' + h.heroHole.map(function (c) { return cardHTML(c, { size: 'xs' }); }).join('') +
        '<span class="tiny txt3">' + handName(h.heroRank) + '</span></div>' +
        '<div class="li-sub">' + h.table + ' · ' + h.handNo + ' · 底池 ' + short(h.pot) + ' · ' + timeAgo(h.ts) + '</div>' +
        '</div><div class="col" style="align-items:flex-end"><span class="tag ' + (h.heroWin ? 'green' : 'red') + '">' + (h.heroWin ? '赢' : '输') + '</span>' +
        '<span class="tiny txt3 mt8">回放 ›</span></div></div>';
    }).join('') + '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var it = e.target.closest('[data-hid]'); if (!it) return;
        var h = S.history.filter(function (x) { return x.id == it.dataset.hid; })[0];
        close(); if (h) openReplay(h);
      });
    }
  });
};

function openReplay(h) {
  var step = 0, playing = false, iv = null, speed = 1;
  var m = openModal({
    title: '牌局回放 · ' + h.handNo, sub: h.table + ' · 底池 ' + fmt(h.pot), size: 'full', buttons: false,
    body: '<div id="rp-stage"></div>' +
      '<div class="replay-ctrl">' +
      '<div class="icon-btn" id="rp-prev">' + icon('prev', 18) + '</div>' +
      '<div class="icon-btn" id="rp-play">' + icon('play', 18) + '</div>' +
      '<div class="icon-btn" id="rp-next">' + icon('next', 18) + '</div>' +
      '<div class="btn xs ghost" id="rp-speed">1.0x</div>' +
      '<div class="tiny txt3" id="rp-prog"></div>' +
      '</div>' +
      '<div class="section-title">玩家</div><div id="rp-players"></div>' +
      '<div class="section-title">行动记录</div><div class="replay-log" id="rp-log"></div>',
    onReady: function (root, close) {
      function render() {
        var showN = [0, 3, 4, 5][step] || 0;
        var stage = $('#rp-stage', root);
        stage.innerHTML = '<div class="replay-stage">' +
          '<div class="pot">POT ' + fmt(h.pot) + '</div>' +
          '<div class="comm">' + (showN ? h.community.slice(0, showN).map(function (c) { return cardHTML(c, { size: 'md' }); }).join('') : '<span class="tiny" style="color:rgba(255,255,255,.5)">等待发牌</span>') + '</div>' +
          '<div class="stage-lbl">' + h.streets[step].name + '</div></div>';
        $('#rp-players', root).innerHTML = '<div class="list">' + h.players.map(function (p) {
          return '<div class="li">' + avatarHTML({ name: p.name, color: p.color }, 'sm') +
            '<div class="grow"><div class="li-title">' + esc(p.name) + (p.win ? ' <span class="tag gold">赢家</span>' : '') + '</div>' +
            '<div class="li-sub">' + (step >= 3 || p.win ? handName(p.rank) : '底牌 hidden') + ' · 投入 ' + fmt(p.contrib) + '</div></div>' +
            '<div class="row gap6">' + p.hole.map(function (c) { return cardHTML(c, { size: 'xs', hidden: !(step >= 3 || p.win), back: 'blue' }); }).join('') + '</div></div>';
        }).join('') + '</div>';
        var acts = h.streets[step].actions;
        $('#rp-log', root).innerHTML = acts.length ? acts.map(function (a) {
          return '<div class="rl"><span class="who">' + esc(a.name) + '</span><span class="a">' + a.act + '</span>' +
            (a.amt ? '<span class="amt">' + fmt(a.amt) + '</span>' : '') + '</div>';
        }).join('') : '<div class="rl"><span class="a">本街无行动</span></div>';
        $('#rp-prog', root).textContent = (step + 1) + ' / 4 · ' + h.streets[step].name +
          (h.heroWin ? ' · 本局盈利 +' + fmt(h.heroNet) : ' · 本局亏损 ' + fmt(h.heroNet));
      }
      function stop() { playing = false; clearInterval(iv); $('#rp-play', root).innerHTML = icon('play', 18); }
      $('#rp-play', root).onclick = function () {
        if (playing) { stop(); return; }
        playing = true; $('#rp-play', root).innerHTML = icon('pause', 18);
        iv = setInterval(function () {
          if (step >= 3) { stop(); return; }
          step++; render();
        }, 1400 / speed);
      };
      $('#rp-next', root).onclick = function () { if (step < 3) { step++; render(); } };
      $('#rp-prev', root).onclick = function () { if (step > 0) { step--; render(); } };
      $('#rp-speed', root).onclick = function () {
        speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : speed === 2 ? 0.5 : 1;
        this.textContent = speed.toFixed(1) + 'x';
        if (playing) { clearInterval(iv); iv = setInterval(function () { if (step >= 3) { stop(); return; } step++; render(); }, 1400 / speed); }
      };
      render();
    }
  });
}

/* ---------- 全局动作绑定 ---------- */
/* ★ 2026-10-02 桌面简约化后，牌桌上只剩 4 个 data-act 入口：
   table-menu（⋯）、leave-table（返回）、buyin（买入/加码）、hand-history（手牌回顾）。
   原先 scoreboard / insurance-info / odds / table-settings / emo / sound-toggle /
   fullscreen / chat 的 bindAct 注册已随各自的 DOM 图标一起删除，统一走牌桌菜单。 */
bindAct('table-menu', function () { if (TT) showTableMenu(); });
bindAct('hand-history', function () { Screens.handHistory(); });
bindAct('buyin', function () { if (TT) showBuyIn(); });
bindAct('leave-table', function () { leaveTable(); });
/* ★ 2026-10-03（第2轮）：右侧悬浮「聊天」按钮，打开聊天面板 */
bindAct('chat', function () { openChatPanel(); });








