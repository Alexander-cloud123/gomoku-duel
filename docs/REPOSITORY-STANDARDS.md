# 仓库规范

本文件规定 `gomoku-duel` 仓库**什么纳入版本控制、什么不纳入**，以及分支、提交与发布约定。改动仓库结构前请先阅读本文。

## 1. 范围与定位

- 纯静态站点：浏览器直接加载 `index.html` + `js/` + `style.css`，**运行时零依赖、零构建**。
- 仓库同时是开发仓库与部署源：`main` 根目录即发布内容。
- 单人维护，无后端、无账号体系、无服务端存储。

## 2. 应纳入版本控制

| 类别 | 路径 | 说明 |
| --- | --- | --- |
| 应用源码 | `index.html`、`style.css`、`js/**` | 运行时所需的全部代码 |
| 静态资源 | `assets/**` | 图标等站点资源 |
| 第三方运行时库 | `lib/**` | 必须 vendored，并登记版本、来源、许可证 |
| 测试 | `tests/**` | 纯 Node 可执行，不依赖浏览器 |
| 开发期工具 | `scripts/**` | 本地服务器、一致性校验、冒烟脚本 |
| 文档 | `README.md`、`CHANGELOG.md`、`docs/**`、`CONTRIBUTING.md` 等 | 项目文档与规范 |
| 工程配置 | `package.json`、`package-lock.json`、`eslint.config.js`、`.editorconfig`、`.gitattributes`、`.gitignore`、`.nvmrc` | 保证环境可复现 |
| 自动化 | `.github/**` | CI、Issue / PR 模板、Dependabot、CODEOWNERS |
| 许可证 | `LICENSE`、`THIRD_PARTY_NOTICES.md` | 授权与合规 |

## 3. 不纳入版本控制

| 类别 | 示例 | 原因 |
| --- | --- | --- |
| 依赖安装产物 | `node_modules/` | 由 `package-lock.json` 可复现 |
| 构建与缓存 | `dist/`、`build/`、`.cache/` | 本项目无构建产物；缓存不可复现 |
| 测试产物 | `coverage/`、`test-results/`、`playwright-report/` | 可重新生成 |
| 密钥与本地配置 | `.env`、`.env.*`、`.npmrc` | 可能含凭证；用环境变量替代 |
| IDE / OS 个人配置 | `.vscode/`、`.idea/`、`.cursor/`、`.DS_Store`、`Thumbs.db` | 因人而异 |
| 内部工具与个人笔记 | `.claude/`、`.superpowers/`、临时 `.mjs` 排查脚本 | 不属于项目交付物 |
| 浏览器 profile | CDP 冒烟使用的临时用户目录 | 含缓存与本地状态 |
| 大体积二进制 | > 2 MB 的图片 / 视频 / 字体源文件 | 仓库体积与克隆成本 |
| 生成物 | 压缩包、构建快照、截图原图（未压缩） | 可由源码或脚本重建 |

> 临时排查脚本请放在仓库外，或使用 `.tmp` / `tmp/` 并在提交前删除。

## 4. 第三方依赖规则

1. 运行时依赖必须 vendored 到 `lib/`，并在 `lib/README.md` 中记录**版本、上游地址、sha256、升级步骤**。
2. 每个第三方库的许可证原文放进 `lib/`，并在 `THIRD_PARTY_NOTICES.md` 汇总。
3. 开发期依赖只允许出现在 `devDependencies`，不得进入运行时加载路径。
4. 禁止运行时 CDN 依赖（离线可用性 + 供应链风险）。

## 5. 敏感信息

- 仓库启用 GitHub Secret Scanning 与 Push Protection。
- 任何密钥、令牌、房间口令不得提交；发现误提交时立即轮换凭证并清理历史（不在本文档展开）。
- 站点不收集用户数据；`localStorage` 仅保存本地设置与战绩（键名 `gomoku-duel:v2`）。

## 6. 分支与版本

- 默认分支 `main`，保持可发布状态。
- 工作分支短生命周期：`feat/<主题>`、`fix/<主题>`、`docs/<主题>`、`chore/<主题>`，合并后删除。
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`feat|fix|docs|test|refactor|chore|ci(scope): 说明`。
- 发布使用 SemVer 标签（`v2.0.0`），标签对应 GitHub Release，版本段落写入 `CHANGELOG.md`。
- 分支保护：`main` 禁止强推与删除；维护者可直接推送，但推送后必须确认 CI 通过。

## 7. 提交前检查清单

- [ ] `npm run ci` 通过（lint + 页面 id 一致性 + 文档链接 + 测试）
- [ ] 新增或修改行为有对应测试
- [ ] 文档与 README 同步更新
- [ ] 未提交 `node_modules`、缓存、临时脚本、密钥
- [ ] 新增第三方代码已登记许可证与版本
