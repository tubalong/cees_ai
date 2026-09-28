import { Module } from '@nestjs/common';
import { AiOrchestrationModule } from '../ai-orchestration/ai-orchestration.module';
import { DocumentModule } from '../document/document.module';
import { FinanceModule } from '../finance/finance.module';
import { ImageModule } from '../image/image.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { OrganizationModule } from '../organization/organization.module';
import { ProjectModule } from '../project/project.module';
import { StorageModule } from '../storage/storage.module';
import { TaskModule } from '../task/task.module';
import { UserMemoryModule } from '../user-memory/user-memory.module';
import { WebSearchModule } from '../web-search/web-search.module';
import { AssistantController } from './api/assistant.controller';
import { AssistantActionDraftController } from './api/assistant-action-draft.controller';
import { AssistantConnectorController } from './api/assistant-connector.controller';
import { AssistantTaskInteractionsController } from './api/assistant-task-interactions.controller';
import { AssistantTasksController } from './api/assistant-tasks.controller';
import { DingTalkConnectorPlannerService } from './connectors/dingtalk-connector-planner.service';
import { TencentMeetingConnectorPlannerService } from './connectors/tencent-meeting-connector-planner.service';
import { WeComConnectorPlannerService } from './connectors/wecom-connector-planner.service';
import { GitHubConnectorPlannerService } from './connectors/github-connector-planner.service';
import { GitHubOAuthBrokerService } from './connectors/github-oauth-broker.service';
import { ConversationService } from './conversation/conversation.service';
import { EventService } from './conversation/event.service';
import { AssistantActionDraftService } from './drafts/assistant-action-draft.service';
import { InteractionService } from './orchestration/interaction.service';
import { OrchestrationToolsService } from './orchestration/orchestration-tools.service';
import { PlanService } from './orchestration/plan.service';
import { StepRunnerService } from './orchestration/step-runner.service';
import { StepStateService } from './orchestration/step-state.service';
import { TaskEventService } from './orchestration/task-event.service';
import { TaskRunnerService } from './orchestration/task-runner.service';
import { TaskService } from './orchestration/task.service';
import { ContextBuilderService } from './runtime/context-builder.service';
import { IntentCapabilityService } from './runtime/intent-capability.service';
import { TurnRunnerService } from './runtime/turn-runner.service';
import { TurnRecoveryService } from './runtime/turn-recovery.service';
import { TurnStateService } from './runtime/turn-state.service';
import { AssistantMessageContentService } from './runtime/message-content.service';
import { ToolRegistryService } from './tools/tool-registry';
import { ToolPolicyService } from './tools/tool-policy.service';
import { GenerateDocumentTool } from './tools/executors/generate-document.tool';
import { GenerateImageTool } from './tools/executors/generate-image.tool';
import { CreateDepartmentTool } from './tools/executors/create-department.tool';
import { CreateKnowledgeBaseTool } from './tools/executors/create-knowledge-base.tool';
import { CreateOrchestrationTaskTool } from './tools/executors/create-orchestration-task.tool';
import { CreateProjectTool } from './tools/executors/create-project.tool';
import { CreateTaskTool } from './tools/executors/create-task.tool';
import { KnowledgeSearchTool } from './tools/executors/knowledge-search.tool';
import { ListDepartmentsTool } from './tools/executors/list-departments.tool';
import { ListKnowledgeBasesTool } from './tools/executors/list-knowledge-bases.tool';
import { ListKnowledgeDocumentsTool } from './tools/executors/list-knowledge-documents.tool';
import { ListProjectsTool } from './tools/executors/list-projects.tool';
import { ListTasksTool } from './tools/executors/list-tasks.tool';
import { UpdateTaskStatusTool } from './tools/executors/update-task-status.tool';
import { SaveToKnowledgeTool } from './tools/executors/save-to-knowledge.tool';
import { InsertDocumentImageTool } from './tools/executors/insert-document-image.tool';
import { WebSearchTool } from './tools/executors/web-search.tool';
import { ListDocumentsTool } from './tools/executors/list-documents.tool';
import { ImportFinanceLedgerTool } from './tools/executors/import-finance-ledger.tool';

/**
 * 统一 AI 编排核心。会话事实源、事件重放与唯一 Tool Loop 运行器都在本模块内，
 * 图片、任务、文档等能力以工具执行器接入 TurnRunner，不复制编排逻辑。
 * 所有 AI 工具必须在这里注册：ToolRegistry/ToolPolicy 提供统一批准闸口，
 * 执行器在 onModuleInit 自注册，新增工具只需新增 provider。
 */
@Module({
  imports: [AiOrchestrationModule, DocumentModule, FinanceModule, ImageModule, KnowledgeModule, OrganizationModule, ProjectModule, StorageModule, TaskModule, UserMemoryModule, WebSearchModule],
  controllers: [AssistantActionDraftController, AssistantController, AssistantConnectorController, AssistantTaskInteractionsController, AssistantTasksController],
  providers: [
    ConversationService,
    DingTalkConnectorPlannerService,
    TencentMeetingConnectorPlannerService,
    WeComConnectorPlannerService,
    GitHubConnectorPlannerService,
    GitHubOAuthBrokerService,
    EventService,
    ContextBuilderService,
    IntentCapabilityService,
    ToolRegistryService,
    ToolPolicyService,
    TurnStateService,
    AssistantMessageContentService,
    AssistantActionDraftService,
    TurnRunnerService,
    TurnRecoveryService,
    TaskEventService,
    PlanService,
    InteractionService,
    TaskService,
    StepStateService,
    StepRunnerService,
    TaskRunnerService,
    OrchestrationToolsService,
    CreateDepartmentTool,
    CreateOrchestrationTaskTool,
    CreateProjectTool,
    CreateTaskTool,
    GenerateDocumentTool,
    GenerateImageTool,
    CreateKnowledgeBaseTool,
    KnowledgeSearchTool,
    ListDepartmentsTool,
    ListKnowledgeBasesTool,
    ListKnowledgeDocumentsTool,
    ListProjectsTool,
    ListTasksTool,
    UpdateTaskStatusTool,
    SaveToKnowledgeTool,
    InsertDocumentImageTool,
    WebSearchTool,
    ListDocumentsTool,
    ImportFinanceLedgerTool,
  ],
})
export class AssistantModule { }
