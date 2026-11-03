import { useEffect, useRef, type KeyboardEvent } from "react";
import Markdown from "react-markdown";

import type { ChatMessage, ChatState } from "../chatReducer";
import { formatTime } from "../format";
import { CardView } from "./Cards";
import { Icon } from "./Icon";

export const MAX_MESSAGE_LENGTH = 2000;
// After a handoff the agent only repeats that a person will answer, so the box is locked
// until the customer starts a new conversation.
export const HANDED_OFF_PLACEHOLDER = "Bir müşteri temsilcisine aktarıldınız. Yeni bir konuşma başlatabilirsiniz.";

const START_TOPICS = [
  { icon: "inventory_2", text: "Siparişim nerede?" },
  { icon: "assignment_return", text: "İade talebi oluştur" },
  { icon: "local_shipping", text: "Kargo takibi" },
  { icon: "policy", text: "İade politikası" },
  { icon: "support_agent", text: "Temsilciye bağlan" },
];

const QUICK_REPLIES = [
  { emoji: "📦", text: "Siparişim nerede?" },
  { emoji: "🔄", text: "İade talebi oluştur" },
  { emoji: "🚚", text: "Kargo takibi" },
  { emoji: "📑", text: "İade politikası" },
  { emoji: "🙋", text: "Temsilciye bağlan", accent: true },
  { emoji: "📍", text: "Adres değişikliği" },
];

interface Props {
  state: ChatState;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  onReset: () => void;
  onClose: () => void;
}

function downloadTranscript(messages: ChatMessage[]) {
  const lines = messages.map(
    (message) => `${message.role === "user" ? "Müşteri" : "DestekAI"}: ${message.text}`,
  );
  const url = URL.createObjectURL(new Blob([lines.join("\n\n")], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "gorusme-kaydi.txt";
  link.click();
  URL.revokeObjectURL(url);
}

/** Fills its container: the chat window decides the size. */
export function ChatPanel({ state, draft, onDraftChange, onSend, onReset, onClose }: Props) {
  const stream = useRef<HTMLDivElement>(null);
  const lastMessage = state.messages[state.messages.length - 1];
  const empty = state.messages.length === 0;
  const handedOff = state.handoffSummary !== null;

  useEffect(() => {
    stream.current?.scrollTo?.({ top: stream.current.scrollHeight });
  }, [state.messages.length, lastMessage?.text, lastMessage?.cards.length]);

  function submit() {
    const text = draft.trim();
    if (!text || state.streaming || handedOff) return;
    onDraftChange("");
    onSend(text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className="flex h-full w-full flex-col bg-surface-container-lowest rounded-xl shadow-2xl border-2 border-ai overflow-hidden">
      <div className="p-space-md pb-space-sm flex flex-col gap-space-sm border-b border-surface-variant/40 bg-surface-container-lowest">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-ai flex items-center justify-center text-on-primary shadow-sm">
              <Icon name="smart_toy" className="text-[24px]" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h2 className="font-headline-sm text-headline-sm text-on-surface">
                  DestekAI Akıllı Asistan
                </h2>
                <span className="w-2 h-2 rounded-full bg-secondary" />
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant">
                ModaTrend Otomatik Müşteri Deneyimi
              </span>
            </div>
          </div>
          <div className="flex items-center gap-space-xs">
            <button
              type="button"
              onClick={onReset}
              title="Görüşmeyi Sıfırla"
              aria-label="Görüşmeyi Sıfırla"
              className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
            >
              <Icon name="refresh" className="text-[20px]" />
            </button>
            <button
              type="button"
              onClick={() => downloadTranscript(state.messages)}
              title="Görüşme Kaydını İndir"
              aria-label="Görüşme Kaydını İndir"
              className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
            >
              <Icon name="download" className="text-[20px]" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Asistanı Kapat"
              aria-label="Asistanı Kapat"
              className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
            >
              <Icon name="close" className="text-[20px]" />
            </button>
          </div>
        </div>
        {state.handoffSummary !== null && <HandoffBanner />}
      </div>

      {empty ? (
        <Welcome onSend={onSend} />
      ) : (
        <div
          ref={stream}
          aria-live="polite"
          className="flex-1 min-h-0 p-space-md overflow-y-auto flex flex-col gap-space-lg bg-surface-bright/50"
        >
          <div className="flex items-center justify-center my-space-xs">
            <span className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-code-sm text-[11px]">
              Bugün • {state.messages[0].time ?? formatTime(new Date())}
            </span>
          </div>
          {state.messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              pending={state.streaming && message === lastMessage}
            />
          ))}
        </div>
      )}

      <div className="p-space-md bg-surface-container-lowest border-t border-ai-soft/40 flex flex-col gap-space-sm">
        {!empty && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply.text}
                type="button"
                disabled={state.streaming || handedOff}
                onClick={() => onSend(reply.text)}
                className={`px-3.5 py-1.5 rounded-full font-label-sm text-label-sm whitespace-nowrap transition-all duration-200 shadow-sm hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
                  reply.accent
                    ? "bg-tertiary-fixed hover:bg-tertiary-container hover:text-on-tertiary-fixed text-on-tertiary-fixed"
                    : "bg-blue-50 text-blue-900 border border-blue-200/60 hover:bg-blue-100"
                }`}
              >
                {reply.emoji} {reply.text}
              </button>
            ))}
          </div>
        )}
        <div className="relative bg-ai-surface rounded-xl p-space-sm shadow-sm flex flex-col gap-2 border border-ai-soft/40 focus-within:border-ai-deep focus-within:ring-2 focus-within:ring-ai-deep/20 transition-all">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            aria-label="Mesajınız"
            disabled={handedOff}
            placeholder={handedOff ? HANDED_OFF_PLACEHOLDER : "Siparişiniz, iade veya ürünler hakkında bir soru sorun..."}
            className="w-full bg-transparent text-on-surface font-body-md text-body-md placeholder:text-ai-muted focus:outline-none resize-none px-2 pt-1 pb-2 border-0"
          />
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
              {[
                ["attach_file", "Görsel / Belge Ekle"],
                ["photo_camera", "Hasar / İade Fotoğrafı Çek"],
                ["mic", "Sesli Mesaj"],
              ].map(([icon, title]) => (
                <button
                  key={icon}
                  type="button"
                  title={title}
                  aria-label={title}
                  className="p-2 rounded-lg text-ai-muted hover:text-ai-deep hover:bg-ai-container transition-colors"
                >
                  <Icon name={icon} className="text-[20px]" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-space-sm">
              <span className="hidden sm:inline font-code-sm text-[11px] text-ai-muted">
                Enter: Gönder
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={state.streaming || handedOff || !draft.trim()}
                className="px-space-md py-2 rounded-lg bg-ai-deep hover:bg-ai text-white font-label-md text-label-md font-semibold flex items-center gap-1.5 shadow-sm transition-all hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span>Gönder</span>
                <Icon name="send" className="text-[18px]" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HandoffBanner() {
  return (
    <div
      role="status"
      className="rounded-xl p-space-sm bg-primary-fixed/40 text-on-primary-fixed-variant shadow-sm flex items-start sm:items-center justify-between gap-space-sm border border-surface-variant"
    >
      <div className="flex items-start gap-space-sm">
        <div className="mt-0.5 sm:mt-0 p-1 rounded-full bg-tertiary-fixed text-tertiary shrink-0">
          <Icon name="support_agent" className="text-[16px]" />
        </div>
        <div className="flex flex-col">
          <span className="font-label-md text-label-md font-bold">
            Canlı Temsilciye Aktarım Başlatıldı
          </span>
          <p className="font-body-sm text-body-sm leading-snug">
            Müşteri temsilcimiz görüşmeye dahil ediliyor. Sipariş bağlamınız aktarıldı.
          </p>
        </div>
      </div>
    </div>
  );
}

function Welcome({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-space-lg flex flex-col items-center bg-surface-bright/40">
      <div className="w-full max-w-2xl flex flex-col items-center gap-space-lg my-auto text-center py-8">
        <div className="flex flex-col items-center gap-space-md w-full">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-ai text-white flex items-center justify-center shadow-md">
              <Icon name="smart_toy" className="text-[36px]" />
            </div>
            <span
              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-secondary ring-4 ring-surface-container-lowest flex items-center justify-center text-[10px] text-on-secondary"
              title="Hazır"
            >
              ✓
            </span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-low border border-surface-variant/50 text-on-surface-variant font-code-sm text-[12px]">
            <Icon name="schedule" className="text-[14px] text-ai-deep" />
            <span>Bugün • {formatTime(new Date())}</span>
            <span className="mx-1">•</span>
            <span className="text-secondary font-medium">DestekAI v2.4</span>
          </div>
          <div className="bg-surface-container-lowest border border-surface-variant/60 rounded-2xl p-space-lg shadow-sm max-w-lg">
            <p className="font-headline-sm text-[17px] text-on-surface leading-relaxed font-medium">
              Merhaba! Siparişleriniz, kargo takibi veya iade işlemleri için size yardımcı
              olabilirim.
            </p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-2">
              Hızlıca başlamak için aşağıdaki hazır konulardan birini seçebilir veya sorunuzu
              doğrudan yazabilirsiniz.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-space-sm w-full max-w-xl">
          <span className="font-label-sm text-[12px] font-semibold text-on-surface-variant uppercase tracking-wider">
            Hızlı Başlangıç Konuları
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {START_TOPICS.map(({ icon, text }) => (
              <button
                key={text}
                type="button"
                onClick={() => onSend(text)}
                className="px-4 py-2 rounded-full bg-surface-container-lowest text-ai-deep border border-ai-deep/30 hover:bg-ai-surface hover:border-ai-deep font-label-md text-label-md flex items-center gap-2 transition-all duration-150 shadow-sm hover:-translate-y-0.5"
              >
                <Icon name={icon} className="text-[18px]" />
                <span>{text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MessageMarkdown({ text }: { text: string }) {
  // Raw HTML stays disabled: this text comes from a model.
  return <Markdown>{text}</Markdown>;
}

function MessageView({ message, pending }: { message: ChatMessage; pending: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1 max-w-[85%] self-end">
        <div className="bg-ai text-white p-space-md rounded-2xl rounded-tr-none shadow-sm whitespace-pre-wrap">
          <p className="font-body-md text-body-md">{message.text}</p>
        </div>
        {message.time && (
          <span className="font-code-sm text-[11px] text-on-surface-variant">
            {message.time} • İletildi
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-space-sm max-w-[95%] self-start">
      <div className="flex items-start gap-space-sm w-full">
        <div className="w-8 h-8 rounded-lg bg-ai text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
          <Icon name="smart_toy" className="text-[18px]" />
        </div>
        <div className="flex flex-col gap-space-md w-full min-w-0">
          {message.text && (
            <div
              className={`markdown p-space-md rounded-2xl rounded-tl-none shadow-sm font-body-md text-body-md leading-relaxed ${
                message.error
                  ? "bg-error-container text-on-error-container"
                  : "bg-surface-container-lowest text-on-surface border border-ai-soft"
              }`}
            >
              <MessageMarkdown text={message.text} />
            </div>
          )}
          {message.cards.map((card, index) => (
            <CardView key={index} card={card} />
          ))}
          {pending && !message.text && (
            <div className="bg-surface-container-lowest px-space-md py-2.5 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-space-sm self-start">
              <div className="flex items-center gap-1" aria-hidden="true">
                <span className="w-2 h-2 rounded-full bg-ai-deep animate-bounce" />
                <span className="w-2 h-2 rounded-full bg-ai-deep animate-bounce [animation-delay:0.2s]" />
                <span className="w-2 h-2 rounded-full bg-ai-deep animate-bounce [animation-delay:0.4s]" />
              </div>
              <span className="font-code-sm text-[12px] text-on-surface-variant">
                DestekAI yanıt oluşturuyor...
              </span>
            </div>
          )}
        </div>
      </div>
      {message.time && !pending && (
        <span className="font-code-sm text-[11px] text-on-surface-variant ml-11">
          {message.time} • AI v2.4 Üretimi
        </span>
      )}
    </div>
  );
}
