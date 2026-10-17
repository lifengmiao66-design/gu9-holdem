'use strict';
/* clubs.js —— 俱乐部脚手架（CRUD + 成员/钱包操作挂钩）
   数据：data/clubs.json
   管理端：/papi/admin/clubs*
   玩家端：/papi/clubs*（列表 / 创建 / 加入 / 离开）
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createClubs(ctx) {
  const fpath = path.join(ctx.DATA, 'clubs.json');
  function load() {
    try { return JSON.parse(fs.readFileSync(fpath, 'utf8')); }
    catch (e) { return { clubs: {}, seq: 1000 }; }
  }
  function save(store) {
    return ctx.writeJson('clubs.json', store);
  }
  let STORE = load();

  function newId() {
    STORE.seq = (STORE.seq || 1000) + 1;
    return 'C' + STORE.seq;
  }
  function pub(c) {
    return {
      id: c.id, name: c.name, desc: c.desc || '', owner: c.owner,
      ownerName: (ctx.db.users[c.owner] && ctx.db.users[c.owner].name) || c.owner,
      members: (c.members || []).length, maxMembers: c.maxMembers || 200,
      bal: +c.bal || 0, status: c.status || 'active',
      createdAt: c.createdAt, updatedAt: c.updatedAt || c.createdAt
    };
  }

  async function handleAdmin(req, res, p, b, send, err) {
    if (p === '/papi/admin/clubs' && req.method === 'GET') {
      const q = String((req._u && req._u.searchParams.get('q')) || '').trim().toLowerCase();
      let list = Object.keys(STORE.clubs).map(k => STORE.clubs[k]);
      if (q) list = list.filter(c => (c.name || '').toLowerCase().indexOf(q) >= 0 || c.id.toLowerCase().indexOf(q) >= 0);
      list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
      return send({ total: list.length, list: list.map(pub) }), true;
    }
    if (p === '/papi/admin/clubs' && req.method === 'POST') {
      const name = String(b.name || '').trim().slice(0, 32);
      if (!name) return err(400, '请填写俱乐部名称'), true;
      const owner = String(b.owner || '').trim();
      if (owner && !ctx.db.users[owner]) return err(404, '房主用户不存在'), true;
      const id = newId();
      const now = Date.now();
      const c = {
        id: id, name: name, desc: String(b.desc || '').slice(0, 200),
        owner: owner || '', members: owner ? [owner] : [],
        maxMembers: Math.min(2000, Math.max(2, +(b.maxMembers) || 200)),
        bal: 0, status: 'active', createdAt: now, updatedAt: now, ledger: []
      };
      STORE.clubs[id] = c;
      await save(STORE);
      try { ctx.audit(ctx.ADMIN_USER, 'club-create', id, name); } catch (e) {}
      return send({ club: pub(c) }), true;
    }
    let m = /^\/papi\/admin\/clubs\/([A-Za-z0-9]+)$/.exec(p);
    if (m && req.method === 'GET') {
      const c = STORE.clubs[m[1]];
      if (!c) return err(404, '俱乐部不存在'), true;
      const members = (c.members || []).map(uid => {
        const u = ctx.db.users[uid];
        return { id: uid, name: (u && u.name) || uid, bal: u ? (+u.bal || 0) : 0 };
      });
      return send({ club: pub(c), members: members, ledger: (c.ledger || []).slice(-50) }), true;
    }
    if (m && (req.method === 'PATCH' || req.method === 'POST')) {
      const c = STORE.clubs[m[1]];
      if (!c) return err(404, '俱乐部不存在'), true;
      if (b.name != null) c.name = String(b.name).trim().slice(0, 32) || c.name;
      if (b.desc != null) c.desc = String(b.desc).slice(0, 200);
      if (b.status === 'active' || b.status === 'frozen' || b.status === 'closed') c.status = b.status;
      if (b.maxMembers != null) c.maxMembers = Math.min(2000, Math.max(2, +b.maxMembers || c.maxMembers));
      if (b.owner != null) {
        const ow = String(b.owner).trim();
        if (ow && !ctx.db.users[ow]) return err(404, '房主用户不存在'), true;
        c.owner = ow;
        if (ow && (c.members || []).indexOf(ow) < 0) c.members.push(ow);
      }
      /* 钱包操作：给俱乐部池加减 USDT（运营调账） */
      if (b.walletDelta != null) {
        const d = Math.round(+b.walletDelta * 100) / 100;
        if (!isFinite(d) || d === 0) return err(400, '调账金额无效'), true;
        c.bal = Math.round(((+c.bal || 0) + d) * 100) / 100;
        c.ledger = c.ledger || [];
        c.ledger.push({ ts: Date.now(), type: 'admin-adjust', amount: d, after: c.bal, note: String(b.note || '后台调账').slice(0, 80), admin: ctx.ADMIN_USER });
        try { ctx.audit(ctx.ADMIN_USER, 'club-wallet', c.id, d + ' → ' + c.bal); } catch (e) {}
      }
      /* 成员增减 */
      if (b.addMember) {
        const uid = String(b.addMember);
        if (!ctx.db.users[uid]) return err(404, '用户不存在'), true;
        c.members = c.members || [];
        if (c.members.indexOf(uid) < 0) {
          if (c.members.length >= (c.maxMembers || 200)) return err(400, '人数已满'), true;
          c.members.push(uid);
        }
      }
      if (b.removeMember) {
        const uid = String(b.removeMember);
        c.members = (c.members || []).filter(x => x !== uid);
        if (c.owner === uid) c.owner = c.members[0] || '';
      }
      c.updatedAt = Date.now();
      await save(STORE);
      return send({ club: pub(c) }), true;
    }
    if (m && req.method === 'DELETE') {
      const c = STORE.clubs[m[1]];
      if (!c) return err(404, '俱乐部不存在'), true;
      c.status = 'closed'; c.updatedAt = Date.now();
      await save(STORE);
      try { ctx.audit(ctx.ADMIN_USER, 'club-close', c.id, c.name); } catch (e) {}
      return send({ ok: true }), true;
    }
    return false;
  }

  async function handlePlayer(req, res, p, b, uid, send, err) {
    if (p === '/papi/clubs' && req.method === 'GET') {
      const list = Object.keys(STORE.clubs)
        .map(k => STORE.clubs[k])
        .filter(c => c.status === 'active')
        .map(pub);
      return send({ list: list }), true;
    }
    if (p === '/papi/clubs/mine' && req.method === 'GET') {
      const list = Object.keys(STORE.clubs)
        .map(k => STORE.clubs[k])
        .filter(c => c.status !== 'closed' && (c.members || []).indexOf(uid) >= 0)
        .map(pub);
      return send({ list: list }), true;
    }
    if (p === '/papi/clubs/create' && req.method === 'POST') {
      const name = String(b.name || '').trim().slice(0, 32);
      if (!name) return err(400, '请填写俱乐部名称'), true;
      const owned = Object.keys(STORE.clubs).map(k => STORE.clubs[k])
        .filter(c => c.status !== 'closed' && c.owner === uid);
      if (owned.length >= 3) return err(403, '每人最多创建 3 个俱乐部'), true;
      const id = newId();
      const now = Date.now();
      const c = {
        id: id, name: name, desc: String(b.desc || '').slice(0, 200),
        owner: uid, members: [uid],
        maxMembers: Math.min(500, Math.max(2, +(b.maxMembers) || 200)),
        bal: 0, status: 'active', createdAt: now, updatedAt: now, ledger: []
      };
      STORE.clubs[id] = c;
      await save(STORE);
      try { ctx.audit((ctx.db.users[uid] && ctx.db.users[uid].name) || uid, 'club-create', id, name, '-', 'user'); } catch (e) {}
      return send({ club: pub(c) }), true;
    }
    if (p === '/papi/clubs/join' && req.method === 'POST') {
      const c = STORE.clubs[String(b.id || '')];
      if (!c || c.status !== 'active') return err(404, '俱乐部不存在或已关闭'), true;
      c.members = c.members || [];
      if (c.members.indexOf(uid) >= 0) return send({ club: pub(c) }), true;
      if (c.members.length >= (c.maxMembers || 200)) return err(400, '人数已满'), true;
      c.members.push(uid); c.updatedAt = Date.now();
      await save(STORE);
      return send({ club: pub(c) }), true;
    }
    if (p === '/papi/clubs/leave' && req.method === 'POST') {
      const c = STORE.clubs[String(b.id || '')];
      if (!c) return err(404, '俱乐部不存在'), true;
      c.members = (c.members || []).filter(x => x !== uid);
      if (c.owner === uid) c.owner = c.members[0] || '';
      c.updatedAt = Date.now();
      await save(STORE);
      return send({ ok: true }), true;
    }
    return false;
  }

  return { handleAdmin: handleAdmin, handlePlayer: handlePlayer, reload: function () { STORE = load(); } };
}

module.exports = { createClubs: createClubs };
