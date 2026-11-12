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
