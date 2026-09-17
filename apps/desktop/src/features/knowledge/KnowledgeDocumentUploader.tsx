import { InboxOutlined } from '@ant-design/icons';
import { App as AntdApp, Input, Modal, Select, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../core/i18n';
import './knowledge.css';

/**
 * 与后端上传白名单（file.service ALLOWED_ATTACHMENT_CONTENT_TYPES）对齐的支持类型：
 * PDF、Word、Excel、PPT、CSV、Markdown、TXT、JSON 与常见图片。
 */
const ACCEPT_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.md', '.txt', '.json', '.jpg', '.jpeg', '.png', '.webp'];
const ACCEPT = ACCEPT_EXTENSIONS.join(',');
const MAX_SIZE_BYTES = 500 * 1024 * 1024;

const scopeLabels: Record<KnowledgeUploadScope, string> = {
    PRIVATE: '仅知识库成员可见',
    TENANT: '全员可见',
};

export type KnowledgeUploadScope = 'PRIVATE' | 'TENANT';

export interface KnowledgeDocumentUploadInput {
    file: File;
    name: string;
    visibilityScope: KnowledgeUploadScope;
}

interface KnowledgeDocumentUploaderProps {
    open: boolean;
    submitting: boolean;
    onCancel: () => void;
    onSubmit: (input: KnowledgeDocumentUploadInput) => void;
}

/**
 * 知识管理专用的文档上传弹窗：拖动或点击选择文件，填写文档名与可见范围后提交。
 * 只收集元数据，文件直传与文档创建由父组件执行（与对话附件的上传组件互不复用）。
 */
export default function KnowledgeDocumentUploader({ open, submitting, onCancel, onSubmit }: KnowledgeDocumentUploaderProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const [file, setFile] = useState<File>();
    const [name, setName] = useState('');
    const [visibilityScope, setVisibilityScope] = useState<KnowledgeUploadScope>('PRIVATE');

    useEffect(() => {
        if (open) {
            setFile(undefined);
            setName('');
            setVisibilityScope('PRIVATE');
        }
    }, [open]);

    const acceptFile = (candidate: File): void => {
        const lower = candidate.name.toLowerCase();
        const supported = ACCEPT_EXTENSIONS.some((extension) => lower.endsWith(extension));
        if (!supported) {
            message.error(t('不支持的文件类型，请选择 PDF、Word、Excel、PPT 或图片等文档'));
            return;
        }
        if (candidate.size > MAX_SIZE_BYTES) {
            message.error(t('文件不能超过 500MB'));
            return;
        }
        setFile(candidate);
        setName(candidate.name);
    };

    const submit = (): void => {
        if (!file) {
            message.warning(t('请先选择文件'));
            return;
        }
        const trimmed = name.trim();
        if (!trimmed) {
            message.warning(t('请填写文档名称'));
            return;
        }
        onSubmit({ file, name: trimmed, visibilityScope });
    };

    return <Modal
        open={open}
        title={t('上传文档')}
        okText={t('上传并解析')}
        cancelText={t('取消')}
        confirmLoading={submitting}
        onOk={submit}
        onCancel={onCancel}
        width={480}
    >
        <div className="kb-uploader">
            <Upload.Dragger
                accept={ACCEPT}
                multiple={false}
                showUploadList={false}
                disabled={submitting}
                beforeUpload={(candidate) => {
                    acceptFile(candidate);
                    // 拦截自动上传：文件直传 COS 由父组件统一执行。
                    return false;
                }}
            >
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">{file ? file.name : t('点击或拖拽文件到此处上传')}</p>
                <p className="ant-upload-hint">{t('支持 PDF、Word、Excel、PPT、CSV、Markdown、TXT、JSON 与图片，单文件不超过 500MB')}</p>
            </Upload.Dragger>
            {file && <div className="form-grid kb-uploader-form">
                <label><span>{t('文档名称')}</span><Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder={t('默认使用文件名，可修改')} /></label>
                <label><span>{t('可见范围')}</span><Select<KnowledgeUploadScope>
                    value={visibilityScope}
                    onChange={setVisibilityScope}
                    options={Object.entries(scopeLabels).map(([value, label]) => ({ value: value as KnowledgeUploadScope, label: t(label) }))}
                /></label>
            </div>}
        </div>
    </Modal>;
}
