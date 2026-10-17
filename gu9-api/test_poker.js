'use strict';
const P = require('./poker.js');

function runHand(table, strategy) {
  // strategy(t, seatIdx) -> {type, amt}
  let guard = 0;
  while (guard++ < 800) {
    const liveN = table.seats.filter(x => !x.empty && !x.folded).length;
    if (liveN <= 1) { if (P.advance(table) === 'showdown') break; continue; }
    if (P.roundDone(table)) { if (P.advance(table) === 'showdown') break; continue; }
    let idx = table.toAct;
    if (idx < 0) { if (P.advance(table) === 'showdown') break; continue; }
    const s = table.seats[idx];
    if (!s || s.folded) { table.toAct = P.nextSeat(table, idx); continue; }
    const d = strategy(table, idx);
    P.doAction(table, idx, d.type, d.amt);
    if (!P.roundDone(table) && table.status === 'playing') table.toAct = P.nextSeat(table, idx);
  }
  return table;
}

function freshTable() {
  const t = P.createTable({ mode: 'nlh', sb: 50, bb: 100, cap: 2 });
  P.seatPlayer(t, 0, { id: 'A', name: 'A', vip: 0 }, 1000);
  P.seatPlayer(t, 1, { id: 'B', name: 'B', vip: 0 }, 1000);
  t.heroSeat = 0; t.dealerSeat = 0;
  return t;
}

// 场景1：双方一直 call/check 到摊牌 -> 验证筹码守恒
(function () {
  const t = freshTable();
  const ok = P.startHand(t);
  if (!ok) { console.log('SC1 startHand 失败'); return; }
  runHand(t, (t, i) => {
    const call = P.toCall(t, t.seats[i]);
    return call > 0 ? { type: 'call' } : { type: 'check' };
  });
  const sum = t.seats.reduce((a, s) => a + s.chips, 0);
  const conserved = (sum + t.rake) === 2000;
  console.log('SC1 摊牌:', {
    status: t.status, street: t.street, pot: t.pot, rake: t.rake,
    chips: t.seats.map(s => s.chips), result: (t.result || []).map(r => r.name + '+' + r.amount + '(' + r.hand + ')'),
    conserved, sum
  });
  if (!conserved) console.log('  !!! 筹码不守恒');
})();

// 场景2：A 翻牌前直接弃牌 -> B 直接获胜
(function () {
  const t = freshTable();
  P.startHand(t);
  // 翻牌前 A 是 toAct（HU: 庄家=小盲先行动），A 弃牌
  let guard = 0;
  while (t.status === 'playing' && guard++ < 50) {
    const liveN = t.seats.filter(x => !x.empty && !x.folded).length;
    if (liveN <= 1) { P.advance(t); break; }
    const idx = t.toAct;
    if (idx < 0) { P.advance(t); break; }
    if (idx === 0) { P.doAction(t, 0, 'fold'); }
    else { const call = P.toCall(t, t.seats[1]); P.doAction(t, 1, call > 0 ? 'call' : 'check'); }
    if (t.status === 'playing' && !P.roundDone(t)) t.toAct = P.nextSeat(t, idx);
  }
  const liveN = t.seats.filter(x => !x.empty && !x.folded).length;
  console.log('SC2 弃牌获胜:', {
    status: t.status, liveN, chips: t.seats.map(s => ({ name: s.user.name, chips: s.chips, folded: s.folded })),
    result: (t.result || []).map(r => r.name + '+' + r.amount)
  });
})();

// 场景3：全下边池 - A 短码全下，B 跟注更多，验证边池
(function () {
  const t = P.createTable({ mode: 'nlh', sb: 50, bb: 100, cap: 2 });
  P.seatPlayer(t, 0, { id: 'A', name: 'A', vip: 0 }, 300);   // 短码
  P.seatPlayer(t, 1, { id: 'B', name: 'B', vip: 0 }, 1000);
  t.heroSeat = 0; t.dealerSeat = 0;
  P.startHand(t);
  runHand(t, (t, i) => {
    const s = t.seats[i];
    const call = P.toCall(t, s);
    if (call >= s.chips) return { type: 'call' };            // 没钱就 all-in call
    if (s.chips <= 300 && call === 0) return { type: 'raise', amt: s.chips }; // 短码 push
    if (call > 0) return { type: 'call' };
    return { type: 'check' };
  });
  console.log('SC3 全下边池:', {
    status: t.status, street: t.street, pot: t.pot, rake: t.rake,
    sidePots: t.sidePots.map(p => p.amount), chips: t.seats.map(s => s.chips),
    result: (t.result || []).map(r => r.name + '+' + r.amount)
  });
})();

// 场景4：检查牌力评估基本正确性
(function () {
  const mk = (r, s) => ({ r, s });
  const royal = [mk(14, 's'), mk(13, 's'), mk(12, 's'), mk(11, 's'), mk(10, 's')];
  const v = P.evalBest(royal, 'nlh');
  console.log('SC4 皇家同花顺 rank[0]=8? ->', v[0], v[0] === 8 ? 'OK' : 'FAIL');
  const pair = [mk(14, 's'), mk(14, 'h'), mk(2, 'd'), mk(3, 'c'), mk(7, 's')];
  const v2 = P.evalBest(pair, 'nlh');
  console.log('SC4 一对 rank[0]=1? ->', v2[0], v2[0] === 1 ? 'OK' : 'FAIL');
})();
