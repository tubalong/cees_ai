import { Module } from '@nestjs/common';
import { OrganizationImportService } from './organization-import.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
    controllers: [OrganizationController],
    providers: [OrganizationService, OrganizationImportService],
    exports: [OrganizationService, OrganizationImportService],
})
export class OrganizationModule { }
