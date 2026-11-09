# 问题记录

按影响、可达条件、波及范围与可恢复性定级。所有问题均处于 `open`，对应修复任务尚未实施；本文件不把源码推断写成已修复。

## FND-001 保存登录的柜员在“已缓存未上班”后离线，无法登记离线存款

- **定位**：PAGE-011 / CMP-019；源码见“根因”。
- **级别与置信度**：P1 / confirmed。
- **前提**：teller01 已保存登录；在线打开 /counter 使 duty 缓存为 null；浏览器 offline 或 abort /rest/v1 与 /auth/v1。
- **步骤**：重载 /counter；观察页面与按钮；尝试搜索学生并存款。
- **实际**：柜员先在线看到“未上班”，localStorage 缓存 dolphin.duty:<uid>=null；随后断网重载 /counter，页面显示“离线登记”和“未上班”DutyCard，“上班”按钮 disabled，搜索框不存在，无法存款。
- **预期**：离线时柜台应允许登记存款（服务端 require_duty 对 offline 放行）；“未上班”闸门只在 online 时阻断。
- **影响**：核心离线业务不可用；学生无法在断网时存款。只影响保存登录且缓存过 null 的柜员，但这是最常见设备状态。
- **证据**：EV-007、EV-011（详见 `audit.json`）。
- **根因**：src/app/counter/index.tsx:94 的条件 (online || duty.data === null) 把缓存 null 视为需要 DutyCard；DutyCard 上班按钮又要求 online，形成死锁。（confirmed）
- **方案**：把闸门改为 !student && online && !duty.data；离线无条件进入 FindStudent，离线提示保留。或在 DutyCard 离线态提供“登记离线存款”入口。
- **复验**：保存登录柜员在线缓存 duty=null → offline → /counter 应出现搜索框与离线提示；上传一条离线存款后恢复在线可成功入账。
- **关联**：CMP-019；任务 TASK-001。
- **处置**：open，等待实施与复验。

## FND-002 工资费率请求失败时，确认弹层显示并可发放 0 HTB，服务端按实际费率扣款

- **定位**：PAGE-028 / CMP-045；源码见“根因”。
- **级别与置信度**：P1 / confirmed。
- **前提**：teacher 登录；1 个 confirmed 班次；staff_payroll 绑定账户。
- **步骤**：拦截 /rest/v1/settings*；打开 /admin/attendance；点开发放工资；读取弹层与按钮状态。
- **实际**：拦截 settings 后页面显示“每班工资 0/0”；工资弹层写“中午班每个 0 HTB、下午班每个 0 HTB”“1 个班次 · 0 HTB”，确认按钮“发放 0 HTB”可用。服务端实际按 settings 10 HTB/班发放。
- **预期**：费率未加载或失败时禁用发放并提示；确认金额必须等于服务端将发放金额。
- **影响**：教师确认的是 0 HTB，实际扣款/入账 10 HTB；财务授权记录与真实金额不一致，可引发对账争议。
- **证据**：EV-009、EV-012（详见 `audit.json`）。
- **根因**：src/app/admin/attendance.tsx:33 rates = useSalaryRate().data ?? NO_RATES；:157 只用 toPay/waiting 控制 disabled；:168-171 使用 0 费率计算确认金额。（confirmed）
- **方案**：使用 rateQuery.isPending/isError 控制发放按钮；只有费率成功时计算 toPay 与确认金额；失败显示可重试 Notice。
- **复验**：abort settings → 发放按钮禁用且不出现 0 HTB 确认；恢复 settings → 确认金额 10 HTB 且服务端一致。
- **关联**：CMP-045；任务 TASK-002。
- **处置**：open，等待实施与复验。

## FND-003 学生批量选择在搜索隐藏后仍对隐藏学生执行重置/注销等操作

- **定位**：PAGE-018 / CMP-033、CMP-058；源码见“根因”。
- **级别与置信度**：P1 / confirmed。
- **前提**：admin 登录；学生列表至少 1 人。
- **步骤**：点选择并勾选第一条；搜索不存在的关键词；观察批量条与动作可用性。
- **实际**：勾选 1 名学生后搜索“不存在XYZ”，列表 0 行，但批量条仍显示“已选 1 个”，冻结/恢复/毕业/重置/注销按钮均可用；确认操作会作用于不可见学生。
- **预期**：筛选变化后清除选择，或批量动作只作用于当前可见 list；操作摘要必须列出被操作对象。
- **影响**：教师可能在看不到对象的情况下批量重置密码/注销账号，造成账号不可用或数据恢复成本。
- **证据**：EV-008、EV-013（详见 `audit.json`）。
- **根因**：src/app/admin/students/index.tsx:51 chosen = all.filter(picked)，list 被 query/onlyWaiting/limit 缩小；搜索只 setQuery，不清 picked。（confirmed）
- **方案**：在 query/onlyWaiting/limit 变化时清空 picked；或将 chosen 改为 list.filter(picked) 并同步 BatchBar 计数；确认弹层列出姓名/学号。
- **复验**：选择 → 搜索无结果 → 批量条为 0 且动作禁用；清空搜索后不恢复隐藏选择（或明确提示）。
- **关联**：CMP-033、CMP-058；任务 TASK-003。
- **处置**：open，等待实施与复验。

## FND-004 名册分批导入中途失败时，已创建学生的初始密码通知单被丢弃

- **定位**：PAGE-020 / CMP-036；源码见“根因”。
- **级别与置信度**：P1 / confirmed。
- **前提**：admin 登录；150 行合法名册；第二批 RPC 失败。
- **步骤**：选择名册；确认导入；在第二批注入失败；查看结果页。
- **实际**：>100 人的名册在第二批失败时，之前批次已创建的账号保留在数据库，但 catch 直接回到 pick，只提示“前 i 人已导入”；累计的 created 通知单（含初始密码）不展示、不保存。
- **预期**：任何批次失败后仍展示已创建账号的通知单/下载入口，并明确哪些学号已创建。
- **影响**：已创建学生无法获知初始密码，只能逐个重置；批量开学导入的恢复成本高。
- **证据**：EV-014（详见 `audit.json`）。
- **根因**：src/app/admin/students/import.tsx run() 的 created 是局部变量；catch setStage({kind:"pick",error}) 丢弃它。（confirmed）
- **方案**：把 created 提升为状态或在 pick 阶段携带；失败页提供“下载已创建通知单”；参考 staff/import 的 done 保留策略。
- **复验**：150 行名册，第二批 import_roster 失败 → 页面仍提供前 100 人通知单，学号与密码可下载。
- **关联**：CMP-036；任务 TASK-004。
- **处置**：open，等待实施与复验。

## FND-005 确认弹层无焦点陷阱，关闭后不归还触发按钮

- **定位**：PAGE-028、PAGE-018 / CMP-045、CMP-058；源码见“根因”。
- **级别与置信度**：P2 / confirmed。
- **前提**：teacher 登录；有可发放班次。
- **步骤**：打开工资弹层；连续 Tab 直至离开 dialog；Esc 关闭并检查 activeElement。
- **实际**：打开工资确认弹层，焦点初始在“取消”；Tab 8 次后焦点到侧栏“出入库”，已离开 dialog；Esc 关闭后焦点仍在“出入库”，未回到“发放工资”。
- **预期**：模态弹层应困住焦点，关闭后恢复到触发元素；Esc/遮罩关闭不依赖动画事件。
- **影响**：键盘与屏幕阅读器用户可操作到被遮挡的后台导航，关闭后迷失位置；破坏所有 ConfirmSheet 流程。
- **证据**：EV-010、EV-015（详见 `audit.json`）。
- **根因**：src/components/Sheet.tsx 没有 focus trap 与 opener 记录；onClose 只在 animationend 回调。（confirmed）
- **方案**：挂载时记录 document.activeElement；实现 Tab/Shift+Tab 循环或使用原生 dialog；卸载时 restore focus；动画结束加超时兜底并尊重 reduced motion。
- **复验**：打开任一 ConfirmSheet → Tab 循环留在 dialog；Esc/取消后焦点回到触发按钮；reduced-motion 下也能关闭。
- **关联**：CMP-045、CMP-058；任务 TASK-005。
- **处置**：open，等待实施与复验。

## FND-006 新设备离线且无名册缓存时，搜索只显示“没有找到”，没有网络错误或重试

- **定位**：PAGE-011 / CMP-018；源码见“根因”。
- **级别与置信度**：P2 / confirmed。
- **前提**：teller 已保存登录；无 roster 缓存；offline。
- **步骤**：打开 /counter；在搜索框输入任意关键词；观察空态。
- **实际**：useRoster 5s 超时后 catch 返回 null，cachedRoster 为空时 indexRoster([]) 得到空索引；FindStudent 渲染“没有找到「…」”，没有网络错误、重试或“尚未缓存名册”。
- **预期**：名册读取失败且无缓存时应明确提示离线不可搜索，并提供重试/联网指引。
- **影响**：新设备离线时用户误以为学生不存在，无法判断是数据问题还是网络问题。
- **证据**：EV-016（详见 `audit.json`）。
- **根因**：src/lib/counter.ts useRoster 把失败与空名册合并为同一空索引；FindStudent 没有 error/emptyReason 分支。（confirmed）
- **方案**：让 useRoster 返回 {index, source:"network"|"cache"|"empty", error}；FindStudent 区分“无名册缓存”和“无搜索结果”，提供重试按钮。
- **复验**：清除 IndexedDB roster → offline → /counter → 显示“本机尚未缓存名册，请联网后重试”而非无结果。
- **关联**：CMP-018；任务 TASK-006。
- **处置**：open，等待实施与复验。

## FND-007 通知单一次性把所有页保留为 JPEG，2000 人规模约 280MB 内存

- **定位**：PAGE-020、PAGE-024 / CMP-036、CMP-040；源码见“根因”。
- **级别与置信度**：P2 / confirmed。
- **前提**：admin 登录；名册 2000 人。
- **步骤**：导入/重置后打开通知单；下载全部 PDF；观察内存与是否崩溃。
- **实际**：src/components/Notices.tsx:99 注释估算 144dpi 每页约 140KB，2000 人约 280MB；代码为每页创建 canvas，toBlob 后把所有 jpeg Uint8Array 放进 pages，最后交给 PDF。
- **预期**：大批量打印应按班级/分段生成并释放 canvas，峰值内存有预算。
- **影响**：低内存设备/浏览器可能在开学批量打印时卡顿或崩溃，打印任务失败。
- **证据**：EV-017（详见 `audit.json`）。
- **根因**：renderDoc 的 pages 数组保留全部 JPEG；没有分批下载或流式写入。（confirmed）
- **方案**：按班级/每 100 页分批生成并下载多个 PDF，或在生成后释放 canvas/JPEG；UI 显示批次与进度。
- **复验**：生成 500/2000 页通知单，测量峰值内存与完成时间；失败时提示按班级重试。
- **关联**：CMP-036、CMP-040；任务 TASK-007。
- **处置**：open，等待实施与复验。

## FND-008 通知单印章使用浏览器本地日期，与其他页面的 Asia/Shanghai 日期不一致

- **定位**：PAGE-020、PAGE-024 / CMP-036、CMP-040；源码见“根因”。
- **级别与置信度**：P3 / confirmed。
- **前提**：admin 登录；浏览器时区非 Asia/Shanghai。
- **步骤**：生成重置/开户通知单；读取印章日期；与银行当天日期比较。
- **实际**：src/components/Notices.tsx:134-136 用 new Date() 的 getFullYear/getMonth/getDate/getHours 本地时间；同一文件的 today() 用 Asia/Shanghai。
- **预期**：所有正式通知单日期按银行时区 Asia/Shanghai 输出。
- **影响**：设备时区与银行不一致时，通知单日期可能跨日，影响凭证一致性。
- **证据**：EV-017（详见 `audit.json`）。
- **根因**：印章日期未复用 format.ts 的 Asia/Shanghai 格式化。（confirmed）
- **方案**：统一使用 formatTime/formatDate 的 Asia/Shanghai 实现，传入 at 时间而非本地 Date 字段。
- **复验**：浏览器时区设为 America/New_York，生成重置通知单，日期应与 Asia/Shanghai 当天一致。
- **关联**：CMP-036、CMP-040；任务 TASK-008。
- **处置**：open，等待实施与复验。

## FND-009 时间滚轮空值停在 00 时不触发选择，确定可能保持空值

- **定位**：PAGE-016 / CMP-060；源码见“根因”。
- **级别与置信度**：P3 / confirmed。
- **前提**：admin 登录；打开按时段筛选。
- **步骤**：打开时间滚轮；保持空值滚到 00；点击确定。
- **实际**：TimePicker 的 onPick 条件 x !== (current || items[0])；空值 current 为空时 items[0]=="00" 被视为已选，滚到 00 不触发 onPick；确定不校验/补全。
- **预期**：空值下滚到 00 也应产生选择；确定前必须有有效时分。
- **影响**：用户无法用滚轮选择 00 点/00 分，只能点数字；空值可能提交。
- **证据**：EV-018（详见 `audit.json`）。
- **根因**：empty 与 00 的等价判断；缺少 confirm 时校验。（confirmed）
- **方案**：区分 null 与 "00"；滚动停止时始终 onPick；确定时若未选则选中当前轮值或禁用。
- **复验**：空值打开 → 滚到 00:00 → 确定 → 值为 00:00；空值直接确定 → 不关闭或显示提示。
- **关联**：CMP-060；任务 TASK-009。
- **处置**：open，等待实施与复验。

## FND-010 参数步进器允许清空后保存 0，客户端无内联校验

- **定位**：PAGE-029 / CMP-061；源码见“根因”。
- **级别与置信度**：P3 / confirmed。
- **前提**：admin 登录；/admin/settings。
- **步骤**：清空单笔取款上限；点保存；观察请求与错误。
- **实际**：Stepper 输入经 digits 可清空；changed 会包含空串，保存 Number("")=0；服务端 set_settings 拒绝，用户只在提交后看到错误。
- **预期**：空值/低于 min 时内联提示并禁用保存；数字边界在客户端与服务端一致。
- **影响**：表单可提交明显无效参数，增加往返与困惑；不会写入错误数据。
- **证据**：EV-019（详见 `audit.json`）。
- **根因**：Stepper 以 string 保存，未校验空串；保存按钮只看 changed。（confirmed）
- **方案**：保留编辑字符串，blur/保存前校验 1..max；空值显示错误并禁用保存；Stepper +/- 用当前有效值。
- **复验**：清空单笔限额 → 显示“请输入 1–N”且保存禁用；输入 0/NaN 不能提交。
- **关联**：CMP-061；任务 TASK-010。
- **处置**：open，等待实施与复验。

## FND-011 报表/流水日期区间非法时仍下发查询

- **定位**：PAGE-017、PAGE-016 / CMP-031、CMP-010；源码见“根因”。
- **级别与置信度**：P3 / confirmed。
- **前提**：admin 登录；/admin/reports。
- **步骤**：把开始日期设到结束日期之后；观察请求与统计。
- **实际**：TimeRange 显示“开始日期不能晚于结束日期”，但 from/to 仍进入 query；reports 的 badTime 只用于展示，不阻断查询。
- **预期**：非法区间应禁用查询/导出并保留上一次有效结果，或纠正到有效区间。
- **影响**：空结果与误导性报表；用户可能误以为无业务。
- **证据**：EV-020（详见 `audit.json`）。
- **根因**：校验结果未作为 query enabled/导出 disabled 的条件。（confirmed）
- **方案**：将 valid 状态提升到页面，非法时 enabled:false 并显示提示；导出按钮同步禁用。
- **复验**：from > to → 不发请求、不导出、显示错误；修正后自动恢复。
- **关联**：CMP-031、CMP-010；任务 TASK-011。
- **处置**：open，等待实施与复验。

