// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ShieldedPool, IPoseidonT3, IPoseidonT5, ITransactionVerifier} from "../contracts/ShieldedPool.sol";
import {Groth16Verifier} from "../contracts/TransactionVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Deploys the Poseidon hashers, the Groth16 verifier and the pool. Usage:
/// TOKENS=0x..,0x.. TREASURY=0x.. CHAIN_ID=46630 forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    function run() external {
        // The asset set is permanent: the pool cannot add a token later.
        address[] memory tokens = vm.envAddress("TOKENS", ",");
        require(tokens.length > 0, "TOKENS is empty");
        uint256 expectedChain = vm.envUint("CHAIN_ID");
        require(block.chainid == expectedChain, "wrong chain");
        IERC20[] memory assets = new IERC20[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i].code.length > 0, "a TOKENS entry has no code at that address");
            assets[i] = IERC20(tokens[i]);
        }

        vm.startBroadcast();

        address hash2 = _deploy(vm.parseBytes(vm.readFile("build/PoseidonT3.bin")));
        address hash4 = _deploy(vm.parseBytes(vm.readFile("build/PoseidonT5.bin")));
        Groth16Verifier verifier = new Groth16Verifier();
        // TREASURY should be a contract such as a Safe, not a hot wallet.
        address treasury = vm.envAddress("TREASURY");
        require(treasury != address(0), "TREASURY unset");
        require(treasury.code.length > 0, "TREASURY has no contract on this chain: activate the Safe first");

        ShieldedPool pool = new ShieldedPool(
            assets, IPoseidonT3(hash2), IPoseidonT5(hash4), ITransactionVerifier(address(verifier)), treasury
        );

        vm.stopBroadcast();

        console2.log("chainId      ", block.chainid);
        console2.log("deployBlock  ", block.number);
        for (uint256 i = 0; i < tokens.length; i++) console2.log("token        ", tokens[i]);
        console2.log("PoseidonT3   ", hash2);
        console2.log("PoseidonT5   ", hash4);
        console2.log("Verifier     ", address(verifier));
        console2.log("ShieldedPool ", address(pool));
        console2.log("treasury     ", treasury);
    }

    function _deploy(bytes memory creationCode) internal returns (address addr) {
        assembly { addr := create(0, add(creationCode, 0x20), mload(creationCode)) }
        require(addr != address(0), "deploy failed");
    }
}
