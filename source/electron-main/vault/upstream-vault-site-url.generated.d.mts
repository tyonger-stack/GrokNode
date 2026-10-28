// Hand-written types for the byte-extracted 0.78.1 PSL module (see the generated
// file's provenance header). Shapes mirror the official bindings exactly.
export interface UpstreamSuffixParseResult {
  domain: string | null;
  domainWithoutSuffix: string | null;
  hostname: string | null;
  isIcann: boolean | null;
  isIp: boolean | null;
  isPrivate: boolean | null;
  publicSuffix: string | null;
  subdomain: string | null;
}

export interface UpstreamSuffixOptions {
  readonly allowIcannDomains?: boolean;
  readonly allowPrivateDomains?: boolean;
  readonly detectIp?: boolean;
  readonly extractHostname?: boolean;
  readonly mixedInputs?: boolean;
  readonly validHosts?: readonly string[] | null;
  readonly validateHostname?: boolean;
}

export declare function siteHostname(site: string): string | null;
export declare function emptyParseResult(): UpstreamSuffixParseResult;
export declare function suffixLookup(
  hostname: string,
  options: Pick<UpstreamSuffixOptions, "allowIcannDomains" | "allowPrivateDomains">,
  result: UpstreamSuffixParseResult,
): UpstreamSuffixParseResult;
export declare function getDomain(input: string, options?: UpstreamSuffixOptions): string | null;
export declare function officialLoginDisplayDomain(site: string): string | null;
