'use strict';
/* ============================================================================
 * pokertable.js · 服务端权威牌局状态机（房间真人对战 P2P）
 * ----------------------------------------------------------------------------
 * 与 poker.js 配合：poker.js 负责"一手牌的规则演化"，本模块负责"房间级别的
 * 多手牌状态机 + 资金记账 + 超时托管 + 脱敏序列化"。
 *
 * 设计要点：
 *   1) 轮询驱动（无 WebSocket）：前端每 ~500ms 拉 /papi/table/state；本模块在
 *      state/action 端点检查 deadline，由"轮询"充当心跳来驱动超时托管与下一手开局，
 *      避免独立定时器带来的内存泄漏/重启丢失。
 *   2) 真人对战房间（有房间号）不安排 bot 陪打：≥2 真人买入才开赛，不足则 waiting。
 *   3) 资金口径（P2P）：买入 account.usdt -> seat.usdt（记 tablePaid/tableBank）；
 *      离座 seat.usdt 全额退回 account.usdt（赢的真人钱可带走，平台只收 rake）。
 *   4) 脱敏：序列化时绝不下发 deck/run（未发出的牌），只暴露当前 hero 的 hole。
 *   5) 超时口径（与前端一致）：主 15s -> 进入 5s 宽限 -> 宽限结束强制弃牌（不自动退房）。
 * ========================================================================== */
const P = require('./poker.js');
const fs = require('fs');
const path = require('path');

const HERO_SEC = 15000;        /* 主决策倒计时（ms） */
const HERO_GRACE_SEC = 5000;   /* 宽限（ms） */
const NEXT_HAND_DELAY = 8000;  /* 摊牌后到下一手自动开始的间隔（ms）——2026-10-05 由 5s 调为 8s：赢家皇冠/金额要看清 */
const TABLES_FILE = process.env.GU9_TABLES_FILE || path.join(__dirname, 'tables.json'); /* 崩溃安全：内存牌局落盘（含 deck/run，仅供续局；测试可经 env 重定向） */

let TABLES = {};               /* roomNo -> 牌局包装对象 */
let D = null;                  /* deps：{ DB, ROOMS, saveDB, getSession, audit } */
/* ---- bot 做市盈亏总账（2026-10-05）----
   牌桌对象会在「真人都走光」时被删除，桌上那份 botNet 随之消失；
   但平台必须能回答「机器人今天总共垫付了多少 / 收了多少」，所以单独落盘累计。
   正 = bot 赢（真人的钱进平台），负 = bot 输（平台垫付给真人）。 */
let BOTPNL = { total: 0, rake: 0, hands: 0, byRoom: {} };
const BOTPNL_FILE = process.env.GU9_BOTPNL_FILE || path.join(__dirname, 'botpnl.json');
function loadBotPnl() {
  try { const j = JSON.parse(fs.readFileSync(BOTPNL_FILE, 'utf8')); if (j && typeof j === 'object') BOTPNL = j; } catch (e) { }
  if (!BOTPNL.byRoom) BOTPNL.byRoom = {};
  /* 控水闭环统计随 botpnl 一起持久化（重启后不用从零校准） */
  try { if (BOTPNL.house) P.houseImport(BOTPNL.house); } catch (e) { }
}
function saveBotPnl() { try { fs.writeFileSync(BOTPNL_FILE, JSON.stringify(BOTPNL)); } catch (e) { } }

/* ---- ★ 2026-10-06：每日经营账（服务端权威）——后台「每日净利润」看板数据源 ----
   与 botpnl 的区别：botpnl 是「开机以来的总账」，这里是「按自然日分桶的日账」，
   每天一行：手数 / 抽水 / 机器人净 / 平台净（= 抽水 + 机器人净）/ 人工发放等资金流。
   记账点就在服务端每手结算（onAdvance→showdown），只认服务端数据，不依赖前端上报，
   因此纯机器人互打的桌（无真人、无人上报）也能记到抽水。 */
let DAILY = { days: {} };
const DAILY_FILE = process.env.GU9_DAILY_FILE || path.join(__dirname, 'dailystats.json');
function dayKey(ts) {
  const d = new Date(ts || Date.now()), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function loadDaily() {
  try { const j = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8')); if (j && j.days && typeof j.days === 'object') DAILY = j; } catch (e) { }
  if (!DAILY.days) DAILY.days = {};
  /* 只留近 120 天，避免文件无限膨胀 */
  const ks = Object.keys(DAILY.days).sort();
  while (ks.length > 120) { delete DAILY.days[ks.shift()]; }
}
function saveDaily() { try { fs.writeFileSync(DAILY_FILE, JSON.stringify(DAILY)); } catch (e) { } }
/* rk=本手抽水，botNet=本手机器人净盈亏（正=机器人赢），hasBot=本桌有机器人 */
function recordDaily(rk, botNet, hasBot) {
  const k = dayKey();
  const d = DAILY.days[k] || (DAILY.days[k] = { hands: 0, rake: 0, botNet: 0, botHands: 0 });
  d.hands += 1;
  d.rake = U((+d.rake || 0) + (rk || 0));
  d.botNet = U((+d.botNet || 0) + (botNet || 0));
  if (hasBot) d.botHands += 1;
  saveDaily();
}
/* 后台人工调账（加款/扣款）也计入当日经营账：给玩家发钱 = 平台支出（负） */
function recordDailyAdjust(deltaUsdt) {
  const k = dayKey();
  const d = DAILY.days[k] || (DAILY.days[k] = { hands: 0, rake: 0, botNet: 0, botHands: 0 });
  d.adjust = U((+d.adjust || 0) + (deltaUsdt || 0));
  saveDaily();
}

function init(deps) { D = deps; loadTables(); loadBotPnl(); loadDaily(); }
function saveTables() { try { fs.writeFileSync(TABLES_FILE, JSON.stringify(TABLES)); } catch (e) { /* 落盘失败不影响内存牌局 */ } }
function loadTables() {
  try { const j = JSON.parse(fs.readFileSync(TABLES_FILE, 'utf8')); if (j && typeof j === 'object') TABLES = j; else TABLES = {}; }
  catch (e) { TABLES = {}; }
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function getUid(req) { const s = D.getSession(req); return s ? s.uid : null; }
function getMe(req) { const uid = getUid(req); return uid ? (D.DB.users[uid] || null) : null; }
function roomOf(no) {
  const rooms = (D.ROOMS && D.ROOMS.rooms) || {};
  for (const k in rooms) if (rooms[k] && rooms[k].no === no) return rooms[k];
  return null;
}
function parseQuery(url) {
  const q = {}; const i = String(url || '').indexOf('?'); if (i < 0) return q;
  String(url).slice(i + 1).split('&').forEach(function (kv) {
    const p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });
  return q;
}

function mkUser(uid, roomSeat) {
  const u = (D.DB.users[uid]) || {};
  /* ★ 2026-10-07：真人座位快照带上 avatar（此前漏了 → 牌桌页真人全走字母兜底头像，bot 反而正常） */
  return { id: uid, name: (roomSeat && roomSeat.name) || u.name || '玩家', color: (roomSeat && roomSeat.color) || u.color || '#3b8cff', avatar: u.avatar || '', vip: u.vip || 0, isBot: false };
}

/* 按 uid 定位座位 / 分配空位 —— 房间 seats 是「压缩数组」：有人离开后下标会整体前移，
   所以绝不能把房间座位下标直接当牌桌座位下标用（否则 A 的桌上筹码会被算到 B 头上）。
   ★ 2026-10-05 P0 修复。 */
function findSeatByUid(t, uid) {
  for (const st of t.seats) { if (!st.empty && st.user && String(st.user.id) === String(uid)) return st; }
  return null;
}
function allocSeat(t, preferIdx, allowKickBot) {
  let cand = (preferIdx != null && preferIdx >= 0 && preferIdx < t.seats.length) ? t.seats[preferIdx] : null;
  if (cand && !cand.empty) cand = null;
  if (!cand) { cand = null; for (const st of t.seats) { if (st.empty) { cand = st; break; } } }
  /* 机器人房满员时真人仍要进 → 挤掉一个 bot（bot 筹码是做市筹码，直接丢弃，不涉真钱） */
  if (!cand && allowKickBot) {
    for (const st of t.seats) { if (isBotSeat(st)) { clearSeat(st); cand = st; break; } }
  }
  return cand;
}

/* 房间牌桌人数上限：最多 8 人 8 椅（用户要求；原先 9 人） */
const MAX_SEATS = 8;

/* ============================================================================
 * 机器人陪打（2026-10-05）★ 产品规则（用户定，勿改）：
 *   ① 机器人桌 = 真钱 USDT，全站没有「练习币」这回事。
 *   ② 真人可以去「机器人房」玩；机器人**绝不允许**出现在真人的自建房 / 好友房里。
 *   ③ 房间用 room.botFill 区分：true = 机器人房（bot 补齐座位、1 个真人即开赛）。
 *   ④ bot 筹码 = 平台做市筹码：bot 赢 → 真人的钱进平台；bot 输 → 平台垫付给真人。
 *      这是刻意的产品选择（玩家随时有桌可打），所以 bot 净盈亏必须可审计。
 *   ⑤ bot 无透视、无控盘：决策只用 P.botDecide（蒙特卡洛胜率 + 底池赔率），
 *      拿不到任何别人的底牌（hole 只对本人 / 摊牌后下发）。
 * ========================================================================== */
/* ★ 2026-10-07：机器人全部换英文名 + 配套真人感头像（bot-01~34.jpg，与 BOT_NAMES 一一对应） */
const BOT_NAMES = ['Mike','Jelly','James','Ryan','Meadow','Teddy','Forest','Emma','Rio','Luna','Penny','Oliver','Bonnie','Star','Finn','Leo','Jack','Iris','Milo','Sam','Max','Grace','Charlie','Sunny','Chloe','Daniel','Sophia','Ivy','Neo','Mia','Yuki','Kevin','Aiko','Ethan'];
const BOT_AVATARS = Array.from({ length: 34 }, function (_, i) { return '/assets/avatars/bot-' + String(i + 1).padStart(2, '0') + '.jpg'; });
const BOT_COLORS = ['#3b8cff', '#ff7a59', '#22c55e', '#a855f7', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6'];
/* 节奏要像真人：用户要求「机器人要像有思想一样，模仿跟真人一样」，
   2026-10-07 用户定档：单次思考 2~7 秒（原 5~12 秒嫌慢，一手牌拖 2~3 分钟）。
   每次决策在 2~7 秒区间随机，避免所有 bot 同频。 */
const BOT_DELAY_MIN = 2000;   /* bot 思考下限（ms）—— 2026-10-07 定档 2~7 秒 */
const BOT_DELAY_MAX = 7000;   /* bot 思考上限（ms）—— 2026-10-07 定档 2~7 秒 */

function isBotSeat(s) { return !!(s && !s.empty && s.user && s.user.isBot); }

function U(v) { return Math.round((+v || 0) * 100) / 100; }   /* ★ 2026-10-06：全站唯一金额单位 = USDT（两位小数），不再有「分」 */

/* ============================================================================
 * 控水（2026-10-06 · 服务端版）：后台「AI 与控水 → 控水」直接作用于机器人房
 * ----------------------------------------------------------------------------
 * ★★ 铁律（改这段代码前必读）：
 *   ① 默认关闭：config.house.on 为假 → 一律返回 null（发牌完全公平随机）。
 *   ② 只有**机器人房**（table.botFill）才可能生成计划。
 *      真人自建房 / 好友房 / 私人房 bot 根本不会进 → 永不控盘（那是作弊，不是运营）。
 *   ③ 桌上必须同时有 bot 和真人：纯 bot 互打（没真人）全是平台做市筹码，控了没意义。
 *   ④ 计划只存在于服务端（t.housePlan），序列化不下发，玩家无从反推。
 *   ⑤ 只偏置发牌，不碰抽水/边池/记账 —— 资金守恒完全不变。
 * ========================================================================== */
function housePlanFor(table) {
  try {
    const cfg = (D && D.getConfig) ? D.getConfig() : null;
    P.setHouse(cfg && cfg.house);   /* 每手开局都按最新后台配置刷新（含「后台刚关掉」的即时生效） */
  } catch (e) { }
  if (!P.houseOn()) return null;
  if (!table || !table.botFill) return null;
  const t = table.t;
  let bots = 0, humans = 0;
  t.seats.forEach(function (s) {
    if (s.empty || s.sittingOut || (+s.usdt || 0) <= 0) return;
    if (s.user && s.user.isBot) bots++; else humans++;
  });
  if (!bots || !humans) return null;
  return P.planHand(t);
}
function botBuyInBase(t) { return Math.max((+t.bb || 1) * 100, 100); } /* bot 标准买入 = 100bb */
function randomBotBuyIn(t) { const base = botBuyInBase(t); const min = U(base * 1.00); const max = U(base * 2.50); return U(min + Math.random() * (max - min)); } /* bot 买入在 100bb~250bb 之间随机（每个 bot 独立） */
function botBuyInOf(t) { return botBuyInBase(t); }
function sumBotChips(t) {
  let n = 0; t.seats.forEach(function (s) { if (isBotSeat(s)) n += Math.max(0, Math.round(+s.usdt || 0)); });
  return n;
}
function clearSeat(s) {
  s.user = null; s.empty = true; s.usdt = 0; s.hole = []; s.bet = 0; s.contrib = 0;
  s.folded = false; s.allin = false; s.acted = false; s.lastAct = ''; s.sittingOut = false; s.win = 0;
}
function seatBot(t, s, usdt, off) {
  const i = s.idx;
  const k = ((i + (off || 0)) % BOT_NAMES.length + BOT_NAMES.length) % BOT_NAMES.length;
  return P.seatPlayer(t, i, {
    id: 'bot:' + i, name: BOT_NAMES[k], avatar: BOT_AVATARS[k], color: BOT_COLORS[i % BOT_COLORS.length],
    vip: 0, isBot: true
  }, usdt);
}
/* 按「真人数」动态补齐 bot：cap 满员时至少留 1 个空位，保证真人随时能挤进来 */
function syncBots(table, room) {
  const t = table.t;
  const cap = t.cap;
  /* ★ 2026-10-05 铁律：机器人只进「机器人房」。真人自建房 / 好友房 / 私人房一律不塞 bot，
     已经混进去的也立刻清掉。 */
  if (!room.botFill || room.priv === 'private') { t.seats.forEach(function (s) { if (isBotSeat(s)) clearSeat(s); }); return; }
  let humans = 0;
  t.seats.forEach(function (s) { if (!s.empty && s.user && !s.user.isBot) humans++; });
  /* 至少留 1 个空位给真人随时挤进来；但空位只剩 1 个时也照样坐满（否则 cap=2 的单挑桌
     永远凑不出 bot，牌桌卡在 waiting 开不了局 —— 2026-10-05 修）。 */
  const free = cap - humans;
  const target = free <= 0 ? 0 : Math.max(1, Math.min(cap - 1, cap - humans - 1));
  let have = 0;
  t.seats.forEach(function (s) { if (isBotSeat(s)) have++; });
  if (have > target) {
    for (let i = t.seats.length - 1; i >= 0 && have > target; i--) {
      if (isBotSeat(t.seats[i])) { clearSeat(t.seats[i]); have--; }
    }
  } else if (have < target) {
    for (let i = 0; i < t.seats.length && have < target; i++) {
      if (t.seats[i].empty) {
        if (table.avOff == null) table.avOff = Math.floor(Math.random() * BOT_AVATARS.length);
        const buy = randomBotBuyIn(t);   /* ★ 每个 bot 独立随机，绝不能在循环外取值 */
        const st = seatBot(t, t.seats[i], buy, table.avOff);
        if (st) st.botBuyin = buy;
        have++;
      }
    }
  }
}
/* bot 输光后自动补码（只在非进行中补，避免破坏本手）：牌桌永远不缺陪打 */
/* bot 每手开局归一到各自的随机目标买入：让桌上 bot 筹码有高有低更逼真（100bb~250bb）。
   只在非 playing 阶段执行，绝不破坏进行中的一手，也只在机器人房生效。 */
function topUpBots(table) {
  if (!table.botFill || table.phase === 'playing') return;
  const t = table.t;
  t.seats.forEach(function (s) {
    if (!isBotSeat(s)) return;
    const _base = botBuyInBase(t);
    if (!s.botBuyin || +s.botBuyin <= 0 || +s.botBuyin < _base) s.botBuyin = randomBotBuyIn(t);   /* 低于 100bb（老数据/异常）自动重随机 */
    s.usdt = U(+s.botBuyin);
  });
}

/* ★ 2026-10-08 玩家真实统计（服务端权威）：发牌后给拿到底牌的真人座位记起始筹码快照 */
function snapHumanStacks(table) {
  /* ★ 2026-10-08 修复：必须在 startHand 【之前】调用 —— 盲注是 startHand 内部扣的，
     扣完再快照会把玩家每手输掉的 sb/bb 漏记进 delta（实测 4 手漏 3 USDT，net 与真实盈亏对不上）。
     条件 = 真人 + 有筹码 + 未旁观（本手参与者）；不再依赖 hole，因为发牌前本来就没有底牌。 */
  table.handSnap = {};
  table.t.seats.forEach(function (s) {
    if (s.empty || !s.user || s.user.isBot) return;
    if (!(+s.usdt > 0) || s.sittingOut) return;
    table.handSnap[s.user.id] = +s.usdt || 0;
  });
}
/* 牌面编码：As / Th —— 前端 PlayingCard 与回看 UI 直接用 */
function cardCode(c) {
  if (!c) return '';
  const rmap = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  return (rmap[c.r] || '?') + (c.s || 's');
}
/* 相对庄家位置标签（正常牌局回看用，不含任何透视） */
function posLabel(t, seatIdx) {
  if (seatIdx === t.dealerSeat) return 'BTN';
  if (seatIdx === t.sbSeat) return 'SB';
  if (seatIdx === t.bbSeat) return 'BB';
  const occupied = [];
  for (let i = 0; i < (t.cap || 9); i++) {
    const s = t.seats[i];
    if (s && !s.empty && s.user && s.hole && s.hole.length) occupied.push(i);
  }
  if (!occupied.length) return 'S' + seatIdx;
  const btn = (t.dealerSeat | 0);
  const ord = occupied.slice().sort(function (a, b) {
    const da = (a - btn + 100) % 100, db = (b - btn + 100) % 100;
    return da - db;
  });
  const names = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO', 'MP', 'LJ'];
  const ix = ord.indexOf(seatIdx);
  if (ix < 0) return 'S' + seatIdx;
  if (ix < names.length) return names[ix];
  return 'UTG+' + (ix - 3);
}
/* 简单牌力强弱：按摊牌牌型类别；未摊牌则按净结果粗标 */
function strengthOf(rankCat, folded, delta) {
  if (folded) return delta >= 0 ? 'fold' : 'fold';
  const cat = Math.max(0, Math.round(+rankCat || 0));
  if (cat >= 6) return 'strong';   /* 葫芦及以上 */
  if (cat >= 3) return 'medium';  /* 三条 / 顺 / 同花 */
  if (cat >= 1) return 'weak';    /* 一对 / 两对 */
  return delta > 0 ? 'medium' : 'weak';
}
/* 每手结束（showdown 结算完）：真人 hands/net/win + 近30天daily + 对局记录log + hands台账 */
function bumpHumanStats(table) {
  const t = table.t;
  const snap = table.handSnap || {};
  const room = roomOf(table.no);
  const roomName = room ? (room.name || ('房间 ' + table.no)) : ('房间 ' + table.no);
  const rakeHand = U(Math.max(0, (+t.rakeTotal || 0) - (+table.lastRake || 0)));
  /* ★ 一手结束 poker.js 会把 s.contrib / t.pot 清零（poker.js:678），这里用「派彩总额 + 本手抽水」还原底池 */
  const potHand = U(t.seats.reduce(function (a, s) { return a + (+s.win || 0); }, 0) + rakeHand);
  const now = Date.now();
  const dk = new Date(now).toISOString().slice(0, 10);
  const handId = 'H' + now.toString(36) + Math.random().toString(36).slice(2, 6);
  const boardCodes = Array.isArray(t.community) ? t.community.map(cardCode).filter(Boolean) : [];
  const boardDisp = Array.isArray(t.community) ? t.community.map(function (c) { try { return P.cardStr(c); } catch (e) { return ''; } }).filter(Boolean) : [];
  const actions = (t.log || []).slice(-80).map(function (e) {
    return {
      street: e.street, sys: !!e.sys, name: e.name || '', act: e.act || '',
      amt: e.amt != null ? U(+e.amt || 0) : undefined,
      text: e.text || ''
    };
  });
  const winners = Array.isArray(t.result) ? t.result.map(function (r) {
    return { seat: r.seat, name: r.name || '', amount: U(+r.amount || 0), hand: r.hand || '', pot: r.side || '' };
  }) : [];
  const winnerNames = winners.filter(function (w) { return (+w.amount || 0) > 0; }).map(function (w) { return w.name; });
  const uniqWinners = winnerNames.filter(function (n, i, a) { return n && a.indexOf(n) === i; });
  const actSummary = actions.filter(function (e) { return !e.sys && e.act; }).slice(0, 24).map(function (e) {
    return (e.name || '?') + ' ' + e.act + (e.amt != null && e.amt > 0 ? (' ' + e.amt) : '');
  }).join(' · ');
  const rows = [];
  t.seats.forEach(function (s) {
    if (s.empty || !s.user || s.user.isBot) return;
    if (snap[s.user.id] === undefined) return;   /* 本手没拿到底牌（旁观/中途进来）不计 */
    const u = D.DB && D.DB.users ? D.DB.users[s.user.id] : null;
    if (!u) return;
    const delta = U((+s.usdt || 0) - (+snap[s.user.id] || 0));
    if (!u.stat || typeof u.stat !== 'object') u.stat = { hands: 0, net: 0, win: 0 };
    u.stat.hands = Math.max(0, Math.round(+u.stat.hands || 0)) + 1;
    u.stat.net = U((+u.stat.net || 0) + delta);
    if ((+s.win || 0) > 0) u.stat.win = Math.max(0, Math.round(+u.stat.win || 0)) + 1;
    if (!u.stat.daily || typeof u.stat.daily !== 'object') u.stat.daily = {};
    u.stat.daily[dk] = U((+u.stat.daily[dk] || 0) + delta);
    const ks = Object.keys(u.stat.daily).sort();
    while (ks.length > 30) delete u.stat.daily[ks.shift()];
    if (!Array.isArray(u.stat.log)) u.stat.log = [];
    u.stat.log.unshift({ t: now, no: String(table.no), room: roomName, bb: U(+t.bb || 0), delta: delta, win: (+s.win || 0) > 0 ? 1 : 0 });
    if (u.stat.log.length > 60) u.stat.log.length = 60;
    const holeCodes = Array.isArray(s.hole) ? s.hole.map(cardCode).filter(Boolean) : [];
    const holeDisp = Array.isArray(s.hole) ? s.hole.map(function (c) { try { return P.cardStr(c); } catch (e) { return ''; } }).filter(Boolean) : [];
    const rankCat = (s.rank && s.rank[0] != null) ? (+s.rank[0] || 0) : -1;
    let handName = '';
    try { if (s.rank) handName = P.handName(s.rank, t.modeKey) || ''; } catch (e) { }
    const folded = !!s.folded;
    const strength = strengthOf(rankCat, folded, delta);
    const pos = posLabel(t, s.idx);
    rows.push({
      id: handId + '-' + String(u.id).slice(-4),
      handId: handId,
      ts: now, uid: u.id, name: u.name,
      table: roomName, roomNo: String(table.no), handNo: String(t.handNo || ''),
      mode: (room && room.modeKey) || t.modeKey || 'nlh',
      sb: U(+t.sb || 0), bb: U(+t.bb || 0),
      pot: potHand, rake: rakeHand,
      hole: holeCodes.length ? holeCodes : holeDisp,
      holeDisp: holeDisp,
      board: boardCodes.length ? boardCodes : boardDisp,
      boardDisp: boardDisp,
      seat: s.idx, pos: pos,
      won: U(+s.win || 0),
      /* 本手投入 = 赢得 - 本手净变动（delta = won - contrib），结算后 s.contrib 已被清零 */
      contrib: U(Math.max(0, (+s.win || 0) - delta)),
      delta: delta,
      folded: folded,
      handName: handName,
      strength: strength,
      winners: uniqWinners,
      winnerDetail: winners,
      actions: actions,
      actSummary: actSummary.slice(0, 400),
      result: delta >= 0 ? ('win +' + delta.toFixed(2)) : ('loss -' + (-delta).toFixed(2))
    });
  });
  table.handSnap = {};
  if (rows.length) {
    rows.forEach(function (row) { try { if (D.reportHand) D.reportHand(row); } catch (e) { } });
    if (D.saveDB) D.saveDB();
  }
}

/* 同步房间座位 -> 牌局座位（仅非 playing 阶段，避免破坏进行中的一手） */
function ensureTable(room) {
  let table = TABLES[room.no];
  const cap = Math.max(2, Math.min(MAX_SEATS, room.cap || MAX_SEATS));
  if (!table) {
    const t = P.createTable({ mode: room.modeKey || 'nlh', sb: room.sb || 0.5, bb: room.bb || 1, cap: cap, ante: room.ante || 0, straddle: !!room.straddle });
    (room.seats || []).forEach(function (s, idx) {
      if (idx < cap) { const st = P.seatPlayer(t, idx, mkUser(s.uid, s), 0); st.sittingOut = true; } /* 未买入 usdt=0，先旁观 */
    });
    table = { no: room.no, t: t, players: {}, deadline: 0, graceUntil: 0, actingUid: null, phase: 'waiting', showdownAt: 0, botFill: !!room.botFill, botActAt: 0, botNet: 0, botSnap: 0 };
    TABLES[room.no] = table;
    syncBots(table, room);
  } else if (table.phase !== 'playing') {
    const t = table.t;
    table.botFill = !!room.botFill; /* 房主可能改过房间属性（改后需重启才会生效，这里顺手同步） */
    const list = (room.seats || []).slice(0, cap);
    const uids = list.map(function (s) { return String(s.uid); });
    /* ① 兜底：还挂在牌桌上、却已不在房间座位里的人 → 结算离场（房间解散/被驱逐的第二道保险） */
    Object.keys(table.players || {}).forEach(function (uid) {
      if (uids.indexOf(String(uid)) < 0) { try { cashOut(table, uid, '离开房间'); } catch (e) { } }
    });
    if (!TABLES[room.no]) TABLES[room.no] = table; /* cashOut 空桌时可能摘掉牌桌，重新挂回，避免 join 写到孤儿对象 */
    /* ② 清掉「空壳座位」：人已不在房间、也从没买入过 —— 留着会占位，
       导致盲注分配/行动顺序绕到它身上（曾经出现 sb 与 bb 都发给同一个人的情况）。 */
    t.seats.forEach(function (st) {
      if (st.empty || !st.user) return;
      if (st.user.isBot) return;   /* ★ bot 座位不在 room.seats 名单里，绝不能被当「空壳」清掉 */
      const sid = String(st.user.id);
      if (uids.indexOf(sid) >= 0 || table.players[sid]) return;
      st.user = null; st.empty = true; st.usdt = 0; st.hole = []; st.bet = 0; st.contrib = 0;
      st.folded = false; st.allin = false; st.acted = false; st.lastAct = ''; st.sittingOut = false; st.win = 0;
    });
    /* ③ 按 uid 匹配落座（不再按房间下标硬套） */
    list.forEach(function (s, idx) {
      const uid = String(s.uid);
      let seat = findSeatByUid(t, uid);
      if (!seat) {
        const cand = allocSeat(t, idx);
        if (!cand) return;
        seat = P.seatPlayer(t, cand.idx, mkUser(s.uid, s), 0);
      } else if (seat.user) {
        if (s && s.name) seat.user.name = s.name;
        if (s && s.color) seat.user.color = s.color;
      }
      if (table.players[uid]) table.players[uid].seatIdx = seat.idx; /* 座位号变了要同步，否则操作错座位 */
      if (!table.players[uid] && seat.usdt <= 0) seat.sittingOut = true; /* 没买入的成员：旁观，不占「0.00」活座 */
    });
    syncBots(table, room);  /* 真人数变了 → 重新配平 bot（先腾位、后补人） */
    topUpBots(table);
  }
  return table;
}

function clearSitOut(table) {
  const t = table.t;
  t.seats.forEach(function (s) { if (!s.empty && s.usdt > 0) s.sittingOut = false; }); /* 有码玩家（含中途加入者）下一手恢复行动 */
}
function setActingFromToAct(table) {
  const t = table.t;
  if (t.toAct < 0) { const r = P.advance(t); return onAdvance(table, r); }
  table.actingUid = t.seats[t.toAct].user ? t.seats[t.toAct].user.id : null;
  table.deadline = Date.now() + HERO_SEC;
  table.graceUntil = 0;
  /* 轮到 bot：给一个「思考」延迟（bot 输赢是真钱，太快像脚本、太慢玩家等得烦） */
  table.botActAt = isBotSeat(t.seats[t.toAct])
    ? Date.now() + BOT_DELAY_MIN + Math.floor(Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN))
    : 0;
}
/* 开赛条件（★ 用户定的产品规则）：
     机器人房 botFill → 1 个真人 + bot 即可开；**没有真人买入时 bot 之间也照常互打**
                        （2026-10-05：玩家进房还没买入也要能看到「有人在打牌」）
     好友房          → 必须 ≥2 个真人，**永不**安排 bot（bot 绝不进真人的房） */
function canStart(table) {
  if (P.activeSeats(table.t).length < 2) return false;
  const humans = Object.keys(table.players || {}).length;
  return table.botFill ? true : humans >= 2;
}
function onAdvance(table, r) {
  if (r === 'showdown') {
    table.phase = 'showdown'; table.actingUid = null; table.showdownAt = Date.now();
    /* ★ 2026-10-08：每手结束记录真人统计与对局记录（服务端权威，bot 盈亏账不受影响） */
    try { bumpHumanStats(table); } catch (e) { }
    /* bot 净盈亏审计（正 = bot 赢真人的钱，负 = 平台垫付给真人）+ 抽水，落盘累计 */
    try {
      const diff = sumBotChips(table.t) - (+table.botSnap || 0);
      table.botNet = U((+table.botNet || 0) + diff);
      const rk = Math.max(0, U((+table.t.rakeTotal || 0) - (+table.lastRake || 0)));
      table.lastRake = U(+table.t.rakeTotal || 0);
      BOTPNL.total = U((+BOTPNL.total || 0) + diff);
      BOTPNL.rake = U((+BOTPNL.rake || 0) + rk);
      BOTPNL.hands = (+BOTPNL.hands || 0) + 1;
      BOTPNL.byRoom[String(table.no)] = U((+BOTPNL.byRoom[String(table.no)] || 0) + diff);
      /* 每日经营账：本手抽水 + 机器人净 → 当日累计（服务端权威，含纯机器人桌的抽水） */
      try {
        const hasBot = (table.t.seats || []).some(function (s) { return s && !s.empty && s.user && s.user.isBot; });
        recordDaily(rk, diff, hasBot);
      } catch (e) { }
      /* 控水闭环：本手真人侧净盈亏 → 校准下一手的偏置目标（控水关闭时是空记账） */
      try { P.houseStatAdd(table.t); BOTPNL.house = P.houseStat(); } catch (e) { }
      saveBotPnl();
    } catch (e) { }
    /* 本手结束：按各家真实持有资产收敛可兑现额度（亏损必须吞掉 cashable） */
    try {
      Object.keys(table.players).forEach(function (uid) {
        const pl = table.players[uid]; if (!pl) return;
        const s = seatOfPlayer(table, uid) || table.t.seats[pl.seatIdx];
        const u = D.DB && D.DB.users ? D.DB.users[uid] : null;
        clampCashable(u, s ? (+s.usdt || 0) : 0);
      });
      if (D.saveDB) D.saveDB();
    } catch (e) { }
    /* 2026-10-08 修订：不再把全部 bot 归一为同一金额。每个 bot 有自己的 100bb~250bb 随机目标买入，
       下一手 beginNextHand -> topUpBots 会把它归一到自己的目标，桌面休息态高低错落更逼真。
       本手净盈亏已用归一前的快照算完，这里不影响 bot 盈亏账。 */
    try { topUpBots(table); } catch (e) { }
    saveTables(); return;
  }
  setActingFromToAct(table);
}
function afterAction(table, lastSeat) {
  const t = table.t;
  if (P.roundDone(t)) { const r = P.advance(t); onAdvance(table, r); return; }
  const nx = P.nextSeat(t, lastSeat);
  if (nx < 0) { const r = P.advance(t); onAdvance(table, r); return; }
  t.toAct = nx; setActingFromToAct(table);
}
function tryStart(table) {
  const t = table.t;
  if (table.phase === 'playing') return;
  topUpBots(table);
  if (canStart(table)) {
    clearSitOut(table);
    t.housePlan = housePlanFor(table);   /* 控水：发牌前定本手计划（默认关闭 → null，发牌完全随机） */
    snapHumanStacks(table);   /* ★ 盲注在 startHand 里扣，快照必须在它之前 */
    if (P.startHand(t)) { table.phase = 'playing'; table.botSnap = sumBotChips(t); setActingFromToAct(table); saveTables(); }
    else table.phase = 'waiting';
  } else table.phase = 'waiting';
}
function beginNextHand(table) {
  const t = table.t;
  t.seats.forEach(function (s) { if (s.win) s.win = 0; });
  /* ★ 2026-10-05：本手结束还剩 0 筹码的座位（输光未补码）→ 标记旁观，
     前端显示「旁观」而不是挂着 0.00 占座；买入后由 clearSitOut 恢复。 */
  t.seats.forEach(function (s) { if (!s.empty && s.usdt <= 0) s.sittingOut = true; });
  topUpBots(table);
  if (canStart(table)) {
    clearSitOut(table);
    t.housePlan = housePlanFor(table);   /* 控水：同上，每一手都重新定计划 */
    snapHumanStacks(table);   /* ★ 盲注在 startHand 里扣，快照必须在它之前 */
    if (P.startHand(t)) { table.phase = 'playing'; table.botSnap = sumBotChips(t); setActingFromToAct(table); saveTables(); }
    else table.phase = 'waiting';
  } else table.phase = 'waiting';
}
function timeoutCheck(table) {
  const now = Date.now();
  if (table.phase !== 'playing' || !table.actingUid) return;
  if (isBotSeat(table.t.seats[table.t.toAct])) return; /* bot 由 botTurnCheck 驱动，不走真人超时托管 */
  if (now <= table.deadline) return;
  if (!table.graceUntil) { table.graceUntil = now + HERO_GRACE_SEC; return; } /* 进入宽限，不替玩家行动 */
  if (now > table.graceUntil) {
    const t = table.t, s = t.seats[t.toAct];
    /* ★ 自愈：轮到的座位没有底牌（历史残留/异常状态）→ 直接按弃牌移出本手，绝不卡局 */
    if (s && !s.hole.length) {
      s.folded = true; s.lastAct = '弃牌';
      afterAction(table, t.toAct);
      saveTables();
      return;
    }
    if (s && !s.folded && !s.allin) {
      const call = P.toCall(t, s);
      P.doAction(t, t.toAct, call > 0 ? 'fold' : 'check');
      afterAction(table, t.toAct);
      saveTables(); /* 超时托管造成的弃牌/过牌也要落盘，防重启丢状态 */
    }
  }
}
/* ---- bot 行动：由玩家轮询（state / action）当心跳驱动，不额外起定时器 ----
   轮询驱动的理由与全局一致：进程重启不丢状态，且没有常驻 timer 泄漏。 */
function botTurnCheck(table) {
  for (let guard = 0; guard < 8; guard++) {          /* 上限 8 次：防止连续 bot 互推时死循环 */
    if (table.phase !== 'playing') return;
    const t = table.t;
    const s = t.seats[t.toAct];
    if (!isBotSeat(s) || s.folded || s.allin || s.usdt <= 0) return;
    if (!table.botActAt) { table.botActAt = Date.now() + BOT_DELAY_MIN + Math.floor(Math.random() * (BOT_DELAY_MAX - BOT_DELAY_MIN)); return; }
    if (Date.now() < table.botActAt) return;
    table.botActAt = 0;
    let d = null;
    try { d = P.botDecide(t, s); } catch (e) { d = null; }   /* 决策失败一律降级为过牌/弃牌，绝不卡桌 */
    const call = P.toCall(t, s);
    let type = (d && d.type) || (call > 0 ? 'fold' : 'check');
    let amt = U(+((d && d.amt) || 0));
    if (type === 'bet' && call > 0) type = 'raise';
    if (type === 'raise' && call <= 0) type = 'bet';
    if (type === 'raise' || type === 'bet') amt = Math.min(Math.max(amt, +t.minRaise || t.bb), s.usdt);
    if (type === 'allin') { type = 'raise'; amt = s.usdt; }
    if (['fold', 'check', 'call', 'raise', 'bet'].indexOf(type) < 0) type = call > 0 ? 'fold' : 'check';
    P.doAction(t, s.idx, type, amt);
    afterAction(table, s.idx);
    saveTables();
  }
}
function maybeNextHand(table) {
  const now = Date.now();
  if (table.phase === 'showdown' && now - table.showdownAt >= NEXT_HAND_DELAY) { beginNextHand(table); botTurnCheck(table); }
  else if (table.phase === 'waiting' && canStart(table)) { tryStart(table); botTurnCheck(table); }
}

/* ---- 脱敏序列化（绝不下发 deck/run） ---- */
function serialize(table, uid) {
  const t = table.t;
  /* ★ 本手赢家金额（按座位汇总 result）——前端据此给赢家戴皇冠并显示 +金额。
     result 在 startHand 里被清空，所以只在本手结束时有效，不会跨手误显。 */
  const winMap = {};
  (t.result || []).forEach(function (r) {
    if (!r || r.seat == null) return;
    winMap[r.seat] = (winMap[r.seat] || 0) + (+r.amount || 0);
  });
  const seats = t.seats.map(function (s) {
    if (s.empty) return { idx: s.idx, empty: true, usdt: 0, bet: 0, folded: false, allin: false, lastAct: '', sittingOut: false, user: null, hole: [], win: 0 };
    const isHero = s.user && s.user.id === uid;
    const reveal = (table.phase === 'showdown'); /* 摊牌后公开所有底牌（手已结束，无作弊风险） */
    return {
      idx: s.idx, empty: false, usdt: s.usdt, bet: s.bet, contrib: s.contrib,
      folded: s.folded, allin: s.allin, acted: s.acted, lastAct: s.lastAct, sittingOut: s.sittingOut,
      win: winMap[s.idx] || 0,
      user: { id: s.user.id, name: s.user.name, /* ★ 2026-10-07：快照没头像时回落查 DB（老座位/中途换头像都能立即生效） */ avatar: s.user.avatar || (function () { var _u = D.DB.users[s.user.id]; return (_u && _u.avatar) || ''; })(), vip: s.user.vip || 0, color: s.user.color || '#3b8cff', isHero: isHero, isBot: !!s.user.isBot },
      hole: (reveal || isHero) ? s.hole.slice() : []
    };
  });
  return {
    no: table.no, modeKey: t.modeKey, phase: table.phase,
    botFill: !!table.botFill,          /* 机器人房：前端据此显示「机器人陪打」标记 */
    botNet: Math.round(+table.botNet || 0),
    mode: { key: t.modeKey, name: t.mode.name, bet: t.mode.bet, hole: t.mode.hole || 2, rake: t.mode.rake },
    sb: t.sb, bb: t.bb, cap: t.cap, ante: t.ante || 0, straddle: !!t.straddle,
    status: t.status, street: t.street, community: t.community.slice(),
    pot: t.pot, toAct: t.toAct, dealerSeat: t.dealerSeat, minRaise: t.minRaise, lastAgg: t.lastAgg,
    actingUid: table.actingUid, deadline: table.deadline, graceUntil: table.graceUntil, showdownAt: table.showdownAt || 0, now: Date.now(),
    heroSeat: table.players[uid] ? table.players[uid].seatIdx : -1,
    fx: table.fx || [],
    seats: seats, result: t.result || null, rake: t.rake || 0, rakeTotal: t.rakeTotal || 0,
    handNo: t.handNo, log: (t.log || []).slice(-14)
  };
}

/* ===================== Handlers ===================== */
async function join(req, res, p, b) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = b && b.roomNo; const room = roomOf(no); if (!room) return send(res, 404, { code: 404, msg: '房间不存在' });
  if (!(room.seats || []).some(function (s) { return s.uid === me.id; })) return send(res, 403, { code: 403, msg: '你不在该房间，请先加入房间' });
  const table = ensureTable(room);
  const pl = table.players[me.id];
  /* ★ 座位按 uid 定位（房间座位数组会压缩，pl.seatIdx 可能已过期 → 2026-10-05 P0 修复） */
  let mySeat = findSeatByUid(table.t, me.id);
  if (pl && mySeat && pl.seatIdx !== mySeat.idx) pl.seatIdx = mySeat.idx;
  /* ★ 2026-10-04：已买入再调 join = 「加码」（追加筹码到现有座位），不再报 403。
     没有这个，玩家输光桌上筹码后牌桌永久停摆（activeSeats<2），只能退出重进。
     ★ 2026-10-05：判定条件从「桌上还有筹码」放宽为「已在座位」——
       桌上筹码为 0（全下/输光）时若走下面的新买入分支，seatPlayer 会重置座位
       （hole/contrib/allin 全清），让人在摊牌前把自己的底牌和投入洗掉。 */
  if (pl && mySeat) {
    /* ★ 只在「本手进行中且已全下」时禁止加码（此时加码会破坏本手的底牌/投入）。
       本手已结束（waiting/showdown）时座位的 allin 只是上一手残留，必须允许补充买入，
       否则玩家全下输光后牌桌会永久卡在 waiting 无法续局（2026-10-05）。 */
    if (table.phase === 'playing' && mySeat.allin) return send(res, 400, { code: 400, msg: '本手已全下，请等本手结束后再加码' });
    let add = Math.min(Math.max(0, U(+(b && b.buyIn) || 0)), U(+me.bal || 0));
    if (add <= 0) return send(res, 400, { code: 400, msg: '筹码不足，无法加码' });
    if (table.phase !== 'playing' && mySeat.allin) mySeat.allin = false; /* 上一手残留：清掉才能参与下一手 */
    /* ★ 2026-10-05 修复「无底牌却被轮到行动/卡局」：本手进行中而这个座位没有底牌
       （中途上桌/异常恢复），加码后只旁观本手（sittingOut），下一手自动上桌。
       绝不能让无牌座位进入行动轮——那会把牌局永久卡死。 */
    if (table.phase === 'playing' && !mySeat.folded && !(mySeat.hole && mySeat.hole.length)) mySeat.sittingOut = true;
    mySeat.usdt = U((+mySeat.usdt || 0) + add);
    if (table.phase !== 'playing' && mySeat.usdt > 0) mySeat.sittingOut = false; /* 补码后恢复行动（本手进行中的无牌旁观不受影响） */
    me.bal = U((+me.bal || 0) - add);
    me.tablePaid = U((+me.tablePaid || 0) + add);
    me.tableBank = U((+me.tableBank || 0) + add);
    clampCashable(me, mySeat.usdt);
    D.saveDB();
    tryStart(table);   /* 之前可能因有人筹码为 0 而停在 waiting，加码后重新尝试开赛 */
    saveTables();
    if (D.audit) D.audit('system', 'table-rebuy', me.id, '加码 ' + add + ' 房间 ' + no, '-');
    return send(res, 200, { ok: true, added: add, state: serialize(table, me.id) });
  }
  let buyIn = Math.min(Math.max(0, U(+(b && b.buyIn) || 100 * (+room.bb || 1))), U(+me.bal || 0));
  if (buyIn <= 0) return send(res, 400, { code: 400, msg: '筹码不足，无法买入' });
  const roomIdx = (room.seats || []).findIndex(function (s) { return String(s.uid) === String(me.id); });
  const exSeat = findSeatByUid(table.t, me.id);
  let seatIdx;
  if (exSeat) seatIdx = exSeat.idx;
  else {
    const cand = allocSeat(table.t, roomIdx, true);   /* 机器人房满员时挤掉一个 bot，真人永远进得来 */
    if (!cand) return send(res, 400, { code: 400, msg: '牌桌座位已满' });
    seatIdx = cand.idx;
  }
  P.seatPlayer(table.t, seatIdx, mkUser(me.id, room.seats[roomIdx] || null), buyIn);
  if (table.phase === 'playing') table.t.seats[seatIdx].sittingOut = true; /* 进行中中途加入 → 本手旁观，下一手自动上场 */
  me.bal = U((+me.bal || 0) - buyIn); me.tablePaid = (me.tablePaid || 0) + buyIn; me.tableBank = (me.tableBank || 0) + buyIn;
  clampCashable(me, table.t.seats[seatIdx].usdt); D.saveDB();
  table.players[me.id] = { seatIdx: seatIdx, joinedAt: Date.now() };
  tryStart(table);
  saveTables();
  if (D.audit) D.audit('system', 'table-join', me.id, '买入 ' + buyIn + ' 进入房间 ' + no, '-');
  return send(res, 200, { ok: true, state: serialize(table, me.id) });
}

async function state(req, res, p, q) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = q.roomNo;
  let table = TABLES[no];
  const room = roomOf(no);
  if (!room) return send(res, 404, { code: 404, msg: '房间不存在' });
  /* ★ 2026-10-05：每次 state 轮询都过一遍 ensureTable —— 桌不存在则建桌；
     桌已存在且不在对局中则同步房间成员（晚进房落座 / 离房者结算 / 空壳座清理）。
     之前只在建桌时同步，导致「后进房的人看不到晚加入的成员、退出者的幽灵座位清不掉」。 */
  const created = !table;
  table = ensureTable(room);
  const isPlayer = !!table.players[me.id];
  timeoutCheck(table); botTurnCheck(table); maybeNextHand(table);
  /* ★ 2026-10-05 兜底：0 筹码且无底牌的空转座位立刻标旁观（不等下一手）。
     否则「输光后退出/从未买入」的座位在等待期会以 0.00 出现在别人屏幕上。 */
  if (table.t.status !== 'playing') {
    table.t.seats.forEach(function (s) {
      if (s && !s.empty && !s.sittingOut && (s.usdt | 0) === 0 && (!s.hole || !s.hole.length)) s.sittingOut = true;
    });
  }
  if (created) saveTables();
  /* spectating=true：围观中（未买入）。前端据此不显示「已加入」状态，保留买入入口 */
  return send(res, 200, { ok: true, state: serialize(table, me.id), spectating: !isPlayer });
}

async function action(req, res, p, b) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = b && b.roomNo; const table = TABLES[no]; if (!table) return send(res, 404, { code: 404, msg: '牌局未开始' });
  const pl = table.players[me.id]; if (!pl) return send(res, 403, { code: 403, msg: '你尚未加入该房间牌局' });
  if (table.phase !== 'playing') return send(res, 400, { code: 400, msg: '当前不是行动阶段' });
  const t = table.t; const s = seatOfPlayer(table, me.id); const seatIdx = s ? s.idx : pl.seatIdx;
  timeoutCheck(table);
  if (!s || s.empty || !s.user || String(s.user.id) !== String(me.id)) return send(res, 400, { code: 400, msg: '你当前不在牌桌座位上' });
  if (table.actingUid !== me.id) return send(res, 400, { code: 400, msg: '还没轮到你行动' });
  if (!s || !s.hole || !s.hole.length) return send(res, 400, { code: 400, msg: '本手没有发牌给你，等下一手自动上桌' });
  if (!s || s.folded || s.allin || s.usdt === 0) return send(res, 400, { code: 400, msg: '你当前无法行动' });
  let type = String(b.type || '').toLowerCase();
  if (['fold', 'check', 'call', 'raise', 'bet', 'allin'].indexOf(type) < 0) return send(res, 400, { code: 400, msg: '未知动作' });
  let amt = Math.round(+(b.amt) || 0);
  if (type === 'allin') { type = 'raise'; amt = s.usdt; }
  if (type === 'raise' || type === 'bet') amt = Math.min(Math.max(0, amt), s.usdt);
  P.doAction(t, seatIdx, type, amt);
  afterAction(table, seatIdx);
  saveTables();
  botTurnCheck(table);   /* 真人行动后立刻让 bot 排队思考，别等下一次轮询 */
  return send(res, 200, { ok: true, state: serialize(table, me.id) });
}

/* ---- 离场结算核心：桌上余额全额退回账户 + 移出牌桌（离座 / 房间解散 / 被驱逐 共用） ----
   ★ 2026-10-04 资金安全：真人对战上线后，桌上余额的**唯一权威是本模块**。
   旧的 `u.tableBank` 只是记账字段，**不能**再被 reapOrphanTableBank 重复退一次，
   否则同一笔钱会「牌桌退一次 + tableBank 再退一次」凭空翻倍。
   所以这里退完后把 tableBank 直接归零，杜绝任何双退可能。 */
/* ★ 2026-10-05 风控：可兑现额度 cashable 必须跟着真实亏损往下走。
   以前 cashable 只在充值/发放时增加、输钱从不减少 → 玩家把本金输光又赢回来之后，
   赢来的盈利也能 100% 兑成 USDT 提走（真钱口子：A 提走的是 B 的本金）。
   现在每次结算/离场/买入都把 cashable 钳到「当前实际持有资产」之上。 */
function clampCashable(u, onTable) {
  if (!u) return;
  /* ★ 2026-10-05 USDT 化后已无「盈利不可兑现」闸门（账户 USDT 全部可提现），
     这里只把历史字段 cashable 同步成真实资产，避免后台/老前端显示错乱。 */
  const tot = U(Math.max(0, +u.bal || 0) + (+onTable || 0));
  u.cashable = Math.max(0, tot);
}

/* 取玩家真实座位（pl.seatIdx 可能因房间座位压缩而过期，按 uid 兜底校正） */
function seatOfPlayer(table, uid) {
  const pl = table.players[uid]; if (!pl) return null;
  const s = table.t.seats[pl.seatIdx];
  if (s && !s.empty && s.user && String(s.user.id) === String(uid)) return s;
  const real = findSeatByUid(table.t, uid);
  if (real) { pl.seatIdx = real.idx; return real; }
  return null;
}

function cashOut(table, uid, reason) {
  const pl = table.players[uid]; if (!pl) return 0;
  const t = table.t; const s = seatOfPlayer(table, uid) || t.seats[pl.seatIdx]; const seatIdx = s ? s.idx : pl.seatIdx;
  const me = D.DB && D.DB.users ? D.DB.users[uid] : null;
  /* ★ 2026-10-05 硬闸门：退回的「已投入」必须真的还躺在底池里。
     若本手已被结算（底池分光/抽水），座位上的 contrib 只是残留计数 ——
     再退一次就是凭空造钱（真钱 USDT 下任何 1 分的凭空增加都是事故）。 */
  const contribBack = s ? Math.min(Math.max(0, +s.contrib || 0), Math.max(0, +t.pot || 0)) : 0;
  /* ★ 2026-10-08 P0：这里曾用 Math.round 取整 —— 桌上余额 288.47 会被砍成 288，凭空吞掉玩家 0.47 USDT。
     全站唯一口径是 USDT 两位小数 U()，任何金额都不许再取整（反向也会凭空造钱）。 */
  let inPlay = s ? (Math.max(0, +s.usdt || 0) + contribBack) : 0; /* 未投入 + 仍在底池里的投入 */
  if (inPlay > 0) inPlay = U(inPlay);
  if (me && inPlay > 0) {
    me.bal = U((+me.bal || 0) + inPlay);
    me.tableCashed = Math.max(0, Math.min(U(+me.tablePaid || 0), U(U(+me.tableCashed || 0) + inPlay)));
  }
  if (me) me.tableBank = 0; /* ★ 已全额结清，不留残值给旧逻辑二次退款 */
  if (me) clampCashable(me, 0);
  if (s) {
    t.pot = Math.max(0, Math.round((+t.pot || 0) - contribBack));            /* 离场者已投入随其退出从底池移除 */
    /* ★ 同步把座位的 contrib 减掉：结算（showdown）是按 contrib 分边池的，
       只扣 pot 不清 contrib，赢家会按老 contrib 多分一份 —— 那笔钱等于被分了两次（凭空翻倍）。 */
    s.contrib = Math.max(0, Math.round((+s.contrib || 0) - contribBack));
  }
  /* 正轮到他 → 视为弃牌并推进 */
  if (table.phase === 'playing' && s && !s.folded && table.actingUid === uid) {
    P.doAction(t, seatIdx, 'fold'); afterAction(table, seatIdx);
  }
  delete table.players[uid];
  if (s) {
    s.user = null; s.empty = true; s.usdt = 0; s.hole = []; s.bet = 0; s.contrib = 0;
    s.folded = true; s.allin = false; s.acted = false; s.lastAct = ''; s.sittingOut = true;
  }
  /* 剩余不足以继续 → 结束本手（剩余玩家赢得所余底池）
     ★ bot 房：剩 1 个真人 + 一群 bot 照样继续打，只有真人都走光才收桌。 */
  const humanLeft = Object.keys(table.players).length;
  if (table.phase === 'playing') {
    const need = table.botFill ? 1 : 2;
    if (humanLeft < need || P.activeSeats(t).length < 2) onAdvance(table, P.advance(t));
  }
  if (humanLeft === 0) delete TABLES[table.no];   /* 真人都走了 → 收桌（bot 是做市筹码，直接丢弃） */
  if (D.saveDB) D.saveDB();
  saveTables();
  if (D.audit) D.audit('system', 'table-leave', uid, (reason || '离座') + '退回 ' + inPlay + ' 房间 ' + table.no, '-');
  return inPlay;
}

/* ---- 给房间侧（server.js）用的外部接口 ---- */
function releaseSeat(roomNo, uid) {                       /* 某人离开某房间 / 被驱逐 */
  const table = TABLES[String(roomNo)];
  if (!table || !table.players[String(uid)]) return 0;
  return cashOut(table, String(uid), '离场');
}
function releaseRoom(roomNo) {                            /* 房间解散：全员结算并删桌 */
  const table = TABLES[String(roomNo)];
  if (!table) return 0;
  let sum = 0;
  Object.keys(table.players).forEach(function (u) { sum += cashOut(table, u, '房间解散'); });
  if (TABLES[String(roomNo)]) delete TABLES[String(roomNo)];
  saveTables();
  return sum;
}
function hasLiveSeat(uid) {                               /* 该用户是否还在某张牌桌上有余额 */
  for (const no in TABLES) { if (TABLES[no] && TABLES[no].players && TABLES[no].players[String(uid)]) return true; }
  return false;
}
function releaseUserEverywhere(uid) {                     /* 孤儿兜底：从所有牌桌结算 */
  let sum = 0;
  Object.keys(TABLES).forEach(function (no) { sum += releaseSeat(no, uid); });
  return sum;
}


async function sitout(req, res, p, b) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = b && b.roomNo; const table = TABLES[no];
  if (!table) return send(res, 404, { code: 404, msg: '牌局未开始' });
  if (!table.players[me.id]) return send(res, 403, { code: 403, msg: '你尚未加入该房间牌局' });
  const seat = findSeatByUid(table.t, me.id);
  if (!seat) return send(res, 400, { code: 400, msg: '你还没有入座' });
  const wantOut = !(b && (b.on === false || b.on === 0 || b.on === '0' || b.sit === false));
  seat.sittingOut = !!wantOut;
  /* If standing up while to act: auto-fold so the hand is not stuck */
  if (wantOut && table.phase === 'playing' && String(table.actingUid) === String(me.id) && !seat.folded) {
    try {
      if (typeof P.doAction === 'function') P.doAction(table.t, seat.idx, 'fold', 0);
      else { seat.folded = true; seat.acted = true; seat.lastAct = '弃牌'; }
      table.actingUid = null;
    } catch (e) { seat.folded = true; seat.acted = true; seat.lastAct = '弃牌'; }
  }
  if (!wantOut && seat.usdt > 0) seat.sittingOut = false;
  saveTables();
  return send(res, 200, { ok: true, sittingOut: !!seat.sittingOut, state: serialize(table, me.id) });
}

async function leave(req, res, p, b) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = b && b.roomNo; const table = TABLES[no]; if (!table) return send(res, 404, { code: 404, msg: '牌局未开始' });
  if (!table.players[me.id]) return send(res, 403, { code: 403, msg: '你尚未加入该房间牌局' });
  const back = cashOut(table, me.id, '离座');
  return send(res, 200, { ok: true, refunded: back });
}

/* ---------- 牌桌内聊天（2026-10-05）----------
   存在内存里（CHATS），不落盘：牌局本身会落盘，但聊天只是本局娱乐，
   落盘会把 tables.json 撑大且重启后出现「昨天的聊天」。每桌最多留 80 条。 */
const CHATS = {};   /* roomNo -> [{uid,name,color,text,ts}] */
function chatList(no) { if (!CHATS[no]) CHATS[no] = []; return CHATS[no]; }
const CHAT_MAX = 80, CHAT_LEN = 120;

/* ---------- 牌桌互动道具（2026-10-05）----------
   点对手头像 → 选道具 → 扔过去。只做视觉/音效，**完全不涉及资金**。
   事件存内存 table.fx（不落盘），随 state 下发给全桌，前端按 id 去重播放。 */
const PROP_KEYS = ['bomb', 'egg', 'chicken', 'shoe', 'cake', 'tomato'];
const PROP_MAX = 12, PROP_CD = 3000;

function prop(req, res, p, b) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = b && b.roomNo; const table = TABLES[no];
  if (!table) return send(res, 404, { code: 404, msg: '牌局未开始' });
  if (!table.players[me.id]) return send(res, 403, { code: 403, msg: '你尚未加入该房间牌局' });
  const key = String((b && b.key) || '');
  if (PROP_KEYS.indexOf(key) < 0) return send(res, 400, { code: 400, msg: '道具不存在' });
  const seats = (table.t && table.t.seats) || [];
  const live = function (uid) {
    return seats.find(function (x) { return !x.empty && x.user && String(x.user.id) === String(uid); });
  };
  if (!live(me.id)) return send(res, 403, { code: 403, msg: '你还没有入座' });
  const toUid = String((b && b.toUid) || '');
  if (!toUid || toUid === 'undefined') return send(res, 400, { code: 400, msg: '缺少目标玩家' });
  if (String(toUid) === String(me.id)) return send(res, 400, { code: 400, msg: '不能扔给自己' });
  const toSeat = live(toUid);
  if (!toSeat) return send(res, 400, { code: 400, msg: '目标玩家不在座位上' });
  /* 冷却：同一人 3 秒一次，防止刷屏 */
  table.propAt = table.propAt || {};
  const now = Date.now();
  if (table.propAt[me.id] && now - table.propAt[me.id] < PROP_CD) {
    return send(res, 429, { code: 429, msg: '扔得太快了，歇一下' });
  }
  /* Optional diamond fee: only when CONFIG.econ.propCost[key] > 0 (default free entertainment). */
  var cost = 0;
  try {
    var cfg = (D.getConfig && D.getConfig()) || {};
    var pc = (cfg.econ && cfg.econ.propCost) || {};
    cost = Math.max(0, Math.round(+pc[key] || 0));
  } catch (e) { cost = 0; }
  if (cost > 0) {
    var u = D.DB && D.DB.users && D.DB.users[me.id];
    if (!u) return send(res, 401, { code: 401, msg: '未登录' });
    var diamonds = Math.max(0, Math.round(+u.diamonds || 0));
    if (diamonds < cost) return send(res, 402, { code: 402, msg: '钻石不足' });
    u.diamonds = diamonds - cost;
    try { if (D.saveDB) D.saveDB(); } catch (e2) {}
  }
  table.propAt[me.id] = now;
  if (!table.fx) table.fx = [];
  table.fx.push({
    id: now + '_' + String(me.id) + '_' + Math.random().toString(36).slice(2, 6),
    from: String(me.id), to: toUid, key: key, ts: now, cost: cost
  });
  while (table.fx.length > PROP_MAX) table.fx.shift();
  return send(res, 200, { ok: true, cost: cost });
}

/* 拉取牌桌聊天（2026-10-05 补：原先只有 POST，别人发的消息收不到） */
function chatGet(req, res, p, q) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = q && q.roomNo;
  if (!no) return send(res, 400, { code: 400, msg: '缺少房间号' });
  if (!TABLES[no]) return send(res, 200, { ok: true, chat: [] });
  return send(res, 200, { ok: true, chat: chatList(no).slice(-40) });
}

function chat(req, res, p, b) {
  const me = getMe(req); if (!me) return send(res, 401, { code: 401, msg: '未登录' });
  const no = b && b.roomNo; const table = TABLES[no];
  if (!table) return send(res, 404, { code: 404, msg: '牌局未开始' });
  if (!table.players[me.id]) return send(res, 403, { code: 403, msg: '你尚未加入该房间牌局' });
  const text = String((b && b.text) || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, CHAT_LEN);
  if (!text) return send(res, 400, { code: 400, msg: '消息不能为空' });
  const arr = chatList(no);
  arr.push({ uid: me.id, name: me.name, color: me.color || '#3b8cff', text: text, ts: Date.now() });
  while (arr.length > CHAT_MAX) arr.shift();
  return send(res, 200, { ok: true, chat: arr.slice(-40) });
}

async function router(req, res, p, b) {
  const q = parseQuery(req.url);
  const m = req.method;
  /* ★ 心跳：任何牌桌请求都表示「这房间里还有人在玩」→ 刷新房间活动时间，避免被判闲置 */
  try {
    const hno = (b && (b.roomNo || b.no)) || (q && (q.roomNo || q.no));
    if (hno && D.touchRoom) D.touchRoom(hno);
  } catch (e) { }
  if (p === '/papi/table/join' && m === 'POST') return await join(req, res, p, b);
  /* 桌内再买入：与 join 加码分支同一套逻辑（已入座则追加筹码，不必离桌） */
  if (p === '/papi/table/rebuy' && m === 'POST') return await join(req, res, p, b);
  if (p === '/papi/table/state' && m === 'GET') return await state(req, res, p, q);
  if (p === '/papi/table/action' && m === 'POST') return await action(req, res, p, b);
  if (p === '/papi/table/leave' && m === 'POST') return await leave(req, res, p, b);
  if (p === '/papi/table/chat' && m === 'POST') return chat(req, res, p, b);
  if (p === '/papi/table/chat' && m === 'GET') return chatGet(req, res, p, q);
  if (p === '/papi/table/prop' && m === 'POST') return prop(req, res, p, b);
  if (p === '/papi/table/sitout' && m === 'POST') return await sitout(req, res, p, b);
  return send(res, 404, { code: 404, msg: 'not found' });
}

/* 后台只读总览：客服用来排查「玩家钱卡在桌上」/牌局卡死 */
function adminList() {
  const out = [];
  for (const no in TABLES) {
    const tb = TABLES[no]; if (!tb || !tb.t) continue;
    const t = tb.t;
    out.push({
      no: no, phase: tb.phase, modeKey: t.modeKey, sb: t.sb, bb: t.bb, cap: t.cap,
      botFill: !!tb.botFill, botNet: Math.round(+tb.botNet || 0),   /* bot 净盈亏：负=平台垫付给真人 */
      handNo: t.handNo, pot: t.pot, rakeTotal: t.rakeTotal || 0,
      housePlan: t.housePlan || null,   /* 控水：本手发牌计划（仅后台可见，玩家协议里没有这个字段） */
      actingUid: tb.actingUid, deadline: tb.deadline, graceUntil: tb.graceUntil,
      startedAt: tb.startedAt || 0,
      seats: (t.seats || []).map(function (s) {
        if (s.empty) return null;
        return {
          idx: s.idx, uid: s.user && s.user.id, name: s.user && s.user.name,
          isBot: !!(s.user && s.user.isBot),
          usdt: s.usdt, bet: s.bet, contrib: s.contrib, folded: s.folded, allin: s.allin, sittingOut: s.sittingOut
        };
      })
    });
  }
  return out;
}

module.exports = {
  init: init, router: router, adminList: adminList,
  releaseSeat: releaseSeat, releaseRoom: releaseRoom,
  hasLiveSeat: hasLiveSeat, releaseUserEverywhere: releaseUserEverywhere,
  botPnl: function () { return BOTPNL; },
  /* 每日经营账：{ 'YYYY-MM-DD': { hands, rake, botNet, botHands, adjust } } */
  dailyStats: function () { return DAILY.days; },
  recordDailyAdjust: recordDailyAdjust,
  /* 控水实时统计：后台「AI 与控水」面板据此显示「实际达成的 bot 胜率 / 净盈亏」 */
  houseStat: function () { try { return { cfg: P.houseCfg(), stat: P.houseStat() }; } catch (e) { return null; } },
  _tables: function () { return TABLES; }, _reset: function () { TABLES = {}; }
};




