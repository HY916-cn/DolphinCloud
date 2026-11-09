# AppShell

多端外壳：同一份页面结构在手机、平板、电脑上自动换成底部导航、图标导航栏或完整侧边导航。

- 结构：`<body class="dc-app">` → `<div class="dc-shell">`，里面依次放 `<aside class="dc-nav">`（`dc-nav-inner` 内放 `dc-nav-brand` 和若干 `<a class="dc-nav-item">`）、`<div class="dc-main">`（`<header class="dc-top">` + `<main class="dc-content">`）、手机用的 `<nav class="dc-tabbar">`。
- 断点用容器查询判断 `.dc-app` 的宽度：手机 <600px 只显示 `TabBar`；平板显示 104px 图标导航栏；电脑显示 248px 侧边导航（标志 + 图标 + 文字）。
- `dc-top`：页面标题行，左侧可放返回按钮 `dc-icon-btn`，标题用 `title` 加 `dc-top-title`，副标题 `dc-top-sub`。
- `dc-content`：内容区，最宽 `content-max` 并居中，子元素纵向排列，间距随屏幕变大。
- `dc-split`：电脑上两栏 7 : 5，手机和平板单列；右栏加 `is-sticky` 后随页面滚动保持可见。`dc-stack` 是纵向排列的一组内容；`dc-card` 是白底卡片；`dc-section-head` 是分区标题 + 右侧轻操作。

使用者提供：导航项（图标 + 2 个字）、当前页（`aria-current="page"`）、页面内容。导航项在 `TabBar` 和 `dc-nav` 里保持同样的顺序和名称；`dc-nav` 最多 12 项，`TabBar` 最多 5 项，多出的入口只放在导航和总览页的宫格里；办理流程页（存款、取款、兑换）在手机上不显示 `TabBar`，只保留返回按钮和操作栏。

动效：侧边导航和图标导航的选中底块上下滑动（240ms，纯 CSS，各项等高）；进入新页面时内容区加 `dc-page-forward`，返回加 `dc-page-back`，导航栏不动。
