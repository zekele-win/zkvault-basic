import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { ZkVaultBasic } from "../typechain-types";
import * as snarkjs from "snarkjs";
import * as hex from "../utils/hex";
import * as pedersen from "../utils/pedersen";

describe("ZkVaultBasic contract", function () {
  const _denomination = ethers.parseEther("0.1");

  let _vaultContract: ZkVaultBasic;
  let _ownerAccount: Signer;
  let _guestAccount: Signer;

  async function deposit(commitment: bigint, value: bigint = 0n) {
    return value
      ? _vaultContract.deposit(commitment, { value })
      : _vaultContract.deposit(commitment);
  }

  async function withdraw(
    commitment: bigint,
    recipient: bigint,
    secret: bigint,
    fakeProof: boolean = false
  ) {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      {
        // Public inputs
        commitment,
        recipient,

        // Private inputs
        secret,
      },
      "./build/ZkVaultBasic_js/ZkVaultBasic.wasm",
      "./build/ZkVaultBasic.zkey"
    );
    // console.log({ proof, publicSignals });

    return _vaultContract.withdraw(
      [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
      [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ],
      fakeProof ? [0n, 0n] : [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
      [BigInt(publicSignals[0]), BigInt(publicSignals[1])]
    );
  }

  beforeEach(async function () {
    [_ownerAccount, _guestAccount] = await ethers.getSigners();
    // console.log({ _ownerAccount, _guestAccount });

    const verifierContractFactory = await ethers.getContractFactory(
      "Groth16Verifier"
    );
    const verifierContract = await verifierContractFactory.deploy();
    const verifierContractAddress = await verifierContract.getAddress();
    // console.log({ verifierContractAddress });

    const vaultContractFactory = await ethers.getContractFactory(
      "ZkVaultBasic"
    );
    _vaultContract = await vaultContractFactory.deploy(
      verifierContractAddress,
      _denomination
    );
  });

  describe("deploy", function () {
    it("should correctly deploy.", async function () {
      expect(await _vaultContract.getAddress()).to.be.properAddress;
    });

    it("should correctly set the denomination.", async function () {
      const denomination = await _vaultContract.denomination();
      expect(denomination).to.equal(_denomination);
    });
  });

  describe("receive", function () {
    it("should revert if the contract received ETH.", async function () {
      await expect(
        _ownerAccount.sendTransaction({
          to: await _vaultContract.getAddress(),
          value: _denomination,
        })
      ).to.be.revertedWith("Use deposit function");
    });
  });

  describe("deposit", function () {
    it("should revert if msg.value lost.", async function () {
      const commitment = 1234n;
      await expect(deposit(commitment)).to.revertedWith(
        "Invalid deposit amount"
      );
    });

    it("should revert if msg.value != denomination.", async function () {
      const commitment = 1234n;
      await expect(deposit(commitment, _denomination + 1n)).to.revertedWith(
        "Invalid deposit amount"
      );
    });

    it("should revert if commitment already used.", async function () {
      const commitment = 1234n;
      await deposit(commitment, _denomination);
      await expect(deposit(commitment, _denomination)).to.revertedWith(
        "Commitment already used"
      );
    });

    it("should correctly emit an event on deposit.", async function () {
      const commitment = 1234n;
      await expect(deposit(commitment, _denomination))
        .to.emit(_vaultContract, "Deposit")
        .withArgs(commitment, anyValue);
    });

    it("should correctly deposit the correct denomination to contract.", async function () {
      const commitment = 1234n;

      const vaultContractBalnceBefore =
        await _ownerAccount.provider!.getBalance(
          await _vaultContract.getAddress()
        );
      const ownerAccountBalnceBefore = await _ownerAccount.provider!.getBalance(
        await _ownerAccount.getAddress()
      );

      const tx = await deposit(commitment, _denomination);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const vaultContractBalnceAfter = await _ownerAccount.provider!.getBalance(
        await _vaultContract.getAddress()
      );
      const ownerAccountBalnceAfter = await _ownerAccount.provider!.getBalance(
        await _ownerAccount.getAddress()
      );

      expect(vaultContractBalnceAfter - vaultContractBalnceBefore).to.equal(
        _denomination
      );
      expect(ownerAccountBalnceBefore - ownerAccountBalnceAfter).to.equal(
        _denomination + gasCost
      );
    });
  });

  describe("withdraw", function () {
    it("should revert if commitment already spent.", async function () {
      const secret = 1234n;
      const recipient = 5678n;
      const commitment = await pedersen.hash(secret);

      await expect(withdraw(commitment, recipient, secret)).to.revertedWith(
        "Commitment already spent"
      );
    });

    it("should revert if commitment proof is invalid.", async function () {
      const secret = 1234n;
      const recipient = 5678n;
      const commitment = await pedersen.hash(secret);

      await deposit(commitment, _denomination);

      await expect(
        withdraw(commitment, recipient, secret, true)
      ).to.revertedWith("Invalid proof");
    });

    it("should correctly emit an event on withdraw.", async function () {
      const secret = 1234n;
      const recipient = 5678n;
      const commitment = await pedersen.hash(secret);

      await deposit(commitment, _denomination);

      await expect(withdraw(commitment, recipient, secret))
        .to.emit(_vaultContract, "Withdraw")
        .withArgs(commitment, hex.from(recipient, 20), anyValue);
    });

    it("should correctly emit an event on withdraw event if the caller is not the owner.", async function () {
      const secret = 1234n;
      const recipient = 5678n;
      const commitment = await pedersen.hash(secret);

      await _vaultContract
        .connect(_guestAccount)
        .deposit(commitment, { value: _denomination });

      await expect(withdraw(commitment, recipient, secret))
        .to.emit(_vaultContract, "Withdraw")
        .withArgs(commitment, hex.from(recipient, 20), anyValue);
    });

    it("should correctly withdraw the correct denomination from contract.", async function () {
      const secret = 1234n;
      const recipient = 5678n;
      const commitment = await pedersen.hash(secret);

      await deposit(commitment, _denomination);

      const vaultContractBalnceBefore =
        await _ownerAccount.provider!.getBalance(
          await _vaultContract.getAddress()
        );
      const recipientBalnceBefore = await _ownerAccount.provider!.getBalance(
        hex.from(recipient, 20)
      );

      await withdraw(commitment, recipient, secret);

      const vaultContractBalnceAfter = await _ownerAccount.provider!.getBalance(
        await _vaultContract.getAddress()
      );
      const recipientBalnceAfter = await _ownerAccount.provider!.getBalance(
        hex.from(recipient, 20)
      );

      expect(vaultContractBalnceBefore - vaultContractBalnceAfter).to.equal(
        _denomination
      );
      expect(recipientBalnceAfter - recipientBalnceBefore).to.equal(
        _denomination
      );
    });
  });
});
