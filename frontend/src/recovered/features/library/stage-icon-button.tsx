import { forwardRef, type ButtonHTMLAttributes } from "react";
import { SandIcon, type SandIconName } from "../../ui/sand-kit-primitives";
import "./stage-icon-button.css";

export interface LibraryStageIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly icon: SandIconName;
}

export const LibraryStageIconButton = forwardRef<HTMLButtonElement, LibraryStageIconButtonProps>(function LibraryStageIconButton({
  icon, className, title, type = "button", ...props
}, ref) {
  return <button {...props} className={["sand-library-stage-icon-button", className].filter(Boolean).join(" ")}
    data-size="md" data-variant="elevated" ref={ref} title={title ?? props["aria-label"]} type={type}>
    <SandIcon name={icon} size="lg" style={{ color: "inherit" }} />
  </button>;
});

export const LibraryStageCloseButton = forwardRef<HTMLButtonElement, Omit<LibraryStageIconButtonProps, "icon">>(function LibraryStageCloseButton(props, ref) {
  return <LibraryStageIconButton {...props} icon="close" title={props.title ?? "关闭"}
    data-stage-resting-focus="" ref={ref} />;
});
