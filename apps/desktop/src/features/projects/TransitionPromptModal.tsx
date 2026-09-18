import { Input, Modal } from 'antd';
import { useI18n } from '../../core/i18n';

interface TransitionPromptModalProps {
    open: boolean;
    title: string;
    reasonKind: string;
    value: string;
    onChange: (value: string) => void;
    onOk: () => void;
    onCancel: () => void;
}

/** 状态流转的原因 / 总结输入弹窗。 */
export default function TransitionPromptModal({ open, title, reasonKind, value, onChange, onOk, onCancel }: TransitionPromptModalProps): JSX.Element {
    const { t } = useI18n();
    return <Modal open={open} title={title} okText={t('确认')} cancelText={t('取消')} onOk={onOk} onCancel={onCancel}>
        <label className="form-grid">
            <span>{reasonKind}</span>
            <Input.TextArea rows={3} value={value} onChange={(event) => onChange(event.target.value)} placeholder={`${reasonKind}（必填）`} />
        </label>
    </Modal>;
}
