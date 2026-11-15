# Quota request ownership

Provider data modules own quota fetching and state construction. Numerical rules remain in their existing provider/domain helpers. Legacy configs and source configs run the same functions with different request dependencies.

- `createQuotaAdapters(session, store?)` captures an immutable source session. Constructing adapters performs no requests. Pass the source's `createQuotaStore()` instance to preserve file invalidation in nested Meta, Kimi and queued Devin reads.
- Every scoped request uses `session.management`, `createAuthFilesApi(session)` or `createApiCallApi(session)`. Dependencies are injected through `providers/dependencies.ts`; every provider config requires explicit dependencies; adapters are created only from a source session.
- Downloads, Blob text decoding, plugin discovery, optional subscription metadata, reset redemption, cooldown clearing and follow-up reads retain the captured source. Check currentness before dispatch and after asynchronous work. Optional-provider errors cannot convert a stale operation into a successful result at the adapter boundary.
- Each hub source session has exactly one quota store, `sourceQuotaStore(owner)` (`src/stores/sourceQuotaStores.ts`), read and written by Auth Files, the Quota page and Quota Management's reset panel; never create a page-private `createQuotaStore()`. It lives and dies with the session's `SourceOwner` (instance, session epoch and source generation), so closing a page keeps it and a replacement session starts empty. The plugin/Devin request cache is likewise per source. Never combine sources using a bare filename or auth index. The stores retain their existing local filename/index key semantics.
- A confirmed reset attempt, from any page, has the history server re-read that one account: Claude claims through the session's `operations.run`, Codex through the adapter's `resetQuota`, both calling `refreshPoolAccountAfterReset` (`src/features/quotaPool/accountSync.ts`), which posts the targeted `POST /v1/refresh` once per account at a time, again once about 20 s later in case the provider lags, and reloads any open Quota Management pool after each. Prox does not model what a reset gives back: the server re-reads the provider and recomputes points, forecast and reset counts from that reading (`tests/quotaResetRecompute.test.ts`). Pages do not post it themselves, and a Claude claim's own forced read goes into the shared store, so every page shows it.
- Claude and Codex accounts are served from prox-history (`GET /prox/accounts`,
  `src/stores/useServerAccountsStore.ts`, `src/features/quotaPool/serverQuota.ts`), not read on the
  hubs. The one routing rule (`servedByServer`): an account is served only when `/prox/inventory`
  answered with this session's key, its source instance is in that inventory, and its provider is
  claude or codex. Everything else stays hub-direct through the adapters above: the other six
  providers, an instance prox-history does not list, prox-history absent, or one that rejects the
  key (or whose accounts cannot be read). One poller for the app (about 30 s while the page is
  visible and on focus, `If-None-Match`, a 304 when unchanged) writes each served credential's
  reading into the source session's shared quota store with the server's observation time as its
  read time, and never over a newer hub-direct reading. A served account the server has not read
  yet shows as not loaded; it is not read on the hub. These pages hold no hub auto-poll for a served
  account: no reset-grant read on mount (the held resets come from the server reading), and the
  page-wide Refresh asks the server for one collection instead of reading each account.
- Refresh on a served account is `POST /prox/refresh {accountId}`; when the server's 20 s floor
  skipped it (or its 4 minute floor skipped the page-wide one) the card says "read N min ago, next
  read at HH:MM" (`QuotaFreshness`, the store's `nextReadAt`) instead of failing silently.
- Named exceptions, which stay hub-direct through the same shared store: (a) a disabled account's
  explicit Refresh on Auth Files does the live hub read (PR #57), since the server never reads a
  disabled account; (b) the reset-grant read when the claim dialog opens (`useClaudeResetGrants`
  with `server`), which needs the grants' ids. The post-claim targeted refresh above stays.
- Registry enumeration and header inventory refresh do not run quota providers, credential downloads, reset grants or inference. Quota refresh and xAI fallback remain explicit actions. Reset confirmation retains the session and cache generation captured when the confirmation opens.
- `QuotaCard` receives its scoped `adapter` prop. Its Claude reset hook receives `adapter.resetGrants`; the reset reader and ambiguous-operation journal are shared only within the captured session. Quota bodies perform no requests and need no ambient connection.
- Compatibility callers can omit dependencies. Source callers must not call the legacy configs, singleton reset journal or global quota store.

`tests/quotaSourceAdapters.test.ts` exercises synthetic A/B owners with overlapping identities, nested transport/key routing, stale actions and downloads, reset chains, metadata, passive enumeration and provider dependency imports. Existing provider tests protect numerical and legacy behavior. These tests do not establish live provider/plugin compatibility or browser interaction correctness.
