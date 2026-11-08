# 第三方运行时库

本目录存放**必须随站点一起发布**的第三方压缩库。规则见 [`docs/REPOSITORY-STANDARDS.md`](../docs/REPOSITORY-STANDARDS.md)。

| 文件 | 库 | 版本 | 许可证 |
| --- | --- | --- | --- |
| `peerjs.min.js` | [PeerJS](https://peerjs.com/) | 1.5.4 | MIT（[`peerjs.LICENSE`](peerjs.LICENSE)） |

## peerjs.min.js

- 来源：`https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js`
- 上游 dist 的 sha256：`ad5d8870d1e389914f9cba8d35be313c4327c69ee0a221e482e9bf7621136fe5`
- 本地文件与上游 dist 内容一致，仅行尾（LF/CRLF）与 BOM 不同；提交时由 `.gitattributes` 统一为 LF
- 文件末尾保留 `//# sourceMappingURL=peerjs.min.js.map`，源码映射未随仓库分发；仅在打开开发者工具时产生一次 404，不影响运行。

### 升级步骤

1. 从 npm 官方 dist 下载目标版本，核对 sha256 并记录到本文件
2. 覆盖 `peerjs.min.js`，同步更新 [`CHANGELOG.md`](../CHANGELOG.md)
3. 跑 `npm run ci` 与 `node scripts/smoke-online.mjs`（真实 PeerJS 联机冒烟）
4. 确认两处线上站点完成联机对局后再提交

## 为什么 vendored 而不是 CDN

站点要求离线可用、零构建、无运行时网络依赖；同时避免第三方 CDN 被篡改或不可达导致的供应链与可用性风险。代价是升级需要手动执行上述步骤。
