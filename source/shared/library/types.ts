import type { z } from "zod";
import type { libraryArgsSchemas, libraryResultSchemas, localAccessGrantSchema, localTeamSchema, localTeamMemberSchema } from "./schemas.js";

export type LocalTeam = z.infer<typeof localTeamSchema>;
export type LocalTeamMember = z.infer<typeof localTeamMemberSchema>;
export type LocalAccessGrant = z.infer<typeof localAccessGrantSchema>;
export type LibraryHttpMethod = keyof typeof libraryArgsSchemas;
export type LibraryHttpArgs<M extends LibraryHttpMethod> = z.input<(typeof libraryArgsSchemas)[M]>;
export type LibraryHttpResult<M extends LibraryHttpMethod> = z.output<(typeof libraryResultSchemas)[M]>;
export type LibraryHttpMethods = {
  [M in LibraryHttpMethod]: (args: LibraryHttpArgs<M>) => Promise<LibraryHttpResult<M>>;
};
