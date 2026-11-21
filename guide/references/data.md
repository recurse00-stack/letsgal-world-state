# 建立资料与查询关系

“生成实例”只在执行时分配编号。选择类型和数量，再为结果命名为 arrows。一次生成十支箭后，arrows 是十个独立的来源与编号引用。转交、拆堆或消耗时传入选中的引用，图标与类型默认资源可以继续共用。

打开世界状态设置页。先在“对象类型”添加“天气”，给它一个数值字段 modifier；再创建“场景”，给它一个引用字段 weather。为角色类型创建 place 引用。新建“雨”“广场”“调查员”三个对象，分别关联到上一级对象。编辑器显示的稳定编号可用于参数。名称可以修改。

字段支持数值、文本、开关、对象引用、结构、列表、片段和来源方法，对应 number、text、boolean、ref、object、list、fragment、action。嵌套结构用 fields 描述成员，列表用 items 描述成员类型。对象初值按类型默认值补全。读天气修正时，用角色作起点，依次读取 place、weather、modifier。

```json
{"op":"read","ref":{"source":"world","id":"hero"},"path":["place","weather","modifier"]}
```

查询遮雨效果时可限定有 cover 词条、owner 指向本次角色、open 为真。只检查指定伞时直接按其编号读取。存在、计数、列表和单个匹配分别使用 exists、count、list、one。单个匹配要求恰好一个结果。展示可以合并十支箭，产生时应给每支自己的编号，转交只改 owner。消耗后原号仍可报告已消耗。

修改状态使用 write，一步中可以放多个 operations。支持 create、set、add、consume。字段和值校验通过后才一并提交。配置中的定义、存档中的现状和使用者的临时显示各有独立职责。
