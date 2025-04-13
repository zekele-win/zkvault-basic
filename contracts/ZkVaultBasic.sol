// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Groth16Verifier} from "./ZkVaultBasicVerifier.sol";

/// @title ZkVaultBasic - A smart contract for deposit and withdrawal using zk-SNARK proofs
/// @dev This contract allows users to deposit a fixed amount of ETH anonymously
/// and withdraw later using a zero-knowledge proof.
contract ZkVaultBasic is ReentrancyGuard {
    // Commitment status
    enum CommitmentStatus {
        UNUSED,
        DEPOSITED,
        SPENT
    }

    // Verifier interface
    IVerifier private immutable _verifier;
    // Deposit denomination
    uint256 private immutable _denomination;
    // Mapping to track commitments and whether they have been used or spent
    mapping(bytes32 => CommitmentStatus) private _commitments;

    /// @notice Emitted when a user deposits ETH into the vault
    /// @param commitment The Pedersen hash of the user's secret
    /// @param timestamp The block timestamp when the deposit was made.
    event Deposit(bytes32 indexed commitment, uint256 timestamp);

    /// @notice Emitted when a user successfully withdraws from the vault
    /// @param commitment The same commitment used in the deposit
    /// @param recipient The address that receives the ETH
    /// @param timestamp The block timestamp when the withdrawal was made
    event Withdraw(
        bytes32 indexed commitment,
        address indexed recipient,
        uint256 timestamp
    );

    /// @notice Initializes the vault with a verifier and fixed ETH denomination
    /// @param verifier The address of the zk-SNARK verifier contract
    /// @param aDenomination The fixed ETH amount for each deposit and withdrawal
    constructor(IVerifier verifier, uint256 aDenomination) {
        _verifier = verifier;
        _denomination = aDenomination;
    }

    /// @notice Returns the fixed denomination required for deposit/withdraw
    /// @return The denomination value in wei
    function denomination() external view returns (uint256) {
        return _denomination;
    }

    /// @notice Allows users to deposit ETH with a unique Pedersen commitment
    /// @param commitment The Pedersen hash of the user's secret
    /// @dev The commitment must not have been used before.
    /// The sender must attach exactly `_denomination` ETH.
    function deposit(bytes32 commitment) external payable nonReentrant {
        // Ensure the deposited amount matches the required denomination
        require(msg.value == _denomination, "Invalid deposit amount");

        // Ensure the commitment has not been used before
        require(
            _commitments[commitment] == CommitmentStatus.UNUSED,
            "Commitment already used"
        );

        // Mark the commitment as used
        _commitments[commitment] = CommitmentStatus.DEPOSITED;

        // Emit a Deposit event
        emit Deposit(commitment, block.timestamp);
    }

    /// @notice Withdraws ETH anonymously using a zk-SNARK proof
    /// @param pA zk-SNARK proof parameter A
    /// @param pB zk-SNARK proof parameter B
    /// @param pC zk-SNARK proof parameter C
    /// @param pubSignals The public inputs to the zk circuit:
    /// - pubSignals[2]: commitment (bytes32 cast as uint)
    /// - pubSignals[3]: recipient address (cast to uint160)
    /// @dev The proof must be valid and match an unused commitment.
    /// The `_denomination` ETH is transferred to the recipient.
    function withdraw(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[4] calldata pubSignals
    ) external nonReentrant {
        // Retrieve the commitment from the public signals
        // and ensure it has been deposited
        bytes32 commitment = bytes32(pubSignals[2]);
        require(
            _commitments[commitment] == CommitmentStatus.DEPOSITED,
            "Commitment already spent"
        );

        // Retrieve the recipient address from the public signals
        address recipient = address(uint160(pubSignals[3]));

        // Validate the zero-knowledge proof using the provided proof parameters
        bool valid = _verifier.verifyProof(pA, pB, pC, pubSignals);
        require(valid, "Invalid proof");

        // Mark the commitment as spent
        _commitments[commitment] = CommitmentStatus.SPENT;

        // Transfer the ETH to the recipient
        (bool sent, ) = recipient.call{value: _denomination}("");
        require(sent, "ETH transfer failed");

        // Emit a Withdraw event
        emit Withdraw(commitment, recipient, block.timestamp);
    }

    /// @notice Fallback function blocks accidental ETH transfers
    /// @dev Users must use the `deposit()` function instead
    receive() external payable {
        revert("Use deposit function");
    }
}

/// @title IVerifier - Interface for zk-SNARK proof verifier
/// @dev Must return true if the proof and public signals are valid
interface IVerifier {
    /// @notice Verifies a zk-SNARK proof with public inputs
    /// @param pA Proof parameter A
    /// @param pB Proof parameter B
    /// @param pC Proof parameter C
    /// @param pubSignals The public input values used by the circuit
    /// @return Returns Returns true if the zk-SNARK proof is valid
    function verifyProof(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[4] calldata pubSignals
    ) external view returns (bool);
}
