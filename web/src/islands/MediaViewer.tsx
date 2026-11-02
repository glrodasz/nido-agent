import { useEffect, useRef, useState } from "preact/hooks";
import { fmt, t } from "../i18n";
import { largePoster } from "../logic/format";
import Icon from "./Icon";
import Spinner from "./Spinner";

export type Media = { kind: "poster"; url: string } | { kind: "trailer"; youtubeId: string };

interface Props {
  media: Media;
  title: string;
  onClose: () => void;
}

/**
 * A title's poster at full size or its trailer, over the page. A native modal dialog, so Escape,
 * focus and the backdrop work as people expect; the trailer stops when it closes because the
 * dialog unmounts.
 */
export default function MediaViewer({ media, title, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState(false);
  const label = media.kind === "poster" ? fmt(t.card.poster, { title }) : fmt(t.card.trailerOf, { title });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);

  return (
    <dialog
      ref={ref}
      class={`viewer viewer-${media.kind}`}
      aria-label={label}
      onClose={onClose}
      // A press on the backdrop lands on the dialog itself; one on the content does not.
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div class="viewer-frame" aria-busy={!loaded}>
        {!loaded && (
          <p class="viewer-loading" role="status">
            <Spinner />
            {t.card.loadingMedia}
          </p>
        )}
        {media.kind === "poster" ? (
          <img
            src={largePoster(media.url)}
            alt={label}
            onLoad={() => setLoaded(true)}
            // A missing large size falls back to the card's own poster.
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== media.url) img.src = media.url;
              else setLoaded(true);
            }}
          />
        ) : (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${media.youtubeId}?autoplay=1&rel=0`}
            title={label}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            onLoad={() => setLoaded(true)}
          />
        )}
      </div>
      <div class="viewer-bar">
        <span class="viewer-title">{label}</span>
        {media.kind === "trailer" && (
          <a href={`https://www.youtube.com/watch?v=${media.youtubeId}`} target="_blank" rel="noopener">
            {t.card.watchOnYouTube}
          </a>
        )}
        <button type="button" class="viewer-close" onClick={() => ref.current?.close()}>
          <Icon name="x" />
          <span class="sr-only">{t.card.close}</span>
        </button>
      </div>
    </dialog>
  );
}
