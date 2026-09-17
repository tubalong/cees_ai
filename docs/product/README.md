# 产品范围

## 使用与验收

- [平台使用、接口与数据库字典](platform-usage-guide.md)：管理员账号、149 个 HTTP 操作、参数含义、平台流转、业务表和 Navicat 查询。
- [公开 AI 对话链路与 Token 计量](../architecture/public-chat-api-and-token-metering.md)：本地对话历史、公开 Chat API 与企业/成员/会话/轮次用量记录。
- [组织部门管理](organization-department-management.md)：租户内部门树、权限、成员归属、审计和数据库约束。
- [组织架构与成员批量导入](organization-member-import.md)：前端 Excel 解析、后端校验、事务导入和一次性激活凭证。
- [项目与项目成员管理](project-management.md)：成员可见范围、项目角色、状态机、完成后只读和归档规则。
- [项目任务管理](task-management.md)：任务 CRUD、父子任务、执行人、状态机、评论、COS 附件和动态。
- [会议管理](meeting-management.md)：会议 CRUD、参会角色、状态机、邀请应答、实际出席和会议纪要。
- [日报与周报管理](work-report-management.md)：报告周期、审核状态机、项目任务关联、权限和审计。
- [通知中心与后台任务](notification-center.md)：站内通知、未读状态、幂等投递、过期清理和日报提醒。
- [工作台与数据看板](dashboard-workbench.md)：项目、任务、报告、会议和通知的实时概览与待办聚合。
- [知识库管理](knowledge-base-management.md)：第一阶段知识库 CRUD、成员权限、租户隔离、乐观锁和审计。
- [用户个人资料管理](user-profile-management.md)：成员查询并修改自己在当前租户内的展示资料。
- [密码修改与凭证安全](../security/password-management.md)：租户成员与平台管理员修改自己的密码。
- [钉钉组织架构与人员同步](dingtalk-organization-sync.md)：一个租户绑定一个钉钉企业，验证凭证并同步外部部门和人员镜像。
- [分配策略与人财法](assignment-and-hr-finance-legal.md)：AssignmentPolicy 与完整 HR 主线已实现；通用任务范围与 Finance/Legal 仍为契约草案。

待补充。建议按以下维度维护：

- 目标用户与核心工作流；
- MVP 边界与验收口径；
- 版本规划与发布说明；
- 桌面端与移动端的能力差异。

## 已落地功能

- [Desktop 企业账号登录](desktop-login.md)
- [Mobile 主界面与双模式 AI 助理](mobile-shell.md)
- [个人资料与账号安全](profile-security.md)
- [组织与部门管理](organization-management.md)
- [企业角色与权限管理](role-management.md)
- [平台租户与管理员管理](platform-tenant-management.md)
- [分配策略管理](assignment-and-hr-finance-legal.md)
- [人力资源管理](assignment-and-hr-finance-legal.md)
- [Desktop 多语言支持](desktop-i18n.md)
- [协作域客户端对接（项目/任务/会议/报告/通知/工作台/AI/批量导入/文件上传）](collaboration-domains.md)
