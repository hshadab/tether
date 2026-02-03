// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { TestUSDT } from "../src/TestUSDT.sol";

contract DeployTestUSDT is Script {
    function run() external {
        vm.startBroadcast();

        TestUSDT token = new TestUSDT();
        token.mint(msg.sender, 1_000_000 * 10 ** 6); // 1M tUSDT

        console.log("TestUSDT deployed at:", address(token));
        console.log("Minted 1,000,000 tUSDT to:", msg.sender);

        vm.stopBroadcast();
    }
}
