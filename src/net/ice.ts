/**
 * WebRTC connectivity for PeerJS. STUN alone fails behind strict NATs (many mobile networks,
 * school/office wifi), so we also list TURN relays. Override with your own TURN by setting
 * VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS at build time.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const iceServers: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.relay.metered.ca:80' },
];

if (env.VITE_TURN_URL) {
  iceServers.push({ urls: env.VITE_TURN_URL.split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
} else {
  // Open Relay Project: free public TURN, fine for a party game (swap in your own for production)
  iceServers.push({
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  });
}

export const PEER_OPTS = { config: { iceServers }, debug: 1 } as const;
