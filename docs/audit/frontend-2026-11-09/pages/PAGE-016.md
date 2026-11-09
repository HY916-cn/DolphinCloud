# PAGE-016 流水

- 路由：`/admin/txns`
- 源码：`client/src/app/admin/txns.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-009, FND-011

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-028 | DEF-013 | 流水筛选；`src/app/admin/txns.tsx; src/components/Filter.tsx` | high | SCN-CMP-028 | — | retain | BP-013 — |
| CMP-029 | DEF-015 | 流水列表与分页；`src/app/admin/txns.tsx; src/components/Ledger.tsx` | high | SCN-CMP-029 | — | retain | BP-015 — |
| CMP-060 | DEF-027 | 时段选择器；`src/app/admin/txns.tsx; src/components/TimePicker.tsx` | normal | SCN-CMP-060 | FND-009 | refactor | BP-027 TASK-009 |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-016 | 对应角色登录 | 访问 `/admin/txns` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-028 | 日期/类型/学生/柜员/搜索 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-029 | 50/页、冲正配对 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-060 | 空/00/边缘 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

需按问题记录修复并回归：FND-009、FND-011。
