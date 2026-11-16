# Icons

海豚云业务图标取自 Lucide 图标集（lucide-static 1.56.0，ISC 许可）：24 网格、2px 圆头圆角描边、无填充。文件里的描边色：业务图标为 `dolphin`（#1f5ff5），`success` 为 `success`（#0b6e4c），`warning` 为 `danger`（#b23c0a）。

| 文件 | 含义 | Lucide 图标 |
| --- | --- | --- |
| `deposit` | 存款 | `banknote-arrow-down` |
| `withdraw` | 取款 | `banknote-arrow-up` |
| `savings` | 储蓄 | `piggy-bank` |
| `exchange` | 兑换（文创好物） | `gift` |
| `query` | 查询 | `search` |
| `invest` | 理财 | `trending-up` |
| `loan` | 贷款 | `hand-coins` |
| `transfer` | 转账 | `arrow-right-left` |
| `passbook` | 存折 | `book-open` |
| `calendar` | 考勤、预约 | `calendar-check` |
| `clock` | 时间 | `clock` |
| `coin` | 海豚币 | `coins` |
| `star` | 奖励 / 闪光点 | `star` |
| `me` | 我的 | `user` |
| `parent` | 家长 | `users` |
| `teacher` | 老师、工作人员、银行管理员 | `presentation` |
| `lock` | 密码 | `lock` |
| `home` | 首页 | `house` |
| `bell` | 消息 | `bell` |
| `help` | 帮助 | `circle-help` |
| `success` | 成功 | `circle-check` |
| `warning` | 警示 | `triangle-alert` |
| `ranking` | 排名 | `trophy` |
| `gauge` | 信用分 | `gauge` |
| `school` | 学期 | `school` |
| `rate` | 利率、利息 | `badge-percent` |
| `balance` | 轧账 | `scale` |
| `plus` | 增加 | `plus` |
| `minus` | 减少 | `minus` |
| `back` | 返回 | `chevron-left` |
| `close` | 关闭 | `x` |
| `check` | 对勾（复选、筛选） | `check` |
| `next` | 前往 | `chevron-right` |
| `expand` | 展开（下拉） | `chevron-down` |
| `logout` | 退出登录 | `log-out` |
| `inbox` | 空状态 | `inbox` |
| `settings` | 设置 | `settings` |
| `apps` | 全部功能 | `grip` |
| `person` | 身份未知的账号头像 | `user-round` |
| `student` | 学生 | `graduation-cap` |
| `teller` | 柜员 | `banknote` |
| `accountant` | 财务 | `calculator` |
| `storekeeper` | 库管 | `package` |
| `president` | 行长 | `landmark` |
| `sysadmin` | 运维员 | `wrench` |

- 同一位置换图标时的变形过渡用 morphicons（MIT），图标路径仍取这里的文件，见“动效”的“图标变形”。
- 组件里内联同一份路径，描边写 `stroke="currentColor"`，让图标跟随文字颜色；作为 `<img>` 使用时放在 `surface`、`surface-raised`、`cloud-100` 上。
- 常用尺寸 20 / 26 / 28 / 30 / 36 / 52px。图标总是和文字一起出现，除非是头像或纯装饰。
- 账号头像（`Avatar`）的圆里就是身份图标：`student`、`teller`、`accountant`、`storekeeper`、`president`、`sysadmin`，银行管理员用 `teacher`，还没分配身份用 `help`，这台设备不知道身份的账号用 `person`。
