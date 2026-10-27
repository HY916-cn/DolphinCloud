# TabBar

手机端底部导航：四个入口，图标在上、文字在下。

- `<nav class="dc-tabbar">` 内 `<a class="dc-tab">`；当前页加 `aria-current="page"`，显示 `cloud-100` 底和 `dolphin-deep` 文字。
- 学生端固定为：首页、兑换、消息、我的。家长端：孩子账户、预约、消息、我的。
- 浮在页面底部，`shadow-float`，离屏幕边缘 `space-4`。

使用者提供：入口列表（图标 + 2 个字的名称）和当前页。最多 5 个入口。
