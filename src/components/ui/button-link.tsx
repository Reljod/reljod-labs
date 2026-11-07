import type { ComponentProps } from "react";

const variants = {
  primary: "bg-federal-blue text-paper",
  accent: "bg-brass text-ink",
  secondary: "bg-paper text-ink",
} as const;

type ButtonLinkProps = ComponentProps<"a"> & {
  variant?: keyof typeof variants;
};

/**
 * A Colonnade button rendered as a link. Used for in-page anchors, mailto and
 * external links, which is every action on this site.
 */
export function ButtonLink({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <a
      className={`outline-box press inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 py-2 font-mono text-sm font-bold tracking-[0.1em] uppercase ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </a>
  );
}
