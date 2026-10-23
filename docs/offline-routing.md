# S2：可拒选的离线路由基线

## 输入

routeTools 接收 query、CatalogSnapshot、可信 RoutingPolicy 和可信 RoutingState。策略必须明确列出 namespaced tool ID；空名单拒绝全部，不接受模型自行申请权限。状态由真实适配器负责提供，首个 demo 只使用人工模拟状态。

## 决策流程

1. 校验策略与状态版本；策略引用未知工具时拒绝配置。
2. 先过滤不被允许的工具，再做词法召回。
3. 使用工具名称与描述的精确词项重合排序，名称命中权重 2，描述命中权重 1；重复查询词只计一次。
4. 最佳候选状态未知时返回 state_unknown；缺少资源时返回 needs_prerequisites，不偷偷换成弱相关的可用工具。
5. 最佳候选并列时返回 ambiguous；没有匹配返回 no_match；仅唯一最佳且 ready 才返回 selected。

输出候选数量限制不会把并列前两名截成一个后假装唯一。结果保存 catalogDigest、policyRevision、stateRevision；这些是建议产生时的快照标识，不是防重放授权或实时执行凭证。

## 明确限制

- 简单中英文分词使用 Node 的 Intl.Segmenter，分词结果依赖 ICU 版本；实测应记录 Node 和 ICU 版本。
- 不是 BM25、Embedding 或语义检索，没有同义词理解，也不做跨语言翻译。
- 只搜索 name/description，不扫描完整 Schema 或用户源码。
- policy 过滤后仍可能选到词项相似但语义不合适的合法工具；这正是后续 Jev 实验要测量的问题。
- 不生成前置步骤、不验证资源真实性、不检查实际调用参数、不执行工具。
- 本页的同步 routeTools 不调用评分器；异步 routeWithProvider 的校验、等待超时、取消与受限回退详见 [S3 编排](provider-routing.md)。尚无真实 Jev HTTP 实现。

## 验证

tests/retrieval.test.ts、tests/routing.test.ts 覆盖中英混合、零匹配、并列、权限过滤、缺资源、状态未知、配置错误及结果快照隔离。

tests/demo.test.ts 验证四个离线场景以及编译后 CLI 可运行。测试中的 fake 状态不是真实 MCP 状态，不能据此宣称已连接真实工具。
