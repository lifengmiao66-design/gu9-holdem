# GU9 Texas Hold'em（德州扑克）

GU9 · Texas Hold'em — a **demo / white-label style** poker web client + Node API.

- **Demo site:** https://gu9.click/
- **Contact:** [@king678ace](https://x.com/king678ace)（GitHub / X handle）

本仓库为可运行的演示源码（UI + API），用于界面与玩法展示 / 白标评估，**不是**完整生产运维包。线上演示见 https://gu9.click/ 。

## 目录结构 Structure

```
gu9-ui/     # 静态前端（HTML / CSS / JS，PWA）
gu9-api/    # Node.js 后端（零 npm 依赖，JSON 落盘）
.env.example
```

There is **no `package.json`** in this tree: the API is plain Node (`require` / stdlib only), and the UI is static files.

## 快速运行 How to run

### 1) API（必需）

```bash
cd gu9-api
export GU9_ADMIN_PASS='your-strong-password'   # required — server exits if unset
export GU9_ADMIN_USER=admin                    # optional, default admin
export PORT=3010
export HOST=127.0.0.1
node server.js
```

- Player API prefix: `/papi/...`
- Admin console: `http://127.0.0.1:3010/`（`admin-web/`）
- Data directory: `gu9-api/data/`（empty seed included; created/updated at runtime）

可选：复制根目录 `.env.example` 为 `.env` 后自行用 `dotenv` / `source` 加载（本仓库未内置 dotenv 依赖）。

### 2) UI

用任意静态服务器托管 `gu9-ui/`，并把 `/papi` 反代到 API（生产示例域名：gu9.click）。

本地简易示例（需先启动 API）：

```bash
# from repo root — example with Python http.server + a reverse proxy of your choice
cd gu9-ui
python3 -m http.server 8080
# then configure nginx/caddy so /papi → http://127.0.0.1:3010/papi
```

无后端时也可打开 `gu9-ui/preview.html` 查看部分静态预览。

### 3) 测试（可选）

```bash
cd gu9-api
node test_poker.js
node test_table.js
```

## 说明 Notes

- 筹码 / 余额为演示用途；请遵守当地法律法规，理性娱乐。
- 管理口令、链上 explorer API Key 等请只放在环境变量或后台配置中，**不要**提交真实密钥。
- `gu9-api/data/config.json` 中的 `pay.chain.keys` 已清空；如需链上充值扫描，请在后台或本地配置中自行填写。

## License / Contact

Demo source for evaluation. Questions → **@king678ace**
