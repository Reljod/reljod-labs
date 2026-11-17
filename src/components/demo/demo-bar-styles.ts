/*
 * The bar's classes, in a plain module so the server bar and the client tabs
 * draw the same boxes.
 */

/**
 * From which width the bar is one row. Below it the places take their own row
 * under the name. A demo with many places, or many controls, passes "xl".
 */
export type DemoBarRowFrom = "lg" | "xl";

/** The bar's row, the name's box and the places, per `DemoBarRowFrom` (literal, for Tailwind). */
export const demoBarRowClass: Record<DemoBarRowFrom, string> = {
  lg: "lg:h-16 lg:flex-nowrap lg:py-0",
  xl: "xl:h-16 xl:flex-nowrap xl:py-0",
};
export const demoBarNameClass: Record<DemoBarRowFrom, string> = {
  lg: "lg:flex-none lg:basis-auto",
  xl: "xl:flex-none xl:basis-auto",
};
const demoTabsRowClass: Record<DemoBarRowFrom, string> = {
  lg: "lg:order-none lg:ml-3 lg:w-auto lg:pb-0",
  xl: "xl:order-none xl:ml-3 xl:w-auto xl:pb-0",
};

/** On phones the places take their own row under the name. */
export const demoTabsClass = (rowFrom: DemoBarRowFrom = "lg") =>
  `order-last flex w-full flex-wrap gap-2 pb-1 ${demoTabsRowClass[rowFrom]}`;

export const demoTabClass = (active: boolean) =>
  `outline-box press eyebrow flex h-9 items-center gap-1.5 rounded-sm px-3 ${
    active ? "bg-ink text-paper" : "bg-paper"
  }`;

/** A control on the right of the bar: same box and press as a tab. */
export const demoBarControlClass =
  "outline-box press eyebrow flex h-9 items-center gap-1.5 rounded-sm bg-paper px-2.5 font-bold";
