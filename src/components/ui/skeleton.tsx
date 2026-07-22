import * as React from "react";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`animate-pulse rounded-md bg-[#2f2f2f]/35 ${className || ""}`} {...props} />;
}
