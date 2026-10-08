# Git 提交信息规则

格式：`<type>: <中文描述>`（一行，≤50 字）

- **type 取值**：`feat` 新功能｜`fix` 修复｜`refactor` 重构｜`docs` 文档｜`style` 样式/格式｜`chore` 构建/依赖/杂项
- 描述用中文、祈使语气，说明"做了什么"，不加句号
- 涉及范围可加前缀，如 `feat(web): `、`fix(server): `
- 示例：
  - `feat(server): 新增元件回收站软删除`
  - `fix(web): 修复单价折算四舍五入错误`
  - `chore: 升级 drizzle-orm 到 0.44`
