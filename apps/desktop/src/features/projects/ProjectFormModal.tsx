import { Form, Input, Modal, Select } from 'antd';
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

const ALL_DEPARTMENTS = '__ALL_DEPARTMENTS__';

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
    const selectedDepartmentId = Form.useWatch('departmentId', form);
    const selectedOwnerMembershipId = Form.useWatch('ownerMembershipId', form);
    const departmentSelected = Boolean(selectedDepartmentId);

    useEffect(() => {
        if (!open) return;
        form.resetFields();
        form.setFieldsValue({
            name: editing?.name ?? '',
            description: editing?.description ?? '',
            departmentId: editing ? editing.departmentId ?? ALL_DEPARTMENTS : undefined,
            ownerMembershipId: undefined,
            memberMembershipIds: [],
        });
    }, [open, editing, creating, currentMembershipId, form]);

    const selectableMembers = !departmentSelected
        ? []
        : selectedDepartmentId === ALL_DEPARTMENTS
            ? activeMembers
            : activeMembers.filter((member) => member.departmentId === selectedDepartmentId);
    const ownerMembers = canAssignOwner
        ? selectableMembers
        : activeMembers.filter((member) => member.id === currentMembershipId);
    const ownerOptions = ownerMembers
        .map((member) => ({ value: member.id, label: member.user.displayName }))
        .sort((left, right) => left.label.localeCompare(right.label));
    const memberOptions = selectableMembers
        .filter((member) => member.id !== selectedOwnerMembershipId)
        .map((member) => ({ value: member.id, label: member.user.displayName }))
        .sort((left, right) => left.label.localeCompare(right.label));
    const departmentOptions = [
        { value: ALL_DEPARTMENTS, label: t('所有部门') },
        ...flattenDepartments(departments)
            .filter((department) => department.status === 'ACTIVE')
            .map((department) => ({ value: department.id, label: department.path })),
    ];

    const handleDepartmentChange = (value: string): void => {
        if (creating) {
            form.setFieldsValue({
                departmentId: value,
                ownerMembershipId: canAssignOwner ? undefined : currentMembershipId,
                memberMembershipIds: [],
            });
            return;
        }
        form.setFieldValue('departmentId', value);
    };

    const submit = (values: ProjectFormValues): void => {
        onSubmit({
            ...values,
            departmentId: values.departmentId === ALL_DEPARTMENTS ? null : values.departmentId,
            description: creating ? undefined : values.description,
        });
    };

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
        <Form<ProjectFormValues> form={form} layout="vertical" onFinish={submit}>
            <Form.Item name="name" label={t('项目名称')} rules={[{ required: true, whitespace: true, message: t('请输入项目名称') }, { max: 120 }]}>
                <Input placeholder={t('例如：AI 工作台建设')} />
            </Form.Item>
            {!creating && <Form.Item name="description" label={t('项目说明')} rules={[{ max: 2000 }]}>
                <Input.TextArea rows={3} placeholder={t('项目目标、范围与关键交付物')} />
            </Form.Item>}
            <Form.Item name="departmentId" label={t('归属部门')} rules={[{ required: true, message: t('请先选择部门') }]}>
                <Select showSearch optionFilterProp="label" placeholder={t('请先选择部门')} options={departmentOptions} onChange={handleDepartmentChange} />
            </Form.Item>
            {creating && <Form.Item
                name="ownerMembershipId"
                label={t('负责人')}
                rules={[{ required: true, message: t('选择负责人') }]}
            >
                <Select
                    showSearch
                    optionFilterProp="label"
                    disabled={!departmentSelected || !canAssignOwner}
                    placeholder={departmentSelected ? t('选择负责人') : t('请先选择部门')}
                    options={ownerOptions}
                    onChange={(membershipId) => form.setFieldsValue({ ownerMembershipId: membershipId, memberMembershipIds: [] })}
                />
            </Form.Item>}
            {creating && <Form.Item
                name="memberMembershipIds"
                label={t('初始成员')}
            >
                <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    disabled={!departmentSelected || !canManageMembers}
                    placeholder={departmentSelected ? t('选择初始成员') : t('请先选择部门')}
                    options={memberOptions}
                />
            </Form.Item>}
            {creating && <div className="project-visibility-note">{t('只有项目成员可以查看该项目')}</div>}
        </Form>
    </Modal>;
}

function flattenDepartments(departments: DepartmentNode[], parentPath = ''): Array<DepartmentNode & { path: string }> {
    return departments.flatMap((department) => {
        const path = parentPath ? `${parentPath} / ${department.name}` : department.name;
        return [{ ...department, path }, ...flattenDepartments(department.children ?? [], path)];
    });
}
