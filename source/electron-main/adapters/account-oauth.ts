import type { ElectronProductionAdapterBindings } from "../production-adapters.js";
import type { ProductionAccountService, ProductionAccountStatus } from "../main-production-services.js";

const LOCAL_LOGGED_OUT_STATUS: ProductionAccountStatus = { kind: "logged-out" };
const LOCAL_ONLY_AUTH_ERROR = "Cursor cloud authentication is unavailable in the local-only build.";

interface LocalAuthService {
  getStatus(): Promise<ProductionAccountStatus>;
  subscribe(listener: (status: ProductionAccountStatus) => void): () => void;
  getValidAccessToken(options?: { readonly backendUrl?: string }): Promise<string>;
  peekAccessToken(): Promise<string | null>;
  revokeForAccountRefusal(): Promise<{ readonly kind: "completed"; readonly status: ProductionAccountStatus }>;
  login(): Promise<ProductionAccountStatus>;
  cancelLogin(): Promise<ProductionAccountStatus>;
  logout(): Promise<ProductionAccountStatus>;
  updateDisplayName(name: string): Promise<ProductionAccountStatus>;
}

function createLocalAuthService(): LocalAuthService {
  const listeners = new Set<(status: ProductionAccountStatus) => void>();
  const status = (): ProductionAccountStatus => LOCAL_LOGGED_OUT_STATUS;
  const notify = (): ProductionAccountStatus => {
    const next = status();
    for (const listener of listeners) listener(next);
    return next;
  };
  return {
    getStatus: async () => status(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getValidAccessToken: async () => { throw new Error(LOCAL_ONLY_AUTH_ERROR); },
    peekAccessToken: async () => null,
    revokeForAccountRefusal: async () => ({ kind: "completed", status: status() }),
    login: async () => notify(),
    cancelLogin: async () => notify(),
    logout: async () => notify(),
    updateDisplayName: async () => notify(),
  };
}

export function createProductionAccountOAuthAdapter(): ElectronProductionAdapterBindings["accountOAuth"] {
  return {
    async create(): Promise<ProductionAccountService> {
      const auth = createLocalAuthService();
      const subscriptions = new Set<() => void>();
      let disposed = false;
      return {
        getStatus: () => auth.getStatus(),
        subscribe(listener) {
          if (disposed) throw new Error("Local account service is disposed.");
          const unsubscribe = auth.subscribe(() => listener());
          subscriptions.add(unsubscribe);
          return () => { if (subscriptions.delete(unsubscribe)) unsubscribe(); };
        },
        currentAuthStatusFreshness: () => 0,
        deliverCursorAuthStatus: () => {},
        revokeForAccountRefusal: () => auth.revokeForAccountRefusal(),
        getAuthService: async () => auth,
        async dispose() {
          if (disposed) return;
          disposed = true;
          for (const unsubscribe of [...subscriptions]) unsubscribe();
          subscriptions.clear();
        },
      };
    },
  };
}

export function createElectronProductionAccountOAuthBinding(): ElectronProductionAdapterBindings["accountOAuth"] {
  return createProductionAccountOAuthAdapter();
}
