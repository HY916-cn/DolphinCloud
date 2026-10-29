海豚云是明德实验学校海豚银行的线上系统，学生在这里查询余额、存取海豚币、兑换文创、学习理财。界面以**云朵、海浪（连续缓曲线）、海豚**为元素，海豚蓝为主色，页面始终明亮。界面元素对儿童友好——大图标、步步引导、大圆角、能按下去的厚底按钮；界面文字保持银行应有的规范与正式。

## 设计原则

1. **一眼看得懂。** 每屏只办一件事；业务入口用大图标 + 规范业务名称；金额是全页最大的字。
2. **每一步都有引导。** 新功能用“小海豚提示”（`GuideBubble`）逐步说明，办理业务用 `Steps` 显示进度，结果用 `Notice` 说清楚。
3. **圆润、可触、有反馈。** 所有可点的元素都是大圆角和厚底阴影，按下会下沉，像积木一样实在。
4. **账目清楚可信。** 金额用 `amount` 样式，收支总配文字（存入 / 支出 / 奖励），不只靠颜色区分。

## 文字与语气

界面元素可以活泼，**界面文字保持正式**：像一家认真对待小储户的银行，亲切、清楚、不幼稚。

- 用“你”称呼学生，句子短，一句话说一件事。不用“哦”“啦”“呀”等语气词，不用叠词和网络用语；感叹号只用于奖励到账，一句最多一个。
- 使用规范业务用语，与柜台业务 SOP 一致：存款、取款、兑换、查询、理财、贷款、存折、预约。按钮写动作本身：“确认存款”“知道了”“下一步”，不写“提交”“确定操作”这类含糊的词。
- 结果直接写结果：“存款成功”“余额不足”。说明里写清数字和下一步：“可用余额 1,280 HTB，还差 720 HTB，请减少取款金额。”不用“错误”“失败”“异常”“非法”。
- 海豚币单位写 `HTB`，金额用千分位逗号：`1,280 HTB`。收入写 `+50`，支出写 `−20`（用减号 −）。
- 时间写“10月27日 14:20”，当年内不写年份。按钮文字 2～5 个字，动词开头；字段名不加冒号。
- 不用 emoji 当图标，用 Icons 组里的图标。

## 颜色

每种颜色只有一个用途。先问“这是操作、类别还是状态”，再选颜色；“颜色用途”卡片把下表画了出来。

| 颜色 | 类名 / token | 表示 | 用在 |
| --- | --- | --- | --- |
| 海豚蓝 | `dolphin` | **操作与导航** | 主按钮、链接、选中的导航、焦点环。全系统只有它表示“可以点、去办理”。 |
| 海豚蓝（默认） | 不加类 | **账户与服务**：不涉及钱进出 | 查询、明细、存折、预约、帮助、设置、身份的图标 |
| 海青 | `dc-kind-save`（`sea-soft` / `sea-ink`） | **储蓄**：钱存进来、攒起来 | 存款、储蓄、定期、储蓄目标；柜台存款的面额卡 |
| 葡萄紫 | `dc-kind-withdraw`（`grape-soft` / `grape-ink`） | **支取**：钱出去，或借入、归还 | 取款、转账、贷款；柜台取款的面额卡 |
| 珊瑚粉 | `dc-kind-exchange`（`rose-soft` / `rose-ink`） | **兑换**：用海豚币换东西 | 兑换、文创好物 |
| 金色 | `dc-kind-reward`（`coin-soft` / `coin-ink`） | **海豚币与奖励** | 奖励、闪光点、利息、理财、排名；币图标 |
| 绿 / 橙红 | `success` / `danger` | **状态**，不是类别 | 办成了、已到账 / 没办成、需要注意。永远配 `success` / `warning` 图标和文字 |

- **类别色只出现在四处**：图标底块（宫格、交易、列表、空状态）、类别标签 `Tag`、进度条 `Progress`、面额卡 `QtyStepper`。类名加在组件或它的容器上，浅底配同色系的图标和文字。
- **类别色不用于**按钮、导航、链接、正文文字、页面和卡片背景。一项业务在全站只用一种颜色，同一个页面里同类的东西颜色相同（一屏的面额卡全是存款的海青）。
- **大面积色块只有两处**：余额卡（纯 `dolphin` 底，同色浅一层的海浪，`dolphin-deep` 胶囊，只有币图标是金色）和登录页头图（`sea-soft` → `cloud-100`，海水到天空）。封面同样只用海豚蓝、云朵色、海青和金色。
- **底色与文字**：页面底色 `surface`，卡片和输入框 `surface-raised`，选中态和引导气泡用 `cloud-100`。标题和正文 `ink`，次要信息 `ink-muted`；`cloud-100` / `cloud-200` 上的蓝色文字用 `dolphin-deep`，`dolphin` 上的文字与图标用 `on-dolphin`。
- 云朵色阶 `cloud-100` → `cloud-500` 取自 logo 的层层海浪，只用于背景、海浪和装饰；`cloud-300` 及更深不放文字。
- 所有文字与底色的组合 ≥ 4.5:1，边框、焦点环、图标 ≥ 3:1；每个颜色的 usage 写明了它能放在哪些底色上。

## 字体

- 全站一套字体 `sans`：Nunito Sans 显示数字和字母（圆润、清晰），中文由思源黑体（Noto Sans SC）显示，系统回退到苹方 / 微软雅黑。两者都从 Google Fonts 加载（`bundle.css` 已引入）。
- 标题组：`display` 36px / 800，用于首页欢迎语和办理成功页，每屏最多一处；`title` 26px / 700 页面标题；`heading` 20px / 700 卡片和分区标题。标题字距 0.02em。
- 正文组：`amount` 40px / 800 用于余额和金额，配等宽数字（`font-variant-numeric: tabular-nums`）；`body-lg` 18px / 600 用于按钮、入口名称、引导语；`body` 16px / 400 是最小的正文；`caption` 14px / 500 只用于时间、单位、标签。

## 形状：云、浪、海豚

- **圆角很大，没有直角**：标签 `radius-sm`（12px），输入框、提示条、列表卡片 `radius-md`（20px），业务入口、余额卡、弹层 `radius-lg`（28px），按钮和胶囊 `radius-pill`。
- **海浪**是连续的缓曲线，三层由浅到深（`cloud-200` → `cloud-400`），用 `WaveDivider` 收尾卡片或头图；每屏最多两处，海浪上不放内容。
- **云朵**：大块 `cloud-100` 圆角区域托住重点信息（余额、引导）。
- **海豚**只以 logo 的形式出现：登录页、引导气泡头像、应用图标。不另画海豚插图，不改动 logo。

## 阴影与状态

- 卡片和业务入口用 `shadow-card`：向下 6px 的实色“厚底”，不用灰色模糊阴影。主按钮用 `shadow-button`（`dolphin-deep` 厚底）。
- 浮在页面上的元素（弹层、引导气泡、底部导航）用 `shadow-float`。
- 按下：元素下移 3～4px，厚底变薄。禁用：`cloud-200` 底 + `ink-muted` 字，并把原因写在按钮上（“余额不足”）。
- 键盘焦点：`focus-ring`（一圈白 + 一圈 `dolphin-deep`），所有可点元素都有。
- 动效的时长、缓动和每个场景的做法见“动效”一节。

## 布局与触控

- 手机、平板、电脑共用一套页面，断点 `bp-tablet`（600px）和 `bp-desktop`（1024px）；导航、栏数和按钮排版随宽度切换，细则见“排版与多端适配”一节。
- 手机上的页面操作按钮总是整行、贴底；表单里的提交按钮在所有屏幕上撑满表单宽度。
- 间距用 `space-1` 到 `space-7`（4 → 48px）；可点区域最小 44×44px，主要按钮 56px 高；相邻可点元素至少相隔 `space-2`。

## 图标

- 图标使用 [morphicons](https://www.morphicons.com/) 的默认图标集 Lucide（ISC 许可）：24 网格、2px 圆头圆角描边，线条干净、圆润而不幼稚。Icons 组收录 32 个图标（21 个业务图标和 11 个界面图标：加、减、返回、前往、展开、关闭、对勾、排名、设置、退出、收件箱），文件里描边为 `dolphin`；`success` 用 `success` 色，`warning` 用 `danger` 色。
- 在组件里把图标写成内联 `<svg class="dc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`，颜色跟随文字：普通位置是 `dolphin`，主按钮上自动变成 `on-dolphin`，选中导航为 `dolphin-deep`。在不能内联的地方用 Icons 组的文件（`<img>`）。
- 图标在两种状态之间切换时（底部导航选中、展开 / 收起、办理完成打勾），用 morphicons（`npm install morphicons`）做形变过渡，时长不超过 200ms。
- 图标总是和文字一起出现（头像和纯装饰除外）。常用尺寸：标签 20px、按钮 26px、导航 30px、提示条和余额卡 36px、宫格 52px。
- 需要新图标时，从 Lucide 里选，保持 2px 描边，不混用其他图标库。

## 组件

组件是纯 CSS 类（`components/bundle.css`，前缀 `dc-`），在任意框架里写出对应的 HTML 结构即可使用。每个组件的 README 写明结构、何时使用，以及使用者需要提供什么。

- 颜色：`ColorRoles`（每种颜色用于什么）。
- 布局：`AppShell`（多端外壳与导航）、`ActionBar`（页面操作栏）、`WaveDivider`。
- 操作与导航：`Button`、`ServiceTile`、`TabBar`、`Tabs`、`Segmented`、`FilterChips`。
- 表单与选择：`Field`、`Select`、`SearchField`、`Switch`、`Checkbox`、`Radio`、`ChoiceCard`、`Slider`、`QtyStepper`。
- 账户：`BalanceCard`、`TxnList`、`PersonCard`、`SummaryList`、`Progress`、`ListGroup`。
- 引导与反馈：`GuideBubble`、`Steps`、`Tag`、`Badge`、`Notice`、`Toast`、`Sheet`、`Result`、`EmptyState`、`Skeleton`。

选择控件怎么选：立即生效的设置用 `Switch`；勾选任意多项用 `Checkbox`；带说明的单选用 `Radio`，带图标的 2～4 项用 `ChoiceCard`；切换视图用 `Segmented`；按类别分页用 `Tabs`；多条件筛选用 `FilterChips`；选项超过 6 个用 `Select`；在范围内取值用 `Slider`。
- 动效示例：`Motion`。

## 页面示例

`LoginPage`（登录）、`StudentHomePage`（学生首页）、`TxnHistoryPage`（交易明细）、`SettingsPage`（设置）、`CounterServicePage`（柜台办理：一位学生连续办理多笔）、`CounterDepositPage`（柜台存款）、`ResultPage`（办理结果）六个页面示例，各自并排展示手机、平板、电脑三种宽度下的同一份页面结构，是组合组件的参考写法。
