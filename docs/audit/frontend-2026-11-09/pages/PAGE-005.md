# PAGE-005 存款排名

- 路由：`/student/ranking`
- 源码：`client/src/app/student/ranking.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：无

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-011 | DEF-020 | 排名榜与我的名次；`src/app/student/ranking.tsx; src/components/Ranking.tsx` | normal | SCN-CMP-011 | — | retain | BP-020 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-005 | 对应角色登录 | 访问 `/student/ranking` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-011 | 前三/榜内/榜外 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

保留现有实现；后续改动需回归本页 SCN 与共享组件 BP。
