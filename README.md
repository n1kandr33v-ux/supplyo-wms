# supply WMS

Рабочая WMS для WB/Ozon, фулфилментов и сотрудников: серверная авторизация, магазины/склады, FBS-заказы, сборка, КИЗ, этикетки, остатки, делегирование и учёт. React/TypeScript/Vite + Fastify/TypeScript; PostgreSQL в production, PGlite локально.

**После переустановки Windows начните с [START-HERE.md](START-HERE.md).**

- [Промпт для нового чата](PROMPT-FOR-NEW-CHAT.md)
- [Актуальное состояние и договорённости](docs/HANDOFF-2026-11-18.md)
- [Восстановление окружения и данных](docs/RESTORE-AFTER-WINDOWS.md)
- [История публикаций и проверок](DEPLOYMENT.md)
- [Редактируемая схема](docs/site-map/Supplyo-full-site.drawio)
- [Просмотр схемы](docs/site-map/Supplyo-map-preview.html)
- [Android](android-app/README.md), [Windows Print Agent](print-agent/windows/README.md)

## Локальный запуск

Node.js 24:

```sh
npm ci
npm run start:live
```

Открыть http://127.0.0.1:8095. `npm run dev` без live запускает исторический прототип. Локальная база отдельная, тестовая подписка не списывает деньги. WB/Ozon с настоящими ключами выполняют настоящие операции.

```sh
npm run check:server
npm run test:server
npm run build:live
```

Production: https://77-87-212-236.sslip.io/ . Данные production и секреты не входят в Git. Архив восстановления хранится отдельно приватно. Не разворачивать локальную БД поверх VPS.

Ozon проверен синтетическими сценариями; реальная приёмка магазина и бумажная печать отдельно. Биллинг тестовый. Подробные ограничения — в актуальном handoff.
