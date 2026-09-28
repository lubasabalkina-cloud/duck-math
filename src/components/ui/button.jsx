import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = {
  default: "bg-secondary text-secondary-foreground hover:bg-secondary/90",
  ghost: "hover:bg-muted hover:text-foreground",
};

export function Button({ className, variant = "default", size = "default", ...props }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant] || buttonVariants.default,
        size === "icon" && "h-10 w-10 p-0",
        size === "default" && "h-10 px-4 py-2",
        className
      )}
      {...props}
    />
  );
}
