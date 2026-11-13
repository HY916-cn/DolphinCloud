# 海豚云 · 第二阶段开发文档

> 依据：[分阶段产品文档](../product/PRODUCT.md) 第 5 节「阶段二：完善运营与管理」及第 6 节中提前到本阶段的部分、[功能需求 3.0](../requirements/REQUIREMENTS.md)、[第一阶段开发文档](PHASE-1.md)
>
> 本文只写第二阶段**新增和改动**的部分；架构、约定、部署、已有的表和函数沿用 PHASE-1.md，引用时写作「P1 §x」。产品范围以产品文档为准，两者不一致时先改产品文档再改本文。
>
> 本文每一条规则都已与需求方逐项确认（2026-11-07）。尚未拍板的细节集中列在第 20 节。

---

## 1. 范围

### 1.1 上线方式

第一阶段与第二阶段合并上线：全部开发完成后，一起试运行、一起上线（P1 §12 的上线步骤顺延到本阶段末尾的 M15）。产品文档第 3 节原来的「前一阶段稳定运行满一个完整月再上线下一阶段」不再适用于阶段一、二。

### 1.2 本阶段交付

| 模块 | 交付内容 |
| --- | --- |
| 下班总结 | 增加按面额的现金汇总：备用金、收入、付出、应有，各面额张数与金额 |
| 工作人员导入 | 像名册导入一样，用 Excel 批量创建工作账号，并为柜员批量绑定工资账户；所有创建账号和重置密码的操作都出每人一页的通知单 |
| 学期 | 银行管理员登记每学期的起止日期；学期末结转，余额与信用分转入下学期，上学期数据只读可查 |
| 海豚信用分 | 每位学生 0～1000 分，初始 600；按还款、存款习惯、账户时长与余额加减分；按分数连续计算贷款额度、贷款利率和储蓄利率（不分档） |
| 利率 | 每周一按公式算出「锚点」利率，储蓄与贷款利率都挂在锚点上同涨同跌；每天计息，每周一结息 |
| 活期与定期 | 账户余额即活期，按天计息；柜台可把活期转为 2 / 4 / 8 周的定期，到期自动转回活期并付息，可提前支取 |
| 贷款 | 柜台当场办理，不设审批：分期（每周一期，等额本金）或到期一次还清；放款、还款都可走账户或现金；到期自动从余额扣款；逾期标红、罚息、扣信用分、暂停新贷款 |
| 轧账 | 每位柜员每次上班一次：上班登记备用金，下班录入储蓄盒实点，系统按面额比对，财务复核 |
| 风险提醒 | 大额贷款、大额取款、提前支取、冲正与频繁操作、参数与信用分修改、库存不足、轧账不平都记一条提醒；行长和银行管理员可「已查看」或「终止」（执行对应的撤销操作） |
| 货币 | 银行管理员登记上线时的银行期初现金、新发行、回收、销毁；纸币与电子币分开监控 |
| 库存预警 | 低于安全库存时在总览和风险提醒里提示 |
| 经营看板 | 总览页顶部 6 个核心指标、按周业务柱状图、未处理的风险提醒 |
| 报表导出 | 流水导出按现有台账样表对齐列；报表与导出加入贷款、还款、利息、定期 |
| 学生端 | 新增「信用」页；首页显示待入账利息、定期、贷款；明细加「利息」「贷款」分类 |

### 1.3 本阶段不做

| 内容 | 说明 |
| --- | --- |
| 胸卡扫码 | 柜台继续按姓名、拼音、班级或学号搜索 |
| 凭条打印 | 暂不实现；以后实现时全部业务办完自动打印 |
| 盘点 | 删除；库存只通过出入库调整 |
| 商品条码 | 不扫码，手动清点 |
| 贷款审批 | 改为风险提醒 + 事后终止 |
| 存折业务 | 新办、补办、销户都不做；销户沿用银行管理员注销（P1 §6.4 `close_accounts`） |
| 对公业务、积分转海豚币、兑换扣闪光点 | 以后再定 |
| 家长端、教师端 | 阶段三 |

---

## 2. 关键决策

| 主题 | 决定 | 说明 |
| --- | --- | --- |
| 学生的权限 | 学生仍不能发起任何账务操作 | 依据需求 3.0 第二部分「一、用户角色与权限」。贷款、还款、开定期、提前支取都在柜台由柜员办理，学生端只能查看 |
| 贷款审批 | 不审批，当场放款 | 额度由信用分算出；高风险的贷款进入风险提醒，行长或银行管理员事后可终止（提前到期） |
| 利率来源 | 只用公式，不接大模型 | 每周的输入、中间值和结果都保存，任何时候可复算 |
| 利息的来源 | 利息算作新增发行 | 利息没有现金对应，货币监控里单独列为「电子币新增」 |
| 金额单位 | 余额仍是整数 HTB；利息在内部按 0.01 HTB 累计 | 满 1 HTB 入账，零头留到下次 |
| 定时任务 | 容器内常驻一个任务进程，到点调用数据库函数 | 与每日备份相同（supervisord 管理）；每个任务可重复执行、错过会补跑（第 13 节） |
| 轧账 | 按柜员的一次上班 | 一个柜员一个储蓄盒；轧账不锁定流水 |
| 货币监控 | 从上线那天起算 | 上线前学校发出去的纸币不登记、不追究；阶段一 `currency_issues` 里的旧记录不计入 |

---

## 3. 角色与权限

身份不变（P1 §4.1）。行长保持现有权限（等同银行管理员，不管理账号），另加风险提醒的查看与终止。下表只列本阶段新增的操作。

| 操作 | 学生 | 柜员 | 财务 | 库管 | 行长 | 银行管理员 | 运维员 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 查看本人信用分、利息、贷款、定期 | ✓ | | | | | | |
| 办理贷款、还款、开定期、提前支取 | | ✓ | | | | | |
| 冲正本人当天的放款、还款、开定期 | | ✓ | | | | | |
| 上班登记备用金、下班录入实点 | | ✓ | | | | | |
| 复核轧账 | | | ✓ | | | | |
| 查看全部贷款、定期、信用分、利率 | | | ✓ | | ✓ | ✓ | |
| 风险提醒：查看、已查看、终止 | | | | | ✓ | ✓ | |
| 手动调整信用分 | | | | | | ✓ | |
| 利率参数、信用分参数、风险阈值 | | | | | ✓ | ✓ | |
| 登记学期、学期结转 | | | | | | ✓ | |
| 登记银行期初现金、发行、回收、销毁 | | | | | | ✓ | |
| 查看货币监控 | | | ✓ | | ✓ | ✓ | |
| 经营看板 | | | ✓ | | ✓ | ✓ | |
| 库存预警（总览） | | | | ✓ | ✓ | ✓ | |
| 批量导入工作人员 | | | | | | ✓ | ✓ |
| 免学生密码绑定工资账户 | | | | | | ✓ | ✓ |

- 柜员仍不能为本人或本人的工资账户办理任何业务（`SELF_SERVICE_FORBIDDEN`），包括贷款和定期。
- 运维员仍不能办理业务、不能修改业务数据。

---

## 4. 下班总结的面额汇总

P1 §7.5 的「柜员下班总结」在逐笔业务之后加一张现金表，柜员拿它直接对着储蓄盒数钱。

```
本次上班现金（不含已冲正的业务）

            1元  2元  5元  10元   合计
备用金 张数     20    10     4     2
       金额     20    20    20    20    80 HTB
收入   张数     12     5     3     4
       金额     12    10    15    40    77 HTB
付出   张数      2     1     2     3
       金额      2     2    10    30    44 HTB
应有   张数     30    14     5     3
       金额     30    28    25    30   113 HTB
实点   张数   ____  ____  ____  ____
```

- 面额列取参数 `denominations`（P1 §5.3）。
- **收入** = 存款收到的 + 现金兑换收到的 + 现金还款收到的。
- **付出** = 取款配出的 + 现金兑换找零 + 现金放款配出的。
- **应有** = 备用金 + 收入 − 付出。某面额为负时写「少 N 张」（备用金里这种面额不够，柜员用了别的面额找零）。
- 已冲正的业务和它的冲正流水都不计入。冲正发生在另一次上班时，现金计入办理冲正的那次上班（见 7.3）。
- 「实点」一行在下班时由柜员录入（第 7 节）；打印的总结里是空格，签字人手写核对。

---

## 5. 工作人员导入与通知单

### 5.1 导入模板

| 账号 | 姓名 | 身份 | 工资账户 |
| --- | --- | --- | --- |
| 必填，2～32 位小写字母、数字、. _ -，以字母或数字开头（同单个新增） | 必填 | 必填：柜员 / 财务 / 库管 / 行长 / 运维员 | 可空，学号；只对柜员有效，其他身份填了报错 |

流程与名册导入相同（P1 §6.5）：

1. 前端用 SheetJS 读取，校验表头、必填项、账号重复（表内和库里的停用、注销账号都算）、身份文字、工资账户（学号存在、在读、未被其他工作人员绑定、表内不重复），错误行标出行号，全部通过才能导入。
2. 每 100 行调用一次 `import_staff`，每批一个事务。
3. 新账号：创建账号和身份，生成随机初始密码；填了工资账户的同时绑定。
4. 已存在的账号：只更新姓名和工资账户绑定（工资账户留空表示不改，解除绑定仍在工作人员详情里做）；不改密码、不改身份。身份与表里不同时报错，请到工作人员详情里改。
5. 银行管理员账号不能导入（全系统只有一个，P1 §4.1）。
6. 「参与考勤」不在模板里，仍在考勤页逐个开启。
7. 结束显示「新建 N 人、更新 M 人、绑定工资账户 K 人」，并提供通知单。

### 5.2 免密码绑定

- 银行管理员或运维员绑定工资账户（导入或在工作人员详情里单个绑定）时不再需要该学生的登录密码，每次绑定写一条日志（`salary.bind`，写明操作人、柜员、学号）。
- 柜员在「我的」里给自己绑定，仍要输入学生密码（P1 §6.9 的规则不变）。
- 行长不能绑定（行长不管理账号）。

### 5.3 通知单

**所有创建账号和重置密码的操作都出通知单**：名册导入、工作人员导入、单个或批量新增工作人员、单个或批量重置密码（`dolphin reset-admin` 除外）。学生只从名册开户，没有单个新增。

- 每人一页 A4，打印或下载 PDF。
- 学生：姓名、班级、学号、初始密码、登录网址（与 P1 §6.5 相同）。
- 工作人员：姓名、身份、账号、初始密码、登录网址；柜员另写工资账户（学生姓名、学号），未绑定写「未绑定」。
- 重置密码的通知单标题写「密码已重置」，并写重置时间，文件名为「重置密码通知单」。
- 学生「开户通知单」重新生成新密码时仍是开户通知单：这些学生还没有登录过。
- 都提示「首次登录后请立即设置新密码」；初始密码只在这次结果里出现，离开页面后不能再看到。

---

## 6. 学期

### 6.1 登记

- 银行管理员在后台「学期」页登记：名称（如「2026 学年第一学期」）、开始日、结束日。
- 学期不能重叠；结束日不早于开始日；已开始的学期不能改开始日，已结转的学期不能改。
- 已经过去的日子不移进、也不移出学期：结束日只有新旧两个日期都不早于今天时才能改；未开始的学期改开始日时，新开始日不早于今天。新登记的学期可以从过去的日子开始（如上线时登记正在进行的学期），定时任务已经处理过的日子不补算。
- 学期名称不能重复（`ALREADY_EXISTS`）；与其他学期日期重叠时返回 `TERM_OVERLAP`，详情 `{"term": "重叠的学期名称"}`；改已结转的学期返回 `TERM_CLOSED`；不能改的日期返回 `INVALID_INPUT`（`field` 为 `starts_on` 或 `ends_on`）。
- 所有登录身份都能读学期表 `terms`；某天所在的学期由 `app_private.current_term(d)` 给出，需要当前学期的业务调用 `app_private.require_term()`，假期里报 `NO_TERM`。
- 下一学期要在本学期结束前登记，否则开学后没有「当前学期」：不计息、不结息，不能办贷款和定期（`NO_TERM`），其他业务照常。
- 两个学期之间是假期。

### 6.2 学期与各项规则

- **计息**：只在学期内的日子计息，周末和节假日也算（一周 7 天）。假期不计息、不结息、信用分不变、锚点不变；开学后的第一个周一恢复。
- **期限**：贷款和定期最长 8 周，到期日不能晚于本学期结束日；临近学期末时柜台只列出放得下的期限。

### 6.3 结转

- 学期结束日之后，银行管理员在「学期」页点「结转」（二次确认）。结束日当天及以前返回 `TERM_NOT_ENDED`，详情 `{"ends_on": "结束日"}`；已结转的返回 `TERM_CLOSED`。
- 前提：没有未结清的贷款、没有未到期的定期（因为期限都不跨学期末，正常情况下到期已全部处理完；逾期贷款要先结清或由银行管理员处理），每天的任务已处理完学期最后一天。不满足时返回 `TERM_OPEN_ITEMS`，详情 `{"items": [...]}` 列出名单，每项带 `kind`：`job` 为每天的任务还没处理完（`{"kind":"job","job":"daily","done_to":"…"}`，补跑后再结转）；`term_deposit` 为本学期开的、还没转回活期的定期（`{"kind":"term_deposit","id","student_no","name","principal","matures_on"}`，按到期日排列）；`loan` 为本学期放款、还没结清的贷款（`{"kind":"loan","id","loan_no","student_no","name","remaining","status","due_on"}`，`due_on` 为最后一期应还日，按它排列）。名单由 `app_private.term_open_items(term)` 给出。
- 结转后余额、信用分原样转入下学期，不生成流水。
- 上学期的流水、利息、贷款、定期、轧账归档为只读（它们本来就不能修改）；报表、流水查询、学生明细都可以按学期筛选。
- 结转写一条日志 `term.close`。

---

## 7. 轧账

### 7.1 流程

1. **上班**：柜员点「上班」时登记储蓄盒里的备用金（各面额张数）。默认填上次下班时的实点（M12 之前是上次的备用金），可修改；没有备用金就全填 0。
2. **办理**：照常。
3. **下班**：下班总结（第 4 节）生成后，柜员数储蓄盒，录入各面额的实点张数。系统按面额比对：
   - 每种面额都相等：显示「平账」，打印签字后确认下班。
   - 有差额：显示每种面额多几张、少几张，以及本次上班的逐笔现金业务，供柜员逐笔核对；柜员必须写明原因才能确认下班，同时生成一条风险提醒（`cash_unbalanced`）。
4. **复核**：财务在后台「轧账」页看到待复核的上班记录（柜员、上下班时间、应有、柜员实点、差额、原因），收到储蓄盒后再点一遍：
   - 一致：点「复核通过」，状态变为「已轧账」。
   - 不一致：录入财务点出的各面额张数，写明原因后「复核通过」；以财务的数为准，差额重新计算，有差额时生成风险提醒。

### 7.2 状态

| 状态 | 含义 |
| --- | --- |
| 待下班 | 正在上班 |
| 待复核 | 柜员已下班并录入实点 |
| 已轧账 | 财务已复核（平账，或不平但写明了原因） |
| 强制下班 | 被风险提醒「终止」强制下班，没有柜员实点；由财务直接点数录入后复核 |

- 轧账后不锁定流水。
- 下班后第二天仍未复核的，在看板和财务总览上标红。

### 7.3 冲正与轧账

- 柜员只能在上班时冲正本人当天的业务（P1 §6.9 的 `require_duty`），所以冲正总落在柜员的某一次上班里。冲正的现金进出算在**办理冲正的那次上班**：如果原业务在更早的一次上班里，那次的应有不变，复核页在那次上班旁注明「其中 N 笔已于 HH:MM 冲正」。
- 银行管理员、行长冲正（含风险提醒里的「终止」）不在任何一次上班里，冲正涉及的现金不进轧账，由银行管理员线下处理，货币监控里计入「银行应有现金」。

---

## 8. 海豚信用分

### 8.1 分数

- 每位学生一个分数，0～1000 分，开户时 600 分（本阶段上线时现有学生全部从 600 起；以后名册导入开户的学生由 `students` 的插入触发器建 600 分）。
- 每次变动都记一条记录（时间、变动、变动后分数、原因），学生在「信用」页能看到。
- 分数超出 0～1000 时截断，记录里的「变动」是截断后实际加减的分数；实际变动为 0 时不记录。
- 所有变动都经过 `app_private.credit_change(学号, 变动, 规则, 原因, ref, 操作人)`：`变动` 为空时取 `credit_rules` 里该规则的分值；同一学生、同一规则、同一 `ref` 只记一次（`credit_events_once` 唯一索引），重复调用直接跳过。每周规则、M11 的还款规则、手动调整和 M13 的「终止」都走它。
- **按分数连续计算，不分档、不显示星级**：每多 1 分，额度和利率都可能变化。

```
贷款额度（400 分以下不能贷款）
  = 50 + (分数 − 400) ÷ 600 × 250，向下取整到 5 HTB

贷款系数 = 1.8 − (分数 − 400) ÷ 600 × 0.7      （400 分以上才有）
储蓄系数 = 0.8 + 分数 ÷ 1000 × 0.4
```

| 分数 | 单笔贷款额度 | 贷款系数 | 储蓄系数 |
| --- | --- | --- | --- |
| 0 | 不能贷款 | — | ×0.8 |
| 400 | 50 HTB | ×1.8 | ×0.96 |
| 600 | 130 HTB | ×1.5667 | ×1.04 |
| 750 | 195 HTB | ×1.3917 | ×1.1 |
| 900 | 255 HTB | ×1.2167 | ×1.16 |
| 1000 | 300 HTB | ×1.1 | ×1.2 |

两端的数（400、50、300、1.8、1.1、0.8、1.2）和取整单位 5 HTB 都是参数（`credit_curve`）。系数保留 4 位小数（四舍五入）。

- 计算函数都读 `credit_curve`：`app_private.credit_limit(分数)`（额度，400 分以下为空；按整数计算，恰好是 5 的倍数的额度不会因为舍入少 5）、`app_private.loan_factor(分数)`（400 分以下为空）、`app_private.saving_factor(分数)`。
- 「再涨 N 分，额度加 5 HTB」：`app_private.credit_next(分数)`，N 是让额度多一个取整单位所需的最少分数；分数不够贷款或额度已到上限（1000 分时的额度）时为空。例如 600 分时额度 130，再涨 4 分到 604 分额度 135。
- 读取：学生用 `credit_profile()` 读本人的；财务、行长、银行管理员用 `credit_profile(学号)` 读任一学生的；柜员在 `lookup_student` 返回的 `credit` 里看到正在办理的学生的分数（第 15 节）。

### 8.2 加减分规则

所有分值都是参数（`credit_rules`）。

| 类别 | 事件 | 分值 | 何时记 |
| --- | --- | --- | --- |
| 还款 | 按时还清一期（应还日当天或之前） | +5 | 还清那一期时 |
| 还款 | 提前还清一笔贷款（放款满 7 天后） | +10 | 结清时；放款不满 7 天就还清、或放款被冲正的不加 |
| 还款 | 逾期（应还日结束仍未还清） | −50 | 逾期当天结束时 |
| 还款 | 逾期后仍未还清，每满一周 | −30 | 每周一 |
| 还款 | 逾期后还清 | 0 | 恢复申请资格 |
| 存款习惯 | 上周有存款 | +3 | 每周一 |
| 存款习惯 | 连续 4 周都有存款 | 再 +10 | 每周一（第 4、8、12……周） |
| 存款习惯 | 上周取款合计超过上周初余额的一半 | −5 | 每周一 |
| 账户时长与余额 | 开户每满 4 周 | +2 | 每周一 |
| 账户时长与余额 | 上周日均余额（活期 + 定期）≥ 100 HTB | +2 | 每周一 |
| 账户时长与余额 | 上周日均余额 ≥ 300 HTB | 再 +2 | 每周一 |

- 「存款」只算柜台存款（`deposit`），不含工资、利息、放款；已冲正的不算。「取款」只算柜台取款（`withdraw`），已冲正的不算。冲正以周一 0 点为界：周一以后才冲正的存款、取款，仍按周一当时的情况计入上一周。
- 「上周」是上周一到上周日；「上周初余额」是上周一开始前（上上周日结束时）的余额；周初余额为 0 时，上周有任何取款都算超过一半。
- 日均余额 = 上周 7 天每天结束时余额（活期 + 定期本金 − 剩余贷款本金）的平均值（第 7 天以前开户的，开户前按 0 算），借来的钱不抬高日均余额。每天结束时的定期本金按记在当天 24:00 以前的 `term_open`、`term_close` 和它们的冲正还原（`app_private.deposits_on(学号, 日期)`），剩余贷款本金按记在当天 24:00 以前的 `loan`、`repay` 和它们的冲正还原（`app_private.loans_on(时刻, 学号)`）；两者相减是 `app_private.net_deposits_on(学号, 日期)`。「上周初余额」只算活期。
- 「连续 4 周」按自然周往回数：从上周起每周都有存款的周数，数到 4、8、12……时加分；中间任何一周（包括假期里的周）没有存款就重新数。
- 「开户每满 4 周」：开户日加 28 天、56 天……落在上周二到本周一之间时加分。
- 每周一的加减分只在学期内进行；假期里信用分不变。学期开始后的第一个周一不加减分（上一周在假期里），学期结束日之后的周一在假期里，所以学期最后一周不计入：18 周的学期记 17 次。
- 冻结、毕业、注销的学生不再加减分（按运行时的状态）；周一当天及以后开户的学生从下一周起计。
- 每条每周变动的 `ref` 是 `weeks:周一日期`，同一周重复运行或补跑不会重复记分；计算只用周一日期和周一以前的流水，所以停机后补跑的结果与每周按时运行相同。每周变动的时间记为周一 0 点（`credit_change` 的 `p_at`），补跑时也一样，活期计息按它还原每天结束时的分数（9.3）。
- 一个没有贷款、每周都存钱、余额 100 以上的学生，一学期 17 次每周加减分：每次 +3（存款）+2（日均余额），4 次连续存款 +10，4 次开户满 4 周 +2，从 600 涨到 733，额度从 130 涨到 185 HTB；日均余额一直在 300 以上的再多 34 分，到 767 分、额度 200 HTB。
- 还款相关的 4 条由 M11 调用 `credit_change(学号, null, 规则, 原因, ref, null, 时间)`：
  - `repay_on_time`（ref `loans:<id>:<期数>`）：一期在应还日当天或之前还清（含应还日当天结束时的自动扣款），时间为这笔还款的时间；应还本金为 0 的期（多还后重新平均出来的）不加。原因「按时还清贷款 DK… 第 N 期」。
  - `repay_early`（`loans:<id>`）：结清的那天早于最后一期应还日、距放款满 7 天、从未逾期。原因「提前还清贷款 DK…」。
  - `overdue`（`loans:<id>:<期数>`）：应还日结束时仍未还清，时间为应还日次日 0 点；同一天有几期一起逾期（终止、学期末提前到期）只扣一次，期数取其中最早的一期。原因「贷款 DK… 第 N 期逾期」。
  - `overdue_week`（`loans:<id>:<周一>`，在 `run_weekly` 的每周加减分之后）：周一 0 点仍逾期、未还清的逾期期里最早的应还日已过满 7 天（应还日 ≤ 周一 − 8），时间为周一 0 点。原因「贷款 DK… 逾期满 N 周」，N =（周一 − 1 − 应还日）÷ 7 取整。
  - 终止的贷款不再加分（按时、提前都不加）；冻结、毕业的学生的贷款照常扣款、照常按这 4 条加减分；冲正还款不撤回已经记的分，重新还款也不重复加。

### 8.3 手动调整

- 银行管理员可以给一位学生加减分，必须写原因；记为一条变动（`rule = 'manual'`，原因前加「银行管理员调整：」，`actor_id` 为银行管理员），写日志 `credit.adjust`，并生成风险提醒（`credit_adjust`，M13）。行长和其他身份不能调整。
- `adjust_credit(p_student_no, p_delta, p_reason)`：变动为 −1000～1000 的非 0 整数；超出 0～1000 时截断；已在 0 或 1000、实际变动为 0 时返回 `INVALID_INPUT`（`field: delta`）。原因为空返回 `INVALID_INPUT`（`field: reason`）；学生不存在返回 `STUDENT_NOT_FOUND`；已注销返回 `ACCOUNT_CLOSED`；冻结、毕业的学生可以调整。
- 风险提醒里「终止」一条手动调整 = 再记一条相反的变动，恢复原分。

### 8.4 呈现：信用仪表盘

所有地方的信用分都用仪表盘呈现，不单独写数字。设计系统里先新增 `CreditGauge` 组件（M8 开始前完成，按设计系统的流程发布后再用到客户端）：

- 半圆弧，0～1000，指针指向当前分数，中间大字写分数。
- 弧线颜色渐变：400 以下红（不能贷款）→ 橙 → 绿；400 处一个刻度「可贷款」。
- 分数变化时指针转到新位置；系统设置了减少动效时直接跳过去。
- 三种大小：

| 大小 | 用在 | 附带内容 |
| --- | --- | --- |
| 大 | 学生「信用」页、后台学生信用详情 | 下方写贷款额度和「再涨 N 分，额度加 5 HTB」 |
| 中 | 柜台「贷款」「定期」面板、学生首页、贷款详情 | 下方写贷款额度 |
| 小 | 柜台学生卡片、后台各列表里的一行 | 只有弧线和数字，与文字同高 |

- 变动记录里的 +5、−50 仍是文字；只有「分数」用仪表盘。
- 无障碍：组件带 `role="meter"`、`aria-valuemin=0`、`aria-valuemax=1000`、`aria-valuenow`，读屏读作「海豚信用分 680 分」。

---

## 9. 利率与计息

### 9.1 锚点

每周一凌晨（学期内）按上周的数据计算本周的锚点。锚点是储蓄系数为 1（500 分）时的活期周利率。

```
存款余额 = 全体学生的活期余额 + 定期本金
存贷比   = 贷款剩余本金合计 ÷ 存款余额
增速     = 本次的存款余额 ÷ 上周一的存款余额 − 1

调整 = +0.25 × (存贷比 − 30%) ÷ 10%
       − 0.25 × (增速 − 2%) ÷ 1%
调整限在 −0.5 ～ +0.5（百分点）

本周锚点 = 上周锚点 + 调整，限在 1% ～ 4%；保留两位小数（百分数）
初始锚点 2%
```

- 例：存贷比 40%、增速 2% → 调整 +0.25 → 2.25%。
- 例：存贷比 30%、增速 4% → 调整 −0.5 → 1.5%。
- 存款余额为 0 时（刚上线）存贷比按 0、增速按 0 计算。
- 假期后的第一个周一不调整，沿用放假前的锚点（假期里的增速没有意义）。
- 公式的数都存在 `anchor_params` 里。行长、银行管理员可以改初始锚点（2%）和上下限（1%～4%），从下一次计算起生效，并生成风险提醒；30%、2%、0.25、±0.5 由系统固定。
- 每周保存一行：周一日期、上周锚点、存款余额、贷款余额、存贷比、增速、调整、本周锚点和当时的 `anchor_params`。后台「利率」页列出全部历史，可据此复算。
- 学期内每个周一都保存一行，学期的第一个周一也保存（调整为 0，增速为空），作为下周算增速的基数。上周一没有记录（第一次运行，或上周一不在学期内）时同样不调整；第一次运行时「上周锚点」取初始锚点。
- 存款余额、贷款余额都按周一 0 点（上海时间）以前的流水计算，补跑时结果不变；本周一的结息流水记在周一 0 点，不计入。贷款余额由放款、还款的本金部分和它们的冲正还原（`app_private.loans_on(周一 0 点)`）；周日应还的自动扣款记在周一 0 点，同样不计入。存款余额不扣贷款（它本身就和贷款相比）。
- 存贷比、增速以百分数保存，保留 4 位小数；上周一的存款余额为 0 时增速也按 0。调整按公式算出并限幅后保留 2 位小数，加到上周锚点上再限在 1%～4%。
- 函数：`app_private.anchor_adjust(存贷比, 增速, 参数)` 算调整；`app_private.publish_anchor(周一, 是否学期第一个周一)` 计算并保存一行（同一周再算时保留原来那行）；`app_private.anchor_on(日期)` 读某天适用的锚点，即不晚于这一天的最近一个周一的锚点，还没有时为初始锚点（假期后、学期第一个周一之前的几天沿用放假前的锚点）。

### 9.2 各项利率

全部是**周利率**，都由当周锚点算出，同涨同跌。贷款利率始终高于最高的储蓄利率，没有借钱存定期套利息的空间。

| 项目 | 公式 |
| --- | --- |
| 活期 | 锚点 × 储蓄系数 |
| 定期 2 周 | 锚点 × 1.25 × 储蓄系数 |
| 定期 4 周 | 锚点 × 1.5 × 储蓄系数 |
| 定期 8 周 | 锚点 × 2 × 储蓄系数 |
| 贷款 | 锚点 × 2 × 贷款系数 |
| 逾期罚息 | 该笔贷款利率 × 1.5 |

锚点 2% 时：

| 分数 | 活期 | 定期 2 周 | 定期 4 周 | 定期 8 周 | 贷款 |
| --- | --- | --- | --- | --- | --- |
| 0 | 1.6% | 2.0% | 2.4% | 3.2% | 不能贷款 |
| 400 | 1.92% | 2.4% | 2.88% | 3.84% | 7.2% |
| 600 | 2.08% | 2.6% | 3.12% | 4.16% | 6.2667% |
| 750 | 2.2% | 2.75% | 3.3% | 4.4% | 5.5667% |
| 900 | 2.32% | 2.9% | 3.48% | 4.64% | 4.8667% |
| 1000 | 2.4% | 3.0% | 3.6% | 4.8% | 4.4% |

同一分数下，贷款利率总高于活期和 2、4 周定期；但约 936 分以上时 8 周定期会高于贷款利率，所以**有未结清贷款的学生不能新开定期**（`LOAN_OUTSTANDING`），没有借钱存定期套利息的空间。利率保留 4 位小数（百分数）。

存期倍数（1.25 / 1.5 / 2）、贷款倍数（2）、罚息倍数（1.5）由系统固定，存在 `term_multipliers`、`loan_multiplier`、`penalty_multiplier` 里。

- 计算时用不取整的贷款系数和储蓄系数，最后一步保留 4 位小数：600 分的贷款利率是 2 × 2 × 1.5666… = 6.2667%。
- 函数：`app_private.saving_rate(锚点, 分数)`（活期）、`app_private.term_rate(锚点, 周数, 分数)`（定期，周数没有倍数时为空）、`app_private.loan_rate(锚点, 分数)`（最低分以下为空）、`app_private.penalty_rate(贷款利率)`；`app_private.rates(锚点, 分数)` 一次给出活期、三种定期和贷款。M10 开定期时锁定 `term_rate`，M11 放款时锁定 `loan_rate`，逾期按 `penalty_rate` 计罚息。

### 9.3 活期计息

- 学期内每天结束时（上海时间 24:00），按当天结束时的活期余额 × 当天的活期周利率 ÷ 7 计算当天利息，精确到 0.01 HTB（舍去更小的部分）。
- 储蓄系数按当天结束时的信用分。
- 冻结、毕业、注销的账户不计息；解冻后从当天恢复。
- 每天每人一行计息记录（日期、余额、利率、利息），可复算：每个在读、当天结束前已开户的账户都有一行，余额为 0 时利息为 0；同一天再算不重复。
- 当天结束时的余额 = 记在当天 24:00 以前的全部流水之和；当天结束时的信用分 = 现在的分数减去记在 24:00 以后的变动。补跑时按这两条还原，结果与每天按时运行相同。
- 冻结、毕业、注销按任务运行时的状态判断（与 8.2 相同）。
- 例：余额 100 HTB、600 分、锚点 2%：100 × 2.08% ÷ 7 = 0.2971，记 0.29 HTB。
- 函数：`app_private.accrue_interest(日期)`，由 `run_daily` 调用。

### 9.4 结息

- 每周一凌晨，把上周（周一至周日）累计的活期利息加上之前的零头，整数部分以一笔 `interest` 流水存入活期，零头留到下周。
- 结息流水记在周一 0 点（上海时间），补跑时也一样；`operator_id` 是系统账号（14.2），说明写「11月10日至11月16日活期利息」（所结的计息记录的起止日）。
- 未结的利息加零头不满 1 HTB 时不生成流水，这些计息记录留到下次一起结。结过的计息记录写上 `settled_txn`，所以「已结的计息记录之和 = 100 × 利息流水之和 + 零头」，`check_balances` 按这个等式逐个账户自检（`kind = 'interest'`）。
- 学期后的周一在假期里，不结息：学期结束日的 `run_daily` 在计息之后结清最后几天的利息，流水记在次日 0 点。
- 冻结、毕业的账户照常结清已计的利息；注销的账户不再结息，注销前已计未结的利息不入账。
- 学生首页显示「攒着的利息 0.37 HTB」：零头加上未结的计息记录，即 `interest_profile()` 的 `pending_centi`（单位 0.01 HTB）。
- 函数：`app_private.settle_interest(流水时间)`，由 `run_weekly` 和学期结束日的 `run_daily` 调用；`app_private.pending_interest(学号)` 给出待入账利息。
- `interest` 流水不能冲正；`cash_delta` 为 0。
- 定期利息在到期时另行支付（9.5）。

### 9.5 定期计息

- 开定期时锁定周利率 = 当周锚点 × 存期倍数 × 当时的储蓄系数（`term_rate`，按开定期那天的锚点和当时的分数）。
- 到期利息 = 本金 × 周利率 × 周数，精确到 0.01 HTB（舍去更小的部分，即 `term_deposits.expected_centi`）。到期时利息与活期的待入账零头相加，整数部分与本金一起转回活期，余下的不满 1 HTB 留作零头（`interest_carry`），下次结息时一起入账；学生端的待入账利息因此包括它。
- 提前支取：只付活期利息。从开定期那天到支取前一天，学期内的每一天按当天的活期利率（当天的锚点和当天结束时的信用分）计算，每天精确到 0.01 HTB（同 9.3）；当天支取的不计息。利息与零头的处理同到期。
- 自检（`check_balances` 的 `interest`）把定期利息并入：100 × (利息流水之和 + 每笔 `term_close` 的利息部分 − 冲正收回的利息部分) + 零头 = 已结的计息记录之和 + 已转回的定期的实付利息之和。

### 9.6 利息与发行

- 利息（活期和定期）没有现金对应，在货币监控里计为「电子币新增」（第 11 节）。
- 工资同样计为电子币新增（P1 已有的 `salary` 流水）。
- 货币监控在 M14 实现；`settle_interest` 里标出了把利息计入电子币新增的位置。

---

## 10. 活期、定期与贷款

### 10.1 活期

账户余额（`accounts.balance`）就是活期，存取款、兑换都从活期走，规则不变。

### 10.2 定期

开定期（柜台「定期」）：

1. 柜员选存期（2 / 4 / 8 周，只列到期日不晚于学期末的），填金额（1 HTB 起，不超过活期余额）。到期日 = 开定期那天 + 7 × 周数。
2. 页面显示锁定的周利率、到期日、到期可得利息（估算）。可选存期、各自的周利率和到期日由 `term_quote(学号)` 给出（柜员读不到 `interest_profile` 和 `rate_weeks`）；估算利息按 9.5 用整数算，避免小数误差：利息（0.01 HTB）= ⌊金额 × round(周利率 × 10000) × 周数 ÷ 10000⌋，与到期时的 `expected_centi` 相同。确认后生成一笔 `term_open` 流水：活期减少，`cash_delta` 为 0。
3. 不能开的情况：有未结清贷款（`LOAN_OUTSTANDING`）、没有当前学期（`NO_TERM`）、到期日晚于学期末（`TERM_TOO_LONG`）、账户不是在读状态（`STUDENT_INACTIVE`）、为本人或本人的工资账户办理（`SELF_SERVICE_FORBIDDEN`）。柜员要在上班中（`OFF_DUTY`），行长不办理。

到期：到期日当天结束时由 `run_daily` 自动处理，生成一笔 `term_close` 流水（本金 + 利息整数部分回到活期，见 9.5），经办人「系统」，时间记为次日 0 点（同学期结束日的结息），所以到期日当天的活期计息不含这笔本金，次日起含。定期状态为「已到期」。不自动续存。学期结束日改早以后，结束日当天还没到期的定期也在那天结束时按到期处理，利息照约定付。

提前支取：柜员在「定期」里选一笔，二次确认后按 9.5 处理，生成 `term_close` 流水，状态为「已提前支取」，并生成风险提醒（`term_early`，M13）。到期日当天还能提前支取，到期日之后（定时任务没跑完时）不能。

一位学生可以同时有多笔定期。

冻结、毕业、注销时还没到期的定期：

- 冻结、毕业：定期照常到期，按约定付息转回活期；冻结、毕业期间不能提前支取（`STUDENT_INACTIVE`）。
- 注销（`close_accounts`）：先把每笔定期按提前支取转回活期，不付利息（注销不再结息，9.4），状态为「已提前支取」、实付利息 0；再与活期一起由「注销账号」流水清零。有未结清贷款（含已终止、逾期的）的学生不能注销，返回 `LOAN_OUTSTANDING`（详情 `{"student_no","loan_no"}`），先结清再注销；一次注销多人时整批不执行。

### 10.3 贷款办理

柜台「贷款」：

- 进入时显示该生的信用分、单笔额度、本周贷款利率、罚息利率和最晚应还日（`loan_quote`）。
- 有未结清贷款时直接显示这笔贷款和「还款」，不能再办新贷款（`LOAN_OUTSTANDING`）。一位学生同一时间只有一笔未结清的贷款（还款中或逾期）。
- 新贷款填：
  - 金额：1 HTB 起，不超过按信用分算出的额度。
  - 用途：必填文字，1～30 字。
  - 还款方式：分期（每周一期，期数 1～8）或一次还清（期限 1～8 周）。最后一期的应还日 = 放款那天 + 7 × 期数（周数），不晚于学期末；超过时返回 `TERM_TOO_LONG`，详情 `{"ends_on","max_weeks"}`（同定期，`max_weeks` 为放得下的最多周数，一周都放不下时为 `null`）。
  - 放款方式：存入账户，或付现金（按面额配钞，同取款）。
- 确认页列出全部应还日和每期应还本金、估算利息（`loan_preview`，算法见 10.4），二次确认后放款，生成一笔 `loan` 流水。存入账户的活期增加；付现金的活期不变，`cash_delta` 为负，配钞记在流水的 `denominations`，计入下班总结的「付出」。
- 放款时锁定周利率 = `loan_rate(本周锚点, 当时的分数)`，记在 `loans.rate`，还清前不变；罚息利率 = `penalty_rate(loans.rate)`。
- 贷款号 = `DK` + 放款日 `YYMMDD` + 序号（全系统递增，至少 4 位，如 `DK2611120001`）。
- 不能办的情况：信用分低于 400（`CREDIT_TOO_LOW`，详情 `{"score","min_score"}`）、超过额度（`OVER_CREDIT_LIMIT`，详情 `{"limit"}`）、有未结清贷款、没有当前学期（`NO_TERM`）、账户不是在读（`STUDENT_INACTIVE`）、为本人或本人的工资账户办理（`SELF_SERVICE_FORBIDDEN`）。柜员要在上班中（`OFF_DUTY`），行长不办理。
- 符合风险条件时（第 12 节）同时生成风险提醒（M13）。
- 离线时「贷款」「定期」不可用（同取款）。

### 10.4 还款计划与计息

- **等额本金**：每期应还本金 = 本金 ÷ 期数（向下取整，最后一期补齐余数）；分期的应还日是放款后每满 7 天，一次还清只有一期，应还日是放款后第 N×7 天。
- **按天计息**：学期内每天结束时，剩余本金 × 放款时锁定的周利率 ÷ 7，精确到 0.01 HTB（舍去更小的部分），加到 `loans.interest_centi`。应还日在当天之前、仍未还清的本金（逾期部分）按罚息利率计；两部分相加后一起舍去。放款当天计息；当天的扣款先于当天的计息（13），所以应还日当天结束时自动扣掉的、或当天在柜台还掉的本金，当天不再计息。假期不计息。
- 还款时先付已产生的利息，再还本金。利息取整：已产生的利息向下取整到 1 HTB 应付，零头留到下次还款；结清时零头不足 1 HTB 的按 1 HTB 收。还清本金的那笔还款必须同时付清利息（零头按 1 HTB）：金额恰好是「剩余本金 + 利息整数部分」而利息还有零头时，柜台返回 `INVALID_AMOUNT`（详情 `{"payoff": 全部结清的金额}`），自动扣款少扣 1 HTB。
- 本金按期先后还：先还应还日已到（当天及以前）的各期，再还最近的一期；还完最近一期后多出的部分从后面各期扣，后面各期的应还本金按剩余期数重新平均（向下取整，最后一期补齐余数，多还得多时可能出现 0 HTB 的期，视为已还清）。
- 提前还款按实际天数计息，提前就少付利息；可以多还。
- **本期应还**（`loan_json` 的 `next.amount`）= 最早一期没还清的那期及之前各期未还的本金 + 利息整数部分；它已是全部剩余本金时为全部结清的金额。**全部结清**（`payoff`）= 剩余本金 + 利息向上取整到 1 HTB。
- **估算利息**（`loan_preview`，`app_private.loan_estimate`）：假设每期都在应还日当天还，每期累计的利息 `interest_centi` = 该期天数 × ⌊那一期开始时的剩余本金 × 周利率 ÷ 7⌋（0.01 HTB），`interest` 为当期应还日实收的整数利息（零头滚到下一期，最后一期向上取整）。按时还款时实际收的利息与它相同。

### 10.5 还款

- 柜台「贷款」里点「还款」，填金额（默认本期应还），选从账户扣或交现金（按面额录入，同存款；现金的金额就是面额合计，同时填了金额的要相等，否则 `INVALID_AMOUNT`）。
- 生成一笔 `repay` 流水，说明里写其中利息多少、本金多少（14.1），拆分记在 `loan_payments`。从账户扣的活期减少；交现金的活期不变，`cash_delta` 为正，计入下班总结的「收入」。
- 一次还款不超过全部结清的金额（`REPAY_TOO_MUCH`，详情 `{"max": 全部结清的金额}`）；从账户扣的不超过活期（`INSUFFICIENT_BALANCE`）。
- 还清全部本金和利息后贷款状态为「已结清」，`closed_on` 为结清那天，零头不足 1 HTB 按 1 HTB 收后 `interest_centi` 归 0。
- 冻结、毕业的账户不能在柜台还款（`STUDENT_INACTIVE`，同其他柜台业务），由每天的自动扣款还。`p_id` 是这笔还款流水的 id（幂等键）。

### 10.6 到期自动扣款

- 每个应还日当天结束时，这一期还没还清的：用活期余额自动扣款，生成一笔 `repay` 流水（经办人记为「系统」，时间记为次日 0 点，同定期到期）。余额够就还清这一期（连同利息整数部分）；不够就先扣掉全部余额，剩下的部分算逾期（与 10.8 终止的做法一致）。
- 能扣的活期 = 次日 0 点及以前的流水之和（含当晚到期转回的定期），且不超过扣款时的余额，补跑时与按时运行一致。
- 自动扣款还清的算按时还款（+5 分）。
- 学期结束日改早以后，结束日当天还没到期的各期在那天结束时一起到期（应还日改为结束日），按本节处理。

### 10.7 逾期

- 任何一期过了应还日仍未还清，这一期记下 `overdue_at`，贷款标为「逾期」，在柜台、后台、学生端都标红。
- 逾期期间：逾期本金按罚息利率计息；当天扣 50 分，之后每满一周再扣 30 分（8.2）；该生不能办新贷款，直到这笔贷款结清。
- 之后每天结束时，用活期余额自动扣款还逾期应还（能扣多少扣多少，同 10.6）。
- 逾期的各期都还清后，贷款回到「还款中」（后面还有没到期的期时）或「已结清」。
- 逾期贷款进入风险提醒（`loan_overdue`，M13）。

### 10.8 终止（提前到期）

- 行长或银行管理员在风险提醒或贷款详情里点「终止」，必须写原因，二次确认（`terminate_loan`）。
- 剩余本金和已产生利息立即全部到期：没还清的各期应还日改为当天；活期余额够就一次扣清；不够就把余额全部扣掉，剩下的立即算逾期（只扣一次 50 分），按 10.7 处理。这笔扣款经办人为终止的人，说明以「终止」开头。
- 终止后的贷款不再加分；已终止的贷款再终止不做任何事，返回原样。
- 写日志 `loan.terminate`（贷款号、原因、扣款流水号）。

### 10.9 冲正

| 流水 | 柜员（本人当天） | 银行管理员 / 行长 |
| --- | --- | --- |
| `loan` 放款 | 贷款在还款中（没有逾期）且还没有还款（不算已冲正的）时可冲正；存入账户的要求活期余额不少于放款额；付现金的收回现金；冲正后贷款作废（`reversed`，剩余本金与利息归 0），不计息、不加减分 | 同左，不限当天 |
| `repay` 还款 | 只能冲正这笔贷款最近的一笔还款（之后没有未冲正的还款）；贷款已结清、学生又办了新贷款的不能冲正。冲正后利息和还款计划恢复到这笔还款之前（`loan_payments.before`），剩余本金加回；应还日在今天之前仍未还清的期立即逾期，按逾期处理 | 同左 |
| `term_open` 开定期 | 定期还没到期、没有提前支取时可冲正，本金回到活期，不计息，定期作废 | 同左，不限当天 |
| `term_close` 到期 / 提前支取 | 不能 | 只能冲正提前支取，且不晚于原到期日：定期按原条件恢复（利率、到期日不变），收回付过的利息，要求活期余额足够 |
| `interest` 利息 | 不能 | 不能 |

冲正提前支取时收回的利息：这笔 `term_close` 里付的整数部分随冲正流水退回，零头从 `interest_carry` 里减去；零头在此之间已经结过、不够减时，冲正流水多收 1 HTB 补足，零头加 100（0.01 HTB）；零头多出 1 HTB 时冲正流水少收 1 HTB。冲正流水带 `term_id`。

冲正放款、还款的流水带 `loan_id`。冲正还款时，这笔还款之后已经计的利息保留（按当时较少的本金计的，不补算）。自动扣款和终止扣款只能由银行管理员、行长冲正。

---

## 11. 货币发行与流通监控

### 11.1 登记

银行管理员在后台「货币」页登记，登记后不能修改，登错了再登一笔「更正」（正负张数）冲抵：

| 种类 | 内容 |
| --- | --- |
| 银行期初现金 | 上线时一次：银行（金库 + 各储蓄盒）现有的各面额张数 |
| 发行 | 批次号、日期、各面额张数、用途、审批人 |
| 回收 | 日期、各面额张数、原因（如旧版回收）：从银行现金里取出，不再流通 |
| 销毁 | 日期、各面额张数、原因（如损毁） |
| 更正 | 对应哪一笔、各面额张数（可为负）、原因 |

行长、财务只能查看。

### 11.2 监控

```
纸币（从上线那天起）
  银行应有现金 = 期初现金 + 新发行 − 回收 − 销毁
                + 所有流水的现金变动（存款、现金兑换、现金还款为 +；
                  取款、找零、现金放款为 −）
  上线后流到学生手中的纸币 = 期初现金 + 新发行 − 回收 − 销毁 − 银行应有现金
  （可以为负：学生把上线前就拿着的纸币存了进来）

电子币（账户里的钱）
  账户余额合计 = 活期 + 定期
  其中「电子币新增」= 工资 + 利息 + 存入账户的放款 − 从账户扣的还款
  每日自检保证账户余额与流水一致（P1 §5.4）

兑付能力 = 银行应有现金 ÷ 账户余额合计
  低于参数 payout_ratio_min（默认 30%）时在看板上醒目提示
```

- 各面额的「银行应有现金」也单独列出，和每次轧账实点的合计对比。
- 阶段一 `currency_issues` 里的旧记录不计入，仍可在日志里查看。

---

## 12. 风险提醒

### 12.1 触发条件

阈值都是参数（`risk_rules`）。

| 代码 | 条件 | 「终止」做什么 |
| --- | --- | --- |
| `loan_large` | 单笔贷款超过 50 HTB，或信用分低于 600 的学生的贷款 | 提前到期（10.8） |
| `loan_overdue` | 贷款逾期 | 提前到期 |
| `withdraw_large` | 单笔取款超过该学部单笔限额的 80% | 冲正这笔取款（写原因） |
| `term_early` | 定期提前支取 | 冲正这笔提前支取（定期恢复） |
| `reversal_many` | 一个柜员一天冲正 3 笔以上（第 3 笔起每笔一条） | 强制该柜员下班 |
| `ops_frequent` | 同一学生 10 分钟内办理 5 笔以上 | 强制经办柜员下班 |
| `setting_change` | 修改利率参数、信用分参数、风险阈值、取款限额 | 恢复到修改前的值 |
| `credit_adjust` | 银行管理员手动调整信用分 | 再记一条相反的变动，恢复原分 |
| `stock_low` | 商品库存降到安全库存或以下 | 无（只能「已查看」） |
| `cash_unbalanced` | 轧账不平 | 无（只能「已查看」） |

### 12.2 处理

- 每条提醒有：时间、种类、对象（学生、柜员、商品、参数）、说明、状态（未处理 / 已查看 / 已终止）、处理人、处理时间、处理说明。
- 行长和银行管理员都能处理，谁先处理算谁的；「终止」必须写原因、二次确认，执行失败时（例如冲正时余额不足）提示原因，提醒保持未处理。
- 后台「风险提醒」页按状态和种类筛选；总览页和看板显示未处理条数和最近 5 条。
- 强制下班：结束该柜员当前的上班，轧账状态为「强制下班」（7.2），柜员要重新上班才能继续办理。

---

## 13. 定时任务

容器内新增一个由 supervisord 管理的任务进程 `dolphin-jobs`（与 `dolphin-backup-schedule` 同样的写法），每分钟检查一次，到点调用数据库函数。每个函数记下已处理到哪一天，可重复执行；服务器停机后重新启动时补跑错过的日子。

| 时间（上海） | 函数 | 内容 |
| --- | --- | --- |
| 每天 00:05 | `app_private.run_daily(d)` | 对前一天 d（学期内）：活期计息；到期的定期转回活期；应还日到期的贷款自动扣款或记逾期，逾期贷款自动扣款；贷款计息；学期结束日结清最后几天的活期利息 |
| 每周一 00:10 | `app_private.run_weekly(w)` | 学期内：活期结息；信用分的每周加减分与逾期满一周扣分；计算并公布本周锚点 |

- 先跑完每天的再跑每周的。补跑时按日子先后交替进行：周一的每周任务排在周日的每天任务之后、周一的每天任务之前，与每天按时运行的顺序相同，所以停机后补跑的结果与没有停机时相同。
- `app_private.run_jobs(today)` 补跑：从每天任务的 `done_to` 的下一天开始，每天的任务做到昨天，每周的任务做到今天（周一）。`dolphin-jobs` 在容器启动、数据库迁移完成后补跑一次，之后每天 00:05 以后补跑一次；`dolphin jobs run` 立即补跑。
- `run_daily(d)` 只接受 `done_to` 的下一天且早于今天；`run_weekly(w)` 只接受周一，且每天的任务已做完前一天。已做过的日子直接跳过（`skipped`），同一天重复执行结果不变。各项计算只用 `d`、`w`，不用当前时间。
- 只处理学期内的日子：假期里的日子和周一记为 `holiday`，只推进 `done_to`。学期内的周一里，学期开始后的第一个周一带 `first: true`（上一周的周一不在本学期），锚点不调整（9.1）。
- 学期结束日之后的周一在假期里，不再结息：最后几天的利息在学期结束日的 `run_daily` 里结清，流水记在次日 0 点（9.4）。
- 任一任务失败时停在那一天：之前的日子保留，这一天的改动撤销，`job_runs.last_err` 记下日期和原因，写日志 `job.failed`（`{"job","day","error"}`）。下一次补跑（第二天 00:05、容器重启或 `dolphin jobs run`）从这一天重试，成功后清空 `last_err`。
- 上线（本迁移执行）之前的日子不补跑：`job_runs` 两个任务的 `done_to` 初始为迁移当天的前一天。
- 运维命令新增 `dolphin jobs`：显示每个任务最后处理到哪天、最后成功时间、有没有失败，以及当前学期；`dolphin jobs run` 立即补跑；`dolphin status` 加一行任务状态。
- 任务失败写日志（`job.failed`），并在运维员总览上提示：运维员和银行管理员（含行长）可直接读 `job_runs`，`last_err` 不为空即为失败。
- `run_daily` 里依次是活期计息（M9，`accrue_interest`）、到期定期转回活期（M10，`mature_term_deposits`，利息零头并入 `interest_carry`）、贷款自动扣款与逾期（M11，`collect_loans`：转回的定期当晚就能用来还款）、贷款计息（M11，`accrue_loans`：按扣款后剩下的本金，应还日当天还掉的本金当天不计息）、学期结束日结息（M9，`settle_interest`）；`run_weekly` 里依次是结息（M9，`settle_interest`）、信用分每周加减分（M8，`credit_weekly(w)`，学期第一个周一跳过，见 8.2）、逾期满一周扣分（M11，`overdue_weekly(w)`，同样跳过第一个周一）、本周锚点（M9，`publish_anchor`）。
- 贷款计息、扣款按任务运行时贷款的状态和计划；停机期间柜台不办业务，所以补跑与按时运行相同。

---

## 14. 数据模型

### 14.1 新增流水类型

```sql
alter type txn_type add value 'interest';    -- 活期结息
alter type txn_type add value 'term_open';   -- 开定期（活期 −）
alter type txn_type add value 'term_close';  -- 定期到期或提前支取（活期 +，含利息整数部分）
alter type txn_type add value 'loan';        -- 放款
alter type txn_type add value 'repay';       -- 还款
```

定期流水的说明（`txns.reason`）：柜员读不到 `term_deposits`，流水标题的后半句取自这里。日期写法同活期利息流水（月日不补零），周数和金额前后各留一个空格：

| 流水 | 说明 | 例 |
| --- | --- | --- |
| `term_open` | 周数、到期日 | 「4 周，12月10日 到期」 |
| `term_close` 到期 | 实付利息（`interest_centi`），两位小数 | 「到期，利息 12.48 HTB」 |
| `term_close` 提前支取（含注销时转回的） | 实付利息，没有时 0.00 | 「提前支取，利息 0.37 HTB」「提前支取，利息 0.00 HTB」 |

贷款流水的说明同样写清楚，柜员读不到 `loans`：

| 流水 | 说明 | 例 |
| --- | --- | --- |
| `loan` 分期 | 期数、用途 | 「分 4 期，用途：买文具」 |
| `loan` 一次还清 | 周数、用途 | 「一次还清 4 周，用途：买文具」 |
| `repay` 柜台还款 | 其中利息、本金（整数 HTB） | 「利息 1 HTB，本金 32 HTB」「利息 0 HTB，本金 30 HTB」 |
| `repay` 自动扣款 | 前加「自动扣款，」 | 「自动扣款，利息 1 HTB，本金 32 HTB」 |
| `repay` 终止时扣的 | 前加「终止，」 | 「终止，利息 2 HTB，本金 75 HTB」 |

`loan`、`repay` 的 `payment` 是放款方式、付款方式（`account` / `cash`）；现金的配钞或收到的面额记在 `denominations`。冲正这几种流水的 `reversal` 的说明仍是冲正原因。

`accounts` 增加 `term_total integer not null default 0`（定期本金合计）。每日自检（`check_balances`）增加：定期本金合计与 `term_deposits` 一致（`kind = 'term'`：`term_total` 对比状态为 `open` 的本金之和）；贷款剩余本金与放款、还款流水一致（`kind = 'loan'`：`loans.remaining` 对比未冲正的 `loan` 金额减未冲正的 `repay` 的本金部分，键为贷款号；`kind = 'loan_plan'`：同一个 `remaining` 对比各期应还本金减已还本金之和，作废的贷款不比）；利息累计与计息记录一致。

### 14.2 新增表

```sql
create table terms (                          -- 学期
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  starts_on  date not null,
  ends_on    date not null check (ends_on >= starts_on),
  closed_at  timestamptz,                     -- 结转时间
  closed_by  uuid references profiles(id),
  exclude using gist (daterange(starts_on, ends_on, '[]') with &&)
);

create table credit_scores (                  -- 每位学生当前的信用分
  student_no text primary key references students(student_no),
  score      integer not null default 600 check (score between 0 and 1000),
  updated_at timestamptz not null default now()
);

create table credit_events (                  -- 每次变动，只增不改（append_only 触发器）
  id         bigserial primary key,
  student_no text not null references students(student_no),
  at         timestamptz not null default now(),
  delta      integer not null,                -- 截断到 0～1000 后实际的变动
  score      integer not null,                -- 变动后
  rule       text not null,                   -- credit_rules 里的键，手动调整为 manual
  reason     text not null,
  ref        text,                            -- weeks:<周一>、loans:<id>…、risk_alerts:<id>
  actor_id   uuid references profiles(id)     -- 手动调整时
);
create unique index credit_events_once on credit_events (student_no, rule, ref) where ref is not null;
-- 读取：学生读本人的，财务、行长、银行管理员读全部（credit_scores 同）；柜员经 lookup_student 读正在办理的学生

create table rate_weeks (                     -- 每周的锚点
  week_start  date primary key,               -- 周一
  prev_anchor numeric(6,2) not null,          -- 百分数
  deposits    integer not null,               -- 存款余额（活期 + 定期）
  loans       integer not null,               -- 贷款剩余本金
  ratio       numeric(12,4) not null,         -- 存贷比（百分数）
  growth      numeric(12,4),                  -- 增速（百分数）；不调整的周为空
  adjust      numeric(6,2) not null,
  anchor      numeric(6,2) not null,
  params      jsonb not null,                 -- 计算时的参数快照
  created_at  timestamptz not null default now()
);

create table interest_accruals (              -- 活期每天每人一行
  student_no text not null references students(student_no),
  day        date not null,
  balance    integer not null,
  rate       numeric(8,4) not null,           -- 当天活期周利率（百分数）
  centi      integer not null,                -- 当天利息，单位 0.01 HTB
  settled_txn uuid references txns(id),       -- 结息流水
  primary key (student_no, day)
);
-- accounts 增加 interest_carry integer not null default 0 check (interest_carry between 0 and 99)：未入账的零头（0.01 HTB）
-- 读取：rate_weeks 财务、行长、银行管理员；interest_accruals 学生读本人的，财务、行长、银行管理员读全部

create table term_deposits (                  -- 定期
  id          uuid primary key,               -- 客户端生成，作幂等键
  student_no  text not null references students(student_no),
  principal   integer not null check (principal > 0),
  weeks       integer not null check (weeks in (2,4,8)),
  rate        numeric(8,4) not null,          -- 锁定的周利率（百分数）
  opened_on   date not null,
  matures_on  date not null,
  status      text not null default 'open' check (status in ('open','matured','early','reversed')),
  open_txn    uuid not null references txns(id) deferrable initially deferred,  -- 先写定期，再写 term_open
  close_txn   uuid references txns(id),
  interest_centi integer,                     -- 实付利息（0.01 HTB）
  expected_centi integer generated always as (floor(principal * rate * weeks)::integer) stored  -- 到期利息（0.01 HTB）
);
-- 读取：学生读本人的，财务、行长、银行管理员读全部；柜员经 term_quote 读正在办理的学生的
-- 状态：open 存期中、matured 已到期、early 已提前支取（含注销时转回的）、reversed 开定期已冲正

create table loans (
  id            uuid primary key,             -- 客户端生成，作幂等键
  loan_no       text unique not null,         -- DK + YYMMDD + 序号
  student_no    text not null references students(student_no),
  principal     integer not null check (principal > 0),
  remaining     integer not null check (remaining >= 0), -- 剩余本金
  rate          numeric(8,4) not null,        -- 锁定的周利率（百分数）
  score         integer not null,             -- 放款时的信用分
  plan          text not null check (plan in ('installment','bullet')),
  periods       integer not null check (periods between 1 and 8), -- 分期的期数，一次还清的周数
  purpose       text not null,                -- 1～30 字
  disbursed_via text not null check (disbursed_via in ('account','cash')),
  interest_centi integer not null default 0,  -- 已产生未付的利息（0.01 HTB）
  status        text not null default 'active' check (status in ('active','overdue','closed','reversed')),
  loan_txn      uuid not null references txns(id) deferrable initially deferred,  -- 先写贷款，再写 loan
  opened_on     date not null,
  closed_on     date,
  terminated_at timestamptz,
  terminated_by uuid references profiles(id),
  terminate_reason text,
  operator_id   uuid not null references profiles(id)
);
create unique index loans_one_open on loans(student_no) where status in ('active','overdue');
-- 状态：active 还款中、overdue 逾期、closed 已结清、reversed 放款已冲正（作废）
-- 审计触发器不记只改 interest_centi 的更新（每天计息）

create table loan_periods (                   -- 还款计划
  loan_id     uuid not null references loans(id),
  seq         integer not null,
  due_on      date not null,                  -- 终止或学期末提前到期时改为那一天
  principal   integer not null check (principal >= 0),  -- 应还本金，多还后重新平均
  paid        integer not null default 0 check (paid between 0 and principal),  -- 已还本金
  overdue_at  timestamptz,                    -- 逾期的时间
  primary key (loan_id, seq)
);

create table loan_payments (                  -- 每笔还款的拆分，只增不改（append_only 触发器）
  txn_id    uuid primary key references txns(id),
  loan_id   uuid not null references loans(id),
  interest  integer not null,
  principal integer not null,
  auto      boolean not null default false,   -- 系统自动扣款
  before    jsonb not null                    -- 还款前的利息与计划，冲正时恢复：{"interest_centi","periods":[{"seq","principal","paid"}]}
);
-- 读取：三张表学生读本人的，财务、行长、银行管理员读全部；柜员经 loan_quote 读正在办理的学生的

create table cash_counts (                    -- 轧账，每次上班一行
  duty_id      uuid primary key references duty(id),
  float        jsonb not null,                -- 备用金 {"1":20,"2":10,...}
  expected     jsonb,                         -- 下班时算出的应有
  teller_count jsonb,                         -- 柜员实点
  teller_note  text,
  review_count jsonb,                         -- 财务实点（与柜员不同时）
  review_note  text,
  reviewed_by  uuid references profiles(id),
  reviewed_at  timestamptz,
  status       text not null default 'open' check (status in ('open','pending','done','forced'))
);

create table currency_moves (                 -- 货币登记（从上线起）
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('baseline','issue','recover','destroy','correction')),
  batch_no      text,                         -- 发行批次号
  on_date       date not null,
  denominations jsonb not null,               -- 各面额张数，更正可为负
  total         integer not null,
  reason        text not null,                -- 用途或原因
  approver_name text,                         -- 发行的审批人
  corrects      uuid references currency_moves(id),
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);
create unique index currency_one_baseline on currency_moves(kind) where kind = 'baseline';

create table risk_alerts (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  kind        text not null,                  -- 12.1 的代码
  target      text not null,                  -- 如 txns:<id>、loans:<id>、settings:<key>
  student_no  text references students(student_no),
  staff_id    uuid references profiles(id),
  detail      jsonb not null,
  status      text not null default 'open' check (status in ('open','seen','terminated')),
  handled_by  uuid references profiles(id),
  handled_at  timestamptz,
  note        text
);

create table job_runs (                       -- 定时任务进度
  job      text primary key,                  -- daily / weekly
  done_to  date not null,                     -- 已处理到的日子（weekly 为最后处理的周一）
  last_ok  timestamptz,
  last_err text
);
```

`txns` 新增可空字段 `loan_id uuid references loans(id)`、`term_id uuid references term_deposits(id)`：`term_open`、`term_close` 和冲正它们的流水都带 `term_id`，`loan`、`repay` 和冲正它们的流水都带 `loan_id`。结息和系统自动扣款的 `operator_id` 用一个专用的系统账号（`profiles.login_id = 'system'`，显示名「系统」，M9 建立）：已停用、已注销、Auth 中封禁，不能登录，也不在工作人员列表里；财务查流水时经办人显示「系统」。函数 `app_private.system_user()` 返回它的 id。

### 14.3 新增参数

| key | 默认值 | 说明 |
| --- | --- | --- |
| `credit_curve` | `{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}` | 能贷款的最低分（0～999 的整数）；额度两端与取整单位（1～10000 的整数，取整单位 ≤ 最低额度 ≤ 最高额度）；贷款系数两端（`loan_max` 在最低分，`loan_min` 在 1000 分）与储蓄系数两端（`saving_min` 在 0 分，`saving_max` 在 1000 分），都是 0.1～10、最多 4 位小数，且小的一端不大于大的一端 |
| `credit_rules` | `{"repay_on_time":5,"repay_early":10,"overdue":-50,"overdue_week":-30,"deposit_week":3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}` | 各事件的分值（8.2 的顺序）：键必须齐全、不能多；加分项 0～100、减分项 −100～0 的整数 |
| `anchor_params` | `{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}` | 锚点公式（9.1）：可改 `initial`、`min`、`max`，都是 0.01～100、精确到 0.01 的数，且 下限 ≤ 初始 ≤ 上限；其余键（`ratio_target`、`ratio_step`、`growth_target`、`growth_step`、`weight`、`max_adjust`）由系统固定。修改时提交全部 9 个键，固定的键必须与当前值相同 |
| `term_multipliers` | `{"2":1.25,"4":1.5,"8":2}` | 定期存期倍数，键为 2、4、8；系统固定，不能修改 |
| `loan_multiplier` | `2` | 贷款倍数；系统固定，不能修改 |
| `penalty_multiplier` | `1.5` | 罚息倍数（罚息不低于贷款利率）；系统固定，不能修改 |
| `risk_rules` | 见 12.1 | 各提醒的阈值 |
| `payout_ratio_min` | `30` | 兑付能力提示线（%） |

---

## 15. 后端接口

规则沿用 P1 §6.1：业务全部在 `security definer` 函数里，前端只调用函数。下面是新增和改动的函数。

| 函数 | 角色 | 说明 |
| --- | --- | --- |
| `import_staff(p_rows)` | teacher / sysadmin | 5.1；返回每人的初始密码（只在新建时） |
| `bind_salary_account(p_user_id, p_student_no, p_password)` | 改动 | teacher / sysadmin 调用时 `p_password` 可为空 |
| `start_duty(p_float)` | 改动 | 上班时登记备用金 |
| `duty_cash(p_duty_id)` | teller / accountant / president / teacher | 第 4 节的现金表；柜员只能查本人的上班，不传时为本人当前的上班 |
| `end_duty(p_txns, p_count, p_note)` | 改动 | 下班时录入实点；有差额时 `p_note` 必填（`NOTE_REQUIRED`） |
| `review_cash_count(p_duty_id, p_count, p_note)` | accountant | 复核；`p_count` 为空表示与柜员一致 |
| `upsert_term(p_id, p_name, p_starts, p_ends)` / `close_term(p_id)` | teacher（行长不可） | 第 6 节；返回学期一行 |
| `term_quote(p_student_no)` | teller | 10.2 柜台「定期」面板：`{"student_no","score","term":{"id","name","ends_on"},"options":[{"weeks","rate","matures_on"}],"balance","term_total","deposits":[term_deposits 一行…]}`；`options` 只列到期日不晚于学期末的存期，`rate` 为按本周锚点和现在的分数锁定的周利率；不在学期内时 `term` 为 `null`、`options` 为 `[]`；`deposits` 为该生的全部定期，按开定期日期从新到旧。学生不存在 `STUDENT_NOT_FOUND`，已注销 `STUDENT_INACTIVE`，本人或本人工资账户 `SELF_SERVICE_FORBIDDEN` |
| `open_term_deposit(p_id, p_student_no, p_amount, p_weeks)` | teller（行长不可） | 10.2；`p_id` 是定期的 id（幂等键，重复提交返回同一结果）；返回流水结果（同 P1）加 `term`（`term_deposits` 一行）。错误：`NO_TERM`、`TERM_TOO_LONG`（详情 `{"ends_on","max_weeks"}`，`max_weeks` 为放得下的最长周数，一种都放不下时为 `null`）、`INVALID_INPUT`（`field: weeks`，不是 2/4/8）、`INVALID_AMOUNT`、`INSUFFICIENT_BALANCE`（`{"balance","short"}`）、`STUDENT_INACTIVE`、`SELF_SERVICE_FORBIDDEN`、`OFF_DUTY`、`LOAN_OUTSTANDING`（有未结清贷款） |
| `withdraw_term_early(p_term_id)` | teller（行长不可） | 10.2、9.5；返回同上，`term.status` 为 `early`，`term.interest_centi` 为实付利息；重复提交返回原来那笔。定期不存在、已到期、已作废或已过到期日返回 `INVALID_INPUT`（`{"field":"term_id","status":"…"}`）；账户不在读 `STUDENT_INACTIVE` |
| `loan_quote(p_student_no)` | teller | 10.3 柜台「贷款」面板：`{"student_no","score","limit","rate","penalty_rate","max_weeks","max_periods","term":{"id","name","ends_on"},"balance","blocked","loan"}`。`limit` 为单笔额度（不能贷款时 `null`），`rate`、`penalty_rate` 为按本周锚点和现在的分数算的贷款周利率与罚息利率；`max_weeks`、`max_periods` 相同，为今天放款最多能选的周数（期数）（1～8，最后一期不晚于学期末；不在学期内或放不下时 `null`）；不在学期内时 `term` 为 `null`；`blocked` 为不能办新贷款的原因（`STUDENT_INACTIVE`、`NO_TERM`、`LOAN_OUTSTANDING`、`CREDIT_TOO_LOW`，可以办时 `null`）；`loan` 为未结清的贷款（下面的「贷款详情」），没有时 `null`。学生不存在 `STUDENT_NOT_FOUND`，已注销 `STUDENT_INACTIVE`，本人或本人工资账户 `SELF_SERVICE_FORBIDDEN` |
| `loan_preview(p_student_no, p_amount, p_plan, p_periods)` | teller | 10.3 确认页：`{"rate","penalty_rate","interest","interest_centi","schedule":[{"seq","due_on","principal","interest_centi","interest"}]}`，按今天放款、每期按时还算（10.4 估算利息）。额度、期限由 `open_loan` 把关；错误 `INVALID_INPUT`（`plan`、`periods`）、`INVALID_AMOUNT`、`CREDIT_TOO_LOW`，学生检查同 `loan_quote` |
| `open_loan(p_id, p_student_no, p_amount, p_purpose, p_plan, p_periods, p_via)` | teller（行长不可） | 10.3；`p_id` 是贷款的 id（幂等键）；`p_plan` 为 `installment` / `bullet`，`p_periods` 为期数或周数（1～8），`p_via` 为 `account` / `cash`；返回流水结果（同 P1，付现金时 `denominations` 为配钞）加 `loan`（贷款详情）。错误：`NO_TERM`、`INVALID_INPUT`（`field`：`plan`、`periods`、`via`、`purpose`）、`TERM_TOO_LONG`（`{"ends_on","max_weeks"}`）、`LOAN_OUTSTANDING`、`CREDIT_TOO_LOW`（`{"score","min_score"}`）、`INVALID_AMOUNT`、`OVER_CREDIT_LIMIT`（`{"limit"}`）、`STUDENT_INACTIVE`、`STUDENT_NOT_FOUND`、`SELF_SERVICE_FORBIDDEN`、`OFF_DUTY` |
| `repay_loan(p_id, p_loan_id, p_amount, p_payment, p_denominations)` | teller（行长不可） | 10.5；`p_id` 是还款流水的 id（幂等键）；`p_payment` 为 `account` / `cash`，现金时金额为 `p_denominations` 的合计；返回流水结果加 `loan`。错误：`INVALID_INPUT`（`{"field":"loan_id"}` 贷款不存在，`{"field":"loan_id","status"}` 已结清或作废；`field: payment`）、`INVALID_AMOUNT`（金额不对；只差利息零头就能结清时详情 `{"payoff"}`）、`REPAY_TOO_MUCH`（`{"max"}`）、`INSUFFICIENT_BALANCE`（`{"balance","short"}`）、`STUDENT_INACTIVE`、`SELF_SERVICE_FORBIDDEN`、`OFF_DUTY` |
| `terminate_loan(p_loan_id, p_reason)` | president / teacher | 10.8；返回 `{"loan": 贷款详情, "txn": 扣款的流水结果或 null}`。原因为空 `INVALID_INPUT`（`field: reason`）；贷款不存在或已结清、作废 `INVALID_INPUT`（`field: loan_id`） |
| 贷款详情 | — | `loan_quote`、`open_loan`、`repay_loan`、`terminate_loan` 返回的 `loan`：`loans` 一行，加 `payoff`（全部结清的金额，未结清时才有）、`next`（`{"seq","due_on","amount"}`，最早一期没还清的期与本期应还，10.4；结清后为 `null`）、`schedule`（`loan_periods` 各行，不含 `loan_id`）、`payments`（`[{"txn_id","txn_no","created_at","amount","interest","principal","auto","payment","status"}]`） |
| `adjust_credit(p_student_no, p_delta, p_reason)` | teacher（行长不可） | 8.3；返回 `{"event": 变动记录, "credit": 调整后的 credit_profile}` |
| `credit_profile(p_student_no default null)` | 学生（不传，读本人）/ accountant / president / teacher | 8.1；返回 `{"student_no","score","loan_limit","points_to_next","loan_factor","saving_factor"}`，不能贷款时额度、贷款系数为 `null`，`points_to_next` 为 `null` 表示不显示「再涨 N 分」 |
| `lookup_student(p_student_no)` | 改动 | 返回里加 `credit`：同 `credit_profile`，不含学号；加 `term_total`（定期本金合计）、`loan_remaining`（未结清贷款的剩余本金，没有时 0）、`loan_overdue`（是否逾期） |
| `deposit_ranking(p_division)` | 改动 | 按活期 + 定期本金 − 未结清贷款的剩余本金排名，`balance` 为这个数，可以为负，照常参加排名（16.3） |
| `close_accounts(p_user_ids)` | 改动 | 注销学生账户时，未到期的定期先按提前支取转回活期、不付利息，再随余额清零（10.2）；有未结清贷款的返回 `LOAN_OUTSTANDING`（`{"student_no","loan_no"}`） |
| `interest_profile(p_student_no default null)` | 学生（不传，读本人）/ accountant / president / teacher | 9.2、9.4；返回 `{"student_no","score","week_start","anchor","rates":{"current","term":{"2","4","8"},"loan"},"pending_centi"}`：本周锚点（`week_start` 为空表示还没有公布过，用初始锚点）、按现在的分数算出的各项周利率（百分数，`loan` 为空表示分数不够贷款）、待入账利息（0.01 HTB） |
| `rate_overview()` | accountant / president / teacher | 16.2「利率」页：`{"week_start","anchor","table":[{"score","current","term","loan"}]}`，`table` 为 9.2 表格的分数（含 `credit_curve.min_score`）在本周锚点下的利率；每周历史读 `rate_weeks` 表，参数读 `settings` |
| `set_setting` / `set_settings` | 改动 | 加入 `credit_curve`、`credit_rules`、`anchor_params` 的校验（14.3）；行长、银行管理员可改，从下一次计算起生效。`anchor_params` 只能改 `initial`、`min`、`max`，固定的键与当前值不同时返回 `INVALID_INPUT`（`field: anchor_params`）；`term_multipliers`、`loan_multiplier`、`penalty_multiplier` 由系统固定，修改返回 `INVALID_INPUT`（`field` 为该参数）；`set_settings` 中有一项被拒绝时全部不保存 |
| `record_currency(p_kind, …)` | teacher | 11.1 |
| `currency_overview()` | accountant / president / teacher | 11.2 的各项数字 |
| `handle_alert(p_id, p_action, p_note)` | president / teacher | `p_action`：`seen` 或 `terminate` |
| `dashboard()` | accountant / president / teacher | 16.2 看板的 6 个指标和按周笔数 |
| `reverse_txn` | 改动 | 支持 10.9 的新类型；`interest`、定期到期的 `term_close`、10.9 不允许的放款和还款不能冲正（`REVERSAL_NOT_ALLOWED`）；冲正提前支取时余额不足返回 `REVERSAL_INSUFFICIENT_BALANCE`，`amount` 为要收回的金额 |

新增错误码（界面文字按 P1 §7.6 的写法）：

| 代码 | 标题 | 说明 |
| --- | --- | --- |
| `NO_TERM` | 现在不在学期内 | 还没有登记当前学期，暂时不能办理贷款和定期。 |
| `LOAN_OUTSTANDING` | 还有贷款没还清 | 先还清这笔贷款，才能办新贷款或新定期。 |
| `CREDIT_TOO_LOW` | 信用分不够 | 信用分 {min_score} 分以上才能贷款，现在是 {score} 分。 |
| `OVER_CREDIT_LIMIT` | 超过贷款额度 | 按现在的信用分，最多能贷 {limit} HTB。 |
| `TERM_TOO_LONG` | 期限超过学期末 | 本学期 M 月 D 日结束，最长只能选 N 周。 |
| `TERM_OPEN_ITEMS` | 还不能结转 | 下面这些处理完后，再结转学期。 |
| `TERM_OVERLAP` | 学期日期重叠 | 和「{term}」的日期重叠，请调整开始日或结束日。 |
| `TERM_NOT_ENDED` | 学期还没结束 | {ends_on} 之后才能结转。 |
| `TERM_CLOSED` | 学期已结转 | 结转后的学期不能再修改。 |
| `NOTE_REQUIRED` | 请写明原因 | 现金和应有不一致，写明原因后才能下班。 |
| `REPAY_TOO_MUCH` | 还多了 | 这笔贷款现在一共只需还 {max} HTB。 |

`INVALID_AMOUNT` 带 `payoff` 时（10.4）写「还清本金要连利息零头一起付，全部结清是 {payoff} HTB。」

---

## 16. 前端

### 16.1 柜台

- 办理页业务栏：存款 / 取款 / 兑换 / **贷款** / **定期** / 查询（平板一行放下，手机排成两行、每行三项）。离线时只有存款可用（P1 §7.7）。
- 学生卡片在「今日还可取」旁加小号信用仪表盘（8.4，分数取 `lookup_student` 返回的 `credit.score`）；有逾期贷款时（`loan_overdue`）卡片上标红「贷款逾期」。
- 「贷款」：10.3～10.9，数据取 `loan_quote`，确认页的计划取 `loan_preview`。
  - 顶部是中号信用仪表盘，加单笔额度（`limit`，为空时「不能贷款」）、本周贷款利率（`rate`）和最晚应还日（今天 + 7 × `max_weeks`，「1月20日（学期末）」）。
  - 不能办理时（`blocked`）只显示一句提示，不显示表单：`CREDIT_TOO_LOW`「信用分 400 分以上才能贷款，现在是 350 分。」，`NO_TERM`「现在不在学期内，不能贷款。」，`STUDENT_INACTIVE`「账户已冻结，不能贷款。」（毕业同理）。在学期内但剩不到一周（`term` 不为空、`max_weeks` 为空）时「本学期 1月20日 结束，不到一周，不能贷款。」
  - 新贷款表单：金额提示「1 HTB 起，最多 165 HTB」；用途必填，最多 30 字；还款方式分「分期还 / 一次还清」，选期数或周数（1～`max_periods`）后提示最后一期的日期；放款方式「存入账户 / 付现金」，付现金时显示配钞（同取款）。
  - 确认弹层标题「给张小明放款 130 HTB？」，按钮「确认放款」；列出计划表：期、应还日、本金、约估利息（`loan_preview` 每期的 `interest_centi`，两位小数，前写「约」），下面合计；说明「利息按天算，提前还就少付。逾期部分按罚息 8.835%/周 计息，并扣信用分。」（罚息取 `penalty_rate`）。
  - 有未结清贷款时（`loan`）：显示剩余本金、已产生利息（`interest_centi`，两位小数）、本期应还（`next`）、周利率；逾期时加一行罚息利率，标红。下面是还款计划与还款表单，提示「本期应还 33 HTB · 全部结清 100 HTB」（`next.amount`、`payoff`，客户端不自己取整），付款方式「从账户扣 / 交现金」；确认弹层「张小明还款 33 HTB？」，按钮「确认还款」。
  - 逾期时提示「11月17日 那期还差 20 HTB。逾期的本金按罚息计息，每满一周再扣 30 分。」几期同时逾期时前半句写「11月17日 起 2 期共还差 52 HTB」，学生端同样。
  - 冻结、毕业的账户照常显示贷款和计划，不显示还款表单，提示「账户已冻结，不能在柜台还款；每期应还日结束时会从活期自动扣。」
  - 每期状态：已还清（`paid = principal`）/ 已逾期（`overdue_at` 不为空且没还清）/ 本期（最早一期没还清的）/ 待还；部分还款的写「已还 20 HTB，还差 12 HTB」。贷款状态：还款中 / 已逾期 / 已结清 / 已作废，已作废的只在后台出现。
  - 放款、还款的弹层遇到服务器拒绝时不关闭，错误写在弹层里。「今日业务」：放款、还款有冲正按钮（由服务器把关）。
- 「定期」：数据取 `term_quote`。
  - 开定期：存期卡片只列 `options`，名称「4 周」，说明两行「12月10日 到期」「3.12%/周」；少于 3 项时写「本学期 1月20日 结束，最长只能选 4 周。」，`term` 为空时「现在不在学期内，不能开定期。」，`options` 为空时「本学期 1月20日 结束，已经放不下定期。」。金额提示「到期拿回 112.48 HTB · 3.12%/周」，没填时「1 HTB 起，最多 415 HTB（活期余额）」。确认弹层标题「给张小明开定期 100 HTB？」，列存期、到期日、周利率（到期前不变）、到期拿回、活期余额 A → B，说明「到期当天结束时自动转回活期。提前支取只按活期算利息。」，按钮「确认开定期」。
  - 定期列表：不显示已冲正的，状态为存期中 / 已到期 / 已提前支取；存期中与已到期写「定期 4 周存 100 HTB，到期拿回 112.48 HTB」，已提前支取写「定期 4 周存 100 HTB，提前取出，利息 0.37 HTB」。学生「我的定期」用同一列表。
  - 提前支取：存期中且未过到期日的才有按钮；确认文案「不付定期利息，只按活期利率算存入这些天的利息，当天支取没有利息。本金和利息转回活期。」，成功后提示「已提前支取，利息 0.37 HTB」。柜台不能冲正提前支取。
  - 冻结、毕业的账户不显示开定期和提前支取，提示「账户已冻结，不能开定期或提前支取；定期照常到期转回活期。」
  - 开定期和提前支取的弹层遇到服务器拒绝时不关闭，错误写在弹层里。
  - 「今日业务」：开定期有冲正按钮（柜员读不到定期状态，由服务器把关），同一次办理中这笔定期已提前支取的不再显示；定期转回没有冲正按钮。
- 「查询」：账户累计里加定期合计（`lookup_student` 的 `term_total`）、贷款剩余（`loan_remaining`，逾期时标红）、信用分。
- 上班：「上班」弹出备用金录入（各面额张数，默认上次实点）。
- 下班：下班总结加现金表（第 4 节），录入实点，比对结果，有差额时写原因。
- 办理单、今日业务、下班总结都包含新类型的业务。

### 16.2 后台

导航新增（按身份显示，见第 3 节）：

| 页面 | 内容 |
| --- | --- |
| 总览 | 顶部经营看板（财务、行长、银行管理员）：账户余额（活期 + 定期）、银行应有现金、贷款余额（下面写「逾期 2 笔 · 45 HTB」，只有这一行标红）、文创库存（件数与成本）、本周业务笔数、本周锚点；下面是按周业务柱状图（最近 12 周）和未处理的风险提醒；库管、行长、银行管理员看到库存不足的商品；财务看到待复核和隔天未复核的轧账 |
| 风险提醒 | 第 12 节 |
| 贷款 | 读 `loans`、`loan_periods`、`loan_payments` 表。列表按状态分页签（全部 / 还款中 / 已逾期 / 已结清 / 已作废），逾期的排在前面，贷款号链接到详情；详情在各种宽度下都排成一列，依次是学生卡片、四项数字（本金、剩余本金、已付利息即 `loan_payments.interest` 之和且不算已冲正的、已产生利息 `interest_centi`）、放款信息、还款计划、还款记录（方式：账户 / 现金 / 自动扣款）；行长、银行管理员可终止：写原因，二次确认「剩余本金 98 HTB 和已产生利息 1.37 HTB 立即全部到期：先从活期扣，不够的部分算逾期。」 |
| 利率 | 本周锚点与按分数的利率表（同 9.2，`rate_overview()`，标题「按分数的周利率 · 锚点 1.85%」，多一列逾期罚息）；每周历史（9.1 的全部输入和结果，`rate_weeks` 表，锚点没有变化时写「与上周持平」）；计算参数分两段：「可在参数页修改」列初始锚点、锚点范围并链接参数页，「系统固定」列目标存贷比、目标增速、每周最多调整、存期倍数、贷款倍数、罚息倍数，数值都读 `settings`。锚点下的说明：假期中「假期中不计息，下学期沿用此锚点。」；还没有锚点「还没有公布锚点，现在按初始锚点 2% 计算。学期内每周一公布。」；其他「11月9日公布，下次 11月16日。」 |
| 信用分 | 按学生查分数和全部变动（`credit_scores`、`credit_events` 表，详情用 `credit_profile(学号)`）；银行管理员可调整（`adjust_credit`）；计算参数与规则参数 |
| 轧账 | 财务：待复核、已轧账；按柜员、日期筛选；复核 |
| 货币 | 第 11 节的登记与监控 |
| 学期 | 第 6 节 |
| 工作人员 | 增加「导入」（5.1）；导入、新增、重置密码都出每人一页的通知单（5.3），页面上不再显示密码 |

参数页加入 14.3 的参数，按「利率」「信用分」「风险提醒」分组。「利率」分组只有初始锚点、锚点下限、锚点上限三项，校验同 14.3，下限、初始、上限的关系不满足时三项都标错；保存时 `anchor_params` 提交完整对象，其余键沿用读到的值，三个倍数不提交；组说明「从下周一起生效。其余计算参数由系统固定，可在利率页查看。」

利率去掉末尾多余的 0，最多 4 位小数，学生端加「/周」；存贷比、增速保留 1 位小数；调整写百分点（+0.25、−0.50）。`interest` 流水显示为「利息」，经办人「系统」，没有冲正入口；后台流水、柜台查询的类型筛选和报表的余额变动都有「利息」。

### 16.3 学生端

导航：首页 / 明细 / **信用** / 排名 / 我的。

- **首页**：余额下面一行写「攒着的利息」（`interest_profile().pending_centi`，两位小数，没有时「0.00 HTB」，读取失败时「—」；下面小字满 1 HTB 时写「下周一存进余额」，不满时写「满 1 HTB 再存进余额」）、定期合计（`accounts.term_total`）、贷款一行「剩余 98 HTB」，小字「11月24日 应还 33 HTB」，逾期时写「已逾期 · 应还 20 HTB」并标红；旁边是中号信用仪表盘，点它进入「信用」页。
- **信用**：大号信用仪表盘（含贷款额度和「再涨 N 分，额度加 5 HTB」，取 `credit_profile()`；变动记录读 `credit_events`）；本周各项利率（按本人分数，`interest_profile().rates`），每行一句金额举例，金额加粗、两位小数，下面小字写周利率（如「2.13%/周」）：活期「活期存 100 HTB，一周多得约 2.13 HTB」（四舍五入）、定期「定期 8 周存 100 HTB，到期拿回 134.08 HTB」（100 + 周利率 × 周数，舍去 0.01 以下，与 9.5 一致）、贷款「借 100 HTB，一周利息约 5.89 HTB」（四舍五入；分数不够时只写「400 分以上才能贷款」）；说明行先写「信用分越高，存钱多得，借钱少付。」，再依次取：不在学期内「放假时不算利息，开学后按这组利率算。」，`week_start` 为空「本周利率还没有公布，先按初始利率显示。每周一公布。」，其他「11月9日公布，每周一更新。」；学生页面不出现「锚点」「系数」「倍数」；我的贷款（读 `loans`、`loan_periods`，同柜台的每期状态；未结清的写「借了 130 HTB，还剩 98 HTB 没还」「下次 11月24日 还本金 32 HTB，利息约 1 HTB · 5.89%/周」，利息约数为 `interest_centi` 向下取整到 1 HTB；逾期时提示「贷款已逾期：11月17日 那期还差 20 HTB。请尽快到柜台还款，每晚会先从活期自动扣。」；已结清的写「贷款 60 HTB · 用途 买书」「10月13日 已结清 · 共付利息 3 HTB」；作废的不显示）；我的定期（读 `term_deposits` 表：本金、存期、周利率、到期日、状态，预计利息 `expected_centi`，已转回的写实付利息 `interest_centi`）；信用分变动记录。
- **明细**：分类加「利息」「贷款」（含放款、还款），定期的转入转出放在「全部」里；存折同样加「贷款」页签。
- 开定期、定期转回是本人的钱在活期和定期之间转，放款、还款是借钱和还钱，首页本学期存入 / 支出和明细的本月统计都不计带 `term_id` 或 `loan_id` 的流水（含冲正它们的流水）。
- **排名**：改按活期 + 定期 − 未还贷款本金排，文案写「存款」（P1 §7.10 的排名口径随之改动）；`deposit_ranking` 返回的 `balance` 是这个数，借钱不抬高名次，借得比存得多时为负数，照常排在后面。
- 存折版（`/book`）同样显示新类型的流水。账户栏第 3 页「利息 · 定期 · 贷款」：攒着的利息、定期合计（如「100 HTB」，下面小字写最早到期那笔的到期日）、贷款三行，写法同首页，只是没有定期、没有贷款时印「无」，贷款逾期时用印章红；页底四条说明「利息每周一满 1 HTB 存进余额。」「定期到期当天结束时连本带息转回活期。」「贷款每期应还日结束时从活期自动扣。」「要看每笔定期和还款计划，在我的栏换回普通版，再到信用页查看。」电脑上这一页在第二组摊开的左页，右页空着；手机上再翻一页。数据取 `interest_profile()`、`accounts.term_total`、`term_deposits`、`loans`。
- 流水名称：`term_open`「开定期」（金额 −，下写「转定期」），`term_close`「定期转回」（金额 +，下写「转回」），都用储蓄图标与储蓄类别色；标题后半句取流水说明（14.1），如「开定期 · 4 周，12月10日 到期」，说明为空时只写类型名。后台流水的类型筛选加这两项，冲正入口只给提前支取的定期转回；冲正被拒（`REVERSAL_NOT_ALLOWED`）时开定期写「这笔定期已经到期或提前支取，不能再冲正。」，提前支取的定期转回写「已过到期日，不能再冲正这笔提前支取。」；结转名单的定期项写「张小明 · 定期 100 HTB · 12月10日 到期」。
- `loan`「贷款」、`repay`「还款」，用 loan 图标和支取类别色：放款存入账户写「+130」，下写「放款」；从账户还款写「−33」，下写「还款」；现金的金额不带正负号，下写「现金」；标题后半句取流水说明（14.1）。后台流水的类型筛选和报表的余额变动加这两项。放款冲正被拒时写「这笔贷款已经开始还款，不能再冲正。」；结转名单的贷款项写「张小明 · 贷款未结清」。

---

## 17. 测试

沿用 P1 §10 的四类测试，新增：

| 类别 | 内容 |
| --- | --- |
| 数据库（pgTAP） | 信用分（`supabase/tests/23_credit.sql`）：8.1 表格每个分数的额度与系数、「再涨 N 分」、截断、每条每周规则、冻结毕业注销与假期不变、同一周重复执行不变、整学期补跑与每周按时运行相同、手动调整的身份与记录、参数校验、读取权限、一学期的稳定存款学生（600 → 733）；锚点公式的边界与限幅、活期每天计息与结息零头、补跑与按时运行相同、利息自检（`supabase/tests/24_interest.sql`）；定期的锁定利率、到期付息与零头、提前支取按天计息、期限不跨学期末、各种不能开的情况、冲正与零头收回、注销、排名、存款余额与日均余额含定期、结转前提、补跑与按时运行相同、自检（`supabase/tests/25_term_deposits.sql`）；贷款的等额本金计划、按天计息、估算利息、提前还款、多还重排、利息零头、自动扣款、逾期、罚息、扣分、终止、有贷款不能开定期、期限不跨学期末、结转前提、放款与还款的冲正、日均余额与排名不计借来的钱、存贷比、补跑与按时运行相同、自检（`supabase/tests/26_loans.sql`）；轧账比对；风险提醒的触发与终止；货币监控等式；免密码绑定只限管理员；`import_staff` |
| 定时任务 | 用固定的「今天」跑 `run_daily`、`run_weekly`：重复执行结果不变；停机三天后补跑结果与每天都跑相同；失败时停在出错的那天并记录（`supabase/tests/22_terms_jobs.sql`）；冒烟测试检查 `dolphin-jobs` 在运行、`dolphin jobs` 的输出和重启后的补跑 |
| 端到端 | 柜台办贷款（账户 / 现金）、还款、开定期、提前支取；上班登记备用金、下班实点不平写原因、财务复核；风险提醒终止贷款；学生「信用」页；利率页、待入账利息与「利息」流水（`client/e2e/rates.spec.ts`）；工作人员导入与通知单 |
| 模拟 | `docker/sim-test.sh`：2000 名学生跑满一学期（18 周）的随机业务（含开定期与提前支取、放款与还款，部分贷款逾期），检查锚点保持在 1%～4%、每天自检通过、单次 `run_daily` 在 30 秒内完成、学期结束时定期全部转回活期、贷款全部结清或逾期在册 |

---

## 18. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| M6 柜台与账号补充 | 上班登记备用金、下班总结面额汇总；工作人员导入、免密码绑定；所有创建与重置都出通知单 | 相关测试通过 |
| M7 学期与定时任务 | 学期登记与结转；`dolphin-jobs` 与 `dolphin jobs` | 定时任务测试通过 |
| M8 信用分 | 设计系统 `CreditGauge`；分数、计算公式、规则、手动调整、学生「信用」页 | 信用分测试通过 |
| M9 利率与活期利息 | 锚点、每天计息、每周结息、利率页 | 锚点与计息测试通过 |
| M10 定期 | 开定期、到期、提前支取 | 定期测试通过 |
| M11 贷款 | 办理、计划、还款、自动扣款、逾期、终止 | 贷款测试通过 |
| M16 定期定值与理财 | 定期期限改为 2 / 4 / 12 / 24 / 48 周，周利率为银行管理员设定的固定值，可以跨学期、假期照常计息；理财：同样的期限，每周收益率取参考指数的周涨跌（东方财富周 K 线，取不到时银行管理员登记），可能为负，随时按净值赎回，到期转回活期 | 定期与理财测试通过 |
| M17 信用分开关 | 银行管理员关闭信用分时，所有学生按 600 分计、分数不变；重新打开后恢复各人原来的分数 | 信用分测试通过 |
| M18 全员考勤与工资 | 除运维员外各身份都可绑定工资账户、参与考勤；柜员按上下班自动记，其他身份由行长或银行管理员登记；工资按身份和班次分别设定 | 考勤与工资测试通过 |
| M19 手动补录与更正流水 | 银行管理员补录存款、取款、兑换或调账，记在原始发生时间，更正之后已算的活期利息；编辑流水 = 冲正原流水 + 生成更正后的新流水，两笔关联 | 补录与更正测试通过 |
| M12 轧账 | 实点、比对、复核、强制下班 | 轧账测试通过 |
| M13 风险提醒 | 全部触发条件与终止操作 | 风险提醒测试通过 |
| M14 货币、库存预警、看板、报表 | 货币登记与监控；库存预警；看板；报表与导出按台账样表对齐 | 全部端到端测试与模拟通过 |
| M15 上线 | P1 §12.1 的上线步骤，加上：登记第一个学期、银行期初现金；柜员培训新业务 | P1 §12.2 与本文第 19 节验收全部通过 |

M6 不依赖其他里程碑，最先做。M8 以后各里程碑依次依赖前一个。M16～M19 在 M11 之后、M12 之前完成，M16～M18 互不依赖，M19 在 M16 之后。

---

## 19. 验收标准

- [x] 上班登记备用金；下班总结按面额列出备用金、收入、付出、应有。
- [ ] 下班录入实点后逐面额比对，财务复核。
- [x] 用 Excel 一次导入多名工作人员并为柜员绑定工资账户，每人得到一页通知单；任何创建账号或重置密码的操作都有通知单。
- [x] 每周一自动结息并公布新锚点；锚点按公式可复算，且始终在 1%～4%。
- [x] 同一锚点、同一分数下，贷款利率高于活期和 2、4 周定期；有未结清贷款时不能开定期。
- [x] 学生端能看到信用分、额度、每次变动的原因和本人的各项利率；所有信用分都以仪表盘呈现。
- [x] 贷款按信用分算出的额度当场放款；分期计划等额本金、按天计息；提前还款少付利息。
- [x] 应还日余额足够时自动扣款；不足时标逾期、罚息、扣分，结清前不能再贷款。
- [x] 行长或银行管理员终止贷款后，剩余本息立即到期并按余额扣款。
- [x] 定期到期自动转回活期并付息；提前支取只付活期利息。
- [x] 贷款和定期的到期日不晚于学期末；假期不计息。
- [ ] 学期结转后余额与信用分转入下学期，上学期数据按学期可查、不可改。
- [ ] 第 12 节的每种情况都生成风险提醒，「终止」执行对应的撤销操作。
- [ ] 货币监控按纸币与电子币分开显示，兑付能力低于提示线时醒目提示。
- [ ] 库存降到安全库存以下时总览提示并生成风险提醒。
- [ ] 看板 6 个指标与报表数字一致。
- [ ] 导出的 Excel 列与现有台账样表一致。
- [ ] 服务器停机后重启，定时任务补跑的结果与没有停机时相同。

---

## 20. 待确认

开发中遇到、还没有拍板的细节。确认后改正文并从这里删除。

| # | 问题 | 现状 |
| --- | --- | --- |
| 1 | 现有台账样表 | 需求方在 M14 之前提供（可去掉姓名），届时按样表写明导出的列名和顺序 |
