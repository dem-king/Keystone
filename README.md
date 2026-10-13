# Keystone 通用后台管理脚手架

用于后续后台管理系统开发的 Spring Boot + Vue 底座。包含认证、菜单与按钮权限、数据权限、组织管理、字典、参数、日志、工作台和代码生成骨架；新增项目在此基础上实现业务模块。

项目名取自「拱心石」：拱券最后落下的那块石头，拆掉它整座结构就塌。统一底座、组件、风格与能力复用，正是这个意思。

## 开发入口

- [项目地图](PROJECT_MAP.md)：按功能定位页面、接口、服务、SQL 和权限。
- [设计规范](DESIGN.md)：珍珠玻璃主题、组件复用及交互规范。
- [开发约定](AGENTS.md)、[更新日志](changelog.md)。
- [后端架构](docs/backend-architecture.md)、[前后端接口约定](docs/frontend-backend-integration.md)、[前端架构](docs/admin-redesign-architecture.md)。

## 目录与技术栈

| 目录 | 用途 | 技术栈 |
| --- | --- | --- |
| `keystone-system` | 后端 Maven 多模块工程 | Java 17+、Spring Boot 3.5、MyBatis、MySQL、Redis、JWT |
| `keystone-vue` | 管理后台 | Vue 3、TypeScript、Vite 6、Vue Router 4、GSAP 3，自有组件库 |
| `keystone-system/sql` | 首次初始化脚本 | `V1__init_schema.sql` 建表，`V2__seed_data.sql` 初始化数据 |
| `docs` | 当前架构说明 | 后端架构、前后端接口约定和前端组件架构 |

当前包含工作台和 10 个管理页面；建筑、工作流模块已移除。

## 本地启动

准备 JDK 17 或更新版本、Maven、Node.js 22+、MySQL 5.7+ 和 Redis；前后端依赖均使用项目现有配置。

后端读取进程环境变量，不会自动加载 `.env` 文件；可在 IDE 运行配置或启动终端中设置：

| 变量 | 中文说明 | 默认值 |
| --- | --- | --- |
| `JWT_SECRET` | JWT 签名密钥，至少 32 字节且不能全为空白 | 必填，无默认值 |
| `DB_HOST` / `DB_PORT` | MySQL 地址 / 端口 | `localhost` / `3306` |
| `DB_NAME` | 数据库名称 | `keystone_system` |
| `DB_USERNAME` / `DB_PASSWORD` | 数据库账号 / 密码 | 本地开发默认账号；按实际环境配置 |
| `DB_TIMEZONE` | 数据库连接与会话时区 | `+08:00` |
| `REDIS_HOST` / `REDIS_PORT` | Redis 地址 / 端口 | `localhost` / `6379` |
| `REDIS_PASSWORD` | Redis 密码 | 空；按实际环境配置 |
| `VITE_API_PROXY_TARGET` | 前端开发代理的后端地址 | `http://localhost:8080` |
| `VITE_PORT` | 前端开发服务器端口 | `5180` |
| `VITE_PREVIEW_PORT` | `npm run preview` 端口 | `4180` |
| `VITE_ALLOWED_HOSTS` | 额外允许的 Host，逗号分隔；用 IP 访问无需设置 | 空 |
| `SERVER_ADDRESS` | 后端监听地址 | `127.0.0.1`，仅本机 |

可在启动后端的终端中生成本机密钥；生成结果保留在当前进程环境，不写入仓库：

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
```

使用 IDE 时将密钥配置到运行环境。未配置或不足 32 字节时后端启动失败；保留同一密钥可让重启前的有效 token 继续验签，更换密钥会使旧 token 失效。

首次创建空的 `keystone_system` 库后，按顺序导入两份 SQL；mysql 客户端须使用 `--default-character-set=utf8mb4`，并通过 `--init-command="SET time_zone='+08:00'"` 设置会话时区。也可在 IDE 运行 `keystone-admin` 中的 `com.keystone.admin.util.DbInit`，该工具使用同一组 `DB_*` 变量并按版本顺序初始化；参数 `fix` 会删除整个目标库，仅在核实库名、备份且明确同意重建时使用。

```bash
# 在 keystone-system 目录构建与启动后端
mvn -pl keystone-admin -am package -DskipTests
java -jar keystone-admin/target/keystone-admin-0.1.0-SNAPSHOT.jar
```

```bash
# 在 keystone-vue 目录启动前端；首次使用先 npm ci
npm run dev
```

浏览器访问 `http://localhost:5180`，后端本地端口为 `8080`；前端统一通过 `/api` 代理访问后端。

### 局域网访问

前端开发服务器监听所有网卡，同一局域网内的同事可直接在浏览器打开 `http://<你的内网IP>:5180`（如 `http://192.168.1.39:5180`），无需在你的电脑上做端口转发，也无需在同事电脑上装任何东西。接口请求由开发服务器在本机转发到后端，后端保持只监听 `127.0.0.1`，同事无法直连 `8080`。

注意事项：

- 你的电脑与同事需在同一局域网，且当前网络未被路由器开启 AP 隔离。
- Windows 防火墙需放行该端口入站；若入站连接失败，为 Node.js 添加专用网络放行规则即可。
- 你的电脑休眠或关闭开发服务器后，同事将无法访问。
- 用 IP 访问即可；若同事习惯用计算机名访问，需设置 `VITE_ALLOWED_HOSTS=你的计算机名` 后重启前端，否则 Vite 会以 403 拒绝非 IP 主机名。
- 本项目端口为 `5180`，因为本机 `5173` 已被其他项目占用；通过 `VITE_PORT` 可改。

种子库管理员为 `admin`，开发密码为 `admin123`；仅用于本地开发，接入实际环境前请修改密码并配置自己的数据库与 Redis 凭据。种子组织和用户为示例，电话留空，邮箱使用 `example.com`。验证码使用页面显示的字符。超级管理员可见全部启用且可见的已注册菜单，并拥有全部操作权限；其余种子角色默认未授予菜单，需在角色管理中分配。无可用菜单的账号登录后显示“暂未分配可用菜单”。

## 新业务模块

1. 先设计业务表与中文字段含义；默认包含 `create_by`、`update_by`、`create_time`、`update_time` 四个审计字段。
2. 复用 `keystone-common` 的返回、分页与异常，以及 `keystone-framework` 的权限、数据权限、操作日志能力。
3. 前端列表复用 `ListPage`、`useListPage` / `useTreeListPage`；表单复用 `FormDialog`、`Field` 和现有控件，操作复用 `PermissionButton`。
4. 在 `src/api` 接入统一 HTTP 客户端，在 `src/composables/auth.ts` 的 `COMPONENT_MAP` 注册页面，再添加菜单和按钮权限。
5. 按角色配置菜单和数据范围，验证低权限账号的真实接口拒绝行为、查询、分页、导出及表单校验。
6. 同步项目地图、相关接口说明和更新日志。

代码生成初始配置为空，按需导入当前数据库的真实表，支持字段信息查看、配置说明保存、7 个文件预览和 ZIP 下载。输出为开发骨架：Controller、Service、Mapper 的业务 CRUD 仍需实现，前端页面需按统一组件规范补齐；下载不会自动写入本工程。

## 验证

不连接数据库和 Redis 的测试与编译：

```bash
# 在 keystone-system 目录
mvn -pl keystone-framework -am test
mvn -pl keystone-admin -am package -DskipTests
```

完整后端集成测试需要配置上述环境变量并准备独立校验库：

```bash
# 在 keystone-system 目录；建议用独立校验库，测试会写入夹具和日志
mvn -pl keystone-admin -am test
```

```bash
# 在 keystone-vue 目录
npm run test:unit
npm run build
# 已安装 Python Playwright 与 Chromium 时，可验证真实浏览器会话与权限
python3 scripts/session-regression.py
# 验证多级菜单渲染、分组折叠、菜单搜索与深层路由跳转；
# 需先在 sys_menu 写入三级以上演示菜单（脚本假定存在「商品中心」分支）
python3 scripts/verify-nav.py http://127.0.0.1:5180
```

浏览器回归脚本只创建并删除自己生成的测试角色和用户，不清空表；管理员密码可通过 `KEYSTONE_TEST_PASSWORD` 覆盖。`verify-nav.py` 不写数据库，只读现有菜单。测试与构建成功不能代替业务页面验收。

## 许可证

本项目代码采用 [MIT License](LICENSE)，允许商用、修改和分发，使用时保留版权及许可证声明。

第三方依赖遵循各自的许可证。GSAP 使用 [Standard "No Charge" License](https://gsap.com/community/standard-license/)，不属于本项目的 MIT 授权范围；使用与再分发时须遵守其条款并保留原有声明。
