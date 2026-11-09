# PAGE-029 参数

- 路由：`/admin/settings`
- 源码：`client/src/app/admin/settings.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-010

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-046 | DEF-010 | 升年级日期；`src/app/admin/settings.tsx; src/components/DatePicker.tsx` | normal | SCN-CMP-046 | — | retain | BP-010 — |
| CMP-061 | DEF-030 | 参数数值步进器；`src/app/admin/settings.tsx#Stepper` | normal | SCN-CMP-061 | FND-010 | refactor | BP-030 TASK-010 |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-029 | 对应角色登录 | 访问 `/admin/settings` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-046 | MM-DD/2月29 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-061 | 空/最小/最大/NaN | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

需按问题记录修复并回归：FND-010。
