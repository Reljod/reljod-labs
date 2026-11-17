"use client";

import { motion } from "motion/react";
import { cx } from "./ui";

/** Sheets drawn behind the front page: a thicker stack for a longer file. */
export function sheetsFor(pages: number) {
  if (pages <= 10) return 1;
  if (pages <= 50) return 2;
  if (pages <= 150) return 3;
  if (pages <= 300) return 4;
  return 6;
}

const LINES = [72, 88, 54, 80, 66, 90, 48, 76];

/**
 * A document as a stack of paper: the front page with a letterhead, text
 * lines and a highlighted name, and sheets behind it as thick as the file is
 * long. Fans out on its card's hover (variant "hover").
 */
export function PageStack({
  pages,
  layoutId,
  size = "md",
  seed = 0,
}: {
  pages: number;
  layoutId?: string;
  size?: "sm" | "md";
  seed?: number;
}) {
  const sheets = sheetsFor(pages);
  const small = size === "sm";
  const width = small ? 44 : 96;
  const step = small ? 1.5 : 3;
  return (
    <motion.div
      layoutId={layoutId}
      className="relative shrink-0"
      style={{
        width: width + sheets * step,
        height: width * 1.3 + sheets * step,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: sheets }, (_, index) => {
        const depth = sheets - index;
        return (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: sheets are positional
            key={index}
            variants={{
              rest: {
                x: depth * step,
                y: -depth * step + sheets * step,
                rotate: 0,
              },
              hover: {
                x: depth * step * 2.2,
                y: -depth * step * 1.6 + sheets * step,
                rotate: depth * 1.4,
              },
            }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            className="absolute top-0 left-0 rounded-[2px] border border-ink/25 bg-paper"
            style={{ width, height: width * 1.3 }}
          />
        );
      })}
      <motion.span
        variants={{
          rest: { y: sheets * step },
          hover: { y: sheets * step - 4 },
        }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className={cx(
          "absolute top-0 left-0 flex flex-col overflow-hidden rounded-[2px] border border-ink/40 bg-paper shadow-[2px_3px_0_rgb(20_33_61_/_0.18)]",
          small ? "gap-[2px] p-1" : "gap-[5px] p-2",
        )}
        style={{ width, height: width * 1.3 }}
      >
        <span
          className={cx(
            "block bg-ink",
            small ? "h-[3px] w-3/5" : "mb-1 h-[6px] w-3/5",
          )}
        />
        {LINES.slice(0, small ? 6 : 8).map((line, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative lines
            key={index}
            className="flex gap-[3px]"
            style={{ width: `${((line + seed * 7 + index * 3) % 45) + 50}%` }}
          >
            {index === (seed % 3) + 2 ? (
              <>
                <span
                  className={cx(
                    "block bg-ink/15",
                    small ? "h-[2px] w-1/4" : "h-[4px] w-1/4",
                  )}
                />
                <span
                  className={cx(
                    "block bg-brass",
                    small ? "h-[2px] w-2/5" : "h-[4px] w-2/5",
                  )}
                />
              </>
            ) : (
              <span
                className={cx(
                  "block w-full bg-ink/15",
                  small ? "h-[2px]" : "h-[4px]",
                )}
              />
            )}
          </span>
        ))}
        {small ? null : (
          <span className="mt-auto self-end font-mono text-[0.45rem] tracking-widest text-seal-red/60">
            SPECIMEN
          </span>
        )}
      </motion.span>
    </motion.div>
  );
}
