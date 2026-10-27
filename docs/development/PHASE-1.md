# 海豚云 · 第一阶段开发文档

> 依据：[分阶段产品文档](../product/PRODUCT.md) 第 4 节「阶段一：柜台上线，替代 Excel 账本」、[功能需求 3.0](../requirements/REQUIREMENTS.md)、[海豚云设计系统](../../design-system/project/README.md)
>
> 本文说明第一阶段「怎么做」：技术架构、数据模型、接口、前端结构、部署与运维、测试与里程碑。产品范围以产品文档为准，两者不一致时先改产品文档再改本文。

---

## 1. 范围

### 1.1 本阶段交付

| 模块 | 交付内容 |
| --- | --- |
| 登录 | 学生用学号 + 密码登录；工作人员用账号 + 密码登录；首次登录强制改密码 |
| 开户 | 指导老师按模板导入名册，批量开户并迁入期初余额；生成随机初始密码，按班打印开户通知单 |
| 学生端 | 余额、最近 10 笔交易、全部明细（分页）、存款排名（默认匿名）、修改密码 |
| 柜台 | 存款、取款、兑换文创、查询、冲正；输入学号后核对姓名与班级再办理 |
| 离线登记 | 断网时只允许登记存款，本机暂存，恢复后补传；纸质凭条兜底 |
| 文创商城 | 商品新增、编辑、图片、价格、上架 / 下架、入库（增加库存） |
| 货币发行 | 发行批次登记 |
| 流水查询 | 会计与老师按学生、日期、类型、柜员组合查询全部流水 |
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
| 前端 | Expo + React Native + Expo Router，TypeScript，第一阶段只发布 Web | 柜台平板、后台电脑、学生手机都用浏览器访问；保留 React Native 写法，阶段三可直接出家长端、教师端原生 App |
| 后端 | 自托管 Supabase 组件：Postgres、Auth（GoTrue）、PostgREST、Storage | 业务规则全部写在 Postgres 函数（RPC）里，前端只调用函数，不直接写表 |
| 部署 | 单容器：Caddy + Postgres + Auth + PostgREST + Storage，由 supervisord 管理 | 一个镜像、一个数据卷；不含 Studio、Realtime、Edge Functions |
| 网络 | 校内服务器，公网域名（已备案）+ 内网均可访问 | Caddy 自动申请并续期 Let's Encrypt 证书 |
| 身份识别 | 柜员输入学号，系统显示姓名、班级供核对 | 胸卡扫码在后续阶段加入，届时只是多一种输入学号的方式 |
| 兑换付款 | 支持「账户扣款」和「现金支付」 | 现金支付按收到的面额计算找零，账户余额不变 |
| 离线 | 只允许存款 | 存款不会透支，补传后服务端照常校验 |
| 对账 | 本阶段不设班次、不做轧账 | 流水记录柜员、设备和时间，并预留 `cash_delta` 字段，便于以后按柜员汇总现金 |
| 更正 | 冲正 | 柜员可冲正本人当天办理的业务；指导老师可冲正任意业务；原流水保留并标记「已冲正」 |
| 初始密码 | 随机 6 位数字，开户通知单发放 | 密码只在导入完成时显示一次，系统不保存明文 |
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
| `DOLPHIN_DOMAIN` | 是 | — | 公网域名，如 `bank.example.edu.cn`；Caddy 据此申请证书 |
| `ACME_EMAIL` | 是 | — | 证书到期通知邮箱 |
| `TZ` | 否 | `Asia/Shanghai` | 容器时区；数据库内时间统一存 `timestamptz` |
| `BACKUP_TIME` | 否 | `02:00` | 每日备份时间 |
| `BACKUP_RETENTION_DAYS` | 否 | `30` | 备份保留天数 |

数据库密码、`JWT_SECRET`、anon key、service_role key 在首次启动时自动生成，保存在 `/data/secrets/`（权限 600）。service_role key 只在容器内部供 Storage 和运维脚本使用，不写入 `/config.js`。

---

## 4. 角色与权限

### 4.1 角色

一个账号可以有多个角色。担任柜员的学生既有自己的学生账户，也有 `teller` 角色。

| 角色代码 | 名称 | 登录方式 |
| --- | --- | --- |
| （学生账户） | 学生 | 学号 + 密码 |
| `teller` | 柜员 | 本人学号或工作账号 + 密码 |
| `accountant` | 会计 | 同上 |
| `storekeeper` | 库管 | 同上 |
| `teacher` | 指导老师 | 工作账号 + 密码 |
| `sysadmin` | 系统管理员 | 工作账号 + 密码 |

### 4.2 权限矩阵

| 操作 | 学生 | 柜员 | 会计 | 库管 | 指导老师 | 系统管理员 |
| --- | --- | --- | --- | --- | --- | --- |
| 查看本人余额、明细、排名 | ✓ | ✓ | ✓ | ✓ | — | — |
| 修改本人密码 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 存款、取款、兑换、查询学生 | | ✓ | | | | |
| 冲正本人当天业务 | | ✓ | | | | |
| 冲正任意业务 | | | | | ✓ | |
| 查看全部流水 | | | ✓ | | ✓ | |
| 商品管理、入库 | | | | ✓ | ✓ | |
| 发行登记 | | | | | ✓ | |
| 导入名册、开户 | | | | | ✓ | |
| 管理工作账号与角色 | | | | | ✓ | ✓ |
| 重置学生密码 | | | | | ✓ | ✓ |
| 参数设置 | | | | | ✓ | |
| 查看操作日志 | | | | | ✓ | ✓ |
| 备份与恢复（命令行） | | | | | | ✓ |

硬性约束：

- 柜员不能为本人的学生账户办理任何业务。
- 任何角色都不能直接修改余额、库存或删除流水；这些只能由第 6 节的函数在事务中产生。
- 系统管理员不能办理业务、不能修改业务数据。

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
  grade      text not null,                    -- 年级，如「四年级」
  class_name text not null,                    -- 班级，如「4班」
  cohort     text,                             -- 入学届，可空
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

### 5.3 参数

| key | 默认值 | 说明 |
| --- | --- | --- |
| `denominations` | `[1,2,5,10]` | 面额（元），柜台按此显示张数输入 |
| `withdraw_single_limit` | `200` | 单笔取款上限 |
| `withdraw_daily_limit` | `500` | 单日累计取款上限（不含已冲正） |
| `ranking_anonymous` | `true` | 排名是否隐藏姓名（显示为「张*明」） |
| `ranking_size` | `10` | 排名显示前几名 |

### 5.4 数据不变式

1. `accounts.balance = sum(txns.balance_delta)`（按学生），由函数在同一事务内维护；`check_balances()` 每天复核一次。
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
- 出错时 `raise exception` 使用固定错误码（`message`），附带 `detail`（JSON），前端按第 7.5 节转成界面文字。

### 6.2 账务函数

| 函数 | 角色 | 参数 | 规则 |
| --- | --- | --- | --- |
| `deposit` | teller | `p_id, p_student_no, p_denominations, p_offline, p_client_created_at` | 金额 = Σ面额 × 张数，> 0；`balance_delta = cash_delta = +金额` |
| `withdraw` | teller | `p_id, p_student_no, p_amount` | 整数 > 0；≤ 单笔上限；当天累计 ≤ 单日上限；≤ 余额；`balance_delta = cash_delta = −金额` |
| `purchase` | teller | `p_id, p_student_no, p_items [{product_id, qty}], p_payment, p_cash_received` | 商品须已上架且库存足够；账户扣款时金额 ≤ 余额，`balance_delta = −金额`，`cash_delta = 0`；现金支付时收到金额 ≥ 应付，`balance_delta = 0`，`cash_delta = +金额`，记录找零；扣库存并写 `stock_movements` |
| `reverse_txn` | teller / teacher | `p_id, p_original_id, p_reason` | 见 6.3 |

公共校验：学生存在且 `status = 'normal'`；学生账户不属于当前操作人。

返回值统一为 `{ txn_no, type, amount, balance_after, change_given }`，前端据此显示结果页。

### 6.3 冲正规则

- 可冲正的类型：`deposit`、`withdraw`、`purchase`；指导老师另可冲正 `opening`。
- 柜员只能冲正本人办理、当天发生、状态为 `normal` 的流水；指导老师不受「本人」和「当天」限制。
- 冲正生成一笔 `reversal` 流水：`amount` 同原流水，`balance_delta`、`cash_delta` 取原值的相反数；兑换冲正同时把商品数量加回库存（`stock_movements.kind = 'reversal'`）。
- 原流水 `status` 改为 `reversed`，两笔流水互相可查。
- 冲正存款时，若当前余额小于原存款金额，拦截并返回 `REVERSAL_INSUFFICIENT_BALANCE`，由指导老师线下处理后再冲正。
- 原因必选：金额录错、学号录错、业务选错、其他（「其他」须填写说明）。

### 6.4 管理函数

| 函数 | 角色 | 说明 |
| --- | --- | --- |
| `import_roster(p_rows)` | teacher | 见 6.5 |
| `create_staff(p_login_id, p_name, p_roles)` | teacher / sysadmin | 创建工作账号，返回一次性初始密码（随机 8 位） |
| `set_roles(p_user_id, p_roles)` | teacher / sysadmin | 系统管理员不能授予或收回 `teacher` |
| `reset_password(p_user_id)` | teacher / sysadmin | 生成新随机密码并返回一次，设置 `must_change_password = true` |
| `set_user_disabled(p_user_id, p_disabled)` | teacher / sysadmin | 停用后无法登录（同时设置 `auth.users.banned_until`） |
| `upsert_product(...)`、`stock_in(p_product_id, p_qty, p_note)` | storekeeper / teacher | 入库只增加库存；库存减少只来自兑换 |
| `register_issue(...)` | teacher | 总额由函数按面额计算 |
| `set_setting(p_key, p_value)` | teacher | 按 key 校验取值范围 |
| `deposit_ranking()` | 学生 | 返回前 N 名（按参数脱敏）与本人名次 |
| `check_balances()` | 定时任务 | 返回余额、库存与流水汇总不一致的记录，并写 `audit_log` |

### 6.5 名册导入与账号创建

模板（Excel，第一行为表头）：

| 学号 | 姓名 | 年级 | 班级 | 入学届 | 期初余额 |
| --- | --- | --- | --- | --- | --- |
| 必填，唯一 | 必填 | 必填 | 必填 | 可空 | 可空，整数 ≥ 0 |

流程：

1. 前端用 SheetJS 读取文件，校验表头、必填项、学号重复、余额格式，错误行标出行号，全部通过才允许导入。
2. 每 100 行调用一次 `import_roster`，界面显示进度；每批一个事务。函数声明 `set statement_timeout = '60s'`。
3. 新学号：创建 `auth.users` + `auth.identities`、`profiles`、`students`、`accounts`；期初余额 > 0 时写一笔 `opening` 流水；生成随机 6 位数字密码（pgcrypto `gen_random_bytes`）。
4. 已存在的学号：只更新姓名、年级、班级、入学届，不改密码、不重复写期初流水。
5. 导入结束显示「新开户 N 人、更新 M 人」，并提供「打印开户通知单」：按班分页，每张含姓名、班级、学号、初始密码、登录网址。离开页面后初始密码不再可见，补发只能重置密码。

账号写入方式：Supabase Auth 不开放注册（`GOTRUE_DISABLE_SIGNUP=true`），账号由 `security definer` 函数直接写入 `auth` schema：

- 登录名映射为内部邮箱：学生 `<学号>@student.dolphin.internal`，工作人员 `<账号>@staff.dolphin.internal`；`email_confirmed_at = now()`。
- 密码 `crypt(p, gen_salt('bf', 10))`；`aud`、`role` 为 `authenticated`；令牌类字段写空串。
- 同时写入 `auth.identities`（`provider = 'email'`）。
- 字段以锁定版本的 Auth 表结构为准，集成测试覆盖「导入 → 登录 → 改密码 → 重置 → 再登录」。

修改密码：前端调用 `supabase.auth.updateUser({ password })`；`auth.users` 上的触发器在密码变更时把 `must_change_password` 置为 `false`（`reset_password` 在写入新密码后再把它置回 `true`）。学生密码至少 6 位，工作账号至少 8 位。

### 6.6 读取与 RLS

| 表 | 学生 | 柜员 | 会计 / 指导老师 | 库管 |
| --- | --- | --- | --- | --- |
| `students`、`accounts` | 本人 | 全部 | 全部 | — |
| `txns`、`txn_items` | 本人 | 本人办理的当天流水 | 全部 | — |
| `products` | 已上架 | 已上架 | 全部 | 全部 |
| `currency_issues` | — | — | 全部 | — |
| `audit_log` | — | — | 指导老师 | — |

柜员查询学生用函数 `lookup_student(p_student_no)`，返回学号、姓名、年级、班级、余额，以及该生当天已取款合计。系统管理员可读 `profiles`、`user_roles`、`audit_log`。

### 6.7 图片存储

- 桶 `product-images`，公开读；写入策略：`storage.objects` 上仅 `storekeeper`、`teacher` 可上传与删除。
- 前端上传前用 `expo-image-manipulator` 缩放到最长边 800px、JPEG 质量 0.8。

---

## 7. 前端

### 7.1 技术栈

| 用途 | 选型 |
| --- | --- |
| 框架 | Expo（开工时的最新稳定 SDK）、Expo Router、TypeScript；`web.output = "single"` |
| 数据 | `@supabase/supabase-js`、`@tanstack/react-query` |
| 图标 | `lucide-react-native` + `react-native-svg` |
| 字体 | `@expo-google-fonts/nunito-sans`（随站点打包，不依赖外部字体服务）；中文使用系统字体（苹方 / 微软雅黑 / 思源黑体） |
| 离线 | Workbox 生成 Service Worker（缓存应用外壳）；`idb-keyval` 存离线队列 |
| Excel | SheetJS（从官方 CDN 发布的 tarball 安装并锁定版本） |
| 测试 | `jest-expo`（单元）、Playwright（端到端） |

### 7.2 目录

```
client/
  app/
    _layout.tsx               会话、主题、Service Worker 注册
    login.tsx                 学生登录 / 工作人员登录两个标签
    change-password.tsx       首次登录强制改密码
    (student)/                学生端（手机单列 + 底部 TabBar）
      index.tsx               余额卡 + 最近 10 笔
      txns.tsx                全部明细
      ranking.tsx             存款排名
      me.tsx                  我的：修改密码、退出
    (counter)/                柜台（平板横屏）
      index.tsx               业务宫格：存款 取款 兑换 查询 冲正
      deposit.tsx  withdraw.tsx  shop.tsx  lookup.tsx  reversal.tsx
      offline.tsx             离线待上传
    (admin)/                  后台（电脑浏览器，左侧导航）
      students/  staff/  products/  issues/  txns/  settings/  audit/
  src/
    components/               按设计系统实现的 RN 组件
    theme/tokens.ts           由 design-system/project/tokens.json 生成
    lib/supabase.ts           客户端，读取 window.__DOLPHIN_CONFIG__
    lib/cash.ts               面额合计、配钞、找零（纯函数）
    lib/offline-queue.ts      离线存款队列
    lib/errors.ts             错误码 → 界面文字
  scripts/gen-tokens.ts       npm run tokens
```

登录后按角色进入：只有学生账户 → 学生端；有工作角色 → 选择「工作台」或「我的账户」，工作台按角色显示柜台或后台入口。

### 7.3 设计系统落地

- `npm run tokens` 把 `tokens.json` 的颜色、字号、间距、圆角、阴影生成为 `src/theme/tokens.ts`，组件只引用 token，不写死数值。
- 设计系统的 `dc-` 组件（Button、ServiceTile、BalanceCard、TxnList、GuideBubble、Steps、Field、Tag、Notice、TabBar、WaveDivider）在 `src/components/` 中用 React Native 组件实现，结构与各组件 README 一致，以 `preview.html` 作为视觉对照。厚底阴影用底部实色块实现，按下时下移 3～4px。
- 金额统一用 `Amount` 组件：Nunito Sans 800、等宽数字、千分位、单位 `HTB`；收入 `+50`、支出 `−20`。
- 界面文字遵循设计系统「文字与语气」：规范业务用语，结果直接写结果，说明里写清数字和下一步。

### 7.4 柜台交互

所有业务都是同一个步骤结构，用 `Steps` 显示进度：

1. **输入学号**：大号数字键盘；输入完成后显示姓名、班级、余额，柜员核对后点「下一步」。
2. **办理**
   - 存款：每个面额一行「− 张数 +」，下方实时显示合计。
   - 取款：输入金额；显示配钞方案（如「10 元 × 2 张、5 元 × 1 张」）、可用余额、今日还可取金额。
   - 兑换：商品宫格（图片、名称、价格、库存，库存为 0 置灰）→ 购物车 → 选择付款方式；现金支付时录入收到的各面额张数，显示找零方案。
3. **确认**：弹层大字复述「为 张小明 取款 25 HTB」，按钮写「确认取款」。
4. **结果**：`display` 字号写「取款成功」，下方「取款 25 HTB，当前余额 43 HTB」和交易号；按钮「办理下一位」回到第 1 步。

配钞与找零使用贪心算法，面额从参数读取；对 1/2/5/10 面额贪心结果即张数最少。

冲正：输入交易号或从「今天我办理的业务」列表中选择 → 显示原流水 → 选择原因 → 「确认冲正」。

### 7.5 错误码与界面文字

| 错误码 | 标题 | 说明 |
| --- | --- | --- |
| `STUDENT_NOT_FOUND` | 未找到该学号 | 请核对学号后重新输入。 |
| `SELF_SERVICE_FORBIDDEN` | 不能为本人办理 | 请由其他柜员为你办理。 |
| `INSUFFICIENT_BALANCE` | 余额不足 | 可用余额 {balance} HTB，还差 {short} HTB，请减少金额。 |
| `WITHDRAW_SINGLE_LIMIT` | 超过单笔取款限额 | 单笔最多取款 {limit} HTB。 |
| `WITHDRAW_DAILY_LIMIT` | 超过今日取款限额 | 今日还可取款 {remaining} HTB。 |
| `OUT_OF_STOCK` | 已售罄 | {name} 库存不足，请调整数量。 |
| `PRODUCT_UNLISTED` | 商品已下架 | 请重新选择商品。 |
| `CASH_NOT_ENOUGH` | 收款不足 | 应付 {due} HTB，已收 {received} HTB。 |
| `REVERSAL_NOT_ALLOWED` | 不能冲正这笔业务 | 只能冲正本人今天办理的业务，其他情况请联系指导老师。 |
| `REVERSAL_INSUFFICIENT_BALANCE` | 暂不能冲正 | 当前余额 {balance} HTB，少于原存款金额，请联系指导老师。 |
| 网络中断（存款以外） | 网络已断开 | 联网后再办理这项业务；存款可以继续离线登记。 |

### 7.6 离线存款

- 柜员登录时缓存名册（学号、姓名、班级），退出登录时清除；离线状态下输入学号仍能核对姓名与班级。
- 判断离线：`navigator.onLine` 为假，或请求超时（5 秒）/ 网络错误。柜台顶部显示「离线登记」状态条。
- 离线时只开放「存款」，其他入口禁用并写明原因。存款记录（含客户端 UUID、面额、学号、柜员 id、设备号、本机时间）写入 IndexedDB，结果页显示「已登记存款 15 HTB，联网后入账」，不显示余额。柜员同时按 SOP 填写纸质凭条。
- 恢复联网后，柜台首页提示「有 N 笔离线存款待上传」，点「上传」按本机时间顺序逐笔调用 `deposit`（`p_offline = true`）。成功一笔删一笔；因幂等，中途断开重传不会重复记账。
- 队列记录了柜员 id：只有同一柜员登录时才能上传，其他人登录时只显示待上传数量和柜员姓名。
- 服务端拒绝的记录（如学号已不存在）保留在队列中并标红，由指导老师核对纸质凭条后处理。

### 7.7 浏览器支持

- 柜台：iPad Safari 16+、Android Chrome（横屏，最小宽度 1024px）。
- 后台：Chrome、Edge 最新两个大版本（最小宽度 1280px，内容最宽 1080px 居中按设计系统）。
- 学生端：iOS Safari 16+、Android Chrome、微信内置浏览器（单列，最小宽度 360px）。

---

## 8. 开发环境

### 8.1 前置

- Node.js LTS、Docker Desktop、Supabase CLI。

### 8.2 仓库结构

```
client/                 Expo 前端
supabase/
  config.toml           本地开发用 Supabase 配置
  migrations/           数据库迁移（开发与生产共用）
  tests/                pgTAP 测试
  seed.sql              开发种子数据（示例学生、商品、各角色账号）
docker/
  Dockerfile            多阶段构建，开头 ARG 锁定组件版本
  smoke-test.sh         单容器冒烟测试（M0）
  Caddyfile
  supervisord.conf
  init/                 首次初始化：Supabase 所需角色与 schema
  bin/                  入口脚本、迁移执行、定时备份、运维命令 dolphin（见 9.3）
  www/                  前端构建产物接入前的占位页
docs/
design-system/
```

### 8.3 常用命令

```bash
supabase start
```

```bash
supabase db reset
```

```bash
supabase test db
```

```bash
cd client && npm run web
```

```bash
docker build -f docker/Dockerfile -t dolphin-cloud:dev .
```

本地开发使用 Supabase CLI 的标准环境（带 Studio，便于查看数据）。生产镜像使用官方 Postgres，迁移中只使用 Postgres 自带扩展（`pgcrypto` 等），不依赖 Supabase 托管版独有扩展；CI 会在生产镜像上再跑一遍 pgTAP 和端到端测试。

### 8.4 规范

- TypeScript `strict`；ESLint + Prettier 使用 Expo 默认配置。
- 数据库对象用英文蛇形命名；界面文字只写在组件和 `errors.ts` 中，统一中文。
- 每个迁移配对应的 pgTAP 测试；改动账务函数必须补充测试。
- 提交信息用英文祈使句，一次提交一件事。

---

## 9. 部署与运维

### 9.1 镜像构建

`docker/Dockerfile` 多阶段构建：

1. `client-build`：`node` 镜像中 `npm ci && npx expo export -p web`，再用 `workbox generateSW` 生成 Service Worker。
2. `storage`：把官方 Storage 镜像（Alpine）中的 `/app` 复制到 `node:24-bookworm-slim`，为 glibc 重新编译其中唯一的原生模块 `fs-xattr`。
3. 最终阶段基于 `postgres:17-bookworm`：复制 Auth、PostgREST、Caddy 二进制，Storage 与 Node 运行时，前端静态文件，迁移文件，`init/`、`bin/`；安装 supervisord。

镜像标签使用语义化版本（如 `1.0.0`），推送到 GitHub Container Registry。

### 9.2 启动

```bash
docker run -d --name dolphin-cloud --restart unless-stopped -p 80:80 -p 443:443 -v dolphin-data:/data -e DOLPHIN_DOMAIN=bank.example.edu.cn -e ACME_EMAIL=it@example.edu.cn ghcr.io/hy916-cn/dolphin-cloud:1.0.0
```

入口脚本顺序：

1. 首次启动：初始化数据库，执行 `init/`（创建 `anon`、`authenticated`、`service_role`、`authenticator`、`supabase_auth_admin`、`supabase_storage_admin` 等角色与 `auth`、`storage` schema），生成密钥。
2. 每次启动：若数据库已有数据且镜像版本变化，先做一次升级前备份；Postgres 就绪后依次启动 Auth、Storage（各自执行内置迁移），执行 `supabase/migrations/` 中未应用的迁移（记录在 `app_migrations` 表），再启动 PostgREST 与 Caddy。
3. 生成 `/config.js`，内容为站点地址与 anon key。

首次启动后创建第一个指导老师账号：

```bash
docker exec -it dolphin-cloud dolphin create-admin teacher01
```

### 9.3 运维命令

| 命令 | 作用 |
| --- | --- |
| `dolphin create-admin <账号>` | 交互输入密码，创建带 `teacher` 和 `sysadmin` 角色的账号 |
| `dolphin backup` | 立即备份 |
| `dolphin backups` | 列出备份文件 |
| `dolphin restore <文件名>` | 恢复指定备份：停止 API 进程 → 恢复数据库与图片 → 启动；恢复前自动再备份一次当前数据 |
| `dolphin check` | 运行 `check_balances()` 并输出结果 |
| `dolphin status` | 各进程状态、版本、最近一次备份时间 |

### 9.4 备份

- 每天 `BACKUP_TIME` 执行：`pg_dump -Fc` 全库 + `/data/storage` 打包为 `/data/backups/dolphin-YYYYMMDD-HHMM.tar.gz`，保留 `BACKUP_RETENTION_DAYS` 天。
- 备份后运行 `check_balances()`；发现不一致时写入 `audit_log`，后台首页对指导老师显示提示。
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
- 学生密码为 6 位以上、服务在公网可访问：上线后关注 `audit_log` 与 Auth 日志中的连续登录失败，必要时在 Caddy 前加 IP 黑名单。
- 不采集身份证号、家庭住址、家长信息；开户通知单含初始密码，发放后由班主任回收销毁。

---

## 10. 测试

| 层级 | 工具 | 覆盖内容 |
| --- | --- | --- |
| 数据库 | pgTAP（`supabase/tests/`） | 每个函数的角色校验；禁止透支；单笔 / 单日限额；本人账户拦截；幂等重复提交；库存不足与并发兑换（两个会话同时买最后一件，只有一个成功）；冲正的四条规则；流水不可删改；`check_balances()` 能发现人为制造的不一致；导入重复学号不重复开户 |
| 前端单元 | jest-expo | `cash.ts` 配钞与找零；离线队列的入队、按序上传、失败保留、换柜员不可上传；错误码映射 |
| 端到端 | Playwright，对构建好的生产镜像运行 | 老师导入名册 → 学生首次登录改密码 → 柜员存款、取款、账户兑换、现金兑换、冲正 → 学生看到余额与明细；离线存款后恢复网络上传；备份后恢复，数据一致 |
| 性能 | 简单脚本 | 2000 名学生、10 万笔流水下：账务函数 < 1 秒，学生首页 < 2 秒 |

CI（GitHub Actions）：每次推送运行 lint、单元测试、`supabase test db`；合并到 `main` 时构建镜像并在镜像上跑 pgTAP 与端到端测试，全部通过后推送镜像。

---

## 11. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| M0 技术验证 | 单容器镜像：Postgres + Auth + PostgREST + Storage + Caddy；入口脚本与 `config.js`；SQL 创建账号 | `docker/smoke-test.sh` 全部通过：经 HTTPS 登录、调用 RPC、上传并公开读取图片；`dolphin backup` → 改动 → `restore` 恢复到备份时状态；容器重启后数据完整 |
| M1 数据与账务核心 | 全部表、RLS、账务函数、冲正、审计、`check_balances()`；运维命令 `dolphin create-admin`、`dolphin check` | pgTAP 全部通过 |
| M2 前端基础 | 主题 token、组件库、登录与改密码、角色路由 | 设计系统组件与 `preview.html` 视觉对照一致 |
| M3 柜台 | 存款、取款、兑换、查询、冲正、离线存款 | 柜台相关端到端测试通过；单笔办理 ≤ 1 分钟（由学生柜员试用计时） |
| M4 后台与学生端 | 名册导入与开户通知单、账号角色、商品与入库、发行登记、流水查询、参数、日志；学生首页、明细、排名 | 全部端到端测试通过 |
| M5 上线 | 正式服务器部署、迁入现有账本、柜员培训、试运行 | 第 12 节验收全部通过 |

M0 是后续工作的前提，先完成并确认单容器方案可行，再进入 M1。

---

## 12. 上线与验收

### 12.1 上线步骤

1. 在正式服务器部署镜像，配置域名与证书，创建指导老师和系统管理员账号。
2. 老师把现有 Excel 账本整理进导入模板（期初余额取账本当日余额），导入后打印「期初余额核对表」，与原账本逐人核对。
3. 打印开户通知单，按班发放；为柜员、会计、库管开通角色。
4. 库管录入文创商品与库存。
5. 柜员用测试账号练习（开发种子数据或单独的测试环境）。
6. 试运行一周：全部业务在系统中办理，同时按 SOP 填写纸质凭条，指导老师每天抽查；无问题后停用 Excel 账本。

### 12.2 验收标准

- [ ] 柜台主界面一屏内显示存款、取款、兑换、查询、冲正入口，任一业务点击不超过 2 层即进入办理。
- [ ] 输入学号后显示姓名、班级、余额；学号不存在时提示「未找到该学号」。
- [ ] 余额不足时取款和账户兑换无法提交，并显示可用余额与差额。
- [ ] 取款超过单笔或单日限额时无法提交，并显示限额或今日剩余额度。
- [ ] 账户兑换成功后，余额、库存、流水同时更新；任一项失败则都不变。两台设备同时兑换最后一件商品，只有一笔成功，另一笔提示「已售罄」。
- [ ] 现金兑换显示应付、已收和找零方案，账户余额不变。
- [ ] 存款、取款、兑换成功后显示大字结果与交易号。
- [ ] 同一笔业务因网络重试重复提交，只记一次账。
- [ ] 柜员能冲正本人当天办理的业务，冲正后余额与库存恢复，原流水显示「已冲正」；柜员无法冲正他人或往日的业务，指导老师可以。
- [ ] 柜员无法为本人的学生账户办理业务。
- [ ] 断网时柜台可登记存款，其他业务禁用并说明原因；恢复网络后上传，系统流水与纸质凭条一致。
- [ ] 学生登录后 2 秒内看到余额和最近 10 笔交易；只能看到本人数据。
- [ ] 名册导入后每位学生可用开户通知单上的初始密码登录，首次登录必须修改密码。
- [ ] 现有 Excel 账本余额迁入后，与原账本逐人核对一致。
- [ ] 任何角色都无法直接修改余额、库存或删除流水（通过 API 直接请求也被拒绝）。
- [ ] 所有业务与管理操作在操作日志中可查到操作人、时间、设备。
- [ ] 每日自动备份生成，`dolphin restore` 能把数据恢复到备份时状态。
- [ ] 容器重启、升级后数据完整，证书自动续期。
