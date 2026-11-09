# PAGE-003 学生首页

- 路由：`/student`
- 源码：`client/src/app/student/index.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-006 | DEF-001 | 余额卡与最近交易；`src/app/student/index.tsx; src/components/Account.tsx` | high | SCN-CMP-006 | — | retain | BP-001 — |
| CMP-007 | DEF-020 | 存款排名卡；`src/app/student/index.tsx; src/components/Ranking.tsx` | normal | SCN-CMP-007 | — | retain | BP-020 — |
| CMP-008 | DEF-025 | 加载骨架；`src/components/Skeleton.tsx` | normal | SCN-CMP-008 | — | retain | BP-025 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-003 | 对应角色登录 | 访问 `/student` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-006 | 有/无交易、错误 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-007 | 有排名/榜外/不参加 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-008 | 首屏/慢加载 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
