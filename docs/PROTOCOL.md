# 联机协议（v1）

实现见 `js/net/protocol.js`、`js/net/session.js`、`js/net/webrtc.js`。

## 信封

每条消息都是：

```json
{ "v": 1, "seq": 12, "t": "MOVE", "p": { "x": 7, "y": 7, "color": 1, "turnSeq": 5 } }
```

- `v`：协议版本，当前为 `1`；不一致时接收方回 `REJECT{PROTO_MISMATCH}` 并终止本次连接
- `seq`：发送方单调递增序号，从 1 开始；接收方丢弃 `seq <= lastSeq`，缺口触发重同步；**每个新连接从 0 重新计数**
- `t`：消息类型
- `p`：载荷；单条消息上限 64 KB

## 握手

两端建立数据通道后各自发送 `HELLO`：

| 字段 | 说明 |
| --- | --- |
| `mode` | `gomoku` / `go` |
| `size` | 棋盘路数（五子棋 15，围棋 9/13/19） |
| `komi` | 围棋贴目 |
| `assist` | 是否启用 AI 辅助 |
| `undoLimit` | 每人悔棋上限 |
| `proto` | 协议版本 |
| `name` | 昵称 |
| `playerId` | 本端临时标识 |

收到 `HELLO` 后回复 `HELLO_ACK`（字段同 `HELLO`）。两端都收到 `HELLO` 且发出/收到 `HELLO_ACK` 后进入 `ready`。

- **房主权威**：棋种、棋盘尺寸、贴目、辅助开关、悔棋上限以房主为准
- 棋种 / 尺寸 / 贴目 / 辅助开关不一致：以房主为准，访客在握手阶段自动采用房主的设置并提示，房主不会因此断开
- 协议版本不一致：`REJECT{PROTO_MISMATCH}`
- 已有连接时新连接会被 `REJECT{ROOM_FULL}` 拒绝

## 对局消息

| 类型 | 方向 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `MOVE` | 双 | `{x, y, color, turnSeq}` | `turnSeq` = 落子前的历史手数，用于检测错位 |
| `PASS` | 双 | `{color}` | 围棋虚手 |
| `UNDO_REQUEST` | 双 | `{color}` | 申请悔棋，`color` 为申请方 |
| `UNDO_ACCEPT` / `UNDO_REJECT` | 反向 | `{color}` | 同意后两端都回退到申请方上次落子之前 |
| `DRAW_REQUEST` | 双 | `{}` | 和棋申请 |
| `DRAW_ACCEPT` / `DRAW_REJECT` | 反向 | `{}` | 同意后双端置为和棋 |
| `RESIGN` | 双 | `{color}` | 认输，双端结算 |
| `RESTART_REQUEST` | 双 | `{}` | 再来一局 |
| `RESTART_ACCEPT` / `RESTART_REJECT` | 反向 | `{}` | 同意后双端重置 |
| `MARK_DEAD` | 双 | `{x, y, dead:[...]}` | 点目阶段；`dead` 为完整死子集合（幂等） |
| `SCORE_CONFIRM` | 双 | `{color, hash}` | 确认计分；哈希不一致会触发重同步 |
| `SYNC_REQUEST` | 访客 | `{}` | 请求房主下发状态 |
| `SYNC_STATE` | 房主 | `{snapshot, hash}` | 完整快照与状态哈希 |
| `PING` / `PONG` | 双 | `{ts}` | 心跳，3 秒一次 |
| `BYE` | 双 | `{}` | 主动离开 |
| `ERROR` | 双 | `{code, message}` | 通用错误通知 |

- `DRAW_REQUEST` 与 `RESIGN` 仅在 `playing` 阶段有效；进入 `scoring` 后只能通过双方 `SCORE_CONFIRM` 结束对局
- `BYE` 只在握手完成后（`ready`）被接受，握手前收到会被忽略

## 一致性

- 落子只在本地 `Game` 上执行一次；收到 `MOVE` 时校验颜色、`turnSeq` 与回合合法性，失败则请求重同步
- `seq` 缺口：访客发 `SYNC_REQUEST`，房主直接下发 `SYNC_STATE`
- 房主收到 `SYNC_REQUEST` 时用当前 `Game.snapshot()` 与 `stateHash()` 回复；访客恢复后比对哈希
- 快照包含 `cells / turn / moveHistory / captures / koPoint / passCount / phase / deadStones / agreed / undoUsed`
- 上述字段存在时按类型与范围校验，缺失时由 `Game.restore` 取默认值（兼容旧客户端）
- 快照中 `myColor` 由接收方覆盖，不使用对端身份

## 心跳与重连

- 每 3 秒发送 `PING`；任意 `PONG` 刷新存活时间
- 12 秒无响应 → 进入 `reconnecting`，界面显示横幅
- 访客每 5 秒尝试重连；房主等待新的连接
- 重连成功后重新握手，访客自动请求 `SYNC_STATE`
- 60 秒仍无法恢复 → 判定对手离开

## 安全与限流

- 未完成握手前只接受 `HELLO / HELLO_ACK / REJECT / ERROR / PING / PONG`
- 所有载荷都经过字段类型、范围与枚举校验；非法消息被丢弃并提示
- 悔棋 / 和棋 / 再来一局 5 秒冷却，且同时只允许一个待处理请求
- 房间号 6 位（去掉了 I/O/0/1），PeerJS id 即房间号本身（不带棋种前缀，棋种由握手协商）
- 同一房间号在五子棋/围棋间不区分：先到者建房，后来者按房主棋种自动切换

## 已知边界

- 双方同时发起请求时，后到者会被拒绝（`busy`）
- 断线期间发生的操作不会重放；重连以房主状态为准
- 不支持观战、三人及以上、跨房间
