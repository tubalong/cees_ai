import { Alert, Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import type { DepartmentNode, ProjectSummary, TenantMember } from '../../core/api';
import { useI18n } from '../../core/i18n';

export interface ProjectFormValues {
    name: string;
    description?: string;
    departmentId?: string | null;
    ownerMembershipId?: string;
    memberMembershipIds?: string[];
}

interface ProjectFormModalProps {
    open: boolean;
    editing?: ProjectSummary;
    permissions: Set<string>;
    currentMembershipId: string;
    activeMembers: TenantMember[];
    departments: DepartmentNode[];
    submitting: boolean;
    onSubmit: (values: ProjectFormValues) => void;
    onCancel: () => void;
}

/**
 * 新建 / 编辑项目弹窗。
 *
 * 项目编码由服务端在创建成功后按租户时区年份分配，因此弹窗内不提供编码输入；
 * 项目时间字段全部是系统时间戳，也不在表单内出现。
 */
export default function ProjectFormModal(props: ProjectFormModalProps): JSX.Element {
    const { open, editing, permissions, currentMembershipId, activeMembers, departments, submitting, onSubmit, onCancel } = props;
    const { t } = useI18n();
    const [form] = Form.useForm<ProjectFormValues>();
    const creating = !editing;
    const canAssignOwner = permissions.has('project.manage_all');
    const canManageMembers = permissions.has('project.member.manage');

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            name: editing?.name ?? '',
            description: editing?.description ?? '',
            departmentId: editing?.departmentId ?? null,
            ownerMembershipId: creating ? currentMembershipId : undefined,
            memberMembershipIds: [],
        });
    }, [open, editing, creating, currentMembershipId, form]);

    const memberOptions = activeMembers.map((member) => ({
        value: member.id,
        label: `${member.user.displayName} (${member.account})`,
    }));
    const departmentOptions = departments.map((department) => ({ value: department.id, label: department.name }));

    return <Modal
        open={open}
        title={editing ? t('编辑项目') : t('新建项目')}
        okText={editing ? t('保存') : t('创建')}
        cancelText={t('取消')}
        confirmLoading={submitting}
        onOk={() => void form.submit()}
        onCancel={onCancel}
        destroyOnHidden
    >
        <Form<ProjectFormValues> form={form} layout="vertical" onFinish={(values) => onSubmit(values)}>
            <Form.Item name="name" label={t('项目名称')} rules={[{ required: true, whitespace: true, message: t('请输入项目名称') }, { max: 120 }]}>
                <Input placeholder={t('例如：AI 工作台建设')} />
            </Form.Item>
            <Form.Item name="description" label={t('项目说明')} rules={[{ max: 2000 }]}>
                <Input.TextArea rows={3} placeholder={t('项目目标、范围与关键交付物')} />
            </Form.Item>
            <Form.Item name="departmentId" label={t('归属部门')} extra={t('归属部门只用于归属、筛选和统计，不会给部门成员授予项目访问权限')}>
                <Select allowClear showSearch optionFilterProp="label" placeholder={t('可选')} options={departmentOptions} />
            </Form.Item>
            {creating && <Form.Item
                name="ownerMembershipId"
                label={t('负责人')}
                extra={canAssignOwner ? undefined : t('不指定时默认为本人；指定其他成员需要 project.manage_all 权限')}
            >
                <Select showSearch optionFilterProp="label" disabled={!canAssignOwner} options={memberOptions} />
            </Form.Item>}
            {creating && <Form.Item
                name="memberMembershipIds"
                label={t('初始成员')}
                extra={canManageMembers
                    ? t('创建后可在项目成员页继续调整；负责人会自动加入，无需重复选择')
                    : t('需要 project.member.manage 权限才能指定初始成员')}
            >
                <Select mode="multiple" allowClear showSearch optionFilterProp="label" disabled={!canManageMembers} placeholder={t('可选')} options={memberOptions} />
            </Form.Item>}
            {creating && <Alert
                type="info"
                showIcon
                message={t('只有项目成员可以查看该项目')}
                description={t('项目编号在创建成功后按企业时区年份自动分配，例如 PRJ-2026-1；项目访问范围始终由项目成员关系决定。')}
            />}
        </Form>
    </Modal>;
}
