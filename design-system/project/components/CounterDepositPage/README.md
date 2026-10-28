# CounterDepositPage

柜台存款示例：柜员核对学生、按面额录入张数、核对金额后确认存款。

- 外壳 `AppShell`，柜台导航：存款、取款、兑换、查询、冲正；标题行有返回按钮、标题“存款”、副标题经办柜员和柜台。
- 内容：`Steps`（识别学生 → 录入面额 → 核对信息 → 完成），`dc-split` 左栏 `PersonCard` + `QtyStepper`，右栏“核对金额”卡片（`SummaryList`，`is-sticky`），最后是 `ActionBar`（上一步 / 确认存款）。
- 手机：单列，操作栏贴底、整行；平板：单列，按钮一行等分；电脑：左录入、右核对，按钮靠右。
- 页面以 `dc-page-forward` 进入。
