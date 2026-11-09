# PAGE-007 存折账户页

- 路由：`/book`
- 源码：`client/src/app/book/index.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-013 | DEF-006 | 存折壳与翻页；`src/app/book/_layout.tsx; src/components/Book.tsx` | high | SCN-CMP-013 | — | retain | BP-006 — |
| CMP-014 | DEF-019 | 存折账户页与最近交易；`src/app/book/index.tsx; src/components/Passbook.tsx` | high | SCN-CMP-014 | — | retain | BP-019 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-007 | 对应角色登录 | 访问 `/book` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-013 | 桌面2页/手机1页、开场/合上 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-014 | 首次补打/已打印 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
