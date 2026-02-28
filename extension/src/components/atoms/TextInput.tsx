import React from "react";
import { cva, cx, type VariantProps } from "class-variance-authority";

const textInputVariants = cva(
  "w-full rounded-md border bg-white text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400",
  {
    variants: {
      intent: {
        default:
          "border-slate-300 focus-visible:border-sky-500 focus-visible:ring-sky-500 dark:border-slate-700 dark:focus-visible:border-sky-500 dark:focus-visible:ring-sky-500",
        danger:
          "border-rose-500 focus-visible:border-rose-500 focus-visible:ring-rose-500 dark:border-rose-500 dark:focus-visible:border-rose-500 dark:focus-visible:ring-rose-500",
        success:
          "border-emerald-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500 dark:border-emerald-500 dark:focus-visible:border-emerald-500 dark:focus-visible:ring-emerald-500",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-3 text-sm",
        lg: "h-12 px-4 text-base",
      },
    },
    defaultVariants: {
      intent: "default",
      size: "md",
    },
  }
);

type TextInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> &
  VariantProps<typeof textInputVariants>;

const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, intent, size, type = "text", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cx(textInputVariants({ intent, size }), className)}
      {...props}
    />
  );
});

export { TextInput, textInputVariants };
export type { TextInputProps };
