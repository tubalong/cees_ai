import type {
  ProjectDecisionStatus,
  ProjectMilestoneStatus,
  ProjectRepositoryProvider,
} from '@prisma/client';

export interface ProjectMemberIdentity {
  membershipId: string;
  account: string;
  displayName: string;
}

export interface ProjectDecisionResult {
  id: string;
  projectId: string;
  title: string;
  problem: string;
  background: string | null;
  recommendation: string | null;
  conclusion: string | null;
  rationale: string | null;
  risks: string[];
  nextActions: string[];
  participantMembershipIds: string[];
  participants: ProjectMemberIdentity[];
  status: ProjectDecisionStatus;
  sourceConversationId: string | null;
  publishedAt: Date | null;
  publishedBy: ProjectMemberIdentity | null;
  createdBy: ProjectMemberIdentity;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ProjectMilestoneResult {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  targetDate: Date;
  owner: ProjectMemberIdentity;
  acceptanceCriteria: string[];
  acceptanceNote: string | null;
  status: ProjectMilestoneStatus;
  startedAt: Date | null;
  acceptanceStartedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  tasks: Array<{ id: string; title: string; status: string; required: boolean }>;
  taskCount: number;
  completedTaskCount: number;
  openTaskCount: number;
  progressPercent: number;
  overdue: boolean;
  health: 'NORMAL' | 'AT_RISK' | 'OVERDUE';
  decisions: Array<{ id: string; title: string; status: ProjectDecisionStatus }>;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ProjectRepositoryResult {
  id: string;
  projectId: string;
  provider: ProjectRepositoryProvider;
  name: string;
  url: string;
  defaultBranch: string;
  enabled: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ProjectActivityResult {
  id: string;
  projectId: string;
  type: string;
  resourceType: string;
  resourceId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  actor: ProjectMemberIdentity | null;
  createdAt: Date;
}

export interface ProjectWorkflowSummaryResult {
  decisions: { total: number; draft: number; published: number; superseded: number };
  milestones: { total: number; planned: number; inProgress: number; acceptance: number; completed: number; cancelled: number; overdue: number };
  repositories: { total: number; enabled: number };
  activities: ProjectActivityResult[];
}
