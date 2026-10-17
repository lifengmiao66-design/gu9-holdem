/* ===== login.js · 登录 / 注册 / 找回密码 / 游客 / 验证码 ===== */
Screens.login = function () {
  var remembered = '';
  try { remembered = localStorage.getItem('poker_last_acc') || ''; } catch (e) { }
  return '' +
    '<div class="login-wrap">' +
    '<div class="login-bg"></div>' +
    '<div class="login-box">' +
    '<div class="logo">' +
    /* ★ 2026-10-03：主 Logo —— APP_LOGO 为空则用内置默认图；后台上传过就用后台那张 */
    '<div class="logo-mark"><img src="' + esc((APP_LOGO ? APP_LOGO + '?v=20261005n' : '') || 'assets/logo-full-light.png') + '" alt="' + esc(APP_NAME) + '" onerror="this.style.display=\'none\'"></div>' +
    '<div class="logo-t1">' + esc(APP_NAME) + ' · TEXAS HOLD\'EM</div>' +
    '<div class="logo-t2">德 州 扑 克</div>' +
    '</div>' +
    /* ★ 2026-10-03（用户要求）：短信验证码登录整个下掉，只留账号密码登录 */
    '<div id="lg-pane" style="margin-top:16px"></div>' +
    '<div class="third">' +
    '<div class="third-title">其他方式登录</div>' +
    '<div class="third-row">' +
    /* ★ 2026-10-03（用户要求）：第三方只留「游客」，微信 / Apple 下掉 */
    '<div class="t3 google" data-t3="guest">' + icon('smile', 22) + '<span>游客</span></div>' +
    '</div></div>' +
    '<div class="agree row" style="justify-content:center;margin-top:14px">' +
    '<div class="checkbox on" id="lg-agree">' + icon('check', 14) + '</div>' +
    /* ★ 以前这两个链接都指向「德州扑克规则」，玩家勾选同意看到的根本不是条款。现在各归各位。 */
    '<span class="tiny txt3">我已阅读并同意 <b class="gold" data-act="terms">《用户协议》</b> 与 <b class="gold" data-act="privacy">《隐私政策》</b></span>' +
    '</div>' +
    '<div class="row" style="justify-content:space-between;margin-top:14px">' +
    '<span class="tiny txt3" data-act="pick-server">服务器：亚洲一区 · 流畅</span>' +
    '<span class="tiny txt3">v3.8.2</span>' +
    '</div>' +
    '</div></div>';
};

Screens.login.after = function (p, root) {
  var pane = $('#lg-pane', root);
  /* ★ 2026-10-03（用户要求）：验证码登录下线，mode 恒为 'acc' */
  var mode = 'acc';
  function renderPane() {
    pane.innerHTML =
      '<div class="field"><div class="input-wrap">' + icon('user', 18) +
      '<input id="lg-acc" placeholder="请输入账号" value="' + esc(remAcc()) + '"></div></div>' +
      '<div class="field"><div class="input-wrap">' + icon('lock', 18) +
      '<input id="lg-pwd" type="password" placeholder="请输入密码">' +
      '<span class="clear" id="lg-eye">' + icon('eye', 18) + '</span></div></div>' +
      '<div class="row" style="justify-content:space-between;margin:2px 0 14px">' +
      '<label class="row tiny txt2 gap6" style="cursor:pointer"><div class="checkbox on" id="lg-rem">' + icon('check', 14) + '</div>记住账号</label>' +
      '<span class="tiny gold" id="lg-forgot">忘记密码？</span>' +
      '</div>' +
      '<button class="btn gold lg block" id="lg-go">登 录</button>' +
      '<div class="row" style="justify-content:center;margin-top:12px"><span class="tiny txt3">还没有账号？</span><span class="tiny gold b" id="lg-reg">立即注册</span></div>';
    $('#lg-eye', root).onclick = function () { var i = $('#lg-pwd', root); i.type = i.type === 'password' ? 'text' : 'password'; };
    $('#lg-go', root).onclick = doLogin;
  }
  function remAcc() { try { return localStorage.getItem('poker_last_acc') || ''; } catch (e) { return ''; } }

  function doLogin() {
    var acc = $('#lg-acc', root) ? $('#lg-acc', root).value.trim() : '';
    var pwd = $('#lg-pwd', root) ? $('#lg-pwd', root).value : '';
    if (!$('#lg-agree', root).classList.contains('on')) { toast('请先同意用户协议', 'err'); return; }
    if (!acc) { toast('请输入账号', 'err'); return; }
    if (pwd.length < 6) { toast('密码至少 6 位', 'err'); return; }
    try { localStorage.setItem('poker_last_acc', acc); } catch (e) { }
    var btn = $('#lg-go', root); if (btn) { btn.disabled = true; btn.textContent = '登录中…'; }
    apiLogin(acc, pwd).then(function (r) {
      if (r.code === 200) {
        toast('登录成功，欢迎回来', 'ok'); go('lobby');
      } else if (r.code === 403) {
        toast(r.j.msg || '账号已被封禁', 'err');
      } else if (r.code === 0) {
        /* 服务端不可达：降级为本机存档，不阻断体验 */
        toast('服务器不可用，已进入离线模式', 'err');
        S.logged = true; if (!S.user) initData(); S.user.name = S.user.name || acc; go('lobby');
      } else {
        toast(r.j.msg || ('登录失败（' + r.code + '）'), 'err');
        if (btn) { btn.disabled = false; btn.textContent = '登 录'; }
      }
    });
  }

  renderPane();
  $('#lg-agree', root).onclick = function () { this.classList.toggle('on'); };
  $$('.t3', root).forEach(function (b) {
    b.onclick = function () {
      confirmBox('游客登录', '游客数据保存在本机，卸载后可能丢失。', '进入游戏').then(function (ok) {
        if (ok) { if (!S.user) initData(); S.user.name = '游客' + rnd(1000, 9999); S.logged = true; go('lobby'); }
      });
    };
  });
  bindClick(pane, function (e) {
    if (e.target.closest('#lg-reg')) showRegister();
    if (e.target.closest('#lg-forgot')) showForgot();
  });

  function getRefFromURL() {
    var m = (location.search || '').match(/[?&]ref=([0-9]+)/);
    return m ? m[1] : '';
  }
  function showRegister() {
    var pref = getRefFromURL();
    openModal({
      title: '注册新账号', size: '', okText: '注册并登录',
      body: '<div class="field"><div class="lb">账号（4-16 位字母数字）</div><div class="input-wrap"><input id="rg-acc" placeholder="请输入账号"></div></div>' +
        '<div class="field"><div class="lb">昵称</div><div class="input-wrap"><input id="rg-nick" placeholder="给自己起个牌桌ID"></div></div>' +
        '<div class="field"><div class="lb">密码</div><div class="input-wrap"><input id="rg-pwd" type="password" placeholder="至少 6 位"></div></div>' +
        /* ★ 2026-10-03（用户要求）：「确认密码」换成「手机号码」，区号可选 中国 +86 / 美国 +1。
           手机号会随注册提交存到服务端（user.phone），找回账号、客服核实身份都用得上。 */
        '<div class="field"><div class="lb">手机号码</div><div class="input-wrap phone-row">' +
        '<select id="rg-cc" class="cc-sel"><option value="+86">中国 +86</option><option value="+1">美国 +1</option></select>' +
        '<input id="rg-phone" placeholder="请输入手机号"></div></div>' +
        /* ★ 2026-10-03：推荐人 ID 现在是真的了 —— 好友填你的 ID，你得 econ.inviteReward 余额（默认 10） */
        '<div class="field"><div class="lb">推荐人 ID（选填）</div><div class="input-wrap"><input id="rg-ref" placeholder="好友的 ID，可不填" value="' + esc(pref) + '"></div></div>',
      /* ★ 2026-10-03 多语言：选了美国区号 +1 就自动把界面切成英文（玩家没手动选过语言时才切） */
      onReady: function (r) {
        var sel = document.getElementById('rg-cc');
        if (!sel) return;
        sel.addEventListener('change', function () {
          if (window.I18N && sel.value === '+1' && !I18N.manual()) I18N.apply('en');
        });
      },
      onOk: function (r, close) {
        var a = $('#rg-acc', r).value.trim(), n = $('#rg-nick', r).value.trim(), p1 = $('#rg-pwd', r).value;
        var cc = $('#rg-cc', r).value, ph = ($('#rg-phone', r).value || '').replace(/\D/g, '');
        if (!/^[a-zA-Z0-9_]{4,16}$/.test(a)) { toast('账号格式不正确', 'err'); return false; }
        if (!n) { toast('请输入昵称', 'err'); return false; }
        if (p1.length < 6) { toast('密码至少 6 位', 'err'); return false; }
        /* 中国手机号 11 位（1 开头）；美国 10 位（区号 2-9 开头） */
        if (cc === '+86' && !/^1[3-9]\d{9}$/.test(ph)) { toast('请输入有效的 11 位中国手机号', 'err'); return false; }
        if (cc === '+1' && !/^[2-9]\d{9}$/.test(ph)) { toast('请输入有效的 10 位美国手机号', 'err'); return false; }
        var okBtn = $('.modal-foot .btn.gold', r);
        if (okBtn) { okBtn.disabled = true; okBtn.textContent = '注册中…'; }
        apiRegister(a, p1, n, $('#rg-ref', r).value.trim(), cc, ph).then(function (rr) {
          if (rr.code === 200) {
            /* ★ 2026-10-03：注册不送余额，改为引导先充值 */
            toast('注册成功，请先充值再上桌', 'ok', 2600);
            close(); go('lobby');
          } else if (rr.code === 0) {
            toast('服务器不可用，已用本机账号进入', 'err');
            if (!S.user) initData(); S.user.name = n; S.logged = true; close(); go('lobby');
          } else {
            toast(rr.j.msg || ('注册失败（' + rr.code + '）'), 'err');
            if (okBtn) { okBtn.disabled = false; okBtn.textContent = '注册并登录'; }
          }
        });
        return false;   /* 由上面的异步决定何时关闭 */
      }
    });
  }
  /* ★ 2026-10-03（用户要求）：短信验证整体下线 —— 以前这个「演示码 8888」的假找回
     根本改不了服务端密码，纯属误导。改为引导联系客服人工核实（注册手机号可用于核对身份）。 */
  function showForgot() {
    openModal({
      title: '找回密码', okText: '我知道了', cancelText: null,
      body: '<div class="tiny" style="line-height:1.9;color:var(--txt2)">' +
        '请提供以下信息联系在线客服人工找回：<br>' +
        '① 账号 / 昵称<br>② 注册时填写的手机号（含区号）<br>③ 大概的注册时间</div>'
    });
  }
  /* ★ 若从邀请链接进入（?ref=xxx），自动打开注册页并把推荐人 ID 填好 */
  if (getRefFromURL()) setTimeout(showRegister, 300);
};

/* 登录页样式注入 — light premium */
(function () {
  var css = document.createElement('style');
  css.textContent = '.login-wrap{position:relative;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}' +
    '.login-bg{position:absolute;inset:0;background:linear-gradient(165deg,#f7f9fc 0%,#eef2f7 45%,#e8edf4 100%)}' +
    '.login-bg::after{content:"";position:absolute;inset:0;background-image:radial-gradient(ellipse 80% 50% at 50% 0%,rgba(37,99,235,.06),transparent 60%)}' +
    '.login-box{position:relative;width:min(400px,92vw);margin:auto;max-height:calc(100dvh - 24px);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:28px 24px;background:#fff;' +
    'border:1px solid var(--line);border-radius:20px;box-shadow:0 16px 48px rgba(15,23,42,.08);animation:pop .3s}' +
    '.logo{text-align:center}' +
    '.logo-mark{margin:0 auto 16px;width:96px;height:96px;border-radius:22px;overflow:hidden;' +
    'display:flex;align-items:center;justify-content:center;background:#f8fafc;' +
    'border:1px solid var(--line);' +
    'box-shadow:0 4px 16px rgba(15,23,42,.06);' +
    'animation:logoIn .45s cubic-bezier(.2,1.2,.4,1)}' +
    '.logo-mark img{width:100%;height:100%;object-fit:contain;display:block;padding:8px}' +
    '@keyframes logoIn{from{opacity:0;transform:translateY(-10px) scale(.92)}to{opacity:1;transform:none}}' +
    '.logo-t1{margin-top:14px;font-size:12px;letter-spacing:3px;color:var(--txt3);font-weight:650;text-transform:uppercase}' +
    '.logo-t2{margin-top:4px;font-size:22px;font-weight:700;letter-spacing:-.3px;color:var(--txt)}' +
    '.third{margin-top:18px}.third-title{text-align:center;font-size:11.5px;color:var(--txt3);position:relative;margin-bottom:12px}' +
    '.third-title::before,.third-title::after{content:"";position:absolute;top:50%;width:28%;height:1px;background:var(--line)}' +
    '.third-title::before{left:0}.third-title::after{right:0}' +
    '.third-row{display:flex;justify-content:center;gap:18px}' +
    '.t3{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;color:var(--txt2);font-size:11.5px}' +
    '.t3 span{font-size:11px}.t3>svg{width:40px;height:40px;padding:9px;border-radius:50%;background:var(--panel2);border:1px solid var(--line)}' +
    '.t3.wechat>svg{color:#059669}.t3.apple>svg{color:#0f172a}.t3.google>svg{color:#c9891a}' +
    '.t3:active{transform:scale(.92)}' +
    '.input-wrap.phone-row{display:flex;align-items:center;gap:8px;padding:0 12px}' +
    '.cc-sel{background:transparent;border:none;outline:none;color:var(--txt);font-size:14px;' +
    'padding:12px 0;border-right:1px solid var(--line);padding-right:10px;appearance:none;-webkit-appearance:none;cursor:pointer}' +
    '.cc-sel option{background:#fff;color:var(--txt)}';
  document.head.appendChild(css);
})();






