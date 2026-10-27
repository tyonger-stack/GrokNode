/**
 * Grok Node extension of aiserver.v1.GrokBotService with the Bot email inbox
 * surface of official Grok Bot 0.75.8 (cloud inbox @mail.grokbot.com). The
 * upstream 0.18 artifact this repo reconstructs carries no email messages;
 * field numbers and proto type codes below are taken verbatim from the
 * official 0.75.8 service descriptor:
 *   GrokBotEmailInbox|1 email 9|2 domain 9|3 created_at_ms 3|4 assigned 8
 *   CreateGrokBotEmailInboxRequest|1 username 9|2 display_name 9          Response|1 inbox #GrokBotEmailInbox
 *   ListGrokBotEmailInboxesRequest|1 shows_assigned 8                     Response|1 inboxes #GrokBotEmailInbox*
 *   DeleteGrokBotEmailInboxRequest|1 email 9
 *   CheckGrokBotEmailAddressAvailabilityRequest|1 usernames 9*            Response|1 results #Result*
 *     Result|1 username 9|2 email 9|3 availability #enum|4 message 9
 *   SearchGrokBotEmailThreadsRequest|1 query 9|2 inbox_email 9?|3 from_address 9?|4 after_ms 3?|5 before_ms 3?|6 limit 5|7 mode #enum
 *   SearchGrokBotEmailThreadsResponse|1 threads #ThreadSummary*
 *     ThreadSummary|1 thread_id 9|2 subject 9|3 message_count 5|4 last_message_at_ms 3|5 participants #Address*|6 matching_messages #MatchingMessage*|7 unread_count 5
 *     MatchingMessage|1 message_id 9|2 from #Address|3 occurred_at_ms 3|4 direction #enum|5 snippet 9?|6 unread 8
 *     Address|1 name 9|2 email 9
 * Scalar codes: 3=int64, 5=int32, 8=bool, 9=string. The response message of
 * DeleteGrokBotEmailInbox is not described upstream and is declared empty.
 */
import { Message, proto3, type MessageType, type PartialMessage } from "@bufbuild/protobuf";

export type GrokBotEmailDirection = 0 | 1 | 2;
export const GrokBotEmailDirection = proto3.makeEnum("aiserver.v1.GrokBotEmailDirection", [
  { no: 0, name: "UNSPECIFIED" },
  { no: 1, name: "INBOUND" },
  { no: 2, name: "OUTBOUND" },
]) as { readonly UNSPECIFIED: 0; readonly INBOUND: 1; readonly OUTBOUND: 2 };

export type GrokBotEmailSearchMode = 0 | 1 | 2 | 3;
export const GrokBotEmailSearchMode = proto3.makeEnum("aiserver.v1.GrokBotEmailSearchMode", [
  { no: 0, name: "UNSPECIFIED" },
  { no: 1, name: "HYBRID" },
  { no: 2, name: "KEYWORD" },
  { no: 3, name: "SEMANTIC" },
]) as { readonly UNSPECIFIED: 0; readonly HYBRID: 1; readonly KEYWORD: 2; readonly SEMANTIC: 3 };

export type GrokBotEmailAddressAvailability = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const GrokBotEmailAddressAvailability = proto3.makeEnum("aiserver.v1.GrokBotEmailAddressAvailability", [
  { no: 0, name: "UNSPECIFIED" },
  { no: 1, name: "AVAILABLE" },
  { no: 2, name: "YOURS" },
  { no: 3, name: "TAKEN" },
  { no: 4, name: "INVALID" },
  { no: 5, name: "RESERVED" },
  { no: 6, name: "NOT_CONFIGURED" },
]) as { readonly UNSPECIFIED: 0; readonly AVAILABLE: 1; readonly YOURS: 2; readonly TAKEN: 3; readonly INVALID: 4; readonly RESERVED: 5; readonly NOT_CONFIGURED: 6 };

class _GrokBotEmailAddress extends Message<_GrokBotEmailAddress> {
  declare name: string;
  declare email: string;
  constructor(data?: PartialMessage<_GrokBotEmailAddress>) { super(); proto3.util.initPartial(data, this); }
}
export type GrokBotEmailAddress = _GrokBotEmailAddress;
export const GrokBotEmailAddress: MessageType<GrokBotEmailAddress> = proto3.makeMessageType("aiserver.v1.GrokBotEmailAddress", () => [
  { no: 1, name: "name", kind: "scalar", T: 9 },
  { no: 2, name: "email", kind: "scalar", T: 9 },
]) as unknown as MessageType<GrokBotEmailAddress>;

class _GrokBotEmailInbox extends Message<_GrokBotEmailInbox> {
  declare email: string;
  declare domain: string;
  declare createdAtMs: bigint;
  declare assigned: boolean;
  constructor(data?: PartialMessage<_GrokBotEmailInbox>) { super(); proto3.util.initPartial(data, this); }
}
export type GrokBotEmailInbox = _GrokBotEmailInbox;
export const GrokBotEmailInbox: MessageType<GrokBotEmailInbox> = proto3.makeMessageType("aiserver.v1.GrokBotEmailInbox", () => [
  { no: 1, name: "email", kind: "scalar", T: 9 },
  { no: 2, name: "domain", kind: "scalar", T: 9 },
  { no: 3, name: "created_at_ms", kind: "scalar", T: 3 },
  { no: 4, name: "assigned", kind: "scalar", T: 8 },
]) as unknown as MessageType<GrokBotEmailInbox>;

class _CreateGrokBotEmailInboxRequest extends Message<_CreateGrokBotEmailInboxRequest> {
  declare username: string;
  declare displayName: string;
  constructor(data?: PartialMessage<_CreateGrokBotEmailInboxRequest>) { super(); proto3.util.initPartial(data, this); }
}
export type CreateGrokBotEmailInboxRequest = _CreateGrokBotEmailInboxRequest;
export const CreateGrokBotEmailInboxRequest: MessageType<CreateGrokBotEmailInboxRequest> = proto3.makeMessageType("aiserver.v1.CreateGrokBotEmailInboxRequest", () => [
  { no: 1, name: "username", kind: "scalar", T: 9 },
  { no: 2, name: "display_name", kind: "scalar", T: 9 },
]) as unknown as MessageType<CreateGrokBotEmailInboxRequest>;

class _CreateGrokBotEmailInboxResponse extends Message<_CreateGrokBotEmailInboxResponse> {
  declare inbox?: GrokBotEmailInbox;
  constructor(data?: PartialMessage<_CreateGrokBotEmailInboxResponse>) { super(); proto3.util.initPartial(data, this); }
}
export type CreateGrokBotEmailInboxResponse = _CreateGrokBotEmailInboxResponse;
export const CreateGrokBotEmailInboxResponse: MessageType<CreateGrokBotEmailInboxResponse> = proto3.makeMessageType("aiserver.v1.CreateGrokBotEmailInboxResponse", () => [
  { no: 1, name: "inbox", kind: "message", T: GrokBotEmailInbox },
]) as unknown as MessageType<CreateGrokBotEmailInboxResponse>;

class _ListGrokBotEmailInboxesRequest extends Message<_ListGrokBotEmailInboxesRequest> {
  declare showsAssigned: boolean;
  constructor(data?: PartialMessage<_ListGrokBotEmailInboxesRequest>) { super(); proto3.util.initPartial(data, this); }
}
export type ListGrokBotEmailInboxesRequest = _ListGrokBotEmailInboxesRequest;
export const ListGrokBotEmailInboxesRequest: MessageType<ListGrokBotEmailInboxesRequest> = proto3.makeMessageType("aiserver.v1.ListGrokBotEmailInboxesRequest", () => [
  { no: 1, name: "shows_assigned", kind: "scalar", T: 8 },
]) as unknown as MessageType<ListGrokBotEmailInboxesRequest>;

class _ListGrokBotEmailInboxesResponse extends Message<_ListGrokBotEmailInboxesResponse> {
  declare inboxes: GrokBotEmailInbox[];
  constructor(data?: PartialMessage<_ListGrokBotEmailInboxesResponse>) { super(); proto3.util.initPartial(data, this); }
}
export type ListGrokBotEmailInboxesResponse = _ListGrokBotEmailInboxesResponse;
export const ListGrokBotEmailInboxesResponse: MessageType<ListGrokBotEmailInboxesResponse> = proto3.makeMessageType("aiserver.v1.ListGrokBotEmailInboxesResponse", () => [
  { no: 1, name: "inboxes", kind: "message", T: GrokBotEmailInbox, repeated: true },
]) as unknown as MessageType<ListGrokBotEmailInboxesResponse>;

class _DeleteGrokBotEmailInboxRequest extends Message<_DeleteGrokBotEmailInboxRequest> {
  declare email: string;
  constructor(data?: PartialMessage<_DeleteGrokBotEmailInboxRequest>) { super(); proto3.util.initPartial(data, this); }
}
export type DeleteGrokBotEmailInboxRequest = _DeleteGrokBotEmailInboxRequest;
export const DeleteGrokBotEmailInboxRequest: MessageType<DeleteGrokBotEmailInboxRequest> = proto3.makeMessageType("aiserver.v1.DeleteGrokBotEmailInboxRequest", () => [
  { no: 1, name: "email", kind: "scalar", T: 9 },
]) as unknown as MessageType<DeleteGrokBotEmailInboxRequest>;

class _DeleteGrokBotEmailInboxResponse extends Message<_DeleteGrokBotEmailInboxResponse> {
  constructor(data?: PartialMessage<_DeleteGrokBotEmailInboxResponse>) { super(); proto3.util.initPartial(data, this); }
}
export type DeleteGrokBotEmailInboxResponse = _DeleteGrokBotEmailInboxResponse;
export const DeleteGrokBotEmailInboxResponse: MessageType<DeleteGrokBotEmailInboxResponse> = proto3.makeMessageType("aiserver.v1.DeleteGrokBotEmailInboxResponse", () => []) as unknown as MessageType<DeleteGrokBotEmailInboxResponse>;

class _CheckGrokBotEmailAddressAvailabilityRequest extends Message<_CheckGrokBotEmailAddressAvailabilityRequest> {
  declare usernames: string[];
  constructor(data?: PartialMessage<_CheckGrokBotEmailAddressAvailabilityRequest>) { super(); proto3.util.initPartial(data, this); }
}
export type CheckGrokBotEmailAddressAvailabilityRequest = _CheckGrokBotEmailAddressAvailabilityRequest;
export const CheckGrokBotEmailAddressAvailabilityRequest: MessageType<CheckGrokBotEmailAddressAvailabilityRequest> = proto3.makeMessageType("aiserver.v1.CheckGrokBotEmailAddressAvailabilityRequest", () => [
  { no: 1, name: "usernames", kind: "scalar", T: 9, repeated: true },
]) as unknown as MessageType<CheckGrokBotEmailAddressAvailabilityRequest>;

class _GrokBotEmailAddressAvailabilityResult extends Message<_GrokBotEmailAddressAvailabilityResult> {
  declare username: string;
  declare email: string;
  declare availability: GrokBotEmailAddressAvailability;
  declare message: string;
  constructor(data?: PartialMessage<_GrokBotEmailAddressAvailabilityResult>) { super(); proto3.util.initPartial(data, this); }
}
export type GrokBotEmailAddressAvailabilityResult = _GrokBotEmailAddressAvailabilityResult;
export const GrokBotEmailAddressAvailabilityResult: MessageType<GrokBotEmailAddressAvailabilityResult> = proto3.makeMessageType("aiserver.v1.CheckGrokBotEmailAddressAvailabilityResponse.Result", () => [
  { no: 1, name: "username", kind: "scalar", T: 9 },
  { no: 2, name: "email", kind: "scalar", T: 9 },
  { no: 3, name: "availability", kind: "enum", T: proto3.getEnumType(GrokBotEmailAddressAvailability) },
  { no: 4, name: "message", kind: "scalar", T: 9 },
]) as unknown as MessageType<GrokBotEmailAddressAvailabilityResult>;

class _CheckGrokBotEmailAddressAvailabilityResponse extends Message<_CheckGrokBotEmailAddressAvailabilityResponse> {
  declare results: GrokBotEmailAddressAvailabilityResult[];
  constructor(data?: PartialMessage<_CheckGrokBotEmailAddressAvailabilityResponse>) { super(); proto3.util.initPartial(data, this); }
}
export type CheckGrokBotEmailAddressAvailabilityResponse = _CheckGrokBotEmailAddressAvailabilityResponse;
export const CheckGrokBotEmailAddressAvailabilityResponse: MessageType<CheckGrokBotEmailAddressAvailabilityResponse> = proto3.makeMessageType("aiserver.v1.CheckGrokBotEmailAddressAvailabilityResponse", () => [
  { no: 1, name: "results", kind: "message", T: GrokBotEmailAddressAvailabilityResult, repeated: true },
]) as unknown as MessageType<CheckGrokBotEmailAddressAvailabilityResponse>;

class _GrokBotEmailMatchingMessage extends Message<_GrokBotEmailMatchingMessage> {
  declare messageId: string;
  declare from?: GrokBotEmailAddress;
  declare occurredAtMs: bigint;
  declare direction: GrokBotEmailDirection;
  declare snippet?: string;
  declare unread: boolean;
  constructor(data?: PartialMessage<_GrokBotEmailMatchingMessage>) { super(); proto3.util.initPartial(data, this); }
}
export type GrokBotEmailMatchingMessage = _GrokBotEmailMatchingMessage;
export const GrokBotEmailMatchingMessage: MessageType<GrokBotEmailMatchingMessage> = proto3.makeMessageType("aiserver.v1.GrokBotEmailMatchingMessage", () => [
  { no: 1, name: "message_id", kind: "scalar", T: 9 },
  { no: 2, name: "from", kind: "message", T: GrokBotEmailAddress },
  { no: 3, name: "occurred_at_ms", kind: "scalar", T: 3 },
  { no: 4, name: "direction", kind: "enum", T: proto3.getEnumType(GrokBotEmailDirection) },
  { no: 5, name: "snippet", kind: "scalar", T: 9, opt: true },
  { no: 6, name: "unread", kind: "scalar", T: 8 },
]) as unknown as MessageType<GrokBotEmailMatchingMessage>;

class _GrokBotEmailThreadSummary extends Message<_GrokBotEmailThreadSummary> {
  declare threadId: string;
  declare subject: string;
  declare messageCount: number;
  declare lastMessageAtMs: bigint;
  declare participants: GrokBotEmailAddress[];
  declare matchingMessages: GrokBotEmailMatchingMessage[];
  declare unreadCount: number;
  constructor(data?: PartialMessage<_GrokBotEmailThreadSummary>) { super(); proto3.util.initPartial(data, this); }
}
export type GrokBotEmailThreadSummary = _GrokBotEmailThreadSummary;
export const GrokBotEmailThreadSummary: MessageType<GrokBotEmailThreadSummary> = proto3.makeMessageType("aiserver.v1.GrokBotEmailThreadSummary", () => [
  { no: 1, name: "thread_id", kind: "scalar", T: 9 },
  { no: 2, name: "subject", kind: "scalar", T: 9 },
  { no: 3, name: "message_count", kind: "scalar", T: 5 },
  { no: 4, name: "last_message_at_ms", kind: "scalar", T: 3 },
  { no: 5, name: "participants", kind: "message", T: GrokBotEmailAddress, repeated: true },
  { no: 6, name: "matching_messages", kind: "message", T: GrokBotEmailMatchingMessage, repeated: true },
  { no: 7, name: "unread_count", kind: "scalar", T: 5 },
]) as unknown as MessageType<GrokBotEmailThreadSummary>;

class _SearchGrokBotEmailThreadsRequest extends Message<_SearchGrokBotEmailThreadsRequest> {
  declare query: string;
  declare inboxEmail?: string;
  declare fromAddress?: string;
  declare afterMs?: bigint;
  declare beforeMs?: bigint;
  declare limit: number;
  declare mode: GrokBotEmailSearchMode;
  constructor(data?: PartialMessage<_SearchGrokBotEmailThreadsRequest>) { super(); proto3.util.initPartial(data, this); }
}
export type SearchGrokBotEmailThreadsRequest = _SearchGrokBotEmailThreadsRequest;
export const SearchGrokBotEmailThreadsRequest: MessageType<SearchGrokBotEmailThreadsRequest> = proto3.makeMessageType("aiserver.v1.SearchGrokBotEmailThreadsRequest", () => [
  { no: 1, name: "query", kind: "scalar", T: 9 },
  { no: 2, name: "inbox_email", kind: "scalar", T: 9, opt: true },
  { no: 3, name: "from_address", kind: "scalar", T: 9, opt: true },
  { no: 4, name: "after_ms", kind: "scalar", T: 3, opt: true },
  { no: 5, name: "before_ms", kind: "scalar", T: 3, opt: true },
  { no: 6, name: "limit", kind: "scalar", T: 5 },
  { no: 7, name: "mode", kind: "enum", T: proto3.getEnumType(GrokBotEmailSearchMode) },
]) as unknown as MessageType<SearchGrokBotEmailThreadsRequest>;

class _SearchGrokBotEmailThreadsResponse extends Message<_SearchGrokBotEmailThreadsResponse> {
  declare threads: GrokBotEmailThreadSummary[];
  constructor(data?: PartialMessage<_SearchGrokBotEmailThreadsResponse>) { super(); proto3.util.initPartial(data, this); }
}
export type SearchGrokBotEmailThreadsResponse = _SearchGrokBotEmailThreadsResponse;
export const SearchGrokBotEmailThreadsResponse: MessageType<SearchGrokBotEmailThreadsResponse> = proto3.makeMessageType("aiserver.v1.SearchGrokBotEmailThreadsResponse", () => [
  { no: 1, name: "threads", kind: "message", T: GrokBotEmailThreadSummary, repeated: true },
]) as unknown as MessageType<SearchGrokBotEmailThreadsResponse>;
