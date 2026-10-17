'use strict';
const fs = require('fs');
const path = require('path');
/* ★ 2026-10-02：USDT 链上收款（地址簿 + 入账监控 + 自动到账）。见 chain.js 顶部说明。 */
const chain = require('./chain.js');
/* ================================================================
   extra.js —— 2026-10-02 新增模块
   ------------------------------------------------------------
   玩家侧：转账赠送（真到帐）/ 邮件与全服公告 / 任务领奖（服务端发放）
           / 筹码流水 / 牌局记录 / 客服工单 / 举报 / 排行榜
           / 房主管理（踢人 · 转让 · 改密码 · 解散）/ 支付密码
   管理侧：概览看板 / 房间管理 / 用户详情增强 / 筹码流水账本 / 牌局记录
           / 客服工单 / 举报处理 / 邮件公告 / VIP与任务可视化配置
           / CSV 导出 / 手动备份 / AI 强度与透视（测试房）开关
   ------------------------------------------------------------
   ★ 设计口径与 server.js 保持一致：
     · 零第三方依赖，JSON 原子写；
     · 任何涉及筹码增减的地方都同时写 ledger（筹码流水账本）；
     · 管理接口一律校验 role==='admin'，玩家接口一律校验 role==='user'；
     · 真钱出口（兑换 USDT / 提现）不在这里 —— 那是 server.js 的 cashable 池，别动。
   ================================================================ */
let ctx = null;
const COLS = ['ledger', 'mails', 'hands', 'tickets', 'reports', 'botHands'];
let store = {};
const SMS = new Map();       /* phone -> {code, exp, until, n, day} —— 内存态，重启即失效 */

/* ---------------- 集合读写 ---------------- */
function init(c) {
  ctx = c;
  COLS.forEach(function (n) {
    const def = n === 'tickets' || n === 'reports' ? { seq: 1000, list: [] } : { list: [] };
    store[n] = ctx.readJson(n + '.json', null) || JSON.parse(JSON.stringify(def));
    if (!Array.isArray(store[n].list)) store[n].list = [];
    if (store[n].seq == null) store[n].seq = 1000;
  });
  /* 把 ORACLE / AI 档位塞进 CONFIG 默认，避免后台没保存过就拿不到值 */
  if (!ctx.config.oracle) ctx.config.oracle = { on: false, board: true, holes: true, useRate: 0.85, ally: false, note: '' };
  if (!ctx.config.ai) ctx.config.ai = {};
  if (ctx.config.ai.skill == null) ctx.config.ai.skill = 3;
  if (!ctx.config.house) ctx.config.house = { on: false, botWinRate: 0.30, strength: 0.85, capProfit: 2000000, capLoss: 1000000 };
  /* 大厅 Banner：空数组 = 前端用内置三条；后台上传过就走后台的 */
  if (!Array.isArray(ctx.config.banners)) ctx.config.banners = [];
  /* Banner 图片目录（nginx 已把 /assets/ 指到 /var/www/gu9-ui，上传完即可公网访问） */
  try { fs.mkdirSync(BANNER_DIR, { recursive: true }); } catch (e) { /* 目录已存在或只读 */ }
  /* 玩家头像目录 */
  try { fs.mkdirSync(AVATAR_DIR, { recursive: true }); } catch (e) { /* 目录已存在或只读 */ }
  /* ★ 2026-10-03：APP 主 Logo 目录（后台上传的主 Logo 放这里） */
  try { fs.mkdirSync(LOGO_DIR, { recursive: true }); } catch (e) { /* 目录已存在或只读 */ }
  if (!ctx.config.ranked) ctx.config.ranked = { on: true, bases: ['net', 'hands', 'vip'] };

  /* ★ 链上收款：把「写筹码流水」和「发站内信」两个钩子交给监控模块，
       命中入账后由它自动到账并记账，口径与后台人工发放完全一致。 */
  chain.init(ctx, {
    ledger: ledger,
    mail: function (uid, from, title, body, gift) { return addMail(uid, from, title, body, gift); }
  });
}
function save(name) { return ctx.writeJson(name + '.json', store[name]); }
function seq(name) { store[name].seq = (store[name].seq || 1000) + 1; return String(store[name].seq); }
function audAdmin(action, target, detail, ip) { return ctx.audit(ctx.ADMIN_USER || 'admin', action, target, detail, ip, 'admin'); }
/* Banner 图片存放目录（玩家端 nginx 静态根 /var/www/gu9-ui 下的 assets/banners/） */
const BANNER_DIR = '/var/www/gu9-ui/assets/banners';
const BANNER_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/* ★ 2026-10-03：APP 主 Logo 目录（后台「参数配置 → 品牌设置」上传，静态根下即可公网访问） */
const LOGO_DIR = '/var/www/gu9-ui/assets/brand';
/* ★ 2026-10-03：玩家头像目录（同样在静态根下，上传完即可公网访问） */
const AVATAR_DIR = '/var/www/gu9-ui/assets/avatars';
const AVATAR_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/* 删除该玩家上一次上传的头像文件（只删 av-<自己的id>- 开头的，绝不碰别人的 / 别的目录） */
function delOldAvatar(u) {
  const old = String((u && u.avatar) || '');
  const m = old.match(/^\/assets\/avatars\/(av-[\w-]+\.(?:png|jpe?g|webp))$/i);
  if (!m) return;
  if (m[1].indexOf('av-' + String(u.id) + '-') !== 0) return;   /* 不是自己的：不删 */
  try { fs.unlinkSync(AVATAR_DIR + '/' + m[1]); } catch (e) { /* 文件已不存在 */ }
}
function nowISO() { return new Date().toISOString().slice(0, 10); }
function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

/* ---------------- 通用小工具 ---------------- */
function num(v, d) { const n = Math.round(+v); return (isFinite(n) ? n : (d || 0)); }
function needUser(x, role) {
  const s = ctx.getSession(x.req);
  if (!s || (role && s.role !== role)) return null;
  return s;
}
/* ★ 统一写筹码：任何 BizEmployee 的筹码增减都必须走这里，账本才不会漏。
   NOTE: 这个函数只改 chips + 写流水，**不动 cashable** —— 只有真金入口才动那个池。 */
function ledger(uid, type, amount, tag, note) {
  const u = ctx.db.users[uid];
  if (!u) return null;
  amount = num(amount);
  const before = Math.max(0, Math.round(+u.bal || 0));
  u.bal = Math.max(0, before + amount);
  const row = {
    id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(), uid: String(uid), name: u.name, type: type, amount: amount,
    before: before, after: u.bal, tag: tag || '', note: note || ''
  };
  store.ledger.list.unshift(row);
  if (store.ledger.list.length > 20000) store.ledger.list.length = 20000;
  return row;
}
function addMail(to, from, title, body, gift) {
  const m = {
    id: 'M' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(), to: String(to || '*'), from: from || '系统',
    title: String(title || '').slice(0, 60), body: String(body || '').slice(0, 1000),
    gift: gift && (gift.chips || gift.diamonds) ? { chips: num(gift.chips), diamonds: num(gift.diamonds) } : null,
    read: {}, claimed: {}
  };
  store.mails.list.unshift(m);
  if (store.mails.list.length > 3000) store.mails.list.length = 3000;
  return m;
}
function mailPublic(m, uid) {
  const claimed = m.gift && m.claimed[String(uid)];
  return {
    id: m.id, ts: m.ts, from: m.from, title: m.title, body: m.body,
    gift: m.gift || null,
    read: !!(m.read && m.read[String(uid)]),
    claimed: !!claimed,
    global: m.to === '*'
  };
}
function myMails(uid) {
  return store.mails.list.filter(function (m) {
    return m.to === '*' || String(m.to) === String(uid);
  }).slice(0, 60);
}
function csv(rows) {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}
function send(res, obj) { return ctx.ok(res, obj); }
function fail(res, code, msg) { return ctx.err(res, code, msg); }
function roundU(v) { return Math.round((+v || 0) * 100) / 100; }   /* 顶层 USDT 取整（handle 内 U 是 URL 对象，不能当函数用） */

/* ================================================================
   主分发
   ================================================================ */
async function handle(x) {
  const p = x.p, res = x.res, req = x.req, ip = x.ip;
  const U = x.u || null;                 /* URL 对象：取查询参数用 */
  const Q = {};
  if (U && U.searchParams) U.searchParams.forEach(function (v, k) { Q[k] = v; });
  const B = x.body;                      /* 256KB 上限的 body（普通接口够用） */
  const BB = x.bodyBig || B;             /* 3MB 上限：只有 Banner 图片上传用 */

  /* ================ 玩家侧 ================ */
  const needP = function () {
    const s = ctx.getSession(req);
    if (!s || s.role !== 'user') { fail(res, 401, '未登录'); return null; }
    const u = ctx.db.users[s.uid];
    if (!u) { fail(res, 401, '账号不存在'); return null; }
    return { s: s, u: u };
  };

  /* ---- 修改登录密码（以前前端只是弹个 toast，密码根本没变） ---- */
  if (p === '/papi/auth/password' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const pwd = String(b.pwd || '');
    if (pwd.length < 6 || pwd.length > 32) return fail(res, 400, '密码需 6-32 位'), true;
    me.u.pwd = ctx.hashPw(pwd);
    await ctx.saveDB();
    ctx.audit(me.u.name, 'password', me.u.id, '修改登录密码', ip, 'user');
    return send(res, { ok: true }), true;
  }

  /* ---- 修改昵称（★ 以前只是弹个 toast 改本地变量，服务端名字根本没变，刷新就回去了） ---- */
  if (p === '/papi/me/rename' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const name = String((b && b.name) || '').trim();
    if (name.length < 2 || name.length > 16) return fail(res, 400, '昵称需 2-16 个字符'), true;
    /* 挡住尖括号 / 引号之类，昵称会出现在其他玩家的界面里（XSS 面） */
    if (/[<>&"'`\\/]/.test(name)) return fail(res, 400, '昵称不能包含特殊字符'), true;
    const mine = String(me.u.id);
    const dup = Object.keys(ctx.db.users).some(function (k) {
      const o = ctx.db.users[k];
      return o && String(k) !== mine && String(o.name || '') === name;
    });
    if (dup) return fail(res, 409, '该昵称已被占用'), true;
    const old = me.u.name;
    if (old === name) return send(res, { ok: true, name: name, user: ctx.publicUser(me.u) }), true;
    me.u.name = name;
    await ctx.saveDB();
    ctx.audit(name, 'rename', me.u.id, '昵称 ' + old + ' → ' + name, ip, 'user');
    return send(res, { ok: true, name: name, user: ctx.publicUser(me.u) }), true;
  }

  /* ---- 头像（2026-10-03）：上传自己的图片，或选系统预设 / 恢复默认 ----
     · body.avatar 是 `sys:N`（系统预设，前端按种子程序化画，不占磁盘）或 'reset'（恢复默认）；
     · body.name + body.data 是 base64 图片，存进静态目录，URL 写回 user.avatar；
     · 换新图时删掉自己上一张旧图，避免磁盘里堆满历史头像。 */
  if (p === '/papi/me/avatar' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await BB();
    /* ★ 只有显式传了 avatar 字段才走「系统预设 / 恢复默认」分支 ——
       否则上传图片的请求（没有 avatar 字段）会被误判成「清空头像」。 */
    if (b && typeof b.avatar === 'string') {
      const sel = String(b.avatar || '').trim();
      if (sel === '' || sel === 'reset') {
        delOldAvatar(me.u);
        me.u.avatar = '';
        await ctx.saveDB();
        return send(res, { ok: true, avatar: '', user: ctx.publicUser(me.u) }), true;
      }
      const m2 = sel.match(/^sys:(\d{1,2})$/);
      if (m2 && +m2[1] < 12) {          /* 系统预设目前只有 12 款（前端 sysAvatarCount） */
        delOldAvatar(me.u);
        me.u.avatar = sel;
        await ctx.saveDB();
        return send(res, { ok: true, avatar: sel, user: ctx.publicUser(me.u) }), true;
      }
      return fail(res, 400, '不支持的头像类型'), true;
    }
    const name = String((b && b.name) || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot) : '';
    if (!AVATAR_EXT[ext]) return fail(res, 400, '仅支持 PNG / JPG / WEBP 图片'), true;
    const data = String((b && b.data) || '');
    const m = data.match(/^data:image\/[a-z+]+;base64,(.+)$/s);
    if (!m) return fail(res, 400, '图片数据格式不对'), true;
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 300) return fail(res, 400, '图片太小或已损坏'), true;
    if (buf.length > 2 * 1024 * 1024) return fail(res, 400, '图片超过 2MB，请压缩后再传'), true;
    /* 魔数校验：扩展名可以造假，文件头不行 —— 别让人把 HTML / 脚本传上来当图片 */
    const head = buf.slice(0, 12);
    const isPng = head[0] === 0x89 && head[1] === 0x50;
    const isJpg = head[0] === 0xff && head[1] === 0xd8;
    const isWebp = head.slice(0, 4).toString('ascii') === 'RIFF' && head.slice(8, 12).toString('ascii') === 'WEBP';
    if (!(isPng || isJpg || isWebp)) return fail(res, 400, '文件不是有效的图片'), true;
    const fn = 'av-' + me.u.id + '-' + Date.now().toString(36) + ext;
    try { fs.writeFileSync(AVATAR_DIR + '/' + fn, buf); }
    catch (e) { return fail(res, 500, '写入失败：' + e.message), true; }
    delOldAvatar(me.u);
    me.u.avatar = '/assets/avatars/' + fn;
    await ctx.saveDB();
    ctx.audit(me.u.name, 'avatar', me.u.id, '更换头像 ' + fn + '（' + buf.length + ' bytes）', ip, 'user');
    return send(res, { ok: true, avatar: me.u.avatar, user: ctx.publicUser(me.u) }), true;
  }

  /* ---- 手机验证码登录 ----
     ★ 以前验证码登录完全不走服务端：任意 11 位手机号 + 万能码 8888 直接进大厅，
       而且 localStorage 里若留着别人的 token，就以那个身份继续玩。
       现在验证码由服务端生成并校验，登录成功后照常下发会话与用户资料。
     ★ 短信通道同样是留空的（返回 devCode 供本机自测；接通道时把 devCode 去掉、改走短信 API）。 */
  if (p === '/papi/auth/sms/send' && req.method === 'POST') {
    const b = await B();
    const phone = String(b.phone || '').replace(/\D/g, '');
    if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, 400, '请输入有效的 11 位手机号'), true;
    const now = Date.now();
    const rec = SMS.get(phone) || { n: 0, day: '' };
    if (rec.day !== nowISO()) { rec.n = 0; rec.day = nowISO(); }
    if (rec.n >= 10) return fail(res, 429, '今日验证码发送次数已达上限'), true;
    if (rec.until && rec.until > now) return fail(res, 429, '请 ' + Math.ceil((rec.until - now) / 1000) + ' 秒后再试'), true;
    const code = String(100000 + Math.floor(Math.random() * 900000));
    SMS.set(phone, { code: code, exp: now + 5 * 60 * 1000, until: now + 60 * 1000, n: rec.n + 1, day: rec.day });
    return send(res, { ok: true, exp: 300, devCode: code }), true;
  }
  if (p === '/papi/auth/sms/login' && req.method === 'POST') {
    const b = await B();
    const phone = String(b.phone || '').replace(/\D/g, '');
    const code = String(b.code || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return fail(res, 400, '请输入有效的 11 位手机号'), true;
    const rec = SMS.get(phone);
    if (!rec || !rec.code) return fail(res, 400, '请先获取验证码'), true;
    if (rec.exp < Date.now()) { SMS.delete(phone); return fail(res, 400, '验证码已过期，请重新获取'), true; }
    if (!ctx.safeEqual(code, rec.code)) return fail(res, 400, '验证码错误'), true;
    SMS.delete(phone);
    /* 未注册则自动开户（acc 用手机号） */
    let u = ctx.db.users && Object.keys(ctx.db.users).map(function (k) { return ctx.db.users[k]; })
      .filter(function (x) { return String(x.acc || '') === phone; })[0];
    let fresh = false;
    if (!u) { u = ctx.mkUser(phone, '玩家' + phone.slice(-4), ctx.newId ? ctx.newId() : Math.random().toString(36).slice(2, 12)); fresh = true; }
    if (u.banned) return fail(res, 403, '账号已被封禁，请联系客服'), true;
    u.lastLogin = Date.now(); u.lastIp = ip;
    await ctx.saveDB();
    const token = ctx.mkSession('user', u.id, ip, ctx.SESSION_TTL || 12 * 3600 * 1000);
    ctx.audit(u.name, fresh ? 'sms-register' : 'sms-login', u.id, '手机验证码登录', ip, 'user');
    return send(res, { token: token, user: ctx.publicUser(u), fresh: fresh }), true;
  }

  /* ---- 设置 / 修改支付密码 ---- */
  if (p === '/papi/paypwd/set' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const pwd = String(b.pwd || '');
    /* ★ 以前支付密码写死 123456（前端硬编码），谁都能过。现在落服务端个人字段。 */
    if (!/^\d{6}$/.test(pwd)) return fail(res, 400, '支付密码需为 6 位数字'), true;
    me.u.paypwd = ctx.hashPw(pwd);
    await ctx.saveDB();
    return send(res, { ok: true }), true;
  }

  /* ---- 转账 / 赠送 USDT（★ 以前是假的：只扣自己的，对方一分收不到） ---- */
  if (p === '/papi/wallet/transfer' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const toRaw = String(b.to || b.uid || b.acc || b.toAcc || '').trim();
    /* 2026-10-05 USDT 化：优先按 USDT（元）计价，内部 ×100 转分；兼容老参数 chips（分）。 */
    const amount = (b.usdt !== undefined && b.usdt !== null && isFinite(+b.usdt)) ? U(+b.usdt) : U(num(b.chips));
    /* QA4H: accept uid OR login acc (players often type account name) */
    let target = ctx.db.users[toRaw];
    if (!target) {
      const hit = Object.keys(ctx.db.users).find(function (k) {
        const u = ctx.db.users[k];
        return u && String(u.acc || '').toLowerCase() === toRaw.toLowerCase();
      });
      if (hit) target = ctx.db.users[hit];
    }
    if (!target) return fail(res, 404, '收款账号不存在'), true;
    const toId = String(target.id);
    if (String(target.id) === String(me.u.id)) return fail(res, 400, '不能转给自己'), true;
    if (!(amount > 0)) return fail(res, 400, '请输入转账金额'), true;
    if (target.banned) return fail(res, 400, '对方账号已被封禁'), true;
    /* 好友关系闸门：只能转给好友，避免变成匿名洗钱通道 */
    var friendIds = Array.isArray(me.u.friends) ? me.u.friends.map(String) : [];
    if (friendIds.indexOf(toId) < 0) {
      return fail(res, 403, '只能向好友转账（先加为好友）'), true;
    }
    if (amount > U(+me.u.bal || 0)) return fail(res, 400, 'USDT 余额不足'), true;
    const DAY = 20000, PER = 10000;   /* ★ 2026-10-06：单日 2 万 / 单笔 1 万 USDT（原为分，已换算） */
    function U(v) { return Math.round((+v || 0) * 100) / 100; }
    /* ★ 支付密码：设置过就必须校验，杜绝「人人 123456」的万能口令 */
    if (me.u.paypwd && !ctx.verifyPw(String(b.pwd || ''), me.u.paypwd)) {
      return fail(res, 400, '支付密码错误'), true;
    }
    /* 单笔 / 单日限额（转账口子收紧，防止成为提现替代通道） */
    if (amount > PER) return fail(res, 400, '单笔最多 ' + PER + ' USDT'), true;
    let daySum = 0, since = dayStart(Date.now());
    store.ledger.list.forEach(function (r) {
      if (r.uid === me.u.id && r.type === 'transfer-out' && r.ts >= since) daySum += Math.abs(r.amount);
    });
    if (daySum + amount > DAY) return fail(res, 400, '今日转账已达上限 ' + DAY + ' USDT'), true;
    /* ★ 双写：扣自己的 + 加对方的，两边都有流水记录，任一环节失败都不会单边记账 */
    ledger(me.u.id, 'transfer-out', -amount, '转账给 ' + target.name, String(b.note || '').slice(0, 60));
    ledger(target.id, 'transfer-in', amount, '来自 ' + me.u.name + ' 的转账', String(b.note || '').slice(0, 60));
    addMail(target.id, me.u.name, '收到转账 ' + amount.toFixed(2) + ' USDT',
      (me.u.name || '好友') + ' 向你转账 ' + amount.toFixed(2) + ' USDT' + (b.note ? '\n留言：' + String(b.note).slice(0, 60) : ''));
    await ctx.saveDB(); await save('ledger'); await save('mails');
    ctx.audit(me.u.name, 'transfer', target.id, '向 ' + target.name + ' 转账 ' + amount.toFixed(2) + ' USDT', ip, 'user');
    return send(res, { ok: true, chips: me.u.bal, usdt: me.u.bal, user: ctx.publicUser(me.u) }), true;
  }

  /* ---- 我的筹码流水 ---- */
  if (p === '/papi/ledger' && req.method === 'GET') {
    const me = needP(); if (!me) return true;
    const list = store.ledger.list.filter(function (r) { return String(r.uid) === String(me.u.id); }).slice(0, 100);
    return send(res, { list: list }), true;
  }

  /* ---- 邮件 / 公告 ---- */
  if (p === '/papi/mails' && req.method === 'GET') {
    const me = needP(); if (!me) return true;
    return send(res, { list: myMails(me.u.id).map(function (m) { return mailPublic(m, me.u.id); }) }), true;
  }
  if (p === '/papi/mails/read' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const m = myMails(me.u.id).filter(function (x) { return x.id === String(b.id); })[0];
    if (!m) return fail(res, 404, '邮件不存在'), true;
    m.read[String(me.u.id)] = 1;
    await save('mails');
    return send(res, { ok: true }), true;
  }
  if (p === '/papi/mails/claim' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const m = myMails(me.u.id).filter(function (x) { return x.id === String(b.id); })[0];
    if (!m) return fail(res, 404, '邮件不存在'), true;
    if (!m.gift) return fail(res, 400, '这封邮件没有附件'), true;
    if (m.claimed[String(me.u.id)]) return fail(res, 400, '已领取过'), true;
    if (m.gift.chips) ledger(me.u.id, 'mail-gift', Math.max(0, Math.round(+m.gift.chips || 0)), '邮件附件（USDT）', m.title);
    if (m.gift.diamonds) me.u.diamonds = Math.max(0, num(me.u.diamonds) + m.gift.diamonds);
    m.claimed[String(me.u.id)] = 1;
    await ctx.saveDB(); await save('mails');
    return send(res, { ok: true, got: m.gift, user: ctx.publicUser(me.u) }), true;
  }

  /* ---- 任务领奖（★ 以前本地加钱 + sync 信任客户端 = 零成本刷筹码） ---- */
  if (p === '/papi/tasks/claim' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const tid = String(b.id || '').trim();
    const cfg = (ctx.config.tasks && ctx.config.tasks.rewards) || {};
    const reward = num(cfg[tid], 0);
    /* ★ 2026-10-03：任务奖励表已清空（只保留每日签到），任何任务领奖一律拒绝 */
    if (!(reward > 0)) return fail(res, 400, '任务已下线，仅保留每日签到'), true;
    if (!me.u.tasks) me.u.tasks = {};
    const todaystr = nowISO();
    if (me.u.tasks[tid] === todaystr) return fail(res, 400, '今天已经领过啦'), true;
    if (String(tid) === '1' || String(tid) === '2') {          /* 每日任务：一天一次 */
      if (me.u.tasks[tid] && me.u.tasks[tid].slice(0, 10) === todaystr) return fail(res, 400, '今天已经领过啦'), true;
    }
    ledger(me.u.id, 'task', reward, '任务奖励 #' + tid, '');
    me.u.tasks[tid] = todaystr;
    await ctx.saveDB(); await save('ledger');
    ctx.audit(me.u.name, 'task-claim', me.u.id, '任务 #' + tid + ' 奖励 ' + reward, ip, 'user');
    return send(res, { ok: true, reward: reward, user: ctx.publicUser(me.u) }), true;
  }
  /* ---- 每日签到（同样服务端发放，7 日循环） ---- */
  if (p === '/papi/signin' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    /* ★ 2026-10-03：签到档位默认「第 N 天送 N 筹码」（1…7），以服务端 CONFIG.tasks.signin 为准 */
    const cfg = (ctx.config.tasks && Array.isArray(ctx.config.tasks.signin) && ctx.config.tasks.signin.length)
      ? ctx.config.tasks.signin : [1, 2, 3, 4, 5, 6, 7];
    const st = me.u.signin || { day: 0, last: 0 };
    const t0 = dayStart(Date.now());
    if (st.last === t0) return fail(res, 400, '今天已经签到过了'), true;
    const cont = st.last && (t0 - dayStart(st.last) === 86400000) ? (st.day || 0) : 0;
    const day = Math.min(cfg.length - 1, cont);
    const reward = num(cfg[day], cfg[0]);
    ledger(me.u.id, 'signin', reward, '签到第 ' + (day + 1) + ' 天', '');
    me.u.signin = { day: cont + 1, last: t0 };
    await ctx.saveDB(); await save('ledger');
    return send(res, { ok: true, reward: reward, day: day + 1, total: cfg.length, user: ctx.publicUser(me.u) }), true;
  }

  /* ---- 排行榜 ---- */
  if (p === '/papi/rank' && req.method === 'GET') {
    const me = needP(); if (!me) return true;
    const by = String(x.u.searchParams.get('by') || 'net');
    const users = Object.keys(ctx.db.users).map(function (k) { return ctx.db.users[k]; })
      .filter(function (u) { return u && !u.banned; });
    users.sort(function (a, b) {
      if (by === 'hands') return ((b.stat && b.stat.hands) || 0) - ((a.stat && a.stat.hands) || 0);
      if (by === 'vip') return (b.vip || 0) - (a.vip || 0);
      return ((b.stat && b.stat.net) || 0) - ((a.stat && a.stat.net) || 0);
    });
    const list = users.slice(0, 50).map(function (u, i) {
      return {
        no: i + 1, id: u.id, name: u.name, color: u.color, vip: u.vip, level: u.level,
        net: (u.stat && u.stat.net) || 0, hands: (u.stat && u.stat.hands) || 0,
        chips: String(u.id) === String(me.u.id) ? Math.max(0, Math.round(+u.bal || 0)) : 0, me: String(u.id) === String(me.u.id)
      };
    });
    /* 自己的名次（不给别人的筹码） */
    let mine = 0;
    for (let i = 0; i < users.length; i++) if (String(users[i].id) === String(me.u.id)) mine = i + 1;
    return send(res, { list: list, mine: mine }), true;
  }

  /* ---- 牌局记录上报（查作弊 / 算抽水的基础数据） ---- */
  if (p === '/papi/hands/report' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const row = {
      id: 'H' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(), uid: me.u.id, name: me.u.name,
      table: String(b.table || '').slice(0, 40), handNo: String(b.handNo || '').slice(0, 20),
      mode: String(b.mode || 'nlh').slice(0, 12), pot: num(b.pot), rake: num(b.rake),
      rebate: num(b.rebate), board: Array.isArray(b.board) ? b.board.slice(0, 5).map(String) : [],
      hole: Array.isArray(b.hole) ? b.hole.slice(0, 6).map(String) : [],
      seat: num(b.seat, 0), won: num(b.won, 0), contrib: num(b.contrib, 0),
      result: String(b.result || '').slice(0, 60), roomNo: String(b.roomNo || '').slice(0, 10)
    };
    store.hands.list.unshift(row);
    if (store.hands.list.length > 20000) store.hands.list.length = 20000;
    /* 顺手把累计统计补上（后台看板要用） */
    const st = me.u.stat || (me.u.stat = { hands: 0, net: 0, win: 0 });
    st.hands = num(st.hands) + 1;
    st.net = num(st.net) + (row.won - row.contrib);
    if (row.won > 0) st.win = num(st.win) + 1;
    await save('hands'); await ctx.saveDB();
    return send(res, { ok: true }), true;
  }
  /* ---- ★ 2026-10-04：机器人本手收支上报（后台「机器人收支」看板的原始数据） ----
     前端在每手结算时，把「非真人、非房主好友」的机器人座位汇总：投入 / 赢得 / 净赢 / 抽水。
     只在公共牌桌（有机器人）时上报；私人房没有机器人，不上报。 */
  if (p === '/papi/hands/botreport' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const botWon = num(b.botWon), botContrib = num(b.botContrib);
    const row = {
      id: 'B' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      table: String(b.table || '').slice(0, 40), handNo: String(b.handNo || '').slice(0, 20),
      mode: String(b.mode || 'nlh').slice(0, 12),
      pot: num(b.pot), rake: num(b.rake),
      botWon: botWon, botContrib: botContrib, botNet: botWon - botContrib,
      botSeats: Math.max(0, Math.round(+b.botSeats || 0))
    };
    store.botHands.list.unshift(row);
    if (store.botHands.list.length > 20000) store.botHands.list.length = 20000;
    await save('botHands');
    return send(res, { ok: true }), true;
  }
  if (p === '/papi/hands/mine' && req.method === 'GET') {
    const me = needP(); if (!me) return true;
    const lim = Math.min(120, Math.max(1, parseInt(Q.limit || '60', 10) || 60));
    const list = store.hands.list.filter(function (h) { return String(h.uid) === String(me.u.id); }).slice(0, lim).map(function (h) {
      /* 列表摘要：老数据缺字段时补默认，不改落盘 */
      const delta = (h.delta != null) ? num(h.delta) : (num(h.won) - num(h.contrib));
      return {
        id: h.id, handId: h.handId || h.id, ts: h.ts, roomNo: h.roomNo || '', table: h.table || '',
        handNo: h.handNo || '', mode: h.mode || 'nlh', sb: h.sb, bb: h.bb,
        pot: num(h.pot), rake: num(h.rake), won: num(h.won), contrib: num(h.contrib),
        delta: delta, result: h.result || '', seat: h.seat, pos: h.pos || '',
        hole: Array.isArray(h.hole) ? h.hole : [], board: Array.isArray(h.board) ? h.board : [],
        folded: !!h.folded, handName: h.handName || '', strength: h.strength || '',
        winners: Array.isArray(h.winners) ? h.winners : [],
        actSummary: h.actSummary || '',
        hasDetail: !!(h.actions && h.actions.length) || !!(h.board && h.board.length)
      };
    });
    return send(res, { list: list, total: list.length }), true;
  }
  /* 单手详情 / 逐手回放（仅本人；不含他人底牌透视） */
  if (p === '/papi/hands/get' && req.method === 'GET') {
    const me = needP(); if (!me) return true;
    const id = String(Q.id || Q.handId || '').slice(0, 40);
    if (!id) return fail(res, 400, '缺少 id'), true;
    const h = store.hands.list.filter(function (x) {
      return String(x.uid) === String(me.u.id) && (String(x.id) === id || String(x.handId) === id);
    })[0];
    if (!h) return fail(res, 404, '手牌不存在'), true;
    const delta = (h.delta != null) ? num(h.delta) : (num(h.won) - num(h.contrib));
    return send(res, {
      hand: {
        id: h.id, handId: h.handId || h.id, ts: h.ts, uid: h.uid, name: h.name,
        roomNo: h.roomNo || '', table: h.table || '', handNo: h.handNo || '',
        mode: h.mode || 'nlh', sb: h.sb, bb: h.bb,
        pot: num(h.pot), rake: num(h.rake), won: num(h.won), contrib: num(h.contrib),
        delta: delta, result: h.result || '', seat: h.seat, pos: h.pos || '',
        hole: Array.isArray(h.hole) ? h.hole : [], holeDisp: h.holeDisp || h.hole || [],
        board: Array.isArray(h.board) ? h.board : [], boardDisp: h.boardDisp || h.board || [],
        folded: !!h.folded, handName: h.handName || '', strength: h.strength || '',
        winners: Array.isArray(h.winners) ? h.winners : [],
        winnerDetail: Array.isArray(h.winnerDetail) ? h.winnerDetail : [],
        actions: Array.isArray(h.actions) ? h.actions : [],
        actSummary: h.actSummary || ''
      }
    }), true;
  }

  /* ---- 客服工单 ---- */
  if (p === '/papi/tickets/create' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const t = {
      id: seq('tickets'), ts: Date.now(), uid: me.u.id, name: me.u.name,
      type: String(b.type || '问题反馈').slice(0, 20),
      title: String(b.title || '').slice(0, 60) || '未命名工单',
      text: String(b.text || '').slice(0, 1000), status: 'open', replies: []
    };
    if (!t.text) return fail(res, 400, '请填写问题描述'), true;
    store.tickets.list.unshift(t);
    await save('tickets');
    return send(res, { ticket: t }), true;
  }
  if (p === '/papi/tickets/mine' && req.method === 'GET') {
    const me = needP(); if (!me) return true;
    const list = store.tickets.list.filter(function (t) { return String(t.uid) === String(me.u.id); }).slice(0, 30);
    return send(res, { list: list }), true;
  }
  if (p === '/papi/tickets/reply' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const t = store.tickets.list.filter(function (y) { return y.id === String(b.id) && String(y.uid) === String(me.u.id); })[0];
    if (!t) return fail(res, 404, '工单不存在'), true;
    t.replies.push({ ts: Date.now(), by: me.u.name, role: 'user', text: String(b.text || '').slice(0, 500) });
    await save('tickets');
    return send(res, { ticket: t }), true;
  }

  /* ---- 举报 ---- */
  if (p === '/papi/reports/create' && req.method === 'POST') {
    const me = needP(); if (!me) return true;
    const b = await B();
    const target = ctx.db.users[String(b.uid || '')];
    const r = {
      id: seq('reports'), ts: Date.now(), by: me.u.id, byName: me.u.name,
      targetId: String(b.uid || ''), targetName: (target && target.name) || String(b.name || '未知'),
      reason: String(b.reason || '').slice(0, 40), detail: String(b.detail || '').slice(0, 400),
      handId: String(b.handId || '').slice(0, 30), roomNo: String(b.roomNo || '').slice(0, 10),
      status: 'open', note: ''
    };
    if (!r.reason) return fail(res, 400, '请选择举报原因'), true;
    store.reports.list.unshift(r);
    await save('reports');
    return send(res, { ok: true }), true;
  }

  /* ============ 房间：房主管理（踢人 / 转让 / 改密码 / 解散） ============ */
  const roomAuth = function (no, opts) {
    const me = needP(); if (!me) return null;
    let r = null;
    for (const k in ctx.rooms.rooms) { const y = ctx.rooms.rooms[k]; if (y && String(y.no) === String(no)) { r = y; break; } }
    if (!r) { fail(res, 404, '房间不存在'); return null; }
    const isOwner = String(r.owner) === String(me.u.id);
    if (opts && opts.ownerOnly && !isOwner) { fail(res, 403, '只有房主可以做这个操作'); return null; }
    if (!isOwner && !(r.seats || []).some(function (s) { return String(s.uid) === String(me.u.id); })) {
      fail(res, 403, '你不在这个房间里'); return null;
    }
    return { me: me, room: r, isOwner: isOwner };
  };
  if (p === '/papi/rooms/kick' && req.method === 'POST') {
    const b = await B();
    const a = roomAuth(String(b.no || ''), { ownerOnly: true }); if (!a) return true;
    const uid = String(b.uid || '');
    if (String(uid) === String(a.room.owner)) return fail(res, 400, '不能踢自己'), true;
    const before = (a.room.seats || []).length;
    a.room.seats = (a.room.seats || []).filter(function (s) { return String(s.uid) !== uid; });
    a.room.invites = (a.room.invites || []).filter(function (s) { return String(s.uid) !== uid; });
    a.room.actAt = Date.now();
    await ctx.saveRooms();
    const nm = (ctx.db.users[uid] && ctx.db.users[uid].name) || '该玩家';
    ctx.audit(a.me.u.name, 'room-kick', String(b.no), '把 ' + nm + ' 移出房间', ip, 'user');
    return send(res, { room: ctx.roomPublic(a.room, a.me.u.id), kicked: before !== (a.room.seats || []).length }), true;
  }
  if (p === '/papi/rooms/owner' && req.method === 'POST') {
    const b = await B();
    const a = roomAuth(String(b.no || ''), { ownerOnly: true }); if (!a) return true;
    const uid = String(b.uid || '');
    const seat = (a.room.seats || []).filter(function (s) { return String(s.uid) === uid; })[0];
    if (!seat) return fail(res, 400, '对方不在这个房间里'), true;
    a.room.owner = uid; a.room.actAt = Date.now();
    await ctx.saveRooms();
    ctx.audit(a.me.u.name, 'room-owner', String(b.no), '房主转让给 ' + ((ctx.db.users[uid] && ctx.db.users[uid].name) || uid), ip, 'user');
    return send(res, { room: ctx.roomPublic(a.room, a.me.u.id) }), true;
  }
  if (p === '/papi/rooms/settings' && req.method === 'POST') {
    const b = await B();
    const a = roomAuth(String(b.no || ''), { ownerOnly: true }); if (!a) return true;
    if (b.name != null) a.room.name = String(b.name).trim().slice(0, 20) || a.room.name;
    if (b.passwd != null) a.room.passwd = String(b.passwd).slice(0, 12);
    if (b.priv != null) a.room.priv = (String(b.priv) === 'private' || b.priv === true || b.priv === 1) ? 'private' : 'public';
    if (b.sb != null) { const sb = roundU(Math.max(0.01, Math.min(100000, num(b.sb, a.room.sb)))); a.room.sb = sb; a.room.bb = roundU(sb * 2); }
    a.room.actAt = Date.now();
    await ctx.saveRooms();
    ctx.audit(a.me.u.name, 'room-settings', String(b.no), '房主修改房间设置', ip, 'user');
    return send(res, { room: ctx.roomPublic(a.room, a.me.u.id) }), true;
  }
  if (p === '/papi/rooms/members' && req.method === 'GET') {
    const a = roomAuth(String(x.u.searchParams.get('no') || ''), { ownerOnly: false }); if (!a) return true;
    return send(res, { room: ctx.roomPublic(a.room, a.me.u.id) }), true;
  }

  /* ================ 管理侧 ================ */
  if (p.indexOf('/papi/admin/extra/') !== 0) return false;
  const s = ctx.getSession(req);
  if (!s || s.role !== 'admin') { fail(res, 401, '未登录或会话已过期'); return true; }
  const adminName = ctx.ADMIN_USER || 'admin';

  /* ================= 链上收款：收款地址簿 + 监控 ================= */
  if (p === '/papi/admin/extra/addr' && req.method === 'GET') {
    return send(res, { list: chain.addrList(), chain: chain.cfgGet() }), true;
  }
  if (p === '/papi/admin/extra/addr/add' && req.method === 'POST') {
    const b = await B();
    const r = chain.addrAdd(b);
    if (!r.ok) return fail(res, 400, r.msg), true;
    audAdmin('admin-addr-add', r.addr.id, '新增 ' + r.addr.net + ' 收款地址 ' + r.addr.address.slice(0, 12) + '… · ' + r.addr.label, ip);
    await ctx.saveConfig();
    return send(res, { ok: true, addr: r.addr, list: chain.addrList() }), true;
  }
  if (p === '/papi/admin/extra/addr/update' && req.method === 'POST') {
    const b = await B();
    const r = chain.addrUpdate(b);
    if (!r.ok) return fail(res, 400, r.msg), true;
    audAdmin('admin-addr-update', String(b.id), '修改收款地址 · 启用=' + (r.addr.enabled !== false) + ' · ' + r.addr.label, ip);
    return send(res, { ok: true, addr: r.addr, list: chain.addrList() }), true;
  }
  if (p === '/papi/admin/extra/addr/del' && req.method === 'POST') {
    const b = await B();
    const r = chain.addrDel(b);
    if (!r.ok) return fail(res, 400, r.msg), true;
    audAdmin('admin-addr-del', String(b.id), '删除收款地址', ip);
    return send(res, { ok: true, list: chain.addrList() }), true;
  }
  if (p === '/papi/admin/extra/chain' && req.method === 'GET') {
    return send(res, chain.cfgGet()), true;
  }
  if (p === '/papi/admin/extra/chain' && req.method === 'POST') {
    const b = await B();
    const before = chain.cfgGet().cfg;
    const r = chain.cfgSet(b);
    const g = r.cfg;
    audAdmin('admin-chain-cfg', '', '链上监控配置：开关=' + (g.on ? '开' : '关') +
      ' 自动到账=' + (g.autoCredit ? '开' : '关') + ' 轮询=' + g.pollMs + 'ms 确认数=' + (g.minConf || '按各链默认') +
      ' 容差=' + g.tolerance + ' 订单窗口=' + g.windowMin + '分' +
      (before.on !== g.on ? ' ★开关由 ' + (before.on ? '开' : '关') + ' 改为 ' + (g.on ? '开' : '关') : ''), ip);
    return send(res, r), true;
  }
  if (p === '/papi/admin/extra/chain/scan' && req.method === 'POST') {
    const r = await chain.scanOnce(true);
    audAdmin('admin-chain-scan', '', '手动扫描一次：新入账 ' + r.scanned + ' 笔 · 自动到账 ' + r.matched + ' 笔' + (r.err ? ' · 错误：' + r.err : ''), ip);
    return send(res, r), true;
  }
  if (p === '/papi/admin/extra/deposits' && req.method === 'GET') {
    return send(res, { list: chain.depList({ limit: Q.limit, only: Q.only }), chain: chain.cfgGet() }), true;
  }
  if (p === '/papi/admin/extra/deposits/claim' && req.method === 'POST') {
    const b = await B();
    const r = chain.claim(b);
    if (!r.ok) return fail(res, 400, r.msg), true;
    await ctx.saveOrders(); await ctx.saveDB();
    audAdmin('admin-deposit-claim', String(b.orderId), '手动补单：入账 ' + String(b.depId) + ' → 订单 ' + String(b.orderId) + ' · 到账筹码 ' + r.chips, ip);
    return send(res, r), true;
  }

  /* ---- 概览看板 ---- */
  if (p === '/papi/admin/extra/overview') {
    const users = Object.keys(ctx.db.users).map(function (k) { return ctx.db.users[k]; });
    const t0 = dayStart(Date.now()), t7 = t0 - 6 * 86400000, t30 = t0 - 29 * 86400000;
    const newToday = users.filter(function (u) { return (u.createdAt || 0) >= t0; }).length;
    const actToday = users.filter(function (u) { return (u.lastLogin || 0) >= t0; }).length;
    /* 留存：注册于第 N 天前、且在今天仍有登录的占该批注册的比例 */
    const cohort = function (daysAgo) {
      const from = t0 - daysAgo * 86400000, to = from + 86400000;
      const born = users.filter(function (u) { return (u.createdAt || 0) >= from && (u.createdAt || 0) < to; });
      if (!born.length) return { size: 0, back: 0, rate: 0 };
      const back = born.filter(function (u) { return (u.lastLogin || 0) >= t0; }).length;
      return { size: born.length, back: back, rate: Math.round(back / born.length * 100) };
    };
    const handsToday = store.hands.list.filter(function (h) { return h.ts >= t0; });
    const rakeToday = handsToday.reduce(function (a, h) { return a + (h.rake || 0); }, 0);
    const rake7 = store.hands.list.filter(function (h) { return h.ts >= t7; }).reduce(function (a, h) { return a + (h.rake || 0); }, 0);
    const depositDone = ctx.orders.list.filter(function (o) { return o.type === 'recharge' && o.status === 'completed'; });
    const withdrawDone = ctx.orders.list.filter(function (o) { return o.type === 'withdraw' && o.status === 'completed'; });
    /* 近 14 日趋势：每日手数 / 抽水 / 新增 */
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const a = t0 - i * 86400000, b = a + 86400000;
      const hs = store.hands.list.filter(function (h) { return h.ts >= a && h.ts < b; });
      trend.push({
        day: new Date(a).toISOString().slice(5, 10),
        hands: hs.length,
        rake: hs.reduce(function (x, h) { return x + (h.rake || 0); }, 0),
        users: users.filter(function (u) { return (u.createdAt || 0) >= a && (u.createdAt || 0) < b; }).length,
        active: users.filter(function (u) { return (u.lastLogin || 0) >= a && (u.lastLogin || 0) < b; }).length
      });
    }
    const chipsTotal = users.reduce(function (a, u) { return a + roundU(+u.bal || 0); }, 0);
    const cashableTotal = users.reduce(function (a, u) { return a + Math.max(0, Math.round(+u.cashable || 0)); }, 0);
    const rooms = Object.keys(ctx.rooms.rooms).map(function (k) { return ctx.rooms.rooms[k]; });
    return send(res, {
      stat: {
        users: users.length, newToday: newToday, activeToday: actToday, new7: users.filter(function (u) { return (u.createdAt || 0) >= t7; }).length,
        new30: users.filter(function (u) { return (u.createdAt || 0) >= t30; }).length,
        banned: users.filter(function (u) { return u.banned; }).length,
        hands: store.hands.list.length, handsToday: handsToday.length,
        rakeToday: rakeToday, rake7: rake7,
        chipsTotal: chipsTotal, cashableTotal: cashableTotal,
        usdtPending: Math.round(ctx.orders.list.filter(function (o) { return o.type === 'withdraw' && (o.status === 'pending' || o.status === 'approved'); }).reduce(function (a, o) { return a + (+o.usdt || 0); }, 0) * 100) / 100,
        rooms: rooms.length, roomsActive: rooms.filter(function (r) { return (r.actAt || 0) >= Date.now() - 30 * 60 * 1000; }).length,
        ticketsOpen: store.tickets.list.filter(function (t) { return t.status === 'open'; }).length,
        reportsOpen: store.reports.list.filter(function (t) { return t.status === 'open'; }).length,
        depositUsdt: Math.round(depositDone.reduce(function (a, o) { return a + (+o.usdt || 0); }, 0) * 100) / 100,
        withdrawUsdt: Math.round(withdrawDone.reduce(function (a, o) { return a + (+o.usdt || 0); }, 0) * 100) / 100,
        riskUsers: users.filter(function (u) { return (+u.riskFlag || 0) > 0; }).length
      },
      retention: { d1: cohort(1), d7: cohort(7), d30: cohort(30) },
      trend: trend
    }), true;
  }

  /* ---- ★ 2026-10-04：机器人收支看板（累计赢/输/净、每日抽水、平台盈亏、近手明细） ---- */
  if (p === '/papi/admin/extra/botstats' && req.method === 'GET') {
    const days = Math.min(90, Math.max(1, +(x.u.searchParams.get('days')) || 30));
    const now = Date.now();
    const t0 = dayStart(now);
    const bot = store.botHands.list;
    const handsAll = store.hands.list;
    /* 累计 */
    let botWonAll = 0, botNetAll = 0, botSeatsAll = 0;
    bot.forEach(function (r) { botWonAll += (r.botWon || 0); botNetAll += (r.botNet || 0); botSeatsAll += (r.botSeats || 0); });
    const botLossAll = bot.reduce(function (a, r) { return a + ((r.botContrib || 0) - (r.botWon || 0)); }, 0);
    const rakeAll = handsAll.reduce(function (a, h) { return a + (h.rake || 0); }, 0);
    const handsCount = handsAll.length, botHandsCount = bot.length;
    const platformNetAll = rakeAll + botNetAll;   /* 抽水（平台收入）+ 机器人净赢 = 平台从机器人相关业务净赚 */
    /* 每日（近 days 天） */
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const a = t0 - i * 86400000, b2 = a + 86400000;
      const bd = bot.filter(function (r) { return r.ts >= a && r.ts < b2; });
      const hd = handsAll.filter(function (h) { return h.ts >= a && h.ts < b2; });
      const bw = bd.reduce(function (s, r) { return s + (r.botWon || 0); }, 0);
      const bn = bd.reduce(function (s, r) { return s + (r.botNet || 0); }, 0);
      const bl = bd.reduce(function (s, r) { return s + ((r.botContrib || 0) - (r.botWon || 0)); }, 0);
      const rk = hd.reduce(function (s, h) { return s + (h.rake || 0); }, 0);
      daily.push({
        day: new Date(a).toISOString().slice(5, 10),
        hands: hd.length, botHands: bd.length, rake: rk,
        botWon: bw, botLoss: bl, botNet: bn, platformNet: rk + bn
      });
    }
    /* 近手明细（最新 60 条，每行带「平台净 = 抽水 + 机器人净」） */
    const recent = bot.slice(0, 60).map(function (r) {
      return {
        ts: r.ts, table: r.table, handNo: r.handNo, mode: r.mode, pot: r.pot, rake: r.rake,
        botWon: r.botWon, botContrib: r.botContrib, botNet: r.botNet, botSeats: r.botSeats,
        platformNet: (r.rake || 0) + (r.botNet || 0)
      };
    });
    return send(res, {
      botsOn: !!(ctx.config.bots && ctx.config.bots.on !== false),
      totals: {
        rakeAll: rakeAll, handsCount: handsCount, botHandsCount: botHandsCount,
        botWonAll: botWonAll, botLossAll: botLossAll, botNetAll: botNetAll, botSeatsAll: botSeatsAll,
        platformNetAll: platformNetAll
      },
      daily: daily, recent: recent
    }), true;
  }

  /* ---- ★ 2026-10-06：每日经营账（服务端权威）——后台「每日净利润」看板 ----
     牌桌侧数据来自 pokertable 的 dailystats.json（每手结算时按自然日累计，不依赖前端上报）；
     资金侧数据来自订单表：当日充值到账、提现代付、提现手续费。
     口径：平台净利 = 抽水 + 机器人净 + 提现手续费 + 人工调账（加款为负）。 */
  if (p === '/papi/admin/extra/dailystats' && req.method === 'GET') {
    const days = Math.min(90, Math.max(1, +(x.u.searchParams.get('days')) || 30));
    const U2 = function (v) { return Math.round((+v || 0) * 100) / 100; };
    const ymd = function (ts) {
      const d = new Date(ts), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    };
    const pt = ctx.pokerTable || null;
    const dmap = (pt && pt.dailyStats) ? (pt.dailyStats() || {}) : {};
    const ord = (ctx.orders && ctx.orders.list) ? ctx.orders.list : [];
    const rows = [];
    const now = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const a = dayStart(now) - i * 86400000, b2 = a + 86400000, k = ymd(a);
      const d = dmap[k] || {};
      const dayOrd = ord.filter(function (o) { const ts = o.updatedAt || o.createdAt || 0; return ts >= a && ts < b2; });
      const dep = dayOrd.filter(function (o) { return o.type === 'recharge' && o.status === 'completed'; })
        .reduce(function (s2, o) { return s2 + (+o.usdt || 0); }, 0);
      const wd = dayOrd.filter(function (o) { return o.type === 'withdraw' && o.status === 'completed'; });
      const wdOut = wd.reduce(function (s2, o) { return s2 + ((o.netAmount !== undefined && o.netAmount !== null) ? +o.netAmount : +o.usdt || 0); }, 0);
      const fee = wd.reduce(function (s2, o) { return s2 + (+o.fee || 0); }, 0);
      const rake = U2(d.rake || 0), botNet = U2(d.botNet || 0), adjust = U2(d.adjust || 0);
      rows.push({
        day: k, hands: d.hands || 0, botHands: d.botHands || 0,
        rake: rake, botNet: botNet, fee: U2(fee), adjust: adjust,
        deposit: U2(dep), withdraw: U2(wdOut),
        platformNet: U2(rake + botNet + U2(fee) + adjust)
      });
    }
    const sum = function (k) { return U2(rows.reduce(function (a, r) { return a + (r[k] || 0); }, 0)); };
    const todayKey = ymd(now), today = rows.filter(function (r) { return r.day === todayKey; })[0] || {};
    const last7 = rows.slice(-7);
    const s7 = function (k) { return U2(last7.reduce(function (a, r) { return a + (r[k] || 0); }, 0)); };
    return send(res, {
      days: days,
      rows: rows,
      today: today,
      totals: {
        hands: sum('hands'), rake: sum('rake'), botNet: sum('botNet'), fee: sum('fee'),
        adjust: sum('adjust'), deposit: sum('deposit'), withdraw: sum('withdraw'), platformNet: sum('platformNet')
      },
      last7: {
        rake: s7('rake'), botNet: s7('botNet'), fee: s7('fee'), platformNet: s7('platformNet'), hands: s7('hands')
      }
    }), true;
  }

  /* ---- 房间管理 ---- */
  if (p === '/papi/admin/extra/rooms') {
    const q = String(x.u.searchParams.get('q') || '').trim().toLowerCase();
    const list = Object.keys(ctx.rooms.rooms).map(function (k) { return ctx.rooms.rooms[k]; })
      .filter(function (r) {
        if (!q) return true;
        return String(r.no).indexOf(q) >= 0 || String(r.name || '').toLowerCase().indexOf(q) >= 0 ||
          String(r.owner).indexOf(q) >= 0 || (r.seats || []).some(function (s) { return String(s.name || '').toLowerCase().indexOf(q) >= 0; });
      })
      .sort(function (a, b) { return (b.actAt || 0) - (a.actAt || 0); })
      .slice(0, 200)
      .map(function (r) {
        const owner = ctx.db.users[r.owner];
        return {
          id: r.id, no: r.no, name: r.name, modeKey: r.modeKey, sb: r.sb, bb: r.bb, cap: r.cap,
          priv: r.priv, hasPwd: !!r.passwd, owner: r.owner,
          ownerName: (owner && owner.name) || '—',
          seats: (r.seats || []).map(function (s) {
            return { uid: s.uid, name: s.name, isOwner: String(r.owner) === String(s.uid) };
          }),
          invites: (r.invites || []).map(function (s) { return { uid: s.uid, status: s.status }; }),
          createdAt: r.createdAt, actAt: r.actAt || r.createdAt,
          stale: (r.actAt || 0) < Date.now() - 30 * 60 * 1000
        };
      });
    return send(res, { list: list }), true;
  }
  if (p === '/papi/admin/extra/rooms/close' && req.method === 'POST') {
    const b = await B();
    const id = String(b.id || '').trim();
    let room = ctx.rooms.rooms[id];
    if (!room) { for (const k in ctx.rooms.rooms) { const y = ctx.rooms.rooms[k]; if (y && String(y.no) === id) room = y; } }
    if (!room) return fail(res, 404, '房间不存在'), true;
    const no = room.no, nm = room.name, ppl = (room.seats || []).length;
    delete ctx.rooms.rooms[room.id];
    await ctx.saveRooms();
    audAdmin('admin-room-close', String(no), '后台解散房间 ' + nm + '（房间号 ' + no + '，座位上 ' + ppl + ' 人）', ip);
    return send(res, { ok: true, closed: { no: no, name: nm, people: ppl } }), true;
  }
  /* 清一批超过 N 小时没活动的僵尸房 */
  if (p === '/papi/admin/extra/rooms/sweep' && req.method === 'POST') {
    const b = await B();
    const hours = Math.max(1, Math.min(720, num(b.hours, 24)));
    const cut = Date.now() - hours * 3600000;
    let n = 0, people = 0;
    Object.keys(ctx.rooms.rooms).forEach(function (k) {
      const r = ctx.rooms.rooms[k];
      if (!r) return;
      if ((r.actAt || r.createdAt || 0) < cut) { people += (r.seats || []).length; delete ctx.rooms.rooms[k]; n++; }
    });
    await ctx.saveRooms();
    audAdmin('admin-room-sweep', '', '清理 ' + hours + ' 小时无活动的房间 ' + n + ' 间（涉及座位 ' + people + ' 个）', ip);
    return send(res, { ok: true, rooms: n, people: people }), true;
  }

  /* ---- 用户详情增强 ---- */
  if (p === '/papi/admin/extra/user') {
    const id = String(x.u.searchParams.get('id') || '').trim();
    const u = ctx.db.users[id];
    if (!u) return fail(res, 404, '用户不存在'), true;
    const orders = ctx.orders.list.filter(function (o) { return String(o.uid) === String(u.id); }).slice(0, 30).map(ctx.orderPublic || function (o) { return o; });
    const rooms = Object.keys(ctx.rooms.rooms).map(function (k) { return ctx.rooms.rooms[k]; })
      .filter(function (r) { return String(r.owner) === String(u.id) || (r.seats || []).some(function (s) { return String(s.uid) === String(u.id); }); })
      .map(function (r) { return { no: r.no, name: r.name, modeKey: r.modeKey, seats: (r.seats || []).length, isOwner: String(r.owner) === String(u.id), actAt: r.actAt || r.createdAt }; });
    const ledgerTAKER = store.ledger.list.filter(function (r) { return String(r.uid) === String(u.id); }).slice(0, 60);
    const hands = store.hands.list.filter(function (h) { return String(h.uid) === String(u.id); }).slice(0, 30);
    /* 登录 IP：从审计日志里取最近几条 */
    let recentIp = [];
    try {
      recentIp = fs.readFileSync(ctx.fpath('audit.log'), 'utf8').trim().split('\n').filter(Boolean).slice(-4000).reverse()
        .map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter(function (r) { return r && String(r.target) === String(u.id) && r.ip; })
        .slice(0, 12).map(function (r) { return { ts: r.ts, ip: r.ip, action: r.action }; });
    } catch (e) { }
    return send(res, {
      user: ctx.publicUser(u),
      full: {
        acc: u.acc, kyc: u.kyc !== false, fromAudit: recentIp[0] && recentIp[0].ip
      },
      table: {
        tablePaid: Math.max(0, num(u.tablePaid)), tableCashed: Math.max(0, num(u.tableCashed)),
        tableBank: Math.max(0, num(u.tableBank)), cashable: Math.max(0, num(u.cashable)),
        usdt: Math.round((+u.usdt || 0) * 100) / 100, riskFlag: Math.max(0, num(u.riskFlag))
      },
      stat: u.stat || { hands: 0, net: 0, win: 0 },
      orders: orders, rooms: rooms, ledger: ledgerTAKER, hands: hands, logins: recentIp,
      tickets: store.tickets.list.filter(function (t) { return String(t.uid) === String(u.id); }).slice(0, 10),
      reports: store.reports.list.filter(function (t) { return String(t.targetId) === String(u.id); }).slice(0, 10)
    }), true;
  }

  /* ---- 筹码流水账本 ---- */
  if (p === '/papi/admin/extra/ledger') {
    const q = String(x.u.searchParams.get('q') || '').trim().toLowerCase();
    const type = String(x.u.searchParams.get('type') || '').trim();
    const limit = Math.min(500, num(x.u.searchParams.get('limit'), 100));
    let list = store.ledger.list;
    if (type) list = list.filter(function (r) { return r.type === type; });
    if (q) list = list.filter(function (r) { return String(r.uid) === q || String(r.name || '').toLowerCase().indexOf(q) >= 0; });
    const sum = list.slice(0, limit).reduce(function (a, r) { return a + (r.amount || 0); }, 0);
    return send(res, { list: list.slice(0, limit), sum: sum, total: store.ledger.list.length }), true;
  }

  /* ---- 牌局记录 ---- */
  if (p === '/papi/admin/extra/hands') {
    const q = String(x.u.searchParams.get('q') || '').trim().toLowerCase();
    const limit = Math.min(500, num(x.u.searchParams.get('limit'), 100));
    let list = store.hands.list;
    if (q) list = list.filter(function (h) {
      return String(h.uid) === q || String(h.name || '').toLowerCase().indexOf(q) >= 0 ||
        String(h.roomNo) === q || String(h.handNo).toLowerCase().indexOf(q) >= 0;
    });
    const agg = list.slice(0, limit);
    return send(res, {
      list: agg, total: store.hands.list.length,
      pot: agg.reduce(function (a, h) { return a + (h.pot || 0); }, 0),
      rake: agg.reduce(function (a, h) { return a + (h.rake || 0); }, 0)
    }), true;
  }

  /* ---- 客服工单 ---- */
  if (p === '/papi/admin/extra/tickets') {
    const stf = String(x.u.searchParams.get('status') || '').trim();
    let list = store.tickets.list;
    if (stf && stf !== 'all') list = list.filter(function (t) { return t.status === stf; });
    return send(res, { list: list.slice(0, 200) }), true;
  }
  if (p === '/papi/admin/extra/tickets/reply' && req.method === 'POST') {
    const b = await B();
    const t = store.tickets.list.filter(function (y) { return y.id === String(b.id); })[0];
    if (!t) return fail(res, 404, '工单不存在'), true;
    t.replies.push({ ts: Date.now(), by: adminName, role: 'admin', text: String(b.text || '').slice(0, 500) });
    if (b.close) t.status = 'closed';
    else if (t.status === 'open') t.status = 'processing';
    await save('tickets');
    /* 玩家侧可见回复（以邮件形式下发） */
    addMail(t.uid, '客服', '工单回复：' + t.title, String(b.text || '').slice(0, 500));
    await save('mails');
    audAdmin('admin-ticket-reply', t.id, '回复工单 ' + t.id + '（' + t.name + '）', ip);
    return send(res, { ticket: t }), true;
  }

  /* ---- 举报处理 ---- */
  if (p === '/papi/admin/extra/reports') {
    const stf = String(x.u.searchParams.get('status') || '').trim();
    let list = store.reports.list;
    if (stf && stf !== 'all') list = list.filter(function (t) { return t.status === stf; });
    return send(res, { list: list.slice(0, 200) }), true;
  }
  if (p === '/papi/admin/extra/reports/handle' && req.method === 'POST') {
    const b = await B();
    const r = store.reports.list.filter(function (y) { return y.id === String(b.id); })[0];
    if (!r) return fail(res, 404, '举报不存在'), true;
    r.status = String(b.status || 'done'); r.note = String(b.note || '').slice(0, 200);
    /* 处置动作：封禁 / 清空标记 */
    let did = '';
    if (b.ban) {
      const t = ctx.db.users[r.targetId];
      if (t) { t.banned = true; did = '已封禁 ' + t.name; }
    }
    await save('reports'); await ctx.saveDB();
    audAdmin('admin-report', r.id, '处理举报 ' + r.id + '（被举报 ' + r.targetName + '，' + r.reason + '）→ ' + r.status + ' ' + did, ip);
    return send(res, { report: r }), true;
  }

  /* ---- 邮件 / 全服公告 ---- */
  if (p === '/papi/admin/extra/mails') {
    return send(res, { list: store.mails.list.slice(0, 100) }), true;
  }
  if (p === '/papi/admin/extra/mails/send' && req.method === 'POST') {
    const b = await B();
    const title = String(b.title || '').trim();
    if (title.length < 2) return fail(res, 400, '请填写标题'), true;
    const gift = (b.gift && (num(b.gift.chips) || num(b.gift.diamonds))) ? { chips: num(b.gift.chips), diamonds: num(b.gift.diamonds) } : null;
    const m = addMail(b.to && String(b.to) !== '*' ? String(b.to) : '*', adminName, title, String(b.body || ''), gift);
    await save('mails');
    audAdmin('admin-mail', m.id, (String(b.to) === '*' || !b.to ? '全服邮件' : '定向邮件 → ' + m.to) + '：' + title + (gift ? '（附件 ' + ((gift.chips || 0) / 100).toFixed(2) + ' USDT / ' + (gift.diamonds || 0) + ' 钻石）' : ''), ip);
    return send(res, { mail: { id: m.id, ts: m.ts } }), true;
  }
  if (p === '/papi/admin/extra/mails/delete' && req.method === 'POST') {
    const b = await B();
    const i = store.mails.list.findIndex(function (m) { return m.id === String(b.id); });
    if (i < 0) return fail(res, 404, '邮件不存在'), true;
    store.mails.list.splice(i, 1);
    await save('mails');
    audAdmin('admin-mail-del', String(b.id), '删除邮件', ip);
    return send(res, { ok: true }), true;
  }

  /* ---- 大厅 Banner：图片上传 + 列表管理 ---- */
  if (p === '/papi/admin/extra/banner/upload' && req.method === 'POST') {
    const b = await BB();
    const name = String((b && b.name) || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot) : '';
    if (!BANNER_EXT[ext]) return fail(res, 400, '仅支持 PNG / JPG / WEBP 图片'), true;
    const data = String((b && b.data) || '');
    const m = data.match(/^data:image\/[a-z+]+;base64,(.+)$/s);
    if (!m) return fail(res, 400, '图片数据格式不对'), true;
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 1024) return fail(res, 400, '图片太小或已损坏'), true;
    if (buf.length > 6 * 1024 * 1024) return fail(res, 400, '图片超过 6MB，请压缩后再传'), true;
    const fn = 'bnr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + ext;
    try { fs.writeFileSync(BANNER_DIR + '/' + fn, buf); }
    catch (e) { return fail(res, 500, '写入失败：' + e.message), true; }
    audAdmin('admin-banner-upload', fn, buf.length + ' bytes', ip);
    return send(res, { url: '/assets/banners/' + fn, size: buf.length }), true;
  }
  if (p === '/papi/admin/extra/banners' && req.method === 'GET') {
    return send(res, {
      list: ctx.config.banners || [],
      /* ★ 2026-10-04：内置三条老图（b1/b2/b3）的显隐开关，供后台直接移除老图 */
      builtin: (ctx.config.lobby && ctx.config.lobby.banners) || {},
    }), true;
  }
  if (p === '/papi/admin/extra/banners' && req.method === 'POST') {
    const b = await B();
    const src = Array.isArray(b.list) ? b.list : [];
    const out = [];
    for (const it of src.slice(0, 8)) {   /* 最多 8 张，轮播再多玩家也看不过来 */
      const img = String(it.img || '');
      /* 只允许引用本站上传目录里的图片，禁止外链（防 SSRF / 防盗链滥用） */
      if (!/^\/assets\/banners\/bnr-[\w-]+\.(png|jpe?g|webp)$/.test(img)) continue;
      out.push({
        id: String(it.id || ctx.newId()).slice(0, 24),
        img: img,
        t: String(it.t || '').slice(0, 24),
        s: String(it.s || '').slice(0, 48),
        act: String(it.act || '').slice(0, 24),
        on: it.on !== false,
      });
    }
    ctx.config.banners = out;
    /* ★ 2026-10-04：同屏保存内置老图（b1/b2/b3）的显隐开关。
       只接受这三个 key，防止把大厅其它配置冲掉；整体替换 banners 子对象
       （PUT /admin/config 对 lobby 也是浅合并，行为一致）。 */
    if (b.builtin && typeof b.builtin === 'object') {
      if (!ctx.config.lobby || typeof ctx.config.lobby !== 'object') ctx.config.lobby = {};
      const cur = (ctx.config.lobby.banners && typeof ctx.config.lobby.banners === 'object') ? ctx.config.lobby.banners : {};
      const nb = {};
      ['b1', 'b2', 'b3'].forEach(function (k) {
        nb[k] = (b.builtin[k] === true) || (b.builtin[k] !== false && cur[k] !== false);
      });
      ctx.config.lobby.banners = nb;
    }
    await ctx.saveConfig();
    audAdmin('admin-banner-save', '', 'Banner 列表 ' + out.length + ' 张：' +
      out.map(function (x) { return (x.on ? '☑' : '☐') + x.img.split('/').pop(); }).join(' '), ip);
    return send(res, {
      list: out,
      builtin: (ctx.config.lobby && ctx.config.lobby.banners) || {},
    }), true;
  }
  /* 已上传图片清单（含「传过但没在用」的老图），供后台清理后再传新图 */
  if (p === '/papi/admin/extra/banner/files' && req.method === 'GET') {
    let files = [];
    try {
      files = fs.readdirSync(BANNER_DIR).filter(function (f) { return /^bnr-[\w-]+\.(png|jpe?g|webp)$/i.test(f); });
    } catch (e) { files = []; }
    const used = {};
    (ctx.config.banners || []).forEach(function (b) {
      const m = String(b.img || '').match(/\/assets\/banners\/(bnr-[\w-]+\.(?:png|jpe?g|webp))$/i);
      if (m) used[m[1]] = true;
    });
    const out = files.map(function (f) {
      let st = null; try { st = fs.statSync(BANNER_DIR + '/' + f); } catch (e) { }
      return { name: f, url: '/assets/banners/' + f, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0, used: !!used[f] };
    }).sort(function (a, b) { return b.mtime - a.mtime; });
    return send(res, { files: out }), true;
  }
  /* 删除已上传的 Banner 图片：磁盘文件删掉，并顺带从轮播列表里移除 */
  if (p === '/papi/admin/extra/banner/del' && req.method === 'POST') {
    const b = await B();
    const nm = String((b && b.name) || '').match(/^(bnr-[\w-]+\.(?:png|jpe?g|webp))$/i);
    let fn = nm ? nm[1] : '';
    if (!fn) {
      const m = String((b && b.url) || '').match(/\/assets\/banners\/(bnr-[\w-]+\.(?:png|jpe?g|webp))$/i);
      if (m) fn = m[1];
    }
    if (!fn) return fail(res, 400, '图片名不合法'), true;
    let gone = false;
    try { fs.unlinkSync(BANNER_DIR + '/' + fn); gone = true; } catch (e) { /* 文件已不在也算清理完成 */ }
    const before = (ctx.config.banners || []).length;
    ctx.config.banners = (ctx.config.banners || []).filter(function (x) {
      return String(x.img || '').indexOf('/assets/banners/' + fn) < 0;
    });
    await ctx.saveConfig();
    audAdmin('admin-banner-del', fn, '删除 Banner 图片' + (gone ? '' : '（磁盘上已不存在）') +
      '，轮播 ' + before + ' → ' + ctx.config.banners.length, ip);
    return send(res, { ok: true, list: ctx.config.banners || [] }), true;
  }
  /* ★ 2026-10-03：一键清空 —— 删掉服务器上所有 Banner 图片文件，并把轮播列表归零。
     老图越堆越多、引用关系对不上时用一次，然后重新传新图，前台不会再出现「引用了不存在的图」的空白块。 */
  if (p === '/papi/admin/extra/banner/clear' && req.method === 'POST') {
    let n = 0;
    try {
      for (const f of fs.readdirSync(BANNER_DIR)) {
        if (!/^bnr-[\w-]+\.(png|jpe?g|webp)$/i.test(f)) continue;
        try { fs.unlinkSync(BANNER_DIR + '/' + f); n++; } catch (e) { /* 单张失败不影响整体 */ }
      }
    } catch (e) { /* 目录不存在 = 本来就是空的 */ }
    ctx.config.banners = [];
    await ctx.saveConfig();
    audAdmin('admin-banner-clear', '', '清空 Banner：删除图片 ' + n + ' 张，轮播归零', ip);
    return send(res, { ok: true, removed: n, list: [] }), true;
  }

  /* ---- ★ 2026-10-03：APP 主 Logo（后台「参数配置 → 品牌设置」上传，上传即生效） ----
     展示位置：登录页大图 118×150（contain 等比）、大厅顶栏小图 34×34（contain 等比）。
     所以建议正方形透明底 PNG（512×512 即可两处都清晰），前端按 contain 缩放不会变形。 */
  if (p === '/papi/admin/extra/brand/upload' && req.method === 'POST') {
    const b = await BB();
    const name = String((b && b.name) || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot) : '';
    if (!BANNER_EXT[ext]) return fail(res, 400, '仅支持 PNG / JPG / WEBP 图片'), true;
    const data = String((b && b.data) || '');
    const m = data.match(/^data:image\/[a-z+]+;base64,(.+)$/s);
    if (!m) return fail(res, 400, '图片数据格式不对'), true;
    const buf = Buffer.from(m[1], 'base64');
    /* 下限只用来拦「空数据 / 损坏文件」：Logo 多是极简图标，纯色 PNG 压缩后可能只有几百字节，
       门槛定高了会把正常小图标误杀（Banner 是 1KB，这里放宽到 128B）。 */
    if (buf.length < 128) return fail(res, 400, '图片太小或已损坏'), true;
    if (buf.length > 4 * 1024 * 1024) return fail(res, 400, 'Logo 超过 4MB，请压缩后再传'), true;
    const fn = 'logo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + ext;
    try { fs.writeFileSync(LOGO_DIR + '/' + fn, buf); }
    catch (e) { return fail(res, 500, '写入失败：' + e.message), true; }
    /* 换 Logo 即换文件：把上一张删掉，免得 assets/brand/ 越堆越多（只删本站自己生成的 logo-* 文件） */
    const old = String((ctx.config.app && ctx.config.app.logo) || '');
    const om = old.match(/^\/assets\/brand\/(logo-[\w-]+\.(?:png|jpe?g|webp))$/i);
    if (om && om[1] !== fn) { try { fs.unlinkSync(LOGO_DIR + '/' + om[1]); } catch (e) { /* 已不在就算了 */ } }
    ctx.config.app = Object.assign({}, ctx.config.app || {}, { logo: '/assets/brand/' + fn });
    await ctx.saveConfig();
    audAdmin('admin-brand-upload', fn, '更换 APP Logo（' + buf.length + ' bytes）', ip);
    return send(res, { url: '/assets/brand/' + fn, size: buf.length }), true;
  }
  /* 恢复内置默认 Logo：删掉已上传的文件，把 app.logo 置空（前端自动回落内置图） */
  if (p === '/papi/admin/extra/brand/reset' && req.method === 'POST') {
    const old = String((ctx.config.app && ctx.config.app.logo) || '');
    const om = old.match(/^\/assets\/brand\/(logo-[\w-]+\.(?:png|jpe?g|webp))$/i);
    let gone = false;
    if (om) { try { fs.unlinkSync(LOGO_DIR + '/' + om[1]); gone = true; } catch (e) { /* 磁盘上已不在 */ } }
    ctx.config.app = Object.assign({}, ctx.config.app || {}, { logo: '' });
    await ctx.saveConfig();
    audAdmin('admin-brand-reset', om ? om[1] : '', '恢复内置默认 Logo' + (gone ? '' : '（磁盘上已无文件）'), ip);
    return send(res, { ok: true }), true;
  }

  /* ---- VIP / 任务可视化配置 ---- */
  if (p === '/papi/admin/extra/tasks' && req.method === 'POST') {
    const b = await B();
    const t = b.tasks && typeof b.tasks === 'object' ? b.tasks : {};
    const out = { signin: [], signinTotal: 0, rewards: {} };
    out.signin = (Array.isArray(t.signin) && t.signin.length ? t.signin : []).slice(0, 14).map(function (v) { const n = num(v); return n >= 0 ? n : 0; });
    out.signinTotal = Math.max(0, num(t.signinTotal));
    const src = (t.rewards && typeof t.rewards === 'object') ? t.rewards : {};
    Object.keys(src).forEach(function (k) { out.rewards[String(k).slice(0, 8)] = Math.max(0, num(src[k])); });
    ctx.config.tasks = out;
    await ctx.saveConfig();
    audAdmin('admin-tasks', '', '更新任务 / 签到奖励 ' + JSON.stringify(out).slice(0, 300), ip);
    return send(res, { tasks: ctx.tasksPublic ? ctx.tasksPublic() : out }), true;
  }
  if (p === '/papi/admin/extra/econ' && req.method === 'POST') {
    const b = await B();
    const e = ctx.config.econ || (ctx.config.econ = {});
    if (b.chipPerUsdt != null) e.chipPerUsdt = Math.max(1, num(b.chipPerUsdt, 100));
    if (b.rakePct != null) e.rakePct = Math.max(0, Math.min(0.2, +b.rakePct || 0));
    if (b.rakeCapBB != null) e.rakeCapBB = Math.max(0, Math.min(20, +b.rakeCapBB || 0));
    if (Array.isArray(b.rebate)) e.rebate = b.rebate.slice(0, 9).map(function (v) { return Math.max(0, Math.min(50, num(v))); });
    /* ★ 2026-10-03：邀请好友奖励（每人多少筹码）+ 单日上限，防刷 */
    if (b.inviteReward != null) e.inviteReward = Math.max(0, Math.min(100000, Math.round(num(b.inviteReward, 10))));
    if (b.inviteDayCap != null) e.inviteDayCap = Math.max(1, Math.min(500, Math.round(num(b.inviteDayCap, 20))));
    await ctx.saveConfig();
    audAdmin('admin-econ', '', '更新经济参数 ' + JSON.stringify(e), ip);
    return send(res, { econ: e }), true;
  }

  /* ---- AI 强度 / 透视开关（★ 测试房专用） ---- */
  if (p === '/papi/admin/extra/ai' && req.method === 'POST') {
    const b = await B();
    const ai = ctx.config.ai || (ctx.config.ai = {});
    if (b.skill != null) ai.skill = Math.max(1, Math.min(5, num(b.skill, 3)));
    const o = ctx.config.oracle || (ctx.config.oracle = {});
    if (b.oracle && typeof b.oracle === 'object') {
      o.on = !!b.oracle.on;
      o.board = b.oracle.board !== false;
      o.holes = b.oracle.holes !== false;
      o.ally = !!b.oracle.ally;
      if (b.oracle.useRate != null) o.useRate = Math.max(0, Math.min(1, +b.oracle.useRate || 0.85));
      o.note = String(b.oracle.note || '').slice(0, 200);
      o.updatedAt = Date.now(); o.updatedBy = adminName;
    }
    /* 控水（机器人赢面调节）：后台可配，下发到前端 HOUSE。
       与透视的区别：控水只调整「发牌倾向」，不改机器人读取信息的能力，是常规运营手段。 */
    const h = ctx.config.house || (ctx.config.house = {});
    if (b.house && typeof b.house === 'object') {
      h.on = !!b.house.on;
      if (b.house.botWinRate != null) h.botWinRate = Math.max(0.05, Math.min(0.9, +b.house.botWinRate || 0.3));
      if (b.house.strength != null) h.strength = Math.max(0, Math.min(1, +b.house.strength || 0.85));
      if (b.house.capProfit != null) h.capProfit = Math.max(0, num(b.house.capProfit, 2000000));
      if (b.house.capLoss != null) h.capLoss = Math.max(0, num(b.house.capLoss, 1000000));
      h.updatedAt = Date.now(); h.updatedBy = adminName;
    }
    await ctx.saveConfig();
    audAdmin('admin-ai', '', 'AI 强度=' + ai.skill + ' · 透视=' + (o.on ? '【开】' : '关') +
      ' board=' + (o.board !== false) + ' holes=' + (o.holes !== false) + ' ally=' + (!!o.ally) +
      ' useRate=' + (o.useRate == null ? 0.85 : o.useRate) + ' 备注=' + (o.note || '') +
      ' · 控水=' + (h.on ? '【开】' : '关') + ' 机器人胜率目标=' + (h.botWinRate == null ? 0.3 : h.botWinRate) +
      ' 强度=' + (h.strength == null ? 0.85 : h.strength), ip);
    return send(res, { ai: ai, oracle: o, house: h }), true;
  }
  if (p === '/papi/admin/extra/ai' && req.method === 'GET') {
    return send(res, {
      ai: ctx.config.ai || {}, oracle: ctx.config.oracle || {},
      house: ctx.config.house || { on: false, botWinRate: 0.30, strength: 0.85, capProfit: 2000000, capLoss: 1000000 },
      /* 控水实时效果：后台据此显示「实际达成的机器人胜率 / bot 净盈亏」（服务端机器人房统计） */
      houseStat: (ctx.pokerTable && ctx.pokerTable.houseStat) ? ctx.pokerTable.houseStat() : null
    }), true;
  }

  /* ---- 风险用户（余额异常跳变） ---- */
  if (p === '/papi/admin/extra/risk') {
    const list = Object.keys(ctx.db.users).map(function (k) { return ctx.db.users[k]; })
      .filter(function (u) { return (+u.riskFlag || 0) > 0; })
      .sort(function (a, b) { return (+b.riskFlag || 0) - (+a.riskFlag || 0); })
      .slice(0, 100).map(function (u) {
        return {
          id: u.id, name: u.name, chips: Math.max(0, Math.round(+u.bal || 0)) / 100, cashable: Math.max(0, Math.round(+u.bal || 0)) / 100,
          usdt: Math.round((+u.usdt || 0) * 100) / 100, riskFlag: +u.riskFlag || 0,
          banned: !!u.banned, lastLogin: u.lastLogin || 0, createdAt: u.createdAt || 0
        };
      });
    return send(res, { list: list }), true;
  }

  /* ---- CSV 导出 ---- */
  if (p === '/papi/admin/extra/export') {
    const type = String(x.u.searchParams.get('type') || 'users');
    let rows = [], fname = type;
    if (type === 'users') {
      rows.push(['ID', '账号', '昵称', '等级', 'VIP', '筹码', '可兑现', 'USDT', '手数', '净盈亏', '注册时间', '最后登录', 'IP', '封禁']);
      Object.keys(ctx.db.users).forEach(function (k) {
        const u = ctx.db.users[k];
        rows.push([u.id, u.acc, u.name, u.level, u.vip, Math.max(0, Math.round(+u.bal || 0)) / 100, Math.max(0, Math.round(+u.bal || 0)) / 100, Math.max(0, Math.round(+u.bal || 0)) / 100,
          (u.stat && u.stat.hands) || 0, (u.stat && u.stat.net) || 0,
          new Date(u.createdAt || 0).toLocaleString('zh-CN'), new Date(u.lastLogin || 0).toLocaleString('zh-CN'),
          u.lastIp || '', u.banned ? '是' : '']);
      });
    } else if (type === 'orders') {
      rows.push(['订单号', '用户', '类型', 'USDT', '筹码', '状态', '网络', '地址', 'TXID', '创建时间']);
      ctx.orders.list.slice(0, 3000).forEach(function (o) {
        rows.push([o.id, o.user, o.type, o.usdt, o.chips, o.status, o.net || '', o.address || '', o.txid || '', new Date(o.createdAt).toLocaleString('zh-CN')]);
      });
    } else if (type === 'ledger') {
      rows.push(['时间', '用户ID', '昵称', '类型', '变动', '变动后', '备注']);
      store.ledger.list.slice(0, 5000).forEach(function (r) {
        rows.push([new Date(r.ts).toLocaleString('zh-CN'), r.uid, r.name, r.type, r.amount, r.after, r.tag || r.note || '']);
      });
    } else if (type === 'hands') {
      rows.push(['时间', '玩家', '牌桌', '手号', '玩法', '底池', '抽水', '投入', '赢得', '返水']);
      store.hands.list.slice(0, 5000).forEach(function (h) {
        rows.push([new Date(h.ts).toLocaleString('zh-CN'), h.name, h.table, h.handNo, h.mode, h.pot, h.rake, h.contrib, h.won, h.rebate]);
      });
    } else if (type === 'rooms') {
      rows.push(['房间号', '名称', '玩法', '盲注', '人数', '房主', '私有', '创建', '最后活动']);
      Object.keys(ctx.rooms.rooms).forEach(function (k) {
        const r = ctx.rooms.rooms[k];
        rows.push([r.no, r.name, r.modeKey, r.sb + '/' + r.bb, (r.seats || []).length,
          (ctx.db.users[r.owner] && ctx.db.users[r.owner].name) || r.owner, r.priv === 'private' ? '是' : '否',
          new Date(r.createdAt).toLocaleString('zh-CN'), new Date(r.actAt || r.createdAt).toLocaleString('zh-CN')]);
      });
    } else {
      return fail(res, 400, '不支持的导出类型'), true;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + fname + '-' + new Date().toISOString().slice(0, 10) + '.csv"',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end('\ufeff' + csv(rows));
    audAdmin('admin-export', type, '导出 ' + type + ' 共 ' + (rows.length - 1) + ' 行', ip);
    return true;
  }

  /* ---- 手动备份 ---- */
  if (p === '/papi/admin/extra/backup' && req.method === 'POST') {
    try {
      const dir = path.join(ctx.DATA, 'backups');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const dest = path.join(dir, 'gu9-' + stamp);
      fs.mkdirSync(dest, { recursive: true });
      let n = 0;
      fs.readdirSync(ctx.DATA).forEach(function (f) {
        const src = path.join(ctx.DATA, f);
        if (!fs.statSync(src).isFile()) return;
        if (/\.tmp\./.test(f)) return;
        fs.copyFileSync(src, path.join(dest, f)); n++;
      });
      /* 顺手把后台必要的集合也写一遍，确保内存里的最新数据落盘 */
      await Promise.all(COLS.map(save));
      audAdmin('admin-backup', dest, '手动备份 ' + n + ' 个数据文件 → ' + stamp, ip);
      return send(res, { ok: true, files: n, name: stamp }), true;
    } catch (e) {
      return fail(res, 500, '备份失败：' + e.message), true;
    }
  }
  if (p === '/papi/admin/extra/backups' && req.method === 'GET') {
    const dir = path.join(ctx.DATA, 'backups');
    let list = [];
    try {
      list = fs.readdirSync(dir).map(function (f) {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, ts: st.mtimeMs, size: st.size };
      }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 20);
    } catch (e) { }
    return send(res, { list: list }), true;
  }

  /* ---- 批量发放 USDT（走 ledger；USDT 化后可提额度 = 余额，无需单独维护） ---- */
  if (p === '/papi/admin/extra/grant' && req.method === 'POST') {
    const b = await B();
    /* 2026-10-05 USDT 化：后台发放按 USDT（元）计价，内部 ×100 转分；兼容老参数 chips（分）。 */
    const chips = (b.usdt !== undefined && b.usdt !== null && isFinite(+b.usdt)) ? Math.round(+b.usdt * 100) : num(b.chips);
    const reason = String(b.reason || '').slice(0, 100);
    let hit = 0, total = 0;
    if (String(b.to) === '*') {
      Object.keys(ctx.db.users).forEach(function (k) {
        const u = ctx.db.users[k];
        if (u.banned) return;
        ledger(u.id, 'admin-grant', chips, reason || '全服发放', 'by ' + adminName);
        u.cashable = Math.max(0, num(u.cashable) + chips);
        hit++; total += chips;
      });
    } else {
      const u = ctx.db.users[String(b.to || '')];
      if (!u) return fail(res, 404, '用户不存在'), true;
      ledger(u.id, 'admin-grant', chips, reason || '后台发放', 'by ' + adminName);
      u.cashable = Math.max(0, num(u.cashable) + chips);
      hit = 1; total = chips;
    }
    await ctx.saveDB(); await save('ledger');
    audAdmin('admin-grant', String(b.to || '*'), (String(b.to) === '*' ? '全服' : '单人') + '发放 ' + (chips / 100).toFixed(2) + ' USDT × ' + hit + ' 人 = ' + (total / 100).toFixed(2) + '（' + reason + '）', ip);
    return send(res, { ok: true, users: hit, total: total }), true;
  }

  return fail(res, 404, 'not found'), true;
}

/* ★ 2026-10-08：服务端（pokertable 每手结束）直接写手牌台账，不再依赖客户端上报 */
function addHands(rows) {
  (rows || []).forEach(function (r) { store.hands.list.unshift(r); });
  if (store.hands.list.length > 20000) store.hands.list.length = 20000;
  return save('hands');
}
module.exports = { init: init, handle: handle, chain: chain, addHands: addHands };



