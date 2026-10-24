import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatINR } from '../../utils/finance';
import { useRole } from '../../context/RoleContext';

interface AssistantScreenProps {
  initialQuery?: string;
  onConsumeInitialQuery?: () => void;
  onNavigateProduct: (sku: string) => void;
  onNavigateCart: () => void;
  onNavigateInvoice: (invoiceId: string) => void;
  onOpenCheckout: () => void;
  showToast: (msg: string) => void;
}

interface ToolBadge {
  toolName: string;
  allowed: boolean;
  recordIds: string[];
  accessNote?: string;
}

interface ProposalAction {
  actionType: string;
  title: string;
  summary: string;
  targetRoute: string;
  requiresConfirmation: true;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  source?: 'live' | 'fallback';
  whyThis?: string;
  citedRecords?: string[];
  toolsUsed?: ToolBadge[];
  proposal?: ProposalAction | null;
  timestamp: string;
  approved?: boolean;
}

const PROMPT_SUGGESTIONS = [
  'Check stock and 3D view readiness for AeroBreeze #FAN-BLDC-892 ceiling fan',
  'Simulate my SmartCart against an ₹85,000 budget ceiling',
  'Review overdue invoices and GST compliance for my store',
  'Check delivery and escrow status on my recent orders',
];

export const AssistantScreen: React.FC<AssistantScreenProps> = ({
  initialQuery,
  onConsumeInitialQuery,
  showToast,
}) => {
  const navigate = useNavigate();
  const { role, profile, getActorHeaders } = useRole();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      source: 'fallback',
      text: `Welcome to AC PayPilot Autonomous Copilot, ${profile.userName}. Ask me to check invoices, orders, transactions, product stock, or plan your SmartCart budget.`,
      whyThis:
        'Reads store records available to your account and suggests next steps for your confirmation.',
      citedRecords: ['#FAN-BLDC-892', '#PP-9821', '#INV-2024-089'],
      toolsUsed: [
        { toolName: 'getStock', allowed: true, recordIds: ['#FAN-BLDC-892', '#SPO-YNX-99P'] },
      ],
      proposal: {
        actionType: 'navigate_product',
        title: 'Open AeroBreeze #FAN-BLDC-892 in 3D & AR view',
        summary: `View the 1200mm BLDC Ceiling Fan (₹${formatINR(8499)}) in 3D & AR view.`,
        targetRoute: '/customer/product/FAN-BLDC-892',
        requiresConfirmation: true,
      },
      timestamp: 'Just now',
      approved: false,
    },
  ]);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [draftEdit, setDraftEdit] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || streaming) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: 'Just now',
    };

    const aiMsgId = `ai-${Date.now() + 1}`;
    const placeholderAiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'assistant',
      source: 'fallback',
      text: 'Checking store records...',
      timestamp: 'Working...',
      approved: false,
    };

    setMessages((prev) => [...prev, userMsg, placeholderAiMsg]);
    setInput('');
    setStreaming(true);

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: {
          ...getActorHeaders(),
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          query: trimmed,
          stream: true,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedText = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const evtBlock of events) {
            const lines = evtBlock.split('\n');
            const eventLine = lines.find((l) => l.startsWith('event:'));
            const dataLine = lines.find((l) => l.startsWith('data:'));
            if (!eventLine || !dataLine) continue;

            const evtType = eventLine.replace('event:', '').trim();
            const payload = JSON.parse(dataLine.replace('data:', '').trim());

            if (evtType === 'tool_calls') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? {
                        ...m,
                        source: payload.source,
                        toolsUsed: payload.toolsUsed,
                        citedRecords: payload.citedRecords,
                      }
                    : m
                )
              );
            } else if (evtType === 'chunk') {
              accumulatedText += payload.text || '';
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? {
                        ...m,
                        text: accumulatedText,
                      }
                    : m
                )
              );
            } else if (evtType === 'done') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? {
                        ...m,
                        source: payload.source,
                        text: payload.answer || accumulatedText,
                        whyThis: payload.whyThis,
                        citedRecords: payload.citedRecords,
                        toolsUsed: payload.toolsUsed,
                        proposal: payload.proposal,
                        timestamp: 'Just now',
                      }
                    : m
                )
              );
            }
          }
        }
      } else {
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                   ...m,
                  source: data.source || 'fallback',
                  text: data.answer || data.error || 'Completed response.',
                  whyThis: data.whyThis,
                  citedRecords: data.citedRecords,
                  toolsUsed: data.toolsUsed,
                  proposal: data.proposal,
                  timestamp: 'Just now',
                }
              : m
          )
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                source: 'fallback',
                text: 'Unable to reach Copilot right now. No changes were made.',
                timestamp: 'Just now',
              }
            : m
        )
      );
    } finally {
      setStreaming(false);
    }
  };

  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      void sendMessage(initialQuery);
      onConsumeInitialQuery?.();
    }
  }, [initialQuery]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleApproveMessage = (id: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              approved: true,
              text: editingMsgId === id && draftEdit.trim() ? draftEdit.trim() : m.text,
            }
          : m
      )
    );
    setEditingMsgId(null);
    showToast('Suggestion confirmed. You can now open the suggested page.');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-widest text-primary block">
            Ask AC PayPilot Copilot
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold font-headline text-on-surface tracking-tight mt-0.5">
            AC PayPilot Autonomous Copilot
          </h1>
          <p className="text-xs text-secondary mt-1">
            Ask questions about your products, cart budget, orders, or invoices.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: Conversation Thread */}
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl border border-surface-container-high flex flex-col h-[620px] overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-2xl rounded-xl p-4 ${
                    msg.role === 'user'
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low border border-surface-container-high text-on-surface'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-surface-container-high">
                      <span
                        data-testid="copilot-msg-source-badge"
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-surface-container-lowest text-secondary border border-surface-container-high"
                      >
                        {msg.source === 'live' ? 'Live' : 'Instant Answer'}
                      </span>
                      <span className="text-[10px] text-secondary">
                        {msg.approved ? 'Confirmed ✓' : 'Awaiting your confirmation'}
                      </span>
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                      {msg.toolsUsed.map((t, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            t.allowed
                              ? 'bg-primary-fixed text-on-primary-fixed'
                              : 'bg-error-container text-on-error-container'
                          }`}
                        >
                          Checked: {t.toolName} ({t.allowed ? `${t.recordIds.length} items` : 'Restricted'})
                        </span>
                      ))}
                    </div>
                  )}

                  {editingMsgId === msg.id ? (
                    <div className="space-y-2 mb-2">
                      <textarea
                        rows={2}
                        value={draftEdit}
                        onChange={(e) => setDraftEdit(e.target.value)}
                        className="w-full p-2 rounded-lg border border-primary text-xs bg-surface-container-lowest text-on-surface"
                      />
                    </div>
                  ) : (
                    <p className="text-xs sm:text-sm leading-relaxed">{msg.text}</p>
                  )}

                  {msg.role === 'assistant' &&
                    msg.citedRecords &&
                    msg.citedRecords.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="font-semibold text-secondary">Referenced:</span>
                        {msg.citedRecords.map((rec, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded bg-surface-container-lowest border border-surface-container-high font-tabular-nums text-on-surface"
                          >
                            {rec}
                          </span>
                        ))}
                      </div>
                    )}

                  {msg.role === 'assistant' && msg.whyThis && (
                    <div className="mt-2.5 p-2.5 rounded-lg bg-surface-container-lowest border border-surface-container-high text-[11px] text-secondary">
                      <strong className="text-on-surface">Why this: </strong>
                      {msg.whyThis}
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="mt-3 pt-2.5 border-t border-surface-container-high flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (editingMsgId === msg.id) {
                              setEditingMsgId(null);
                            } else {
                              setEditingMsgId(msg.id);
                              setDraftEdit(msg.text);
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg border border-surface-container-high bg-surface-container-lowest hover:bg-surface-container text-on-surface text-[11px] font-semibold cursor-pointer"
                        >
                          {editingMsgId === msg.id ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveMessage(msg.id)}
                          data-testid={`copilot-approve-${msg.id}`}
                          className={`px-3 py-1 rounded-lg text-[11px] font-semibold text-on-primary cursor-pointer ${
                            msg.approved
                              ? 'bg-emerald-600'
                              : 'bg-primary hover:bg-primary-container'
                          }`}
                        >
                          {msg.approved ? 'Confirmed ✓' : 'Confirm Suggestion'}
                        </button>
                      </div>

                      {msg.proposal && (
                        <button
                          type="button"
                          disabled={!msg.approved}
                          onClick={() => navigate(msg.proposal!.targetRoute)}
                          className="px-3 py-1 rounded-lg bg-inverse-surface text-inverse-on-surface disabled:opacity-40 text-[11px] font-semibold transition-opacity cursor-pointer disabled:cursor-not-allowed"
                        >
                          {msg.proposal.title} →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
            className="p-4 border-t border-surface-container-high bg-surface-container-low flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask AC PayPilot Copilot about products, orders, invoices, or your cart..."
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-surface-container-high bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={streaming}
              data-testid="copilot-send-btn"
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-container disabled:opacity-50 text-on-primary text-xs font-semibold cursor-pointer"
            >
              {streaming ? 'Working...' : 'Send'}
            </button>
          </form>
        </div>

        {/* Right 4 Cols: Suggested Questions */}
        <div className="lg:col-span-4 bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-secondary">
            Suggested Questions ({role.replace('_', ' ')})
          </h2>
          <div className="space-y-2">
            {PROMPT_SUGGESTIONS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => void sendMessage(prompt)}
                className="w-full text-left p-3 rounded-xl border border-surface-container-high bg-surface-container-low/60 hover:bg-surface-container text-xs font-medium text-on-surface transition-colors cursor-pointer"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
