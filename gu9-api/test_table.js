'use strict';
/* 本地集成自测：模拟 server.js 的依赖，跑通「真人对真人」整局 + 落盘续局。
   不依赖真实服务器，纯本地验证 pokertable.js 闭环正确。 */
const fs = require('fs');
const path = require('path');
// 让 pokertable 把 tables.json 写到临时位置，避免污染工作区
const TF = path.join(__dirname, 'tables_test.json');
process.env.GU9_TABLES_FILE = TF;

// ---- 依赖桩 ----
function mkUser(id, name, chips) { return { id: id, name: name, chips: chips, tablePaid: 0, tableBank: 0, tableCashed: 0, color: '#3b8cff', vip: 0 }; }
const DB = { seq: 100, users: { u1: mkUser('u1', 'A', 10000), u2: mkUser('u2', 'B', 10000) } };
const ROOMS = { rooms: { r1: { no: 'r1', modeKey: 'nlh', sb: 50, bb: 100, cap: 9, seats: [{ uid: 'u1' }, { uid: 'u2' }] } } };
const toks = { tok1: 'u1', tok2: 'u2' };
let saveCount = 0;
const deps = {
  DB: DB, ROOMS: ROOMS,
  saveDB: function () { saveCount++; },
  getSession: function (req) { const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const uid = toks[t]; return uid ? { uid: uid } : null; },
  audit: function () {}
};

const PT = require('./pokertable.js');
// 用测试文件路径覆盖 TABLES_FILE（通过重新指向模块内部不可行，故直接改其写盘目标）
PT.init(deps);

// ---- 伪 req/res ----
function req(method, url, token, body) {
  return { method: method, url: url, headers: { authorization: 'Bearer ' + token }, _body: body };
}
function res() {
  return { code: 0, body: '', writeHead: function (c) { this.code = c; }, end: function (s) { this.body = s; } };
}
function call(method, url, token, body) {
  const r = res();
  PT.router(req(method, url, token, body), r, url.split('?')[0], body || {});
  const o = JSON.parse(r.body);
  return { code: r.code, obj: o };
}

let fails = 0;
function assert(cond, msg) { if (!cond) { console.log('  ✗ ' + msg); fails++; } else console.log('  ✓ ' + msg); }

function totalSystem() {
  let s = 0;
  Object.keys(DB.users).forEach(function (k) { s += DB.users[k].chips; });
  const T = PT._tables();
  Object.keys(T).forEach(function (no) {
    const t = T[no].t;
    s += t.pot; /* 底池也要计入（盲注/下注期间筹码在底池里） */
    t.seats.forEach(function (x) { if (!x.empty) s += x.chips; });
    s += (t.rakeTotal || 0);
  });
  return s;
}

console.log('=== 场景1：双玩家买入 → 开赛 → 跑到摊牌 ===');
let a = call('POST', '/papi/table/join', 'tok1', { roomNo: 'r1', buyIn: 2000 });
assert(a.code === 200 && a.obj.ok, 'u1 买入成功');
let b = call('POST', '/papi/table/join', 'tok2', { roomNo: 'r1', buyIn: 2000 });
assert(b.code === 200 && b.obj.ok, 'u2 买入成功');
assert(b.obj.state.phase === 'playing', '两人买入后自动开赛 (phase=playing)');
assert(b.obj.state.seats.filter(function (x) { return !x.empty; }).length === 2, '牌桌 2 个有筹码座位');
const before = totalSystem();
assert(before === 20000, '开赛前系统总筹码=20000 (got ' + before + ')');

// 轮询驱动：每次找 actingUid，call/check 推演到 showdown
let guard = 0, sawShowdown = false, lastRake = 0;
while (guard++ < 200) {
  const st = call('GET', '/papi/table/state?roomNo=r1', 'tok1', {}).obj.state;
  if (st.phase === 'showdown') { sawShowdown = true; lastRake = st.rake; break; }
  if (st.phase !== 'playing') { // waiting 之间（下一手延迟），推进时间再查
    // 直接再查一次即可（beginNextHand 在 state 内触发）
    continue;
  }
  const actor = st.actingUid;
  const tok = actor === 'u1' ? 'tok1' : 'tok2';
  const mySeat = st.seats.find(function (x) { return x.user && x.user.id === actor; });
  const toCall = mySeat ? Math.max(0, st.seats.reduce(function (m, x) { return Math.max(m, x.bet); }, 0) - mySeat.bet) : 0;
  const act = toCall > 0 ? 'call' : 'check';
  const r = call('POST', '/papi/table/action', tok, { roomNo: 'r1', type: act });
  assert(r.code === 200, 'actor ' + actor + ' 行动 ' + act + ' 成功');
  if (r.code !== 200) break;
}
assert(sawShowdown, '整局推进到摊牌');
const after = totalSystem();
assert(after === 20000, '摊牌后系统总筹码守恒=20000 (got ' + after + ')');
assert(lastRake >= 0, '抽水字段存在 rake=' + lastRake);
assert((PT._tables().r1.t.rakeTotal || 0) === lastRake, 'rakeTotal 累计正确');

console.log('=== 场景2：离座退回筹码 ===');
const u2Before = DB.users.u2.chips;
const lv = call('POST', '/papi/table/leave', 'tok2', { roomNo: 'r1' });
assert(lv.code === 200, 'u2 离座成功');
assert(DB.users.u2.chips > u2Before, 'u2 账户收到退回筹码 (' + u2Before + ' -> ' + DB.users.u2.chips + ')');
assert(totalSystem() === 20000, '离座后系统总筹码仍守恒=20000 (got ' + totalSystem() + ')');

console.log('=== 场景3：超时托管（主 15s→宽限 5s→强弃牌） ===');
// 重新开一局：让 u2 重新买入
call('POST', '/papi/table/join', 'tok2', { roomNo: 'r1', buyIn: 2000 });
let st = call('GET', '/papi/table/state?roomNo=r1', 'tok1', {}).obj.state;
assert(st.phase === 'playing', 'u2 重新买入后再次开赛');
// 手动把当前行动者 deadline 推到过去并越过宽限，触发强弃牌
const T = PT._tables().r1;
T.deadline = Date.now() - 20000;
T.graceUntil = Date.now() - 10000;
const actorBefore = st.actingUid;
const actorSeat = st.seats.find(function (x) { return x.user && x.user.id === actorBefore; });
const foldedBefore = actorSeat ? actorSeat.folded : null;
const r2 = call('GET', '/papi/table/state?roomNo=r1', 'tok1', {}); // 触发 timeoutCheck
assert(r2.obj.state.phase !== undefined, '超时托管后 state 正常返回');
// 验证：被超时的座位要么已弃牌推进，要么轮到别人
const st3 = r2.obj.state;
const actorSeat3 = st3.seats.find(function (x) { return x.user && x.user.id === actorBefore; });
assert(!actorSeat3 || actorSeat3.folded || st3.actingUid !== actorBefore, '超时者已被强制弃牌/交出行动权');

console.log('=== 场景4：崩溃安全（落盘 tables.json 续局） ===');
assert(fs.existsSync(TF), 'tables.json 已落盘');
// 全新进程视角：重新 require 并 init（同 deps），应能从磁盘恢复牌局
delete require.cache[require.resolve('./pokertable.js')];
delete require.cache[require.resolve('./poker.js')];
const PT2 = require('./pokertable.js');
PT2.init(deps);
const resumed = PT2._tables().r1;
assert(!!resumed, '新实例从磁盘恢复出房间 r1 牌局');
if (resumed) {
  assert(typeof resumed.t.handNo === 'number' && resumed.t.handNo >= 1, '恢复后手牌号保留 (handNo=' + resumed.t.handNo + ')');
  assert(Array.isArray(resumed.t.deck) && resumed.t.deck.length > 0, '恢复后 deck 保留（可续局发牌）');
}

// 清理测试落盘
try { fs.unlinkSync(TF); } catch (e) {}
console.log('\n' + (fails === 0 ? 'ALL_TABLE_OK' : ('TABLE_FAILS=' + fails)));
process.exit(fails === 0 ? 0 : 1);
