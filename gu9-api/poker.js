'use strict';
/* ============================================================================
 * poker.js · 服务端权威牌局引擎（纯规则，无前端依赖、无透视）
 * ----------------------------------------------------------------------------
 * 移植自前端 game.js 的已验证规则，但做以下裁剪，以便服务端权威驱动：
 *   1) 只保留「控水」的发牌偏置（HOUSE 模块，2026-10-06 移植），且限定只作用于
 *      **机器人房里 bot 与真人同桌**的手；真人对真人的房永不偏置（那是对玩家的作弊）。
 *      透视（读对手底牌）一律不做：机器人拿到的信息与真人完全一致。
 *   2) 移除 voiceSfx / S.user 等前端全局依赖。
 *   3) showdown 的 VIP 返水暂置 0（MVP 不做返水，后续后台可配）。
 *   4) bot 决策用干净的 botDecide（基于 simHumanDecide + mcEquity），无透视。
 *
 * 资金口径（仅对"有房间号"的真人对战房间生效）：
 *   - 玩家买入：account.usdt -> seat.usdt（调用方负责记账 tablePaid/tableBank）。
 *   - 牌局中 seat.usdt 在真人之间零和转移（平台只收 rake）。
 *   - 离座/房间解散：seat.usdt 全额退回 account.usdt（赢的真人钱可带走）。
 *   - 本文件不包含账户记账，只负责"桌上 seat.usdt"的牌局演化；账户记账由 server.js 调用方处理。
 * ========================================================================== */

/* ---------- 基础常量 ---------- */
var SUITS = ['s', 'h', 'd', 'c'];
var SUIT_CH = { s: '♠', h: '♥', d: '♦', c: '♣' };
var RANK_CH = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

/* ---------- 主流玩法配置（与前端一致） ---------- */
var MODES = {
  nlh: { key: 'nlh', name: '无限注德州扑克', hole: 2, bet: 'nolimit', minRank: 2, cap: 9, ante: 0, rake: { pct: 0.05, capBB: 3 } },
  plo: { key: 'plo', name: '底池限注奥马哈', hole: 4, bet: 'potlimit', minRank: 2, cap: 9, ante: 0, omaha: 1, rake: { pct: 0.05, capBB: 3 } },
  plo5: { key: 'plo5', name: '奥马哈5', hole: 5, bet: 'potlimit', minRank: 2, cap: 9, ante: 0, omaha: 1, rake: { pct: 0.05, capBB: 3 } },
  omaha8: { key: 'omaha8', name: '奥马哈高低', hole: 4, bet: 'potlimit', minRank: 2, cap: 9, ante: 0, omaha: 1, hilo: 1, rake: { pct: 0.05, capBB: 3 } },
  short: { key: 'short', name: '短牌6+', hole: 2, bet: 'nolimit', minRank: 6, cap: 9, ante: 0, rake: { pct: 0.05, capBB: 2.5 } },
  aof: { key: 'aof', name: 'All-in or Fold', hole: 2, bet: 'aof', minRank: 2, cap: 6, ante: 0, rake: { pct: 0.04, capBB: 2 } },
  hu: { key: 'hu', name: '单挑', hole: 2, bet: 'nolimit', minRank: 2, cap: 2, ante: 0, rake: { pct: 0.05, capBB: 2 } },
  pineapple: { key: 'pineapple', name: '疯狂菠萝', hole: 3, bet: 'nolimit', minRank: 2, cap: 9, ante: 0, pineapple: 1, rake: { pct: 0.05, capBB: 3 } },
  rush: { key: 'rush', name: '极速桌', hole: 2, bet: 'nolimit', minRank: 2, cap: 6, ante: 0, rake: { pct: 0.05, capBB: 3 } }
};
/* 兜底：未知 mode 一律退化成 nlh */
function modeOf(key) { return MODES[key] || MODES.nlh; }

var RAKEBACK = [0, 0, 0, 0, 0, 1, 2, 3, 4];

/* ============================================================================
 * 控水（服务端发牌偏置）—— 2026-10-06 新增
 * ----------------------------------------------------------------------------
 * 后台「AI 与控水 → 控水」面板现在直接驱动服务端机器人房的发牌倾向（默认关闭）。
 *
 * ★★ 适用范围铁律（安全红线，改这里前先读）：
 *   ① 默认关闭：config.house.on = false 时本模块全部是空操作。
 *   ② **只对机器人房生效**：调用方（pokertable）只在 table.botFill 为真、
 *      且桌上同时存在 bot 与真人时才写入 t.housePlan。
 *      真人自建房 / 好友房 / 私人房 bot 根本不会进 → 永不写入 → 绝不控真人的盘。
 *   ③ 纯 bot 互打（桌上没有真人）不控：那全是平台做市筹码，控了没意义。
 *   ④ 只改「发给谁的牌」（底牌置换 / 公共牌重发），
 *      不改抽水、不改边池、不凭空造钱 —— 资金守恒完全不受影响。
 *   ⑤ 计划不下发客户端：housePlan 只存在于服务端牌局对象；
 *      deck / run 本就不下发，玩家无法从协议里反推。
 *
 * 与「透视」的区别：控水不改任何人的读牌能力，机器人拿到的信息量与真人完全一致，
 * 只是牌面朝计划方向倾斜，行为上更自然，是常规运营手段。
 * ========================================================================== */
var HOUSE = {
  on: false, botWinRate: 0.30, strength: 0.85, capProfit: 2000000, capLoss: 1000000, gain: 1,
  stat: { hands: 0, botWin: 0, heroWin: 0, botNet: 0 }
};
function setHouse(cfg) {
  if (!cfg || typeof cfg !== 'object') { HOUSE.on = false; return HOUSE; }
  HOUSE.on = !!cfg.on;
  HOUSE.botWinRate = Math.max(0.05, Math.min(0.9, +cfg.botWinRate > 0 ? +cfg.botWinRate : 0.30));
  HOUSE.strength = Math.max(0, Math.min(1, cfg.strength != null ? +cfg.strength : 0.85));
  HOUSE.capProfit = Math.max(0, +cfg.capProfit || 0);
  HOUSE.capLoss = Math.max(0, +cfg.capLoss || 0);
  return HOUSE;
}
function houseCfg() { return { on: HOUSE.on, botWinRate: HOUSE.botWinRate, strength: HOUSE.strength, capProfit: HOUSE.capProfit, capLoss: HOUSE.capLoss }; }
function houseOn() { return !!HOUSE.on; }
function houseStat() { return HOUSE.stat; }
/* 统计落盘：进程重启后闭环校准不至于从零开始（botpnl.json → BOTPNL.house） */
function houseImport(j) {
  if (j && typeof j === 'object') {
    HOUSE.stat = {
      hands: Math.max(0, +j.hands || 0), botWin: Math.max(0, +j.botWin || 0),
      heroWin: Math.max(0, +j.heroWin || 0), botNet: U(+j.botNet || 0)
    };
  }
}
/* 本手双方的座位划分：bot 侧 vs 真人侧（按「已发到底牌的活座」判定，弃牌者不计） */
function houseSides(t) {
  var bots = [], humans = [];
  t.seats.forEach(function (s) {
    if (s.empty || s.sittingOut || !s.hole || !s.hole.length || s.folded) return;
    if (s.user && s.user.isBot) bots.push(s); else humans.push(s);
  });
  return { bots: bots, humans: humans };
}
/* 目标胜率：基础目标 + 止盈止损收敛（botNet 正 = bot 赢真人的钱） */
function houseRateFor() {
  var base = HOUSE.botWinRate, net = +HOUSE.stat.botNet || 0;
  if (HOUSE.capLoss && net <= -HOUSE.capLoss) return Math.min(0.9, base + 0.15);   /* 亏到止损线：加强 */
  if (HOUSE.capProfit && net >= HOUSE.capProfit) return Math.max(0.05, base - 0.15); /* 赢到止盈线：收敛 */
  return base;
}
/* 闭环校准：用「实际达成的 bot 胜率」反推本手该偏向谁，抵消真人弃牌率等结构偏差 */
function houseAdjustedRate() {
  var base = houseRateFor(), s = HOUSE.stat, decided = s.botWin + s.heroWin;
  if (decided < 15) return base;                       /* 样本太少，先按目标走 */
  var achieved = s.botWin / decided, err = base - achieved;
  return Math.max(0, Math.min(1, base + err * (HOUSE.gain || 1)));
}
/* 本手计划：'bot' = bot 该赢，'hero' = 真人该赢，null = 不控（默认） */
function planHand(t) {
  if (!HOUSE.on) return null;
  var bots = 0, humans = 0;
  t.seats.forEach(function (s) {
    if (s.empty || s.sittingOut || (+s.usdt || 0) <= 0) return;
    if (s.user && s.user.isBot) bots++; else humans++;
  });
  if (!bots || !humans) return null;
  return Math.random() < houseAdjustedRate() ? 'bot' : 'hero';
}
/* 底牌偏置：把最强的几手底牌置换给计划方（★ 纯置换：牌堆组成与张数完全不变） */
function houseBiasHoles(t, plan) {
  if (!HOUSE.on || !plan) return;
  if (Math.random() > HOUSE.strength) return;          /* 留一部分自然牌局，强度越低越自然 */
  var sd = houseSides(t);
  var fav = plan === 'hero' ? sd.humans : sd.bots;
  var oth = plan === 'hero' ? sd.bots : sd.humans;
  if (!fav.length || !oth.length) return;
  /* 开销控制：底牌强度用「对 1 个对手」的胜率近似（相关性足够，成本约为对多家的 1/2） */
  var scored = fav.concat(oth).map(function (s) {
    return { s: s, eq: mcEquity(s.hole, [], 1, 30, t.modeKey) };
  });
  scored.sort(function (a, b) { return b.eq - a.eq; });   /* 强 → 弱 */
  var holes = scored.map(function (x) { return x.s.hole; });
  /* 计划方内部随机分配（避免「总是同一个座位拿强牌」的痕迹） */
  var favSeats = fav.slice().sort(function () { return Math.random() - 0.5; });
  var othSeats = oth.slice().sort(function () { return Math.random() - 0.5; });
  favSeats.forEach(function (s, i) { s.hole = holes[i]; });
  othSeats.forEach(function (s, i) { s.hole = holes[favSeats.length + i]; });
}
/* 当前牌面是否已朝计划方向走
   ★ 只比较「两侧各自最强的那一家」，且每侧最多取 3 家（开销封顶）；
     要求计划方领先一定幅度（0.06），否则重发 —— 太宽松的话重发等于白做。 */
function houseFavorOk(t, plan) {
  var sd = houseSides(t);
  if (!sd.bots.length || !sd.humans.length) return true;
  var fav = (plan === 'hero' ? sd.humans : sd.bots).slice(0, 3);
  var oth = (plan === 'hero' ? sd.bots : sd.humans).slice(0, 3);
  var fEq = 0, oEq = 0;
  fav.forEach(function (s) { fEq = Math.max(fEq, mcEquity(s.hole, t.community, 1, 24, t.modeKey)); });
  oth.forEach(function (s) { oEq = Math.max(oEq, mcEquity(s.hole, t.community, 1, 24, t.modeKey)); });
  return fEq >= oEq + 0.06;
}
/* 翻牌 / 转牌：把这 count 张牌退回牌堆重发，直到牌面朝计划方向走（次数有限，绝不死循环） */
function houseBiasStreet(t, count) {
  if (!HOUSE.on || !t.housePlan) return;
  if (Math.random() > HOUSE.strength) return;
  var plan = t.housePlan, tries = count >= 3 ? 6 : 4;
  for (var a = 0; a < tries; a++) {
    if (houseFavorOk(t, plan)) return;
    if (t.community.length < count) return;
    var back = t.community.splice(t.community.length - count, count);
    t.deck = t.deck.concat(back); shuffle(t.deck);
    for (var i = 0; i < count; i++) t.community.push(t.deck.pop());
  }
}
/* 河牌：直接从剩余牌堆里挑一张让计划方获胜的牌（挑不到就返回 null 走正常发牌） */
function housePickRiver(t) {
  if (!HOUSE.on || !t.housePlan) return null;
  if (Math.random() > HOUSE.strength) return null;
  var plan = t.housePlan, sd = houseSides(t);
  if (!sd.bots.length || !sd.humans.length) return null;
  var fav = (plan === 'hero' ? sd.humans : sd.bots).slice(0, 3);
  var oth = (plan === 'hero' ? sd.bots : sd.humans).slice(0, 3);
  var board = t.community.slice(), bestScore = null, pool = [];
  function at(s, full) { return t.mode.omaha ? evalOmaha(s.hole, full, t.modeKey) : evalBest(s.hole.concat(full), t.modeKey); }
  for (var i = 0; i < t.deck.length; i++) {
    var full = board.concat([t.deck[i]]), fBest = null, oBest = null;
    fav.forEach(function (s) { var v = at(s, full); if (!fBest || cmp(v, fBest) > 0) fBest = v; });
    oth.forEach(function (s) { var v = at(s, full); if (!oBest || cmp(v, oBest) > 0) oBest = v; });
    if (!fBest || !oBest) continue;
    /* 评分：>0 计划方获胜，越大赢得越硬；全都不赢时退而求其次选「输得最少」的那张 */
    var sc = cmp(fBest, oBest);
    if (bestScore === null || sc > bestScore) { bestScore = sc; pool = [i]; }
    else if (sc === bestScore) pool.push(i);
  }
  if (!pool.length) return null;
  return t.deck.splice(pool[Math.floor(Math.random() * pool.length)], 1)[0];
}
/* 本手结算后的闭环统计：真人侧净盈亏（正 = 真人赢）→ bot 侧取反 */
function houseStatAdd(t) {
  if (!HOUSE.on) return;
  var hNet = 0, anyH = false, anyB = false;
  t.seats.forEach(function (s) {
    if (s.empty || !s.user || s._hs == null) return;
    var net = U((+s.usdt || 0) - (+s._hs || 0));
    if (s.user.isBot) anyB = true; else { anyH = true; hNet = U(hNet + net); }
  });
  if (!anyH || !anyB) return;      /* 只有「真人 + bot 同时在场」的手才计入胜率样本 */
  HOUSE.stat.hands++;
  if (hNet > 0) HOUSE.stat.heroWin++;
  else if (hNet < 0) HOUSE.stat.botWin++;
  HOUSE.stat.botNet = U((+HOUSE.stat.botNet || 0) - hNet);
}

/* ---------- 牌组 / 洗牌 / 字符串 ---------- */
function makeDeck(minRank) {
  var lo = minRank || 2;
  var d = [];
  for (var s = 0; s < 4; s++) for (var r = lo; r <= 14; r++) d.push({ r: r, s: SUITS[s] });
  return d;
}
function U(v) { return Math.round((+v || 0) * 100) / 100; }   /* ★ 全站唯一金额单位 = USDT（两位小数），不再有「分」 */
function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function cardStr(c) { return RANK_CH[c.r] + SUIT_CH[c.s]; }

/* ---------- 牌力评估（5张） ---------- */
function eval5raw(cs, lowAce) {
  var ranks = cs.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
  var flush = cs.every(function (c) { return c.s === cs[0].s; });
  var uniq = [], counts = {};
  ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
  Object.keys(counts).forEach(function (k) { uniq.push(parseInt(k)); });
  uniq.sort(function (a, b) { return (counts[b] - counts[a]) || (b - a); });
  var straight = 0;
  var seq = uniq.slice();
  if (seq.indexOf(14) >= 0) seq.push(lowAce || 1);
  var run = 1, best = 0;
  for (var i = 0; i < seq.length - 1; i++) {
    if (seq[i] - 1 === seq[i + 1]) { run++; if (run >= 5) best = seq[i - 3]; } else run = 1;
  }
  if (run >= 5 && !best) best = seq[0];
  straight = best;
  var cntArr = uniq.map(function (u) { return counts[u]; });
  if (flush && straight) return [8, straight];
  if (cntArr[0] === 4) return [7, uniq[0], uniq[1]];
  if (cntArr[0] === 3 && cntArr[1] === 2) return [6, uniq[0], uniq[1]];
  if (flush) return [5, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]];
  if (straight) return [4, straight];
  if (cntArr[0] === 3) return [3, uniq[0], uniq[1], uniq[2]];
  if (cntArr[0] === 2 && cntArr[1] === 2) return [2, uniq[0], uniq[1], uniq[2]];
  if (cntArr[0] === 2) return [1, uniq[0], uniq[1], uniq[2], uniq[3]];
  return [0, ranks[0], ranks[1], ranks[2], ranks[3], ranks[4]];
}
function eval5(cs, mode) {
  var v = eval5raw(cs, mode === 'short' ? 5 : 1);
  if (mode === 'short') {
    if (v[0] === 6) v[0] = 5;
    else if (v[0] === 5) v[0] = 6;
  }
  return v;
}
function evalBest(cards, mode) {
  var best = null, n = cards.length;
  function rec(start, cur) {
    if (cur.length === 5) { var v = eval5(cur.map(function (i) { return cards[i]; }), mode); if (!best || cmp(v, best) > 0) best = v; return; }
    for (var i = start; i < n; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); }
  }
  rec(0, []);
  return best || [0];
}
function evalOmaha(hole, comm, mode) {
  var best = null;
  var h = hole.length, c = comm.length;
  if (c < 3) return evalBest(hole.concat(comm), mode);
  for (var a = 0; a < h; a++) {
    for (var b = a + 1; b < h; b++) {
      for (var i = 0; i < c; i++) {
        for (var j = i + 1; j < c; j++) {
          for (var k = j + 1; k < c; k++) {
            var five = [hole[a], hole[b], comm[i], comm[j], comm[k]];
            var v = eval5(five, mode);
            if (!best || cmp(v, best) > 0) best = v;
          }
        }
      }
    }
  }
  return best || [0];
}
function lowHand(cards) {
  var ranks = cards.map(function (c) { return c.r === 14 ? 1 : c.r; }).sort(function (a, b) { return a - b; });
  var uniq = ranks.filter(function (v, i, a) { return a.indexOf(v) === i; });
  if (uniq.length < 5) return null;
  var low = uniq.slice(0, 5);
  if (low[4] > 8) return null;
  return low.slice().sort(function (a, b) { return b - a; });
}
function omahaLow(hole, comm) {
  if (comm.length < 3 || hole.length < 2) return null;
  var best = null, h = hole.length, c = comm.length;
  for (var a = 0; a < h; a++) {
    for (var b = a + 1; b < h; b++) {
      for (var i = 0; i < c; i++) {
        for (var j = i + 1; j < c; j++) {
          for (var k = j + 1; k < c; k++) {
            var lo = lowHand([hole[a], hole[b], comm[i], comm[j], comm[k]]);
            if (lo && (!best || cmpLow(lo, best) < 0)) best = lo;
          }
        }
      }
    }
  }
  return best;
}
function cmpLow(a, b) {
  if (!a) return 1; if (!b) return -1;
  for (var i = 0; i < 5; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}
function cmp(a, b) { for (var i = 0; i < Math.max(a.length, b.length); i++) { var x = a[i] || 0, y = b[i] || 0; if (x !== y) return x - y; } return 0; }
var HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
var HAND_NAMES_SHORT = ['高牌', '一对', '两对', '三条', '顺子', '葫芦', '同花', '四条', '同花顺'];
function handName(v, mode) { return ((mode === 'short' ? HAND_NAMES_SHORT : HAND_NAMES)[v[0]]) || ''; }

/* ---------- 抽水 ---------- */
function rakeOf(t) {
  var m = modeOf(t.modeKey);
  var r = m.rake || { pct: 0.05, capBB: 3 };
  if (!r.pct) return 0;
  if (t.street === 0) return 0; /* No Flop No Drop */
  var cap = U((r.capBB || 3) * t.bb);
  var amt = U(t.pot * r.pct);
  return Math.max(0, Math.min(amt, cap));
}
function rakeText(t) {
  var m = modeOf(t.modeKey), r = m.rake || { pct: 0.05, capBB: 3 };
  if (!r.pct) return '服务费 ' + Math.round((r.fee || 0.1) * 100) + '%';
  return '抽水 ' + (r.pct * 100).toFixed(r.pct * 100 % 1 ? 1 : 0) + '% · 上限 ' + (r.capBB || 3) + 'BB';
}
function potMaxRaise(t) {
  var call = toCall(t, t.seats[t.toAct < 0 ? 0 : t.toAct]);
  return t.pot + call;
}

/* ---------- 座位 / 状态 ---------- */
function seatPlayer(t, idx, u, usdt) {
  var s = t.seats[idx];
  s.empty = false; s.user = u; s.usdt = usdt; s.bet = 0; s.contrib = 0; s.hole = [];
  s.folded = false; s.allin = false; s.acted = false; s.lastAct = ''; s.sittingOut = false;
  s.stat = { c: 0, f: 0 };
  return s;
}
function activeSeats(t) { return t.seats.filter(function (s) { return !s.empty && s.usdt > 0 && !s.sittingOut; }); }
/* ★ 2026-10-05 修复「无底牌却被轮到行动」：本手进行中（status==='playing'），
   没有底牌的座位绝不能参与行动轮（中途上桌/异常恢复的座位只旁观）。
   ignoreHole=true 供 startHand 选庄位/盲注用（发牌前 hole 必然为空）。
   startHand 已把 t.status='playing' 挪到发牌全部完成之后，选盲注时不会触发此检查。 */
function nextSeat(t, from, ignoreHole) {
  var n = t.cap;
  for (var i = 1; i <= n; i++) {
    var j = (from + i) % n, s = t.seats[j];
    if (s.empty || s.sittingOut || s.folded || s.allin || s.usdt <= 0) continue;
    if (!ignoreHole && t.status === 'playing' && !(s.hole && s.hole.length)) continue;
    return j;
  }
  return -1;
}
function nextLivingSeat(t, from) {
  var n = t.cap;
  for (var i = 1; i <= n; i++) {
    var j = (from + i) % n, s = t.seats[j];
    if (!s.empty && !s.sittingOut && !s.folded) return j;
  }
  return -1;
}

function createTable(opt) {
  opt = opt || {};
  var mode = modeOf(opt.mode);
  var t = {
    id: opt.id || 1, name: opt.name || mode.name, sb: opt.sb || 50, bb: opt.bb || 100,
    cap: opt.cap || mode.cap || 9, seats: [], handNo: 0, dealerSeat: 0, street: -1,
    community: [], pot: 0, sidePots: [], deck: [], toAct: -1, minRaise: 0,
    status: 'waiting', lastAgg: -1, log: [], heroSeat: 0, handStart: 0,
    mode: mode, modeKey: mode.key, ante: (opt.ante != null ? opt.ante : mode.ante) || 0,
    straddle: !!opt.straddle, rake: 0, rakeTotal: 0, rebate: 0
  };
  for (var i = 0; i < t.cap; i++) t.seats.push({ idx: i, empty: true, user: null, usdt: 0, bet: 0, contrib: 0, hole: [], folded: false, allin: false, acted: false, lastAct: '', rank: null, low: null, sittingOut: false, owner: false, stat: { c: 0, f: 0 } });
  return t;
}

/* ---------- 一手开始：公平发牌（无控盘） ---------- */
function startHand(t) {
  var live = activeSeats(t);
  if (live.length < 2) { t.status = 'waiting'; return false; }
  t.seats.forEach(function (s) { s.bet = 0; s.contrib = 0; s.hole = []; s.folded = false; s.allin = false; s.acted = false; s.lastAct = ''; s.rank = null; s.low = null; });
  t.dealerSeat = nextSeat(t, t.dealerSeat < 0 ? 0 : t.dealerSeat);
  if (t.dealerSeat < 0) return false;
  t.handNo++; t.community = []; t.pot = 0; t.sidePots = []; t.log = []; t.handStart = Date.now();
  t.result = null; t.refunds = null; t.rake = 0; /* ★ 清掉上一手结算残留，避免跨手误显 */
  t.run = shuffle(makeDeck(t.mode.minRank || 2));
  t.deck = t.run;
  t.rake = 0;
  /* ★ t.status='playing' 挪到发牌完成后（原在发牌前）：保证选庄/盲注阶段 nextSeat
     的「无底牌跳过」检查不会误伤（此时 hole 还没发，全部为空）。 */
  t.street = 0; t.minRaise = t.bb;
  var sbSeat = nextSeat(t, t.dealerSeat), bbSeat = nextSeat(t, sbSeat);
  if (t.cap === 2) { sbSeat = t.dealerSeat; bbSeat = nextSeat(t, sbSeat); }
  t.sbSeat = sbSeat; t.bbSeat = bbSeat;
  if (t.ante > 0) live.forEach(function (s) { post(t, s, t.ante, '前注', true); });
  post(t, t.seats[sbSeat], t.sb, '小盲');
  post(t, t.seats[bbSeat], t.bb, '大盲');
  t.straddleSeat = -1;
  if (t.straddle) {
    var stSeat = nextSeat(t, bbSeat);
    if (stSeat >= 0 && t.seats[stSeat].usdt > t.bb * 2) {
      post(t, t.seats[stSeat], t.bb * 2, '强抓');
      t.straddleSeat = stSeat;
    }
  }
  var hn = t.mode.hole || 2;
  live.forEach(function (s) { s.hole = []; for (var i = 0; i < hn; i++) s.hole.push(t.deck.pop()); });
  /* ★ 控水（2026-10-06）：t.housePlan 由 pokertable 在开局前写入，仅在「机器人房 + 有真人」时非空。
     houseBiasHoles 只是把已发出的底牌在座位间**置换**，牌堆组成/张数完全不变，
     不影响后续公共牌发牌，也不产生重复牌。控水关闭时 houseBiasHoles 是空操作。 */
  if (t.housePlan) houseBiasHoles(t, t.housePlan);
  else t.housePlan = null;
  /* 本手起始筹码快照（含已下的盲注/前注）：只给真正参与本手（发了底牌）的座位，
     供 houseStatAdd 算各家本手净盈亏；旁观/未发牌座位记 null，不进统计样本。 */
  t.seats.forEach(function (s) { s._hs = null; });
  live.forEach(function (s) { s._hs = s.usdt; });
  t.discardDone = false;
  t.toAct = nextSeat(t, t.straddleSeat >= 0 ? t.straddleSeat : bbSeat);
  t.log.push({ street: 0, text: '第 ' + t.handNo + ' 手开始，' + t.mode.name + '，盲注 ' + t.sb + '/' + t.bb + (t.ante ? ' 前注 ' + t.ante : ''), sys: 1 });
  t.status = 'playing';
  return true;
}
function post(t, s, amt, label, isAnte) {
  amt = U(Math.min(amt, s.usdt)); s.usdt = U(s.usdt - amt); s.contrib = U(s.contrib + amt); t.pot = U(t.pot + amt);
  s.bet = isAnte ? 0 : amt;
  s.lastAct = label;
  if (s.usdt === 0) s.allin = true;
}
function autoDiscard(t, s) {
  if (s.hole.length <= 2) return;
  var best = null, keep = [0, 1];
  for (var i = 0; i < s.hole.length; i++) {
    for (var j = i + 1; j < s.hole.length; j++) {
      var v = evalBest([s.hole[i], s.hole[j]].concat(t.community), t.modeKey);
      if (!best || cmp(v, best) > 0) { best = v; keep = [i, j]; }
    }
  }
  s.hole = [s.hole[keep[0]], s.hole[keep[1]]];
  s.lastAct = '弃底牌';
}
function discardAll(t) {
  t.seats.forEach(function (s) { if (!s.empty && !s.folded && s.hole.length > 2) autoDiscard(t, s); });
  t.discardDone = true;
}
function toCall(t, s) { var max = 0; t.seats.forEach(function (x) { if (x.bet > max) max = x.bet; }); return Math.max(0, max - s.bet); }

/* ---------- 动作 ---------- */
function doAction(t, seatIdx, type, amt) {
  var s = t.seats[seatIdx]; if (!s || s.folded) return false;
  var call = toCall(t, s);
  if (type === 'fold') { s.folded = true; s.lastAct = '弃牌'; t.log.push({ street: t.street, name: s.user && s.user.name, act: '弃牌' }); }
  else if (type === 'check') { if (call > 0) type = 'call'; }
  if (type === 'call' || type === 'check') {
    var pay = U(Math.min(call, s.usdt)); s.usdt = U(s.usdt - pay); s.bet = U(s.bet + pay); s.contrib = U(s.contrib + pay); t.pot = U(t.pot + pay);
    if (s.usdt === 0) s.allin = true;
    s.lastAct = call > 0 ? (s.allin ? '跟注 All-in' : '跟注') : '过牌';
    t.log.push({ street: t.street, name: s.user && s.user.name, act: s.lastAct, amt: pay });
  } else if (type === 'raise' || type === 'bet') {
    var betType = t.mode.bet || 'nolimit';
    if (betType === 'aof') amt = s.usdt;
    else if (betType === 'potlimit') amt = Math.min(amt, t.pot + call);
    else if (betType === 'fixed') amt = t.street >= 2 ? t.bb * 2 : t.bb;
    amt = Math.max(amt, Math.min(t.minRaise, s.usdt));
    var total = Math.min(call + amt, s.usdt);
    var add = total - s.bet > 0 ? total - s.bet : 0;
    if (s.usdt - total <= 0) { total = s.usdt; s.allin = true; }
    s.usdt = U(s.usdt - total); s.bet = U(s.bet + total); s.contrib = U(s.contrib + total); t.pot = U(t.pot + total);
    var raiseInc = total - call;
    var isFullRaise = raiseInc >= t.minRaise && !s.allin;
    t.minRaise = Math.max(t.minRaise, raiseInc);
    s.lastAct = (call > 0 ? '加注' : '下注') + (s.allin ? ' All-in' : '');
    t.log.push({ street: t.street, name: s.user && s.user.name, act: s.lastAct, amt: s.bet });
    t.lastAgg = seatIdx;
    if (isFullRaise) t.seats.forEach(function (x) { if (x.idx !== seatIdx) x.acted = false; });
  }
  if (!s.stat) s.stat = { c: 0, f: 0 };
  if (type === 'fold') s.stat.f++;
  else if (type === 'call' && call > 0) s.stat.c++;
  s.acted = true;
  return true;
}

/* ---------- 轮次 / 推进 ---------- */
function roundDone(t) {
  var live = t.seats.filter(function (s) { return !s.empty && !s.folded && !s.sittingOut && (!s.hole || s.hole.length > 0); });
  if (live.length <= 1) return true;
  var acting = live.filter(function (s) { return !s.allin && s.usdt > 0; });
  if (!acting.length) return true;
  var maxBet = 0;
  live.forEach(function (s) { if (s.bet > maxBet) maxBet = s.bet; });
  return acting.every(function (s) { return s.acted && s.bet >= maxBet; });
}
function advance(t) {
  var live = t.seats.filter(function (s) { return !s.empty && !s.folded && !s.sittingOut && (!s.hole || s.hole.length > 0); });
  if (live.length === 1) return showdown(t);
  var notAllin = live.filter(function (s) { return !s.allin; });
  if (t.street === 3 || live.length <= 1 || (live.length === 2 && notAllin.length === 0) || notAllin.length === 0) {
    if (t.street < 3) { while (t.street < 3) { t.street++; dealCommunity(t); } }
    return showdown(t);
  }
  t.street++; dealCommunity(t);
  t.seats.forEach(function (s) { s.bet = 0; s.acted = false; });
  t.minRaise = t.bb; t.lastAgg = -1;
  var start = nextSeat(t, t.dealerSeat);
  t.toAct = start;
  return 'next';
}
function dealCommunity(t) {
  if (t.street === 1) {
    t.community.push(t.deck.pop(), t.deck.pop(), t.deck.pop());
    houseBiasStreet(t, 3);                                   /* 控水：翻牌按计划方向重发（关闭时是空操作） */
    t.log.push({ street: 1, sys: 1, text: '翻牌：' + t.community.map(cardStr).join(' ') });
  } else if (t.street === 2) {
    t.community.push(t.deck.pop());
    houseBiasStreet(t, 1);                                   /* 控水：转牌同理 */
    t.log.push({ street: 2, sys: 1, text: '转牌：' + cardStr(t.community[3]) });
  } else if (t.street === 3) {
    /* 控水：河牌优先从剩余牌堆里挑一张让计划方获胜的牌；挑不到则正常发牌 */
    var rc = housePickRiver(t);
    t.community.push(rc || t.deck.pop());
    t.log.push({ street: 3, sys: 1, text: '河牌：' + cardStr(t.community[4]) });
  }
}
function rankOf(t, s) {
  if (t.mode.omaha) return evalOmaha(s.hole, t.community, t.modeKey);
  return evalBest(s.hole.concat(t.community), t.modeKey);
}

/* ---------- 未跟注退还 + 结算 + 抽水 + 边池 ---------- */
function refundUncalled(t) {
  var refunds = [], contribs = {};
  t.seats.forEach(function (s) { if (s.contrib > 0) contribs[s.idx] = s.contrib; });
  var levels = Object.keys(contribs).map(Number).map(function (k) { return contribs[k]; });
  levels = levels.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  var prev = 0;
  levels.forEach(function (lv) {
    var amt = 0;
    t.seats.forEach(function (s) { var c = Math.min(s.contrib, lv) - Math.min(s.contrib, prev); if (c > 0) amt += c; });
    var part = t.seats.filter(function (s) { return s.contrib >= lv; });
    if (amt > 0 && part.length === 1 && !t.seats[part[0].idx].empty) refunds.push({ seat: part[0].idx, amount: amt });
    prev = lv;
  });
  refunds.forEach(function (rf) {
    var s = t.seats[rf.seat];
    s.usdt = U(s.usdt + rf.amount); s.contrib = U(s.contrib - rf.amount); t.pot = U(t.pot - rf.amount);
  });
  return refunds;
}
function showdown(t) {
  /* ★★ 2026-10-05 修正「抽水吃掉主池 / 抽水超过底池」（不变式压力测试实测出来的真金 bug）：
     旧实现是「先按『退还未跟注之前』的底池算抽水，再从 pools[0]（主池，往往是最小的那一层）里扣」。
     后果：短码 all-in 造成的边池结构里，主池金额可能远小于抽水 → 主池被扣成 0，
     赢了主池的玩家一分钱拿不到；极端情况整手牌派彩为 0，钱全部进了平台抽水。
     正确顺序：① 先退还未跟注（这部分从未被跟注，理应不抽水）
               ② 再按「实际派彩总额」算抽水
               ③ 抽水按各池金额比例分摊 —— 任何池都不会被抽成负数。
     No Flop No Drop：翻牌前结束的手不抽水（streetForRake 必须是置 4 之前的真实街位）。 */
  var streetForRake = t.street;
  t.status = 'showdown';
  var refunds = refundUncalled(t);
  var contribs = {};
  t.seats.forEach(function (s) { if (s.contrib > 0) contribs[s.idx] = s.contrib; });
  var levels = Object.keys(contribs).map(Number).map(function (k) { return contribs[k]; });
  levels = levels.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  var pools = [], prev = 0;
  levels.forEach(function (lv) {
    var amt = 0;
    t.seats.forEach(function (s) { var c = Math.min(s.contrib, lv) - Math.min(s.contrib, prev); if (c > 0) amt += c; });
    var part = t.seats.filter(function (s) { return s.contrib >= lv; });
    var elig = part.filter(function (s) { return !s.empty && !s.folded && s.hole && s.hole.length > 0; });
    if (amt > 0) {
      if (!elig.length) {
        /* 无合格赢家（通常因离场者残留贡献）：归剩余在场玩家，避免筹码蒸发 */
        var liveRemain = t.seats.filter(function (s) { return !s.empty && !s.folded && !s.sittingOut && s.hole && s.hole.length > 0; });
        if (liveRemain.length) {
          var e2 = U(amt / liveRemain.length), r2 = U(amt - e2 * liveRemain.length);
          liveRemain.forEach(function (x, k) { x.usdt = U(x.usdt + e2 + (k === 0 ? r2 : 0)); });
          t.pot -= amt;
        } else {
          /* ★ 兜底：连一个有底牌的玩家都不剩（异常恢复的残留局）——按该层投入原路退还 */
          var parts = t.seats.filter(function (s) { return !s.empty && s.contrib >= lv; });
          if (parts.length) {
            var e3 = U(amt / parts.length), r3 = U(amt - e3 * parts.length);
            parts.forEach(function (x, k) { x.usdt = U(x.usdt + e3 + (k === 0 ? r3 : 0)); });
            t.pot -= amt;
          }
        }
      } else {
        pools.push({ amount: amt, level: lv, elig: elig.map(function (s) { return s.idx; }) });
      }
    }
    prev = lv;
  });
  t.refunds = refunds;
  /* 抽水：基于「实际派彩总额」（已扣除未跟注退还），并按各池金额比例分摊 */
  var total = 0;
  pools.forEach(function (p) { total += p.amount; });
  var rake = 0;
  if (streetForRake > 0 && total > 0) {
    var rm = modeOf(t.modeKey), rc = rm.rake || { pct: 0.05, capBB: 3 };
    if (rc.pct) {
      var cap = U((rc.capBB || 3) * t.bb);
      rake = Math.max(0, Math.min(U(total * rc.pct), cap, total));
    }
  }
  if (rake > 0 && pools.length) {
    var takes = pools.map(function (p) { return Math.min(p.amount, U(rake * p.amount / total)); });
    var got = 0;
    takes.forEach(function (x) { got += x; });
    var left = rake - got;                                  /* 整除余数：从还有余量的池里补 */
    for (var ti = 0; ti < pools.length && left > 0; ti++) {
      var room = pools[ti].amount - takes[ti];
      var add = Math.min(room, left);
      takes[ti] += add; left -= add;
    }
    pools.forEach(function (p, i) { p.amount = U(p.amount - takes[i]); });
    t.rake = U(rake - left);
    t.rakeTotal = U((t.rakeTotal || 0) + (rake - left));
  } else t.rake = 0;
  t.street = 4;
  t.sidePots = pools;

  function pay(winners, amount, tag, results) {
    if (!winners.length || amount <= 0) return;
    var each = U(amount / winners.length);
    var rem = U(amount - each * winners.length);
    winners.forEach(function (o, k) {
      var s = t.seats[o.seat], add = each + (k === 0 ? rem : 0);
      s.usdt = U(s.usdt + add); s.win = U((s.win || 0) + add);
      results.push({ seat: o.seat, name: s.user && s.user.name, amount: add, hand: handName(s.rank, t.modeKey), low: !!o.low, pot: amount, side: tag });
    });
  }

  var results = [];
  pools.forEach(function (p, pi) {
    var objs = p.elig.map(function (i) {
      var s = t.seats[i];
      s.rank = rankOf(t, s);
      s.low = t.mode.hilo ? omahaLow(s.hole, t.community) : null;
      return { seat: i, rank: s.rank, low: s.low };
    });
    if (t.mode.hilo) {
      var hi = null, hiW = [];
      objs.forEach(function (o) {
        if (!hi || cmp(o.rank, hi) > 0) { hi = o.rank; hiW = [o]; }
        else if (cmp(o.rank, hi) === 0) hiW.push(o);
      });
      var lo = null, loW = [];
      objs.forEach(function (o) {
        if (!o.low) return;
        if (!lo || cmpLow(o.low, lo) < 0) { lo = o.low; loW = [o]; }
        else if (cmpLow(o.low, lo) === 0) loW.push(o);
      });
      if (loW.length) {
        var half = U(p.amount / 2), rem2 = U(p.amount - half * 2);
        pay(hiW, half, '高牌', results);
        pay(loW, half + rem2, '低牌', results);
      } else {
        pay(hiW, p.amount, '高牌独得', results);
      }
      return;
    }
    var best = null, winners = [];
    objs.forEach(function (o) {
      if (!best || cmp(o.rank, best) > 0) { best = o.rank; winners = [o]; }
      else if (cmp(o.rank, best) === 0) winners.push(o);
    });
    pay(winners, p.amount, pi === 0 ? '主池' : '边池' + pi, results);
  });
  /* MVP：VIP 返水暂置 0（后续后台可配；避免凭空增发筹码）。 */
  t.rebate = 0;
  t.pot = 0; /* ★ 底池已在上面的 refund/pool 分配中全部结清（含抽水），此处归零避免重复计入 */
  t.seats.forEach(function (s) { s.contrib = 0; s.bet = 0; }); /* ★ 一手结束：清掉已结算的投入/下注，避免被离座逻辑当成在玩筹码重复退款 */
  t.result = results;
  t.log.push({ street: 4, sys: 1, text: '摊牌结束' });
  return 'showdown';
}

/* ---------- 蒙特卡洛胜率 + 机器人决策（陪打用，MVP 房间桌不启用） ---------- */
function mcEquity(hole, board, nOpp, iters, modeKey) {
  iters = iters || 220;
  nOpp = Math.max(1, Math.min(4, nOpp || 1));
  var mode = modeOf(modeKey);
  var isOm = !!mode.omaha;
  var known = hole.concat(board || []);
  var deck = makeDeck(mode.minRank || 2).filter(function (c) {
    return !known.some(function (k) { return k.r === c.r && k.s === c.s; });
  });
  var need = 5 - (board ? board.length : 0);
  var win = 0, it, i;
  for (it = 0; it < iters; it++) {
    shuffle(deck);
    var full = (board || []).slice(), p = 0;
    for (i = 0; i < need; i++) full.push(deck[p++]);
    var my = isOm ? evalOmaha(hole, full, modeKey) : evalBest(hole.concat(full), modeKey);
    var beaten = false, tied = false;
    for (i = 0; i < nOpp && !beaten; i++) {
      var oh = [deck[p++], deck[p++]];
      var ov = isOm ? evalOmaha(oh, full, modeKey) : evalBest(oh.concat(full), modeKey);
      var c = cmp(ov, my);
      if (c > 0) beaten = true; else if (c === 0) tied = true;
    }
    if (!beaten) win += tied ? 0.5 : 1;
  }
  return win / iters;
}
/* 干净的机器人决策（无透视、无控盘）：基于胜率 + 底池赔率，类似前端 simHumanDecide。
   仅当房间需要机器人陪打时使用；MVP 真人对战房间不调用。 */
function botDecide(t, s) {
  var call = toCall(t, s);
  var pot = Math.max(1, t.pot);
  var live = t.seats.filter(function (x) { return !x.empty && !x.folded && !x.sittingOut && x.idx !== s.idx; });
  var oppN = Math.max(1, live.length);
  var eq = mcEquity(s.hole, t.community, oppN, 120, t.modeKey);
  var po = call / (pot + call);
  if (call <= 0) {
    if (eq > 0.6 && Math.random() < 0.6) return { type: 'bet', amt: Math.max(t.bb, Math.round(pot * 0.5)) };
    return { type: 'check' };
  }
  if (t.mode.bet === 'aof') {
    if (eq >= (oppN > 2 ? 0.55 : 0.44)) return { type: 'raise', amt: s.usdt };
    return { type: 'fold' };
  }
  if (eq > 0.78 && Math.random() < 0.5) return { type: 'raise', amt: Math.max(t.minRaise, Math.round(pot * 0.6)) };
  if (eq >= po) return { type: 'call' };
  if (Math.random() < 0.15) return { type: 'call' };
  return { type: 'fold' };
}

/* ---------- 导出 ---------- */
module.exports = {
  SUITS: SUITS, SUIT_CH: SUIT_CH, RANK_CH: RANK_CH, MODES: MODES, RAKEBACK: RAKEBACK, modeOf: modeOf,
  makeDeck: makeDeck, shuffle: shuffle, cardStr: cardStr,
  eval5raw: eval5raw, eval5: eval5, evalBest: evalBest, evalOmaha: evalOmaha, lowHand: lowHand, omahaLow: omahaLow,
  cmpLow: cmpLow, cmp: cmp, HAND_NAMES: HAND_NAMES, HAND_NAMES_SHORT: HAND_NAMES_SHORT, handName: handName,
  rakeOf: rakeOf, rakeText: rakeText, potMaxRaise: potMaxRaise,
  seatPlayer: seatPlayer, activeSeats: activeSeats, nextSeat: nextSeat, nextLivingSeat: nextLivingSeat,
  createTable: createTable, startHand: startHand, post: post, autoDiscard: autoDiscard, discardAll: discardAll, toCall: toCall,
  doAction: doAction, roundDone: roundDone, advance: advance, dealCommunity: dealCommunity, rankOf: rankOf,
  refundUncalled: refundUncalled, showdown: showdown, mcEquity: mcEquity, botDecide: botDecide,
  /* 控水（服务端版，2026-10-06）：后台「AI 与控水 → 控水」直接驱动机器人房发牌倾向。
     默认关闭；只对 botFill 且 bot 与真人同桌的手生效；只改发牌，不改抽水/边池/资金守恒。 */
  setHouse: setHouse, houseCfg: houseCfg, houseOn: houseOn, houseStat: houseStat, houseImport: houseImport,
  planHand: planHand, houseStatAdd: houseStatAdd
};




