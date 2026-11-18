# Supplyo test deployment

Deployed on 10 November 2026 to Hoster VPS `77.87.212.236`.

- Public site: https://77-87-212-236.sslip.io/#welcome
- Registration: https://77-87-212-236.sslip.io/#register
- Current release: `/opt/supplyo/current` → `/opt/supplyo/releases/20261110-employees-v1`
- Runtime: Node 24, systemd unit `supplyo`, unprivileged OS user `supplyo`.
- Database: PostgreSQL 14, database and role `supplyo`, local Unix socket with peer authentication. No database port is exposed externally.
- API keys: encrypted using `/var/lib/supplyo/encryption.key`. Preserve this file when restoring a database.
- Nginx terminates HTTPS and proxies to `127.0.0.1:3040`. Certbot renews the certificate automatically.
- Test subscriptions are enabled with `TEST_PURCHASES=1`. They do not charge money. WB requests and fulfillment actions use the connected seller's real API.

## Checks performed

Local server typecheck and all five server tests passed. The assembly test also passed against an isolated PostgreSQL database on the VPS using a mocked WB transport. External HTTPS checks passed for registration, secure session cookies, subscription gating, test activation, login/logout, and persistence after service restart. The landing page and registration form rendered in a browser. No real seller credentials were copied from the local installation.

## Operations

```sh
systemctl status supplyo
journalctl -u supplyo -n 100 --no-pager
systemctl restart supplyo
curl -fsS http://127.0.0.1:3040/api/health
```

Configuration is in `/etc/systemd/system/supplyo.service` and `/etc/nginx/sites-available/supplyo`. Keep `PUBLIC_ORIGIN` equal to the public HTTPS origin; changing domains requires updating it and restarting the service.

The server supports `DATABASE_URL` for PostgreSQL. Without it, local development continues to use PGlite in `DATA_DIR/postgres`.

Build frontend locally with `npm run build:live`. Build the server with:

```sh
node node_modules/esbuild/bin/esbuild server/index.ts --bundle --platform=node --packages=external --format=esm --outfile=.deploy/server.mjs
```

Upload `dist`, the compiled `server.mjs`, and a runtime package manifest with `fastify`, `zod`, `pg`, and `@electric-sql/pglite` into a new release directory. Install runtime dependencies, update the `current` symlink, restart and check health. Do not upload `.local-data`, `.public-test-data`, `.deploy/acceptance.json`, API-key files, or local environment secrets.

## Backups

`supplyo-backup.timer` runs daily at 04:15 Europe/Moscow and keeps 14 days of archives in `/var/backups/supplyo`, readable only by root. Each archive contains a consistent `pg_dump -Fc` and the encryption key. Run an immediate backup with `systemctl start supplyo-backup.service`.

The initial archive was also downloaded to the ignored local `.deploy/backups` directory. Automatic replication to a second server is not configured.

For recovery, stop Supplyo, extract the archive into a protected directory, restore `database.dump` using `pg_restore` to a fresh database owned by `supplyo`, restore the encryption key with owner `supplyo` and mode `0600`, then restart and verify health. Do not overwrite an existing live database without retaining a backup first.

## Warehouse and accounting update

The account menu now exposes warehouses/staff and accounting for active subscriptions. Data is saved in owner-scoped PostgreSQL workspace documents with optimistic versions, and attachments in owner-scoped bytea records (5 MiB per file, 100 MiB per account). Nginx accepts up to 6 MiB request bodies. The frontend loads these modules lazily. Blank duplicate cabinet selectors were removed for accounts without stores.

Validation: five server integration tests, frontend build and server typecheck passed. Public HTTPS checks verified warehouse and income persistence in a separate acceptance account. Browser verification showed the new menu, warehouse card and employee dialog. No real seller orders were changed.

Employee access is now enforced by the employee update described below. The stock API/module is still unavailable in the live interface.

## Store connection without a subscription

The prepared update permits authenticated accounts to add their own encrypted WB API credentials without a subscription. A connection job verifies the key and retrieves the seller name. Unpaid accounts do not request or expose orders, start background order synchronization, or gain access to WMS/workspace endpoints. Activating a subscription starts synchronization for the already connected store. Active plan cabinet limits continue to apply.

Validation: all six server integration tests passed, including unpaid connection, encrypted storage, blocked order access and synchronization after activation. Server typecheck and the live frontend build passed. Published on 10 November 2026 after a database backup; the service health check passed. The previous release remains available for rollback at `/opt/supplyo/releases/20261110-011314-workspace`.

## Client-to-fulfillment warehouse access

The store owner opens **Settings → Fulfillment access**, chooses their verified WB store and one of its seller warehouses, then generates a single-use code valid for 24 hours. This does not require the owner's subscription. Only the digest is stored; the full code is returned once. Creating a replacement code invalidates pending codes for that store/warehouse, without revoking accepted connections.

A fulfillment account with an active subscription opens **Settings → Clients** and redeems the code. The shared cabinet counts toward its plan's cabinet limit; different warehouse grants for the same cabinet count once. Redemption and connection capacity are transactionally serialized. The recipient never receives the owner's API credential.

Delegated store route IDs are grant IDs. Orders, warehouses, supplies, scans, KIZ checks, printing acknowledgements and delivery mutations resolve the grant on the server and restrict access to its warehouse. Subscription expiry or explicit revocation removes delegated access. An unpaid store owner's orders are synchronized when an active paid fulfillment has an accepted grant. The owner can revoke access; the recipient can disconnect it. Revoked grants remain in owner history.

Validation: seven server integration tests and server typecheck passed, as did the live frontend build. The delegation integration test covers concurrent redemption, expiry/replay, plan limits, unpaid owners and recipients, warehouse-scoped reads and mutations, and revocation. Browser checks used isolated synthetic accounts and mocked WB data; no seller orders were changed.

Published on 10 November 2026 at `/opt/supplyo/releases/20261110-client-delegation-v1` after a database backup. Public HTTPS checks verified health, authenticated incoming/outgoing access endpoints, unauthenticated rejection, and the new frontend assets. The prior release `/opt/supplyo/releases/20261110-store-access-v2` remains available for rollback.

## Employee warehouse access, existing supplies and printing settings

An administrator adds the employee's registered email and permissions to a physical warehouse. The employee signs in with that same email; a personal subscription is not required while the employer's subscription remains active. This does not send an invitation email or create an employee account automatically. Membership, current permissions, active employer subscription and warehouse bindings are resolved again on every protected request. Changes are reflected in the interface by polling.

Owners bind marketplace cabinets/warehouses through **Cabinets of the warehouse** on the warehouse card. Legacy documents are automatically mapped only when exactly one physical warehouse and one marketplace warehouse scope exist; ambiguous mappings remain inaccessible until configured. Employee responses contain scoped cabinet identifiers and safe metadata, never API credentials. Reads require view rights, assembly actions require assembly rights, supply mutations require supply rights, and warehouse/staff editing requires management rights. Employees cannot edit their own rights, expand bindings or grant permissions they lack. The employer's accounting and other warehouses are excluded from employee workspace responses.

New orders now retain both **Add to supply** and **Create supply**. Adding uses an existing open supply for the same cabinet and warehouse, with a chooser when several match. Server validation checks fresh new-order membership, warehouse and delivery compatibility, duplicates and closed supplies. Existing assembly results remain intact. Printer discovery, selection and agent download are in **Settings → Label printing**; assembly uses the saved local printer selection.

Validation: eight server integration tests passed across the full run and the corrected targeted run. Typecheck and live production build passed. Tests cover employee access before/after registration, permission changes, employer expiry, membership removal, delegated client access, isolation, existing supply additions and preserved assembly state. After deployment, the actual employee browser session loaded its assigned cabinet, new orders and existing assembly supply without a personal subscription. No real WB mutations or printing were performed during verification.

Published after a fresh database backup at `/opt/supplyo/releases/20261110-employees-v1`; health passed after restart. Rollback release: `/opt/supplyo/releases/20261110-client-delegation-v1`.

## Assembly statuses and delivery destination

Assembly displays colored status badges. Once every order is ready, the footer offers SC/PVZ selection, a required box count for PVZ, and a delivery confirmation. The server validates the destination/count, reconciles existing WB transport boxes before creating missing boxes, and records delivery metadata. Retries do not recreate boxes already present in WB.

Validation: live frontend build and server typecheck passed; fulfillment, employee and delegation integration tests passed (3 tests). Browser verification used an isolated in-memory database and mocked WB responses, including colored statuses, the PVZ count field and confirmation/cancellation. No real supply was delivered or printed.

Published on 10 November 2026 at `/opt/supplyo/releases/20261110-delivery-ui-v1` after backup `supplyo-20261110-112115.tar.gz`. The service is active and local/public HTTPS health checks passed. Public frontend JavaScript and CSS checksums match the tested local build. Rollback release: `/opt/supplyo/releases/20261110-employees-v1`. No real WB supply was delivered or printed during deployment verification.

## Shipping labels after delivery

Delivery now fetches WB supply labels for SC or transport-box labels for PVZ and sends them to the saved local print agent. Closed supplies expose a separate print action, so failed printing can be retried without repeating delivery. Label files are validated as PNG and cached separately from supply-list responses. Retries reuse the print job identifier; explicit reprints require confirmation and create a fresh identifier. Warehouse and employee supply permissions also apply to label requests and acknowledgements.

Validation: all eight server integration tests, server typecheck and live production build passed. An isolated browser scenario verified delivery, a simulated agent failure, retry with the same print job and a confirmed reprint with a new job. No real WB supply or physical printer was used.

Published on 10 November 2026 at `/opt/supplyo/releases/20261110-shipping-labels-v1` after backup `supplyo-20261110-114317.tar.gz`. Local API, Nginx HTTPS and external public HTTPS health checks passed. Public entry JavaScript, CSS and HTML checksums match the tested local build. The shipping-label endpoint rejects unauthenticated requests. Rollback release: `/opt/supplyo/releases/20261110-delivery-ui-v1`. No real WB supply was delivered or physical label printed during deployment verification.

## Store-owner dashboard

The logo opens Overview regardless of the owner's subscription. This read-only dashboard lists only owned marketplace warehouses with accepted, non-revoked grants to fulfillment accounts whose subscriptions remain active. Pending codes and unrelated warehouses are excluded. It reads cached new orders and warehouse-scoped assembly/ready/delivery counts; loading the dashboard makes no WB requests and does not unlock protected WMS actions. An empty dashboard contains a neutral message without invitations or access-grant buttons.

Validation: all eight server integration tests, server typecheck and live build passed. Delegation tests cover unpaid dashboard access, pending/accepted/revoked/expired grants, tenant isolation and warehouse-scoped counters. Isolated browser fixtures verified logo navigation from stores and profile, disabled WMS navigation, empty state without calls to action and the narrow-screen layout. No real orders or printers were changed.

Published on 10 November 2026 at `/opt/supplyo/releases/20261110-client-dashboard-v1` after backup `supplyo-20261110-120036.tar.gz`. The service and public HTTPS health check passed; public HTML, entry assets and dashboard chunks match the tested build. The dashboard API rejects unauthenticated requests. Rollback release: `/opt/supplyo/releases/20261110-shipping-labels-v1`.

## Fulfillment and employee dashboards

Overview now includes incoming client warehouse grants for fulfillment accounts with active subscriptions, and known warehouses of their own stores. Employees see only assigned warehouse scopes with view permission. Unpaid store owners continue to see only their warehouses connected to an active fulfillment account. Revocation and subscription expiry remove the corresponding access. Counters remain warehouse-scoped and use saved data without additional WB requests. The seller warehouse directory is persisted when the existing directory request runs, allowing warehouses without orders to appear too.

Validation: server typecheck, all eight integration tests and the live production build passed. Tests cover incoming grants, own warehouses with and without orders, employee isolation, revocation and no extra WB requests. Browser fixtures verified logo navigation, paid and unpaid dashboards, neutral empty states and narrow-screen layout. No real orders or printers were changed.

Published on 10 November 2026 at `/opt/supplyo/releases/20261110-fulfillment-dashboard-v2` after backup `supplyo-20261110-121337.tar.gz`. Service health and public HTTPS passed; public HTML, entry assets and dashboard chunks match the tested build. Unauthenticated dashboard requests are rejected. Rollback release: `/opt/supplyo/releases/20261110-client-dashboard-v1`.

## Dashboard fulfillment names

Only the store owner's dashboard shows the fulfillment label. Its names come from the fulfillment's physical warehouse documents, matched by delegated cabinet route and WB warehouse ID. Legacy mapping is permitted only for one physical warehouse, one incoming scope and no owned stores. Ambiguous/unconfigured names remain absent; registered users' names are never substituted. Incoming fulfillment and employee cards do not label themselves as contractors, and whitespace-only labels are hidden.

Validation: server typecheck, all eight integration tests and the live build passed. Tests cover the physical name, exact bindings, ambiguous legacy documents and recipient isolation. Browser fixtures verified client names, absent fulfillment labels (including whitespace-only values), navigation and narrow screens.

Published on 10 November 2026 at `/opt/supplyo/releases/20261110-dashboard-labels-v1` after backup `supplyo-20261110-123216.tar.gz`. Local/public HTTPS health checks passed, published HTML and JavaScript checksums match the tested build, and unauthenticated dashboard requests return 401. Rollback release: `/opt/supplyo/releases/20261110-fulfillment-dashboard-v2`. No real orders or printers were changed.


## Auto barcode printing

Assembly now offers an Auto switch, off by default. One barcode scan in Auto mode prepares all pending, unprinted orders for that barcode in the selected supply whose marking requirements explicitly confirm that no KIZ is required. KIZ and unknown requirements do not enter the batch. Missing WB stickers are requested in batches of at most 100, keyed by order ID. The server saves an immutable batch manifest with a stable job ID before returning it. After every sticker is prepared, the local agent receives one /print-batch job containing all labels, loads all images and submits one Windows PrintDocument. A single atomic, idempotent acknowledgement marks the batch ready. Retries reuse the same manifest and job ID; the agent deduplicates completed jobs and rejects uncertain started jobs for manual verification. Queue acceptance does not prove physical paper output.

Validation: server typecheck, all nine integration tests and the live production build passed. Isolated browser tests covered single/auto mode, duplicate Enter, printer failure and resume, KIZ, unknown requirements and narrow screens. No physical printer or real WB mutation was used during verification.

Published on 10 November 2026 at `/opt/supplyo/releases/20261110-auto-print-v1` after backup `supplyo-20261110-134215.tar.gz`. Local and public HTTPS health checks passed. Published HTML, entry JavaScript, CSS, fulfillment and dashboard chunks match the tested local build. The auto-print endpoint returns 401 for unauthenticated requests with the required Origin/client headers; requests without these headers are rejected with 403. Rollback release: `/opt/supplyo/releases/20261110-dashboard-labels-v1`.

## Batch printing, toasts and employee access (10 November 2026)

The legacy single-physical-warehouse fallback no longer depends on there being exactly one connected client. All active delegated scopes remain available to assigned employees after another client is connected; adding an own store does not grant it automatically. Explicit bindings, including an empty list, override the fallback. Multi-warehouse organizations require explicit assignments. Revocation, subscription expiry and per-action rights remain checked on every request. The bindings editor preselects the same delegated defaults, and dashboard fulfillment labels use the same warehouse mapping.

Bottom-right notifications now cover data refresh, preparation, printing, completion and errors. The editable site map was updated in chapters 07, 10 and 13 (local draw.io, HTML viewer and ZIP).

Validation: server typecheck, 10 integration tests, live production build and isolated browser tests passed. Cases include second-client access preservation, own-store exclusion, per-warehouse isolation, individual revocation, explicit empty bindings, ambiguous multi-warehouse denial, one print job for all labels, duplicate Enter and acknowledgement retry without duplicate spooling. No real WB orders or physical printing were used for these tests.

Published at `/opt/supplyo/releases/20261110-auto-batch-v1` after backup `/var/backups/supplyo/supplyo-20261110-142322.tar.gz`. Local/public HTTPS health checks passed and 29 published files match the tested build. Rollback release: `/opt/supplyo/releases/20261110-auto-print-v1`. A read-only check using the deployed employee resolver and production database confirmed two accessible, warehouse-scoped client cabinets and two dashboard scopes for the existing employee, with no credentials exposed.


## KIZ detection in optional metadata (10 November 2026)

WB order 6240319070 exposed a missed marking requirement: `requiredMeta: []`, `optionalMeta: ["sgtin", "customs_declaration"]`. Both lists are now preserved and checked by one shared rule in the UI and server. Unknown requirements fail closed in single and Auto modes. SGTIN orders cannot enter Auto, bypass validation through a print acknowledgement, or be delivered with a forged/stale Ready status. Only positive WB SGTIN decisions count as approval; `filled` and `optional` keep the order pending validation.

Startup repairs false Ready statuses in open marked supplies while retaining the saved labels and print receipts. No historical closed supply is rewritten. Retry acknowledgements preserve an existing positive decision. Editable map chapters 10 and 11 explain both metadata fields and the independent printing/validation gates.

Validation: server typecheck, 10 integration tests with additional optionalMeta, repair, direct-ack, unverified-decision and idempotent-ack regressions; live build; isolated browser scan verifies optionalMeta SGTIN opens KIZ input without printing or entering Auto. Map validation: 20 chapters, 237 nodes, 242 connections, 21 pages, no errors.

Published at `/opt/supplyo/releases/20261110-kiz-optional-v1` after backup `/var/backups/supplyo/supplyo-20261110-145415.tar.gz`. Local and public health checks passed; 29 published files match the tested build. Rollback: `/opt/supplyo/releases/20261110-auto-batch-v1`. No WB mutation or physical printing was performed during verification.


## Scanner layout, KIZ separators and intentional reprints (10 November 2026)

Product and KIZ scan inputs translate physical Russian keyboard keys to their US English equivalents, including Shift punctuation. Pasted Russian scan strings are normalized too. Search and ordinary text fields keep their original language. F8 / Ctrl+] emit GS. For validated GS1 91/92/93 structures, missing boundary separators (or the phone display's single boundary spaces) become U+001D before saving and submitting to WB. Serial numbers and cryptographic payloads are preserved. This fixes formatting, not an adverse WB status decision.

Each deliberate individual print now receives a fresh random job ID. While a print intent is pending, the browser retains its ID, files and printer through an agent/acknowledgement retry; the same KIZ is not resubmitted. Only successful acknowledgement clears it. Agent duplicate responses are reported as an already accepted queue job, not a newly printed sticker. Physical paper output still requires printer-side verification.

Validation: 12 server tests and server typecheck; live production build; isolated Chromium tests using the exact Russian/English KIZ examples, physical key events, paste, F8, canonical API body, deliberate reprinting, individual acknowledgement retry, Auto packet retry, unknown metadata and responsive layout. No WB mutation or physical print during tests. Editable map chapters 10, 11 and 13 regenerated: 20 chapters, 237 nodes, 242 edges, 21 pages, no validation errors.

Published at `/opt/supplyo/releases/20261110-scanner-print-v1` after backup `/var/backups/supplyo/supplyo-20261110-152805.tar.gz`. Local/public HTTPS health and published asset hashes verified (29 files). Rollback: `/opt/supplyo/releases/20261110-kiz-optional-v1`.

## Warehouse inventory (10 November 2026)

The live Stocks navigation now opens a lazy-loaded inventory table backed by the server. WB Content supplies product cards, sizes and all barcodes; Marketplace supplies warehouse quantities by chrtId in batches of at most 1000. Loading is queued and uses the existing per-token request scheduler. The UI reads a persisted, paginated snapshot; failed or incomplete requests preserve the previous successful snapshot. Values absent from WB are recorded as unknown rather than zero. Manual refresh has a cooldown, and automatic snapshot refresh is requested after five minutes while the view is used.

Warehouse grants and assigned employee warehouse scopes apply to reads, edits and CSV exports. Viewing requires paid WMS access or an authorized employee assignment; editing additionally requires the stocks permission. Cell and address remain local placement data. Quantity edits update WB and read back the result before publishing it locally. Conflicting/stale edits are rejected. Whole-warehouse totals are independent of search and availability filters. No real inventory quantity was changed during verification.

Validation: server typecheck, all 13 server tests and the production live build passed. Inventory tests cover card pagination, stock batching, alternate barcode search, unknown quantities, placement persistence, quantity verification, version conflicts, 429 recovery, delegated warehouse isolation, employee permissions, CSV and revocation. Isolated Chromium checks cover navigation, inline editing without size changes, whole-row hover and narrow viewport containment. Editable site-map chapter 14 was regenerated with no validation errors (20 chapters, 237 nodes, 242 edges, 21 pages).

Published at `/opt/supplyo/releases/20261110-stocks-v1` after backup `/var/backups/supplyo/supplyo-20261110-164004.tar.gz`. All 33 uploaded files passed checksum verification. Local/public HTTPS health and public HTML/entry/inventory JavaScript hashes passed after activation. Rollback: `/opt/supplyo/releases/20261110-scanner-print-v1`. Initial real warehouse synchronization begins when the authorized user opens Stocks; the browser verification used fixture data.

## Assembly placement from inventory (10 November 2026)

Imported 352 exact barcode/nmID matches from the user's location matrix into the Gagarin cabinet, warehouse 1937111. A database backup and per-row backup table were created; amounts and barcodes were verified unchanged. Four source variants are absent from the cached catalog; source row 341 lacks identity. These five rows were not guessed.

Assembly now reads cell/address from inventory by the same cabinet, WB warehouse and any matching barcode. Multiple matching variants return no placement. Multiline locations are preserved and searchable. Added explicit placement columns only in Assembly; New orders remains unchanged as explicitly requested. Site-map chapter 10 and editable exports updated.

Validation: 13 server tests passed, followed by the updated targeted inventory/assembly test after excluding New orders changes; server typecheck and live build passed. Isolated browser checks verified columns, multiline placement, missing values, search, narrow viewport containment and unchanged New orders. Read-only production lookup for order 6241195277 resolves cell Г77-54 and address B-7-4. No real order or print mutations were made.

Published at /opt/supplyo/releases/20261110-assembly-placement-v1 after backup /var/backups/supplyo/supplyo-20261110-170852.tar.gz. All 33 uploaded files verified; local/public HTTPS health and public HTML/JavaScript/CSS checksums passed. Rollback: /opt/supplyo/releases/20261110-stocks-v1.

## Assembly address ordering (10 November 2026)

Assembly rows are sorted by warehouse address with numeric segments (A-1-2 precedes A-1-10). Visually equivalent Cyrillic/Latin address letters share ordering. Multiple addresses use the earliest sorted address; rows without placement appear last. Filtering preserves this ordering. New orders unchanged. Site-map chapter 10 and editable exports regenerated without validation errors.

Validation: live typecheck/build, natural-order checks (numeric parts, Cyrillic/Latin, multiple/empty addresses), isolated browser checks with reversed input order, placement rendering, search and responsive containment passed. Published /opt/supplyo/releases/20261110-assembly-address-sort-v1 after backup /var/backups/supplyo/supplyo-20261110-171355.tar.gz. All 33 uploaded files verified; local/public health and public HTML/JS/CSS checksums passed. Rollback: /opt/supplyo/releases/20261110-assembly-placement-v1. No inventory/order mutations.

## Restore navigation after reload (10 November 2026)

Removed the unconditional employee redirect to New orders when a valid saved navigation state exists. Per-account sessionStorage preserves section, selected cabinet and managed team within a browser tab. Only currently returned cabinets and authorized management teams can be restored. Assembly also preserves the selected supply per account/cabinet; its server-returned open supply list validates it and supplies a fallback. Storage failures do not block navigation. Print auto-mode and delivery confirmation are not restored or triggered.

Validation: live TypeScript/build passed. Isolated employee-browser scenario selects a non-first supply, reloads and verifies Assembly and that exact supply; New orders also remains selected after another reload. Placement/search/responsive checks passed. Site map chapter 10 and exports regenerated without validation errors.

Published /opt/supplyo/releases/20261110-navigation-restore-v1 after backup /var/backups/supplyo/supplyo-20261110-171839.tar.gz. All 33 uploaded files verified; local/public health and public HTML/JS/CSS hashes passed. Rollback /opt/supplyo/releases/20261110-assembly-address-sort-v1. No business-data mutations.

## Shared pending KIZ checks and refresh queue feedback (10 November 2026)

KIZ validation now gathers only non-terminal submitted codes from open supplies in the real cabinet and requests WB metadata in sequential batches of at most 100. All authorized grant/employee routes resolve that cabinet before joining a single in-flight check. A database row lock also serializes separate checker instances; the per-cabinet cooldown is persisted for 15 seconds after a cycle. WB errors retain pending state and impose at least 60 seconds of backoff (including Retry-After). Already approved/rejected codes are excluded until a new scan resets the decision. A KIZ revision prevents an old response approving a rescan of the same code. Updates use current print state, validate the response and requested order IDs, and do not rewrite closed supplies. The browser does not overlap its own polls. No client credentials or unscoped results are returned.

The general New orders refresh still has its existing 60-second spacing. Queue waiting now displays the next attempt time; active retrieval and failures have distinct labels/toasts. Read-only production audit found Gagarin ready at 17:27:52 MSK, so the screenshot was not evidence of an ongoing hung request.

Validation: all 14 server tests, server typecheck, live build and isolated browser checks passed. Dedicated regressions cover 150 orders split 100+50, simultaneous owner/two employees across supplies, authorization before shared work, terminal/closed/unscanned exclusion, print gate, persisted cooldown across checker recreation, 429/120-second backoff, missing WB results and stale same-code rescan. Browser verifies queue timing text and existing navigation/placement behavior. Map chapters 09/11 and exports regenerated without validation errors. No real WB mutation or physical print used in verification.

Published /opt/supplyo/releases/20261110-kiz-shared-queue-v1 after backup /var/backups/supplyo/supplyo-20261110-173129.tar.gz. All 33 uploaded files verified; local/public HTTPS health and public HTML/JS/CSS hashes passed. Rollback /opt/supplyo/releases/20261110-navigation-restore-v1.

## Immediate manual refresh and silent background sync (10 November 2026)

Manual refresh bypasses the ordinary one-minute next_sync interval and expedites an existing queued job; active jobs remain deduplicated. Actual WB 429 backoff is persisted separately in stores.api_retry_after and remains enforced on manual refresh and restart. Existing 429 pauses are migrated. New-order requests use the common per-token WB scheduler rather than treating a local spacing interval as an upstream 429. Successful background loads schedule the next run 60 seconds after completion.

Background syncing/queued states no longer replace the header's last successful update time or create progress toasts. Explicit manual refresh retains normal progress/completion/error feedback without minute-wait text; real upstream errors remain visible. Site-map chapter 09 and editable exports updated.

Validation: all 14 server tests, server typecheck, live build and isolated browser checks passed. Tests verify manual refresh before the minute elapses, deduplication, background spacing, cached data on failure and inability to bypass real 429 with the button. Browser confirms quiet queued background state, no automatic toasts and existing navigation/assembly placement behavior.

Published /opt/supplyo/releases/20261110-manual-refresh-v1 after backup /var/backups/supplyo/supplyo-20261110-173746.tar.gz. All 33 uploaded files verified; local/public HTTPS health and public HTML/JS/CSS hashes passed. Rollback /opt/supplyo/releases/20261110-kiz-shared-queue-v1. No real WB order/stock mutation or printing used for verification.

## Dashboard supply count and assembly column order (10 November 2026)

Overview now shows Quantity of supplies instead of shipped order count. The counter includes open and closed supplies once per supply in the same cabinet/warehouse, including empty supplies with an explicit warehouse. Legacy warehouse-less supplies count only when all their saved orders identify the same warehouse. Existing access scoping remains unchanged. Assembly now orders placement columns Address then Cell; address sorting unchanged. Site-map chapters 08/10 and editable exports updated.

Validation: server typecheck, targeted access/dashboard integration test, live build and isolated dashboard/assembly browser checks passed (counter values, label, column values/order, mobile containment). Published /opt/supplyo/releases/20261110-dashboard-supplies-v1 after backup /var/backups/supplyo/supplyo-20261110-225434.tar.gz. All 33 uploaded files and local/public health plus public asset hashes verified. Rollback /opt/supplyo/releases/20261110-manual-refresh-v1.

## Notification close button on the right (10 November 2026)

Moved the existing notification close control to the top-right edge, preserving notification behavior and styles. Live build and isolated browser geometry/dismissal checks passed; screenshot visually verified. Published /opt/supplyo/releases/20261110-toast-close-right-v1 after backup /var/backups/supplyo/supplyo-20261110-225650.tar.gz. All 33 files verified, local/public HTTPS health and public HTML/JS/CSS hashes passed. Includes the preceding dashboard supply counter and Address/Cell ordering. Rollback /opt/supplyo/releases/20261110-dashboard-supplies-v1.

## Rename Cell to Code throughout product UI (10 November 2026)

Renamed the user-facing Cell concept to Code in live Assembly/Stocks, editable field labels, search placeholders, staff stock permissions, CSV exports, landing previews/features and the legacy React prototype. Internal cell fields and existing values remain unchanged. Active site-map wording and editable exports updated; historical deployment entries retained.

Validation: no old Russian cell terminology remains in src/server/public runtime sources; server typecheck, live build, assembly browser column/value/search/responsive checks and map validation passed. Published /opt/supplyo/releases/20261110-code-label-v1 after backup /var/backups/supplyo/supplyo-20261110-230403.tar.gz. All 33 files verified, local/public health and public HTML/JS/CSS hashes passed. Rollback /opt/supplyo/releases/20261110-toast-close-right-v1. No business-data changes.

## Replace brand assets from user-supplied final variants (10 November 2026)

Replaced public/brand-logo.png with the exact supply-identical-p.png and public/brand-mark.png with letter-s.png from the user's last-two-variants directory. Full logo references in landing/auth/live/prototype use cache-versioned URLs. Collapsed live sidebar now uses the supplied S image instead of a text glyph, with a 22px image height. Original files backed up locally under this chat's work/brand-before. Source artwork unchanged.

Validation: live build and isolated browser DOM/image checks passed (full image 2138px natural width, S 295px, collapsed sidebar 76px, mark 22px high, logo dashboard navigation). Published /opt/supplyo/releases/20261110-brand-v2 after backup /var/backups/supplyo/supplyo-20261110-231448.tar.gz. All 33 uploaded files verified; public full-logo/mark bytes, HTML/JS/CSS hashes and local/public health passed. Rollback /opt/supplyo/releases/20261110-code-label-v1. No business-data changes.

## supply brand and stable animated sidebar (10 November 2026)

The product display name is now supply. Updated visible copy/ARIA/alt text in landing, auth, live shell and prototype, default newly created supply names, browser title (supply — WMS), favicon using supplied S, print-agent README and its downloadable ZIP, server startup display text and active site map. Existing storage/session/header/print-agent protocol identifiers stay compatible so saved data and installed agents continue working; historical records and operational paths were not renamed.

Live sidebar now uses one permanently mounted full wordmark. Its image position, width and height remain fixed while a clip smoothly hides the right-hand letters, leaving the original S. Grid width and edge toggle interpolate over 280ms. Navigation labels fade, icons stay anchored, and collapsed slots cannot overflow the sidebar. Reduced-motion preference disables animation. Prototype logo uses equivalent clipping rather than swapping differently sized images.

Validation: server typecheck, live build and isolated Chromium checks passed. Frame sampling verifies stable image x/y/width/height and DOM identity throughout close/open, intermediate sidebar widths, final S clip, no overflowing navigation slots, reduced-motion behavior and logo dashboard navigation. Landing/login/register checked for supply title and absence of old display names. Expanded/collapsed screenshots inspected; site map regenerated without validation errors. No data mutations.

Published /opt/supplyo/releases/20261110-supply-rebrand-v2 after backup /var/backups/supplyo/supplyo-20261110-232149.tar.gz. All 33 files verified; public wordmark/S image bytes, HTML/JS/CSS hashes and local/public HTTPS health passed. Rollback /opt/supplyo/releases/20261110-brand-v2. Prepared rebrand-v1 was never activated; v2 includes final navigation containment correction.

## Compact assembly columns and anchored bottom navigation (10 November 2026)

Shifted the sidebar logo 6px left with identical positioning in expanded/collapsed states. Settings label and profile info now remain mounted and fade like primary navigation. Fixed profile block height and anchored settings icon/avatar eliminate jumps during sidebar width animation. Both dropdowns remain usable while collapsed.

Assembly table now has explicit compact status (140px) and order ID (148px) columns, moving order ID/product left and giving product the remaining width. Placement columns remain Address then Code (100px each); barcodes 180px and actions 176px. Order header/IDs stay on one line and KIZ/Print buttons remain side by side. Other tables unchanged.

Validation: live TypeScript/build and isolated Chromium checks passed. Frame sampling verifies stable logo/settings/avatar coordinates and profile height, smooth grid interpolation, dropdown operation and reduced-motion support. Assembly checks verify measured column widths/product start, horizontal actions, placement values/search and narrow viewport containment. Expanded/collapsed and assembly screenshots inspected.

Published /opt/supplyo/releases/20261110-assembly-columns-v2 after backup /var/backups/supplyo/supplyo-20261110-232837.tar.gz. All 33 files verified; local/public HTTPS health and public HTML/JS/CSS/logo byte checks passed. Rollback /opt/supplyo/releases/20261110-supply-rebrand-v2. Staging bottom-motion-v1 and assembly-columns-v1 were never activated. No data changes.

## Soft opening across sections and custom panels (10 November 2026)

Added shared short entrance/exit motion for navigation, landing/auth content, lazy-loaded views, active tab content, Radix menus/select panels and dialogs/backdrops. Navigation uses opacity only (220ms) so fixed toasts and page geometry do not shift. Panels fade with a subtle independent scale (220ms in, 140ms out), preserving their positioning. The navigation animation depends on section/cabinet/team/session identity, not polled data. Reduced-motion preference disables the added effects. Existing sidebar geometry and business state remain unchanged.

Validation: live TypeScript/build and isolated browser assertions passed for menu/dialog animation names, close/unmount behavior, no repeated navigation animation across background polling, reduced-motion disabling, assembly geometry/search and responsive containment. Published /opt/supplyo/releases/20261110-soft-motion-v1 after backup /var/backups/supplyo/supplyo-20261110-233458.tar.gz. All 33 files, local/public HTTPS health and public HTML/JS/CSS/logo hashes verified. Rollback /opt/supplyo/releases/20261110-assembly-columns-v2. No business-data changes.

## Store removal and continuous scanner focus (11 November 2026)

Owned store cards now have a red Delete action with a named confirmation. Only the owner can call the confirmed removal endpoint. Removal marks the store removed, clears its encrypted credential, revokes grants/codes, removes owner warehouse bindings for that cabinet with a workspace version increment, cancels queued/running syncs and drops the inventory sync job. Orders, supply history, inventory placement and accounting documents are retained. Access resolution, lists, employee sources, dashboard and cabinet capacity exclude removed stores. Reconnecting the same key by the same owner restores the original cabinet/history without reviving grants or warehouse bindings. Other accounts cannot claim that retained history. In-flight sync completion/failure cannot revive the store or overwrite its cached orders after removal.

Assembly now restores scanner focus after busy printing ends, after errors and after KIZ submit/cancellation. The input is disabled only while an operation is running. Initial assembly entry and subsequent scans no longer require an extra click when focus is outside another editor. Document-level scanner routing preserves the first character and US keyboard normalization, while editable inputs and open dialogs/menus/listboxes are protected. Empty search relinquishes focus after four seconds. Submitted product barcodes clear immediately for the next scan; pending print job deduplication is unchanged.

Validation: 15 server integration tests, server typecheck and live build passed. Removal tests cover permissions, confirmation, repeat calls, grant/binding revocation, credential clearing, retained history, safe reconnect and deletion during a held WB read. Isolated browser tests cover deletion cancellation, failure/retry, preserved second store and narrow layout; consecutive single/Auto scans without clicks, body scanning, KIZ submit/Escape, unknown barcode, Russian search and four-second empty search, and menu protection. Existing scanner regression scenarios also passed (Russian physical input/paste, GS, canonical codes, retry IDs, Auto batching and responsive layout). Site-map chapters 04/10 and editable exports updated, no validation errors. All external WB/printer responses in these tests were mocked; no real shop was removed.

Published /opt/supplyo/releases/20261111-scanner-focus-v1 after backup /var/backups/supplyo/supplyo-20261111-104511.tar.gz. All 32 uploaded files verified, local/public HTTPS health and public HTML/JS/CSS/logo byte checks passed. Rollback /opt/supplyo/releases/20261110-soft-motion-v1. Prepared store-remove-v1 was never activated separately; its changes are included here.

## Print-agent connection diagnosis and clear errors (11 November 2026)

Investigated the screenshot for order 6243885927 without resubmitting KIZ or printing. Read-only production data showed KIZ and sticker saved, status pending validation, printed=false. Local 127.0.0.1:17891 initially refused connections. Started the existing Windows agent in a hidden PowerShell process using RemoteSigned and the project's original agent script; quick health now responds and printer discovery returns six installed printers. No print endpoint was called during diagnosis.

Fulfillment now distinguishes supply-server fetch failures from local print-agent connection failures. Local failures show Russian instructions to run the agent/check printer settings/browser local-network access and accurately state printing is unconfirmed. The existing session print intent is retained for retry, including job ID, label and printer; no automatic new print is created.

Validation: live TypeScript/build and isolated browser connection-refusal/recovery checks passed. The saved print intent survived the simulated offline agent, retry used the identical job ID, and sticker/KIZ preparation was not repeated. Published /opt/supplyo/releases/20261111-print-network-v1 after backup /var/backups/supplyo/supplyo-20261111-105421.tar.gz. All 32 uploaded files, local/public health and public asset hashes verified. Rollback /opt/supplyo/releases/20261111-scanner-focus-v1. No real physical print was initiated by the agent.


## WB no-check KIZ allows shipment (11 November 2026)

Explicit product rule: WB decision filled (Без проверки) allows readiness and delivery with a saved KIZ and confirmed printing. It remains distinct from successful validation. Pending, optional, deadlineExceeded and errors still block delivery. Filled is terminal and no longer polled. Startup reconciles existing filled items only in open supplies, preserving print receipts and closed history.

Validation: all 15 server tests, server typecheck and live build passed. Added coverage for filled polling, print acknowledgement, ready/delivery guards, existing open-item repair, closed-history preservation and actual mocked delivery route. Site-map exports regenerated without errors. No real WB delivery or printing performed.

Published /opt/supplyo/releases/20261111-filled-ready-v1 after backup /var/backups/supplyo/supplyo-20261111-111754.tar.gz. All 32 uploaded files, public health and asset checks verified. Rollback /opt/supplyo/releases/20261111-print-network-v1.


## Textual WB sticker in assembly (11 November 2026)

Added Sticker immediately after Barcodes in assembly only, displaying WB partA + partB (or barcode fallback) as plain text with leading zeros preserved. Added sticker_text storage and exposed it through scoped fulfillment reads; both single and Auto sticker fetching save the text mapped by order ID. Assembly loads missing numbers for the selected supply in batches of up to 100, coalescing concurrent staff requests per real cabinet/supply and reusing stored results. Number retrieval never confirms printing, changes readiness or submits KIZ. Existing image/print intent caching remains intact. Sticker text is searchable. Compact columns and internal horizontal scrolling preserve the product column on narrow screens.

Validation: server typecheck, all 15 server tests, live build and isolated Chromium checks passed. Tests cover existing-number backfill/cache, leading zeros, reverse WB result ordering in Auto, column order, empty values and responsive containment. Site-map exports regenerated with zero validation errors. No real print or handover performed.

Published /opt/supplyo/releases/20261111-sticker-text-v1 after backup /var/backups/supplyo/supplyo-20261111-112645.tar.gz. All 32 uploaded files, local/public health and public asset hashes verified. Rollback /opt/supplyo/releases/20261111-filled-ready-v1.

## Assembly barcode grouping (11 November 2026)

Assembly preserves natural address ordering, then groups by normalized barcode (alternative barcode order does not matter), then uses numeric order ID for deterministic ties. Status and printing do not reorder identical products. Codes are not used as the grouping key.

Validation: live TypeScript/build and isolated Chromium grouping check passed for repeated products, reversed alternative barcode lists and mixed statuses. Site-map exports regenerated with no errors. No data changes.

Published /opt/supplyo/releases/20261111-barcode-sort-v1 after backup /var/backups/supplyo/supplyo-20261111-114027.tar.gz. All 32 uploaded files and public health/assets verified. Rollback /opt/supplyo/releases/20261111-sticker-text-v1.
## Android picker preview — 0.1.0 (11 November 2026)

Added an isolated mobile entry (?mobile=1#mobile) with existing account login, server-authorized cabinet selection, open supply selection and grouped picking cards. Remaining quantity, progress, code/address, barcodes, order details and WB sticker text use the same fulfillment data as the desktop. Search, pending/all filters, visible-only 15-second refresh with shared KIZ checker, empty/error/retry states and logout included. Existing desktop routes remain unchanged. Phone view does not acknowledge printing or submit delivery/scan mutations.

Added android-app, a small Java Android WebView host for Android 8+ (minSdk 26, target/compileSdk 36). HTTPS same-host navigation, no file/content access, no mixed content, no native JS bridge, no embedded passwords or WB credentials. Cookie persistence, system back, insets and native initial-network retry screen are included. APK is a preview signed using the local retained test keystore; no Play publication. Build source/tooling instructions in android-app/README.md. Build scripts compile with aapt2/javac/D8, align and sign with apksigner. Signed APK at public/downloads/supply-android-0.1.0.apk, with a copy in the chat outputs/android folder.

Validation: TypeScript/Vite production build; isolated mobile browser checks for failed/successful login, shops, grouped remaining units, order/sticker details, search, supply switching, empty supply/shop, network failure/retry layout, logout, 393px and 320px containment. Existing desktop assembly browser regression passed. APK manifest and v2/v3 signatures verified. Site-map exports regenerated with no errors. No physical Android device/emulator runtime test performed. No production print, handover or credential changes.

Published /opt/supplyo/releases/20261111-android-preview-v1 after backup /var/backups/supplyo/supplyo-20261111-121151.tar.gz. All 36 uploaded files, public health, JS/CSS and downloadable APK hashes verified. Rollback /opt/supplyo/releases/20261111-barcode-sort-v1.
## Android picking cards, local marks and shared mobile notes — 0.2.0 (11 November 2026)

Phone cards now show address, code and quantity prominently in one row with barcodes below. Product name appears only in the notes sheet. Double tap toggles a local device mark; another double tap removes it. A single tap, vertical scrolling, left swipe and note badge presses do not change marks. Marks persist locally per account/store/supply and do not move cards; all order statuses are independent from these marks. The top counter explicitly says Marked on phone. No phone POST calls to check, sticker-numbers, scan, printed or deliver remain.

Left swipe opens the notes bottom sheet; a small card icon/count at bottom right appears only when notes exist. Notes show product title, author/time and messages, with order/sticker details inside the sheet. Shared mobile_pick_notes storage is isolated from fulfillment state. GET uses existing view/supply/warehouse permissions; POST requires assembly permission and an item in the accessible open supply. Authorship/time are server assigned; UUID request IDs make network retries idempotent. Revocation applies immediately. Desktop has no notes or mark UI and no business rows are updated by these features.

Android APK 0.2.0 / versionCode 2 uses the same retained preview signing key, so it installs over 0.1.0. System back first closes the notes sheet. Signed APK and chat output copy provided; old APK remains available. The hosted interface also updates existing installations on reload.

Validation: server typecheck and all 16 server tests passed. New integration coverage verifies owner/staff/reader/stranger permissions, warehouse and item scope, blank/oversized validation, idempotency, immediate revocation, and unchanged fulfillment item/supply/print tables. Touch browser checks pass for double tap/undo/single tap, persistence after reload, supply isolation, swipe vs mark, notes badge, failed-response retry without duplicates, 320px containment and absence of desktop mutation requests. All test WB responses were mocked; no production order/print/delivery was changed. APK manifest (minSdk26/target36/versionCode2), v2/v3 signatures and local build verified. Site-map regenerated with zero errors. Physical Android runtime testing remains pending.

Published /opt/supplyo/releases/20261111-android-picking-v2 after backup /var/backups/supplyo/supplyo-20261111-160416.tar.gz. All 37 uploaded files, public health, JS/CSS and APK hashes verified; public HTTPS mobile login checked. Rollback /opt/supplyo/releases/20261111-android-preview-v1.
## Compact Android picking cards — 0.2.1 (11 November 2026)

Removed the check icon and Marked caption from individual phone cards; green background/border remain, along with the accessible marked description. Moved notes badge/count to the right of the barcode row. Removed the separate bottom row and reduced card padding/primary-row height, bringing the representative card from about 162px to 122px without reducing address/code/quantity type sizes. No backend/data/mark/gesture changes.

Validation: live TypeScript/build passed; existing touch browser scenarios passed with added visual/geometry assertions for no visible marked caption, compact height and badge aligned with barcode row. Reviewed phone screenshots at 393px; 320px containment passed. APK 0.2.1/versionCode3 compiled and v2/v3 signatures verified using the retained signing key. Site-map exports regenerated without errors. Physical device installation remains a user check.

Additional 0.2.1 motion: phone cards follow left pointer movement with a capped reveal of the Notes action. Short/cancelled swipes settle back with a 280ms ease; vertical movement remains native scroll. Notes content is retained during the 200ms exit, with a 300ms entrance and overlay fade. Added soft card entrance, tab indicator slide, mark color/quantity feedback and button press feedback. Stable keys avoid replay during data polling. Reduced-motion preference disables the new animations/transitions. Added touch checks for partial swipe displacement/reset and reduced-motion styling; existing full swipe/tap/persistence/notes checks pass. Prepared compact-v1 was not activated; final compact-v2 includes both compact layout and motion.

Published /opt/supplyo/releases/20261111-android-compact-v2 after backup /var/backups/supplyo/supplyo-20261111-162254.tar.gz. All 38 uploaded files, public health and public JS/CSS/APK hashes verified. Rollback /opt/supplyo/releases/20261111-android-picking-v2.
## Delete mobile notes (11 November 2026)

Added a trash action and explicit inline confirmation/cancellation in the mobile notes sheet. Employees with assembly rights can remove their own notes; the store owner can remove any note with the same store/warehouse access checks. GET returns can_delete based on live permissions; author user IDs are not exposed. Deletion sets deleted_at and excludes notes from lists/counts. Repeated deletes are idempotent; a late create retry cannot resurrect a deleted note. Client guards recently removed IDs against an older in-flight notes read. Existing notes remain unchanged until the user confirms deletion. Fulfillment rows, print/KIZ state, local marks and desktop UI are untouched.

Validation: server typecheck, all 16 server tests, live build and touch browser checks passed. Tests cover missing confirmation, cancellation, own vs other-author permissions, owner removal, reader/warehouse/revocation restrictions, repeated delete and create-after-delete, unchanged fulfillment data and immediate badge/count update. Site-map regenerated without errors. No real production notes were deleted during testing. Hosted interface update works with the existing APK after a full restart; no native APK changes required.

Published /opt/supplyo/releases/20261111-mobile-note-delete-v1 after backup /var/backups/supplyo/supplyo-20261111-170215.tar.gz. All 38 files, public health and JS/CSS/APK checks verified. Rollback /opt/supplyo/releases/20261111-android-compact-v2.
## Sequential scans skip already printed KIZ orders (12 November 2026)

Root cause: ordinary barcode selection filtered only status != Ready. A successfully printed KIZ order remains Checking while WB validates it and was selected again before the next identical unit. Selection now requires printed=false as well. Explicit per-row KIZ/Print actions still allow deliberate correction/reprint. Exhausted barcodes explain that printing is already confirmed and direct the user to a specific row. After acknowledged single printing, local state immediately records printed=true, so a failed following list refresh does not reselect the consumed unit. Failed printer/ack requests remain retryable using the existing persisted print job ID. No backend state/validation rules changed.

Validation: live TypeScript/build and isolated Chromium tests passed. Regression covers a printed Checking order followed by two identical unprinted KIZ orders, printed KIZ errors, another supply isolation, a failed post-ack list refresh, failed acknowledgement retry retaining the same job ID, exhausted barcode and explicit reprint. Existing scanner focus/Auto/Russian input/menu/search/KIZ cancellation regression also passed. WB/printer responses were mocked; no production print was performed. Site-map exports regenerated without errors.

Published /opt/supplyo/releases/20261112-scanner-next-item-v1 after backup /var/backups/supplyo/supplyo-20261112-105452.tar.gz. All 38 files and public health/assets verified. Rollback /opt/supplyo/releases/20261111-mobile-note-delete-v1.
## Full supplies history, replace WB key and dashboard heading order (12 November 2026)

Supplies now show warehouse, created/delivered dates, orders without/with KIZ (including optionalMeta), box count, SC/PVZ destination, status and sticker printing/reprinting. Added inclusive creation-date period filter with the shared calendar and reset, explicitly using Moscow dates/times. Counts derive from the accessible saved fulfillment items. Legacy warehouse IDs can be inferred from a single saved order warehouse. Open supply title/status navigates to the corresponding assembly. Fixed column widths and internal horizontal scrolling retain readable titles, dates and actions on narrow screens. No shipping/history values were rewritten.

Owned shop cards now provide Replace key in a named dialog. Owner-only endpoint checks existing ownership/identity, rejects another seller or token already bound elsewhere, validates seller-info and FBS reads before modifying anything, and encrypts the accepted key. Invalid permissions, WB rejection/429 or concurrent changes preserve the existing credential. Replacement keeps cabinet ID, all history/placement/stock/grants/bindings and subscription capacity; queued old-key jobs are cancelled and a fresh connect job queued atomically. Running sync blocks replacement; worker startup also verifies the credential it originally read to guard against stale-key races. No key is returned in API responses or stored in browser persistence. The endpoint respects existing seller-info cooldown/backoff.

Dashboard card headers now show the IP/store name first, with warehouse underneath as requested.

Validation: server typecheck, all 17 server tests and live TypeScript/build passed. New integration test verifies same-key no-op, unauthorized/other owner, wrong seller, invalid/insufficient FBS rights, 429, duplicate token, running sync, preserved history/inventory/grants/bindings, encrypted replacement, normal queue completion and removal/concurrent replacement races. Browser checks cover all table columns/counts, optional KIZ, Moscow-midnight inclusive date filtering/reset, legacy warehouse, responsive containment, open-supply navigation, IP-before-warehouse and key dialog cancellation/failure/success. All WB responses mocked; no real key replaced or stock/delivery mutated during tests. Site-map exports regenerated with no errors.

Published /opt/supplyo/releases/20261112-supplies-key-v1 after backup /var/backups/supplyo/supplyo-20261112-112949.tar.gz. All 38 uploaded files, public health and asset/APK hashes verified. First activation connection timed out before mutation; retry completed successfully. Rollback /opt/supplyo/releases/20261112-scanner-next-item-v1.
## Comprehensive site-map refresh (12 November 2026)

Reconciled editable map with current live/Android code and the deployment history through supplies/key replacement. Updated actual flow nodes and edges instead of only appending notes. Added full Android flow and explicit implementation/plans chapter; now 22 chapters + table of contents, 285 flow nodes and 297 edges. Corrected stale brand/date/state labels, filled readiness, queued KIZ batching, next-unprinted scan selection, key replacement/removal, full supplies creation-date filtering, dashboard heading order, mobile independent marks/shared notes/deletion/motion, and real profile limitations. Moved misfiled incremental notes into their proper chapters. Current code shows a read-only live profile; the full prototype editor is correctly marked as pending.

Exporter now derives counts/date/page references, supports chapters 20/21 and dynamic footer note height, and rebuilds a verified ZIP/manifest. Preserved legacy artifact filenames for compatibility. Regenerated drawio, standalone HTML, SVG per chapter, readable editing instructions and dated change coverage. Validation checks references, duplicate/missing nodes, node/edge intersections and page count; Chromium rendered all 22 chapters without clipped SVG text and tested HTML navigation/date/download. Archive CRC and SHA-256 manifest checked. Dated deliverables copied to chat outputs/site-map-2026-11-12. Source remains docs/site-map. No application deployment or production-data changes. The historical FigJam URL is retained as reference; no claim of synchronizing that board.
## One-file Windows print agent (12 November 2026)

Replaced the main ZIP download with downloads/supply-print-agent.exe: a native portable Windows tray application built from print-agent/windows/SupplyPrintAgent.cs using the existing .NET Framework compiler. No unpacking, CMD/PowerShell launcher, installation, registry changes or administrative setup. No autostart: reopen the file after restarting Windows. EXE is currently unsigned. The prior ZIP remains available for compatibility.

Print settings discover the agent automatically every five seconds while visible, preserve an existing printer selection or select the Windows default, and clear the offline hint when connected. The native agent retains the legacy local settings/job directory, loopback endpoint and client protocol. Batch jobs are serialized and deduplicated against the same body digest; uncertain jobs cannot silently print again. Exit waits for accepted requests to finish. Source, deterministic build script and usage limitations included. Site-map chapter 13 and exports updated.

Validation: live TypeScript/build, native executable integration and isolated Chromium settings/network regressions passed. Verified printer enumeration, unchanged existing local settings/job files, completed-job deduplication, changed-body rejection, uncertain-job rejection, denied untrusted origins and graceful exit while an accepted request is incomplete. Browser verifies EXE download and automatic discovery/default-printer persistence without manual refresh. No actual labels were printed; physical printer output still requires a hardware check.
Published /opt/supplyo/releases/20261112-onefile-agent-v2 after backup /var/backups/supplyo/supplyo-20261112-120906.tar.gz. All 39 uploaded files verified; public health, JS/CSS/APK and EXE hashes match. Rollback /opt/supplyo/releases/20261112-supplies-key-v1. First v1 staging upload was incomplete after rebuilding local assets; it was never activated. Final v2 was staged from the stable rebuilt directory and verified before activation. No database or customer printer configuration changed.
## Print settings wording (12 November 2026)

Removed the selected extra explanation about unpacking/installation/printer selection and removed (.exe) from the download button label. The actual EXE download is unchanged. Live TypeScript/build passed.
Published /opt/supplyo/releases/20261112-print-copy-v1 after backup /var/backups/supplyo/supplyo-20261112-121318.tar.gz. All 39 files and public health/assets/EXE verified. Rollback /opt/supplyo/releases/20261112-onefile-agent-v2.
## Empty assembly state (12 November 2026)

When no open supplies exist, Assembly displays a centered empty state with an explanation and a New orders navigation button. Hides the empty native select, scanner and empty assembly table. Existing open-supply flow is retained. Live TypeScript/build and isolated browser checks passed for empty-state/navigation and existing populated assembly layout. No business data changed.
Published /opt/supplyo/releases/20261112-assembly-empty-v1 after backup /var/backups/supplyo/supplyo-20261112-121703.tar.gz. All 39 uploaded files and public health/assets/EXE verified. Rollback /opt/supplyo/releases/20261112-print-copy-v1.
## WB-created active supplies synchronization and order transfer (12 November 2026)

The cabinet's existing durable background/manual sync now imports active supplies created directly in WB, their current order IDs, details and available marking metadata. Uses paginated GET supplies / GET supply order-ids / GET orders (30-day windows, up to the API's recent three-month detail horizon), read-only status requests up to 1000 and metadata up to 100 orders. Existing complete snapshots avoid repeated detail/meta reads. Canceled/handed-over orders are excluded from active work. Existing local delivery history receives closure updates; this is not a full import of previously closed external history. Unknown/incomplete/malformed responses abort publication and preserve saved data. Unresolved details outside the supported API horizon also preserve the previous snapshot and require reconciliation rather than fabricating items.

Shared worker/jobs coalesce owner/staff refreshes for the real cabinet; per-token request spacing and persisted WB 429 backoff remain in force. Fetch completes before the publishing transaction. Local fulfillment mutations invalidate an in-flight remote snapshot. Warehouse scope is inferred from order warehouse IDs; delegated/staff reads and mutations retain existing checks. Import uses existing placement joins and never changes inventory amounts. Stable memberships retain print/KIZ/decision/label/sticker state. External membership changes retain full former row state in fulfillment_item_history before reset/detachment. Deleted open supplies are hidden with wb_removed, without pretending they were delivered. Canceled pending print batches cannot mark moved items ready.

Assembly now offers checkboxes and Transfer orders, then existing compatible open supply or Create new. Requires supply rights, validates source/target locally and in WB, same warehouse and delivery attributes, at most 100 orders. Does not move closed supplies or orders reserved by unfinished Auto printing. Successful local moves preserve print/KIZ state and move shared notes. Durable operation IDs prevent duplicate target creation and reconcile ambiguous PATCH results by reading target membership before retrying. An uncertain creation without a returned WB ID is blocked from blind repeat; synchronize and select the resulting WB supply instead. Background synchronization recognizes prepared local moves and retains their receipts if it reconciles them before the browser retries.

Validation: all 20 server tests, server typecheck and live build passed. Focused integration covers 150 orders, metadata batching, pagination/cached details, cancellation, incomplete responses, local mutation races, cabinet refresh coalescing, warehouse isolation, placement/inventory preservation, ready/KIZ preservation, external moves/removal/closure/history, old print acknowledgement rejection and 429. Transfer tests cover existing/new targets, rights/scope/closed/other-warehouse/limits, preserved KIZ/labels/notes, idempotent retry, lost PATCH response plus background reconciliation, uncertain creation and pending Auto batches. Chromium covers existing/new selection, filtering destinations, stable retry operation ID, retained ready status, assembly layout and scanner focus/Auto/search/KIZ/menu regression. All test WB mutations and printing mocked; no production order transferred for testing. Read method contracts checked against official WB FBS documentation at https://dev.wildberries.cn/docs/openapi/orders-fbs (RU documentation endpoint was unavailable). Updated site-map exports.
Published /opt/supplyo/releases/20261112-wb-supplies-sync-v2 after backup /var/backups/supplyo/supplyo-20261112-124501.tar.gz. All 39 files and public health/assets/EXE verified. Rollback /opt/supplyo/releases/20261112-assembly-empty-v1. Earlier v1 was only staged; it was never activated because order transfer was added before publication. Initial public health/assets and saved cabinet states were checked. This did not prove every cabinet had finished the new detail-import path: two cabinets later failed on large WB pagination cursors; see the cursor correction below. The existing 11 supplies and 208 fulfillment records remain; no additional active external supply was present at verification time. No production transfer or physical print was used for testing. Site-map: 287 nodes, 300 edges, 23 pages, no validation/render errors.
## Preserve WB int64 pagination cursors (12 November 2026)

Production order details returned a 19-digit next cursor (above Number.MAX_SAFE_INTEGER). The schema's safe integer validation rejected it; simply converting an already parsed Number to a string would also round it and could skip pages. Central WB HTTP JSON decoding now retains the original raw digits of unsafe numeric next cursors using Node 24 JSON.parse source context. Supply/order pagination accepts validated digit strings or safe integers, sends exact cursor text and compares progression using BigInt. Malformed cursors still abort publication rather than clearing saved data.

Validation: all 21 server tests and server typecheck passed. Added regression exercising exact 19-digit cursor preservation through JSON decoding and both supplies/order-detail next-page URLs. Read-only production diagnostic with corrected code successfully fetched 274 WB supply headers, one active supply and its two orders for the affected cabinet. No production WB mutation or physical printing performed. Recovering affected generic-failure jobs preserves upstream 429 cooldowns.
Published /opt/supplyo/releases/20261112-wb-cursor-fix-v1 after backup /var/backups/supplyo/supplyo-20261112-130237.tar.gz. All 39 uploaded files and public health/assets/EXE verified. Rollback /opt/supplyo/releases/20261112-wb-supplies-sync-v2. Recovered generic-failure jobs while retaining API retry_after. Verified the affected shop's external active supply and two orders were imported. Subsequent inspection confirmed all four cabinets have a successful post-fix last_synced timestamp and no saved error; one may already be performing the next periodic sync. Totals rose from 11 supplies/208 records to 31 supplies/291 records (20 supply headers and 83 items imported). No production transfers/printing performed.
## Clear current subscription (12 November 2026)

Profile now shows tariff name, actual test-subscription type, active/expired/not-connected state, expiration date in Moscow and connected cabinet usage. Subscription page names the active plan, highlights its card and disables redundant activation of that current plan. Cabinet count still deduplicates shared warehouse views of one real cabinet. Unknown custom limits are labeled Individual rather than being guessed as a standard tariff. Existing subscription limits, expiry and activation rules are unchanged. API entitlement additionally returns the stored is_test flag; no subscription data migration or purchase occurs.

Validation: server typecheck, two subscription integration tests and live build passed. Chromium verified Pro/test/date at Moscow midnight, deduplicated cabinet count, one active highlighted card with disabled action, expired and unsubscribed states. No billing action performed. Updated site-map note/exports.
Published /opt/supplyo/releases/20261112-subscription-clarity-v1 after backup /var/backups/supplyo/supplyo-20261112-132810.tar.gz. All 39 files and public health/assets/EXE verified. Rollback /opt/supplyo/releases/20261112-wb-cursor-fix-v1. No subscription records changed.
## Ozon phase 1: connection, warehouses and FBS postings (12 November 2026)

Added a provider discriminator to stores (existing rows default to wb) and an isolated Ozon client/read model. Settings -> Shops now offers Wildberries/Ozon; Ozon takes Client ID plus password-masked API key. Client ID is normalized and identifies a unique cabinet across API-key rotations/users. The tuple is encrypted with the existing server key and never returned to the browser or stored in browser persistence. Cabinet capacity/removal/reactivation, owner/grant/employee resolution and subscription checks are shared. Seller name is read from /v1/seller/info. Failed initial Ozon keys can be corrected without deleting/recreating the shop; key replacement verifies the fixed client identity, warehouses and FBS access before changing encrypted credentials.

Contracts verified in the actual official Seller API documentation browser view: /v1/seller/info (company.name/legal_name), /v2/warehouse/list (limit <=200, opaque cursor, root warehouses/has_next), /v4/posting/fbs/list (limit <=100, sort_dir, filter.since/to/last_changed_status_date, root postings/has_next/cursor without v3 result wrapper). Numeric int64 identifiers preserve raw JSON digits. FBS warehouses exclude rFBS; postings are also checked against allowed FBS warehouses. No deprecated v1 warehouse or v3 posting list is used. Reference https://docs.ozon.ru/api/seller/ operations SellerAPI_SellerInfo, WarehouseListV2 and PostingFbsList; official announcements https://dev.ozon.ru/news/688-Izmeneniia-v-metodakh-dlia-raboty-so-skladami-i-ostatkami-FBS-i-rFBS/ and https://dev.ozon.ru/news/734-Otkliuchenie-starykh-metodov-Seller-API-dlia-raboty-s-postingami/.

Worker shares the existing cabinet job queue. First FBS import is the last 30 days; background sync uses status-change overlap, while manual refresh performs a fuller read. Known older active postings extend the created range up to the documented one-year horizon. Validated full reads publish transactionally; updates upsert quantities/composition/status and retain history. HTTP failures, malformed/partial pagination and persisted 429 pauses preserve saved data. Ozon calls use a separate per-client scheduler and headers; Ozon credentials never enter WB transport. An unpaid connection verifies shop/warehouses but does not fetch orders. Warehouse results are reused in the UI cache after sync. Existing WB model/error declarations were extracted to wb-model.ts to remove the pre-existing circular initialization exposed by loading a second provider.

New dark-styled FBS view shows posting/order number, product names/offer IDs/SKUs, per-product and total quantities, status, warehouse, created/shipment times (Moscow) and optional scanit text. Supports warehouse/status/search filters and 50-row paging, with contained horizontal scrolling. Ozon warehouse bindings/grants/employees reuse warehouse scoping; dashboard shows To assemble / To ship / Postings for Ozon. Only needed posting fields are stored: customer name/address/phone and financial data are discarded. Ozon assembly, labels, shipping mutations, inventory and mobile assembly are explicitly unavailable at this phase; UI and backend guards prevent those requests from reaching WB. Existing Android APK loads the guarded mobile UI from the server.

Validation: server typecheck, all 23 server tests and live build passed. Focused Ozon tests additionally verified unpaid connection, mixed-provider capacity/identity, encrypted secrets, invalid key/repair/rotation, exact large IDs, v2/v4 cursor requests, multi-product quantities, cancellation/composition changes, grant and unpaid employee warehouse isolation, 500/429 retention, manual cooldown, coalesced employee refresh and removal during fetch. Chromium verified provider/client/key form, masked/cleared key and no browser persistence, cards and FBS rows, status/warehouse filtering, quantity/status text, narrow containment and unsupported-action guards. Existing WB scanner/Auto/KIZ/search/focus and transfer UI regressions passed. Bundled server started successfully against an isolated fresh database. Ozon responses were fixtures based on the documented contract; no real Ozon credentials were provided, so a live Ozon cabinet is not yet verified. No production Ozon order/stock/shipping mutation or print was performed. Site-map chapter 22 added (23 chapters + contents, 298 nodes, 313 edges, 24 pages).

Rollback to the prior WB-only release must first cancel Ozon jobs and temporarily hide Ozon cabinets (status=removed, with credentials/history/grants retained), so the old worker cannot send an Ozon credential to WB. The deployment helper includes this guarded failure rollback and records affected cabinet IDs/statuses for restoration. Never use an unguarded old-version rollback once Ozon shops exist.
Published /opt/supplyo/releases/20261112-ozon-fbs-v2 after backup /var/backups/supplyo/supplyo-20261112-140147.tar.gz. All 42 uploaded files and public health/assets/Android APK/Windows EXE hashes verified. Staged v1 was never activated; final v2 backend was refreshed and hash-verified before activation to include initial bad-key repair. Post-deploy database inspection shows all four existing WB cabinets ready with no error and fresh synchronization timestamps; no Ozon cabinet has been connected yet (zero Ozon records). Guarded rollback target /opt/supplyo/releases/20261112-subscription-clarity-v1, using the provider safety steps above. No user keys, existing WB history, placements or amounts were changed by deployment.

## Ozon product marking evidence (12 November 2026)

Automatically reads /v4/product/info/attributes for unique posting SKUs in batches of 100 with validated last_id/total pagination. Stores only explicit attribute 23536 (true/false; absent, ambiguous or unrecognized = unknown), 22232 (10-digit TN VED), and evidence timestamp in a store-scoped table. Does not infer marking from missing data or guess legal classification from TN VED alone. Daily cache shared by employees; manual sync rereads. Unchanged active saved postings are included during status-delta refresh. Catalog failures retain prior evidence and allow order snapshots to publish; 429 preserves shared retry/backoff. Stale evidence is visibly labeled after a day. No product-card writes, code submissions, shipping or WB workflow changes.

Orders display marking/unknown and available TN VED per product, with source/time tooltip. This is catalog evidence, not proof of a physical code, validation or mandatory transmission for that particular posting. Official contract inspected in Seller API operation ProductAPI_GetProductAttributesV4; attribute definitions confirmed by Ozon announcements 777 (23536) and 741 (22232).

Validation: 24 server tests passed, server typecheck/live build and focused final Ozon tests passed. Covers 150 SKUs, pagination/batches, explicit false versus missing/ambiguous values, missing products, wrong SKU/partial response rejection, daily reuse, catalog denial retention/staleness and existing scoped access. Chromium fixture verified three marking states, stale label and contained narrow layout. Browser form fixture fills controlled fields with input events; per-character typing lost focus due to the existing settings rerender behavior, outside this change. Site-map note/exports regenerated and validated. Production currently has no connected Ozon cabinet, so live product values remain unverified until the owner connects it.

First activation rolled back automatically because the accumulated release-to-release node_modules symlink chain prevented Node from resolving zod. The staged release dependency link was normalized to the actual existing dependency directory and zod resolution verified as service user; future preparation resolves that real path directly. No dependency installation or production-data replacement was used.

Published /opt/supplyo/releases/20261112-ozon-marking-v1 after backup /var/backups/supplyo/supplyo-20261112-152413.tar.gz. All 42 uploaded files, public health and JS/CSS/APK/EXE hashes verified. Previous Ozon-aware release /opt/supplyo/releases/20261112-ozon-fbs-v2 is the rollback target.

## Hide Ozon marking diagnostics (12 November 2026)

Removed the per-product marking/unknown/TN VED/timestamp UI from Ozon orders at the user's request. Automatic server-side evidence loading/storage stays available. Desired future assembly behavior is WB-like: request KIZ automatically after a product scan when needed, without diagnostic labels in the product list. This release does not implement Ozon assembly, print, code submission or shipping, which remain guarded; it must not be described as already prompting for KIZ.

Validation for the UI correction: live build and Chromium fixture passed, including absence of marking/TN VED/status tooltip text with true/false/unknown evidence still present in API fixtures, plus existing filters and narrow containment. Map exports regenerated with no validation/render errors.

Published /opt/supplyo/releases/20261112-ozon-clean-v1 after backup /var/backups/supplyo/supplyo-20261112-153526.tar.gz. All 42 files and public health/assets/APK/EXE hashes verified. Rollback /opt/supplyo/releases/20261112-ozon-marking-v1. No server business logic or production order/stock data changed in this UI correction.

## Ozon assembly and per-instance KIZ storage (12 November 2026)

Added a separate live Ozon assembly screen in the existing visual system. Filters by permitted warehouse and posting, searches products/barcodes, pages 50 postings and counts all applicable units. Scanner resolves the next available physical unit by any catalog barcode/SKU/offer ID; plain goods are picked, marked goods automatically open the KIZ dialog. No needs-marking/TN VED diagnostics appear in the table. Reserved units have actor/request-specific leases and cancellation; retries of a scan/save cannot increment quantity or submit a second identical mark. Duplicate KIZ identity is blocked per cabinet. Two identical goods are separate units and require separate codes. Existing desktop WB code remains isolated.

Fetches fresh /v3/posting/fbs/get and /v6/fbs/posting/product/exemplar/create-or-get before action, combining catalog evidence and posting/exemplar positive requirements. Unknown does not become unmarked. Barcodes are cached with product evidence. Pending marks are durably queued, then merged into the freshly read COMPLETE product/exemplar set for /v6/fbs/posting/product/exemplar/set. Existing marks, GTD/RNPT/absence flags and weight are preserved; mismatches, changed composition and conflicting external codes stop the write. Exact int64 exemplar/product IDs serialize as exact JSON integers, never rounded. Uses documented mark_type=mandatory_mark (the current docs' example contradicts the field description with KIZ; field definition is followed).

HTTP 200 is only task acceptance. Shared persisted posting checks read /v5/fbs/posting/product/exemplar/status at least 15 seconds apart, and only positive matched-code results (passed / explicit SUCCESS example, no error codes) mark a unit ready. Unknown/processing remains pending, failed/error or explicit error codes require correction. A lost set response is reconciled by reads without replaying a stale full payload; an unconfirmed code becomes a visible error after 60 seconds. Upstream 429 is persisted in the existing cabinet pause and cannot be bypassed by staff/manual action. New queued submissions recheck actor permissions, removal and credential changes; revoked employees cannot send queued codes. An authorized owner can correct/retry a failed submission. Local audit retains replaced state.

A separate confirmed Finish assembly action requires supplies rights and all units ready, rereads composition/catalog/exemplars/KIZ and calls /v4/posting/fbs/ship with one complete package. Its durable task verifies actual awaiting_deliver via get before confirming completion. Unknown ship responses are not blindly repeated; a vendor ship_failed or explicit rejection permits a new attempt. Multi-box work is explicitly left to Ozon. Label printing, carriage/shipping documents, Ozon inventory and Android Ozon assembly remain separate future work; current ready means collected/mark accepted, not a paper-label receipt. Fixed the shell's obsolete WB-orders read for a selected Ozon cabinet.

Official Seller API contracts inspected directly in current browser-rendered docs: ProductAPI_GetProductAttributesV4, PostingAPI_GetFbsPostingV3, PostingAPI_FbsPostingProductExemplarCreateOrGetV6, PostingAPI_FbsPostingProductExemplarSetV6, PostingAPI_FbsPostingProductExemplarStatusV5 and PostingAPI_ShipFbsPostingV4. Schema descriptions and example inconsistencies handled conservatively; unfamiliar states do not authorize readiness. Reference https://docs.ozon.ru/api/seller/.

Validation: all 25 server tests passed, then expanded targeted assembly regression passed after final guards; server typecheck and live build passed. Tests cover unit counts, second identical scan, same-request retry, code format and duplicate identity, complete merge preserving another unit/IMEI/GTD/RNPT, exact large IDs, pending/pass/error/correction, uncertain save response without replay, persisted 429, overlapping scans, unpaid/view-only staff and revoked queued staff, owner retry, denied other tenant, barcode search and finish/retry reconciliation. Chromium fixtures verify automatic dialog, save/checking, plain scan, scanner focus return, hidden diagnostics, counters, explicit finish confirmation and narrow containment without WB calls. Test upstream writes are synthetic; no real Ozon cabinet has yet been connected and no production Ozon code or shipping mutation was used for testing. Site map chapter 23 added: 24 chapters, 310 nodes, 326 edges, 25 pages, no validation/render errors.

Published /opt/supplyo/releases/20261112-ozon-assembly-v1 after backup /var/backups/supplyo/supplyo-20261112-160002.tar.gz. All 43 uploaded files and public health/assets/APK/EXE hashes verified. Final staged backend was refreshed/hash-verified before activation to include initial-status and fresh-merge guards. Bundled server startup against a fresh isolated local DB and unauthenticated assembly protection also passed. Previous Ozon-aware release /opt/supplyo/releases/20261112-ozon-clean-v1 is the rollback target; additive tables and queued data remain retained on rollback.

## Ozon label printing through the portable agent (12 November 2026)

Added Print for awaiting_deliver FBS postings in the Ozon list and after confirmed assembly. Uses current /v3/posting/fbs/package-label/create and /v2/posting/fbs/package-label/get, not deprecated label endpoints. Shared durable preparation selects small_label (or big_label), preserves exact int64 task IDs, polls saved tasks and requires completed, exactly one generated posting and no unprinted errors. A recent local assembly confirmation delays initial generation to at least 45 seconds, following Ozon's guidance. 429 uses the existing persisted cabinet pause; transient failures retry without erasing the last successful label. Partial files never become printable.

Downloads the protected PDF only from HTTPS Ozon/ozone hosts without forwarding API credentials or following redirects. Streams within a 16 MiB limit. Poppler pdfinfo/pdftoppm renders 300 dpi PNG pages, preserves CropBox/rotation and original millimeter size, validates page count/dimensions/resolution and bounds total image size. Uses private randomly named temp directories with checked cleanup. poppler-utils installed from the server's Ubuntu package repository; deployment checks both executables. Linux service-user rendering of the synthetic 58x40 PDF passed before publication. No Windows PDF reader or additional agent dependency is needed.

Print jobs are immutable, tied to the agent's persistent device ID and a fixed printer. One pending job per posting coalesces browsers/staff; another physical device cannot silently take it over and duplicate paper. Retries after lost browser/agent acknowledgement reuse exactly the same job/body. Server receipt is recorded only after agent success. An intentional reprint requires a separate confirmation and new job ID; it uses the retained label. Canceled/returned saved postings cannot output pending labels. Label generation/status access and job receipts enforce subscription/employee rights, warehouse, store and device binding; store removal prevents further reads. No Ozon ship or KIZ operation is repeated as part of printing.

Agent version 2026.11.12-ozon-media adds mediaSizes/deviceId discovery and optional per-page width_mm/height_mm. The default WB media remains 58x40 mm and legacy body/job deduplication stays compatible. The stable device-id.txt is stored alongside existing local settings; no installation/autostart/registry changes. The old running agent needs to be closed once and the new EXE opened. UI detects an old/missing agent and offers the download directly. A successful native receipt means Windows spool acceptance, not proof of paper output.

Validation: all 27 server tests passed; final focused label tests, server typecheck and live build passed. Actual PDF conversion/PNG signature and exact dimensions, host/protocol protections, sparse pending data, int64 label tasks, 429, partial results, same request/coalescing, other device/tenant/warehouse rejection, premature receipt, explicit reprint and removal covered. Synthetic fixture is server/fixtures/ozon-label.pdf. Chromium verifies upgrade guard, source media dimensions, lost agent response with identical body/job and a single synthetic spool, then confirmed intentional reprint with a new ID. Native EXE regression verifies media/device discovery, invalid media/device rejection, legacy dedup, modified/uncertain jobs, origin protection, graceful stop and unchanged existing settings; zero actual printer jobs submitted. Rendered synthetic label visually checked. Site-map chapter 24 added; 25 chapters, 320 nodes, 338 edges, 26 pages, no validation/render errors. No real Ozon cabinet is connected, so vendor responses are fixtures and real customer labels/paper remain unverified.

Published /opt/supplyo/releases/20261112-ozon-print-v1 after backup /var/backups/supplyo/supplyo-20261112-162658.tar.gz. All 42 uploaded files, public health and JS/CSS/Android APK/new Windows EXE hashes verified. Previous /opt/supplyo/releases/20261112-ozon-assembly-v1 is the Ozon-aware rollback target. Poppler is a system prerequisite; rollback does not remove it. New label/job tables are additive and retained. No production Ozon label request, shipment mutation or hardware printing was performed for verification.

## WB optional customs declaration regression (12 November 2026, urgent fix)

A production assembly error blocked label retrieval for WB orders 6257243894 and 6257835774 in WB-GI-309274221. Saved snapshots had requiredMeta=[customsDeclaration] and no optionalMeta, while a direct read-only WB metadata request returned key=customsDeclaration, decision=optional for both, matching an ordinary sibling. The external-supplies importer incorrectly promoted every available metaDetails key to mandatory, dropping its decision. This was a missed WB regression, not evidence of a printer failure.

Reader now retains explicit optional decisions in optionalMeta, normalizes the observed customsDeclaration alias to customs_declaration and keeps non-optional/unknown entries conservative. Optional sgtin still requests KIZ because the established shared rule checks both lists. Imported metadata is versioned. The identifiable legacy inferred customsDeclaration/no-optional-list shape is re-read once through the shared existing cabinet worker so saved bad metadata is repaired from actual WB evidence. No blanket bypass of unknown/mandatory marking and no direct manual rewrite of statuses, labels, KIZ, placements or print receipts.

Regression now includes the real optional-customs response, repair of a cached legacy shape, optional KIZ behavior, explicit required customs safety, metadata batch limits and cache reuse, plus the scoped scan/print acknowledgement path for an imported ordinary order. Five focused WB sync/fulfillment tests and server typecheck passed. Deployment copies the existing published dist unchanged and replaces only the backend bundle; the static tree is hash-compared. Production metadata diagnostics are read-only and do not print labels or submit WB mutations.

Published backend-only /opt/supplyo/releases/20261112-wb-marking-fix-v1 after backup /var/backups/supplyo/supplyo-20261112-180627.tar.gz. All 42 files verified; published static tree is unchanged from the preceding release, backend hash/public health verified. Scheduled the affected cabinet through the normal worker without bypassing WB 429. Read-only post-repair verification confirms orders 6257243894 and 6257835774 now have requiredMeta=[], optionalMeta=[customs_declaration], wbMetaVersion=1 and pass the no-KIZ print rule. All five affected-supply rows pass that rule; the original two printed/ready rows remain printed/ready and the three unprinted rows remain unprinted/waiting. No physical printing, order-state mutation in WB or user-data reset performed. Site-map exports revalidated.

## WB assembly revalidation (13 November 2026)

Read-only audit and repeat tests requested after the optional-customs regression. All 27 server tests passed. Five isolated Chromium suites passed: scanner focus/single/Auto/KIZ/search/menu handling; duplicate-product next-unprinted selection and same-job acknowledgement retry; whole Auto batch/double Enter/failed-ack retry/KIZ exclusion/unknown-metadata guard; existing/new-supply transfer with stable retry and preserved ready status; offline-agent failure/retry without new preparation. Native Windows agent legacy-WB compatibility/dedup/origin/graceful-stop tests passed against an isolated state/port, with zero physical prints and existing user settings unchanged.

Production current release remains /opt/supplyo/releases/20261112-wb-marking-fix-v1, backend SHA-256 232f065d333d22ec106ef226a4a5f5d16826ad754430036be9c8db2c46327ad2, matching the verified deployment. Service active and public health OK. Four WB cabinets ready, no saved errors, fresh synchronization. Audit of 15 open supplies / 24 active items: zero legacy optional-customs corrupt snapshots, unknown requirements, unsupported non-KIZ mandatory metadata, KIZ errors, pending KIZ checks, ready-without-print rows, invalid ready KIZ rows or unfinished Auto batches. These are point-in-time observations, not a guarantee of every future API response.

No application change/redeployment, production order mutation, delivery or physical label printing performed. Vendor delivery/print behavior is covered by isolated fixtures; actual paper output was not revalidated.

## Cabinet select arrow alignment (13 November 2026)

Replaced the native browser arrow only in .live-picker selects with a fixed 16px SVG background positioned right 12px / vertical center, reserving 40px for it and retaining native select keyboard/selection behavior. Existing style and layout retained. Live build passed; Chromium preview verified appearance:none, 16x16 background and vertical 50% position, visually inspected cabinet picker screenshot. No new business tests or business logic changes.

Published /opt/supplyo/releases/20261113-cabinet-arrow-v1 after backup /var/backups/supplyo/supplyo-20261113-132256.tar.gz. All 42 files and public assets/health/EXE verified. Backend copied unchanged from the previous release and hash-verified as 232f065d333d22ec106ef226a4a5f5d16826ad754430036be9c8db2c46327ad2. Previous /opt/supplyo/releases/20261112-wb-marking-fix-v1 is rollback target. No production business data changed.


## Accounting warehouse picker styling (14 November 2026)

The MultiSelectPicker trigger relied on field styles scoped to the prototype .app-shell, while the live accounting screen uses .live-shell. Added self-contained field background, height, padding, radius, border, hover/focus/disabled and reduced-motion styles to .cabinet-multi-trigger. Selection behavior and stored accounting data are unchanged.

Validation: live TypeScript/Vite build passed. Isolated Chromium fixture verified 36px height, 12px padding, 8px radius, non-transparent field background, multi-warehouse selection, keyboard open/close and 1024px desktop layout; screenshot visually inspected. No production financial mutations or real marketplace requests were made for testing.

Published /opt/supplyo/releases/20261114-accounting-picker-v1. Backup /var/backups/supplyo/supplyo-20261114-204558.tar.gz. All 42 files verified; public health/assets/APK/EXE checks passed. Backend copied unchanged, SHA256 232f065d333d22ec106ef226a4a5f5d16826ad754430036be9c8db2c46327ad2. Previous 20261113-cabinet-arrow-v1 remains rollback target.

## Internal warehouse inventory and explicit publication to WB (14 November 2026)

Stocks now separates «Остаток на WB» from independently stored «На складе». Manual initialization/corrections use optimistic versions and a movement ledger. Unknown physical quantities remain unset. Catalog synchronization never overwrites these quantities. WB products are scoped to the canonical cabinet/marketplace warehouse; a separate «Без маркетплейса» catalog supports goods belonging to an actual workspace warehouse, including accounts with no marketplace connection. Live employee permissions and warehouse deletion protection apply.

Background local-DB reconciliation debits only confirmed shipments, transactionally with an immutable marketplace/store/shipment receipt. Printing, scanning, KIZ, Ready and transfer between open supplies do not debit stock. WB closure confirmed by the existing delivery flow or vendor supply sync triggers one unit per order, with warehouse/variant matching and conservative barcode ambiguity handling. Ozon packing/awaiting_deliver does not debit: marketplace delivering/delivered confirmation records stock_shipped_at and triggers the actual posting quantities. Existing shipped history is baselined at first migration; shortages remain visible as negative quantities. Returns are reconciled manually.

«Передать остатки на WB» requires an explicit preview/confirmation covering all tracked variants of the selected warehouse, regardless of UI filters/page. It sends absolute physical values including zero, skips unset variants, blocks negatives/out-of-range quantities, checks access and versions before each batch, writes at most 1000 variants per request and verifies WB readback. Durable batch progress permits retry after a lost response; completed confirmations are idempotent. Changed internal quantities require a new preview. WB 429 pauses are respected. No automatic WB quantity writes were enabled.

Validation: all 28 server tests passed. After the final stock filtering/export and batching changes, both stock suites passed again, including 1001 variants as 1000+1, zero, shortage, lost reply/retry, version conflicts, no early/repeated deduction, scoped rights/revocation, catalog refresh survival, own products and Ozon dispatch distinction. Server typecheck and live build passed. Isolated Chromium verified both columns, quantity form/history, keyboard dialog closing, explicit publication, own-product creation and 1024px layout; screenshot visually inspected. No real vendor stock writes, shipments or physical prints were used for tests.

Published /opt/supplyo/releases/20261114-internal-stock-v1 after backup /var/backups/supplyo/supplyo-20261114-211025.tar.gz. All 41 application files hash-verified; public health/assets/APK/EXE checks passed. Backend SHA256 4785d71657e56ee92e3e7149b0c1fa5a6cd25af54093fdc381520dab9f565fec. Previous 20261114-accounting-picker-v1 remains rollback target; new additive internal-stock tables must be retained during any rollback. See docs/INTERNAL-STOCK.md for semantics and limits.

### User-authorized initial copy from WB to internal stock

The user explicitly requested copying WB quantities into «На складе» in all cabinets, including replacement of already entered quantities. Refreshed all four saved WB warehouse inventories through the existing worker without bypassing cooldowns; all four completed ready/fresh with no errors. After backup /var/backups/supplyo/supplyo-20261114-211953.tar.gz, a single guarded transaction initialized/replaced 535 internal positions, 3872 units total, including one previously set position. All 535 changes have movement records with operation reference `WB-initial-copy-20261114-1`; the script cannot apply that operation twice. Verification found zero mismatches between copied values and current known WB snapshot values. The remaining 2616 catalog positions had no quantity returned by WB and were not guessed as zero. No quantity writes to WB were performed by this copy. Subsequent verified shipments continue the normal internal-stock ledger.

## Stocks scope clarification: one table, two quantities (14 November 2026)

User clarified that only WB quantities and physical warehouse quantities are needed for the same products. Removed both category tabs («Товары кабинета»/«Без маркетплейса») and the separate manual-product catalog component. Stocks now directly displays the selected cabinet table with «Остаток на WB» and «На складе», retaining corrections/history, explicit publication to WB and shipment-only deduction. Without a selected cabinet, it requests cabinet selection. Previously stored quantities/history were not deleted or reseeded.

Live build and updated Chromium stock regression passed, including absence of the extra category switch, quantity editing/history, explicit publication and 1024px layout. Frontend-only release /opt/supplyo/releases/20261114-stock-columns-only-v1 published after backup /var/backups/supplyo/supplyo-20261114-212340.tar.gz. All 41 application files and public health/assets/APK/EXE verified. Backend unchanged, SHA256 4785d71657e56ee92e3e7149b0c1fa5a6cd25af54093fdc381520dab9f565fec. Previous release /opt/supplyo/releases/20261114-internal-stock-v1 is rollback target.

## Consistent dropdown chevrons (14 November 2026)

Moved the cabinet-specific native select arrow into shared controls.css for all native single-value selects, including lazy-loaded screens and portalled forms. All use the same 16px SVG chevron, right 12px, vertically centered, with 40px reserved text space. Multiple/listbox selects are excluded. Existing Radix/Lucide chevrons already share the same geometry. Removed duplicate cabinet arrow declarations; native selection behavior is retained.

Live build and Chromium stock regression passed. Computed-style checks covered cabinet/availability selects and stock, access, connection, Ozon, fulfillment and mobile select contexts; availability changes still work. Screenshot visually inspected. Published frontend-only /opt/supplyo/releases/20261114-select-arrows-v1 after backup /var/backups/supplyo/supplyo-20261114-212951.tar.gz. All 41 application files and public health/assets/APK/EXE verified. Backend unchanged, SHA256 4785d71657e56ee92e3e7149b0c1fa5a6cd25af54093fdc381520dab9f565fec. Previous stock-columns-only-v1 is rollback target. No business data changes.

## Fulfillment-owned price lists, service invoices and Excel (15 November 2026)

«Учёт → Счета → Прайс услуг» lets each fulfillment owner save its own service titles, units and prices. Stored in the existing owner-scoped workspace document kind `prices`, with subscription checks and independent optimistic versioning; no shared global price list and no prices for other accounts. The user will supply actual rates later, so no production price list was fabricated or seeded.

New invoice creation shows the saved price list with quantity inputs and a calculated total. Zero/unselected lines are excluded on save; quantities support three decimals and prices two decimals. Each line is rounded to kopecks using integer milliunit/kopeck arithmetic (including decimal ties such as 1.005 × 9 = 9.05), then line amounts are summed. Invoice items retain service name/unit/rate snapshots; changes/removals in the price catalog never silently reprice previously saved invoices. Backend validates totals and current prices for new lines; existing snapshots can be edited for quantity while retaining their historical rates. Existing manual invoices and receipt/payment-to-income behavior remain supported.

Invoices and linked invoice-payment income rows expose a real XLSX download with client, warehouse, date, number, due date, service lines, numeric quantities/prices, line formulas, cached results and total. Text is emitted as inline text, not executable formulas. The browser bundles `fflate` for ZIP packaging; production backend has no new runtime dependency. See docs/INVOICES.md.

Validation: all 30 server tests passed; final focused invoice/workspace tests, server typecheck, live build and invoice Chromium flow passed after refinements. Checks include separate mutable lists for two owners, stale writes/prices, forged totals, historical snapshots, decimal rounding, legacy invoices, real file download and reload persistence. Downloaded XLSX independently read with openpyxl in read-only verification: numeric values, formulas and cached totals match. Invoice UI screenshot visually inspected. Tests used isolated synthetic accounts/data; no production invoices/payments or prices were created.

Published /opt/supplyo/releases/20261115-invoices-v2 after backup /var/backups/supplyo/supplyo-20261115-132306.tar.gz. All 42 application files hash-verified; public health/assets, invoice CSS, APK and EXE checks passed. Backend SHA256 2ba2d88d794e8ce4767ed43c337b53f37edf12c663fd9ec6656b8452e522f8bf. Previous /opt/supplyo/releases/20261114-select-arrows-v1 is rollback target. Preserve saved prices/invoiceItems on rollback; older schemas must not save structured invoices because they could strip unknown fields.


## 2026-11-17: client service presets and Ozon KIZ retention
- Client presets: `/opt/supplyo/releases/20261117-client-services-v1`; owner/versioned clientServices workspace document, explicit per-client save, add/remove invoice services, quantity reset. All 30 server tests and browser invoice flow passed.
- Ozon retention: `/opt/supplyo/releases/20261117-ozon-retention-v1`; confirmed first packing completion plus 14 days, live units/history code cleanup once per minute, no WB changes. All 30 server tests passed; see docs/OZON-MARK-RETENTION.md for semantics and official references.


## 2026-11-17: marketplace switch and mandatory Ozon KIZ
Active release `/opt/supplyo/releases/20261117-market-switch-v1`; previous `/opt/supplyo/releases/20261117-ozon-retention-v1`. Backup `/var/backups/supplyo/supplyo-20261117-121605.tar.gz`. Backend SHA256 `2abc78ea2beb918c3d543434a871c0c24b92cac8dab1b3084661ab925d11aead`. All 42 deployed files verified; service and public assets healthy. 31 server tests passed plus WB scanner-focus, Ozon assembly and marketplace-switch Chromium regressions. No real marketplace mutations or paper printing during verification. Details in docs/OZON-MARK-RETENTION.md.


## 2026-11-17: unpaid client Ozon KIZ archive
Active `/opt/supplyo/releases/20261117-ozon-client-marks-v1`, previous `/opt/supplyo/releases/20261117-market-switch-v1`; backup `/var/backups/supplyo/supplyo-20261117-123410.tar.gz`. Backend SHA256 `47fd1c3ea15f0d28a2bb93ad710994f7638ce249ee4de768b98565995832b059`; 46 files verified, activation and public health/assets passed. Initial staging SFTP connection dropped; resumed only the inactive release and verified every file before activation. 33 server tests passed, plus Chromium unpaid archive/export, marketplace switch, WB scanner and Ozon assembly regressions. See docs/OZON-MARK-RETENTION.md.


## 2026-11-17: optional Ozon seller-name permission
Active `/opt/supplyo/releases/20261117-ozon-seller-role-v1`; previous `/opt/supplyo/releases/20261117-ozon-client-marks-v1`; backup `/var/backups/supplyo/supplyo-20261117-124619.tar.gz`. Backend SHA256 `87e7476cac19f66cc6f7df86d7f24e6011791a45bb17e325c534528015e47e8b`; 46 files verified, service/public checks passed. Production read-only diagnosis found seller/info HTTP403 missing role while warehouse/list and FBS/list both returned200. Seller info HTTP403 now falls back to Ozon · Client ID; warehouse/order authorization still validates the key, and 401/429/500 are not swallowed. 34 server tests passed. Retried only the affected failed initial connect job with the saved key; store reached ready, seller_id set, error null. No marketplace mutation requests or credential changes.


## 2026-11-17: private Ozon client labels
Active `/opt/supplyo/releases/20261117-client-labels-v1`; previous `/opt/supplyo/releases/20261117-ozon-seller-role-v1`; backup `/var/backups/supplyo/supplyo-20261117-125656.tar.gz`. Backend SHA256 `097bc03065308ac8ad2d52d19828dff6d18fdbd6f431a9f51514cf8bd3ab5cc6`; 46 files verified, service/public checks passed. 34 server tests plus browser alias save/reload, switch, desktop/mobile layout and unpaid Ozon marks passed. Final manual Ozon refresh name retry typechecked and focused Ozon suite passed. No production client names guessed or altered; aliases are user-controlled.

## 2026-11-18: complete Ozon workflows and automatic printing
Active release `/opt/supplyo/releases/20261118-ozon-auto-print-v1`, previous `20261118-ozon-delivery-marks-v1`. Backup `/var/backups/supplyo/supplyo-20261118-144718.tar.gz`. Backend SHA256 `33e631fdc28d554b91deb3fcd4b58772ccbd0a32dc94e8cd907d9677c5b8032a`. 47 published files and public/service health verified. Includes full catalog/warehouse stock, aliases/placement, confirmed stock publishing, per-unit assembly and catalog-required KIZ, client/FF per-posting marks archive, removal of marketplace header badges, and automatic completion/label printing with persisted deduplication. 37 server tests and browser auto-flow/reload/print/scanner regressions passed. Read-only production check: auto queue contained the user requested posting with quantity=ready=1. See HANDOFF-2026-11-18.md for exact behavior and limits.
