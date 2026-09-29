import { MessageCircle, Maximize2, Send, Sparkles, X } from 'lucide-react';
import { Button, Input } from 'antd';
import { useState } from 'react';
import { createConversation, createTurn, type PageAssistantContext, type TurnStreamEvent } from '../../core/api';
import { useI18n } from '../../core/i18n';
import { toUserErrorMessage } from '../../core/user-error';
import './page-assistant.css';

interface PageAssistantProps {
    context: PageAssistantContext;
    suggestions: string[];
    onExpand: (context: PageAssistantContext, conversationId?: string) => void;
}

interface LocalMessage {
    role: 'assistant' | 'user';
    content: string;
}

export default function PageAssistant({ context, suggestions, onExpand }: PageAssistantProps): JSX.Element {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [conversationId, setConversationId] = useState<string>();
    const [messages, setMessages] = useState<LocalMessage[]>([]);

    const greeting = `我是你的${context.role}。我可以根据当前页面帮你查询、分析和推进工作；涉及创建、修改、分配等操作时，我会先向你确认。`;

    const openAssistant = (): void => {
        setOpen(true);
        setMessages((items) => items.length ? items : [{ role: 'assistant', content: greeting }]);
    };

    const send = async (value = input): Promise<void> => {
        const content = value.trim();
        if (!content || sending) return;
        setInput('');
        setMessages((items) => [...items, { role: 'user', content }]);
        setSending(true);
        let answer = '';
        try {
            const conversation = conversationId
                ? { id: conversationId }
                : await createConversation(`${context.role} · 页面助手`, 'standard');
            if (!conversationId) setConversationId(conversation.id);
            await createTurn(
                conversation.id,
                { content, mode: 'standard', assistantContext: context, knowledgeBaseEnabled: context.source === 'knowledge-management' },
                crypto.randomUUID(),
                (event: TurnStreamEvent) => {
                    if (event.type === 'content_delta') {
                        answer += event.text;
                        setMessages((items) => [
                            ...items.filter((item) => item !== items[items.length - 1] || item.role !== 'assistant'),
                            { role: 'assistant', content: answer },
                        ]);
                    }
                    if (event.type === 'error') throw new Error(event.error.message);
                    if (event.type === 'completed') setSending(false);
                },
            );
            if (!answer) setMessages((items) => [...items, { role: 'assistant', content: t('暂时没有生成可展示的回答，请换一种问法。') }]);
        } catch (error) {
            setMessages((items) => [...items, { role: 'assistant', content: toUserErrorMessage(error, t('页面助手暂时无法响应，请稍后重试。')) }]);
        } finally {
            setSending(false);
        }
    };

    return <>
        {!open && <button type="button" className="page-assistant-fab" onClick={openAssistant} aria-label={t('问问 AI')}><Sparkles size={17} /><span>{t('问问 AI')}</span></button>}
        {open && <aside className="page-assistant-popover" aria-label={`${context.role}对话助手`}>
            <header className="page-assistant-header"><span><i><Sparkles size={15} /></i><strong>{context.role}</strong></span><span><button type="button" onClick={() => onExpand(context, conversationId)} aria-label={t('展开完整对话')}><Maximize2 size={15} /></button><button type="button" onClick={() => setOpen(false)} aria-label={t('关闭')}><X size={16} /></button></span></header>
            <div className="page-assistant-context"><MessageCircle size={13} />{context.selected?.name ? String(context.selected.name) : t('当前管理页面')}</div>
            <div className="page-assistant-messages">
                {messages.map((message, index) => <div className={`page-assistant-message ${message.role}`} key={`${message.role}-${index}`}>{message.content}</div>)}
                {sending && <div className="page-assistant-message assistant is-thinking">{t('正在思考…')}</div>}
            </div>
            {messages.length <= 1 && <div className="page-assistant-suggestions">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div>}
            <div className="page-assistant-composer"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} value={input} disabled={sending} onChange={(event) => setInput(event.target.value)} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={t('问问当前页面…')} /><Button type="primary" shape="circle" icon={<Send size={14} />} loading={sending} disabled={!input.trim()} onClick={() => void send()} /></div>
        </aside>}
    </>;
}
