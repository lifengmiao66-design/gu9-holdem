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
/* ===== lobby.js · 大厅 / 牌桌列表 / 快速开始 / 私人房 ===== */
function navHTML(cur) {
  var items = [
    { k: 'lobby', n: '大厅', i: 'home' },
    { k: 'friends', n: '好友', i: 'users', badge: S.requests.length },
    { k: 'wallet', n: '钱包', i: 'wallet' },
    { k: 'mine', n: '我的', i: 'user' }
  ];
  return '<div class="navbar">' + items.map(function (it) {
    return '<div class="nav' + (cur === it.k ? ' on' : '') + '" data-nav="' + it.k + '">' +
      '<span class="ico" style="position:relative">' + icon(it.i, 22) +
      (it.badge ? '<span class="badge">' + it.badge + '</span>' : '') + '</span>' +
      '<span class="lb">' + it.n + '</span></div>';
  }).join('') + '</div>';
}
document.addEventListener('click', function (e) {
  var n = e.target.closest('[data-nav]'); if (!n) return;
  var k = n.getAttribute('data-nav');
  if (k === 'lobby') go('lobby'); else go(k);
});

/* ★ 2026-10-03：导航栏「好友」红点 —— 好友申请 + 房间邀请都算。
   以前红点只数 S.requests，好友发来房间邀请时大厅/底栏毫无提示，
   于是「邀请了但好友那边不显示」（其实他根本不知道有事发生）。 */
function navBadgeRefresh() {
  var n = (S.requests || []).length + (S.roomInvites || []).length;
  var ico = document.querySelector('.navbar .nav[data-nav="friends"] .ico');
  if (!ico) return;
  var b = ico.querySelector('.badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'badge'; ico.appendChild(b); }
  b.textContent = n > 99 ? '99+' : n;
}
/* 大厅牌桌列表重画（房间同步完成后回调；页面已切走就什么都不做） */
var LOBBY_RENDER = null;
function lobbyRenderTables() { if (LOBBY_RENDER) LOBBY_RENDER(); }

/* ★★ 大厅顶部「房间邀请」横幅 —— 2026-10-03 夜修：
   以前这个横幅只在进大厅那一瞬间画一次，之后邀请到达只会闪一条 toast，
   横幅再也不出现（用户实测＝「邀请了但好友那边不显示」）。
   现在抽成全局函数：邀请轮询（8 秒）一到货就调它，不用刷新页面、不用切页面。
   横幅上直接给「接受 / 拒绝」，一步到位，不用再钻到好友页里去点。 */
function lobbyRenderInvites() {
  if (!Route || Route.cur !== 'lobby') return;
  var box = document.querySelector('#lobby-invites'); if (!box) return;
  var list = S.roomInvites || [];
  if (!list.length) { box.innerHTML = ''; return; }
  var it = list[0];
  box.innerHTML = '<div class="li mt12" style="border-left:3px solid var(--gold)">' +
    '<div style="color:var(--gold);flex:0 0 auto">' + icon('mail', 20) + '</div>' +
    '<div class="grow" style="min-width:0">' +
    '<div class="li-title">' + list.length + ' 条房间邀请</div>' +
    '<div class="li-sub">' + esc(it.fromName || '好友') + ' 邀请你进房间 <b class="gold">' + esc(String(it.no)) + '</b>' +
    (list.length > 1 ? ' 等 ' + list.length + ' 条' : '') + ' · ' + esc(it.name || '') + ' ' + it.sb + '/' + it.bb +
    ' · ' + (it.seats || 0) + '/' + (it.cap || 0) + ' 人</div>' +
    '<div class="li-sub">同意后才会入座，你不同意谁也拉不动你</div>' +
    '</div>' +
    '<div class="col gap6" style="flex:0 0 auto;align-items:stretch">' +
    '<div class="btn xs gold" data-ra="' + esc(String(it.no)) + '">接受</div>' +
    '<div class="btn xs ghost" data-rj="' + esc(String(it.no)) + '">拒绝</div>' +
    (list.length > 1 ? '<div class="btn xs" data-act="room-invites">全部</div>' : '') +
    '</div></div>';
}
/* 大厅横幅上的「接受 / 拒绝」（不打开弹窗直接处理） */
document.addEventListener('click', function (e) {
  if (!Route || Route.cur !== 'lobby') return;
  var a = e.target.closest('[data-ra]'), d = e.target.closest('[data-rj]');
  if (!a && !d) return;
  e.stopPropagation();
  if (d) {
    apiRoomDecline(d.getAttribute('data-rj')).then(function () {
      toast('已拒绝邀请', 'ok'); refreshRoomInvites().then(function () { lobbyRenderInvites(); lobbyRenderTables(); });
    });
    return;
  }
  apiRoomAccept(a.getAttribute('data-ra')).then(function (r) {
    if (r.code !== 200) { toast((r.j && r.j.msg) || '接受失败', 'err', 2800); return; }
    /* 没有密码的房间：接受即入座，直接进桌 */
    var t = upsertRoomTable(r.j.room);
    toast('已接受邀请，进入房间', 'ok');
    go('table', { id: t.id });
  });
}, true);   /* ★ 捕获阶段：抢在 bindClick 的 data-tid / data-act 之前处理 */

function quickStart() {
  var pool = S.tables.filter(function (t) { return t.players < t.cap && (!t.vipOnly || S.user.vip >= 4); });
  var t = pick(pool.length ? pool : S.tables);
  enterTable(t);
}
function enterTable(t) {
  if (t.vipOnly && (S.user.vip || 0) < 4) { toast('该牌桌需要 VIP4 以上', 'err'); return; }
  /* 服务端房间（有房间号）：一律交给服务端判定，前端不持有明文密码。
     以前这里用 t.passwd 判断 —— 但 roomPublic 从不下发明文密码，t.passwd 永远为空，
     导致有密码的房间不弹框、直接 join 被服务端拒「密码不正确」。
     现在：先以空密码 join；若服务端 403 提示密码，则弹框输入后重试；
     若是私有房未接受邀请，则替他接受后再试。 */
  if (t.roomNo) {
    var joinTry = function (pwd) {
      apiRoomJoin(t.roomNo, pwd || '').then(function (x) {
        if (x.code === 200) { go('table', { id: upsertRoomTable(x.j.room).id }); return; }
        if (x.code === 403) {
          var msg = (x.j && x.j.msg) || '';
          if (/密码/.test(msg)) {
            promptBox('该牌桌已设置密码', { label: '请输入房间密码', placeholder: '请输入房主设置的密码', type: 'text', required: true }).then(function (v) {
              if (v === null) return;
              joinTry(v);
            });
          } else {
            apiRoomAccept(t.roomNo).then(function (y) {
              if (y.code === 200) go('table', { id: upsertRoomTable(y.j.room).id });
              else toast(msg || '无法进入这个房间', 'err', 2800);
            });
          }
          return;
        }
        toast(msg || '无法进入房间', 'err', 2800);
      });
    };
    joinTry('');
    return;
  }
  /* 纯本地桌（无 roomNo）★ 2026-10-05 全部改道：
     机器人桌 = 真钱 USDT，由服务端发牌 + 服务端 bot 陪打。
     以前这类桌跑在浏览器里、用本地「练习币」，改一下缓存就能凭空刷钱 —— 已废弃。
     现在按本桌参数（玩法 / 盲注 / 人数）开一间机器人房，然后进服务端牌桌页。 */
  if (t.passwd) {
    promptBox('该牌桌已设置密码', { label: '请输入房间密码', placeholder: '请输入房间口令', type: 'text', required: true }).then(function (v) {
      if (v === null) return;
      if (v !== String(t.passwd)) { toast('密码错误', 'err'); return; }
      enterBotRoom(t);
    });
    return;
  }
  enterBotRoom(t);
}
/* 进机器人房：找现成的 / 没有就建一间，然后跳服务端牌桌页 */
function enterBotRoom(t) {
  if (typeof apiQuickStart !== 'function') { toast('请刷新页面后重试', 'err'); return; }
  /* ★ 2026-10-07（用户要求）：去掉「正在进入机器人房…」提示，点了直接进 */
  apiQuickStart({
    modeKey: t.modeKey || 'nlh',
    sb: t.sb || (blindLevels()[0] || {}).sb || 1,   /* ★ 兜底用后台配置的第一档，不再是写死的 0.5 */
    cap: Math.min(8, t.cap || 8)
  }).then(function (r) {
    if (r.code !== 200 || !r.j || !r.j.room) {
      toast((r.j && r.j.msg) || '进入机器人房失败，请重试', 'err', 2800); return;
    }
    var room = r.j.room;
    if (typeof upsertRoomTable === 'function') upsertRoomTable(room);
    location.href = 'table_rt.html?room=' + encodeURIComponent(room.no);
  });
}

var LobbyFilter = { type: 'all', level: 'all', onlySeat: false, kw: '' };
var LOBBY_SEARCH_ROOM = null;   /* 大厅顶部按房间号精确查找（含 private）的临时结果 */

/* 大厅配置（后台可调开关） */
var LOBBY_BANNERS = [
  { k: 'b1', t: '百万俱乐部赛', s: '每晚 20:00 · 保底奖励 5,000 USDT', c: 'linear-gradient(120deg,#7a3f12,#c9832a)' },
  { k: 'b2', t: 'USDT 充值', s: 'USDT 充值 · 签到 / 任务免费领 · 提现走风控审核', c: 'linear-gradient(120deg,#1f4d8f,#2f80ed)' },
  { k: 'b3', t: '新手福利', s: '登录 7 天领 1,000 USDT', c: 'linear-gradient(120deg,#14603f,#2ecc71)' }
];
var LOBBY_QUICK = [
  { k: 'quick', n: '快速开始', i: 'bolt', c: '#f5c352' },
  { k: 'room', n: '建房邀请', i: 'lock', c: '#3b8cff' },
  { k: 'mtt', n: '锦标赛', i: 'trophy', c: '#a06bff' },
  { k: 'addhome', n: '添加到主屏幕', i: 'plus', c: '#2ecc71' }
];
function admOn(group, key) {
  var cfg = S.admin && S.admin.lobby && S.admin.lobby[group];
  if (!cfg) return true;
  return cfg[key] !== false;
}

/* ★ 2026-10-04：轮播数据与 HTML 抽成全局 —— 服务端配置异步到达时（applyServerCfg）
   可调用 lobbyRepaintBanner() 原地重画，不用等玩家下次进大厅。 */
function lobbyBannerData() {
  var cb = ((S.serverCfg || {}).banners || []).filter(function (b) { return b && b.img; });
  var banners;
  if (cb.length) {
    banners = cb.map(function (b, i) {
      /* 底色取自内置三条：图片万一加载不出来（文件被删 / 路径错），下面还有一层渐变顶着，
         不会出现一块纯黑看着像「空白」。 */
      return { k: 'srv' + i, img: b.img, t: b.t || '', s: b.s || '', c: LOBBY_BANNERS[i % LOBBY_BANNERS.length].c };
    });
  } else {
    banners = LOBBY_BANNERS.filter(function (b) { return admOn('banners', b.k); });
  }
  if (!banners.length) banners = [LOBBY_BANNERS[0]];
  return banners;
}
function lobbyBannerHTML(banners) {
  return banners.map(function (b, i) {
    /* ★ 用 <img> 做背景：兼容性好、可 onerror 兜底、任意比例自适应 cover。
       文字和遮罩放在前景，避免深色遮罩把图片压成黑块。 */
    var bg = b.img
      ? '<img class="slide-bg" src="' + esc(b.img) + '" alt="" onerror="this.style.display=\'none\'">'
      : '';
    var hasText = !!(b.t || b.s);
    var txt = hasText
      ? '<div class="slide-body"><div style="font-size:20px;font-weight:800;text-shadow:0 1px 6px rgba(0,0,0,.5)">' + esc(b.t || '') + '</div>' +
        (b.s ? '<div class="small" style="opacity:.92;margin-top:4px;text-shadow:0 1px 4px rgba(0,0,0,.5)">' + esc(b.s) + '</div>' : '') +
        '</div>'
      : '';
    var c = b.c || '#1b2a3a';
    return '<div class="slide' + (i === 0 ? ' on' : '') + '" style="background:' + c + '">' +
      bg +
      (b.img ? '<div class="slide-mask"></div>' : '') +
      txt +
      '</div>';
  }).join('') +
  '<div class="dots">' + banners.map(function (_, i) { return '<i class="' + (i === 0 ? 'on' : '') + '"></i>'; }).join('') + '</div>';
}
/* 服务端配置晚到（首屏渲染用的还是本地旧开关）→ 原地重画轮播 */
function lobbyRepaintBanner() {
  var el = document.getElementById('bnr');
  if (!el || !document.getElementById('view')) return;
  el.innerHTML = lobbyBannerHTML(lobbyBannerData());
}
/* 邮件未读数变化时原地刷新顶栏 badge，不用重画整个大厅 */
function lobbyRepaintMailBadge() {
  var btn = document.querySelector('.topbar .icon-btn[data-act="mail"]');
  if (!btn || !document.getElementById('view')) return;
  var old = btn.querySelector('.badge');
  if (S.unread.mail > 0) {
    if (old) { old.textContent = S.unread.mail; return; }
    var sp = document.createElement('span'); sp.className = 'badge'; sp.textContent = S.unread.mail;
    btn.appendChild(sp);
  } else if (old) {
    old.remove();
  }
}
Screens.lobby = function () {
  var banners = lobbyBannerData();
  var quick = LOBBY_QUICK.filter(function (q) { return admOn('quick', q.k); });
  return '<div class="app-shell">' +
    '<div class="topbar">' +
    /* ★ 2026-10-03：顶栏小图也用后台上传的主 Logo（没上传就回落内置的 logo-mark.png） */
    '<div class="brand-mark" title="' + esc(APP_NAME) + '"><img src="' + esc(APP_LOGO || 'assets/logo-mark.png') + '" alt="' + esc(APP_NAME) + '" onerror="this.parentNode.style.display=\'none\'"></div>' +
    /* ★ 2026-10-02：顶栏不再显示玩家头像 / 昵称 / VIP / ID —— 截图外发不再泄露账号信息。
       这里只留 APP 名称（APP_NAME，可由后台「参数配置 → 应用名称」改）。
       进「我的」的入口仍在底部导航，功能不丢；bindAct('profile') 仍被「我的」页卡片使用。 */
    '<div class="col topbar-who" style="line-height:1.3">' +
    '<div class="row gap6"><span class="b" data-app-name>' + esc(APP_NAME) + '</span></div>' +
    '</div>' +
    '<div class="grow"></div>' +
    '<div class="icon-btn" data-lang-open="1" title="Language / 语言"><span class="lang-mark">' + esc((window.I18N ? (I18N.langs.filter(function (l) { return l.k === I18N.get(); })[0] || I18N.langs[0]).s : '简')) + '</span></div>' +
    assetBarHTML() +
    '<div class="icon-btn" data-act="mail">' + icon('mail', 18) + (S.unread.mail ? '<span class="badge">' + S.unread.mail + '</span>' : '') + '</div>' +
    '<div class="icon-btn" data-act="settings">' + icon('settings', 18) + '</div>' +
    '</div>' +
    '<div class="body">' +
    '<div class="banner" id="bnr">' +
    lobbyBannerHTML(banners) +
    '</div>' +
    '<div class="grid g4 mt12">' + quick.map(function (q) {
      return '<div class="card center" data-q="' + q.k + '" style="padding:12px 4px;cursor:pointer;border-color:rgba(255,255,255,.06)">' +
        '<div style="color:' + q.c + '">' + icon(q.i, 24) + '</div>' +
        '<div class="tiny txt2" style="margin-top:4px">' + q.n + '</div></div>';
    }).join('') +     '</div>' +
    '<div id="lobby-invites"></div>' +
    '<div class="row mt16" style="justify-content:space-between">' +
    '<div class="b" style="font-size:15px">牌桌列表</div>' +
    '<div class="row gap6">' +
    '<div class="icon-btn" data-act="refresh">' + icon('refresh', 16) + '</div>' +
    '<div class="icon-btn" data-act="filter">' + icon('filter', 16) + '</div>' +
    '<div class="input-wrap" style="height:36px;width:170px">' + icon('search', 16) +
    '<input id="kw" placeholder="搜索牌桌 / 房间号" value="' + esc(LobbyFilter.kw) + '"></div>' +
    '</div></div>' +
    '<div class="segment mt8" id="gtab">' +
    ['all|全部', 'nlh|德州', 'omaha|奥马哈', 'short|短牌', 'aof|AOF', 'rush|极速', 'pineapple|菠萝', 'tourney|赛事'].map(function (x) {
      var p = x.split('|');
      return '<div class="seg' + (LobbyFilter.type === p[0] ? ' on' : '') + '" data-gt="' + p[0] + '">' + p[1] + '</div>';
    }).join('') + '</div>' +
    '<div class="hscroll mt8">' +
    ['all|全部级别', 'micro|微额', 'small|小额', 'mid|中额', 'high|高额'].map(function (x) {
      var p = x.split('|');
      return '<div class="tag' + (LobbyFilter.level === p[0] ? ' gold' : '') + '" data-lv="' + p[0] + '" style="padding:5px 12px;cursor:pointer">' + p[1] + '</div>';
    }).join('') + '</div>' +
    '<div id="tables" class="mt8"></div>' +
    '</div>' +
    navHTML('lobby') +
    '</div>';
};

Screens.lobby.after = function (p, root) {
  /* Banner 轮播 —— 每 tick 重新查询 DOM（不缓存 NodeList），
     这样 lobbyRepaintBanner() 替换 #bnr 内容后轮播能自动接管新节点，
     不会出现「重画后卡在第一张 / 旋转打在已脱离文档的旧节点上」。 */
  var bi = 0;
  var timer = setInterval(function () {
    var slides = $$('#bnr .slide', root), dots = $$('#bnr .dots i', root);
    if (!slides.length) return;
    bi = (bi + 1) % slides.length;
    slides.forEach(function (s, i) { s.classList.toggle('on', i === bi); });
    dots.forEach(function (d, i) { d.classList.toggle('on', i === bi); });
  }, 3500);
  /* 大厅停留期间每 12 秒同步一次服务端房间：好友接受邀请进来、房主改设置、房间解散，
     都能在列表里实时反映（不用手动点刷新）。离开大厅时清掉。 */
  var roomTimer = setInterval(function () {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    syncServerRooms(function (ok) { if (ok) { renderTables(); lobbyRenderInvites(); } });
  }, 12000);
  root.__cleanup = function () { clearInterval(timer); clearInterval(roomTimer); LOBBY_RENDER = null; };

  function renderTables() {
    LOBBY_RENDER = renderTables;      /* 供 syncServerRooms 回调重画（页面切走会被 after 清掉） */
    var kw = LobbyFilter.kw.trim().toLowerCase();
    var list = S.tables.filter(function (t) {
      var k = t.modeKey || 'nlh';
      if (MODES[k] && MODES[k].off) return false;            /* 后台关闭的玩法不显示 */
      if (LobbyFilter.type === 'nlh' && k !== 'nlh') return false;
      if (LobbyFilter.type === 'omaha' && ['plo', 'plo5', 'omaha8'].indexOf(k) < 0) return false;
      if (LobbyFilter.type === 'short' && k !== 'short') return false;
      if (LobbyFilter.type === 'aof' && k !== 'aof') return false;
      if (LobbyFilter.type === 'rush' && k !== 'rush') return false;
      if (LobbyFilter.type === 'pineapple' && k !== 'pineapple') return false;
      if (LobbyFilter.type === 'tourney' && ['sng', 'mtt', 'spin'].indexOf(k) < 0) return false;
      if (LobbyFilter.level === 'micro' && t.sb > 10) return false;
      if (LobbyFilter.level === 'small' && (t.sb < 25 || t.sb > 100)) return false;
      if (LobbyFilter.level === 'mid' && (t.sb < 200 || t.sb > 500)) return false;
      if (LobbyFilter.level === 'high' && t.sb < 1000) return false;
      if (LobbyFilter.onlySeat && t.players >= t.cap) return false;
      if (kw && (t.name + t.id + t.sb + (t.roomNo || '')).toLowerCase().indexOf(kw) < 0) return false;
      return true;
    });
    /* ★ 房间号精确查找：用户输入 4-6 位数字时，把 /papi/rooms/detail 查到的房间（含 private）顶到列表最前 */
    if (LOBBY_SEARCH_ROOM && /^\d{4,6}$/.test(LobbyFilter.kw.trim())) {
      var sr = tableFromRoom(LOBBY_SEARCH_ROOM); sr._search = true;
      list = [sr].concat(list.filter(function (x) { return String(x.roomNo) !== String(LOBBY_SEARCH_ROOM.no); }));
    }
    if (!list.length) { $('#tables', root).innerHTML = '<div class="empty">' + icon('search', 40) + '<div>没有符合条件的牌桌</div></div>'; return; }
    /* ★ 真房间（我建的 / 我在里面的 / 邀请我的）排在最前面 —— 造完房要能一眼找到它 */
    list = list.slice().sort(function (a, b) {
      var ra = a.roomNo ? 0 : 1, rb = b.roomNo ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (b.actAt || 0) - (a.actAt || 0);
    });
    $('#tables', root).innerHTML = '<div class="list">' + list.map(function (t) {
      var full = t.players >= t.cap;
      var m = MODES[t.modeKey] || MODES.nlh;
      var isMine = t.roomNo && String(t.owner || '') === String((S.user && S.user.id) || '');
      return '<div class="li" data-tid="' + t.id + '">' +
        /* flex:0 0 auto 必需：只写 width 的话它仍会被 flex 压缩，
           44px 挤成不到两字宽，「2张」就断成两行。 */
        '<div class="col center" style="flex:0 0 auto;width:44px;gap:2px">' +
        '<div class="center" style="width:42px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1d5c43,#0e3b2a);color:#8ff0bb">' + icon('cards', 20) + '</div>' +
        '<div class="tiny txt3">' + m.hole + '张</div></div>' +
        '<div class="grow" style="min-width:0">' +
        '<div class="row gap6"><span class="li-title">' + (t.roomNo ? t.name : modeName(m)) + '</span>' +
        (t.roomNo ? '<span class="tag">' + esc(String(t.roomNo)) + '</span>' : '') +
        (t.myInvite === 'pending' ? '<span class="tag gold">邀请你加入</span>' : '') +
        (isMine ? '<span class="tag purple">我的房</span>' : '') +
        (t._search ? '<span class="tag gold">房间号搜索</span>' : '') +
        (t.private ? '<span class="tag blue">私人房</span>' : '') +
        (t.vipOnly ? '<span class="tag purple">VIP</span>' : '') +
        (t.insurance ? '<span class="tag green">保险</span>' : '') +
        (t.hasPwd ? '<span class="tag">' + icon('lock', 11) + '</span>' : '') +
        (t.straddle ? '<span class="tag gold">强抓</span>' : '') +
        (t.ante ? '<span class="tag">前注</span>' : '') + '</div>' +
        /* ★ 每个统计项包一层 .st（white-space:nowrap），分隔符单独成 .sep。
           中文在任意两字之间都能断行，于是「均池 425」会被断成「均」/「池 425」。
           包起来后只会在「项与项之间」换行，语义单元不再被拆开。 */
        '<div class="li-sub">' + [
          '盲注 <b class="gold">' + uStr(t.sb) + '/' + uStr(t.bb) + ' USDT</b>',
          betTypeName(m.bet), t.cap + '人', '均池 ' + short(t.avgPot), t.speed
        ].map(function (x) { return '<span class="st">' + x + '</span>'; }).join('<i class="sep">·</i>') + '</div>' +
        '<div class="li-sub">' + [
          rakeText({ mode: m, bb: t.bb, street: 1 }), '入池率 ' + t.flopRate + '%'
        ].map(function (x) { return '<span class="st">' + x + '</span>'; }).join('<i class="sep">·</i>') + '</div>' +
        '</div>' +
        '<div class="col" style="align-items:flex-end;gap:4px">' +
        '<div class="small ' + (full ? 'red' : 'green') + ' b">' + t.players + '/' + t.cap + '</div>' +
        '<div class="bar" style="width:60px"><i style="width:' + Math.round(t.players / t.cap * 100) + '%"></i></div>' +
        '<div class="btn xs ' + (full ? 'ghost' : 'gold') + '" data-tid="' + t.id + '">' + (full ? '满员' : '进入') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
  }
  renderTables();

  /* ★ 2026-10-03：进大厅就把服务端真房间拉回来 —— 我建的、我在里面的、好友邀请我的，
     刷新页面 / 重新登录后也必须在列表里（以前只在「创建那一刻」存在于内存里）。 */
  if (S.logged && apiTokenGet()) startFriendPoll();      /* 幂等：本次会话登录的号也能挂上邀请轮询 */
  syncServerRooms(function (ok) { if (ok) renderTables(); });
  /* 房间里「谁邀请了我」的横幅：不用玩家自己钻到好友页去找。
     横幅的渲染统一走 lobbyRenderInvites()（全局），邀请轮询一到货就能重画。 */
  refreshRoomInvites().then(function () { lobbyRenderInvites(); });

  bindClick(root, function (e) {
    var seg = e.target.closest('#gtab .seg');
    if (seg) { LobbyFilter.type = seg.dataset.gt; $$('#gtab .seg', root).forEach(function (x) { x.classList.remove('on'); }); seg.classList.add('on'); renderTables(); return; }
    var lv = e.target.closest('[data-lv]');
    if (lv) { LobbyFilter.level = lv.dataset.lv; $$('[data-lv]', root).forEach(function (x) { x.classList.remove('gold'); }); lv.classList.add('gold'); renderTables(); return; }
    var tid = e.target.closest('[data-tid]');
    if (tid) { var t = S.tables.filter(function (x) { return x.id == tid.dataset.tid; })[0]; if (t) enterTable(t); return; }
    var q = e.target.closest('[data-q]');
    if (q) {
      var k = q.dataset.q;
      if (k === 'quick') quickStart();
      else if (k === 'room') createRoomFlow();
      else if (k === 'modes') go('modes');
      else if (k === 'rake') go('rake');
      else if (k === 'mtt') go('mtt');
      else if (k === 'rank') go('mine', { tab: 'rank' });
      else if (k === 'friends') go('friends');
      else if (k === 'addhome') { if (typeof promptAddToHome === 'function') promptAddToHome(); }
      else go(k);
    }
  });
  var kwI = $('#kw', root);
  kwI && kwI.addEventListener('input', function () {
    var v = this.value.trim();
    LobbyFilter.kw = v;
    if (/^\d{4,6}$/.test(v)) {
      /* 房间号：实时调详情，拿到后顶到列表最前（含 private，进不去会提示原因） */
      apiRoomDetail(v).then(function (r) {
        LOBBY_SEARCH_ROOM = (r.code === 200 && r.j && r.j.room) ? r.j.room : null;
        renderTables();
      });
    } else { LOBBY_SEARCH_ROOM = null; renderTables(); }
  });
};

function showPrivate() {
  openSheet({
    title: '私人房', body:
      '<div class="segment" id="pv-tab" style="margin-bottom:12px"><div class="seg on" data-p="create">创建房间</div><div class="seg" data-p="join">加入房间</div></div>' +
      '<div id="pv-body"></div>',
    onReady: function (root, close) {
      var body = $('#pv-body', root);
      var pvSb = blindLevels()[0].sb;   /* ★ 2026-10-07：私人房盲注默认取后台配置的第一档，点选后跟着变 */
      function render(m) {
        if (m === 'create') {
          body.innerHTML =
            '<div class="field"><div class="lb">房间名称</div><div class="input-wrap"><input id="pv-name" value="老大的私人牌局"></div></div>' +
            '<div class="field"><div class="lb">游戏类型</div><div class="segment gold"><div class="seg on">德州扑克</div><div class="seg">短牌</div><div class="seg">奥马哈</div></div></div>' +
            '<div class="field"><div class="lb">盲注级别</div><div class="hscroll">' + blindLevels().map(function (b) {
              return '<div class="tag' + (pvSb === b.sb ? ' gold' : '') + '" data-pvb="' + b.sb + '" style="padding:6px 12px">' + b.label + '</div>';
            }).join('') + '</div></div>' +
            '<div class="field"><div class="lb">买入范围（BB）</div><div class="row"><div class="input-wrap grow"><input value="40"></div><span class="txt3">~</span><div class="input-wrap grow"><input value="200"></div></div></div>' +
            '<div class="field"><div class="lb">房间密码（6位，可留空）</div><div class="input-wrap"><input id="pv-pwd" placeholder="留空则无需密码"></div></div>' +
            '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">开启保险</div><div class="li-sub">All-in 时可购买 EV 保险</div></div><div class="switch on"></div></div>' +
            '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">允许旁观</div><div class="li-sub">好友可观看你的牌局</div></div><div class="switch"></div></div>' +
            '<button class="btn gold block lg mt12" id="pv-create">创建并进入</button>';
          /* ★ 盲注档位可点选：以前这里只是装饰（创建时写死 sb:0.5），选了不生效 —— 现在跟着选的档位走 */
          body.querySelectorAll('[data-pvb]').forEach(function (b) {
            b.onclick = function () {
              body.querySelectorAll('[data-pvb]').forEach(function (x) { x.classList.remove('gold'); });
              b.classList.add('gold'); pvSb = +b.dataset.pvb;
            };
          });
          /* ★ 真房间：房间号由服务端生成，不再本地编一个 999 出来 */
          $('#pv-create', root).onclick = function () {
            var btn = this; btn.textContent = '创建中…';
            apiRoomCreate({
              name: ($('#pv-name', root) || {}).value || '老大的私人牌局',
              modeKey: 'nlh', sb: pvSb, cap: 9, priv: 'private',
              passwd: (($('#pv-pwd', root) || {}).value || '').trim().slice(0, 12)
            }).then(function (r) {
              btn.textContent = '创建并进入';
              if (r.code !== 200 || !r.j.room) { toast((r.j && r.j.msg) || '创建房间失败，请检查网络', 'err', 2800); return; }
              var t = upsertRoomTable(r.j.room);
              close(); showRoomCard(t, 0);
            });
          };
        } else {
          body.innerHTML =
            '<div class="field"><div class="lb">房间号</div><div class="input-wrap">' + icon('search', 16) + '<input id="pv-id" placeholder="输入 6 位房间号"></div></div>' +
            '<div class="field"><div class="lb">密码</div><div class="input-wrap"><input id="pv-pw" placeholder="房间密码（若有）"></div></div>' +
            '<div class="section-title">我的房间</div>' +
            '<div class="list" id="pv-mine"><div class="li"><div class="li-sub">加载中…</div></div></div>' +
            '<button class="btn gold block lg mt12" id="pv-join">加入房间</button>';
          /* 我创建 / 加入 / 受邀的房间（服务端真数据） */
          apiRoomMine().then(function (r) {
            var box = $('#pv-mine', root); if (!box) return;
            var list = (r.code === 200 && r.j.list) ? r.j.list : [];
            box.innerHTML = list.length ? list.slice(0, 10).map(function (rm) {
              return '<div class="li" data-pvr="' + esc(rm.no) + '"><div class="grow">' +
                '<div class="li-title">' + esc(rm.name) + ' <span class="tag">' + esc(rm.no) + '</span></div>' +
                '<div class="li-sub">' + rm.sb + '/' + rm.bb + ' · ' + (rm.seats || []).length + '/' + rm.cap + ' 人' +
                (rm.mine.invite === 'pending' ? ' · <span class="gold">等你接受邀请</span>' : '') + '</div></div>' +
                '<div class="btn xs gold">' + (rm.mine.invite === 'pending' ? '接受' : '进入') + '</div></div>';
            }).join('') : '<div class="li"><div class="li-sub">还没有房间</div></div>';
            bindClick(box, function (e) {
              var b = e.target.closest('[data-pvr]'); if (!b) return;
              var no = b.dataset.pvr;
              (function enter() {
                var pwv = (($('#pv-pw', root) || {}).value || '').trim();
                apiRoomJoin(no, pwv).then(function (x) {
                  if (x.code === 200) { var t = upsertRoomTable(x.j.room); close(); go('table', { id: t.id }); }
                  else if (x.code === 403) {
                    /* 私有房且还没被邀请/没同意 → 先接受邀请再进 */
                    apiRoomAccept(no).then(function (y) {
                      if (y.code === 200) { var t2 = upsertRoomTable(y.j.room); close(); go('table', { id: t2.id }); }
                      else toast((y.j && y.j.msg) || '无法进入这个房间', 'err', 2800);
                    });
                  } else toast((x.j && x.j.msg) || '无法进入这个房间', 'err', 2800);
                });
              })();
            });
          });
          /* ★ 凭真实房间号加入；没被邀请 / 没同意 → 服务端会拒绝，提示真实原因 */
          $('#pv-join', root).onclick = function () {
            var v = ($('#pv-id', root) || {}).value ? $('#pv-id', root).value.trim() : '';
            var pw = ($('#pv-pw', root) || {}).value ? $('#pv-pw', root).value.trim() : '';
            if (v.length < 4) { toast('请输入正确房间号', 'err'); return; }
            var btn = this; btn.textContent = '加入中…';
            apiRoomJoin(v, pw).then(function (r) {
              btn.textContent = '加入房间';
              if (r.code === 200) { var t = upsertRoomTable(r.j.room); close(); toast('已进入房间 ' + t.roomNo, 'ok'); go('table', { id: t.id }); return; }
              if (r.code === 403) {
                /* 私有房：要么没邀请，要么是 pending —— 试着替他接受邀请 */
                apiRoomAccept(v).then(function (y) {
                  if (y.code === 200) { var t2 = upsertRoomTable(y.j.room); close(); toast('已接受邀请并进入房间', 'ok'); go('table', { id: t2.id }); }
                  else toast((r.j && r.j.msg) || '这是私有房，需要房主邀请并你同意', 'err', 3000);
                });
                return;
              }
              toast((r.j && r.j.msg) || '加入失败', 'err', 2800);
            });
          };
        }
      }
      render('create');
      bindClick(root, function (e) {
        var s = e.target.closest('#pv-tab .seg'); if (!s) return;
        $$('#pv-tab .seg', root).forEach(function (x) { x.classList.remove('on'); }); s.classList.add('on'); render(s.dataset.p);
      });
    }
  });
}
function showClub() {
  openSheet({
    title: '俱乐部', body:
      '<div class="list">' +
      ['皇家同花顺俱乐部|128 成员|今日盈利 328万', '深夜牌神联盟|64 成员|今日盈利 96万', '概率信徒|32 成员|今日盈利 12万'].map(function (x) {
        var p = x.split('|');
        return '<div class="li"><div class="center" style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#5a2f8f,#2a1650);color:#e0b0ff">' + icon('users', 20) + '</div>' +
          '<div class="grow"><div class="li-title">' + p[0] + '</div><div class="li-sub">' + p[1] + ' · ' + p[2] + '</div></div>' +
          '<div class="btn xs ghost">进入</div></div>';
      }).join('') + '</div>' +
      '<button class="btn gold block mt12" onclick="toast(\'俱乐部创建功能演示\')">创建俱乐部</button>'
  });
}
Screens.mtt = function () {
  openSheet({
    title: '锦标赛 / MTT', body:
      '<div class="list">' +
  [{ n: '午夜狂欢赛', p: '200 USDT 报名', t: '20:00 开赛', s: '保底 5,000 USDT', r: '128/512' },
  { n: '周日百万赛', p: '1,000 USDT 报名', t: '20:30 开赛', s: '保底 20,000 USDT', r: '312/1024' },
  { n: '快速狙击赛', p: '50 USDT 报名', t: '滚动开赛', s: '即时开打', r: '18/36' },
  { n: 'VIP 邀请赛', p: '门票 x1', t: '21:00 开赛', s: '保底 8,000 USDT', r: '88/200' }].map(function (m) {
        return '<div class="li"><div class="center" style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#8f5a12,#4a2c05);color:#ffd08a">' + icon('trophy', 20) + '</div>' +
          '<div class="grow"><div class="li-title">' + m.n + '</div><div class="li-sub">' + m.p + ' · ' + m.t + ' · ' + m.s + '</div></div>' +
          '<div class="col" style="align-items:flex-end"><div class="tiny txt3">' + m.r + '</div><div class="btn xs gold mt8">报名</div></div></div>';
      }).join('') + '</div>'
  });
};

/* ★ 2026-10-07：盲注档位改由后台配置下发（后台 → 参数配置 → 盲注级别）。
   配置是字符串数组 ["1/2","2/4",...]，含义 = 小盲/大盲；没配置时回落到 BLINDS_FALLBACK。
   建房（modes.js 主流程 / 私人房）和大厅筛选三处共用这一份，杜绝各写一套硬编码。 */
var BLINDS_FALLBACK = ['1/2', '2/4', '5/10', '10/20', '25/50', '50/100', '100/200'];
function blindLevels() {
  var raw = null;
  try { raw = (S && S.admin && S.admin.lobby && S.admin.lobby.blinds) || null; } catch (e) { raw = null; }
  var arr = (Array.isArray(raw) && raw.length) ? raw : BLINDS_FALLBACK;
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var s = String(arr[i] == null ? '' : arr[i]).trim();
    if (!s) continue;
    var p = s.split('/');
    var sb = parseFloat(p[0]);
    var bb = p.length > 1 ? parseFloat(p[1]) : sb * 2;
    if (!isFinite(sb) || !isFinite(bb) || sb <= 0 || bb <= 0) continue;
    out.push({ sb: sb, bb: bb, label: sb + '/' + bb });
  }
  if (!out.length) {
    return BLINDS_FALLBACK.map(function (s) {
      var p = s.split('/');
      return { sb: parseFloat(p[0]), bb: parseFloat(p[1]), label: s };
    });
  }
  return out;
}

bindAct('filter', function () {
  openSheet({
    title: '筛选牌桌', body:
      '<div class="section-title" style="margin-top:0">盲注级别</div><div class="hscroll">' +
      ['全部'].concat(blindLevels().map(function (b) { return b.label; })).map(function (v, i) {
        return '<div class="tag' + (i === 0 ? ' gold' : '') + '" style="padding:6px 12px">' + v + '</div>';
      }).join('') + '</div>' +
      '<div class="section-title">桌型</div><div class="hscroll">' + ['2人桌', '6人桌', '9人桌', '极速桌'].map(function (v) { return '<div class="tag" style="padding:6px 12px">' + v + '</div>'; }).join('') + '</div>' +
      '<div class="section-title">其它</div>' +
      '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">仅显示有空位</div></div><div class="switch" id="f-seat"></div></div>' +
      '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">仅显示开启保险</div></div><div class="switch on"></div></div>' +
      '<div class="li" style="padding:10px 0;border:none"><div class="grow"><div class="li-title">隐藏满员牌桌</div></div><div class="switch on"></div></div>' +
      '<button class="btn gold block lg mt12" onclick="toast(\'筛选已应用\')">应用筛选</button>',
    onReady: function (root) {
      $('#f-seat', root).onclick = function () { this.classList.toggle('on'); LobbyFilter.onlySeat = this.classList.contains('on'); };
    }
  });
});
bindAct('refresh', function () {
  S.tables.forEach(function (t) { t.players = Math.max(0, Math.min(t.cap, t.players + rnd(-1, 1))); });
  /* ★ 刷新也要拉服务端：新邀请、好友入座、房间解散，都得跟着变 */
  refreshRoomInvites().then(navBadgeRefresh);
  syncServerRooms(function (ok) {
    toast(ok ? '牌桌已刷新' : '牌桌已刷新（未连上服务器）');
    if (Route.cur === 'lobby') go('lobby', {}, { noHist: true, anim: 'fade' });
  });
});
bindAct('bnr-go', function () { toast('活动页面演示'); });
bindAct('rule', function () { Screens.rule(); });








