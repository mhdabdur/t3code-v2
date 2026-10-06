import { Button } from "../ui/button";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  formatContextWindowCompactionMessage,
  formatContextWindowCost,
} from "./ContextWindowMeter.logic";
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { formatResetsIn } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, Minimize2Icon } from "lucide-react";
import { usePrimarySettings } from "../../hooks/useSettings";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { composerFloatingLayerProps } from "./composerEventScope";

/** Subscription quota for the composer's provider, shown under the context window. */
export interface ComposerUsageLimits {
  readonly limits: ServerProviderUsageLimits;
  readonly planLabel: string | null;
}

const DAY_MS = 86_400_000;

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot | null;
  usageLimits?: ComposerUsageLimits | null;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const {
    usage,
    usageLimits,
    modelDisplayName,
    onCompact,
    compactDisabled,
    compactDisabledReason,
  } = props;
  const usedPercentage = usage ? formatPercentage(usage.usedPercentage) : null;
  const normalizedPercentage = Math.max(0, Math.min(100, usage?.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedPercentage / 100);
  const totalProcessedTokens = usage?.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const isOverloaded = normalizedPercentage > 90;
  const usageColor = isOverloaded
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7"
            aria-label={
              !usage
                ? "Usage limits"
                : usage.maxTokens != null && usedPercentage
                  ? `Context window ${usedPercentage} used`
                  : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  className="stroke-muted-foreground/24"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width="sm"
        className="text-left whitespace-normal"
      >
        {usage ? (
          <div className="flex flex-col gap-2 p-(--floating-content-inset)">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-muted-foreground text-xs">Context window</div>
              <div className="text-secondary-label text-2xs tabular-nums">
                {formatContextWindowTokens(usage.usedTokens)}
                {usage.maxTokens != null ? (
                  <>
                    {" / "}
                    {formatContextWindowTokens(usage.maxTokens)}
                    {usedPercentage ? ` (${usedPercentage})` : null}
                  </>
                ) : null}
              </div>
            </div>
            {usage.maxTokens != null ? (
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(normalizedPercentage)}
                aria-label="Context window usage"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{
                    width: `${normalizedPercentage}%`,
                    ...(isOverloaded ? { backgroundColor: "var(--color-error)" } : {}),
                  }}
                />
              </div>
            ) : null}
            {showTotalProcessed ? (
              <div className="flex items-center justify-between gap-3 text-2xs leading-4">
                <span className="text-secondary-label">Total processed</span>
                <span className="font-medium tabular-nums text-secondary-label">
                  {formatContextWindowTokens(totalProcessedTokens)}
                </span>
              </div>
            ) : null}
            {usage.cost != null ? (
              <div className="flex items-center justify-between gap-3 text-2xs leading-4">
                <span className="text-secondary-label">Cost</span>
                <span className="font-medium tabular-nums text-secondary-label">
                  {formatContextWindowCost(usage.cost)}
                </span>
              </div>
            ) : null}
            {usage.compactsAutomatically ? (
              <div className="mt-1 text-pretty text-secondary-label text-2xs font-medium">
                {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
              </div>
            ) : null}
            {onCompact ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  className="mt-1 w-full justify-center"
                  disabled={compactDisabled}
                  onClick={onCompact}
                >
                  <Minimize2Icon aria-hidden="true" />
                  Compact context
                </Button>
                {compactDisabled && compactDisabledReason ? (
                  <div className="text-pretty text-secondary-label text-2xs">
                    {compactDisabledReason}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {usageLimits ? (
          <UsageLimitsSection usageLimits={usageLimits} separated={usage !== null} />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

function resetLabel(
  window: ServerProviderUsageWindow,
  now: number,
  timestampFormat: TimestampFormat,
): string | null {
  if (!window.resetsAt) return null;
  const resetsAt = Date.parse(window.resetsAt);
  if (Number.isFinite(resetsAt) && resetsAt - now >= DAY_MS) {
    return `Resets ${formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}`;
  }
  const resetsIn = formatResetsIn(window, now);
  return resetsIn ? resetsIn.charAt(0).toUpperCase() + resetsIn.slice(1) : null;
}

/**
 * The account's quota windows as used-share bars, like Claude Desktop's meter.
 * Mounted only while the popover is open, so `now` is read once per opening.
 */
function UsageLimitsSection({
  usageLimits,
  separated,
}: {
  readonly usageLimits: ComposerUsageLimits;
  readonly separated: boolean;
}) {
  const navigate = useNavigate();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const now = Date.now();
  const openUsagePage = () => void navigate({ to: "/usage" });
  return (
    <>
      <div
        className={
          separated
            ? "flex flex-col gap-2.5 border-t border-border/60 p-(--floating-content-inset)"
            : "flex flex-col gap-2.5 p-(--floating-content-inset)"
        }
      >
        <button
          type="button"
          className="flex items-center justify-between gap-3 text-left text-muted-foreground text-xs font-medium hover:text-foreground"
          onClick={openUsagePage}
        >
          <span className="truncate">
            Your usage limits{usageLimits.planLabel ? ` · ${usageLimits.planLabel}` : ""}
          </span>
          <ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
        </button>
        {usageLimits.limits.windows.map((window) => {
          const used = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
          const resets = resetLabel(window, now, timestampFormat);
          return (
            <div key={window.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-2xs leading-4">
                <span className="truncate font-medium text-foreground">{window.label}</span>
                <span className="shrink-0 tabular-nums text-secondary-label">
                  {resets}
                  <span className="ms-2">{used}%</span>
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={used}
                aria-label={`${window.label} usage`}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${used}%`,
                    ...(used > 90 ? { backgroundColor: "var(--color-error)" } : {}),
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex border-t border-border/60 p-(--floating-content-inset)">
        <Button size="xs" variant="secondary" onClick={openUsagePage}>
          See detailed breakdown
        </Button>
      </div>
    </>
  );
}

/** Holds the meter's footprint while a thread's activities are still loading. */
export function ContextWindowMeterPlaceholder() {
  return <span aria-hidden="true" className="size-7 shrink-0" />;
}
