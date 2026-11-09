# PAGE-028 考勤与工资

- 路由：`/admin/attendance`
- 源码：`client/src/app/admin/attendance.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-002, FND-005

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-044 | DEF-003 | 后台考勤周视图；`src/app/admin/attendance.tsx; src/components/Attendance.tsx` | high | SCN-CMP-044 | — | retain | BP-003 — |
| CMP-045 | DEF-023 | 工资发放确认；`src/app/admin/attendance.tsx; src/components/Sheet.tsx#ConfirmSheet` | high | SCN-CMP-045 | FND-002, FND-005 | refactor | BP-023 TASK-002, TASK-005 |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-028 | 对应角色登录 | 访问 `/admin/attendance` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-044 | 本周/历史/补签 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-045 | 费率加载/失败/正常 | 主交互 | 状态/权限/数据符合契约 | 0 HTB 可确认；焦点逃逸（EV-009/010） | failed |

## 本页迁移与回归

需按问题记录修复并回归：FND-002、FND-005。
