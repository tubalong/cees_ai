import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ResourceModule } from '../resource/resource.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';

@Module({
    imports: [AuthModule, ResourceModule],
    controllers: [DocumentController],
    providers: [DocumentService],
    exports: [DocumentService],
})
export class DocumentModule { }
