import { Module } from '@nestjs/common';
import { AiOrchestrationModule } from '../ai-orchestration/ai-orchestration.module';
import { StorageModule } from '../storage/storage.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeDocumentService } from './knowledge-document.service';
import {
    KNOWLEDGE_DOCUMENT_PARSER,
    MinerUDocumentParser,
    RoutedKnowledgeDocumentParser,
} from './knowledge-document-parser';
import { KnowledgeIndexingService } from './knowledge-indexing.service';
import { KnowledgeService } from './knowledge.service';

@Module({
    imports: [AiOrchestrationModule, StorageModule],
    controllers: [KnowledgeController],
    providers: [
        KnowledgeService,
        KnowledgeDocumentService,
        KnowledgeIndexingService,
        MinerUDocumentParser,
        RoutedKnowledgeDocumentParser,
        { provide: KNOWLEDGE_DOCUMENT_PARSER, useExisting: RoutedKnowledgeDocumentParser },
    ],
    exports: [KnowledgeService, KnowledgeDocumentService],
})
export class KnowledgeModule { }
