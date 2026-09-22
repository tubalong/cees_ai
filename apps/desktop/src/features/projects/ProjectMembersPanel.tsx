import { DeleteOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { App as AntdApp, Avatar, Button, Modal, Popconfirm, Select, Tag } from 'antd';
import { useState } from 'react';
import {
    addProjectMember, removeProjectMember, transferProjectOwner, updateProjectMember,
    type ProjectMemberSummary, type TenantMember,
} from '../../core/api';
import { useI18n } from '../../core/i18n';
import { projectMemberRoleLabels } from './project-constants';

interface ProjectMembersPanelProps {
    projectId: string;
    permissions: Set<string>;
    readOnly: boolean;
    myMembershipId: string;
    activeMembers: TenantMember[];
    projectMembers: ProjectMemberSummary[];
    projectVersion: number;
    onRefreshMembers: () => void;
}

export default function ProjectMembersPanel({
    projectId, permissions, readOnly, myMembershipId, activeMembers, projectMembers, projectVersion, onRefreshMembers,
}: ProjectMembersPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const [addOpen, setAddOpen] = useState(false);
    const [addMembershipId, setAddMembershipId] = useState<string>();
    const [addRole, setAddRole] = useState<'MANAGER' | 'MEMBER'>('MEMBER');
    const [transferTarget, setTransferTarget] = useState<string>();
    const memberIds = new Set(projectMembers.map((member) => member.membershipId));
    const candidates = activeMembers.filter((member) => !memberIds.has(member.id));
    const canManage = permissions.has('project.member.manage') && !readOnly;

    const handleAdd = async (): Promise<void> => {
        if (!addMembershipId) return;
        try {
            await addProjectMember(projectId, addMembershipId, addRole);
            message.success(t('成员已加入项目'));
            setAddOpen(false);
            setAddMembershipId(undefined);
            onRefreshMembers();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleRemove = async (member: ProjectMemberSummary): Promise<void> => {
        try {
            await removeProjectMember(projectId, member.membershipId, member.version);
            message.success(t('成员已移出项目'));
            onRefreshMembers();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleTransfer = async (): Promise<void> => {
        if (!transferTarget) return;
        try {
            await transferProjectOwner(projectId, transferTarget, projectVersion);
            message.success(t('负责人已转移'));
            setTransferTarget(undefined);
            onRefreshMembers();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    return <>
        <div className="project-panel-heading project-member-toolbar">
            <div><h2>{t('项目成员')}</h2><p><TeamOutlined /> {projectMembers.length} {t('名成员')}</p></div>
            <div className="project-inline-actions">
                {canManage && <Select showSearch allowClear optionFilterProp="label" placeholder={t('转移负责人给…')} value={transferTarget} onChange={(value) => setTransferTarget(value)} style={{ minWidth: 180 }} options={projectMembers.filter((member) => member.role !== 'OWNER').map((member) => ({ value: member.membershipId, label: member.displayName }))} />}
                {transferTarget && <Button type="primary" ghost onClick={() => void handleTransfer()}>{t('确认转移')}</Button>}
                {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>{t('添加成员')}</Button>}
            </div>
        </div>
        <div className="project-member-grid">
            {projectMembers.map((member) => <article className="project-member-card" key={member.id}>
                <div className="project-member-card-head">
                    <Avatar size={38}>{member.displayName.slice(0, 1)}</Avatar>
                    <div><strong>{member.displayName}</strong><small>{member.account}</small></div>
                    <Tag color={member.role === 'OWNER' ? 'gold' : member.role === 'MANAGER' ? 'blue' : 'default'}>{t(projectMemberRoleLabels[member.role])}</Tag>
                </div>
                <div className="project-member-card-actions">
                    {canManage && member.role !== 'OWNER' && <Select size="small" value={member.role} style={{ flex: 1 }} options={[{ value: 'MANAGER', label: t('项目经理') }, { value: 'MEMBER', label: t('项目成员') }]} onChange={(role) => void (async () => {
                        try {
                            await updateProjectMember(projectId, member.membershipId, role as 'MANAGER' | 'MEMBER', member.version);
                            message.success(t('角色已更新'));
                            onRefreshMembers();
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : t('操作失败'));
                        }
                    })()} />}
                    {canManage && member.role !== 'OWNER' && member.membershipId !== myMembershipId && <Popconfirm title={t('确认移出该成员？')} onConfirm={() => void handleRemove(member)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>}
                </div>
            </article>)}
        </div>
        <Modal open={addOpen} title={t('添加项目成员')} okText={t('添加')} cancelText={t('取消')} onOk={() => void handleAdd()} onCancel={() => setAddOpen(false)}>
            <div className="form-grid">
                <label><span>{t('成员')}</span><Select showSearch optionFilterProp="label" placeholder={t('选择租户成员')} value={addMembershipId} onChange={setAddMembershipId} options={candidates.map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} /></label>
                <label><span>{t('项目角色')}</span><Select value={addRole} onChange={(value) => setAddRole(value as 'MANAGER' | 'MEMBER')} options={[{ value: 'MANAGER', label: t('项目经理') }, { value: 'MEMBER', label: t('项目成员') }]} /></label>
            </div>
        </Modal>
    </>;
}
