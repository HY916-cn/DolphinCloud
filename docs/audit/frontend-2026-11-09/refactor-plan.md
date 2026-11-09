# 系统重构与修复计划

只列与问题相关的结构；不重写可靠的数据层。所有任务均为 `planned`，需按 P1→P2→P3 顺序实施。

| TASK | 阶段 | 页/组件 | 文件/配置 | 实施步骤 | 依赖 | 负责人 | 验收 SCN | 恢复 |
|---|---|---|---|---|---|---|---|---|
| TASK-001 | 1 | PAGE-011、CMP-019 | client/src/app/counter/index.tsx:94；client/src/components/Duty.tsx#DutyCard | 把未上班闸门限定为 online；离线时直接进入 FindStudent 并保留离线提示；补充 cached-null 离线回归 | — | 前端工程师 | SCN-CMP-019 | 回滚到原条件；不影响在线未上班提示 |
| TASK-002 | 1 | PAGE-028、CMP-045 | client/src/app/admin/attendance.tsx:33,157,168-171；client/src/lib/attendance.ts#useSalaryRate | 读取 rateQuery 的 pending/error；禁用发放并显示可重试提示；确认金额只用成功费率计算 | — | 前端工程师 | SCN-FND-002 | 保留旧 UI，仅加 disabled 分支 |
| TASK-003 | 1 | PAGE-018、CMP-033 | client/src/app/admin/students/index.tsx:44-51,116；client/src/components/Batch.tsx#BatchBar | query/onlyWaiting/limit 变化时清空 picked；或 chosen 改为 list.filter；确认弹层列出姓名/学号 | — | 前端工程师 | SCN-CMP-033 | 仅前端状态；可回滚 |
| TASK-004 | 1 | PAGE-020、CMP-036 | client/src/app/admin/students/import.tsx#run；client/src/app/admin/staff/import.tsx | 把 created 提升为状态或在 pick 阶段携带；失败页提供已创建通知单下载；提示已创建学号数量 | — | 前端工程师 | SCN-CMP-036 | 保留原成功路径；降级到旧页面 |
| TASK-005 | 2 | PAGE-028、CMP-045 | client/src/components/Sheet.tsx#ConfirmSheet | 记录 opener 并在挂载时聚焦；Tab/Shift+Tab 循环或原生 dialog；卸载/关闭后 restore focus；动画禁用时超时兜底 | — | 前端工程师 | SCN-CMP-045 | 回滚到当前焦点逻辑 |
| TASK-006 | 2 | PAGE-011、CMP-018 | client/src/lib/counter.ts#useRoster；client/src/components/Counter.tsx#FindStudent | 返回 source/error 元信息；区分无名册缓存与无搜索结果；提供重试按钮 | — | 前端工程师 | SCN-CMP-018 | 保留现有缓存回退 |
| TASK-007 | 2 | PAGE-020、CMP-036 | client/src/components/Notices.tsx:99-107,239-240 | 按班级/页数分批生成 PDF；每批释放 canvas/JPEG；UI 显示批次进度 | — | 前端工程师 | SCN-CMP-036 | 保留单人小批量路径 |
| TASK-008 | 3 | PAGE-020、CMP-036 | client/src/components/Notices.tsx:134-136；client/src/lib/format.ts#formatTime | 复用 formatTime/formatDate；印章与页眉使用同一时区 | — | 前端工程师 | SCN-CMP-036 | 回滚日期格式 |
| TASK-009 | 3 | PAGE-016、CMP-060 | client/src/components/TimePicker.tsx | 区分 null 与 "00"；滚动停止始终触发 onPick；确定前校验 | — | 前端工程师 | SCN-CMP-060 | 回滚滚轮逻辑 |
| TASK-010 | 3 | PAGE-029、CMP-061 | client/src/app/admin/settings.tsx#Stepper | 保留编辑字符串；blur/保存前校验 1..max；空值禁用保存 | — | 前端工程师 | SCN-CMP-061 | 回滚校验 |
| TASK-011 | 3 | PAGE-017、CMP-031 | client/src/components/Report.tsx#TimeRange；client/src/app/admin/reports.tsx#badTime；client/src/components/Filter.tsx | 把 valid 状态提升到页面；query enabled 与导出按钮同步；保留上次有效结果 | — | 前端工程师 | SCN-CMP-031 | 回滚 enabled |

## 顺序

1. **Phase 1（阻断发布）**：TASK-001 离线闸门、TASK-002 工资确认、TASK-003 学生批量、TASK-004 导入恢复。
2. **Phase 2（可靠性/可访问性）**：TASK-005 弹层焦点、TASK-006 离线名册、TASK-007 通知单内存。
3. **Phase 3（一致性/表单）**：TASK-008/009/010/011。

## 目标结构

- **离线状态单一来源**：`useOnline` + `useDuty` + `useRoster` 都需返回可区分状态（online/cached/unknown），页面不得用 `null` 同时表达“未上班”“无缓存”“未知”。
- **金额确认单一来源**：工资/取款/兑换的确认金额必须来自与提交相同的已加载配置；配置未知时禁用提交。
- **批量选择作用域**：选择集合必须与当前筛选/可见集合绑定；确认层展示对象姓名/学号。
- **弹层基础件**：ConfirmSheet 提供焦点陷阱、opener 归还、动画兜底；所有确认/输出流程复用。
- **通知单批处理**：按班级/页数分批生成并释放 canvas，日期统一 Asia/Shanghai。
