// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.32;

import "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol";
import { ProofOfMembershipVerifier } from "./ProofOfMembershipVerifier.sol";

contract CryptoMixer {
    using IncrementalBinaryTree for IncrementalTreeData;
	
	ProofOfMembershipVerifier private immutable VERIFIER;


    mapping(uint256 => bool) public roots;
    mapping(uint256 => bool) public nullifiers;

    IncrementalTreeData public tree;

    event Deposited(uint256 commitment);

    constructor(ProofOfMembershipVerifier _verifier) {
		VERIFIER = _verifier;
        tree.init(20, 0);
        roots[tree.root] = true;
    }


    function deposit(uint256 commitment) payable public {
		require(msg.value == 0.001 ether, "Deposit must be exactly 0.001 ETH");
		tree.insert(commitment);
        roots[tree.root] = true;
        emit Deposited(commitment);
	}

    function withdraw(bytes calldata proof, address payable to, uint256 nonce) public{
        // unwrap the proof (to extract signals)
        ( uint256[2] memory pia, uint256[2][2] memory pib, uint256[2] memory pic, uint256[5] memory signals)
            = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2], uint256[5]));
        
        // check signals
        uint256 root = signals[0];      
        uint256 nullifier = signals[2];
        require(roots[root], "root isn't part of merkle tree");
        require(!nullifiers[nullifier], "Nullifier already used");
        require(signals[3] == nonce, "Nonce mismatch");
        require(signals[4] == uint256(uint160(address(to))), "Recipient mismatch");
        
        // check the proof
        (bool valid, bytes memory data) = address(VERIFIER).staticcall(abi.encodeWithSelector(ProofOfMembershipVerifier.verifyProof.selector, pia, pib, pic, signals));
        require(valid, "Proof Not Valid"); 
        require(abi.decode(data, (bool)), "Proof verification failed"); 

        nullifiers[nullifier] = true;
        // Transfer funds
        (bool sent, ) = to.call{value: 0.001 ether}("");
        require(sent, "Failed to send Ether");
    }
}