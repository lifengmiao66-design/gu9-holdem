/* ===== wallet.js · 钱包 / 充值 / 提现 / 订单 / 转账 =====
   ★ 商城页面已按产品决定整体下线：底部导航、大厅快捷入口、钱包页入口、路由注册 全部移除。
   ★★ 资金口径（用户 2026-10-01 明确，别再改）：
      · 充值档位按 USDT 计价，到账即账户 USDT 余额；
      · 充值：付 USDT → 审核 completed 后充入 USDT 余额；「100 U 快捷档」一键下单。
      · 提现：账户 USDT 余额直接提（无需任何兑换步骤），单笔固定手续费 2 USDT；
        提现单笔固定手续费 2 USDT，**不限额度**（有多少提多少）。
      · 兑换不收费；费用只在提现时收。
   ★ 资金通道由持牌运营方的支付适配器提供；本服务不生成收款地址、不托管资金。 */

/* ---------- 充值 / 提现 / 我的订单（实现在下文的 showRecharge / showWithdraw） ----------
   USDT 余额可通过充值获得，也能通过每日签到 / 活动 / 官方补偿获得
   （后台「用户管理 › 编辑」可以直接调余额用于补偿）。
   ★ 资金通道留空：后端 payCreate() 恒返回 provider:'none' + address:null，
     不生成地址、不查链上、不发起出款；接入由持牌方的工程师完成。 */

/* ---------- 转账 ---------- */
function showTransfer(preset) {
  var targets = S.friends.slice(0, 6);
  var cur = preset || null;
  var amount = 10;   /* ★ USDT 化：输入框单位是「USDT 元」，提交时 ×100 转分 */
  openSheet({
    title: '转账',
    body: '<div class="section-title" style="margin-top:0">选择收款人</div>' +
      '<div class="hscroll">' + targets.map(function (f) {
        return '<div class="card center" data-to="' + f.id + '" style="min-width:74px;padding:8px;cursor:pointer">' +
          avatarHTML(f, 'md', { status: 1 }) + '<div class="tiny txt2 mt8">' + esc(f.name) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="field mt12"><div class="lb">玩家 ID</div><div class="input-wrap">' + icon('user', 16) +
      '<input id="tf-uid" placeholder="输入收款人 ID" value="' + (cur ? cur.id : '') + '"></div></div>' +
      '<div class="field"><div class="lb">转账金额（USDT）</div><div class="input-wrap"><input id="tf-amt" type="number" step="0.01" value="' + amount + '"></div>' +
      '<div class="tiny txt3">可用 ' + uStr(balCent()) + ' USDT</div></div>' +
      '<div class="hscroll">' + [10, 50, 100, 500, 1000].map(function (a) {
        return '<div class="tag" data-amt="' + (a * 100) + '" style="padding:6px 12px">' + a + ' U</div>';
      }).join('') + '<div class="tag gold" data-amt="' + balCent() + '" style="padding:6px 12px">全部 ' + uStr(balCent()) + '</div></div>' +
      '<div class="field mt12"><div class="lb">备注（选填）</div><div class="input-wrap"><input id="tf-msg" placeholder="写点什么…"></div></div>' +
      /* ★ 2026-10-02：支付密码以前写死 123456，谁都能过。现在走服务端个人密码（未设置则提示先去设置）。 */
      '<div class="field"><div class="lb">支付密码（6 位）</div><div class="input-wrap">' + icon('lock', 16) +
      '<input id="tf-pwd" type="password" placeholder="请输入支付密码"></div>' +
      (S.user && S.user.hasPaypwd === false ? '<div class="tiny txt3 mt8">未设置支付密码，先到「我的 → 安全中心 → 支付密码」设置</div>' : '') + '</div>' +
      /* ★ 2026-10-02：以前写着「手续费 1%」，实际只是从本地数字里扣掉、钱凭空蒸发（对方根本收不到）。
         现在转账走服务端实时到账全额，手续费口径统一为【免费】，界面不许再显示一个收了但没交代的钱。 */
      '<div class="card mt12"><div class="row"><span class="tiny txt2 grow">手续费</span><span class="tiny gold">免费</span></div>' +
      '<div class="row mt8"><span class="tiny txt2 grow">实际到账</span><span class="b gold" id="tf-real">10.00 USDT</span></div>' +
      '<div class="tiny txt3 mt8">★ 只能转给已互加的好友；转账是即时到账，对方可在「邮件」里看到通知</div></div>' +
      '<button class="btn gold block lg mt12" id="tf-ok">确认转账</button>' +
      '<div class="tiny txt3 center mt8" data-act="transfer-log">查看转账记录 ›</div>',
    onReady: function (root, close) {
      function upd() {
        var n = Math.round(+$('#tf-amt', root).value || 0);   /* data-amt 直接给分；手输是元，提交时统一转分 */
        var isCent = n > 0 && n === Math.round(n) && n % 1 === 0 && n > 100000 ? true : false;
        $('#tf-real', root).textContent = isCent ? uStr(n) + ' USDT' : uStr(Math.round(n * 100)) + ' USDT';
      }
      $('#tf-amt', root).oninput = upd; upd();
      $$('[data-amt]', root).forEach(function (b) { b.onclick = function () { $('#tf-amt', root).value = b.dataset.amt; upd(); }; });
      $$('[data-to]', root).forEach(function (c) { c.onclick = function () { $('#tf-uid', root).value = c.dataset.to; toast('已选择收款人'); }; });
      $('#tf-ok', root).onclick = function () {
        var uid = $('#tf-uid', root).value.trim();
        var rawN = Math.round(+$('#tf-amt', root).value || 0);
        var n = rawN;   /* 输入框单位是 USDT 元 → 转分 */
        var pwd = $('#tf-pwd', root).value.trim();
        var msg = $('#tf-msg', root).value.trim();
        if (!uid) { toast('请输入收款人 ID', 'err'); return; }
        if (n <= 0) { toast('请输入转账金额', 'err'); return; }
        if (n < 1) { toast('最少转账 0.01 USDT', 'err'); return; }
        if (Math.round(n * 100) > Math.round(balCent() * 100)) { toast('余额不足', 'err'); return; }
        n = Math.round(n * 100);   /* 元 → 分，服务端按分记账 */
        if (!/^\d{6}$/.test(pwd)) { toast('请输入 6 位支付密码', 'err'); return; }
        /* ★★ 以前这一段是假的：只改本地 S.user.chips（对方一分收不到），
           还会被 apiSync 把假数字回写服务端，手续费等于凭空蒸发。
           现在打到服务端：双写 + 双方流水 + 给对方发邮件，一步到位。 */
        var btn = $('#tf-ok', root); btn.textContent = '转账中…'; btn.disabled = true;
        apiTransfer(uid, n, msg).then(function (r) {
          btn.textContent = '确认转账'; btn.disabled = false;
          if (r.code !== 200 || !r.j.ok) {
            toast((r.j && r.j.msg) || '转账失败，请稍后再试', 'err', 3000);
            return;
          }
          var fee = 0;
          if (r.j.user) applyServerUser(r.j.user);
          var f = S.friends.filter(function (x) { return String(x.id) === String(uid); })[0];
          S.transferLogs.unshift({ id: Date.now(), to: f ? f.name : ('玩家' + uid), uid: uid, n: n, fee: 0, ts: Date.now(), type: 'out', status: '完成' });
          saveState(); close();
          flyText('-' + uStr(n) + ' U', window.innerWidth / 2 - 40, 180);
          toast('转账成功，' + (f ? f.name : '对方') + ' 已到账 ' + uStr(n) + ' USDT', 'ok', 2800);
          if (Route.cur === 'mine') go('mine', { tab: 'wallet' }, { noHist: true });
        });
      };
    }
  });
}

/* ★ 保险箱（场外账户）已按产品决定整体下线：
   入口 / 钱包按钮 / 弹层 / 全局动作 / 余额字段 全部移除。
   牌桌的买入、取回一律走 USDT 账户，不再有第二个场外账户。 */

function refreshCurrent() {
  if (Route.cur === 'lobby') go('lobby', {}, { noHist: true });
  else if (Route.cur === 'mine') go('mine', { tab: Route.lastParams && Route.lastParams.tab }, { noHist: true });
}

/* ---------- 转账记录 ---------- */
function showTransferLog() {
  openSheet({
    title: '转账记录',
    body: '<div class="list">' + (S.transferLogs.length ? S.transferLogs.map(function (l) {
      return '<div class="li"><div class="center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2);color:' + (l.type === 'out' ? '#ff5a5f' : '#2ecc71') + '">' + icon('transfer', 18) + '</div>' +
        '<div class="grow"><div class="li-title">' + (l.type === 'out' ? '转出给 ' + esc(l.to) : '收到来自 ' + esc(l.from || '玩家')) + '</div>' +
        '<div class="li-sub">' + timeAgo(l.ts) + ' · 手续费 ' + fmt(l.fee) + ' · ' + l.status + '</div></div>' +
        '<div class="b ' + (l.type === 'out' ? 'red' : 'green') + '">' + (l.type === 'out' ? '-' : '+') + fmt(l.n) + '</div></div>';
    }).join('') : '<div class="empty">暂无转账记录</div>') + '</div>'
  });
}

bindAct('transfer', function () { showTransfer(); });
bindAct('transfer-log', function () { showTransferLog(); });
/* ---------- 充值 / 提现 / 我的订单 ----------
   ★ 业务骨架齐全：下单、六态订单、限额校验、KYC 闸门、后台人工审批、审计留痕。
   ★ 资金通道留空：后端 payCreate() 恒返回 provider:'none' + address:null，
     所以这里不会出现任何收款地址，也没有写死的资金地址可复制。
     地址由持牌运营方的 PSP / 托管钱包下发之后，这一页才会把它显示出来。 */
/* 充值档位：以 USDT 计价（服务端内部 ×100 存成「分」）。 */
var RCPACKS = [
  { usdt: 10, tag: '' }, { usdt: 50, tag: '' }, { usdt: 100, tag: '热卖' },
  { usdt: 200, tag: '' }, { usdt: 500, tag: '' }, { usdt: 1000, tag: '' }
];
function rcChips(p) { return usdtToChips(p.usdt); }
/* ★ 100 U 快捷档：档位表里本来就有 100 USDT，但埋在第二排。
   这里在弹层顶部再给一个显眼的一键入口 —— 点一下 = 选中 100 档 + 直接生成订单。 */
var RC_FAST_USDT = 100;
var RC_FAST_INDEX = (function () {
  for (var i = 0; i < RCPACKS.length; i++) if (RCPACKS[i].usdt === RC_FAST_USDT) return i;
  return -1;
})();
var RC = { step: 1, pick: null, net: 'TRC20', order: null, pay: null, txid: '', q: null };
var WD = { usdt: 0, addr: '', net: 'TRC20' };

/* ★ 2026-10-08：网络代码 → 中文显示名（新增以太坊 ERC20 / Solana SOL） */
var NET_NAME = { TRC20: '波场 TRC20', ERC20: '以太坊 ERC20', BEP20: '币安 BEP20', SOL: 'Solana SOL' };
function netLabel(n) { return NET_NAME[String(n || '').toUpperCase()] || n; }

/* 兜底配置：服务端没下发 pay 段时用（★ 口径必须与 server.js PAY_DEFAULT 一致，
   历史上这里漏改过一次 feeRate，导致离线渲染出 5% 提现费） */
function payCfgNow() {
  return S.payCfg || (S.serverCfg && S.serverCfg.pay) ||
    /* ★ 2026-10-03：只保留 TRC20，与 server.js PAY_DEFAULT.nets 保持一致 */
    { provider: 'none', enabled: true, feeFlat: 2, feeRate: 0, nets: ['TRC20'], limits: {}, kycRequired: true };
}
function payLimits() { return payCfgNow().limits || {}; }
function orderPill(st) {
  var m = {
    pending: ['#ffd48a', 'rgba(245,195,82,.16)'], frozen: ['#ffd48a', 'rgba(245,195,82,.16)'],
    approved: ['#9ecbff', 'rgba(59,140,255,.16)'], completed: ['#7fe3a8', 'rgba(46,204,113,.15)'],
    rejected: ['#ffa4a7', 'rgba(255,90,95,.15)'], refunded: ['#ffa4a7', 'rgba(255,90,95,.15)']
  }[st] || ['#9fb0c3', 'rgba(255,255,255,.06)'];
  return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:' +
    m[0] + ';background:' + m[1] + '">' + (ORDER_STATUS[st] || st) + '</span>';
}
function quotaBar(label, used, cap) {
  if (!cap) return '';
  var pct = Math.min(100, (used || 0) / cap * 100);
  return '<div class="row mt8" style="gap:8px"><span class="tiny txt3" style="min-width:56px">' + label + '</span>' +
    '<span style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden">' +
    '<i style="display:block;height:100%;width:' + pct.toFixed(1) + '%;background:var(--gold)"></i></span>' +
    '<span class="tiny mono">' + fmt(Math.max(0, cap - (used || 0))) + ' / ' + fmt(cap) + '</span></div>';
}
function kycGateHTML() {
  return '<div class="card" style="border-color:rgba(245,195,82,.45);text-align:center;padding:26px 16px">' +
    '<div style="font-size:34px">&#128100;</div>' +
    '<div class="b mt8">需先完成实名认证</div>' +
    '<div class="tiny txt3 mt8">KYC 未通过前，充值 / 提现功能不可用。请联系客服完成实名核验，' +
    '或由运营方在后台「用户管理 &rsaquo; 编辑」中标记实名通过。</div></div>';
}
/* 前端也做一次限额校验给即时反馈；服务端会再校验一次，以服务端为准 */
function limCheckLocal(usdtAmt, type) {
  var L = payLimits(), q = RC.q || {};
  var used = (q.used && q.used[type]) || { day: 0, month: 0 };
  var min = +L.perTxMin || 0, max = +L.perTxMax || Infinity;
  if (usdtAmt < min) return '低于单笔最小限额 ' + min + ' USDT';
  if (usdtAmt > max) return '超过单笔限额 ' + fmt(max) + ' USDT';
  if (used.day + usdtAmt > (+L.day || Infinity)) return '超过单日限额 ' + fmt(L.day) + ' USDT（今日已用 ' + fmt(used.day) + '）';
  if (used.month + usdtAmt > (+L.month || Infinity)) return '超过单月限额 ' + fmt(L.month) + ' USDT';
  return '';
}

/* ★ 100 U 快捷档的卡片（一键：选中 100 档 + 直接生成订单） */
function rcFastCardHTML() {
  var p = RC_FAST_INDEX >= 0 ? RCPACKS[RC_FAST_INDEX] : { usdt: RC_FAST_USDT };
  var L = payLimits();
  var over = p.usdt > (+L.perTxMax || Infinity);
  return '<div class="card gold mt12" id="rc-fast" style="cursor:pointer;text-align:center;padding:16px 12px' +
    (over ? ';opacity:.45' : '') + '">' +
    '<div class="row gap8" style="justify-content:center;align-items:center">' +
    '<span class="gold">' + icon('coin', 18) + '</span>' +
    '<span class="b gold" style="font-size:17px">' + fmt(p.usdt) + ' U 快捷充值</span>' +
    '<span class="tiny" style="color:#ffd48a;background:rgba(245,195,82,.16);padding:2px 7px;border-radius:999px">一键</span></div>' +
    '<div class="b mt8" style="font-size:20px">' + fmt(p.usdt) + ' USDT</div>' +
    '<div class="tiny txt3 mt8">点一下直接生成订单 · ' + esc(RC.net) + ' &middot; 充值到账即为 USDT 余额' +
    (over ? ' · 超限' : '') + '</div></div>';
}
/* 一键：选中 100 档 → 校验限额 → 直接下单（等价于「点 100 档 + 点生成订单」） */
function rcFastGo(root) {
  if (RC_FAST_INDEX < 0) return;
  var msg = limCheckLocal(RCPACKS[RC_FAST_INDEX].usdt, 'recharge');
  if (msg) { toast(msg, 'err'); return; }
  RC.pick = RC_FAST_INDEX;
  var el = $('#rc-fast', root);
  if (el) el.style.pointerEvents = 'none';
  var keep = (el || {}).textContent;
  apiDeposit(rcChips(RCPACKS[RC_FAST_INDEX]), RC.net).then(function (r) {
    if (r.code !== 200) {
      if (el) { el.style.pointerEvents = ''; el.textContent = keep; }
      toast((r.j && r.j.msg) || '下单失败', 'err');
      return;
    }
    RC.order = r.j.order; RC.pay = r.j.pay; RC.step = 2; RC.txid = '';
    renderRechargeSheet();
  });
}
function showRecharge() {
  /* 每次打开都从「选档位」开始，避免上次的订单/凭证串到这次 */
  RC.step = 1; RC.order = null; RC.pay = null; RC.pick = null; RC.txid = '';
  apiWalletQuote().then(function (r) {
    if (r.code === 200 && r.j) RC.q = r.j;
    renderRechargeSheet();
  });
}
function renderRechargeSheet() {
  var cfg = payCfgNow(), q = RC.q || {}, L = cfg.limits || {};
  var kyc = q.kyc || { required: cfg.kycRequired !== false, verified: true };
  var prov = cfg.provider || 'none';
  var body = '';

  if (kyc.required && !kyc.verified) {
    body = kycGateHTML();
  } else if (cfg.enabled === false) {
    body = '<div class="empty">充值功能已关闭</div>';
  } else if (RC.step === 2 && RC.order) {
    body = rechargePayBody();
  } else if (RC.step === 4 && RC.order) {
    /* ★ 链上自动到账成功页（2026-10-02） */
    body = '<div class="card gold" style="text-align:center;padding:24px">' +
      '<div style="font-size:32px">&#127881;</div><div class="b mt8" style="font-size:17px">充值已到账</div>' +
      '<div class="b gold mt8" style="font-size:22px">+' + uStr(RC.order.usdt || 0) + ' USDT</div>' +
      '<div class="tiny txt3 mt8">订单 ' + esc(RC.order.id) + ' &nbsp;' + orderPill(RC.order.status) + '</div>' +
      (RC.order.txid ? '<div class="tiny txt3 mt8">TX ' + esc(String(RC.order.txid).slice(0, 24)) + '…</div>' : '') +
      '</div>' +
      '<button class="btn gold block lg mt12" id="rc-done">完成</button>' +
      '<button class="btn ghost block mt8" id="rc-orders">查看我的订单</button>';
  } else if (RC.step === 3 && RC.order) {
    body = '<div class="card gold" style="text-align:center;padding:24px">' +
      '<div style="font-size:32px">&#9989;</div><div class="b mt8">已提交，等待后台审核</div>' +
      '<div class="tiny txt3 mt8">订单 ' + esc(RC.order.id) + ' &nbsp;' + orderPill(RC.order.status) + '</div>' +
      '<div class="tiny txt3 mt8">审核通过后仍需「确认到账」才会增加 USDT 余额 —— 人工审核与链上到账是两件事。</div></div>' +
      '<button class="btn ghost block mt12" id="rc-orders">查看我的订单</button>';
  } else {
    /* ★ 2026-10-03 简化版（用户要求）：只留「输入金额 → 确认 → 直接出收款地址 + 二维码」，
       档位网格 / 100U 快捷卡 / 额度进度条全部删掉；快捷金额只剩一行小按钮。 */
    body = '<div class="row"><span class="tiny txt3 grow">当前余额</span><span class="b gold">' + uStr(balCent()) + ' USDT</span></div>' +
      '<div class="field mt12"><div class="lb">充值金额（USDT）</div>' +
      '<div class="input-wrap"><input id="rc-amt" type="number" inputmode="decimal" min="0" step="any" placeholder="请输入 USDT 金额"></div></div>' +
      '<div class="row gap8 mt8">' + [100, 500, 1000, 5000].map(function (v) {
        return '<span class="btn xs ghost" data-amt="' + v + '" style="flex:1;text-align:center">' + v + '</span>';
      }).join('') + '</div>' +
      '<div class="tiny txt3 mt8">单笔 ' + fmt(+L.perTxMin || 0) + (+L.perTxMax ? ' – ' + fmt(+L.perTxMax) : '') +
      '</div>' +
      '<div class="field mt12"><div class="lb">链上网络</div><select id="rc-net">' +
      /* ★ 2026-10-03：选项列表统一听服务端下发的 depositNets（= pay.nets）。 */
      (cfg.depositNets || cfg.nets || ['TRC20']).map(function (n) {
        return '<option value="' + n + '"' + (RC.net === n ? ' selected' : '') + '>' + esc(netLabel(n)) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="card mt12"' + (prov === 'none' ? ' style="border-color:rgba(245,195,82,.45)"' : '') + '">' +
      '<div class="row gap8"><span class="gold">' + icon('info', 18) + '</span><div class="grow">' +
      /* ★ 2026-10-03：provider 现由服务端按「地址簿有无启用地址」下发 ——
         usdt-chain = 链上自动收款已就绪；none = 地址簿为空，提示找运营方配置。 */
      (prov === 'usdt-chain'
        ? '<div class="b small">链上自动收款 ' + esc((cfg.depositNets || ['TRC20']).map(netLabel).join(' / ')) + '</div>' +
          '<div class="tiny txt3 mt8">确认后直接显示平台收款地址和二维码，链上到账自动入账（通常 1~3 分钟）。</div>'
        : '<div class="b small">收款地址待配置</div>' +
          '<div class="tiny txt3 mt8">平台收款地址尚未配置，暂时无法充值；配置完成后这里会显示「链上自动收款」。如有疑问请联系客服。</div>'
      ) + '</div></div></div>' +
      '<button class="btn gold block lg mt12" id="rc-go">确认充值</button>' +
      '<button class="btn ghost block mt8" id="rc-orders">我的订单</button>';
  }

  openSheet({
    title: '充值', body: body, key: 'recharge',
    onClose: function () { stopDepositWatch(); },   /* ★ 关掉弹层就停掉轮询，别让定时器一直跑 */
    onReady: function (root, close) {
      /* ★ 2026-10-03 简化版：快捷金额按钮直接填进输入框 */
      $$('[data-amt]', root).forEach(function (el) {
        el.onclick = function () {
          var inp = $('#rc-amt', root);
          if (inp) { inp.value = el.dataset.amt; inp.focus(); }
        };
      });
      var netEl = $('#rc-net', root);
      if (netEl) netEl.onchange = function () { RC.net = netEl.value; };
      var goBtn = $('#rc-go', root);
      if (goBtn) goBtn.onclick = function () {
        /* 输入的是 USDT 金额（元）；服务端内部 ×100 存成「分」并二次校验限额 */
        var amt = Math.round(+($('#rc-amt', root) || {}).value * 100) / 100;
        if (!(amt > 0)) { toast('请输入充值金额', 'err'); return; }
        var msg = limCheckLocal(amt, 'recharge');
        if (msg) { toast(msg, 'err'); return; }
        goBtn.disabled = true; goBtn.textContent = '正在生成…';
        apiDeposit(Math.round(amt * CHIP_PER_USDT), RC.net).then(function (r) {
          if (r.code !== 200) {
            goBtn.disabled = false; goBtn.textContent = '确认充值';
            toast((r.j && r.j.msg) || '下单失败', 'err'); return;
          }
          RC.order = r.j.order; RC.pay = r.j.pay; RC.step = 2; RC.txid = '';
          renderRechargeSheet();   /* → 直接显示收款地址 + 二维码 */
        });
      };
      /* ★ 链上收款：复制地址 / 到账自动检测 */
      var cp = $('#rc-copy', root);
      if (cp) cp.onclick = function () {
        copyText(RC.pay.address).then(function (okd) {
          toast(okd ? '地址已复制' : '复制失败，请长按手动复制', okd ? 'ok' : 'err');
        });
      };
      var doneBtn = $('#rc-done', root);
      if (doneBtn) doneBtn.onclick = function () { stopDepositWatch(); closeSheetNow(); };
      if (RC.step === 2 && RC.pay && RC.pay.address) startDepositWatch();

      var sub = $('#rc-submit', root);
      if (sub) sub.onclick = function () {
        var tx = (($('#rc-txid', root) || {}).value || '').trim();
        var done = function () {
          RC.step = 3; renderRechargeSheet();
          /* 已填 TXID 的话继续盯着，等到账会自动跳成功页 */
          toast(RC.pay && RC.pay.address ? '已记录，链上到账后会自动充入 USDT 余额' : '已提交，等待后台审核', 'ok');
          if (RC.pay && RC.pay.address) startDepositWatch();
        };
        if (tx.length < 6) { done(); return; }
        sub.disabled = true; sub.textContent = '提交中…';
        apiSetTxid(RC.order.id, tx).then(function (r) {
          if (r.code !== 200) { sub.disabled = false; sub.textContent = '提交审核'; toast((r.j && r.j.msg) || '提交失败', 'err'); return; }
          RC.order = r.j.order; done();
        });
      };
      var can = $('#rc-cancel', root);
      if (can) can.onclick = function () {
        apiCancelOrder(RC.order.id).then(function (r) {
          if (r.code !== 200) { toast((r.j && r.j.msg) || '取消失败', 'err'); return; }
          toast('订单已取消', 'ok');
          RC.step = 1; RC.order = null; RC.pay = null; RC.pick = null;
          apiWalletQuote().then(function (q) { if (q.code === 200) RC.q = q.j; renderRechargeSheet(); });
        });
      };
      var ob = $('#rc-orders', root);
      if (ob) ob.onclick = function () { showWalletOrders(); };
    }
  });
}
function rechargePayBody() {
  var o = RC.order, pay = RC.pay || {};
  var h = '<div class="card gold"><div class="tiny txt3">订单 ' + esc(o.id) + '</div>' +
    '<div class="b" style="font-size:17px">' + fmt(o.usdt) + ' USDT</div>' +
    '<div class="mt8">' + orderPill(o.status) + ' <span class="tiny txt3">' + esc(o.net) + '</span></div></div>';
  if (!pay.address) {
    h += '<div class="card mt12" style="border-color:rgba(245,195,82,.45)"><div class="row gap8">' +
      '<span class="gold">' + icon('lock', 18) + '</span><div class="grow">' +
      '<div class="b small">收款地址待运营方配置</div>' +
      '<div class="tiny txt3 mt8">' + esc(pay.note || '支付通道未接入。') + '</div>' +
      '<div class="tiny txt3 mt8">订单已生成并进入「待审核」。运营方在后台「USDT 收款」页添加收款地址后，本页会自动显示地址。</div>' +
      '</div></div></div>';
  } else {
    /* ★ 2026-10-02：链上收款 —— 真实 USDT 地址 + 金额 + 二维码 + 倒计时 + 自动轮询到账 */
    var left = Math.max(0, (+(pay.expireAt) || 0) - Date.now());
    h += '<div class="card gold mt12" style="text-align:center">' +
      '<div class="tiny txt3">请向下方地址转入</div>' +
      '<div class="b gold" style="font-size:26px">' + fmt(o.usdt) + ' USDT</div>' +
      '<div class="tiny txt3 mt8">' + esc(o.net) + ' &middot; <b>金额必须完全一致</b>，少转会导致无法自动到账</div>' +
      '<div class="tiny txt3 mt8">订单有效期 <b id="rc-left">' + fmtLeft(left) + '</b>，超时未到账请联系客服补单</div>' +
      '</div>' +
      '<div class="card mt12"><div class="tiny txt3">收款地址（' + esc(o.net) + (pay.label ? ' · ' + esc(pay.label) : '') + '）</div>' +
      '<div class="mono small mt8" id="rc-addr" style="word-break:break-all;line-height:1.6">' + esc(pay.address) + '</div>' +
      '<div class="row mt8 gap8"><button class="btn gold sm" id="rc-copy">复制地址</button>' +
      (pay.memo ? '<span class="tiny txt3">Memo/Tag：<b class="mono">' + esc(pay.memo) + '</b>（必填）</span>' : '') + '</div>' +
      /* 二维码：地址是公开信息，用公共二维码服务渲染；不想走第三方就删掉这个 img 节点即可 */
      '<div style="text-align:center;margin-top:12px"><img id="rc-qr" alt="收款地址二维码" width="148" height="148" ' +
      'style="border-radius:12px;background:#fff;padding:6px" src="https://api.qrserver.com/v1/create-qr-code/?size=148x148&data=' +
      encodeURIComponent(pay.address) + '"></div>' +
      '<div class="tiny txt3 mt8">' + esc(pay.note || '达到确认数后系统自动到账，无需联系客服。') + '</div>' +
      '<div class="row mt8"><span class="b small" id="rc-wait">等待链上到账…</span></div>' +
      '</div>';
  }
  h += '<div class="field mt12"><div class="lb">交易哈希 TXID（可选，方便对账）</div>' +
    '<div class="input-wrap"><input id="rc-txid" placeholder="转账后填写" value="' + esc(RC.txid) + '"></div></div>' +
    '<button class="btn gold block lg mt12" id="rc-submit">我已转账</button>' +
    '<button class="btn ghost block mt8" id="rc-cancel">取消该订单</button>';
  return h;
}
/* 倒计时文案 */
function fmtLeft(ms) {
  var s = Math.max(0, Math.round(ms / 1000));
  var m = Math.floor(s / 60);
  return m + ' 分 ' + (s % 60) + ' 秒';
}
/* ★ 链上到账自动检测：轮询「我的订单」，状态变成 completed 就刷新余额并提示。
   页面关掉就停（openSheet 的 onClose 里清掉定时器），不会一直跑在后台。 */
var RC_TIMER = null, RC_TICK = null;
function startDepositWatch() {
  stopDepositWatch();
  if (!RC.order || !(RC.pay && RC.pay.address)) return;
  RC_TICK = setInterval(function () {
    var el = $('#rc-left');
    if (el && RC.pay && RC.pay.expireAt) el.textContent = fmtLeft(RC.pay.expireAt - Date.now());
  }, 1000);
  RC_TIMER = setInterval(function () {
    if (!RC.order) return stopDepositWatch();
    apiMyOrders().then(function (r) {
      if (r.code !== 200 || !r.j || !r.j.list) return;
      var o = null;
      r.j.list.forEach(function (x) { if (x.id === RC.order.id) o = x; });
      if (!o) return;
      if (o.status === 'completed' || o.status === 'approved') {
        stopDepositWatch();
        RC.order = o;
        apiMe().then(function () {
          RC.step = 4; renderRechargeSheet();
          toast('充值已到账：+' + uStr(o.usdt) + ' USDT', 'ok', 3200);
        });
      }
      var w = $('#rc-wait');
      if (w) w.textContent = '等待链上到账…（' + (o.statusText || o.status) + '）';
    });
  }, 8000);
}
function stopDepositWatch() {
  if (RC_TIMER) { clearInterval(RC_TIMER); RC_TIMER = null; }
  if (RC_TICK) { clearInterval(RC_TICK); RC_TICK = null; }
}
/* 关掉当前充值弹层（成功页「完成」按钮用） */
function closeSheetNow() {
  var el = $('#sheet-root').querySelector('[data-sheet-key="recharge"]');
  if (el) el.remove();
}

/* ---------- 我的订单（六态） ---------- */
function showWalletOrders() {
  apiMyOrders().then(function (r) {
    var list = (r.code === 200 && r.j && r.j.list) || [];
    var body = list.length ? '<div class="list">' + list.map(function (o) {
      var up = o.type === 'recharge';
      return '<div class="li"><div class="center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2);color:' +
        (up ? '#2ecc71' : '#ff5a5f') + '">' + (up ? '&#8595;' : '&#8593;') + '</div>' +
        '<div class="grow"><div class="li-title">' + (up ? '充值' : '提现') + ' &middot; ' + esc(o.id) + '</div>' +
        '<div class="li-sub">' + esc(o.net || '') + ' &middot; ' + timeAgo(o.createdAt) + (o.txid ? (' &middot; ' + esc(String(o.txid).slice(0, 12)) + '…') : '') + '</div>' +
        /* 提现单要能看出「申请多少 / 扣多少手续费 / 实际到账多少」 */
        (!up && +o.fee ? '<div class="li-sub">手续费 ' + fmt(o.fee) + ' USDT &middot; 实际到账 ' + fmt(o.amount) + ' USDT</div>' : '') +
        '</div>' +
        '<div style="text-align:right"><div class="b ' + (up ? 'green' : 'red') + '">' + (up ? '+' : '-') + fmt(o.usdt) + ' USDT</div>' +
        '<div class="mt8">' + orderPill(o.status) + '</div></div></div>';
    }).join('') + '</div>' : '<div class="empty">还没有订单</div>';
    if (r.code !== 200) body = '<div class="empty">' + esc((r.j && r.j.msg) || '请先登录') + '</div>';
    openSheet({ title: '我的订单', body: body });
  });
}
function showWithdraw() {
  /* 默认填「全部 USDT 余额」（提现不限额度，有多少提多少） */
  WD.usdt = usdtBal();
  apiWalletQuote().then(function (r) {
    if (r.code === 200 && r.j) RC.q = r.j;
    renderWithdrawSheet();
  });
}
/* 当前 USDT 余额（提现的唯一来源） */
/* ★ 2026-10-06：bal 就是 USDT，不做任何换算（1 USDT = 1 USDT），只做两位小数归一。 */
function usdtBal() { return Math.round(Math.max(0, +((S.user && S.user.bal) || 0)) * 100) / 100; }
function balCent() { return Math.max(0, Math.round(+((S.user && S.user.bal) || 0))); }
function renderWithdrawSheet() {
  var cfg = payCfgNow(), q = RC.q || {};
  var kyc = q.kyc || { required: cfg.kycRequired !== false, verified: true };
  var feeFlat = Math.round((+cfg.feeFlat || 0) * 100) / 100;   /* ★ 单笔固定手续费 2 USDT */
  var bal = usdtBal();
  var w = Math.round((+WD.usdt || 0) * 100) / 100;
  var net = Math.round((w - feeFlat) * 100) / 100;
  var body;
  if (kyc.required && !kyc.verified) {
    body = kycGateHTML();
  } else if (cfg.enabled === false) {
    body = '<div class="empty">提现功能已关闭</div>';
  } else {
    /* ★ 提现不限额度：这里刻意不显示任何额度条，也不做单笔/单日/单月校验 */
    body = '<div class="card"><div class="tiny txt3">可提现 USDT 余额</div>' +
      '<div class="b gold" style="font-size:24px">' + fmt(bal) + ' USDT</div>' +
      '<div class="tiny txt3 mt8">账户余额即 USDT，充值到账与牌桌盈利都可提现</div>' +
      (bal > 0 ? '' : '<button class="btn ghost block mt12" id="wd-ex">去充值 &rarr;</button>') +
      '</div>' +
      '<div class="field mt12"><div class="lb">提现金额（USDT）</div><div class="input-wrap">' +
      '<input id="wd-u-in" type="number" value="' + w + '"></div>' +
      '<div class="tiny txt3">提现不限额度 &middot; 单笔手续费固定 ' + fmt(feeFlat) + ' USDT</div></div>' +
      '<div class="hscroll">' + [0.25, 0.5, 1].map(function (p) {
        return '<div class="tag" data-wdp="' + Math.round(bal * p * 100) / 100 + '" style="padding:6px 12px">' + (p * 100) + '%</div>';
      }).join('') + '</div>' +
      '<div class="field mt12"><div class="lb">收款地址（' + esc(WD.net) + '）</div><div class="input-wrap">' +
      '<input id="wd-a" placeholder="粘贴你的收款地址" value="' + esc(WD.addr) + '"></div></div>' +
      '<div class="field"><div class="lb">链上网络</div><select id="wd-net">' +
      (cfg.nets || ['TRC20']).map(function (n) {
        return '<option value="' + n + '"' + (WD.net === n ? ' selected' : '') + '>' + esc(netLabel(n)) + '</option>';
      }).join('') + '</select></div>' +
      /* ★ 2026-10-05 审计修复：设置过支付密码的账号，提现需输入支付密码（服务端同口径强校验） */
      ((S.user && S.user.hasPaypwd) ? '<div class="field mt12"><div class="lb">支付密码</div><div class="input-wrap">' +
      '<input id="wd-pwd" type="password" inputmode="numeric" maxlength="6" placeholder="输入 6 位支付密码"></div></div>' : '') +
      '<div class="card mt12">' +
      '<div class="row"><span class="tiny txt2 grow">提现金额</span><span class="b mono" id="wd-u">' + fmt(w) + ' USDT</span></div>' +
      '<div class="row mt8"><span class="tiny txt2 grow">单笔手续费（固定）</span><span class="tiny mono" id="wd-f">' + fmt(feeFlat) + ' USDT</span></div>' +
      '<div class="row mt8"><span class="tiny txt2 grow">实际到账</span><span class="b gold mono" id="wd-n">' + fmt(Math.max(0, net)) + ' USDT</span></div>' +
      '</div>' +
      '<div class="card mt12"><div class="row gap8">' + icon('info', 18) + '<div class="grow">' +
      '<div class="b small">链上自动出款</div><div class="tiny txt3 mt8">提交后提现金额立即从 USDT 余额冻结；风控审核通过后系统自动发起 ' + esc(WD.net) + ' 链上出款，' +
      '到账后可在「我的订单」查看交易哈希。可疑单会被冻结待人工复核，驳回则把 USDT 退回余额。</div></div></div></div>' +
      '<button class="btn gold block lg mt12" id="wd-go">提交提现申请</button>' +
      '<button class="btn ghost block mt8" id="wd-orders">我的订单</button>';
  }
  openSheet({
    title: '提现', body: body, key: 'withdraw',
    onReady: function (root, close) {
      function sync() {
        var v = Math.round(+(($('#wd-u-in', root) || {}).value) || 0) / 100 * 100;
        v = Math.round(v * 100) / 100;
        WD.usdt = v;
        var u = $('#wd-u', root), n = $('#wd-n', root);
        if (u) u.textContent = fmt(v) + ' USDT';
        if (n) n.textContent = fmt(Math.max(0, Math.round((v - feeFlat) * 100) / 100)) + ' USDT';
      }
      var ci = $('#wd-u-in', root);
      if (ci) ci.oninput = sync;
      $$('[data-wdp]', root).forEach(function (b) {
        b.onclick = function () { WD.usdt = +b.dataset.wdp; if (ci) ci.value = WD.usdt; sync(); };
      });
      var ex = $('#wd-ex', root);
      if (ex) ex.onclick = function () { close(); showRecharge(); };
      var ai = $('#wd-a', root); if (ai) ai.oninput = function () { WD.addr = ai.value; };
      var ni = $('#wd-net', root); if (ni) ni.onchange = function () { WD.net = ni.value; };
      var go = $('#wd-go', root);
      if (go) go.onclick = function () {
        var v = Math.round(+(($('#wd-u-in', root) || {}).value) * 100) / 100;
        var a = ((($('#wd-a', root) || {}).value) || '').trim();
        if (!(v > 0)) { toast('请填写提现金额', 'err'); return; }
        if (v > usdtBal()) { toast('超出可提现 USDT 余额', 'err'); return; }
        if (v <= feeFlat) { toast('提现金额需大于手续费 ' + feeFlat + ' USDT', 'err'); return; }
        if (a.length < 10) { toast('请填写收款地址', 'err'); return; }
        var wpEl = $('#wd-pwd', root); var wpPwd = wpEl ? wpEl.value.trim() : '';
        if (S.user && S.user.hasPaypwd && !/^\d{6}$/.test(wpPwd)) { toast('请输入 6 位支付密码', 'err'); return; }
        go.disabled = true; go.textContent = '提交中…';
        apiWithdraw(v, a, WD.net, wpPwd).then(function (r) {
          if (r.code !== 200) { go.disabled = false; go.textContent = '提交提现申请'; toast((r.j && r.j.msg) || '提交失败', 'err'); return; }
          if (r.j && r.j.user) applyServerUser(r.j.user);
          close();
          WD.addr = '';
          toast('提现申请已提交，审核通过后自动链上出款', 'ok', 2600);
          refreshCurrent();
        });
      };
      var ob = $('#wd-orders', root);
      if (ob) ob.onclick = function () { showWalletOrders(); };
    }
  });
}

bindAct('recharge', function () { showRecharge(); });
bindAct('withdraw', function () { showWithdraw(); });
/* ★ 2026-10-05 全站 USDT 化：账户余额即 USDT，「兑换 / U兑筹码」两个入口已整体下线 */

bindAct('my-orders', function () { showWalletOrders(); });
/* ★ 2026-10-02：以前这里是纯 toast 假签到（点完余额没变化）。改为打服务端真签到。 */
bindAct('act-signin', function () {
  apiSignin().then(function (r) {
    if (r.code !== 200 || !r.j.ok) {
      toast((r.j && r.j.msg) || '签到失败', 'err', 2600);
      return;
    }
    if (r.j.user) applyServerUser(r.j.user);
    toast('签到成功，第 ' + r.j.day + ' 天 +' + uStr(r.j.reward) + ' USDT', 'ok', 2600);
  });
});





