# 前端审查覆盖索引

项目：DolphinCloud 前端

目标：/Users/huang/Desktop/Project/DolphinCloud/client

访问范围：source_runtime；发现状态：reconciled

> 本文件由台账生成。结构校验不验证证据真实性，也不等于产品认证。

## 覆盖结论

- schema_valid: True
- audit_coverage_closed: True
- plan_complete: True
- production_gates_satisfied: False

## 分母与状态

~~~json
{
  "pages_in_scope": 36,
  "pages_excluded": 1,
  "definitions": 30,
  "instances_in_scope": 61,
  "checks": {
    "failed": 23,
    "not_applicable": 1,
    "passed": 612
  },
  "scenarios": {
    "failed": 4,
    "passed": 94
  },
  "findings": {
    "P1": 4,
    "P2": 3,
    "P3": 4
  },
  "component_plans": 61,
  "tasks": 11
}
~~~

## 页面与组件实例

| 页面 | 路由 | 组件实例 | 已通过 / 失败 / 阻塞 / 未检查 / 不适用 |
|---|---|---|---|
| PAGE-001 登录 | /login | 3 | 28 / 0 / 0 / 0 / 0 |
| PAGE-002 修改密码 | /change-password | 2 | 20 / 0 / 0 / 0 / 0 |
| PAGE-003 学生首页 | /student | 3 | 28 / 0 / 0 / 0 / 0 |
| PAGE-004 交易明细 | /student/txns | 2 | 20 / 0 / 0 / 0 / 0 |
| PAGE-005 存款排名 | /student/ranking | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-006 学生我的 | /student/me | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-007 存折账户页 | /book | 2 | 20 / 0 / 0 / 0 / 0 |
| PAGE-008 存折交易明细 | /book/txns | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-009 存折排名 | /book/ranking | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-010 存折我的 | /book/me | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-011 柜台办理 | /counter | 6 | 47 / 5 / 0 / 0 / 0 |
| PAGE-012 今日业务 | /counter/today | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-013 柜员考勤 | /counter/attendance | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-014 柜员我的 | /counter/me | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-015 管理总览 | /admin | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-016 流水 | /admin/txns | 3 | 26 / 2 / 0 / 0 / 0 |
| PAGE-017 报表 | /admin/reports | 3 | 26 / 2 / 0 / 0 / 0 |
| PAGE-018 学生管理 | /admin/students | 3 | 24 / 4 / 0 / 0 / 0 |
| PAGE-019 学生详情 | /admin/students/[no] | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-020 导入名册 | /admin/students/import | 2 | 16 / 4 / 0 / 0 / 0 |
| PAGE-021 工作人员 | /admin/staff | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-022 工作人员详情 | /admin/staff/[id] | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-023 新增账号 | /admin/staff/new | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-024 导入工作人员 | /admin/staff/import | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-025 商品 | /admin/products | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-026 商品编辑 | /admin/products/[id] | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-027 出入库 | /admin/stock | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-028 考勤与工资 | /admin/attendance | 2 | 16 / 4 / 0 / 0 / 0 |
| PAGE-029 参数 | /admin/settings | 2 | 18 / 2 / 0 / 0 / 0 |
| PAGE-030 日志 | /admin/audit | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-031 管理员我的 | /admin/me | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-032 根布局 | / | 1 | 12 / 0 / 0 / 0 / 0 |
| PAGE-033 学生布局 | /student | 2 | 20 / 0 / 0 / 0 / 0 |
| PAGE-034 存折布局 | /book | 2 | 20 / 0 / 0 / 0 / 0 |
| PAGE-035 柜台布局 | /counter | 2 | 20 / 0 / 0 / 0 / 0 |
| PAGE-036 后台布局 | /admin | 2 | 20 / 0 / 0 / 0 / 0 |
| PAGE-037 入口重定向 | / | 0 | 0 / 0 / 0 / 0 / 0 |

## 组件处置

| 实例 | 蓝图 | 处置 | 任务 | 理由 |
|---|---|---|---|---|
| CMP-001 | BP-002 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-002 | BP-028 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-003 | BP-029 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-004 | BP-028 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-005 | BP-029 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-006 | BP-001 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-007 | BP-020 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-008 | BP-025 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-009 | BP-015 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-010 | BP-013 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-011 | BP-020 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-012 | BP-016 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-013 | BP-006 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-014 | BP-019 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-015 | BP-019 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-016 | BP-019 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-017 | BP-019 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-018 | BP-009 | refactor | TASK-006 | 离线名册空态不可诊断。 |
| CMP-019 | BP-012 | refactor | TASK-001 | 离线闸门条件错误，需调整 DutyCard/页面协作。 |
| CMP-020 | BP-007 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-021 | BP-007 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-022 | BP-007 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-023 | BP-007 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-024 | BP-015 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-025 | BP-003 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-026 | BP-016 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-027 | BP-011 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-028 | BP-013 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-029 | BP-015 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-030 | BP-021 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-031 | BP-010 | refactor | TASK-011 | 非法区间仍查询。 |
| CMP-032 | BP-018 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-033 | BP-005 | refactor | TASK-003 | 批量选择与筛选状态未收敛。 |
| CMP-034 | BP-011 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-035 | BP-008 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-036 | BP-017 | refactor | TASK-004, TASK-007, TASK-008 | 导入失败恢复、批量内存与日期一致性。 |
| CMP-037 | BP-004 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-038 | BP-004 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-039 | BP-029 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-040 | BP-017 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-041 | BP-011 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-042 | BP-029 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-043 | BP-026 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-044 | BP-003 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-045 | BP-023 | refactor | TASK-002, TASK-005 | 工资确认金额与弹层可访问性。 |
| CMP-046 | BP-010 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-047 | BP-013 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-048 | BP-016 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-049 | BP-014 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-050 | BP-014 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-051 | BP-024 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-052 | BP-014 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-053 | BP-024 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-054 | BP-014 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-055 | BP-024 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-056 | BP-014 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-057 | BP-024 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-058 | BP-023 | refactor | TASK-003, TASK-005 | 批量确认复用同一弹层。 |
| CMP-059 | BP-029 | retain |  | 基线与源码核对通过；保持现有契约，纳入回归。 |
| CMP-060 | BP-027 | refactor | TASK-009 | 空值/00 选择边界。 |
| CMP-061 | BP-030 | refactor | TASK-010 | 空值可提交。 |

## 问题索引

| 问题 | 级别 | 置信度 | 状态 | 页面 / 实例 |
|---|---|---|---|---|
| FND-001 保存登录的柜员在“已缓存未上班”后离线，无法登记离线存款 | P1 | confirmed | open | PAGE-011, CMP-019 |
| FND-002 工资费率请求失败时，确认弹层显示并可发放 0 HTB，服务端按实际费率扣款 | P1 | confirmed | open | PAGE-028, CMP-045 |
| FND-003 学生批量选择在搜索隐藏后仍对隐藏学生执行重置/注销等操作 | P1 | confirmed | open | PAGE-018, CMP-033, CMP-058 |
| FND-004 名册分批导入中途失败时，已创建学生的初始密码通知单被丢弃 | P1 | confirmed | open | PAGE-020, CMP-036 |
| FND-005 确认弹层无焦点陷阱，关闭后不归还触发按钮 | P2 | confirmed | open | PAGE-028, PAGE-018, CMP-045, CMP-058 |
| FND-006 新设备离线且无名册缓存时，搜索只显示“没有找到”，没有网络错误或重试 | P2 | confirmed | open | PAGE-011, CMP-018 |
| FND-007 通知单一次性把所有页保留为 JPEG，2000 人规模约 280MB 内存 | P2 | confirmed | open | PAGE-020, PAGE-024, CMP-036, CMP-040 |
| FND-008 通知单印章使用浏览器本地日期，与其他页面的 Asia/Shanghai 日期不一致 | P3 | confirmed | open | PAGE-020, PAGE-024, CMP-036, CMP-040 |
| FND-009 时间滚轮空值停在 00 时不触发选择，确定可能保持空值 | P3 | confirmed | open | PAGE-016, CMP-060 |
| FND-010 参数步进器允许清空后保存 0，客户端无内联校验 | P3 | confirmed | open | PAGE-029, CMP-061 |
| FND-011 报表/流水日期区间非法时仍下发查询 | P3 | confirmed | open | PAGE-017, PAGE-016, PAGE-004, CMP-031, CMP-010 |

## 任务顺序

| 任务 | 阶段 | 负责人 | 依赖 | 状态 |
|---|---|---|---|---|
| TASK-001 修复离线柜台闸门 | 1 | 前端工程师 |  | planned |
| TASK-002 工资发放只在费率已知时可用 | 1 | 前端工程师 |  | planned |
| TASK-003 学生批量选择随筛选收敛 | 1 | 前端工程师 |  | planned |
| TASK-004 名册导入失败保留已创建通知单 | 1 | 前端工程师 |  | planned |
| TASK-005 ConfirmSheet 焦点陷阱与归还 | 2 | 前端工程师 |  | planned |
| TASK-006 离线名册空态可诊断 | 2 | 前端工程师 |  | planned |
| TASK-007 通知单分批生成/释放内存 | 2 | 前端工程师 |  | planned |
| TASK-008 通知单日期统一 Asia/Shanghai | 3 | 前端工程师 |  | planned |
| TASK-009 TimePicker 空值与 00 选择 | 3 | 前端工程师 |  | planned |
| TASK-010 参数步进器空值校验 | 3 | 前端工程师 |  | planned |
| TASK-011 非法日期区间阻断查询/导出 | 3 | 前端工程师 |  | planned |

## 发布门槛

| 门槛 | 必需 | 状态 | 证据 / 理由 |
|---|---|---|---|
| 核心旅程、异常恢复及关键可访问性已验证 | True | failed | EV-007, EV-008, EV-009, EV-010 离线存款被阻挡、工资确认金额错误、学生批量隐藏操作、ConfirmSheet 焦点缺陷均未修复。 |
| 身份、对象、租户与字段权限在受信任边界执行 | True | blocked | EV-023 前端路由守卫已核对；服务端 RLS/RPC 未做渗透与越权矩阵验证，不能宣称权限通过。 |
| 写操作的一致性、重试、取消与结果未知语义已验证 | True | failed | EV-007, EV-009 离线写路径存在闸门死锁；工资写确认金额与服务端不一致。 |
| 生产构建、配置与依赖安装可复现 | True | passed | EV-002, EV-003, EV-004 typecheck/lint/9 单测/build 均通过；仍建议补 CI 与锁定依赖。 |
| 目标环境下的性能、布局与长时间使用符合约定 | True | failed | EV-005, EV-017 布局无溢出；但通知单 2000 页内存风险无预算，未做长时间运行。 |
| 错误可诊断，监控与日志数据满足隐私约定 | True | blocked | EV-001 无前端遥测/错误上报证据；生产日志与隐私策略不在本次访问范围。 |
| 发布、新旧版本兼容与恢复路径已验证 | True | blocked | EV-002 PWA skipWaiting/更新路径已读，但无发布回滚演练与版本兼容矩阵。 |
| 审查范围、基线一致性及尚存风险已明确 | True | passed | EV-001, EV-006, EV-024 范围、基线、排除项与未验证风险已记录；旧容器差异已排除。 |

## 缺口


## 下一步

- 按 TASK-001/002/003/004 修复 P1 并补回归
- 在真实设备与生产同构环境复验构建/性能/权限
