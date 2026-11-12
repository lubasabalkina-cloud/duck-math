(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const endpoint = window.FREE_SEVER_FRIENDS_ENDPOINT;
  if (typeof endpoint !== 'string' || !/^wss:\/\//.test(endpoint)) throw new Error('Friends server is not configured');
  // The bundle's playerName() reads 'clutcher_name' (written by the settings
  // menu); this client used to read only 'clutcher_mp_name'. Two keys meant the
  // local row showed "Player" while the remote showed a per-profile random, so
  // the same human had a different name on every client. Read the game's key
  // too, and write both so the settings menu and the relay never disagree.
  const requestedName = params.get('name')
    || localStorage.getItem('clutcher_name')
    || localStorage.getItem('clutcher_mp_name')
    || '';
  const name = (requestedName || `Player-${Math.random().toString(36).slice(2, 7)}`)
    .replace(/[<>&\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Player';
  localStorage.setItem('clutcher_mp_name', name);
  localStorage.setItem('clutcher_name', name);

  const STATE_PUBLISH_INTERVAL_MS = 1000 / 15;
  // Damage we have personally dealt to each peer this round, pending a kill.
  // A hit is credited on emit; the KILL is claimed when that peer's own
  // published health reaches zero, because the victim owns health and we cannot
  // decide it ourselves.
  const pendingNetDamage = new Map();

  function claimPendingKill(peerId) {
    if (!peerId) return;
    const p = game && game.player;
    if (!p) return;
    // The delete IS the double-count guard: this runs on the alive edge, which
    // fires once per transition, and a peer with no pending entry cannot have
    // been damaged by us. A permanent "already claimed" set used to cap every
    // peer at one kill for the whole session.
    const entry = pendingNetDamage.get(peerId);
    if (!entry) return;
    pendingNetDamage.delete(peerId);
    p.kills = (p.kills || 0) + 1;
    p._hsKills = (p._hsKills || 0) + (entry.head ? 1 : 0);
  }

  // Peer ids this client has been credited with an assist for, this round. The
  // victim is the only side that can compute it (it holds _dmgBy), so it
  // publishes the list and we credit ourselves from it exactly once each.
  // Exposed to the game bundle: called from sendNetHit in main.js the instant
  // the local player lands a shot on a peer. Credits our own damage immediately;
  // the kill follows from the peer's published health in the state handler.
  function noteLocalHit(peerId, damage, headshot) {
    if (!peerId || !game || !game.player) return;
    const p = game.player;
    const amount = Math.max(0, Math.round(Number(damage) || 0));
    if (amount > 0) {
      p._dmgDealt = (p._dmgDealt || 0) + amount;
      p._roundDmg = (p._roundDmg || 0) + amount;
    }
    const entry = pendingNetDamage.get(peerId) || { amount: 0, head: false };
    entry.amount += amount;
    entry.head = entry.head || !!headshot;
    pendingNetDamage.set(peerId, entry);
  }

  const assistCredits = new Set();
  let shotWindowStart = 0;
  let shotCount = 0;
  // A `hit` frame is gameplay, not movement, and arrives per bullet rather than
  // per tick. One relay-broadcast hit can only be authored by an actual shot, so
  // a burst far above that is a flooding peer. Bucket-based (not a single window)
  // so a peer cannot spend 200 in one burst and stall for the next second.
  const HIT_BURST_LIMIT = 12;
  const HIT_WINDOW_MS = 250;
  // Money cap for the defusal ruleset (Do.maxMoney = 0x3e80, main.js:12997).
  // Published for display only; the relay clamps again.
  const MAX_MONEY = 16000;
  // Remote peers publish at 15 Hz; rendering is an uncapped requestAnimationFrame
  // (~60 Hz), so the body must be lerped between the last two snapshots or it
  // steps once per packet. The one-publish-interval delay is NOT a tunable
  // constant: it emerges from the 2-deep buffer. Raising it to 2 intervals with
  // only 2 snapshots freezes the body permanently at prev.
  // A snapshot gap wider than this means the peer stalled or the tab was hidden.
  // Sweeping linearly across it would drag the body through walls.
  const NETWORK_MAX_SPAN_MS = STATE_PUBLISH_INTERVAL_MS * 3;
  const ROOM_STATUS_INTERVAL_MS = 4000;
  const BLOCKED_JOIN_TTL_MS = 15000;
  // Same 10 s as the engine's 0x2710 admit timer, but they are independent and
  // can BOTH fire: the engine announces "JOIN TIMED OUT" first, then this rejects
  // and the .catch announces the same text again. Harmless, but expect the double.
  const ADMISSION_TIMEOUT_MS = 10000;
  const HANDSHAKE_TIMEOUT_MS = 8000;
  const DEFAULT_WATCHED_ROOMS = ['oasis-01', 'oasis-02', 'dune-01'];
  const socketState = { socket: null, connected: false, joinedRoom: '', joinedTeam: '', attempt: 0, closing: false, selfId: '' };
  const players = new Map();
  const bound = new Map();
  const roomStatuses = new Map();
  const roomListeners = new Set();
  const pendingAdmissions = new Map();
  const blockedJoinKeys = new Map();
  let watchedRooms = [...DEFAULT_WATCHED_ROOMS];
  let game = null;
  let lastStateSent = 0;
  let lastJoinKey = '';
  let pendingJoinKey = '';
  let handshakeTimer = 0;
  let admissionSequence = 0;
  let latestRequestId = '';
  let hitWindowStart = 0;
  let hitCount = 0;
  let damageEntryMissing = false;
  let matchContext = { kind: 'bots', room: '', map: '', mode: 'defusal' };
  let statusElement = null;
  let statusLine = { text: 'starting', tone: 'warn' };
  // Single sanitizer for every room identifier on this client. The relay keys a
  // roster purely on the room string, so the lobby's setRoom, main.js's
  // setMatchContext, the ?room= URL parameter and the generated public-room
  // fallback must all normalize identically.
  function sanitizeRoom(value) {
    return (value === null || value === undefined ? '' : String(value))
      .replace(/[^a-z0-9_-]/gi, '').slice(0, 32).toLowerCase();
  }
  function normalizeMapId(value) {
    return String(value || 'unknown').slice(0, 32);
  }
  function normalizeMode(value) {
    return value === 'dm' ? 'dm' : 'defusal';
  }
  // F3: the one join-guard key. ensureJoined() and joinRequest() must agree or the
  // client re-joins every poll and churns every bound remote entity.
  function joinKey(room, map, mode, team) {
    return `${sanitizeRoom(room)}|${normalizeMapId(map)}|${normalizeMode(mode)}|${team}`;
  }

  let selectedRoom = sanitizeRoom(params.get('room'));
  function setRoom(value) {
    const next = sanitizeRoom(value);
    // F4: re-clicking the same lobby card is how a player retries a "team is
    // full" soft-lock, and the early return used to skip the cache clear
    // entirely, so the stale block survived for the full BLOCKED_JOIN_TTL_MS.
    // None of these three decide which room is sent, and the relay re-checks
    // capacity regardless.
    if (next === selectedRoom) {
      lastJoinKey = '';
      pendingJoinKey = '';
      blockedJoinKeys.clear();
      return;
    }
    selectedRoom = next;
    lastJoinKey = '';
    pendingJoinKey = '';
    blockedJoinKeys.clear();
  }

  function watchRooms(rooms) {
    const names = (Array.isArray(rooms) ? rooms : [])
      .map((room) => String(room || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32).toLowerCase())
      .filter(Boolean);
    watchedRooms = names.length ? [...new Set(names)] : [...DEFAULT_WATCHED_ROOMS];
    roomStatuses.clear();
    if (socketState.connected) requestRoomStatus();
    notifyRoomStatus();
  }

  function setMatchContext(value) {
    if (!value || value.kind !== 'multiplayer') {
      // F1: the explicitly chosen room survives this transition. Blanking it here
      // repoints a live session at the generated public-room name below, so the two
      // clients sit in healthy one-player rosters that never exchange a message.
      matchContext = { kind: 'bots', room: '', map: '', mode: 'defusal' };
      lastJoinKey = '';
      pendingJoinKey = '';
      blockedJoinKeys.clear();
      updateStatusLine();
      return;
    }
    // An empty incoming room must not erase an explicit choice either.
    const room = sanitizeRoom(value.room) || selectedRoom;
    matchContext = {
      kind: 'multiplayer',
      room,
      map: normalizeMapId(value.map),
      mode: normalizeMode(value.mode),
    };
    selectedRoom = room;
    lastJoinKey = '';
    pendingJoinKey = '';
    blockedJoinKeys.clear();
    updateStatusLine();
  }

  function clearMatchContext() {
    clearLocalBots();botEntries=[];botHostId='';botRoom='';roundState=null;
    send({type:'leave'});
    players.clear(); releaseAll();
    setMatchContext(null);
  }

  function roomStatusDefaults(room) {
    return {
      room,
      map: matchContext.map || 'unknown',
      mode: matchContext.mode || 'defusal',
      players: 0,
      teamCounts: { CT: 0, T: 0 },
      roomLimit: 10,
      teamLimit: 5,
      ready: false,
    };
  }

  function notifyRoomStatus() {
    for (const listener of roomListeners) {
      try { listener([...roomStatuses.values()]); } catch {}
    }
  }

  function unblockStaleJoinKeys(summary) {
    const now = Date.now();
    for (const [key, entry] of blockedJoinKeys) {
      if (now - entry.at > BLOCKED_JOIN_TTL_MS) {
        blockedJoinKeys.delete(key);
        continue;
      }
      if (summary && entry.room === summary.room) {
        const count = entry.team === 'T' ? summary.teamCounts.T : summary.teamCounts.CT;
        if (count < summary.teamLimit) blockedJoinKeys.delete(key);
      }
    }
  }

  function updateRoomStatus(summary) {
    if (!summary || !summary.room) return;
    roomStatuses.set(summary.room, { ...roomStatusDefaults(summary.room), ...summary });
    unblockStaleJoinKeys(roomStatuses.get(summary.room));
    notifyRoomStatus();
    updateStatusLine();
  }

  function requestRoomStatus(rooms) {
    const names = Array.isArray(rooms) && rooms.length
      ? rooms
      : watchedRooms;
    send({ type: 'room_status', rooms: names });
  }

  function getRoomStatus(room) {
    return roomStatuses.get(room) || roomStatusDefaults(room);
  }

  function isRoomReady(room) {
    const status = getRoomStatus(room);
    return status.ready===true;
  }

  function canJoinTeam(team, room) {
    const status = getRoomStatus(room || selectedRoom);
    return (team === 'T' ? status.teamCounts.T : status.teamCounts.CT) < status.teamLimit;
  }

  function onRoomStatus(listener) {
    if (typeof listener !== 'function') return () => {};
    roomListeners.add(listener);
    listener([...roomStatuses.values()]);
    return () => roomListeners.delete(listener);
  }

  function joinRequest(team) {
    const context = matchContext.kind === 'multiplayer' ? matchContext : null;
    if (!context || !socketState.connected) return Promise.reject(new Error('Multiplayer relay is not connected.'));
    if (!canJoinTeam(team, context.room)) return Promise.reject(new Error(`${team} is full.`));
    const key = joinKey(context.room, context.map, context.mode, team);
    for (const pending of pendingAdmissions.values()) {
      if (pending.key === key) return new Promise((resolve, reject) => {
        pending.extra.push({ resolve, reject });
      });
    }
    const requestId = `admission-${Date.now()}-${++admissionSequence}`;
    latestRequestId = requestId;
    return new Promise((resolve, reject) => {
      const entry = { requestId, resolve, reject, key, team, room: context.room, extra: [], timer: 0 };
      pendingAdmissions.set(requestId, entry);
      // F5: client-side backstop. settleAdmission() is the only other thing that
      // settles this promise, and it is reached only from an `admission` or an
      // `error` frame. A relay that already holds this socket in this room and
      // this team answers with a bare `roster`, so the promise — and every later
      // click chained onto entry.extra — would hang forever. The engine's 10 s
      // timer only prints a message; it never rejects or drops the entry.
      entry.timer = setTimeout(() => {
        if (pendingAdmissions.get(requestId) !== entry) return;
        pendingAdmissions.delete(requestId);
        entry.timer = 0;
        const error = new Error('Timed out waiting for the relay to confirm the team join.');
        entry.reject(error);
        for (const extra of entry.extra || []) extra.reject(error);
        if (socketState.connected && latestRequestId === requestId) setStatus(error.message, 'warn');
      }, ADMISSION_TIMEOUT_MS);
      send({ type: 'join', requestId, room: context.room, name, team, map: context.map, mode: context.mode });
      setStatus(`requesting ${team} in ${context.room}`, 'warn');
    });
  }

  function settleAdmission(message) {
    const pending = pendingAdmissions.get(message.requestId);
    if (!pending) return;
    pendingAdmissions.delete(message.requestId);
    if (pending.timer) { clearTimeout(pending.timer); pending.timer = 0; }
    const settles = [{ resolve: pending.resolve, reject: pending.reject }, ...(pending.extra || [])];
    if (message.type === 'error') {
      const error = new Error(message.message || 'Team join failed.');
      for (const settle of settles) settle.reject(error);
      return;
    }
    lastJoinKey = pending.key;
    pendingJoinKey = '';
    for (const settle of settles) settle.resolve(message);
  }

  function currentMatch() {
    if (matchContext.kind !== 'multiplayer' || !game || game.state !== 'playing' || !game.map) return null;
    return {
      map: normalizeMapId(game.map.id),
      mode: normalizeMode(game.mode),
      team: game.player && game.player.team === 'T' ? 'T' : 'CT',
    };
  }

  // F1: this must be the very room joinRequest() sent, in this order — committed
  // match room, then explicitly chosen room, then the generated public room.
  // Recomputing the fallback independently is what split two players into two rooms.
  function roomFor(match) {
    if (matchContext.kind === 'multiplayer' && matchContext.room) return matchContext.room;
    if (selectedRoom) return selectedRoom;
    return `${normalizeMode(match.mode)}-${normalizeMapId(match.map)}-public`;
  }

  function admitTeam(team) {
    return joinRequest(team === 'T' ? 'T' : 'CT');
  }

  function paintStatus(message, tone) {
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'mp-status';
      statusElement.style.cssText = [
        'position:fixed', 'left:12px', 'bottom:12px', 'z-index:9999',
        'padding:7px 10px', 'border:1px solid rgba(255,255,255,.18)',
        'border-radius:6px', 'background:rgba(8,12,16,.82)', 'color:#dce8ef',
        'font:600 12px/1.25 system-ui,sans-serif', 'pointer-events:none',
        'box-shadow:0 4px 18px rgba(0,0,0,.28)', 'max-width:min(420px,80vw)',
      ].join(';');
      document.body.appendChild(statusElement);
    }
    statusElement.textContent = `MULTIPLAYER · ${message}`;
    statusElement.style.color = tone === 'ok' ? '#67e8a7' : tone === 'warn' ? '#ffd166' : '#ff7b8a';
  }

  function setStatus(message, tone) {
    statusLine = { text: message, tone };
    updateStatusLine();
  }

  function warmupHold() {
    if (matchContext.kind !== 'multiplayer' || !socketState.connected) return null;
    if (!currentMatch()) return null;
    const status = getRoomStatus(matchContext.room);
    if (status.ready) return null;
    return status;
  }

  function updateStatusLine() {
    const warmup = warmupHold();
    if (warmup) {
      paintStatus(`WAITING FOR PLAYERS · CT ${warmup.teamCounts.CT} · T ${warmup.teamCounts.T}`, 'warn');
      return;
    }
    paintStatus(statusLine.text, statusLine.tone);
  }

  function send(message) {
    const socket = socketState.socket;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  // Peer ids that damaged ME enough to earn an assist. Only the victim holds
  // _dmgBy, so only the victim can compute this; the shooter credits itself
  // from the published list, at most once per peer per round.
  function computeAssistsFor() {
    const player = game && game.player;
    const by = player && player._dmgBy;
    if (!by || typeof by.forEach !== 'function') return [];
    const out = [];
    by.forEach((amount, attacker) => {
      if ((amount || 0) < 0x28) return;
      const id = attacker && attacker._networkPlayerId;
      if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
    });
    return out.slice(0, 16);
  }

  function playerState() {
    const match = currentMatch();
    const player = game && game.player;
    if (!match || !player) return null;
    assistCredits.clear();
    // `weapon` is the local player's CURRENT weapon (game.weapons.current), not a
    // lookup into the V table: the relay whitelists the id and the main.js
    // consumer does V[id] itself. `money` is the local entity's, so the scoreboard
    // bind is live without a second round trip.
    const weapon = game.weapons && game.weapons.current;
    // money is tri-state on the wire: a real amount, or null for "not known yet"
    // (main.js's scoreboard renders an em-dash for null). Coercing a missing
    // value to 0 here would claim a real $0 and pin the board to it.
    const rawMoney = Number(player.money);
    const money = Number.isFinite(rawMoney)
      ? Math.max(0, Math.min(MAX_MONEY, Math.round(rawMoney)))
      : null;
    return {
      type: 'state', map: match.map, mode: match.mode, team: match.team,
      state: {
        round:game.modeCtl?._networkRound||0,use:game.modeCtl?._netUse===true,kit:game.modeCtl?.playerKit===true,
        x: player.x, y: player.y, z: player.z,
        vx: player.vx || 0, vy: player.vy || 0, vz: player.vz || 0,
        yaw: player.yaw || 0, pitch: player.pitch || 0,
        health: Math.max(0, Math.min(100, player.health || 0)),
        armor: Math.max(0, Math.min(100, player.armor || 0)),
        alive: player.alive !== false, onGround: player.onGround === true,
        crouch: player.crouching === true || (player.crouchT || 0) > 0,
        weapon: typeof weapon === 'string' ? weapon : 'knife',
        money,
        // Shooter-owned scoreboard counters. The victim used to write these onto
        // a private replica of us, so we saw 0 while the other player saw a
        // number only they could see. We publish them ourselves now.
        kills: statOf(player.kills),
        deaths: statOf(player.deaths),
        assists: statOf(player.assists),
        hsKills: statOf(player._hsKills),
        dmgDealt: statOf(player._dmgDealt),
        assistsFor: computeAssistsFor(),
      },
    };
  }

  // A scoreboard counter, clamped to what the relay will accept anyway.
  function statOf(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(99999, Math.round(n)));
  }

  function ensureJoined() {
    const match = currentMatch();
    if (!match || !socketState.connected) return;
    const room = roomFor(match);
    const key = joinKey(room, match.map, match.mode, match.team);
    if (lastJoinKey === key || pendingJoinKey === key || blockedJoinKeys.has(key)) return;
    pendingJoinKey = key;
    // F3: only tear down bound entities when the room or team actually changed.
    // A re-join forced by a reset guard key must not destroy and recreate every
    // remote, which is invisible by construction.
    if (socketState.joinedRoom !== room || socketState.joinedTeam !== match.team) {
      players.clear();
      releaseAll();
    }
    socketState.joinedRoom = room;
    socketState.joinedTeam = match.team;
    send({ type: 'join', room, name, team: match.team, map: match.map, mode: match.mode });
    setStatus(`connecting to ${room}`, 'warn');
  }

  function interpolateAngle(current, target, amount) {
    return current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * amount;
  }

  // Ground height for the death rest-lift, matching the bundle's resolution
  // order at main.js:34041-34051.
  function groundFor(game, x, y, z) {
    let h = -20;
    try {
      if (game.physics && game.physics.groundHeight) h = game.physics.groundHeight(x, y + 1.2, z);
    } catch {}
    if (h > -20 && game.map && game.map.visualGround) {
      const v = game.map.visualGround(x, z, h);
      if (v != null) return v;
    }
    return h > -20 ? h : y;
  }

  function updateNetworkBot(bot, dt) {
    const target = bot._networkTarget;
    if (!target) return;
    const amount = 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * 14);
    // Interpolate between the last two arrival-stamped snapshots, one publish
    // interval behind the newest one. Velocity is deliberately unused: dead
    // reckoning overshoots on every strafe change, and at 15 Hz there is always a
    // newer real sample. Never extrapolate — alpha is clamped, so a stalled peer
    // simply freezes at its last known position.
    const span = target.at - target.prevAt;
    const canLerp = !!(target.prev && span > 0 && span <= NETWORK_MAX_SPAN_MS);
    let x = target.x;
    let y = target.y;
    let z = target.z;
    let yaw = target.yaw;
    if (canLerp) {
      // Monotonic render clock. Advancing by dt (rather than reading the wall
      // clock) is what makes a LATE packet glide instead of pop: the clock simply
      // keeps sweeping the same segment. Clamped to [prevAt, at] so a peer that
      // stops publishing freezes at its last real position rather than running on.
      let renderT = typeof bot._renderT === 'number' ? bot._renderT : target.prevAt;
      if (renderT < target.prevAt) renderT = target.prevAt;
      // dt is SECONDS (game time); the snapshot stamps are MILLISECONDS
      // (performance.now()). Adding them raw advanced renderT by 0.005 per frame
      // instead of 5, so alpha never left ~0 and the body rendered one snapshot
      // behind - the exact 0.33 m-per-packet step this change was meant to remove.
      renderT = Math.min(renderT + dt * 1000, target.at);
      bot._renderT = renderT;
      const alpha = Math.max(0, Math.min(1, (renderT - target.prevAt) / span));
      x = target.prev.x + (target.x - target.prev.x) * alpha;
      y = target.prev.y + (target.y - target.prev.y) * alpha;
      z = target.prev.z + (target.z - target.prev.z) * alpha;
      yaw = interpolateAngle(target.prev.yaw, target.yaw, alpha);
    } else if (target.prev) {
      // Gap too wide to interpolate across: fall back to the exponential
      // catch-up rather than dragging the body in a straight line. Re-seed the
      // render clock so the next segment starts from this position.
      x = bot.x + (target.x - bot.x) * amount;
      y = bot.y + (target.y - bot.y) * amount;
      z = bot.z + (target.z - bot.z) * amount;
      bot._renderT = target.at;
    }
    // No `prev` means the entity was hard-snapped in bindPlayer this frame.
    bot.x = x;
    bot.y = y;
    bot.z = z;
    // In the lerp branch yaw is already time-exact; applying the exponential on
    // top would leave it ~71 ms behind position, so aim desyncs from movement.
    bot.yaw = canLerp ? yaw : interpolateAngle(bot.yaw, yaw, amount);
    bot.pitch = target.pitch;
    bot._lookPitch = target.pitch;
    bot.vx = target.vx; bot.vy = target.vy; bot.vz = target.vz;
    bot.health = target.health; bot.armor = target.armor;
    bot.onGround = target.onGround;
    bot.crouchT = target.crouch ? 0.2 : 0;
    bot._visY = bot.y;
    if (bot.alive !== target.alive) {
      // The peer owns its own health, so a kill is claimed the moment it reports
      // dead - not decided by us. Only fires if we have damage pending on it.
      const wentDown = !target.alive && bot.alive;
      if (!target.alive) claimPendingKill(bot._networkPlayerId);
      bot.alive = target.alive;
      // A peer's death must run the elimination check HERE too. The shooter
      // never gets killEntity() - dealDamage() early-returns for a network
      // target (main.js:54781) - so onKill() and therefore the team-wipe test
      // only ever ran on the VICTIM's client. The killer's client sat in 'live'
      // with a dead enemy until its own 115 s clock expired, which is why the
      // winning shooter never respawned. Each client evaluates this against its
      // own economy, so both are meant to reach roundEnd independently.
      if (wentDown) {
        try {
          const mc = game && game.modeCtl;
          if (mc && typeof mc.onKill === 'function') mc.onKill();
        } catch (error) { void error; }
      }
      bot.deathAnimT = 0;
      if (bot.cs2Agent) {
        if (target.alive) {
          // New life, new round for this pairing: damage we banked before their
          // death must not be available to claim a kill after they respawn.
          pendingNetDamage.delete(bot._networkPlayerId);
          if (bot.cs2Agent.revive) bot.cs2Agent.revive();
          bot.cs2Agent.root.visible = true;
          bot._netDeath = null;
        } else {
          // Mirror the bundle's bot death (main.js:34024-34058) by hand. bot.die()
          // is NOT called here on purpose: it also runs respawn timers, drops
          // weapons and plays local audio, none of which are ours to do for a
          // peer. Without this the model was hidden on the first frame and the
          // player simply vanished.
          const dur = bot.cs2Agent.die ? (bot.cs2Agent.die('chest', bot.crouchT > 0, false) || 0) : 0;
          const ground = groundFor(game, bot.x, bot.y, bot.z);
          bot._netDeath = {
            t: 0,
            dur: dur || 0.6,
            rest: dur && bot.cs2Agent.restLift
              ? (bot.cs2Agent.restLift(game.effects && game.effects.groundAt) || 0)
              : 0,
            y: ground,
          };
        }
      }
    }
    if (!target.alive && bot._netDeath && bot.cs2Agent) {
      const d = bot._netDeath;
      d.t += dt;
      if (d.t < d.dur + 0.35) {
        // smoothstep the rest lift, same curve the bundle uses at main.js:34218
        const k = d.dur > 0 ? Math.min(1, Math.max(0, d.t / d.dur)) : 1;
        const lift = d.rest * k * k * (3 - 2 * k);
        bot.cs2Agent.root.visible = true;
        bot._visY = d.y;
        bot.cs2Agent.setTransform(bot.x, d.y + lift, bot.z, bot.yaw);
        bot.cs2Agent.update(dt);
      } else if (!d.done) {
        d.done = true;
        // Same handoff the bundle uses for bots (main.js:34022). bot.alive is
        // already false, so _updateCS2Body will not re-create the agent.
        if (game.addAgentCorpse) game.addAgentCorpse(bot.cs2Agent, bot.team, game.time);
        bot.cs2Agent = null;
        bot._netDeath = null;
      }
    }
    bot._updateCS2Body(dt, game);
  }

  // F2: the relay publishes every roster entry with `state: null` until that peer
  // sends its first state message, and binding used to require a live state. A peer
  // whose publishing is momentarily stalled was therefore never bound, and nothing
  // retried until its next state. Hold at the map origin until real state arrives;
  // updateNetworkBot then takes over unchanged.
  function holdingState() {
    return {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0, health: 100, armor: 100,
      alive: true, onGround: true, crouch: false,
      weapon: 'knife', money: null,
    };
  }

  // The relay seeds every roster entry with map:'unknown'/mode:'dm' and only corrects
  // them once that peer publishes state. A peer still carrying the seed is in OUR
  // room, so the seed must not read as "a different match".
  function peerInMatch(player, match) {
    const map = normalizeMapId(player.map);
    if (map !== 'unknown' && map !== match.map) return false;
    if (player.mode !== 'dm' && normalizeMode(player.mode) !== match.mode) return false;
    return true;
  }

  // F6: bindPlayer() runs on every packet AND on every 250 ms poll() tick, so the
  // same roster entry is re-offered many times per publish. Rotating the snapshot
  // window on those repeats would stretch the interpolation window to a quarter
  // second; an identical snapshot keeps its original arrival stamps instead.
  function sameSnapshot(a, b) {
    return !!a && !!b
      && a.x === b.x && a.y === b.y && a.z === b.z
      && a.yaw === b.yaw && a.pitch === b.pitch
      && a.health === b.health && a.armor === b.armor
      && a.alive === b.alive && a.onGround === b.onGround && a.crouch === b.crouch;
  }

  let botHostId='',botEpoch=0,botEntries=[],botRoom='',roundState=null;
  const localBots=new Map();
  function clearLocalBots(){
    for(const bot of localBots.values())if(game?.botMgr)window.FreeSeverBots?.remove(game,bot);
    localBots.clear();
  }
  function reconcileBots(){
    if(!game||!window.FreeSeverBots)return;
    const active=matchContext.kind==='multiplayer'&&socketState.connected&&botRoom===matchContext.room;
    const host=active&&botHostId===socketState.selfId;
    if(!host){clearLocalBots();return;}
    if(game.state!=='playing')return;
    window.FreeSeverBots.install(game,window.ClutcherMultiplayer);
    let changed=false;const keep=new Set(botEntries.map(b=>b.id));
    for(const [id,bot] of localBots)if(!keep.has(id)||!game.botMgr.bots.includes(bot)){window.FreeSeverBots.remove(game,bot);localBots.delete(id);changed=true;}
    for(const entry of botEntries){
      releasePlayer(entry.id);
      if(!localBots.has(entry.id)){localBots.set(entry.id,window.FreeSeverBots.create(game,entry));changed=true;}
    }
    if(changed)game.hud?.buildAvatars?.();
  }
  function publishBots(){
    reconcileBots();
    if(!localBots.size||game.state!=='playing')return;
    const bots=[...localBots].map(([id,b])=>({id,state:{round:game.modeCtl?._networkRound||0,use:!b.target,kit:b.hasKit===true,x:b.x,y:b.y,z:b.z,vx:b.vx||0,vy:b.vy||0,vz:b.vz||0,yaw:b.yaw||0,pitch:b._lookPitch||0,health:b.health,armor:b.armor,alive:b.alive,onGround:b.onGround,crouch:b.crouchT>0,weapon:b.weapon,kills:b.kills,deaths:b.deaths,assists:b.assists,hsKills:b._hsKills,dmgDealt:b._dmgDealt,money:b.money}}));
    send({type:'bot_state',epoch:botEpoch,bots});
  }
  function bindPlayer(player) {
    if(player.bot&&botHostId===socketState.selfId)return;
    if (!game || !game.botMgr) return;
    const source = player.state || holdingState();
    const team = player.team === 'T' ? 'T' : 'CT';
    const existing = bound.get(player.id);
    if (existing && existing.team !== team) releasePlayer(player.id);
    let networkPlayer = bound.get(player.id);
    // botMgr.setup() calls clearNetworkPlayers(), splicing the entity out of
    // networkPlayers while `bound` still holds it. Treat that corpse as absent so
    // the peer is re-added instead of silently re-posed into nothing. An absent
    // pool means the engine is mid-teardown: leave the binding alone.
    const pool = game.botMgr.networkPlayers || null;
    if (networkPlayer && pool && pool.indexOf(networkPlayer) < 0) {
      bound.delete(player.id);
      networkPlayer = null;
    }
    const isNew = !networkPlayer;
    if (!networkPlayer) {
      networkPlayer = game.botMgr.addNetworkPlayer(player.id, {
        name: player.name || 'Player',
        team,
      });
      if (!networkPlayer) return;
    }
    const snapshot = {
      ...source,
      x: Number(source.x) || 0,
      y: Number(source.y) || 0,
      z: Number(source.z) || 0,
      vx: Number(source.vx) || 0,
      vy: Number(source.vy) || 0,
      vz: Number(source.vz) || 0,
      yaw: Number(source.yaw) || 0,
      pitch: Number(source.pitch) || 0,
      health: Number(source.health) || 0,
      armor: Number(source.armor) || 0,
      alive: source.alive !== false,
      onGround: source.onGround === true,
      crouch: source.crouch === true,
    };
    // Keep the outgoing snapshot as the time-stamped "previous" sample so
    // updateNetworkBot can interpolate between the last two publishes.
    const prior = networkPlayer._networkTarget || null;
    if (sameSnapshot(prior, snapshot)) {
      snapshot.at = prior.at;
      snapshot.prevAt = prior.prevAt;
      snapshot.prev = prior.prev;
    } else {
      const now = performance.now();
      snapshot.at = now;
      snapshot.prevAt = prior ? (prior.at || (now - STATE_PUBLISH_INTERVAL_MS)) : now;
      snapshot.prev = prior;
      // Keep the chain exactly two deep. Nothing downstream reads prev.prev, and
      // without this every packet retains every earlier snapshot for the life of
      // the binding (~63 MB/day for 3 peers at 15 Hz).
      if (prior) prior.prev = null;
    }
    networkPlayer._networkTarget = snapshot;
    // Display-only mirror, exactly as money is done. These are NOT fed back into
    // the snapshot: they are authored by the peer and read by the scoreboard.
    // Only overwrite when we actually have a value. statOf(null) is 0, so the
    // old code collapsed a peer's row to all-zeros whenever their roster entry
    // carried no live state - which is what makes a scoreboard look like it
    // "refreshed" on its own. Retain the last known figures instead; a genuine
    // zero still arrives as a real 0 and overwrites normally.
    const showStat = (a, b) => (a != null ? a : b);
    if (snapshot.kills != null || player.kills != null) networkPlayer.kills = statOf(showStat(snapshot.kills, player.kills));
    if (snapshot.deaths != null || player.deaths != null) networkPlayer.deaths = statOf(showStat(snapshot.deaths, player.deaths));
    if (snapshot.assists != null || player.assists != null) networkPlayer.assists = statOf(showStat(snapshot.assists, player.assists));
    if (snapshot.hsKills != null || player.hsKills != null) networkPlayer._hsKills = statOf(showStat(snapshot.hsKills, player.hsKills));
    if (snapshot.dmgDealt != null || player.dmgDealt != null) networkPlayer._dmgDealt = statOf(showStat(snapshot.dmgDealt, player.dmgDealt));
    networkPlayer.name = player.name || 'Player';
    networkPlayer.team = team;
    // weapon/money ride on the snapshot but are NOT part of sameSnapshot(): they
    // change without any movement, and folding them in there would re-stamp the
    // interpolation window on a weapon swap. Prefer the live snapshot, then the
    // roster entry (the relay seeds both, so a peer that has not published state
    // yet still binds a sane weapon). money stays null when unknown — do not
    // coerce it to 0, or the scoreboard's em-dash path becomes unreachable.
    const snapshotMoney = Number(snapshot.money);
    const rosterMoney = Number(player.money);
    networkPlayer.weapon = snapshot.weapon || player.weapon || 'knife';
    networkPlayer.money = Number.isFinite(snapshotMoney)
      ? snapshotMoney
      : (Number.isFinite(rosterMoney) ? rosterMoney : null);
    networkPlayer.isNetworkPlayer = true;
    networkPlayer.update = function (dt) { updateNetworkBot(this, dt); };
    // F6: hard-snap only on first sight — a fresh entity, or one re-added after
    // botMgr.setup() spliced it out of the pool (both clear `isNew` above). This
    // used to run on EVERY packet, which overwrote the interpolation window 15
    // times a second and left the smoothing nothing to do. Later packets only
    // move `_networkTarget`, so the body tracks between real samples.
    if (isNew) {
      Object.assign(networkPlayer, {
        x: snapshot.x,
        y: snapshot.y,
        z: snapshot.z,
        vx: snapshot.vx,
        vy: snapshot.vy,
        vz: snapshot.vz,
        yaw: snapshot.yaw,
        pitch: snapshot.pitch,
        _lookPitch: snapshot.pitch,
        health: snapshot.health,
        armor: snapshot.armor,
        alive: snapshot.alive,
        onGround: snapshot.onGround,
        crouchT: snapshot.crouch ? 0.2 : 0,
      });
    }
    bound.set(player.id, networkPlayer);
    if (isNew && game.hud && game.hud.buildAvatars) game.hud.buildAvatars();
  }

  function releasePlayer(id) {
    const networkPlayer = bound.get(id);
    if (!networkPlayer) return;
    if (game && game.botMgr && game.botMgr.removeNetworkPlayer) {
      game.botMgr.removeNetworkPlayer(id);
    }
    bound.delete(id);
    if (game && game.hud && game.hud.buildAvatars) game.hud.buildAvatars();
  }

  function releaseAll() {
    for (const id of [...bound.keys()]) releasePlayer(id);
  }

  function upsertPlayer(id, patch) {
    if (!id || id === socketState.selfId) return;
    const current = players.get(id) || { id, name: 'Player', team: 'CT', map: 'unknown', mode: 'dm', state: null };
    // A roster entry that omits map/mode must not erase what a state message taught us.
    const known = {};
    for (const field of Object.keys(patch || {})) if (patch[field] !== undefined) known[field] = patch[field];
    Object.assign(current, known);
    players.set(id, current);
    const match = currentMatch();
    if (match && peerInMatch(current, match)) bindPlayer(current);
  }

  // Token bucket over inbound `hit` frames. The relay already caps a single
  // client at CLIENT_MESSAGE_RATE_LIMIT messages/second, but that is shared with
  // `state` and is far above what a real trigger pull produces, so a peer that
  // wants to spend another client's screen time on hitmarkers gets dropped here
  // first. Never rejects the connection — an over-budget frame is just ignored.
  function allowHitFrame() {
    const now = Date.now();
    if (now - hitWindowStart >= HIT_WINDOW_MS) {
      hitWindowStart = now;
      hitCount = 1;
      return true;
    }
    hitCount += 1;
    return hitCount <= HIT_BURST_LIMIT;
  }

  function hitDamage(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(100, number);
  }

  // main.js's damage entry point for the LOCAL player: applyNetHit at
  // main.js:54709, signature (damage, fromId, region, weaponId) -> boolean.
  //
  // NOT game.damagePlayer: that is the fall-damage helper (main.js:4548/4602/
  // 4632 call it with "fall"). It applies no armour reduction, no hit-shake and
  // no directional indicator, and passes a null weapon, so the killfeed would
  // lose both the gun and the hit region. applyNetHit routes through the real
  // dealDamage path and resolves the attacker itself from fromId.
  //
  // The VICTIM must call this. Writing `bound.get(fromId).health -= damage` here
  // instead would be reverted inside 66 ms, because updateNetworkBot overwrites
  // bot.health from the victim's own published snapshot on the very next tick.
  function applyLocalHit(damage, fromId, region, weaponId, scoped) {
    if (!game || typeof game.applyNetHit !== 'function') {
      if (!damageEntryMissing) {
        damageEntryMissing = true;
        console.warn('[mp] game.applyNetHit is unavailable; remote hit damage is not being applied.');
      }
      return false;
    }
    return game.applyNetHit(damage, fromId || null, region || null, weaponId, !!scoped) !== false;
  }

  // The relay broadcasts `shot` to the room EXCLUDING the sender, so anything
  // that arrives here is another player's trigger pull. All of it is cosmetic;
  // the only thing we must not do is let a peer flood the effects pools.
  function allowShotFrame() {
    const now = performance.now();
    if (now - shotWindowStart > 250) { shotWindowStart = now; shotCount = 0; }
    return ++shotCount <= 40;
  }

  function handleShot(message) {
    if (!allowShotFrame() || !socketState.selfId) return;
    if (!message || message.fromId === socketState.selfId) return;
    const peer = bound.get(message.fromId);
    if (!peer) return;
    const fx = game && game.effects;
    if (!fx) return;
    const ox = Number(message.ox), oy = Number(message.oy), oz = Number(message.oz);
    const ex = Number(message.ex), ey = Number(message.ey), ez = Number(message.ez);
    if (![ox, oy, oz, ex, ey, ez].every(Number.isFinite)) return;
    // Muzzle flash. Deliberately NOT drawing a shell ejection: that needs the
    // weapon's ammo CLASS, which lives in the bundle's module-scope V table and
    // is unreachable from here. A faked casing would be worse than none.
    if (fx.worldMuzzle) fx.worldMuzzle(ox, oy, oz, message.weapon);
    if (fx.tracer) fx.tracer(ox, oy, oz, ex, ey, ez, null, message.weapon);
    // Remote gunfire, spatialised from the muzzle. playWeapon builds the same
    // "shot_<weapon>" bank key the engine builds from V[weapon].sound, and its
    // opts are what give inverse rolloff, the >33 m "far_*" variant and the
    // distance lowpass. Self-guards on readiness and on an unknown bank id, so a
    // pre-audio-init client is a silent no-op rather than a throw.
    if (game && game.audio && typeof game.audio.playWeapon === 'function') {
      try { game.audio.playWeapon('shot', message.weapon, { pos: { x: ox, y: oy, z: oz } }); }
      catch (error) { void error; }
    }
    // Recoil on the shooter's own model. Null weapon id makes the agent fall
    // back to its own already-synced weapon, so no V lookup is needed.
    if (peer.cs2Agent && peer.cs2Agent.shoot) peer.cs2Agent.shoot(null, { crouched: peer.crouchT > 0 });
  }

  function handleHit(message) {
    if (!allowHitFrame()) return;
    if (!socketState.selfId) return;
    const damage = hitDamage(message.damage);
    if (!damage) return;
    const region = typeof message.region === 'string' ? message.region.slice(0, 16) : null;
    // The weapon travels with the hit so the victim can name it in the killfeed.
    // Unvalidated here on purpose: applyNetHit resolves it through the game's own
    // weapon table and falls back to knife for anything it does not know.
    const weaponId = typeof message.weapon === 'string' ? message.weapon.slice(0, 24) : undefined;
    // The relay sends a strict boolean; used only for the killfeed's no-scope icon.
    const scoped = message.scoped === true;
    // Two disjoint audiences, one frame. Damage is applied by the VICTIM and by
    // nobody else; the hitmarker belongs to the SHOOTER. The relay never echoes
    // a self-aimed hit, so `fromId === selfId` implies `targetId !== selfId`.
    const isVictim = message.targetId === socketState.selfId && message.fromId !== socketState.selfId;
    const isShooter = message.fromId === socketState.selfId;
    if (!isVictim && !isShooter) return;
    if (isVictim) {
      // Throws are contained: a missing or reworked engine entry point must not
      // take down the socket's message handler, which is wrapped in a bare
      // try/catch in connect() and would silently drop every later frame.
      try {
        applyLocalHit(damage, message.fromId, region, weaponId, scoped);
      } catch (error) {
        if (!damageEntryMissing) {
          damageEntryMissing = true;
          console.warn('[mp] remote hit could not be applied:', error && (error.message || error));
        }
        return;
      }
      return;
    }
    // Shooter: hitmarker / VFX only. The damage was already applied by the
    // victim's own engine path, which also owns the damage flash and the kill.
    const headshot = region === 'head' || region === 'neck';
    try {
      if (game && game.hud && typeof game.hud.hitmarker === 'function') game.hud.hitmarker(headshot);
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('clutcher:mp-hit', {
        detail: { fromId: message.fromId || '', targetId: message.targetId || '', damage, region, headshot },
      }));
    } catch {}
  }

  // NOTE: there is deliberately no `reportHit` helper. main.js owns the outbound
  // emit — it calls window.ClutcherMultiplayer.send({type:'hit',...}) from
  // dealDamage (main.js:54669) and the grenade/flash paths — so this module adds
  // no second send path for the same frame. send() is already exported below.

  function handleMessage(message) {
    if (!message || typeof message.type !== 'string') return;
    if(message.type==='round'){if(message.room===matchContext.room)roundState=message;return;}
    if (message.type === 'room_status') {
      for (const summary of message.rooms || []) updateRoomStatus(summary);
    } else if (message.type === 'hello') {
      // The relay greets every fresh connection with `hello`; `welcome` only follows
      // a successful join. Without this branch the status line never leaves
      // "connecting" while a player sits in the lobby.
      if (message.id) socketState.selfId = message.id;
      socketState.attempt = 0;
      if (!socketState.connected) socketState.connected = true;
      setStatus(socketState.joinedRoom
        ? `connected · ${socketState.joinedRoom}`
        : 'connected · choose a team to join', 'ok');
    } else if (message.type === 'admission') {
      settleAdmission(message);
      if (message.room) {
        updateRoomStatus({
          room: message.room,
          map: matchContext.kind === 'multiplayer' ? matchContext.map : undefined,
          mode: matchContext.kind === 'multiplayer' ? matchContext.mode : undefined,
          players: message.teamCounts ? message.teamCounts.CT + message.teamCounts.T : 0,
          teamCounts: message.teamCounts,
          roomLimit: message.roomLimit,
          teamLimit: message.teamLimit,
          ready: message.ready,
        });
      }
      if (message.id) socketState.selfId = message.id;
      updateStatusLine();
    } else if (message.type === 'welcome') {
      socketState.selfId = message.id;
      socketState.attempt = 0;
      lastJoinKey = pendingJoinKey || lastJoinKey;
      pendingJoinKey = '';
      if (message.room) {
        updateRoomStatus({
          room: message.room,
          players: message.teamCounts ? message.teamCounts.CT + message.teamCounts.T : 0,
          teamCounts: message.teamCounts,
          roomLimit: message.limit,
          teamLimit: message.teamLimit,
          ready: message.ready,
        });
      }
      setStatus(currentMatch()
        ? `connected · ${message.room} · 1 player`
        : 'connected · choose a team to join', 'ok');
    } else if (message.type === 'roster') {
      botHostId=message.hostId||'';botEpoch=message.epoch||0;botRoom=message.room||'';botEntries=(message.players||[]).filter(p=>p.bot);reconcileBots();
      const roster = message.players || [];
      lastJoinKey = pendingJoinKey || lastJoinKey;
      pendingJoinKey = '';
      const ids = new Set(roster.map((player) => player.id));
      for (const player of roster) upsertPlayer(player.id, player);
      for (const id of [...players.keys()]) if (!ids.has(id)) { players.delete(id); releasePlayer(id); }
      if (message.room) {
        updateRoomStatus({
          room: message.room,
          players: message.count || ids.size,
          teamCounts: message.teamCounts || message.counts,
          roomLimit: message.limit,
          teamLimit: message.teamLimit,
          ready: message.ready,
        });
      }
      setStatus(`connected · ${socketState.joinedRoom} · ${Math.max(1, ids.size)} player${ids.size === 1 ? '' : 's'}`, 'ok');
    } else if (message.type === 'state') {
      upsertPlayer(message.id, { state: message.state, team: message.team, map: message.map, mode: message.mode });
      // If that peer listed us as an assist, credit ourselves - once per peer.
      const list = message.state && message.state.assistsFor;
      if (Array.isArray(list) && socketState.selfId && list.includes(socketState.selfId) && game && game.player) {
        if (!assistCredits.has(message.id)) {
          assistCredits.add(message.id);
          game.player.assists = (game.player.assists || 0) + 1;
        }
      }
    } else if (message.type === 'bot_damage') {
      const bot=localBots.get(message.targetId);
      if(bot&&botHostId===socketState.selfId&&message.epoch===botEpoch)window.FreeSeverBots?.damage(game,bot,message);
    } else if (message.type === 'hit') {
      handleHit(message);
    } else if (message.type === 'shot') {
      handleShot(message);
    } else if (message.type === 'error') {
      settleAdmission(message);
      pendingJoinKey = '';
      if ((message.code === 'team_full' || message.code === 'room_full') && message.room) {
        const context = matchContext.kind === 'multiplayer' ? matchContext : null;
        const map = context ? context.map : 'unknown';
        const mode = context ? context.mode : 'dm';
        const team = message.code === 'team_full' ? (message.team || 'CT') : 'CT';
        blockedJoinKeys.set(joinKey(message.room, map, mode, team), { at: Date.now(), room: message.room, team });
        if (message.teamCounts && message.room) {
          updateRoomStatus({
            room: message.room,
            teamCounts: message.teamCounts,
            teamLimit: message.teamLimit,
          });
        }
      }
      setStatus(message.message || 'connection error', 'warn');
    }
  }

  function clearHandshakeTimer() {
    if (!handshakeTimer) return;
    clearTimeout(handshakeTimer);
    handshakeTimer = 0;
  }

  function scheduleReconnect() {
    if (socketState.closing) return;
    clearHandshakeTimer();
    socketState.attempt += 1;
    setStatus(`offline · retry ${socketState.attempt}`, 'warn');
    setTimeout(connect, Math.min(15000, 750 * 2 ** Math.min(5, socketState.attempt)));
  }

  function connect() {
    if (socketState.closing) return;
    // Never stack sockets: every extra handshake holds a relay slot for this IP and
    // pushes the per-IP connection limit closer to its cap.
    const previous = socketState.socket;
    if (previous && (previous.readyState === WebSocket.CONNECTING || previous.readyState === WebSocket.OPEN)) return;
    clearHandshakeTimer();
    setStatus(socketState.attempt ? `reconnecting (${socketState.attempt})` : 'connecting', 'warn');
    let socket;
    try { socket = new WebSocket(endpoint); }
    catch { scheduleReconnect(); return; }
    socketState.socket = socket;
    let down = false;
    // Single idempotent teardown shared by close, error and the handshake watchdog,
    // so the retry loop always advances even if an engine never fires `close`.
    const fail = () => {
      if (down) return;
      down = true;
      clearHandshakeTimer();
      if (socketState.socket === socket) {
        socketState.socket = null;
        socketState.connected = false;
        socketState.joinedRoom = '';
        socketState.joinedTeam = '';
        socketState.selfId = '';
        // A fresh socket is a fresh membership. Without this the guard in
        // ensureJoined() still matches lastJoinKey, we never re-send join, the
        // server holds client.room === null and drops our state frames, and the
        // client sits "connected" while seeing nobody and being seen by nobody.
        lastJoinKey = '';
        pendingJoinKey = '';
        players.clear();
        releaseAll();
        clearLocalBots();botHostId='';botEntries=[];
        for (const pending of pendingAdmissions.values()) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(new Error('Multiplayer relay disconnected.'));
          for (const extra of pending.extra || []) extra.reject(new Error('Multiplayer relay disconnected.'));
        }
        pendingAdmissions.clear();
      }
      scheduleReconnect();
    };
    handshakeTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.CONNECTING) return;
      try { socket.close(); } catch {}
      fail();
    }, HANDSHAKE_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      clearHandshakeTimer();
      socketState.connected = true;
      socketState.attempt = 0;
      lastJoinKey = '';
      setStatus('connected · choose a team to join', 'ok');
      ensureJoined();
      requestRoomStatus();
    });
    socket.addEventListener('message', (event) => {
      try { handleMessage(JSON.parse(event.data)); } catch {}
    });
    socket.addEventListener('close', fail);
    socket.addEventListener('error', () => { try { socket.close(); } catch {} });
  }

  function publishState() {
    // The engine installs a placeholder window.game before the real one exists. A
    // truthy latch on `if (!game)` is permanent, so re-latch on every identity
    // change instead: a boot-order race self-corrects on the next tick.
    if (game !== window.game) game = window.game || null;
    const now = performance.now();
    if (socketState.connected && now - lastStateSent >= STATE_PUBLISH_INTERVAL_MS) {
      const message = playerState();
      if (message) {send(message);publishBots();}
      lastStateSent = now;
    }
  }

  function poll() {
    // The engine installs a placeholder window.game before the real one exists. A
    // truthy latch on `if (!game)` is permanent, so re-latch on every identity
    // change instead: a boot-order race self-corrects on the next tick.
    if (game !== window.game) game = window.game || null;
    if (!game) return;
    const match = currentMatch();
    if (!match) {
      if (lastJoinKey) { lastJoinKey = ''; pendingJoinKey = ''; players.clear(); releaseAll(); }
      return;
    }
    ensureJoined();
    for (const player of players.values()) {
      if (peerInMatch(player, match)) bindPlayer(player);
    }
  }

  window.addEventListener('beforeunload', () => {
    socketState.closing = true;
    if (socketState.socket) socketState.socket.close(1000, 'Page closed');
  });
  window.ClutcherMultiplayer = {
    endpoint,
    get botEpoch(){return botEpoch;},
    get selfId(){return socketState.selfId;},
    get isHost(){return botHostId===socketState.selfId;},
    get roundState(){return roundState;},
    get connected() { return socketState.connected; },
    get players() { return [...players.values()]; },
    get remoteBots() { return [...bound.values()]; },
    get selectedRoom() { return selectedRoom; },
    get multiplayerActive() { return matchContext.kind === 'multiplayer'; },
    get matchRoom() { return matchContext.kind === 'multiplayer' ? matchContext.room : ''; },
    get status() {
      if (matchContext.kind !== 'multiplayer') return null;
      const room = socketState.joinedRoom || matchContext.room;
      if (!room) return null;
      const summary = getRoomStatus(room);
      return {
        ...summary,
        room,
        connected: socketState.connected,
        joined: socketState.joinedRoom === room,
      };
    },
    setRoom,
    watchRooms,
    setMatchContext,
    clearMatchContext,
    requestRoomStatus,
    getRoomStatus,
    isRoomReady,
    canJoinTeam,
    onRoomStatus,
    admitTeam,
    joinRequest,
    send: (message) => send(message),
    // Called by the game bundle's sendNetHit the instant the local player lands
    // a shot on a peer. Damage is credited here; the kill follows from that
    // peer's own published health, because the victim owns its health.
    noteLocalHit: (peerId, damage, headshot) => noteLocalHit(peerId, damage, headshot),
  };

  setStatus('starting', 'warn');
  connect();
  setInterval(poll, 250);
  setInterval(publishState, STATE_PUBLISH_INTERVAL_MS);
  setInterval(() => {
    if (socketState.connected && roomListeners.size) requestRoomStatus();
  }, ROOM_STATUS_INTERVAL_MS);
})();

