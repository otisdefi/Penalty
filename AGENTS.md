# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Tiebreaker: a penalty shootout game (best of five, sudden death). Modes: ranked and practice vs a learning bot, and peer-to-peer friend matches (PeerJS, commit-reveal moves). Ranked results are saved by the player's wallet to the `PenaltyLeaderboard` contract.

## Deployed contracts

- PenaltyLeaderboard on Arc Testnet: `0x1df2ff3dd51acb1683781dd5d2808ca338047f4c` (read from `VITE_LEADERBOARD_ADDRESS` in `.env`; ABI in `src/contract.ts`). Results are self-reported, so it is not cheat-proof.

- PenaltyMatch on Arc Testnet: `0x8093487cdfdcb6a31e371742a400ec203794c575` (read from `VITE_MATCH_ADDRESS`; ABI in `src/online/abi.ts`, regenerate with `bun run abi:match`). Verified on the Arc Testnet explorer. Two-wallet commit/reveal shootouts, 20 second steps, permissionless `claimTimeout`, ranked quick-match queue, verified leaderboard.
- Older unused leaderboard version: `0x988c32e64ff107a7b355db244b6e3c4c67ab2d6a` (incompatible with the current source; ignore).

## Online match notes

- `src/online/`: `OnlineHome` (create, join by link, quick match), `OnlineLobby`, `OnlineMatchScreen`, `useOnlineMatch` (polling, commit/reveal, forfeit), `useOnlineEntry`.
- A one-time helper key (stored in this browser's localStorage, funded at room creation) signs commits and reveals so the wallet is asked once. The room code lives only in the share link's `#fragment`.
- Commit hash is `keccak256(abi.encodePacked(id, kick, MAIN wallet, dir, salt))`. Gas estimates are padded by 50% because the RPC sometimes under-estimates.
- `scripts/e2e-match.ts` runs the whole flow against an anvil fork of Arc Testnet.

## Customization

- `src/cosmetics/`: `catalog.ts` (all items, none locked), `store.ts` (saved choices, localStorage with try/catch), `art.tsx` (jersey patterns, balls, trails, stadium themes), `nameFilter.ts` (name tag: 8 chars, no links, blocked words), `validate.ts` (parses shirts received from other players), `CustomizeScreen.tsx`.
- Online matches share looks over a direct PeerJS link (`src/online/useCosmeticSync.ts`, ids derived from match id, seat and wallet). The contract only stores moves. Received data is validated, display only. The home player's stadium is shown to both.

## Layout

- `src/game/`: pure logic (`logic.ts`), bot (`bot.ts`), audio, local storage, PeerJS wrapper (`peer.ts`)
- `src/hooks/useMatch.ts`: match state machine for bot and friend modes
- `src/components/`: Menu, MatchScreen, Pitch, FriendLobby, Leaderboard, SaveResult

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```

## Languages (i18n)

- `src/i18n/index.ts`: tiny translation layer (`useI18n()` gives `t`, `n` for number formatting, and the current language). The choice is saved under `tb:lang`; the first visit uses the browser language if supported.
- `src/i18n/locales/*.ts`: one file per language, picked up automatically (`import.meta.glob`). `en.ts` is the source of truth and defines every key; other files may omit keys (English fallback). Keep texts short for phone buttons. Do not translate wallet addresses, contract names or numbers.
- Add a text: add the key to `en.ts`, then to the other language files. Use `t('key', { name: value })` with `{name}` placeholders.

## Lobby and looks

- Friend rooms: after connecting, both players share their look (`hello`) and press Ready (`ready`) in `FriendLobby`; the match starts when both are ready. Messages that arrive in the lobby are held and re-queued for the match (`FriendLink.requeue`).
- Onchain matches share looks over a PeerJS side channel (`src/online/useCosmeticSync.ts`); Ready = create/join/queue, since the 20 second clock is onchain. Looks are validated (known colours and patterns, numbers 1 to 99, names 12 characters max with links and bad words removed) and only ever drawn, never rendered as HTML.
- `src/cosmetics/kits.ts`: if both shirt colours match, the guest is shown in a contrasting colour. `src/cosmetics/identity.ts`: names default to "Player 1234" (offline and friend) or the short wallet address (onchain).

## Accounts and chat (Supabase)

- `src/chat/`: `config.ts` (env, limits), `client.ts` (Supabase client loaded on demand), `account.ts` (auth store and actions), `rules.ts` (username, password, message and recovery-code rules), `useChat.ts` and `ChatPanel.tsx` (realtime chat), `AuthDialog.tsx`/`AuthParts.tsx`/`AccountView.tsx` (sign up, sign in, reset, account), `Turnstile.tsx`.
- `supabase/schema.sql` is the source of truth for the database rules (RLS, chat triggers, reports, recovery hash, owner tools); `supabase/functions/reset-password/` is the Edge Function; `supabase/README.md` lists the dashboard steps. Keep the client rules in `rules.ts` and the SQL in sync.
- No secret in the code: only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_TURNSTILE_SITE_KEY` (all public). The signed-in username replaces the jersey name everywhere (`useCosmetics`).

## Profiles and challenges

- SQL: `supabase/profiles_challenges.sql` (run after `schema.sql`). Every rule (filters, rate limits, cooldown, blocks, availability) lives in the database functions; the app only explains the outcome.
- App: `src/social/` (`api.ts` database calls, `challenges.ts` engine with Realtime plus polling fallback, `ProfileCard.tsx`, `MyProfile.tsx`, `ChallengeHost.tsx` notifications, `blocks.ts`, `nav.ts` bridge to App).
- Private two-wallet rooms are unranked in the contract, so the online challenge mode is called "Online match (two wallets)", not ranked.

## Profile pictures

- SQL: `supabase/avatars/` (five parts, run in order after the profiles and challenges SQL), `avatars_checks.sql` for read-only checks, and the `purge-avatars` Edge Function in `supabase/functions/purge-avatars/` (deletes rejected or removed files through the Storage API).
- App: `src/avatar/` (`processImage.ts` checks and crops, `api.ts` database and storage calls, `store.ts` shared cache, `Avatar.tsx` round picture or generated default, `AvatarUpload.tsx` upload screen in My profile).
- Rules live in the database and storage policies: private bucket, one file per player named by user id, WebP or JPEG up to 512 KB, 3 uploads a day, pending until approved, hidden after 3 reports.

## Networks

- `src/networks.ts` is the one place that knows the test networks (Arc Testnet and Base Sepolia): chain, gas coin, explorer, faucet hint, and the contract addresses read from `VITE_*_ARC` and `VITE_*_BASE_SEPOLIA` (Arc falls back to the deployed addresses, Base Sepolia has none until configured). Only testnets are listed on purpose.
- The selected network is remembered in the browser (`tb:network`) and can come from a share link (`?net=`). Components call `useNetwork()`; code that must not follow later changes (an open online match) takes the network as an argument.
- Per-network data: leaderboards (separate contracts), remembered online matches (`src/online/storage.ts` keys), the match chat channel (`matchChannel`). Match links carry `&net=`; a challenge invite is matched to its network by `src/online/detect.ts`.

## Automatic picture checks

- `supabase/functions/check-avatar` (Verify JWT on) reads a picture with the service role, asks the moderation services named in the `MODERATION_PROVIDER` secret (sightengine, openai, azure; strictest answer wins) and applies the verdict through `moderation_claim` / `moderation_decide` (service role only, `supabase/avatars/moderation_part*_of_2.sql`). Keys are Edge Function secrets, never in the repo or the app.
- The app calls it through `checkAvatar()` in `src/avatar/api.ts` after an upload and after a picture report. Anything unclear or failing leaves the picture pending for the manual review in `admin_pending_pictures`.

## Leaderboard contract versions

- Arc Testnet's leaderboard (`0x1df2…`) is version 1: `recordMatch(bool won)`. Its source is not in git.
- `contracts/PenaltyLeaderboard.sol` in the repo is version 2: `recordMatch(bytes32 matchId, bool won)`, refusing the same match id twice for a wallet. It is what runs on Base Sepolia (`0x9c6d…`). Reads (`getRecord`, `getTopTen`) are identical.
- `NetworkConfig.leaderboardVersion` (override with `VITE_LEADERBOARD_VERSION_*`) picks the write call in `SaveResult`. `PenaltyMatch` is the same bytecode on both networks.

