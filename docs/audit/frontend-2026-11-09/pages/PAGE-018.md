# PAGE-018 学生管理

- 路由：`/admin/students`
- 源码：`client/src/app/admin/students/index.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-003, FND-005

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-033 | DEF-005 | 学生批量条；`src/app/admin/students/index.tsx; src/components/Batch.tsx#BatchBar` | high | SCN-CMP-033 | FND-003 | refactor | BP-005 TASK-003 |
| CMP-034 | DEF-011 | 学生页壳；`src/app/admin/students/index.tsx; src/components/Desk.tsx` | normal | SCN-CMP-034 | — | retain | BP-011 — |
| CMP-058 | DEF-023 | 学生批量重置确认；`src/app/admin/students/index.tsx; src/components/Sheet.tsx#ConfirmSheet` | high | SCN-CMP-058 | FND-005 | refactor | BP-023 TASK-003, TASK-005 |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-018 | 对应角色登录 | 访问 `/admin/students` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-033 | 选择/搜索隐藏/全选 | 主交互 | 状态/权限/数据符合契约 | 搜索隐藏后仍可批量操作（EV-008） | failed |
| SCN-CMP-034 | 列表/空/错误 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-058 | 重置/冻结/注销 | 主交互 | 状态/权限/数据符合契约 | 基准确认流程通过；焦点问题归入 FND-005 | passed |

## 本页迁移与回归

需按问题记录修复并回归：FND-003、FND-005。
