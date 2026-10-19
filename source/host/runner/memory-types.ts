/** Official 0.71 memory types (`memory-types/profile.ts`, `journal.ts`). */

export const MEMORY_SURFACES = ["always_in_context", "library"] as const;
export type MemorySurface = (typeof MEMORY_SURFACES)[number];

export const CONTEXT_MEMORY_TYPES = [
  "profile",
  "journal",
  "shared_profile",
  "shared_journal",
] as const;
export type ContextMemoryType = (typeof CONTEXT_MEMORY_TYPES)[number];

export interface MemoryTypeDefinition {
  readonly name: ContextMemoryType;
  readonly prompt: string;
  readonly owner: "bot" | "user";
  readonly surface: MemorySurface;
}

export const PROFILE_MEMORY_TYPE: MemoryTypeDefinition = {
  name: "profile",
  prompt: "Lasting facts about the user and how to work with them, kept in mind every turn. Keep it small.",
  owner: "bot",
  surface: "always_in_context",
};

export const JOURNAL_MEMORY_TYPE: MemoryTypeDefinition = {
  name: "journal",
  prompt: "Dated history. Only the latest entries stay in view.",
  owner: "bot",
  surface: "always_in_context",
};

export const SHARED_PROFILE_MEMORY_TYPE: MemoryTypeDefinition = {
  name: "shared_profile",
  prompt: "Lasting facts every assistant the user runs should know. Keep it small.",
  owner: "user",
  surface: "always_in_context",
};

export const SHARED_JOURNAL_MEMORY_TYPE: MemoryTypeDefinition = {
  name: "shared_journal",
  prompt: "Dated history every assistant the user runs should know.",
  owner: "user",
  surface: "always_in_context",
};

export const MEMORY_TYPE_BY_NAME: Readonly<Record<ContextMemoryType, MemoryTypeDefinition>> = {
  profile: PROFILE_MEMORY_TYPE,
  journal: JOURNAL_MEMORY_TYPE,
  shared_profile: SHARED_PROFILE_MEMORY_TYPE,
  shared_journal: SHARED_JOURNAL_MEMORY_TYPE,
};

export function isContextMemoryType(value: string): value is ContextMemoryType {
  return (CONTEXT_MEMORY_TYPES as readonly string[]).includes(value);
}

/** Library facts stay out of the prompt. Node stores the four always-in-context types. */
export function memoryTypeStaysInPrompt(type: ContextMemoryType): boolean {
  return MEMORY_TYPE_BY_NAME[type].surface === "always_in_context";
}

export interface MemoryWriteTarget {
  readonly scope: "agent" | "user";
  readonly tier: "profile" | "log";
}

export function memoryWriteTarget(type: ContextMemoryType): MemoryWriteTarget {
  switch (type) {
    case "profile":
      return { scope: "agent", tier: "profile" };
    case "journal":
      return { scope: "agent", tier: "log" };
    case "shared_profile":
      return { scope: "user", tier: "profile" };
    case "shared_journal":
      return { scope: "user", tier: "log" };
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export function memoryTypeForStoredKind(
  kind: "profile" | "log",
  scope: "agent" | "user",
): ContextMemoryType {
  if (scope === "user") return kind === "profile" ? "shared_profile" : "shared_journal";
  return kind === "profile" ? "profile" : "journal";
}
