# Meeple Scope

Meeple Scope — фронтенд-приложение на `React 18 + TypeScript` для подбора настольных игр, анализа игровых предпочтений и обучения по конкретным играм. Проект реализован по требованиям курса: использует `TanStack Router`, `Zustand`, `CSS Modules`, строгую типизацию, отдельный слой API и полноценный CRUD.

## Что умеет приложение

- каталог настольных игр через локальный REST API
- большая локальная база на 20 000+ игр, сгенерированная из открытого BGG-датасета
- подбор игры по числу игроков, длительности партии, сложности и игровому DNA
- дашборд с рейтингами, трендами, статистикой и тематическими игровыми вечерами
- учебная страница по игре: AI-генерация объяснения правил и сценария вечера через локальную модель Ollama
- регистрация, вход, серверные сессии и уникальный идентификатор игрока
- рейтинг игроков, заявки в друзья с принятием второй стороной и лобби для сбора компании
- профиль пользователя и CRUD отзывов через локальный REST API

## API и хранение данных

- Основное хранение данных: `PostgreSQL`
- REST API: `Express` на `http://localhost:3001`
- База поднимается в Docker через `docker compose up -d`
- Большой каталог, профиль, отзывы и справочники лежат в таблицах PostgreSQL
- Пользователи, сессии, заявки в друзья, дружбы и составы лобби тоже хранятся в PostgreSQL
- Источник первичного сидирования: открытый BGG CSV-датасет `https://github.com/jalwz17/Board-Game-Data-Analysis`
- JSON-файл с базой не используется: сидирование идет напрямую из `data/bgg_dataset.csv` в PostgreSQL

## Разделение backend и frontend

Frontend находится в `src/` и ходит только в локальный backend через `VITE_LOCAL_API`.

Backend находится в `server/`: он открывает REST endpoints, работает с PostgreSQL через `pg`, хранит сессии и бизнес-логику. Внешние источники, например BoardGameGeek XML API2 для генератора обучения, вызываются только на backend.

## AI для правил и сценариев

Генерация не является заглушкой: frontend вызывает `POST /ai/learning-plan`, сервер берёт игру из PostgreSQL, дополняет контекст через BoardGameGeek XML API2 и отправляет промпт в локальный Ollama.

Рекомендуемая лёгкая модель:

```powershell
ollama pull qwen2.5:1.5b
```

Если нужна другая модель или Ollama запущен на другом адресе:

```powershell
$env:OLLAMA_MODEL='qwen2.5:1.5b'
$env:OLLAMA_HOST='http://127.0.0.1:11434'
$env:OLLAMA_TIMEOUT_MS='240000'
npm run api
```

BoardGameGeek XML API2 может требовать application token. Если он есть, можно передать его серверу:

```powershell
$env:BGG_API_TOKEN='ваш_token'
npm run api
```

Без токена генератор всё равно работает, но использует только локальные данные PostgreSQL и не притворяется официальной книгой правил.

Если Ollama не запущен, страница обучения покажет ошибку вместо подмены результата статичным текстом.

## AI-НРИ чат с ведущим

В проект добавлена страница `AI НРИ` по адресу `/rpg`: генерация кампании по теме, выбор персонажа, игровой чат, команды `/state`, `/character`, `/quests`, `/turns`, `/recap`, `/map`, `/inventory`, `/help`, боковая панель состояния и Leaflet-карта с перемещением токена игрока.

Backend хранит состояние игры в PostgreSQL и остаётся источником истины: LLM получает только system prompt, актуальный `game_state`, скрытое состояние ведущего, summary, последние сообщения и защищённую обёртку действия игрока. `STATE_PATCH` не показывается пользователям и применяется только после Zod-валидации.

Для генерации кампаний и ответов ведущего используется DeepSeek через OpenAI-compatible API. Добавь в `.env`:

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

Ключ DeepSeek используется только backend-ом. Если ключ не задан, endpoint генерации вернёт понятную `503` ошибку.

## Демо-аккаунты

После `npm run db:seed` доступны аккаунты:

| Почта                | Пароль     | Идентификатор |
| -------------------- | ---------- | ------------- |
| `maria@example.com`  | `demo1234` | `1000000001`  |
| `artem@example.com`  | `demo1234` | `1000000002`  |
| `lena@example.com`   | `demo1234` | `1000000003`  |
| `nikita@example.com` | `demo1234` | `1000000004`  |

Друзья добавляются через страницу `Вход` → `Игроки`: нужно найти пользователя по идентификатору и отправить заявку. Заявка появляется только у найденного пользователя во входящих, после принятия игрок становится доступен для приглашения в лобби.

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Запустить PostgreSQL через Docker:

```bash
docker compose up -d
```

3. Создать таблицы и импортировать данные:

```bash
npm run db:migrate
npm run db:seed
```

4. В одном терминале запустить REST API:

```bash
npm run api
```

5. Во втором терминале запустить фронтенд:

```bash
npm run dev
```

6. Для проверки линтера:

```bash
npm run lint
```

## Как посмотреть базу

Через pgAdmin:

```text
URL: http://localhost:5050
Email: admin@meeplescope.dev
Password: 227291
```

В pgAdmin добавь сервер с такими параметрами:

```text
Name: BoardGameProject
Host: postgres
Port: 5432
Database: boardgameproject
Username: boardgame
Password: boardgame
```

Быстрая проверка без pgAdmin:

```bash
docker compose exec postgres psql -U boardgame -d boardgameproject -c "select count(*) from games;"
```

## Архитектура папок

```text
src/
  app/          # роутер, layout, точка входа
  entities/     # типы, сервисы и хуки доменных сущностей
  features/     # state manager и логика подбора
  pages/        # страницы маршрутов
  shared/       # api-клиенты, утилиты и переиспользуемый UI
server/         # Express API, PostgreSQL schema, миграция и сидирование
data/           # исходный CSV-датасет для PostgreSQL seed
```

Подробная сверка с требованиями лежит в [REQUIREMENTS_IMPLEMENTATION.md](./REQUIREMENTS_IMPLEMENTATION.md).

## Почему Zustand

`Zustand` выбран для хранения предпочтений пользователя в подборе, потому что здесь нужен компактный стейт без сложных асинхронных редьюсеров и шаблонного кода. Для этой задачи он проще и легче объясняется на защите, чем Redux Toolkit, и даёт более явную модель, чем Jotai, когда нужно хранить несколько связанных параметров подбора в одном месте.
