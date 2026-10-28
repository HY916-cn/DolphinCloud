# Toast

轻提示：操作完成后的短暂反馈，例如“设置已保存”，不打断当前操作。

- 结构：`<div class="dc-toasts" role="status">` 内放 `<div class="dc-toast is-success">图标 + 一句话</div>`；失败用 `is-danger`。
- 位置随屏幕变化：手机在底部、`TabBar` 上方；平板在底部居中；电脑在右上角。白底胶囊、`shadow-float`，进入时上移淡入（240ms）。
- 显示 3 秒后自动消失；同时最多两条。

使用者提供：一句不超过 12 个字的结果（“设置已保存”“已复制交易号”）。办理业务的结果用 `Result`，需要用户处理的问题用 `Notice`，都不用轻提示。

动效：进入时上移淡入（240ms）；离开时加 `is-leaving`，下沉淡出（160ms，`--ease-in`），动画结束后移除。
