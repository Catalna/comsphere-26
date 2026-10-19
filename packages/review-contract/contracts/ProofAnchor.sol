// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Minimal on-chain anchoring of canonical proof package commitments.
/// The backend relayer records the SHA-256 commitment of a canonical proof
/// package after a 2-of-3 Verifier quorum finalizes a decision. One commitment
/// per opaque proof ID, immutable once recorded. There is no owner, admin, or
/// deletion path: anchoring is append-only by design.
contract ProofAnchor {
    error EXPECT_INVALID_RELAYER();
    error EXPECT_RELAYER_ONLY();
    error EXPECT_INVALID_PROOF_ID();
    error EXPECT_INVALID_COMMITMENT();
    error EXPECT_ALREADY_ANCHORED();

    event ProofAnchored(bytes32 indexed proofId, bytes32 indexed commitment);

    address public immutable relayer;
    mapping(bytes32 => bytes32) public proofCommitments;

    constructor(address initialRelayer) {
        if (initialRelayer == address(0)) revert EXPECT_INVALID_RELAYER();
        relayer = initialRelayer;
    }

    function anchorProof(bytes32 proofId, bytes32 commitment) external {
        if (msg.sender != relayer) revert EXPECT_RELAYER_ONLY();
        if (proofId == bytes32(0)) revert EXPECT_INVALID_PROOF_ID();
        if (commitment == bytes32(0)) revert EXPECT_INVALID_COMMITMENT();
        if (proofCommitments[proofId] != bytes32(0)) revert EXPECT_ALREADY_ANCHORED();
        proofCommitments[proofId] = commitment;
        emit ProofAnchored(proofId, commitment);
    }
}
