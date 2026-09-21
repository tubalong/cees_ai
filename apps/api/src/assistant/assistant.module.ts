import { Module } from '@nestjs/common';
import { AiOrchestrationModule } from '../ai-orchestration/ai-orchestration.module';
import { DocumentModule } from '../document/document.module';
import { ImageModule } from '../image/image.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { StorageModule } from '../storage/storage.module';
import { UserMemoryModule } from '../user-memory/user-memory.module';
import { WebSearchModule } from '../web-search/web-search.module';
import { AssistantController } from './api/assistant.controller';
import { AssistantConnectorController } from './api/assistant-connector.controller';
import { DingTalkConnectorPlannerService } from './connectors/dingtalk-connector-planner.service';
import { ConversationService } from './conversation/conversation.service';
import { EventService } from './conversation/event.service';
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
import { CreateKnowledgeBaseTool } from './tools/executors/create-knowledge-base.tool';
import { KnowledgeSearchTool } from './tools/executors/knowledge-search.tool';
import { ListKnowledgeBasesTool } from './tools/executors/list-knowledge-bases.tool';
import { SaveToKnowledgeTool } from './tools/executors/save-to-knowledge.tool';
import { InsertDocumentImageTool } from './tools/executors/insert-document-image.tool';
import { WebSearchTool } from './tools/executors/web-search.tool';
import { ListDocumentsTool } from './tools/executors/list-documents.tool';

/**
 * 统一 AI 编排核心。会话事实源、事件重放与唯一 Tool Loop 运行器都在本模块内，
 * 图片、任务、文档等能力以工具执行器接入 TurnRunner，不复制编排逻辑。
 * 所有 AI 工具必须在这里注册：ToolRegistry/ToolPolicy 提供统一批准闸口，
 * 执行器在 onModuleInit 自注册，新增工具只需新增 provider。
 */
@Module({
  imports: [AiOrchestrationModule, DocumentModule, ImageModule, KnowledgeModule, StorageModule, UserMemoryModule, WebSearchModule],
  controllers: [AssistantController, AssistantConnectorController],
  providers: [
    ConversationService,
    DingTalkConnectorPlannerService,
    EventService,
    ContextBuilderService,
    IntentCapabilityService,
    ToolRegistryService,
    ToolPolicyService,
    TurnStateService,
    AssistantMessageContentService,
    TurnRunnerService,
    TurnRecoveryService,
    GenerateDocumentTool,
    GenerateImageTool,
    CreateKnowledgeBaseTool,
    KnowledgeSearchTool,
    ListKnowledgeBasesTool,
    SaveToKnowledgeTool,
    InsertDocumentImageTool,
    WebSearchTool,
    ListDocumentsTool,
  ],
})
export class AssistantModule { }
