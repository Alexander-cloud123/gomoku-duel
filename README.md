# Gomoku Duel - 五子棋双端联机

一个开源的浏览器五子棋游戏，支持**点对点联机对战**，房主独享 **AI 智能辅助**（落子推荐 + 威胁提醒 + 胜率评估）。

## 在线试玩

https://alexander-cloud123.github.io/gomoku-duel/

## 特色

- **WebRTC P2P 联机** — 无需服务器，两人直连
- **AI 智能辅助** — 房主可见，落子推荐 + 威胁 + 胜率
- **响应式设计** — 电脑、平板、手机都能玩
- **现代简约 UI** — 浅色清新，无干扰
- **零依赖** — 纯 HTML + CSS + JS，双击 index.html 就能玩
- **MIT 开源** — 随便用

## 玩法

1. **房主**：点击"创建房间" → 把生成的房间号发给室友
2. **访客**：点击"加入房间" → 输入房主给的房间号
3. 开始对战！

## 技术栈

- HTML5 Canvas
- 原生 JavaScript（ES6 模块）
- [PeerJS](https://peerjs.com/)（WebRTC 信令）
- Google 公共 STUN（NAT 穿透）

## 本地运行

```bash
git clone https://github.com/Alexander-cloud123/gomoku-duel.git
cd gomoku-duel
# 直接用浏览器打开 index.html 即可
```

## 许可证

[MIT](LICENSE)
