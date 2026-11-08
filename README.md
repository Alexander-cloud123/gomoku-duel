# 棋盘对弈（Gomoku Duel v2）

浏览器五子棋 / 围棋，支持 **WebRTC 点对点联机**、**本地 AI 辅助** 与 **人机对战**。纯静态部署，无需服务器、无需构建。

在线试玩：https://alexander-cloud123.github.io/gomoku-duel/

---

## 功能概览

### 联机对战（P2P）

- 房主创建 6 位房间号，对手输入即可直连，游戏数据不经服务器
- 握手会校验棋种、棋盘尺寸、贴目与协议版本，模式不匹配会明确提示
- 落子合法性由两端规则共同校验；消息带序号，重复/乱序会被去重并自动重同步
- 心跳检测 + 断线重连（60 秒窗口），重连后自动同步盘面
- 悔棋 / 和棋 / 认输 / 再来一局都需要对方同意；操作有冷却与次数限制
- 房间满员、房间不存在、创建冲突等错误都有中文提示

### 人机对战

- 三档难度：入门 / 进阶 / 高手（五子棋与围棋共用入口）
- AI 在 Web Worker 中思考，主线程不卡顿；Worker 不可用时自动降级
- 围棋 AI 会判断虚手，避免自杀与打劫禁着

### AI 辅助（可在设置中关闭）

- 推荐落点 + 备选点
- 局面评估（启发式，非概率真值）
- 对手威胁提示（活四 / 冲四 / 双三 / 四三）
- 提示在本地计算，零 API、零联网

### 围棋

- 9 / 13 / 19 路，可配贴目（5.5 / 6.5 / 7.5）
- 提子、自杀禁着、打劫、位置超级劫
- 双虚手进入终局点目：可点击棋组标记死子，双方确认后按中国规则数子结算
- 悔棋会完整恢复盘面、提子数与劫状态

### 体验细节

- Canvas 按设备像素比渲染，移动端不糊
- 指针/键盘双输入：方向键移动光标，Enter 落子
- 落子动画、最后落子标记、连五连线高亮、打劫标记
- 可滚动走子记录、提子与贴目信息、本地战绩
- 统一模态框（替代 `alert`/`confirm`）、Toast 提示、焦点陷阱与 Esc 关闭
- 深链邀请：`?room=CODE&mode=go`

---

## 快速开始

需要 Node.js 20+（仅用于本地开发服务器与测试，运行游戏本身不需要）。

```bash
git clone https://github.com/Alexander-cloud123/gomoku-duel.git
cd gomoku-duel
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 。

> 不能直接双击 `index.html`：浏览器会以 `file://` 加载页面，ES Module 与 Worker 会被 CORS 拦截。请用 `npm run dev`，或部署到任意静态服务器。

### 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地静态服务器（127.0.0.1:5173） |
| `npm test` | Node 内置测试（规则 / 协议 / 联机会话 / AI） |
| `npm run lint` | ESLint 检查 |
| `npm run ci` | lint + 全部测试 |
| `npm run check:ids` | 校验页面元素 id 与脚本引用是否一致 |

---

## 玩法

### 联机

1. 房主选择棋种与设置，点击「创建房间」
2. 把房间号或邀请链接发给对手
3. 对手点击「加入房间」输入房间号（或直接打开邀请链接）
4. 房主执黑先行

### 人机

1. 在首页切换到「人机对战」
2. 选择棋种、难度，点击「开始人机对战」
3. 你执黑，AI 执白

### 断线与重连

连接中断时页面会显示「连接中断，正在恢复…」。60 秒内恢复会重新同步盘面；超过时限则判定对手离开，返回首页重新开房。

---

## 规则说明

- **五子棋**：15 路，无禁手，任意方向连成 5 子（含 6 子及以上）即胜；棋盘下满且无人连五为和棋。
- **围棋**：中国规则数子（子 + 地），白方贴目；连续两次虚手进入点目；死子需双方标记并确认；打劫与位置超级劫禁止重复局面。

AI 的「评估」是基于棋型与搜索分数的启发式估计，不代表真实胜率，仅供参照。

---

## 技术栈

- 原生 HTML / CSS / ES Modules，无框架、无构建步骤
- Canvas 2D 渲染
- [PeerJS](https://peerjs.com/)（WebRTC 信令与 P2P 数据通道，本地 `lib/peerjs.min.js`）
- Web Worker + 迭代加深 Alpha-Beta + 置换表（五子棋），启发式一手评估（围棋）
- Node 内置测试运行器 + ESLint（开发期）
- GitHub Actions（Node 20 / 22）

---

## 项目结构

```
index.html              # 页面结构
style.css               # 样式（响应式 / 深浅对比 / 模态 / Toast）
js/
  main.js               # 模块入口
  app.js                # 应用控制器（页面流转、联机/PvE 调度）
  board.js              # 棋盘视图（Canvas、DPR、指针/键盘输入、动画）
  game.js               # 对局状态机（规则、悔棋、终局点目）
  rules/                # 纯规则：五子棋 / 围棋 / Zobrist / 常量与记谱
  net/                  # 传输（PeerJS）、协议、会话（握手/心跳/重连）
  ai/                   # 棋型、五子棋引擎、围棋引擎、Worker、客户端
  ui/                   # 页面、模态、Toast、本地设置与战绩
  room.js               # 房间号
scripts/                # 本地服务器与一致性检查
tests/                  # 规则 / 协议 / 会话 / AI 测试
docs/                   # 架构、协议、测试与变更记录
lib/peerjs.min.js       # 本地 PeerJS 副本
```

更详细的设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，消息格式见 [docs/PROTOCOL.md](docs/PROTOCOL.md)，测试方法见 [docs/TESTING.md](docs/TESTING.md)。

---

## 测试与 CI

```bash
npm run ci
```

当前覆盖 60+ 用例：五子棋规则、围棋规则（提子 / 自杀 / 劫 / 超级劫 / 数子 / 死子）、状态机与悔棋、协议校验、双端会话（内存传输：落子、悔棋、认输、和棋、重开、去重、伪造消息、断线重连）、AI 棋型与引擎。

---

## 部署

仓库根目录即静态站点，可直接用于 GitHub Pages：

1. 推送到 `main`
2. Settings → Pages → Source: `main` / `(root)`
3. 访问 `https://<用户名>.github.io/gomoku-duel/`

运行时不需要 npm 依赖，`index.html` + `js/` + `lib/` 即可。

---

## 浏览器支持

Chrome / Edge / Firefox / Safari 15+，以及现代移动浏览器。需要 WebRTC、Canvas 2D、ES Modules 与 Web Worker。

---

## 许可

[MIT](LICENSE)
