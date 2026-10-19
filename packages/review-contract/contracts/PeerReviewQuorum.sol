// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract PeerReviewQuorum is EIP712 {
    enum Decision {
        NONE,
        VERIFIED,
        NEEDS_REVISION,
        REJECTED
    }

    enum RoundStatus {
        NONE,
        OPEN,
        QUORUM_REACHED,
        NO_QUORUM
    }

    struct Vote {
        bytes32 reviewId;
        bytes32 evidenceCommitment;
        bytes32 organizerOrganizationCommitment;
        bytes32 funderOrganizationCommitment;
        uint32 round;
        uint8 decision;
        bytes32 instructionCommitment;
        bool noConflictAttested;
    }

    struct ReviewRound {
        bytes32 evidenceCommitment;
        bytes32 organizerOrganizationCommitment;
        bytes32 funderOrganizationCommitment;
        uint32 round;
        uint8 voteCount;
        Decision decision;
        RoundStatus status;
        uint64 rosterVersion;
        address[3] panel;
        bytes32[3] panelOrganizationCommitments;
    }

    bytes32 private constant VOTE_TYPEHASH = keccak256(
        "Vote(bytes32 reviewId,bytes32 evidenceCommitment,bytes32 organizerOrganizationCommitment,bytes32 funderOrganizationCommitment,uint32 round,uint8 decision,bytes32 instructionCommitment,bool noConflictAttested)"
    );
    bytes32 private constant ROSTER_UPDATE_TYPEHASH = keccak256(
        "RosterUpdate(bytes32 rosterHash,uint256 nonce,uint64 rosterVersion)"
    );

    address public immutable reviewRelayer;
    uint64 public rosterVersion = 1;
    uint256 public rosterNonce;
    address[3] private _verifiers;
    bytes32[3] private _verifierOrganizationCommitments;
    mapping(bytes32 => uint32) public latestRound;
    mapping(bytes32 => uint32) public finalizedRound;
    mapping(bytes32 => bytes32) public evidenceCommitmentForReview;
    mapping(bytes32 => mapping(uint32 => ReviewRound)) private _reviews;
    mapping(bytes32 => mapping(uint32 => mapping(address => bool))) public hasVoted;
    mapping(bytes32 => mapping(uint32 => mapping(uint8 => uint8))) private _decisionVotes;

    error UnauthorizedRelayer();
    error InvalidRoster();
    error InvalidReview();
    error ReviewAlreadyExists();
    error InvalidRound();
    error ReviewNotOpen();
    error EvidenceCommitmentMismatch();
    error InvalidDecision();
    error ConflictNotAttested();
    error InvalidInstructionCommitment();
    error SignerNotInPanel();
    error DuplicateVote();
    error InvalidRosterUpdate();

    event ReviewOpened(
        bytes32 indexed reviewId,
        bytes32 indexed evidenceCommitment,
        uint32 round,
        uint64 rosterVersion,
        address[3] panel
    );
    event VoteSubmitted(
        bytes32 indexed reviewId,
        uint32 indexed round,
        address indexed verifier,
        uint8 decision,
        bytes32 instructionCommitment,
        uint8 voteCount
    );
    event ReviewFinalized(
        bytes32 indexed reviewId,
        bytes32 indexed evidenceCommitment,
        uint32 round,
        uint8 decision,
        bytes32 instructionCommitment
    );
    event ReviewNoQuorum(bytes32 indexed reviewId, bytes32 indexed evidenceCommitment, uint32 round);
    event VerifierRosterUpdated(uint64 indexed rosterVersion, bytes32 rosterHash);

    constructor(address[3] memory verifiers_, bytes32[3] memory organizationCommitments_, address relayer_)
        EIP712("DanaTerang Peer Review", "1")
    {
        if (relayer_ == address(0)) revert InvalidRoster();
        _validateRoster(verifiers_, organizationCommitments_);
        _verifiers = verifiers_;
        _verifierOrganizationCommitments = organizationCommitments_;
        reviewRelayer = relayer_;
    }

    modifier onlyRelayer() {
        if (msg.sender != reviewRelayer) revert UnauthorizedRelayer();
        _;
    }

    function openReview(
        bytes32 reviewId,
        bytes32 evidenceCommitment,
        uint32 round,
        bytes32 organizerOrganizationCommitment,
        bytes32 funderOrganizationCommitment
    ) external onlyRelayer {
        if (reviewId == bytes32(0) || evidenceCommitment == bytes32(0)
            || organizerOrganizationCommitment == bytes32(0) || funderOrganizationCommitment == bytes32(0)) {
            revert InvalidReview();
        }
        if (round != latestRound[reviewId] + 1 || finalizedRound[reviewId] != 0) revert InvalidRound();
        if (round > 1 && _reviews[reviewId][round - 1].status != RoundStatus.NO_QUORUM) revert InvalidRound();
        bytes32 existingCommitment = evidenceCommitmentForReview[reviewId];
        if (existingCommitment != bytes32(0) && existingCommitment != evidenceCommitment) {
            revert EvidenceCommitmentMismatch();
        }
        for (uint256 i = 0; i < 3; i++) {
            bytes32 verifierOrganization = _verifierOrganizationCommitments[i];
            if (verifierOrganization == organizerOrganizationCommitment || verifierOrganization == funderOrganizationCommitment) {
                revert InvalidRoster();
            }
        }

        evidenceCommitmentForReview[reviewId] = evidenceCommitment;
        latestRound[reviewId] = round;
        ReviewRound storage review = _reviews[reviewId][round];
        review.evidenceCommitment = evidenceCommitment;
        review.organizerOrganizationCommitment = organizerOrganizationCommitment;
        review.funderOrganizationCommitment = funderOrganizationCommitment;
        review.round = round;
        review.status = RoundStatus.OPEN;
        review.rosterVersion = rosterVersion;
        review.panel = _verifiers;
        review.panelOrganizationCommitments = _verifierOrganizationCommitments;
        emit ReviewOpened(reviewId, evidenceCommitment, round, rosterVersion, _verifiers);
    }

    function submitVote(Vote calldata vote, bytes calldata signature) external {
        ReviewRound storage review = _reviews[vote.reviewId][vote.round];
        if (review.status != RoundStatus.OPEN) revert ReviewNotOpen();
        if (review.evidenceCommitment != vote.evidenceCommitment) revert EvidenceCommitmentMismatch();
        if (review.organizerOrganizationCommitment != vote.organizerOrganizationCommitment
            || review.funderOrganizationCommitment != vote.funderOrganizationCommitment) {
            revert EvidenceCommitmentMismatch();
        }
        if (vote.decision < uint8(Decision.VERIFIED) || vote.decision > uint8(Decision.REJECTED)) revert InvalidDecision();
        if (!vote.noConflictAttested) revert ConflictNotAttested();
        if (vote.decision == uint8(Decision.NEEDS_REVISION)) {
            if (vote.instructionCommitment == bytes32(0)) revert InvalidInstructionCommitment();
        } else if (vote.instructionCommitment != bytes32(0)) {
            revert InvalidInstructionCommitment();
        }

        bytes32 structHash = keccak256(abi.encode(
            VOTE_TYPEHASH,
            vote.reviewId,
            vote.evidenceCommitment,
            vote.organizerOrganizationCommitment,
            vote.funderOrganizationCommitment,
            vote.round,
            vote.decision,
            vote.instructionCommitment,
            vote.noConflictAttested
        ));
        address verifier = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (!_isInPanel(review.panel, verifier)) revert SignerNotInPanel();
        if (hasVoted[vote.reviewId][vote.round][verifier]) revert DuplicateVote();

        hasVoted[vote.reviewId][vote.round][verifier] = true;
        review.voteCount += 1;
        uint8 matchingVotes = ++_decisionVotes[vote.reviewId][vote.round][vote.decision];
        emit VoteSubmitted(vote.reviewId, vote.round, verifier, vote.decision, vote.instructionCommitment, review.voteCount);

        if (matchingVotes >= 2) {
            review.decision = Decision(vote.decision);
            review.status = RoundStatus.QUORUM_REACHED;
            finalizedRound[vote.reviewId] = vote.round;
            emit ReviewFinalized(vote.reviewId, vote.evidenceCommitment, vote.round, vote.decision, vote.instructionCommitment);
        } else if (review.voteCount == 3) {
            review.status = RoundStatus.NO_QUORUM;
            emit ReviewNoQuorum(vote.reviewId, vote.evidenceCommitment, vote.round);
        }
    }

    function updateVerifierRoster(address[3] calldata newVerifiers, bytes32[3] calldata newOrganizationCommitments, bytes[] calldata signatures)
        external
    {
        if (signatures.length < 2 || signatures.length > 3) revert InvalidRosterUpdate();
        _validateRoster(newVerifiers, newOrganizationCommitments);
        bytes32 rosterHash = keccak256(abi.encode(newVerifiers, newOrganizationCommitments));
        bytes32 structHash = keccak256(abi.encode(ROSTER_UPDATE_TYPEHASH, rosterHash, rosterNonce, rosterVersion));
        bytes32 digest = _hashTypedDataV4(structHash);
        address firstSigner;
        address secondSigner;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (!_isInPanel(_verifiers, signer) || signer == firstSigner || signer == secondSigner) revert InvalidRosterUpdate();
            if (firstSigner == address(0)) firstSigner = signer;
            else secondSigner = signer;
        }
        if (secondSigner == address(0)) revert InvalidRosterUpdate();
        _verifiers = newVerifiers;
        _verifierOrganizationCommitments = newOrganizationCommitments;
        rosterNonce += 1;
        rosterVersion += 1;
        emit VerifierRosterUpdated(rosterVersion, rosterHash);
    }

    function getReview(bytes32 reviewId, uint32 round)
        external
        view
        returns (bytes32 evidenceCommitment, RoundStatus status, Decision decision, uint8 voteCount, uint64 roundRosterVersion, address[3] memory panel)
    {
        ReviewRound storage review = _reviews[reviewId][round];
        return (
            review.evidenceCommitment,
            review.status,
            review.decision,
            review.voteCount,
            review.rosterVersion,
            review.panel
        );
    }

    function isVerifier(address verifier) external view returns (bool) {
        return _isInPanel(_verifiers, verifier);
    }

    function verifierAt(uint256 index) external view returns (address verifier, bytes32 organizationCommitment) {
        if (index >= 3) revert InvalidRoster();
        return (_verifiers[index], _verifierOrganizationCommitments[index]);
    }

    function _validateRoster(address[3] memory verifiers_, bytes32[3] memory organizationCommitments_) internal pure {
        for (uint256 i = 0; i < 3; i++) {
            if (verifiers_[i] == address(0) || organizationCommitments_[i] == bytes32(0)) revert InvalidRoster();
            for (uint256 j = i + 1; j < 3; j++) {
                if (verifiers_[i] == verifiers_[j] || organizationCommitments_[i] == organizationCommitments_[j]) {
                    revert InvalidRoster();
                }
            }
        }
    }

    function _isInPanel(address[3] storage panel, address verifier) internal view returns (bool) {
        for (uint256 i = 0; i < 3; i++) if (panel[i] == verifier) return true;
        return false;
    }
}
