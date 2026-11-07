# Tiebreaker

A penalty shootout game. Play a best-of-five against a bot that learns your habits, challenge a friend over a shareable link, and save your ranked results to a top-ten leaderboard on Arc Testnet.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Ranked and practice matches against a bot. A ranked result can be saved onchain only on the result screen right after the match; skipping or leaving discards it
- Friend matches over a shareable link (peer to peer, free, not saved to the leaderboard)
- Online matches between two wallets on Arc Testnet: private rooms with a share link, a ranked quick-match queue, hidden moves that both players reveal, a 20 second deadline per step with a forfeit claim, and a verified leaderboard
- Customize screen with live preview: shirt colour, pattern, secondary colour, number and name tag; ball design and trail; stadium theme (day, night, rainy, sunset, snow)
- Every colour, pattern, ball, trail and stadium is available to everyone from the start
- Onchain top ten by wins, plus your own wins, losses and streaks
- Sound effects with a mute toggle

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit, PeerJS, Solidity (Foundry)

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
bun run dev
```

Other commands:

- `bun run build` makes a production build in `dist/`
- `bun run check` runs lint and typecheck
- `bun run contracts:build` compiles the contract
- `bun run contracts:test` runs contract tests
- `bun run abi:match` regenerates the online match ABI after changing the contract

### Friend and online matches

Both players choose their own shirt (colour, pattern, second colour, number) and a player name of up to 12 characters, then press Ready. In a friend room the match starts when both are ready. In an onchain match, creating, joining or queueing counts as Ready, because the move clock runs onchain. If both pick the same colour, the guest is shown in a contrasting one. The host's stadium is shown to both players; each player keeps their own ball.

### Accounts and chat

Players can sign up with a username and password only (no email, no real name) to use the lobby chat and the small chat in friend rooms and online matches. Guests can play everything and read the lobby chat. Messages are plain text, up to 200 characters, with a rate limit, link, email and phone blocking and a profanity filter. Players can report and mute others, and the owner can hide messages and ban users. A one-time recovery code resets a lost password. See `supabase/README.md` for the setup.

### Languages

English (default), Türkçe, Español, Português and Русский. The game uses the browser language on the first visit and remembers the choice made with the globe button. To add a language, copy `src/i18n/locales/es.ts` to a new file (for example `de.ts`), change the `code`, `name` and texts. It is picked up automatically, and any missing text falls back to English.

### Environment variables

- `VITE_LEADERBOARD_ADDRESS` (optional): address of the deployed leaderboard contract on Arc Testnet (offline ranked results).
- `VITE_MATCH_ADDRESS` (optional): address of the deployed online match contract on Arc Testnet.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (optional): your Supabase project for accounts and chat. Without them the app shows "Chat is not configured". Setup and SQL: `supabase/README.md`.
- `VITE_TURNSTILE_SITE_KEY` (optional): Cloudflare Turnstile site key for bot protection on sign-up.
- `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` (optional, set all three): a TURN relay so friend matches also connect on strict mobile or office networks. These are visible in the built app, so use browser-safe, usage-limited credentials.
- `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE` (optional): use your own PeerJS matchmaking server instead of the free PeerJS cloud.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional outside Arc Studio. Provisioned by Arc Studio for RPC access.

You need a wallet with a little Arc Testnet USDC (used for gas) to save a result.
