# PAGE-004 交易明细

- 路由：`/student/txns`
- 源码：`client/src/app/student/txns.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-009 | DEF-015 | 交易明细列表；`src/app/student/txns.tsx; src/components/Ledger.tsx` | high | SCN-CMP-009 | — | retain | BP-015 — |
| CMP-010 | DEF-013 | 类型与日期筛选；`src/app/student/txns.tsx; src/components/Filter.tsx` | normal | SCN-CMP-010 | — | retain | BP-013 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-004 | 对应角色登录 | 访问 `/student/txns` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-009 | 全部/类型筛选/空/错误 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-010 | 日/时段/搜索 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
