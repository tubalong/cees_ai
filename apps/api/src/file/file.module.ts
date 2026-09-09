import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { FileController } from './file.controller';
import { FileService } from './file.service';

@Module({
    imports: [AuthModule, StorageModule],
    controllers: [FileController],
    providers: [FileService],
    exports: [FileService],
})
export class FileModule { }
