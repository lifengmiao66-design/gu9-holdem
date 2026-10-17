/* ===== app.js · 启动 ===== */
(function () {
  /* PWA：捕获浏览器「添加到主屏幕」安装提示 */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    A2HS_PROMPT = e;
  });
  /* ★ 2026-10-04：注册最小 Service Worker —— Chrome 必须有 SW 才会让站点「可安装」，
     进而触发上面的 beforeinstallprompt，使「添加到主屏幕」按钮在 Android 上点一下就弹系统安装框。
     SW 不缓存任何资源（见 sw.js），不会造成版本不一致。 */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* 注册失败不影响正常使用 */ });
    });
  }

  function boot() {
    var restored = loadState();
    if (!restored || !S.user) initData();
    /* ★ 这里曾经有一行 `if (!S.friends || !S.friends.length) initData();`
       —— 好友现在是真的，新账号好友数本来就是 0，那行会让每次启动都整包重跑
       initData()，把刚恢复的存档整个冲掉。已删除。 */
    if (!S.history || !S.history.length) S.history = genHistory(14);
    if (!S.tables || !S.tables.length) initData();
    if (!S.admin) S.admin = defaultAdmin();
    applyAdmin();                       /* 本地默认配置 → 运行时全局 */

    /* 人声播报：以 localStorage('gu9_voice') 为准同步到设置项（用户上次的开关状态） */
    if (typeof SfxVoice !== 'undefined' && SfxVoice) {
      S.settings.voice = SfxVoice.isEnabled();
      SfxVoice.preload();
    }

    /* 服务端配置 + 会话恢复（离线时自动降级为本机存档，不阻断进入） */
    fetchServerConfig();
    var tk = apiTokenGet();
    var ready = tk ? apiMe() : Promise.resolve(null);
    ready.then(function (r) {
      if (tk && r && r.code === 401) { apiTokenSet(''); }      /* token 失效：清掉，按本机存档决定 */
      /* 好友列表随会话一起拉；顺手挂上「申请/邀请到达即提示」（切回前台立刻拉一次） */
      if (S.logged && S.user) { loadFriends(); startFriendPoll(); go('lobby'); }
      else go('login');
    });

    /* 世界频道模拟消息 */
    setInterval(function () {
      var u = mkUser(rnd(1, 30));
      var txt = pick(['这把运气太差了', '有没有大佬带带我', '50/100 缺人，来 3 个', '刚才那手打得漂亮', '广场赛开奖了，去看看',
        '求推荐紧凶打法', '连赢五把，收工', '有人一起打短牌吗', '这保险买得值', '新赛季冲榜！']);
      pushChat('world', u, txt);
      if (ChatTab === 'world') { /* 面板打开时可自动刷新，简化处理 */ }
    }, 22000);

    /* ESC 关闭最上层弹层 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var ms = document.querySelectorAll('#modal-root .mask');
        if (ms.length) { ms[ms.length - 1].remove(); return; }
        var ss = document.querySelectorAll('#sheet-root .sheet-mask');
        if (ss.length) { ss[ss.length - 1].remove(); return; }
        if (Route.cur !== 'login') back();
      }
    });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 0);
  else document.addEventListener('DOMContentLoaded', boot);
})();

