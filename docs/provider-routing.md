# S3b：可替换评分器与失败处理

routeTools 保留为同步词法基线；routeWithProvider 显式使用调用方传入的 DecisionProvider。目前仓库只有模拟评分器，未提供 Jev HTTP 实现，不会自动读取密钥或执行工具。

## 入口与设置

在使用 buildCatalog 建立目录、提供可信 policy/state 后，可以调用：

```ts
const result = await routeWithProvider(request, {
  provider: myProvider,
  minConfidence: 0.8,
  timeoutMs: 1_000,
  candidateLimit: 8,
  fallback: "none",
  signal: controller.signal,
});
```

0.8 仅为示例，不是已校准的推荐阈值。minConfidence 必填且为有限 [0,1] 数值；恰好等于阈值可以接受。timeoutMs 为 1–60000 的整数，约束评分器等待，不包括目录构建、候选准备和输出解析的同步耗时。

candidateLimit 默认 8、范围 1–32，决定提供给评分器的候选上限。request.limit 只控制结果中 candidates 的展示数量，范围 1–50。providerCandidateIds 独立记录本轮准备的评分名单，因此展示被截断也不会丢失评分范围的记录。准备完成后仍可能在派发前取消或超时，所以该字段不是请求已发送或远端已计费的证明。

## 决策边界

1. 复用同步基线的可信白名单、完整排序与状态快照。最高相关候选未知或缺少前置条件时，不调用评分器；没有允许工具或没有词法匹配也不调用。
2. 从允许且 ready 的匹配工具中准备候选；名称、描述、查询以冻结副本传入，不发送完整 Schema、policy 或 state 对象。
3. 如果候选预算会切断一个并列分数组，返回 candidate_budget_exceeded，不让截断制造虚假的唯一候选；调用方可明确增加预算。
4. 评分器可以在完整保留的并列候选中选择，但输出必须经过严格解析、当轮候选成员校验和置信度门限。
5. 调用开始前固定参数、提供者方法和目录/策略/状态版本。调用期间修改原配置不会偷偷改变本次决策；这也意味着版本可能已经过时，执行前仍须重新授权和检查实时状态。

query 按调用方提供的内容传入评分器，没有自动脱敏。未来配置远程评分器时，调用方必须先决定查询是否包含敏感内容，不能因为候选字段较少就认为整次请求已经脱敏。

## 超时、取消与回退

| 情况                | 默认行为                      | 显式 fallback: lexical   |
| ------------------- | ----------------------------- | ------------------------ |
| 同步抛错或异步拒绝  | provider_error，拒选          | 使用调用前的保守词法结果 |
| 到达等待期限        | provider_timeout，拒选        | 使用调用前的保守词法结果 |
| 用户取消            | cancelled，拒选               | 不回退                   |
| 非法返回或候选外 ID | invalid_provider_output，拒选 | 不回退                   |
| 低于置信度门限      | low_confidence，拒选          | 不回退                   |
| 评分器主动拒选      | no_suitable_tool / uncertain  | 不回退                   |

结果的 source 区分 guard、provider、lexical-fallback。providerStatus 保留本次评分器状态；词法回退没有 confidence 字段，不将词法重合分数包装成模型概率。回退使用已固定的保守基线，并列仍拒选，不扩大名单或放宽状态。

评分器收到内部 AbortSignal。即使其忽略 signal，路由也会结束异步等待、忽略迟到结果并消费迟到的 rejection；清理本地定时器与取消监听器。真正派发调用前会再次核验 deadline，过期不再启动调用。

限制：同进程同步代码若阻塞事件循环，计时器无法强行中断它；忽略取消的后台请求也不保证停止。Provider 是可信代码，不是被隔离的插件；本层不承诺停止远端计费。将来的 HTTP 适配器仍需传播 signal、限制响应大小并控制重试。

## 可运行演示与验证

运行 npm run demo:provider，可以离线看到五个场景：模拟选择、候选外结果拒绝、显式回退、超时、取消。使用人工响应和模拟状态，不是 Jev 准确率或性能评测。

tests/provider-output.test.ts 验证解析边界；tests/provider-routing.test.ts 验证编排、状态、候选预算、超时取消和快照隔离；tests/provider-demo.test.ts 验证演示及独立 CLI。后续 S4 才连接 Jev HTTP 协议。
