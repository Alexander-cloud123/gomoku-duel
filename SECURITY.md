# 安全策略

## 支持版本

| 版本 | 状态 |
| --- | --- |
| 2.x（`main`） | 接受安全报告与修复 |
| 1.x 及更早 | 不再维护 |

站点部署即 `main` 分支内容，因此修复会直接进入线上。

## 报告漏洞

**请勿通过公开 Issue 披露漏洞细节。**

- 首选：[GitHub 私密漏洞报告](https://github.com/Alexander-cloud123/gomoku-duel/security/advisories/new)
- 备选：邮件至 727972670@qq.com，标题注明 `[SECURITY] gomoku-duel`

请在报告中包含：受影响的版本或提交、复现步骤、影响范围、必要的截图或日志。我们会在 **7 天内**确认收到，并在修复发布后于 Release Notes 中致谢（如你同意）。

## 范围

本项目是一个纯静态、无后端的浏览器游戏，安全关注点集中在客户端：

- 对端消息的解析与校验（协议字段、体积上限、序号去重、伪造消息）
- 渲染层的注入风险（站点不使用 `innerHTML` 拼接对端内容）
- 本地存储内容（仅设置与战绩，键名 `gomoku-duel:v2`）
- 第三方运行时库（PeerJS，见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)）

不在本项目范围内：

- PeerJS 公共信令服务器与 WebRTC 基础设施本身的可用性、限流或 DDoS
- 第三方库上游漏洞（请同时报告给上游；我们负责升级 vendored 版本）
- 社会工程、物理访问或用户设备被入侵
- 房间号被猜到并加入公开房间（房间号即共享凭证，属设计预期）

## 安全设计要点

- 无账号、无服务端存储、无凭证；联机数据只在对等连接之间传输
- 所有入站消息经 `js/net/protocol.js` 校验后才进入状态机
- 房主为状态权威；访客重连后以快照重同步，避免状态被单方面篡改
- 仓库启用 GitHub Secret Scanning 与 Push Protection
