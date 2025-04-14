import { expect } from "chai";
import { wasm, WasmTester } from "circom_tester";
import * as pedersen from "../utils/pedersen";

describe("ZkVaultBasic _circuit", () => {
  let _circuit: WasmTester;

  before(async () => {
    _circuit = await wasm("./circuits/ZkVaultBasic.circom");
  });

  it("should correctly invoke.", async () => {
    const secret = 1234n;
    const recipient = 5678n;
    const commitment = await pedersen.hash(secret);

    const witness = await _circuit.calculateWitness(
      { commitment, recipient, secret },
      true
    );

    await _circuit.assertOut(witness, {});
  });

  it("should throw error if recipient = 0n.", async () => {
    const secret = 1234n;
    const recipient = 0n;
    const commitment = await pedersen.hash(secret);

    await expect(
      _circuit.calculateWitness({ commitment, recipient, secret }, true)
    ).to.be.rejectedWith(Error, /Assert Failed/);
  });

  it("should throw error if secret = 0n.", async () => {
    const secret = 0n;
    const recipient = 5678n;
    const commitment = await pedersen.hash(secret);

    await expect(
      _circuit.calculateWitness({ commitment, recipient, secret }, true)
    ).to.be.rejectedWith(Error, /Assert Failed/);
  });

  it("should throw error if commitment is incorrect.", async () => {
    const secret = 1234n;
    const recipient = 5678n;
    const commitment = 0xabcdn;

    await expect(
      _circuit.calculateWitness({ commitment, recipient, secret }, true)
    ).to.be.rejectedWith(Error, /Assert Failed/);
  });
});
