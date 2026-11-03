// End-to-end check of the online match client helpers against a local anvil fork of Arc Testnet.
// Usage: anvil --fork-url https://rpc.testnet.arc.io --port 8599 --chain-id 5042002
//        MATCH_ADDRESS=0x... bun run scripts/e2e-match.ts
import { createPublicClient, createTestClient, createWalletClient, encodeFunctionData, http, parseEther } from 'viem'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { penaltyMatchAbi } from '../src/online/abi'
import { commitHash, kickFlags, padGas, parseMatch, randomBytes32, roomCodeHash } from '../src/online/helpers'

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8599'
const MATCH = process.env.MATCH_ADDRESS as `0x${string}` | undefined
if (!MATCH) throw new Error('Set MATCH_ADDRESS')

const transport = http(RPC)
const pub = createPublicClient({ chain: arcTestnet, transport })
const test = createTestClient({ chain: arcTestnet, transport, mode: 'anvil' })

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`)
  if (!ok) failures++
}

const makePlayer = async () => {
  const account = privateKeyToAccount(generatePrivateKey())
  await test.setBalance({ address: account.address, value: parseEther('10') })
  return { account, wallet: createWalletClient({ account, chain: arcTestnet, transport }) }
}
type Player = Awaited<ReturnType<typeof makePlayer>>

const send = async (p: Player, data: Hex, value = 0n) => {
  // simulate first so a revert shows the contract's error name
  await pub.call({ account: p.account.address, to: MATCH, data, value }).catch((e: unknown) => {
    const err = e as { cause?: { data?: { errorName?: string } }; shortMessage?: string }
    throw new Error(`reverted: ${err.cause?.data?.errorName ?? err.shortMessage ?? 'unknown'}`)
  })
  const gas = padGas(await pub.estimateGas({ account: p.account, to: MATCH, data, value }))
  const hash = await p.wallet.sendTransaction({ account: p.account, chain: arcTestnet, to: MATCH, data, value, gas })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') {
    const tx = await pub.getTransaction({ hash })
    let reason = 'unknown'
    try {
      await pub.call({ account: p.account.address, to: MATCH, data, value, blockNumber: r.blockNumber - 1n })
      reason = 'simulation at previous block passes'
    } catch (e) {
      reason = (e as { cause?: { data?: { errorName?: string } }; shortMessage?: string }).cause?.data?.errorName ?? (e as { shortMessage?: string }).shortMessage ?? 'unknown'
    }
    throw new Error(`tx reverted: gasUsed ${r.gasUsed} of ${tx.gas}; ${reason}`)
  }
}
const getMatch = async (id: bigint) =>
  parseMatch((await pub.readContract({ address: MATCH, abi: penaltyMatchAbi, functionName: 'getMatch', args: [id] })))
const currentId = (p: Player) => pub.readContract({ address: MATCH, abi: penaltyMatchAbi, functionName: 'currentMatch', args: [p.account.address] })

const playKick = async (id: bigint, a: Player, b: Player, dirA: number, dirB: number) => {
  const m0 = await getMatch(id)
  const saltA = randomBytes32()
  const saltB = randomBytes32()
  for (const [p, dir, salt] of [[a, dirA, saltA], [b, dirB, saltB]] as const) {
    const hash = commitHash(id, m0.kicks, p.account.address, dir, salt)
    // the contract's own view function must agree with the client helper
    const onchain = await pub.readContract({ address: MATCH, abi: penaltyMatchAbi, functionName: 'commitHash', args: [id, m0.kicks, p.account.address, dir, salt] })
    if (onchain !== hash) check(`commitHash matches contract (kick ${m0.kicks})`, false)
    else if (m0.kicks === 0) check('commitHash matches contract', true)
    await send(p, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'commit', args: [id, hash] }))
  }
  await send(a, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'reveal', args: [id, dirA, saltA] }))
  await send(b, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'reveal', args: [id, dirB, saltB] }))
}

const main = async () => {
  const alice = await makePlayer()
  const bob = await makePlayer()
  const aliceKey = privateKeyToAccount(generatePrivateKey())

  // 1) private room with a funded helper key for the creator
  const code = randomBytes32()
  const fund = parseEther('0.3')
  await send(alice, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'createMatch', args: [roomCodeHash(alice.account.address, code), aliceKey.address] }), fund)
  const id = await currentId(alice)
  check('createMatch sets currentMatch', id !== 0n, id.toString())
  check('helper key received funding', (await pub.getBalance({ address: aliceKey.address })) === fund)
  let m = await getMatch(id)
  check('room is Open and unranked', m.status === 1 && !m.ranked)

  // wrong code must not join
  let rejected = false
  try {
    await send(bob, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'joinMatch', args: [id, randomBytes32(), '0x0000000000000000000000000000000000000000'] }))
  } catch {
    rejected = true
  }
  check('wrong room code is rejected', rejected)

  await send(bob, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'joinMatch', args: [id, code, '0x0000000000000000000000000000000000000000'] }))
  m = await getMatch(id)
  check('join activates the match', m.status === 2 && m.phase === 0)

  // 2) first kick: Alice signs with her helper key, Bob with his wallet
  const keyWallet = createWalletClient({ account: aliceKey, chain: arcTestnet, transport })
  const saltA = randomBytes32()
  const saltB = randomBytes32()
  const hashA = commitHash(id, 0, alice.account.address, 0, saltA)
  const hashB = commitHash(id, 0, bob.account.address, 1, saltB)
  const viaKey = async (data: Hex) => {
    const gas = padGas(await pub.estimateGas({ account: aliceKey, to: MATCH, data }))
    const h = await keyWallet.sendTransaction({ account: aliceKey, chain: arcTestnet, to: MATCH, data, gas })
    const r = await pub.waitForTransactionReceipt({ hash: h })
    if (r.status !== 'success') throw new Error('key tx reverted')
  }
  await viaKey(encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'commit', args: [id, hashA] }))
  await send(bob, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'commit', args: [id, hashB] }))
  m = await getMatch(id)
  check('both commits move to Revealing', m.phase === 1)
  await viaKey(encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'reveal', args: [id, 0, saltA] }))
  await send(bob, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'reveal', args: [id, 1, saltB] }))
  m = await getMatch(id)
  check('kick resolved by helper key + wallet', m.kicks === 1 && m.lastGoal && m.score1 === 1, `shot ${m.lastShot} dive ${m.lastDive}`)
  check('kickFlags reads goalBits', kickFlags(m).red[0] === true)

  // 3) a full match where Alice always shoots into a corner Bob never dives to
  while ((await getMatch(id)).status === 2) {
    const k = (await getMatch(id)).kicks
    const aliceShoots = k % 2 === 0
    // Bob saves Alice's kick from kick 6 on, so the shootout always has a winner
    await playKick(id, alice, bob, aliceShoots ? 0 : 1, aliceShoots ? (k >= 6 ? 0 : 2) : 0)
  }
  m = await getMatch(id)
  check('match finished with a winner', m.status === 3 && m.winner !== '0x0000000000000000000000000000000000000000', `score ${m.score1}-${m.score2} after ${m.kicks} kicks`)
  check('wallets are free after the match', (await currentId(alice)) === 0n && (await currentId(bob)) === 0n)

  // 4) forfeit: a ranked quick match where one player never commits
  await send(alice, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'quickMatch', args: ['0x0000000000000000000000000000000000000000'] }))
  await send(bob, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'quickMatch', args: ['0x0000000000000000000000000000000000000000'] }))
  const qid = await currentId(alice)
  m = await getMatch(qid)
  check('quick match pairs two wallets as ranked', m.status === 2 && m.ranked)
  const s = randomBytes32()
  await send(alice, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'commit', args: [qid, commitHash(qid, 0, alice.account.address, 2, s)] }))
  let early = false
  try {
    await send(bob, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'claimTimeout', args: [qid] }))
  } catch {
    early = true
  }
  check('claimTimeout is rejected before the deadline', early)
  await test.increaseTime({ seconds: 21 })
  await test.mine({ blocks: 1 })
  await send(alice, encodeFunctionData({ abi: penaltyMatchAbi, functionName: 'claimTimeout', args: [qid] }))
  m = await getMatch(qid)
  check('forfeit after 20s awards the committed player', m.status === 3 && m.winner.toLowerCase() === alice.account.address.toLowerCase())
  const rec = await pub.readContract({ address: MATCH, abi: penaltyMatchAbi, functionName: 'getRecord', args: [alice.account.address] })
  check('ranked forfeit updates the verified record', rec[0] === 1)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
