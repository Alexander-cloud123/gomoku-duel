# 变更记录

本项目遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)，变更记录格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 变更

- 仓库按企业开源规范整理：归档历史设计稿、补齐社区与合规文件、加入文档链接校验（`npm run check:docs`）

### 文档

- README 重写为规范结构，并加入界面截图

## [2.0.0] - 2026-11

v2 重构：规则与渲染解耦、网络分层、加入人机对战与完整围棋规则。

### 新增

- 人机对战：五子棋 / 围棋，三档难度
- 围棋 9 / 13 / 19 路与贴目（5.5 / 6.5 / 7.5）
- 围棋提子、自杀禁着、打劫、位置超级劫、数子结算与死子标记
- 联机断线重连与状态重同步（60 秒窗口）
- 深链邀请 `?room=CODE&mode=...`
- 走子记录、提子与贴目信息、本地战绩
- 落子动画、胜利连线、音效、键盘操作、焦点陷阱与 `prefers-reduced-motion`
- Node 内置测试、ESLint、GitHub Actions、本地静态开发服务器与浏览器冒烟脚本
- 协议版本、消息序号去重、字段校验与体积上限

### 修复

- 认输仅本地生效：改为 `RESIGN` 双端结算
- 悔棋可在他方回合发起、可撤销对手胜局：改为按申请方颜色精确回退，并限制次数
- 围棋悔棋不恢复提子与劫：改为截断历史后完整回放
- 心跳只发不收：补 PONG 超时判定与重连窗口
- 加入房间靠猜模式：改为握手校验，模式不匹配时明确拒绝并自动切换
- 第二条连接顶掉第一条：房主拒绝并提示房间已满
- 消息无版本 / 序号 / 校验：补协议校验与重同步
- 再来一局单方生效：改为请求 / 同意
- AI 无请求 id 与时间上限：补请求取消、时间预算与思考状态
- 威胁识别误报、胜率模型不合理：重写棋型识别与评估
- 提示坐标与棋盘标注上下颠倒：统一记谱
- 手机端棋盘发虚、无法触控：补 DPR、ResizeObserver、Pointer 事件
- 原生 `alert` / `confirm`：替换为统一模态与 Toast
- README 错误地建议双击 `index.html`：更正为 `npm run dev`

### 移除

- `ai.js`、`ai-eval.js`、`ai-worker.js`、`go-ai-eval.js`、`webrtc.js`（由 `js/ai/*` 与 `js/net/*` 取代）
- 隐藏作弊按键序列
- 房主 `*` 房间号后缀的隐式权限（保留兼容解析，不再有特权）

### 架构

- 规则抽取为 `js/rules/*`，状态机不再依赖 DOM
- 网络拆分为传输 / 协议 / 会话
- 渲染与控制器分离

[Unreleased]: https://github.com/Alexander-cloud123/gomoku-duel/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Alexander-cloud123/gomoku-duel/releases/tag/v2.0.0
