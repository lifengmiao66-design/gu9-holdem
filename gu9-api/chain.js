'use strict';
/* ================================================================
   chain.js —— USDT 链上收款：地址簿 + 入账监控 + 自动到账
   ------------------------------------------------------------
   · 后台维护收款地址（TRC20 / ERC20 / BEP20 / SOL），可增删改、可启停
   · 玩家充值下单 → 分配一个收款地址（同一地址可复用，避免上链转账被"独占"卡死）
   · 后台进程轮询公共区块浏览器，扫描 USDT 入账
   · 命中订单（地址 + 金额 + 时间窗 + 确认数）→ 自动把筹码打到玩家账户，并抬升可兑现池
   · 未命中的入账留在「待认领」列表，后台可手动补单
   ------------------------------------------------------------
   ★ 本模块只读链上数据，不持有任何私钥、不发起任何转账。
     出款仍走原来的 /papi/admin/orders 人工流程，不在这里自动化。
   ★ 零第三方依赖：用 node 内置 https 打公共 API。
   ================================================================ */
const fs = require('fs');
const path = require('path');
const https = require('https');

let ctx = null;                    /* 由 extra.js 注入：读写 / 配置 / 订单 / 用户 */
let HOOK = {};                     /* ledger / mail 钩子（extra.js 提供） */

function U(v) { return Math.round((+v || 0) * 100) / 100; }   /* ★ 2026-10-06：全站唯一金额单位 = USDT（两位小数），不再有「分」 */
let ADDR = { seq: 1000, list: [] };/* 收款地址簿 */
let SEEN = { list: [], map: {} };  /* 已处理过的 txid（防重复入账） */
let DEPS = { list: [] };           /* 扫描到的入账流水（含已匹配/未匹配） */
let CFG = null;                    /* 监控配置（存 CONFIG.pay.chain） */
let timer = null;
let running = false;
let LAST = { at: 0, ok: false, err: '', scanned: 0, matched: 0 };

/* ---------------- 链参数 ---------------- */
const NETS = {
  TRC20: {
    kind: 'tron',
    /* USDT-TRC20 合约（T 开头 base58） */
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    minConf: 19,                                   /* TRON 约 19 个块后不可逆（约 1 分钟） */
    addrRe: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    note: 'TRON 主网 · USDT TRC20 · 手续费低、到账快'
  },
  ERC20: {
    kind: 'evm', chainId: 1,
    contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    minConf: 12,
    addrRe: /^0x[a-fA-F0-9]{40}$/,
    note: 'Ethereum 主网 · USDT ERC20 · 手续费高'
  },
  BEP20: {
    kind: 'evm', chainId: 56,
    contract: '0x55d398326f99059ff775485246999027b3197955',
    minConf: 15,
    addrRe: /^0x[a-fA-F0-9]{40}$/,
    note: 'BNB Chain · USDT BEP20 · 手续费低'
  },
  SOL: {
    kind: 'sol',
    /* ★ 新增：Solana 主网 · USDT (SPL) —— 充值通道第 3 条链 */
    contract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',     /* USDT-SPL mint（base58） */
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    minConf: 1,                                                   /* Solana 终局即确认，scanSolana 回报 conf=9999 */
    addrRe: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    note: 'Solana 主网 · USDT (SPL) · 速度极快、手续费极低',
    rpc: 'https://api.mainnet-beta.solana.com'                  /* 默认公共 RPC（无需 key），后台「Solana RPC」处可换成 Helius/QuickNode/Ankr 等更稳节点 */
  }
};
/* Solana 公共 RPC 兜底列表（按序尝试；后台配置了自定义 RPC 时优先用它，失败再退回这里） */
const RPC_FALLBACKS = [
  'https://api.mainnet-beta.solana.com'
];
const DEFAULT_CFG = {  on: false,               /* 总开关：后台打开后才开始轮询 */
  autoCredit: true,        /* 命中订单自动到账（关掉就只是记录，等后台人工点） */
  pollMs: 30000,           /* 轮询间隔 */
  minConf: null,           /* null = 用各链默认值 */
  tolerance: 0.005,        /* 金额容差 0.5%（链上转账常被扣手续费，实收会略少） */
  windowMin: 60,           /* 订单有效时间（分钟），超时不再自动匹配 */
  scanHours: 24,           /* 每次回扫多少小时 */
  keys: { tron: '', evm: '', sol: '' }   /* 浏览器 / RPC 端点（可选） */
};

/* ---------------- 小工具 ---------------- */
function nowISO() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function lower(s) { return String(s || '').toLowerCase(); }
function netOf(n) { return NETS[String(n || '').toUpperCase()] || null; }
function netName(n) { const k = String(n || '').toUpperCase(); return NETS[k] ? k : ''; }
function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
function r2(v) { return Math.round(num(v) * 100) / 100; }

function httpGet(url, headers, timeout) {
  return new Promise(function (resolve) {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, err: 'bad url' }); }
    const req = https.request({
      host: u.host, path: u.pathname + u.search, method: 'GET',
      headers: Object.assign({ 'User-Agent': 'gu9-chain/1.0', Accept: 'application/json' }, headers || {}),
      timeout: timeout || 15000
    }, function (res) {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => b += c);
      res.on('end', function () {
        let j = null;
        try { j = JSON.parse(b); } catch (e) { return resolve({ ok: false, code: res.statusCode, err: 'non-json: ' + b.slice(0, 120) }); }
        if (res.statusCode >= 400) return resolve({ ok: false, code: res.statusCode, err: 'http ' + res.statusCode });
        resolve({ ok: true, j: j });
      });
    });
    req.on('error', e => resolve({ ok: false, err: e.message }));
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
    req.end();
  });
}
/* JSON-RPC POST（Solana 公共 RPC 用） */
function httpPostJson(url, body, timeout) {
  return new Promise(function (resolve) {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, err: 'bad url' }); }
    const data = JSON.stringify(body);
    const req = https.request({
      host: u.host, path: u.pathname + u.search, method: 'POST',
      headers: {
        'User-Agent': 'gu9-chain/1.0', 'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: timeout || 20000
    }, function (res) {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => b += c);
      res.on('end', function () {
        let j = null;
        try { j = JSON.parse(b); } catch (e) { return resolve({ ok: false, code: res.statusCode, err: 'non-json: ' + b.slice(0, 120) }); }
        if (res.statusCode >= 400) return resolve({ ok: false, code: res.statusCode, err: 'http ' + res.statusCode });
        if (j && j.error) return resolve({ ok: false, err: (j.error.message || JSON.stringify(j.error)).slice(0, 120) });
        resolve({ ok: true, j: j });
      });
    });
    req.on('error', e => resolve({ ok: false, err: e.message }));
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, err: 'timeout' }); });
    req.write(data);
    req.end();
  });
}
function uiAmt(tok) {
  if (!tok || !tok.uiTokenAmount) return 0;
  if (tok.uiTokenAmount.uiAmount != null) return num(tok.uiTokenAmount.uiAmount);
  const dec = (tok.uiTokenAmount.decimals != null) ? tok.uiTokenAmount.decimals : 6;
  return num(tok.uiTokenAmount.amount) / Math.pow(10, dec);
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------------- 持久化 ---------------- */
function loadStore() {
  ADDR = ctx.readJson('addr.json', null) || { seq: 1000, list: [] };
  if (!Array.isArray(ADDR.list)) ADDR.list = [];
  if (ADDR.seq == null) ADDR.seq = 1000;
  SEEN = ctx.readJson('chainseen.json', null) || { list: [], map: {} };
  if (!Array.isArray(SEEN.list)) SEEN.list = [];
  if (!SEEN.map || typeof SEEN.map !== 'object') SEEN.map = {};
  SEEN.list.forEach(function (t) { SEEN.map[t] = 1; });
  DEPS = ctx.readJson('chaindep.json', null) || { list: [] };
  if (!Array.isArray(DEPS.list)) DEPS.list = [];
  const c = (ctx.config.pay && ctx.config.pay.chain) || {};
  CFG = Object.assign({}, DEFAULT_CFG, c);
  CFG.keys = Object.assign({}, DEFAULT_CFG.keys, c.keys || {});
}
function saveAddr() { return ctx.writeJson('addr.json', ADDR); }
function saveSeen() {
  if (SEEN.list.length > 20000) { SEEN.list = SEEN.list.slice(-20000); }
  return ctx.writeJson('chainseen.json', { list: SEEN.list });
}
function saveDeps() {
  if (DEPS.list.length > 3000) DEPS.list = DEPS.list.slice(0, 3000);
  return ctx.writeJson('chaindep.json', DEPS);
}
function saveCfg() {
  if (!ctx.config.pay) ctx.config.pay = {};
  ctx.config.pay.chain = CFG;
  return ctx.saveConfig();
}

/* ---------------- 地址簿 ---------------- */
function addrList() {
  return ADDR.list.map(function (a) {
    return {
      id: a.id, net: a.net, address: a.address, tag: a.tag || '', label: a.label || '',
      enabled: a.enabled !== false, createdAt: a.createdAt,
      used: a.used || 0, lastTs: a.lastTs || 0, lastAmt: a.lastAmt || 0,
      totalUsdt: r2(a.totalUsdt || 0), scans: a.scans || 0, lastErr: a.lastErr || ''
    };
  });
}
function addrById(id) { return ADDR.list.filter(function (a) { return a.id === id; })[0] || null; }
function normalizeAddr(net, address) {
  const n = netName(net);
  if (!n) return { ok: false, msg: '不支持的链上网络：' + net };
  const a = String(address || '').trim();
  if (!NETS[n].addrRe.test(a)) return { ok: false, msg: n + ' 地址格式不正确' };
  const dup = ADDR.list.filter(function (x) { return x.net === n && lower(x.address) === lower(a); })[0];
  if (dup) return { ok: false, msg: '该地址已存在（' + dup.id + '）' };
  return { ok: true, net: n, address: a };
}
function addrAdd(b) {
  const c = normalizeAddr(b.net, b.address);
  if (!c.ok) return c;
  const a = {
    id: 'A' + (++ADDR.seq), net: c.net, address: c.address,
    tag: String(b.tag || '').trim().slice(0, 32),
    label: String(b.label || '').trim().slice(0, 40) || (c.net + ' 收款地址'),
    enabled: b.enabled !== false, createdAt: Date.now(),
    used: 0, lastTs: 0, lastAmt: 0, totalUsdt: 0, scans: 0, lastErr: ''
  };
  ADDR.list.push(a);
  saveAddr();
  return { ok: true, addr: a };
}
function addrUpdate(b) {
  const a = addrById(String(b.id || ''));
  if (!a) return { ok: false, msg: '地址不存在' };
  if (b.label != null) a.label = String(b.label).slice(0, 40);
  if (b.tag != null) a.tag = String(b.tag).slice(0, 32);
  if (b.enabled != null) a.enabled = !!b.enabled;
  const r = saveAddr();
  return { ok: !!r, addr: a };
}
function addrDel(b) {
  const a = addrById(String(b.id || ''));
  if (!a) return { ok: false, msg: '地址不存在' };
  ADDR.list = ADDR.list.filter(function (x) { return x.id !== a.id; });
  saveAddr();
  return { ok: true };
}
/* 分配收款地址：取该网络下「启用中 + 用时最少」的那个。
   ★ 刻意允许复用：一个地址同时挂多笔订单，靠「金额 + 时间窗」区分归属，
     否则玩家 A 占着地址不下单，玩家 B 就永远拿不到地址。 */
function assign(net, uid) {
  const n = netName(net);
  if (!n) return null;
  const pool = ADDR.list.filter(function (a) { return a.net === n && a.enabled !== false; });
  if (!pool.length) return null;
  pool.sort(function (a, b) { return (a.used || 0) - (b.used || 0) || (a.createdAt - b.createdAt); });
  const a = pool[0];
  a.used = (a.used || 0) + 1;
  saveAddr();
  return { id: a.id, net: a.net, address: a.address, tag: a.tag || '', label: a.label };
}

/* ---------------- 扫描：拉某个地址的 USDT 入账 ---------------- */
async function scanTron(a, sinceMs) {
  const url = 'https://api.trongrid.io/v1/accounts/' + encodeURIComponent(a.address) +
    '/transactions/trc20?only_to=true&limit=100&order_by=block_timestamp,desc&min_timestamp=' + sinceMs;
  const r = await httpGet(url, CFG.keys.tron ? { 'TRON-PRO-API-KEY': CFG.keys.tron } : null);
  if (!r.ok) return { ok: false, err: r.err };
  const data = (r.j && r.j.data) || [];
  const out = [];
  for (const t of data) {
    const ti = t.token_info || {};
    if (lower(ti.address || ti.contract_address) !== lower(NETS.TRC20.contract)) continue;
    if (lower(t.to) !== lower(a.address)) continue;
    const dec = +(ti.decimals != null ? ti.decimals : 6);
    const amt = num(t.value) / Math.pow(10, dec);
    if (!(amt > 0)) continue;
    out.push({ txid: t.transaction_id, ts: num(t.block_timestamp), amount: r2(amt), block: num(t.blockNumber), conf: null });
  }
  /* 确认数：拿最新块高减去交易块高 */
  if (out.length) {
    const nb = await httpGet('https://api.trongrid.io/wallet/getnowblock', CFG.keys.tron ? { 'TRON-PRO-API-KEY': CFG.keys.tron } : null);
    const head = nb.ok && nb.j && nb.j.block_header && nb.j.block_header.raw_data ? num(nb.j.block_header.raw_data.number) : 0;
    out.forEach(function (x) { x.conf = head ? Math.max(0, head - x.block) : 9999; });
  }
  return { ok: true, list: out };
}
async function scanEvm(a, net, sinceMs) {
  const N = NETS[net];
  if (!(CFG.keys && CFG.keys.evm)) {
    return { ok: false, err: 'missing EVM explorer API key (ops)' };
  }
  const key = '&apikey=' + encodeURIComponent(CFG.keys.evm);
  const url = 'https://api.etherscan.io/v2/api?chainid=' + N.chainId +
    '&module=account&action=tokentx&contractaddress=' + N.contract +
    '&address=' + encodeURIComponent(a.address) + '&page=1&offset=100&sort=desc' + key;
  const r = await httpGet(url);
  if (!r.ok) return { ok: false, err: r.err };
  const res = r.j && r.j.result;
  if (typeof res === 'string') return { ok: false, err: 'explorer: ' + String(res).slice(0, 80) };
  if (!Array.isArray(res)) return { ok: true, list: [] };
  const out = [];
  for (const t of res) {
    if (lower(t.to) !== lower(a.address)) continue;
    if (lower(t.contractAddress) !== lower(N.contract)) continue;
    const dec = +(t.tokenDecimal != null ? t.tokenDecimal : 6);
    const amt = num(t.value) / Math.pow(10, dec);
    if (!(amt > 0)) continue;
    if (num(t.timeStamp) * 1000 < sinceMs) continue;
    out.push({
      txid: t.hash, ts: num(t.timeStamp) * 1000, amount: r2(amt),
      block: num(t.blockNumber), conf: num(t.confirmations, 0)
    });
  }
  return { ok: true, list: out };
}
/* Solana：用公共 RPC（JSON-RPC）扫某地址的 USDT(SPL) 入账。
   ★ 思路：先 getTokenAccountsByOwner 拿到该钱包的 USDT 关联代币账户(ATA)，
     再 getSignaturesForAddress 拉该 ATA 的最近交易，逐笔 getTransaction 解析
     postTokenBalances 里「本地址 owner 的 USDT 余额增量」即入账金额。
   ★ 不持有私钥、不发交易，纯只读。 */
async function scanSolana(a, sinceMs) {
  const N = NETS.SOL;
  /* 端点容错：先试后台配置的，再依次试内置公共 RPC 兜底，避免单点不可达就整条链失明 */
  const endpoints = [(CFG.keys && CFG.keys.sol) ? CFG.keys.sol : N.rpc]
    .concat(RPC_FALLBACKS);
  async function rpcCall(method, params) {
    let last = { ok: false, err: 'no rpc tried' };
    for (const url of endpoints) {
      const r = await httpPostJson(url, { jsonrpc: '2.0', id: 1, method: method, params: params });
      if (r.ok) return r;
      last = r;
    }
    return last;
  }
  /* 1) 该钱包的 USDT 关联代币账户(ATA) */
  const r1 = await rpcCall('getTokenAccountsByOwner',
    [a.address, { mint: N.contract }, { encoding: 'jsonParsed', commitment: 'finalized' }]);
  if (!r1.ok) return { ok: false, err: 'sol rpc: ' + (r1.err || 'getTokenAccountsByOwner') };
  const accts = (r1.j && r1.j.result && r1.j.result.value) || [];
  if (!accts.length) return { ok: true, list: [] };   /* 从未持有 USDT，不可能有入账 */
  const ata = accts[0].pubkey;
  /* 2) 拉该 ATA 的最近交易签名 */
  const r2 = await rpcCall('getSignaturesForAddress', [ata, { limit: 50, commitment: 'finalized' }]);
  if (!r2.ok) return { ok: false, err: 'sol rpc: ' + (r2.err || 'getSignaturesForAddress') };
  const sigs = (r2.j && r2.j.result) || [];
  const out = [];
  for (const s of sigs) {
    if (SEEN.map[s.signature]) continue;
    if (typeof s.blockTime === 'number' && s.blockTime * 1000 < sinceMs) continue;
    const r3 = await rpcCall('getTransaction',
      [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    if (!r3.ok || !r3.j || !r3.j.result) { await sleep(120); continue; }
    const tx = r3.j.result;
    const pre = (tx.meta && tx.meta.preTokenBalances) || [];
    const post = (tx.meta && tx.meta.postTokenBalances) || [];
    const mapPre = {}; pre.forEach(p => { mapPre[p.accountIndex] = p; });
    for (const po of post) {
      if (lower(po.mint) !== lower(N.contract)) continue;
      if (lower(po.owner) !== lower(a.address)) continue;   /* 不是转到本地址 */
      const pr = mapPre[po.accountIndex];
      const delta = uiAmt(po) - uiAmt(pr);
      if (!(delta > 0)) continue;
      out.push({
        txid: s.signature,
        ts: (typeof s.blockTime === 'number' ? s.blockTime * 1000 : (num(tx.blockTime) * 1000) || Date.now()),
        amount: r2(delta), block: num(s.slot), conf: 9999
      });
    }
    await sleep(120);   /* 公共 RPC 限流，礼貌一点 */
  }
  return { ok: true, list: out };
}
function pendingOrders() {
  return ctx.orders.list.filter(function (o) {
    return o.type === 'recharge' && o.status === 'pending' && o.address;
  });
}
function creditOrder(o, dep, adminName) {
  /* 走统一的六态状态机：pending → approved → completed，completed 才会加筹码 + 抬可兑现池 */
  const t1 = ctx.orderTransition(o, 'approve', adminName || 'chain', 'chain');
  if (!t1.ok) return { ok: false, msg: t1.msg };
  const t2 = ctx.orderTransition(o, 'approve', adminName || 'chain', 'chain');
  if (!t2.ok) return { ok: false, msg: t2.msg };
  o.txid = dep.txid;
  o.netAmount = dep.amount;                    /* 按**实收**入账，多付的部分也算玩家的 */
  o.chips = U(dep.amount);
  o.note = '链上自动到账 · ' + nowISO();
  o.updatedAt = Date.now();
  /* ★ 上面 transition 到 completed 时已按 o.chips 加过一次（那时还是订单原金额），
       所以这里要把「实收 − 订单额」的差额补上，避免少收/多收对不上账。 */
  const u = ctx.db.users[o.uid];
  if (u) {
    const diff = U(dep.amount - (o.usdt || 0));
    if (diff !== 0) {
      u.bal = U((+u.bal || 0) + diff);
      u.cashable = U((+u.cashable || 0) + diff);
    }
  }
  if (HOOK.ledger) HOOK.ledger(o.uid, 'recharge', o.chips, o.net, 'USDT 充值到账 ' + dep.amount + ' · 订单 ' + o.id + ' · ' + dep.txid.slice(0, 16));
  /* ★ 2026-10-05 审计修复：邀请奖励改「首充后发放」（注册不再即发，堵注册刷号套利） */
  (function () {
    const nu = ctx.db.users[o.uid];
    if (nu && nu.refBy && !nu.refPaid) {
      nu.refPaid = true;
      const inv = ctx.db.users[nu.refBy];
      const ec = ctx.config.econ || {};
      const reward = Math.max(0, Math.round(+ec.inviteReward || 0));
      const cap = Math.max(1, Math.round(+ec.inviteDayCap || 20));
      const today = new Date().toISOString().slice(0, 10);
      if (inv && !inv.banned && reward > 0) {
        if (inv.inviteDay !== today) { inv.inviteDay = today; inv.inviteDayN = 0; }
        if ((inv.inviteDayN || 0) < cap) {
          inv.bal = U((+inv.bal || 0) + reward);
          inv.cashable = U((+inv.cashable || 0) + reward);
          inv.inviteDayN = (inv.inviteDayN || 0) + 1;
          inv.inviteCount = Math.round((+inv.inviteCount || 0) + 1);
          if (HOOK.mail) HOOK.mail(inv.id, '系统', '邀请奖励到账',
            '你邀请的好友「' + (nu.name || '') + '」已完成首次充值，邀请奖励 ' + reward.toFixed(2) + ' USDT 已到账。', null);
          ctx.audit(inv.name, 'invite-reward', nu.id, '邀请好友首充到账 · +' + reward + ' USDT', '', 'system');
        }
      }
      if (ctx.saveDB) ctx.saveDB();
    }
  })();
  if (HOOK.mail) HOOK.mail(o.uid, '系统', '充值到账通知',
    '你的充值订单 ' + o.id + ' 已到账：' + dep.amount + ' USDT → ' + o.chips + ' 筹码（' + o.net + ' · ' + dep.txid.slice(0, 20) + '…）。祝你玩得开心。', null);
  ctx.audit('chain', 'deposit-auto', o.id,
    '链上自动到账 ' + dep.amount + ' USDT（订单 ' + o.usdt + '）· ' + o.net + ' · tx=' + dep.txid.slice(0, 20) + ' · 筹码 +' + o.chips, '', 'admin');
  return { ok: true, chips: o.chips };
}
function matchDeposit(dep, addr) {
  const tol = Math.max(0.01, num(CFG.tolerance, 0.005));
  const cands = pendingOrders().filter(function (o) {
    if (netName(o.net) !== addr.net) return false;
    if (lower(o.address) !== lower(addr.address)) return false;
    if (o.createdAt - dep.ts > 120000) return false;              /* 入账早于下单 2 分钟以上 → 不是这笔 */
    if (dep.ts - o.createdAt > num(CFG.windowMin, 60) * 60000) return false;  /* 订单已过期 */
    return dep.amount >= (o.usdt || 0) * (1 - tol) - 0.01;
  }).sort(function (a, b) { return a.createdAt - b.createdAt; });
  return cands[0] || null;
}

/* ---------------- 一轮扫描 ---------------- */
async function scanOnce(manual) {
  if (!ctx) return { ok: false, err: 'not init' };
  const since = Date.now() - Math.max(1, num(CFG.scanHours, 24)) * 3600000;
  let scanned = 0, matched = 0, err = '', hardErr = '';
  const list = ADDR.list.filter(function (a) { return a.enabled !== false; });
  for (const a of list) {
    const N = netOf(a.net); if (!N) continue;
    let r;
    if (N.kind === 'tron') r = await scanTron(a, since);
    else if (N.kind === 'sol') r = await scanSolana(a, since);
    else r = await scanEvm(a, a.net, since);
    a.scans = (a.scans || 0) + 1;
    a.lastErr = r.ok ? '' : String(r.err || '').slice(0, 80);
    if (!r.ok) {
      const soft = String(r.err || '').indexOf('missing') >= 0;
      err = a.net + ' ' + a.address.slice(0, 10) + '：' + r.err;
      if (!soft) hardErr = err;
      continue;
    }
    const minConf = Math.max(1, num(CFG.minConf, N.minConf));
    for (const d of r.list) {
      if (SEEN.map[d.txid]) continue;
      if (num(d.conf, 0) < minConf) continue;                     /* 确认数不够，下一轮再看 */
      SEEN.map[d.txid] = 1; SEEN.list.push(d.txid);
      scanned++;
      const dep = {
        id: 'D' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        txid: d.txid, net: a.net, address: a.address, addrId: a.id,
        amount: d.amount, ts: d.ts, conf: num(d.conf, 0),
        orderId: null, uid: null, user: '', credited: 0, at: Date.now()
      };
      const o = matchDeposit(d, a);
      if (o && CFG.autoCredit) {
        const cr = creditOrder(o, dep, 'chain');
        if (cr.ok) {
          dep.orderId = o.id; dep.uid = o.uid; dep.user = o.user || ''; dep.credited = o.chips;
          matched++;
          a.lastTs = Date.now(); a.lastAmt = d.amount;
          a.totalUsdt = r2((+a.totalUsdt || 0) + d.amount);
        } else {
          dep.failMsg = cr.msg || '入账失败';
        }
      }
      DEPS.list.unshift(dep);
    }
    /* 未匹配但已确认的入账：地址统计照记 */
    a.lastTs = a.lastTs || 0;
  }
  await saveSeen(); await saveDeps(); await saveAddr();
  if (matched) { await ctx.saveOrders(); await ctx.saveDB(); }
  LAST = { at: Date.now(), ok: !hardErr, err: hardErr || err, scanned: scanned, matched: matched };
  return { ok: true, scanned: scanned, matched: matched, err: hardErr || err, addrs: list.length, manual: !!manual };
}

/* ---------------- 轮询 ---------------- */
function start() {
  stop();
  if (!CFG.on) return false;
  running = true;
  const tick = async function () {
    if (!running) return;
    try { await scanOnce(false); } catch (e) { LAST = { at: Date.now(), ok: false, err: String(e && e.message || e), scanned: 0, matched: 0 }; }
    if (running) timer = setTimeout(tick, Math.max(10000, num(CFG.pollMs, 30000)));
  };
  timer = setTimeout(tick, 3000);
  return true;
}
function stop() { running = false; if (timer) { clearTimeout(timer); timer = null; } }

/* ---------------- 对外 ---------------- */
function init(c, hooks) {
  ctx = c; HOOK = hooks || {};
  loadStore();
  start();
}
function cfgGet() {
  return {
    cfg: Object.assign({}, CFG, { keys: { tron: !!CFG.keys.tron, evm: !!CFG.keys.evm, sol: !!CFG.keys.sol } }),
    nets: Object.keys(NETS).map(function (k) {
      return { net: k, minConf: NETS[k].minConf, note: NETS[k].note, contract: NETS[k].contract };
    }),
    running: running, last: LAST,
    stats: {
      addrs: ADDR.list.length, enabled: ADDR.list.filter(a => a.enabled !== false).length,
      deps: DEPS.list.length,
      unmatched: DEPS.list.filter(d => !d.orderId).length,
      matched: DEPS.list.filter(d => !!d.orderId).length
    }
  };
}
function cfgSet(b) {
  if (b.on != null) CFG.on = !!b.on;
  if (b.autoCredit != null) CFG.autoCredit = !!b.autoCredit;
  if (b.pollMs != null) CFG.pollMs = Math.max(10000, Math.min(600000, num(b.pollMs, 30000)));
  if (b.minConf != null) CFG.minConf = (b.minConf === '' || b.minConf == null) ? null : Math.max(1, Math.min(200, num(b.minConf, 1)));
  if (b.tolerance != null) CFG.tolerance = Math.max(0, Math.min(0.1, num(b.tolerance, 0.005)));
  if (b.windowMin != null) CFG.windowMin = Math.max(5, Math.min(1440, num(b.windowMin, 60)));
  if (b.scanHours != null) CFG.scanHours = Math.max(1, Math.min(72, num(b.scanHours, 24)));
  if (b.keys && typeof b.keys === 'object') {
    if (b.keys.tron != null) CFG.keys.tron = String(b.keys.tron).trim();
    if (b.keys.evm != null) CFG.keys.evm = String(b.keys.evm).trim();
    if (b.keys.sol != null) CFG.keys.sol = String(b.keys.sol).trim();
  }
  saveCfg();
  if (CFG.on) start(); else stop();
  return cfgGet();
}
/* 后台手动补单：把一条未认领的入账挂到指定订单上 */
function claim(b) {
  const dep = DEPS.list.filter(function (d) { return d.id === String(b.depId || ''); })[0];
  if (!dep) return { ok: false, msg: '入账记录不存在' };
  if (dep.orderId) return { ok: false, msg: '该入账已认领（订单 ' + dep.orderId + '）' };
  const o = ctx.orders.list.filter(function (x) { return x.id === String(b.orderId || ''); })[0];
  if (!o) return { ok: false, msg: '订单不存在' };
  if (o.type !== 'recharge') return { ok: false, msg: '只能补到充值订单' };
  if (o.status !== 'pending' && o.status !== 'approved') return { ok: false, msg: '订单状态为「' + o.status + '」，无法补单' };
  const cr = creditOrder(o, { txid: dep.txid, amount: dep.amount }, 'admin');
  if (!cr.ok) return { ok: false, msg: cr.msg };
  dep.orderId = o.id; dep.uid = o.uid; dep.user = o.user || ''; dep.credited = cr.chips;
  saveDeps();
  return { ok: true, chips: cr.chips, order: ctx.orderPublic(o) };
}
function depList(q) {
  const n = Math.max(1, Math.min(200, num(q && q.limit, 60)));
  const only = q && q.only ? String(q.only) : '';
  let list = DEPS.list.slice();
  if (only === 'unmatched') list = list.filter(d => !d.orderId);
  if (only === 'matched') list = list.filter(d => !!d.orderId);
  return list.slice(0, n);
}

module.exports = {
  init: init, start: start, stop: stop, scanOnce: scanOnce,
  assign: assign, netOf: netOf, netName: netName, NETS: NETS,
  addrList: addrList, addrAdd: addrAdd, addrUpdate: addrUpdate, addrDel: addrDel,
  cfgGet: cfgGet, cfgSet: cfgSet, claim: claim, depList: depList,
  getCfg: function () { return CFG; }
};

