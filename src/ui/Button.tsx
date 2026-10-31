import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
  shine?: boolean;
  children?: ReactNode;
}

/** Bouton avec retour tactile (léger enfoncement) et reflet sur la variante principale. */
export default function Button({
  variant = "default",
  size = "md",
  icon,
  loading,
  block,
  shine,
  children,
  className = "",
  disabled,
  ...rest
}: Props) {
  const classes = [
    "btn",
    variant !== "default" && variant,
    size !== "md" && size,
    block && "block",
    shine && "shine",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <motion.button
      whileHover={disabled || loading ? undefined : { y: -1 }}
      whileTap={disabled || loading ? undefined : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={classes}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" /> : icon}
      {children}
    </motion.button>
  );
}
