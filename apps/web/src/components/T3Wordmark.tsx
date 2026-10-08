import type { HTMLAttributes } from "react";

import { cn } from "~/lib/utils";

/** The aDamn Code mark, tinted with `currentColor`. Size it with a height or a `size-*` class. */
export function T3Wordmark({ className, style, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      role="img"
      {...props}
      className={cn("inline-block aspect-[484/313] bg-current", className)}
      style={{
        maskImage: "url(/dc-mark.png)",
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}
