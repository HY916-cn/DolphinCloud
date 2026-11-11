# 海豚云 · 第一阶段开发文档

> 依据：[分阶段产品文档](../product/PRODUCT.md) 第 4 节「阶段一：柜台上线，替代 Excel 账本」、[功能需求 3.0](../requirements/REQUIREMENTS.md)、[海豚云设计系统](../../design-system/project/README.md)
>
> 本文说明第一阶段「怎么做」：技术架构、数据模型、接口、前端结构、部署与运维、测试与里程碑。产品范围以产品文档为准，两者不一致时先改产品文档再改本文。

---

## 1. 范围

### 1.1 本阶段交付

| 模块 | 交付内容 |
| --- | --- |
| 登录 | 学生用学号 + 密码登录；工作人员用账号 + 密码登录；用初始密码登录后必须设置新密码；连续输错 5 次锁定 15 分钟 |
| 开户 | 银行管理员按模板导入名册，批量开户并迁入期初余额；每人一个随机初始密码，打印或下载开户通知单（每人一页）发放 |
| 学生端 | 余额、最近 10 笔交易、全部明细（按存款、取款、兑换、工资分开，可搜索和按日期筛选）、存款排名（按学部分开排，默认匿名） |
| 柜台 | 上班后才能办理；办理、今日业务：按姓名、拼音、班级或学号找到学生，在一次办理里连续办理存款、取款、兑换和查询（账户累计与全部交易记录，可筛选），办理单记下每一笔并可就地冲正；下班时打印本次上班的业务总结，签字留存 |
| 离线登记 | 断网时只允许登记存款，本机暂存，恢复后补传；纸质凭条兜底 |
| 文创商城 | 商品新增、编辑、图片、价格、上架 / 下架；出入库（一次为多件商品入库或出库） |
| 流水查询 | 财务与银行管理员用一个搜索框找学生、班级、学部、柜员或交易号，再按日期、类型和每天的时段筛选全部流水，可打印、导出 PDF 或 Excel |
| 报表 | 财务与银行管理员按日、周、月或任意日期（最长一年）和每天的时段，看全行、学部、班级或一位学生的营业、账户、财务、商品报表（图表与表格，与上一个同样长的期间对比），打印或导出 PDF，每个图表和表格各占一页 |
| 考勤与工资 | 银行管理员为已绑定工资账户的柜员开启考勤；参与考勤的柜员上班、下班时自动记下所在的中午班（13:30 前）或下午班（13:30 起），一个班次里多次上下班只算一次；考勤按周显示；银行管理员逐个审查（二次确认，审查后不能再改）或全部确认、补签；全部审查完成后手动发放工资，中午班、下午班的工资由参数分别设定，发到柜员用密码绑定的学生账户 |
| 系统 | 账号与角色（学生和工作人员都可批量停用、重置密码、注销）、每个账号的「我的」页、参数设置、操作日志、每日自动备份与命令行恢复、余额自检 |
| 部署 | 单个 Docker 镜像，一条 `docker run` 启动，自动申请 HTTPS 证书 |

### 1.2 后续阶段

以下内容在后续阶段实现，本阶段的数据结构为它们预留字段，但不实现功能：

- 二维码胸卡扫码识别（扫码枪与摄像头）
- 凭条打印、经营看板、盘点、贷款、学期结转
- 家长端、教师端、存折、利息与定期、积分转海豚币

---

## 2. 关键决策

| 主题 | 决定 | 说明 |
| --- | --- | --- |
| 前端 | Expo Router + React，TypeScript，界面直接使用设计系统的 `bundle.css`；第一阶段只发布 Web | 柜台平板、后台电脑、学生手机都用浏览器访问，一套页面按宽度适配三种屏幕。原生客户端用同一份界面打包：M3 起是可安装的 PWA；阶段三用 Capacitor 打包安卓 / iOS 安装包，原生能力（推送、相机）走插件。数据与业务逻辑集中在 `src/lib`，不依赖 DOM，也可供 React Native 界面复用 |
| 后端 | 自托管 Supabase 组件：Postgres、Auth（GoTrue）、PostgREST、Storage | 业务规则全部写在 Postgres 函数（RPC）里，前端只调用函数，不直接写表 |
| 部署 | 单容器：Caddy + Postgres + Auth + PostgREST + Storage，由 supervisord 管理 | 一个镜像、一个数据卷；不含 Studio、Realtime、Edge Functions |
| 网络 | 校内服务器，公网域名（已备案）+ 内网均可访问 | Caddy 自动申请并续期 Let's Encrypt 证书 |
| 身份识别 | 柜员按姓名、拼音首字母、班级或学号搜索，点选后学生条大字显示姓名、班级、学号，柜员当面核对 | 胸卡扫码在后续阶段加入，届时只是多一种输入学号的方式 |
| 兑换付款 | 支持「账户扣款」和「现金支付」 | 现金支付按收到的面额计算找零，账户余额不变 |
| 离线 | 只允许存款 | 存款不会透支，补传后服务端照常校验 |
| 对账 | 柜员上班、下班；下班前打印本次上班以来的全部业务，签字留存 | 不做现金轧账；流水记录柜员、设备和时间，并预留 `cash_delta` 字段，便于以后按柜员汇总现金 |
| 更正 | 冲正 | 柜员可冲正本人当天办理的业务；银行管理员可冲正任意业务；原流水保留并标记「已冲正」 |
| 密码 | 新账号和重置后的账号各得一个随机 8 位数字初始密码，只在开户通知单、密码单或操作结果里出现一次 | 用初始密码登录后必须设置新密码，这是本人唯一一次改密码；之后只能由银行管理员或运维员重置，重置后得到新的随机初始密码 |
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
| supervisord | Debian 包 | 进程管理；每日备份和定时任务（`dolphin-jobs`，PHASE-2.md §13）由它托管的脚本执行 |

版本统一写在 `docker/Dockerfile` 开头的 `ARG` 中，取自 Supabase 官方 self-hosted `docker-compose.yml`（2026 年 10 月）：Auth `v2.197.0`、PostgREST `v14.18`、Storage `v1.81.0`、Postgres `17`、Caddy `2.10`、Node `24`。Postgres 主版本与 `supabase/config.toml` 的 `db.major_version` 一致；升级任一组件后先跑 `docker/smoke-test.sh`，再跑第 10 节的集成测试。

### 3.3 运行配置

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DOLPHIN_DOMAIN` | 是 | — | 用户访问的域名，不含端口，如 `bank.example.edu.cn`；本地测试用 `localhost` |
| `ACME_EMAIL` | 由 Let's Encrypt 签发时必填 | — | 证书到期通知邮箱 |
| `DOLPHIN_PORT` | 否 | `443` | 容器内 HTTPS 监听端口；放在端口转发或隧道后面时使用。对外地址始终是 `https://$DOLPHIN_DOMAIN` |
| `TZ` | 否 | `Asia/Shanghai` | 容器时区；数据库内时间统一存 `timestamptz` |
| `BACKUP_TIME` | 否 | `02:00` | 每日备份时间 |
| `BACKUP_RETENTION_DAYS` | 否 | `30` | 备份保留天数 |
| `BACKUP_RECIPIENT` | 生产环境应设置 | — | age 公钥（`age1…`）；设置后备份加密为 `.tar.gz.age`，见 9.4 |

证书三种来源：挂载了 `/certs/fullchain.pem` 与 `/certs/privkey.pem` 时使用这两个文件（如 Certd 推送的证书），文件变化后 10 秒内自动重载；`DOLPHIN_DOMAIN=localhost` 时使用 Caddy 本地 CA；其余情况由 Caddy 向 Let's Encrypt 自动申请和续期。

数据库密码、`JWT_SECRET`、anon key、service_role key 在首次启动时自动生成，保存在 `/data/secrets/`（权限 600）。service_role key 只在容器内部供 Storage 和运维脚本使用，不写入 `/config.js`。

---

## 4. 角色与权限

### 4.1 角色

每个账号只有一种身份。学生账号就是学生，柜员、财务、库管、行长、银行管理员、运维员都是工作人员，各用一个独立的工作账号，账号之间互不关联，与担任者是谁无关。同一个人担任两种身份时持有两个账号，在同一台设备上登录后可一键切换（见 7.4）。

| 身份 | 角色代码 | 登录方式 |
| --- | --- | --- |
| 学生 | （无，学生账户） | 「学生」+ 学号 + 密码 |
| 柜员 | `teller` | 「工作人员」+ 工作账号 + 密码 |
| 财务 | `accountant` | 同上 |
| 库管 | `storekeeper` | 同上 |
| 行长 | `president` | 同上 |
| 银行管理员 | `teacher` | 同上 |
| 运维员 | `sysadmin` | 同上 |

- 学生账号由名册导入产生，不带任何角色。
- 银行管理员全系统只有一个（`user_roles` 上 `role = 'teacher'` 的唯一索引）：由 `dolphin create-admin` 创建，不能新增第二个，也不能把其他账号改成银行管理员或改掉它的身份；忘记密码时用 `dolphin reset-admin` 生成新的初始密码。其他身份可以有多个账号。
- 行长可以有多个，由银行管理员或运维员创建和管理。行长的权限与银行管理员相同，只是不管理账号：学生和工作人员的名单与详情（含余额、工资账户）只读，不能导入名册、新增账号、改身份、重置密码、停用或启用、注销、冻结或标记毕业、重发开户通知单、绑定或解除工资账户；也不能登记货币发行（只由银行管理员登记，同 [PHASE-2.md](PHASE-2.md) §3）。数据库里凡检查银行管理员（`has_role('teacher')`）的地方也认行长；管理账号的函数和 `register_issue` 开头调用 `app_private.forbid_president()` 拒绝行长（`FORBIDDEN`）。
- 工作账号恰好有一个角色；`user_roles` 每个账号最多一行，学生账号不能写入。

### 4.2 权限矩阵

| 操作 | 学生 | 柜员 | 财务 | 库管 | 行长 | 银行管理员 | 运维员 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 查看本人余额、明细、排名 | ✓ | — | — | — | — | — | — |
| 首次登录设置新密码（仅此一次） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 存款、取款、兑换、查询学生（含该生全部交易记录） | | ✓ | | | | | |
| 冲正本人当天业务 | | ✓ | | | | | |
| 上班、下班，查看本人考勤 | | ✓ | | | | | |
| 绑定工资账户（须输入该学生账户的密码） | | 本人 | | | | ✓ | ✓ |
| 冲正任意业务 | | | | | ✓ | ✓ | |
| 查看全部流水、报表与导出 | | | ✓ | | ✓ | ✓ | |
| 查看商品与成本 | | | ✓ | ✓ | ✓ | ✓ | |
| 商品管理、出入库 | | | | ✓ | ✓ | ✓ | |
| 设置参与考勤、审核与补签、发放工资 | | | | | ✓ | ✓ | |
| 查看学生与工作人员（名单、详情、余额） | | | | | ✓ | ✓ | ✓（不含余额） |
| 导入名册、开户 | | | | | | ✓ | |
| 管理工作账号（含批量） | | | | | | ✓ | ✓ |
| 重置学生密码、注销账号（含批量） | | | | | | ✓ | ✓ |
| 参数设置 | | | | | ✓ | ✓ | |
| 登记货币发行 | | | | | | ✓ | |
| 查看操作日志 | | | | | ✓ | ✓ | ✓ |
| 备份与恢复（命令行） | | | | | | | ✓ |

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
  total_spent  integer not null default 0,     -- 累计账户兑换（现金兑换不经账户，不计入）
  updated_at   timestamptz not null default now()
);

create type txn_type as enum ('opening','deposit','withdraw','purchase','reversal','salary');

create table txns (
  id                uuid primary key,          -- 客户端生成，作幂等键
  seq               bigserial unique,
  txn_no            text unique not null,      -- 交易号：HT + YYMMDD + 序号（完整序号，不足 6 位补 0）
  type              txn_type not null,
  student_no        text not null references students(student_no),
  amount            integer not null check (amount > 0),
  balance_delta     integer not null,          -- 对账户余额的影响
  balance_after     integer not null,
  cash_delta        integer not null default 0,-- 对柜台现金的影响：存款 +，取款 −，现金兑换 +
  payment           text check (payment in ('account','cash')),  -- 仅兑换
  denominations     jsonb,                     -- 面额明细，如 {"10":2,"5":1}：存款收到的、取款付出的（服务端按面额从大到小配钞）
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
  safety_stock integer not null default 5 check (safety_stock >= 0), -- 安全库存
  low          boolean generated always as (stock <= safety_stock) stored, -- 总览「库存不足」按它筛选
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
  kind        text not null check (kind in ('stock_in','stock_out','sale','reversal')),
  qty_delta   integer not null,
  txn_id      uuid references txns(id),
  operator_id uuid not null references profiles(id),
  note        text,
  created_at  timestamptz not null default now()
);

-- 货币发行：第一阶段早期登记的批次保留在库中，供日志与以后的阶段读取；本阶段不再登记。
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

create table staff_payroll (                   -- 考勤与工资（6.9），每个柜员一行
  user_id    uuid primary key references profiles(id),
  attendance boolean not null default false,  -- 参与考勤
  account    text unique references students(student_no)  -- 工资账户，一个学生账户只绑定一个工作人员
);

create table attendance (                      -- 每个柜员每个班次一行
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id),
  day         date not null,
  shift       text not null check (shift in ('am','pm')),   -- 中午班 13:30 前，下午班 13:30 起（上海时间）
  status      text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  signed_at   timestamptz not null default now(),
  signed_by   uuid not null references profiles(id),       -- 柜员本人，补签时为银行管理员
  note        text,                                         -- 补签说明或审核说明
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  salary_txn  uuid references txns(id),                     -- 发放这个班次工资的 salary 流水
  pay         integer,                                      -- 发放时这种班次的工资
  unique (user_id, day, shift)
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
| `salary_per_shift` | `{"am":10,"pm":10}` | 柜员每个有效班次的工资（HTB，1～10000），中午班、下午班分别设置，发放时按当时的金额计算 |

### 5.4 数据不变式

1. `accounts.balance = sum(txns.balance_delta)`（按学生），由函数在同一事务内维护；`app_private.check_balances()` 每天复核一次。
2. `products.stock = sum(stock_movements.qty_delta)`（按商品），同样由函数维护并每日复核。每日复核还检查每笔的办理后余额前后衔接、累计存入 / 取出 / 消费与流水一致、兑换明细合计等于兑换金额。
3. `txns` 只能新增；唯一允许的更新是冲正时把原流水 `status` 改为 `reversed`。触发器拒绝其他 `update` 与所有 `delete`。
4. 每笔冲正指向唯一一笔原流水（`reversal_of` 唯一），冲正流水本身不能再被冲正。

### 5.5 审计

- 触发器记录 `profiles`、`user_roles`、`students`、`products`、`currency_issues`、`settings`、`staff_payroll`、`attendance`、`duty` 的每次变更（前后值）；班次被发放工资时不逐条记录，每次发放另写一条 `salary.pay`。
- 流水本身即账务审计；导入名册、重置密码、冲正、注销账号（`user.close`）等函数另写一条 `audit_log`。
- IP、设备号、User-Agent 取自 PostgREST 传入的请求头：`current_setting('request.headers', true)::json`，其中 IP 取 Caddy 写入的 `X-Forwarded-For`，设备号取前端发送的 `X-Device-Id`。
- 登录钩子由 Auth 调用，拿不到请求头，`login.ok` 先记下账号；前端登录成功后随即调用 `note_login()`，为这条记录补上设备号、IP 和 User-Agent（存法同上）。`login.failed`、`login.locked` 不带设备与 IP。

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

返回值统一为 `{ txn_no, type, amount, balance_after, denominations, change_given }`，前端据此显示结果页（取款凭条的配钞取 `denominations`）。

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
| `create_staff(p_login_id, p_name, p_role)` | teacher / sysadmin | 创建一个角色的工作账号，返回随机初始密码；不能创建 `teacher`（只有一个，`ONE_BANK_ADMIN`） |
| `set_role(p_user_id, p_role)` | teacher / sysadmin | 更正工作账号的角色（仍只有一个）；学生账号不能设置角色；不能改成或改掉 `teacher`（`ONE_BANK_ADMIN`） |
| `reset_password(p_user_id)` | teacher / sysadmin | 生成新的随机初始密码并返回（`must_change_password` 随之为 `true`），结束该账号的所有会话并解除登录锁定 |
| `reissue_passwords(p_student_nos)` | teacher / sysadmin | 重印开户通知单：为其中还未设置新密码的学生各生成新的初始密码并返回（同 `import_roster` 的 `accounts`），旧通知单随即失效 |
| `set_student_status(p_student_no, p_status)` | teacher | 账户状态改为 `normal`（在读）、`frozen`（冻结）或 `graduated`（毕业）；非在读账户不能办理业务（`STUDENT_INACTIVE`）；已注销的账户不能再改（`ACCOUNT_CLOSED`） |
| `set_user_disabled(p_user_id, p_disabled)` | teacher / sysadmin | 停用后无法登录（同时设置 `auth.users.banned_until`），登录时提示「账号已停用」；停用柜员同时退出考勤，不发工资，也不再出现在各处名单里，只留在记录中；已注销的账号不能再启用（`ACCOUNT_CLOSED`） |
| `close_accounts(p_user_ids)` | teacher / sysadmin | 注销账号，不能撤销：学生账户的余额由一笔 `closing`（注销清零）流水清零，状态为 `closed`；账号永久停用（`profiles.closed_at`）、结束会话，从所有名单里消失，交易、考勤与日志保留；用作工资账户的学生账户解除绑定并让该柜员退出考勤。不能注销自己和银行管理员。返回注销人数和清零金额。至少保留一个在用的运维员：最后一个不能停用、注销或改为其他身份（`LAST_SYSADMIN`，数据库触发器检查） |
| `upsert_product(...)`、`stock_in(p_product_id, p_qty, p_note)` | storekeeper / teacher | 新增或编辑商品（`p_listed` 必填；`p_safety_stock` 新商品默认 5，编辑时不传则保持原值）；单件商品入库 |
| `stock_move(p_kind, p_items [{product_id, qty}], p_note)` | storekeeper / teacher | 出入库页使用：`stock_in` 入库或 `stock_out` 出库，多件商品一次完成，任一件失败则都不变；出库须写原因（`p_note`），数量不能超过库存（`OUT_OF_STOCK`）。库存其余的减少来自兑换 |
| `set_setting(p_key, p_value)` | teacher | 按 key 校验取值范围（第二阶段的参数见 PHASE-2.md §14.3） |
| `set_settings(p_values)` | teacher | 一次保存多项参数（`{key: value}`），逐项按 `set_setting` 校验，全部成功或全部不保存；「参数」页保存用它 |
| `deposit_ranking(p_division)` | 学生 | 返回该学部前 N 名（按参数脱敏）与本人名次；`p_division` 为空时取本人所在学部 |
| `app_private.check_balances()` | 定时任务、`dolphin check` | 返回与流水不一致的记录（`kind`：余额、库存、办理后余额衔接 `balance_after`、累计 `total_in` / `total_out` / `total_spent`、兑换明细合计 `txn_items`），并写 `audit_log`；不经 API 开放 |
| `public.hook_password_verification_attempt(event)` | Auth 登录钩子 | 每次密码校验后调用：同一账号 15 分钟内输错 5 次即锁定 15 分钟（期间密码正确也拒绝，返回 `LOGIN_LOCKED`），登录成败记入 `audit_log`（`login.ok` / `login.failed` / `login.locked`）；只授予 `supabase_auth_admin`；事件里没有 `user_id` 时交给 Auth 自行处理 |
| `note_login()` | 已登录的任何账号 | 登录成功后由前端调用：为本人最近 5 分钟内最新的一条 `login.ok` 补上设备号、IP 和 User-Agent；这条已有设备信息或找不到时不改动，返回 `{"noted": true / false}`；重复调用无副作用。只授予 `authenticated` |
| `app_private.create_admin(p_login_id)` | `dolphin create-admin` | 创建银行管理员账号，显示名为「银行管理员」，返回随机初始密码；已有银行管理员时拒绝；不经 API 开放。运维员和其他工作账号由银行管理员在后台创建 |

### 6.5 名册导入与账号创建

模板（Excel，第一行为表头）：

| 学号 | 姓名 | 学部 | 学届 | 班号 | 期初余额 |
| --- | --- | --- | --- | --- | --- |
| 必填，唯一 | 必填 | 必填，小学部 / 初中部 | 必填，入学年份，如 2023；须使学生当前处在本学部的年级内 | 必填，1–99 的整数 | 可空，整数 ≥ 0 |

流程：

1. 前端用 SheetJS 读取文件，校验表头、必填项、学号重复、学部（「小学部」「初中部」，提交时转为 `primary` / `junior`）、余额格式，错误行标出行号，全部通过才允许导入。
2. 每 100 行调用一次 `import_roster`，界面显示进度；每批一个事务。函数声明 `set statement_timeout = '60s'`。
3. 新学号：创建 `auth.users` + `auth.identities`、`profiles`、`students`、`accounts`；期初余额 > 0 时写一笔 `opening` 流水；每人生成随机初始密码，随结果返回一次。
4. 已存在的学号：只更新姓名、学部、学届、班号，不改密码、不重复写期初流水。
5. 导入结束显示「新开户 N 人、更新 M 人」，并提供「开户通知单」（打印或下载 PDF）：每人一页 A4 的 PDF，按班、按学号排列，每页含姓名、班级、学号、本人的初始密码、登录网址，并提示「首次登录后请立即设置新密码」。

账号写入方式：Supabase Auth 不开放注册（`GOTRUE_DISABLE_SIGNUP=true`），账号由 `security definer` 函数直接写入 `auth` schema：

- 登录名映射为内部邮箱：学生 `<学号>@student.dolphin.internal`，工作人员 `<账号>@staff.dolphin.internal`；`email_confirmed_at = now()`。
- 密码 `crypt(p, gen_salt('bf', 10))`；`aud`、`role` 为 `authenticated`；令牌类字段写空串。
- 同时写入 `auth.identities`（`provider = 'email'`）。
- 字段以锁定版本的 Auth 表结构为准，集成测试覆盖「导入 → 初始密码登录 → 设置新密码 → 重置 → 新初始密码再登录」。

密码规则：

- 初始密码由 `app_private.new_password(login_kind)` 随机生成，所有账号都是 8 位数字。新账号、`dolphin create-admin` 建的账号、重置后的账号各得一个，`must_change_password` 为 `true`；密码只在开户通知单或操作结果里出现一次，系统不保存明文。
- `must_change_password` 为 `true` 时，该账号不具备任何角色，也看不到本人的学生账户，只能读到自己的 `profiles`；前端据此直接进入「设置新密码」页。
- 设置新密码：前端调用 `supabase.auth.updateUser({ password })`。`auth.users` 上的触发器只在 `must_change_password` 为 `true` 时允许修改；新密码与初始密码相同时 Auth 返回 `same_password`。修改后 `must_change_password` 变为 `false`。此后本人无法再改密码（Auth 返回错误），忘记或需要更换时由银行管理员或运维员 `reset_password` 生成新的初始密码。
- 登录锁定：同一账号 15 分钟内输错 5 次即锁定 15 分钟，由 Auth 的密码校验钩子实现（按账号计算，不按 IP，校内共用出口 IP 不受影响）；重置密码同时解除锁定。按账号锁定意味着知道学号的人可以故意输错把对方锁 15 分钟，`login.locked` 在日志里集中出现时由银行管理员核查；`smoke-test.sh` 经 HTTPS 调 Auth 验证锁定。
- 新密码至少 8 位，可以全是数字，所有账号相同。这是已接受的风险：8 位数字的组合较少，靠按账号锁定防猜测；Auth 的按 IP 限流（`GOTRUE_RATE_LIMIT_TOKEN_REFRESH`）因全校共用出口 IP 放得很宽。入学教育和首次设置新密码时提醒不要用生日、学号等容易猜的数字。由 Auth 校验（`GOTRUE_PASSWORD_MIN_LENGTH=8`），不符合时返回 `weak_password`；前端在提交前给出同样的提示。

### 6.6 读取与 RLS

| 表 | 学生 | 柜员 | 财务 / 银行管理员 | 库管 |
| --- | --- | --- | --- | --- |
| `students` | 本人 | 全部 | 全部 | — |
| `accounts` | 本人 | 全部 | 全部 | — |
| `txns`、`txn_items` | 本人 | 本人办理的当天流水 | 全部 | — |
| `products`（不含 `cost`） | 已上架 | 已上架 | 全部 | 全部 |
| `currency_issues` | — | — | 全部 | — |
| `audit_log` | — | — | 银行管理员 | — |

`products.cost` 不对 `authenticated` 开放；成本经视图 `product_costs (id, cost)` 读取，只有库管、财务、银行管理员能读到数据。

柜员查询学生用函数 `lookup_student(p_student_no)`，返回学号、姓名、学部、学届、班号、年级、班级名称、余额、该生当天已取款合计，以及信用分（`credit`，见 PHASE-2.md §8.1）。信用分表 `credit_scores`、`credit_events` 学生读本人的，财务、行长、银行管理员读全部，柜员只经 `lookup_student` 看到正在办理的学生。运维员可读 `profiles`、`user_roles`、`audit_log` 和 `students`（为学生重置密码时查找学生，不含余额）；财务可读工作账号的 `profiles` 和 `user_roles`（流水里的柜员姓名，按柜员筛选）。

### 6.8 查询与报表

| 函数 | 角色 | 说明 |
| --- | --- | --- |
| `student_txns(p_student_no, p_before, p_limit, p_from, p_to, p_time_from, p_time_to, p_types, p_search)` | teller | 柜台「查询」：该生的全部交易，最新在前，每次 `p_limit` 笔（1–50，默认 10），`p_before` 为上一页最后一笔的 `seq`；可按上海时区的日期、每天的时段（不含结束时刻）、类型和交易号或商品名里的文字筛选；每笔含交易号、类型、金额、余额变动、办理后余额、支付方式、状态、原因、时间、经办人和兑换的商品。柜员不能查自己的学生账户（`SELF_SERVICE_FORBIDDEN`） |
| `bank_report(p_from, p_to, p_division, p_cohort, p_class_no, p_student_no, p_time_from, p_time_to)` | accountant / teacher | 报表：上海时区的日期 `p_from`–`p_to`（最长 366 天），范围为全行、一个学部、一个班（学部 + 学届 + 班号）或一位学生，可只取每天 `p_time_from`–`p_time_to` 之间（不含结束时刻）。返回 `business`（存款、取款、账户兑换、现金兑换各几笔多少，办理过业务的学生数，均不含已冲正的）、`reversals`、`reversed`、`openings`、`balance`（期初、期末账面余额和本期按类型的余额变动，期初 + 变动 = 期末）、`cash`（柜面现金收入、付出）、`days`（每天各业务笔数金额与余额变动）、`hours`、`tellers`、`classes`、`students`（人数、办理过业务、各状态人数 `normal` / `frozen` / `graduated` / `closed`、余额合计、中位数、最高；人数含已注销的账户）、`distribution`（期末余额分档人数）、`products`（兑换数量、金额、成本）、`stock`（期初、入库、出库、兑出、期末），以及早期登记的 `issues`（前端不再显示） |
| `cn_time(txns)` | 表查询 | 流水的上海时间时刻，供「流水」按时段筛选：`txns?cn_time=gte.12:00&cn_time=lt.13:30` |

- 期初、期末余额取每位学生在期间开始前、结束前最后一笔流水的 `balance_after`；余额核对始终按整天计算，不受时段影响。范围内的学生为期末前已开户或已有流水的学生。
- 库存是全行数据，不按学生范围筛选。
- 报表在浏览器里画成 A4 页面（`lib/doc.ts`），可打印或下载 PDF：首页为营业概况、余额核对和柜面现金，之后每日业务、按日明细、营业时段、按柜员、账户与余额分布、按班级、日终账面余额、商品兑换、库存各占一页，图表在上、表格在下，长表格接到下一页并重复表头。
- 流水页按当前筛选导出：「打印 / 导出」打开的面板里打印、下载 PDF（`ledgerPages`）或下载 Excel（SheetJS 生成 `.xlsx`）。学生姓名默认写作「张*明」，在同一面板勾选「导出完整姓名」才写全名。

### 6.9 考勤与工资

| 函数 | 角色 | 说明 |
| --- | --- | --- |
| `set_attendance(p_user_id, p_on)` | teacher | 设置柜员是否参与考勤；开启前须已绑定工资账户（`SALARY_UNBOUND`），已停用的账号不能开启 |
| `start_duty(p_float)` | teller | 上班：没有进行中的上班记录时新建一条（`duty`），同时登记备用金（`cash_counts`，见 PHASE-2.md §7.1；`p_float` 为各面额张数，不传时取本人上次的备用金，从未上过班则全为 0），已上班时返回原记录、不改备用金，返回值带 `float`（各面额张数）和 `stale`：这次上班开始于上海时间今天以前（跨天未下班）时为 `true`，此时不记班次，前端提示柜员先下班；参与考勤的柜员同时记下当前班次（上海时间 13:30 前为中午班 `am`，13:30 起为下午班 `pm`），状态为待审，同一班次已有记录时不重复 |
| `duty_txns()` | teller | 下班总结：本人当前上班以来办理的全部业务（按办理时间，含学生姓名），与 `end_duty` 的计数口径相同（含离线补传和冲正）。柜员只能读当天流水，跨午夜的上班也由它完整列出；未上班时 `OFF_DUTY` |
| `end_duty(p_txns)` | teller | 下班：`p_txns` 是下班总结里列出的业务笔数，与上班以来本人办理的笔数不同时返回 `SUMMARY_STALE`（总结已过时，需重新打印）；未上班时 `OFF_DUTY`。参与考勤的柜员同时记下下班时所在的班次。跨天未下班的上班也照此下班，之后重新上班即可办理。下班时把按面额算出的应有写进 `cash_counts.expected`，状态改为待复核 `pending` |
| `duty_cash(p_duty_id)` | teller / accountant / president / teacher | 下班总结的现金表（PHASE-2.md §4）：备用金、收入、付出、应有，各面额张数、金额与合计；不传时为本人当前的上班（未上班时 `OFF_DUTY`），柜员只能查本人的上班 |
| `makeup_attendance(p_user_id, p_day, p_shift, p_note)` | teacher | 补签：今天已开始的班次或以前的班次，须写说明，直接计为有效；已有记录时 `ALREADY_EXISTS` |
| `review_attendance(p_ids, p_status, p_note)` | teacher | 审查待审班次：设为有效（`confirmed`）或未通过（`rejected`）；审查后不能再改（`ATTENDANCE_REVIEWED`） |
| `bind_salary_account(p_user_id, p_student_no, p_password)` | teller（本人）/ teacher / sysadmin | 绑定工资账户，须输入该学生账户的登录密码；输错计入该学生账号的登录锁定（15 分钟内 5 次锁定 15 分钟），因此不报错而返回 `{"error":"WRONG_PASSWORD"}` 或 `{"error":"LOGIN_LOCKED"}`；一个学生账户只绑定一个工作人员（`ALREADY_EXISTS`）；只能绑定在读（`normal`）的账户（`STUDENT_INACTIVE`） |
| `unbind_salary_account(p_user_id)` | teller（本人）/ teacher / sysadmin | 解除绑定；参与考勤期间不能解除（`ATTENDANCE_ON`） |
| `pay_salaries(p_week)` | teacher | 由银行管理员手动发放。到 `p_week` 所在周日为止还有待审班次时拒绝（`ATTENDANCE_PENDING`，附待审数量）；否则发放这一周（周一至周日）及以前所有有效、未发放的班次：每个柜员一笔 `salary` 流水存入其工资账户（金额 = 中午班数 × 中午班工资 + 下午班数 × 下午班工资，`cash_delta` 为 0，原因写日期和两种班次各几个，如「10月27日至11月1日，中午班 3 个、下午班 2 个」），并在班次上记下流水和每班次金额。未绑定工资账户或工资账户已冻结、毕业的柜员这次跳过，下次发放时补发；已停用的柜员不发放；重复发放不会重复付。返回发放和跳过的名单 |

- 柜员不能为本人的工资账户办理业务（`SELF_SERVICE_FORBIDDEN`，与本人的学生账户相同）。
- 柜员未上班时不能办理存款、取款、兑换和冲正（`txns` 上的触发器 `require_duty`，`OFF_DUTY`）；进行中的上班开始于上海时间今天以前（跨天未下班）时同样不能办理（`STALE_DUTY`，附 `started_at`），须先下班再重新上班。离线登记的存款补传时不受这两条限制。
- `salary` 流水不能冲正；报表的余额核对把它列为「工资」，不计入营业笔数。

### 6.7 图片存储

- 桶 `product-images`，公开读，只接受 jpeg / png / webp、单个不超过 5 MB；写入策略：`storage.objects` 上仅 `storekeeper`、`teacher` 可上传与删除。
- 前端上传前用浏览器自带的 `canvas` 缩放到最长边 800px、JPEG 质量 0.8，文件名为随机 UUID。
- 更换或移除图片在保存商品后生效：保存成功即删除旧图；保存前又换了一张，先删掉刚传的那张。上传后没保存就离开页面的图片会留在桶里。

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
| 离线 | Workbox 生成 Service Worker（预缓存应用外壳与拉丁字体，其余字体分片用到时下载并留存、后台再向服务器确认，`/config.js` 网络优先并留存一份）；`idb-keyval` 在 IndexedDB 中存离线队列和名册；Web App Manifest 支持添加到主屏幕。部署新版本后，页面先从旧缓存打开，新的 Service Worker 接管时自动刷新一次；Caddy 对带哈希的 `/_expo/static/*` 设长期缓存，其余静态文件 `no-cache`，每次向服务器确认 |
| Excel | SheetJS 0.20.3（从官方 CDN 发布的 tarball 安装并锁定版本），只在导入名册页按需加载 |
| 测试 | Node 自带的类型擦除运行 `src/lib/*.test.mjs`（单元）、Playwright（端到端，`client/e2e`） |

### 7.2 目录

```
client/
  src/app/                    路由（Expo Router）
    _layout.tsx               设计系统样式、React Query、会话
    index.tsx                 按账号去向跳转（见下）
    login.tsx                 登录页（LoginPage）：学生 / 工作人员分段切换
    change-password.tsx       初始密码登录后设置新密码
    student/                  学生端（AppShell）
      index.tsx               问候、余额卡、最近 10 笔
      txns.tsx                明细：全部 / 存款 / 取款 / 兑换 / 工资，搜索与日期筛选，按天分组，分页加载；本月合计
      ranking.tsx             存款排名：本人名次，本学部前 N 名（按参数匿名）
      me.tsx                  我的：切换账号、在此设备保存登录、退出账号、打开存折版（三端共用 MeView）
    book/                     学生端存折版（只给学生）：合着的存折是登录页，学号和密码打开；打开后是一本固定大小的存折，右侧书签换栏目，栏内按页翻（电脑两页摊开，手机一次一页）
      index.tsx  txns.tsx     账户（余额、本学期收支、最近 9 笔）、明细（按类型，分页印下去；本月收支）
      ranking.tsx  me.tsx     排名（名次表、我的名次）、我的（户主信息、普通版、切换账号、合上存折）
    counter/                  柜台（AppShell，导航：办理 今日业务 考勤 我的；进入时打开办理）
      _layout.tsx             柜员准入；联网时把名册缓存到本机
      index.tsx  today.tsx    办理（找学生、一位学生连续办理多笔和查询、就地冲正）、今日业务（合计与冲正）
      attendance.tsx          考勤：上班 / 下班、一周的班次、有效班次与工资、上下班记录、工资账户
      me.tsx                  我的
    admin/                    后台（AppShell，导航为总览和本身份可用的各项管理，见 7.9）
      _layout.tsx             后台准入，每项管理只对 4.2 中有权限的身份开放
      index.tsx               总览：按身份显示今日业务、待办、库存不足和管理入口；银行管理员另见最近的余额自检不一致
      students/               学生：查找、批量管理、详情（重置密码、状态、注销）（index、[no]）；导入名册与开户通知单（import）
      staff/                  工作人员：查找、批量管理、新增账号（单个或批量，new）、身份 / 重置密码 / 停用 / 注销（[id]）
      products/               商品：列表、新增与编辑、图片、上架、库存变动（index、[id]）
      stock.tsx               出入库：多件商品一次入库或出库，最近 20 次库存变动
      attendance.tsx          考勤：一周的班次、审查与补签、全部确认、发放工资、参与考勤
      txns.tsx  reports.tsx  流水查询与导出、报表（图表、表格、打印与 PDF）
      settings.tsx  audit.tsx  me.tsx   参数、操作日志、我的
  src/components/             设计系统结构的 React 写法：Shell / Page（AppShell）、Welcome（登录页外观）、
                              Gate（页面准入）、ConfirmSheet / SignOut、Passbook / BookCover / BookShell / BookPages（存折版的存折、封面登录、书签与按页翻动）、Podium（排名领奖台）、TxnList、Notice、Icon、
                              Desk（后台页面框架）、DatePicker / TimePicker（月历选日期、24 小时选时间）、FilterBar（筛选栏）、ScopePicker / TimeRange（学生范围、时段）、Stats / Columns / Line / Bars / Table（报表的数字、图表与表格）、WeekBar / WeekShifts / DayShifts / SalaryAccount（考勤的一周、班次、工资账户）、DutyCard（上班 / 下班）、MeView（我的）、DeviceAccounts（切换账号页的本机账号）、OutputSheet（打印或下载 PDF）、Pick / BatchBar（批量选择）、CloseSheet（注销）、MoveList（库存变动）、LedgerLine（流水一行）、ReversalSheet（冲正）、noticePages / openingPages（开户通知单、期初余额核对表）
  src/theme/                  tokens.css、bundle.css、icons.ts，均由 npm run tokens 生成
  src/lib/supabase.ts         客户端：与页面同源，anon key 取自 window.__DOLPHIN_CONFIG__；请求带 X-Device-Id
  src/lib/session.tsx         会话、本人资料与角色、去向
  src/lib/accounts.ts         本机记住的账号与会话、切换
  src/lib/format.ts           千分位、带符号金额、时间（当年不写年份）、报表期间、姓名脱敏
  src/lib/reports.ts          报表数据类型与报表页面、流水筛选查询与导出
  src/lib/doc.ts              文档页面（标题、数字、表格、图表、签字栏）画成 A4，打印或存为 PDF
  src/lib/duty.ts             上班状态（本机留一份，离线也知道）、上下班记录、下班总结
  src/lib/attendance.ts       考勤与工资：班次、工资账户、中午班与下午班工资的读取，绑定工资账户
  src/lib/txns.ts             流水 → TxnList 的标题、图标与方向
  src/lib/cash.ts             面额合计、配钞与找零（贪心）、「10 元 × 2 张」文字
  src/lib/rpc.ts              调用数据库函数：超时（默认 5 秒）视为离线，错误码转为 AppError
  src/lib/counter.ts          柜台调用账务函数、柜台参数、本机名册
  src/lib/roster.ts           名册模板校验（逐行列出问题）与按学届推算年级
  src/lib/students.ts  staff.ts   后台读取学生与工作账号
  src/lib/errors.ts           错误码 → 界面文字（7.6）
  src/lib/online.ts           是否能连上服务器
  src/lib/offline-queue.ts    离线存款队列与名册缓存（IndexedDB）
  src/lib/pdf.ts              把每页一张 JPEG 写成 A4 PDF
  src/lib/*.test.mjs          单元测试：npm --prefix client test
  e2e/*.spec.ts               端到端测试（Playwright）：admin（名册与账号）、back-office（流水、参数、日志）、
                              counter（柜台）、products（商品与出入库）、reports（报表、导出与柜台查询）、attendance（考勤与工资）、student（学生端）；helpers.ts 为登录等公用步骤
  workbox-config.cjs          Service Worker 配置
  public/index.html           页面模板，先加载 /config.js 和 /fonts/fonts.css
  public/logo.png             海豚云标志
  scripts/gen-tokens.mjs      npm run tokens
  scripts/fonts.mjs           npm run web / build 前把字体复制到 public/fonts（不入库）
  metro.config.js             开发时把 API 路径转发到本地容器，前端与 API 同源
```

`src/lib` 只放数据与业务逻辑，不引用 DOM、CSS 和组件，原生客户端可以直接复用。

页面准入（`Gate`）：未登录去登录页，初始密码去设置新密码，无权限回首页。登录后按身份进入：还在用初始密码 → 设置新密码；学生 → 学生端，柜员 → 柜台，财务 / 库管 / 银行管理员 / 运维员 → 后台。每种身份都有一个总览页作为第一项导航：学生是「首页」（余额卡、排名与最近交易；用过存折版的设备打开存折版的「账户」），柜员是柜台「办理」（搜索框和今天办理过的学生），后台身份是后台「总览」（本身份的今日数据、待办和管理入口）。

### 7.3 设计系统落地

- `npm run tokens` 从 `design-system/project` 生成三个文件：`tokens.json` → `src/theme/tokens.css`（同名 CSS 变量，以及与字号样式同名的类 `.display`、`.title`、`.heading`、`.amount`、`.body-lg`、`.body`、`.caption`），`components/bundle.css` → `src/theme/bundle.css`（去掉 Google Fonts 引用，其余原样），`assets/Icons/*.svg` → `src/theme/icons.ts`。设计系统改动后重新运行并提交生成的文件。
- 页面按设计系统 README 与页面示例写出相同的 HTML 结构和 `dc-` 类名，外观、动效、三种屏宽的布局都由 `bundle.css` 负责，组件里不写颜色和尺寸。断点用 `.dc-app` 的容器查询。
- 登录、设置新密码、账号状态提示都用登录页外观（`Welcome`）；登录后的页面都在 `AppShell` 里：手机底部 `TabBar`，平板图标导航，电脑侧边导航。导航只列出本身份的页面，只有一项时手机上不显示 `TabBar`。
- 空状态（还没有数据、没有符合条件的结果、柜员未上班）都是居中的大卡片：图标、标题、说明和需要时的按钮。
- 退出登录先经 `Sheet` 确认。弹层渲染在 `body` 末尾一个占满视口的 `.dc-app` 里，不受页面容器和进入动画影响。
- 字体：`tokens.json` 的字体顺序不变，前两项换成同一字体的可变字体名（`Nunito Sans Variable`、`Noto Sans SC Variable`），由站点自己提供。
- 金额统一经 `lib/format.ts` 格式化：千分位、单位 `HTB`；收入 `+50`、支出 `−20`（减号 −）；金额字用 Nunito Sans 800、等宽数字。
- 界面文字遵循设计系统「文字与语气」：规范业务用语，结果直接写结果，说明里写清数字和下一步。

### 7.4 本机多账号

一台设备可以登录多个账号并随时切换，例如担任柜员的学生在同一部手机上登录自己的学生账号和柜员账号。

- 每个账号都有「我的」页（学生 `/student/me`、柜员 `/counter/me`、后台 `/admin/me`，都在导航里，后台手机底部导航的最后一项）：本人信息下是「切换账号」、「在此设备保存登录」开关和「退出账号」。「切换账号」打开切换账号页（`/login?switch=1`）：本机账号列表（点一个切换，当前账号标「当前」），列表最后一行是「添加账号」，有多个账号时可「退出全部账号」。「添加账号」打开单独的登录页（`/login?add=1`），登录后加入列表，「返回切换账号」回到列表。
- 在一台设备上首次登录时，登录页有「在此设备保存登录」勾选（默认不勾）。保存的账号连同会话记在本机 `localStorage`，切换回它不用再输密码：当前账号的会话由 supabase-js 保存和续期，切换前把最新会话写回列表，再用目标账号的会话恢复登录。不保存的账号只记显示名和账号，会话只放在 `sessionStorage`：同一标签页刷新仍在登录，关闭标签页、浏览器或主屏 App 后须重新输入密码；切换离开时同样丢弃会话。
- 「我的」里打开「在此设备保存登录」须输入本账号密码确认，当前会话随即转存到 `localStorage`；关闭不需要，会话随即转回 `sessionStorage`。
- 本机账号列表里当前账号标「当前」；点已保存的账号先弹出「你是 柜员小林 吗？」，确认后切换；点未保存的账号弹出密码框；从「添加账号」登录的账号加入列表。
- 退出登录只结束本机这个会话（`signOut({ scope: 'local' })`），并从列表移除；随后回到切换账号页（`/login` 在本机还有账号时就是切换账号页，可点一个切换，或「添加账号」登录新的账号）。
- 「退出全部账号」（本机记住两个以上账号时显示）逐个结束本机所有账号的会话并清空列表，回到登录页；先经 `Sheet` 确认。
- 某个账号的会话已失效（密码被重置、账号被停用，或 7 天未使用）时，切换会失败：该账号从列表移除，提示重新登录；账号被停用时明确提示「账号已停用」。
- 已注销的账号从本机账号列表移除：有账号登录时，打开切换账号页先问服务器（`closed_logins`）列表里哪些已注销，随即移除；点到一个刚注销的账号时提示「这个账号已注销，已从这台设备上移除」。
- 离线队列按柜员账号保存，切换账号不会混用（见 7.7）。

### 7.5 柜台交互

柜员导航四项：**办理**、**今日业务**、**考勤**、**我的**。柜员登录后直接进入「办理」；还没上班时这里只有「上班」卡片，上班后才出现搜索框。

**上班 / 下班**（「办理」和「考勤」顶部的 `DutyCard`）：「上班」后开始办理业务。「下班」先生成「柜员下班总结」：本次上班以来本人办理的每一笔业务（时间、交易号、学生、业务、金额、状态）和存款、取款、兑换合计，底部留柜员、复核人签字和日期；打印（或下载 PDF）、签字留存后，再确认下班（`end_duty`，总结过时则提示重新打印）；也可「跳过打印」，直接确认下班。上班状态在本机留一份，离线重新打开也知道；本机没有记录又读不到时（首次加载、网络或服务异常），「办理」只显示读取中或「暂时无法确认上班状态」和「重试」，不打开柜台；但已经断网时打开柜台，只能离线登记存款（服务器补传离线存款不要求上班）。上班状态和本人信息跟会话存在同一处：在此设备保存登录的账号存在本机，未保存的只存到关闭标签页为止。

**办理**：一位学生到柜台办理的全过程，版式按设计系统页面示例 `CounterServicePage`（柜台办理），整个过程不跳页。

1. **找学生**：在搜索框（`SearchField`）输入姓名、拼音全拼或首字母（`zxm`）、班级（「四年级1班」）或学号，结果即时列出（姓名、班级、学号）；学号开头的匹配排在前，只有一个结果时按回车直接选中。点一下学生即读取余额并进入办理。搜索框为空时列出「今天办理过的学生」，点一下就能再次办理。
   - 搜索在本机名册上进行（`lib/search.ts`，拼音由 `pinyin-pro` 生成，姓氏按姓氏读音），联网与离线相同。
2. **办理业务**：
   - 顶部学生条（`PersonCard` 样式）：大字姓名、班级与学号，柜员据此当面核对本人；今日还可取金额（账户冻结或毕业时一并注明）、当前余额，右侧「换一位」（已办业务时为「结束办理」）。
   - `Segmented` 选择 存款 / 取款 / 兑换 / 查询，切换只换下方录入区。
   - 左栏录入：存款每个面额一行「− 张数 +」；取款输入金额，显示配钞方案（如「10 元 × 2 张、5 元 × 1 张」），超出余额、单笔或今日限额时提示原因；兑换选商品（库存为 0 置灰）、调整数量、选付款方式，现金支付时录入收到的各面额张数，显示找零方案。
   - 右栏「办理单」：本次已办的每一笔（名称、面额或付款方式、交易号，金额 `+22` / `−10`，现金兑换写「现金」）和它的「冲正」按钮，正在录入的这笔和办理后余额，底部「结束办理（已办 N 笔）」。手机上办理单在录入区下方。
   - 贴底操作栏只有当前业务的合计和主按钮，主按钮写明金额（「确认存款 22 HTB」）。存款点一下即办理；取款和兑换会付出现金或扣减余额，点主按钮后在确认框里核对金额、配钞或商品、付款方式与办理后余额，再确认办理。超出可取范围时主按钮写明原因并禁用。录错时在办理单这一笔上点「冲正」改正。
   - 办完一笔：这笔进入办理单，录入区清空，余额重新读取，可以接着办下一项。
3. **结束**：点「结束办理」（或标题行返回）回到搜索框，上方提示「张小明：办理完成」，逐笔写出业务和金额与当前余额，光标已在搜索框，可以直接查找下一位。

查询：学生条里一直显示余额与今日还可取金额。`Segmented` 的第四项「查询」占满整个宽度（不显示办理单，切换到其他业务时再出现）：一行数字写当前余额、累计存入、累计取出、累计账户兑换；下面是与流水相同的筛选栏（搜索交易号或商品、日期、类型、按时段）和全部交易记录（含其他柜员办理的和以前的，`student_txns`），每笔写明时间、经办人、交易号和办理后余额，每次 10 笔、「加载更多」继续；本次办了业务后记录随之更新。需要联网。

**考勤**：顶部是上班 / 下班（未参与考勤时提示上下班照常、班次不计工资）；考勤按周显示（「上一周 / 下一周 / 本周」，或点日期从月历跳到所在的一周），一行数字写这周的有效、待审、工资和已发；下面每天一行中午班、下午班，写明有效、待审、未通过或未上班和打卡时间；右栏是这一周的上下班记录（上班、下班时间和总结笔数）和「工资账户」：已绑定时显示学生姓名和学号，可更换（参与考勤期间不能解除），未绑定时输入学号和该学生账户的密码绑定。上下班需要联网。

**冲正**：一个 `Sheet` 里写明业务和交易号，选择原因（「其他」须写说明）后「确认冲正」。入口有三处：办理单上的每一笔、「今日业务」的每一行（柜员只能冲正本人今天的业务），以及后台「流水」的每一行（银行管理员）。

**今日业务**：今天本人办理的全部业务，最新在前，可按姓名、学号或交易号筛选；每一行写明学生、业务、交易号、时间（已冲正的注明，冲正行写原因），带「冲正」和「继续办理」（打开「办理」并直接选好这位学生，`/counter?s=学号`）。右栏「今日合计」：存款、取款、兑换各几笔、共多少 HTB（不含已冲正的）。需要联网。

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
| `STUDENT_INACTIVE` | 账户不可办理 | 该账户已冻结或已毕业（已注销的写「该账户已注销」），请联系银行管理员。 |
| `INVALID_AMOUNT` | 金额有误 | 请输入正整数金额，并使用柜台列出的面额。 |
| `TXN_NOT_FOUND` | 未找到该业务 | 请核对交易号。 |
| `FORBIDDEN` | 没有权限 | 当前账号不能办理这项业务。 |
| `INVALID_INPUT` | 填写有误 | 请检查 {field}（名册导入时为第 {row} 行）。 |
| `ALREADY_EXISTS` | 已存在 | {field} 已被使用。 |
| `ONE_BANK_ADMIN` | 银行管理员只有一个 | 不能新增银行管理员，也不能更改银行管理员的身份。 |
| `USER_NOT_FOUND`、`PRODUCT_NOT_FOUND` | 未找到 | 请刷新后重试。 |
| `SELF_SERVICE_FORBIDDEN` | 不能为自己办理 | 这是你本人或你的工资账户，请由其他柜员办理。 |
| `OFF_DUTY` | 还没有上班 | 请先点「上班」，再办理业务。 |
| `STALE_DUTY` | 上次上班还没下班 | 这次上班从 {started_at}（M月D日 HH:mm）开始，已经跨天。请先下班，再重新上班办理业务。 |
| `LAST_SYSADMIN` | 至少保留一个运维员 | 这是最后一个在用的运维员账号，不能停用、注销或改为其他身份；请先新增一个运维员。 |
| `SUMMARY_STALE` | 下班总结已过时 | 打印后又办理了业务，请重新打印下班总结。 |
| `ATTENDANCE_REVIEWED` | 已经审查过 | 审查后的班次不能再修改。 |
| `ATTENDANCE_PENDING` | 还有待审的班次 | 还有 {count} 个班次没有审查，全部审查后才能发放工资。 |
| `ATTENDANCE_ON` | 正在参与考勤 | 工资账户在参与考勤期间不能解除；请先关闭参与考勤。 |
| `SALARY_UNBOUND` | 还没有绑定工资账户 | 先绑定工资账户，再开启参与考勤。 |
| `ACCOUNT_CLOSED` | 账号已注销 | 注销的账号不能再修改。 |
| `WRONG_PASSWORD` | 密码不对 | 请输入该学生账户的登录密码；连续输错 5 次，该学生账号会锁定 15 分钟。 |
| `LOGIN_LOCKED` | 该学生账号已锁定 | 密码错误次数过多，请 15 分钟后再试。 |
| 网络中断（存款以外） | 网络已断开 | 联网后再办理这项业务；存款可以继续离线登记。 |

### 7.7 离线存款

- 柜员进入柜台时读取名册（学号、姓名、班级）并保存在本机，退出登录时清除；离线时在本机名册上搜索和核对学生。
- 判断离线：`navigator.onLine` 为假，或请求超时（5 秒）/ 网络错误。柜台顶部显示「离线登记」状态条，「办理」里只有存款可选，取款、兑换置灰。联网办理存款时请求没有回应，也按离线登记，用同一个 `p_id` 上传，不会重复入账。
- 离线时只开放存款：「办理」里取款、兑换置灰，「冲正」页显示「需要联网」并提供「去登记存款」。存款记录（含客户端 UUID、面额、学号、柜员 id、设备号、本机时间）写入 IndexedDB，结果页显示「已登记存款 15 HTB，联网后入账」，不显示余额。柜员同时按 SOP 填写纸质凭条。
- 恢复联网后，柜台各页顶部提示「有 N 笔离线存款待上传」，点「上传」按本机时间顺序逐笔调用 `deposit`（`p_offline = true`）。成功一笔删一笔；因幂等，中途断开重传不会重复记账。
- 队列记录了柜员 id：只有同一柜员登录时才能上传，其他人登录时只显示待上传数量和柜员姓名。
- 服务端拒绝的记录（如学号已不存在）保留在队列中并标红，不再重传；由银行管理员核对纸质凭条后，柜员点「已核对，移除」清除。
- 断网时重新打开柜台：Service Worker 提供应用外壳和 `/config.js`，本人资料、柜台参数（面额、限额）和名册都有本机副本，仍可登记存款。前提是这台设备联网打开过一次柜台。

### 7.8 浏览器支持

- 柜台：iPad Safari 16+、Android Chrome 105+（横屏，最小宽度 1024px）。
- 后台：Chrome、Edge 最新两个大版本（最小宽度 1280px，内容最宽 1080px 居中按设计系统）。
- 学生端：iOS Safari 16+、Android Chrome 105+、微信内置浏览器（单列，最小宽度 360px）。
- 这些版本起支持设计系统用到的容器查询和 `:has()`。

### 7.9 后台

后台导航为「总览」和本身份可用的各项管理（4.2）；手机底部 `TabBar` 最多 5 项，其余从总览宫格进入。每页标题行下写当前账号的显示名（银行管理员显示「银行管理员」），「我的」在导航里；有查找卡片的页面，页面自己的操作（导入名册、新增账号、打印 / 导出）放在卡片最后一行的右端；商品页的新增商品放在内容第一行，左边是计数。数据加载时各页显示与真实布局同形的骨架屏（`components/Skeleton.tsx`），超过 10 秒换成「加载时间比平时长」提示，一页只出一条。读取整个名册时按每页 1000 行分页读取（接口单次最多返回 1000 行，`lib/supabase.ts` 的 `readAll`）。

- **行长**：看到的页面和能办的事与银行管理员相同；「学生」「工作人员」只读（名单、详情、余额、工资账户），没有「选择」、「新增账号」、「导入名册」、「开户通知单」和账号详情里的修改按钮，总览没有账号待办；直接打开导入名册、新增账号的地址回到总览。
- **总览**：自检不一致提示、管理入口宫格，然后按身份显示：财务、银行管理员看今日存款、取款、兑换的笔数和金额（不含已冲正）、账户余额合计和最近 8 笔流水；银行管理员、运维员看待办（未设置新密码的学生、已停用的工作人员账号）；库管、银行管理员看库存不多于安全库存的已上架商品（`products.low`，0 件标「缺货」）和最近库存变动。每一项都点进对应页面，并已带好筛选条件。
- **页面互通**：流水的筛选条件可以写在地址里（`student`、`operator`、`from`、`to`、`type`），其他页面据此直接打开筛选好的流水。学生详情有「查看全部流水」；人员详情里柜员账号有「查看他办理的流水」，所有账号有「操作日志」（日志按操作人筛选，可取消）；日志条目链到它涉及的工作人员账号、学生、商品，冲正记录链到该学生的流水，只显示本身份能打开的页面。
- **学生**（银行管理员、运维员）：按姓名、拼音、班级或学号查找（同柜台的 `lib/search.ts`），列表注明「未设置密码」和冻结、毕业，每次列出 100 人，「显示更多」继续；已注销的学生不出现。「选择」后每行前出现勾选框，底部操作栏对勾选的学生批量冻结、恢复正常、标记毕业（银行管理员）、重置密码（随后打印或下载新的开户通知单）或注销，均经确认，部分失败时逐人写明原因。「开户通知单」一次为所有还未设置新密码的学生重新生成初始密码（`reissue_passwords`，确认后旧通知单失效）；银行管理员还有「期初余额核对表」和「导入名册」（新增与修改学生）。学生详情显示班级、学届、学号、学部、账户状态、登录状态，「重置密码」经 `Sheet` 确认，新初始密码只显示一次；银行管理员另见余额和最近 10 笔交易（含现金兑换），并可冻结、解冻、标记毕业或恢复为在读（`set_student_status`，均经确认）；「注销账号」写明余额将清零，再次确认后注销（`close_accounts`）。运维员看不到余额。
- **导入名册**（银行管理员）：选择 Excel 或 CSV → 逐行校验（`lib/roster.ts`，问题按行号列出，全部改好才能导入）→「核对名册」显示各学部人数与期初余额合计 →「确认导入」每 100 人一批并显示进度 → 「导入完成：新开户 N 人，更新 M 人」→「开户通知单」（打印或下载 PDF）。页面提供「下载模板」。某一批被拒绝时，说明哪个学号有问题、前面已导入多少人；改好后重新导入整个名册即可。
- **打印与 PDF**：所有文件（开户通知单、期初余额核对表、工作人员密码单、流水、报表、下班总结）都经同一个 `OutputSheet`：「打印」直接打开打印对话框（页面图片放进隐藏的 iframe），「下载 PDF」存为文件。
- **开户通知单**：在浏览器里生成（`开户通知单-日期-N人.pdf`），每人一页 A4，按班、按学号排列。每页由设计系统的部件组成，尺寸和颜色与界面一致：顶部是登录页头图（标志与波纹、「海豚云」、学校与日期、`WaveDivider`），下面依次是 `display` 问候语、`dc-card` 里的核对清单（班级、学号，初始密码作为合计行）、`Steps` 三步登录说明（含登录网址和新密码规则；网址取服务器配置的正式地址 `https://$DOLPHIN_DOMAIN`，与打开后台用的地址无关）和默认 `Notice` 保管提醒。页面用设计系统的 token、字体和图标画在 canvas 上再存为 JPEG（`lib/pdf.ts` 写出 PDF），不嵌入字体，约 140 KB 一页。
- **期初余额核对表**：每班一页（`lib/doc.ts`），列出学号、姓名、系统期初余额（`opening` 流水金额，没有则为 0），留空「原账本余额」和「一致」两栏，表头写本班人数与合计，表尾留核对人签字和日期。
- **工作人员**（银行管理员、运维员）：按姓名或账号搜索，列表显示姓名、身份、账号和未设置密码状态；已停用的账号默认不列出，点「已停用」查看；已注销的不出现。「选择」后批量停用或启用、重置密码（随后打印或下载密码单，含签收栏）、注销（银行管理员和自己的账号不能选）。「新增账号」填写账号、姓名、身份，创建后提示初始密码；下方「批量新增」每行写账号、姓名和身份（不写为柜员），可从表格粘贴，创建后打印或下载密码单。账号详情可改身份、重置密码、停用或启用、注销（不能停用或注销自己和银行管理员）；柜员账号另有「参与考勤」开关（银行管理员，须先绑定工资账户）和工资账户的绑定、更换、解除（银行管理员、运维员，须输入该学生账户的密码；参与考勤期间不能解除）。运维员不能创建银行管理员，也不能修改银行管理员的账号，页面显示「由银行管理员管理」。
- **商品**（库管、银行管理员；财务只读）：列表显示图片、名称、价格、库存和上架状态，缺货的标「缺货」，内容第一行有「出入库」。编辑页填写名称、价格、成本、分类、安全库存（默认 5 件）、图片（可更换、移除）和是否上架；已有商品另显示当前库存、最近 10 次库存变动和「去出入库」。财务打开的是「商品详情」：名称、价格、成本、分类、安全库存、上架状态和库存变动，没有编辑、新增和出入库入口。
- **出入库**（库管、银行管理员）：可带商品打开（`?product=`，预填入库 1 件），卡片和库存变动里的商品名链到商品页；`Segmented` 切换入库 / 出库；每件商品一张 `QtyStepper` 卡片（名称、当前库存、加减数量），出库数量不超过库存；入库可写备注，出库须写原因；下方合计后「确认入库 / 确认出库」一次提交（`stock_move`）。右栏（手机在下方）是全部商品最近 20 次库存变动，写明商品与备注。
- **学生范围**（报表）：与柜台相同的搜索（姓名、拼音全拼或首字母、班级、学号），结果里除了学生，还有名称匹配的整个班级和整个学部（各注明人数）；选中后显示为一个标签，点一下或「全部学生」取消。
- **筛选栏**（流水、日志、柜台查询、学生明细共用 `FilterBar`）：一张卡片，自上而下是搜索框、已选条件的标签、「从 / 到」两个 `DatePicker`（留空为不限，今天之后不能选）、类型标签与「按时段」（打开每天的时段，两个 `TimePicker`；日志没有时段）。条件一改列表即更新。卡片最后一行的右端固定放「清除条件」和这一页的打印、导出按钮（「打印 / 导出」）。报表的条件卡片、学生与工作人员的查找卡片用同样的排版：搜索在上，标签在最后一行左边，页面操作在右边。
- **流水**（财务、银行管理员）：搜索框输入姓名、拼音、班级、学部、柜员姓名或交易号，下面列出匹配的学生、整个班级、整个学部、柜员和「交易号含…」，选中后成为一个可去掉的标签（已停用的柜员不在其中）；再按日期、类型（存款、取款、兑换、冲正、工资、期初、注销清零）和时段筛选，最新的在前，每次加载 50 笔，显示符合条件的总笔数。每一行可以展开看完整信息，已冲正的写明原因和冲正交易号；银行管理员从展开处进入学生和经办人页面，并可直接冲正正常状态的期初、存款、取款、兑换（`ReversalSheet`）。「打印 / 导出」打印符合条件的全部流水，或下载 PDF、Excel。
- **报表**（财务、银行管理员）：期间用「今天 / 本周 / 本月 / 上月」一键选，也可用「从 / 到」选任意日期（最长一年）；「按时段」和学生范围可选，条件一改报表即更新（`bank_report`）。同时读取紧挨着的上一个同样长的期间，主要数字下写「比上期 +12%」。四个标签页，每项都有图表和表格：
  - 营业：存款、取款、兑换、冲正、办理业务的学生；每日存款 / 取款 / 兑换金额柱状图（期间多于一天时，附按日明细表）；营业时段柱状图；按柜员条形图与表格。
  - 账户：学生、办理过业务、期末账面余额、中位数、最高余额、冻结 / 毕业 / 注销（「学生」含已注销的账户）；期末余额分布柱状图；按班级条形图与表格（含合计）。
  - 财务：余额核对（期初 + 各类变动 = 期末，含注销清零，一致时显示「核对一致」）与日终账面余额折线图；柜面现金收入、付出、净额。
  - 商品：兑换数量条形图，兑换金额、账户 / 现金支付、成本、毛利表；库存期初、入库、出库、兑出、期末表。
  - 图表每张只有一个系列（存款、取款、兑换用各自的类别色，其余用海豚蓝）：柱状图和折线图左侧有取整的刻度和虚线网格，标题旁写合计；条形图写数值和占比；悬停显示数值。样式在 `app.css` 的 `rp-` 类里，用设计系统的 token。
  - 「打印 / 导出」见 6.8。
- **考勤**（银行管理员）：一周一页（「上一周 / 下一周 / 本周」，或点日期从月历跳到所在的一周），每个参与考勤（或这周有记录）的未停用柜员一行，周一到周日每天两个班次标记，后面是有效班次数和工资，姓名下注明工资账户。点一个待审班次：选「有效 / 未通过」并可写说明，「下一步」后再次确认；审查过的班次只显示、不能点开；过去未上班的班次可「补签」，须写说明。「全部确认（N）」一次确认这一周全部待审班次（经确认）。「发放工资」在到这周日为止还有待审班次时不可用；可用时先列出每位柜员有效、未发放的班次数、金额和工资账户（未绑定的注明本次不发放），确认后发放并显示结果。下方「参与考勤」每位柜员一个开关，未绑定工资账户时不能开启并提示「去绑定」。
- **参数**（银行管理员）：面额用 `FilterChips` 勾选（1、2、5、10、20、50、100 元，1 元必选）；两个学部的单笔与单日取款上限用 `QtyStepper`（每次 ±10，也可直接输入）；排名人数用 `QtyStepper`（1～100）；升年级日期用 `DatePicker`（只取月、日）；中午班、下午班的工资各一个 `QtyStepper`（1～10000）。「保存参数」一并保存改动的项；「排名匿名」开关切换后立即生效。
- **日志**（银行管理员、运维员）：最新的在前，每次加载 50 条；每条写明操作、操作人、时间、设备与 IP，展开后列出改动的字段（旧值 → 新值）。上方是筛选栏：搜索框找工作人员（含已停用、已注销的，只看他的操作）、学生（他自己的操作和关于他的记录）或操作名称，选中后成为可去掉的标签；再按日期和类型（账号与登录、学生、冲正、商品、参数、考勤与工资、备份与自检）筛选。从人员详情的「操作日志」进入时已选好该操作人。

### 7.10 学生端

学生导航四项：**首页**、**明细**、**排名**、**我的**。

- **明细**：`Tabs` 全部 / 存款 / 取款 / 兑换 / 工资；下面是筛选栏（搜索交易号或商品、日期、按时段），按天分组，每次加载 30 笔，「加载更早的交易」继续；现金兑换注明「现金支付，余额不变」。右栏（手机在下方）是本月存款、工资、取款、兑换（含现金支付）四项合计，不含已冲正的业务。
- **我的**：见 7.4。
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
  seed.sql              开发种子数据（银行管理员 `admin`、运维员 `ops01`、柜员 `teller01`、行长 `president01`、财务 `accountant01`、库管 `keeper01`、三名学生、商品与几笔交易；密码均为固定测试密码 `a12345678`）
docker/
  Dockerfile            多阶段构建，开头 ARG 锁定组件版本
  smoke-test.sh         单容器冒烟测试（M0）
  upgrade-test.sh       从指定的旧提交升级到新镜像：迁移、升级前备份、余额与库存不变、自检
  rollback-test.sh      从指定的旧提交升级到新镜像再按 9.5 回滚：库结构与余额、库存恢复到备份时，旧镜像正常办理
  db-test.sh            在镜像上运行 supabase/tests 的 pgTAP 测试（M1）
  perf-test.sh          全校规模（2000 名学生、10 万笔流水）的性能与越权修改检查
  Caddyfile
  supervisord.conf
  init/                 首次初始化：Supabase 所需角色与 schema
  bin/                  入口脚本、迁移执行、定时备份、定时任务、运维命令 dolphin（见 9.3）
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

```bash
docker/upgrade-test.sh <生产环境当前的提交>
```

```bash
docker/rollback-test.sh <生产环境当前的提交>
```

`e2e-test.sh` 用镜像起一个新容器（端口由 Docker 分配本机空闲端口），导入种子数据并留一份数据快照，再运行 `client/e2e` 的 Playwright 测试，结束后删除容器和数据卷。每个 spec 开始前把数据恢复到快照（只清空、重灌表数据和图片文件，服务连接不断），互不依赖执行顺序。Chromium（1180×820）跑全部，WebKit 跑柜台和学生端，iPhone 13 尺寸跑学生端。首次运行前执行一次 `npx --prefix client playwright install chromium webkit`。

前端检查：`npm --prefix client run typecheck`、`npm --prefix client run lint`（ESLint，`eslint-config-expo`）、`npm --prefix client test`。生产镜像使用官方 Postgres，迁移中只使用 Postgres 自带扩展（`pgcrypto`、`dblink` 仅测试用），不依赖 Supabase 托管版独有扩展。

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
2. 每次启动：若数据库已有数据且镜像版本变化，先做一次升级前备份；Postgres 就绪后依次启动 Auth、Storage（各自执行内置迁移），执行 `supabase/migrations/` 中未应用的迁移（记录在 `app_migrations` 表，含每个文件的 sha256；已应用的文件内容变了就停止迁移并报错，`dolphin health` 随之失败；同一时间只有一个迁移进程），再启动 PostgREST 与 Caddy。
3. 生成 `/config.js`，内容为站点地址与 anon key。

首次启动后创建第一个银行管理员账号（命令打印初始密码，登录后设置新密码）：

```bash
docker exec -it dolphin-cloud dolphin create-admin admin
```

### 9.3 运维命令

| 命令 | 作用 |
| --- | --- |
| `dolphin create-admin <账号>` | 创建银行管理员账号（全系统一个），打印随机初始密码 |
| `dolphin reset-admin` | 银行管理员忘记密码时，生成并打印新的初始密码，解除停用和登录锁定，下次登录设置新密码 |
| `dolphin backup` | 立即备份 |
| `dolphin backups` | 列出备份文件 |
| `dolphin restore <文件名>` | 恢复指定备份：停止 API 进程和定时任务 → 把备份恢复到一个新库，成功后替换原库（备份之后新增的表、函数等不会留下；恢复失败时原库不变）→ 恢复图片 → 启动；恢复前自动再备份一次当前数据。加密备份从标准输入读私钥：`docker exec -i dolphin-cloud dolphin restore <文件名> < backup-key.txt` |
| `dolphin check` | 运行 `app_private.check_balances()` 并输出结果；有不一致时退出码为 1 |
| `dolphin jobs` | 定时任务（PHASE-2.md §13）每个任务处理到哪天、最后成功时间、最近一次失败，以及当前学期 |
| `dolphin jobs run` | 立即补跑定时任务到昨天（周任务到今天的周一）；有任务失败时停在那天，退出码为 1 |
| `dolphin status` | 各进程状态、版本、最近一次备份时间、备份是否加密、定时任务是否正常 |
| `dolphin health` | 镜像的 `HEALTHCHECK`：Auth、PostgREST、Storage 各自应答且 Caddy 在运行 |

### 9.4 备份

- 备份目录权限 700、备份文件 600；备份与恢复都写入 `audit_log`（`backup.create` / `backup.restore`）。
- 每天 `BACKUP_TIME` 执行：`pg_dump -Fc` 全库 + `/data/storage` 打包为 `/data/backups/dolphin-YYYYMMDD-HHMM.tar.gz`，保留 `BACKUP_RETENTION_DAYS` 天。
- 设置 `BACKUP_RECIPIENT` 后备份用 [age](https://age-encryption.org) 加密为 `.tar.gz.age`，容器里只有公钥，没有私钥的人打不开备份。生成密钥：`docker run --rm --entrypoint age-keygen dolphin-cloud > backup-key.txt`，文件里 `# public key:` 后面就是公钥；`backup-key.txt` 离线保管（密码管理器或加密 U 盘），丢失后加密备份无法恢复。未设置时备份不加密，`dolphin backup`、`dolphin check` 和容器启动日志都会提示。
- 备份后运行 `dolphin check`；发现不一致时写入 `audit_log`，后台首页对银行管理员显示提示。
- 建议把 `/data/backups` 单独挂载到另一块磁盘或 NAS：`-v /mnt/nas/dolphin-backups:/data/backups`。
- 每学期末把当期备份复制归档一次，并在测试机上演练一次 `dolphin restore`。

### 9.5 升级

1. 拉取新版本镜像。
2. `docker stop dolphin-cloud && docker rm dolphin-cloud`。
3. 用同样的参数和数据卷以新标签启动；入口脚本自动备份并执行迁移。
4. 回滚：用旧标签启动，再用新镜像里的 `dolphin` 恢复升级前的备份，步骤见下面的「回滚演练」第 5 步。

升级安排在非营业时段进行。

#### 回滚演练

在正式服务器上完整做一次升级 → 回滚 → 再升级，确认出问题时能退回旧版本。安排在非营业时段，从第 2 步备份到第 5 步恢复之间不办理任何业务：恢复会退回到备份时的数据，期间办理的业务不会保留。`docker/rollback-test.sh` 在测试机上按同样的步骤运行，CI 每周从一周前的 `main` 跑一次。

下面的命令以容器名 `dolphin-cloud` 为例；`docker run` 的参数用该服务器平时启动时的那一组（数据卷、端口、`DOLPHIN_DOMAIN`、`BACKUP_RECIPIENT` 等），只换镜像标签。

1. **记下当前镜像标签**（即旧标签），并确认现状正常：

   ```bash
   docker inspect -f '{{.Config.Image}}' dolphin-cloud
   ```

   ```bash
   docker exec dolphin-cloud dolphin health && docker exec dolphin-cloud dolphin check
   ```

2. **备份并记下文件名与抽查数字**。`dolphin backup` 最后一行是备份文件路径，记下文件名；再记下账户数、余额合计、库存合计和两三个学生的余额：

   ```bash
   docker exec dolphin-cloud dolphin backup
   ```

   ```bash
   docker exec dolphin-cloud psql -U postgres -qAt -c "select count(*), sum(balance) from accounts" -c "select sum(stock) from products" -c "select student_no, balance from accounts order by student_no limit 3"
   ```

3. **升级**：拉取新标签，按 9.5 第 2、3 步换成新标签启动；入口脚本会再备份一次并执行迁移。`dolphin status` 里的 `version` 变为新版本、`dolphin health` 通过即启动完成。

4. **验证新版本**：`dolphin health`、`dolphin check` 通过；用一个工作账号登录，打开柜台和后台首页；第 2 步的数字不变。

5. **回滚**。先从新镜像取出 `dolphin`：新镜像的 `restore` 把整个库换成备份时的样子；`fccdee6` 等较早的镜像自带的 `restore` 逐个删除并重建备份里的对象，会被新版本加在旧表上的外键挡住，也不会删除新版本新增的表和函数。

   ```bash
   docker run --rm --entrypoint cat <新标签> /usr/local/bin/dolphin > dolphin-restore
   ```

   ```bash
   docker stop dolphin-cloud && docker rm dolphin-cloud
   ```

   用第 1 步记下的旧标签、同样的参数启动，等 `dolphin health` 通过；此时库仍是新版本的结构，立即接着恢复，其间不要办理业务或运行其他 `dolphin` 命令（`create-admin`、`reset-admin` 要等恢复后才能用）。

   ```bash
   docker cp dolphin-restore dolphin-cloud:/tmp/dolphin-restore
   ```

   把离线保管的私钥 `backup-key.txt` 临时放到服务器上，恢复第 2 步的备份（私钥从标准输入读入），完成后删除服务器上的私钥：

   ```bash
   docker exec -i dolphin-cloud bash /tmp/dolphin-restore restore <第 2 步的备份文件名> < backup-key.txt
   ```

   ```bash
   rm backup-key.txt dolphin-restore
   ```

   恢复前会自动备份一次升级后的数据，输出里的 `Backing up current data first:` 就是这份备份。

6. **回滚后的验证**：

   ```bash
   docker exec dolphin-cloud dolphin health && docker exec dolphin-cloud dolphin check && docker exec dolphin-cloud dolphin status
   ```

   `dolphin status` 的 `version` 为旧版本；再运行第 2 步的抽查命令，账户数、余额合计、库存合计和抽查学生的余额与第 2 步记下的一致；用一个工作账号登录，打开柜台和后台首页。

7. **重新升级**：演练到此结束，按第 3、4 步再换回新标签。

8. **记录**：在 [ACCEPTANCE.md](ACCEPTANCE.md) 新增一节「日期 · 回滚演练」，写明：
   - 日期、操作人、服务器；
   - 旧标签与新标签（含 `sha-` 提交号）；
   - 第 2 步的备份文件名，第 5 步恢复前自动生成的备份文件名；
   - 每一步的开始时间，以及从停止旧容器到回滚后验证通过、从回滚到重新升级完成的停机时长；
   - 第 1、4、6 步 `dolphin health`、`dolphin check` 的结果，第 6 步 `dolphin status` 显示的版本；
   - 第 2 步与第 6 步的账户数、余额合计、库存合计和抽查学生的余额，是否一致；
   - 遇到的问题和处理办法；没有问题也写明「无」。

   记录完成后，GATE-007 的「正式服务器上的镜像回滚演练」即有了证据。

### 9.6 安全

- 只开放 80/443；Postgres、各 API 端口只监听 `127.0.0.1`。
- Caddy 设置 HSTS、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options DENY`、CSP（只允许同源脚本，`frame-ancestors 'none'`）；`/storage/v1/*` 的响应另加 `default-src 'none'; sandbox`，上传的文件不能在本站执行脚本。
- 图片桶只接受 `image/jpeg`、`image/png`、`image/webp`，单个文件不超过 5 MB。
- 除 Postgres（自行降权）和证书监视外，各服务以低权限用户 `dolphin` 运行；Caddy 通过 `cap_net_bind_service` 监听 80/443。入口脚本每次启动把 `/data/run`、`/data/storage`、`/data/caddy`、`/data/backups` 交给 `dolphin`。
- Auth 关闭注册与邮件发送；访问令牌有效期 1 小时，刷新令牌 7 天未使用即失效。
- 学校出口 NAT 时所有校内设备共用一个公网 IP：Auth 的登录限速按 IP 计算，需将 `GOTRUE_RATE_LIMIT_TOKEN_REFRESH`、`GOTRUE_RATE_LIMIT_VERIFY` 等调到能容纳全校同时登录的水平，并让 Auth 信任 Caddy 传入的 `X-Forwarded-For`。
- 初始密码每人不同，只印在本人的开户通知单上，通知单当面发放；本人发现无法登录时由银行管理员重置。登录成败都记入 `audit_log`，后台「日志」可查连续失败与锁定；成功的登录由 `note_login` 补记设备与 IP。
- 不采集身份证号、家庭住址、家长信息。

---

## 10. 测试

| 层级 | 工具 | 覆盖内容 |
| --- | --- | --- |
| 数据库 | pgTAP（`supabase/tests/`） | 每个函数的角色校验；禁止透支；单笔 / 单日限额；每个账号一种身份；幂等重复提交；库存不足与并发兑换（两个会话同时买最后一件，只有一个成功）；冲正的四条规则；流水不可删改；`check_balances()` 能发现人为制造的不一致；导入重复学号不重复开户；柜台查询翻页与经办人，报表各项数字（不含已冲正的、期初 + 变动 = 期末、库存期初 + 入库 − 出库 − 兑出 = 期末）、时段、学部 / 班级 / 学生范围与以前的期间；上班才能办理、跨天未下班不能办理（下班后重新上班可办理）、上下班记下班次（一个班次只记一次）、下班总结笔数核对、补签与审核的权限（审查一次）、参与考勤前须绑定工资账户、工资账户的密码与锁定计数、不能为工资账户办理业务、有待审班次时不能发放、停用柜员不发放、按周发放与不重复发放（两台设备同时发放也只发一次）、`salary` 流水不能冲正且不破坏余额自检；8 位数字初始密码；注销账号（余额清零、不能注销自己和银行管理员、余额自检一致）；跨午夜的下班总结、最后一个运维员、工资账户须在读、发行登记日期不晚于今天；行长（多个、有银行管理员的业务权限、管理账号的函数和登记发行全部拒绝）；柜台查询按类型、商品和日期筛选；登录后补记设备与 IP（只改本人最近一次登录，重复调用不改动）；报表统计已注销人数。运行：`docker/db-test.sh [镜像]`，在临时容器中逐个执行 `supabase/tests/*.sql` |
| 前端单元 | `npm --prefix client test` | `cash.ts` 合计、配钞与找零；`search.ts` 按学号、姓名、拼音、首字母、班级搜索与排序，学生范围里的班级与学部；离线队列按柜员、按时间上传，失败保留并标记，断网停止；`format.ts` 金额、时间、报表期间（周一起算）、姓名脱敏与班次（13:30 分界）；`roster.ts` 名册模板逐行校验与年级推算 |
| 端到端 | Playwright（`docker/e2e-test.sh`），对构建好的生产镜像运行 | 柜员存款、取款、账户兑换、现金兑换，办理单与今日业务里冲正 → 学生看到余额与明细；离线存款后恢复网络上传；新设备读到上班状态前断网仍能离线登记；断网重新打开柜台；银行管理员导入名册（含逐行报错）→ 新学生首次登录设置新密码 → 银行管理员重置密码；新增工作账号、改身份、停用，运维员不能管理银行管理员；商品新增、出入库、上下架；流水按搜索（学生、柜员、交易号）、时段、类型筛选与冲正、流水导出；报表数字、标签页、时段与 PDF 导出；柜台查询全部交易记录与筛选；柜员上班才能办理、下班打印总结；柜员绑定工资账户 → 银行管理员开启考勤 → 上下班记下班次 → 审查、全部确认、补签、发放工资 → 柜员看到已发工资、学生明细里有工资；批量管理学生与工作人员、注销账号；我的页与在此设备保存登录（未保存的账号重新打开后须登录）；行长看到全部业务页面、学生与工作人员只读；总览待办、页面间跳转、参数开关、日志；学生明细（按类型、搜索）与排名。备份恢复由 `smoke-test.sh` 覆盖 |
| 性能 | `docker/perf-test.sh`：新容器经 `import_roster` 导入 2000 名学生、写入 10 万笔流水后计时，并以各身份直接请求修改余额、库存和流水 | 2000 名学生、10 万笔流水下：账务函数 < 1 秒，学生首页 < 2 秒，全校一年的报表 < 5 秒，流水导出每页 1000 行 < 2 秒；直接修改全部被拒，`dolphin check` 一致 |

CI（GitHub Actions，`.github/workflows/ci.yml`）：每次推送和每个 PR 先运行类型检查与单元测试，再构建镜像，在镜像上运行 `docker/db-test.sh` 与 `docker/e2e-test.sh`；端到端测试失败时上传 Playwright 结果。推送到 `main` 且全部通过后，把镜像推送到 GHCR（见 9.1）。每周一次（也可手动触发）另跑 `docker/perf-test.sh`、`docker/upgrade-test.sh` 和 `docker/rollback-test.sh`，后两者从一周前的 `main` 升级到当前镜像，`rollback-test.sh` 再按 9.5 回滚到一周前的 `main`。

---

## 11. 里程碑

| 里程碑 | 内容 | 完成标准 |
| --- | --- | --- |
| M0 技术验证 | 单容器镜像：Postgres + Auth + PostgREST + Storage + Caddy；入口脚本与 `config.js`；SQL 创建账号 | `docker/smoke-test.sh` 全部通过：经 HTTPS 登录、调用 RPC、上传并公开读取图片；`dolphin backup` → 改动 → `restore` 恢复到备份时状态；容器重启后数据完整 |
| M1 数据与账务核心 | 全部表、RLS、账务与管理函数、冲正、审计、`check_balances()`；运维命令 `dolphin create-admin`、`dolphin check` | `docker/db-test.sh` 全部通过 |
| M2 前端基础 | 设计系统样式与图标接入、AppShell、登录与设置新密码、按角色进入 | 页面与设计系统页面示例在手机、平板、电脑三种宽度下一致；登录与设置新密码在 375×667 一屏放下 |
| M3 柜台 | 存款、取款、兑换、查询、冲正、离线存款 | 柜台相关端到端测试通过；单笔办理 ≤ 1 分钟（由学生柜员试用计时） |
| M4 后台与学生端 | 名册导入与开户通知单、账号角色、商品与入库、流水查询、参数、日志；学生首页、明细、排名 | 全部端到端测试通过 |
| M5 上线 | 正式服务器部署、迁入现有账本、柜员培训、试运行 | 第 12 节验收全部通过 |

M0 是后续工作的前提，先完成并确认单容器方案可行，再进入 M1。

阶段一、二合并上线：M5 顺延，与第二阶段一起在 [PHASE-2.md](PHASE-2.md) 的 M15 完成。

---

## 12. 上线与验收

### 12.1 上线步骤

1. 在正式服务器部署镜像，配置域名与证书，用 `dolphin create-admin` 创建银行管理员账号，再由银行管理员在后台创建运维员账号。
2. 银行管理员把现有 Excel 账本整理进导入模板（期初余额取账本当日余额），导入后打印「期初余额核对表」，与原账本逐人核对。
3. 打印开户通知单，按班发给学生本人；为柜员、财务、库管分别创建工作账号。
4. 库管录入文创商品与库存。
5. 柜员用测试账号练习（开发种子数据或单独的测试环境）。
6. 试运行一周：全部业务在系统中办理，同时按 SOP 填写纸质凭条，银行管理员每天抽查；无问题后停用 Excel 账本。

### 12.2 验收标准

逐条证据与未勾选条目的原因见 [ACCEPTANCE.md](ACCEPTANCE.md)。

- [x] 柜员登录后直接是搜索框；找到学生点一下即进入办理；存款点一下主按钮即办完，取款和兑换再确认一次；余额与今日还可取金额一直可见。
- [x] 找到一位学生后，可以连续办理多项业务，不用重新查找；结束后回到搜索框并写明本次办理的业务与当前余额。
- [x] 按姓名、拼音首字母、班级或学号都能搜到学生；选中后大字显示姓名、班级、学号和余额供当面核对。
- [x] 余额不足时取款和账户兑换无法提交，并显示可用余额与差额。
- [x] 取款超过单笔或单日限额时无法提交，并显示限额或今日剩余额度。
- [x] 账户兑换成功后，余额、库存、流水同时更新；任一项失败则都不变。两台设备同时兑换最后一件商品，只有一笔成功，另一笔提示「已售罄」。
- [x] 现金兑换显示应付、已收和找零方案，账户余额不变。
- [x] 存款、取款、兑换成功后这一笔连同交易号进入办理单，录错时在这一笔上直接冲正。
- [x] 同一笔业务因网络重试重复提交，只记一次账。
- [x] 柜员能冲正本人当天办理的业务，冲正后余额与库存恢复，原流水显示「已冲正」；柜员无法冲正他人或往日的业务，银行管理员可以。
- [x] 每个账号只有一种身份：学生账号没有工作角色，工作账号只有一个角色。
- [x] 同一台设备登录学生账号和柜员账号后，确认「你是 xxx 吗？」即可来回切换，不输密码；退出一个账号不影响其他账号。
- [x] 每种身份登录后先看到自己的总览页。
- [ ] 断网时柜台可登记存款，其他业务禁用并说明原因；恢复网络后上传，系统流水与纸质凭条一致。
- [x] 学生登录后 2 秒内看到余额和最近 10 笔交易；只能看到本人数据。
- [x] 名册导入后每位学生可用通知单上的初始密码登录，登录后必须设置新密码；之后本人无法再改，重置后得到新的初始密码。
- [x] 同一账号连续输错 5 次密码后 15 分钟内无法登录，重置密码后立即可登录。
- [ ] 现有 Excel 账本余额迁入后，与原账本逐人核对一致。
- [x] 任何角色都无法直接修改余额、库存或删除流水（通过 API 直接请求也被拒绝）。
- [x] 所有业务与管理操作在操作日志中可查到操作人、时间、设备。
- [x] 每日自动备份生成，`dolphin restore` 能把数据恢复到备份时状态。
- [ ] 容器重启、升级后数据完整，证书自动续期。
