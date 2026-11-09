# PAGE-011 柜台办理

- 路由：`/counter`
- 源码：`client/src/app/counter/index.tsx`
- 角色/变体：桌面 1280x900；手机 390x844；按 Gate 角色进入
- 运行证据：EV-005/EV-006/EV-021
- 关联问题：FND-001, FND-006

## 组件实例

| CMP | DEF | 观察/源码定位 | 关键性 | CHK/SCN | FND | 处置 | BP/TASK |
|---|---|---|---|---|---|---|---|
| CMP-018 | DEF-009 | 学生搜索与今日办理；`src/app/counter/index.tsx; src/components/Counter.tsx#FindStudent` | high | SCN-CMP-018 | FND-006 | refactor | BP-009 TASK-006 |
| CMP-019 | DEF-012 | 上班卡；`src/app/counter/index.tsx; src/components/Duty.tsx#DutyCard` | high | SCN-CMP-019 | FND-001 | refactor | BP-012 TASK-001 |
| CMP-020 | DEF-007 | 存款面板；`src/app/counter/index.tsx; src/components/Business.tsx#DepositPanel` | high | SCN-CMP-020 | — | retain | BP-007 — |
| CMP-021 | DEF-007 | 取款面板；`src/app/counter/index.tsx; src/components/Business.tsx#WithdrawPanel` | high | SCN-CMP-021 | — | retain | BP-007 — |
| CMP-022 | DEF-007 | 兑换面板；`src/app/counter/index.tsx; src/components/Business.tsx#ShopPanel` | high | SCN-CMP-022 | — | retain | BP-007 — |
| CMP-023 | DEF-007 | 查询面板；`src/app/counter/index.tsx; src/components/Business.tsx#QueryPanel` | high | SCN-CMP-023 | — | retain | BP-007 — |

## 状态与交互

| SCN | 前提 | 动作 | 预期 | 实际 | 状态 |
|---|---|---|---|---|---|
| SCN-PAGE-011 | 对应角色登录 | 访问 `/counter` | 页面可渲染、无异常/溢出 | Playwright 已加载 | passed |
| SCN-CMP-018 | 在线/离线/无名册 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-019 | 在线/离线/缓存 null | 主交互 | 状态/权限/数据符合契约 | 离线被 DutyCard 阻挡（EV-007） | failed |
| SCN-CMP-020 | 在线/离线入队 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-021 | 限额/余额/配钞 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-022 | 账户/现金/库存 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |
| SCN-CMP-023 | 账户/流水/分页 | 主交互 | 状态/权限/数据符合契约 | 基线场景通过（EV-005/006） | passed |

## 本页迁移与回归

需按问题记录修复并回归：FND-001、FND-006。
