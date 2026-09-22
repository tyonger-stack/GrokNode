import { z } from "zod";

const text = z.string().min(1).max(1_000_000);
const name = z.string().min(1).max(255);
const recipeSchema = z.object({
  profile: z.object({ name, description: text, avatarShape: z.string().max(32).optional(), avatarColor: z.string().max(32).optional() }),
  memory: z.array(z.object({ kind: z.enum(["profile", "log"]).nullish(), createdAt: z.string().nullish(), content: text })).max(10_000),
  skills: z.array(z.object({ name, description: text, content: text })).max(1_000),
  routines: z.array(z.object({ name, slug: name, description: text, content: text })).max(1_000),
  plugins: z.array(z.object({ name, pluginId: name, description: text.optional() })).max(1_000),
  gettingStarted: z.object({ skill: name }).optional(),
}).superRefine((recipe, ctx) => {
  if (recipe.gettingStarted !== undefined && !recipe.skills.some(skill => skill.name === recipe.gettingStarted?.skill)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gettingStarted", "skill"], message: "The getting-started skill is missing from the template." });
  }
});

export type BotTemplateRecipe = z.infer<typeof recipeSchema>;
export function parseBotTemplateRecipe(raw: string): BotTemplateRecipe {
  if (Buffer.byteLength(raw, "utf8") > 25 * 1024 * 1024) throw new Error("Bot template exceeds the 25 MB limit.");
  return recipeSchema.parse(JSON.parse(raw));
}
