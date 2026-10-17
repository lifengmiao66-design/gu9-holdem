'use strict';
/* ================================================================
   GU9 UI API —— 德州扑克前端的真实后端
   · 玩家：注册 / 登录 / 会话 / 余额同步（scrypt 加盐哈希）
   · 管理员：独立账号 + 服务端会话 + 失败锁 IP（口令走环境变量，不在前端）
   · 后台 API：用户管理（搜索/封禁/改余额VIP/重置密码）、配置读写、统计、审计日志
   · 零第三方依赖，数据用 JSON 原子写（tmp + rename）
   ★ 只做合规能力：不做任何服务端发牌操控 / 控水
   ================================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
/* GU9_DATA_DIR 仅供测试用：把数据目录指到临时目录，跑出干净结果；线上不设该变量 */
const DATA = process.env.GU9_DATA_DIR ? path.resolve(process.env.GU9_DATA_DIR) : path.join(ROOT, 'data');
const WEB = path.join(ROOT, 'admin-web');
const PORT = +(process.env.PORT || 3010);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_USER = (process.env.GU9_ADMIN_USER || 'admin');
const ADMIN_PASS = process.env.GU9_ADMIN_PASS || '';
const SESSION_TTL = +(process.env.SESSION_TTL || 12 * 3600 * 1000);   /* 玩家 12h */
const ADMIN_TTL = 7 * 86400 * 1000;                                   /* 管理员 7 天（配滑动续期，常用免登录） */
const LOCK_FAILS = 10, LOCK_WINDOW = 15 * 60 * 1000, LOCK_TIME = 5 * 60 * 1000;

if (!ADMIN_PASS) { console.error('[fatal] 必须设置环境变量 GU9_ADMIN_PASS（后台口令）'); process.exit(1); }
let ADMIN_HASH = null;   /* 启动时由 GU9_ADMIN_PASS 派生，明文口令不落盘 */
try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { }

/* ---------------- 存储 ---------------- */
function fpath(n) { return path.join(DATA, n); }
function readJson(n, def) {
  try { return JSON.parse(fs.readFileSync(fpath(n), 'utf8')); } catch (e) { return def; }
}
let writeQueue = Promise.resolve();
function writeJson(n, obj) {
  const tmp = fpath(n + '.tmp.' + process.pid);
  writeQueue = writeQueue.then(() => new Promise(res => {
    fs.writeFile(tmp, JSON.stringify(obj), err => {
      if (err) { console.error('[write]', n, err.message); return res(); }
      fs.rename(tmp, fpath(n), err2 => { if (err2) console.error('[rename]', n, err2.message); res(); });
    });
  }));
  return writeQueue;
}
function appendLine(n, obj) {
  const line = JSON.stringify(obj) + '\n';
  writeQueue = writeQueue.then(() => new Promise(res => {
    fs.appendFile(fpath(n), line, err => { if (err) console.error('[append]', n, err.message); res(); });
  }));
  return writeQueue;
}

/* ---------------- 密码 / 令牌 ---------------- */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return salt + ':' + h;
}
function verifyPw(pw, stored) {
  if (!stored || typeof stored !== 'string' || stored.indexOf(':') < 0) return false;
  const parts = stored.split(':');
  const salt = parts[0], want = parts[1];
  let got;
  try { got = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, SCRYPT).toString('hex'); } catch (e) { return false; }
  const a = Buffer.from(want, 'hex'), b = Buffer.from(got, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function newId() { return crypto.randomBytes(6).toString('hex'); }

/* ---------------- 支付 / 风控默认参数（客户文档《GU9_Poker_正式项目结构_5%》口径） ----------------
   ★ provider 恒为 'none'：本服务不生成收款地址、不查链上到账、不发起出款。
     适配器接入由持牌运营方工程师实现 payCreate() / payPayout()。 */
const PAY_DEFAULT = {
  provider: 'none',
  enabled: true,             /* 订单系统开关；与资金通道无关，开着也收不到钱 */
  feeRate: 0,                /* 不再按比例收费（保留字段以兼容后台/老配置） */
  feeFlat: 2,                /* ★ 提现单笔固定手续费 2 USDT（用户口径：兑换免费，提现收 2 USDT/笔） */
  minAge: 18,
  asset: 'USDT',
  /* ★ 2026-10-03（用户决定）：充值 / 提现只保留 TRC20 一条链，ERC20 / BEP20 下线。
     2026-10-08（用户要求）：恢复以太坊(ERC20)并新增 Solana(SOL) 两条链作为收款通道，
     与后台「参数配置」保存的 pay.nets 互为唯一开关。这里改的是兜底默认值 ——
     后台「参数配置」保存一次通常会走 PAY_DEFAULT，不改这里的话，下次保存配置又会被重置回来。 */
  nets: ['TRC20', 'ERC20', 'SOL'],
  kycRequired: true,
  limits: { perTxMin: 10, perTxMax: 10000, day: 50000, month: 500000 },   /* 单位 USDT —— ★ 只约束「充值」；提现不限额度 */
  geo: { allow: ['SG', 'MY', 'TH', 'PH'], block: ['CN', 'US', 'FR'] },
  env: 'Sandbox'
};

/* ---------------- 任务 / 签到奖励（后台可配） ----------------
   ★ 2026-10-02：这些数值原来写死在前端（core.js 的 S.tasks 默认档 / misc.js 的「20000 * (i+1)」），
     现在统一由服务端 CONFIG.tasks 下发，前端只读。
   ★ 只改「送多少」，不引入任何新的发奖通道 —— 领奖仍然走前端已有的那条路径。 */
/* ★ 2026-10-03（用户要求）：任务只保留「每日签到」，其余 8 条任务全部下线（rewards 为空）。
   签到档位改成「第 N 天送 N 筹码」：1/2/3/4/5/6/7，一周累计 28 筹码。 */
const TASKS_DEFAULT = {
  signin: [1, 2, 3, 4, 5, 6, 7],   /* 7 日签到：第 1 天 1 筹码 … 第 7 天 7 筹码 */
  signinTotal: 28,                 /* 「连续签到领取累计 X 筹码」里的 X（= 1+2+…+7） */
  rewards: {}                      /* ★ 空 = 没有任务奖励，/papi/tasks/claim 一律拒绝 */
};
const TASK_KEYS = Object.keys(TASKS_DEFAULT.rewards);
/* 归一化：只认 signin / signinTotal / rewards 三个字段，一律转成非负整数。
   磁盘 config.json 里被手工塞进来的脏值不会流到前端。 */
function tasksPublic() {
  const t = (CONFIG.tasks && typeof CONFIG.tasks === 'object') ? CONFIG.tasks : {};
  const out = { signin: [], signinTotal: 0, rewards: {} };
  out.signin = (Array.isArray(t.signin) && t.signin.length ? t.signin : TASKS_DEFAULT.signin)
    .slice(0, 14).map(function (v) { const n = Math.round(+v); return (isFinite(n) && n >= 0) ? n : 0; });
  const tn = Math.round(+t.signinTotal);
  out.signinTotal = (isFinite(tn) && tn >= 0) ? tn : TASKS_DEFAULT.signinTotal;
  /* ★ 2026-10-03：只认 TASK_KEYS（当前是空表）里的任务，磁盘 config.json 里残留的旧任务
     奖励一律不下发 —— 否则「任务已下线」只是界面上不显示，接口仍在发钱。 */
  const src = (t.rewards && typeof t.rewards === 'object') ? t.rewards : {};
  TASK_KEYS.forEach(function (k) {
    const n = Math.round(+src[k]);
    out.rewards[k] = (isFinite(n) && n >= 0) ? n : (TASKS_DEFAULT.rewards[k] || 0);
  });
  return out;
}

/* ---------------- 数据 ---------------- */
let DB = readJson('users.json', null) || { seq: 100000, users: {} };
let CONFIG = Object.assign({
  think: { min: 3000, max: 11000 },
  ai: {
    iters: 260, vbetEq: 0.55, vbetStep: 0.04, semiBluff: 0.32, steal: 0.12,
    raiseEq: 0.70, raiseStep: 0.04, semiRaiseEq: 0.56, semiRaiseFreq: 0.32,
    reqBase: 0.03, reqOpp: 0.01, reqFacingRaise: 0, bigBetPenalty: 0, riverPenalty: 0,
    airFold: 0.18, drawCall: 0.25, allinCallEq: 0.66, adapt: 0
  },
  /* ★ 2026-10-03：VIP5 起才有返水 1/2/3/4%；邀请好友奖励默认 10 筹码 / 人，单日上限 20 人（防刷） */
  econ: { chipPerUsdt: 100, rakePct: 0.05, rakeCapBB: 3, rebate: [0, 0, 0, 0, 0, 1, 2, 3, 4], inviteReward: 10, inviteDayCap: 20 },
  lobby: { quick: { quick: true, room: true, mtt: true }, banners: { b1: true, b2: true, b3: true } },
  modes: {},
  maintenance: { on: false, msg: '系统维护中，请稍后再来' },
  /* ★ 2026-10-03：APP 品牌。name = 大厅顶栏/登录页展示的应用名；
     logo = 后台上传的主 Logo 图片地址（'/assets/brand/logo-xxx.png'），空 = 前端用内置默认图。 */
  app: { name: 'GU9', logo: '' },
  /* ★ 2026-10-04：机器人总开关。on=true 时公共牌桌照常安排机器人陪坐；
     on=false 时前端不安排任何机器人（公共桌变为等待真人的空桌），控水也随之强制关闭。 */
  bots: { on: true },
  tasks: TASKS_DEFAULT,      /* ★ 任务 / 签到奖励，后台可配 */
  meContent: {
    walletSub: 'USDT 余额',
    transferSub: '向好友转账 / 记录',
    mailSub: '0 封未读',
    tasksSub: '每日 / 成长任务',
    friendsSub: '好友与申请',
    statsSub: '手数 · 赢池',
    achievementsSub: '说明向 · 待接通',
    guideSub: '11 种主流玩法规则',
    rakeSub: '抽水上限与 VIP 返水',
    inviteSub: '每邀请 1 人得 1.00 USDT',
    settingsSub: '密码 · 语言 · 通知',
    guideBody: '德州扑克、短牌、奥马哈等主流玩法规则说明。可在后台 Me内容 中编辑。',
    rakeBody: '默认抽水 5%，单手上限 3BB；VIP 可获得返水。可在后台 Me内容 / 经济设置中调整。',
    achievementsBody: '成就引擎尚未接通。完成牌局与任务后将在此解锁徽章（当前为说明向半成品）。',
    transferBody: '向好友转账 USDT，记录可在资金明细查看。',
    mailBody: '系统公告与站内信。',
    tasksBody: '每日签到与成长任务。',
    friendsBody: '好友列表、申请与私信。',
    statsBody: '手数、赢池、VPIP 等数据统计。'
  },
  pay: PAY_DEFAULT
}, readJson('config.json', {}));

/* ---------------- 充值 / 提现：业务骨架齐全，资金通道留空 ----------------
   有：订单六态状态机、后台人工审批、限额与风控、KYC / 地理闸门、审计留痕。
   没有（也不在此实现）：生成收款地址、派生或托管钱包、查询链上到账、发起出款打款。
   ★ payCreate() 是支付适配器接口，恒返回 provider:'none' + address:null ——
     没有地址，玩家无从转账，充值订单就永远停在 pending。这是刻意的，不是没做完。
     接入方式：持牌运营方拿到 PSP / 托管钱包的 merchant key 后，由其工程师实现该函数。 */

/* ---------------- 订单（六态） ----------------
   pending ──审核通过──▶ approved ──确认到账 / 出款完成──▶ completed
      ├─冻结─▶ frozen ──放行──▶ approved
      └─驳回─▶ rejected ──(提现)退回筹码──▶ refunded            */
let ORDERS = readJson('orders.json', null) || { seq: 1000, list: [] };
if (!Array.isArray(ORDERS.list)) ORDERS = { seq: 1000, list: [] };
const ORDER_STATES = ['pending', 'frozen', 'approved', 'rejected', 'refunded', 'completed'];

function saveDB() { return writeJson('users.json', DB); }
function saveConfig() { return writeJson('config.json', CONFIG); }
function saveOrders() { return writeJson('orders.json', ORDERS); }

/* ---- 会话持久化（2026-10-05）：token 落盘，服务重启 / 崩溃后玩家不掉线 ---- */
function saveSessions() {
  try {
    var o = {}, now = Date.now();
    sessions.forEach(function (s, t) { if (s && s.exp > now) o[t] = s; });
    return writeJson('sessions.json', o);
  } catch (e) { console.error('[sessions] save failed', e.message); }
}
function loadSessions() {
  try {
    var o = readJson('sessions.json', null), n = 0, now = Date.now();
    if (!o || typeof o !== 'object') return 0;
    for (var t in o) {
      var s = o[t];
      if (s && s.uid && s.exp > now) { sessions.set(t, s); n++; }
    }
    console.log('[sessions] 已恢复 ' + n + ' 个登录会话');
    return n;
  } catch (e) { console.error('[sessions] load failed', e.message); return 0; }
}

/* ---------------- 房间：真实房间 + 邀请必须同意（2026-10-02） ----------------
   ★ 以前「邀请好友建房」是纯本地把戏：前端把好友对象直接塞进座位（js/table.js 的
     invited[k] → seatPlayer），好友毫不知情、也永远拿不到房间号。
     现在房间与邀请一律落服务端：
       · 房间号由服务端生成（6 位数字），凭号可加入；
       · 邀请必须经对方 accept 才可能入座 —— pending / declined / 无邀请一律拒绝进私有房；
       · 房间成员名单是服务端真实数据，不是本地捏的。
   ★ 仍然没有的：服务端发牌 / 实时同步（那需要 WebSocket + 服务端牌局权威）。
     牌局依旧跑在客户端本地，没跟你开同一局的好友由本地 AI 代打，UI 会明确标注。 */
let ROOMS = readJson('rooms.json', null) || { seq: 0, rooms: {} };
function saveRooms() { return writeJson('rooms.json', ROOMS); }
const ROOM_KEEP = 24 * 3600 * 1000;        /* 24 小时无活动 → 自动清理 */
/* ★★ 闲置房间自动解散（2026-10-05 产品规则）---------------------------------
   ① 机器人房(botFill) 里没有真人 → 3 分钟关（否则 bot 互打会无限堆房间）；
   ② 真人自建房 / 好友房 15 分钟没人玩 → 关；
   ③ 关之前一定先 pokerTable.releaseRoom()，桌上余额全额结回账户，绝不吞钱。 */
const ROOM_IDLE_CLOSE = 15 * 60 * 1000;
const ROOM_BOT_IDLE_CLOSE = 3 * 60 * 1000;
const MAX_BOT_ROOMS = 8;                    /* 大厅里机器人房最多 8 间，多了按最旧且没真人的先关 */
const ROOM_INVITE_TTL = 6 * 3600 * 1000;   /* 邀请 6 小时未处理 → 视为过期 */
/* ★ 与前端 js/game.js 的 MODES 表一一对应 —— 以前这里只列了 6 个，选奥马哈/短牌/菠萝/单挑/极速
   建房会被静默降级成德州扑克（玩家在大厅选了玩法，进桌发现规则变了）。
   cap / hole / bet 用于服务端侧校验建房参数（防止前端提交一手天马行空的座位与限注）。 */
const ROOM_MODES = ['nlh', 'plo', 'plo5', 'plo6', 'omaha8', 'short', 'aof', 'rush', 'pineapple', 'sng', 'mtt', 'spin'];
const MODE_META = {
  nlh: { cap: 8, hole: 2, bet: 'nolimit' }, plo: { cap: 8, hole: 4, bet: 'potlimit' },
  plo5: { cap: 8, hole: 5, bet: 'potlimit' }, plo6: { cap: 8, hole: 6, bet: 'potlimit' },
  omaha8: { cap: 8, hole: 4, bet: 'potlimit' }, short: { cap: 8, hole: 2, bet: 'nolimit' },
  aof: { cap: 6, hole: 2, bet: 'aof' }, rush: { cap: 6, hole: 2, bet: 'nolimit' },
pineapple: { cap: 8, hole: 3, bet: 'nolimit' },
  sng: { cap: 8, hole: 2, bet: 'nolimit' }, mtt: { cap: 8, hole: 2, bet: 'nolimit' },
  spin: { cap: 3, hole: 2, bet: 'nolimit' }
};
/* ★★ 一个账号同一时刻只能在一个房间（2026-10-02 修）
   以前 create / join / 接受邀请 都不查这个，同一张账号可以同时挂在 A、B 两个房间的座位上 ——
   两边的座位表、邀请、牌桌各算各的，玩家自己都搞不清人在哪一局，
   实测反馈就是「我一个账号怎么会在两个房间里」。
   规则：进新房间之前，先把该账号在**其它**房间的座位清掉。
   ★ 口径跟 `/papi/rooms/leave` 完全一致：人走了 → **房主转让给剩下的人**，一间都不剩了才解散。
   （第一版写成「房主一走就直接 delete 整间房」，太狠：A 自己开了房又去 join 好友的房，
    自己那间就被端了，还在里面打牌的好友莫名其妙失去房间。） */
function evictFromOtherRooms(room, uid) {
  const dropped = [];
  for (const k in ROOMS.rooms) {
    const r = ROOMS.rooms[k];
    if (!r || (room && r.id === room.id)) continue;
    if (!(r.seats || []).some(x => String(x.uid) === String(uid))) continue;
    r.seats = (r.seats || []).filter(x => String(x.uid) !== String(uid));
    /* 2026-10-04 P0：同账号只能在一个房间 —— 被踢出旧房间时，旧桌上的钱必须结回账户 */
    try { pokerTable.releaseSeat(r.no, uid); } catch (e) {}
    r.invites = (r.invites || []).filter(x => String(x.uid) !== String(uid));
    if (r.owner === uid && r.seats.length) r.owner = r.seats[0].uid;
    r.actAt = Date.now();   /* ★ 不能用 handler 里的 `now` —— 那是各 handler 的局部变量，这里取不到（500） */
    if (!r.seats.length) { try { pokerTable.releaseRoom(r.no); } catch (e) {} delete ROOMS.rooms[k]; }
    dropped.push({ id: r.id, no: r.no, gone: !ROOMS.rooms[k] });
  }
  return dropped;
}
async function evictAndSave(room, uid) {
  const drop = evictFromOtherRooms(room, uid);
  if (drop.length) await saveRooms();
  reapOrphanTableBank();   /* ★ 离座/驱逐后，回收可能留下的孤儿桌上筹码 */
  return drop;
}
/* ★ 孤儿筹码回收：账号不在任何房间座位、但桌上却有钱(tableBank>0)时，
   把桌上钱退回钱包 chips（仅本金段，符合风控：tableBank 永远 ≤ tablePaid−tableCashed）。
   防止「离座 / 房间解散时忘退钱」导致玩家筹码卡死、后台显示为 0。 */
function reapOrphanTableBank() {
  try {
    const seated = {};
    for (const k in ROOMS.rooms) {
      const r = ROOMS.rooms[k];
      if (!r || !r.seats) continue;
      for (const s of r.seats) { if (s && s.uid) seated[String(s.uid)] = true; }
    }
    let changed = false;
    for (const uid in DB.users) {
      const u = DB.users[uid];
      /* 牌桌上究竟还有没有这笔钱：不再用「是否坐在房间」当挡箭牌，否则牌桌数据丢失时钱永久卡死 */
      if (!u) continue;
      /* 2026-10-04 P0：真人对战牌桌的权威余额在 pokertable，先让它结算；
         绝不能再按 tableBank 退第二次（同一笔钱会被退两遍、凭空翻倍）。 */
      /* 牌桌上有余额 = 正在正常游戏中，必须原样不动。
         ★ 2026-10-05 P0 修复：这里曾经直接 releaseUserEverywhere 把人结算掉，
           结果任何人点一次「离座」，全服牌桌上的玩家都会被强制踢出结算、牌局当场崩掉。 */
      if (pokerTable.hasLiveSeat(uid)) continue;
      /* ★ 双重保险：退款额封顶为「服务端记录的买入本金 − 已取回」，
         即使磁盘上存在历史脏数据，也不会被当成真钱退给用户。 */
      /* ★ 2026-10-08 P0：tableBank/tablePaid/tableCashed 也可能是两位小数，Math.round 会吞掉分位 */
      const tb = U(Math.max(0, Math.min(U(+u.tableBank || 0),
        Math.max(0, U(+u.tablePaid || 0) - U(+u.tableCashed || 0)))));
      if (tb > 0) {
        /* ★ 2026-10-08 P0：原 Math.round(+u.bal) 会把 1088.47 砍成 1088 —— 直接抹掉玩家余额小数 */
        u.bal = U((+u.bal || 0) + tb);
        u.tableCashed = U(Math.max(0, U(+u.tableCashed || 0) + tb));
        u.tableBank = 0;
        changed = true;
      }
    }
    if (changed) saveDB();
    return changed;
  } catch (e) { return false; }
}
function newRoomNo() {
  for (let i = 0; i < 60; i++) {
    const n = String(100000 + Math.floor(Math.random() * 900000));
    let dup = false;
    for (const k in ROOMS.rooms) { if (ROOMS.rooms[k] && ROOMS.rooms[k].no === n) { dup = true; break; } }
    if (!dup) return n;
  }
  return String(Date.now()).slice(-6);
}
/* 对外投影：只给公开信息（与好友接口同一套口径，绝不含余额） */
function roomPublic(r, meId) {
  const seats = (r.seats || []).map(function (s) {
    const u = DB.users[s.uid];
    return {
      uid: s.uid, name: (u && u.name) || s.name || '玩家', color: (u && u.color) || '#3b8cff',
      level: (u ? levelOfUser(u) : 0), vip: (u && u.vip) || 0, joinedAt: s.joinedAt || 0,
      /* ★ 2026-10-03：头像跟着人走 —— 同房间好友桌上显示的就是他真实设置的头像 */
      avatar: (u && typeof u.avatar === 'string') ? u.avatar : '',
      online: !!(u && Date.now() - (u.lastLogin || 0) < 5 * 60 * 1000),
      isOwner: s.uid === r.owner
    };
  });
  const inv = (r.invites || []).filter(function (x) { return x.uid === meId; })[0];
  return {
    id: r.id, no: r.no, name: r.name, modeKey: r.modeKey, sb: r.sb, bb: r.bb, cap: r.cap,
    ante: r.ante || 0, straddle: !!r.straddle, priv: r.priv, hasPwd: !!r.passwd,
    /* botFill = 机器人房（服务端安排 bot 陪打）。好友房永远是 false —— bot 绝不进真人的房。 */
    botFill: !!r.botFill,
    owner: r.owner, ownerName: (DB.users[r.owner] && DB.users[r.owner].name) || '',
    createdAt: r.createdAt, actAt: r.actAt || r.createdAt, seats: seats,
    /* 「我」在这个房间的视角：在不在里面、是不是房主、邀请处于什么状态 */
    mine: {
      inRoom: (r.seats || []).some(function (s) { return s.uid === meId; }),
      isOwner: r.owner === meId,
      invite: inv ? inv.status : null,          /* pending / accepted / declined / null */
      inviteTs: inv ? inv.ts : 0
    }
  };
}
/* payCfg()：磁盘配置可能与默认结构不同（老版本 config.json 里 pay 是 {usdtTrc20,…}），
   因此这里做「白名单归一化」—— 只认 PAY_KEYS 里的字段，其余键（尤其是任何地址类字段）
   一律丢弃。这样即便有人在 config.json 里塞了 usdtTrc20 / provider:'xxx'，
   也不会流到任何接口响应里。 */
const PAY_KEYS = ['provider', 'enabled', 'feeRate', 'feeFlat', 'minAge', 'asset', 'nets', 'kycRequired', 'limits', 'geo', 'env'];
const PAY_LIMIT_KEYS = ['perTxMin', 'perTxMax', 'day', 'month'];
const PAY_GEO_KEYS = ['allow', 'block'];
function pickKeys(src, keys) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  keys.forEach(function (k) { if (src[k] !== undefined) out[k] = src[k]; });
  return out;
}
function payCfg() {
  const src = (CONFIG.pay && typeof CONFIG.pay === 'object') ? CONFIG.pay : {};
  const cfg = Object.assign({}, PAY_DEFAULT);
  PAY_KEYS.forEach(function (k) { if (src[k] !== undefined) cfg[k] = src[k]; });
  cfg.limits = Object.assign({}, PAY_DEFAULT.limits, pickKeys(src.limits, PAY_LIMIT_KEYS));
  cfg.geo = Object.assign({}, PAY_DEFAULT.geo, pickKeys(src.geo, PAY_GEO_KEYS));
  cfg.nets = Array.isArray(src.nets) && src.nets.length ? src.nets.slice() : PAY_DEFAULT.nets.slice();
  cfg.provider = 'none';                 /* ★ 硬闸门：无论如何都不允许出现真实 provider */
  return cfg;
}
/* ★【充值】可用网络。
   2026-10-02 曾做成「白名单 ∪ 地址簿里有地址的网络」，让后台加地址即刻生效；
   2026-10-03 用户决定只保留 TRC20 一条链后，那个自动放宽就成了隐患 ——
   万一后台加了别的链的地址，那条链会悄悄复活。所以改回【严格等于 pay.nets 白名单】：
   pay.nets 是唯一开关，只有它点了头才能充值。 */
function depositNets(cfg) {
  return (cfg.nets || []).map(function (n) { return String(n).toUpperCase(); });
}
/* 后台提交的 pay 补丁：白名单合并，写完的结果本身就是归一化的，落盘不会带进任何多余键 */
function payMerge(cur, src) {
  const out = Object.assign({}, cur);
  PAY_KEYS.forEach(function (k) {
    if (!src || src[k] === undefined) return;
    if (k === 'provider') return;                            /* 见下方硬闸门，忽略外部值 */
    if (k === 'limits') { out.limits = Object.assign({}, cur.limits, pickKeys(src.limits, PAY_LIMIT_KEYS)); return; }
    if (k === 'geo') { out.geo = Object.assign({}, cur.geo, pickKeys(src.geo, PAY_GEO_KEYS)); return; }
    if (k === 'nets') {
      if (Array.isArray(src.nets) && src.nets.length) {
        out.nets = src.nets.map(function (n) { return String(n).toUpperCase(); })
          .filter(function (n) { return /^[A-Z0-9]{2,10}$/.test(n); }).slice(0, 8);
      }
      return;
    }
    out[k] = src[k];
  });
  out.provider = 'none';                                     /* ★ 硬闸门 */
  return out;
}
/* 下发给前端的只读子集：不含地址、密钥、适配器凭据 —— 这些字段本来就不存在 */
function payPublic(cfg) {
  const c = cfg || payCfg();
  const nets = depositNets(c);
  /* ★ 2026-10-03：链上收款是否就绪 = 有启用的收款地址且网络在充值白名单里。
     玩家端「支付通道」卡片据此显示，别再拿 PSP 适配器的 provider:'none' 吓人 ——
     实际充值走的是链上地址簿（chain.assign），跟 PSP 适配器是两条线。 */
  let chainReady = false;
  try {
    const list = extraApi.chain ? extraApi.chain.addrList() : [];
    chainReady = nets.length > 0 && list.some(function (a) {
      return a.enabled !== false && nets.indexOf(String(a.net).toUpperCase()) >= 0;
    });
  } catch (e) { chainReady = false; }
  return {
    provider: chainReady ? 'usdt-chain' : (c.provider || 'none'),
    chainReady: chainReady, enabled: c.enabled !== false,
    feeRate: c.feeRate, feeFlat: c.feeFlat, minAge: c.minAge, asset: c.asset,
    nets: c.nets || [], kycRequired: c.kycRequired !== false,
    /* ★ 【充值】可用网络。2026-10-03 起严格等于 pay.nets —— 后台 nets 是唯一开关，
       加了别的链的地址也不会自动开通。前端渲染充值网络选项时请用这个字段。 */
    depositNets: depositNets(c),
    limits: c.limits, geoBlocked: (c.geo && c.geo.block) || [], env: c.env
  };
}
/* 后台读配置：pay 段用归一化后的对象，磁盘上遗留的旧结构不会漏到前端 */
function cfgForAdmin() {
  return Object.assign({}, CONFIG, { pay: payCfg() });
}
function audit(admin, action, target, detail, ip, role) {
  /* ★ role 分流（2026-10-02）：以前 admin 字段被写成“操作对象的昵称”，
     后台日志里「谁干的」一栏会出现玩家名（实测 "admin":"king" 其实是玩家自己在兑换），
     导致管理员操作与玩家行为混在一条流里，事后完全没法追责。 */
  return appendLine('audit.log', {
    ts: Date.now(), admin: admin, role: role || 'user',
    action: action, target: target || '', detail: detail || '', ip: ip || ''
  });
}

/* ---------------- 扩展模块（房间管理 / 转账 / 邮件 / 工单 / 牌局 / 后台新页面） ----------------
   单独拆到 extra.js，主文件保持可读；通过 ctx 把读写能力与存储句柄注入，避免循环依赖。
   ★ init 必须在 sessions / mkSession 等声明之后再跑（见文件末尾的 extraApi.init 调用），
     否则会撞上 const 的暂时性死区（TDZ）。 */
const extraApi = require('./extra.js');
const pokerTable = require('./pokertable.js'); /* 2026-10-04 服务端权威牌局（真人对战 P2P） */
const clubsMod = require('./clubs.js');

/* ---------------- 支付适配器（空实现 = 只装了插座，没接电线） ---------------- */
function payCreate(order) {
  const cfg = payCfg();
  if (cfg.provider && cfg.provider !== 'none') {
    /* TODO(持牌运营方工程师)：在此接入 PSP / 托管钱包 SDK，由对方下发收款地址与回调签名。
       本仓库不提供、也不建议在此硬编码任何私钥、助记词或资金地址。 */
  }
  return {
    provider: cfg.provider || 'none',
    address: null,      /* ★ 恒为 null —— 没有地址，玩家无从转账，订单永远停在 pending */
    memo: null, qr: null,
    note: cfg.provider === 'none'
      ? '收款地址暂未配置：运营方在后台「USDT 收款」页添加地址后即可正常充值，如有疑问请联系客服。'
      : '适配器已接入，地址由 provider 下发。'
  };
}
function payPayout(order) {
  /* 出款说明：审核通过后由运营侧完成链上打款并回填 TXID；玩家端口径见 wallet.js「链上自动出款」 */
  return {
    provider: payCfg().provider || 'none', txid: null,
    note: '风控审核通过后自动链上出款（TRC20），到账后可在「我的订单」查看交易哈希；如有疑问请联系客服。'
  };
}


function U(v) { return Math.round((+v || 0) * 100) / 100; }   /* ★ 2026-10-06：全站唯一金额单位 = USDT（两位小数），不再有「分」 */
/* ---------------- 订单：六态状态机 ---------------- */
const OSTATES = {
  pending: '待审核', frozen: '已冻结', approved: '已通过',
  rejected: '已驳回', refunded: '已退回', completed: '已完成'
};
function orderPublic(o) {
  const kind = (o.type === 'recharge' || o.type === 'withdraw') ? o.type : '';
  return {
    id: o.id, uid: o.uid, user: o.user, type: o.type, net: o.net,
    usdt: o.usdt, chips: o.chips, fee: o.fee || 0,
    /* 实际到账（提现 = 申请额 − 固定手续费；充值无手续费 = 申请额）。缺省时回退成 usdt，
       老订单（没写 netAmount 的）也能正常显示。★ 别用 `net`：那个字段是链上网络名。 */
    amount: (o.netAmount !== undefined && o.netAmount !== null) ? o.netAmount : o.usdt,
    address: o.address || null, txid: o.txid || '',
    status: o.status, statusText: OSTATES[o.status] || o.status,
    /* 旧版本（VIP 订阅 / 赛事门票）遗留的订单：不是充值也不是提现，单独标出来，
       免得在「我的订单」和后台订单表里被错当成新的资金单 */
    legacy: !kind, kind: kind,
    note: o.note || '', createdAt: o.createdAt, updatedAt: o.updatedAt,
    /* ★ 2026-10-02：充值单的有效期（链上收款用）。0 = 无（老订单 / 提现单）。
       前端用它做倒计时，超时未到账的订单不再自动匹配，需后台手动补单。 */
    expireAt: o.expireAt || 0, addrId: o.addrId || '',
    history: (o.history || []).slice(-6)
  };
}
function newOrderId() { ORDERS.seq = (+ORDERS.seq || 1000) + 1; return 'O' + ORDERS.seq; }

/* 当日 / 当月已用额度（驳回的不计） */
function usedQuota(uid, type) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  let day = 0, month = 0;
  ORDERS.list.forEach(function (o) {
    if (o.uid !== uid || o.type !== type || o.status === 'rejected') return;
    if (o.createdAt >= d0.getTime()) day += o.usdt || 0;
    if (o.createdAt >= m0.getTime()) month += o.usdt || 0;
  });
  return { day: Math.round(day * 100) / 100, month: Math.round(month * 100) / 100 };
}
/* 限额校验：通过返回 ''，否则返回错误文案 */
function limCheck(usdtAmt, uid, type) {
  const L = payCfg().limits || {};
  const min = +L.perTxMin || 0, max = +L.perTxMax || Infinity;
  if (usdtAmt < min) return '低于单笔最小限额 ' + min + ' USDT';
  if (usdtAmt > max) return '超过单笔限额 ' + max + ' USDT';
  const u = usedQuota(uid, type);
  if (u.day + usdtAmt > (+L.day || Infinity)) return '超过单日限额 ' + L.day + ' USDT（今日已用 ' + u.day + '）';
  if (u.month + usdtAmt > (+L.month || Infinity)) return '超过单月限额 ' + L.month + ' USDT';
  return '';
}
/* 六态流转的唯一入口，保证不会出现非法状态 */
const O_NEXT = {
  approve: { pending: 'approved', frozen: 'approved', approved: 'completed' },
  reject: { pending: 'rejected', frozen: 'rejected', approved: 'rejected' },
  freeze: { pending: 'frozen', frozen: 'pending' },
  refund: { rejected: 'refunded' }
};
/* ★★ 把提现冻结的余额退回**原来那个口袋**，返回给审计/备注用的一句话。
   提现是「从 USDT 余额扣」，所以退回的也必须是 USDT 余额；
   唯一例外是兑换功能上线前的老订单（那时提现直接冻结筹码，o.unit 不是 'usdt'），按筹码退回。
   ★ 后台驳回退回（orderTransition）和玩家自己取消（cancel 分支）必须共用这一段 ——
     两处各写一份的话，漏改一处就会出现「扣的是 USDT、退的是筹码」的双记 bug。 */
function refundPocket(o) {
  const u = DB.users[o.uid];
  if (!u) return '';
  /* ★ 2026-10-05 USDT 化：余额只有一个口袋 bal（分）。提现冻结扣 bal，退回也加回 bal。 */
  const back = U(Math.max(0, +o.usdt || 0));
  u.bal = Math.max(0, Math.round(+u.bal || 0)) + back;
  return 'USDT 退回 ' + back.toFixed(2);
}
function orderTransition(o, act, admin, ip) {
  const map = O_NEXT[act];
  const to = map && map[o.status];
  if (!to) return { ok: false, msg: '状态「' + (OSTATES[o.status] || o.status) + '」不支持该操作' };
  o.status = to;
  o.updatedAt = Date.now();
  if (!o.history) o.history = [];
  o.history.push({ ts: Date.now(), act: act, to: to, admin: admin, ip: ip || '' });
  let extra = '';
  /* ★ 充值：只有 completed（确认到账）才加筹码 —— 人工审核与链上到账是两件事 */
  if (o.type === 'recharge' && to === 'completed') {
    const u = DB.users[o.uid];
    /* 充值到账 → 筹码 + 可兑现池同步增加（后台手工发放走 /admin/users/... 同一口径） */
    if (u) { const _c = U(+o.usdt || 0); u.bal = U((+u.bal || 0) + _c); extra = 'USDT +' + _c.toFixed(2); }
  }
  /* 提现：提交时已冻结扣减，驳回后退回**同一个口袋**（见上面的 refundPocket） */
  if (o.type === 'withdraw' && to === 'refunded') extra = refundPocket(o);
  /* 充值单状态一变就重算累计充值（幂等，只统计 completed），等级随之升降，绝不双记。 */
  if (o.type === 'recharge') { try { recalcDepositTotal(o.uid); } catch (e) { } }
  return { ok: true, to: to, extra: extra };
}

const AV = ['#f5c352', '#3b8cff', '#2ecc71', '#ff5a5f', '#a06bff', '#ff9f43', '#00c2d1', '#ff6ba8', '#7bd44b', '#e0b0ff'];
function mkUser(acc, name, pwd) {
  const id = String(++DB.seq);
  const u = {
    id: id, acc: acc, name: name, pwd: hashPw(pwd),
    color: AV[DB.seq % AV.length],
    /* ★ 2026-10-05：以前是 1 + random(20)，新号一注册就 Lv.11 —— 纯假数据。
       等级一律从 1 起步（目前没有经验系统，就诚实显示 Lv.1）。 */
    level: 1, vip: 0, vipExpire: 0,
    depositTotal: 0,   /* 累计充值（分）—— 等级由它自动计算 */
    /* ★ 2026-10-03（用户要求）：注册不送任何筹码 —— 一律 0 起步，筹码只能靠充值兑换获得。
       以前这里是 100000，等于任何人注册完就能直接上桌打真钱盘口。 */
    bal: 0, chips: 0, usdt: 0, practice: 0, diamonds: 0, banned: false, note: '', items: [], kyc: true,
    /* ★ 2026-10-03：头像。空 = 前端按名字哈希程序化生成（机器人因此也都有各自的头像）；
       `/assets/avatars/av-<uid>-xxx.jpg` = 玩家上传的图片；`sys:N` = 系统预设第 N 号。 */
    avatar: '',
    /* ★★ 牌桌独立记账（2026-10-02）：tablePaid = 从账户买入桌上的累计本金，
       tableCashed = 已从桌上取回账户的累计额，tableBank = 当前留在桌上的余额。
       「本金可取回、净盈利不可兑现」就靠 tablePaid − tableCashed 这条上限兜住，
       否则「开机器人打牌赢钱 → 筹码兑 USDT → 提现」是一条实打实的真钱口子。 */
    tablePaid: 0, tableCashed: 0, tableBank: 0,
    /* ★★ 2026-10-02 追加：可兑现筹码池 cashable（服务端权威，客户端永远写不到）
       只有「真金白银进来」的筹码才进这个池：充值订单 completed / 后台人工发放。
       兑换成 USDT 时只能从这个池扣 —— 于是就算 /me/sync 把 chips 报成天文数字，
       最多也只能兑回自己充过的本金，堵死「POST 一个数字 → 换 USDT → 提现」的口子。 */
    cashable: 0,
    dayGain: { day: '', amt: 0 },      /* 每日筹码净增长统计（异常增长检测） */
    riskFlag: 0,                       /* 风控标记次数：余额异常跳变的累计次数 */
    createdAt: Date.now(), lastLogin: Date.now(), lastIp: '',
    stat: { hands: 0, net: 0, win: 0 }
  };
  DB.users[id] = u;
  return u;
}
/* 老数据迁移：把新字段补进磁盘上已有的用户（不动任何既有值） */
(function migrateUsers() {
  let dirty = false;
  for (const id in DB.users) {
    const u = DB.users[id];
    if (!u) continue;
    /* ★ 2026-10-05 全站 USDT 化：权威余额改为 bal（USDT「分」整数，1 USDT = 100 分）。
       1 旧筹码 = 1 分，故 chips 数值直接并入；usdt（元）×100 并入；两者随后清零不再使用。 */
    if (typeof u.bal !== 'number') {
      u.bal = U(Math.max(0, +u.chips || 0) + Math.max(0, +u.usdt || 0));
      u.usdt = 0; dirty = true;   /* chips 旧值刻意保留，便于回溯核对 */
    }
    if (typeof u.practice !== 'number') { u.practice = 0; dirty = true; }
    if (typeof u.cashable !== 'number') { u.cashable = 0; dirty = true; }
    if (typeof u.tablePaid !== 'number') { u.tablePaid = 0; u.tableCashed = 0; u.tableBank = 0; dirty = true; }
    if (typeof u.riskFlag !== 'number') { u.riskFlag = 0; dirty = true; }
    if (!u.dayGain || typeof u.dayGain !== 'object') { u.dayGain = { day: '', amt: 0 }; dirty = true; }
    if (!u.stat) { u.stat = { hands: 0, net: 0, win: 0 }; dirty = true; }
  }
  if (dirty) saveDB();
})();
/* ★ 手机号掩码：只暴露「前 3 后 4」，绝不把完整号码下发到前端（隐私）。
   前端「账号安全」据此如实显示已绑定/未绑定 —— 以前用本地假号码 138****6621，
   没绑手机的号也显示「已绑定手机」，是明显的假数据。 */
function maskPhone(p) {
  if (typeof p !== 'string' || !p) return '';
  var d = p.replace(/\D/g, '');
  if (d.length > 11) d = d.slice(-11);
  if (d.length < 7) return '';
  return d.slice(0, 3) + '****' + d.slice(-4);
}
/* ==================================================================
   ★ 2026-10-06（用户口径）：等级 = 累计充值档位，自动计算，不再手改。
     500U→Lv.1，1000→Lv.2，2000→3，3000→4，4000→5，5000→6，
     之后每 +1000U 再升一档（6000→7、7000→8 …），不足 500U → Lv.0。
     只统计「真实充值订单 completed」；后台人工发放 / 补偿不计入。
   ================================================================== */
function levelOfDepositUsdt(usdt) {
  var v = Math.max(0, +usdt || 0);
  if (v < 500) return 0;
  return Math.floor(v / 1000) + 1;
}
function levelOfUser(u) {
  return levelOfDepositUsdt(Math.max(0, +((u && u.depositTotal) || 0)));
}
/* 幂等重算：累计充值完全由订单派生，重算覆盖而非累加，永远不会被重复计算。 */
function recalcDepositTotal(uid) {
  var sum = 0;
  for (var i = 0; i < ORDERS.list.length; i++) {
    var o = ORDERS.list[i];
    if (!o || o.uid !== uid) continue;
    if (o.type !== 'recharge' || o.status !== 'completed') continue;
    sum += U(+o.usdt || 0);
  }
  var u = DB.users[uid];
  if (u) u.depositTotal = sum;
  return sum;
}
function migrateDepositTotal() {
  var c = 0;
  for (var uid in DB.users) { try { recalcDepositTotal(uid); c++; } catch (e) { } }
  return c;
}
function publicUser(u) {
  return {
    id: u.id, acc: u.acc || u.name, name: u.name, color: u.color,
    /* 等级 = 累计充值档位，自动计算，不再读取手改的 u.level */
    level: levelOfUser(u),
    depositTotal: Math.max(0, Math.round(+u.depositTotal || 0)),
    depositUsdt: U(+u.depositTotal || 0),
    vip: u.vip,
    phone: maskPhone(u.phone),
    vipExpire: u.vipExpire || 0, items: Array.isArray(u.items) ? u.items : [],
    /* ★ 2026-10-03：头像（图片 URL / sys:N / 空 —— 空则前端程序化生成） */
    avatar: typeof u.avatar === 'string' ? u.avatar.slice(0, 200) : '',
    /* ★ 2026-10-05：bal = USDT 余额（分，整数，服务端权威）。
       chips 仅作兼容别名（值 = bal，即分数），新前端一律用 usdt（元）展示。 */
    bal: Math.max(0, Math.round(+u.bal || 0)),
    chips: Math.max(0, Math.round(+u.bal || 0)),
    practice: Math.max(0, Math.round(+u.practice || 0)),
    /* ★ 牌桌独立记账：一律只读下发（客户端只能经 /me/sync 报数，且会被下面的上限 clamp）。
       界面上用来告诉玩家「桌上多少钱、其中多少是本金可以取回」。 */
    tablePaid: Math.max(0, Math.round(+u.tablePaid || 0)),
    tableCashed: Math.max(0, Math.round(+u.tableCashed || 0)),
    tableBank: Math.max(0, Math.round(+u.tableBank || 0)),
    /* ★ USDT 余额（元）= bal（分）/ 100。USDT 化后它就是账户全部资产，
       充值到账 / 提现冻结 / 牌桌结算 才会变动；客户端一律不能直接写（/me/sync 不收余额字段）。 */
    usdt: U(+u.bal || 0),
    diamonds: u.diamonds, banned: u.banned, note: u.note,
    riskFlag: Math.max(0, Math.round(+u.riskFlag || 0)),
    /* 支付密码只告诉前端「有没有设置」，绝不下发哈希 */
    hasPaypwd: !!u.paypwd,
    /* 2026-10-03 多语言：账号界面语言（zh-CN / zh-TW / en），前端登录后据此套用 */
    lang: (typeof u.lang === 'string' && u.lang) ? u.lang : '',
    /* ★ 可兑现筹码池：服务端权威，客户端只能读不能写。
       钱包页要用它显示「可兑换额度」，玩家才知道自己赢的那些筹码兑不出来（见 fix: 2026-10-02）。 */
    cashable: Math.max(0, Math.round(+u.bal || 0)),   /* ★ 无闸门：账户 USDT 全部可提现 */
    /* ★ 只给数量，不给名单：好友是社交关系，后台也不需要知道具体是谁 */
    friends: Array.isArray(u.friends) ? u.friends.length : 0,
    pending: Array.isArray(u.freqIn) ? u.freqIn.length : 0,
    kyc: u.kyc !== false,
      /* ★ 2026-10-03：签到进度（连续第几天 / 上次签到日 0 点时间戳）—— 任务页据此点亮已签到的格子，
         并判断今天是否已签到（避免「点一下才知道今天领过了」）。 */
      signin: { day: (u.signin && u.signin.day) || 0, last: (u.signin && u.signin.last) || 0 },
      /* ★ 2026-10-03：邀请好友 —— 只下发「成功邀请了几人」，不下发名单（隐私） */
      inviteCount: Math.max(0, Math.round(+u.inviteCount || 0)),
    createdAt: u.createdAt, lastLogin: u.lastLogin, stat: u.stat || { hands: 0, net: 0, win: 0 }
  };
}
/* 登录名：账号 acc 优先，其次昵称 name（旧数据兼容） */
function findByLogin(key) {
  const k = String(key).trim().toLowerCase();
  if (!k) return null;
  for (const id in DB.users) if (String(DB.users[id].acc || '').toLowerCase() === k) return DB.users[id];
  for (const id in DB.users) if (String(DB.users[id].name || '').toLowerCase() === k) return DB.users[id];
  return null;
}
function findByName(name) {
  const k = String(name).trim().toLowerCase();
  for (const id in DB.users) if (DB.users[id].name.toLowerCase() === k) return DB.users[id];
  return null;
}

/* ---------------- 会话 ---------------- */
const sessions = new Map();     /* token -> {role, uid, exp, ip} */
function mkSession(role, uid, ip, ttl) {
  const t = newToken();
  sessions.set(t, { role: role, uid: uid, exp: Date.now() + ttl, ip: ip });
  saveSessions();
  return t;
}
function getSession(req) {
  const raw = req.headers['authorization'] || req.headers['x-session'] || '';
  const m = /^(?:Bearer\s+)?([a-f0-9]{64})$/i.exec(String(raw).trim());
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(m[1]); saveSessions(); return null; }
  return Object.assign({ token: m[1] }, s);
}
loadSessions();   /* 2026-10-05：重启后恢复登录态 */
setInterval(function () {
  const now = Date.now();
  let dropped = 0;
  sessions.forEach(function (s, t) { if (s.exp < now) { sessions.delete(t); dropped++; } });
  if (dropped) saveSessions();
}, 10 * 60 * 1000).unref();

/* ---------------- 登录限流 / 锁 ---------------- */
const fails = new Map();       /* ip -> {n, first, until} */
/* 全站轻量限流：每 IP 每分钟最多 HIT_MAX 次写/鉴权请求，防刷 */
const apiHits = new Map();     /* ip -> {n, win} */
const HIT_MAX = 120, HIT_WIN = 60 * 1000;
function hitLimit(ip) {
  const now = Date.now();
  let h = apiHits.get(ip);
  if (!h || now - h.win > HIT_WIN) h = { n: 0, win: now };
  h.n++; apiHits.set(ip, h);
  return h.n > HIT_MAX;
}
function ipOf(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

/* ---------------- GeoIP：按客户端 IP 归属国判界面语言（2026-10-04） ----------------
   · 只用 node 内置模块，零第三方依赖
   · 结果内存缓存 24h，同一 IP 只查一次
   · 三语站点：中国大陆→简体，台湾/香港/澳门→繁體，其余一律英文
----------------------------------------------------------------------------- */
const GEO_CACHE = new Map();     /* ip -> {cc, lang, ts} */
const GEO_PEND = new Map();      /* ip -> Promise（并发去重，别重复打上游） */
const GEO_TTL = 24 * 3600 * 1000;
const GEO_BAD_TTL = 10 * 60 * 1000;   /* 上游查不到（限流/超时）时只缓存 10 分钟 */
const GEO_MAX = 20000;

/* 真实客户端 IP：优先 X-Real-IP（nginx 用 $remote_addr 写的，伪造不了），
   其次 X-Forwarded-For 最后一跳（最靠近 nginx 的那跳才是真的），最后 socket */
function ipReal(req) {
  const xr = String(req.headers['x-real-ip'] || '').trim();
  if (xr) return xr;
  const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (xf.length) return xf[xf.length - 1];
  return req.socket.remoteAddress || '';
}

function isLocalIp(ip) {
  if (!ip) return true;
  let v = String(ip).trim();
  if (v.indexOf('::ffff:') === 0) v = v.slice(7);
  if (v === '::1' || v === '127.0.0.1' || v === 'localhost' || v === '0.0.0.0') return true;
  if (/^(10|127)\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  if (v.indexOf(':') >= 0 && !/^::ffff:/.test(String(ip))) return true;   /* IPv6 一律跳过，库覆盖差 */
  return false;
}

/* 国家码 → 三语之一 */
function langForCc(cc) {
  const c = String(cc || '').toUpperCase();
  if (c === 'CN') return 'zh-CN';
  if (c === 'TW' || c === 'HK' || c === 'MO') return 'zh-TW';
  return 'en';
}

function httpJson(url, ms) {
  return new Promise(function (resolve, reject) {
    let mod;
    try { mod = url.indexOf('https:') === 0 ? require('https') : require('http'); } catch (e) { return reject(e); }
    let done = false;
    const req = mod.get(url, { timeout: ms || 4000, headers: { 'User-Agent': 'gu9/1.0' } }, function (r) {
      let buf = '';
      r.setEncoding('utf8');
      r.on('data', function (d) { buf += d; if (buf.length > 40000) req.destroy(); });
      r.on('end', function () {
        if (done) return; done = true;
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad json')); }
      });
    });
    req.on('error', function (e) { if (done) return; done = true; reject(e); });
    req.on('timeout', function () { if (done) return; done = true; req.destroy(); reject(new Error('timeout')); });
  });
}

/* 三个上游并行跑，谁先回就用谁（首次判定通常 1.2s 内拿到） */
function geoFetch(ip) {
  const q = encodeURIComponent(ip);
  const jobs = [
    httpJson('http://ip-api.com/json/' + q + '?fields=status,countryCode', 3000)
      .then(function (a) { return (a && a.status === 'success' && a.countryCode) ? String(a.countryCode).toUpperCase() : ''; }),
    httpJson('https://ipwho.is/' + q, 3000)
      .then(function (b) { return (b && b.success && b.country_code) ? String(b.country_code).toUpperCase() : ''; }),
    httpJson('https://ipinfo.io/' + q + '/json', 3000)
      .then(function (c) { return (c && c.country) ? String(c.country).toUpperCase() : ''; })
  ];
  return new Promise(function (resolve) {
    let left = jobs.length, got = '';
    jobs.forEach(function (j) {
      j.then(function (cc) {
        if (cc && !got) { got = cc; resolve(cc); }
        else if (--left <= 0 && !got) resolve('');
      }, function () { if (--left <= 0 && !got) resolve(''); });
    });
  });
}

function geoGet(ip) {
  const hit = GEO_CACHE.get(ip);
  if (hit && (Date.now() - hit.ts) < (hit.bad ? GEO_BAD_TTL : GEO_TTL)) return Promise.resolve(hit.cc);
  if (GEO_PEND.has(ip)) return GEO_PEND.get(ip);
  const pr = geoFetch(ip).then(function (cc) {
    GEO_PEND.delete(ip);
    if (GEO_CACHE.size > GEO_MAX) { GEO_CACHE.clear(); }
    GEO_CACHE.set(ip, { cc: cc, lang: cc ? langForCc(cc) : '', ts: Date.now(), bad: !cc });
    return cc;
  }).catch(function () { GEO_PEND.delete(ip); return ''; });
  GEO_PEND.set(ip, pr);
  return pr;
}
function lockLeft(ip) {
  const f = fails.get(ip); if (!f) return 0;
  if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 1000);
  return 0;
}
function noteFail(ip) {
  const now = Date.now();
  let f = fails.get(ip);
  if (!f || now - f.first > LOCK_WINDOW) f = { n: 0, first: now, until: 0 };
  f.n++;
  if (f.n >= LOCK_FAILS) { f.until = now + LOCK_TIME; f.n = 0; }
  fails.set(ip, f);
}
function clearFail(ip) { fails.delete(ip); }

/* ---------------- HTTP ---------------- */
function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': b.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  });
  res.end(b);
}
const ok = (res, o) => json(res, 200, Object.assign({ ok: true }, o || {}));
const err = (res, code, msg) => json(res, code, { ok: false, msg: msg });

function body(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > (limit || 65536)) { reject(new Error('too big')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = '';
  try { rel = decodeURIComponent(String(urlPath || '').replace(/^\/padmin\/?/, '')); } catch (e) { return err(res, 400, 'bad path'); }
  if (!rel || rel === '/') rel = 'index.html';
  /* reject null bytes, absolute paths, and any .. segment (path traversal) */
  if (rel.indexOf('\0') >= 0 || path.isAbsolute(rel) || rel.split(/[\\/]/).indexOf('..') >= 0) {
    return err(res, 400, 'bad path');
  }
  const root = path.resolve(WEB);
  const f = path.resolve(root, rel);
  if (f !== root && f.indexOf(root + path.sep) !== 0) return err(res, 404, 'not found');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    const idx = path.join(root, 'index.html');
    if (!fs.existsSync(idx)) return err(res, 404, 'admin web not found');
    return sendFile(res, idx);
  }
  return sendFile(res, f);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function sendFile(res, f) {
  const b = fs.readFileSync(f);
  const ext = path.extname(f);
  const csp = ext === '.html'
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    : "default-src 'none'; frame-ancestors 'none'";
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': b.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': csp
  });
  res.end(b);
}

/* 扩展模块初始化（放在这里：sessions / mkSession / mkUser 等都已声明完毕） */
extraApi.init({
  DATA: DATA, ADMIN_USER: ADMIN_USER, fpath: fpath, readJson: readJson, writeJson: writeJson,
  saveDB: saveDB, saveConfig: saveConfig, saveOrders: saveOrders, saveRooms: saveRooms,
  audit: audit, hashPw: hashPw, verifyPw: verifyPw, publicUser: publicUser, tasksPublic: tasksPublic,
  mkUser: mkUser, mkSession: mkSession, safeEqual: safeEqual, SESSION_TTL: SESSION_TTL,
  roomPublic: roomPublic, orderPublic: orderPublic, orderTransition: orderTransition,
  sessions: sessions, getSession: getSession,
  ok: ok, err: err, json: json, newId: newId,
  get db() { return DB; }, get config() { return CONFIG; }, get pokerTable() { return pokerTable; },
  get orders() { return ORDERS; }, get rooms() { return ROOMS; }
});

/* 2026-10-04：牌局状态机依赖同样的会话/账户/房间/落盘接口 */
pokerTable.init({ DB: DB, ROOMS: ROOMS, saveDB: saveDB, getSession: getSession, audit: audit, touchRoom: touchRoom, getConfig: function () { return CONFIG; }, reportHand: function (row) { try { extraApi.addHands([row]); } catch (e) { } } });
const clubsApi = clubsMod.createClubs({
  DATA: DATA, db: DB, writeJson: writeJson, audit: audit, ADMIN_USER: ADMIN_USER
});


const server = http.createServer(async function (req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const ip = ipOf(req);
  try {
    /* 安全头：所有响应默认带上（静态/JSON 会覆盖 Content-Type） */
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    /* 写接口 + 鉴权接口限流 */
    if (p.indexOf('/papi/') === 0 && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (hitLimit(ip)) return err(res, 429, '请求过于频繁，请稍后再试');
    }
    if ((p === '/papi/auth/login' || p === '/papi/auth/register' || p === '/papi/admin/login') && hitLimit(ip + ':auth')) {
      return err(res, 429, '请求过于频繁，请稍后再试');
    }
    /* ---- 后台静态页 ---- */
    if (p === '/padmin' || p.indexOf('/padmin/') === 0) return serveStatic(req, res, p);

    /* ---- 健康检查 ---- */
    if (p === '/papi/ping') return ok(res, { t: Date.now() });

    /* ---- IP 归属国 → 界面语言（美国 IP 打开就是英文，无需登录） ---- */
    if (p === '/papi/geo' && req.method === 'GET') {
      const gip = ipReal(req);
      if (isLocalIp(gip)) return ok(res, { ip: gip, cc: '', lang: '', local: true });
      const gh = GEO_CACHE.get(gip);
      if (gh && (Date.now() - gh.ts) < (gh.bad ? GEO_BAD_TTL : GEO_TTL)) {
        return ok(res, { ip: gip, cc: gh.cc, lang: gh.lang, cached: true });
      }
      let gcc = '';
      try { gcc = await geoGet(gip); } catch (e) { }
      return ok(res, { ip: gip, cc: gcc, lang: gcc ? langForCc(gcc) : '', cached: false });
    }

    /* ---- 扩展模块：先过一遍，命中就直接返回；未命中继续走下面的老分支 ---- */
    /* ---- 2026-10-04：服务端权威牌局（真人对战 P2P）优先于扩展模块 ---- */
    if (p.indexOf('/papi/table') === 0) {
      const b = await body(req, 262144);
      return pokerTable.router(req, res, p, b);
    }

    if (p.indexOf('/papi/') === 0) {
      const handled = await extraApi.handle({ p: p, req: req, res: res, ip: ip, u: u, body: () => body(req, 262144), bodyBig: () => body(req, 8388608) });
      if (handled) return;
    }

    /* ---- 公开配置（前端启动拉取，不含任何敏感项） ---- */
    if (p === '/papi/config' && req.method === 'GET') {
      const pc = payCfg();
      return ok(res, {
        config: {
          think: CONFIG.think, ai: CONFIG.ai, econ: CONFIG.econ,
          lobby: CONFIG.lobby, modes: CONFIG.modes, maintenance: CONFIG.maintenance,
          /* ★ 2026-10-07：注册赠送（前端只拿 on/bonus 做展示，防刷上限 ipCap/didCap 不下发） */
          reg: {
            on: !((CONFIG.reg || {}).on === false),
            bonus: U(Math.max(0, (+((CONFIG.reg || {}).bonus) || 0)))
          },
          /* ★ 2026-10-02：大厅顶栏的 APP 名称 + 任务/签到奖励（都归一化后下发）
             ★ 2026-10-03：logo 只认「本站上传目录」的地址，防止被人塞外链 / 追踪像素。
               空 = 前端回落到内置的 logo-full-light.png / logo-mark.png。 */
          app: {
            name: String((CONFIG.app && CONFIG.app.name) || 'GU9').slice(0, 24),
            logo: /^\/assets\/brand\/logo-[\w-]+\.(png|jpe?g|webp)$/i.test(String((CONFIG.app && CONFIG.app.logo) || ''))
              ? String(CONFIG.app.logo) : ''
          },
          /* ★ 2026-10-03：大厅轮播 Banner（后台「Banner 管理」配置的；空数组=前端用内置三条） */
          banners: (Array.isArray(CONFIG.banners) ? CONFIG.banners : [])
            .filter(function (b) { return b && b.on !== false; })
            .map(function (b) { return { img: b.img, t: b.t || '', s: b.s || '', act: b.act || '' }; }),
          tasks: tasksPublic(),
          /* ★ 2026-10-02：AI 强度档位 + 透视（测试房专用）下发到前端；默认是关的 */
          oracle: Object.assign({ on: false, board: true, holes: true, useRate: 0.85, ally: false }, CONFIG.oracle || {}),
          /* ★ 2026-10-02：控水（机器人赢面调节）下发到前端；默认关闭，只能后台开 */
          house: Object.assign({ on: false, botWinRate: 0.30, strength: 0.85, capProfit: 2000000, capLoss: 1000000 }, CONFIG.house || {}),
          /* ★ 2026-10-04：机器人总开关下发到前端（关时前端不安排机器人、强制关控水） */
          bots: Object.assign({ on: true }, CONFIG.bots || {}),
          /* ★ 2026-10-05：第三方客服链接（后台「参数配置 → 客服配置」填写）。
             启用时前端客服中心显示「在线客服」按钮跳转到该链接；不在则回落到内置演示客服。 */
          support: Object.assign({ enabled: false, url: '' }, CONFIG.support || {}),
          meContent: Object.assign({}, CONFIG.meContent || {}),
          /* 只下发前端展示所需字段；不含任何地址、密钥或适配器凭据 */
          pay: payPublic(pc)
        }
      });
    }

    /* ---- 玩家注册 ---- */
    if (p === '/papi/auth/register' && req.method === 'POST') {
      const leftReg = lockLeft(ip);
      if (leftReg > 0) return err(res, 429, '尝试过于频繁，请 ' + leftReg + ' 秒后再试');
      const b = await body(req);
      const acc = String(b.acc || '').trim();
      const name = String(b.name || '').trim();
      const pwd = String(b.pwd || '');
      if (!/^[a-zA-Z0-9_]{4,16}$/.test(acc)) return err(res, 400, '账号需 4-16 位字母/数字/下划线');
      if (name.length < 2 || name.length > 16) return err(res, 400, '昵称需 2-16 个字符');
      if (pwd.length < 6 || pwd.length > 32) return err(res, 400, '密码需 6-32 位');
      if (findByLogin(acc)) return err(res, 409, '该账号已被注册');
      if (findByName(name)) return err(res, 409, '该昵称已被注册');
      /* ★ 2026-10-03（用户要求）：注册表单「确认密码」换成「手机号码」，区号可选 中国 +86 / 美国 +1。
         服务端存 user.phone = "cc-num"，格式不对直接拒；老客户端不传手机号也放行（兼容）。 */
      const cc = String(b.cc || '').trim();
      const phone = String(b.phone || '').replace(/\D/g, '');
      let phoneFull = '';
      if (phone || cc) {
        if (cc === '+86' && /^1[3-9]\d{9}$/.test(phone)) phoneFull = '+86-' + phone;
        else if (cc === '+1' && /^[2-9]\d{9}$/.test(phone)) phoneFull = '+1-' + phone;
        else return err(res, 400, cc === '+1' ? '请输入有效的 10 位美国手机号' : '请输入有效的 11 位中国手机号');
      }
      const user = mkUser(acc, name, pwd);
      if (phoneFull) user.phone = phoneFull;
      /* 2026-10-03 多语言：只接受三种，其它一律忽略。美国区号 +1 没传 lang 时默认英文。 */
      const _lg = String(b.lang || '').trim() || (cc === '+1' ? 'en' : '');
      if (_lg === 'zh-CN' || _lg === 'zh-TW' || _lg === 'en') user.lang = _lg;
      /* ★★ 2026-10-07（用户要求）：注册赠送 USDT —— 开关/金额/防刷上限全部后台「参数配置 → 注册赠送」可调。
         防刷口径（防一个人注册多个号薅赠送）：
           ① 同一 IP 累计发放 ipCap 次（默认 3）后，该 IP 再注册只建号不赠送；
           ② 同一设备指纹（前端 localStorage gu9_did，随注册上报）累计发放 didCap 次（默认 2）；
           ③ 上限填 0 = 全停；金额填 0 或开关关 = 不赠送；
           ④ 发放计数 DB.regGuard 持久化到 users.json，重启不丢；每一笔都写审计 + 进日账（资金守恒）。 */
      const rcfg = Object.assign({ on: true, bonus: 10, ipCap: 3, didCap: 2 }, CONFIG.reg || {});
      const rbonus = (rcfg.on === false) ? 0 : U(Math.max(0, Math.min(10000, +rcfg.bonus || 0)));
      if (rbonus > 0) {
        if (!DB.regGuard || typeof DB.regGuard !== 'object') DB.regGuard = { ip: {}, did: {} };
        if (!DB.regGuard.ip || typeof DB.regGuard.ip !== 'object') DB.regGuard.ip = {};
        if (!DB.regGuard.did || typeof DB.regGuard.did !== 'object') DB.regGuard.did = {};
        const _did = String(b.did || '').replace(/[^\w-]/g, '').slice(0, 48);
        const ipN = DB.regGuard.ip[ip] || 0;
        const didN = _did ? (DB.regGuard.did[_did] || 0) : 0;
        const ipCap = Math.max(0, Math.round(+rcfg.ipCap || 0));
        const didCap = Math.max(0, Math.round(+rcfg.didCap || 0));
        if (ipN < ipCap && (!_did || didN < didCap)) {
          user.bal = U((+user.bal || 0) + rbonus);
          user.cashable = U(+user.bal || 0);   /* 与后台人工发放同口径：余额即全部可提 */
          user.regBonus = rbonus;
          DB.regGuard.ip[ip] = ipN + 1;
          if (_did) DB.regGuard.did[_did] = didN + 1;
          try { pokerTable.recordDailyAdjust(-rbonus); } catch (e) { }   /* 平台送出进日账 */
          audit(null, 'reg-bonus', user.id + '(' + user.name + ')',
            'USDT +' + rbonus.toFixed(2) + ' ip#' + (ipN + 1) + (_did ? ' did#' + (didN + 1) : ''), ip, 'system');
        }
      }
      /* ★ 2026-10-03：邀请好友奖励 —— 好友注册时填了你的 ID/账号，你就得 econ.inviteReward 筹码
         （默认 10，后台「参数配置 → 邀请好友奖励」可调）。防刷三件套：
         ① 不能自己邀自己；② 一个账号只会记一次推荐人（注册时写入 refBy，之后不再改）；
         ③ 推荐人每日最多 inviteDayCap 笔（默认 20），超了当天不再发。 */
      const refRaw = String(b.ref || '').trim();
      if (refRaw) {
        const inv = (DB.users[refRaw] && DB.users[refRaw].id !== user.id) ? DB.users[refRaw] : null;
        const inv2 = inv || ((findByLogin(refRaw) || {}).id !== user.id ? findByLogin(refRaw) : null);
        /* ★ 2026-10-05 审计修复：注册不再即发邀请奖励 —— 注册零成本，可无限刷小号
           每号套 10 USDT（日上限 20 人 = 200 USDT/天，可长期累计提现）。
           现在只记录 refBy；奖励由 chain.js creditOrder 在被邀请人【首次充值到账】后发放。 */
        if (inv2 && inv2.id !== user.id) user.refBy = inv2.id;
      }
      await saveDB();
      const token = mkSession('user', user.id, ip, SESSION_TTL);
      return ok(res, { token: token, user: publicUser(user) });
    }

    /* ---- 玩家登录 ---- */
    if (p === '/papi/auth/login' && req.method === 'POST') {
      const left = lockLeft(ip);
      if (left > 0) return err(res, 429, '尝试过于频繁，请 ' + left + ' 秒后再试');
      const b = await body(req);
      const user = findByLogin(String(b.acc || b.name || '').trim());
      if (!user || !verifyPw(String(b.pwd || ''), user.pwd)) {
        noteFail(ip);
        return err(res, 401, '账号或密码错误');
      }
      if (user.banned) return err(res, 403, '账号已被封禁，请联系客服');
      clearFail(ip);
      user.lastLogin = Date.now(); user.lastIp = ip;
      await saveDB();
      const token = mkSession('user', user.id, ip, SESSION_TTL);
      return ok(res, { token: token, user: publicUser(user) });
    }

    /* ---- 玩家退出 ---- */
    if (p === '/papi/auth/logout' && req.method === 'POST') {
      const s = getSession(req); if (s) { sessions.delete(s.token); saveSessions(); }
      return ok(res);
    }

    /* ---- 我的信息 ---- */
    if (p === '/papi/me' && req.method === 'GET') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const user = DB.users[s.uid]; if (!user) return err(res, 401, '账号不存在');
      return ok(res, { user: publicUser(user) });
    }

    /* ---- 玩家界面语言（简体 / 繁體 / English），写进账号，换设备也保持 ---- */
    if (p === '/papi/me/lang' && req.method === 'POST') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const u = DB.users[s.uid]; if (!u) return err(res, 401, '账号不存在');
      const _b = await body(req);
      const _lg = String((_b && _b.lang) || '').trim();
      if (_lg !== 'zh-CN' && _lg !== 'zh-TW' && _lg !== 'en' && _lg !== 'ja' && _lg !== 'ko') return err(res, 400, '不支持的语言');
      u.lang = _lg; saveDB();
      return ok(res, { lang: _lg });
    }

    /* ---- 玩家自己同步余额 / 统计 ---- */
    if (p === '/papi/me/sync' && req.method === 'POST') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const user = DB.users[s.uid]; if (!user) return err(res, 401, '账号不存在');
      const b = await body(req);
      /* ★★ 2026-10-02 修「客户端说了算」：这一句以前是 user.bal = b.chips，
         随便一条 `curl -d '{"chips":999999999}'` 就能把余额刷爆，再兑换 USDT → 提现。
         现在是四道闸（牌局跑在浏览器里，服务端无法逐手核账，只能封住「离谱的跳变」；
         真钱的最后一道锁放在 exchange —— 可兑换额度只认服务端账 cashable，跟 chips 无关）：
           ① 单次跳变步长上限      —— 正常一手牌不可能越过
           ② 24 小时累计净增长上限  —— 掐掉「小步快跑」式的刷钱
           ③ 筹码硬上限 HARD_CAP    —— 天花板封顶
           ④ 触发以上任一条 → 写审计 + riskFlag+1，后台「风险用户」页可见，可在出款前拦下 */
      const HARD_CAP = 10000000;
      const dstr = new Date().toISOString().slice(0, 10);
      if (!user.dayGain || user.dayGain.day !== dstr) user.dayGain = { day: dstr, amt: 0 };
      /* ★★ 2026-10-05 全站 USDT 化（安全红线）：账户余额只能由服务端权威写入
         （充值到账 / 提现冻结 / 牌桌结算），客户端一律不得上报余额 ——
         否则「POST 一个天文数字 → 提现」就是零成本直刷真钱，没有任何闸能兜住。
         允许上报的只有 practice（单机练习币，纯前端娱乐余额，与 USDT 无关）。 */
      /* ★★ 2026-10-05 P0 安全修复：practice / diamonds 一律不再接受客户端上报。
         practice（练习币）全站已下线；diamonds 若被客户端任意写，同样是可被滥用的数值字段。
         两者此后只能由服务端（后台/活动发放）写入。 */
      /* ★★ 牌桌记账（只读报数 + 硬 clamp）：
         · tablePaid / tableCashed 只准单调不减（防止刷表把本金刷成天文数字）
         · tableCashed 不许超过 tablePaid
         · tableBank 永远压在 tablePaid − tableCashed 以内 —— 桌上的钱最多只能取回本金，
           赢来的净盈利留在 tableBank 里出不去，也就兑不成 USDT、提不了现。 */
      const paid = Math.max(0, Math.round(+(b.tablePaid || 0) || 0));
      const cashed = Math.max(0, Math.round(+(b.tableCashed || 0) || 0));
      const bank = Math.max(0, Math.round(+(b.tableBank || 0) || 0));
      const paidOld = Math.max(0, Math.round(+user.tablePaid || 0));
      const cashedOld = Math.max(0, Math.round(+user.tableCashed || 0));
      /* ★★ 2026-10-05 P0 安全修复（实测可刷钱，务必保留）：
         以前这三行让客户端能任意写 tablePaid / tableBank，而 reapOrphanTableBank()
         会把 tableBank 当成「桌上的真钱」直接加进 u.bal ——
         实测一条 `POST /papi/me/sync {tablePaid:88888888,tableBank:88888888}` 后建房再离座，
         余额当场变成 88888888（= 888,888.88 USDT）并可原样提现。
         牌桌记账的权威是 pokertable（买入/结算时自己写 tablePaid/tableBank），
         客户端一律不得上报 —— 这里只接收 stat（手数/净盈亏）这类展示性数据。 */
      /* ★ 2026-10-08 P1：stat 改为服务端权威（pokertable 每手记账），客户端不再上报。
         旧逻辑接受客户端 stat 上报，玩家本地旧值（全 0）每次 sync 都会把服务端权威统计覆盖掉
         —— 这就是「统计页永远是 0」的根因之一。 */

      await saveDB();
      return ok(res, { user: publicUser(user) });
    }

    /* ================= 好友：真实玩家之间的好友关系 =================
       · 关系存在用户对象上：friends(双向) / freqIn(收到的申请) / freqOut(发出的申请) / blocked
       · 一律不下发他人余额（chips / net）—— 好友是社交关系，不是财富榜
       · 加好友必须双向确认：A 发申请 → B 同意 → 双方 friends 各记一条
       · 三条隐私红线：不能加自己 / 不能加被封禁账号 / 被拉黑时对方不能被搜到申请 */
    if (p.indexOf('/papi/friends') === 0) {
      const s = getSession(req);
      if (!s || s.role !== 'user') return err(res, 401, '未登录');
      const me = DB.users[s.uid];
      if (!me) return err(res, 401, '账号不存在');
      if (!Array.isArray(me.friends)) me.friends = [];
      if (!Array.isArray(me.freqIn)) me.freqIn = [];
      if (!Array.isArray(me.freqOut)) me.freqOut = [];
      if (!Array.isArray(me.blocked)) me.blocked = [];
      /* ★ 2026-10-03：私信收件箱 —— 好友发来的消息落在这里，随 GET /friends 一起下发。
         保留 3 天 / 最多 200 条（再老再多的丢掉，聊天记录本来就是轻量场景）。 */
      if (!Array.isArray(me.inbox)) me.inbox = [];

      const FMAX = 200;      /* 好友上限 */
      const OMAX = 100;      /* 待对方处理的申请上限 */

      /* 对外投影：只给公开信息，绝不含余额 */
      const brief = function (x, extra) {
        return Object.assign({
          id: x.id, name: x.name, color: x.color, level: x.level, vip: x.vip,
          lastLogin: x.lastLogin || 0, createdAt: x.createdAt || 0,
          hands: (x.stat && x.stat.hands) || 0,
          online: Date.now() - (x.lastLogin || 0) < 5 * 60 * 1000
        }, extra || {});
      };
      const briefById = function (id) { return DB.users[id] ? brief(DB.users[id]) : null; };
      const uidOf = function (b) { return String((b && (b.id || b.uid || b.to)) || '').trim(); };
      /* 关系标签：给前端决定按钮该显示「加好友 / 同意 / 已发送 / 已是好友」 */
      const relOf = function (id, other) {
        if (String(id) === String(me.id)) return 'self';
        if (me.blocked.indexOf(id) >= 0) return 'blocked';
        if (other && Array.isArray(other.blocked) && other.blocked.indexOf(me.id) >= 0) return 'blocked';
        if (me.friends.indexOf(id) >= 0) return 'friend';
        if (me.freqIn.some(function (r) { return r.from === id; })) return 'in';
        if (me.freqOut.some(function (r) { return r.to === id; })) return 'out';
        return 'none';
      };
      const norm = function (other) {
        if (!other) return null;
        if (!Array.isArray(other.friends)) other.friends = [];
        if (!Array.isArray(other.freqIn)) other.freqIn = [];
        if (!Array.isArray(other.freqOut)) other.freqOut = [];
        if (!Array.isArray(other.blocked)) other.blocked = [];
        return other;
      };

      /* ---- 我的好友 / 申请 / 黑名单 ---- */
      if (p === '/papi/friends' && req.method === 'GET') {
        me.friends = me.friends.filter(function (id) { return !!DB.users[id]; }).slice(0, FMAX);
        me.freqIn = me.freqIn.filter(function (r) { return !!DB.users[r.from]; });
        me.freqOut = me.freqOut.filter(function (r) { return !!DB.users[r.to]; });
        /* 收件箱：清掉 3 天前的老消息；最多下发最近 100 条 */
        const cutoff = Date.now() - 3 * 86400000;
        const ib = me.inbox.filter(function (m) { return m && DB.users[m.from] && (m.ts || 0) >= cutoff; }).slice(-100);
        if (ib.length !== me.inbox.length) me.inbox = ib;
        return ok(res, {
          friends: me.friends.map(briefById).filter(Boolean),
          incoming: me.freqIn.map(function (r) { return brief(DB.users[r.from], { note: r.note || '', ts: r.ts }); }),
          outgoing: me.freqOut.map(function (r) { return brief(DB.users[r.to], { ts: r.ts }); }),
          blocked: me.blocked.map(briefById).filter(Boolean),
          /* 私信：带发送者昵称/颜色，前端不用二次查 */
          inbox: ib.map(function (m) {
            const fu = DB.users[m.from] || {};
            return { from: m.from, fromName: fu.name || '玩家', fromColor: fu.color || '#3b8cff', text: m.text, ts: m.ts };
          })
        });
      }

      /* ---- ★ 2026-10-03：发好友私信（存对方收件箱，对方在线时随轮询拉到并提示）---- */
      if (p === '/papi/friends/msg' && req.method === 'POST') {
        const b = await body(req, 4096);
        const to = uidOf(b);
        const text = String(b.text || '').trim();
        if (!to) return err(res, 400, '缺少目标玩家');
        if (to === String(me.id)) return err(res, 400, '不能给自己发消息');
        if (!text) return err(res, 400, '消息不能为空');
        if (text.length > 500) return err(res, 400, '消息最多 500 字');
        const other = norm(DB.users[to]);
        if (!other) return err(res, 404, '玩家不存在');
        if (other.banned) return err(res, 403, '该玩家已被封禁');
        if (me.blocked.indexOf(to) >= 0 || other.blocked.indexOf(me.id) >= 0) return err(res, 403, '你们之间已被拉黑');
        if (!Array.isArray(other.friends) || other.friends.indexOf(me.id) < 0 || me.friends.indexOf(to) < 0)
          return err(res, 403, '只有好友才能发私信');
        if (!Array.isArray(other.inbox)) other.inbox = [];
        other.inbox.push({ from: me.id, text: text, ts: Date.now() });
        if (other.inbox.length > 200) other.inbox = other.inbox.slice(-200);
        await saveDB();
        return ok(res, { msg: '已发送' });
      }

      /* ---- 搜索玩家：ID 全等 > 昵称全等 > 昵称包含 ---- */
      if (p === '/papi/friends/search' && req.method === 'GET') {
        const kw = String(u.searchParams.get('q') || '').trim().toLowerCase();
        if (!kw) return ok(res, { list: [] });
        const hit = [];
        for (const id in DB.users) {
          const x = DB.users[id];
          if (x.banned) continue;
          if (String(x.id).toLowerCase() === kw ||
            String(x.acc || '').toLowerCase() === kw ||
            String(x.name || '').toLowerCase().indexOf(kw) >= 0) {
            hit.push(brief(x, { rel: relOf(x.id, x) }));
            if (hit.length >= 40) break;
          }
        }
        const score = function (x) {
          return String(x.id).toLowerCase() === kw ? 0
            : String(x.acc || '').toLowerCase() === kw ? 1
              : String(x.name).toLowerCase() === kw ? 2 : 3;
        };
        hit.sort(function (a, b) { return score(a) - score(b); });
        return ok(res, { list: hit.slice(0, 20) });
      }

      /* ---- 发送好友申请 ---- */
      if (p === '/papi/friends/req' && req.method === 'POST') {
        const b = await body(req);
        const to = uidOf(b);
        if (!to) return err(res, 400, '缺少目标玩家');
        if (to === String(me.id)) return err(res, 400, '不能加自己为好友');
        const other = norm(DB.users[to]);
        if (!other) return err(res, 404, '玩家不存在');
        if (other.banned) return err(res, 403, '该玩家已被封禁');
        if (other.blocked.indexOf(me.id) >= 0) return err(res, 403, '对方暂时无法添加');
        if (me.blocked.indexOf(to) >= 0) return err(res, 403, '请先解除拉黑');
        if (me.friends.indexOf(to) >= 0) return ok(res, { rel: 'friend', msg: '你们已经是好友' });

        /* 对方已经申请过我 → 直接互相成为好友，省掉一次来回 */
        if (me.freqIn.some(function (r) { return r.from === to; })) {
          me.freqIn = me.freqIn.filter(function (r) { return r.from !== to; });
          other.freqOut = other.freqOut.filter(function (r) { return r.to !== me.id; });
          if (me.friends.indexOf(to) < 0) me.friends.push(to);
          if (other.friends.indexOf(me.id) < 0) other.friends.push(me.id);
          await saveDB();
          return ok(res, { rel: 'friend', msg: '已互为好友' });
        }

        if (me.freqOut.some(function (r) { return r.to === to; })) return ok(res, { rel: 'out', msg: '申请已发送，等待对方同意' });
        if (me.friends.length >= FMAX) return err(res, 403, '好友数已达上限');
        if (me.freqOut.length >= OMAX) return err(res, 403, '待处理的申请过多，请稍后再试');
        me.freqOut.push({ to: to, ts: Date.now() });
        other.freqIn.push({ from: me.id, ts: Date.now(), note: String(b.note || '').slice(0, 40) });
        await saveDB();
        return ok(res, { rel: 'out', msg: '申请已发送' });
      }

      /* ---- 同意申请 ---- */
      if (p === '/papi/friends/accept' && req.method === 'POST') {
        const b = await body(req);
        const id = uidOf(b);
        if (!me.freqIn.some(function (r) { return r.from === id; })) return err(res, 404, '没有这条申请');
        const other = norm(DB.users[id]);
        if (!other) return err(res, 404, '玩家不存在');
        if (me.friends.length >= FMAX) return err(res, 403, '好友数已达上限');
        me.freqIn = me.freqIn.filter(function (r) { return r.from !== id; });
        other.freqOut = other.freqOut.filter(function (r) { return r.to !== me.id; });
        if (me.friends.indexOf(id) < 0) me.friends.push(id);
        if (other.friends.indexOf(me.id) < 0) other.friends.push(me.id);
        await saveDB();
        return ok(res, { msg: '已添加好友' });
      }

      /* ---- 拒绝申请 ---- */
      if (p === '/papi/friends/reject' && req.method === 'POST') {
        const b = await body(req);
        const id = uidOf(b);
        me.freqIn = me.freqIn.filter(function (r) { return r.from !== id; });
        const other = norm(DB.users[id]);
        if (other) other.freqOut = other.freqOut.filter(function (r) { return r.to !== me.id; });
        await saveDB();
        return ok(res, { msg: '已拒绝' });
      }

      /* ---- 删除好友（双向，且顺手清空双方残留申请） ---- */
      if (p === '/papi/friends/del' && req.method === 'POST') {
        const b = await body(req);
        const id = uidOf(b);
        me.friends = me.friends.filter(function (x) { return x !== id; });
        me.freqIn = me.freqIn.filter(function (r) { return r.from !== id; });
        me.freqOut = me.freqOut.filter(function (r) { return r.to !== id; });
        const other = norm(DB.users[id]);
        if (other) {
          other.friends = other.friends.filter(function (x) { return x !== me.id; });
          other.freqIn = other.freqIn.filter(function (r) { return r.from !== me.id; });
          other.freqOut = other.freqOut.filter(function (r) { return r.to !== me.id; });
        }
        await saveDB();
        return ok(res, { msg: '已删除好友' });
      }

      /* ---- 拉黑 / 解除拉黑 ---- */
      if (p === '/papi/friends/block' && req.method === 'POST') {
        const b = await body(req);
        const id = uidOf(b);
        if (!id) return err(res, 400, '缺少目标玩家');
        if (id === String(me.id)) return err(res, 400, '不能拉黑自己');
        const on = b.on !== false;
        if (on) {
          if (me.blocked.indexOf(id) < 0) me.blocked.push(id);
          me.friends = me.friends.filter(function (x) { return x !== id; });
          me.freqIn = me.freqIn.filter(function (r) { return r.from !== id; });
          me.freqOut = me.freqOut.filter(function (r) { return r.to !== id; });
          const other = norm(DB.users[id]);
          if (other) {
            other.friends = other.friends.filter(function (x) { return x !== me.id; });
            other.freqIn = other.freqIn.filter(function (r) { return r.from !== me.id; });
            other.freqOut = other.freqOut.filter(function (r) { return r.to !== me.id; });
          }
        } else {
          me.blocked = me.blocked.filter(function (x) { return x !== id; });
        }
        await saveDB();
        return ok(res, { msg: on ? '已拉黑' : '已解除拉黑' });
      }

      return err(res, 404, 'not found');
    }

    /* ============ 房间：真实房间 + 邀请必须同意 ============ */
    if (p.indexOf('/papi/rooms') === 0) {
      const s = getSession(req);
      if (!s || s.role !== 'user') return err(res, 401, '未登录');
      const me = DB.users[s.uid];
      if (!me) return err(res, 401, '账号不存在');
      const uid = String(me.id);
      const now = Date.now();
      const RMAX = 20;                       /* 我同时挂着的房间数上限 */

      /* 闲置清理：机器人房 3 分钟 / 其它房 15 分钟无活动 → 自动解散（桌上钱先退回） */
      await reapIdleRooms(false);
      /* 兜底：超过 24h 的历史房间一律清掉（同样先退款，绝不能直接删） */
      let rdirty = false;
      for (const k in ROOMS.rooms) {
        const r = ROOMS.rooms[k];
        if (!r || now - (r.actAt || r.createdAt || 0) > ROOM_KEEP) {
          try { pokerTable.releaseRoom(r.no); } catch (e) { }
          delete ROOMS.rooms[k]; rdirty = true;
        }
      }
      if (rdirty) await saveRooms();

      const noOf = function (b) { return String((b && b.no) || u.searchParams.get('no') || '').trim(); };
      const findByNo = function (no) {
        for (const k in ROOMS.rooms) { if (ROOMS.rooms[k] && ROOMS.rooms[k].no === no) return ROOMS.rooms[k]; }
        return null;
      };
      const findById = function (id) { return (id && ROOMS.rooms[id]) || null; };
      const seatOf = function (r, id) { return (r.seats || []).filter(function (x) { return x.uid === id; })[0] || null; };
      const invOf = function (r, id) { return (r.invites || []).filter(function (x) { return x.uid === id; })[0] || null; };
      const myRooms = function () {
        const out = [];
        for (const k in ROOMS.rooms) {
          const r = ROOMS.rooms[k]; if (!r) continue;
          const iv = invOf(r, uid);
          if (r.owner === uid || seatOf(r, uid) || (iv && iv.status !== 'declined')) out.push(r);
        }
        out.sort(function (a, b) { return (b.actAt || b.createdAt) - (a.actAt || a.createdAt); });
        return out;
      };


      /* QA4H maintenance gate: block new tables while maintenance.on */
      const maintBlock = function () {
        try {
          const m = CONFIG && CONFIG.maintenance;
          if (m && (m.on === true || m.on === 1 || m.on === '1')) {
            return String((m && m.msg) || '系统维护中，请稍后再来');
          }
        } catch (e) {}
        return null;
      };

      /* ---- 创建房间（房主自动入座）---- */
      if (p === '/papi/rooms/create' && req.method === 'POST') {
        const _mb = maintBlock(); if (_mb) return err(res, 503, _mb);
        const b = await body(req);
        const mk = String(b.modeKey || b.mode || '').trim();
        const modeKey = ROOM_MODES.indexOf(mk) >= 0 ? mk : 'nlh';
        const meta = MODE_META[modeKey] || MODE_META.nlh;
        let sb = U(+b.sb) || (function () { try { var bl = (CONFIG && CONFIG.lobby && CONFIG.lobby.blinds) || []; for (var i = 0; i < bl.length; i++) { var v = parseFloat(String(bl[i] || '').split('/')[0]); if (isFinite(v) && v > 0) return v; } } catch (e) { } return 1; })();
        sb = U(Math.max(0.01, Math.min(100000, sb)));
        let bb = U(+b.bb);
        if (!(bb > 0)) bb = U(sb * 2);
        bb = U(Math.max(sb, Math.min(200000, bb)));
        /* cap 不允许超过玩法本身的上限（单挑最多 2 座、Spin 最多 3 座），杜绝「9 人单挑桌」 */
        const cap = Math.max(2, Math.min(meta.cap, Math.round(+b.cap) || meta.cap));
        if (myRooms().length >= RMAX) return err(res, 403, '你的房间太多了，先退出或关闭几个');
        const id = 'r' + newId();
        const r = {
          id: id, no: newRoomNo(),
          name: String(b.name || '').trim().slice(0, 20) || (me.name + '的房间'),
          modeKey: modeKey, sb: sb, bb: bb, cap: cap,
          ante: Math.max(0, Math.round(+b.ante) || 0), straddle: !!b.straddle,
          priv: (String(b.priv || '').trim() === 'private' || b.private === 1 || b.private === true) ? 'private' : 'public',
          passwd: String(b.passwd || '').slice(0, 12),
          /* ★ 2026-10-05：botFill 只有「机器人房」入口才会传 true。
             默认 false —— 任何老房间 / 好友房都不可能被塞进 bot（产品铁律：机器人不进真人的房）。 */
          botFill: (b.botFill === true || b.botFill === 1 || String(b.botFill) === 'true'),
          owner: uid, createdAt: now, actAt: now,
          seats: [{ uid: uid, name: me.name, color: me.color, joinedAt: now }],
          invites: []
        };
        ROOMS.rooms[id] = r;
        await evictAndSave(r, uid);          /* ★ 同账号只能在一个房间：把自己在别的房间的座位清掉 */
        await saveRooms();
        return ok(res, { room: roomPublic(r, uid) });
      }

      /* ---- 快速开始：找 / 建一个「机器人房」，点一下立刻有桌打（2026-10-05）----
         ★ 只可能返回 botFill=true 的房间。真人的自建房 / 好友房永不参与匹配。 */
      if (p === '/papi/rooms/quickstart' && req.method === 'POST') {
        const _mb = maintBlock(); if (_mb) return err(res, 503, _mb);
        const b = await body(req);
        const mk = String(b.modeKey || b.mode || '').trim();
        const modeKey = ROOM_MODES.indexOf(mk) >= 0 ? mk : 'nlh';
        const meta = MODE_META[modeKey] || MODE_META.nlh;
        let sb = U(+b.sb) || (function () { try { var bl = (CONFIG && CONFIG.lobby && CONFIG.lobby.blinds) || []; for (var i = 0; i < bl.length; i++) { var v = parseFloat(String(bl[i] || '').split('/')[0]); if (isFinite(v) && v > 0) return v; } } catch (e) { } return 1; })();
        sb = U(Math.max(0.01, Math.min(100000, sb)));
        const cap = Math.max(2, Math.min(meta.cap, Math.round(+b.cap) || meta.cap));
        /* ① 优先塞进已有的、同玩法同盲注的机器人房（有人气、开局快，也省房间数） */
        let cand = null, best = -1;
        for (const k in ROOMS.rooms) {
          const r = ROOMS.rooms[k];
          if (!r || !r.botFill || r.priv !== 'public') continue;
          if (r.modeKey !== modeKey || r.sb !== sb) continue;
          if ((r.seats || []).length >= r.cap) continue;
          const n = (r.seats || []).length;
          if (n > best) { best = n; cand = r; }   /* 挑人最多的那桌，最快凑满 */
        }
        if (cand) {
          if (!(cand.seats || []).some(function (s) { return s.uid === uid; }))
            cand.seats.push({ uid: uid, name: me.name, color: me.color, joinedAt: now });
          cand.actAt = now;
          await evictAndSave(cand, uid);
          await saveRooms();
          return ok(res, { room: roomPublic(cand, uid), created: false });
        }
        /* ② 没有现成的就建一间 */
        if (myRooms().length >= RMAX) return err(res, 403, '你的房间太多了，先退出或关闭几个');
        const id2 = 'r' + newId();
        const r2 = {
          id: id2, no: newRoomNo(),
          name: (meta.name || '德州扑克'),   /* ★ 2026-10-09：去掉「· 机器人房」后缀，不暴露机器人房（统计/后台记录原样显示房名） */
          modeKey: modeKey, sb: sb, bb: sb * 2, cap: cap,
          ante: Math.max(0, Math.round(+b.ante) || 0), straddle: !!b.straddle,
          priv: 'public', passwd: '',
          botFill: true,
          owner: uid, createdAt: now, actAt: now,
          seats: [{ uid: uid, name: me.name, color: me.color, joinedAt: now }],
          invites: []
        };
        ROOMS.rooms[id2] = r2;
        await evictAndSave(r2, uid);
        await saveRooms();
        return ok(res, { room: roomPublic(r2, uid), created: true });
      }

      /* ---- 公开房间列表（大厅用）---- */
      if (p === '/papi/rooms/list' && req.method === 'GET') {
        const out = [];
        for (const k in ROOMS.rooms) {
          const r = ROOMS.rooms[k]; if (!r || r.priv !== 'public') continue;
          if ((r.seats || []).length >= r.cap) continue;
          out.push(r);
        }
        out.sort(function (a, b) { return (b.actAt || b.createdAt) - (a.actAt || a.createdAt); });
        return ok(res, { list: out.slice(0, 30).map(function (r) { return roomPublic(r, uid); }) });
      }

      /* ---- 我的房间（我建的 / 我在里面的 / 我受邀的）---- */
      if (p === '/papi/rooms/mine' && req.method === 'GET') {
        return ok(res, { list: myRooms().slice(0, RMAX).map(function (r) { return roomPublic(r, uid); }) });
      }

      /* ---- 我的邀请收件箱：谁邀请我、哪个房间、什么玩法 ---- */
      if (p === '/papi/rooms/invites' && req.method === 'GET') {
        const out = [];
        for (const k in ROOMS.rooms) {
          const r = ROOMS.rooms[k]; if (!r) continue;
          const iv = invOf(r, uid);
          if (!iv || iv.status !== 'pending') continue;
          if (now - (iv.ts || 0) > ROOM_INVITE_TTL) continue;      /* 过期的不显示 */
          if (seatOf(r, uid)) continue;                             /* 已经在里面了就不是「邀请」 */
          out.push({
            no: r.no, id: r.id, name: r.name, modeKey: r.modeKey, sb: r.sb, bb: r.bb,
            hasPwd: !!r.passwd, ts: iv.ts,
            from: r.owner, fromName: (DB.users[r.owner] && DB.users[r.owner].name) || '玩家',
            fromColor: (DB.users[r.owner] && DB.users[r.owner].color) || '#3b8cff',
            seats: (r.seats || []).length, cap: r.cap
          });
        }
        out.sort(function (a, b) { return b.ts - a.ts; });
        return ok(res, { list: out.slice(0, 30) });
      }

      /* ---- 房间详情（凭房间号）---- */
      if (p === '/papi/rooms/detail' && req.method === 'GET') {
        const r = findByNo(noOf(null)) || findById(String(u.searchParams.get('id') || ''));
        if (!r) return err(res, 404, '房间不存在或已解散');
        return ok(res, { room: roomPublic(r, uid) });
      }

      /* ---- 加入房间 ★ 私有房铁律：必须「房主」或「已接受的邀请」 ---- */
      if (p === '/papi/rooms/join' && req.method === 'POST') {
        const _mb = maintBlock(); if (_mb) return err(res, 503, _mb);
        const b = await body(req);
        const r = findByNo(noOf(b)) || findById(String(b.id || ''));
        if (!r) return err(res, 404, '房间不存在或已解散');
        if (r.priv === 'private') {
          const iv = invOf(r, uid);
          const allowed = (r.owner === uid) || !!seatOf(r, uid) || (iv && iv.status === 'accepted');
          if (!allowed) {
            return err(res, 403, (iv && iv.status === 'pending')
              ? '你还没接受这个房间的邀请，接受后才能进来'
              : '这是私有房，需要房主邀请、并且你同意后才能进入');
          }
        }
        if (r.passwd && String(b.passwd || '') !== String(r.passwd)) return err(res, 403, '房间密码不正确');
        if (!seatOf(r, uid) && (r.seats || []).length >= r.cap) return err(res, 403, '房间已满');
        if (!seatOf(r, uid)) {
          await evictAndSave(r, uid);        /* ★ 同账号只能在一个房间 */
          r.seats.push({ uid: uid, name: me.name, color: me.color, joinedAt: now });
        }
        const iv2 = invOf(r, uid);
        if (iv2 && iv2.status !== 'accepted') iv2.status = 'accepted';
        r.actAt = now;
        await saveRooms();
        return ok(res, { room: roomPublic(r, uid) });
      }

      /* ---- 离开房间（房主离开则转让；没人了就解散）---- */
      if (p === '/papi/rooms/leave' && req.method === 'POST') {
        const b = await body(req);
        const r = findByNo(noOf(b)) || findById(String(b.id || ''));
        if (!r) return err(res, 404, '房间不存在');
        r.seats = (r.seats || []).filter(function (x) { return x.uid !== uid; });
        r.invites = (r.invites || []).filter(function (x) { return x.uid !== uid; });
        /* 2026-10-04 P0：离座先把桌上余额结回账户（房间侧只管座位，钱归牌桌管） */
        try { pokerTable.releaseSeat(r.no, uid); } catch (e) {}
        if (r.owner === uid) {
          if (r.seats.length) { r.owner = r.seats[0].uid; }
          else { try { pokerTable.releaseRoom(r.no); } catch (e) {} delete ROOMS.rooms[r.id]; }
        }
        if (ROOMS.rooms[r.id]) { r.actAt = now; }
        await saveRooms();
        reapOrphanTableBank();   /* ★ 房间解散/转让后，回收离场玩家的孤儿桌上筹码 */
        return ok(res, { msg: '已离开房间' });
      }

      /* ---- 邀请好友（只有房主能邀请，且必须是好友）---- */
      if (p === '/papi/rooms/invite' && req.method === 'POST') {
        const b = await body(req);
        const r = findByNo(noOf(b)) || findById(String(b.id || ''));
        if (!r) return err(res, 404, '房间不存在');
        if (r.owner !== uid) return err(res, 403, '只有房主可以邀请好友');
        const to = String((b && (b.uid || b.to || b.id2 || '')) || '').trim();
        if (!to) return err(res, 400, '缺少目标好友');
        if (to === uid) return err(res, 400, '不用邀请自己');
        const other = DB.users[to];
        if (!other || other.banned) return err(res, 404, '玩家不存在');
        if ((me.friends || []).indexOf(to) < 0) return err(res, 403, '只有好友才能被邀请进房间');
        if ((other.blocked || []).indexOf(uid) >= 0) return err(res, 403, '对方暂时无法接收邀请');
        r.invites = r.invites || [];
        const old = invOf(r, to);
        if (old) {
          if (old.status === 'accepted') return ok(res, { msg: '对方已经在这个房间了', status: 'accepted' });
          old.status = 'pending'; old.ts = now; old.by = uid;
        } else {
          if (r.invites.length >= 30) return err(res, 403, '本房间邀请太多了');
          r.invites.push({ uid: to, status: 'pending', ts: now, by: uid });
        }
        r.actAt = now;
        await saveRooms();
        return ok(res, { msg: '邀请已发送，等对方同意', status: 'pending', to: to });
      }

      /* ---- 接受邀请：先置 accepted，再真正入座 ---- */
      if (p === '/papi/rooms/invite/accept' && req.method === 'POST') {
        const b = await body(req);
        const r = findByNo(noOf(b)) || findById(String(b.id || ''));
        if (!r) return err(res, 404, '房间不存在或已解散');
        const iv = invOf(r, uid);
        if (!iv || iv.status === 'declined') return err(res, 404, '没有这条邀请');
        if (iv.status !== 'accepted') { iv.status = 'accepted'; iv.ts = now; }
        if ((r.seats || []).length >= r.cap && !seatOf(r, uid)) return err(res, 403, '房间已满');
        if (!seatOf(r, uid)) {
          await evictAndSave(r, uid);        /* ★ 同账号只能在一个房间 */
          r.seats.push({ uid: uid, name: me.name, color: me.color, joinedAt: now });
        }
        r.actAt = now;
        await saveRooms();
        return ok(res, { room: roomPublic(r, uid), msg: '已接受邀请并入座' });
      }

      /* ---- 拒绝邀请 ---- */
      if (p === '/papi/rooms/invite/decline' && req.method === 'POST') {
        const b = await body(req);
        const r = findByNo(noOf(b)) || findById(String(b.id || ''));
        if (!r) return err(res, 404, '房间不存在');
        const iv = invOf(r, uid);
        if (iv) { iv.status = 'declined'; iv.ts = now; }
        r.seats = (r.seats || []).filter(function (x) { return x.uid !== uid; });
        r.actAt = now;
        await saveRooms();
        return ok(res, { msg: '已拒绝邀请' });
      }

      /* ---- 房主解散房间 ---- */
      if (p === '/papi/rooms/close' && req.method === 'POST') {
        const b = await body(req);
        const r = findByNo(noOf(b)) || findById(String(b.id || ''));
        if (!r) return err(res, 404, '房间不存在');
        if (r.owner !== uid) return err(res, 403, '只有房主可以解散房间');
        /* 2026-10-04 P0：解散房间前把桌上余额全部结回账户（原来直接删房间 → 筹码蒸发） */
        try { pokerTable.releaseRoom(r.no); } catch (e) {}
        delete ROOMS.rooms[r.id];
        await saveRooms();
        reapOrphanTableBank();
        return ok(res, { msg: '房间已解散' });
      }

      return err(res, 404, 'not found');
    }

    /* ============ 钱包：充值 / 提现 / 我的订单 ============ */
    /* 配置与额度（前端进入充值页时拉取） */
    if (p === '/papi/wallet/quote' && req.method === 'GET') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const u = DB.users[s.uid]; if (!u) return err(res, 401, '账号不存在');
      const cfg = payCfg();
      return ok(res, {
        pay: payPublic(cfg),
        kyc: { required: cfg.kycRequired !== false, verified: u.kyc !== false },
        used: { recharge: usedQuota(u.id, 'recharge'), withdraw: usedQuota(u.id, 'withdraw') },
        bal: Math.max(0, Math.round(+u.bal || 0)),
        chips: Math.max(0, Math.round(+u.bal || 0)),
        usdt: U(+u.bal || 0)
      });
    }

    /* ---- 充值下单 ---- */
    if (p === '/papi/wallet/deposit' && req.method === 'POST') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const u = DB.users[s.uid]; if (!u) return err(res, 401, '账号不存在');
      const cfg = payCfg();
      if (cfg.enabled === false) return err(res, 403, '充值功能已关闭');
      if (cfg.kycRequired !== false && u.kyc === false) return err(res, 403, '请先完成实名认证');
      const b = await body(req);
      const net = String(b.net || 'TRC20').toUpperCase();
      if (depositNets(cfg).indexOf(net) < 0) return err(res, 400, '不支持的链上网络');
      /* ★ 2026-10-05 USDT 化：充值按 USDT（元）计价，内部 ×100 存成「分」整数。
         兼容老客户端传 chips（那时它就是分，数值一致）。 */
      let usdt = U(+(b.usdt || 0));
      if (!(usdt > 0)) usdt = U(+(b.chips || 0));
      let chips = usdt;
      if (!(chips > 0)) return err(res, 400, '请填写充值金额');
      const bad = limCheck(usdt, u.id, 'recharge');
      if (bad) return err(res, 400, bad);
      /* ★ 2026-10-02：链上收款 —— 从后台维护的地址簿里分配一个该网络的收款地址。
         地址簿为空 / 未配置时仍返回 null，前端照旧提示「待运营方配置」，不会出现假地址。 */
      const assign = extraApi.chain || null;
      const slot = assign ? assign.assign(net, u.id) : null;
      const winMin = Math.max(5, Math.round(+(((CONFIG.pay && CONFIG.pay.chain) || {}).windowMin) || 60));
      const pay = slot ? {
        provider: 'usdt-chain', address: slot.address, memo: slot.tag || null, qr: slot.address,
        addrId: slot.id, label: slot.label,
        expireAt: Date.now() + winMin * 60000,
        note: '请用 ' + net + ' 网络向该地址转入 ' + usdt + ' USDT（金额需一致）。达到确认数后系统自动到账，通常 1~3 分钟。'
      } : payCreate(null);
      const o = {
        id: newOrderId(), uid: u.id, user: u.name, type: 'recharge', net: net,
        usdt: usdt, chips: chips, fee: 0, netAmount: usdt, unit: 'usdt',
        address: slot ? slot.address : null, addrId: slot ? slot.id : '', txid: '',
        status: 'pending', note: '', createdAt: Date.now(), updatedAt: Date.now(),
        expireAt: slot ? pay.expireAt : 0, history: []
      };
      ORDERS.list.unshift(o);
      if (ORDERS.list.length > 2000) ORDERS.list.length = 2000;
      await saveOrders();
      audit(u.name, 'deposit-create', o.id, '充值 ' + usdt + ' USDT · ' + net + (slot ? ' · 地址 ' + slot.address.slice(0, 10) + '…' : ' · 未配置收款地址'), ip);
      return ok(res, { order: orderPublic(o), pay: pay });
    }

    /* ---- 提现申请（从 USDT 余额提；提交即冻结扣减；驳回后退回 USDT 余额） ----
       ★ 口径（用户 2026-10-01 明确）：筹码必须先「兑换成 USDT」才能提现 USDT；
         兑换免费（1 USDT = chipPerUsdt 筹码）；提现单笔固定收 2 USDT；提现不限额度。 */
    if (p === '/papi/wallet/withdraw' && req.method === 'POST') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const u = DB.users[s.uid]; if (!u) return err(res, 401, '账号不存在');
      const cfg = payCfg();
      if (cfg.enabled === false) return err(res, 403, '提现功能已关闭');
      if (cfg.kycRequired !== false && u.kyc === false) return err(res, 403, '请先完成实名认证');
      const b = await body(req);
      /* 前端提交的是「提现 USDT 金额」（USDT 化后账户余额即 USDT，无需先兑换） */
      const usdt = Math.round(+(b.usdt || 0) * 100) / 100;
      const addr = String(b.address || '').trim();
      const net = String(b.net || 'TRC20').toUpperCase();
      if ((cfg.nets || []).indexOf(net) < 0) return err(res, 400, '不支持的链上网络');
      if (!(usdt > 0)) return err(res, 400, '请填写提现金额');
      if (addr.length < 10) return err(res, 400, '请填写收款地址');
      /* ★ 2026-10-05 审计修复：设置过支付密码的账号，提现必须验证支付密码（与转账同口径） */
      if (u.paypwd && !verifyPw(String(b.pwd || ''), u.paypwd)) return err(res, 403, '支付密码错误');
      const bal = U(+u.bal || 0);
      if (usdt > bal) return err(res, 400, '超出可提现 USDT 余额（当前 ' + bal + ' USDT）');
      const feeFlat = Math.round((+cfg.feeFlat || 0) * 100) / 100;
      if (usdt <= feeFlat) return err(res, 400, '提现金额需大于手续费 ' + feeFlat + ' USDT');
      /* ★ 提现不限额度：这里刻意不调 limCheck()。充值仍走限额（见上面 deposit 分支）。 */
      const netAmount = Math.round((usdt - feeFlat) * 100) / 100;
      /* ★ 先构造订单对象、再扣余额：任何一步抛异常都不会出现「钱扣了却没有订单」的黑洞。 */
      const o = {
        id: newOrderId(), uid: u.id, user: u.name, type: 'withdraw', net: net,
        usdt: usdt, chips: usdt, fee: feeFlat, netAmount: netAmount, unit: 'usdt',
        address: addr, txid: '', status: 'pending', note: '',
        createdAt: Date.now(), updatedAt: Date.now(), history: []
      };
      ORDERS.list.unshift(o);
      u.bal = U((+u.bal || 0) - usdt);   /* ★ 提交即冻结（扣的是 USDT 余额，单位分） */
      if (ORDERS.list.length > 2000) ORDERS.list.length = 2000;
      await saveDB(); await saveOrders();
      audit(u.name, 'withdraw-create', o.id, '提现 ' + usdt + ' USDT（固定手续费 ' + feeFlat + ' USDT，实际到账 ' + netAmount + ' USDT）· ' + net, ip);
      return ok(res, { order: orderPublic(o), pay: payPayout(o), user: publicUser(u) });
    }

    /* ---- 筹码兑 USDT（免费：1 USDT = chipPerUsdt 筹码） ----
       ★ 这是提现的前置步骤：筹码 → USDT 余额 → 才能提现。
         兑换按当时汇率即时结算、不收费用，也不进订单六态（它不是资金出入，只是账内换算）。 */
    /* ★ 2026-10-05：全站改为 USDT 直接结算（已无筹码），「筹码兑 USDT」下线。
       保留路由返回可读提示，避免老客户端拿到莫名其妙的 404。 */
    if (p === '/papi/wallet/exchange' && req.method === 'POST') {
      return err(res, 410, '系统已升级为 USDT 直接结算，无需兑换：账户余额即 USDT，可直接提现');
    }

    /* ---- USDT 余额 → 筹码（U 兑筹码：把账户里已有的 USDT 余额转成可玩筹码）----
       ★ 与「筹码兑 USDT」(exchange) 互为逆操作，免费、即时、不走订单六态。
         用途：玩家把筹码兑换成 U 后，想把 U 再变回筹码上桌玩（当前系统只有 chips→U 这一条，
         导致「有 U 没筹码」的死局）。这些筹码来自真实 USDT，故同步加回可兑池 cashable
         —— 既可上桌玩，也能再次兑回 U，不会变成取不出来的死钱。风控闭环不被破坏：
         牌桌盈利（不在 cashable 内）依然无法兑成 U 提现。 */
    /* ★ 2026-10-05：USDT 化后不存在「U 换筹码」这一步（账户本身就是 USDT），下线。 */
    if (p === '/papi/wallet/usdt2chips' && req.method === 'POST') {
      return err(res, 410, '系统已升级为 USDT 直接结算：账户余额即 USDT，可直接上桌');
    }

    /* ---- 我的订单（只列充值 / 提现；旧版本的商品订单不混进来） ---- */
    if (p === '/papi/wallet/orders' && req.method === 'GET') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const mine = ORDERS.list.filter(function (o) {
        return o.uid === s.uid && (o.type === 'recharge' || o.type === 'withdraw');
      }).slice(0, 50).map(orderPublic);
      return ok(res, { list: mine, total: mine.length });
    }

    /* ---- 补充 TXID（充值凭证） ---- */
    if (p === '/papi/wallet/txid' && req.method === 'POST') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const b = await body(req);
      const o = ORDERS.list.filter(function (x) { return x.id === String(b.id || '') && x.uid === s.uid; })[0];
      if (!o) return err(res, 404, '订单不存在');
      if (o.status !== 'pending') return err(res, 400, '订单已进入处理流程，无法修改凭证');
      const txid = String(b.txid || '').trim();
      if (txid.length < 6) return err(res, 400, '请填写有效的交易哈希');
      o.txid = txid; o.updatedAt = Date.now();
      await saveOrders();
      return ok(res, { order: orderPublic(o) });
    }

    /* ---- 取消订单 ---- */
    let wm = /^\/papi\/wallet\/order\/(O\d+)\/cancel$/.exec(p);
    if (wm && req.method === 'POST') {
      const s = getSession(req); if (!s) return err(res, 401, '未登录');
      const o = ORDERS.list.filter(function (x) { return x.id === wm[1] && x.uid === s.uid; })[0];
      if (!o) return err(res, 404, '订单不存在');
      if (o.status !== 'pending') return err(res, 400, '该状态无法取消');
      o.updatedAt = Date.now();
      if (!o.history) o.history = [];
      o.history.push({ ts: Date.now(), act: 'cancel', to: 'rejected', admin: o.user, ip: ip });
      if (o.type === 'withdraw') {
        /* ★ 必须走 refundPocket：提现扣的是 USDT 余额，退的也得是 USDT 余额。
           这里原来写的是 `u.bal += o.chips`（旧口径），会把 USDT 换成筹码退回去 —— 双记。 */
        const back = refundPocket(o);
        o.status = 'refunded'; o.note = '玩家取消，' + (back || '额度已退回');
        await saveDB();
      } else {
        o.status = 'rejected'; o.note = '玩家取消';
      }
      await saveOrders();
      return ok(res, { order: orderPublic(o) });
    }

    /* ---- 俱乐部（玩家） ---- */
    if (p.indexOf('/papi/clubs') === 0) {
      const s = getSession(req);
      if (!s || s.role !== 'user') return err(res, 401, '请先登录');
      const b = (req.method === 'GET') ? {} : await body(req);
      req._u = u;
      const handled = await clubsApi.handlePlayer(req, res, p, b, s.uid, function (data) { ok(res, data); }, function (code, msg) { err(res, code, msg); });
      if (handled) return;
    }

    /* ============ 以下全部需要管理员会话 ============ */
    if (p.indexOf('/papi/admin/') === 0 && p !== '/papi/admin/login') {
      const s = getSession(req);
      if (!s || s.role !== 'admin') return err(res, 401, '未登录或会话已过期');
      req.admin = ADMIN_USER; req.sess = s;
      { /* 滑动续期：剩余不足一半自动续满，后台常用就不用反复登录 */
        const _cur = sessions.get(s.token);
        if (_cur && _cur.exp - Date.now() < ADMIN_TTL / 2) { _cur.exp = Date.now() + ADMIN_TTL; saveSessions(); }
      }
    }

    /* ---- 管理员登录 ---- */
    if (p === '/papi/admin/login' && req.method === 'POST') {
      const left = lockLeft(ip);
      if (left > 0) return err(res, 429, '尝试过于频繁，请 ' + left + ' 秒后再试');
      const b = await body(req, 8192);
      const uOk = safeEqual(String(b.user || ''), ADMIN_USER);
      const pOk = verifyPw(String(b.pwd || ''), ADMIN_HASH);
      if (!uOk || !pOk) {
        noteFail(ip);
        audit(String(b.user || '?'), 'admin-login-fail', '', 'ip=' + ip, ip);
        return err(res, 401, '账号或密码错误');
      }
      clearFail(ip);
      const token = mkSession('admin', 'admin', ip, ADMIN_TTL);
      audit(ADMIN_USER, 'admin-login', '', 'ip=' + ip, ip);
      return ok(res, { token: token, exp: Date.now() + ADMIN_TTL, user: ADMIN_USER });
    }
    if (p === '/papi/admin/logout' && req.method === 'POST') {
      if (req.sess) { sessions.delete(req.sess.token); saveSessions(); }
      return ok(res);
    }
    if (p === '/papi/admin/me') return ok(res, { user: ADMIN_USER, exp: req.sess.exp });

    /* ---- 俱乐部（管理） ---- */
    if (p.indexOf('/papi/admin/clubs') === 0) {
      const b = (req.method === 'GET' || req.method === 'DELETE') ? {} : await body(req);
      req._u = u;
      const handled = await clubsApi.handleAdmin(req, res, p, b, function (data) { ok(res, data); }, function (code, msg) { err(res, code, msg); });
      if (handled) return;
    }

    /* ---- 统计 ---- */
    if (p === '/papi/admin/stats' && req.method === 'GET') {
      const now = Date.now(), day = 86400000;
      let total = 0, banned = 0, today = 0, active = 0, chips = 0, vip = 0, vipExpiring = 0;
      for (const id in DB.users) {
        const u2 = DB.users[id]; total++;
        if (u2.banned) banned++;
        if (u2.createdAt > now - day) today++;
        if (u2.lastLogin > now - day) active++;
        if (u2.vip > 0) vip++;
        if (u2.vipExpire > now && u2.vipExpire < now + 7 * day) vipExpiring++;
        chips += U(+u2.bal || 0);
      }
      return ok(res, {
        stats: {
          total: total, banned: banned, newToday: today, activeToday: active,
          chipsTotal: chips, vip: vip, vipExpiring: vipExpiring, sessions: sessions.size,
          adminSessions: Array.from(sessions.values()).filter(s => s.role === 'admin').length
        }
      });
    }

    /* ---- 用户列表 ---- */
    if (p === '/papi/admin/users' && req.method === 'GET') {
      const q = String(u.searchParams.get('q') || '').trim().toLowerCase();
      const page = Math.max(1, +(u.searchParams.get('page') || 1));
      const size = Math.min(100, Math.max(5, +(u.searchParams.get('size') || 20)));
      const sort = u.searchParams.get('sort') || 'lastLogin';
      let list = Object.keys(DB.users).map(k => DB.users[k]);
      if (q) list = list.filter(x => x.name.toLowerCase().indexOf(q) >= 0 || x.id.indexOf(q) >= 0 || String(x.acc || '').toLowerCase().indexOf(q) >= 0);
      const cmp = {
        lastLogin: (a, b) => b.lastLogin - a.lastLogin,
        createdAt: (a, b) => b.createdAt - a.createdAt,
        chips: (a, b) => Math.max(0, Math.round(+b.bal || 0)) - Math.max(0, Math.round(+a.bal || 0)),
        vip: (a, b) => b.vip - a.vip,
        name: (a, b) => a.name.localeCompare(b.name)
      }[sort] || ((a, b) => b.lastLogin - a.lastLogin);
      list.sort(cmp);
      const total = list.length;
      const slice = list.slice((page - 1) * size, page * size).map(publicUser);
      return ok(res, { total: total, page: page, size: size, list: slice });
    }

    /* ---- 用户详情 ---- */
    let m = /^\/papi\/admin\/user\/([a-f0-9]+)$/i.exec(p);
    if (m && req.method === 'GET') {
      const user = DB.users[m[1]];
      if (!user) return err(res, 404, '用户不存在');
      return ok(res, { user: publicUser(user) });
    }

    /* ---- 修改用户 ---- */
    if (m && (req.method === 'PATCH' || req.method === 'POST')) {
      const user = DB.users[m[1]];
      if (!user) return err(res, 404, '用户不存在');
      const b = await body(req);
      const changes = [];
      if (typeof b.name === 'string' && b.name.trim().length >= 2) {
        const dup = findByName(b.name.trim());
        if (dup && dup.id !== user.id) return err(res, 409, '昵称已被占用');
        changes.push('昵称 ' + user.name + ' → ' + b.name.trim()); user.name = b.name.trim();
      }
      /* ★ 2026-10-05 USDT 化：b.usdt = 元（推荐）；b.chips 兼容老后台脚本（单位分）。 */
      let _cent = null;
      if (typeof b.usdt === 'number' && isFinite(b.usdt)) _cent = U(b.usdt);
      else if (typeof b.chips === 'number' && isFinite(b.chips)) _cent = U(b.chips);
      if (_cent !== null) {
        const nv = _cent;
        const old = Math.max(0, Math.round(+user.bal || 0));
        if (nv !== old) {
          changes.push('USDT ' + old.toFixed(2) + ' → ' + nv.toFixed(2)); user.bal = nv;
          user.cashable = U(+user.bal || 0);   /* 无闸门：余额即全部可提 */
          /* ★ 2026-10-06 交付审计：后台人工加/扣款必须进日账，否则「平台净利」和资金守恒对不上 */
          try { pokerTable.recordDailyAdjust(U(old - nv)); } catch (e) { }
        }
      }
      if (typeof b.diamonds === 'number' && isFinite(b.diamonds)) {
        const nv = Math.max(0, Math.round(b.diamonds));
        if (nv !== user.diamonds) { changes.push('钻石 ' + user.diamonds + ' → ' + nv); user.diamonds = nv; }
      }
      if (typeof b.vip === 'number' && isFinite(b.vip)) {
        const nv = Math.max(0, Math.min(8, Math.round(b.vip)));
        if (nv !== user.vip) { changes.push('VIP ' + user.vip + ' → ' + nv); user.vip = nv; }
      }
      /* ★ 等级改由「累计充值」自动计算（见 levelOfUser），后台手改一律忽略。
         要调等级就调他的累计充值 —— 只有真实充值订单 completed 才计入。 */
      if (typeof b.banned === 'boolean' && b.banned !== user.banned) {
        changes.push(b.banned ? '封禁' : '解封'); user.banned = b.banned;
      }
      if (typeof b.note === 'string') { changes.push('备注'); user.note = b.note.slice(0, 200); }
      if (typeof b.kyc === 'boolean' && b.kyc !== (user.kyc !== false)) {
        changes.push('实名认证 ' + (user.kyc !== false ? '已认证' : '未认证') + ' → ' + (b.kyc ? '已认证' : '未认证'));
        user.kyc = b.kyc;
      }
      if (typeof b.pwd === 'string' && b.pwd.length >= 6) { user.pwd = hashPw(b.pwd); changes.push('重置密码'); }
      await saveDB();
      audit(ADMIN_USER, 'user-edit', user.id + '(' + user.name + ')', changes.join('；') || '无改动', ip);
      return ok(res, { user: publicUser(user), changes: changes });
    }

    /* ---- 配置 ---- */
    if (p === '/papi/admin/config') {
      if (req.method === 'GET') return ok(res, { config: cfgForAdmin() });
      if (req.method === 'PUT' || req.method === 'POST') {
        const b = await body(req);
        const before = JSON.stringify(CONFIG);
        ['think', 'ai', 'econ', 'lobby', 'modes', 'maintenance', 'app', 'bots', 'reg'].forEach(k => {
          if (b.config && b.config[k] && typeof b.config[k] === 'object') {
            CONFIG[k] = Object.assign({}, CONFIG[k], b.config[k]);
          }
        });
        /* ★ tasks 不能走上面的浅合并：rewards 是「按任务 id 索引」的对象，
           浅合并时后台只提交一部分会把其余档位整个丢掉。这里改成按下标并；
           signin 数组则整体替换（档位数允许变）。 */
        if (b.config && b.config.tasks && typeof b.config.tasks === 'object') {
          const cur = (CONFIG.tasks && typeof CONFIG.tasks === 'object') ? CONFIG.tasks : {};
          const inc = b.config.tasks;
          const next = Object.assign({}, cur);
          if (Array.isArray(inc.signin) && inc.signin.length) {
            next.signin = inc.signin.slice(0, 14).map(v => { const n = Math.round(+v); return (isFinite(n) && n >= 0) ? n : 0; });
          }
          if (inc.signinTotal !== undefined) {
            const tn = Math.round(+inc.signinTotal);
            next.signinTotal = (isFinite(tn) && tn >= 0) ? tn : 0;
          }
          if (inc.rewards && typeof inc.rewards === 'object') {
            next.rewards = Object.assign({}, cur.rewards || {});
            Object.keys(inc.rewards).forEach(k => {
              const n = Math.round(+inc.rewards[k]);
              if (isFinite(n) && n >= 0) next.rewards[k] = n;
            });
          }
          CONFIG.tasks = next;
        }
        /* pay 走白名单合并：多余键（尤其地址类）进不来，limits/geo 也不会被整段覆盖 */
        if (b.config && b.config.pay && typeof b.config.pay === 'object') {
          /* ★ 链上收款配置（CONFIG.pay.chain）不在 pay 白名单里，
             payMerge 会把它整段丢掉 —— 保存参数配置时必须原样带回来，否则监控会静默停摆。 */
          const keepChain = (CONFIG.pay && CONFIG.pay.chain) || null;
          CONFIG.pay = payMerge(payCfg(), b.config.pay);
          if (keepChain) CONFIG.pay.chain = keepChain;
        }
        /* ★ 2026-10-05：第三方客服链接。白名单只接收 enabled 布尔 + url 字符串，
           url 必须是 http/https，杜绝 javascript: 等伪协议注入到前端 window.open。 */
        if (b.config && b.config.support && typeof b.config.support === 'object') {
          const s = b.config.support;
          const url = String(s.url || '').trim();
          const enabled = !!s.enabled;
          if (enabled && url && !/^https?:\/\//i.test(url)) {
            return err(res, 400, '客服链接必须以 http:// 或 https:// 开头');
          }
          CONFIG.support = { enabled: enabled, url: enabled ? url : '' };
        }
        /* Me / 我的 菜单文案（副标题 + 子页正文） */
        if (b.config && b.config.meContent && typeof b.config.meContent === 'object') {
          const cur = (CONFIG.meContent && typeof CONFIG.meContent === 'object') ? CONFIG.meContent : {};
          const inc = b.config.meContent;
          const next = Object.assign({}, cur);
          Object.keys(inc).forEach(function (k) {
            if (typeof inc[k] === 'string') next[k] = String(inc[k]).slice(0, 8000);
          });
          CONFIG.meContent = next;
        }
        await saveConfig();
        audit(ADMIN_USER, 'config-edit', '', diffKeys(before, JSON.stringify(CONFIG)), ip);
        return ok(res, { config: cfgForAdmin() });
      }
    }

    /* ---- 订单管理 ---- */
    if (p === '/papi/admin/orders' && req.method === 'GET') {
      const st = String(u.searchParams.get('status') || '').trim();
      const q = String(u.searchParams.get('q') || '').trim().toLowerCase();
      const page = Math.max(1, +(u.searchParams.get('page') || 1));
      const size = Math.min(100, Math.max(5, +(u.searchParams.get('size') || 20)));
      let list = ORDERS.list.slice();
      if (st) list = list.filter(function (o) { return o.status === st; });
      if (q) list = list.filter(function (o) {
        return o.id.toLowerCase().indexOf(q) >= 0 ||
          String(o.user || '').toLowerCase().indexOf(q) >= 0 ||
          String(o.uid || '').indexOf(q) >= 0 ||
          String(o.txid || '').toLowerCase().indexOf(q) >= 0;
      });
      const kpi = { pending: 0, frozen: 0, approved: 0, completed: 0, rejected: 0, refunded: 0, inSum: 0, outSum: 0 };
      ORDERS.list.forEach(function (o) {
        if (kpi[o.status] != null) kpi[o.status]++;
        if (o.status === 'completed' && o.type === 'recharge') kpi.inSum += o.usdt || 0;
        if (o.status === 'completed' && o.type === 'withdraw') kpi.outSum += o.usdt || 0;
      });
      kpi.inSum = Math.round(kpi.inSum * 100) / 100;
      kpi.outSum = Math.round(kpi.outSum * 100) / 100;
      return ok(res, {
        total: list.length, page: page, size: size, kpi: kpi,
        list: list.slice((page - 1) * size, page * size).map(orderPublic),
        /* 后台审核时需要看到「这笔提现按固定 2 USDT 扣」，所以把手续费一并下发 */
        pay: { provider: payCfg().provider || 'none', enabled: payCfg().enabled !== false, feeFlat: payCfg().feeFlat }
      });
    }

    /* ---- 订单审批：六态流转的唯一入口 ---- */
    let om = /^\/papi\/admin\/order\/(O\d+)\/(approve|reject|freeze|refund|complete)$/.exec(p);
    if (om && req.method === 'POST') {
      const o = ORDERS.list.filter(function (x) { return x.id === om[1]; })[0];
      if (!o) return err(res, 404, '订单不存在');
      const act = om[2] === 'complete' ? 'approve' : om[2];
      const r = orderTransition(o, act, ADMIN_USER, ip);
      if (!r.ok) return err(res, 400, r.msg);
      await saveDB(); await saveOrders();
      audit(ADMIN_USER, act + '-order', o.id,
        (o.type === 'recharge' ? '充值 ' : '提现 ') + o.usdt + ' USDT → ' + (OSTATES[r.to] || r.to) + (r.extra ? ' · ' + r.extra : ''), ip);
      return ok(res, { order: orderPublic(o), state: r.to, extra: r.extra || '' });
    }

    /* ---- ★ 2026-10-03：提现审核专用列表 ----
       运营（用户）口径：后台要一眼看清「谁的、提多少、扣多少手续费、实际打出多少、打到哪个收款账户」。
       通用订单表把地址挤在「凭证」列里还会被截断，这里单独成一页，字段全给、地址不截断。 */
    if (p === '/papi/admin/withdraws' && req.method === 'GET') {
      const st = String(u.searchParams.get('status') || '').trim();
      const q = String(u.searchParams.get('q') || '').trim().toLowerCase();
      const page = Math.max(1, +(u.searchParams.get('page') || 1));
      const size = Math.min(100, Math.max(5, +(u.searchParams.get('size') || 20)));
      let list = ORDERS.list.filter(function (o) { return o.type === 'withdraw'; });
      if (st) list = list.filter(function (o) { return o.status === st; });
      if (q) list = list.filter(function (o) {
        return o.id.toLowerCase().indexOf(q) >= 0 ||
          String(o.user || '').toLowerCase().indexOf(q) >= 0 ||
          String(o.uid || '').indexOf(q) >= 0 ||
          String(o.address || '').toLowerCase().indexOf(q) >= 0 ||
          String(o.txid || '').toLowerCase().indexOf(q) >= 0;
      });
      list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      const kpi = { frozen: 0, pending: 0, approved: 0, completed: 0, rejected: 0, refunded: 0, waitSum: 0, outSum: 0, feeSum: 0 };
      ORDERS.list.forEach(function (o) {
        if (o.type !== 'withdraw') return;
        if (kpi[o.status] != null) kpi[o.status]++;
        /* 还没真正打出去的钱：待审核 / 冻结 / 风控通过待出款 */
        if (o.status === 'pending' || o.status === 'frozen' || o.status === 'approved') kpi.waitSum += (+o.usdt || 0);
        if (o.status === 'completed') { kpi.outSum += (o.netAmount !== undefined && o.netAmount !== null) ? (+o.netAmount || 0) : (+o.usdt || 0); kpi.feeSum += (+o.fee || 0); }
      });
      ['waitSum', 'outSum', 'feeSum'].forEach(function (k) { kpi[k] = Math.round(kpi[k] * 100) / 100; });
      return ok(res, {
        total: list.length, page: page, size: size, kpi: kpi,
        feeFlat: payCfg().feeFlat,
        list: list.slice((page - 1) * size, page * size).map(orderPublic)
      });
    }

    /* ---- 出款后回填链上哈希（运营打完款把 TXID 记进来，方便对账 / 玩家查证） ---- */
    let txm = /^\/papi\/admin\/order\/(O\d+)\/txid$/.exec(p);
    if (txm && req.method === 'POST') {
      const o = ORDERS.list.filter(function (x) { return x.id === txm[1]; })[0];
      if (!o) return err(res, 404, '订单不存在');
      const b = await body(req);
      const txid = String((b && b.txid) || '').trim();
      if (txid.length < 6) return err(res, 400, '请填写有效的交易哈希');
      o.txid = txid; o.updatedAt = Date.now();
      if (!o.history) o.history = [];
      o.history.push({ ts: Date.now(), act: 'txid', to: o.status, admin: ADMIN_USER, ip: ip });
      await saveOrders();
      audit(ADMIN_USER, 'order-txid', o.id,
        '回填链上哈希 ' + txid.slice(0, 12) + '…（' + (o.type === 'withdraw' ? '出款' : '收款') + '）', ip);
      return ok(res, { order: orderPublic(o) });
    }

    /* ---- 支付与风控参数 ---- */
    if (p === '/papi/admin/pay') {
      if (req.method === 'GET') return ok(res, { pay: payCfg(), states: ORDER_STATES, stateText: OSTATES });
      if (req.method === 'PUT' || req.method === 'POST') {
        const b = await body(req);
        const src = (b && b.pay) || {};
        const next = payMerge(payCfg(), src);   /* ★ provider 只接受 none：接入要由持牌方工程师改代码 */
        const keepChain2 = (CONFIG.pay && CONFIG.pay.chain) || null;
        CONFIG.pay = next;
        if (keepChain2) CONFIG.pay.chain = keepChain2;   /* ★ 同上：别把链上配置冲掉 */
        await saveConfig();
        audit(ADMIN_USER, 'pay-config', '',
          '提现固定手续费=' + next.feeFlat + ' USDT 充值限额=' + JSON.stringify(next.limits) + '（提现不限额度） KYC=' + next.kycRequired, ip);
        return ok(res, { pay: payCfg() });
      }
    }

    /* ---- 审计日志 ---- */
    /* ---- 牌桌总览（只读；排查「玩家钱卡在桌上」/ 牌局卡死）---- */
    if (p === '/papi/admin/tables' && req.method === 'GET') {
      try { return ok(res, { list: pokerTable.adminList() }); }
      catch (e) { return ok(res, { list: [] }); }
    }

    /* ---- 房间总览（后台排查「房间怎么这么多」）---- */
    if (p === '/papi/admin/rooms' && req.method === 'GET') {
      const now2 = Date.now();
      const list = [];
      for (const k in ROOMS.rooms) {
        const r = ROOMS.rooms[k]; if (!r) continue;
        list.push({
          id: r.id, no: r.no, name: r.name, priv: r.priv, botFill: !!r.botFill,
          modeKey: r.modeKey, sb: r.sb, cap: r.cap,
          humans: roomHumans(r), seats: (r.seats || []).length,
          owner: r.owner, ownerName: (DB.users[r.owner] && DB.users[r.owner].name) || '-',
          idleMin: Math.round((now2 - (r.actAt || r.createdAt || now2)) / 60000)
        });
      }
      list.sort(function (a, b) { return b.idleMin - a.idleMin; });
      return ok(res, { list: list, tables: pokerTable.adminList().length });
    }
    /* ---- 一键清房：all=1 清全部；否则按 no / id 清指定房间（都先退款）---- */
    if (p === '/papi/admin/rooms/close' && req.method === 'POST') {
      const b2 = await body(req);
      const all = (b2 && (b2.all === 1 || b2.all === true || String(b2.all) === 'true'));
      let n = 0;
      if (all) {
        n = await reapIdleRooms(true);
      } else {
        const no2 = String((b2 && b2.no) || '').trim();
        const id2 = String((b2 && b2.id) || '').trim();
        for (const k of Object.keys(ROOMS.rooms)) {
          const r = ROOMS.rooms[k]; if (!r) continue;
          if (no2 && String(r.no) !== no2) continue;
          if (!no2 && id2 && String(r.id) !== id2) continue;
          try { pokerTable.releaseRoom(r.no); } catch (e) { }
          delete ROOMS.rooms[k]; n++;
        }
        if (n) { await saveRooms(); reapOrphanTableBank(); }
      }
      audit(ADMIN_USER, 'room-close', '', '关闭房间 ' + n + ' 间' + (all ? '（全部）' : ''), ip);
      return ok(res, { closed: n });
    }

    if (p === '/papi/admin/audit' && req.method === 'GET') {
      const limit = Math.min(500, +(u.searchParams.get('limit') || 100));
      let lines = [];
      try {
        lines = fs.readFileSync(fpath('audit.log'), 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse();
      } catch (e) { }
      return ok(res, { list: lines.map(l => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } }) });
    }

    return err(res, 404, 'not found');
  } catch (e) {
    console.error('[err]', p, e.message);
    return err(res, 500, 'server error');
  }
});

function diffKeys(a, b) {
  const oa = JSON.parse(a), ob = JSON.parse(b);
  const out = [];
  Object.keys(ob).forEach(k => {
    if (JSON.stringify(oa[k]) !== JSON.stringify(ob[k])) out.push(k);
  });
  return '修改分区: ' + (out.join(',') || '无');
}

/* ★ 房间心跳：只要还有人在打牌（轮询 state / 下注 / 聊天），房间就不算闲置 */
function touchRoom(no) {
  if (!no) return false;
  try {
    for (const k in ROOMS.rooms) {
      const r = ROOMS.rooms[k];
      if (r && String(r.no) === String(no)) { r.actAt = Date.now(); return true; }
    }
  } catch (e) { }
  return false;
}
/* 房间里还剩几个真人（房间侧 seats 只放真人；账号已删 / 机器人都不算） */
function roomHumans(r) {
  let n = 0;
  for (const s of ((r && r.seats) || [])) {
    if (!s || !s.uid) continue;
    const u = DB.users[String(s.uid)];
    if (!u) continue;
    if (u.isBot || u.bot) continue;
    n++;
  }
  return n;
}
/* ★ 闲置房间自动解散。force=true = 后台一键清空（无视时间，但仍全额退款） */
async function reapIdleRooms(force) {
  try {
    const now = Date.now();
    let closed = 0;
    for (const k of Object.keys(ROOMS.rooms)) {
      const r = ROOMS.rooms[k];
      if (!r) continue;
      if (force !== true) {
        const idle = now - (r.actAt || r.createdAt || 0);
        /* 机器人房没人 → 3 分钟就关（bot 互打没有意义，只会堆房间）；
           真人房没人 / 有人但长时间没动静 → 15 分钟关。 */
        const ttl = r.botFill ? ROOM_BOT_IDLE_CLOSE : ROOM_IDLE_CLOSE;
        if (idle <= ttl) continue;
      }
      try { pokerTable.releaseRoom(r.no); } catch (e) { }   /* 桌上余额全额退回 */
      delete ROOMS.rooms[k];
      closed++;
    }
    /* 数量收敛：机器人房最多 MAX_BOT_ROOMS 间 —— 从最久没动静的开始关，
       但座位上还有真人的绝不动手（宁可多留，也不能把正在玩的人踢了）。 */
    const botKeys = Object.keys(ROOMS.rooms).filter(function (k) { const r = ROOMS.rooms[k]; return r && r.botFill; });
    if (botKeys.length > MAX_BOT_ROOMS) {
      botKeys.sort(function (a, b) { return (ROOMS.rooms[a].actAt || 0) - (ROOMS.rooms[b].actAt || 0); });
      let over = botKeys.length - MAX_BOT_ROOMS;
      for (const k of botKeys) {
        if (over <= 0) break;
        const r = ROOMS.rooms[k];
        if (!r || roomHumans(r) > 0) continue;
        try { pokerTable.releaseRoom(r.no); } catch (e) { }
        delete ROOMS.rooms[k]; closed++; over--;
      }
    }
    if (closed) { await saveRooms(); reapOrphanTableBank(); }
    if (closed) console.log('[rooms] 自动解散 ' + closed + ' 间闲置房间');
    return closed;
  } catch (e) { return 0; }
}

server.listen(PORT, HOST, function () {
  ADMIN_HASH = hashPw(ADMIN_PASS);
  /* 启动即按历史充值订单重算每个人的累计充值 → 等级（老号无需手动刷） */
  try { var _n = migrateDepositTotal(); saveDB(); console.log('[level] 累计充值重算完成，账号数 ' + _n); } catch (e) { }
  console.log('[gu9-ui-api] listening on ' + HOST + ':' + PORT + '  admin=' + ADMIN_USER);
  reapOrphanTableBank();   /* ★ 启动即回收任何遗留的孤儿桌上筹码 */
  /* 启动 30s 后清一次历史遗留房间（留时间给在线玩家重连刷新心跳）；之后每 60s 巡检 */
  setTimeout(function () { reapIdleRooms(false); }, 30000).unref();
  setInterval(function () { reapIdleRooms(false); }, 60 * 1000).unref();
});






