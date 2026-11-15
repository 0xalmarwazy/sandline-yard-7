// SANDLINE — Yard 7. Static data: palette, weapons, map geometry, waypoints.
// Everything the sim and the renderer agree on lives here; nothing here imports three.js.

export const PALETTE = {
  sky: 0x87b5d6,
  fog: 0x9db8c8,
  ground: 0xc2a878,
  groundDark: 0xa8905f,
  wall: 0x62686f,
  wallTop: 0x6a707a,
  wallDark: 0x454a52,
  crate: 0x8a6f4d,
  crateDark: 0x6e5738,
  containerA: 0x2e7d6f,
  containerB: 0xb07d2b,
  siteA: 0x2dd4bf,
  siteB: 0xf59e0b,
  van: 0x38bdf8,
  jac: 0xef4444,
  accent: 0xf0a830,
  ink: 0xe9e6df,
};

export const TEAMS = {
  van: { name: 'Vanguard', short: 'VAN', color: PALETTE.van, attacks: true },
  jac: { name: 'Jackals', short: 'JAC', color: PALETTE.jac, attacks: false },
};

// Team size, in one place: the player plus BOT_NAMES.van bots on Vanguard,
// BOT_NAMES.jac bots on Jackals. Both lists must hold TEAM_SIZE - 1 and
// TEAM_SIZE names respectively.
export const TEAM_SIZE = 5;

// Weapons. damage is per pellet; headMult multiplies on a head hit.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 3,
    rpm: 320, auto: false, mag: 12, reserve: 48, reload: 1.4,
    spread: 0.011, moveSpread: 0.03, recoil: 0.011, pellets: 1, range: 60,
  },
  k9: {
    id: 'k9', name: 'K9 SMG', price: 1400, damage: 22, headMult: 3,
    rpm: 750, auto: true, mag: 25, reserve: 100, reload: 2.0,
    spread: 0.016, moveSpread: 0.035, recoil: 0.008, pellets: 1, range: 55,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', price: 2700, damage: 34, headMult: 3,
    rpm: 600, auto: true, mag: 30, reserve: 90, reload: 2.4,
    spread: 0.009, moveSpread: 0.045, recoil: 0.015, pellets: 1, range: 80,
  },
  m870: {
    id: 'm870', name: 'M870 Breacher', price: 1200, damage: 11, headMult: 2,
    rpm: 70, auto: false, mag: 6, reserve: 24, reload: 2.8,
    spread: 0.05, moveSpread: 0.05, recoil: 0.05, pellets: 8, range: 30,
  },
};
export const WEAPON_ORDER = ['p9', 'k9', 'm870', 'vk47'];
export const GRENADE = { id: 'frag', name: 'HE-1 Frag', price: 300, radius: 7, damage: 90, fuse: 2.2 };
// Smoke: no damage — it blooms into a cloud that blocks line of sight for
// both teams (see combat.js hasLineOfSight). A site-entry tool.
export const SMOKE = { id: 'smoke', name: 'SM-2 Smoke', price: 300, radius: 4.5, fuse: 1.6, life: 13 };

// Money and round economy.
export const ECON = {
  startMoney: 800, killBonus: 300, plantBonus: 300,
  winBonus: 3000, lossBonus: 1400, maxMoney: 16000,
};
export const ROUND = {
  buyTime: 15, roundTime: 100, bombTime: 35,
  plantTime: 3, defuseTime: 5, endTime: 4, matchToWin: 5,
};
export const MOVE = {
  walk: 4.3, crouch: 2.1, accel: 42, friction: 9.5, airAccel: 8,
  jumpVel: 5.2, gravity: 14.5, radius: 0.36, eyeStand: 1.62, eyeCrouch: 1.12,
  height: 1.8, crouchHeight: 1.25,
};

// Map: axis-aligned boxes. {x0,z0,x1,z1,h} — h is the top height; sight is
// blocked when h > 1.35 (a standing eye line). kind picks the material.
export const WALLS = [
  // Perimeter, height 4.
  { x0: -45, z0: -35, x1: 45, z1: -34, h: 4, kind: 'wall' },
  { x0: -45, z0: 34, x1: 45, z1: 35, h: 4, kind: 'wall' },
  { x0: -45, z0: -35, x1: -44, z1: 35, h: 4, kind: 'wall' },
  { x0: 44, z0: -35, x1: 45, z1: 35, h: 4, kind: 'wall' },
  // West lane divider (gaps at the two connectors).
  { x0: -33, z0: -28, x1: -32, z1: -14, h: 3.4, kind: 'wall' },
  { x0: -33, z0: -10, x1: -32, z1: 10, h: 3.4, kind: 'wall' },
  { x0: -33, z0: 14, x1: -32, z1: 28, h: 3.4, kind: 'wall' },
  // East lane divider (mirrored).
  { x0: 32, z0: -28, x1: 33, z1: -14, h: 3.4, kind: 'wall' },
  { x0: 32, z0: -10, x1: 33, z1: 10, h: 3.4, kind: 'wall' },
  { x0: 32, z0: 14, x1: 33, z1: 28, h: 3.4, kind: 'wall' },
  // Mid doors: a wall across mid with a 2 m door gap.
  { x0: -8, z0: 4, x1: -1, z1: 5, h: 3.4, kind: 'wall' },
  { x0: 1, z0: 4, x1: 8, z1: 5, h: 3.4, kind: 'wall' },
  // Site A walls: south wall leaves the west-lane gap, east wall the mid gap.
  { x0: -30, z0: -17, x1: -20, z1: -16, h: 3.4, kind: 'wall' },
  { x0: -21, z0: -30, x1: -20, z1: -24, h: 3.4, kind: 'wall' },
  // Site B walls (mirrored).
  { x0: 20, z0: -17, x1: 30, z1: -16, h: 3.4, kind: 'wall' },
  { x0: 20, z0: -30, x1: 21, z1: -24, h: 3.4, kind: 'wall' },
  // Site huts.
  { x0: -34, z0: -28, x1: -31, z1: -25, h: 2.6, kind: 'dark' },
  { x0: 31, z0: -28, x1: 34, z1: -25, h: 2.6, kind: 'dark' },
  // Containers (block sight).
  { x0: -28, z0: -31, x1: -24, z1: -28.5, h: 2.6, kind: 'containerA' },
  { x0: 24, z0: -31, x1: 28, z1: -28.5, h: 2.6, kind: 'containerB' },
  { x0: 6, z0: 14, x1: 10, z1: 16.5, h: 2.6, kind: 'containerA' },
  { x0: -10, z0: -16, x1: -6, z1: -13.5, h: 2.6, kind: 'containerB' },
  // Mid pillars.
  { x0: -4.5, z0: -8.5, x1: -3.5, z1: -7.5, h: 4, kind: 'dark' },
  { x0: 3.5, z0: -8.5, x1: 4.5, z1: -7.5, h: 4, kind: 'dark' },
  { x0: -4.5, z0: 15.5, x1: -3.5, z1: 16.5, h: 4, kind: 'dark' },
  { x0: 3.5, z0: 15.5, x1: 4.5, z1: 16.5, h: 4, kind: 'dark' },
  // Crates: low cover, block movement, not sight.
  { x0: 1, z0: 11.5, x1: 3, z1: 12.5, h: 1.1, kind: 'crate' },
  { x0: -3.5, z0: -6.5, x1: -2.5, z1: -5.5, h: 1.1, kind: 'crate' },
  { x0: 3, z0: -14.5, x1: 5, z1: -13.5, h: 1.1, kind: 'crate' },
  { x0: -38.5, z0: 5.5, x1: -37.5, z1: 6.5, h: 1.1, kind: 'crate' },
  { x0: -37, z0: -6.5, x1: -35, z1: -5.5, h: 1.1, kind: 'crate' },
  { x0: 37.5, z0: -6.5, x1: 38.5, z1: -5.5, h: 1.1, kind: 'crate' },
  { x0: 35, z0: 7.5, x1: 37, z1: 8.5, h: 1.1, kind: 'crate' },
  { x0: -29, z0: -27.5, x1: -27, z1: -26.5, h: 1.1, kind: 'crate' },
  { x0: -36.5, z0: -20.5, x1: -35.5, z1: -19.5, h: 1.1, kind: 'crate' },
  { x0: 27, z0: -27.5, x1: 29, z1: -26.5, h: 1.1, kind: 'crate' },
  { x0: 35.5, z0: -20.5, x1: 36.5, z1: -19.5, h: 1.1, kind: 'crate' },
  { x0: -1, z0: 25.5, x1: 1, z1: 26.5, h: 1.1, kind: 'crate' },
  { x0: -1, z0: -26.5, x1: 1, z1: -25.5, h: 1.1, kind: 'crate' },
  // v2 cover: two more containers and low sandbag walls near the mid and
  // site approaches. Each was checked against every waypoint edge: no edge
  // segment passes through any of these boxes (see the nav check in the
  // repo's test notes), so bot routes stay walkable.
  { x0: 14, z0: 22, x1: 18, z1: 24.5, h: 2.6, kind: 'containerB' },
  { x0: -18, z0: -28, x1: -14, z1: -25.5, h: 2.6, kind: 'containerA' },
  { x0: 5, z0: 10, x1: 9, z1: 11, h: 1.1, kind: 'crate' },
  { x0: -9, z0: -2, x1: -5, z1: -1, h: 1.1, kind: 'crate' },
  { x0: 26, z0: -14, x1: 28, z1: -13, h: 1.1, kind: 'crate' },
  { x0: -28, z0: -14, x1: -26, z1: -13, h: 1.1, kind: 'crate' },
];

// Bomb sites: plant zones on the ground.
export const SITES = {
  A: { id: 'A', x0: -42, z0: -32, x1: -20, z1: -16, cx: -31, cz: -24, color: PALETTE.siteA, name: 'Warehouse' },
  B: { id: 'B', x0: 20, z0: -32, x1: 42, z1: -16, cx: 31, cz: -24, color: PALETTE.siteB, name: 'Depot' },
};

export const SPAWNS = {
  van: [
    { x: -6, z: 28, yaw: 0 },
    { x: -11, z: 27, yaw: 0 },
    { x: -1, z: 27, yaw: 0 },
    { x: -16, z: 26, yaw: 0 },
    { x: 4, z: 26, yaw: 0 },
  ],
  jac: [
    { x: 6, z: -28, yaw: Math.PI },
    { x: 2, z: -27, yaw: Math.PI },
    { x: 10, z: -27, yaw: Math.PI },
    { x: 14, z: -26, yaw: Math.PI },
    { x: -2, z: -26, yaw: Math.PI },
  ],
};

// Waypoint graph for bot navigation. Every edge is walkable (no wall crosses
// the straight segment between its nodes).
export const WAYPOINTS = [
  { x: -6, z: 28 }, // 0 atk spawn
  { x: -38, z: 20 }, // 1 west south
  { x: -38, z: 0 }, // 2 west mid
  { x: -38, z: -20 }, // 3 west north
  { x: -32, z: -24 }, // 4 site A
  { x: -16, z: -20 }, // 5 A mid approach
  { x: 0, z: 20 }, // 6 mid south
  { x: 0, z: 0 }, // 7 mid
  { x: 0, z: -20 }, // 8 mid north
  { x: 38, z: 20 }, // 9 east south
  { x: 38, z: 0 }, // 10 east mid
  { x: 38, z: -20 }, // 11 east north
  { x: 32, z: -24 }, // 12 site B
  { x: 16, z: -20 }, // 13 B mid approach
  { x: 6, z: -28 }, // 14 def spawn
  { x: -20, z: 12 }, // 15 south connector west
  { x: 20, z: 12 }, // 16 south connector east
  { x: -20, z: -12 }, // 17 north connector west
  { x: 20, z: -12 }, // 18 north connector east
  { x: -38, z: -28 }, // 19 A corner hold
  { x: 38, z: -28 }, // 20 B corner hold
  { x: 0, z: 4 }, // 21 mid door
  { x: -38, z: 12 }, // 22 west gap south
  { x: -38, z: -12 }, // 23 west gap north
  { x: 38, z: 12 }, // 24 east gap south
  { x: 38, z: -12 }, // 25 east gap north
];
export const EDGES = [
  [0, 6], [0, 15], [0, 16], [6, 15], [6, 16], [6, 21], [21, 7], [7, 8],
  [15, 22], [22, 1], [22, 2], [1, 2], [2, 23], [23, 17], [23, 3], [3, 4],
  [3, 19], [4, 5], [5, 17], [5, 8], [17, 8], [17, 7], [8, 14], [8, 13],
  [16, 24], [24, 9], [24, 10], [9, 10], [10, 25], [25, 18], [25, 11],
  [11, 12], [11, 20], [12, 13], [13, 18], [13, 8], [18, 8], [18, 7],
  [14, 17], [14, 18],
];

export const BOT_NAMES = {
  van: ['Rook', 'Sable', 'Ash', 'Flint'],
  jac: ['Vex', 'Mira', 'Dusk', 'Nyx', 'Onyx'],
};

// Defender hold spots: waypoint + facing yaw (radians, 0 = north/-z).
export const HOLD_SPOTS = [
  { wp: 19, yaw: Math.PI * 0.25, site: 'A' },
  { wp: 4, yaw: Math.PI * 0.75, site: 'A' },
  { wp: 20, yaw: -Math.PI * 0.25, site: 'B' },
  { wp: 12, yaw: -Math.PI * 0.75, site: 'B' },
  { wp: 8, yaw: Math.PI, site: null },
  { wp: 17, yaw: Math.PI * 0.5, site: null },
  { wp: 18, yaw: -Math.PI * 0.5, site: null },
];
