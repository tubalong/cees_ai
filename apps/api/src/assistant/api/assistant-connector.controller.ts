import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantContextInterceptor } from '../../tenant/tenant-context.interceptor';
import { TenantGuard } from '../../tenant/tenant.guard';
import { DingTalkConnectorPlannerService } from '../connectors/dingtalk-connector-planner.service';
import { TencentMeetingConnectorPlannerService } from '../connectors/tencent-meeting-connector-planner.service';
import { WeComConnectorPlannerService } from '../connectors/wecom-connector-planner.service';
import { GitHubConnectorPlannerService } from '../connectors/github-connector-planner.service';
import { GitHubOAuthBrokerService } from '../connectors/github-oauth-broker.service';
import { toAssistantHttpException } from '../assistant.errors';
import { GitHubOAuthExchangeRequestDto, PlanDingTalkConnectorRequestDto, PlanGitHubConnectorRequestDto, PlanTencentMeetingConnectorRequestDto, PlanWeComConnectorRequestDto } from '../dto';

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
    private readonly githubOAuthBroker: GitHubOAuthBrokerService,
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

  @Get('github/oauth/config')
  @ApiOperation({ summary: '读取 GitHub OAuth 公共配置' })
  @ApiOkResponse({ description: '返回 Client ID、授权地址和 scope，不返回 Client Secret' })
  getGitHubOAuthConfig() {
    return this.githubOAuthBroker.getConfig();
  }

  @Post('github/oauth/exchange')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '由服务端代理 GitHub OAuth 授权码换取令牌' })
  @ApiOkResponse({ description: '返回当前用户 GitHub 访问令牌；服务端不持久化令牌' })
  async exchangeGitHubOAuthCode(@Body() input: GitHubOAuthExchangeRequestDto) {
    return this.githubOAuthBroker.exchange(input);
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
