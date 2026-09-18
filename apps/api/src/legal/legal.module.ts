import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
    imports: [NotificationModule],
    controllers: [LegalController],
    providers: [LegalService],
    exports: [LegalService],
})
export class LegalModule { }
