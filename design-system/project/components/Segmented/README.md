# Segmented

分段切换：在 2～4 个并列的视图或模式间切换，例如“本周 / 本月 / 本学期”、字号“标准 / 较大 / 特大”。

- 结构：`<fieldset class="dc-seg" aria-label="时间范围">`，每段 `<label><input type="radio" name="…"><span>本月</span></label>`。
- `cloud-100` 胶囊底，选中段变为白色胶囊、`dolphin-deep` 文字，切换 160ms；每段等宽，最小高度 44px。

使用者提供：2～4 个选项（每个不超过 4 个字）和当前项。切换后立即更新下方内容，不需要确认按钮；分类筛选数据用 `Tabs`。
