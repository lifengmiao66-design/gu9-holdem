/* ===== social.js · 聊天 / 好友 / 私聊 / 赠送 ===== */
function pushChat(ch, user, text) {
  if (ch === 'p2p') {
    var uid = user.id; S.chats.p2p[uid] = S.chats.p2p[uid] || [];
    S.chats.p2p[uid].push({ id: Date.now(), uid: uid, name: user.name, color: user.color, text: text, ts: Date.now(), me: 1 });
    return;
  }
  var arr = S.chats[ch] || (S.chats[ch] = []);
  arr.push({ id: Date.now(), uid: user.id, name: user.name, color: user.color, text: text, ts: Date.now() });
  if (ch === 'table' && Route.cur === 'table') {
    var dot = $('#tb-chat-dot'); if (dot) dot.style.display = 'block';
  }
}

/* ---------- 聊天面板 ---------- */
var ChatTab = 'table';
function openChatPanel() {
  function msgsHTML(ch) {
    var arr = ch === 'p2p' ? p2pList() : (S.chats[ch] || []);
    if (!arr.length) return '<div class="empty">' + icon('chat', 34) + '<div>暂无消息</div></div>';
    return arr.map(function (m) {
      var isMe = m.me || (S.user && m.uid === S.user.id);
      return '<div class="chat-msg' + (isMe ? ' me' : '') + (m.sys ? ' sys' : '') + '">' +
        avatarHTML({ name: m.name, color: m.color }, 'sm') +
        '<div class="col"><div class="nm">' + esc(m.name) + ' · ' + timeAgo(m.ts) + '</div>' +
        '<div class="bubble">' + esc(m.text) + '</div></div></div>';
    }).join('');
  }
  function p2pList() {
    var out = [];
    Object.keys(S.chats.p2p).forEach(function (uid) {
      var arr = S.chats.p2p[uid]; if (!arr.length) return;
      var last = arr[arr.length - 1];
      out.push({ uid: uid, name: last.name, text: last.text, ts: last.ts });
    });
    out.sort(function (a, b) { return b.ts - a.ts; });
    return out;
  }
  function renderBody(root) {
    var body = $('#chat-body', root);
    if (ChatTab === 'p2p') {
      var l = p2pList();
      body.innerHTML = l.length ? l.map(function (x) {
        var f = S.friends.filter(function (f) { return f.id === x.uid; })[0] || { name: x.name, color: '#3b8cff', status: 'online' };
        return '<div class="li" data-p2p="' + x.uid + '">' + avatarHTML(f, 'md', { status: 1 }) +
          '<div class="grow" style="min-width:0"><div class="li-title">' + esc(x.name) + '</div>' +
          '<div class="li-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.text) + '</div></div>' +
          '<div class="tiny txt3">' + timeAgo(x.ts) + '</div></div>';
      }).join('') : '<div class="empty">' + icon('users', 34) + '<div>暂无私聊，去好友列表找人聊聊</div></div>';
    } else {
      body.innerHTML = '<div class="chat-msgs" id="chat-msgs">' + msgsHTML(ChatTab) + '</div>';
      setTimeout(function () { var c = $('#chat-msgs', root); if (c) c.scrollTop = c.scrollHeight; }, 30);
    }
  }
  openSheet({
    title: '聊天',
    body: '<div class="chat-tabs">' +
      '<div class="t' + (ChatTab === 'table' ? ' on' : '') + '" data-ct="table">牌桌</div>' +
      '<div class="t' + (ChatTab === 'world' ? ' on' : '') + '" data-ct="world">世界</div>' +
      '<div class="t' + (ChatTab === 'p2p' ? ' on' : '') + '" data-ct="p2p">私聊</div>' +
      '</div>' +
      '<div id="chat-body" style="height:340px;overflow-y:auto;margin-top:10px"></div>' +
      (ChatTab === 'p2p' ? '' : '<div class="chat-input">' +
        '<div class="icon-btn" data-chat-emo>' + icon('smile', 18) + '</div>' +
        '<div class="input-wrap"><input id="chat-in" placeholder="说点什么…"></div>' +
        '<div class="btn gold sm" id="chat-send">' + icon('send', 15) + '</div></div>'),
    onReady: function (root, close) {
      renderBody(root);
      bindClick(root, function (e) {
        var t = e.target.closest('[data-ct]');
        if (t) { ChatTab = t.dataset.ct; $$('[data-ct]', root).forEach(function (x) { x.classList.remove('on'); }); t.classList.add('on'); refreshSheet(root, close); return; }
        var p = e.target.closest('[data-p2p]');
        if (p) {
          var uid = p.dataset.p2p;
          var f = S.friends.filter(function (x) { return x.id === uid; })[0] || { id: uid, name: (S.chats.p2p[uid][0] || {}).name || '好友', color: '#3b8cff' };
          close(); openPrivateChat(f); return;
        }
        if (e.target.closest('[data-chat-emo]')) {
          var emos = ['👍', '😂', '😎', '🔥', '💰', '👏', '😱', '🤝'];
          openSheet({
            title: '表情', body: '<div class="emo-grid">' + emos.map(function (x) { return '<div class="e" data-em="' + x + '">' + x + '</div>'; }).join('') + '</div>',
            onReady: function (r2, c2) {
              bindClick(r2, function (e2) {
                var b = e2.target.closest('[data-em]'); if (!b) return;
                var inp = $('#chat-in', root); if (inp) inp.value += b.dataset.em; c2();
              });
            }
          });
        }
      });
      var btn = $('#chat-send', root), inp = $('#chat-in', root);
      function send() {
        var v = inp.value.trim(); if (!v) return;
        pushChat(ChatTab, S.user, v); inp.value = ''; renderBody(root);
        if (ChatTab === 'table') { var d = $('#tb-chat-dot'); if (d) d.style.display = 'none'; }
      }
      if (btn) btn.onclick = send;
      if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter') send(); };
    }
  });
  function refreshSheet(root, close) { close(); openChatPanel(); }
}

/* ---------- 私聊 ---------- */
function openPrivateChat(user) {
  var uid = user.id;
  /* ★ 2026-10-03：不再塞「在吗？一起打两把」的假消息，也不再 setTimeout 编自动回复。
     消息走服务端：我发的本地立刻上屏 + POST /friends/msg 落到对方收件箱；
     对方在线时由好友轮询（45s/次 + 切前台立即拉）拉到并弹 toast 提示。 */
  S.chats.p2p[uid] = S.chats.p2p[uid] || [];
  function render(root) {
    var arr = S.chats.p2p[uid];
    var box = $('#p2p-msgs', root);
    box.innerHTML = arr.map(function (m) {
      var isMe = m.me || m.uid === S.user.id;
      return '<div class="chat-msg' + (isMe ? ' me' : '') + '">' +
        avatarHTML({ name: m.name, color: m.color }, 'sm') +
        '<div class="col"><div class="nm">' + esc(isMe ? '我' : m.name) + ' · ' + timeAgo(m.ts) + '</div>' +
        '<div class="bubble">' + esc(m.text) + '</div></div></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }
  openSheet({
    title: esc(user.name) + ' · 私聊',
    body: '<div class="chat-msgs" id="p2p-msgs" style="height:320px"></div>' +
      '<div class="quick-grid mt8">' + ['一起打牌吗？', '在哪个房间？', '借我点余额', '打得不错'].map(function (q) {
        return '<div class="q" data-q="' + q + '">' + q + '</div>';
      }).join('') + '</div>' +
      '<div class="chat-input">' +
      '<div class="icon-btn" data-gift>' + icon('gift', 18) + '</div>' +
      '<div class="input-wrap"><input id="p2p-in" placeholder="输入消息…"></div>' +
      '<div class="btn gold sm" id="p2p-send">' + icon('send', 15) + '</div></div>',
    onReady: function (root, close) {
      render(root);
      /* 打开会话即把「已读水位」推到最新 —— 轮询就不会再对老消息弹提示 */
      (function () {
        var arr = S.chats.p2p[uid] || [], mx = 0;
        arr.forEach(function (m) { if (!m.me && m.ts > mx) mx = m.ts; });
        if (mx) p2pMarkSeen(uid, mx);
      })();
      function send(txt) {
        txt = (txt == null ? $('#p2p-in', root).value.trim() : txt);
        if (!txt) return;
        if (txt.length > 500) { toast('消息太长（最多 500 字）', 'err'); return; }
        pushChat('p2p', Object.assign({}, user, { id: uid }), txt);
        $('#p2p-in', root).value = ''; render(root);
        p2pMarkSeen(uid, Date.now());
        apiFriendMsg(uid, txt).then(function (r) {
          if (r.code !== 200) toast((r.j && r.j.msg) || '发送失败，对方可能收不到', 'err', 2800);
        });
      }
      $('#p2p-send', root).onclick = function () { send(); };
      $('#p2p-in', root).onkeydown = function (e) { if (e.key === 'Enter') send(); };
      bindClick(root, function (e) {
        var q = e.target.closest('[data-q]'); if (q) send(q.dataset.q);
        if (e.target.closest('[data-gift]')) { close(); showGift(user); }
      });
    }
  });
}

/* ---------- 赠送金币 ---------- */
function showGift(user) {
  var amounts = [10000, 50000, 100000, 500000];
  var cur = 50000;
  openSheet({
    title: '赠送金币给 ' + esc(user.name),
    body: '<div class="row center mb12">' + avatarHTML(user, 'lg') + '</div>' +
      '<div class="tiny txt3 center">我的余额：' + uStr(balCent()) + ' USDT</div>' +
      '<div class="grid g2 gap8 mt12">' + amounts.map(function (a) {
        return '<div class="btn ghost' + (a === cur ? ' gold' : '') + '" data-amt="' + a + '">' + short(a) + '</div>';
      }).join('') + '</div>' +
      '<div class="field mt12"><div class="lb">自定义金额</div><div class="input-wrap"><input id="gf-amt" type="number" value="' + cur + '"></div></div>' +
      '<div class="field"><div class="lb">留言（选填）</div><div class="input-wrap"><input id="gf-msg" placeholder="写点什么…"></div></div>' +
      '<div class="tiny txt3">每日赠送上限 200 万，赠送需手续费 2%</div>' +
      '<button class="btn gold block lg mt12" id="gf-ok">确认赠送</button>',
    onReady: function (root, close) {
      $$('[data-amt]', root).forEach(function (b) {
        b.onclick = function () {
          cur = +b.dataset.amt; $('#gf-amt', root).value = cur;
          $$('[data-amt]', root).forEach(function (x) { x.classList.remove('gold'); }); b.classList.add('gold');
        };
      });
      $('#gf-ok', root).onclick = function () {
        var n = Math.round(+$('#gf-amt', root).value || 0);
        if (n < 1000) { toast('最少赠送 1000', 'err'); return; }
        if (n > S.user.chips) { toast('余额不足', 'err'); return; }
        var fee = Math.round(n * 0.02);
        S.user.chips -= (n + fee);
        S.transferLogs.unshift({ id: Date.now(), to: user.name, uid: user.id, n: n, fee: fee, ts: Date.now(), type: 'out', status: '完成' });
        saveState(); close();
        flyText('-' + short(n + fee), window.innerWidth / 2 - 40, 160);
        toast('已赠送 ' + fmt(n) + ' 给 ' + user.name + '（手续费 ' + fmt(fee) + '）', 'ok', 2600);
        if (Route.cur === 'friends') go('friends', {}, { noHist: true });
      };
    }
  });
}

/* ---------- 好友页 ---------- */
var FriendTab = 'friends';
Screens.friends = function (p) {
  FriendTab = (p && p.tab) ? p.tab : 'friends';
  return '<div class="app-shell">' +
    '<div class="topbar">' +
    '<div class="icon-btn" data-act="back">' + icon('back', 18) + '</div>' +
    '<div class="title grow">好友</div>' +
    '<div class="icon-btn" data-act="add-friend">' + icon('plus', 18) + '</div>' +
    '<div class="icon-btn" data-act="mycard">' + icon('invite', 18) + '</div>' +
    '</div>' +
    '<div class="body nopad">' +
    '<div style="padding:10px 12px"><div class="input-wrap">' + icon('search', 16) +
    '<input id="fr-kw" placeholder="在好友里搜索（昵称 / ID）"></div></div>' +
    /* ★ 房间邀请收件箱入口（2026-10-02）：好友建私有房邀请你，必须在这里同意才会入座 */
    '<div id="fr-invites" style="padding:0 12px 8px"></div>' +
    '<div class="tabs">' +
    '<div class="tab' + (FriendTab === 'friends' ? ' on' : '') + '" data-ft="friends">好友 ' + S.friends.length + '</div>' +
    '<div class="tab' + (FriendTab === 'requests' ? ' on' : '') + '" data-ft="requests">申请' + (S.requests.length ? ' <span class="tag red">' + S.requests.length + '</span>' : '') + '</div>' +
    '<div class="tab' + (FriendTab === 'sent' ? ' on' : '') + '" data-ft="sent">已发送</div>' +
    '<div class="tab' + (FriendTab === 'block' ? ' on' : '') + '" data-ft="block">黑名单</div>' +
    '</div>' +
    '<div id="fr-list" style="padding:8px 12px"></div>' +
    '</div>' + navHTML('friends') + '</div>';
};
/* 空状态：把「为什么是空的、下一步该干嘛」说清楚，别只丢一句「暂无数据」 */
function frEmpty(ic, title, sub) {
  return '<div class="empty">' + icon(ic, 40) + '<div>' + esc(title) + '</div>' +
    (sub ? '<div class="tiny txt3 mt8" style="max-width:250px;margin-left:auto;margin-right:auto">' + esc(sub) + '</div>' : '') + '</div>';
}
Screens.friends.after = function (p, root) {
  function item(u, opt) {
    opt = opt || {};
    var stTxt = u.status === 'playing' ? '游戏中 · ' + (u.table || '牌桌')
      : u.status === 'online' ? '在线'
        : (u.last ? '离线 · ' + timeAgo(u.last) : '离线');
    return '<div class="li" data-fid="' + u.id + '">' + avatarHTML(u, 'md', { status: 1 }) +
      '<div class="grow" style="min-width:0"><div class="row gap6"><span class="li-title">' + esc(u.name) + '</span>' +
      (u.vip >= 5 ? '<span class="tag gold">VIP' + u.vip + '</span>' : '') + '</div>' +
      '<div class="li-sub">' + stTxt + ' · Lv.' + u.level + ' · 手牌 ' + fmtInt(u.hands || 0) +
      (opt.note ? ' · “' + esc(opt.note) + '”' : '') + '</div></div>' +
      (opt.btns || '') + '</div>';
  }
  function render() {
    /* ★★ 这个 render 会被**异步回调**调到：reload() → loadFriends(cb) → render()。
       玩家点进好友页后立刻切走，`#screen-root` 已经被下一个屏幕的 HTML 覆盖，
       再无条件读 $('#fr-kw', root).value 就会抛
       `TypeError: Cannot read properties of null (reading 'value')`（live-check 真抓到过）。
       屏幕不在了就静默丢弃这次渲染。 */
    var kwEl = $('#fr-kw', root), box = $('#fr-list', root);
    if (!kwEl || !box) return;
    var kw = (kwEl.value || '').trim().toLowerCase();
    var match = function (f) { return !kw || String(f.name).toLowerCase().indexOf(kw) >= 0 || String(f.id).indexOf(kw) >= 0; };
    var html = '';
    if (FriendTab === 'friends') {
      var list = S.friends.filter(match);
      list.sort(function (a, b) { var o = { playing: 0, online: 1, offline: 2 }; return (o[a.status] || 2) - (o[b.status] || 2); });
      html = list.length
        ? '<div class="list">' + list.map(function (f) {
          return item(f, { btns: '<div class="row gap6"><div class="btn xs ghost" data-chat="' + f.id + '">私聊</div><div class="btn xs ghost" data-more="' + f.id + '">详情</div></div>' });
        }).join('') + '</div>'
        /* ★ 空状态要顺手把「申请 tab 里躺着 N 条」说破 —— 很多用户不是在等加载，
           是压根没注意到上面还有个「申请」tab（之前只喊一句「还没有好友」会被读成坏了）。 */
        : frEmpty('users', '还没有好友',
          (S.requests && S.requests.length
            ? '你有 ' + S.requests.length + ' 条好友申请还没处理，点上面的「申请」tab 通过一下 → '
            : '') + '点右上角「+」输入对方的 ID 或昵称，对方同意后两边好友列表都会出现');
    } else if (FriendTab === 'requests') {
      var reqs = S.requests.filter(match);
      html = reqs.length
        ? '<div class="list">' + reqs.map(function (f) {
          return item(f, { note: f.note, btns: '<div class="row gap6"><div class="btn xs green" data-acc="' + f.id + '">接受</div><div class="btn xs ghost" data-rej="' + f.id + '">拒绝</div></div>' });
        }).join('') + '</div>'
        : frEmpty('mail', '暂无好友申请', '别人申请加你的时候会出现在这里');
    } else if (FriendTab === 'sent') {
      var sents = S.outgoing.filter(match);
      html = sents.length
        ? '<div class="list">' + sents.map(function (f) {
          return item(f, { note: '等待对方同意', btns: '<div class="btn xs ghost" data-cancel="' + f.id + '">撤回</div>' });
        }).join('') + '</div>'
        : frEmpty('clock', '没有等待回复的申请', '你发出的好友申请会显示在这里；对方点「同意」之后，双方好友列表才同时出现');
    } else {
      html = S.blocked.length
        ? '<div class="list">' + S.blocked.map(function (f) {
          return item(f, { btns: '<div class="btn xs ghost" data-unblock="' + f.id + '">解除</div>' });
        }).join('') + '</div>'
        : frEmpty('ban', '黑名单为空', '拉黑后对方不能再向你发起好友申请');
    }
    box.innerHTML = html;
  }
  /* 增删一律「先调接口 → 成功后整体刷新」，不在本地自己改数组（否则会和服务器各说各话） */
  function reload(msg) {
    if (!apiTokenGet()) { render(); return; }
    if (msg) toast(msg, 'ok');
    loadFriends(function (okv) {
      render();
      if (!okv && S.logged) toast('好友列表拉取失败，请稍后重试', 'err');
    });
  }
  function act(promise, okMsg) {
    promise.then(function (r) {
      if (r.code === 200 && r.j && r.j.ok) reload(r.j.msg || okMsg);
      else toast((r.j && r.j.msg) || '操作失败，请重试', 'err');
    });
  }
  render();
  reload();
  $('#fr-kw', root).oninput = render;
  bindClick(root, function (e) {
    var t = e.target.closest('[data-ft]');
    if (t) { FriendTab = t.dataset.ft; $$('[data-ft]', root).forEach(function (x) { x.classList.remove('on'); }); t.classList.add('on'); render(); return; }

    var c = e.target.closest('[data-chat]');
    if (c) { var u1 = findFriend(c.dataset.chat); if (u1) openPrivateChat(u1); return; }
    var mr = e.target.closest('[data-more]');
    if (mr) { var u2 = findFriend(mr.dataset.more); if (u2) showFriendCard(u2); return; }

    var ac = e.target.closest('[data-acc]');
    if (ac) { act(apiFriendAccept(ac.dataset.acc), '已添加为好友'); return; }
    var rj = e.target.closest('[data-rej]');
    if (rj) { act(apiFriendReject(rj.dataset.rej), '已拒绝'); return; }
    var cn = e.target.closest('[data-cancel]');
    if (cn) { act(apiFriendDel(cn.dataset.cancel), '已撤回申请'); return; }
    var ub = e.target.closest('[data-unblock]');
    if (ub) { act(apiFriendBlock(ub.dataset.unblock, false), '已解除拉黑'); return; }

    var fid = e.target.closest('[data-fid]');
    if (fid) { var u3 = findFriend(fid.dataset.fid); if (u3) showFriendCard(u3); }
  });
  render();
  loadRoomInvites(root);      /* 房间邀请（异步，回来时屏幕可能已切走 → 内部会再校验一次 DOM） */
};
/* ===== 房间邀请收件箱 =====
   ★ 2026-10-02：以前「邀请好友建房」是纯本地 push，好友根本收不到任何东西，
     还被前端直接塞进座位开始打牌。现在邀请落服务端，只在这里由对方自己决定。 */
function loadRoomInvites(root) {
  var box = $('#fr-invites', root); if (!box) return;
  apiRoomInvites().then(function (r) {
    var b = $('#fr-invites', root); if (!b) return;    /* 异步回来时页面可能已经换掉 */
    var list = (r.code === 200 && r.j.list) ? r.j.list : [];
    if (!list.length) { b.innerHTML = ''; return; }
    b.innerHTML = '<div class="li" data-act="room-invites" style="border-left:3px solid var(--gold)">' +
      '<div class="grow" style="min-width:0"><div class="li-title">' + list.length + ' 条房间邀请</div>' +
      '<div class="li-sub">' + esc(list[0].fromName) + ' 邀请你进入房间 ' + esc(String(list[0].no)) +
      (list.length > 1 ? ' 等' : '') + '</div></div>' +
      '<span class="tag gold">查看</span>' + icon('right', 16) + '</div>';
  });
}
function showRoomInvites() {
  openSheet({
    title: '房间邀请',
    body: '<div id="ri-body"><div class="li"><div class="li-sub">加载中…</div></div></div>',
    onReady: function (root, close) {
      function draw() {
        apiRoomInvites().then(function (r) {
          var b = $('#ri-body', root); if (!b) return;
          var list = (r.code === 200 && r.j.list) ? r.j.list : [];
          if (!list.length) {
            b.innerHTML = '<div class="empty">' + icon('mail', 40) + '<div>暂时没有房间邀请</div>' +
              '<div class="tiny txt3 mt8">好友建私有房并邀请你时，会出现在这里</div></div>';
            return;
          }
          b.innerHTML = '<div class="tiny txt3 mb8">同意之后才会进房间；你不同意，谁也拉不动你。</div>' +
            '<div class="list">' + list.map(function (it) {
              return '<div class="li"><div class="grow" style="min-width:0">' +
                '<div class="li-title">' + esc(it.fromName) + ' 邀请你 · 房间 <span class="tag">' + esc(String(it.no)) + '</span></div>' +
                '<div class="li-sub">' + esc(it.name) + ' · ' + it.sb + '/' + it.bb + ' · ' + it.seats + '/' + it.cap + ' 人' +
                (it.hasPwd ? ' · 需要密码' : '') + ' · ' + timeAgo(it.ts) + '</div></div>' +
                '<div class="row gap6"><div class="btn xs ghost" data-rj="' + esc(String(it.no)) + '">拒绝</div>' +
                '<div class="btn xs gold" data-ra="' + esc(String(it.no)) + '">接受并进入</div></div></div>';
            }).join('') + '</div>';
        });
      }
      bindClick(root, function (e) {
        var a = e.target.closest('[data-ra]'), d = e.target.closest('[data-rj]');
        if (d) { apiRoomDecline(d.dataset.rj).then(function () { toast('已拒绝邀请', 'ok'); draw(); }); return; }
        if (a) {
          apiRoomAccept(a.dataset.ra).then(function (r) {
            if (r.code !== 200) { toast((r.j && r.j.msg) || '接受失败', 'err', 2800); return; }
            var t = upsertRoomTable(r.j.room);
            close(); toast('已接受邀请，进入房间', 'ok');
            go('table', { id: t.id });
          });
        }
      });
      draw();
    }
  });
}
bindAct('room-invites', showRoomInvites);
function findFriend(id) {
  var all = (S.friends || []).concat(S.requests || [], S.outgoing || [], S.blocked || []);
  for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(id)) return all[i];
  return null;
}
function showFriendCard(u) {
  openSheet({
    title: '玩家资料',
    body: '<div class="row gap12" style="margin-bottom:12px">' + avatarHTML(u, 'xl', { frame: u.vip >= 5 ? 'gold' : 'plain' }) +
      '<div class="col grow"><div class="row gap6"><span class="b" style="font-size:17px">' + esc(u.name) + '</span>' +
      '<span class="tag gold">VIP' + u.vip + '</span></div>' +
      '<div class="tiny txt3">ID ' + u.id + ' · Lv.' + u.level + '</div>' +
      '<div class="tiny txt3">注册 ' + (u.regDays || 0) + ' 天' + (u.status === 'online' ? ' · 当前在线' : '') + '</div>' +
      '</div></div>' +
      /* ★ 只展示公开信息：绝不显示别人的余额 / 盈亏 —— 别人的钱包不是社交货币 */
      '<div class="stat-grid">' +
      '<div class="stat-box"><div class="v">Lv.' + (u.level || 1) + '</div><div class="k">等级</div></div>' +
      '<div class="stat-box"><div class="v">' + fmtInt(u.hands || 0) + '</div><div class="k">手牌数</div></div>' +
      '<div class="stat-box"><div class="v">' + (u.vip ? 'VIP' + u.vip : '—') + '</div><div class="k">会员</div></div>' +
      '</div>' +
      '<div class="grid g2 gap8 mt12">' +
      '<div class="btn gold" data-fc="chat">私聊</div>' +
      '<div class="btn ghost" data-fc="gift">赠送余额</div>' +
      '<div class="btn gold" data-fc="room">建房一起玩</div>' +
      '<div class="btn ghost" data-fc="invite">邀请入桌</div>' +
      '<div class="btn ghost" data-fc="block">拉黑</div>' +
      '<div class="btn ghost" data-fc="delete">删除好友</div>' +
      '</div>',
    onReady: function (root, close) {
      bindClick(root, function (e) {
        var b = e.target.closest('[data-fc]'); if (!b) return;
        var a = b.dataset.fc; close();
        if (a === 'chat') openPrivateChat(u);
        if (a === 'gift') showGift(u);
        if (a === 'room') createRoomFlow({ mode: 'nlh', invite: [u.id] });
        /* ★ 2026-10-02 修「假 toast」：
           以前这里只要 TT.src 存在就弹一句「已邀请 X 进入当前牌桌」，
           但邀请列表只对 private 房间弹 —— 公共牌桌上那句 toast 是**骗人的**，
           服务端一条邀请都没发，对方收件箱里什么都没有，用户死活等不到人。
           现在：有服务端房间号就开邀请列表（顺便把这句没意义的话去掉），没有就给明确出路。 */
        if (a === 'invite') {
          /* ★ 2026-10-05：牌桌上直接给本桌建个真房间再邀请，不再把人赶去重建房 */
          if (TT && TT.src && TT.src.roomNo) { toast('选择要请进来的好友', 'ok'); inviteFriendsToRoom(TT.src); }
          else if (TT && TT.t) showTableInvite();
          else createRoomFlow({ mode: 'nlh', invite: [u.id] });
        }
        if (a === 'block') return friendAct(apiFriendBlock(u.id, true));
        if (a === 'delete') return friendAct(apiFriendDel(u.id));
        if (Route.cur === 'friends') go('friends', {}, { noHist: true });
      });
    }
  });
}

/* ---------- 添加好友（真实搜索，不再是凭空造人） ---------- */
bindAct('create-room', function () { createRoomFlow(); });

/* 好友增删的统一回调：成功→提示并刷新好友页；失败→把服务端的原因原样告诉用户 */
function friendAct(promise) {
  promise.then(function (r) {
    if (r.code === 200 && r.j && r.j.ok) toast(r.j.msg || '已完成', 'ok');
    else toast((r.j && r.j.msg) || '操作失败，请重试', 'err');
    if (Route.cur === 'friends') go('friends', {}, { noHist: true });
  });
}

bindAct('add-friend', function () {
  openSheet({
    title: '添加好友',
    body: '<div class="field"><div class="input-wrap">' + icon('search', 16) +
      '<input id="af-id" placeholder="输入玩家 ID 或昵称"></div></div>' +
      '<button class="btn gold block" id="af-search">搜索玩家</button>' +
      '<div id="af-result" class="mt12"></div>' +
      '<div class="section-title">我的 ID</div>' +
      '<div class="list"><div class="li" data-af="copyid">' +
      '<div class="center" style="width:34px;height:34px;border-radius:10px;background:var(--panel2)">' + icon('users', 18) + '</div>' +
      '<div class="grow"><div class="li-title">ID ' + esc(S.user.id) + '</div>' +
      '<div class="li-sub">把这串数字给好友，他就能搜到你</div></div>' +
      '<div class="btn xs ghost">复制</div></div></div>',
    onReady: function (root, close) {
      var box = $('#af-result', root);
      var btnOf = function (p) {
        if (p.rel === 'self') return '<span class="tag">这是你自己</span>';
        if (p.rel === 'friend') return '<span class="tag green">已是好友</span>';
        if (p.rel === 'in') return '<div class="btn xs green" data-af-add="' + p.id + '">同意</div>';
        if (p.rel === 'out') return '<span class="tag">已申请</span>';
        if (p.rel === 'blocked') return '<span class="tag">不可添加</span>';
        return '<div class="btn xs gold" data-af-add="' + p.id + '">加好友</div>';
      };
      function search() {
        var kw = $('#af-id', root).value.trim();
        if (!kw) { toast('请输入 ID 或昵称', 'err'); return; }
        box.innerHTML = '<div class="empty"><div class="tiny txt3">搜索中…</div></div>';
        apiFriendSearch(kw).then(function (r) {
          if (r.code !== 200 || !r.j || !r.j.ok) { box.innerHTML = frEmpty('search', '搜索失败', '请检查网络后重试'); return; }
          var list = r.j.list || [];
          if (!list.length) { box.innerHTML = frEmpty('search', '没有找到玩家', '确认 ID 或昵称是否输对；也可以让好友把他的 ID 发给你'); return; }
          box.innerHTML = '<div class="list">' + list.map(function (p) {
            var f = friendFromApi(p);
            return '<div class="li">' + avatarHTML(f, 'md') +
              '<div class="grow" style="min-width:0"><div class="li-title">' + esc(f.name) + '</div>' +
              '<div class="li-sub">ID ' + esc(f.id) + ' · Lv.' + f.level + ' · ' + (f.status === 'online' ? '在线' : '离线') + '</div></div>' +
              btnOf(p) + '</div>';
          }).join('') + '</div>';
        });
      }
      $('#af-search', root).onclick = search;
      $('#af-id', root).onkeydown = function (e) { if (e.key === 'Enter') search(); };
      bindClick(root, function (e) {
        var a = e.target.closest('[data-af-add]');
        if (a) {
          apiFriendReq(a.dataset.afAdd).then(function (r) {
            if (r.code === 200 && r.j && r.j.ok) {
              /* ★ 以前只弹一句「申请已发送」，用户不懂还得等谁、等什么，
                 对方没同意就跑去说「加了好友对方不显示」——链路是通的，是这句话没说清楚。 */
              toast((r.j.msg || '申请已发送') + ' · 等对方点「同意」，两边好友列表才会同时出现', 'ok', 3400);
              close();
              if (Route.cur === 'friends') go('friends', {}, { noHist: true });
            } else toast((r.j && r.j.msg) || '操作失败，请重试', 'err');
          });
          return;
        }
        var b = e.target.closest('[data-af]'); if (!b) return;
        if (b.dataset.af === 'copyid') { copyText(S.user.id); toast('ID 已复制', 'ok'); }
      });
    }
  });
});

/* 我的名片。
   以前这里画的是一个「假二维码」——CSS 画的方块，扫不出任何东西，
   却写着「扫码添加我为好友」。二维码要真正实现编码才敢画，
   没做之前宁可老实给 ID：假二维码比没有更坏。 */
bindAct('mycard', function () {
  openSheet({
    title: '我的名片',
    body: '<div class="card gold center">' +
      '<div class="tiny txt3">我的玩家 ID</div>' +
      '<div class="b gold" style="font-size:26px;letter-spacing:2px">' + esc(S.user.id) + '</div>' +
      '<div class="tiny txt3 mt8">' + esc(S.user.name) + ' · Lv.' + S.user.level + ' · VIP' + S.user.vip + '</div>' +
      '<button class="btn gold block mt12" id="mc-copy">复制 ID</button>' +
      '<div class="tiny txt3 mt8">好友在「好友 → 右上角 +」里输入这串 ID 就能搜到你</div>' +
      '</div>',
    onReady: function (root) {
      $('#mc-copy', root).onclick = function () { copyText(S.user.id); toast('ID 已复制', 'ok'); };
    }
  });
});



