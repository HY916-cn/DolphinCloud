# 2026-11-09 前端审查复验记录

- **日期**：2026-11-10
- **对象**：[audit-2026-11-09.md](audit-2026-11-09.md) 第七节 TASK-001～011 与发布门禁 GATE-001～008
- **基线**：`2dce647`（main 已提交代码），在临时 `git worktree` 中运行，不含工作区未提交的改动
- **修复提交**：`c98f3ee`（11 项修复，新增 `client/e2e/safeguards.spec.ts`）、`49fdf57`（柜员考勤费率、柜台查询时段、工作人员批量）、`0a8294d`（时间选择器在平滑滚动中被关闭时保持已选的值）、`1e484c7`（导入中断提示的文案）
- **结论**：TASK-001～011 共 11 项通过；发布门禁 5 项通过、3 项阻塞（GATE-005～007），详见第三节。全量 e2e 跑了两轮：第二轮 111 条全部通过；第一轮有 1 条偶发失败，见第一节。

## 一、运行环境与结果

| 项目 | 内容 |
|---|---|
| 机器 | Mac16,10（arm64，24GB），macOS 27.0.1，Docker 29.9.2，Node 24.18.0 |
| 浏览器 | Playwright 1.64.1，Chromium 156.0.8078.4、WebKit、iPhone 13 视口（按 `playwright.config.ts` 的项目划分） |
| 镜像 | 从基线 worktree 用 `docker/Dockerfile` 构建的临时镜像 `dolphin-cloud:audit-verify` |
| 容器 | `dolphin-e2e-audit-verify`，`https://localhost:18471`，43 个迁移全部执行后载入 `supabase/seed.sql`，快照与重置方式同 `docker/e2e-test.sh` |
| 全量 e2e | 共 111 条（原有 106 条，新增 5 条），在两个全新容器上各跑一轮。第二轮：111 通过（8.0 分钟）。第一轮：103 通过，1 失败，7 条未运行（失败用例所在的 `counter.spec.ts` 为串行模式，Chromium 项目中其后 7 条随之跳过）；之后单独重跑 `counter.spec.ts` 的 Chromium 项目 3 遍（`--repeat-each=3`），33 条全部通过。 |
| 余额核对 | 两轮全量 e2e 后 `dolphin check` 均为：Balances and stock match the ledger |
| `npm run typecheck` | 通过（按 CI 先写入 `expo-env.d.ts`） |
| `npm run lint` | 通过 |
| TASK-004 文案复验 | 在 `2dce647` 上只加入导入中断提示的文案改动（`admin/students/import.tsx`、`admin/staff/import.tsx` 和 `safeguards.spec.ts` 中对应断言），重新构建镜像并在新容器中运行：typecheck、lint 通过；`safeguards` 名册与导入中断 3 条、`admin.spec.ts` 名册导入 2 条、`audit-verify` TASK-006/TASK-008 2 条，共 7 条通过；`staff-import.spec.ts` 6 条通过 |
| `npm test` | 通过，10 个单测文件（cash、errors、format、motion、offline queue、pdf、roster、search、staff import、term） |

**第一轮的偶发失败**：`counter.spec.ts`「offline deposit is registered, then uploaded once online」（Chromium）超时。离线登记、恢复联网、“结束办理 1 笔”和“上传”各步均已通过（“待上传”提示已消失），随后第 130 行再次搜索学生时找不到搜索框：页面停在李思远的办理页，余额显示 42（上传前的余额），而不是回到学生搜索。同一用例在 WebKit 项目中通过，单独重跑 3 遍和第二轮全量都通过，原因尚未查明，已回报前端排查。这条用例与 TASK-001 同属离线存款路径，但不是 TASK-001 的验收用例。CI 运行 42801159079（提交 `39c745e`）中该用例通过，e2e 106 passed。

每轮结束后，临时容器、数据卷、镜像和 worktree 均已删除。

## 二、TASK 复验

用例名为 Playwright 的测试标题。`safeguards` 指 `client/e2e/safeguards.spec.ts`，`audit-verify` 指本次新增的 `client/e2e/audit-verify.spec.ts`。

| TASK | 结果 | 修复提交 | 证据 |
|---|---|---|---|
| TASK-001 离线柜台闸门 | 通过 | `c98f3ee` | `safeguards`「a teller whose device knows they are off duty still registers deposits offline」：在线下班使本机缓存“未上班” → 注册 service worker → 断网重载，出现“离线登记”提示和搜索框 → 给张小明存 5 元，办理单显示“存款（离线登记）” → 恢复联网、结束办理并上传，“待上传”消失，数据库余额为 113 → 之后可正常上班。 |
| TASK-002 工资费率未知时不可发放 | 通过 | `c98f3ee`、`49fdf57` | `safeguards`「工资 cannot be paid on rates that were not read; with them, the amount confirmed is the amount paid」：拦截 `settings` 返回 500 → 显示“暂时无法读取工资费率”，“发放工资”禁用，每班/本周工资显示“—”，不出现确认弹层 → 恢复后点“重试”，弹层金额等于 `settings` 中的费率，发放后数据库 `attendance.pay` 与之相同。柜员端另有「the teller sees — and not 0 while the rates cannot be read」。 |
| TASK-003 批量选择随筛选收敛 | 通过 | `c98f3ee`、`49fdf57` | `safeguards`「选择 covers only the students in view, and a batch confirmation names everyone it reaches」：选中张小明后搜索“不存在XYZ”，批量条为“已选 0 个”，重置密码、注销禁用；清除搜索后仍为 0；切换“未设置密码”筛选也清空选择；确认弹层逐行列出姓名和学号；工作人员页同样收敛。 |
| TASK-004 导入中断保留通知单 | 通过 | `c98f3ee`；`1e484c7`（文案） | `safeguards`「an import cut short keeps the notices of the students it opened」：150 行名册，第二批 `import_roster` 返回 500 → 页面“导入中断”，显示新开户 100 人，提示为“前 100 人已导入，其中新开户 100 人，请先保存这些人的开户通知单；改好名册后再导入一次即可，已导入的学号只更新信息，不会重复开户。”（用例断言后半句全文），可下载的开户通知单 PDF 恰为 100 页。导入工作人员的中断提示同步为“改好表格后再导入一次即可，已导入的账号只更新信息，不会重复创建账号。”，没有用例覆盖这句，按源码核对。 |
| TASK-005 ConfirmSheet 焦点 | 通过 | `c98f3ee` | `safeguards`「a sheet keeps Tab inside it and gives focus back to the button that opened it」：打开批量重置确认，初始焦点在“取消”；Tab、Shift+Tab 各 8 次，焦点始终在弹层内，只在“取消”“本次涉及”“重置并生成通知单”之间循环；Esc 关闭后焦点回到“重置密码”；`reducedMotion: 'reduce'` 下点“取消”也能关闭并归还焦点。 |
| TASK-006 离线无名册可诊断 | 通过 | `c98f3ee` | 请求立即失败：`safeguards`「a device with no roster and no network says so, and 重试 fetches it」。请求无应答：`audit-verify`「TASK-006: a roster read that never answers gives up after 5 s and says the device has no roster」，挂起名册请求且本机无缓存，4 秒以上后出现“这台设备还没有名册 / 请联网后重试”，放行后点“重试”即可搜到张小明。名册确实为空时不当作失败：`safeguards`「a roster that is really empty is not a failure」。 |
| TASK-007 通知单内存 | 通过 | `c98f3ee` | 本次复测：`audit-verify`「TASK-007: 500 notices keep the ArrayBuffer memory small」，走真实导入页导入 500 名新生后下载开户通知单，测得：单独运行 500 页用时 5.1s，ArrayBuffer 峰值 2.9MB（开始生成前 2.9MB），JS 堆峰值 16.6MB，PDF 66.6MB；两轮全量 e2e 中分别为 5.6s、3.0MB、16.5MB、66.6MB 和 4.4s、3.1MB、34.6MB、66.6MB。测量方式：生成期间每 50ms 通过 Chrome DevTools Protocol 读取 `Runtime.getHeapUsage` 的 `backingStorageSize`（ArrayBuffer 背后的内存）和 `usedSize`。用例断言 PDF 为 500 页，ArrayBuffer 峰值低于 32MB。2026-11-09 实测（同一台 Mac 的 Chromium，走真实导入页，ArrayBuffer 峰值）：500 页从 132.2MB 降到 2.8MB，耗时 5.1s → 4.8s；2000 页从 522.6MB 降到 3.1MB，耗时 20.7s → 19.9s，未崩溃。2000 页本次未重测。 |
| TASK-008 通知单日期按上海 | 通过 | `c98f3ee` | `audit-verify`「TASK-008: a notice printed in New York carries the date in Shanghai」：浏览器 `timezoneId: 'America/New_York'`，时钟固定为上海 2026-11-10 09:00（纽约为 11 月 9 日 20:00，页内 `new Date().getDate()` 为 9）→ 生成开户通知单，印章文字含“2026年11月10日”，文件名为 `开户通知单-2026-11-10-1人.pdf`。 |
| TASK-009 TimePicker 空值与 00 | 通过 | `c98f3ee`、`0a8294d` | `safeguards`「a 时段 left empty takes the time in the band only when confirmed」：空值时 Esc 或点外部关闭仍为空，空值点“确定”取中间带的值 00:00，不会提交空值（即报告修复建议中的“无值则选中当前轮值”）。`audit-verify`「TASK-009: an empty 时段 scrolled away and back to 00 is 00:00」：空值把“时”轮滚到 03 再滚回 00，字段为 00:00，确定后保持。`0a8294d` 的场景（点数字后立刻确定）由 `safeguards` 三条时段用例覆盖：点“10时”后立即确定，值保持为 10 点，才会出现“时段有误”。 |
| TASK-010 参数步进器 | 通过 | `c98f3ee` | `safeguards`「参数 says what a number may be and will not save one it cannot take」：清空“小学部单笔取款上限”→ 字段标红，提示“请输入 1 到 1000000 的整数”，“保存参数”禁用；填 0 仍禁用；排名人数填 101 提示“请输入 1 到 100 的整数”并禁用；全程未发出 `set_settings` 请求。 |
| TASK-011 非法时段阻断查询与导出 | 通过 | `c98f3ee`、`49fdf57` | 流水：`safeguards`「流水 asks for nothing and exports nothing while its 时段 ends before it starts」；柜台查询：「柜台查询 asks for nothing while its 时段 ends before it starts」；学生明细：「明细 asks for nothing while its 时段 ends before it starts」。报表：`audit-verify`「TASK-011: 报表 asks for nothing and exports nothing while its 时段 ends before it starts」，10 时至 9 时 → 显示“时段有误”，“打印 / 导出”禁用，0 个 `bank_report` 请求；改为 11 时后自动恢复。日期区间“从/到”由 DatePicker 的 `min`/`max` 限制，无法选出开始晚于结束；报表页在审查基线 `2c1b884` 已用 `enabled: !badTime` 阻断查询。 |

## 三、发布门禁

| GATE | 名称 | 状态 | 依据 | 还差什么 / 由谁做 |
|---|---|---|---|---|
| GATE-001 | 核心旅程、异常恢复及关键可访问性已验证 | passed | TASK-001～005 均由 e2e 运行验证（第二节）；全量 e2e 覆盖柜台、学生、存折、后台主流程；柜台、学生、存折页另在 WebKit 运行，学生和存折页另在手机视口运行。 | — |
| GATE-002 | 身份、对象、租户与字段权限在受信任边界执行 | passed | 后端补充的服务端权限证据：`supabase/tests/20_rpc_matrix.sql` 对 38 个对外函数 × 12 种身份做 593 条断言，修复迁移为 `20261111000300_rpc_access.sql`、`20261111000400_issue_teacher_only.sql`；表级 RLS 另有 `supabase/tests/05_rls.sql`。这些 pgTAP 测试由 CI 的 image 任务执行，运行 42796561155（提交 `a07743b`，已包含上述文件）通过。本次未在本机运行 `docker/db-test.sh`（固定容器名）。 | 系统只服务一所学校，没有多租户。外部渗透测试未做，如学校要求，由用户安排。 |
| GATE-003 | 写操作的一致性、重试、取消与结果未知语义已验证 | passed | 离线写路径的闸门死锁已解除，离线存款上传后余额与数据库一致（TASK-001）；工资确认金额与实发一致（TASK-002）；全量 e2e 后 `dolphin check` 余额与流水一致；并发与工资竞争由 `08_concurrency.sql`、`15_salary_race.sql` 覆盖。 | — |
| GATE-004 | 生产构建、配置与依赖安装可复现 | passed | CI 运行 42796561155（提交 `a07743b`）：check（`npm ci`、`npm audit`、typecheck、lint、单测）与 image（镜像构建、数据库测试、冒烟、e2e 104 passed）均成功；之后的运行 42801159079（提交 `39c745e`）同样成功，e2e 106 passed；依赖由 `package-lock.json` 和 `npm ci` 锁定，Actions 按提交 SHA 固定。本次在基线上重新构建镜像并通过 typecheck、lint、单测和全量 e2e。 | — |
| GATE-005 | 目标环境下的性能、布局与长时间使用符合约定 | blocked | 通知单内存已有预算并由用例断言（TASK-007，500 页 ArrayBuffer 峰值低于 32MB）；2000 页在 Mac Chromium 上完成；全校规模性能由每周的 `docker/perf-test.sh` 覆盖（定时运行 42526763541，11-08，perf 成功）；布局无溢出（审查报告第三节）。 | 目标设备未实测：柜台 iPad（Safari）和后台电脑上的长时间运行、2000 页通知单。需要用户或学校提供设备，前端可提供测量步骤。 |
| GATE-006 | 错误可诊断，监控与日志数据满足隐私约定 | blocked | 客户端没有前端错误上报或遥测（`client/src` 中无相关代码）；错误提示在页面内可读，余额核对有 `dolphin check`。 | 需要用户决定是否引入前端错误上报及其隐私约定；决定后由前端实现上报、后端提供接收与保留策略。 |
| GATE-007 | 发布、新旧版本兼容与恢复路径已验证 | blocked（部分已验证） | 数据库升级：每周 `docker/upgrade-test.sh` 从一周前的 main 升级到当前镜像，定时运行 42526763541 成功；备份恢复：`docker/smoke-test.sh` 覆盖加密备份 → 改动 → 恢复。 | 未验证：已打开的旧版 PWA 在新版本发布后的更新与接口兼容（前端补用例）；正式服务器上的镜像回滚演练（需要用户在正式环境安排，后端提供步骤）。 |
| GATE-008 | 审查范围、基线一致性及尚存风险已明确 | passed | 本记录写明基线提交、运行环境、每项证据和未覆盖部分。 | — |

## 四、本次未覆盖

- **WebKit 和真机上的通知单内存**：TASK-007 的测量只在 Chromium 上做（读取 V8 堆数据需 Chrome DevTools Protocol）。JPEG 以 Blob 形式由浏览器保存，PDF 大小随页数线性增长（500 页约 66.6MB），低内存设备上的表现未测。
- **2000 页通知单**：本次只复测 500 页，2000 页引用 11-09 的测量。
- **服务端权限测试的本地运行**：`docker/db-test.sh` 使用固定容器名，本次未运行，引用 CI 结果。
- **生产构建 `npm run build`**：未单独运行；镜像构建中已执行。
- **偶发失败的原因**：第一轮中 `counter.spec.ts` 离线存款用例的超时（第一节）未定位，需前端用 trace 复现。
- **离线存款与纸质凭条一致**：按 `docs/development/ACCEPTANCE.md` 第 14 项，待试运行周由银行管理员抽查。
