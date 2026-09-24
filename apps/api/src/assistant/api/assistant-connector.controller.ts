import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../../tenant/tenant-context.interceptor';
import { TenantGuard } from '../../tenant/tenant.guard';
import { DingTalkConnectorPlannerService } from '../connectors/dingtalk-connector-planner.service';
import { TencentMeetingConnectorPlannerService } from '../connectors/tencent-meeting-connector-planner.service';
import { WeComConnectorPlannerService } from '../connectors/wecom-connector-planner.service';
import { GitHubConnectorPlannerService } from '../connectors/github-connector-planner.service';
import { toAssistantHttpException } from '../assistant.errors';
import { PlanDingTalkConnectorRequestDto, PlanGitHubConnectorRequestDto, PlanTencentMeetingConnectorRequestDto, PlanWeComConnectorRequestDto } from '../dto';

@ApiTags('Conversation')
@ApiBearerAuth()
@Controller('assistant/connectors')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class AssistantConnectorController {
  constructor(
    private readonly planner: DingTalkConnectorPlannerService,
    private readonly tencentMeetingPlanner: TencentMeetingConnectorPlannerService,
    private readonly weComPlanner: WeComConnectorPlannerService,
    private readonly githubPlanner: GitHubConnectorPlannerService,
  ) {}

  @Post('dingtalk/plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '规划本机钉钉 DWS 只读查询' })
  @ApiOkResponse({ description: '返回最多三个本地工具调用计划；服务端不执行 DWS' })
  async planDingTalk(@Body() input: PlanDingTalkConnectorRequestDto) {
    try {
      return await this.planner.plan(input.query, input.tools);
    } catch (error) {
      throw toAssistantHttpException(error);
    }
  }

  @Post('tencent-meeting/plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '规划本机腾讯会议官方 CLI 调用' })
  @ApiOkResponse({ description: '返回最多三个本地 CLI 调用计划；服务端不接触 OAuth 凭据，也不执行工具' })
  async planTencentMeeting(@Body() input: PlanTencentMeetingConnectorRequestDto) {
    try {
      return await this.tencentMeetingPlanner.plan(input.query, input.tools);
    } catch (error) {
      throw toAssistantHttpException(error);
    }
  }

  @Post('wecom/plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '规划本机企业微信官方 CLI 调用' })
  @ApiOkResponse({ description: '返回最多三个本地 CLI 调用计划；服务端不接触机器人授权，也不执行工具' })
  async planWeCom(@Body() input: PlanWeComConnectorRequestDto) {
    try {
      return await this.weComPlanner.plan(input.query, input.tools);
    } catch (error) {
      throw toAssistantHttpException(error);
    }
  }

  @Post('github/plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '规划本机 GitHub 官方远程 MCP 调用' })
  @ApiOkResponse({ description: '返回最多三个本地执行的 MCP 调用计划；服务端不接触 GitHub OAuth 凭据，也不执行工具' })
  async planGitHub(@Body() input: PlanGitHubConnectorRequestDto) {
    try {
      return await this.githubPlanner.plan(input.query, input.tools);
    } catch (error) {
      throw toAssistantHttpException(error);
    }
  }
}
