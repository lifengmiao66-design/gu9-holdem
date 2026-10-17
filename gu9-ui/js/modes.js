/* 2026-10-06：英文界面下优先用玩法自带的英文字段（en / enIntro / enTips）。
   原因：卡片里 intro 会被截断到 46 字，运行时词典匹配不到整句，
   逐段翻译会变成「任 选 组 合 成」这种碎片；有原生英文文案就不会有这个问题。 */
function modeName(m) {
  try { if (window.I18N && I18N.get && I18N.get() === 'en' && m && m.en) return m.en; } catch (e) { }
  return (m && m.name) || '';
}
function modeIntro(m, cut) {
  var s = '';
  try { if (window.I18N && I18N.get && I18N.get() === 'en' && m && m.enIntro) s = m.enIntro; } catch (e) { }
  if (!s) s = (m && m.intro) || '';
  if (cut && s.length > cut) return s.slice(0, cut) + '\u2026';
  return s;
}
function modeTips(m) {
  try { if (window.I18N && I18N.get && I18N.get() === 'en' && m && m.enTips) return m.enTips; } catch (e) { }
  return (m && m.tips) || '';
}
/* ===== modes.js · 主流玩法 / 玩法介绍 / 抽水规则 / 建房邀请好友 ===== */
var RAKE_TABLE = [
  { lv: '微额 (5/10 ~ 10/20)', pct: '5%', cap: '1 BB', note: '新手桌' },
  { lv: '小额 (25/50 ~ 50/100)', pct: '5%', cap: '2 BB', note: '最热门' },
  { lv: '中额 (100/200 ~ 500/1000)', pct: '5%', cap: '3 BB', note: '常规桌' },
  { lv: '高额 (1000/2000 以上)', pct: '4%', cap: '2.5 BB', note: 'VIP 桌' },
  { lv: 'All-in or Fold', pct: '4%', cap: '2 BB', note: '快速桌' },
  { lv: '短牌 6+', pct: '5%', cap: '2.5 BB', note: '36 张牌' },
  { lv: 'SNG 单桌赛', fee: '报名费 10%', note: '服务费' },
  { lv: 'MTT 锦标赛', fee: '报名费 10%', note: '服务费' },
  { lv: 'Spin & Go', fee: '报名费 8%', note: '服务费' }
];

function betTypeName(b) {
  /* 2026-10-06：英文界面直接给限注类型的英文说法
     （运行时词典会把「无限注」切成「No 限」，所以这里不交给翻译层） */
  try {
    if (window.I18N && I18N.get && I18N.get() === 'en') {
      return b === 'potlimit' ? 'Pot-Limit' : b === 'fixed' ? 'Fixed-Limit' : b === 'aof' ? 'All-in / Fold' : 'No-Limit';
    }
  } catch (e) { }
  return b === 'potlimit' ? '底池限注' : b === 'fixed' ? '固定限注' : b === 'aof' ? '全下/弃牌' : '无限注';
}
function modeOrder() {
  return ['nlh', 'plo', 'plo5', 'omaha8', 'short', 'aof', 'rush', 'pineapple', 'sng', 'mtt', 'spin'];
}

/* ---------- 玩法大厅 ---------- */
Screens.modes = function () {
  return '<div class="app-shell">' +
    '<div class="topbar"><div class="icon-btn" data-act="back">' + icon('back', 18) + '</div>' +
    '<div class="title grow">玩法大全</div>' +
    '<div class="btn xs ghost" data-rake-open>抽水规则</div></div>' +
    '<div class="body">' +
    '<div class="card gold row"><div style="color:var(--gold)">' + icon('cards', 22) + '</div>' +
    '<div class="grow"><div class="b">共 ' + modeOrder().length + ' 种主流玩法</div>' +
    '<div class="tiny txt3 mt8">点「规则」查看完整玩法说明，点「建房」可创建房间邀请好友同玩</div></div></div>' +
    '<div class="list mt12">' + modeOrder().map(function (k) {
      var m = MODES[k];
      return '<div class="li" style="align-items:flex-start">' +
        '<div class="col center" style="width:44px">' +
        '<div class="row" style="gap:2px">' + (m.hole <= 2 ? cardHTML(null, { size: 'xs', hidden: true, back: 'red' }) + cardHTML(null, { size: 'xs', hidden: true, back: 'red' }) :
          '<div class="tag gold" style="padding:2px 6px">' + m.hole + '张</div>') + '</div>' +
        '<div class="tiny txt3 mt8">' + betTypeName(m.bet).slice(0, 2) + '</div></div>' +
        '<div class="grow" style="min-width:0">' +
        '<div class="row gap6"><span class="li-title">' + modeName(m) + '</span>' +
        (m.hot ? '<span class="tag red">热门</span>' : '<span class="tag">' + m.tag + '</span>') + '</div>' +
        '<div class="tiny txt3">' + m.en + ' · ' + betTypeName(m.bet) + ' · ' + (m.cap || 8) + ' 人</div>' +
        '<div class="li-sub" style="margin-top:4px">' + modeIntro(m, 46) + '…</div>' +
        '<div class="row gap6 mt8">' +
        '<div class="btn xs ghost" data-md="' + k + '">规则说明</div>' +
        '<div class="btn xs gold" data-mplay="' + k + '">快速开始</div>' +
        '<div class="btn xs ghost" data-mroom="' + k + '">建房邀请</div>' +
        '</div></div></div>';
    }).join('') + '</div>' +
    '<div class="tiny txt3 center mt16">所有玩法均为虚拟币娱乐，无任何真实货币交易</div>' +
    '</div></div>';
};
Screens.modes.after = function (p, root) {
  bindClick(root, function (e) {
    var d = e.target.closest('[data-md]'); if (d) { showModeDetail(d.dataset.md); return; }
    var pl = e.target.closest('[data-mplay]'); if (pl) { startMode(pl.dataset.mplay); return; }
    var rm = e.target.closest('[data-mroom]'); if (rm) { createRoomFlow({ mode: rm.dataset.mroom }); return; }
    if (e.target.closest('[data-rake-open]')) go('rake');
  });
};

/* ---------- 玩法详情 ---------- */
function showModeDetail(key) {
  var m = MODES[key]; if (!m) return;
  var sample = '';
  if (key === 'plo' || key === 'plo5' || key === 'omaha8') {
    sample = '<div class="card mt12"><div class="b small">示例：奥马哈成手判定</div>' +
      '<div class="row mt8 gap6">' + [{ r: 14, s: 's' }, { r: 13, s: 's' }, { r: 12, s: 'h' }, { r: 11, s: 'h' }].map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') +
      '<span class="tiny txt3" style="margin-left:6px">底牌</span></div>' +
      '<div class="row mt8 gap6">' + [{ r: 9, s: 's' }, { r: 2, s: 's' }, { r: 7, s: 'd' }, { r: 4, s: 'c' }, { r: 3, s: 'h' }].map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') +
      '<span class="tiny txt3" style="margin-left:6px">公共牌</span></div>' +
      '<div class="tiny txt2 mt8">必须用【恰好 2 张底牌 + 3 张公共牌】：A♠K♠ + 9♠2♠7♦ 组成同花 A♠K♠9♠2♠ + 7♦（A 高同花）。' +
      '注意不能同时使用 3 张底牌。</div></div>';
  }
  if (key === 'short') {
    sample = '<div class="card mt12"><div class="b small">示例：短牌 6+特殊牌型</div>' +
      '<div class="row mt8 gap6">' + [{ r: 14, s: 'h' }, { r: 9, s: 'h' }, { r: 8, s: 'h' }, { r: 7, s: 'h' }, { r: 6, s: 'h' }].map(function (c) { return cardHTML(c, { size: 'sm' }); }).join('') + '</div>' +
      '<div class="tiny txt2 mt8">同花 > 葫芦：A♥9♥8♥7♥6♥ 为同花顺；A-6-7-8-9 在短牌中是有效顺子（A 作低牌）。</div></div>';
  }
  if (key === 'omaha8') {
    sample = '<div class="card mt12"><div class="b small">示例：高低分池</div>' +
      '<div class="tiny txt2 mt8">底牌 A♠2♠K♦Q♦ + 公共牌 3♥5♣8♦9♥J♣ → 低牌 A-2-3-5-8 成立，可争一半底池；高牌若有 K 或 Q 对子可争另一半。' +
      '同时拿到最高与最低称 Scoop，通吃全池。</div></div>';
  }
  openSheet({
    title: modeName(m) + ' · 规则说明',
    body: '<div class="card gold"><div class="row">' +
      '<div class="grow"><div class="b">' + m.en + '</div>' +
      '<div class="tiny txt3 mt8">底牌 ' + m.hole + ' 张 · ' + betTypeName(m.bet) + ' · 最多 ' + (m.cap || 8) + ' 人' +
      (m.ante ? ' · 前注 ' + m.ante : '') + '</div></div>' +
      '<div class="tag gold">' + m.tag + '</div></div>' +
      '<div class="tiny txt2 mt12">' + modeIntro(m) + '</div></div>' +
      '<div class="section-title">核心规则</div>' +
      '<div class="list">' + m.rules.map(function (r, i) {
        return '<div class="li" style="align-items:flex-start"><div class="center" style="width:22px;height:22px;border-radius:7px;background:var(--panel2);font-size:11px;color:var(--gold)">' + (i + 1) + '</div>' +
          '<div class="grow li-title" style="font-weight:500">' + r + '</div></div>';
      }).join('') + '</div>' +
      '<div class="section-title">抽水 / 服务费</div>' +
      '<div class="card"><div class="row"><span class="tiny txt2 grow">' + (m.rake.pct ? '底池抽水' : '赛事服务费') + '</span>' +
      '<span class="b gold">' + (m.rake.pct ? (m.rake.pct * 100).toFixed(0) + '% · 上限 ' + m.rake.capBB + 'BB' : (m.rake.fee * 100).toFixed(0) + '%') + '</span></div>' +
      '<div class="tiny txt3 mt8">' + (m.rake.pct ? '仅在翻牌后收取，翻牌前结束不抽水（No Flop No Drop）。' : '从报名费中扣除，奖池为扣除服务费后的部分。') + '</div></div>' +
      '<div class="section-title">玩法建议</div>' +
      '<div class="card"><div class="tiny txt2">' + modeTips(m) + '</div></div>' +
      sample +
      '<div class="grid g2 gap8 mt16">' +
      '<div class="btn gold lg" data-dt-play="' + key + '">开始游戏</div>' +
      '<div class="btn ghost lg" data-dt-room="' + key + '">建房邀请好友</div>' +
      '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var a = e.target.closest('[data-dt-play]');
        if (a) { close(); startMode(a.dataset.dtPlay); return; }
        var b = e.target.closest('[data-dt-room]');
        if (b) { close(); createRoomFlow({ mode: b.dataset.dtRoom }); }
      });
    }
  });
}

/* ---------- 抽水规则页 ---------- */
Screens.rake = function () {
  var vip = S.user.vip || 0;
  return '<div class="app-shell">' +
    '<div class="topbar"><div class="icon-btn" data-act="back">' + icon('back', 18) + '</div>' +
    '<div class="title grow">抽水与返水规则</div></div>' +
    '<div class="body">' +
    '<div class="card gold"><div class="row"><div style="color:var(--gold)">' + icon('info', 22) + '</div>' +
    '<div class="grow"><div class="b">什么是抽水（Rake）</div>' +
    '<div class="tiny txt3 mt8">平台从每个底池收取的服务费，只在<b>翻牌发出后</b>产生；翻牌前结束的手牌不抽水（No Flop No Drop）。</div></div></div></div>' +
    '<div class="section-title">常规抽水表</div>' +
    '<div class="list">' + RAKE_TABLE.map(function (r) {
      return '<div class="li"><div class="grow"><div class="li-title">' + r.lv + '</div>' +
        '<div class="li-sub">' + r.note + '</div></div>' +
        '<div class="col" style="align-items:flex-end"><span class="b gold">' + (r.pct || r.fee) + '</span>' +
        (r.cap ? '<span class="tiny txt3">上限 ' + r.cap + '</span>' : '') + '</div></div>';
    }).join('') + '</div>' +
    '<div class="section-title">抽水计算示例</div>' +
    '<div class="card">' +
    '<div class="row"><span class="tiny txt2 grow">底池 10,000 · 中额 5%</span><span class="b">抽水 500</span></div>' +
    '<div class="row mt8"><span class="tiny txt2 grow">底池 50,000 · 中额 5%（上限 3BB=600）</span><span class="b gold">抽水 600（封顶）</span></div>' +
    '<div class="row mt8"><span class="tiny txt2 grow">底池 8,000 · 翻牌前结束</span><span class="b green">不抽水</span></div>' +
    '<div class="tiny txt3 mt12">抽水从主池扣除，边池不额外抽水；保险赔付与抽水相互独立。</div>' +
    '</div>' +
    '<div class="section-title">VIP 返水（Rakeback）</div>' +
    '<div class="list">' + RAKEBACK.map(function (r, i) {
      /* ★ 2026-10-03：VIP5 起才有返水（1%~4%），低等级明确标「无返水」 */
      return '<div class="li' + (i === vip ? '" style="background:rgba(245,195,82,.10)' : '') + '">' +
        '<div class="tag ' + (i === vip ? 'gold' : '') + '">VIP' + i + '</div>' +
        '<div class="grow"><div class="li-title">' + (i === vip ? '当前等级' : 'VIP' + i) + '</div>' +
        '<div class="li-sub">' + (r > 0 ? '每手按贡献抽水返还' : '无返水（VIP5 起享返水）') + '</div></div>' +
        '<div class="b gold">' + r + '%</div></div>';
    }).join('') + '</div>' +
    '<div class="section-title">常见问题</div>' +
    '<div class="list">' +
    [['抽水什么时候扣？', '手牌结算时从主池扣除，未发出翻牌则不扣。'],
    ['有上限吗？', '有，按大盲倍数封顶，级别越高上限越宽松。'],
    ['返水怎么发？', '每手结算后按 VIP 等级即时返还到余额账户。'],
    ['边池会重复抽水吗？', '不会，一手牌只抽一次，从主池扣除。'],
    ['锦标赛怎么收费？', '按报名费的服务费比例（常见 8%~10%）一次性收取。']].map(function (x) {
      return '<div class="li" style="align-items:flex-start"><div class="grow"><div class="li-title">' + x[0] + '</div>' +
        '<div class="li-sub" style="margin-top:4px">' + x[1] + '</div></div></div>';
    }).join('') + '</div>' +
    '<div class="tiny txt3 center mt16">具体抽水以所在牌桌规则为准</div>' +
    '</div></div>';
};

/* ---------- 按玩法开始 ---------- */
function startMode(key) {
  var m = MODES[key]; if (!m) return;
  var pool = S.tables.filter(function (t) { return t.modeKey === key; });
  if (!pool.length) {
    var sb = pick(blindLevels()).sb;   /* ★ 2026-10-07：演示桌的盲注也走后台配置的档位，不再写死小额 */
    var t = mkTableData(key, sb, Math.min(8, m.cap || 8));
    S.tables.unshift(t); pool = [t];
  }
  var t = pick(pool);
  toast('进入 ' + modeName(m) + ' ' + t.sb + '/' + t.bb, 'ok');
  enterTable(t);
}
function mkTableData(key, sb, cap, opt) {
  opt = opt || {};
  var m = MODES[key] || MODES.nlh;
  return {
    /* ★ 2026-10-02 修「房间号与本地桌 id 撞命名空间」：以前随机 6 位，跟服务端房间号同区间，
       撞号时会把玩家静默送进另外一张桌子（用户的原话「去了另外一个房间」）。
       本地随机桌改用 7 位；真房间用带 R 前缀的字符串（见 tableFromRoom），两套永不重叠。 */
    id: opt.id || rnd(2000000, 8999999), name: m.name, modeKey: key, sb: sb, bb: sb * 2,
    cap: Math.min(8, cap || m.cap || 8), players: opt.players != null ? opt.players : Math.max(1, Math.min(Math.min(8, cap || m.cap || 8) - 1, rnd(2, 6))),
    avgPot: sb * rnd(30, 120), speed: pick(['常规', '快速', '极速']), straddle: opt.straddle || Math.random() < .2,
    insurance: opt.insurance != null ? opt.insurance : Math.random() < .6, vipOnly: sb >= 1000,
    passwd: opt.passwd || '', flopRate: rnd(28, 62), running: true,
    ante: opt.ante || m.ante || 0, owner: opt.owner || '', private: !!opt.private,
    /* ★ 2026-10-02：房间不再本地捏造。
       · roomNo = 服务端生成的 6 位房间号（凭号可加入）
       · invited = 服务端邀请记录（uid + status：pending / accepted / declined）
       · members = 服务端座位名单（**只有 accepted 的人才会出现**）
       ★ 铁律：任何 pending / declined 的人都不许进座位 —— 以前是本地直接塞进去的，好友毫不知情。 */
    roomNo: opt.roomNo || '', invited: opt.invited || [], members: opt.members || []
  };
}
/* 把服务端房间投影成本地牌桌数据（进桌用） */
function tableFromRoom(rm) {
  var t = mkTableData(rm.modeKey || 'nlh', rm.sb || 50, Math.min(8, rm.cap || 8), {
    id: 'R' + String(rm.no), name: rm.name, private: rm.priv === 'private', hasPwd: !!rm.hasPwd,
    roomNo: rm.no, owner: rm.owner,
    invited: (rm.invites || []).map(function (x) { return { id: x.uid, name: '', status: x.status }; }),
    members: (rm.seats || []).map(function (s) {
      return { id: s.uid, name: s.name, color: s.color, level: s.level || 0, vip: s.vip || 0, isOwner: !!s.isOwner };
    }),
    players: Math.max(1, (rm.seats || []).length), insurance: true
  });
  t.roomSeats = (rm.seats || []).slice();
  /* ★ 2026-10-03：大厅要能看出「这是我的房」还是「别人邀请我进去的」，
     否则建完房在 26 张随机桌里根本认不出来，好友端也不知道那个房间在等他答复。 */
  t.owner = String(rm.owner || '');
  t.myInvite = (rm.mine && rm.mine.invite) || null;   /* pending / accepted / declined */
  t.actAt = rm.actAt || rm.createdAt || 0;
  return t;
}
/* 把服务端房间同步进本地牌桌列表（已存在则更新，避免重复） */
function upsertRoomTable(rm) {
  var t = tableFromRoom(rm), i = -1;
  S.tables.forEach(function (x, k) { if (String(x.roomNo) === String(rm.no)) i = k; });
  if (i >= 0) S.tables[i] = t; else S.tables.unshift(t);
  return t;
}

/* ---------- 创建房间 + 邀请好友 ---------- */
function createRoomFlow(pre) {
  pre = pre || {};
  var modeKey = pre.mode || 'nlh';
  var sb = 50, passwd = '', invited = (pre.invite || []).slice();
  var insOn = true, stOn = false, pubOn = true;   /* 第 1 步的开关，切到第 2 步前要存下来（DOM 会被重建） */
  openSheet({
    title: '创建房间 · 邀请好友',
    body: '<div id="cr-body"></div>',
    onReady: function (root, close) {
      var body = $('#cr-body', root);
      function render(step) {
        if (step === 1) {
          body.innerHTML =
            '<div class="section-title" style="margin-top:0">① 选择玩法</div>' +
            '<div class="grid g2 gap8">' + modeOrder().map(function (k) {
              var m = MODES[k];
              return '<div class="card center" data-crm="' + k + '" style="padding:10px 6px;cursor:pointer;' + (modeKey === k ? 'border-color:var(--gold);background:rgba(245,195,82,.10)' : '') + '">' +
                '<div class="b small">' + modeName(m) + '</div>' +
                '<div class="tiny txt3 mt8">' + m.hole + ' 张底牌 · ' + betTypeName(m.bet) + '</div></div>';
            }).join('') + '</div>' +
            '<div class="section-title">② 盲注级别</div>' +
            '<div class="hscroll">' + blindLevels().map(function (b) {
              return '<div class="tag' + (sb === b.sb ? ' gold' : '') + '" data-crs="' + b.sb + '" style="padding:6px 12px">' + b.label + '</div>';
            }).join('') + '</div>' +
            '<div class="section-title">③ 房间设置</div>' +
            '<div class="field"><div class="lb">房间密码（6 位，可留空）</div>' +
            '<div class="input-wrap"><input id="cr-pwd" placeholder="留空则好友可直接进入" value="' + esc(passwd) + '"></div></div>' +
            '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">公开房间</div>' +
            '<div class="li-sub">开启后大厅所有人可见并可进入（设了密码仍需输入）</div></div><div class="switch on" id="cr-pub"></div></div>' +
            '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">开启保险</div>' +
            '<div class="li-sub">All-in 时可购买 EV 保险</div></div><div class="switch on" id="cr-ins"></div></div>' +
            '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">开启强抓 Straddle</div>' +
            '<div class="li-sub">大盲后可加倍下注</div></div><div class="switch" id="cr-st"></div></div>' +
            '<button class="btn gold block lg mt12" id="cr-next">下一步：邀请好友</button>';
          body.querySelectorAll('[data-crm]').forEach(function (b) { b.onclick = function () { modeKey = b.dataset.crm; render(1); }; });
          body.querySelectorAll('[data-crs]').forEach(function (b) { b.onclick = function () { sb = +b.dataset.crs; render(1); }; });
          $('#cr-next', body).onclick = function () {
            passwd = $('#cr-pwd', body).value.trim();
            insOn = $('#cr-ins', body).classList.contains('on');
            stOn = $('#cr-st', body).classList.contains('on');
            pubOn = $('#cr-pub', body).classList.contains('on');
            render(2);
          };
        } else {
          var m = MODES[modeKey];
          body.innerHTML =
            '<div class="card gold"><div class="b">房间已配置</div>' +
            '<div class="tiny txt3 mt8">' + modeName(m) + ' · ' + sb + '/' + sb * 2 + ' · ' + (m.cap || 8) + ' 人 · ' +
            (passwd ? '需要密码' : '无需密码') + '</div></div>' +
            '<div class="section-title">选择好友入座（可多选）</div>' +
            /* ★ 没有好友时别说「已选 0 位」就完了 —— 玩家会以为勾选失败。
               明确告诉他先去加好友（以前这块是纯空白，看不出是没好友还是没加载出来）。 */
            (!S.friends || !S.friends.length
              ? '<div class="empty">' + icon('users', 40) + '<div>还没有好友</div>' +
                '<div class="tiny txt3 mt8">先到「好友」页加几个人，回来就能邀请他们入座</div></div>'
              : '<div class="list">' + S.friends.slice(0, 12).map(function (f) {
              var on = invited.indexOf(f.id) >= 0;
              return '<div class="li" data-cri="' + f.id + '">' + avatarHTML(f, 'md', { status: 1 }) +
                '<div class="grow"><div class="li-title">' + esc(f.name) + '</div>' +
                '<div class="li-sub">' + (f.status === 'playing' ? '游戏中' : f.status === 'online' ? '在线' : '离线') + '</div></div>' +
                '<div class="checkbox' + (on ? ' on' : '') + '">' + icon('check', 13) + '</div></div>';
            }).join('') + '</div>') +
            '<div class="tiny txt3 mt8">已选 ' + invited.length + ' 位好友（离线好友会发送邀请通知）</div>' +
            '<div class="grid g2 gap8 mt12">' +
            '<div class="btn ghost lg" id="cr-back">上一步</div>' +
            '<div class="btn gold lg" id="cr-create">创建并进入</div>' +
            '</div>';
          body.querySelectorAll('[data-cri]').forEach(function (b) {
            b.onclick = function () {
              var id = b.dataset.cri, i = invited.indexOf(id);
              if (i >= 0) invited.splice(i, 1); else invited.push(id);
              render(2);
            };
          });
          $('#cr-back', body).onclick = function () { render(1); };
          $('#cr-create', body).onclick = function () {
            var friends = S.friends.filter(function (f) { return invited.indexOf(f.id) >= 0; });
            var btn = $('#cr-create', body);
            btn.textContent = '创建中…';
            /* ★ 2026-10-02：房间与邀请一律走服务端。
               房间号由服务端生成；邀请是 pending —— 对方在收件箱里同意之后才可能入座。
               （以前是本地把好友对象直接塞进座位，好友根本不知道有这个房间。） */
            apiRoomCreate({
              name: modeName(m) + ' ' + sb + '/' + sb * 2, modeKey: modeKey, sb: sb,
              cap: Math.min(8, m.cap || 8), priv: pubOn ? 'public' : 'private', passwd: passwd, straddle: stOn, ante: m.ante || 0
            }).then(function (r) {
              btn.textContent = '创建并进入';
              if (r.code !== 200 || !r.j.room) { toast((r.j && r.j.msg) || '创建房间失败，请检查网络', 'err', 2800); return; }
              var room = tableFromRoom(r.j.room);
              room.passwd = passwd;   /* 房主本地已知刚设的密码，仅用于创建成功卡片回显给房主 */
              /* ★ 2026-10-02：同账号只能在一个房间（服务端已把你在别房的座位清了），
                 本地牌桌列表也要跟着剔掉其它房间号，否则大厅里还挂着你已经不在的房间。
                 快速开局（没有房间号）的本地牌桌不受影响，照常保留。 */
              S.tables = (S.tables || []).filter(function (x) {
                return !(x.roomNo && String(x.roomNo) !== String(room.roomNo || '') && x.id !== room.id);
              });
              S.tables.unshift(room);
              close();
              var n = 0, why = '';
              Promise.all(friends.map(function (f) {
                return apiRoomInvite(room.roomNo, f.id).then(function (x) {
                  if (x.code === 200) n++;
                  else why = (x.j && x.j.msg) || ('邀请失败（' + x.code + '）');
                });
              })).then(function () {
                /* ★ 以前邀请失败是静默的：房间建好了、提示也弹了，其实一条邀请都没发出去，
                   好友那边当然「不显示」。现在失败必须说出来。 */
                if (friends.length && !n) toast('房间已创建，但邀请没发出去：' + (why || '请到牌桌内点「邀请好友」重试'), 'err', 3600);
                else toast('房间已创建，已向 ' + n + ' 位好友发出邀请 · 等对方同意', 'ok', 3000);
              });
              setTimeout(function () { showRoomCard(room, n || friends.length); }, 320);
            });
          };
        }
      }
      render(1);
    }
  });
}
/* 房间卡片：真实房间号（服务端发的），可复制 / 继续邀请 / 直接进入 */
function showRoomCard(room, n) {
  var no = room.roomNo || room.id;
  openModal({
    title: '房间创建成功', sub: '好友需要同意邀请才能进来', okText: '进入房间',
    body: '<div class="center col" style="gap:8px;padding:6px 0">' +
      '<div class="b" style="font-size:26px;letter-spacing:4px;color:var(--gold)">' + esc(String(no)) + '</div>' +
      '<div class="tiny txt3">' + esc(room.name) + ' · ' + room.sb + '/' + room.bb + ' · ' + room.cap + ' 人</div>' +
      (room.passwd ? '<div class="tag gold mt8">密码 ' + esc(room.passwd) + '</div>' : '<div class="tag green mt8">无需密码</div>') +
      '<div class="tiny txt3 mt8" style="line-height:1.5">已发出 ' + (n || 0) + ' 条邀请，好友在「好友 → 房间邀请」里同意后才会入座。<br>没同意之前，谁也不会被拉进来。</div>' +
      '<div class="row gap8 mt12"><div class="btn xs ghost" id="rm-copy">复制房间号</div>' +
      '<div class="btn xs ghost" id="rm-inv">继续邀请好友</div></div></div>',
    onOk: function () { go('table', { id: room.id }); },
    onReady: function (r2) {
      $('#rm-copy', r2).onclick = function () {
        var txt = String(no);
        try { navigator.clipboard.writeText(txt); toast('房间号已复制：' + txt, 'ok'); }
        catch (e) { toast('房间号：' + txt, 'ok', 3000); }
      };
      $('#rm-inv', r2).onclick = function () { inviteFriendsToRoom(room); };
    }
  });
}

/* 牌桌内继续邀请好友 —— ★ 走服务端邀请，不是本地把人塞进座位 */
function inviteFriendsToRoom(room) {
  var no = room.roomNo || room.id;
  var invited = (room.invited || []).map(function (f) { return String(f.id); });
  openSheet({
    title: '邀请好友入座',
    body: '<div class="tiny txt3">房间 ' + esc(String(no)) + ' · ' + modeName(MODES[room.modeKey]) + ' ' + room.sb + '/' + room.bb + '</div>' +
      '<div class="tiny txt3 mt8">好友同意后才会真正入座，未同意不会出现在牌桌上。</div>' +
      '<div class="list mt12">' + S.friends.slice(0, 14).map(function (f) {
        var on = invited.indexOf(String(f.id)) >= 0;
        return '<div class="li" data-iv="' + f.id + '">' + avatarHTML(f, 'md', { status: 1 }) +
          '<div class="grow"><div class="li-title">' + esc(f.name) + '</div>' +
          '<div class="li-sub">' + (on ? '已邀请 · 等待对方同意' : (f.status === 'playing' ? '游戏中' : f.status === 'online' ? '在线' : '离线')) + '</div></div>' +
          '<div class="btn xs ' + (on ? 'ghost' : 'gold') + '">' + (on ? '已邀请' : '邀请') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="grid g2 gap8 mt12">' +
      '<div class="btn ghost" id="iv-copy">复制房间号</div>' +
      '<div class="btn ghost" id="iv-mem">刷新成员</div></div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-iv]'); if (!b) return;
        var f = S.friends.filter(function (x) { return String(x.id) === String(b.dataset.iv); })[0];
        if (!f) return;
        if (!room.roomNo) { toast('这个房间还没有服务端房间号，请重新创建', 'err'); close(); return; }
        if (invited.indexOf(String(f.id)) >= 0) { toast('已经邀请过了，等对方同意', 'ok'); return; }
        apiRoomInvite(room.roomNo, f.id).then(function (r) {
          if (r.code !== 200) { toast((r.j && r.j.msg) || '邀请发送失败', 'err', 2600); return; }
          room.invited = room.invited || [];
          room.invited.push({ id: f.id, name: f.name, status: 'pending' });
          toast('已邀请 ' + f.name + ' · 等对方同意', 'ok', 2600);
          close();
        });
      });
      $('#iv-copy', root).onclick = function () {
        try { navigator.clipboard.writeText(String(no)); toast('房间号已复制：' + no, 'ok'); }
        catch (e) { toast('房间号：' + no, 'ok', 3000); }
      };
      $('#iv-mem', root).onclick = function () { close(); refreshRoomMembers(room); };
    }
  });
}
/* 从服务端拉一次房间成员（只有 accepted 的人会在 seats 里），更新本地牌桌 */
function refreshRoomMembers(room, cb) {
  if (!room || !room.roomNo) { if (cb) cb(false); return; }
  apiRoomDetail(room.roomNo).then(function (r) {
    if (r.code !== 200 || !r.j.room) { toast('房间已解散或网络不可用', 'err'); if (cb) cb(false); return; }
    var rm = r.j.room;
    room.members = (rm.seats || []).map(function (s) {
      return { id: s.uid, name: s.name, color: s.color, level: s.level || 0, vip: s.vip || 0, isOwner: !!s.isOwner };
    });
    room.roomSeats = (rm.seats || []).slice();
    room.players = Math.max(1, (rm.seats || []).length);
    toast('房间成员已更新 · ' + (rm.seats || []).length + ' 人在座', 'ok');
    if (cb) cb(true);
  });
}

bindAct('rake-open', function () { go('rake'); });
bindAct('modes', function () { go('modes'); });





