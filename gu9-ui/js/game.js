/* ===== game.js · 牌局引擎：牌力评估 / AI / 下注轮 / 边池 / 保险 ===== */
var SUITS = ['s', 'h', 'd', 'c'];
var SUIT_CH = { s: '♠', h: '♥', d: '♦', c: '♣' };
var RANK_CH = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

/* ---------- 主流玩法配置 ---------- */
var MODES = {
  nlh: {
    key: 'nlh', name: '无限注德州扑克', en: 'No Limit Hold\'em', hole: 2, bet: 'nolimit', minRank: 2, cap: 8, ante: 0,
    rake: { pct: 0.05, capBB: 3 }, tag: '最主流', hot: 1,
    intro: '每位玩家 2 张底牌 + 5 张公共牌，任选组合成最大 5 张牌型。可任意加注，最大可 All-in 全部余额。',
    enIntro: 'Two hole cards plus five community cards — make the best five-card hand. Bet any amount, up to All-in for your whole stack.',
    rules: ['发 2 张底牌，依次发出翻牌 3 张、转牌、河牌', '四轮下注：翻牌前 / 翻牌 / 转牌 / 河牌', '加注无上限，可随时 All-in', '盲注：小盲 / 大盲，可开强抓 Straddle 与前注 Ante', '常见变体：Ante 桌、Bomb Pot、Seven-Deuce 赏金局'],
    tips: '新手首选。位置、起手牌范围与余额管理是最重要的三项基本功。',
    enTips: 'Best for beginners: position, starting hand range and bankroll management are the three fundamentals.'
  },
  plo: {
    key: 'plo', name: '底池限注奥马哈', en: 'Pot Limit Omaha', hole: 4, bet: 'potlimit', minRank: 2, cap: 8, ante: 0, omaha: 1,
    rake: { pct: 0.05, capBB: 3 }, tag: '策略深',
    intro: '每位玩家 4 张底牌，必须「恰好使用 2 张底牌 + 3 张公共牌」组成牌型。最大只能下注一个底池。',
    enIntro: 'Four hole cards — you must use exactly two of them plus three community cards. The maximum bet is one pot.',
    rules: ['发 4 张底牌，成手必须用且仅用 2 张底牌', '底池限注：最大加注 = 当前底池 + 2 倍跟注额', '公共牌同样是 5 张（翻 3 / 转 / 河）', '常见强牌：同花连张 + 对子（如 A♠K♠Q♦J♦）', '听牌多、波动大，胜率优势通常更薄'],
    tips: '只打「可发展的强听牌」和坚果潜力牌，避免用单对去拼大底池。',
    enTips: 'Play strong drawing hands and nut potential; avoid stacking off with a bare pair.'
  },
  plo5: {
    key: 'plo5', name: '奥马哈5 / Big O', en: 'Five Card Omaha', hole: 5, bet: 'potlimit', minRank: 2, cap: 8, ante: 0, omaha: 1,
    rake: { pct: 0.05, capBB: 3 }, tag: '大波动',
    intro: '5 张底牌版本的奥马哈，同样必须用恰好 2 张底牌 + 3 张公共牌，牌力天花板更高、波动更大。',
    enIntro: 'Five-card Omaha: again exactly two hole cards plus three community cards, with bigger nut hands and bigger swings.',
    rules: ['发 5 张底牌，成手必须用且仅用 2 张底牌', '底池限注，最大加注为一个底池', '常见为 Big O（5 张奥马哈高低） 或纯高牌版本', '坚果牌要求更高，谨慎追第二坚果'],
    tips: '只追坚果，避免在大底池里用非坚果成手全下。',
    enTips: 'Chase only the nuts — never stack off with a non-nut hand in a big pot.'
  },
  omaha8: {
    key: 'omaha8', name: '奥马哈高低 Hi-Lo', en: 'Omaha Hi/Lo 8+', hole: 4, bet: 'potlimit', minRank: 2, cap: 8, ante: 0, omaha: 1, hilo: 1,
    rake: { pct: 0.05, capBB: 3 }, tag: '分池',
    intro: '4 张底牌奥马哈，底池由「最大牌型」与「8 低及以下的低牌」平分；无合格低牌时高牌全收。',
    enIntro: 'Four-card Omaha where the pot is split between the best high hand and the 8-or-better low; with no low, high scoops.',
    rules: ['成手必须用且仅用 2 张底牌 + 3 张公共牌', '低牌：5 张牌点数均 ≤ 8 且互不重复（A 算 1）', '低牌比较：从最大牌往下比，越小越好', '同时持有最高与最低（Scoop）可通吃整个底池', '无低牌时高牌独得底池'],
    tips: '优先起手 A-2-x-x 这类同时具备坚果低牌与同花潜力的牌。',
    enTips: 'Prioritise A-2-x-x hands with both nut-low and flush potential.'
  },
  short: {
    key: 'short', name: '短牌 6+', en: 'Short Deck', hole: 2, bet: 'nolimit', minRank: 6, cap: 8, ante: 0,
    rake: { pct: 0.05, capBB: 2.5 }, tag: '刺激',
    intro: '去掉 2~5 只保留 6~A 共 36 张牌，成牌概率大幅提升。特殊规则：同花 > 葫芦，A 可作 5 参与顺子（6-7-8-9-A）。',
    enIntro: 'A 36-card deck (6 to A): made hands are far more common. Flush beats full house, and A can play as 5 in a straight.',
    rules: ['牌堆 36 张（6 7 8 9 10 J Q K A）', '牌型顺序特殊：同花 > 葫芦', 'A 可作低牌：A-6-7-8-9 成立为顺子', '通常带 Ante，盲位结构常见 Button 下 Ante', '对子与听牌胜率显著高于标准德州'],
    tips: '起手牌范围大幅放宽，中等对子价值提升，注意同花与葫芦的大小关系反转。',
    enTips: 'Ranges widen a lot and mid pairs gain value — watch the flipped flush vs full house ranking.'
  },
  aof: {
    key: 'aof', name: 'All-in or Fold', en: 'AOF', hole: 2, bet: 'aof', minRank: 2, cap: 6, ante: 0,
    rake: { pct: 0.04, capBB: 2 }, tag: '极速',
    intro: '只能全下或弃牌，没有跟注与加注。每手牌在几秒内结束，节奏极快。',
    enIntro: 'All-in or fold only — no calling, no raising. Every hand is decided in seconds at breakneck speed.',
    rules: ['每手只有两个选项：All-in 或 Fold', '盲注按人数与位置自动分配', '通常 3~6 人桌，一手牌 5 秒内结束', '牌力与位置决定一切，无翻后操作'],
    tips: '收紧起手范围，只打前 15% 左右的强牌，位置越靠后越松。',
    enTips: 'Tighten up: play roughly the top 15% of hands, wider as you get closer to the button.'
  },
  rush: {
    key: 'rush', name: '极速桌 Rush & Cash', en: 'Rush & Cash', hole: 2, bet: 'nolimit', minRank: 2, cap: 6, ante: 0,
    rake: { pct: 0.05, capBB: 3 }, tag: '高频率',
    intro: '弃牌后立即被分配到新的牌桌继续下一手，无需等待，每小时手牌数翻倍。',
    enIntro: 'Fold and you are moved straight to a fresh table for the next hand — no waiting, double the hands per hour.',
    rules: ['弃牌后立刻换桌开新的一手', '牌池玩家为匿名轮换，降低被读牌风险', '常见 4~6 人桌', '适合大量手牌快速积累数据与返水'],
    tips: '节奏极快，适合熟悉标准的玩家刷手牌量与返水。',
    enTips: 'Perfect for grinding volume and rakeback once your standard game is solid.'
  },
  pineapple: {
    key: 'pineapple', name: '疯狂菠萝', en: 'Crazy Pineapple', hole: 3, bet: 'nolimit', minRank: 2, cap: 8, ante: 0, pineapple: 1,
    rake: { pct: 0.05, capBB: 3 }, tag: '趣味',
    intro: '发 3 张底牌，翻牌后弃掉 1 张，再用剩余 2 张 + 公共牌组成牌型。',
    enIntro: 'Three hole cards: discard one after the flop, then make your hand from the remaining two plus the board.',
    rules: ['每人发 3 张底牌', '翻牌发出后必须先弃 1 张底牌', '转牌前再弃 1 张（Crazy Pineapple 为翻牌后弃 1 张）', '其余规则与无限注德州一致'],
    tips: '多一张底牌让成牌率上升，起手牌价值整体提高，注意保留同花与连张潜力。',
    enTips: 'The extra card boosts made-hand frequency — keep flush and straight potential when discarding.'
  },
  sng: {
    key: 'sng', name: 'SNG 单桌赛', en: 'Sit & Go', hole: 2, bet: 'nolimit', minRank: 2, cap: 8, ante: 0,
    rake: { pct: 0, capBB: 0, fee: 0.1 }, tag: '赛事',
    intro: '满员即开的单桌锦标赛，报名费含赛事服务费（约 10%），按名次分配奖池。',
    enIntro: 'A single-table tournament that starts once full. The buy-in includes a fee and the pool pays out by finishing place.',
    rules: ['报名费 = 奖池 + 服务费（常见 5%~10%）', '盲注逐级上涨，余额不能带出牌桌', '按名次分配奖池，常见 6 人桌 3 名入奖', '不可中途买入（部分支持 Rebuy/Add-on）'],
    tips: '中后期 ICM 压力显著，短码要抢盲，大码要压制对手。',
    enTips: 'ICM pressure peaks late: short stacks should steal blinds, big stacks should apply pressure.'
  },
  mtt: {
    key: 'mtt', name: 'MTT 锦标赛', en: 'Multi-Table Tournament', hole: 2, bet: 'nolimit', minRank: 2, cap: 8, ante: 0,
    rake: { pct: 0, capBB: 0, fee: 0.1 }, tag: '大额奖池',
    intro: '多桌同时进行的大型锦标赛，设有保底奖池，逐桌合并直至决赛桌。',
    enIntro: 'A large multi-table tournament with a guaranteed prize pool; tables merge until the final table.',
    rules: ['固定开赛时间或达到人数即开赛', '盲注等级每 8~15 分钟上涨', '含 Ante 阶段与封盘休息', '奖池按名次分配，冠军占比最高', '支持重买 Rebuy / 加购 Add-on / 分阶段 Day2'],
    tips: '前期紧、中期抢、后期按 ICM 决策；关注泡沫期与奖励跳跃。',
    enTips: 'Tight early, aggressive mid, ICM-driven late — watch the bubble and pay jumps.'
  },
  spin: {
    key: 'spin', name: 'Spin & Go 随机奖池', en: 'Spin & Go', hole: 2, bet: 'nolimit', minRank: 2, cap: 3, ante: 0,
    rake: { pct: 0, capBB: 0, fee: 0.08 }, tag: '随机倍率',
    intro: '3 人超快速锦标赛，开赛前随机抽取奖池倍率（2x ~ 数万倍），一手定胜负节奏极快。',
    enIntro: 'A three-player hyper-turbo: the prize multiplier (2x up to tens of thousands) is drawn before the first hand.',
    rules: ['3 人桌，开赛即定奖池倍率', '初始余额通常为 25~50BB，盲注快速上涨', '冠军独得奖池（部分平台按名次）', '服务费约为报名费的 6%~10%'],
    tips: '浅余额对抗，熟记推牌/跟注范围表是关键。',
    enTips: 'Short-stack play — memorising push/fold charts is the key.'
  }
};
var RAKEBACK = [0, 0, 0, 0, 0, 1, 2, 3, 4];  /* VIP0~VIP8 返水比例(%) —— ★ 2026-10-03：VIP5 起才有返水 1/2/3/4 */

function makeDeck(minRank) {
  var lo = minRank || 2;
  var d = [];
  for (var s = 0; s < 4; s++) for (var r = lo; r <= 14; r++) d.push({ r: r, s: SUITS[s] });
  return d;
}
function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function cardStr(c) { return RANK_CH[c.r] + SUIT_CH[c.s]; }

/* ---------- 牌力评估（5张） ---------- */
/* lowAce：A 参与顺子时当作几点用。标准牌组传 1（A-2-3-4-5 轮顺，顶端算 5）；
   短牌 6+ 传 5（A-6-7-8-9 成立顺子，顶端算 9）——规则页 Rules 里就写了这条，以前没实现。 */
function eval5raw(cs, lowAce) {
  var ranks = cs.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
  var flush = cs.every(function (c) { return c.s === cs[0].s; });
  var uniq = [], counts = {};
  ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
  Object.keys(counts).forEach(function (k) { uniq.push(parseInt(k)); });
  uniq.sort(function (a, b) { return (counts[b] - counts[a]) || (b - a); });
  var straight = 0;
  var seq = uniq.slice();
  /* A 接在序列末尾当 lowAce（1 = 轮顺；5 = 短牌的 6-7-8-9-A）。
     ★ 短牌牌组里没有 2~5，所以 push(5) 不会和真实牌面冲突。 */
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
/* 短牌 6+ 特殊规则：同花 > 葫芦 */
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
/* 奥马哈：必须用且仅用 2 张底牌 + 3 张公共牌 */
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
/* 低牌（8 或更好）：返回降序点数数组或 null —— 只看这 5 张，不含 2+3 约束 */
function lowHand(cards) {
  var ranks = cards.map(function (c) { return c.r === 14 ? 1 : c.r; }).sort(function (a, b) { return a - b; });
  var uniq = ranks.filter(function (v, i, a) { return a.indexOf(v) === i; });
  if (uniq.length < 5) return null;
  var low = uniq.slice(0, 5);
  if (low[4] > 8) return null;
  return low.slice().sort(function (a, b) { return b - a; });
}
/* 奥马哈高低低牌：★ 必须同样遵守「恰好 2 张底牌 + 3 张公共牌」。
   以前直接 lowHand(hole.concat(comm)) 取最优 5 张，允许 1 张底牌 + 4 张公共牌成立，
   实测 AKQJ 底牌 + 23459 面也能造出低牌，属于规则错误。 */
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
function cmpLow(a, b) { /* 低牌越小越好，返回 >0 表示 a 更差 */
  if (!a) return 1; if (!b) return -1;
  for (var i = 0; i < 5; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}
function cmp(a, b) { for (var i = 0; i < Math.max(a.length, b.length); i++) { var x = a[i] || 0, y = b[i] || 0; if (x !== y) return x - y; } return 0; }
var HAND_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
/* 短牌 6+ 里 eval5 把「同花/葫芦」的强度下标对调了（同花 > 葫芦），
   名字表必须跟着对调，否则同花会显示成「葫芦」、葫芦显示成「同花」（★ 实测确认的显示错位）。 */
var HAND_NAMES_SHORT = ['高牌', '一对', '两对', '三条', '顺子', '葫芦', '同花', '四条', '同花顺'];
function handName(v, mode) { return ((mode === 'short' ? HAND_NAMES_SHORT : HAND_NAMES)[v[0]]) || ''; }
function vStrength(v) { return Math.min(1, (v[0] * 14 + (v[1] || 0) / 14) / (8 * 14 + 1)); }
function handStrength(cards, mode) {
  var v = evalBest(cards, mode);
  return vStrength(v);
}
/* 起手牌强度（翻牌前） */
function preflopScore(hole) {
  var a = hole[0], b = hole[1];
  var hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
  var suited = a.s === b.s, pair = a.r === b.r;
  var s = (hi * 2 + lo) / 44;
  if (pair) s += 0.42; if (suited) s += 0.14; if (hi - lo <= 1) s += 0.05;
  return Math.min(1, s);
}
/* 是否算作有效补牌：成三条以上 / 中高对 / 底对升级两对 */
function isImprove(v, cur) {
  if (v[0] >= Math.max(cur[0] + 1, 3)) return true;
  if (cur[0] <= 1 && v[0] === 1 && (v[1] || 0) >= 10) return true;
  if (cur[0] === 1 && v[0] === 2 && (v[1] || 0) >= (cur[1] || 0)) return true;
  return false;
}
/* 补牌 outs */
function computeOuts(hole, community, mode) {
  var known = hole.concat(community);
  var deck = makeDeck(mode === 'short' ? 6 : 2).filter(function (c) { return !known.some(function (k) { return k.r === c.r && k.s === c.s; }); });
  var cur = evalBest(known, mode);
  var outs = [], n = 0;
  deck.forEach(function (c) {
    var v = evalBest(known.concat([c]), mode);
    if (isImprove(v, cur)) { n++; outs.push(c); }
  });
  return { outs: n, cards: outs };
}
/* 胜率估算：翻牌后用 4/2 法则，翻牌前用补牌 + 起手牌基准 */
function equityFromOuts(outs, commLen) {
  var remaining = 5 - commLen;
  var eq;
  if (commLen === 0) eq = (outs * 4 + 28) / 100;
  else if (remaining >= 2) eq = outs * 4 / 100;
  else if (remaining === 1) eq = outs * 2 / 100;
  else eq = outs > 0 ? 0.5 : 0;
  return Math.max(0.02, Math.min(0.92, eq));
}

/* ---------- 牌桌对象 ---------- */
function createTable(opt) {
  opt = opt || {};
  var mode = MODES[opt.mode] || MODES.nlh;
  var t = {
    id: opt.id || 1, name: opt.name || mode.name, sb: opt.sb || 50, bb: opt.bb || 100,
    cap: opt.cap || mode.cap || 8, seats: [], handNo: 0, dealerSeat: 0, street: -1,
    community: [], pot: 0, sidePots: [], deck: [], toAct: -1, minRaise: 0,
    status: 'waiting', lastAgg: -1, log: [], heroSeat: 0, handStart: 0,
    mode: mode, modeKey: mode.key, ante: (opt.ante != null ? opt.ante : mode.ante) || 0,
    straddle: !!opt.straddle, rake: 0, rakeTotal: 0, rebate: 0
  };
  for (var i = 0; i < t.cap; i++) t.seats.push({ idx: i, empty: true, user: null, chips: 0, bet: 0, contrib: 0, hole: [], folded: false, allin: false, acted: false, lastAct: '', rank: null, low: null, sittingOut: false, owner: false, stat: { c: 0, f: 0 } });
  return t;
}
/* 抽水：pct 百分比，capBB 上限（大盲倍数），无翻牌不抽水 */
function rakeOf(t) {
  var m = t.mode || MODES.nlh;
  var r = m.rake || { pct: 0.05, capBB: 3 };
  if (!r.pct) return 0;
  if (t.street === 0) return 0;                    /* No Flop No Drop */
  var cap = Math.round((r.capBB || 3) * t.bb);
  var amt = Math.floor(t.pot * r.pct);
  return Math.max(0, Math.min(amt, cap));
}
function rakeText(t) {
  var m = t.mode || MODES.nlh, r = m.rake || { pct: 0.05, capBB: 3 };
  if (!r.pct) return '赛事服务费 ' + Math.round((r.fee || 0.1) * 100) + '%';
  return '抽水 ' + (r.pct * 100).toFixed(r.pct * 100 % 1 ? 1 : 0) + '% · 上限 ' + (r.capBB || 3) + 'BB';
}
/* 底池限注最大「加注增量」（amt 是跟注之上的增量，总注额 = toCall + 本值 = 底池 + 2×跟注额） */
function potMaxRaise(t) {
  var call = toCall(t, t.seats[t.toAct < 0 ? 0 : t.toAct]);
  return t.pot + call;
}
function seatPlayer(t, idx, u, chips) {
  var s = t.seats[idx];
  s.empty = false; s.user = u; s.chips = chips; s.bet = 0; s.contrib = 0; s.hole = []; s.folded = false; s.allin = false; s.acted = false; s.lastAct = ''; s.sittingOut = false; s.stat = { c: 0, f: 0 };
  if (u && u.id === (S.user && S.user.id)) t.heroSeat = idx;
}
function activeSeats(t) { return t.seats.filter(function (s) { return !s.empty && s.chips > 0 && !s.sittingOut; }); }
function nextSeat(t, from) { var n = t.cap; for (var i = 1; i <= n; i++) { var j = (from + i) % n; if (!t.seats[j].empty && !t.seats[j].sittingOut && !t.seats[j].folded && !t.seats[j].allin && t.seats[j].chips > 0) return j; } return -1; }
function nextLivingSeat(t, from) { var n = t.cap; for (var i = 1; i <= n; i++) { var j = (from + i) % n; var s = t.seats[j]; if (!s.empty && !s.sittingOut && !s.folded) return j; } return -1; }

function startHand(t) {
  var live = activeSeats(t);
  if (live.length < 2) { t.status = 'waiting'; return false; }
  /* ★ 2026-10-03 修「点继续报玩家不足后整桌卡死」：座位状态重置必须放在选庄家位之前。
     以前重置在下面第 311 行，而上手残留的 folded / allin 还挂着 ——
     一旦上手结束时其他玩家全员弃牌或全下，nextSeat()（要求 !folded && !allin）
     一个座位都找不到 → dealerSeat = -1 → startHand 恒 false，牌桌永远开不了下一手。 */
  t.seats.forEach(function (s) { s.bet = 0; s.contrib = 0; s.hole = []; s.folded = false; s.allin = false; s.acted = false; s.lastAct = ''; s.rank = null; s.low = null; });
  t.dealerSeat = nextSeat(t, t.dealerSeat < 0 ? 0 : t.dealerSeat);
  if (t.dealerSeat < 0) return false;
  t.handNo++; t.community = []; t.pot = 0; t.sidePots = []; t.log = []; t.handStart = Date.now();
  t.run = shuffle(makeDeck(t.mode.minRank || 2));   /* 本手完整牌序（预先生成，可复现 / 供透视模组读取） */
  t.deck = t.run;
  t.rake = 0;
  t.street = 0; t.minRaise = t.bb; t.status = 'playing';
  var sbSeat = nextSeat(t, t.dealerSeat), bbSeat = nextSeat(t, sbSeat);
  if (t.cap === 2) { sbSeat = t.dealerSeat; bbSeat = nextSeat(t, sbSeat); }
  t.sbSeat = sbSeat; t.bbSeat = bbSeat;
  /* 前注 Ante */
  if (t.ante > 0) live.forEach(function (s) { post(t, s, t.ante, '前注', true); });
  post(t, t.seats[sbSeat], t.sb, '小盲');
  post(t, t.seats[bbSeat], t.bb, '大盲');
  /* 强抓 Straddle */
  t.straddleSeat = -1;
  if (t.straddle) {
    var stSeat = nextSeat(t, bbSeat);
    if (stSeat >= 0 && t.seats[stSeat].chips > t.bb * 2) {
      post(t, t.seats[stSeat], t.bb * 2, '强抓');
      t.straddleSeat = stSeat;
    }
  }
  var hn = t.mode.hole || 2;
  live.forEach(function (s) { s.hole = []; for (var i = 0; i < hn; i++) s.hole.push(t.deck.pop()); });
  t.discardDone = false;
  t.housePlan = planHand(t);                 /* 控水：本手归属计划（bot / hero / null） */
  houseBiasHoles(t);                         /* 控水：底牌按计划偏置 */
  t.toAct = nextSeat(t, t.straddleSeat >= 0 ? t.straddleSeat : bbSeat);
  t.log.push({ street: 0, text: '第 ' + t.handNo + ' 手开始，' + t.mode.name + '，盲注 ' + t.sb + '/' + t.bb + (t.ante ? ' 前注 ' + t.ante : ''), sys: 1 });
  return true;
}
function post(t, s, amt, label, isAnte) {
  amt = Math.min(amt, s.chips); s.chips -= amt; s.contrib += amt; t.pot += amt;
  s.bet = isAnte ? 0 : amt;
  s.lastAct = label;
  if (s.chips === 0) s.allin = true;
}
/* 疯狂菠萝：翻牌后弃掉一张底牌 */
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

function doAction(t, seatIdx, type, amt) {
  var s = t.seats[seatIdx]; if (!s || s.folded) return false;
  var call = toCall(t, s);
  if (type === 'fold') { s.folded = true; s.lastAct = '弃牌'; t.log.push({ street: t.street, name: s.user.name, act: '弃牌' }); }
  else if (type === 'check') { if (call > 0) type = 'call'; }
  if (type === 'call' || type === 'check') {
    var pay = Math.min(call, s.chips); s.chips -= pay; s.bet += pay; s.contrib += pay; t.pot += pay;
    if (s.chips === 0) s.allin = true;
    s.lastAct = call > 0 ? (s.allin ? '跟注 All-in' : '跟注') : '过牌';
    t.log.push({ street: t.street, name: s.user.name, act: s.lastAct, amt: pay });
  } else if (type === 'raise' || type === 'bet') {
    var betType = t.mode.bet || 'nolimit';
    if (betType === 'aof') amt = s.chips;                                  /* AOF：只能全下 */
    /* 底池限注：最大「总注额」= 底池 + 2×跟注额，而 amt 是跟注之上的增量 → 上限取 底池 + 跟注额。
       以前写成 t.pot + call*2，实际总注变成 底池+3×跟注，比规则多放了一个跟注额（sb1/bb2 时该下 7 却下了 9）。 */
    else if (betType === 'potlimit') amt = Math.min(amt, t.pot + call);
    else if (betType === 'fixed') amt = t.street >= 2 ? t.bb * 2 : t.bb;    /* 固定限注 */
    amt = Math.max(amt, Math.min(t.minRaise, s.chips));
    var total = Math.min(call + amt, s.chips);
    var add = total - s.bet > 0 ? total - s.bet : 0;
    if (s.chips - total <= 0) { total = s.chips; s.allin = true; }
    s.chips -= total; s.bet += total; s.contrib += total; t.pot += total;
    /* ★ 2026-10-02 修正：minRaise 存的是「加注增量」，不是本次投入的总额。
       以前写 total（= call + amt）→ 每加一手门槛翻倍（实测 300/600/1200/2400，合法应为 300/600/900/1200）。
       增量 = 本次总额 - 用来补齐跟注的那部分；首次下注时 call=0，两者本来就相等。 */
    var raiseInc = total - call;
    /* ★ 2026-10-02 修正：只有「完整加注」才重开所有人的行动权。
       短码全下但加注量不足最小加注时（all-in raise），已经跟过注的人不应被强制重新表态——
       否则拿到便宜位置的玩家可以反复加码，把对手逼进无限轮。
       不足额的加注不影响已完成表态者的行动权，他们仍可在 roundDone 为 false 时选择跟/弃。 */
    var isFullRaise = raiseInc >= t.minRaise && !s.allin;
    t.minRaise = Math.max(t.minRaise, raiseInc);
    s.lastAct = (call > 0 ? '加注' : '下注') + (s.allin ? ' All-in' : '');
    t.log.push({ street: t.street, name: s.user.name, act: s.lastAct, amt: s.bet });
    t.lastAgg = seatIdx;
    if (isFullRaise) t.seats.forEach(function (x) { if (x.idx !== seatIdx) x.acted = false; });
  }
  if (!s.stat) s.stat = { c: 0, f: 0 };
  if (type === 'fold') s.stat.f++;
  else if (type === 'call' && call > 0) s.stat.c++;
  s.acted = true;
  /* 人声播报：所有座位（玩家 + 机器人）都走这里，动作听起来一致。
     无头评测（Node vm）里没有 core.js，做存在性保护。 */
  var vk = '';
  if (type === 'fold') vk = 'fold';
  else {
    var la = s.lastAct || '';
    var isRaise = la.indexOf('加注') >= 0 || la.indexOf('下注') >= 0;
    if (la.indexOf('All-in') >= 0) vk = isRaise ? 'allin' : 'allinCall';
    else if (isRaise) vk = 'raise';
    else if (la.indexOf('跟注') >= 0) vk = 'call';
    else if (la.indexOf('过牌') >= 0) vk = 'check';
  }
  if (vk && typeof voiceSfx === 'function') voiceSfx(vk, seatIdx);
  return true;
}
/* ★ 2026-10-02 重写：all-in 玩家不再参与「注额必须相等」的比较。
   以前把 all-in 的人也算进 live 平均值里，只要有人短码全下（注额低于场上水平），
   这一街永远判定不结束 → 剩下两家互相推诿，若都不弃牌就是死循环（实测复现）。
   正确判定：每个「还能行动」的玩家都已表态，且注额不低于全场最高注（含 all-in 者的注）。 */
function roundDone(t) {
  var live = t.seats.filter(function (s) { return !s.empty && !s.folded && !s.sittingOut; });
  if (live.length <= 1) return true;
  var acting = live.filter(function (s) { return !s.allin && s.chips > 0; });
  if (!acting.length) return true;                       /* 全场都 all-in，直接发完 */
  var maxBet = 0;
  live.forEach(function (s) { if (s.bet > maxBet) maxBet = s.bet; });
  return acting.every(function (s) { return s.acted && s.bet >= maxBet; });
}
function advance(t) {
  var live = t.seats.filter(function (s) { return !s.empty && !s.folded && !s.sittingOut; });
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
    houseRetry(t, 3, 8);                       /* 控水：翻牌按计划方重发 */
    t.log.push({ street: 1, sys: 1, text: '翻牌：' + t.community.map(cardStr).join(' ') });
  }
  else if (t.street === 2) {
    t.community.push(t.deck.pop());
    houseRetry(t, 1, 6);
    t.log.push({ street: 2, sys: 1, text: '转牌：' + cardStr(t.community[3]) });
  }
  else if (t.street === 3) {
    var rc = housePickRiver(t);
    if (!rc) rc = t.deck.pop();
    t.community.push(rc); t.log.push({ street: 3, sys: 1, text: '河牌：' + cardStr(rc) });
  }
}
function rankOf(t, s) {
  if (t.mode.omaha) return evalOmaha(s.hole, t.community, t.modeKey);
  return evalBest(s.hole.concat(t.community), t.modeKey);
}
/* 未跟注金额退回（Uncalled Bet Refund）
   ★ 2026-10-02 修复「余额凭空蒸发」：以前建池时若某层没有任何合格赢家（elig 为空），
     pay([], amt) 直接 return，那部分钱既没发给谁也没退给谁，凭空消失（实测 pot=150 只发出 100）。
   标准规则：某一层只有一个人投入（没人跟到那个额度）→ 超出部分原路退回该玩家，不参与抽水、不计入摊牌。
   必须在算抽水之前执行，否则 rake 会把退回的钱也算进去。 */
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
    if (amt > 0 && part.length === 1) refunds.push({ seat: part[0].idx, amount: amt });
    prev = lv;
  });
  refunds.forEach(function (rf) {
    var s = t.seats[rf.seat];
    s.chips += rf.amount; s.contrib -= rf.amount; t.pot -= rf.amount;
  });
  return refunds;
}
/* 边池 + 结算 + 抽水 */
function showdown(t) {
  t.street = 4; t.status = 'showdown';
  var refunds = refundUncalled(t);            /* ① 先退未跟注的钱 */
  var rake = rakeOf(t);                       /* ② 再算抽水（基于退回后的底池，且 street=4 不影响 No Flop No Drop） */
  var contribs = {};
  t.seats.forEach(function (s) { if (s.contrib > 0) contribs[s.idx] = s.contrib; });
  var levels = Object.keys(contribs).map(Number).map(function (k) { return contribs[k]; });
  levels = levels.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  var pools = [], prev = 0;
  levels.forEach(function (lv) {
    var amt = 0;
    t.seats.forEach(function (s) { var c = Math.min(s.contrib, lv) - Math.min(s.contrib, prev); if (c > 0) amt += c; });
    var part = t.seats.filter(function (s) { return s.contrib >= lv; });
    var elig = part.filter(function (s) { return !s.empty && !s.folded; });
    /* part.length === 1 的那层已在 refundUncalled 里退掉，这里不会重复。
       若这一层全部参与者都弃牌（理论上只剩最后的加注者），把钱退给最后一个投入的人，杜绝凭空蒸发。 */
    if (amt > 0) {
      if (!elig.length) {
        var last = part[part.length - 1];
        if (last) { last.chips += amt; last.contrib -= amt; t.pot -= amt; refunds.push({ seat: last.idx, amount: amt }); }
      } else {
        pools.push({ amount: amt, level: lv, elig: elig.map(function (s) { return s.idx; }) });
      }
    }
    prev = lv;
  });
  /* 兜底：抽水不能超过主池 */
  t.refunds = refunds;
  /* 抽水：从主池扣除，平台收入 */
  if (rake > 0 && pools.length) {
    var take = Math.min(rake, pools[0].amount);
    pools[0].amount -= take;
    t.rake = take;
    t.rakeTotal = (t.rakeTotal || 0) + take;
  } else t.rake = 0;
  t.sidePots = pools;

  function pay(winners, amount, tag, results) {
    if (!winners.length || amount <= 0) return;
    var each = Math.floor(amount / winners.length);
    var rem = amount - each * winners.length;
    winners.forEach(function (o, k) {
      var s = t.seats[o.seat], add = each + (k === 0 ? rem : 0);
      s.chips += add; s.win = (s.win || 0) + add;
      results.push({ seat: o.seat, name: s.user.name, amount: add, hand: handName(s.rank, t.modeKey), low: !!o.low, pot: amount, side: tag });
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
        var half = Math.floor(p.amount / 2), rem = p.amount - half * 2;
        pay(hiW, half, '高牌', results);
        pay(loW, half + rem, '低牌', results);
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
  /* VIP 返水：按 hero 本手贡献的抽水比例返还 */
  var hero = t.seats[t.heroSeat];
  var share = t.pot > 0 ? hero.contrib / t.pot : 0;
  var rate = (RAKEBACK[S.user && S.user.vip ? S.user.vip : 0] || 0) / 100;
  var rebate = Math.round(t.rake * share * rate);
  if (rebate > 0) { hero.chips += rebate; t.rebate = rebate; } else t.rebate = 0;
  t.result = results;
  houseStatAdd(t);                          /* 控水统计：机器人实际输赢 */
  t.log.push({ street: 4, sys: 1, text: '摊牌结束' });
  return 'showdown';
}

/* ---------- 控水引擎（后台可调：机器人赢/输比例） ----------
   botWinRate：机器人目标「赢下真人」的手数占比（0.2 / 0.3 / 0.4 …）
   strength  ：控水执行强度（1=每手都按计划，越低越自然）
   capProfit / capLoss：机器人累计盈利/亏损阈值，超线自动反向调节
   perTable  ：按牌桌覆盖比率 { tableId: rate }
   实现：每手开局前掷骰决定归属，河牌发牌时从剩余牌中挑一张达成结果（不改底牌、不改下注逻辑）。 */
var HOUSE = {
  on: false, botWinRate: 0.30, strength: 0.85, capProfit: 2000000, capLoss: 1000000, gain: 1,
  perTable: {}, stat: { hands: 0, botWin: 0, heroWin: 0, botNet: 0 }
};
function houseRateFor(t) {
  var base = HOUSE.botWinRate;
  if (HOUSE.perTable && HOUSE.perTable[t.id] != null) base = HOUSE.perTable[t.id];
  if (!HOUSE.capProfit && !HOUSE.capLoss) return base;
  var net = HOUSE.stat.botNet;
  if (HOUSE.capLoss && net <= -HOUSE.capLoss) return Math.min(0.9, base + 0.15);   /* 亏到止损线：加强 */
  if (HOUSE.capProfit && net >= HOUSE.capProfit) return Math.max(0.05, base - 0.15); /* 赢到止盈线：收敛 */
  return base;
}
/* 闭环校准：用「实际达成的机器人胜率」反推本手该偏向谁，抵消结构偏差（真人的弃牌率等） */
function houseAdjustedRate(t) {
  var base = houseRateFor(t);                               /* 目标 + 按桌覆盖 + 止损止盈 */
  var s = HOUSE.stat, decided = s.botWin + s.heroWin;
  if (decided < 15) return base;                            /* 样本太少，先按目标走 */
  var achieved = s.botWin / decided;
  var err = base - achieved;
  var p = base + err * (HOUSE.gain || 1);
  return Math.max(0, Math.min(1, p));
}
function planHand(t) {
  if (!HOUSE.on) return null;
  var hero = t.seats[t.heroSeat];
  if (!hero || hero.empty) return null;
  return Math.random() < houseAdjustedRate(t) ? 'bot' : 'hero';
}
function handRankOf(t, s, full) {
  return t.mode.omaha ? evalOmaha(s.hole, full, t.modeKey) : evalBest(s.hole.concat(full), t.modeKey);
}
/* 牌面是否足够偏向「计划方」：用真实胜率判定（th 为阈值），
   光看当前大小不够——给真人一张「暂时领先」的牌，他后面照样会输。 */
function houseFavor(t, plan, th) {
  var hero = t.seats[t.heroSeat];
  if (!hero || hero.empty || hero.folded || !hero.hole.length) return false;
  var bots = t.seats.filter(function (s) { return !s.empty && !s.folded && s.idx !== t.heroSeat && s.hole.length; });
  if (!bots.length) return false;
  var eq = mcEquity(hero.hole, t.community, Math.min(3, bots.length), 40, t.modeKey);
  return plan === 'hero' ? eq >= th : eq <= th;
}
/* 底牌偏置：按计划给「真人」换一手强牌（或弱牌），这是控水最有效的杠杆——
   真人拿着垃圾牌翻牌后还是会弃，光控公共牌压不住。 */
function houseBiasHoles(t) {
  if (!HOUSE.on || !t.housePlan) return;
  if (Math.random() > HOUSE.strength) return;
  var plan = t.housePlan, hero = t.seats[t.heroSeat];
  if (!hero || hero.empty || !hero.hole.length) return;
  var slots = hero.hole.length;
  var ths = plan === 'hero' ? [0.46, 0.40, 0.36] : [0.24, 0.28, 0.32];
  for (var ti = 0; ti < ths.length; ti++) {
    for (var a = 0; a < 6; a++) {
      var eq = mcEquity(hero.hole, [], 3, 50, t.modeKey);
      if (plan === 'hero' ? eq >= ths[ti] : eq <= ths[ti]) return;
      t.deck = t.deck.concat(hero.hole); hero.hole = []; shuffle(t.deck);
      for (var i = 0; i < slots; i++) hero.hole.push(t.deck.pop());
    }
  }
}
/* 翻牌 / 转牌：分档重发这几张公共牌，直到牌面朝计划方向走（先严后松） */
function houseRetry(t, count, tries) {
  if (!HOUSE.on || !t.housePlan) return;
  if (Math.random() > HOUSE.strength) return;
  var plan = t.housePlan;
  var tiers = plan === 'hero' ? [0.78, 0.70, 0.62] : [0.22, 0.30, 0.38];
  for (var ti = 0; ti < tiers.length; ti++) {
    for (var a = 0; a < tries; a++) {
      if (houseFavor(t, plan, tiers[ti])) return;
      var back = t.community.splice(t.community.length - count, count);
      t.deck = t.deck.concat(back); shuffle(t.deck);
      for (var i = 0; i < count; i++) t.community.push(t.deck.pop());
    }
  }
}
/* 河牌：从剩余牌里挑一张让计划方获胜的牌 */
function housePickRiver(t) {
  var plan = t.housePlan;
  if (!plan || !HOUSE.on) return null;
  if (Math.random() > HOUSE.strength) return null;          /* 留一部分自然牌局 */
  var hero = t.seats[t.heroSeat];
  if (!hero || hero.empty || hero.folded || !hero.hole.length) return null;
  var bots = t.seats.filter(function (s) { return !s.empty && !s.folded && s.idx !== t.heroSeat && s.hole.length; });
  if (!bots.length) return null;
  var board = t.community.slice(), good = [];
  for (var i = 0; i < t.deck.length; i++) {
    var full = board.concat([t.deck[i]]);
    var hr = handRankOf(t, hero, full), bb = null;
    for (var k = 0; k < bots.length; k++) { var r = handRankOf(t, bots[k], full); if (!bb || cmp(r, bb) > 0) bb = r; }
    var heroWin = cmp(hr, bb) > 0;
    if (plan === 'hero' ? heroWin : !heroWin) good.push(t.deck[i]);
  }
  if (!good.length) return null;
  var c = good[Math.floor(Math.random() * good.length)];
  var idx = t.deck.indexOf(c);
  if (idx >= 0) t.deck.splice(idx, 1);
  return c;
}
function houseStatAdd(t) {
  var hero = t.seats[t.heroSeat];
  if (!hero || hero.empty) return;
  var won = 0;
  (t.result || []).forEach(function (r) { if (r.seat === t.heroSeat) won += r.amount; });
  var net = won - (hero.contrib || 0);
  HOUSE.stat.hands++;
  if (net > 0) HOUSE.stat.heroWin++; else if (net < 0) HOUSE.stat.botWin++;
  HOUSE.stat.botNet -= net;
}

/* 后台自检：无头跑若干手，返回机器人实际赢下真人的比例（carry 可续跑） */
function simHumanDecide(t, s) {
  var call = toCall(t, s);
  var eq = mcEquity(s.hole, t.community, 3, 60, t.modeKey) + (Math.random() - 0.5) * 0.2;
  var pot = Math.max(1, t.pot), po = call / (pot + call);
  if (call <= 0) {
    if (eq > 0.6 && Math.random() < 0.6) return { type: 'bet', amt: Math.max(200, Math.round(pot * 0.5)) };
    return { type: 'check' };
  }
  if (eq > 0.78 && Math.random() < 0.5) return { type: 'raise', amt: Math.max(t.minRaise, Math.round(pot * 0.6)) };
  if (eq >= po) return { type: 'call' };
  if (Math.random() < 0.15) return { type: 'call' };
  return { type: 'fold' };
}
function simHouse(n, iters, carry) {
  iters = iters || 60;
  var saveIters = AI_CFG.iters; AI_CFG.iters = iters;
  var t, stat;
  if (carry && carry.t) { t = carry.t; stat = carry.stat; }
  else {
    t = createTable({ id: 990001, sb: 50, bb: 100, cap: 6, mode: 'nlh' });
    seatPlayer(t, 0, { id: 'sim-hero', name: '真人' }, 10000);
    for (var i = 1; i < 6; i++) seatPlayer(t, i, { id: 'sim-b' + i, name: '机器人' + i }, 10000);
    t.heroSeat = 0; t.dealerSeat = -1;
    stat = { hands: 0, botWin: 0, heroWin: 0, botNet: 0 };
  }
  var saveStat = HOUSE.stat; HOUSE.stat = stat;
  for (var h = 0; h < (n || 20); h++) {
    t.seats.forEach(function (s) { s.chips = 10000; });
    if (!startHand(t)) continue;
    var guard = 0;
    while (guard++ < 300) {
      var liveN = t.seats.filter(function (x) { return !x.empty && !x.folded; }).length;
      if (liveN <= 1) { if (advance(t) === 'showdown') break; continue; }
      if (roundDone(t)) { if (advance(t) === 'showdown') break; continue; }
      var idx = t.toAct;
      if (idx < 0) { if (advance(t) === 'showdown') break; continue; }
      var s2 = t.seats[idx];
      if (!s2 || s2.folded) { t.toAct = nextSeat(t, idx); continue; }
      var d = (idx === t.heroSeat) ? simHumanDecide(t, s2) : aiDecide(t, s2);
      doAction(t, idx, d.type, d.amt);
      if (!roundDone(t)) t.toAct = nextSeat(t, idx);
    }
  }
  HOUSE.stat = saveStat; AI_CFG.iters = saveIters;
  return { t: t, stat: stat, rate: stat.hands ? stat.botWin / stat.hands : 0 };
}

/* ---------- AI ---------- */
/* 蒙特卡洛胜率：用剩余牌随机补全公共牌 + 对手底牌，估算我方获胜概率 */
function mcEquity(hole, board, nOpp, iters, modeKey) {
  iters = iters || 220;
  nOpp = Math.max(1, Math.min(4, nOpp || 1));
  var mode = MODES[modeKey] || MODES.nlh;
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
/* 透视（天眼）模组 —— 让机器人读取「本手预先生成的完整牌序」做精确决策
   ⚠ 合规提示：这是**内部压测 / 演示房专用**能力。任何涉及真人资金、且未向玩家明示的房间禁止开启，
     否则属于欺诈性玩法。默认关闭，只能由后台显式打开，且打开动作会写进日志。
   可获得：① 自己底牌 ② 当前已公开公共牌 ③ 本手完整牌序 ④ 预计 Turn ⑤ 预计 River（⑥ 可选：对手底牌） */
var ORACLE = {
  on: false,          /* 总开关 */
  board: true,        /* 读未来 Turn / River */
  holes: true,        /* 读对手底牌（关闭则只用到河牌的确定性，翻前仍需蒙特卡洛） */
  useRate: 0.85,      /* 使用比例：留出一部分常规决策，避免行为过于机械、便于复盘 */
  ally: true,         /* 对 hero 是否有效（true = 真人主角也享有透视，用于演示） */
  diag: { used: 0, mc: 0, last: null }
};
/* 牌序是否可信：控水（HOUSE）开着的时候，翻牌/转牌会被分档重发、河牌会被定向挑选，
   预先生成的牌序就不再等于实际发出的牌 —— 此时透视必须降级，否则机器人会拿着错的未来牌做决策。 */
function oracleTrustworthy(t) {
  if (!t.deck || !t.deck.length) return false;
  if (typeof HOUSE !== 'undefined' && HOUSE.on && t.housePlan) return false;
  return true;
}
/* 接下来的 n 张公共牌（按发出顺序）。deck 用 pop 从头取，所以队尾就是下一张。 */
function futureBoard(t, n) {
  var out = [];
  for (var i = t.deck.length - 1; i >= 0 && out.length < n; i--) out.push(t.deck[i]);
  return out;
}
/* 透视视角下的「本手终局牌面」
   ★ 必须按**绝对街位**取牌：f[0] 永远是「当前要发的下一张」，不是 Turn。
     翻前 f[0..2] 是翻牌三张、f[3] 才是 Turn；转牌时 f[0] 已经河牌了。
     早期版本直接取 f[0]/f[1]，导致翻前把「翻牌第一张」当成 Turn —— 已修正。 */
function oracleFutureRun(t) {
  var have = t.community.length;
  var board = { turn: null, river: null, full: t.community.slice() };
  if (!ORACLE.board || !oracleTrustworthy(t)) return board;
  var need = Math.max(0, 5 - have);
  var f = futureBoard(t, need);
  board.full = t.community.concat(f.slice(0, need));
  if (have >= 4) {
    board.turn = t.community[3];                                   /* 转牌已发出 */
    board.river = have >= 5 ? t.community[4] : (f[0] || null);
  } else {
    board.turn = f[3 - have] || null;
    board.river = f[4 - have] || null;
  }
  return board;
}
/* 精确胜率：已知完整牌面 + 所有对手底牌时直接判定，否则退化到蒙特卡洛 */
function oracleEquity(t, s) {
  var run = oracleFutureRun(t);
  var board = run.full;
  var opps = t.seats.filter(function (x) { return !x.empty && !x.folded && x.idx !== s.idx && x.hole && x.hole.length; });
  if (board.length < 5 || !ORACLE.holes) {
    return mcEquity(s.hole, board, Math.max(1, Math.min(4, opps.length)), AI_CFG.iters, t.modeKey);
  }
  var my = t.mode.omaha ? evalOmaha(s.hole, board, t.modeKey) : evalBest(s.hole.concat(board), t.modeKey);
  var ties = 0;
  for (var i = 0; i < opps.length; i++) {
    var ov = t.mode.omaha ? evalOmaha(opps[i].hole, board, t.modeKey) : evalBest(opps[i].hole.concat(board), t.modeKey);
    var c = cmp(ov, my);
    if (c > 0) return 0;                       /* 有人必胜 → 我 0% */
    if (c === 0) ties++;
  }
  return ties ? 1 / (ties + 1) : 1;
}
/* AI 策略参数（模拟器网格搜索调优后的取值）
   skill：整体强度档位 1~5（后台可调）。数值越高：模拟次数更多、跟注更准、诈唬更少但时机更好。
   iters：蒙特卡洛模拟次数，越大越准但越慢 */
var AI_CFG = {
  skill: 3, iters: 260, vbetEq: 0.55, vbetStep: 0.04, semiBluff: 0.32, steal: 0.12,
  raiseEq: 0.70, raiseStep: 0.04, semiRaiseEq: 0.56, semiRaiseFreq: 0.32,
  reqBase: 0.03, reqOpp: 0.01, reqFacingRaise: 0, bigBetPenalty: 0, riverPenalty: 0,
  airFold: 0.18, drawCall: 0.25, allinCallEq: 0.66, adapt: 0
};
/* 按 skill 档位派生实际阈值（1=娱乐陪打，5=高压桌） */
function skillCfg() {
  var k = Math.max(1, Math.min(5, AI_CFG.skill || 3));
  var t01 = (k - 1) / 4;                                     /* 0~1 */
  return {
    iters: AI_CFG.itersForce || AI_CFG.iters || Math.round(160 + t01 * 340),   /* 160 → 500 次模拟（itersForce 供测试提速） */
    reqBase: 0.055 - t01 * 0.045,                            /* 安全边际：越紧越薄 */
    reqOpp: 0.014 - t01 * 0.010,
    airFold: 0.22 - t01 * 0.16,                              /* 空气直接弃的门槛：高手会继续诈唬 */
    allinCallEq: 0.72 - t01 * 0.14,                          /* 接 All-in 的胜率要求 */
    bluffMul: 1.25 - t01 * 0.55,                             /* 诈唬频率：高手反而更少诈唬但更准 */
    valueThin: t01 * 0.12,                                   /* 薄价值下注：只有高档位才会做 */
    defenseAdj: t01 * 0.06                                   /* 面对连续下注的额外防守宽度 */
  };
}
/* 对手松紧度：取「本手还在局中的对手」里最松那位的跟注率（0~1），供策略扩展用。
   默认不启用（AI_CFG.adapt=0）：实测关闭时表现最好。 */
function oppLoose(t, self) {
  var mx = 0.4;
  t.seats.forEach(function (s) {
    if (s.empty || s.idx === self.idx || s.folded) return;
    var st = s.stat || { c: 0, f: 0 }, k = st.c + st.f;
    if (k >= 6) { var r = st.c / k; if (r > mx) mx = r; }
  });
  return mx;
}
function aiDecide(t, s) {
  var call = toCall(t, s);
  var pot = Math.max(1, t.pot);
  var live = t.seats.filter(function (x) { return !x.empty && !x.folded && !x.sittingOut && x.idx !== s.idx; });
  var oppN = Math.max(1, live.length);
  var K = skillCfg();
  var streetN = t.community.length ? (t.community.length <= 3 ? 1 : t.community.length === 4 ? 2 : 3) : 0;

  /* ===== 胜率：透视开启时用「终局精确值」，否则蒙特卡洛 ===== */
  var eq, exact = false;
  var useOracle = ORACLE.on && (ORACLE.ally || s.idx !== t.heroSeat);
  if (useOracle && Math.random() < ORACLE.useRate) {
    eq = oracleEquity(t, s); exact = true;
    ORACLE.diag.used++;
    ORACLE.diag.last = { seat: s.idx, hand: t.handNo, street: streetN, turn: null, river: null };
    var fb = oracleFutureRun(t);
    ORACLE.diag.last.turn = fb.turn ? cardStr(fb.turn) : null;
    ORACLE.diag.last.river = fb.river ? cardStr(fb.river) : null;
  } else {
    eq = mcEquity(s.hole, t.community, oppN, K.iters, t.modeKey);
    if (useOracle) ORACLE.diag.mc++;
  }

  var potOdds = call / (pot + call);
  var r = Math.random();
  /* 听牌：折算成补牌胜率，避免把「4 张补牌」当成 0 胜率的空气牌 */
  var outs = t.community.length ? computeOuts(s.hole, t.community, t.modeKey).outs : 0;
  var draw = outs >= 4;
  var drawEq = outs > 0 ? Math.min(0.95, outs * (t.community.length >= 4 ? 2.2 : 4.2) / 100) : 0;
  var minB = Math.min(s.chips, Math.max(t.bb * 2, t.bb));
  /* 有效余额深度（SPR）：决定了短码应该更激进、深码应该更谨慎 */
  var spr = s.chips / Math.max(1, pot);
  /* 是否有位置（最后一个行动） */
  var positional = t.toAct === s.idx && (function () {
    var left = live.filter(function (x) { return !x.allin; });
    return left.length <= 1;
  })();

  /* AOF：只有全下或弃牌，按真实胜率决定 */
  if (t.mode.bet === 'aof') {
    var aofTh = oppN > 2 ? 0.55 : 0.44;
    if (eq >= aofTh || (draw && spr < 3)) return { type: 'raise', amt: s.chips };
    return { type: 'fold' };
  }

  /* 面对足以打光余额的大注：用「胜率 vs 底池赔率」做 EV 判断，而不是一把硬门槛 */
  if (call > 0 && call >= s.chips * 0.85) {
    var needAllin = exact ? potOdds + 0.02 : K.allinCallEq;
    if (eq >= needAllin) return { type: 'call' };
    /* 补牌足够多时按真实结算概率接，避免把坚果听牌扔掉 */
    if (draw && drawEq + 0.06 >= potOdds && spr < 2) return { type: 'call' };
    return { type: 'fold' };
  }

  /* 读牌桌：对手松 → 收敛诈唬、放宽价值下注门槛；对手紧 → 正常偷池 */
  var loose = AI_CFG.adapt ? oppLoose(t, s) : 0.4;
  var bluffMul = loose > 0.5 ? 0.3 : (loose > 0.42 ? 0.65 : 1);

  /* ---------- 无人下注：价值下注 / 半诈唬 / 偷池 / 过牌 ---------- */
  if (call <= 0) {
    var betEq = AI_CFG.vbetEq + AI_CFG.vbetStep * (oppN - 1) + (loose > 0.5 ? -0.05 : 0);
    /* 河牌：牌力已定型，极化下注——坚果要大注，中等牌控池过牌 */
    if (streetN === 3) {
      if (eq >= 0.82) return { type: 'bet', amt: Math.max(minB, Math.round(pot * (0.7 + Math.random() * 0.4))) };
      if (eq >= 0.62 + AI_CFG.vbetStep * (oppN - 1) - K.valueThin) return { type: 'bet', amt: Math.max(minB, Math.round(pot * 0.5)) };
      if (oppN === 1 && r < AI_CFG.steal * bluffMul * 1.4) return { type: 'bet', amt: Math.max(minB, Math.round(pot * 0.45)) };
      return { type: 'check' };
    }
    if (eq >= betEq) return { type: 'bet', amt: Math.max(minB, Math.round(pot * (0.5 + Math.random() * 0.3))) };
    if (draw && oppN <= 2 && r < AI_CFG.semiBluff * bluffMul) return { type: 'bet', amt: Math.max(minB, Math.round(pot * 0.45)) };
    /* 位置好 + 对手少 → 偷池；多人池大幅收敛 */
    if (oppN === 1 && r < AI_CFG.steal * bluffMul * (positional ? 1.6 : 1)) return { type: 'bet', amt: Math.max(minB, Math.round(pot * 0.33)) };
    return { type: 'check' };
  }

  /* ---------- 有人下注：跟注 / 加注 / 弃牌 ---------- */
  var req = potOdds + K.reqBase + (streetN < 3 ? K.reqOpp * oppN : K.reqOpp * 0.5);
  if (t.lastAgg >= 0) req += AI_CFG.reqFacingRaise - K.defenseAdj;   /* 面对加注略紧，但高手会更愿意防守 */
  if (call > pot * 0.6) req += AI_CFG.bigBetPenalty;                 /* 大注收紧 */
  if (streetN === 3) req += AI_CFG.riverPenalty;                     /* 河牌没有补牌，不再为隐含赔率买单 */
  /* 有听牌时：把「成牌概率」折进所需胜率（隐含赔率），避免高手把强听牌打得太软 */
  var effEq = Math.max(eq, streetN < 3 ? Math.min(0.9, drawEq * (pot / Math.max(1, call)) * 0.45 + eq) : eq);
  if (exact) effEq = eq;                                             /* 透视时不给自己加幻想分 */

  /* 加注：强牌价值加注 / 半诈唬加注 */
  var raiseTh = AI_CFG.raiseEq + AI_CFG.raiseStep * (oppN - 1);
  if (effEq >= raiseTh && r < 0.82) return { type: 'raise', amt: Math.max(t.minRaise, Math.round(pot * (0.6 + Math.random() * 0.4))) };
  if (effEq >= AI_CFG.semiRaiseEq && oppN <= 2 && r < AI_CFG.semiRaiseFreq * bluffMul * K.bluffMul) return { type: 'raise', amt: Math.max(t.minRaise, Math.round(pot * 0.55)) };
  if (effEq >= req) return { type: 'call' };
  /* 便宜的听牌跟注：补牌折算后的真实收益够本就跟 */
  if (draw && call <= pot * AI_CFG.drawCall && streetN < 3 && effEq >= potOdds * 0.85) return { type: 'call' };
  if (effEq < K.airFold) return { type: 'fold' };                    /* 彻底的空气牌，不再送余额 */
  /* 一对一且有位置：受控诈唬加注，逼对手弃掉中等牌 */
  if (oppN === 1 && r < 0.07 * bluffMul * K.bluffMul) return { type: 'raise', amt: Math.max(t.minRaise, Math.round(pot * 0.5)) };
  if (effEq >= potOdds * 0.95) return { type: 'call' };              /* 底池赔率边缘：高手会更愿意接 */
  return { type: 'fold' };
}

/* ---------- 保险 ---------- */
function insuranceOffer(t, heroSeat) {
  var hero = t.seats[heroSeat];
  if (!hero || hero.folded || hero.hole.length === 0) return null;
  var live = t.seats.filter(function (s) { return !s.empty && !s.folded && s.idx !== heroSeat; });
  var allinOpp = live.filter(function (s) { return s.allin; });
  if (!allinOpp.length || t.street >= 3) return null;
  var o = computeOuts(hero.hole, t.community, t.modeKey);
  var eq = equityFromOuts(o.outs, t.community.length);
  /* ★★ 2026-10-02 修「输了反而赚钱」套利（实测：只投入 5000，risk 被抬到 21000、赔付 14700）。
     敞口只能取「hero 真投进去的」与「对手匹配得上」的较小者，绝不能拿底池比例去兜底——
     否则 payout 会超过 hero 的实际亏损，玩家反复买保险就是稳赚。 */
  var risk = Math.min(hero.contrib, allinOpp.reduce(function (a, b) { return Math.max(a, b.contrib); }, 0));
  if (risk <= 0) return null;
  var payout = Math.round(risk * (1 - eq));
  if (payout < 1) return null;
  var premium = Math.max(1, Math.round(payout * (1 - eq) * 1.06));
  return { outs: o.outs, cards: o.cards, equity: eq, risk: risk, payout: payout, premium: premium, street: t.street };
}

/* ---------- 牌面 HTML ---------- */
function cardHTML(c, opt) {
  opt = opt || {};
  var size = opt.size || 'md';
  if (!c || opt.hidden) {
    return '<div class="pcard ' + size + ' back ' + (opt.back || 'red') + '"><span class="pcard-logo"></span></div>';
  }
  var red = (c.s === 'h' || c.s === 'd');
  var col = S.settings.fourColor ? (c.s === 'd' ? 'blue' : c.s === 'c' ? 'green' : red ? 'red' : 'black') : (red ? 'red' : 'black');
  return '<div class="pcard ' + size + ' ' + col + (opt.dim ? ' dim' : '') + (opt.win ? ' win' : '') + '">' +
    '<span class="pc-r">' + RANK_CH[c.r] + '</span><span class="pc-s">' + SUIT_CH[c.s] + '</span>' +
    '<span class="pc-big">' + SUIT_CH[c.s] + '</span></div>';
}

/* ---------- 生成历史牌局（用于手牌回顾） ---------- */
function genHistory(n) {
  var out = [];
  for (var i = 0; i < (n || 12); i++) {
    var deck = shuffle(makeDeck());
    var comm = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    var heroHole = [deck.pop(), deck.pop()];
    var players = [];
    var cnt = rnd(3, 6);
    for (var p = 0; p < cnt; p++) {
      var u = mkUser(p + i * 7 + 5);
      var hole = p === 0 ? heroHole : [deck.pop(), deck.pop()];
      players.push({ name: u.name, color: u.color, hole: hole, seat: p, contrib: pick([100, 200, 400, 800, 1600]), rank: evalBest(hole.concat(comm)), win: false, act: pick(['跟注', '加注', '过牌', '弃牌']) });
    }
    var heroRank = evalBest(heroHole.concat(comm));
    var bestv = null, wi = 0;
    players.forEach(function (pl, k) { if (!bestv || cmp(pl.rank, bestv) > 0) { bestv = pl.rank; wi = k; } });
    players[wi].win = true;
    var pot = players.reduce(function (a, b) { return a + b.contrib; }, 0) * 2;
    out.push({
      id: 90000 + i, ts: Date.now() - i * rnd(600000, 7200000), table: pick(['50/100 德州扑克', '10/20 德州扑克', '200/400 短牌', '5/10 德州扑克']),
      handNo: '#' + (312800 - i * 7), pot: pot, heroHole: heroHole, heroRank: heroRank, heroWin: wi === 0,
      heroNet: wi === 0 ? Math.round(pot * 0.6) : -players[0].contrib, community: comm, players: players,
      streets: [
        { name: '翻牌前', actions: players.map(function (pl) { return { name: pl.name, act: pl.act, amt: pl.contrib }; }) },
        { name: '翻牌', actions: players.slice(0, cnt - 1).map(function (pl) { return { name: pl.name, act: pick(['下注', '跟注', '加注', '过牌']), amt: pick([0, 200, 600]) }; }) },
        { name: '转牌', actions: players.slice(0, cnt - 2).map(function (pl) { return { name: pl.name, act: pick(['过牌', '下注', '跟注']), amt: pick([0, 400, 1200]) }; }) },
        { name: '河牌', actions: players.slice(0, Math.max(2, cnt - 3)).map(function (pl) { return { name: pl.name, act: pick(['下注', '跟注', '弃牌', 'All-in']), amt: pick([0, 800, 2400]) }; }) }
      ]
    });
  }
  return out;
}




