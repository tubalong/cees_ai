import { Module } from '@nestjs/common';
import { DingTalkClient } from './dingtalk.client';
import { DingTalkMappingService } from './dingtalk-mapping.service';
import { DingTalkController } from './dingtalk.controller';
import { DingTalkCredentialCipher } from './dingtalk-credential-cipher';
import { DingTalkService } from './dingtalk.service';

@Module({
    controllers: [DingTalkController],
    providers: [DingTalkClient, DingTalkCredentialCipher, DingTalkMappingService, DingTalkService],
    exports: [DingTalkMappingService, DingTalkService],
})
export class DingTalkModule { }

