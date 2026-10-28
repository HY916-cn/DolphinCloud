# ChoiceCard

图标单选卡：用大图标 + 名称做选择，选项一眼可辨，整块都能点。

- 结构：`<div class="dc-choices" role="radiogroup" aria-label="身份">`，每项 `<label class="dc-choice"><input type="radio" name="…"><span class="dc-choice-icon">图标</span><span><b>学生</b><small>学号登录</small></span></label>`。
- 选中：描边变 `dolphin`、底色 `cloud-100`，图标底变为实心 `dolphin`、图标变白。键盘聚焦时出现 `focus-ring`。
- 选项自动排成一行，每项最窄 140px，放不下时换行。

使用者提供：选项（图标、名称、一句说明）、`name` 和默认选中项。用于 2～4 个互斥、需要说明的选项，例如存款类型（活期 / 定期）、兑换方式（账户扣款 / 现金支付）；选项更多时改用列表。

动效：选中时描边、底色过渡（160ms），图标底轻轻弹一下（320ms，`--ease-bounce`）。
