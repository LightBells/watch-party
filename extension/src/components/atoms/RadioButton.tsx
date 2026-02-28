import React from "react";
import { cva, cx, type VariantProps } from "class-variance-authority";

const radioVariants = cva(
  "h-4 w-4 appearance-none rounded-full border border-slate-400 align-middle checked:border-sky-500 checked:bg-sky-500 checked:ring-2 checked:ring-sky-300/40 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-500",
  {
    variants: {
      intent: {
        default: "focus-visible:ring-sky-500",
        danger: "checked:border-rose-500 checked:bg-rose-500 checked:ring-rose-300/40 focus-visible:ring-rose-500",
      },
      size: {
        sm: "h-3.5 w-3.5",
        md: "h-4 w-4",
        lg: "h-5 w-5",
      },
    },
    defaultVariants: {
      intent: "default",
      size: "md",
    },
  }
);

type RadioButtonProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> &
  VariantProps<typeof radioVariants> & {
    label?: React.ReactNode;
    labelClassName?: string;
  };

const RadioButton = React.forwardRef<HTMLInputElement, RadioButtonProps>(function RadioButton(
  { className, intent, size, label, labelClassName, ...props },
  ref
) {
  return (
    <label className={cx("inline-flex items-center gap-2", labelClassName)}>
      <input
        ref={ref}
        type="radio"
        className={cx(radioVariants({ intent, size }), className)}
        {...props}
      />
      {label ? <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span> : null}
    </label>
  );
});

export { RadioButton, radioVariants };
export type { RadioButtonProps };
