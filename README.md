# Tiebreaker

A penalty shootout game. Play a best-of-five against a bot that learns your habits, challenge a friend over a shareable link, and save your ranked results to a top-ten leaderboard on Arc Testnet.

Built with [Arc Studio](https://studio.arc.io)

## Features

- Ranked and practice matches against a bot
- Friend matches over a shareable link (peer to peer, not saved to the leaderboard)
- Custom shirt colour and number
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

### Environment variables

- `VITE_LEADERBOARD_ADDRESS`: address of the deployed leaderboard contract on Arc Testnet.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional outside Arc Studio. Provisioned by Arc Studio for RPC access.

You need a wallet with a little Arc Testnet USDC (used for gas) to save a result.
