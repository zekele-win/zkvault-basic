import { program } from "commander";
import dotenv from "dotenv";
dotenv.config();
import path from "path";
import fs from "fs";
import { ethers } from "ethers";
import crypto from "crypto";
import { utils as ffutils } from "ffjavascript";
import * as snarkjs from "snarkjs";
import * as hex from "../utils/hex";
import * as pedersen from "../utils/pedersen";

/**
 * Generates a wallet from the given mnemonic and derivation index.
 * @param mnemonic The mnemonic phrase.
 * @param index The wallet index in the HD derivation path.
 * @param provider An ethers JsonRpcProvider instance.
 * @returns A Wallet instance connected to the provider.
 */
function generateWallet(
  mnemonic: string,
  index: number,
  provider: ethers.JsonRpcProvider
): ethers.Wallet {
  const hdAallet = ethers.HDNodeWallet.fromPhrase(
    mnemonic,
    undefined,
    `m/44'/60'/0'/0/${index}`
  );
  return new ethers.Wallet(hdAallet.privateKey, provider);
}

/**
 * Retrieves the deployed vault contract address for a specific network.
 * @param network The target network name (e.g., "mainnet", "sepolia", "test").
 * @returns The deployed contract address.
 */
function getVaultContractAddress(network: string): string {
  const filePath = path.join(
    __dirname,
    `../artifacts/deployments/${network}/ZkVaultBasic.json`
  );
  const deployment = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return deployment.address;
}

/**
 * Loads the ABI for the ZkVaultBasic contract.
 * @returns The contract ABI array.
 */
function getVaultContractAbi(): any[] {
  const filePath = path.join(__dirname, `../artifacts/abis/ZkVaultBasic.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Prints the ETH balances of specified wallet addresses.
 * @param tag A label for the current balance snapshot (e.g., "Before deposit").
 * @param provider An ethers.js provider.
 * @param wallets A record of label => address.
 */
async function printBalances(
  tag: string,
  provider: ethers.JsonRpcProvider,
  wallets: Record<string, string>
) {
  console.log(`[${tag}]`);
  for (const [label, address] of Object.entries(wallets)) {
    const balance = await provider.getBalance(address);
    console.log(`${label}: ${ethers.formatEther(balance)} ETH`);
  }
}

/**
 * Executes the deposit operation into the zkVault contract.
 * Generates a random secret, computes a Pedersen commitment,
 * and sends ETH into the vault with that commitment.
 */
async function deposit() {
  const network = process.env.NETWORK as string;
  const nodeUrl = process.env.NODE_URL as string;
  const mnemonic = process.env.MNEMONIC as string;

  const provider = new ethers.JsonRpcProvider(nodeUrl);

  const depositWallet = generateWallet(mnemonic, 0, provider);
  console.log({ depositWallet });

  const vaultContract = new ethers.Contract(
    getVaultContractAddress(network),
    getVaultContractAbi(),
    depositWallet
  );

  // Generate a 31-byte random secret as bigint
  const secret = ffutils.leBuff2int(crypto.randomBytes(31));
  console.log({ secret });

  // Compute the Pedersen commitment for the secret
  const commitment = await pedersen.hash(secret);
  console.log({ commitment });

  // Fetch the vault's deposit denomination
  const denomination = await vaultContract.denomination();
  console.log({ denomination: ethers.formatEther(denomination) });

  // Print balances before the deposit
  await printBalances("Before deposit", provider, {
    depositWallet: depositWallet.address,
    vaultContract: await vaultContract.getAddress(),
  });

  // Perform the deposit transaction
  const tx = await vaultContract.deposit(hex.from(commitment), {
    value: denomination,
    gasLimit: 5_000_000,
    maxFeePerGas: ethers.parseUnits("50", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("2", "gwei"),
  });
  console.log({ tx });
  const receipt = await tx.wait();
  console.log({ receipt });

  // Print balances after the deposit
  await printBalances("After deposit", provider, {
    depositWallet: depositWallet.address,
    vaultContract: await vaultContract.getAddress(),
  });

  console.log(
    `Depost successful with: ${JSON.stringify(
      { secret: secret.toString(), commitment: commitment.toString() },
      null,
      2
    )}`
  );

  process.exit(0);
}

/**
 * Executes the withdrawal operation from the zkVault contract.
 * Requires a valid secret from a previous deposit. Proves knowledge
 * of the secret via zkSNARK and transfers funds to the recipient.
 * @param secret The original deposit secret (bigint).
 */
async function withdraw(secret: bigint) {
  console.log({ secret });

  const network = process.env.NETWORK as string;
  const nodeUrl = process.env.NODE_URL as string;
  const mnemonic = process.env.MNEMONIC as string;

  const provider = new ethers.JsonRpcProvider(nodeUrl);

  const withdrawWallet = generateWallet(mnemonic, 1, provider);
  const recipientWallet = generateWallet(mnemonic, 2, provider);
  console.log({ withdrawWallet, recipientWallet });

  const vaultContract = new ethers.Contract(
    getVaultContractAddress(network),
    getVaultContractAbi(),
    withdrawWallet
  );

  // Recompute the commitment from the given secret
  const commitment = await pedersen.hash(secret);
  console.log({ commitment });

  // Generate the zero-knowledge proof for the withdrawal
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      // Public inputs
      commitment,
      recipient: BigInt(recipientWallet.address),

      // Private inputs
      secret,
    },
    path.join(__dirname, "../build/ZkVaultBasic_js/ZkVaultBasic.wasm"),
    path.join(__dirname, "../build/ZkVaultBasic.zkey")
  );

  // Print balances before the withdrawal
  await printBalances("Before withdraw", provider, {
    withdrawWallet: withdrawWallet.address,
    recipientWallet: recipientWallet.address,
    vaultContract: await vaultContract.getAddress(),
  });

  // Perform the withdrawal using the generated zk proof
  const tx = await vaultContract.withdraw(
    [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    [
      BigInt(publicSignals[0]),
      BigInt(publicSignals[1]),
      BigInt(publicSignals[2]),
      BigInt(publicSignals[3]),
    ]
  );
  console.log({ tx });
  const receipt = await tx.wait();
  console.log({ receipt });

  // Print balances after the withdrawal
  await printBalances("After withdraw", provider, {
    withdrawWallet: withdrawWallet.address,
    recipientWallet: recipientWallet.address,
    vaultContract: await vaultContract.getAddress(),
  });

  console.log(
    `Withdraw successful with: ${JSON.stringify(
      { secret: secret.toString(), commitment: commitment.toString() },
      null,
      2
    )}`
  );

  process.exit(0);
}

/**
 * Entry point using Commander to parse options.
 * Supports `deposit` and `withdraw` commands.
 */
async function main() {
  program.description("zkvault-basic CLI");

  program
    .command("deposit")
    .description("Deposit ETH into the vault.")
    .action(async () => {
      await deposit();
    });

  program
    .command("withdraw")
    .description("Withdraw ETH from the vault.")
    .option(
      "--secret <secret>",
      "The returned secret when you deposit.",
      (value) => BigInt(value)
    )
    .action(async (opts) => {
      await withdraw(opts.secret);
    });

  program.parse();
}

main();
