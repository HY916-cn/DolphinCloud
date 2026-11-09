# PAGE-013 柜员考勤

- 路由：`/counter/attendance`
- 源码：`client/src/app/counter/attendance.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-025 | DEF-003 | 柜员考勤周视图；`src/app/counter/attendance.tsx; src/components/Attendance.tsx` | normal | SCN-CMP-025 | — | retain | BP-003 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-013 | 对应角色登录 | 访问 `/counter/attendance` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-025 | 本周/历史/未参与 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
