import * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-5 overflow-hidden bg-card py-5 text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 has-[>img:first-child]:pt-0 data-[size=sm]:gap-4 data-[size=sm]:py-4 sm:gap-8 sm:py-8 sm:data-[size=sm]:gap-5 sm:data-[size=sm]:py-5 *:[img:first-child]:rounded-none *:[img:last-child]:rounded-none",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-none px-5 group-data-[size=sm]/card:px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] sm:px-8 sm:group-data-[size=sm]/card:px-5 [.border-b]:pb-5 group-data-[size=sm]/card:[.border-b]:pb-4 sm:[.border-b]:pb-8 sm:group-data-[size=sm]/card:[.border-b]:pb-5",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-heading text-lg font-semibold tracking-wider uppercase", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn(
        "px-5 group-data-[size=sm]/card:px-4 sm:px-8 sm:group-data-[size=sm]/card:px-5",
        className,
      )}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center px-5 group-data-[size=sm]/card:px-4 sm:px-8 sm:group-data-[size=sm]/card:px-5 [.border-t]:pt-5 group-data-[size=sm]/card:[.border-t]:pt-4 sm:[.border-t]:pt-8 sm:group-data-[size=sm]/card:[.border-t]:pt-5",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
