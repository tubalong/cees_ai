import { DeleteOutlined, PlusOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Modal, Popconfirm, Select, Tag } from 'antd';
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
        <div className="task-toolbar">
            {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>{t('添加成员')}</Button>}
            {canManage && <Select showSearch allowClear optionFilterProp="label" placeholder={t('转移负责人给…')} value={transferTarget} onChange={(value) => setTransferTarget(value)} style={{ minWidth: 200 }} options={projectMembers.filter((member) => member.role !== 'OWNER').map((member) => ({ value: member.membershipId, label: member.displayName }))} />}
            {transferTarget && <Button type="primary" ghost onClick={() => void handleTransfer()}>{t('确认转移')}</Button>}
            <span style={{ flex: 1 }} />
            <small style={{ color: 'var(--cees-muted)' }}><TeamOutlined /> {projectMembers.length}</small>
        </div>
        <div className="task-list">
            {projectMembers.map((member) => <div className="task-row-item" key={member.id} style={{ cursor: 'default' }}>
                <UserOutlined />
                <strong>{member.displayName}</strong>
                <small>{member.account}</small>
                <Tag color={member.role === 'OWNER' ? 'gold' : member.role === 'MANAGER' ? 'blue' : 'default'}>{t(projectMemberRoleLabels[member.role])}</Tag>
                {canManage && member.role !== 'OWNER' && <Select size="small" value={member.role} style={{ width: 110 }} options={[{ value: 'MANAGER', label: t('项目经理') }, { value: 'MEMBER', label: t('项目成员') }]} onChange={(role) => void (async () => {
                    try {
                        await updateProjectMember(projectId, member.membershipId, role as 'MANAGER' | 'MEMBER', member.version);
                        message.success(t('角色已更新'));
                        onRefreshMembers();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t('操作失败'));
                    }
                })()} />}
                {canManage && member.role !== 'OWNER' && member.membershipId !== myMembershipId && <Popconfirm title={t('确认移出该成员？')} onConfirm={() => void handleRemove(member)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>}
            </div>)}
        </div>
        <Modal open={addOpen} title={t('添加项目成员')} okText={t('添加')} cancelText={t('取消')} onOk={() => void handleAdd()} onCancel={() => setAddOpen(false)}>
            <div className="form-grid">
                <label><span>{t('成员')}</span><Select showSearch optionFilterProp="label" placeholder={t('选择租户成员')} value={addMembershipId} onChange={setAddMembershipId} options={candidates.map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} /></label>
                <label><span>{t('项目角色')}</span><Select value={addRole} onChange={(value) => setAddRole(value as 'MANAGER' | 'MEMBER')} options={[{ value: 'MANAGER', label: t('项目经理') }, { value: 'MEMBER', label: t('项目成员') }]} /></label>
            </div>
        </Modal>
    </>;
}
