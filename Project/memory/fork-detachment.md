---
name: fork-detachment
description: 2026-05-10 完成 fork 关系剥离，项目从三创 fork 转型为独立仓库 CPA-Dashboard-kelen
type: project
version: 1.0.0
lastUpdated: 2026-05-10
---

## 剥离 fork 关系

2026-05-10 执行：完全剥离上游两层 fork 关系（kongkongyo → router-for-me），调整为独立仓库。

**Why:** 项目已积累足够的独立功能（监控中心、自动化脚本、个人化规则体系），继续维护 fork 关系增加复杂度但无实际收益。

**How to apply:**
- 不再从 upstream/source 同步代码
- 不再判断是否向上游提 PR
- README 底部保留致谢标注即可
- 版本号使用独立 semver（非 fork tag）
- 脚本中 `sync` 命令已删除，`release` 改为标准 semver

**变更范围:** 14 个文件，详见 commit。
