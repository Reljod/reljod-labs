"use client";

import { motion, useScroll } from "motion/react";
import { type CSSProperties, type ReactNode, useRef } from "react";
import { useCopyMotion } from "./copy-motion";
import "./motion.css";

type Props = {
  children: ReactNode;
  className?: string;
  /** Sideways lean while it comes in, in degrees. */
  lean?: number;
  as?: "div" | "li" | "article";
} & Record<`data-${string}`, string>;

/**
 * A block that tips up into place as it comes up the screen, scrubbed by
 * scroll. `lean` sets which way it comes from. Outside a moving page (see
 * `CopyMotionProvider`) it renders a plain block.
 */
export function ScrollIn(props: Props) {
  const animated = useCopyMotion();
  if (!animated) {
    const { children, className, lean: _lean, as = "div", ...rest } = props;
    const Plain = as;
    return (
      <Plain className={className} {...rest}>
        {children}
      </Plain>
    );
  }
  return <Driven {...props} />;
}

function Driven({ children, className, lean = 0, as = "div", ...rest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 1", "start 0.72"],
  });
  const Tag = motion[as];
  return (
    <Tag
      ref={ref as never}
      className={`scroll-in ${className ?? ""}`}
      style={
        {
          "--q": scrollYProgress,
          "--lean": `${lean}deg`,
        } as unknown as CSSProperties
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}
