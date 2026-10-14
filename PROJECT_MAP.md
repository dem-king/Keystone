# Keystone 通用后台管理脚手架项目地图

> 2026-10-11 更新。用于后续业务开发和排障；“已确认”表示代码链路已核对，运行验证记录见 `changelog.md`。数据库映射已与本地 MySQL 5.7 的真实结构及两份初始化脚本核对。

## 一、项目总览

| 端 | 路径 | 技术栈 | 本地入口 | 来源 |
| --- | --- | --- | --- | --- |
| 后端 | `keystone-system` | Java 17+、Spring Boot 3.5、MyBatis、MySQL、Redis、JWT | `8080`，接口前缀 `/api` | 已确认 |
| 管理后台 | `keystone-vue` | Vue 3、TypeScript、Vite、Vue Router、GSAP，自有组件 | `5180`，开发代理 `/api` | 已确认 |

- Maven 模块：`keystone-common`、`keystone-framework`、`keystone-system`、`keystone-generator`、`keystone-admin`。
- 包名前缀：`com.keystone`；启动类：`keystone-system/keystone-admin/src/main/java/com/keystone/admin/KeystoneAdminApplication.java`。
- 配置：`keystone-system/keystone-admin/src/main/resources/application.yml`、`application-dev.yml`；前端代理：`keystone-vue/vite.config.ts`。
- 数据库初始化：`keystone-system/sql/V1__init_schema.sql`、`V2__seed_data.sql`；开发工具：`keystone-admin/src/main/java/com/keystone/admin/util/DbInit.java`。
- 入口规范：`README.md`、`AGENTS.md`、`DESIGN.md`；建筑与工作流已移除。

## 二、业务术语词典

| 业务说法 | 代码 / 表 | 字段及中文含义 | 来源 |
| --- | --- | --- | --- |
| 后台账号 | `AuthUserRow`、`sys_user` | `username` 登录账号；`nickname` 姓名；`status` 启用状态；`deleted` 删除标记 | 已确认 |
| 角色 | `sys_role`、`sys_user_role` | `role_code` 角色编码；`builtin` 内置标记；`data_scope` 数据范围 | 已确认 |
| 菜单 / 按钮 | `MenuRow`、`sys_menu`、`sys_role_menu` | `menu_type` 为 `dir` 目录 / `menu` 页面 / `btn` 操作；`permission` 权限码 | 已确认 |
| 组织与岗位 | `sys_dept`、`sys_post`、`sys_user_post` | `parent_id` 上级部门；`ancestors` 上级链；`post_code` 岗位编码 | 已确认 |
| 字典 | `sys_dict_type`、`sys_dict_data` | `dict_type` 字典类型；`dict_label` 显示名称；`dict_value` 存储值 | 已确认 |
| 参数 | `sys_config` | `config_key` 参数键；`config_value` 参数值；`builtin` 内置标记 | 已确认 |
| 登录 / 操作审计 | `sys_login_log`、`sys_oper_log` | `login_time` 登录事件时间；`oper_time` 操作时间；`request_params` 脱敏参数 | 已确认 |
| 生成配置 | `gen_table`、`gen_table_column` | `table_name` 表名；`java_field` 属性名；`synced` 配置确认标记 | 已确认 |
| 审计字段 | 业务表公共列 | `create_by` 创建人；`update_by` 更新人；`create_time` 创建时间；`update_time` 更新时间 | 已确认 |

## 三、模块文件地图

下列后端业务路径均相对于 `keystone-system`，前端路径均相对于 `keystone-vue/src`。

| 后端模块 | Controller | Service | Mapper / 表 | 来源 |
| --- | --- | --- | --- | --- |
| 认证与路由 | `keystone-system/src/main/java/com/keystone/system/controller/AuthController.java` | 同包域 `service/AuthService.java`、`SystemPermissionResolver.java` | `mapper/AuthMapper.java`；用户、角色、菜单及关联表、登录日志 | 已确认 |
| 用户、角色、组织、菜单、字典、参数 | `keystone-system/src/main/java/com/keystone/system/controller/SystemManagementController.java` | `service/SystemManagementService.java` | `mapper/SystemManagementMapper.java`；各 `sys_*` 管理表 | 已确认 |
| 工作台 | `keystone-system/src/main/java/com/keystone/system/controller/DashboardController.java` | `service/DashboardService.java` | `mapper/DashboardMapper.java`；用户、角色、两类日志 | 已确认 |
| 日志查询、导出与清理 | `keystone-system/src/main/java/com/keystone/system/controller/MonitorController.java` | `service/SystemManagementService.java` | `mapper/SystemManagementMapper.java`；两类日志 | 已确认 |
| 日志统计与当日泳道 | 同上 | `service/MonitorStatsService.java` | `mapper/MonitorStatsMapper.java`；两类日志（只读） | 已确认 |
| 代码生成 | `keystone-generator/src/main/java/com/keystone/generator/controller/GeneratorController.java` | `service/GeneratorService.java` | `mapper/GeneratorMapper.java`；`information_schema`、两张生成配置表 | 已确认 |
| 健康检查 | `keystone-admin/src/main/java/com/keystone/admin/controller/HealthController.java` | 无独立业务服务 | 无数据库写入 | 已确认 |

| 前端功能 | 路由 | 页面文件 | API 文件 / 后端模块 | 来源 |
| --- | --- | --- | --- | --- |
| 登录（全幅画布、神经网络背景、时钟、服务健康） | `/login` | `views/Login.vue` + `components/NeuralNet.vue` | `api/auth.ts`、`portal.ts` 的 `health`；认证 | 已确认 |
| 工作台（主次布局 + 会话首次开场 + 模块网络卡） | `/dashboard` | `views/Dashboard.vue` | `api/portal.ts`；工作台；有日志权限时加载当日泳道 | 已确认 |
| 用户（列表 / 看板） | `/system/user` | `views/system/Users.vue` | `api/system.ts`；系统管理 | 已确认 |
| 角色（列表 / 权限矩阵 / 溯源·图谱舞台） | `/system/role` | `views/system/Roles.vue` + `components/business/PermissionTrace.vue` | 同上 + `permissions/graph` | 已确认 |
| 菜单（表格 / 导航星系·图谱舞台 + 侧栏预览） | `/system/menu` | `views/system/Menus.vue` + `components/business/MenuStarMap.vue` | 同上 | 已确认 |
| 部门（组织画布 / 表格，选中路径脉冲） | `/system/dept` | `views/system/Depts.vue` | 同上 | 已确认 |
| 岗位（列表 / 阶梯·图谱舞台） | `/system/post` | `views/system/Posts.vue` + `components/business/PostLadder.vue` | 同上；阶梯成员经 `users?postId=` | 已确认 |
| 字典（表格 / 样本册） | `/system/dict` | `views/system/Dict.vue` + `components/business/DictSwatchbook.vue` | 同上 | 已确认 |
| 参数（设置面板 / 表格） | `/system/config` | `views/system/Configs.vue` | 同上 | 已确认 |
| 操作日志（横带：概览 / 趋势或泳道 / 明细，抽屉级联） | `/monitor/oper-log` | `views/monitor/OperLog.vue` | `api/system.ts`；日志与统计 | 已确认 |
| 登录日志（横带：概览 / 趋势或热力 / 异常 / 明细） | `/monitor/login-log` | `views/monitor/LoginLog.vue` | 同上 + `login-logs/heatmap` | 已确认 |
| 代码生成（三步流水线抽屉） | `/tool/generator` | `views/tool/Generator.vue` + `components/business/GeneratorPipeline.vue` | `api/portal.ts`；生成器 | 已确认 |
| 无菜单 / 无匹配页面 | `/no-access` / 通配路径 | `views/NoAccess.vue`、`views/NotFound.vue` | 路由与会话状态 | 已确认 |

| 公共能力 | 文件入口 | 用途 |
| --- | --- | --- |
| 列表模板与数据状态 | `components/business/ListPage.vue`、`composables/list.ts` | 查询、重置、分页、导出、勾选、底部批量浮条及树列表；`altView` + `#alt` 换成画布 / 看板 / 矩阵 |
| 版式组件 | `components/business/OrgCanvas.vue`、`BoardView.vue`、`PermissionMatrix.vue`、`PostLadder.vue`、`PermissionTrace.vue`、`MenuStarMap.vue`、`DictSwatchbook.vue`、`GeneratorPipeline.vue`、`composables/view.ts` | 组织画布、看板分列（拖拽 + 键盘移动）、角色权限矩阵、岗位阶梯、权限溯源（三层下钻）、导航星系（三层下钻）、字典样本册、生成流水线、按页面记忆视图 |
| 图谱与问答 | `components/charts/RelationGraph.vue`、`composables/neural.ts`、`components/business/InsightPanel.vue`、`AskDock.vue`、`composables/ask.ts`、`composables/viewport.ts`、`components/NeuralNet.vue` | 通用关系图（弹簧布局变形、脉冲、扇形触须；`variant="stage"` 为珍珠玻璃图谱舞台）、舞台 Canvas 绘制件（珍珠球、玻璃刻度表盘、连线与脉冲、背景网络、轨道、台阶光柱）、分析栏、问答坞、本地规则问答引擎、共享视口平移缩放、登录神经网络背景 |
| 仪器化组件 | `components/ui/Metric.vue`、`Odometer.vue`、`SectionLabel.vue`、`SpecPlate.vue`、`DeltaPill.vue`、`Ruler.vue`、`HoverCard.vue` | 显示级读数、逐位滚动、编号眉标、规格铭牌、环比、刻度尺、悬停名片 |
| 图表 | `components/charts/TrendChart.vue`、`BarChart.vue`、`TickRing.vue`、`Swimlane.vue` | 自绘 SVG：形变折线与准星（稀疏数据茎叶点）、柱状、刻度环、时间轴泳道（默认聚焦有操作时段）；工作台数据权限为页内占比条 |
| 表单与引用选项 | `components/business/FormDialog.vue`、`DictSelect.vue`、`DeptTree.vue`、`DeptSelect.vue`、`UserSelect.vue` | 统一表单、字典、部门、用户选择 |
| 权限 | `components/business/PermissionButton.vue`、`directives/permission.ts` | 以当前用户权限控制操作显示 |
| 外壳 | `components/layout/AppShell.vue`、`Sidebar.vue`、`Topbar.vue`、`CommandPalette.vue` | 导航、移动侧栏、滚动凝结顶栏、命令面板（最近访问 / 页面 / 用户 / 动作）与账号操作 |
| 导航树与折叠 | `components/layout/NavTreeNode.vue`、`composables/navCollapse.ts`、`utils/navTree.ts` | 递归渲染任意层级菜单、分组折叠状态（`sessionStorage` 的 `keystone.navCollapsed`）、菜单树转换纯函数（深度上限 `MAX_MENU_DEPTH=6`） |
| 请求与会话 | `api/http.ts`、`api/session.ts`、`composables/auth.ts`、`router/index.ts` | 响应解包、存储、401 处理、动态路由与会话清理 |
| 外观与动效 | `composables/appearance.ts`、`motion.ts`、`focus.ts` | 主题、密度、GSAP、浮层层级与焦点 |
| 登录转场与欢迎链 | `composables/welcome.ts`、`components/welcome/WelcomeChain.vue` | 交接状态机（idle / leaving / arriving）、点击拦截、`ARRIVE_BUDGET` 收尾、工作台数据预热；欢迎链是「星球自右上角坠落（途中由小变大）→ 到中央炸开 → 浮牌同点浮现 → 整句问候语逐字打出 → 吸附式回落页头标题位置」，粒子走 canvas（`.welcome-dust`） |
| 首屏骨架 | `components/ui/Skeleton.vue`、`views/Dashboard.vue` | 数据未到时用等高灰条占位，卡片从第 0 帧就在位；`page.is-handoff` 期间跳过「藏卡片」兜底 |
| 样式 | `styles/tokens.css`、`base.css`、`materials.css`、`components.css`、`instruments.css`、`layout.css`、`pages.css` | 顺序加载的七层样式 |

## 四、场景剧本

**登录与切换账号**：`Login.vue` → `authApi.login` → `AuthController.login` → `AuthService.login` → `AuthMapper` 校验账号、写登录日志 → `JwtService` 生成独立 token、`TokenStore` 写 Redis → `/auth/me` 取角色和权限 → `/auth/routes` 取菜单 → `router/index.ts` 注册页面；退出同步清除会话、菜单、路由和引用缓存，旧请求以会话版本判定是否仍可写回。

**新增用户**：`Users.vue` → `/system/users/options` 取引用选项 → `FormDialog` 校验 → `systemApi.users.create` → `SystemManagementController.createUser` → `SystemManagementService.createUser` → 用户表与角色、岗位关联表 → 列表重载；操作日志由公共切面记录。

**分配权限**：`Roles.vue` → 菜单树与角色菜单接口 → `PermissionTree` 勾选菜单 / 按钮、选择数据范围 → `PUT /system/roles/{id}` → 更新角色及关联表 → 重新登录加载新权限；停用或删除角色不能提供菜单与操作权限。

**泳道定位明细**：`Dashboard.vue` / `OperLog.vue` 的 `Swimlane` → `GET /monitor/oper-logs/timeline` → `MonitorStatsService.operTimeline` 按模块聚合 → 点击时间块以模块名写入操作日志关键词并滚到明细；工作台跳转通过 `pathOf('monitor/operlog/index')` 取当前账号可访问路径。

**看板改状态 / 矩阵改授权**：`BoardView` 拖到「停用」列 → 确认 → `PUT /system/users/{id}/status` → 重载；`PermissionMatrix` 本地累计改动 → 浮条「保存变更」→ 逐个角色 `PUT /system/roles/{id}`（仅带 `menuIds`）→ 重载矩阵；内置角色只读。

**字典维护**：`Dict.vue` → 类型表单 / 数据抽屉 → 类型与数据 CRUD → 两张字典表 → `invalidateDict` 更新公共下拉缓存；业务下拉仅请求启用选项接口。

**代码生成**：`Generator.vue` → 查询当前库 `information_schema` → 导入表与列信息 → 保存说明 / 确认标记 → 预览 7 个文件 → 生成并下载 ZIP；业务 CRUD 实现与代码接入仍由开发者完成。

## 五、API 快速索引

所有路径都以前缀 `/api` 开始；`{id}` 表示记录 ID，`{dictType}` 表示字典类型。

| 功能 | 方法与路径 | Controller | 来源 |
| --- | --- | --- | --- |
| 健康检查 | `GET /health` | `HealthController` | 已确认 |
| 验证码 / 登录 / 退出 | `GET /auth/captcha`、`POST /auth/login`、`POST /auth/logout` | `AuthController` | 已确认 |
| 用户、路由、修改密码 | `GET /auth/me`、`GET /auth/routes`、`PUT /auth/password` | 同上 | 已确认 |
| 工作台 | `GET /dashboard/summary`（含 `trendPrev`、`dailyOps`；`stats` 含 `menus` 菜单项、`depts` 部门数） | `DashboardController` | 已确认 |
| 权限溯源图 | `GET /system/permissions/graph` | `SystemManagementController`（`system:role:list`） | 已确认 |
| 用户 | `GET/POST /system/users`（列表支持 `postId` 岗位过滤）、`PUT/DELETE /system/users/{id}` | `SystemManagementController` | 已确认 |
| 用户引用 / 导出 / 状态 / 密码 | `GET /system/users/options`、`GET /system/users/export`、`PUT /system/users/{id}/status`、`PUT /system/users/{id}/password` | 同上 | 已确认 |
| 角色 | `GET/POST /system/roles`、`PUT/DELETE /system/roles/{id}`、`GET /system/roles/{id}/menus`、`GET /system/roles/export` | 同上 | 已确认 |
| 菜单 | `GET /system/menus/tree`、`POST /system/menus`、`PUT/DELETE /system/menus/{id}`、`GET /system/menus/export` | 同上 | 已确认 |
| 部门 | `GET /system/depts/tree`、`POST /system/depts`、`PUT/DELETE /system/depts/{id}`、`GET /system/depts/export` | 同上 | 已确认 |
| 岗位 / 参数 / 字典类型 | `GET/POST /system/posts`、`/system/configs`、`/system/dict/types`；各资源支持 `PUT/DELETE /{id}` 和 `GET /export` | 同上 | 已确认 |
| 字典数据 / 业务选项 | `GET /system/dict/data/{dictType}`、`POST /system/dict/data`、`PUT/DELETE /system/dict/data/{id}`、`GET /system/dict/options/{dictType}` | 同上 | 已确认 |
| 两类日志 | `GET /monitor/oper-logs`、`/monitor/login-logs`；各支持 `GET /export`、`DELETE /{id}`、`DELETE` 清空 | `MonitorController` | 已确认 |
| 登录热力 | `GET /monitor/login-logs/heatmap?days=7|30`（`cells` 星期×小时、`anomalies` 连续失败聚合） | 同上（`monitor:loginlog:list`） | 已确认 |
| 日志统计 / 泳道 | `GET /monitor/oper-logs/stats`、`GET /monitor/oper-logs/timeline`、`GET /monitor/login-logs/stats` | 同上 | 已确认 |
| 生成器表与导入 | `GET /tool/generator/tables`、`GET /tool/generator/importable-tables`、`POST /tool/generator/import` | `GeneratorController` | 已确认 |
| 生成器配置与输出 | `PUT /tool/generator/tables/{id}`；其后追加 `GET /columns`、`GET /preview`、`POST /generate`、`GET /download` | 同上 | 已确认 |

## 六、改动影响链

| 变更 | 必查位置 |
| --- | --- |
| 新增业务页面 | 业务表 / DTO → Mapper → Service → Controller → `src/api` → `ListPage` / `FormDialog` → `COMPONENT_MAP` → 菜单及角色授权 |
| 改权限 | `sys_role` / `sys_menu` / 关联表 → `AuthMapper`、`SystemPermissionResolver` → `@RequiresPermission` → `auth.ts`、`PermissionButton` → 低权限浏览器 / 接口回归 |
| 改数据范围 | `SystemDataScopeResolver` → `DataScopeCriteria` → 查询与导出 SQL → 用户筛选 / 分页；新增业务必须显式接入 |
| 改字段 | 初始化或后续迁移 SQL → Mapper 字段别名 → DTO 校验 / Service → API 类型 → 页面表单、表格与导出 |
| 改外观 / 公共交互 | 样式令牌或公共组件 → 代表性页面 → 浅色 / 深色 / 窄宽度 / 键盘 / 减少动效 |
| 改认证 | `JwtService`、`TokenStore`、认证过滤器 → `AuthService` → `session.ts`、`http.ts`、`auth.ts`、路由守卫 → 会话回归脚本 |
| 改生成模板 | `GeneratorService.renderFiles` → 全文件预览 → ZIP 内容 → 菜单 SQL 与当前 schema；骨架接口需业务开发者接入 |

## 七、症状定位表

| 症状 | 第一现场 | 排查重点 | 来源 |
| --- | --- | --- | --- |
| 切换账号后停留登录页 / 旧菜单仍可见 | `router/index.ts`、`composables/auth.ts`、`AppShell.vue` | 会话同步清理、旧请求版本、路由初始化取消、失效跳转 | 已确认 |
| 登录成功但没有菜单 | `AuthService.routes`、`AuthMapper`、`NoAccess.vue` | 角色启用状态、菜单授权、组件是否注册 | 已确认 |
| 菜单可见但接口返回 403 | `PermissionAspect`、`SystemPermissionResolver` | 当前角色 / 按钮权限、用户状态；引用选项使用专用接口 | 已确认 |
| 部门筛选漏掉下级 / 数据范围错误 | `SystemManagementMapper`、`SystemDataScopeResolver` | `ancestors`、部门范围、分页和导出是否同口径 | 已确认 |
| 时间差 8 小时 / 连接时区异常 | `application-dev.yml`、`DbInit` | Hikari 连接属性、`DB_TIMEZONE`、MySQL 会话 `NOW()` | 已确认 |
| 页面过渡空白 / 后台浮层未关闭 | `composables/motion.ts` | Vue 过渡完成回调、后台状态与减少动效终态 | 已确认 |
| 登录后首屏白一下再出内容 | `playShellEntrance`、`Dashboard.playEntrance`、`pageEnter` | 别用 `opacity: 0` 表达组装：改骨架等高占位，卡片只做位移；整框不参与淡入（舞台底一直在） | 已确认 |
| SVG 虚线拖尾不生效 / 属性被忽略 | `motion.ts`、`WelcomeChain.vue` | GSAP 把 `stroke-dasharray/dashoffset` 写成**内联样式**，优先级高于 SVG 表现属性，`setAttribute` 被静默忽略，必须写 `path.style.*` | 已确认 |
| 欢迎动效「看不出来」/ 视觉变化为零 | `WelcomeChain.vue` | 浮牌若与真实标题同字号同色又精确压在标题上，用户看到的还是原标题。浮牌必须有玻璃底与投影，且播放期间隐藏真实 `.page-title` | 已确认 |
| 归位落点判定误报偏了几十像素 | 验证脚本 | `.page-title` 是 `<h1>` 块元素，盒宽 > 文字宽，用「盒中心」比较会误判。归位要比**文字起始边**（左边缘 + 纵向中心） | 已确认 |
| 入场动画被视口切边 | `WelcomeChain.vue` | 抛物线的顶点比起点更高，起点贴顶会冲出上沿。起点下移到 `(vw-150, 124)`；断言里有「飞行全程不出视口」兜底 | 已确认 |
| 问候语「没经过打字效果」 | `WelcomeChain.vue` | 模板预渲染了 `下午好，`，只有用户名在打。整句一起 `typeOut`；牌宽会随打字变化，每写一个字要重新居中 | 已确认 |
| 粒子在浅色主题下看不见 | `WelcomeChain.vue` | 白底上用 `lighter` 会把亮色洗成白。按主题切合成模式：深色 `lighter` + 亮青柠，浅色 `source-over` + 深色 | 已确认 |
| 动效断言「末帧」其实是中间帧 | 验证脚本 | 链条变长后，切路后固定 `sleep` 会在半路截断日志，落点/接管等断言全线误报。改为等欢迎层自行卸载再读 | 已确认 |
| 归位后交叉淡化时「文字跳一下」 | `WelcomeChain.vue` | 量标题的时机太早：`pageEnter` 的页面 `scale 0.994→1`（差 4px）与页头 `y:8→0`（差 8px）没跑完就量。把测量推迟到入场结束后，实测偏差归零 | 已确认 |
| 欢迎层元素在页面左上角被看到 | `WelcomeChain.vue` | 基准位置要等坠落结束才量，在那之前浮牌停在 `(0,0)`；`opacity: 0` 必须在挂载第一帧设置，不能等到测量时 | 已确认 |
| `--slow-api` 拦截后接口永不返回 | `scripts/shot-welcome-chain.mjs` | `Fetch.requestPaused` 是**事件**（无 id），改 `cdp.send` 接不到。客户端需支持 `on()` 注册事件处理器，延迟后再 `continueRequest` | 已确认 |
| 动效分镜每帧都「超时」 | `scripts/shot-welcome-chain.mjs` | 一张截图耗时约 400ms，先抓别的帧会吃掉后续时间窗。改为单遍按序采集：命中即抓，抓完继续用当前状态匹配下一帧 | 已确认 |
| 变换矩阵解析出 NaN | 验证脚本 | 代码在模板字符串里，正则的 `\(` 会被求值成 `(`，捕获组内容带上括号导致 `Number()` 得 NaN。按括号切分即可，别用正则 | 已确认 |
| 收尾时线条闪一帧全亮 | `WelcomeChain.vue` | `clearProps: 'all'` 会连 `opacity: 0` 一起清掉，CSS 默认值会让线条复现。先显式压 opacity 0 + `removeAttribute('d')`，再只 clear 指定属性 | 已确认 |
| 打字机先闪一下全名 | `typeOut` | 它首帧会 `write('')` 清空后重打，模板里不要预渲染完整文本 | 已确认 |
| 动效播到一半被掐断 | `AppShell.vue` 欢迎层卸载 | 卸载时机由链条 `emit('done')` 决定，不用 `setTimeout` 猜时长；另留安全阀 | 已确认 |
| 铭牌定位到错误位置 / 量到 0 宽 | `WelcomeChain.vue` | 外壳比路由内容先挂载，`.page-title` 尚不存在，需轮询等待后再量 | 已确认 |
| 读数停在 0 / 动画停在中途 | `Odometer.vue`、`motion.ts` | 后台标签页 rAF 不触发：读数用定时器兜底，GSAP 补间在切到后台时走完 | 已确认 |
| 登录成功后停在对勾圆环 | `Login.vue` | 进入外壳的导航被取消（会话过期等）时须恢复登录按钮 | 已确认 |
| 抽屉内确认框被挡 / Escape 连带关闭 | `focus.ts`、`Modal.vue`、`Drawer.vue`、`Select.vue` | 打开顺序、公共层级、最上层焦点与事件 | 已确认 |
| 预览其他文件无代码 / 菜单 SQL 不匹配 | `GeneratorService`、`Generator.vue` | 每份文件的 `code`、当前菜单字段和类型 | 已确认 |
| 登录日志来源列为空 / 全是 127.0.0.1 | `AuthMapper.insertLoginLog`、`ClientInfoResolver` | 写入端是否采集 `ip / location / browser / os`；本机访问应回退为 `192.168.x.x`（若仍 127 检查 `localAddress()` 是否探测失败）；同事经代理访问若记成服务器 IP，检查 vite `xfwd` 是否已重启生效；存量旧记录为 NULL，仅新记录有值 | 已确认 |

## 八、权限标识速查

| 模块 | 权限码 | 用途 |
| --- | --- | --- |
| 用户 | `system:user:list/add/edit/remove/resetPwd` | 查询导出 / 新增 / 编辑状态 / 删除 / 重置密码 |
| 角色、菜单、部门、岗位、字典、参数 | `system:role`、`system:menu`、`system:dept`、`system:post`、`system:dict`、`system:config`，后缀 `list/add/edit/remove` | 各模块查询导出与写入操作 |
| 日志 | `monitor:operlog:list/remove`、`monitor:loginlog:list/remove` | 查询导出 / 删除清理 |
| 代码生成 | `tool:gen:list` | 当前生成器全部接口 |

- 超级管理员角色编码为 `super_admin`，后端操作权限直接放行，菜单按启用和显示状态读取。
- 业务字典选项仅需已登录；字典管理数据和写入仍使用对应权限。
- 用户引用选项要求 `system:user:list`；只读用户不接收角色、岗位及初始密码选项，也不接收部门联系人信息。
- 数据范围：`ALL` 全部、`DEPT_AND_CHILD` 本部门及下级、`DEPT` 本部门、`SELF` 本人、`CUSTOM` 自选部门。

## 九、特殊机制备忘

- Redis token key 前缀为 `auth:token:`；退出删除当前 token，每次登录的 JWT 带独立 ID。
- JWT 签名密钥读取必填环境变量 `JWT_SECRET`，UTF-8 编码至少 32 字节且不能全为空白；缺失或长度不足时阻止启动。
- 验证码保存在 Redis、验证时消费；当前开发底座接口返回四位字符供页面显示。
- `session.ts` 统一管理 localStorage / sessionStorage；会话清理两处都清，外观设置独立保留。
- `sessionVersion` 阻止旧菜单 / 用户请求写回；旧 token 的 401 不能清除新账号会话。
- 字典、部门缓存随账号切换清除；列表以请求序号避免晚到结果覆盖新查询。
- MySQL 时区以连接属性传递并强制到会话；不修改实例全局时区。
- 初始化 SQL 是新项目起点，不是旧库的自动升级迁移；`DbInit fix` 会删除整个目标库。
- 日志表、关联表、生成字段表不强制使用全部四个业务审计字段；`sys_file` 为保留表，当前没有上传业务接口。
- `composables/ask.ts` 是本地规则问答引擎：各模块注册 `intent{patterns, run}`，按 `hasPermission` 过滤不可用意图；命令面板输入 `?` 进入同一引擎。
- 视口平移缩放集中在 `composables/viewport.ts`（`useViewportPan`）：组织画布与关系图共用；`firstTimeInSession` 控制工作台开场等“每会话一次”的编排。
- 用户按岗位过滤走 `sys_user_post` 关联条件，分页、统计、导出一致生效并沿用 `@DataScope`。
- 侧边栏菜单树递归渲染，支持三级及以上（深度上限 `MAX_MENU_DEPTH=6`）；二级及以下节点按分组折叠，状态存 `sessionStorage` 的 `keystone.navCollapsed`，路由变化时自动展开当前页的祖先分支。
- 一级分组同样可折叠。可见页面总数超过 `AUTO_COLLAPSE_THRESHOLD=20` 进入紧凑模式，自动收起排在 `KEEP_OPEN_GROUPS=2` 之后的分组；当前页分组与搜索态强制展开。手动折叠存 `keystone.navCollapsed`，手动展开存 `keystone.navExpanded`，两者共同覆盖自动策略。
- 菜单搜索在侧边栏内跨层级匹配（非隐藏入口）；Ctrl+K 命令面板覆盖同样的页面集合，两者共用 `navLeaves` 的深度展开结果。
- 新增业务菜单只需在 `sys_menu` 写 `parent_id` 自关联，并在 `auth.ts` 的 `COMPONENT_MAP` 登记组件路径，无需改动导航组件。
- 客户端信息（IP、地点、浏览器、系统）由 `keystone-framework` 的 `com.keystone.framework.web.ClientInfoResolver` 从当前请求统一采集，登录日志与操作日志共用：IP 取 `X-Forwarded-For`（首段，跳过 unknown）→ `X-Real-IP` → 直连地址，**结果为回环地址时回退本机网卡真实 IPv4**（`localAddress()`：非虚拟适配器私网优先，跳过 OpenVPN TAP / Clash 隧道等虚拟网卡；探测不到保留回环值）；地点仅标注「本机 / 内网」（公网留空，待接地理库）；无请求上下文时字段记 NULL。前端 `vite.config.ts` 的 `/api` 代理已开 `xfwd: true`，局域网同事经代理访问时后端凭 `X-Forwarded-For` 记录其真实 IP。

<!-- MANUAL-NOTES-START -->
## 十、人工维护备注

后续项目的业务规则、特殊权限和人工定位说明可补充在此区域。
<!-- MANUAL-NOTES-END -->

## 十一、待核实与开发边界

| 项目 | 当前事实 | 后续处理 |
| --- | --- | --- |
| 生成业务 CRUD | 生成器输出文件骨架，尚未实现生成模块的完整 CRUD | 新业务接入时实现并单独验证 |
| 新业务数据权限 | 当前接入用户列表与导出，其他新增业务不会自动具备数据范围 | 按业务表的部门 / 创建人字段接入公共能力 |
| 文件业务与防重复提交 | 文件表已保留，统一上传及防重复提交能力未提供完整业务闭环 | 有实际需求时扩展公共能力 |
| 历史能力边界 | 早期版本包含当前已删除的建筑与工作流模块 | 历史变更见 `changelog.md`，当前范围查本地图与 README |
