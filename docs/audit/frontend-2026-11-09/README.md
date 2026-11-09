# DolphinCloud 前端全面审查（2026-11-09）

- 目标：`client/` Expo Router Web 前端 + 本地干净 Supabase 运行
- 基线：`2c1b884 (main) + 当前工作树 86 files, +710/-703`；运行 `Expo Web http://localhost:8081 -> https://localhost:18445 (dolphin-audit; 37 migrations + seed)`
- 模式：`audit_plan`（只审查与规划，未修改应用源码）
- 结论：**未通过发布门禁**；4 个 P1、3 个 P2、4 个 P3 未解决。

## 文件

- [总报告](review.md)
- [问题记录](findings.md)
- [逐页报告](pages/)
- [组件蓝图](components/)
- [重构计划](refactor-plan.md)
- [验收与交接](verification-handoff.md)
- [覆盖索引](coverage.md)
- [机器台账](audit.json)

## 复现

```bash
cd /Users/huang/Desktop/Project/DolphinCloud/client
npm run typecheck && npm run lint && npm test && npm run build
```

运行时：干净容器 `dolphin-audit` 暴露 `18445`，Expo `8081` 通过 Metro 代理；账号 `admin/ops01/president01/teller01`、学生 `20260001`，密码 `a12345678`。旧 `dolphin-dev` 容器账号与当前种子不一致，不能用于结论。
