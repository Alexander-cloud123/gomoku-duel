# 测试指南

## 自动化

```bash
npm test        # Node 内置测试运行器（node:test）
npm run lint    # ESLint 9 flat config
npm run check:ids   # 页面 id 与脚本引用一致性
npm run check:docs  # 文档相对链接与图片存在性
npm run ci      # 以上全部检查加测试（与 CI 一致）
```

测试文件：

| 文件 | 覆盖 |
| --- | --- |
| `tests/gomoku-rules.test.mjs` | 落子、四方向连五、六连、成五连线、满盘 |
| `tests/go-rules.test.mjs` | 棋组与气、提子、自杀、打劫、超级劫、数子、死子 |
| `tests/game.test.mjs` | 回合校验、胜负、悔棋与次数、认输、双虚手点目、快照恢复 |
| `tests/notation.test.mjs` | 坐标记谱、棋盘尺寸、Zobrist |
| `tests/protocol.test.mjs` | 版本、信封、载荷范围、快照校验、体积上限 |
| `tests/session.test.mjs` | 握手、落子同步、去重、伪造消息、悔棋、认输、和棋、重开、围棋点目、断线重连 |
| `tests/ai.test.mjs` | 棋型识别、威胁、引擎选点/堵四/时间预算/不修改入参、围棋合法性与自杀规避 |

联机会话测试使用 `tests/helpers/memory-transport.mjs` 的内存传输，不依赖浏览器或 PeerJS。

## 真实浏览器冒烟（可选）

仓库提供一个基于 Chrome DevTools Protocol 的冒烟脚本，验证页面初始化、模式切换、Canvas 尺寸、人机对局与 AI 辅助：

```bash
npm run dev                                   # 终端 1
# 终端 2：启动带远程调试端口的无头浏览器（以 Edge 为例）
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --headless=new --disable-gpu --remote-debugging-port=9223 --window-size=1280,900 about:blank
# 终端 3
node scripts/smoke-e2e.mjs
```

脚本会检查：页面状态、围棋设置显隐、Canvas 后备缓冲与 DPR、围棋/五子棋 AI 出招、AI 辅助推荐、深链、未捕获异常与控制台错误。脚本固定 1280×900 视口，结果不随窗口大小变化。

需要更新 README 截图时，用同一脚本输出 WebP：

```bash
SMOKE_SHOT_DIR=docs/assets node scripts/smoke-e2e.mjs
```

Windows PowerShell：

```powershell
$env:SMOKE_SHOT_DIR='docs/assets'; node scripts/smoke-e2e.mjs
```

会生成 `docs/assets/home.webp`（首页）与 `docs/assets/game.webp`（围棋人机对局）。截图只包含页面本身，不含房间号、账号或本地数据。

另有真实 PeerJS 联机冒烟（两个页面，需要外网访问 PeerJS 公共信令）：

```bash
node scripts/smoke-online.mjs
```

覆盖：建房、加入、颜色分配、双向落子、悔棋请求/同意、认输结算。

## 手工验收矩阵（两个浏览器窗口）

启动 `npm run dev`，打开两个标签页（或一普通一隐身）以确保独立 Peer。

| 用例 | 步骤 | 期望 |
| --- | --- | --- |
| 创建/加入 | A 创建房间 → B 输入房间号 | B 进入对局，A 执黑 |
| 落子同步 | A 落子 → B 落子 | 双端棋盘一致，回合正确 |
| 非法落子 | 轮到 A 时 B 点击棋盘 | 无落子，提示“还没轮到你” |
| 悔棋 | B 申请 → A 同意 | 双端回退到 B 上次落子前 |
| 拒绝悔棋 | B 申请 → A 拒绝 | B 收到提示，盘面不变 |
| 和棋 | A 申请 → B 同意 | 双端显示和棋 |
| 认输 | A 认输 | 双端显示 B 胜 |
| 再来一局 | A 申请 → B 同意 | 双端清盘重开 |
| 断线 | B 关闭网络/刷新 | A 显示重连中；60 秒内恢复则同步，否则判离开 |
| 房间已满 | 第三人尝试加入 | 提示房间已满 |
| 模式不匹配 | A 开五子棋，B 选围棋加入 | B 提示并切换后重连 |
| 深链 | 打开 `?room=CODE` | 自动填入房间号 |

## 移动端检查

- 375px 宽：无横向滚动，棋盘完整可见，侧栏在下方
- 触控落子命中准确，悬停残影不残留
- 旋转屏幕后棋盘重新适配
- 弹窗可滚动、按钮可点

## 围棋终局

- 双方连续虚手 → 进入点目
- 点击棋组标记死子，对端同步
- 双方确认后结算；一人确认时提示等待
- 死子被移除、领地归属正确

## 已知限制

- 未接入浏览器自动化，Canvas 交互依赖手工矩阵
- PeerJS 使用公共信令服务器；极端 NAT 环境需要自建 TURN（`Transport` 已预留 ICE 配置）
- 断线重连以房主状态为准，断线期间的操作不会重放
