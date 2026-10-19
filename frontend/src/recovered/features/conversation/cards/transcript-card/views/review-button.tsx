import type { ButtonHTMLAttributes } from "react";
import { reviewButtonClass } from "./review-card-classes";

export function ReviewButton({ variant = "primary", sending = false, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: "primary" | "secondary"; readonly sending?: boolean }) {
  return <button {...rest} className={`${reviewButtonClass(variant, sending)}${className == null ? "" : ` ${className}`}`} />;
}
