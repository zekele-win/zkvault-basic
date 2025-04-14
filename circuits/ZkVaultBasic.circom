pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/pedersen.circom";

// Hash the secret to commitment using Pedersen hash
template CommitmentHasher() {
    // Private input: user's secret
    signal input secret;
    // Output: Pedersen hash of the secret
    signal output commitment;

    // Pedersen hash with 248-bit expectation
    component commitmentHasher = Pedersen(248);
    // Secret bits with 248-bit array
    component secretBits = Num2Bits(248);

    // Convert secret to bits and feed into Pedersen hasher
    secretBits.in <== secret;
    for (var i = 0; i < 248; i++) {
        commitmentHasher.in[i] <== secretBits.out[i];
    }

    // Use the first output of Pedersen hash
    commitment <== commitmentHasher.out[0];
}

// Check if the secret matches the given commitment and pass through recipient
template Withdraw() {
    // Public input: Pedersen hash of the secret
    signal input commitment;
    // Public input: recipient address
    signal input recipient;

    // Private input: user's secret
    signal input secret;

    // Reject empty inputs
    assert(recipient != 0);
    assert(secret != 0);

    // Compute pedersen hash from secret to commitment
    component hasher = CommitmentHasher();
    hasher.secret <== secret;
    hasher.commitment === commitment;

    // Squares are used to prevent optimizer from removing those constraints
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

// Declare the main circuit with public signals
component main {public [commitment, recipient]} = Withdraw();
