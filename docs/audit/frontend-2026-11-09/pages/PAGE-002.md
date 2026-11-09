# PAGE-002 修改密码

- 路由：`/change-password`
- 源码：`client/src/app/change-password.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-004 | DEF-028 | 改密欢迎头部；`src/app/change-password.tsx; src/components/Welcome.tsx` | normal | SCN-CMP-004 | — | retain | BP-028 — |
| CMP-005 | DEF-029 | 改密密码输入与提示；`src/app/change-password.tsx; src/components/ui.tsx` | normal | SCN-CMP-005 | — | retain | BP-029 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-002 | 对应角色登录 | 访问 `/change-password` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-004 | 强制改密 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-005 | 空/短/不一致/服务端错误 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
