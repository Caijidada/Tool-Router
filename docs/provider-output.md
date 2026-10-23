# S3a：评分器输出校验

parseProviderDecision 把评分器返回值当作 unknown，仅接受两个明确结构：

```ts
{ kind: "selected", toolId: "git::diff", confidence: 0.8 }
{ kind: "abstained", reason: "no_suitable_tool" /* 或 uncertain */ }
```

- selected 的 toolId 必须是本次实际交给评分器的候选，不能只是在总目录里存在。
- confidence 必须是有限数值，范围含 0 与 1；本层不负责设置或校准使用门限。
- 不允许缺字段、多字段、类型强转、符号键、访问器、非普通对象；也接受 null 原型的普通数据对象。
- 通过属性描述符检查普通 getter，不执行它；结果重新构造并冻结。
- 非法返回抛出 ProviderOutputError，错误信息不附带原始返回、异常详情或凭据。
- 这是数据边界，不是对同进程恶意 JavaScript 或 Proxy 的执行沙箱。HTTP 适配器应先解析有大小限制的 JSON 响应。

验证：tests/provider-output.test.ts；独立覆盖正常结果、置信度边界、候选外 ID、错误字段、访问器和反射异常。模拟输出测试不能证明任何真实模型的准确率。
