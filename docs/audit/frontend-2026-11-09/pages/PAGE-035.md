# PAGE-035 柜台布局

- 路由：`/counter`
- 源码：`client/src/app/counter/_layout.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-054 | DEF-014 | 柜台 Gate；`src/app/counter/_layout.tsx; src/components/Gate.tsx` | high | SCN-CMP-054 | — | retain | BP-014 — |
| CMP-055 | DEF-024 | 柜台 Shell；`src/app/counter/_layout.tsx; src/components/Shell.tsx` | high | SCN-CMP-055 | — | retain | BP-024 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-035 | 对应角色登录 | 访问 `/counter` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-054 | teller/非 teller | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-055 | 桌面/手机 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
