import {
  SmartModeClassifierDecision,
  SmartModeClassifierResult,
  SmartModeClassifierSuccess,
  type SmartModeClassifierArgs,
  type SmartModeClassifierResult as SmartModeClassifierResultType,
} from "../../../packages/proto/generated/agent/v1/smart_mode_classifier_exec_pb.js";
import { DEFAULT_SAND_AUTO_REVIEW_INSTRUCTIONS, type SandAutoReviewInstructions } from "../../../shared/sand-auto-review-instructions.js";
import { hasSavedAutoReviewRule, localShellAllowRule } from "./local-auto-review-rules.js";

export const LOCAL_AUTO_REVIEW_BLOCK_REASON = "Local Auto-review requires your confirmation.";

export function createLocalSmartModeClassifierExecutor(readInstructions: () => SandAutoReviewInstructions = () => DEFAULT_SAND_AUTO_REVIEW_INSTRUCTIONS): {
  execute(ctx: unknown, args: SmartModeClassifierArgs): Promise<SmartModeClassifierResultType>;
} {
  return {
    async execute(_ctx: unknown, args: SmartModeClassifierArgs): Promise<SmartModeClassifierResultType> {
      const proposedAllowRule = localShellAllowRule(args);
      const instructions = readInstructions();
      const allowed = proposedAllowRule !== undefined && instructions.blockInstructions.length === 0
        && hasSavedAutoReviewRule(proposedAllowRule, instructions.allowInstructions);
      return new SmartModeClassifierResult({
        result: {
          case: "success",
          value: new SmartModeClassifierSuccess({
            decision: allowed ? SmartModeClassifierDecision.ALLOW : SmartModeClassifierDecision.BLOCK,
            ...(allowed ? {} : { blockReason: LOCAL_AUTO_REVIEW_BLOCK_REASON }),
            ...(proposedAllowRule === undefined ? {} : { proposedAllowRule }),
          }),
        },
      });
    },
  };
}
