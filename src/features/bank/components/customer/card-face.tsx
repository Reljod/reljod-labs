import { maskedCard } from "../../domain/numbers";
import type { CardView } from "../../domain/views";
import { Badge, cx } from "../ui";
import { CARD_TONE, cardExpiry } from "./format";

/**
 * A debit card drawn in the Colonnade style: an ink outline, a hard shadow,
 * a brass chip. Only the last four digits exist, so only they are shown.
 */
export function CardFace({
  card,
  className = "",
}: {
  card: CardView;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "outline-box relative flex aspect-[1.586] w-full max-w-sm flex-col justify-between overflow-hidden rounded-sm p-4 shadow-hard-md",
        card.status === "cancelled"
          ? "bg-marble text-ink-muted"
          : "bg-federal-blue text-paper",
        card.status === "frozen" && "opacity-75",
        className,
      )}
      role="img"
      aria-label={`Debit card ending ${card.lastFour}, ${card.nameOnCard}, expires ${cardExpiry(card.expiresOn)}, ${card.status}`}
      data-testid="bank-card-face"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow text-[0.7rem] font-bold tracking-[0.2em]">
          Tidewater
        </span>
        <Badge tone={CARD_TONE[card.status]}>{card.status}</Badge>
      </div>
      <svg viewBox="0 0 40 30" className="h-8 w-10" aria-hidden="true">
        <rect
          x="1"
          y="1"
          width="38"
          height="28"
          rx="2"
          className="fill-brass stroke-ink"
          strokeWidth="2"
        />
        <path
          d="M14 1v28M26 1v28M1 11h13M26 11h13M1 19h13M26 19h13"
          className="stroke-ink"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>
      <p className="font-mono text-base tracking-[0.12em] sm:text-lg">
        {maskedCard(card.lastFour)}
      </p>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow text-[0.5rem] opacity-80">Card holder</p>
          <p className="truncate font-mono text-xs font-bold uppercase">
            {card.nameOnCard}
          </p>
        </div>
        <div className="text-right">
          <p className="eyebrow text-[0.5rem] opacity-80">Valid thru</p>
          <p className="font-mono text-xs font-bold">
            {cardExpiry(card.expiresOn)}
          </p>
        </div>
        <span className="eyebrow text-[0.6rem] font-bold italic">Debit</span>
      </div>
    </div>
  );
}
