import { BookOutlined, FileTextOutlined, FolderOutlined, StarOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Empty, Input, Modal, Spin, Tag } from 'antd';
import { Download, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    exportDocument, getDocument, updateDocument,
    type ManagedDocumentDetail, type ManagedDocumentSummary,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';

function DocumentEditorModal({ documentId, onClose }: { documentId?: string; onClose: () => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const [document, setDocument] = useState<ManagedDocumentDetail>();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState<'docx' | 'pdf' | 'pptx'>();

    useEffect(() => {
        if (!documentId) return;
        setLoading(true);
        getDocument(documentId)
            .then((result) => { setDocument(result); setContent(result.content); })
            .catch((error) => message.error(error instanceof Error ? error.message : t('加载文档失败')))
            .finally(() => setLoading(false));
    }, [documentId, message, t]);

    const save = async (): Promise<void> => {
        if (!document) return;
        setSaving(true);
        try {
            const updated = await updateDocument(document.id, { content, version: document.version });
            setDocument(updated);
            message.success(t('已保存'));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('保存失败'));
        } finally {
            setSaving(false);
        }
    };

    const exportAs = async (format: 'docx' | 'pdf' | 'pptx'): Promise<void> => {
        if (!document) return;
        setExporting(format);
        try {
            await exportDocument(document.id, format, document.title);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('导出失败'));
        } finally {
            setExporting(undefined);
        }
    };

    return <Modal open={Boolean(documentId)} onCancel={onClose} footer={null} width={760} title={document?.title ?? t('文档')} destroyOnHidden>
        {loading ? <div className="data-loading"><Spin /></div> : <>
            <Input.TextArea value={content} onChange={(event) => setContent(event.target.value)} rows={16} style={{ fontFamily: 'Menlo, Consolas, monospace' }} />
            <div className="document-editor-actions">
                {(['docx', 'pdf', 'pptx'] as const).map((format) => <Button key={format} icon={<Download size={15} />} loading={exporting === format} onClick={() => void exportAs(format)}>{format.toUpperCase()}</Button>)}
                <Button type="primary" loading={saving} onClick={() => void save()}>{t('保存')}</Button>
            </div>
        </>}
    </Modal>;
}

type VisibilityScope = 'ALL' | 'TENANT' | 'PRIVATE';

export default function ManagedDocumentsPage({ documents, loading }: { documents: ManagedDocumentSummary[]; loading: boolean }): JSX.Element {
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const [search, setSearch] = useState('');
    const [scope, setScope] = useState<VisibilityScope>('ALL');
    const [selectedId, setSelectedId] = useState<string>();
    const [editingId, setEditingId] = useState<string>();
    const scopes: { value: VisibilityScope; label: string; icon: JSX.Element; count: number }[] = [
        { value: 'ALL', label: t('全部文档'), icon: <BookOutlined />, count: documents.length },
        { value: 'TENANT', label: t('租户可见'), icon: <FolderOutlined />, count: documents.filter((document) => document.visibility === 'TENANT').length },
        { value: 'PRIVATE', label: t('我的私有'), icon: <FolderOutlined />, count: documents.filter((document) => document.visibility === 'PRIVATE').length },
    ];
    const scopedDocuments = scope === 'ALL' ? documents : documents.filter((document) => document.visibility === scope);
    const filteredDocuments = scopedDocuments.filter((document) => document.title.toLowerCase().includes(search.toLowerCase()));
    // 选中项只在当前筛选结果内查找，切换分类或搜索后自动回落到列表首项。
    const selected = filteredDocuments.find((document) => document.id === selectedId) ?? filteredDocuments[0];

    return <div className="workspace-page knowledge-page">
        <header className="workspace-page-header"><div><h1>{t('生成文档')}</h1><p>{t('编辑并导出 AI 生成的受控文档')}</p></div><Button type="primary" icon={<Plus size={15} />}>{t('新建文档')}</Button></header>
        <div className="knowledge-layout">
            <aside className="knowledge-folders surface-panel"><h3>{t('受控文档')}</h3>{scopes.map((item) => <button className={scope === item.value ? 'is-active' : ''} type="button" key={item.value} aria-pressed={scope === item.value} onClick={() => setScope(item.value)}>{item.icon}{item.label}<span>{item.count}</span></button>)}</aside>
            <section className="knowledge-list surface-panel"><div className="knowledge-toolbar"><Input value={search} onChange={(event) => setSearch(event.target.value)} prefix={<FileTextOutlined />} placeholder={t('搜索受控文档')} /><Button icon={<StarOutlined />}>{t('收藏')}</Button></div><div className="knowledge-table-head"><span>{t('文档名称')}</span><span>{t('可见性')}</span><span>{t('更新时间')}</span><span>{t('版本')}</span></div>{loading ? <div className="data-loading"><Spin /></div> : filteredDocuments.length ? filteredDocuments.map((document) => <button className={`knowledge-row ${selected?.id === document.id ? 'is-selected' : ''}`} type="button" key={document.id} onClick={() => setSelectedId(document.id)}><span><i><FileTextOutlined /></i><b>{document.title}</b><small>{t('受控文档')}</small></span><span>{document.visibility === 'TENANT' ? t('租户可见') : t('私有')}</span><span>{formatDate(document.updatedAt)}</span><span><Tag>v{document.version}</Tag></span></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前权限范围内暂无文档')} />}</section>
            <aside className="knowledge-detail surface-panel">{selected ? <><i className="knowledge-file-icon"><FileTextOutlined /></i><h2>{selected.title}</h2><Tag>{selected.visibility === 'TENANT' ? t('租户可见') : t('私有')}</Tag><p>{t('该文档由服务端统一执行权限、版本控制与审计。')}</p><dl><div><dt>{t('最近更新')}</dt><dd>{formatDate(selected.updatedAt)}</dd></div><div><dt>{t('当前版本')}</dt><dd>v{selected.version}</dd></div><div><dt>{t('有效权限')}</dt><dd>{selected.currentPermissions?.join('、') || t('读取')}</dd></div></dl><Button type="primary" block onClick={() => setEditingId(selected.id)}>{t('打开文档')}</Button></> : <Empty description={t('请选择文档')} />}</aside>
        </div>
        <DocumentEditorModal documentId={editingId} onClose={() => setEditingId(undefined)} />
    </div>;
}