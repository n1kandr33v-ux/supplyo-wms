# Ozon KIZ retention

Implemented 17 November 2026. Codes are already stored in ozon_pick_units when scanned. assembled_at records the first confirmed awaiting_deliver/delivering/delivered observation, not the HTTP acceptance of a ship request. Subsequent polling and finish retries do not extend it. After 14 full days the local worker (once a minute, batches of 100 postings) clears kiz, previous_code and identity in pick units and removes these fields from all related pick-history snapshots. Order numbers, SKU, exemplar IDs and assembly status remain. No upstream request/deletion is made, and WB is untouched. Legacy packed postings use their existing updated_at as the conservative observation timestamp. Normal backup rotation is separate; deleting from the live database does not rewrite existing backup archives.

Official API references checked:
- https://dev.ozon.ru/start/301-Kak-sgenerirovat-kliuch-dlia-Seller-API
- https://dev.ozon.ru/start/300-Mapping-rolei-i-metodov-Seller-API/
- https://dev.ozon.ru/community/1269-Metody-dlia-raboty-so-spiskom-markirovok-FBS-rFBS/
- https://seller.ozon.ru/media/news/o-rabote-s-kodami-markirovki-na-fbs-i-realfbs/

The seller article dated 9 June 2026 says entering KIZ is optional for most FBS orders to individuals; B2B still requires it. This is distinct from whether the product itself is subject to mandatory marking. Existing user-requested scanning policy is not changed by the retention implementation. Official role mapping lists Posting FBS (write), Product read-only and Warehouse for the corresponding method families, but omits some newer endpoint versions and seller/info; Admin is documented as permitting all Seller API methods. A claim that the narrower combination is sufficient for every current integration endpoint requires a live key check.


## Mandatory transmission and marketplace switch (17 November)
Ozon assembly now uses fresh posting.requirements.products_requiring_mandatory_mark, product.is_mandatory_mark_needed and per-exemplar.is_mandatory_mark_needed. Catalog marking=true, optional.products_with_possible_mandatory_mark and is_mandatory_mark_possible do not force entry. Missing product requirements are rejected rather than inferred as false. Finish rechecks live requirements and verifies any submitted optional marks just like required ones. Catalog-marked optional products offer the KIZ action after a plain scan; no visible marking diagnostics were added. WB marking behavior is unchanged.

A WB/Ozon segmented switch sits in the common cabinet picker across orders/assembly/supplies/stocks. It filters cabinets, remembers the active market across reload, preserves the last selected cabinet for each market during the session, and shows a connection action when empty. Background store polling respects an empty active market. Browser regression tests cover filter/poll/reload/assembly switching and layouts at 1440, 1024 and 390 pixels.


## Client archive without subscription
`GET /api/stores/:id/ozon/marks` authenticates the store owner directly and requires an active (not removed) Ozon store. It deliberately has no subscription or fulfillment-grant dependency. Delegated FF/staff routes, other owners and WB IDs are rejected. SQL only returns scanned codes for confirmed assembled postings within the last 14 full days and not purged; expired/open postings are excluded even when the cleanup worker has not run. Cache-Control: no-store. Search/date filters (Moscow inclusive dates), 100-row pagination. No upstream API calls or writes.

Client UI: own Ozon store card → КИЗ Ozon, or Поставки → КИЗ. Unpaid owners can enter via Поставки; this exception does not unlock assembly or other paid views. Rows show assembly/expiry, posting, product/article, barcodes, raw-code copy. Selected postings export all matching codes across pages, not only visible rows. Real OOXML XLSX contains text identifiers and escaped GS controls; formula-like strings stay text. Max 10,000 rows per export, narrower filters required beyond that.

Validation: unpaid/foreign/FF/anonymous/WB/removed access, expiry before cleanup, paging/filter dates; XLSX structure/safety; Chromium free card entry, reload, clipboard payload stub, selected posting XLSX across pages, search and responsive page. Generated workbook independently read with openpyxl. No production test KIZ/marketplace writes.


## Ozon display labels
Owner and paid FF recipients can set a private label via POST /api/stores/:id/display-name (name max150; empty resets). It resolves canonical store access, rejects staff and WB, and persists per user/canonical store in store_labels. /stores exposes the private name plus original_name/custom_name; incoming client list uses the same label. Other account names are untouched and API sync never overwrites a label. The pencil in the cabinet picker and store-card Название клиента open the editor. The redundant Ozon prefix is removed from option labels. Manual Ozon full refresh also retries seller/info so newly granted permissions can recover the upstream name without reconnecting.

## КИЗ в отгрузках (18.11.2026)

В каждой строке отгрузки кнопка КИЗ раскрывает коды всех экземпляров с копированием исходной строки и выгрузкой Excel. Новый read-only endpoint `/api/stores/:id/ozon/postings/:posting/marks` проверяет доступ к магазину и складу на каждом запросе. Владельцу не нужна подписка; фулфилменту и сотрудникам нужен действующий доступ к этому складу. Чужой/отозванный доступ даёт 404. Пагинация 100 кодов, экспорт до 10000. До подтверждения сборки и после 14 дней коды не возвращаются. Общий бесплатный архив владельца сохранён. Во всех разделах удалена декоративная плашка Ozon рядом с заголовками. Проверены серверные права, отозванный доступ, срок хранения, пагинация, браузерное раскрытие и копирование.
