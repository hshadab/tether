// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TestUSDT.sol";

contract TestUSDTTest is Test {
    TestUSDT public token;
    address public alice = address(0x1);

    function setUp() public {
        token = new TestUSDT();
    }

    function test_name() public view {
        assertEq(token.name(), "Test Tether USD");
    }

    function test_symbol() public view {
        assertEq(token.symbol(), "tUSDT");
    }

    function test_decimals() public view {
        assertEq(token.decimals(), 6);
    }

    function test_mint() public {
        token.mint(alice, 1_000_000);
        assertEq(token.balanceOf(alice), 1_000_000);
    }

    function test_mintMultiple() public {
        token.mint(alice, 500);
        token.mint(alice, 500);
        assertEq(token.balanceOf(alice), 1000);
    }
}
