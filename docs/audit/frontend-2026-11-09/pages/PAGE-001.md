# PAGE-001 登录

- 路由：`/login`
- 源码：`client/src/app/login.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-001 | DEF-002 | 本机账号列表与切换；`src/app/login.tsx; src/components/Accounts.tsx#DeviceAccounts` | high | SCN-CMP-001 | — | retain | BP-002 — |
| CMP-002 | DEF-028 | 登录欢迎头部；`src/app/login.tsx; src/components/Welcome.tsx` | normal | SCN-CMP-002 | — | retain | BP-028 — |
| CMP-003 | DEF-029 | 登录提示/图标/Loading；`src/components/ui.tsx#Notice,#Icon,#Loading` | normal | SCN-CMP-003 | — | retain | BP-029 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-001 | 对应角色登录 | 访问 `/login` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-001 | 已保存/未保存、当前/非当前 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-002 | 首次/已登录 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-003 | 错误/正常/加载 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
