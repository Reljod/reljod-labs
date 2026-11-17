"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { buttonClass, cx } from "../ui";

/**
 * A small panel that opens under (or over) a button. Escape and a click
 * outside close it and focus goes back to the button. Not modal: the page
 * stays reachable.
 */
export function Popover({
  label,
  children,
  icon,
  align = "left",
  side = "bottom",
  disabled = false,
  title,
  className = "",
  panelClassName = "",
}: {
  /** The button's text. */
  label: ReactNode;
  /** The panel; receives `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  icon?: ReactNode;
  align?: "left" | "right";
  side?: "top" | "bottom";
  disabled?: boolean;
  title?: string;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={root} className={cx("relative", className)}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        title={title}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={buttonClass("secondary", "sm")}
      >
        {icon}
        {label}
      </button>
      {open ? (
        <div
          id={panelId}
          className={cx(
            "absolute z-30 w-[min(22rem,calc(100vw-2rem))] rounded-sm border border-ink/25 bg-paper p-3 text-sm shadow-hard-md",
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
            align === "left" ? "left-0" : "right-0",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
