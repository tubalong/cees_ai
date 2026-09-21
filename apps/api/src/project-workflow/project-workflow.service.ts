import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditOutcome, MembershipStatus, Prisma, ProjectDecisionStatus, ProjectMemberRole, ProjectMilestoneStatus, ProjectRepositoryProvider, ProjectStatus, TaskStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockProjectForUpdate } from '../project/project-transaction-lock';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { CancelProjectMilestoneDto, CompleteProjectMilestoneDto, CreateProjectDecisionDto, CreateProjectMilestoneDto, CreateProjectRepositoryDto, ListProjectActivitiesQueryDto, PublishProjectDecisionDto, ReopenProjectMilestoneDto, UpdateProjectDecisionDto, UpdateProjectMilestoneDto, UpdateProjectRepositoryDto } from './project-workflow.dto';
import { ProjectActivityResult, ProjectDecisionResult, ProjectMemberIdentity, ProjectMilestoneResult, ProjectRepositoryResult, ProjectWorkflowSummaryResult } from './project-workflow.types';

const WRITABLE_PROJECT_STATUSES = new Set<ProjectStatus>([ProjectStatus.PLANNING, ProjectStatus.ACTIVE, ProjectStatus.PAUSED]);
const memberIdentitySelect = { id: true, account: true, displayName: true, user: { select: { displayName: true } } } satisfies Prisma.TenantMembershipSelect;
const projectAccessSelect = { id: true, status: true, ownerMembershipId: true, tenant: { select: { timezone: true } }, members: { where: { deletedAt: null }, select: { membershipId: true, role: true, membership: { select: memberIdentitySelect } } } } satisfies Prisma.ProjectSelect;
const decisionSelect = { id: true, projectId: true, title: true, problem: true, background: true, recommendation: true, conclusion: true, rationale: true, risks: true, nextActions: true, participantMembershipIds: true, status: true, sourceConversationId: true, publishedAt: true, publishedByMembership: { select: memberIdentitySelect }, createdByMembership: { select: memberIdentitySelect }, createdAt: true, updatedAt: true, version: true } satisfies Prisma.ProjectDecisionSelect;
const milestoneSelect = { id: true, projectId: true, title: true, objective: true, targetDate: true, ownerMembership: { select: memberIdentitySelect }, acceptanceCriteria: true, acceptanceNote: true, status: true, startedAt: true, acceptanceStartedAt: true, completedAt: true, cancelledAt: true, cancellationReason: true, taskLinks: { select: { required: true, task: { select: { id: true, title: true, status: true } } }, orderBy: { createdAt: 'asc' as const } }, decisionLinks: { select: { decision: { select: { id: true, title: true, status: true } } }, orderBy: { createdAt: 'asc' as const } }, createdAt: true, updatedAt: true, version: true } satisfies Prisma.ProjectMilestoneSelect;
const repositorySelect = { id: true, projectId: true, provider: true, name: true, url: true, defaultBranch: true, enabled: true, lastSyncedAt: true, createdAt: true, updatedAt: true, version: true } satisfies Prisma.ProjectRepositorySelect;
type ProjectAccessRecord = Prisma.ProjectGetPayload<{ select: typeof projectAccessSelect }>;
type DecisionRecord = Prisma.ProjectDecisionGetPayload<{ select: typeof decisionSelect }>;
type MilestoneRecord = Prisma.ProjectMilestoneGetPayload<{ select: typeof milestoneSelect }>;
type RepositoryRecord = Prisma.ProjectRepositoryGetPayload<{ select: typeof repositorySelect }>;
type WorkflowDb = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ProjectWorkflowService {
  constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContext) {}

  async listDecisions(projectId: string): Promise<ProjectDecisionResult[]> {
    const context = this.tenantContext.require();
    const project = await this.requireProjectAccess(context, projectId);
    const rows = await this.prisma.projectDecision.findMany({ where: { tenantId: context.tenantId, projectId, deletedAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], select: decisionSelect });
    return rows.map((row) => this.toDecisionResult(row, project));
  }

  async createDecision(projectId: string, input: CreateProjectDecisionDto): Promise<ProjectDecisionResult> {
    const context = this.tenantContext.require();
    const decisionId = await this.prisma.$transaction(async (transaction) => {
      await this.requireProjectAccess(context, projectId, transaction, 'write');
      await this.validateDecisionInput(context, projectId, input, transaction);
      const row = await transaction.projectDecision.create({ data: { tenantId: context.tenantId, projectId, title: input.title.trim(), problem: input.problem.trim(), background: normalizeNullable(input.background), recommendation: normalizeNullable(input.recommendation), conclusion: normalizeNullable(input.conclusion), rationale: normalizeNullable(input.rationale), risks: normalizeStringArray(input.risks) as unknown as Prisma.InputJsonValue, nextActions: normalizeStringArray(input.nextActions) as unknown as Prisma.InputJsonValue, participantMembershipIds: uniqueStrings(input.participantMembershipIds), sourceConversationId: input.sourceConversationId ?? null, createdByMembershipId: context.membershipId, createdBy: context.userId, updatedBy: context.userId }, select: { id: true } });
      await this.createActivity(transaction, context, projectId, 'DECISION_CREATED', 'DECISION', row.id, `决策草稿“${input.title.trim()}”已创建`, { status: ProjectDecisionStatus.DRAFT });
      await this.createAudit(transaction, context, 'PROJECT_DECISION_CREATED', 'PROJECT_DECISION', row.id, { projectId, title: input.title.trim() });
      return row.id;
    });
    return this.getDecision(projectId, decisionId);
  }

  async getDecision(projectId: string, decisionId: string): Promise<ProjectDecisionResult> {
    const context = this.tenantContext.require();
    const project = await this.requireProjectAccess(context, projectId);
    return this.toDecisionResult(await this.requireDecision(context, projectId, decisionId), project);
  }

  async updateDecision(projectId: string, decisionId: string, input: UpdateProjectDecisionDto): Promise<ProjectDecisionResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      const decision = await this.requireDecision(context, projectId, decisionId, transaction);
      this.assertDecisionEditable(context, project, decision);
      await this.validateDecisionInput(context, projectId, input, transaction);
      const updated = await transaction.projectDecision.updateMany({ where: { id: decisionId, tenantId: context.tenantId, projectId, deletedAt: null, status: ProjectDecisionStatus.DRAFT, version: input.version }, data: { title: input.title.trim(), problem: input.problem.trim(), background: normalizeNullable(input.background), recommendation: normalizeNullable(input.recommendation), conclusion: normalizeNullable(input.conclusion), rationale: normalizeNullable(input.rationale), risks: normalizeStringArray(input.risks) as unknown as Prisma.InputJsonValue, nextActions: normalizeStringArray(input.nextActions) as unknown as Prisma.InputJsonValue, participantMembershipIds: uniqueStrings(input.participantMembershipIds), sourceConversationId: input.sourceConversationId ?? null, updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_DECISION_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'DECISION_UPDATED', 'DECISION', decisionId, `决策草稿“${input.title.trim()}”已更新`, {});
      await this.createAudit(transaction, context, 'PROJECT_DECISION_UPDATED', 'PROJECT_DECISION', decisionId, { projectId, title: input.title.trim() });
    });
    return this.getDecision(projectId, decisionId);
  }

  async publishDecision(projectId: string, decisionId: string, input: PublishProjectDecisionDto): Promise<ProjectDecisionResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const decision = await this.requireDecision(context, projectId, decisionId, transaction);
      if (decision.status !== ProjectDecisionStatus.DRAFT) throw new ConflictException({ code: 'PROJECT_DECISION_STATUS_CONFLICT', message: '只有草稿决策可以发布' });
      const conclusion = input.conclusion === undefined ? decision.conclusion : normalizeNullable(input.conclusion);
      if (!conclusion) throw new BadRequestException({ code: 'PROJECT_DECISION_CONCLUSION_REQUIRED', message: '发布决策前必须填写最终结论' });
      const updated = await transaction.projectDecision.updateMany({ where: { id: decisionId, tenantId: context.tenantId, projectId, status: ProjectDecisionStatus.DRAFT, version: input.version, deletedAt: null }, data: { status: ProjectDecisionStatus.PUBLISHED, conclusion, publishedAt: new Date(), publishedByMembershipId: context.membershipId, updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_DECISION_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'DECISION_PUBLISHED', 'DECISION', decisionId, `决策“${decision.title}”已发布`, {});
      await this.createAudit(transaction, context, 'PROJECT_DECISION_PUBLISHED', 'PROJECT_DECISION', decisionId, { projectId, title: decision.title });
    });
    return this.getDecision(projectId, decisionId);
  }

  async deleteDecision(projectId: string, decisionId: string, version: number): Promise<void> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      const decision = await this.requireDecision(context, projectId, decisionId, transaction);
      this.assertDecisionEditable(context, project, decision);
      const deleted = await transaction.projectDecision.updateMany({ where: { id: decisionId, tenantId: context.tenantId, projectId, status: ProjectDecisionStatus.DRAFT, version, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } } });
      if (deleted.count !== 1) throw this.versionConflict('PROJECT_DECISION_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'DECISION_DELETED', 'DECISION', decisionId, `决策草稿“${decision.title}”已删除`, {});
      await this.createAudit(transaction, context, 'PROJECT_DECISION_DELETED', 'PROJECT_DECISION', decisionId, { projectId, title: decision.title });
    });
  }

  async listMilestones(projectId: string): Promise<ProjectMilestoneResult[]> {
    const context = this.tenantContext.require();
    await this.requireProjectAccess(context, projectId);
    const rows = await this.prisma.projectMilestone.findMany({ where: { tenantId: context.tenantId, projectId, deletedAt: null }, orderBy: [{ targetDate: 'asc' }, { id: 'asc' }], select: milestoneSelect });
    return rows.map((row) => this.toMilestoneResult(row));
  }

  async createMilestone(projectId: string, input: CreateProjectMilestoneDto): Promise<ProjectMilestoneResult> {
    const context = this.tenantContext.require();
    const milestoneId = await this.prisma.$transaction(async (transaction) => {
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      await this.validateMilestoneInput(context, projectId, input, transaction);
      const row = await transaction.projectMilestone.create({ data: { tenantId: context.tenantId, projectId, title: input.title.trim(), objective: input.objective.trim(), targetDate: parseDate(input.targetDate), ownerMembershipId: input.ownerMembershipId, acceptanceCriteria: normalizeRequiredStringArray(input.acceptanceCriteria) as unknown as Prisma.InputJsonValue, createdByMembershipId: context.membershipId, createdBy: context.userId, updatedBy: context.userId, taskLinks: input.taskIds.length ? { create: input.taskIds.map((taskId) => ({ tenantId: context.tenantId, taskId, required: true })) } : undefined, decisionLinks: input.decisionIds.length ? { create: input.decisionIds.map((decisionId) => ({ tenantId: context.tenantId, decisionId })) } : undefined }, select: { id: true } });
      await this.createActivity(transaction, context, projectId, 'MILESTONE_CREATED', 'MILESTONE', row.id, `里程碑“${input.title.trim()}”已创建`, { targetDate: input.targetDate });
      await this.createAudit(transaction, context, 'PROJECT_MILESTONE_CREATED', 'PROJECT_MILESTONE', row.id, { projectId, title: input.title.trim() });
      return row.id;
    });
    return this.getMilestone(projectId, milestoneId);
  }

  async getMilestone(projectId: string, milestoneId: string): Promise<ProjectMilestoneResult> {
    const context = this.tenantContext.require();
    await this.requireProjectAccess(context, projectId);
    return this.toMilestoneResult(await this.requireMilestone(context, projectId, milestoneId));
  }

  async updateMilestone(projectId: string, milestoneId: string, input: UpdateProjectMilestoneDto): Promise<ProjectMilestoneResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const milestone = await this.requireMilestone(context, projectId, milestoneId, transaction);
      if (milestone.status === ProjectMilestoneStatus.COMPLETED || milestone.status === ProjectMilestoneStatus.CANCELLED) throw new ConflictException({ code: 'PROJECT_MILESTONE_STATUS_CONFLICT', message: '已完结里程碑需先重新打开后才能编辑' });
      await this.validateMilestoneInput(context, projectId, input, transaction);
      const updated = await transaction.projectMilestone.updateMany({ where: { id: milestoneId, tenantId: context.tenantId, projectId, deletedAt: null, version: input.version }, data: { title: input.title.trim(), objective: input.objective.trim(), targetDate: parseDate(input.targetDate), ownerMembershipId: input.ownerMembershipId, acceptanceCriteria: normalizeRequiredStringArray(input.acceptanceCriteria) as unknown as Prisma.InputJsonValue, updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_MILESTONE_VERSION_CONFLICT');
      await transaction.projectMilestoneTask.deleteMany({ where: { tenantId: context.tenantId, milestoneId } });
      if (input.taskIds.length) await transaction.projectMilestoneTask.createMany({ data: input.taskIds.map((taskId) => ({ tenantId: context.tenantId, milestoneId, taskId, required: true })) });
      await transaction.projectMilestoneDecision.deleteMany({ where: { tenantId: context.tenantId, milestoneId } });
      if (input.decisionIds.length) await transaction.projectMilestoneDecision.createMany({ data: input.decisionIds.map((decisionId) => ({ tenantId: context.tenantId, milestoneId, decisionId })) });
      await this.createActivity(transaction, context, projectId, 'MILESTONE_UPDATED', 'MILESTONE', milestoneId, `里程碑“${input.title.trim()}”已更新`, { targetDate: input.targetDate });
      await this.createAudit(transaction, context, 'PROJECT_MILESTONE_UPDATED', 'PROJECT_MILESTONE', milestoneId, { projectId, title: input.title.trim() });
    });
    return this.getMilestone(projectId, milestoneId);
  }

  async startMilestone(projectId: string, milestoneId: string, version: number): Promise<ProjectMilestoneResult> {
    return this.changeMilestoneStatus(projectId, milestoneId, version, ProjectMilestoneStatus.PLANNED, ProjectMilestoneStatus.IN_PROGRESS, 'MILESTONE_STARTED', '里程碑已启动', { startedAt: new Date() });
  }

  async startMilestoneAcceptance(projectId: string, milestoneId: string, version: number): Promise<ProjectMilestoneResult> {
    return this.changeMilestoneStatus(projectId, milestoneId, version, ProjectMilestoneStatus.IN_PROGRESS, ProjectMilestoneStatus.ACCEPTANCE, 'MILESTONE_ACCEPTANCE_STARTED', '里程碑已进入验收', { acceptanceStartedAt: new Date() });
  }

  async completeMilestone(projectId: string, milestoneId: string, input: CompleteProjectMilestoneDto): Promise<ProjectMilestoneResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const milestone = await this.requireMilestone(context, projectId, milestoneId, transaction);
      if (milestone.status !== ProjectMilestoneStatus.ACCEPTANCE) throw new ConflictException({ code: 'PROJECT_MILESTONE_STATUS_CONFLICT', message: '只有验收中的里程碑可以确认完成' });
      const updated = await transaction.projectMilestone.updateMany({ where: { id: milestoneId, tenantId: context.tenantId, projectId, status: ProjectMilestoneStatus.ACCEPTANCE, version: input.version, deletedAt: null }, data: { status: ProjectMilestoneStatus.COMPLETED, completedAt: new Date(), acceptanceNote: normalizeNullable(input.acceptanceNote), updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_MILESTONE_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'MILESTONE_COMPLETED', 'MILESTONE', milestoneId, `里程碑“${milestone.title}”已完成`, {});
      await this.createAudit(transaction, context, 'PROJECT_MILESTONE_COMPLETED', 'PROJECT_MILESTONE', milestoneId, { projectId, title: milestone.title });
    });
    return this.getMilestone(projectId, milestoneId);
  }

  async returnMilestoneToProgress(projectId: string, milestoneId: string, input: ReopenProjectMilestoneDto): Promise<ProjectMilestoneResult> {
    return this.changeMilestoneStatus(projectId, milestoneId, input.version, ProjectMilestoneStatus.ACCEPTANCE, ProjectMilestoneStatus.IN_PROGRESS, 'MILESTONE_RETURNED', '里程碑已退回进行中', { acceptanceStartedAt: null, cancellationReason: normalizeNullable(input.reason) });
  }

  async cancelMilestone(projectId: string, milestoneId: string, input: CancelProjectMilestoneDto): Promise<ProjectMilestoneResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const milestone = await this.requireMilestone(context, projectId, milestoneId, transaction);
      if (milestone.status === ProjectMilestoneStatus.COMPLETED || milestone.status === ProjectMilestoneStatus.CANCELLED) throw new ConflictException({ code: 'PROJECT_MILESTONE_STATUS_CONFLICT', message: '该里程碑已终结' });
      const updated = await transaction.projectMilestone.updateMany({ where: { id: milestoneId, tenantId: context.tenantId, projectId, version: input.version, deletedAt: null }, data: { status: ProjectMilestoneStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: input.reason.trim(), updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_MILESTONE_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'MILESTONE_CANCELLED', 'MILESTONE', milestoneId, `里程碑“${milestone.title}”已取消`, { reason: input.reason.trim() });
      await this.createAudit(transaction, context, 'PROJECT_MILESTONE_CANCELLED', 'PROJECT_MILESTONE', milestoneId, { projectId, title: milestone.title, reason: input.reason.trim() });
    });
    return this.getMilestone(projectId, milestoneId);
  }

  async reopenMilestone(projectId: string, milestoneId: string, input: ReopenProjectMilestoneDto): Promise<ProjectMilestoneResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const milestone = await this.requireMilestone(context, projectId, milestoneId, transaction);
      if ((milestone.status !== ProjectMilestoneStatus.COMPLETED && milestone.status !== ProjectMilestoneStatus.CANCELLED)) throw new ConflictException({ code: 'PROJECT_MILESTONE_STATUS_CONFLICT', message: '只有已完成或已取消的里程碑可以重新打开' });
      const updated = await transaction.projectMilestone.updateMany({ where: { id: milestoneId, tenantId: context.tenantId, projectId, version: input.version, deletedAt: null }, data: { status: ProjectMilestoneStatus.PLANNED, startedAt: null, acceptanceStartedAt: null, completedAt: null, cancelledAt: null, cancellationReason: normalizeNullable(input.reason), updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_MILESTONE_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'MILESTONE_REOPENED', 'MILESTONE', milestoneId, `里程碑“${milestone.title}”已重新打开`, {});
      await this.createAudit(transaction, context, 'PROJECT_MILESTONE_REOPENED', 'PROJECT_MILESTONE', milestoneId, { projectId, title: milestone.title });
    });
    return this.getMilestone(projectId, milestoneId);
  }

  async listRepositories(projectId: string): Promise<ProjectRepositoryResult[]> {
    const context = this.tenantContext.require();
    await this.requireProjectAccess(context, projectId);
    const rows = await this.prisma.projectRepository.findMany({ where: { tenantId: context.tenantId, projectId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: repositorySelect });
    return rows.map(toRepositoryResult);
  }

  async createRepository(projectId: string, input: CreateProjectRepositoryDto): Promise<ProjectRepositoryResult> {
    const context = this.tenantContext.require();
    const id = await this.prisma.$transaction(async (transaction) => {
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const normalized = normalizeRepository(input.url, input.name, input.defaultBranch);
      const row = await transaction.projectRepository.create({ data: { tenantId: context.tenantId, projectId, ...normalized, createdBy: context.userId, updatedBy: context.userId }, select: { id: true } });
      await this.createActivity(transaction, context, projectId, 'REPOSITORY_ADDED', 'REPOSITORY', row.id, `已绑定项目仓库“${normalized.name}”`, { url: normalized.url, provider: normalized.provider });
      await this.createAudit(transaction, context, 'PROJECT_REPOSITORY_CREATED', 'PROJECT_REPOSITORY', row.id, { projectId, url: normalized.url });
      return row.id;
    });
    return this.getRepository(projectId, id);
  }

  async getRepository(projectId: string, repositoryId: string): Promise<ProjectRepositoryResult> {
    const context = this.tenantContext.require();
    await this.requireProjectAccess(context, projectId);
    return toRepositoryResult(await this.requireRepository(context, projectId, repositoryId));
  }

  async updateRepository(projectId: string, repositoryId: string, input: UpdateProjectRepositoryDto): Promise<ProjectRepositoryResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const current = await this.requireRepository(context, projectId, repositoryId, transaction);
      const normalized = normalizeRepository(input.url ?? current.url, input.name ?? current.name, input.defaultBranch ?? current.defaultBranch);
      const updated = await transaction.projectRepository.updateMany({ where: { id: repositoryId, tenantId: context.tenantId, projectId, version: input.version }, data: { ...normalized, enabled: input.enabled ?? current.enabled, updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_REPOSITORY_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'REPOSITORY_UPDATED', 'REPOSITORY', repositoryId, `项目仓库“${normalized.name}”已更新`, { url: normalized.url });
      await this.createAudit(transaction, context, 'PROJECT_REPOSITORY_UPDATED', 'PROJECT_REPOSITORY', repositoryId, { projectId, url: normalized.url });
    });
    return this.getRepository(projectId, repositoryId);
  }

  async deleteRepository(projectId: string, repositoryId: string, version: number): Promise<void> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const repository = await this.requireRepository(context, projectId, repositoryId, transaction);
      const deleted = await transaction.projectRepository.deleteMany({ where: { id: repositoryId, tenantId: context.tenantId, projectId, version } });
      if (deleted.count !== 1) throw this.versionConflict('PROJECT_REPOSITORY_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, 'REPOSITORY_REMOVED', 'REPOSITORY', repositoryId, `已解除项目仓库“${repository.name}”`, { url: repository.url });
      await this.createAudit(transaction, context, 'PROJECT_REPOSITORY_DELETED', 'PROJECT_REPOSITORY', repositoryId, { projectId, url: repository.url });
    });
  }

  async listActivities(projectId: string, query: ListProjectActivitiesQueryDto): Promise<ProjectActivityResult[]> {
    const context = this.tenantContext.require();
    await this.requireProjectAccess(context, projectId);
    const rows = await this.prisma.projectActivity.findMany({ where: { tenantId: context.tenantId, projectId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: Math.min(query.limit, 100), select: { id: true, projectId: true, type: true, resourceType: true, resourceId: true, summary: true, metadata: true, actorMembership: { select: memberIdentitySelect }, createdAt: true } });
    return rows.map(toActivityResult);
  }

  async summary(projectId: string): Promise<ProjectWorkflowSummaryResult> {
    const context = this.tenantContext.require();
    await this.requireProjectAccess(context, projectId);
    const [decisions, milestones, repositories, activities] = await Promise.all([
      this.prisma.projectDecision.findMany({ where: { tenantId: context.tenantId, projectId, deletedAt: null }, select: { status: true } }),
      this.prisma.projectMilestone.findMany({ where: { tenantId: context.tenantId, projectId, deletedAt: null }, select: { status: true, targetDate: true, taskLinks: { where: { required: true }, select: { task: { select: { status: true } } } } } }),
      this.prisma.projectRepository.findMany({ where: { tenantId: context.tenantId, projectId }, select: { enabled: true } }),
      this.listActivities(projectId, { limit: 20 }),
    ]);
    const todayKey = localDateKeyForSummary(new Date());
    const decisionCounts = countBy(decisions.map((item) => item.status));
    const milestoneCounts = countBy(milestones.map((item) => item.status));
    return {
      decisions: { total: decisions.length, draft: decisionCounts[ProjectDecisionStatus.DRAFT] ?? 0, published: decisionCounts[ProjectDecisionStatus.PUBLISHED] ?? 0, superseded: decisionCounts[ProjectDecisionStatus.SUPERSEDED] ?? 0 },
      milestones: { total: milestones.length, planned: milestoneCounts[ProjectMilestoneStatus.PLANNED] ?? 0, inProgress: milestoneCounts[ProjectMilestoneStatus.IN_PROGRESS] ?? 0, acceptance: milestoneCounts[ProjectMilestoneStatus.ACCEPTANCE] ?? 0, completed: milestoneCounts[ProjectMilestoneStatus.COMPLETED] ?? 0, cancelled: milestoneCounts[ProjectMilestoneStatus.CANCELLED] ?? 0, overdue: milestones.filter((item) => item.status !== ProjectMilestoneStatus.COMPLETED && item.status !== ProjectMilestoneStatus.CANCELLED && dateKey(item.targetDate) < todayKey).length },
      repositories: { total: repositories.length, enabled: repositories.filter((item) => item.enabled).length },
      activities,
    };
  }

  private async changeMilestoneStatus(projectId: string, milestoneId: string, version: number, from: ProjectMilestoneStatus, to: ProjectMilestoneStatus, activityType: string, summary: string, extra: Prisma.ProjectMilestoneUpdateManyMutationInput): Promise<ProjectMilestoneResult> {
    const context = this.tenantContext.require();
    await this.prisma.$transaction(async (transaction) => {
      await lockProjectForUpdate(transaction, context.tenantId, projectId);
      const project = await this.requireProjectAccess(context, projectId, transaction, 'write');
      this.assertManager(context, project);
      const milestone = await this.requireMilestone(context, projectId, milestoneId, transaction);
      if (milestone.status !== from) throw new ConflictException({ code: 'PROJECT_MILESTONE_STATUS_CONFLICT', message: '里程碑当前状态不允许执行该操作' });
      const updated = await transaction.projectMilestone.updateMany({ where: { id: milestoneId, tenantId: context.tenantId, projectId, status: from, version, deletedAt: null }, data: { ...extra, status: to, updatedBy: context.userId, version: { increment: 1 } } });
      if (updated.count !== 1) throw this.versionConflict('PROJECT_MILESTONE_VERSION_CONFLICT');
      await this.createActivity(transaction, context, projectId, activityType, 'MILESTONE', milestoneId, `${summary}：“${milestone.title}”`, {});
      await this.createAudit(transaction, context, activityType, 'PROJECT_MILESTONE', milestoneId, { projectId, title: milestone.title });
    });
    return this.getMilestone(projectId, milestoneId);
  }

  private async requireProjectAccess(context: RequestTenantContext, projectId: string, db: WorkflowDb = this.prisma, mode: 'read' | 'write' = 'read'): Promise<ProjectAccessRecord> {
    const project = await db.project.findFirst({ where: { id: projectId, tenantId: context.tenantId, deletedAt: null, ...(this.canManageAll(context) ? {} : { members: { some: { membershipId: context.membershipId, deletedAt: null } } }) }, select: projectAccessSelect });
    if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不存在或当前成员无权访问' });
    if (mode === 'write' && !WRITABLE_PROJECT_STATUSES.has(project.status)) throw new ConflictException({ code: 'PROJECT_READ_ONLY', message: '当前项目状态不允许修改项目工作流' });
    return project;
  }

  private async requireDecision(context: RequestTenantContext, projectId: string, decisionId: string, db: WorkflowDb = this.prisma): Promise<DecisionRecord> {
    const decision = await db.projectDecision.findFirst({ where: { id: decisionId, tenantId: context.tenantId, projectId, deletedAt: null }, select: decisionSelect });
    if (!decision) throw new NotFoundException({ code: 'PROJECT_DECISION_NOT_FOUND', message: '项目决策不存在' });
    return decision;
  }

  private async requireMilestone(context: RequestTenantContext, projectId: string, milestoneId: string, db: WorkflowDb = this.prisma): Promise<MilestoneRecord> {
    const milestone = await db.projectMilestone.findFirst({ where: { id: milestoneId, tenantId: context.tenantId, projectId, deletedAt: null }, select: milestoneSelect });
    if (!milestone) throw new NotFoundException({ code: 'PROJECT_MILESTONE_NOT_FOUND', message: '项目里程碑不存在' });
    return milestone;
  }

  private async requireRepository(context: RequestTenantContext, projectId: string, repositoryId: string, db: WorkflowDb = this.prisma): Promise<RepositoryRecord> {
    const repository = await db.projectRepository.findFirst({ where: { id: repositoryId, tenantId: context.tenantId, projectId }, select: repositorySelect });
    if (!repository) throw new NotFoundException({ code: 'PROJECT_REPOSITORY_NOT_FOUND', message: '项目仓库不存在' });
    return repository;
  }

  private assertManager(context: RequestTenantContext, project: ProjectAccessRecord): void {
    if (this.canManageAll(context)) return;
    const role = project.members.find((member) => member.membershipId === context.membershipId)?.role;
    if (role !== ProjectMemberRole.OWNER && role !== ProjectMemberRole.MANAGER) throw new ForbiddenException({ code: 'PROJECT_ROLE_DENIED', message: '需要项目负责人或项目经理角色' });
  }

  private assertDecisionEditable(context: RequestTenantContext, project: ProjectAccessRecord, decision: DecisionRecord): void {
    if (decision.status !== ProjectDecisionStatus.DRAFT) throw new ConflictException({ code: 'PROJECT_DECISION_STATUS_CONFLICT', message: '只有决策草稿可以修改或删除' });
    const role = project.members.find((member) => member.membershipId === context.membershipId)?.role;
    const isCreator = decision.createdByMembership.id === context.membershipId;
    if (!this.canManageAll(context) && role !== ProjectMemberRole.OWNER && role !== ProjectMemberRole.MANAGER && !isCreator) throw new ForbiddenException({ code: 'PROJECT_DECISION_MUTATION_DENIED', message: '只有草稿创建人或项目管理者可以修改或删除草稿' });
  }

  private async validateDecisionInput(context: RequestTenantContext, projectId: string, input: CreateProjectDecisionDto | UpdateProjectDecisionDto, db: WorkflowDb): Promise<void> {
    const ids = uniqueStrings(input.participantMembershipIds);
    if (ids.length) {
      const members = await db.projectMember.findMany({ where: { tenantId: context.tenantId, projectId, membershipId: { in: ids }, deletedAt: null }, select: { membershipId: true } });
      if (members.length !== ids.length) throw new BadRequestException({ code: 'PROJECT_DECISION_PARTICIPANT_INVALID', message: '决策参与人必须是当前项目成员' });
    }
    if (input.sourceConversationId) {
      const conversation = await db.conversation.findFirst({ where: { id: input.sourceConversationId, tenantId: context.tenantId, ownerMembershipId: context.membershipId, projectId, deletedAt: null }, select: { id: true } });
      if (!conversation) throw new BadRequestException({ code: 'PROJECT_DECISION_CONVERSATION_INVALID', message: '来源会话必须是当前成员在本项目下的私有会话' });
    }
  }

  private async validateMilestoneInput(context: RequestTenantContext, projectId: string, input: CreateProjectMilestoneDto | UpdateProjectMilestoneDto, db: WorkflowDb): Promise<void> {
    const owner = await db.projectMember.findFirst({ where: { tenantId: context.tenantId, projectId, membershipId: input.ownerMembershipId, deletedAt: null, membership: { is: { status: MembershipStatus.ACTIVE, deletedAt: null } } }, select: { membershipId: true } });
    if (!owner) throw new BadRequestException({ code: 'PROJECT_MILESTONE_OWNER_INVALID', message: '里程碑负责人必须是当前项目的有效成员' });
    if (input.taskIds.length) {
      const tasks = await db.task.findMany({ where: { tenantId: context.tenantId, projectId, id: { in: input.taskIds }, deletedAt: null }, select: { id: true } });
      if (tasks.length !== uniqueStrings(input.taskIds).length) throw new BadRequestException({ code: 'PROJECT_MILESTONE_TASK_INVALID', message: '关联任务必须属于当前项目' });
    }
    if (input.decisionIds.length) {
      const decisions = await db.projectDecision.findMany({ where: { tenantId: context.tenantId, projectId, id: { in: input.decisionIds }, deletedAt: null }, select: { id: true } });
      if (decisions.length !== uniqueStrings(input.decisionIds).length) throw new BadRequestException({ code: 'PROJECT_MILESTONE_DECISION_INVALID', message: '关联决策必须属于当前项目' });
    }
  }

  private async createActivity(db: WorkflowDb, context: RequestTenantContext, projectId: string, type: string, resourceType: string, resourceId: string, summary: string, metadata: Prisma.InputJsonObject): Promise<void> {
    await db.projectActivity.create({ data: { tenantId: context.tenantId, projectId, actorMembershipId: context.membershipId, type, resourceType, resourceId, summary, metadata } });
  }

  private async createAudit(db: WorkflowDb, context: RequestTenantContext, action: string, resourceType: string, resourceId: string, metadata: Prisma.InputJsonObject): Promise<void> {
    await db.auditLog.create({ data: { tenantId: context.tenantId, actorUserId: context.userId, actorMembershipId: context.membershipId, action, outcome: AuditOutcome.SUCCESS, resourceType, resourceId, requestId: context.requestId, metadata } });
  }

  private canManageAll(context: RequestTenantContext): boolean { return context.permissions.includes('project.manage_all'); }

  private toDecisionResult(record: DecisionRecord, project: ProjectAccessRecord): ProjectDecisionResult {
    const memberMap = new Map(project.members.map((member) => [member.membershipId, toMemberIdentity(member.membership)]));
    return { id: record.id, projectId: record.projectId, title: record.title, problem: record.problem, background: record.background, recommendation: record.recommendation, conclusion: record.conclusion, rationale: record.rationale, risks: readStringArray(record.risks), nextActions: readStringArray(record.nextActions), participantMembershipIds: record.participantMembershipIds, participants: record.participantMembershipIds.map((id) => memberMap.get(id)).filter((item): item is ProjectMemberIdentity => Boolean(item)), status: record.status, sourceConversationId: record.sourceConversationId, publishedAt: record.publishedAt, publishedBy: record.publishedByMembership ? toMemberIdentity(record.publishedByMembership) : null, createdBy: toMemberIdentity(record.createdByMembership), createdAt: record.createdAt, updatedAt: record.updatedAt, version: record.version };
  }

  private toMilestoneResult(record: MilestoneRecord): ProjectMilestoneResult {
    const tasks = record.taskLinks.map((link) => ({ id: link.task.id, title: link.task.title, status: link.task.status, required: link.required }));
    const required = tasks.filter((task) => task.required);
    const completedTaskCount = required.filter((task) => task.status === TaskStatus.DONE).length;
    const taskCount = required.length;
    const progressPercent = taskCount === 0 ? 0 : Math.round((completedTaskCount / taskCount) * 100);
    const overdue = (record.status !== ProjectMilestoneStatus.COMPLETED && record.status !== ProjectMilestoneStatus.CANCELLED) && dateKey(record.targetDate) < localDateKeyForSummary(new Date());
    const atRisk = !overdue && (record.status !== ProjectMilestoneStatus.COMPLETED && record.status !== ProjectMilestoneStatus.CANCELLED) && (dateKeyDifference(record.targetDate, new Date()) <= 3 || required.some((task) => task.status === TaskStatus.BLOCKED));
    return { id: record.id, projectId: record.projectId, title: record.title, objective: record.objective, targetDate: record.targetDate, owner: toMemberIdentity(record.ownerMembership), acceptanceCriteria: readStringArray(record.acceptanceCriteria), acceptanceNote: record.acceptanceNote, status: record.status, startedAt: record.startedAt, acceptanceStartedAt: record.acceptanceStartedAt, completedAt: record.completedAt, cancelledAt: record.cancelledAt, cancellationReason: record.cancellationReason, tasks, taskCount, completedTaskCount, openTaskCount: taskCount - completedTaskCount, progressPercent, overdue, health: overdue ? 'OVERDUE' : atRisk ? 'AT_RISK' : 'NORMAL', decisions: record.decisionLinks.map((link) => ({ id: link.decision.id, title: link.decision.title, status: link.decision.status })), createdAt: record.createdAt, updatedAt: record.updatedAt, version: record.version };
  }

  private versionConflict(code: string): ConflictException { return new ConflictException({ code, message: '数据已被其他请求修改，请刷新后重试' }); }
}

function toRepositoryResult(record: RepositoryRecord): ProjectRepositoryResult { return { ...record }; }
function toActivityResult(record: { id: string; projectId: string; type: string; resourceType: string; resourceId: string | null; summary: string; metadata: Prisma.JsonValue; actorMembership: { id: string; account: string; displayName: string | null; user: { displayName: string } } | null; createdAt: Date }): ProjectActivityResult {
  return { id: record.id, projectId: record.projectId, type: record.type, resourceType: record.resourceType, resourceId: record.resourceId, summary: record.summary, metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata) ? record.metadata as Record<string, unknown> : {}, actor: record.actorMembership ? toMemberIdentity(record.actorMembership) : null, createdAt: record.createdAt };
}
function toMemberIdentity(member: { id: string; account: string; displayName: string | null; user: { displayName: string } }): ProjectMemberIdentity { return { membershipId: member.id, account: member.account, displayName: member.displayName ?? member.user.displayName }; }
function normalizeRepository(urlInput: string, nameInput: string | undefined, branchInput: string): { provider: ProjectRepositoryProvider; name: string; url: string; normalizedUrl: string; defaultBranch: string } {
  let url: URL;
  try { url = new URL(urlInput.trim()); } catch { throw new BadRequestException({ code: 'PROJECT_REPOSITORY_URL_INVALID', message: '请输入有效的仓库 URL' }); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new BadRequestException({ code: 'PROJECT_REPOSITORY_URL_INVALID', message: '仓库 URL 仅支持 HTTP 或 HTTPS' });
  if (url.username || url.password) throw new BadRequestException({ code: 'PROJECT_REPOSITORY_SECRET_FORBIDDEN', message: '仓库 URL 不得包含用户名、密码或访问令牌' });
  url.hash = '';
  const normalizedUrl = url.toString().replace(/\/$/, '');
  const fallbackName = url.pathname.split('/').filter(Boolean).slice(-2).join('/') || url.hostname;
  return { provider: detectProvider(url.hostname), name: (nameInput?.trim() || fallbackName).slice(0, 120), url: urlInput.trim(), normalizedUrl, defaultBranch: branchInput.trim() || 'main' };
}
function detectProvider(hostname: string): ProjectRepositoryProvider { const host = hostname.toLowerCase(); if (host.includes('github')) return ProjectRepositoryProvider.GITHUB; if (host.includes('gitlab')) return ProjectRepositoryProvider.GITLAB; if (host.includes('gitee')) return ProjectRepositoryProvider.GITEE; return ProjectRepositoryProvider.OTHER; }
function normalizeNullable(value: string | null | undefined): string | null { const normalized = value?.trim(); return normalized || null; }
function normalizeStringArray(values: string[]): string[] { return values.map((item) => item.trim()).filter(Boolean); }
function normalizeRequiredStringArray(values: string[]): string[] { const result = normalizeStringArray(values); if (result.length === 0) throw new BadRequestException({ code: 'PROJECT_MILESTONE_ACCEPTANCE_REQUIRED', message: '里程碑至少需要一项验收标准' }); return result; }
function uniqueStrings(values: string[]): string[] { return [...new Set(values)]; }
function parseDate(value: string): Date { const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime())) throw new BadRequestException({ code: 'PROJECT_MILESTONE_DATE_INVALID', message: '目标日期格式无效' }); return date; }
function dateKey(value: Date): string { return value.toISOString().slice(0, 10); }
function localDateKeyForSummary(value: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
function dateKeyDifference(target: Date, now: Date): number { return Math.ceil((target.getTime() - Date.parse(localDateKeyForSummary(now) + 'T00:00:00.000Z')) / 86400000); }
function countBy<T extends string>(values: T[]): Record<T, number> { return values.reduce((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {} as Record<T, number>); }
function readStringArray(value: Prisma.JsonValue): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
