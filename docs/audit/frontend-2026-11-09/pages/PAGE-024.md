# PAGE-024 导入工作人员

- 路由：`/admin/staff/import`
- 源码：`client/src/app/admin/staff/import.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-007, FND-008

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-040 | DEF-017 | 工作人员通知单输出；`src/app/admin/staff/import.tsx; src/components/Notices.tsx` | high | SCN-CMP-040 | — | retain | BP-017 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-024 | 对应角色登录 | 访问 `/admin/staff/import` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-040 | 单/批量 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

需按问题记录修复并回归：FND-007、FND-008。
