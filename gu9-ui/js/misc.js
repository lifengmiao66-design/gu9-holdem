/* ===== misc.js · 我的 / 资料 / 邮件 / 任务 / 排行榜 / 统计 / 设置 / 客服 / 规则 ===== */
var MineTab = 'main';
Screens.mine = function (p) {
  if (p && p.tab) MineTab = p.tab; else if (!p || !p.tab) MineTab = 'main';
  var u = S.user;
  if (MineTab === 'main') {
    var funcs = [
      { k: 'wallet', n: '钱包', i: 'wallet', d: uStr(balCent()) + ' USDT' },
      { k: 'transfer', n: '转账', i: 'transfer', d: '向好友转账 / 记录' },
      { k: 'mail', n: '邮件', i: 'mail', d: S.mails.filter(function (m) { return !m.read; }).length + ' 封未读' },
      { k: 'task', n: '任务', i: 'task', d: '每日 / 成长任务' },
      { k: 'friends', n: '好友', i: 'users', d: S.friends.length + ' 位好友 · ' + S.requests.length + ' 条申请' },
      { k: 'stat', n: '数据统计', i: 'stats', d: '已打 ' + fmtInt((u.stat && u.stat.hands) || u.hands || 0) + ' 手 · 赢池 ' + fmtInt((u.stat && u.stat.win) || 0) + ' 个' },
      { k: 'achieve', n: '成就', i: 'trophy', d: S.achievements.filter(function (a) { return a.got; }).length + '/' + S.achievements.length },
      { k: 'modes', n: '玩法大全', i: 'cards', d: '11 种主流玩法规则' },
      { k: 'rake', n: '抽水规则', i: 'info', d: '抽水上限与 VIP 返水' },
      /* ★ 2026-10-03：以前写着「每邀请 1 人得 10 万」，但服务端根本没实现、数额也离谱；
         现在改成真的 econ.inviteReward（默认 10 USDT / 人），数值由后台下发。 */
      { k: 'invite', n: '邀请好友', i: 'invite', d: '每邀请 1 人得 ' + uStr(INVITE_REWARD) + ' USDT' },
      { k: 'security', n: '账号安全', i: 'shield', d: u.phone ? ('已绑定手机 ' + u.phone) : '未绑定手机 · 建议绑定' },
      { k: 'settings', n: '设置', i: 'settings', d: '音效 / 隐私 / 关于' },
      { k: 'addhome', n: '添加到主屏幕', i: 'phone', d: '像 App 一样从桌面打开' },
      { k: 'service', n: '客服中心', i: 'help', d: '在线客服 · 常见问题' },
      { k: 'rule', n: '规则说明', i: 'list', d: '德州扑克玩法规则' }
    ];
    return '<div class="app-shell">' +
      '<div class="topbar"><div class="title grow">我的</div>' +
      '<div class="icon-btn" data-act="settings">' + icon('settings', 18) + '</div>' +
      '<div class="icon-btn" data-act="service">' + icon('help', 18) + '</div></div>' +
      '<div class="body">' +
      '<div class="card gold row gap12" data-act="profile" style="cursor:pointer">' +
      avatarHTML(u, 'xl', { frame: 'gold' }) +
      '<div class="col grow" style="min-width:0">' +
      '<div class="row gap6"><span class="b" style="font-size:18px">' + esc(u.name) + '</span><span class="tag gold">VIP' + u.vip + '</span>' +
      '<span class="tag blue">Lv.' + u.level + '</span></div>' +
      '<div class="tiny txt3 mt8">ID ' + u.id + ' · 注册 ' + u.regDays + ' 天 · ' + u.country + '</div>' +
      (lvNextInfo(u) ? '<div class="bar mt8"><i style="width:' + lvNextInfo(u).pct + '%"></i></div>' +
      '<div class="tiny txt3 mt8">累计充值 ' + (+u.depositUsdt || 0).toFixed(2) + ' USDT \u00b7 距离 Lv.' + ((+u.level || 0) + 1) + ' 还需 ' + lvNextInfo(u).need.toFixed(2) + ' USDT</div>' : '') +
      '</div>' + icon('right', 18) + '</div>' +
      '<div class="card gold row gap12 mt12">' +
      '<div class="col grow"><div class="tiny txt3">我的余额</div>' +
      '<div class="b gold" style="font-size:22px">' + uStr(balCent()) + ' <span style="font-size:14px">USDT</span></div>' +
      '<div class="tiny txt3 mt8">可提现 ' + fmt(Math.round((+(u.usdt || 0)) * 100) / 100) + ' USDT</div></div>' +
      '<div class="col" style="text-align:right"><div class="tiny txt3">已打手数</div>' +
      '<div class="b" style="font-size:18px">' + fmtInt((u.stat && u.stat.hands) || u.hands || 0) + ' 手</div></div>' +
      '</div>' +
      '<div class="list mt12">' + funcs.map(function (f) {
        return '<div class="li" data-mf="' + f.k + '"><div class="center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2);color:var(--txt2)">' + icon(f.i, 18) + '</div>' +
          '<div class="grow"><div class="li-title">' + f.n + '</div><div class="li-sub">' + f.d + '</div></div>' + icon('right', 16) + '</div>';
      }).join('') + '</div>' +
      '<button class="btn ghost block mt16" data-act="logout">' + icon('logout', 16) + ' 退出登录</button>' +
      '</div>' + navHTML('mine') + '</div>';
  }
  if (MineTab === 'task') return taskScreen();
  if (MineTab === 'stat') return statScreen();
  if (MineTab === 'wallet') return walletScreen();
  return '';
};
Screens.mine.after = function (p, root) {
  bindClick(root, function (e) {
    var tc = e.target.closest('[data-tclaim]');
    if (tc) {
      var t = S.tasks.filter(function (x) { return x.id == tc.dataset.tclaim; })[0];
      if (t) {
        /* ★★ 2026-10-02 修「本地加钱 = 零成本刷USDT」：
           以前这里直接 S.user.chips += t.reward，本地数字一改再被 apiSync 写回服务端，
           等于玩家可以自己给自己发钱。现在奖励由服务端发放（带流水 + 每日限额），
           服务端返回的余额才是权威值。 */
        var btn = tc, old = btn.textContent;
        btn.textContent = '领取中…';
        apiTaskClaim(t.id).then(function (r) {
          btn.textContent = old;
          if (r.code !== 200 || !r.j.ok) {
            toast((r.j && r.j.msg) || (r.code === 0 ? '网络不可用，需要联网才能领取' : '领取失败'), 'err', 2800);
            return;
          }
          if (r.j.user) applyServerUser(r.j.user);
          t.done = true; t.prog = t.goal; t.reward = r.j.reward; saveState();
          toast('任务奖励已领取 +' + uStr(r.j.reward) + ' USDT', 'ok', 2400);
          flyFromEl(btn, '+' + short(r.j.reward));
          go('mine', { tab: 'task' }, { noHist: true });
        });
      }
      return;
    }
    var tg = e.target.closest('[data-tgoto]');
    if (tg) { toast('已跳转到对应玩法'); quickStart(); return; }
    var sg = $('#task-signin', root);
    if (sg) sg.onclick = function () {
      var b = this, old = b.textContent;
      b.textContent = '签到中…';
      apiSignin().then(function (r) {
        b.textContent = old;
        if (r.code !== 200 || !r.j.ok) {
          toast((r.j && r.j.msg) || (r.code === 0 ? '网络不可用，需要联网签到' : '签到失败'), 'err', 2800);
          return;
        }
        if (r.j.user) applyServerUser(r.j.user);
        toast('签到成功，第 ' + r.j.day + ' 天 +' + uStr(r.j.reward) + ' USDT', 'ok', 2600);
        flyFromEl(b, '+' + short(r.j.reward));
        go('mine', { tab: 'task' }, { noHist: true });
      });
    };
    var b = e.target.closest('[data-mf]'); if (!b) return;
    var a = b.dataset.mf;
    /* 好友是独立的屏幕（底部导航也有入口），不在「我的」内部切 tab */
    if (a === 'friends') { go('friends'); return; }
    if (['wallet', 'task', 'stat'].indexOf(a) >= 0) {
      go('mine', { tab: a });
      /* ★ 统计页打开时拉一次服务端最新数据再重渲染（对局记录/盈亏都是服务端权威） */
      if (a === 'stat' && typeof apiMe === 'function') apiMe().then(function () { if (MineTab === 'stat') go('mine', { tab: 'stat' }, { noHist: true }); });
      return;
    }
    if (a === 'transfer') showTransfer();
    if (a === 'mail') Screens.mail();
    if (a === 'achieve') showAchieve();
    if (a === 'modes') go('modes');
    if (a === 'rake') go('rake');
    if (a === 'invite') showInvite();
        if (a === 'security') showSecurity();
        if (a === 'settings') Screens.settings();
        if (a === 'addhome') promptAddToHome();
        if (a === 'service') Screens.service();
    if (a === 'rule') Screens.rule();
  });
};

/* ---------- 邀请好友（★ 2026-10-03：真实奖励版） ----------
   以前点「邀请好友」只弹一句「已复制链接，你得 10 万USDT」——纯空话，服务端没这回事。
   现在：给出本人邀请码（= 账号 ID）+ 注册页填法说明 + 已成功邀请人数；
   奖励由 chain.js 在被邀请人【首次充值到账】后发放（econ.inviteReward，单位分，单日上限 inviteDayCap 笔防刷）。 */
function showInvite() {
  var code = String(S.user.id || '');
  var link = ''+location.origin+'/?ref=' + encodeURIComponent(code);
  var rw = INVITE_REWARD;
  var body = '<div class="card gold center"><div class="tiny txt3">我的邀请码</div>' +
    '<div class="b gold mt8" style="font-size:26px;letter-spacing:2px">' + esc(code) + '</div>' +
    '<div class="tiny txt3 mt8">好友打开下方链接注册时，推荐人 ID 会自动填好</div>' +
    '<div class="tiny txt3 mt8" style="word-break:break-all;opacity:.75">' + esc(link) + '</div>' +
    '<button class="btn gold sm mt12" id="iv-copy">复制邀请链接</button></div>' +
    '<div class="card mt12"><div class="row"><span class="tiny txt3 grow">已成功邀请</span>' +
    '<span class="b">' + (S.user.inviteCount || 0) + ' 人</span></div>' +
    '<div class="row mt8"><span class="tiny txt3 grow">每人奖励</span><span class="b gold">' + uStr(rw) + ' USDT</span></div></div>' +
    '<div class="card mt12"><div class="h">邀请规则</div>' +
    '<div class="tiny txt3 mt8" style="line-height:1.7">' +
    '1. 好友通过你的邀请链接进入，注册页「推荐人 ID」已自动填入；<br>' +
    '2. 好友首次充值到账后，奖励自动进你的 USDT 余额（后台可查流水，类型 invite）；<br>' +
    '3. 奖励数值由后台「参数配置 → 邀请好友奖励」控制（当前 ' + uStr(rw) + ' USDT / 人）；<br>' +
    '4. 每人每天最多领 20 笔，超过当天不再发放（防刷号）。</div></div>';
  openSheet({
    title: '邀请好友', body: body, key: 'invite',
    onReady: function (root, close) {
      var cp = $('#iv-copy', root);
      if (cp) cp.onclick = function () {
        copyText(link).then(function (okd) {
          toast(okd ? '邀请链接已复制' : '复制失败，请长按手动复制', okd ? 'ok' : 'err');
        });
      };
    }
  });
}

/* ★ 2026-10-05 USDT 化：账户余额 = USDT，内部字段 bal 单位是「分」（1 USDT = 100 分）。 */
function balCent() { return Math.max(0, Math.round(+((S.user && S.user.bal) || 0) * 100) / 100); }   /* ★ bal 即 USDT，无换算 */

/* ---------- 钱包页 ---------- */
/* 2026-10-06：等级 = 累计充值档位（后端权威，前端只做展示、绝不自己算等级）。
   档位：Lv.0→500U，Lv.1→1000U，之后每 +1000U 一档。 */
function lvThresholdOf(lv) { var v = +lv || 0; return v <= 0 ? 500 : v * 1000; }
function lvNextInfo(u) {
  var dep = Math.max(0, +u.depositUsdt || 0);
  var lv = Math.max(0, +u.level || 0);
  var cur = lv <= 0 ? 0 : (lv === 1 ? 500 : (lv - 1) * 1000);
  var next = lvThresholdOf(lv);
  if (!(next > dep)) return null;
  var span = next - cur;
  return { need: next - dep, pct: span > 0 ? Math.max(2, Math.min(100, Math.round((dep - cur) / span * 100))) : 0 };
}
function walletScreen() {
  var u = S.user || {};   /* ★ 2026-10-05 修复：原来这里直接用裸 u（未定义），渲染抛 ReferenceError → 钱包页整个打不开 */
  return '<div class="app-shell">' +
    '<div class="topbar"><div class="icon-btn" data-act="back">' + icon('back', 18) + '</div><div class="title grow">我的钱包</div></div>' +
    '<div class="body">' +
    '<div class="card gold"><div class="tiny txt3">USDT 余额</div>' +
    '<div class="b gold" style="font-size:30px">' + uStr(balCent()) + '</div>' +
    '<div class="tiny txt3 mt8">账户与牌桌统一以 USDT 计价 · 可直接上桌或提现</div>' +
    '<div class="row mt12">' +
    '<div class="col grow"><div class="tiny txt3">可提现</div>' +
    '<div class="b" style="font-size:18px">' + uStr(balCent()) + ' USDT</div></div>' +
    '<div class="col" style="text-align:right"><div class="tiny txt3">已打手数</div><div class="b">' + fmtInt((u.stat && u.stat.hands) || u.hands || 0) + ' 手</div></div>' +
    '</div></div>' +
    '<div class="grid g2 gap8 mt12">' +
    '<div class="btn green lg" data-act="recharge">充值</div>' +
    '<div class="btn ghost lg" data-act="withdraw">提现</div>' +
    '<div class="btn ghost lg" data-act="my-orders">我的订单</div>' +
    '<div class="btn ghost lg" data-act="transfer">转账</div>' +
    '<div class="btn ghost lg" data-act="transfer-log">转账记录</div>' +
    '</div>' +
    '<div class="card mt12"><div class="row gap8"><span class="gold">' + icon('info', 16) + '</span>' +
    '<div class="tiny txt3 grow">本平台以 USDT 为唯一计价币种：充值到账、牌桌输赢、提现出款都是同一笔 USDT 余额，' +
    '没有任何USDT中间环节，也不需要兑换。提现单笔固定手续费 2 USDT，不限额度，走风控审核。</div></div></div>' +
    '<div class="section-title">资金流水</div>' +
    (S.transferLogs.length ?
    '<div class="list">' + S.transferLogs.slice(0, 6).map(function (l) {
      return '<div class="li"><div class="center" style="width:32px;height:32px;border-radius:8px;background:var(--panel2);color:' + (l.type === 'out' ? '#ff5a5f' : '#2ecc71') + '">' + icon('transfer', 16) + '</div>' +
        '<div class="grow"><div class="li-title">' + (l.type === 'out' ? '转出 · ' + esc(l.to) : '转入 · ' + esc(l.from || '玩家')) + '</div>' +
        '<div class="li-sub">' + timeAgo(l.ts) + '</div></div>' +
        '<div class="b ' + (l.type === 'out' ? 'red' : 'green') + '">' + (l.type === 'out' ? '-' : '+') + uStr(l.n) + ' USDT</div></div>';
    }).join('') + '</div>' :
    '<div class="empty-state"><div class="txt2">暂无转账记录</div></div>') +
    '</div></div>';
}
Screens.wallet = walletScreen;

/* ---------- 任务页 ----------
   ★ 2026-10-03（用户要求）：任务只保留「每日签到」，每日任务 / 成长任务全部下线。
   ★ 签到规则：连续第 1 天 1 USDT、第 2 天 2 USDT … 第 7 天 7 USDT（一周共 28 USDT），
     断签则从第 1 天重新开始。档位数与每档数值仍由后台「参数配置 → 任务/签到」下发。 */
function taskScreen() {
  var st = (S.user && S.user.signin) || { day: 0, last: 0 };
  var d0 = new Date(); d0.setHours(0, 0, 0, 0);
  var today0 = d0.getTime();
  var signedToday = (+st.last || 0) === today0;
  var doneDays = signedToday ? Math.max(0, +st.day || 0) : 0;
  var cfg = (TASK_REWARD && Array.isArray(TASK_REWARD.signin) && TASK_REWARD.signin.length)
    ? TASK_REWARD.signin : [1, 2, 3, 4, 5, 6, 7];
  var sum = 0; cfg.forEach(function (v) { sum += (+v || 0); });
  var totalTxt = (TASK_REWARD && +TASK_REWARD.signinTotal > 0) ? +TASK_REWARD.signinTotal : sum;
  var btn = signedToday
    ? '<div class="btn sm ghost" style="opacity:.7">今日已签</div>'
    : '<div class="btn sm gold" id="task-signin">签到</div>';
  return '<div class="app-shell">' +
    '<div class="topbar"><div class="icon-btn" data-act="back">' + icon('back', 18) + '</div><div class="title grow">任务</div>' +
    '<div class="icon-btn" data-act="mail">' + icon('mail', 18) + '</div></div>' +
    '<div class="body">' +
    '<div class="card gold row"><div style="color:var(--gold)">' + icon('fire', 24) + '</div>' +
    '<div class="grow"><div class="b">每日签到</div>' +
    '<div class="tiny txt3 mt8">' + (signedToday ? '已连续签到 ' + doneDays + ' 天' : '连续签到累计可领 ' + uStr(totalTxt) + ' USDT') + '</div></div>' +
    /* ★ 签到走服务端 /papi/signin（真发USDT，带流水，一天一次） */
    btn + '</div>' +
    '<div class="hscroll mt12">' + cfg.map(function (v, i) {
      var got = i < doneDays;
      return '<div class="card center" style="min-width:66px;padding:8px;' +
        (got ? 'border-color:rgba(245,195,82,.5)' : 'opacity:.55') + '">' +
        '<div class="tiny txt3">第' + (i + 1) + '天</div>' +
        '<div style="font-size:20px;margin:4px 0">' + (got ? '✅' : '🎁') + '</div>' +
        '<div class="tiny gold">' + short(v) + '</div></div>';
    }).join('') + '</div>' +
    '<div class="card mt12"><div class="row gap8"><span class="gold">' + icon('info', 16) + '</span>' +
    '<div class="tiny txt3 grow">第 1 天领 1 USDT，第 2 天 2 USDT，以此类推，第 7 天 7 USDT。' +
    '中途断签会重新从第 1 天开始。签到所得为真实 USDT，可直接上桌或提现。</div></div></div>' +
    '<div class="tiny txt3 center mt12">任务奖励已下线</div>' +
    '</div></div>';
}

/* ---------- 排行榜：已移除（2026-10-01） ----------
   它展示的是「谁钱多」，而榜单本身是 S.rank 这份本地假数据撑起来的，
   还要把别人的余额直接摆到台面上。产品方向换成「好友」——
   做真实社交关系，不做财富排名。
   原来的 rankScreen() / RankTab / data-rk 分支、以及「我的排名：第 128 名」这种
   写死的数字，全部删除。 */

/* ---------- 数据统计 ---------- */
function statScreen() {
  var u = S.user;
  var st = (u.stat && typeof u.stat === 'object') ? u.stat : {};
  var daily = (st.daily && typeof st.daily === 'object') ? st.daily : {};
  /* ★ 2026-10-08：近 30 天盈亏曲线改为服务端逐日真实累计（原来是 rnd() 假数据） */
  var pts = [], v = 0, i, d, k;
  var now = Date.now();
  for (i = 29; i >= 0; i--) {
    d = new Date(now - i * 86400000);
    k = d.toISOString().slice(0, 10);
    v += (+daily[k] || 0);
    pts.push(v);
  }
  var max = Math.max.apply(null, pts), min = Math.min.apply(null, pts), w = 100 / 29;
  var path = pts.map(function (p, i) { return (i * w).toFixed(2) + ',' + (50 - (p - min) / Math.max(1, max - min) * 46).toFixed(2); }).join(' ');
  /* ★ 对局记录：服务端逐手记录（哪个房间 / 何时 / 输赢多少 USDT） */
  var log = Array.isArray(st.log) ? st.log.slice(0, 30) : [];
  var logHtml = log.length ? '<div class="list">' + log.map(function (g) {
    var td = new Date(+g.t || 0);
    var tstr = ('0' + (td.getMonth() + 1)).slice(-2) + '-' + ('0' + td.getDate()).slice(-2) + ' ' + ('0' + td.getHours()).slice(-2) + ':' + ('0' + td.getMinutes()).slice(-2);
    var dv = Math.round(+(g.delta || 0) * 100) / 100;
    return '<div class="li"><div class="grow" style="min-width:0"><div class="li-title">' + esc(g.room || ('房间 ' + (g.no || ''))) + '</div>' +
      '<div class="li-sub">' + tstr + '</div></div>' +
      '<div class="b' + (dv >= 0 ? ' gold' : '') + '" style="' + (dv >= 0 ? '' : 'color:#7fd7a8') + '">' + (dv >= 0 ? '+' : '') + uStr(dv) + '</div></div>';
  }).join('') + '</div>'
    : '<div class="card tiny txt3">暂无对局，打过牌之后这里会逐手显示：哪个房间、几点、输赢多少</div>';
  return '<div class="app-shell">' +
    '<div class="topbar"><div class="icon-btn" data-act="back">' + icon('back', 18) + '</div><div class="title grow">数据统计</div></div>' +
    '<div class="body">' +
    '<div class="card"><div class="b small">近 30 天盈亏曲线</div>' +
    '<svg viewBox="0 0 100 60" preserveAspectRatio="none" style="width:100%;height:130px;margin-top:8px">' +
    '<polyline points="' + path + '" fill="none" stroke="#f5c352" stroke-width="1.2" vector-effect="non-scaling-stroke"/>' +
    '<line x1="0" y1="30" x2="100" y2="30" stroke="#26313f" stroke-width=".4"/></svg>' +
    '<div class="row tiny txt3"><span>30 天前</span><span class="grow center">时间</span><span>今天</span></div></div>' +
    '<div class="section-title">核心数据</div>' +
    '<div class="grid g3 gap8">' +
    statBox(fmtInt(st.hands || 0), '总手牌数') +
    statBox((st.net || 0) >= 0 ? '+' + short(st.net || 0) : short(st.net || 0), '净盈利') +
    statBox(fmtInt(st.win || 0), '赢下底池') +
    '</div>' +
    '<div class="section-title">生涯</div>' +
    '<div class="list">' +
    '<div class="li"><div class="grow">总手牌数</div><div class="b">' + fmtInt(st.hands || 0) + '</div></div>' +
    '<div class="li"><div class="grow">累计盈利</div><div class="b ' + ((st.net || 0) >= 0 ? 'gold' : '') + '">' + ((st.net || 0) >= 0 ? '+' : '') + short(st.net || 0) + '</div></div>' +
    '</div>' +
    '<div class="section-title">对局记录</div>' + logHtml +
    '<div class="tiny txt3 center mt12">数据仅供娱乐统计，不作为任何投注建议</div>' +
    '</div></div>';
}
function statBox(v, k) { return '<div class="card center"><div class="b gold" style="font-size:17px">' + v + '</div><div class="tiny txt3">' + k + '</div></div>'; }

/* ---------- 邮件 ----------
   ★ 2026-10-02：以前 S.mails 是 initData() 里造的本地假数据，「领取」就是本地加钱 ——
     和任务奖励一样能零成本刷USDT，而且后台根本触达不到玩家。
     现在邮件一律来自服务端（系统邮件 + 后台全服公告 + 转账通知），
     附件由服务端发放并入账，写进USDT流水。 */
Screens.mail = function () {
  openSheet({
    title: '邮件',
    body: '<div id="ml-root"><div class="li"><div class="li-sub">加载中…</div></div></div>',
    onReady: function (root, close) { renderMailBox(root, close); }
  });
};
function renderMailBox(root, close) {
  var box = $('#ml-root', root); if (!box) return;
  apiMails().then(function (r) {
    var b = $('#ml-root', root); if (!b) return;
    if (r.code !== 200 || !r.j.list) {
      b.innerHTML = '<div class="empty">' + icon('mail', 40) + '<div>' +
        (r.code === 0 ? '网络不可用，无法读取邮件' : esc((r.j && r.j.msg) || '读取失败')) + '</div></div>';
      return;
    }
    var list = r.j.list || [];
    S.mails = list;   /* 同步本地缓存，用于红点计数 */
    var unreadAll = list.filter(function (m) { return !m.read; }).length;
    S.unread.mail = unreadAll;
    if (typeof lobbyRepaintMailBadge === 'function') lobbyRepaintMailBadge();
    var unread = list.filter(function (m) { return !m.read && m.gift; });
    if (!list.length) {
      b.innerHTML = '<div class="empty">' + icon('mail', 40) + '<div>暂时没有邮件</div>' +
        '<div class="tiny txt3 mt8">系统通知、后台公告、转账到账提醒都会出现在这里</div></div>';
      return;
    }
    b.innerHTML = (unread.length ? '<button class="btn gold block mb12" id="ml-all">一键领取全部附件（' + unread.length + '）</button>' : '') +
      '<div class="list">' + list.map(function (m) {
        return '<div class="li" style="align-items:flex-start" data-mid="' + esc(m.id) + '">' +
          '<div class="center" style="width:36px;height:36px;border-radius:10px;background:' + (m.read ? 'var(--panel2)' : 'rgba(245,195,82,.16)') + ';color:' + (m.read ? 'var(--txt3)' : 'var(--gold)') + '">' + icon('mail', 18) + '</div>' +
          '<div class="grow" style="min-width:0"><div class="row"><span class="li-title">' + esc(m.title) + '</span>' +
          (m.global ? '<span class="tag gold" style="margin-left:6px">全服</span>' : '') +
          '<span class="tiny txt3" style="margin-left:auto">' + timeAgo(m.ts) + '</span></div>' +
          '<div class="li-sub">' + esc(m.body || '—') + '</div>' +
          '<div class="tiny txt3 mt8">来自 ' + esc(m.from || '系统') + '</div>' +
          (m.gift ? '<div class="row mt8 gap6"><span class="tag gold">USDT ' + uStr(m.gift.chips) + '</span>' +
            (m.gift.diamonds ? '<span class="tag gold">钻石 ' + short(m.gift.diamonds) + '</span>' : '') +
            (m.claimed ? '<span class="tag green" style="margin-left:auto">已领取</span>'
              : '<span class="btn xs gold" data-claim="' + esc(m.id) + '" style="margin-left:auto">领取</span>') + '</div>' : '') +
          '</div></div>';
      }).join('') + '</div>' +
      '<div class="tiny txt3 center mt12">附件需要在邮件里主动领取，领取后即时到账</div>';
    var all = $('#ml-all', root);
    if (all) all.onclick = function () {
      var pending = unread.slice();
      var n = 0, got = 0;
      Promise.all(pending.map(function (m) {
        return apiMailClaim(m.id).then(function (x) {
          if (x.code === 200 && x.j.ok) { n++; got += (x.j.got && x.j.got.chips) || 0; }
        });
      })).then(function () {
        applyServerUserRefresh();
        toast('已领取 ' + n + ' 封邮件附件，共 +' + uStr(got) + ' USDT', 'ok');
        close(); Screens.mail();
      });
    };
    bindClick(root, function (e) {
      var c = e.target.closest('[data-claim]'); if (!c) return;
      var btn = c; btn.textContent = '领取中…';
      apiMailClaim(c.dataset.claim).then(function (x) {
        btn.textContent = '领取';
        if (x.code !== 200 || !x.j.ok) { toast((x.j && x.j.msg) || '领取失败', 'err'); return; }
        applyServerUserRefresh();
        toast('已领取 +' + uStr((x.j.got && x.j.got.chips) || 0) + ' USDT', 'ok');
        close(); Screens.mail();
      });
      var mid = e.target.closest('[data-mid]');
      if (mid) {
        apiMailRead(mid.dataset.mid).then(function (res) {
          if (res.code === 200) {
            S.mails.forEach(function (m) { if (String(m.id) === String(mid.dataset.mid)) m.read = true; });
            S.unread.mail = S.mails.filter(function (m) { return !m.read; }).length;
            if (typeof lobbyRepaintMailBadge === 'function') lobbyRepaintMailBadge();
          }
        });
      }
    });
  });
}
function applyServerUserRefresh() {
  apiMe().then(function (r) { if (r.code === 200 && r.j && r.j.user) applyServerUser(r.j.user); });
}

/* ---------- 用户协议 / 隐私政策 ----------
   ★★ 2026-10-02 修合规硬伤：登录页的《用户协议》《隐私政策》以前点开都是
      「德州扑克玩法规则」（跟协议毫不相干），玩家勾选同意时看到的根本不是条款本身。
      这里补上真实条款文本；随业务调整时改这两段即可。 */
function legalDocHTML(kind) {
  var isTerms = kind !== 'privacy';
  return '<div class="card" style="line-height:1.7;font-size:13px">' +
    (isTerms
      ? '<div class="b mb8">一、服务性质</div>' +
        '本平台提供的德州扑克游戏，全部以 <b>USDT</b> 计价与结算：充值、牌桌下注、提现均为同一笔 USDT 余额，' +
        '不含任何虚拟USDT或中间兑换环节。<br><br>' +
        '<div class="b mb8">二、账户与年龄</div>' +
        '1. 注册用户须年满 18 周岁，并保证注册信息真实、准确。<br>' +
        '2. 一个自然人仅限持有并使用一个账号；同一设备、同一 IP 批量注册将被风控识别并处置。<br>' +
        '3. 账号不得出借、转让、出售。因账号保管不善造成的后果由用户自行承担。<br><br>' +
        '<div class="b mb8">三、虚拟道具与资金</div>' +
        '1. 余额来源：USDT 充值、签到与活动发放、牌桌输赢、后台发放。<br>' +
        '2. 提现：账户 USDT 余额（含牌桌盈利）均可申请提现，按平台公示规则收取单笔固定手续费。<br>' +
        '3. 提现需通过实名认证与风控审核；异常余额跳变将被标记并可能暂缓出款。<br>' +
        '4. 平台不生成、不托管任何资金地址；充值地址与出款由持牌运营方的支付服务商完成。<br><br>' +
        '<div class="b mb8">四、禁止行为</div>' +
        '使用外挂、脚本、多开协同作弊；利用系统漏洞套利；洗钱、套现、非法资金中转；' +
        '发布违法违规信息；冒充平台工作人员。一经核实，平台有权冻结账号、清零违规所得并永久封禁。<br><br>' +
        '<div class="b mb8">五、免责与变更</div>' +
        '因网络、设备、运营商、不可抗力导致的服务中断，平台不承担责任。' +
        '本协议可能随法律法规与业务调整而更新，更新后继续使用即视为接受。'
      : '<div class="b mb8">一、我们收集的信息</div>' +
        '1. 注册信息：账号、昵称、加密后的登录密码（我们只保存不可逆的加盐哈希，不保存明文）。<br>' +
        '2. 必要的业务信息：充值 / 提现订单记录、设备与 IP 日志（用于风控与找回事宜）。<br>' +
        '3. 游戏数据：牌局记录、USDT 资金流水，用于提供服务、处理争议与反作弊。<br><br>' +
        '<div class="b mb8">二、我们使用信息的目的</div>' +
        '提供服务与客服支持；风险控制（识别异常登录、批量注册、套利行为）；' +
        '履行反洗钱与合规义务；在匿名化、聚合化前提下做产品统计。<br><br>' +
        '<div class="b mb8">三、信息的共享</div>' +
        '我们不会出售你的个人信息。仅在下列情形共享：为完成支付与出款，向持牌支付服务商提供必要信息；' +
        '应法律法规或有权机关的强制要求。<br><br>' +
        '<div class="b mb8">四、你的权利</div>' +
        '你可通过「我的 → 客服工单」申请查询、更正或删除你的个人信息；' +
        '也可通过设置关闭聊天、好友邀请等社交功能。<br><br>' +
        '<div class="b mb8">五、安全措施</div>' +
        '密码使用 scrypt 加盐哈希存储；管理后台独立鉴权；' +
        '所有后台操作写入审计日志；数据每日本地备份。' +
        '请妥善保管账号与支付密码，不要向任何人透露。') +
    '</div>' +
    '<div class="tiny txt3 center mt12">最后更新：2026-10-02 · 如有疑问请通过「我的 → 客服工单」联系</div>';
}
bindAct('terms', function () {
  openSheet({ title: '用户协议', body: legalDocHTML('terms') });
});
bindAct('privacy', function () {
  openSheet({ title: '隐私政策', body: legalDocHTML('privacy') });
});

/* ---------- 成就 / 实名 / 安全 ---------- */
function showAchieve() {
  openSheet({
    title: '我的成就',
    body: '<div class="grid g2 gap8">' + S.achievements.map(function (a) {
      return '<div class="card center" style="' + (a.got ? 'border-color:rgba(245,195,82,.45)' : 'opacity:.5') + '">' +
        '<div style="color:' + (a.got ? 'var(--gold)' : 'var(--txt3)') + '">' + icon(a.icon, 26) + '</div>' +
        '<div class="b small mt8">' + a.name + '</div><div class="tiny txt3">' + a.desc + '</div>' +
        (a.got ? '<div class="tag green mt8">已获得</div>' : '<div class="tag mt8">未解锁</div>') + '</div>';
    }).join('') + '</div>'
  });
}
function showSecurity() {
  openSheet({
    title: '账号安全',
    body: '<div class="list">' +
      '<div class="li"><div class="grow"><div class="li-title">手机号</div><div class="li-sub">' + (S.user.phone || '未绑定') + '</div></div><span class="tag ' + (S.user.phone ? 'green">已绑定' : 'gray">未绑定') + '</span></div>' +
      '<div class="li" data-sec="pwd"><div class="grow"><div class="li-title">登录密码</div><div class="li-sub">建议 90 天更换一次</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-sec="pay"><div class="grow"><div class="li-title">支付密码</div><div class="li-sub">转账时使用' +
      (S.user && S.user.hasPaypwd === false ? '（未设置，转账前请先设置）' : '') + '</div></div>' +
      '<span class="tag ' + (S.user && S.user.hasPaypwd === false ? 'red' : 'gold') + '">' + (S.user && S.user.hasPaypwd === false ? '未设置' : '已设置') + '</span></div>' +
      '<div class="li" data-sec="real"><div class="grow"><div class="li-title">实名认证</div><div class="li-sub">未认证将限制部分功能</div></div><span class="tag red">未认证</span></div>' +
      '<div class="li" data-sec="dev"><div class="grow"><div class="li-title">登录设备管理</div><div class="li-sub">3 台设备</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-sec="log"><div class="grow"><div class="li-title">登录日志</div><div class="li-sub">最近 5 条记录</div></div>' + icon('right', 16) + '</div>' +
      '</div>',
    onReady: function (root) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-sec]'); if (!b) return;
        var a = b.dataset.sec;
        if (a === 'pwd') promptBox('修改登录密码', { label: '新密码（至少 6 位）', type: 'password', required: true }).then(function (v) {
          /* ★ 登录密码以前也是纯 toast 演示（点完没有任何变化）。现在打到服务端。 */
          if (!v) return;
          if (String(v).length < 6) { toast('密码至少 6 位', 'err'); return; }
          apiCall('/auth/password', { method: 'POST', body: { pwd: String(v) } }).then(function (r) {
            if (r.code === 200 && r.j.ok) toast('登录密码已修改', 'ok');
            else toast((r.j && r.j.msg) || '修改失败', 'err');
          });
        });
        if (a === 'pay') promptBox('设置支付密码', { label: '6 位数字密码', type: 'password', required: true, sub: '用于转账' }).then(function (v) {
          if (!v) return;
          if (!/^\d{6}$/.test(String(v))) { toast('支付密码需为 6 位数字', 'err'); return; }
          /* ★ 以前只是 toast「已设置」，实际密码写死在转账页（123456 谁都能过）。现在落服务端。 */
          apiPaypwdSet(v).then(function (r) {
            if (r.code === 200 && r.j.ok) {
              S.user.hasPaypwd = true; saveState();
              toast('支付密码已设置，转账时需要使用', 'ok');
            } else toast((r.j && r.j.msg) || '设置失败', 'err');
          });
        });
        if (a === 'real') confirmBox('实名认证', '实名认证仅供演示，不会上传真实信息。', '前往认证').then(function (ok) { if (ok) toast('认证成功（演示）', 'ok'); });
        if (a === 'dev') toast('设备管理（演示）');
        if (a === 'log') toast('登录日志（演示）');
      });
    }
  });
}

/* ---------- 设置 ---------- */
Screens.settings = function () {
  openSheet({
    title: '设置',
    body: '<div class="section-title" style="margin-top:0">音效与画面</div>' +
      '<div class="list">' +
      rowSwitch('sound', '游戏音效', S.settings.sound) +
      rowSwitch('voice', '人声播报（牌桌动作）', S.settings.voice !== false) +
      rowSwitch('music', '背景音乐', S.settings.music) +
      rowSwitch('vibrate', '震动反馈', S.settings.vibrate) +
      rowSwitch('fourColor', '四色扑克牌', S.settings.fourColor) +
      '</div>' +
      '<div class="section-title">游戏</div>' +
      '<div class="list">' +
      rowSwitch('autoBuyIn', '自动买入', S.settings.autoBuyIn) +
      rowSwitch('autoRebuy', '自动补码', S.settings.autoRebuy) +
      rowSwitch('autoMuck', '自动盖牌', S.settings.autoMuck) +
      rowSwitch('showOdds', '显示胜率提示', S.settings.showOdds) +
      '</div>' +
      '<div class="section-title">隐私与通知</div>' +
      '<div class="list">' +
      rowSwitch('privateMsg', '允许陌生人私信', S.settings.privateMsg) +
      rowSwitch('allowInvite', '允许好友邀请', S.settings.allowInvite) +
      rowSwitch('allowTransfer', '允许接收转账', S.settings.allowTransfer) +
      '<div class="li" data-set="lang" data-lang-open="1"><div class="grow"><div class="li-title">语言</div></div><span class="tiny txt2" data-i18n-curlang>' + (window.I18N ? (I18N.langs.filter(function (l) { return l.k === I18N.get(); })[0] || I18N.langs[0]).n : '简体中文') + '</span>' + icon('right', 16) + '</div>' +
      '</div>' +
      '<div class="section-title">其它</div>' +
      '<div class="list">' +
      '<div class="li" data-set="addhome"><div class="grow"><div class="li-title">添加到主屏幕</div><div class="li-sub">像 App 一样从桌面打开</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-set="cache"><div class="grow"><div class="li-title">清除缓存</div><div class="li-sub">当前缓存 128 MB</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-set="about"><div class="grow"><div class="li-title">关于我们</div><div class="li-sub">版本 v3.8.2</div></div>' + icon('right', 16) + '</div>' +
      '<div class="li" data-set="rule"><div class="grow"><div class="li-title">规则说明</div></div>' + icon('right', 16) + '</div>' +
      '</div>' +
      '<button class="btn ghost block mt16" data-act="logout">' + icon('logout', 16) + ' 退出登录</button>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var sw = e.target.closest('[data-sw]');
        if (sw) {
          var k = sw.dataset.sw; S.settings[k] = !S.settings[k]; applySetting(k, S.settings[k]); saveState();
          sw.querySelector('.switch').classList.toggle('on', S.settings[k]);
          toast('设置已保存'); return;
        }
        var b = e.target.closest('[data-set]'); if (!b) return;
        var a = b.dataset.set;
        /* ★ 2026-10-03 多语言：真切换（简体 / 繁體 / English），不再是演示 */
        if (a === 'lang') {
          if (window.I18N) {
            I18N.open();
            I18N.onChange(function (l) {
              var el = document.querySelector('[data-i18n-curlang]');
              if (el) {
                var cur = I18N.langs.filter(function (x) { return x.k === l; })[0] || I18N.langs[0];
                el.textContent = cur.n;
              }
            });
          } else toast('语言切换（演示）');
          return;
        }
        if (a === 'addhome') promptAddToHome();
        if (a === 'cache') confirmBox('清除缓存', '将清除本地图片与日志缓存。', '清除').then(function (ok) { if (ok) toast('缓存已清除', 'ok'); });
        if (a === 'about') openModal({ title: '关于', buttons: false, body: '<div class="center col" style="padding:10px 0;gap:6px">' + icon('cards', 40) + '<div class="b">德州扑克 UI Demo</div><div class="tiny txt3">v3.8.2 · Build 20260930</div><div class="tiny txt3 mt8">本 Demo 仅用于界面展示，所有数据均为虚拟数据</div></div>' });
        if (a === 'rule') { close(); Screens.rule(); }
      });
    }
  });
};

/* ---------- 客服 ---------- */
Screens.service = function () {
  openSheet({
    title: '客服中心',
    body: '<div class="grid g2 gap8">' +
      ['充值未到账', '账号问题', '举报作弊', '提现申请进度', '规则咨询', 'BUG 反馈'].map(function (x) {
        return '<div class="card center" data-sv="' + x + '" style="cursor:pointer;padding:12px 4px">' + icon('help', 20) + '<div class="tiny txt2 mt8">' + x + '</div></div>';
      }).join('') + '</div>' +
      '<div class="section-title">常见问题</div>' +
      '<div class="list">' +
      ['如何购买保险？|All-in 时系统会自动弹出保险窗口，点击立即投保即可。',
      '为什么我无法转账？|需设置支付密码，且当日转账额度未超限。',
      '怎么充值、怎么提现？|充值：用 USDT 直接充值，审核到账后进入余额。提现：余额里的 USDT 可直接申请提现，单笔固定手续费 2 USDT，不限额度，走风控审核。全程没有「USDT」这一层。',
      'VPIP 是什么意思？|VPIP 表示主动入池率，是重要的扑克数据指标。'].map(function (x) {
        var p = x.split('|');
        return '<div class="li" style="align-items:flex-start"><div class="grow"><div class="li-title">' + p[0] + '</div>' +
          '<div class="li-sub" id="sv-a" style="display:none;margin-top:6px">' + p[1] + '</div></div>' + icon('down', 16) + '</div>';
      }).join('') + '</div>' +
      '<div class="section-title">在线客服</div>' +
      (function () {
        var sup = (S.serverCfg && S.serverCfg.support) || {};
        if (sup.enabled && /^https?:\/\//i.test(sup.url || '')) {
          return '<div class="center" style="padding:10px 0">' +
            '<button class="btn gold" id="sv-3rd" style="width:80%;max-width:320px;padding:14px;font-size:15px">联系在线客服</button>' +
            '<div class="tiny txt3 mt8">已接入第三方客服系统，点击将打开客服对话窗口</div></div>';
        }
        return '<div class="chat-msgs" style="height:160px;background:var(--panel);border-radius:12px">' +
          '<div class="chat-msg"><div class="col"><div class="nm">客服小助手 · 在线</div><div class="bubble">您好，请问有什么可以帮您？</div></div></div>' +
          '</div>' +
          '<div class="chat-input" style="padding:8px 0"><div class="input-wrap grow"><input placeholder="输入您的问题…"></div><div class="btn gold sm">发送</div></div>';
      })(),
    onReady: function (root) {
      bindClick(root, function (e) {
        var b3 = e.target.closest('#sv-3rd');
        if (b3) {
          var sup = (S.serverCfg && S.serverCfg.support) || {};
          if (sup.enabled && /^https?:\/\//i.test(sup.url || '')) { window.open(sup.url, '_blank'); }
          else toast('客服系统暂未配置', 'err');
          return;
        }
        var b = e.target.closest('[data-sv]');
        if (b) { toast('已转接人工客服（演示）'); return; }
        var li = e.target.closest('.li');
        if (li && li.querySelector('#sv-a')) { var a = li.querySelector('#sv-a'); a.style.display = a.style.display === 'none' ? 'block' : 'none'; }
      });
    }
  });
};

/* ---------- 规则 ---------- */
Screens.rule = function () {
  openModal({
    title: '德州扑克规则', size: 'wide', buttons: false,
    body: '<div style="font-size:13px;line-height:1.9">' +
      '<p><b>游戏目标</b>：用 2 张底牌与 5 张公共牌组成最大的 5 张牌型，赢取底池。</p>' +
      '<p><b>牌型大小</b>：皇家同花顺 > 同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌。</p>' +
      '<p><b>下注轮</b>：翻牌前（Preflop）→ 翻牌（Flop 3 张）→ 转牌（Turn）→ 河牌（River）→ 摊牌（Showdown）。</p>' +
      '<p><b>操作</b>：弃牌（Fold）、过牌（Check）、跟注（Call）、加注（Raise）、全下（All-in）。</p>' +
      '<p><b>保险</b>：All-in 时可按实时胜率购买 EV 保险，未赢下底池则获赔付。</p>' +
      '<p class="txt3">本应用为纯界面演示，不涉及任何真实货币交易与赌博行为，请理性娱乐。</p>' +
      '</div>'
  });
};

/* ---------- 个人资料 ---------- */
/* ★ 2026-10-03：换头像面板 —— 可以上传自己的图片，也可以直接挑一张系统头像。
   上传前用 canvas 压到 256px / JPEG 0.82（原图动辄几 MB，没必要往服务器塞）。 */
function showAvatarPicker(done) {
  var sel = S.user.avatar || '';
  openSheet({
    title: '更换头像',
    body: '<div class="center col" style="gap:8px;padding:4px 0 10px">' +
      '<div id="ap-prev">' + avatarHTML(S.user, 'xl', { frame: 'gold' }) + '</div>' +
      '<div class="tiny txt3">当前头像</div></div>' +
      '<div class="row gap8">' +
      '<label class="btn gold grow center" style="margin:0">上传图片' +
      '<input type="file" id="ap-file" accept="image/*" style="display:none"></label>' +
      '<div class="btn ghost" id="ap-reset">恢复默认</div></div>' +
      '<div class="tiny txt3 mt8">支持 PNG / JPG / WEBP，自动压缩到 256×256，单张 ≤ 2MB</div>' +
      '<div class="section-title">系统头像</div>' +
      '<div class="grid g4 gap8">' + (function () {
        var h = '';
        for (var i = 0; i < sysAvatarCount(); i++) {
          var cur = sel === 'sys:' + i;
          h += '<div class="card center" data-av="sys:' + i + '" style="padding:8px;cursor:pointer;' +
            (cur ? 'border-color:rgba(245,195,82,.7)' : '') + '">' +
            '<div style="width:52px;height:52px;margin:0 auto">' +
            botAvatarSVG(null, 'sys#' + i) + '</div>' +
            '<div class="tiny ' + (cur ? 'gold' : 'txt3') + '" style="margin-top:4px">' + (cur ? '使用中' : '第 ' + (i + 1) + ' 号') + '</div></div>';
        }
        return h;
      })() + '</div>' +
      '<div id="ap-msg" class="tiny txt3 mt8"></div>',
    onReady: function (root, close) {
      function preview(av) {
        var p = $('#ap-prev', root); if (!p) return;
        p.innerHTML = avatarHTML({ name: S.user.name, color: S.user.color, avatar: av }, 'xl', { frame: 'gold' });
      }
      bindClick(root, function (e) {
        var c = e.target.closest('[data-av]'); if (!c) return;
        var av = c.dataset.av;
        var msg = $('#ap-msg', root); if (msg) msg.textContent = '保存中…';
        apiSetAvatarSys(av).then(function (r) {
          if (r.code !== 200 || !r.j.ok) {
            if (msg) msg.textContent = '✘ ' + ((r.j && r.j.msg) || '保存失败');
            return;
          }
          S.user.avatar = r.j.avatar || av; if (r.j.user) applyServerUser(r.j.user);
          saveState(); toast('头像已更新', 'ok'); close(); if (done) done();
        });
      });
      var f = $('#ap-file', root);
      if (f) f.onchange = function () {
        var file = f.files && f.files[0]; if (!file) return;
        var msg = $('#ap-msg', root);
        if (msg) msg.textContent = '处理中…';
        compressImage(file, 256, function (dataUrl) {
          if (!dataUrl) { if (msg) msg.textContent = '✘ 图片读取失败'; return; }
          if (msg) msg.textContent = '上传中…';
          apiSetAvatarUpload(file.name || 'avatar.jpg', dataUrl).then(function (r) {
            if (r.code !== 200 || !r.j.ok) {
              if (msg) msg.textContent = '✘ ' + ((r.j && r.j.msg) || '上传失败');
              return;
            }
            S.user.avatar = r.j.avatar || ''; if (r.j.user) applyServerUser(r.j.user);
            saveState(); toast('头像已更新', 'ok'); close(); if (done) done();
          });
        });
      };
      var rs = $('#ap-reset', root);
      if (rs) rs.onclick = function () {
        apiSetAvatarSys('reset').then(function (r) {
          if (r.code !== 200 || !r.j.ok) { toast((r.j && r.j.msg) || '恢复失败', 'err'); return; }
          S.user.avatar = ''; if (r.j.user) applyServerUser(r.j.user);
          saveState(); toast('已恢复为默认头像', 'ok'); close(); if (done) done();
        });
      };
    }
  });
}
/* 图片压缩：等比缩到 maxPx 以内，输出 JPEG dataURL（头像只有几十 KB 就够用） */
function compressImage(file, maxPx, cb) {
  try {
    var rd = new FileReader();
    rd.onload = function () {
      var img = new Image();
      img.onload = function () {
        /* ★ 2026-10-07：头像统一「中心裁方」—— 之前保持长宽比，非正方形图（如 172×256）
           传上去被圆形容器 cover 裁得七零八落/拉变形；先裁方再压 256，所见即所得。 */
        var side = Math.min(img.width, img.height);
        var sx = Math.max(0, (img.width - side) / 2), sy = Math.max(0, (img.height - side) / 2);
        var px = Math.max(1, Math.min(maxPx || 256, side));
        var c = document.createElement('canvas');
        c.width = px; c.height = px;
        var g = c.getContext('2d');
        g.fillStyle = '#1b2430'; g.fillRect(0, 0, px, px);
        g.drawImage(img, sx, sy, side, side, 0, 0, px, px);
        cb(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { cb(null); };
      img.src = rd.result;
    };
    rd.onerror = function () { cb(null); };
    rd.readAsDataURL(file);
  } catch (e) { cb(null); }
}
Screens.profile = function () {
  openSheet({
    title: '个人资料',
    body: '<div class="center col" style="gap:8px;padding:6px 0 14px">' +
      '<div data-pf="avatar" style="cursor:pointer">' + avatarHTML(S.user, 'xl', { frame: 'gold' }) + '</div>' +
      '<div class="btn xs ghost" data-pf="avatar">更换头像</div>' +
      '<div class="row gap6"><span class="b">' + esc(S.user.name) + '</span><span class="tag gold">VIP' + S.user.vip + '</span></div>' +
      '<div class="tiny txt3">ID ' + S.user.id + '</div></div>' +
      '<div class="list">' +
      '<div class="li" data-pf="name"><div class="grow"><div class="li-title">昵称</div></div><span class="tiny txt2">' + esc(S.user.name) + '</span>' + icon('edit', 15) + '</div>' +
      '<div class="li" data-pf="sign"><div class="grow"><div class="li-title">个性签名</div></div><span class="tiny txt2">' + esc(S.user.signature) + '</span>' + icon('edit', 15) + '</div>' +
      '<div class="li" data-pf="gender"><div class="grow"><div class="li-title">性别</div></div><span class="tiny txt2">' + S.user.gender + '</span>' + icon('right', 16) + '</div>' +
      '<div class="li" data-pf="city"><div class="grow"><div class="li-title">地区</div></div><span class="tiny txt2">' + S.user.country + '</span>' + icon('right', 16) + '</div>' +
      '<div class="li" data-pf="frame"><div class="grow"><div class="li-title">头像框</div></div><span class="tiny txt2">尊贵金框</span>' + icon('right', 16) + '</div>' +
      '</div>' +
      '<div class="grid g3 gap8 mt12">' +
      '<div class="card center"><div class="b gold">' + S.user.hands + '</div><div class="tiny txt3">手牌</div></div>' +
      '<div class="card center"><div class="b green">' + S.user.winRate + '%</div><div class="tiny txt3">胜率</div></div>' +
      '<div class="card center"><div class="b">' + short(S.user.profit) + '</div><div class="tiny txt3">盈利</div></div>' +
      '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-pf]'); if (!b) return;
        var a = b.dataset.pf;
        /* ★ 2026-10-03：换头像（上传图片 / 系统预设） */
        if (a === 'avatar') { showAvatarPicker(function () { close(); Screens.profile(); }); return; }
        /* ★ 2026-10-03：昵称改走服务端（以前只改本地变量，刷新就回去了，也不查重名） */
        if (a === 'name') promptBox('修改昵称', { label: '新昵称（2-16 字）', value: S.user.name, required: true }).then(function (v) {
          if (!v) return;
          v = String(v).trim();
          if (v === S.user.name) return;
          apiRename(v).then(function (r) {
            if (r.code !== 200 || !r.j.ok) {
              toast((r.j && r.j.msg) || (r.code === 0 ? '网络不可用，无法修改昵称' : '修改失败'), 'err', 2800);
              return;
            }
            if (r.j.user) applyServerUser(r.j.user); else S.user.name = v;
            saveState(); toast('昵称已更新', 'ok'); close(); Screens.profile();
          });
        });
        if (a === 'sign') promptBox('修改签名', { label: '个性签名', value: S.user.signature }).then(function (v) { if (v) { S.user.signature = v; saveState(); toast('已更新'); close(); Screens.profile(); } });
        if (a === 'gender') openSheet({ title: '选择性别', body: '<div class="list">' + ['男', '女', '保密'].map(function (g) { return '<div class="li" data-g="' + g + '"><div class="grow">' + g + '</div></div>'; }).join('') + '</div>', onReady: function (r2, c2) { bindClick(r2, function (e2) { var x = e2.target.closest('[data-g]'); if (x) { S.user.gender = x.dataset.g; saveState(); c2(); toast('已更新'); } }); } });
        if (a === 'city') toast('地区选择（演示）');
        if (a === 'frame') toast('头像框（演示）');
      });
    }
  });
};
bindAct('profile', function () { Screens.profile(); });
bindAct('mail', function () { Screens.mail(); });
bindAct('settings', function () { Screens.settings(); });
bindAct('service', function () {
  var sup = (S.serverCfg && S.serverCfg.support) || {};
  if (/^https?:\/\//i.test(sup.url || '')) {
    window.open(sup.url, '_blank');
  } else {
    Screens.service();
  }
});









