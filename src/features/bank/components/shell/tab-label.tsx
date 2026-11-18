import { TAB_LABEL, type Tab } from "../../domain/api";

/** Two places have long names: on a 1280px bar (one row from xl) they shorten. */
const SHORT_LABEL: Partial<Record<Tab, string>> = {
  hood: "Hood",
  connect: "Connect",
};

/** A tab's label in the bar. Shared by the shell and its skeleton, so nothing moves when the app lands. */
export function tabLabel(tab: Tab) {
  const short = SHORT_LABEL[tab];
  if (!short) return TAB_LABEL[tab];
  return (
    <>
      <span className="xl:hidden 2xl:inline">{TAB_LABEL[tab]}</span>
      <span className="hidden xl:inline 2xl:hidden">
        {short}
      </span>
    </>
  );
}
