# 贡献指南

感谢你愿意改进本项目。提交前请先阅读[行为准则](CODE_OF_CONDUCT.md)与[仓库规范](docs/REPOSITORY-STANDARDS.md)。

## 环境要求

- Node.js 22.13 及以上（仓库提供 [`.nvmrc`](.nvmrc)，默认为 24）
- npm 10 及以上（随 Node 22+ 附带）

运行时（浏览器加载的站点）**不需要 Node 或任何依赖**；Node 只用于开发服务器、测试与检查。

## 起步

```bash
git clone https://github.com/Alexander-cloud123/gomoku-duel.git
cd gomoku-duel
npm ci
npm run dev
```

打开 http://127.0.0.1:5173/ 。不要用 `file://` 直接打开 `index.html`：ES Module 与 Worker 会被浏览器拦截。

## 分支与提交

- 从 `main` 拉出短生命周期分支：`feat/<主题>`、`fix/<主题>`、`docs/<主题>`、`chore/<主题>`、`test/<主题>`
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

  ```
  feat(ai): 围棋 AI 增加叫吃优先级
  fix(net): 心跳超时后误判断线
  docs: 补充部署说明
  ```

- 一次提交只做一件事；格式化改动与逻辑改动分开提交
- 合并后删除工作分支（仓库已开启自动删除）

## 代码约定

- 原生 ES Modules，**不引入运行时框架、打包器或 CDN 依赖**
- 4 空格缩进、LF、文件末尾保留换行（见 [`.editorconfig`](.editorconfig)）
- `js/rules/*` 与 `js/game.js` 保持纯逻辑，不访问 DOM；渲染只在 `js/board.js` 与 `js/ui/*` 中进行
- 网络消息必须先经 `js/net/protocol.js` 校验再处理；新增消息类型需同步更新 [`docs/PROTOCOL.md`](docs/PROTOCOL.md)
- 新增第三方运行时库必须 vendored 到 `lib/` 并登记到 `THIRD_PARTY_NOTICES.md`
- 界面文案使用中文；新增可交互元素需保留键盘可达性与焦点样式

## 测试要求

- 规则、协议、会话、AI 的行为变更必须补充 `node:test` 用例（`tests/*.test.mjs`）
- 提交前运行：

  ```bash
  npm run ci
  ```

  该命令依次执行 ESLint、页面 id 一致性检查、文档链接检查与全部测试。

- 涉及界面或联机的改动，请额外按 [`docs/TESTING.md`](docs/TESTING.md) 的冒烟与手工矩阵验证

可选：启用本地推送前检查（要求已安装 Git Bash，Windows 亦可）：

```bash
git config core.hooksPath .githooks
```

## 提交 Pull Request

1. 同步仓库设置后，PR 模板会引导填写变更说明、关联 Issue 与自测结果
2. 说明**为什么改**，不仅是改了什么；行为变化请给出前后对比
3. 确认 CI 全绿；UI 改动附截图
4. 维护者合并前可能请求调整，请在原分支继续提交

## 文档同步

行为、命令、协议、目录结构发生变化时，请同时更新：

- [`README.md`](README.md)
- [`CHANGELOG.md`](CHANGELOG.md) 的 `Unreleased` 段
- 对应 `docs/*` 文档

## 发布

只有维护者执行发布：打 SemVer 标签（`vX.Y.Z`）、创建 GitHub Release、确认两处线上站点更新。
