import Link from "next/link";
import type { ComponentProps } from "react";

const variants = {
  primary: "bg-federal-blue text-paper",
  accent: "bg-brass text-ink",
  secondary: "bg-paper text-ink",
} as const;

type ButtonLinkProps = ComponentProps<"a"> & {
  href: string;
  variant?: keyof typeof variants;
};

/**
 * A Colonnade button rendered as a link. Routes on this site ("/about") go
 * through the Next router; anchors, mailto and external links stay plain.
 */
export function ButtonLink({
  variant = "primary",
  className = "",
  href,
  children,
  ...props
}: ButtonLinkProps) {
  const classes = `outline-box press inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 py-2 font-mono text-sm font-bold tracking-[0.1em] uppercase ${variants[variant]} ${className}`;

  if (href.startsWith("/")) {
    return (
      <Link href={href} className={classes} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={classes} {...props}>
      {children}
    </a>
  );
}
