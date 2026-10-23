# 候选项目 B：REA Tool Router

> 中文名：REA 工具发现、Evidence 状态与上下文成本实验  
> 工作名：ReaRoute；类型：单机 Agent 工具中间件 + 可复现评测  
> 文档版本：v0.3，后端技术负责人视角修订；日期：2026-10-23  
> 状态：已审查设计并核对官方文档；尚未运行 REA、验证 Fork 兼容性或完成性能实验。

## 1. 这是什么，值不值得做

Agent 面对一个较大的工具目录时，需要决定调用哪个工具、参数从哪里来、已有分析能否复用。ReaRoute 在 Agent 和 REA 之间维护工具元数据及同连接 Evidence 状态，帮助 Agent 找到下一步，并记录实际成本和失败原因。

典型输入是“追踪这个 Electron 项目里的导出功能”。输出包括下一步工具、必要的输入 Evidence 引用、调用结果和可检查的路由记录。用户通过已有 Agent 客户端使用，不另外开发聊天网站。

它是 Agent 工具中间件。检索、依赖判断、参数边界和缓存都可以用确定性代码实现；外部 Agent 才负责理解任务、调用工具和观察结果。本项目不能独立声称实现了完整 Agent、长期记忆或自主反思系统。

后端面试官的第一印象可能是：“方向成立，但像一个搜索加转发的包装层。”要改变这个印象，需要真实状态错误的处理、可重复的故障实验、与简单方案公平比较后的结果。工具数量、MCP 名词和页面数量不构成工程深度。

**有条件可做，先验证价值。** 最强竞争者还包括“给 Agent 固定配置一组 JavaScript 工具”。如果后者已经够用，本项目应交付适配器与评测结论，不继续扩张成平台。

## 2. 已知事实与证据边界

- [REA #5861](https://github.com/morluto/rea/issues/5861) 报告某个 207 工具版本的 full/compact 目录成本约为 259K/66K tokens。这是报告者特定客户端的历史测量，不是我们在当前环境的实测值。
- [REA #5975 对应提交](https://github.com/morluto/rea/commit/aa51e4343963fdd0b97ec2ebdc3c41579fd9cb38) 已将 compact 输入 schema 设为默认，不能宣称本项目修复了“默认 full”的问题。
- REA 的完整目录和当前可用性是分开的；调用方应读取当前连接的 availability。广告 schema 与 canonical 校验也有区别。[REA MCP 合同](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md)
- 通用搜索与代理已有 [mcp-tool-search](https://github.com/KGT24k/mcp-tool-search) 和 [lazy-tool](https://github.com/mcp-shark/lazy-tool)。增量假设是正确绑定 Evidence、处理状态并证明任务成本收益，不能把懒加载本身说成创新。

开工时固定 REA commit、包版本、MCP SDK 版本、协议协商结果、Agent Host 及模型版本。来源的 main 分支会变化，不能用当前文字代替固定版本的契约测试。

## 3. 原方案的问题及修正

| 原设计 | 后端负责人会指出什么 | 修订方案 |
|---|---|---|
| availability=false 先过滤，再补依赖 | 需要前置分析的工具被提前删掉 | 区分禁止、缺资源、暂不可用和未知，补前置后再检查 |
| 工具名依赖图就是可执行计划 | 一个工具可能需要两个不同版本 Evidence | 规划调用实例及输入资源绑定 |
| route token 表示授权 | 模型可以自己请求 route | ticket 仅标识计划，可信 policy 决定权限 |
| session 一变化就让 token 失效 | 前置步骤产出 Evidence 后计划立即过期 | 连接 epoch 与资源账本分开，逐步核验 |
| get_tool 返回 canonical schema | full/compact 广告均未必表达全部运行约束 | 忠实返回广告 schema，最终判定留给 REA |
| top-k schema 总和代表上下文成本 | schema 留在历史，搜索还增加轮次 | 测真实 Host 每轮输入、输出、缓存与峰值上下文 |
| 透传 JSON 就是 MCP 兼容 | 错误、annotations、进度和取消仍会改变语义 | 写明协议支持范围并验证边界 |
| 业余 3–4 周完成全部 | 36–64 小时难覆盖可靠代理和可信评测 | 先投入 20–30 小时验证；扎实版估计 85–130 小时 |

## 4. 收紧范围

第一版固定一个本地 REA upstream、一个 Agent Host、一个模型、stdio 传输。输入为自有或可合法使用的小型 JS/Electron 项目目录或 ASAR，只进行静态分析与已保留 Evidence 的查询、比较。

建议支持以下七个真实工具；具体参数从固定版本目录读取：

| 工具 | 本项目用途 |
|---|---|
| binary_session | 检查连接身份、目录身份和当前可用性 |
| analyze_javascript_application | 生成目标 artifact 的 Application Evidence |
| inspect_analysis_view | 查询已有 Evidence 的摘要、模块和分页 |
| trace_application_feature | 使用已有 Application Evidence 追踪特征 |
| trace_javascript_semantics | 相应语义图存在时查询，可推迟到第二阶段 |
| compare_application_versions | 比较绑定好的两份 Application Evidence |
| get_evidence_bundle | 通过 summary 查询已有记录，避免重复分析 |

代理内部可以索引完整目录，但白名单外工具只用于解释“未纳入支持范围”，不允许执行。固定小工具集必须进入 baseline，否则排除 200 多个无关工具得到的节省没有说服力。

不纳入 MVP：多租户、OAuth、HTTP 公网服务、动态代码执行、浏览器自动化、native provider、设备工具、跨客户端支持矩阵、Embedding 服务、自学习路由、管理后台。

## 5. 三条可验证工作流

以下为设计级调用顺序，参数必须再与固定版本 schema 对照。它们不要求 open_binary，也不需要已打开 native target；分析入口仍需要用户提供 artifact。

### 工作流一：首次分析后追踪功能

1. 用户给出项目目录和“导出笔记”线索。
2. 同连接没有匹配的 Application Evidence，调用 analyze_javascript_application，选择 detail: "summary"。
3. 从摘要 normalized_result.parent_evidence_id 获取完整分析 ID，不能误用摘要自身 evidence_id。
4. 必要时通过 inspect_analysis_view 查询模块、node ID 和线索，再选择字面量 seed。
5. trace_application_feature.application 绑定完整分析的 retained reference。
6. 保留 partial/unknown/limitations，不把静态路径称为已运行证明。

引用形状如下；它属于 REA 当前连接账本，不是任意文件路径或通用 MCP Resource URI：

    {"kind":"retained-evidence","evidence_id":"实际完整分析ID"}

### 工作流二：比较两个版本

1. 给出 A、B 两个 artifact，分别查找兼容的已保留分析。
2. 只对缺少的一侧运行分析，记录各自 parent Evidence ID。
3. compare_application_versions.left/right 分别绑定 A、B 的引用。
4. 验收故意交换、重复或缺失 ID 的情况，避免工具选对而比较对象错了。

同一个 producer 可以执行两次。工具集合只有一个 analyze_javascript_application，调用计划却有两个资源实例，单纯 top-k 或工具名 DAG 不能完整表达。

### 工作流三：复用分析与连接失效恢复

1. 用户继续问同一 artifact 的另一个模块，用已知账本或 get_evidence_bundle(detail: "summary") 查找记录。
2. 确认 artifact 身份、分析配置及 Evidence 类型相符后直接调用 view/trace。
3. upstream 重启后连接 epoch 改变，旧 retained reference 失效；返回明确状态，按白名单重新分析。
4. MVP 不自动导入外部 Evidence，也不把磁盘缓存 ID 当作新连接仍存在的记录。

已核查的上游语义：换 target 保留账本；close_binary 即使没有 binary 也会清空；新连接有独立账本。[保留记录与输入说明](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md#retained-application-evidence-inputs)

第一次分析若返回完整 Evidence，可使用其 ID；summary 返回时必须区分父记录。后续 JavaScript 工作流消费分析结果，无需再启动 native provider。[JavaScript 工作流](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md)

## 6. 最小架构与职责

~~~text
Agent Host
  └─ ReaRoute MCP 入口
       ├─ Catalog：广告定义、索引、版本与成本估计
       ├─ Router：词法召回、资源前置条件、下一步选择
       ├─ Session：连接 epoch、当前 Evidence 资源账本
       ├─ Policy：允许工具、允许 artifact、参数约束
       ├─ Executor：调用、取消、deadline、upstream 生命周期
       └─ Trace：候选、实际调用、状态变化、错误与成本
            └─ 固定版本 REA
~~~

四个 meta-tools 为 rea_route、rea_get_tool、rea_call、rea_explain_route。搜索和执行分开，但不要求为演示固定调用四次；route 返回有限说明，已知 schema 不重复读取。

这是显式 meta-tool 适配模式，不能宣传为完全透明的 MCP 代理。原工具的名称、独立 input/output schema、静态 annotations 不再直接出现在 Host 的原生列表。

## 7. 状态与依赖：先解决正确性

### 7.1 资源账本

每条资源至少记录：connectionEpoch、Evidence ID、producer operation、artifact digest、分析配置标识、Evidence 类型、coverage，以及它是完整记录还是派生 view。

用户输入 applicationEvidence: true 或模型口头描述不能成为可信状态。资源来自真实上游返回或已验证的同连接查询。路径相同不保证内容相同；无法确认 artifact/config 身份时不能宣称缓存可复用。

先使用内存账本和可重放 JSONL 轨迹，不另外造数据库。进程重启后重新建立连接状态；日志用于排查，不自动恢复未经核实的 retained ledger。

### 7.2 availability 与前置条件

| 分类 | 例子 | 路由行为 |
|---|---|---|
| policy 禁止 | 不在静态分析白名单 | 直接排除，不能由模型解锁 |
| 缺资源、可补齐 | 尚未生成 A 版本分析 | 将 producer 加入计划，消费步骤暂缓 |
| 当前能力不可满足 | 固定环境缺少所需能力 | 返回具体原因和不支持状态 |
| 未知或陈旧 | 连接重建、探测信息缺失 | 刷新状态或明确未知 |
| 已满足 | 有同连接兼容 Evidence | 进入下一步候选 |

先判断可信 policy，再召回并补齐资源，再做预算选择，执行前重新检查。不能把目录 unavailable 一律当作永远不可能，也不能把 discovery 信息当作运行时成功证明。

### 7.3 调用实例计划

MVP 维护三条人工审查的 workflow template 及具体 Evidence 绑定，暂不开发通用规划语言。区分 AND 前置条件、替代 producer、重复分析实例和已存在资源。

缺前置的叶子工具可以列入“待执行”计划，但不能立即调用。每步成功后根据真实返回更新账本；失败进入明确分支，不猜测 producer 已完成。

采用可行的启发式选择，预算不足时明确返回原因，不能将 greedy 结果描述成全局最小工具链。

## 8. Route ticket、参数边界与授权

rea_route 返回的 ticket 是服务端保存的计划引用，帮助定位候选及版本。它不代表用户授权，也不允许模型请求更高 allowedEffect 自行扩大权限。

调用同时要求：本地可信配置许可、当前会话可用、工具在计划范围、参数指向允许资源、前置条件成立。服务器配置的 policy 是权限来源，模型输入仅表达意图。

ticket 关联连接 epoch、catalog/metadata 版本、policy revision、步骤和资源角色。每次核验实际参数，防止获准分析 A 的计划被用于 B，或把 A 的 Evidence 换成另一目标记录。

策略使用具体能力与资源约束，不能只有 read-only < run < modify 数字等级。第一版限制输入目录、允许工具及保留记录范围，不提供任意命令或任意网络目标。

路径限制要处理规范化、父目录穿越、符号链接和 Windows 重解析点，不能只比较字符串前缀。只读也可能读取秘密，因此默认使用批准的测试目录。代理的参数限制不是 REA 进程的 OS 沙箱，不承诺防御恶意 upstream；检查与调用之间仍存在的文件变化窗口应公开说明。

每个任务独占代理创建的上游连接，所有调用由同一执行器串行调度；不支持其他客户端共享该连接修改状态。catalog 描述、源码和工具结果中的指令视为数据，不能改变本地 policy。新增 Evidence 不影响现有授权，但不能自动扩大允许的 artifact 范围。

policy、upstream 连接或目录合同改变后废弃旧 ticket；正常新增 Evidence 只更新账本并继续核验。不能因成功完成前置步骤就让计划自失效。

MCP annotations 是提示，不是授权系统；参数校验也不等于权限校验。通用 meta-tool annotations 无法准确表达所有上游行为，所以 MVP 使用固定静态白名单。[MCP 工具规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

## 9. Catalog、schema 和缓存

保留原始广告定义，另外创建搜索投影。rea_get_tool 标注 schema profile、catalog identity 和来源，忠实返回广告 schema；full/compact 都不保证等价于 canonical runtime validator。

本地校验负责 meta-tool envelope、大小限制和 policy 参数边界；REA 负责 canonical 参数及领域校验。不能通过删未知字段、补默认值或以 compact 验证成功代替 canonical 成功。

| 缓存 | key 应包含 | 失效条件 |
|---|---|---|
| Catalog/检索索引 | 上游身份、广告 digest、schema profile、手工 metadata 版本 | 定义或 metadata 改变 |
| Token 估计 | 定义身份、Host 序列化方式、tokenizer/model 标识 | 任意一项改变 |
| 路由建议 | query、连接/资源状态、policy、预算、路由版本 | 状态或约束改变 |

digest 是一致性标识，不是可信来源证明。排序工具名和对象键，保留有语义的数组顺序；description、effect metadata 等影响检索或策略的字段也参与相关缓存身份。

catalog digest 不代替 live state；availability 改变时目录可能不变。资源账本正常新增无需重新生成 catalog 索引。

MVP 不缓存工具执行结果，只复用经验证仍在当前连接的 Evidence，避免过期结果、失败或旧连接 ID 被误当作有效返回。

## 10. 检索、预算与计量

先用一种词法方案，如 MiniSearch 或固定配置 BM25；实现和报告必须使用真实算法名称，不同时引入 SQLite、向量数据库及 reranker。

原方案把 BM25 乘 0.40 后叠加若干 0–1 值，尺度不一致。第一版采用明确排序规则或归一化分数；参数只在开发集调整，不看测试集改规则。

预算分两层：路由器控制本次返回大小；真实 Host 控制全会话上下文。四个 meta-tools 减少初始目录，但 get_tool 返回可能留在历史中，并增加模型轮次。

记录以下指标：

- 首轮工具定义 tokens，以及逐步取回的 schema tokens。
- 每轮实际 input/output tokens，能够取得时记录 cached input tokens。
- 全任务累计输入/输出、峰值请求上下文、轮数和端到端耗时。
- Router 本地耗时与上游分析耗时分别报告。
- 失败、超时、发现和重试均进入任务成本分母。

近似窗口预算为“窗口上限 − 系统/用户/历史 − 预留输出 − 工具结果余量”。tokenizer 只是估计；真实 Host 序列化、包装及模型统计才是最终依据。

取不到 Host 边界数据时，只能声称“本地 schema 成本估计”，不能声称费用下降。预算不足时返回原因或分步披露，不静默截断必需约束。历史压缩由选定 Host 处理，所有 baseline 使用相同策略。

## 11. 执行可靠性与错误语义

单连接内先串行执行，限制队列长度和每次 deadline，明确不是高并发系统。稳定后才考虑同资源请求合并；不为简历添加没有需求的队列平台。

| 故障 | 必须处理的结果 |
|---|---|
| 广告校验通过、REA 拒绝 | 保留规范错误，不放松校验或重复原请求 |
| 客户端取消 | 映射 request ID，传播取消，清理本地等待 |
| 超时但没收到结果 | 标记执行状态未知，先查询账本/健康，不无条件重试 |
| upstream 退出 | 终止挂起请求，增加 epoch，旧引用失效 |
| 返回部分观察 | 保留 partial/unknown 和诊断，不转成完整成功 |
| 响应过大 | 明确返回代理容量错误；仅使用上游真实支持的 view/summary 或 continuation，不编造续页引用 |
| policy/catalog 改变 | 拒绝旧计划，返回重新路由原因 |

静态分析也会修改 Evidence 会话。仅当确认未发送，或工具重试行为经测试且符合策略时才自动重试，不实现通用 exactly-once 承诺。

转发保留 content、structuredContent、isError、相关 _meta、完整 Evidence 与未知字段；错误和成功分开校验。进度、取消独立映射并测试。[MCP 取消规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation)

队列、输入、响应和日志均设大小上限；不能为控制体积悄悄改写成功响应。超限未交付的响应要单独计数，不称作无损透传成功。日志配置保留与清理策略，默认不记录凭据；发送源码或结果给远端模型前明确内容范围。

## 12. 评测：证明有用，而不是只缩小目录

相同 model、Host、artifact、任务、资源预算和结果读取方式下运行：

| Baseline | 回答的问题 |
|---|---|
| 完整 compact 目录 | 相比默认方式有什么变化？ |
| 人工静态 JS 工具小集合 | 简单配置是否已经解决问题？这是强基线 |
| 通用词法搜索 + 相同 meta-tools | 增益来自状态逻辑，还是仅减少工具？ |
| ReaRoute | 资源绑定、前置补齐、重规划是否有收益？ |

full 目录只做历史成本参考；请求超窗应记录“不兼容”，不能把失败组当成唯一对照。Host 原生 tool search 若可用，增加同环境对照；否则明确未比较。

所有方案统一使用 summary/retained Evidence，不能只给 ReaRoute 小结果而让 baseline 接收整份大图，再把结果压缩收益归因于 Router。

### 12.1 数据与规模

验证阶段：12–20 条路由/state cases，三个工作流，每类至少一个正常和一个故障案例。

扎实版：40–60 条离线路由样例、8–12 条真实端到端任务，每条重复 3 次。按 fixture 与工作流变体划分开发/保留集，避免同题改写跨集合泄漏。

样例标注输入资源、允许的多种调用顺序、结果断言，不能只有 required tool names。数据规模支持局部工程结论，报告分子/分母和波动；不能据此宣称统计显著或全场景成功率不下降。

### 12.2 核心指标

| 指标 | 定义 |
|---|---|
| 任务正确率 | 最终结果满足 fixture 预先定义的断言 |
| 资源绑定正确率 | 正确 artifact、版本、parent Evidence 与连接 |
| 无效调用 | 缺前置、旧引用、错误参数、不支持能力分别统计 |
| 重复分析次数 | 可复用资源存在时是否仍运行 producer |
| 成本及延迟 | 包括发现、schema 返回、历史、失败、重试 |
| 协议保真 | 同一次上游结果经代理后完整字段保留 |
| Policy 正确性 | 允许请求成功、越界被拒；同时统计误拒 |

不能要求两次独立运行的 Evidence ID 必然相同。保真测试对同一可控上游响应逐字段比较；真实任务确认该次收到的 ID 和内容未被改写。

### 12.3 消融与验收

分别移除状态、资源绑定、前置补齐，跑同一保留集，判断哪一部分有用；保存版本、模型设置、冷/热缓存状态和原始结果。

验收要求：三工作流闭环可重复；故障不伪报成功；旧连接及越界参数正确处理；全任务成本可追溯。90% 节省、95% Recall 和零故障必须等实测，不能当已实现能力。

继续项目的依据：相对静态集合或通用搜索，在重复分析、资源错误或实际成本上出现可解释收益，并披露成功率损失。无收益则收缩为适配器、benchmark 或上游贡献。

## 13. 开源复用与实现结构

TypeScript + Node.js 配合固定版 MCP SDK。可阅读或 Fork MIT 的 [mcp-tool-search](https://github.com/KGT24k/mcp-tool-search) 复用目录快照、检索入口和代理骨架；目前只核对公开说明，未验证与当前 REA、SDK 和协议版本兼容。

Fork 前检查许可证、依赖锁定、错误透传、子进程回收和取消支持。适配成本过高时用官方 SDK 做单 upstream 入口，不因“基于开源”继承多 server 管理负担。[lazy-tool](https://github.com/mcp-shark/lazy-tool) 作为对照，不默认移植其 Go 代码。

~~~text
src/catalog/       # 原始定义、索引、版本、估算
src/router/        # 三条 workflow、召回、资源前置
src/session/       # 连接 epoch、Evidence ledger
src/policy/        # 白名单、参数资源范围
src/proxy/         # meta-tools、执行、进度、取消
src/telemetry/     # 轨迹与计量
fixtures/          # 自建 JS/Electron 目录及版本对
bench/             # 数据切分、baseline、结果与报告
tests/             # 资源语义、协议、故障、契约
~~~

## 14. 工时、里程碑与停止条件

以下为熟悉 TypeScript、API 和基本测试的单人有效工时估计，非承诺。首次接触 MCP/REA 另加约 30%–60% 学习缓冲；模型费用由实际选择和试验次数决定。

| 阶段 | 累计有效工时 | 交付物 |
|---|---:|---|
| 可行性验证 | 20–30 小时 | 固定版本运行、三真实链路、静态集合基线、实际成本采样 |
| 最小可演示版 | 40–65 小时 | 单 Host/模型/上游、资源账本、四入口、基础故障、三流程演示 |
| 扎实面试版 | 85–130 小时 | 保留集和消融、取消/重启/超时实验、原始轨迹、报告及复盘 |

这些是累计数，不相加。每周 12–16 小时，扎实版约 6–11 周；每周 30 小时，约 3–5 周。原文“业余 3–4 周完成完整简历版”的估计撤回。

20–30 小时关卡：静态七工具是否够用？Host 是否已有等价发现？资源状态错误是否存在？能否测可信成本？至少一个核心假设成立才进入代理开发。

40–65 小时关卡：三流程真实可跑，错误可解释，能故意制造旧引用/缺资源并恢复。仍只有“搜索再调用”时，不以独立主项目继续加功能。

85–130 小时用于完善证据和故障处理，不扩张平台。固定版本 CI 为阻断检查；最新 upstream 兼容检测可作为后续非阻断任务。

## 15. 后端面试官会怎样追问

| 问题 | 合格回答需要的材料 |
|---|---|
| 七个工具直接给模型不就行了？ | 静态集合成本与资源错误对比；可能承认它更好 |
| 你的代码和 Fork 边界在哪里？ | 分模块列复用/修改/新增，提交记录与许可证 |
| 为什么需要 Agent？ | Router 不需要 LLM；说清外部 Agent 和执行层分工 |
| 怎样判断分析存在且能复用？ | artifact/config/connection 资源键，parent/summary 区别 |
| A、B 的比较如何避免拿错对象？ | 左右资源绑定及失败测试 |
| unavailable 或状态变化怎么处理？ | 可补前置、未知、禁止各自路径，执行前核验 |
| 模型拿 ticket 换参数怎么办？ | 每次独立 policy 校验，ticket 不扩大权限 |
| 超时能重试吗？ | 未发送、已发送未知、已产生 Evidence 的不同处理 |
| 代理取消后 REA 是否继续占资源？ | 真实取消传播、进度和进程生命周期实验 |
| digest 一样就能复用旧结果吗？ | 定义身份、live state、资源 identity 的职责 |
| 节省 tokens 算没算多轮历史？ | Host 请求边界逐轮数据和费用口径 |
| 怎样证明成功率没下降？ | 保留集、重复运行、断言、失败清单和样本局限 |
| 为什么能称无损？ | 同一响应保真测试，错误/_meta/进度边界 |
| 换个 Host 还能用吗？ | 只承诺实测组合，不把接口一致当全生态兼容 |

## 16. 简历表述与判断

未完成时只能写“设计中”，不要提前填收益。完成后可以写：

> 基于 REA 与 MCP 实现单机工具中间件，维护同连接 Evidence 资源账本与参数约束，支持三类 JavaScript 分析工作流；实现目录版本校验、取消/超时处理及调用轨迹，并以固定工具集和通用搜索作对照评测。

实测后再补“N 个任务、M 次运行中，资源错误从 X 到 Y，全任务 tokens/延迟为……”，标注模型及范围。不能将历史 issue 的 207 个工具或 66K tokens 当成自己的成绩。

对后端岗位，它展示接口合同、状态一致性、资源生命周期、失败语义及实验设计；对 Agent 岗位，展示工具发现和上下文代价，不能代替完整 Agent 经验。

建议先投入 20–30 小时做实证。固定工具小集合若达到同等表现，停止扩张并交付可复现的评测与适配器，也是有效工程产出。
