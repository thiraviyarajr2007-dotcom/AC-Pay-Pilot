import React, { useState, useEffect } from 'react';
import { useRole } from '../../context/RoleContext';

interface CopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
  onConsumeInitialQuery?: () => void;
}

interface ModalMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  whyThis?: string;
  approved?: boolean;
}

export const CopilotModal: React.FC<CopilotModalProps> = ({
  isOpen,
  onClose,
  initialQuery,
  onConsumeInitialQuery,
}) => {
  const { dataSource } = useRole();
  const [messages, setMessages] = useState<ModalMessage[]>([
    {
      id: 'm1',
      role: 'ai',
      text: 'Welcome to AC PayPilot Autonomous Copilot. Suggested Action: Check product dimensions in the 3D & AR view and review your 18% GST tax summary before completing PayPal checkout.',
      whyThis:
        'Helps ensure your order qualifies for GST input tax credit and fits your space.',
      approved: false,
    },
  ]);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    if (isOpen && initialQuery && initialQuery.trim()) {
      const q = initialQuery.trim();
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', text: q },
        {
          id: `a-${Date.now() + 1}`,
          role: 'ai',
          text: `Suggestion for "${q}": Reserve payment in PayPal escrow and confirm delivery before releasing funds to the seller.`,
          whyThis:
            'Based on your question and active account view.',
          approved: false,
        },
      ]);
      onConsumeInitialQuery?.();
    }
  }, [isOpen, initialQuery, onConsumeInitialQuery]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const q = input.trim();
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text: q },
      {
        id: `a-${Date.now() + 1}`,
        role: 'ai',
        text: `Suggestion for "${q}": Review the GST invoice line items and keep funds held in escrow until delivery is confirmed.`,
        whyThis:
          'Protects your order until shipment tracking is verified.',
        approved: false,
      },
    ]);
    setInput('');
  };

  return (
    <div className="fixed inset-0 bg-on-surface/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest border border-surface-container-high w-full max-w-lg rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="bg-inverse-surface text-inverse-on-surface px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-inverse-primary">smart_toy</span>
            <div>
              <h3 className="text-sm font-bold font-headline">
                Ask AC PayPilot Copilot — AC PayPilot Autonomous Copilot
              </h3>
              <span className="text-[10px] text-inverse-on-surface/75">
                {dataSource === 'live' ? 'Live' : 'Demo data'} • Suggestions require your confirmation
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-inverse-on-surface/70 hover:text-white p-1 cursor-pointer"
            aria-label="Close Copilot Modal"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`p-3.5 rounded-xl text-xs ${
                m.role === 'user'
                  ? 'bg-primary text-on-primary ml-8'
                  : 'bg-surface-container-low border border-surface-container-high text-on-surface mr-4'
              }`}
            >
              {m.role === 'ai' && (
                <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-surface-container-high">
                  <span className="text-[10px] font-semibold uppercase text-primary">
                    {dataSource === 'live' ? 'Live' : 'Demo data'}
                  </span>
                  <span className="text-[10px] text-secondary">
                    {m.approved ? 'Confirmed ✓' : 'Awaiting Confirmation'}
                  </span>
                </div>
              )}

              {editingId === m.id ? (
                <textarea
                  rows={2}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  className="w-full p-2 rounded-lg border border-primary text-xs bg-surface-container-lowest text-on-surface mb-2"
                />
              ) : (
                <p className="leading-relaxed">{m.text}</p>
              )}

              {m.role === 'ai' && m.whyThis && (
                <div className="mt-2 p-2 rounded-lg bg-surface-container-lowest border border-surface-container-high text-[11px] text-secondary">
                  <strong className="text-on-surface">Why this?</strong> {m.whyThis}
                </div>
              )}

              {m.role === 'ai' && (
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (editingId === m.id) {
                        setEditingId(null);
                      } else {
                        setEditingId(m.id);
                        setDraftText(m.text);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg border border-surface-container-high bg-surface-container-lowest text-on-surface text-[11px] font-semibold cursor-pointer"
                  >
                    {editingId === m.id ? 'Cancel' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMessages((prev) =>
                        prev.map((item) =>
                          item.id === m.id
                            ? {
                                ...item,
                                approved: true,
                                text:
                                  editingId === m.id && draftText.trim()
                                    ? draftText.trim()
                                    : item.text,
                              }
                            : item
                        )
                      );
                      setEditingId(null);
                    }}
                    className={`px-3 py-1 rounded-lg text-on-primary text-[11px] font-semibold cursor-pointer ${
                      m.approved ? 'bg-emerald-600' : 'bg-primary'
                    }`}
                  >
                    {m.approved ? 'Confirmed ✓' : 'Confirm'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <form
          onSubmit={handleSend}
          className="p-3 border-t border-surface-container-high bg-surface-container-low flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask AC PayPilot Copilot..."
            className="flex-1 px-3 py-2 rounded-xl border border-surface-container-high bg-surface-container-lowest text-xs text-on-surface focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-semibold cursor-pointer"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
