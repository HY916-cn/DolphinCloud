# PAGE-036 后台布局

- 路由：`/admin`
- 源码：`client/src/app/admin/_layout.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-056 | DEF-014 | 后台 Gate；`src/app/admin/_layout.tsx; src/components/Gate.tsx` | high | SCN-CMP-056 | — | retain | BP-014 — |
| CMP-057 | DEF-024 | 后台 Shell；`src/app/admin/_layout.tsx; src/components/Shell.tsx` | high | SCN-CMP-057 | — | retain | BP-024 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-036 | 对应角色登录 | 访问 `/admin` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-056 | 五角色/路由守卫 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-057 | 桌面全导航/手机截断 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
