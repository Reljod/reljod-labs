/*
 * The bar's classes, in a plain module so the server bar and the client tabs
 * draw the same boxes.
 */

/** On phones the places take their own row under the name. */
export const demoTabsClass =
  "order-last flex w-full flex-wrap gap-2 pb-1 lg:order-none lg:ml-3 lg:w-auto lg:pb-0";

export const demoTabClass = (active: boolean) =>
  `outline-box press eyebrow flex h-9 items-center gap-1.5 rounded-sm px-3 ${
    active ? "bg-ink text-paper" : "bg-paper"
  }`;

/** A control on the right of the bar: same box and press as a tab. */
export const demoBarControlClass =
  "outline-box press eyebrow flex h-9 items-center gap-1.5 rounded-sm bg-paper px-2.5 font-bold";
