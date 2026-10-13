export type ComputerPreviewState = "awake" | "asleep";

export interface ComputerPreviewController {
  readonly getState: () => ComputerPreviewState;
  readonly sleep: () => ComputerPreviewState;
  readonly wake: () => ComputerPreviewState;
}

export function createComputerPreviewController(): ComputerPreviewController {
  let previewVisible = true;
  return {
    getState: () => previewVisible ? "awake" : "asleep",
    sleep: () => {
      previewVisible = false;
      return "asleep";
    },
    wake: () => {
      previewVisible = true;
      return "awake";
    },
  };
}
