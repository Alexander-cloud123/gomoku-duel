# 第三方声明

本仓库分发的内容中包含以下第三方软件。

## 运行时（随站点发布）

| 组件 | 版本 | 许可证 | 位置 | 用途 |
| --- | --- | --- | --- | --- |
| [PeerJS](https://peerjs.com/) | 1.5.4 | MIT | [`lib/peerjs.min.js`](lib/peerjs.min.js)、[`lib/peerjs.LICENSE`](lib/peerjs.LICENSE) | WebRTC 信令与点对点数据通道 |

PeerJS 的许可证原文见 [`lib/peerjs.LICENSE`](lib/peerjs.LICENSE)，版本与升级方式见 [`lib/README.md`](lib/README.md)。

## 开发期（不随站点发布）

以下依赖仅用于本地开发、测试与 CI，不会被打包或部署：

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| ESLint | 代码检查 | MIT |
| @eslint/js | ESLint 推荐规则集 | MIT |
| globals | 环境全局变量定义 | MIT |

各依赖的许可证以其 npm 包内 `LICENSE` 文件为准。

## 字体、图标与图像

站点图标 [`assets/favicon.svg`](assets/favicon.svg)、棋盘与棋子均由 Canvas 绘制，未使用第三方字体或商业素材。
