# PAGE-019 学生详情

- 路由：`/admin/students/[no]`
- 源码：`client/src/app/admin/students/[no].tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-035 | DEF-008 | 学生注销确认；`src/app/admin/students/[no].tsx; src/components/Close.tsx` | high | SCN-CMP-035 | — | retain | BP-008 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-019 | 对应角色登录 | 访问 `/admin/students/[no]` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-035 | 两步确认、余额 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
