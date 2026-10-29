# Tag

状态标签：图标 + 一两个词，贴在账户、交易或商品旁边。

- `dc-tag`（默认，`cloud-100` 底 `dolphin-deep` 字）：活期、定期等类别。
- 类别标签加业务类别类：`dc-tag dc-kind-save`（储蓄目标、定期）、`dc-kind-withdraw`（转账）、`dc-kind-exchange`（文创好物）；奖励用 `dc-tag-coin`。类别色只表示业务类别，状态用 `dc-tag-success` / `dc-tag-danger`。
- `dc-tag-success`：已到账、已领取。`dc-tag-danger`：已逾期、已下架。`dc-tag-coin`：奖励、闪光点。
- 每个标签都带图标（20px），成功和警示总是配 `success` / `warning` 图标，不只靠颜色区分。

使用者提供：类型和文字（最多 5 个字）。

动效：状态变化（如“待到账”→“已到账”）时底色和文字颜色过渡（160ms）；新出现的标签可加 `dc-pop`。
