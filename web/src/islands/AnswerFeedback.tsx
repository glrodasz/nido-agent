import { useState } from "preact/hooks";
import { api } from "../logic/api";
import { t } from "../i18n";
import Icon from "./Icon";
import Spinner, { usePending } from "./Spinner";

type Rating = "up" | "down";

/** 👍/👎 under an Ask Nido answer, with an optional comment after 👎, for the Quality page. */
export default function AnswerFeedback({ logId }: { logId: string }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, track] = usePending();

  async function rate(next: Rating) {
    const value = rating === next ? null : next;
    await track(next, async () => {
      setError(null);
      try {
        await api.feedback(logId, value);
        setRating(value);
        setSent(false);
        setComment("");
      } catch {
        setError(t.feedback.failed);
      }
    });
  }

  async function send(e: Event) {
    e.preventDefault();
    if (!comment.trim()) return;
    await track("comment", async () => {
      setError(null);
      try {
        await api.feedback(logId, "down", comment.trim());
        setSent(true);
      } catch {
        setError(t.feedback.failed);
      }
    });
  }

  return (
    <div class="answer-feedback">
      <div class="answer-rate">
        <span>{rating === "up" ? t.feedback.thanks : t.feedback.question}</span>
        {(["up", "down"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            class={`icon-btn rate-btn${rating === kind ? " rate-on" : ""}`}
            aria-label={kind === "up" ? t.feedback.up : t.feedback.down}
            aria-pressed={rating === kind}
            title={kind === "up" ? t.feedback.up : t.feedback.down}
            disabled={pending !== null}
            onClick={() => rate(kind)}
          >
            {pending === kind ? <Spinner /> : <Icon name={kind === "up" ? "thumbs-up" : "thumbs-down"} />}
          </button>
        ))}
      </div>
      {rating === "down" &&
        (sent ? (
          <p class="answer-noted">{t.feedback.noted}</p>
        ) : (
          <form class="answer-comment" onSubmit={send}>
            <label class="answer-hint" for={`why-${logId}`}>
              {t.feedback.whatWrong}
            </label>
            <input
              id={`why-${logId}`}
              type="text"
              maxLength={500}
              value={comment}
              placeholder={t.feedback.placeholder}
              onInput={(e) => setComment((e.target as HTMLInputElement).value)}
            />
            <button type="submit" class="btn btn-small" disabled={pending !== null || !comment.trim()}>
              {pending === "comment" ? (
                <>
                  <Spinner />
                  {t.feedback.sending}
                </>
              ) : (
                t.feedback.send
              )}
            </button>
          </form>
        ))}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
