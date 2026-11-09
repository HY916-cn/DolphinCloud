# DolphinCloud 前端全面审查报告

## 1. 范围与基线

- 项目：海豚云校园银行，`/Users/huang/Desktop/Project/DolphinCloud/client`。
- 源码：`2c1b884 (main) + 当前工作树 86 files, +710/-703`。运行：`Expo Web http://localhost:8081 -> https://localhost:18445 (dolphin-audit; 37 migrations + seed)`，干净容器 37 个迁移 + 种子成功。
- 角色：学生、柜员、teacher、president、sysadmin；学生 3 人、交易 7 笔。
- 访问：源码 + 运行（source_runtime）；审查深度 full；未修改应用源码。
- 排除：服务端 RLS 深度渗透、生产部署/监控、真机原生性能。权威依据见 `audit.json.project.out_of_scope`。
- 发现渠道：37 个路由文件、29 个共享组件、约 30 个 lib；58 个页面/视口 sweep；定向复现离线、工资、批量、焦点；typecheck/lint/test/build。

## 2. 核心判断

1. **已知范围已核对**：路由、组件、数据层、运行入口与历史审计差异已对账；旧 `dolphin-dev` 容器账号差异被排除，不当作缺陷。`inventory_status=reconciled`。
2. **页面与运行**：36 个 in-scope 页面，36 个页面场景通过；61 个实例，57 个基线场景通过，4 个失败场景对应已确认缺陷。58 视口无 pageerror、无横向溢出。
3. **方案覆盖**：30 个 DEF 均有 BP，61 个 CMP 均有唯一 plan，11 个 FND 均有 TASK；`--require-plan --require-complete` 通过。
4. **发布条件**：`GATE-001/003/005` 失败，`GATE-002/006/007` 阻塞；**不满足发布条件**。构建门禁通过。

| 根因/问题 | 影响页与组件 | 用户/数据后果 | 优先级与置信度 | 推荐机制 | 依赖 |
|---|---|---|---|---|---|
| 离线未上班闸门 | PAGE-011 / CMP-019 | 柜员无法登记离线存款 | P1 confirmed | 闸门限定 online；离线直达 FindStudent | TASK-001 |
| 工资确认 0 HTB | PAGE-028 / CMP-045 | 确认金额与实际发放不一致 | P1 confirmed | 费率未知禁用发放；金额单一来源 | TASK-002 |
| 学生批量隐藏选择 | PAGE-018 / CMP-033、CMP-058 | 对不可见学生重置/注销 | P1 confirmed | 筛选变化清空选择或按可见 list 计算 | TASK-003 |
| 导入通知单丢失 | PAGE-020 / CMP-036 | 新学生初始密码无法交付 | P1 confirmed | 失败后保留 created 并下载 | TASK-004 |
| ConfirmSheet 焦点 | PAGE-028/018 / CMP-045、CMP-058 | 键盘/读屏用户逃出弹层 | P2 confirmed | 焦点陷阱 + restore + 超时兜底 | TASK-005 |
| 离线名册空态 | PAGE-011 / CMP-018 | 误判学生不存在 | P2 confirmed | 区分空/失败/无缓存 + 重试 | TASK-006 |
| 通知单内存 | PAGE-020/024 / CMP-036、CMP-040 | 2000 页可能卡顿/崩溃 | P2 confirmed | 分批生成/释放 | TASK-007 |
| 通知单日期时区 | PAGE-020/024 / CMP-036 | 正式凭证日期跨日 | P3 confirmed | 统一 Asia/Shanghai | TASK-008 |
| TimePicker 00 | PAGE-016 / CMP-060 | 无法滚轮选 00，空值可确认 | P3 confirmed | 区分 null 与 00 | TASK-009 |
| 参数空值 | PAGE-029 / CMP-061 | 提交 0 后被服务端拒绝 | P3 confirmed | 内联校验与禁用保存 | TASK-010 |
| 非法日期区间 | PAGE-017/016 / CMP-031、CMP-010 | 空报表/误导统计 | P3 confirmed | valid 状态阻断查询 | TASK-011 |

## 3. 已排除的假阳性

- **president 看不到商品成本**：运行验证成本值为 4，保存 payload 含 `p_cost:4`；`has_role` 将 president 视为 teacher。不是缺陷。
- **工作人员批量隐藏行**：`chosen = list.filter(...)`，搜索后批量条为 0，不会操作隐藏账号；与学生页不同，不计缺陷。
- **存折翻页“永久卡死”**：额外 sheet 是加载页，翻到该页会触发 `fetchNextPage`，不是永久卡死；仅存在额外加载页体验。
- **旧容器 staff 登录 400**：当前 `dolphin-dev` 是旧种子，账号/邮箱与仓库不一致；干净容器全部账号可登录，不计产品缺陷。

## 4. 质量与限制

- 通过：`npm run typecheck`、`npm run lint`、`npm test`（9 项）、`npm run build`（49 预缓存 URL，3.27MB）。
- 未覆盖：服务端 RLS 渗透、生产监控/回滚、真机性能、2000 人真实批量导入/打印的测量。
- 证据分层：FND-001/002/003/005 已用 Playwright 定向复现；FND-004/006/007/008/009/010/011 由源码控制流确认，未逐项注入运行，修复后须补运行时回归。
- 未把“无 pageerror”当作业务正确；资金、权限、离线状态仍以定向场景和源码控制流为准。
