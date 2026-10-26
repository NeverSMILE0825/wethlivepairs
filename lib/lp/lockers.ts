/**
 * Verified liquidity lockers only. A contract is not a locker because its name contains "lock".
 * V3 and V4 locker addresses stay out until their source page and explorer name are both confirmed.
 */

export type LockerCapability = "restricted-until-unlock" | "restricted" | "allowed" | "supported" | "unknown"

export type LockerProvider = {
  id: string
  name: string
  chainId: 1
  versions: readonly ("v2" | "v3" | "v4")[]
  address: string
  source: string
  enabled: boolean
  principalWithdrawal: LockerCapability
  feeCollection: LockerCapability
  increaseLiquidity: LockerCapability
  extension: LockerCapability
}

export const LOCKER_REGISTRY: readonly LockerProvider[] = [
  {
    id: "team-finance",
    name: "Team Finance",
    chainId: 1,
    versions: ["v2"],
    address: "0xe2fe530c047f2d85298b07d9333c05737f1435fb",
    source: "Etherscan public name tag: TrustSwap: Team Finance Lock",
    enabled: true,
    principalWithdrawal: "restricted-until-unlock",
    feeCollection: "restricted",
    increaseLiquidity: "unknown",
    extension: "supported",
  },
  {
    id: "uncx-v2-legacy",
    name: "UNCX",
    chainId: 1,
    versions: ["v2"],
    address: "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214",
    source: "docs.uncx.network legacy Uniswap v2 locker, Etherscan name UniswapV2Locker",
    enabled: true,
    principalWithdrawal: "restricted-until-unlock",
    feeCollection: "restricted",
    increaseLiquidity: "unknown",
    extension: "unknown",
  },
  {
    id: "uncx-v2",
    name: "UNCX",
    chainId: 1,
    versions: ["v2"],
    address: "0x59d7d55ddc58494fbbbca29904f108ece82ac7fb",
    source: "docs.uncx.network contracts: ETH (Uniswap V2)",
    enabled: true,
    principalWithdrawal: "restricted-until-unlock",
    feeCollection: "restricted",
    increaseLiquidity: "unknown",
    extension: "unknown",
  },
]

const byAddress = new Map(LOCKER_REGISTRY.filter((item) => item.enabled).map((item) => [item.address, item]))

export function lockerByAddress(address: string | null | undefined): LockerProvider | null {
  if (!address) return null
  return byAddress.get(address.toLowerCase()) ?? null
}
