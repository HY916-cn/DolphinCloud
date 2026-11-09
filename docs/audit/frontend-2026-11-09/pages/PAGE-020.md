# PAGE-020 导入名册

- 路由：`/admin/students/import`
- 源码：`client/src/app/admin/students/import.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-004, FND-007, FND-008

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-036 | DEF-017 | 开户/重置通知单输出；`src/app/admin/students/import.tsx; src/components/Notices.tsx` | high | SCN-CMP-036 | FND-004, FND-007, FND-008 | refactor | BP-017 TASK-004, TASK-007, TASK-008 |
| CMP-059 | DEF-029 | 名册文件选择输入；`src/app/admin/students/import.tsx; src/components/ui.tsx` | normal | SCN-CMP-059 | — | retain | BP-029 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-020 | 对应角色登录 | 访问 `/admin/students/import` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-036 | 1/100/2000 人 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-059 | xlsx/xls/csv/错误 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

需按问题记录修复并回归：FND-004、FND-007、FND-008。
