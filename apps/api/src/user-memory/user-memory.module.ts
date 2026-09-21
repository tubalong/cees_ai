import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserMemoryController } from './user-memory.controller';
import { UserMemoryService } from './user-memory.service';

@Module({
    imports: [AuthModule],
    controllers: [UserMemoryController],
    providers: [UserMemoryService],
    exports: [UserMemoryService],
})
export class UserMemoryModule { }
