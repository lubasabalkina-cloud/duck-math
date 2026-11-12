# FREE SEVER — комнаты для друзей

Сервер опубликован: https://free-sever-friends.onrender.com — WebSocket /ws, health /health.
Render service: srv-dbq3kk8ae00c73d7fq2g; workspace tea-dbpr8115efls738q1ff0. Бесплатный план, один экземпляр, автоматическая публикация выключена.
Исходник: https://github.com/lubasabalkina-cloud/duck-math/tree/free-sever-friends/friends-server

Командный deathmatch на Oasis/Dune, до четырёх игроков, по два в команде. Случайный код комнаты, проверка команд и комнаты, heartbeat, ограничения сообщений. Комнаты хранятся в памяти и исчезают после перезапуска. Пустые комнаты очищаются через 5 минут.

Кнопка «С друзьями» встроена в игру; отдельный вход /games/clutcher/rooms.html. Обычные игры с ботами не подключаются к комнате. Другие игры не изменены.

## Проверено
Два теста npm test прошли локально и против опубликованного WSS сервера: создание, приглашение, состав, движение, попадания, изоляция комнат, лимиты команд, выход, неизвестная комната, повреждённый JSON, неверный Origin.

## Ограничения проверки
Полный 3D-матч двух игроков, респаун и экипировка не проверены: браузер QA не создаёт WebGL context. Наличие рабочего relay не означает завершённую проверку игрового процесса. Нужна проверка двух браузеров с WebGL.
Это дружеский режим с клиентским расчётом попаданий, не сервер с соревновательной защитой. Bomb Defusal не включён: требует синхронизации бомбы, раундов и таймера.

## Развёртывание
Node 22+. Build: npm ci --prefix friends-server && npm test --prefix friends-server. Start: node friends-server/server.mjs. PORT задаёт Render; ALLOWED_ORIGINS содержит только два домена FREE SEVER.
Сетевой клиент адаптирован из https://github.com/Kuzmaeth/clutcher/blob/main/multiplayer-client.js.

## Обновление: общие боты
Включаемая при создании комнаты опция botFill заполняет места до двух участников в каждой команде. 1/2/3/4 человека = 3/2/1/0 ботов. Сервер назначает первого участника ведущим симуляции AI; остальные получают общие состояния и события. При выходе ведущего сервер меняет epoch и передаёт последнему состоянию нового ведущего. Старый ведущий не может публиковать события.
Обычный одиночный режим сохранён. Боты используют оригинальную AI, модели, оружие, столкновения и респаун. Переход на другого ведущего сохраняет положение/здоровье, но внутренний план AI и таймер респауна восстанавливаются заново. Фоновая/замороженная вкладка ведущего может замедлить ботов; это ограничение браузерной симуляции.
Тесты: 3 серверных WebSocket сценария + 2 сценария настоящего клиентского модуля в VM с подставным рендерером, включая замену ботов и смену ведущего. Это не полноценная проверка 3D-матча: WebGL в браузере QA недоступен.

## 5 на 5
Лимиты обновлены: 10 участников, по 5 в команде. 1 человек + 9 ботов, 2 + 8, 10 + 0. Тест проверяет заполнение всех десяти мест, отклонение 11-го и восстановление бота при выходе. Ограничена общая частота косметических выстрелов ботов, чтобы 9 ботов не переполняли лимит сообщений.

## Bomb defusal (version 24)
New rooms created by the UI use `mode: defusal`. Existing DM clients remain compatible.
The relay owns round/score/bomb transitions; a single elected browser still simulates bots.
5v5, vacant places filled by bots, one C4, 15s freeze, 115s round, 40s bomb,
3.2s plant, 10s defuse / 5s with kit, first to 13 wins, fixed teams (no halftime swap).
Players joining a running round wait for the next one. Death cannot be undone by a later state packet.
800 starting money; original weapon purchase/price/buy-zone checks are used, with 20s live buy window.
`defusal-test.mjs` verifies the state machine; `test.mjs` exercises actual WebSockets.
`engine-test.mjs` runs the actual shipped mode controller and purchase code when the site bundle is available (skipped on the relay-only Render checkout).
This is a casual private-room protocol, not an anti-cheat server. A Render restart removes rooms.
Full WebGL match verification must be performed on a browser with working WebGL.
