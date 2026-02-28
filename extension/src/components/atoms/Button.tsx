import React from "react";
import { cva, cx, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      intent: {
        primary:
          "bg-sky-600 text-white hover:bg-sky-500 focus-visible:ring-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400 dark:focus-visible:ring-sky-400",
        secondary:
          "bg-slate-200 text-slate-900 hover:bg-slate-300 focus-visible:ring-slate-500 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600 dark:focus-visible:ring-slate-500",
        ghost:
          "bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-500 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-slate-500",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-5 text-base",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      intent: "primary",
      size: "md",
      fullWidth: false,
    },
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, intent, size, fullWidth, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cx(buttonVariants({ intent, size, fullWidth }), className)}
      {...props}
    />
  );
});

export { Button, buttonVariants };
export type { ButtonProps };
