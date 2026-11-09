# 验收与交接

## 已执行

| 检查/SCN | 命令或人工步骤 | 版本环境 | 实际结果 | EV | 未覆盖 |
|---|---|---|---|---|---|
| 类型/lint/单测 | `npm run typecheck && npm run lint && npm test` | HEAD + worktree; node 24; Expo 58 | passed；9 个单测 | EV-003 | 无 E2E CI |
| 生产导出 | `npm run build` | 同上 | passed；49 URLs/3.27MB | EV-004 | 未测真实网络 |
| 58 视口 sweep | Playwright 各角色 | 8081→18445 | passed；无 pageerror/overflow | EV-005 | 移动端仅 390x844 |
| P1 离线闸门 | 保存登录+缓存 null+offline→/counter | teller01 | failed | EV-007 | 真机网络切换 |
| P1 工资 0 | abort settings→发放弹层 | admin | failed | EV-009 | 未实际确认发放 |
| P1 批量隐藏 | 选择→搜索→批量条 | admin | failed | EV-008 | 未执行注销 |
| P2 焦点 | Tab 8 次/Esc | admin | failed | EV-010 | 屏幕阅读器未测 |

## 修复后必须通过的回归

- `SCN-CMP-019`：cached-null 离线仍有搜索框；离线存款可上传。
- `SCN-FND-002`：费率失败禁用发放；恢复后金额一致。
- `SCN-CMP-033`：搜索无结果时批量条 0、动作禁用。
- 新增长期回归：分批失败仍可下载已创建通知单；2000 页不崩溃；非中国时区日期正确（FND-004/007/008）。
- `SCN-CMP-045`：Tab 不逃出 dialog；Esc 后焦点归还（FND-005）；CMP-058 复用同一回归。
- `SCN-CMP-018`：无名册离线显示可诊断提示。
- `SCN-CMP-060`/`061`/`031`：00 可选；空值不能保存；非法区间不发请求。

## 发布门槛

| GATE | 状态 | 证据 | 说明 |
|---|---|---|---|
| GATE-001 核心旅程/异常/可访问性 | failed | EV-007/008/009/010 | 4 个 P1 + 焦点缺陷 |
| GATE-002 身份/对象/权限 | blocked | EV-023 | 前端守卫已读；服务端 RLS 未渗透 |
| GATE-003 写一致性/重试 | failed | EV-007/009 | 离线写与工资确认 |
| GATE-004 构建可复现 | passed | EV-003/004 | 建议补 CI 与锁文件核对 |
| GATE-005 性能/布局 | failed | EV-005/017 | 布局通过；通知单内存无预算 |
| GATE-006 错误/监控/隐私 | blocked | — | 无前端遥测/生产日志 |
| GATE-007 发布/兼容/恢复 | blocked | EV-002 | 无回滚演练 |
| GATE-008 范围/基线/风险 | passed | EV-001/006/024 | 假阳性已排除 |

## 交接

- 台账：`audit.json`；覆盖索引：`coverage.md`；逐页：`pages/`；组件：`components/`。
- 机器校验命令：
```bash
python3 /Users/huang/.dsh/skills/review-frontend-production/scripts/audit_ledger.py check   docs/audit/frontend-2026-11-09/audit.json --require-plan --require-complete
```
- 修复从 P1 开始；每项修复后把对应 SCN 从 failed 改为 passed，并补 runtime/test EV，再更新 FND 状态。
- 不把 `audit_coverage_closed` 表述为“可发布”；它只表示发现范围已核对。
