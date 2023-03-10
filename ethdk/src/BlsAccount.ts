import { BlsWalletWrapper, Aggregator, type Bundle } from 'bls-wallet-clients'
import { ethers } from 'ethers'
import BlsTransaction from './BlsTransaction'
import type Transaction from './interfaces/Transaction'
import type Account from './interfaces/Account'
import type SendTransactionParams from './interfaces/SendTransactionParams'
import { type BlsNetwork } from './interfaces/Network'

// TODO (ethdk #10) Initially we are just using the local network. This will be
// replaced with a dynamic network selection in the future.
const NETWORK: BlsNetwork = {
  name: 'localhost',
  chainId: 31337,
  rpcUrl: 'http://localhost:8545',
  aggregatorUrl: 'http://localhost:3000',
  verificationGateway: '0x689A095B4507Bfa302eef8551F90fB322B3451c6'
}

export default class BlsAccount implements Account {
  static accountType: string = 'bls'

  address: string
  private readonly privateKey: string
  private readonly wallet: BlsWalletWrapper

  private constructor (privateKey: string, wallet: BlsWalletWrapper) {
    this.privateKey = privateKey
    this.wallet = wallet
    this.address = wallet.address
  }

  static async createAccount (privateKey?: string): Promise<BlsAccount> {
    const pk = privateKey ?? await BlsWalletWrapper.getRandomBlsPrivateKey()

    const wallet = await BlsWalletWrapper.connect(
      pk,
      NETWORK.verificationGateway,
      new ethers.providers.JsonRpcProvider(NETWORK.rpcUrl)
    )

    return new BlsAccount(pk, wallet)
  }

  static async generatePrivateKey (): Promise<string> {
    return await BlsWalletWrapper.getRandomBlsPrivateKey()
  }

  /**
   * Sends a transaction to the aggregator to be bundled and submitted to the L2
   * @param params Array of transactions
   * @returns Transaction hash of the transaction that was sent to the aggregator
   */
  async sendTransaction (params: SendTransactionParams[]): Promise<Transaction> {
    const actions = params.map((tx) => ({
      ethValue: tx.value ?? '0',
      contractAddress: tx.to,
      encodedFunction: tx.data ?? '0x'
    }))

    const nonce = await this.wallet.Nonce()
    const bundle = this.wallet.sign({ nonce, actions })

    return await addBundleToAggregator(bundle)
  }

  /**
   * Sets the trusted account for this account. The trusted account will be able to reset this accounts private key
   * by calling the recoverWallet function using this accounts address and the recovery phrase.
   * @param recoveryPhrase String that is used as salt to generate the recovery hash
   * @param trustedAccountAddress Address of the account that will be able to reset this accounts private key
   * @returns Transaction hash of the transaction that was sent to the aggregator
   */
  async setTrustedAccount (recoveryPhrase: string, trustedAccountAddress: string): Promise<Transaction> {
    const bundle = await this.wallet.getSetRecoveryHashBundle(
      recoveryPhrase,
      trustedAccountAddress
    )

    return await addBundleToAggregator(bundle)
  }

  /**
   * Get the balance of this account
   * @returns The balance of this account formated in ether (instead of wei)
   */
  async getBalance (): Promise<string> {
    const provider = new ethers.providers.JsonRpcProvider(NETWORK.rpcUrl)
    const balance = await provider.getBalance(this.address)

    return ethers.utils.formatEther(balance)
  }
}

async function addBundleToAggregator (bundle: Bundle): Promise<Transaction> {
  const agg = new Aggregator(NETWORK.aggregatorUrl)
  const result = await agg.add(bundle)

  if ('failures' in result) {
    throw new Error(JSON.stringify(result))
  }

  return new BlsTransaction(NETWORK, result.hash)
}
