# 海豚云 · 第一阶段开发文档

> 依据：[分阶段产品文档](../product/PRODUCT.md) 第 4 节「阶段一：柜台上线，替代 Excel 账本」、[功能需求 3.0](../requirements/REQUIREMENTS.md)、[海豚云设计系统](../../design-system/project/README.md)
>
> 本文说明第一阶段「怎么做」：技术架构、数据模型、接口、前端结构、部署与运维、测试与里程碑。产品范围以产品文档为准，两者不一致时先改产品文档再改本文。

---

## 1. 范围

### 1.1 本阶段交付

| 模块 | 交付内容 |
| --- | --- |
| 登录 | 学生用学号 + 密码登录；工作人员用账号 + 密码登录；用默认密码登录后必须设置新密码 |
| 开户 | 银行管理员按模板导入名册，批量开户并迁入期初余额；新账号使用默认密码，按班打印开户通知单 |
| 学生端 | 余额、最近 10 笔交易、全部明细（分页）、存款排名（按学部分开排，默认匿名） |
| 柜台 | 总览、办理、冲正：按姓名、拼音、班级或学号找到学生并确认是本人后，在一次办理里连续办理存款、取款、兑换，办理单记下每一笔 |
| 离线登记 | 断网时只允许登记存款，本机暂存，恢复后补传；纸质凭条兜底 |
| 文创商城 | 商品新增、编辑、图片、价格、上架 / 下架、入库（增加库存） |
| 货币发行 | 发行批次登记 |
| 流水查询 | 会计与银行管理员按学生、日期、类型、柜员组合查询全部流水 |
| 系统 | 账号与角色、参数设置、操作日志、每日自动备份与命令行恢复、余额自检 |
| 部署 | 单个 Docker 镜像，一条 `docker run` 启动，自动申请 HTTPS 证书 |

### 1.2 后续阶段

以下内容在后续阶段实现，本阶段的数据结构为它们预留字段，但不实现功能：

- 二维码胸卡扫码识别（扫码枪与摄像头）
- 凭条打印、报表导出、经营看板、盘点与库存预警、贷款、工资发放、学期结转
- 家长端、教师端、存折、利息与定期、积分转海豚币

---

## 2. 关键决策

| 主题 | 决定 | 说明 |
| --- | --- | --- |
| 前端 | Expo Router + React，TypeScript，界面直接使用设计系统的 `bundle.css`；第一阶段只发布 Web | 柜台平板、后台电脑、学生手机都用浏览器访问，一套页面按宽度适配三种屏幕。原生客户端用同一份界面打包：M3 起是可安装的 PWA；阶段三用 Capacitor 打包安卓 / iOS 安装包，原生能力（推送、相机）走插件。数据与业务逻辑集中在 `src/lib`，不依赖 DOM，也可供 React Native 界面复用 |
| 后端 | 自托管 Supabase 组件：Postgres、Auth（GoTrue）、PostgREST、Storage | 业务规则全部写在 Postgres 函数（RPC）里，前端只调用函数，不直接写表 |
| 部署 | 单容器：Caddy + Postgres + Auth + PostgREST + Storage，由 supervisord 管理 | 一个镜像、一个数据卷；不含 Studio、Realtime、Edge Functions |
| 网络 | 校内服务器，公网域名（已备案）+ 内网均可访问 | Caddy 自动申请并续期 Let's Encrypt 证书 |
| 身份识别 | 柜员按姓名、拼音首字母、班级或学号搜索，选中后确认「是 张小明 吗？」 | 胸卡扫码在后续阶段加入，届时只是多一种输入学号的方式 |
| 兑换付款 | 支持「账户扣款」和「现金支付」 | 现金支付按收到的面额计算找零，账户余额不变 |
| 离线 | 只允许存款 | 存款不会透支，补传后服务端照常校验 |
| 对账 | 本阶段不设班次、不做轧账 | 流水记录柜员、设备和时间，并预留 `cash_delta` 字段，便于以后按柜员汇总现金 |
| 更正 | 冲正 | 柜员可冲正本人当天办理的业务；银行管理员可冲正任意业务；原流水保留并标记「已冲正」 |
| 密码 | 新账号和重置后的密码均为默认密码 `a12345678` | 用默认密码登录后必须设置新密码，这是本人唯一一次改密码；之后只能由银行管理员或运维员重置回默认密码 |
| 规模 | 学生 500–2000 人，柜台窗口 3–5 个 | 2 核 4 GB、40 GB 磁盘的服务器即可 |

---

## 3. 系统架构

### 3.1 总览

```
浏览器（柜台平板 / 后台电脑 / 学生手机）
        │ HTTPS 443
┌───────▼─────────────────────────── dolphin-cloud 容器 ─┐
│ Caddy（证书、静态站点、反向代理）                         │
│   /             → Expo Web 静态文件（SPA，含 Service Worker）│
│   /config.js    → 启动时生成的运行配置（站点地址、anon key） │
│   /auth/v1/*    → Auth (GoTrue)      127.0.0.1:9999      │
│   /rest/v1/*    → PostgREST          127.0.0.1:3000      │
│   /storage/v1/* → Storage API        127.0.0.1:5000      │
│                                                         │
│ Postgres（只监听容器内部）                                 │
│ 定时任务：每日备份、余额自检                              │
│ supervisord：管理以上进程                                  │
└──────────────── /data（数据库、图片、备份、密钥、证书）───┘
```

- 前端与 API 同域，没有跨域问题；前端用 `supabase-js` 访问 `location.origin`。
- 只对外开放 80（证书验证与跳转）和 443。Postgres 不映射端口。
- Web 产物与环境无关：密钥和地址在容器启动时写入 `/config.js`，同一个镜像可用于测试和正式环境。

### 3.2 组件与版本

| 组件 | 来源 | 用途 |
| --- | --- | --- |
| Postgres | `postgres:<major>-bookworm` 官方镜像（作为最终镜像的基础） | 业务数据、Auth 与 Storage 的元数据 |
| Auth | `supabase/auth` 镜像中的 Go 二进制 | 登录、令牌签发与刷新 |
| PostgREST | `postgrest/postgrest` 镜像中的静态二进制 | 表查询与 RPC |
| Storage API | `supabase/storage-api`，在 `node:<ver>-bookworm-slim` 中按标签构建 | 商品图片，文件存放在 `/data/storage` |
| Caddy | `caddy` 镜像中的二进制 | HTTPS 与路由 |
| supervisord | Debian 包 | 进程管理；每日备份由它托管的定时脚本执行 |

版本统一写在 `docker/Dockerfile` 开头的 `ARG` 中，取自 Supabase 官方 self-hosted `docker-compose.yml`（2026 年 10 月）：Auth `v2.197.0`、PostgREST `v14.18`、Storage `v1.81.0`、Postgres `17`、Caddy `2.10`、Node `24`。Postgres 主版本与 `supabase/config.toml` 的 `db.major_version` 一致；升级任一组件后先跑 `docker/smoke-test.sh`，再跑第 10 节的集成测试。

### 3.3 运行配置

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DOLPHIN_DOMAIN` | 是 | — | 用户访问的域名，不含端口，如 `bank.example.edu.cn`；本地测试用 `localhost` |
| `ACME_EMAIL` | 由 Let's Encrypt 签发时必填 | — | 证书到期通知邮箱 |
| `DOLPHIN_PORT` | 否 | `443` | 容器内 HTTPS 监听端口；放在端口转发或隧道后面时使用 |
| `TZ` | 否 | `Asia/Shanghai` | 容器时区；数据库内时间统一存 `timestamptz` |
| `BACKUP_TIME` | 否 | `02:00` | 每日备份时间 |
| `BACKUP_RETENTION_DAYS` | 否 | `30` | 备份保留天数 |

证书三种来源：挂载了 `/certs/fullchain.pem` 与 `/certs/privkey.pem` 时使用这两个文件（如 Certd 推送的证书），文件变化后 10 秒内自动重载；`DOLPHIN_DOMAIN=localhost` 时使用 Caddy 本地 CA；其余情况由 Caddy 向 Let's Encrypt 自动申请和续期。

数据库密码、`JWT_SECRET`、anon key、service_role key 在首次启动时自动生成，保存在 `/data/secrets/`（权限 600）。service_role key 只在容器内部供 Storage 和运维脚本使用，不写入 `/config.js`。

---

## 4. 角色与权限

### 4.1 角色

每个账号只有一种身份。学生账号就是学生，柜员、会计、库管、银行管理员、运维员都是工作人员，各用一个独立的工作账号，账号之间互不关联，与担任者是谁无关。同一个人担任两种身份时持有两个账号，在同一台设备上登录后可一键切换（见 7.4）。

| 身份 | 角色代码 | 登录方式 |
| --- | --- | --- |
| 学生 | （无，学生账户） | 「学生」+ 学号 + 密码 |
| 柜员 | `teller` | 「工作人员」+ 工作账号 + 密码 |
| 会计 | `accountant` | 同上 |
| 库管 | `storekeeper` | 同上 |
| 银行管理员 | `teacher` | 同上 |
| 运维员 | `sysadmin` | 同上 |

- 学生账号由名册导入产生，不带任何角色。
- 银行管理员全系统只有一个（`user_roles` 上 `role = 'teacher'` 的唯一索引）：由 `dolphin create-admin` 创建，不能新增第二个，也不能把其他账号改成银行管理员或改掉它的身份；忘记密码时用 `dolphin reset-admin` 恢复默认密码。其他身份可以有多个账号。
- 工作账号恰好有一个角色；`user_roles` 每个账号最多一行，学生账号不能写入。

### 4.2 权限矩阵

| 操作 | 学生 | 柜员 | 会计 | 库管 | 银行管理员 | 运维员 |
| --- | --- | --- | --- | --- | --- | --- |
| 查看本人余额、明细、排名 | ✓ | — | — | — | — | — |
| 首次登录设置新密码（仅此一次） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 存款、取款、兑换、查询学生 | | ✓ | | | | |
| 冲正本人当天业务 | | ✓ | | | | |
| 冲正任意业务 | | | | | ✓ | |
| 查看全部流水 | | | ✓ | | ✓ | |
| 商品管理、入库 | | | | ✓ | ✓ | |
| 发行登记 | | | | | ✓ | |
| 导入名册、开户 | | | | | ✓ | |
| 管理工作账号 | | | | | ✓ | ✓ |
| 重置学生密码 | | | | | ✓ | ✓ |
| 参数设置 | | | | | ✓ | |
| 查看操作日志 | | | | | ✓ | ✓ |
| 备份与恢复（命令行） | | | | | | ✓ |

硬性约束：

- 任何角色都不能直接修改余额、库存或删除流水；这些只能由第 6 节的函数在事务中产生。
- 运维员不能办理业务、不能修改业务数据。

---

## 5. 数据模型

### 5.1 约定

- 所有金额、数量为整数（`integer`），单位 HTB，禁止浮点。
- 时间为 `timestamptz`；「当天」按 `Asia/Shanghai` 计算：`(created_at at time zone 'Asia/Shanghai')::date`。
- 业务表全部放在 `public` schema，开启 RLS；`authenticated` 角色对业务表只有 `select`（受 RLS 限制），写入全部经由 `security definer` 函数。
- 迁移文件放在 `supabase/migrations/`，按时间戳命名，只增不改。

### 5.2 表结构

```sql
-- 账号资料（与 auth.users 一一对应）
create table profiles (
  id                   uuid primary key references auth.users(id),
  login_kind           text not null check (login_kind in ('student','staff')),
  login_id             text not null,          -- 学号或工作账号
  display_name         text not null,
  must_change_password boolean not null default true,
  disabled             boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (login_kind, login_id)
);

create type app_role as enum ('teller','accountant','storekeeper','teacher','sysadmin');

create table user_roles (
  user_id uuid references profiles(id),
  role    app_role not null,
  primary key (user_id, role)
);

create table students (
  student_no text primary key,
  user_id    uuid unique references profiles(id),
  name       text not null,
  division   text not null check (division in ('primary','junior')),  -- 学部：小学部 / 初中部
  cohort     integer not null check (cohort between 2000 and 2100),  -- 学届：入学年份，如 2023
  class_no   integer not null check (class_no between 1 and 99),     -- 班号，只有数字
  status     text not null default 'normal' check (status in ('normal','frozen','graduated')),
  opened_at  timestamptz not null default now()
);

create table accounts (
  student_no   text primary key references students(student_no),
  balance      integer not null default 0 check (balance >= 0),
  total_in     integer not null default 0,     -- 累计存入（含期初）
  total_out    integer not null default 0,     -- 累计取出
  total_spent  integer not null default 0,     -- 累计账户兑换
  updated_at   timestamptz not null default now()
);

create type txn_type as enum ('opening','deposit','withdraw','purchase','reversal');

create table txns (
  id                uuid primary key,          -- 客户端生成，作幂等键
  seq               bigserial unique,
  txn_no            text unique not null,      -- 交易号：HT + YYMMDD + 6 位序号
  type              txn_type not null,
  student_no        text not null references students(student_no),
  amount            integer not null check (amount > 0),
  balance_delta     integer not null,          -- 对账户余额的影响
  balance_after     integer not null,
  cash_delta        integer not null default 0,-- 对柜台现金的影响：存款 +，取款 −，现金兑换 +
  payment           text check (payment in ('account','cash')),  -- 仅兑换
  denominations     jsonb,                     -- 面额明细，如 {"10":2,"5":1}
  change_given      jsonb,                     -- 现金兑换的找零明细
  status            text not null default 'normal' check (status in ('normal','reversed')),
  reversal_of       uuid unique references txns(id),
  reason            text,                      -- 冲正原因
  operator_id       uuid not null references profiles(id),
  device_id         text,
  offline           boolean not null default false,
  client_created_at timestamptz,               -- 离线登记的本机时间
  created_at        timestamptz not null default now()
);
create unique index txns_one_opening on txns(student_no) where type = 'opening';
create index on txns (student_no, created_at desc);
create index on txns (operator_id, created_at desc);
create index on txns (type, created_at desc);
create index on txns (created_at desc);

create table products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  image_path   text,                           -- Storage 中 product-images 桶内路径
  price        integer not null check (price > 0),
  cost         integer,
  category     text,
  listed       boolean not null default false,
  stock        integer not null default 0 check (stock >= 0),
  safety_stock integer,                        -- 阶段二库存预警使用
  updated_at   timestamptz not null default now()
);

create table txn_items (
  txn_id     uuid references txns(id),
  product_id uuid references products(id),
  name       text not null,                    -- 下单时的商品名快照
  unit_price integer not null,
  qty        integer not null check (qty > 0),
  primary key (txn_id, product_id)
);

create table stock_movements (
  id          bigserial primary key,
  product_id  uuid not null references products(id),
  kind        text not null check (kind in ('stock_in','sale','reversal')),
  qty_delta   integer not null,
  txn_id      uuid references txns(id),
  operator_id uuid not null references profiles(id),
  note        text,
  created_at  timestamptz not null default now()
);

create table currency_issues (
  id            uuid primary key default gen_random_uuid(),
  batch_no      text unique not null,
  issued_on     date not null,
  denominations jsonb not null,                -- {"1":500,"2":300,"5":200,"10":100}
  total         integer not null,              -- 由函数按面额算出
  purpose       text not null,
  approver_name text not null,
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);

create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  action     text not null,                    -- 如 product.update、user.reset_password
  target     text,                             -- 表名:主键
  before     jsonb,
  after      jsonb,
  ip         text,
  device_id  text,
  user_agent text
);
```

年级与班级：

- 数据库只保存学届（入学年份）和班号，统计、筛选都按学届；年级由学届推算，不存储。
- 学年从参数 `promotion_date`（默认 9 月 1 日）开始。小学部年级 = 当前学年 − 学届 + 1（一至六年级），初中部年级 = 当前学年 − 学届 + 7（七至九年级）。
- 显示时以年级班级为主、学届为辅：主文字「四年级(1)班」，旁边弱化显示「2023 届」。学届超出本学部年级范围时（已升出或尚未入学）只显示学届。
- `app_private.grade_of(学部, 学届[, 日期])`、`app_private.class_label(学部, 学届, 班号[, 日期])` 负责推算；表查询可直接取计算列 `students?select=*,grade,class_label`。

### 5.3 参数

| key | 默认值 | 说明 |
| --- | --- | --- |
| `denominations` | `[1,2,5,10]` | 面额（元），柜台按此显示张数输入 |
| `withdraw_single_limit` | `{"primary":200,"junior":200}` | 单笔取款上限，小学部、初中部分别设置 |
| `withdraw_daily_limit` | `{"primary":500,"junior":500}` | 单日累计取款上限（不含已冲正），小学部、初中部分别设置 |
| `ranking_anonymous` | `true` | 排名是否隐藏姓名（显示为「张*明」） |
| `ranking_size` | `10` | 排名显示前几名（每个学部） |
| `promotion_date` | `"09-01"` | 每年升年级的日期（月-日），从这天起所有学生的年级加一 |

### 5.4 数据不变式

1. `accounts.balance = sum(txns.balance_delta)`（按学生），由函数在同一事务内维护；`app_private.check_balances()` 每天复核一次。
2. `products.stock = sum(stock_movements.qty_delta)`（按商品），同样由函数维护并每日复核。
3. `txns` 只能新增；唯一允许的更新是冲正时把原流水 `status` 改为 `reversed`。触发器拒绝其他 `update` 与所有 `delete`。
4. 每笔冲正指向唯一一笔原流水（`reversal_of` 唯一），冲正流水本身不能再被冲正。

### 5.5 审计

- 触发器记录 `profiles`、`user_roles`、`students`、`products`、`currency_issues`、`settings` 的每次变更（前后值）。
- 流水本身即账务审计；导入名册、重置密码、冲正等函数另写一条 `audit_log`。
- IP、设备号、User-Agent 取自 PostgREST 传入的请求头：`current_setting('request.headers', true)::json`，其中 IP 取 Caddy 写入的 `X-Forwarded-For`，设备号取前端发送的 `X-Device-Id`。

---

## 6. 后端接口

### 6.1 原则

- 前端只通过 `supabase.rpc()` 写数据，通过表查询读数据（受 RLS 限制）。
- 每个写函数都是 `security definer`、`set search_path = public`，开头调用 `require_role(...)` 校验角色，结尾写审计。
- 账务函数先 `select ... for update` 锁定账户行（兑换还要按商品 id 升序锁定商品行），再校验、写流水、更新余额与库存，全部在一个事务内完成。
- 幂等：`p_id` 由客户端生成（UUID v4）。同一 `p_id` 再次提交时直接返回已有流水，不重复记账。
- 出错时 `raise exception` 使用固定错误码（`message`），附带 `detail`（JSON），前端按第 7.6 节转成界面文字。

### 6.2 账务函数

| 函数 | 角色 | 参数 | 规则 |
| --- | --- | --- | --- |
| `deposit` | teller | `p_id, p_student_no, p_denominations, p_offline, p_client_created_at` | 金额 = Σ面额 × 张数，> 0；`balance_delta = cash_delta = +金额` |
| `withdraw` | teller | `p_id, p_student_no, p_amount` | 整数 > 0；≤ 单笔上限；当天累计 ≤ 单日上限（两项上限按学生所在学部取值）；≤ 余额；`balance_delta = cash_delta = −金额` |
| `purchase` | teller | `p_id, p_student_no, p_items [{product_id, qty}], p_payment, p_cash_received`（收到的各面额张数） | 商品须已上架且库存足够；同一商品多行时合并；账户扣款时金额 ≤ 余额，`balance_delta = −金额`，`cash_delta = 0`；现金支付时收到金额 ≥ 应付，`balance_delta = 0`，`cash_delta = +金额`，记录找零；扣库存并写 `stock_movements` |
| `reverse_txn` | teller / teacher | `p_id, p_original_id, p_reason` | 见 6.3 |

公共校验：学生存在且 `status = 'normal'`。

返回值统一为 `{ txn_no, type, amount, balance_after, change_given }`，前端据此显示结果页。

### 6.3 冲正规则

- 可冲正的类型：`deposit`、`withdraw`、`purchase`；银行管理员另可冲正 `opening`。
- 柜员只能冲正本人办理、当天发生、状态为 `normal` 的流水；银行管理员不受「本人」和「当天」限制。
- 冲正生成一笔 `reversal` 流水：`amount` 同原流水，`balance_delta`、`cash_delta` 取原值的相反数；兑换冲正同时把商品数量加回库存（`stock_movements.kind = 'reversal'`）。
- 原流水 `status` 改为 `reversed`，两笔流水互相可查。
- 冲正存款时，若当前余额小于原存款金额，拦截并返回 `REVERSAL_INSUFFICIENT_BALANCE`，由银行管理员线下处理后再冲正。
- 原因必选：金额录错、学号录错、业务选错、其他（「其他」须填写说明）。`p_reason` 传其中一项原文，「其他」写作 `其他：<说明>`。

### 6.4 管理函数

| 函数 | 角色 | 说明 |
| --- | --- | --- |
| `import_roster(p_rows)` | teacher | 见 6.5 |
| `create_staff(p_login_id, p_name, p_role)` | teacher / sysadmin | 创建一个角色的工作账号，密码为默认密码；不能创建 `teacher`（只有一个，`ONE_BANK_ADMIN`） |
| `set_role(p_user_id, p_role)` | teacher / sysadmin | 更正工作账号的角色（仍只有一个）；学生账号不能设置角色；不能改成或改掉 `teacher`（`ONE_BANK_ADMIN`） |
| `reset_password(p_user_id)` | teacher / sysadmin | 把密码恢复为默认密码（`must_change_password` 随之为 `true`），并结束该账号的所有会话 |
| `set_user_disabled(p_user_id, p_disabled)` | teacher / sysadmin | 停用后无法登录（同时设置 `auth.users.banned_until`） |
| `upsert_product(...)`、`stock_in(p_product_id, p_qty, p_note)` | storekeeper / teacher | 入库只增加库存；库存减少只来自兑换 |
| `register_issue(...)` | teacher | 总额由函数按面额计算 |
| `set_setting(p_key, p_value)` | teacher | 按 key 校验取值范围 |
| `deposit_ranking(p_division)` | 学生 | 返回该学部前 N 名（按参数脱敏）与本人名次；`p_division` 为空时取本人所在学部 |
| `app_private.check_balances()` | 定时任务、`dolphin check` | 返回余额、库存与流水汇总不一致的记录，并写 `audit_log`；不经 API 开放 |
| `app_private.create_admin(p_login_id)` | `dolphin create-admin` | 创建银行管理员账号，密码为默认密码；已有银行管理员时拒绝；不经 API 开放。运维员和其他工作账号由银行管理员在后台创建 |

### 6.5 名册导入与账号创建

模板（Excel，第一行为表头）：

| 学号 | 姓名 | 学部 | 学届 | 班号 | 期初余额 |
| --- | --- | --- | --- | --- | --- |
| 必填，唯一 | 必填 | 必填，小学部 / 初中部 | 必填，入学年份，如 2023；须使学生当前处在本学部的年级内 | 必填，1–99 的整数 | 可空，整数 ≥ 0 |

流程：

1. 前端用 SheetJS 读取文件，校验表头、必填项、学号重复、学部（「小学部」「初中部」，提交时转为 `primary` / `junior`）、余额格式，错误行标出行号，全部通过才允许导入。
2. 每 100 行调用一次 `import_roster`，界面显示进度；每批一个事务。函数声明 `set statement_timeout = '60s'`。
3. 新学号：创建 `auth.users` + `auth.identities`、`profiles`、`students`、`accounts`；期初余额 > 0 时写一笔 `opening` 流水；密码为默认密码。
4. 已存在的学号：只更新姓名、学部、学届、班号，不改密码、不重复写期初流水。
5. 导入结束显示「新开户 N 人、更新 M 人」，并提供「打印开户通知单」：按班分页，每张含姓名、班级、学号、默认密码、登录网址，并提示「首次登录后请立即设置新密码」。

账号写入方式：Supabase Auth 不开放注册（`GOTRUE_DISABLE_SIGNUP=true`），账号由 `security definer` 函数直接写入 `auth` schema：

- 登录名映射为内部邮箱：学生 `<学号>@student.dolphin.internal`，工作人员 `<账号>@staff.dolphin.internal`；`email_confirmed_at = now()`。
- 密码 `crypt(p, gen_salt('bf', 10))`；`aud`、`role` 为 `authenticated`；令牌类字段写空串。
- 同时写入 `auth.identities`（`provider = 'email'`）。
- 字段以锁定版本的 Auth 表结构为准，集成测试覆盖「导入 → 默认密码登录 → 设置新密码 → 重置 → 默认密码再登录」。

密码规则：

- 默认密码为 `a12345678`（`app_private.default_password()`）。新账号、`dolphin create-admin` 建的账号、重置后的账号都使用它，`must_change_password` 为 `true`。
- `must_change_password` 为 `true` 时，该账号不具备任何角色，也看不到本人的学生账户，只能读到自己的 `profiles`；前端据此直接进入「设置新密码」页。
- 设置新密码：前端调用 `supabase.auth.updateUser({ password })`。`auth.users` 上的触发器只在 `must_change_password` 为 `true` 时允许修改，且新密码不能是默认密码；修改后 `must_change_password` 变为 `false`。此后本人无法再改密码（Auth 返回错误），忘记或需要更换时由银行管理员或运维员 `reset_password` 恢复为默认密码。
- 新密码至少 8 位，必须同时包含英文字母和数字，所有账号相同。由 Auth 校验（`GOTRUE_PASSWORD_MIN_LENGTH=8`、`GOTRUE_PASSWORD_REQUIRED_CHARACTERS` 要求字母与数字各至少一个），不符合时返回 `weak_password`；前端在提交前给出同样的提示。默认密码 `a12345678` 本身符合这条规则。

### 6.6 读取与 RLS

| 表 | 学生 | 柜员 | 会计 / 银行管理员 | 库管 |
| --- | --- | --- | --- | --- |
| `students` | 本人 | 全部 | 全部 | — |
| `accounts` | 本人 | 全部 | 全部 | — |
| `txns`、`txn_items` | 本人 | 本人办理的当天流水 | 全部 | — |
| `products` | 已上架 | 已上架 | 全部 | 全部 |
| `currency_issues` | — | — | 全部 | — |
| `audit_log` | — | — | 银行管理员 | — |

柜员查询学生用函数 `lookup_student(p_student_no)`，返回学号、姓名、学部、学届、班号、年级、班级名称、余额，以及该生当天已取款合计。运维员可读 `profiles`、`user_roles`、`audit_log` 和 `students`（为学生重置密码时查找学生，不含余额）；会计可读工作账号的 `profiles` 和 `user_roles`（流水里的柜员姓名，按柜员筛选）。

### 6.7 图片存储

- 桶 `product-images`，公开读；写入策略：`storage.objects` 上仅 `storekeeper`、`teacher` 可上传与删除。
- 前端上传前用浏览器自带的 `canvas` 缩放到最长边 800px、JPEG 质量 0.8，文件名为随机 UUID。

---

## 7. 前端

### 7.1 技术栈

| 用途 | 选型 |
| --- | --- |
| 框架 | Expo SDK 58、Expo Router、React DOM、TypeScript；`web.output = "single"`（单页应用，路由全部在前端） |
| 样式 | 设计系统 `components/bundle.css` 与 `tokens.json` 生成的 CSS 变量，原样使用 `dc-` 类名 |
| 数据 | `@supabase/supabase-js`、`@tanstack/react-query` |
| 图标 | 设计系统 `assets/Icons` 的 Lucide 图标，由 `npm run tokens` 生成，内联为 `<svg class="dc-icon">`，颜色跟随文字 |
| 字体 | Nunito Sans 与思源黑体（Noto Sans SC）的可变字体（`@fontsource-variable`，OFL），构建时复制到站点 `/fonts/`，不依赖外部字体服务；中文按 unicode-range 分片，页面只下载用到的字 |
| 离线 | Workbox 生成 Service Worker（预缓存应用外壳与拉丁字体，`/config.js` 网络优先并留存一份）；`idb-keyval` 在 IndexedDB 中存离线队列和名册；Web App Manifest 支持添加到主屏幕。部署新版本后，页面先从旧缓存打开，新的 Service Worker 接管时自动刷新一次；Caddy 对带哈希的 `/_expo/static/*` 设长期缓存，其余静态文件 `no-cache`，每次向服务器确认 |
| Excel | SheetJS 0.20.3（从官方 CDN 发布的 tarball 安装并锁定版本），只在导入名册页按需加载 |
| 测试 | Node 自带的类型擦除运行 `src/lib/*.test.mjs`（单元）、Playwright（端到端，`client/e2e`） |

### 7.2 目录

```
client/
  src/app/                    路由（Expo Router）
    _layout.tsx               设计系统样式、React Query、会话
    index.tsx                 按账号去向跳转（见下）
    login.tsx                 登录页（LoginPage）：学生 / 工作人员分段切换
    change-password.tsx       默认密码登录后设置新密码
    accounts.tsx              本机账号：切换、添加、退出
    student/                  学生端（AppShell）
      index.tsx               问候、余额卡、最近 10 笔
      txns.tsx                明细：全部 / 存入 / 支出，按天分组，分页加载；本月收支
      ranking.tsx             存款排名：本人名次，本学部前 N 名（按参数匿名）
      me.tsx                  我的：年级班级、学届、退出
    counter/                  柜台（AppShell，导航：总览 办理 冲正；进入时打开总览）
      _layout.tsx             柜员准入；联网时把名册缓存到本机
      index.tsx  serve.tsx  reversal.tsx   总览、办理（一位学生连续办理多笔）、冲正
    admin/                    后台（AppShell，导航为总览和本身份可用的各项管理，见 7.9）
      _layout.tsx             后台准入，每项管理只对 4.2 中有权限的身份开放
      index.tsx               总览：管理入口；银行管理员另见最近的余额自检不一致
      students/               学生：查找、详情与重置密码（index、[no]）；导入名册与开户通知单（import）
      staff/                  工作人员：列表、新增账号（new）、身份 / 重置密码 / 停用（[id]）
      products/               商品：列表、新增与编辑、图片、上架、入库（index、[id]）
      txns.tsx  issues.tsx  settings.tsx  audit.tsx   流水查询、发行登记、参数、操作日志
  src/components/             设计系统结构的 React 写法：Shell / Page（AppShell）、Welcome（登录页外观）、
                              Gate（页面准入）、ConfirmSheet / SignOut、BalanceCard、TxnList、Notice、Icon、
                              Desk（后台页面框架）、AccountNotices / OpeningSheet（开户通知单、期初余额核对表的打印内容）
  src/theme/                  tokens.css、bundle.css、icons.ts，均由 npm run tokens 生成
  src/lib/supabase.ts         客户端：与页面同源，anon key 取自 window.__DOLPHIN_CONFIG__；请求带 X-Device-Id
  src/lib/session.tsx         会话、本人资料与角色、去向
  src/lib/accounts.ts         本机记住的账号与会话、切换
  src/lib/format.ts           千分位、带符号金额、时间（当年不写年份）
  src/lib/txns.ts             流水 → TxnList 的标题、图标与方向
  src/lib/cash.ts             面额合计、配钞与找零（贪心）、「10 元 × 2 张」文字
  src/lib/rpc.ts              调用数据库函数：超时（默认 5 秒）视为离线，错误码转为 AppError
  src/lib/counter.ts          柜台调用账务函数、柜台参数、本机名册
  src/lib/roster.ts           名册模板校验（逐行列出问题）与按学届推算年级
  src/lib/students.ts  staff.ts   后台读取学生与工作账号
  src/lib/errors.ts           错误码 → 界面文字（7.6）
  src/lib/online.ts           是否能连上服务器
  src/lib/offline-queue.ts    离线存款队列与名册缓存（IndexedDB）
  src/lib/*.test.mjs          单元测试：npm --prefix client test
  e2e/*.spec.ts               端到端测试（Playwright）：admin（名册与账号）、back-office（流水、发行、参数、日志）、
                              counter（柜台）、products（商品）、student（学生端）；helpers.ts 为登录等公用步骤
  workbox-config.cjs          Service Worker 配置
  public/index.html           页面模板，先加载 /config.js 和 /fonts/fonts.css
  public/logo.png             海豚云标志
  scripts/gen-tokens.mjs      npm run tokens
  scripts/fonts.mjs           npm run web / build 前把字体复制到 public/fonts（不入库）
  metro.config.js             开发时把 API 路径转发到本地容器，前端与 API 同源
```

`src/lib` 只放数据与业务逻辑，不引用 DOM、CSS 和组件，原生客户端可以直接复用。

页面准入（`Gate`）：未登录去登录页，默认密码去设置新密码，无权限回首页。登录后按身份进入：还在用默认密码 → 设置新密码；学生 → 学生端，柜员 → 柜台，会计 / 库管 / 银行管理员 / 运维员 → 后台。每种身份都有一个总览页作为第一项导航：学生是「首页」（余额与最近交易），柜员是柜台「总览」（业务入口与今天本人办理的笔数、金额），后台身份是后台「总览」（本身份可用的管理入口）。

### 7.3 设计系统落地

- `npm run tokens` 从 `design-system/project` 生成三个文件：`tokens.json` → `src/theme/tokens.css`（同名 CSS 变量，以及与字号样式同名的类 `.display`、`.title`、`.heading`、`.amount`、`.body-lg`、`.body`、`.caption`），`components/bundle.css` → `src/theme/bundle.css`（去掉 Google Fonts 引用，其余原样），`assets/Icons/*.svg` → `src/theme/icons.ts`。设计系统改动后重新运行并提交生成的文件。
- 页面按设计系统 README 与页面示例写出相同的 HTML 结构和 `dc-` 类名，外观、动效、三种屏宽的布局都由 `bundle.css` 负责，组件里不写颜色和尺寸。断点用 `.dc-app` 的容器查询。
- 登录、设置新密码、本机账号、账号状态提示都用登录页外观（`Welcome`）；登录后的页面都在 `AppShell` 里：手机底部 `TabBar`，平板图标导航，电脑侧边导航。导航只列出本身份的页面，只有一项时手机上不显示 `TabBar`。
- 退出登录先经 `Sheet` 确认。弹层渲染在 `body` 末尾一个占满视口的 `.dc-app` 里，不受页面容器和进入动画影响。
- 字体：`tokens.json` 的字体顺序不变，前两项换成同一字体的可变字体名（`Nunito Sans Variable`、`Noto Sans SC Variable`），由站点自己提供。
- 金额统一经 `lib/format.ts` 格式化：千分位、单位 `HTB`；收入 `+50`、支出 `−20`（减号 −）；金额字用 Nunito Sans 800、等宽数字。
- 界面文字遵循设计系统「文字与语气」：规范业务用语，结果直接写结果，说明里写清数字和下一步。

### 7.4 本机多账号

一台设备可以登录多个账号并随时切换，例如担任柜员的学生在同一部手机上登录自己的学生账号和柜员账号。

- 每次登录成功，账号（显示名、登录方式、账号）和它的会话记在本机 `localStorage`，同一账号只记一次。当前账号的会话由 supabase-js 保存和续期；切换前把最新会话写回列表，再用目标账号的会话恢复登录，不需要再输密码。
- 「本机账号」页（`/accounts`）列出记住的账号，当前账号标「当前」；点其他账号先弹出「你是 柜员小林 吗？」，确认后切换；「添加账号」打开登录页，登录后加入列表。入口：学生在「我的」，工作人员在标题行右侧。
- 退出登录只结束本机这个会话（`signOut({ scope: 'local' })`），并从列表移除；本机还有其他账号时切换到下一个，没有时回到登录页。
- 「退出全部账号」（本机记住两个以上账号时显示）逐个结束本机所有账号的会话并清空列表，回到登录页；先经 `Sheet` 确认。
- 某个账号的会话已失效（密码被重置、账号被停用，或 7 天未使用）时，切换会失败：该账号从列表移除，提示重新登录。
- 离线队列按柜员账号保存，切换账号不会混用（见 7.7）。

### 7.5 柜台交互

柜员导航三项：**总览**、**办理**、**冲正**。

**总览**：柜员登录后的第一页。业务宫格（存款、取款、兑换打开「办理」并选好对应业务，冲正打开「冲正」页），以及「今天我办理的业务」：存款、取款、兑换各几笔、共多少 HTB（不含已冲正的）。离线时只显示入口。

**办理**：一位学生到柜台办理的全过程，版式按设计系统页面示例 `CounterServicePage`（柜台办理）。

1. **识别学生**：在搜索框（`SearchField`）输入姓名、拼音全拼或首字母（`zxm`）、班级（「四年级1班」）或学号，结果即时列出（姓名、班级、学号）；学号开头的匹配排在前，只有一个结果时按回车直接选中。选中后 `Sheet` 弹出「是 张小明 吗？」和班级、学号，柜员当面核对，点「是，继续办理」读取余额；点「不是」回到搜索。
   - 搜索在本机名册上进行（`lib/search.ts`，拼音由 `pinyin-pro` 生成，姓氏按姓氏读音），联网与离线相同。
2. **办理业务**（同一页，不跳页）：
   - 顶部学生条（`PersonCard` 样式）：姓名、班级与学号、今日还可取金额（账户冻结或毕业时一并注明）、当前余额，右侧「换一位」（还没办业务时）。
   - `Segmented` 选择 存款 / 取款 / 兑换，切换只换下方录入区。
   - 左栏录入：存款每个面额一行「− 张数 +」；取款输入金额，显示配钞方案（如「10 元 × 2 张、5 元 × 1 张」），超出余额、单笔或今日限额时提示原因；兑换选商品（库存为 0 置灰）、调整数量、选付款方式，现金支付时录入收到的各面额张数，显示找零方案。
   - 右栏「办理单」：本次已办的每一笔（名称、面额或付款方式、交易号，金额 `+22` / `−10`，现金兑换写「现金」），正在录入的这笔和办理后余额，底部「结束办理（已办 N 笔）」。手机上办理单在录入区下方。
   - 贴底操作栏只有当前业务的合计和主按钮；超出可取范围时主按钮写明原因并禁用。提交前 `Sheet` 复述「为 张小明 取款 25 HTB」，按钮写「确认取款」。
   - 办完一笔：这笔进入办理单，录入区清空，余额重新读取，可以接着办下一项。
3. **完成**：点「结束办理」（或标题行返回），`display` 字号写「办理完成」和「为 张小明 办理了 N 笔业务，当前余额 …」，下面逐笔列出业务、金额和交易号；按钮「办理下一位」回到第 1 步。一笔都没办时，返回直接回到第 1 步。

查询：学生条里一直显示余额与今日还可取金额。

**冲正**页：列出今天本人办理、还没冲正的全部业务，可按交易号或学号筛选 → 显示原流水 → 选择原因（「其他」须写说明）→「确认冲正」。

配钞与找零使用贪心算法，面额从参数读取；对 1/2/5/10 面额贪心结果即张数最少。

手机上进入「办理业务」（页面有返回按钮）后不显示底部 `TabBar`。

### 7.6 错误码与界面文字

| 错误码 | 标题 | 说明 |
| --- | --- | --- |
| `STUDENT_NOT_FOUND` | 未找到该学号 | 请核对学号后重新输入。 |
| `INSUFFICIENT_BALANCE` | 余额不足 | 可用余额 {balance} HTB，还差 {short} HTB，请减少金额。 |
| `WITHDRAW_SINGLE_LIMIT` | 超过单笔取款限额 | 单笔最多取款 {limit} HTB。 |
| `WITHDRAW_DAILY_LIMIT` | 超过今日取款限额 | 今日还可取款 {remaining} HTB。 |
| `OUT_OF_STOCK` | 已售罄 | {name} 库存不足，请调整数量。 |
| `PRODUCT_UNLISTED` | 商品已下架 | 请重新选择商品。 |
| `CASH_NOT_ENOUGH` | 收款不足 | 应付 {due} HTB，已收 {received} HTB。 |
| `REVERSAL_NOT_ALLOWED` | 不能冲正这笔业务 | 只能冲正本人今天办理的业务，其他情况请联系银行管理员。 |
| `REVERSAL_INSUFFICIENT_BALANCE` | 暂不能冲正 | 当前余额 {balance} HTB，少于原存款金额，请联系银行管理员。 |
| `STUDENT_INACTIVE` | 账户不可办理 | 该账户已冻结或已毕业，请联系银行管理员。 |
| `INVALID_AMOUNT` | 金额有误 | 请输入正整数金额，并使用柜台列出的面额。 |
| `TXN_NOT_FOUND` | 未找到该业务 | 请核对交易号。 |
| `FORBIDDEN` | 没有权限 | 当前账号不能办理这项业务。 |
| `INVALID_INPUT` | 填写有误 | 请检查 {field}（名册导入时为第 {row} 行）。 |
| `ALREADY_EXISTS` | 已存在 | {field} 已被使用。 |
| `ONE_BANK_ADMIN` | 银行管理员只有一个 | 不能新增银行管理员，也不能更改银行管理员的身份。 |
| `USER_NOT_FOUND`、`PRODUCT_NOT_FOUND` | 未找到 | 请刷新后重试。 |
| 网络中断（存款以外） | 网络已断开 | 联网后再办理这项业务；存款可以继续离线登记。 |

### 7.7 离线存款

- 柜员进入柜台时读取名册（学号、姓名、班级）并保存在本机，退出登录时清除；离线时在本机名册上搜索和核对学生。
- 判断离线：`navigator.onLine` 为假，或请求超时（5 秒）/ 网络错误。柜台顶部显示「离线登记」状态条，「办理」里只有存款可选，取款、兑换置灰。联网办理存款时请求没有回应，也按离线登记，用同一个 `p_id` 上传，不会重复入账。
- 离线时只开放存款：「办理」里取款、兑换置灰，「冲正」页显示「需要联网」并提供「去登记存款」。存款记录（含客户端 UUID、面额、学号、柜员 id、设备号、本机时间）写入 IndexedDB，结果页显示「已登记存款 15 HTB，联网后入账」，不显示余额。柜员同时按 SOP 填写纸质凭条。
- 恢复联网后，柜台各页顶部提示「有 N 笔离线存款待上传」，点「上传」按本机时间顺序逐笔调用 `deposit`（`p_offline = true`）。成功一笔删一笔；因幂等，中途断开重传不会重复记账。
- 队列记录了柜员 id：只有同一柜员登录时才能上传，其他人登录时只显示待上传数量和柜员姓名。
- 服务端拒绝的记录（如学号已不存在）保留在队列中并标红，由银行管理员核对纸质凭条后处理。
- 断网时重新打开柜台：Service Worker 提供应用外壳和 `/config.js`，本人资料、柜台参数（面额、限额）和名册都有本机副本，仍可登记存款。前提是这台设备联网打开过一次柜台。

### 7.8 浏览器支持

- 柜台：iPad Safari 16+、Android Chrome 105+（横屏，最小宽度 1024px）。
- 后台：Chrome、Edge 最新两个大版本（最小宽度 1280px，内容最宽 1080px 居中按设计系统）。
- 学生端：iOS Safari 16+、Android Chrome 105+、微信内置浏览器（单列，最小宽度 360px）。
- 这些版本起支持设计系统用到的容器查询和 `:has()`。

### 7.9 后台

后台导航为「总览」和本身份可用的各项管理（4.2）；手机底部 `TabBar` 最多 5 项，其余从总览宫格进入。每页标题行下写当前账号名，右侧只放切换账号；页面自己的操作（导入名册、新增账号、新增商品）放在内容第一行，左边是这一页的计数。数据加载时各页显示与真实布局同形的骨架屏（`components/Skeleton.tsx`），超过 10 秒换成「加载时间比平时长」提示，一页只出一条。读取整个名册时按每页 1000 行分页读取（接口单次最多返回 1000 行，`lib/supabase.ts` 的 `readAll`）。

- **学生**（银行管理员、运维员）：按姓名、拼音、班级或学号查找（同柜台的 `lib/search.ts`），列表注明「未设置密码」和冻结、毕业；可一次打印所有还未设置新密码的学生的开户通知单；银行管理员还可打印期初余额核对表。学生详情显示班级、学届、学号、学部、账户状态、登录状态，「重置密码」经 `Sheet` 确认；银行管理员另见余额和最近 10 笔交易。运维员看不到余额。
- **导入名册**（银行管理员）：选择 Excel 或 CSV → 逐行校验（`lib/roster.ts`，问题按行号列出，全部改好才能导入）→「核对名册」显示各学部人数与期初余额合计 →「确认导入」每 100 人一批并显示进度 → 「导入完成：新开户 N 人，更新 M 人」→「打印开户通知单」。页面提供「下载模板」。某一批被拒绝时，说明哪个学号有问题、前面已导入多少人；改好后重新导入整个名册即可。
- **开户通知单**：浏览器打印，只打印通知单本身；按班分页，每张含姓名、班级、学号、初始密码、登录网址和「首次登录后请立即设置新密码」。
- **期初余额核对表**：同样按班分页，每班一张表，列出学号、姓名、系统期初余额（`opening` 流水金额，没有则为 0），留空「原账本余额」和「一致」两栏，表头写本班人数与合计，表尾留核对人和日期。
- **工作人员**（银行管理员、运维员）：列表显示姓名、身份、账号和停用、未设置密码状态。「新增账号」填写账号、姓名、身份，创建后提示初始密码。账号详情可改身份、重置密码、停用或启用（不能停用自己）。运维员不能创建银行管理员，也不能修改银行管理员的账号，页面显示「由银行管理员管理」。
- **商品**（库管、银行管理员）：列表显示图片、名称、价格、库存和上架状态。编辑页填写名称、价格、成本、分类、图片和是否上架；已有商品另有「入库」（数量、备注）和最近 10 次库存变动。
- **流水**（会计、银行管理员）：按学号、日期范围、类型、柜员组合筛选，最新的在前，每次加载 50 笔，显示符合条件的总笔数；每笔写明业务、学生、柜员、交易号、时间和金额，已冲正的注明。
- **发行**（银行管理员）：登记批次号、发行日期、各面额张数（总额自动合计）、用途、审批人；下方列出已登记的批次。
- **参数**（银行管理员）：面额、两个学部的单笔与单日取款上限、排名人数、升年级日期，「保存参数」一并保存改动的项；「排名匿名」开关切换后立即生效。
- **日志**（银行管理员、运维员）：最新的在前，每次加载 50 条；每条写明操作、操作人、时间、设备与 IP，展开后列出改动的字段（旧值 → 新值）。

### 7.10 学生端

学生导航四项：**首页**、**明细**、**排名**、**我的**。

- **明细**：`Tabs` 全部 / 存入 / 支出，按天分组，每次加载 30 笔，「加载更早的交易」继续；右栏（手机在下方）是本月存入与支出合计。现金兑换不影响余额，不列入明细。
- **排名**：先显示本人名次与余额，再列出本学部前 N 名（名次、姓名、班级、余额），本人一行标「我」；`ranking_anonymous` 为真时姓名显示为「张*明」。

---

## 8. 开发环境

### 8.1 前置

- Node.js LTS、Docker Desktop。

### 8.2 仓库结构

```
client/                 Expo 前端
supabase/
  migrations/           数据库迁移（开发与生产共用）
  tests/                pgTAP 测试（`helpers/setup.psql` 为公用辅助）
  seed.sql              开发种子数据（银行管理员、柜员、三名学生、商品与几笔交易；密码均为默认密码）
docker/
  Dockerfile            多阶段构建，开头 ARG 锁定组件版本
  smoke-test.sh         单容器冒烟测试（M0）
  db-test.sh            在镜像上运行 supabase/tests 的 pgTAP 测试（M1）
  perf-test.sh          全校规模（2000 名学生、10 万笔流水）的性能与越权修改检查
  Caddyfile
  supervisord.conf
  init/                 首次初始化：Supabase 所需角色与 schema
  bin/                  入口脚本、迁移执行、定时备份、运维命令 dolphin（见 9.3）
docs/
design-system/
```

### 8.3 常用命令

本地开发用正式镜像起一个后端容器，再用 Metro 开发服务器跑前端；Metro 把 `/auth`、`/rest`、`/storage`、`/config.js` 转发给容器，前端与 API 同源，与生产一致。

```bash
docker build -f docker/Dockerfile -t dolphin-cloud:dev .
```

```bash
docker run -d --name dolphin-dev -e DOLPHIN_DOMAIN=localhost -p 127.0.0.1:18444:443 -v dolphin-dev-data:/data dolphin-cloud:dev
```

```bash
docker exec -i dolphin-dev psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/seed.sql
```

```bash
npm --prefix client run web
```

```bash
docker/db-test.sh
```

```bash
docker/smoke-test.sh
```

```bash
docker/e2e-test.sh
```

`e2e-test.sh` 用镜像起一个新容器（`https://localhost:18445`），导入种子数据后运行 `client/e2e` 的 Playwright 测试，结束后删除容器和数据卷；首次运行前执行一次 `npx --prefix client playwright install chromium`。

前端检查：`npm --prefix client run typecheck`、`npm --prefix client test`。生产镜像使用官方 Postgres，迁移中只使用 Postgres 自带扩展（`pgcrypto`、`dblink` 仅测试用），不依赖 Supabase 托管版独有扩展。

### 8.4 规范

- TypeScript `strict`；ESLint + Prettier 使用 Expo 默认配置。
- 数据库对象用英文蛇形命名；界面文字只写在组件和 `errors.ts` 中，统一中文。
- 每个迁移配对应的 pgTAP 测试；改动账务函数必须补充测试。
- 提交信息用英文祈使句，一次提交一件事。

---

## 9. 部署与运维

### 9.1 镜像构建

`docker/Dockerfile` 多阶段构建：

1. `client`：`node` 镜像中 `npm ci && npm run build`（复制字体、`expo export -p web`、`workbox generateSW` 生成 `sw.js`），产物复制到最终镜像的 `/srv/www`。
2. `storage`：把官方 Storage 镜像（Alpine）中的 `/app` 复制到 `node:24-bookworm-slim`，为 glibc 重新编译其中唯一的原生模块 `fs-xattr`。
3. 最终阶段基于 `postgres:17-bookworm`：复制 Auth、PostgREST、Caddy 二进制，Storage 与 Node 运行时，前端静态文件，迁移文件，`init/`、`bin/`；安装 supervisord。

镜像推送到 GitHub Container Registry（`ghcr.io/hy916-cn/dolphin-cloud`）：CI 在 `main` 每次通过后推送 `main` 与 `sha-<7 位提交号>`，正式发布时另打语义化版本标签（如 `1.0.0`）。

### 9.2 启动

```bash
docker run -d --name dolphin-cloud --restart unless-stopped -p 80:80 -p 443:443 -v dolphin-data:/data -e DOLPHIN_DOMAIN=bank.example.edu.cn -e ACME_EMAIL=it@example.edu.cn ghcr.io/hy916-cn/dolphin-cloud:1.0.0
```

入口脚本顺序：

1. 首次启动：初始化数据库，执行 `init/`（创建 `anon`、`authenticated`、`service_role`、`authenticator`、`supabase_auth_admin`、`supabase_storage_admin` 等角色与 `auth`、`storage` schema），生成密钥。
2. 每次启动：若数据库已有数据且镜像版本变化，先做一次升级前备份；Postgres 就绪后依次启动 Auth、Storage（各自执行内置迁移），执行 `supabase/migrations/` 中未应用的迁移（记录在 `app_migrations` 表），再启动 PostgREST 与 Caddy。
3. 生成 `/config.js`，内容为站点地址与 anon key。

首次启动后创建第一个银行管理员账号（默认密码登录后设置新密码）：

```bash
docker exec -it dolphin-cloud dolphin create-admin admin
```

### 9.3 运维命令

| 命令 | 作用 |
| --- | --- |
| `dolphin create-admin <账号>` | 创建银行管理员账号（全系统一个），密码为默认密码 |
| `dolphin reset-admin` | 银行管理员忘记密码时，把它恢复为默认密码并解除停用，下次登录设置新密码 |
| `dolphin backup` | 立即备份 |
| `dolphin backups` | 列出备份文件 |
| `dolphin restore <文件名>` | 恢复指定备份：停止 API 进程 → 恢复数据库与图片 → 启动；恢复前自动再备份一次当前数据 |
| `dolphin check` | 运行 `app_private.check_balances()` 并输出结果；有不一致时退出码为 1 |
| `dolphin status` | 各进程状态、版本、最近一次备份时间 |

### 9.4 备份

- 每天 `BACKUP_TIME` 执行：`pg_dump -Fc` 全库 + `/data/storage` 打包为 `/data/backups/dolphin-YYYYMMDD-HHMM.tar.gz`，保留 `BACKUP_RETENTION_DAYS` 天。
- 备份后运行 `dolphin check`；发现不一致时写入 `audit_log`，后台首页对银行管理员显示提示。
- 建议把 `/data/backups` 单独挂载到另一块磁盘或 NAS：`-v /mnt/nas/dolphin-backups:/data/backups`。
- 每学期末把当期备份复制归档一次，并在测试机上演练一次 `dolphin restore`。

### 9.5 升级

1. 拉取新版本镜像。
2. `docker stop dolphin-cloud && docker rm dolphin-cloud`。
3. 用同样的参数和数据卷以新标签启动；入口脚本自动备份并执行迁移。
4. 回滚：用旧标签启动，并 `dolphin restore` 升级前的备份。

升级安排在非营业时段进行。

### 9.6 安全

- 只开放 80/443；Postgres、各 API 端口只监听 `127.0.0.1`。
- Caddy 设置 HSTS、`X-Content-Type-Options`、`Referrer-Policy`、CSP（只允许同源脚本）。
- Auth 关闭注册与邮件发送；访问令牌有效期 1 小时，刷新令牌 7 天未使用即失效。
- 学校出口 NAT 时所有校内设备共用一个公网 IP：Auth 的登录限速按 IP 计算，需将 `GOTRUE_RATE_LIMIT_TOKEN_REFRESH`、`GOTRUE_RATE_LIMIT_VERIFY` 等调到能容纳全校同时登录的水平，并让 Auth 信任 Caddy 传入的 `X-Forwarded-For`。
- 默认密码人人知道：开户或重置后，知道学号的人可能抢先登录并设置密码，因此通知学生尽快登录；本人发现无法登录时由银行管理员重置。服务在公网可访问，上线后关注 `audit_log` 与 Auth 日志中的连续登录失败，必要时在 Caddy 前加 IP 黑名单。
- 不采集身份证号、家庭住址、家长信息。

---

## 10. 测试

| 层级 | 工具 | 覆盖内容 |
| --- | --- | --- |
| 数据库 | pgTAP（`supabase/tests/`） | 每个函数的角色校验；禁止透支；单笔 / 单日限额；每个账号一种身份；幂等重复提交；库存不足与并发兑换（两个会话同时买最后一件，只有一个成功）；冲正的四条规则；流水不可删改；`check_balances()` 能发现人为制造的不一致；导入重复学号不重复开户。运行：`docker/db-test.sh [镜像]`，在临时容器中逐个执行 `supabase/tests/*.sql` |
| 前端单元 | `npm --prefix client test` | `cash.ts` 合计、配钞与找零；`search.ts` 按学号、姓名、拼音、首字母、班级搜索与排序；离线队列按柜员、按时间上传，失败保留并标记，断网停止；`format.ts` 金额与时间；`roster.ts` 名册模板逐行校验与年级推算 |
| 端到端 | Playwright（`docker/e2e-test.sh`），对构建好的生产镜像运行 | 柜员存款、取款、账户兑换、现金兑换、冲正 → 学生看到余额与明细；离线存款后恢复网络上传；断网重新打开柜台；银行管理员导入名册（含逐行报错）→ 新学生首次登录设置新密码 → 银行管理员重置密码；新增工作账号、改身份、停用，运维员不能管理银行管理员；商品新增、入库、上下架；流水筛选、发行登记、参数开关、日志；学生明细与排名。备份恢复由 `smoke-test.sh` 覆盖 |
| 性能 | `docker/perf-test.sh`：新容器经 `import_roster` 导入 2000 名学生、写入 10 万笔流水后计时，并以各身份直接请求修改余额、库存和流水 | 2000 名学生、10 万笔流水下：账务函数 < 1 秒，学生首页 < 2 秒；直接修改全部被拒，`dolphin check` 一致 |

CI（GitHub Actions，`.github/workflows/ci.yml`）：每次推送和每个 PR 先运行类型检查与单元测试，再构建镜像，在镜像上运行 `docker/db-test.sh` 与 `docker/e2e-test.sh`；端到端测试失败时上传 Playwright 结果。推送到 `main` 且全部通过后，把镜像推送到 GHCR（见 9.1）。

---

## 11. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| M0 技术验证 | 单容器镜像：Postgres + Auth + PostgREST + Storage + Caddy；入口脚本与 `config.js`；SQL 创建账号 | `docker/smoke-test.sh` 全部通过：经 HTTPS 登录、调用 RPC、上传并公开读取图片；`dolphin backup` → 改动 → `restore` 恢复到备份时状态；容器重启后数据完整 |
| M1 数据与账务核心 | 全部表、RLS、账务与管理函数、冲正、审计、`check_balances()`；运维命令 `dolphin create-admin`、`dolphin check` | `docker/db-test.sh` 全部通过 |
| M2 前端基础 | 设计系统样式与图标接入、AppShell、登录与设置新密码、按角色进入 | 页面与设计系统页面示例在手机、平板、电脑三种宽度下一致；登录与设置新密码在 375×667 一屏放下 |
| M3 柜台 | 存款、取款、兑换、查询、冲正、离线存款 | 柜台相关端到端测试通过；单笔办理 ≤ 1 分钟（由学生柜员试用计时） |
| M4 后台与学生端 | 名册导入与开户通知单、账号角色、商品与入库、发行登记、流水查询、参数、日志；学生首页、明细、排名 | 全部端到端测试通过 |
| M5 上线 | 正式服务器部署、迁入现有账本、柜员培训、试运行 | 第 12 节验收全部通过 |

M0 是后续工作的前提，先完成并确认单容器方案可行，再进入 M1。

---

## 12. 上线与验收

### 12.1 上线步骤

1. 在正式服务器部署镜像，配置域名与证书，用 `dolphin create-admin` 创建银行管理员账号，再由银行管理员在后台创建运维员账号。
2. 银行管理员把现有 Excel 账本整理进导入模板（期初余额取账本当日余额），导入后打印「期初余额核对表」，与原账本逐人核对。
3. 打印开户通知单，按班发放；为柜员、会计、库管分别创建工作账号。
4. 库管录入文创商品与库存。
5. 柜员用测试账号练习（开发种子数据或单独的测试环境）。
6. 试运行一周：全部业务在系统中办理，同时按 SOP 填写纸质凭条，银行管理员每天抽查；无问题后停用 Excel 账本。

### 12.2 验收标准

- [ ] 柜台总览一屏内显示存款、取款、兑换、冲正入口，任一业务点击不超过 2 层即进入办理；确认学生后余额与今日还可取金额一直可见。
- [ ] 找到并确认一位学生后，可以连续办理多项业务，不用重新查找；结束时列出本次办理的全部业务和交易号。
- [ ] 按姓名、拼音首字母、班级或学号都能搜到学生；选中后先确认「是 xxx 吗？」，再显示姓名、班级、余额。
- [ ] 余额不足时取款和账户兑换无法提交，并显示可用余额与差额。
- [ ] 取款超过单笔或单日限额时无法提交，并显示限额或今日剩余额度。
- [ ] 账户兑换成功后，余额、库存、流水同时更新；任一项失败则都不变。两台设备同时兑换最后一件商品，只有一笔成功，另一笔提示「已售罄」。
- [ ] 现金兑换显示应付、已收和找零方案，账户余额不变。
- [ ] 存款、取款、兑换成功后显示大字结果与交易号。
- [ ] 同一笔业务因网络重试重复提交，只记一次账。
- [ ] 柜员能冲正本人当天办理的业务，冲正后余额与库存恢复，原流水显示「已冲正」；柜员无法冲正他人或往日的业务，银行管理员可以。
- [ ] 每个账号只有一种身份：学生账号没有工作角色，工作账号只有一个角色。
- [ ] 同一台设备登录学生账号和柜员账号后，确认「你是 xxx 吗？」即可来回切换，不输密码；退出一个账号不影响其他账号。
- [ ] 每种身份登录后先看到自己的总览页。
- [ ] 断网时柜台可登记存款，其他业务禁用并说明原因；恢复网络后上传，系统流水与纸质凭条一致。
- [ ] 学生登录后 2 秒内看到余额和最近 10 笔交易；只能看到本人数据。
- [ ] 名册导入后每位学生可用默认密码登录，登录后必须设置新密码；之后本人无法再改，重置后恢复默认密码。
- [ ] 现有 Excel 账本余额迁入后，与原账本逐人核对一致。
- [ ] 任何角色都无法直接修改余额、库存或删除流水（通过 API 直接请求也被拒绝）。
- [ ] 所有业务与管理操作在操作日志中可查到操作人、时间、设备。
- [ ] 每日自动备份生成，`dolphin restore` 能把数据恢复到备份时状态。
- [ ] 容器重启、升级后数据完整，证书自动续期。
