import { Module } from '@nestjs/common';
import { ProjectWorkflowController } from './project-workflow.controller';
import { ProjectWorkflowService } from './project-workflow.service';

@Module({ controllers: [ProjectWorkflowController], providers: [ProjectWorkflowService], exports: [ProjectWorkflowService] })
export class ProjectWorkflowModule {}
