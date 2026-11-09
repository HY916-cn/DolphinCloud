# PAGE-017 报表

- 路由：`/admin/reports`
- 源码：`client/src/app/admin/reports.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-011

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-030 | DEF-021 | 报表主体；`src/app/admin/reports.tsx; src/components/Report.tsx` | high | SCN-CMP-030 | — | retain | BP-021 — |
| CMP-031 | DEF-010 | 报表日期区间；`src/app/admin/reports.tsx; src/components/DatePicker.tsx` | normal | SCN-CMP-031 | FND-011 | refactor | BP-010 TASK-011 |
| CMP-032 | DEF-018 | 报表打印/导出；`src/app/admin/reports.tsx; src/components/Output.tsx` | high | SCN-CMP-032 | — | retain | BP-018 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-017 | 对应角色登录 | 访问 `/admin/reports` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-030 | 营业/账户/财务/商品 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-031 | 本月/今天/自定义 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-032 | PDF/Excel | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

需按问题记录修复并回归：FND-011。
