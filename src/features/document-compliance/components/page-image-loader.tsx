"use client";

import {
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useState,
} from "react";

export type ImageStatus = "loading" | "loaded" | "error";

/** Adds a throwaway query param so a retry asks for a fresh signed redirect. */
function withAttempt(src: string, attempt: number) {
  if (attempt === 0) return src;
  return `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;
}

/**
 * Tracks whether a page image has loaded. Spread `imageProps` on the `<img>`.
 * Statuses are kept per URL, so a late event from an image that is being
 * replaced never marks the new one as loaded.
 */
export function useImageStatus(src: string) {
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<Record<string, ImageStatus>>({});
  const imageSrc = withAttempt(src, attempts[src] ?? 0);
  const status = statuses[imageSrc] ?? "loading";

  const settle = useCallback((key: string | null, next: ImageStatus) => {
    if (!key) return;
    setStatuses((previous) =>
      previous[key] === next ? previous : { ...previous, [key]: next },
    );
  }, []);

  // An image can finish before hydration (or straight from the cache), when
  // `onLoad` never fires, so check it as soon as the element is attached.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check whenever the URL changes
  const ref = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image?.complete) return;
      settle(
        image.getAttribute("src"),
        image.naturalWidth > 0 ? "loaded" : "error",
      );
    },
    [settle, imageSrc],
  );

  const retry = useCallback(() => {
    setAttempts((previous) => ({
      ...previous,
      [src]: (previous[src] ?? 0) + 1,
    }));
  }, [src]);

  return {
    status,
    retry,
    imageProps: {
      src: imageSrc,
      ref,
      onLoad: (event: SyntheticEvent<HTMLImageElement>) =>
        settle(event.currentTarget.getAttribute("src"), "loaded"),
      onError: (event: SyntheticEvent<HTMLImageElement>) =>
        settle(event.currentTarget.getAttribute("src"), "error"),
    },
  };
}

/** A shimmering placeholder shown over an image while it loads. */
export function ImageSkeleton({ spinner = true }: { spinner?: boolean }) {
  return (
    <output
      aria-label="Loading page"
      data-testid="image-loading"
      className="absolute inset-0 grid animate-pulse place-items-center bg-limestone"
    >
      {spinner ? (
        <span
          aria-hidden
          className="size-6 animate-spin rounded-full border-2 border-ink border-t-transparent"
        />
      ) : null}
    </output>
  );
}

/** Shown in place of an image that failed to load. */
export function ImageError({ onRetry }: { onRetry?: () => void }) {
  return (
    <span
      role="alert"
      data-testid="image-error"
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-limestone p-2 text-center"
    >
      <span className="font-mono text-xs font-bold uppercase">
        {onRetry ? "Couldn't load page" : "!"}
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          className="outline-box eyebrow pointer-events-auto rounded-sm bg-paper px-3 py-1.5 hover:bg-morning-haze focus-visible:outline-2 focus-visible:outline-federal-blue"
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}

type PageImageProps = {
  src: string;
  alt: string;
  /** Classes for the wrapper, which the image and any overlay fill. Must position it (defaults to `relative`). */
  className?: string;
  style?: CSSProperties;
  /** Classes for the `<img>` in every state. */
  imageClassName?: string;
  /** Extra `<img>` classes while it has no size of its own (loading or failed). */
  pendingClassName?: string;
  /** Small thumbnails: no spinner and no retry button. */
  compact?: boolean;
  /** Overlays drawn on the image, given its status (e.g. only once loaded). */
  children?: (status: ImageStatus) => ReactNode;
};

/** A page image with a loading skeleton, a fade-in, and an error state. */
export function PageImage({
  src,
  alt,
  className = "relative",
  style,
  imageClassName = "",
  pendingClassName = "",
  compact = false,
  children,
}: PageImageProps) {
  const { status, retry, imageProps } = useImageStatus(src);
  const loaded = status === "loaded";

  return (
    <span
      data-testid="page-image"
      data-status={status}
      style={style}
      className={`block ${className}`}
    >
      {/* biome-ignore lint/performance/noImgElement: signed Storage redirect; overlays need the image's natural size */}
      <img
        {...imageProps}
        alt={alt}
        draggable={false}
        className={`transition-opacity duration-300 ${imageClassName} ${
          loaded ? "opacity-100" : `opacity-0 ${pendingClassName}`
        }`}
      />
      {status === "loading" ? <ImageSkeleton spinner={!compact} /> : null}
      {status === "error" ? (
        <ImageError onRetry={compact ? undefined : retry} />
      ) : null}
      {children?.(status)}
    </span>
  );
}
