/**
 * Scrolls `element` into view inside its nearest scrolling container only.
 * `scrollIntoView` also scrolls every ancestor that can scroll, including
 * `overflow: hidden` ones and the window, so the app shell slid up and left a
 * blank band under it when a Rule was opened from a Finding.
 */
export function scrollWithin(
  element: HTMLElement | null | undefined,
  block: "start" | "center" | "nearest" = "start",
  behavior: ScrollBehavior = "smooth",
): void {
  if (!element) return;
  let box = element.parentElement;
  while (box) {
    const { overflowY } = getComputedStyle(box);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      box.scrollHeight > box.clientHeight
    )
      break;
    box = box.parentElement;
  }
  if (!box) return;
  const offset =
    element.getBoundingClientRect().top -
    box.getBoundingClientRect().top +
    box.scrollTop;
  const top =
    block === "center"
      ? offset - (box.clientHeight - element.offsetHeight) / 2
      : block === "nearest"
        ? Math.min(
            Math.max(
              box.scrollTop,
              offset + element.offsetHeight - box.clientHeight,
            ),
            offset,
          )
        : offset;
  box.scrollTo({ top: Math.max(0, top), behavior });
}
