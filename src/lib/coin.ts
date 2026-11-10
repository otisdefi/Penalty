/**
 * Number format for a small amount of the gas coin: two decimals for normal amounts (USDC on Arc), but enough digits
 * to read tiny ones (a few cents of ETH on Base Sepolia can be 0.000012).
 */
export function coinFormat(amount: number): Intl.NumberFormatOptions {
  return amount >= 0.01 || amount === 0 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumSignificantDigits: 2 }
}
