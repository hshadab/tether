// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDT - A simple ERC-20 for testing zkML-gated transfers on Sepolia
/// @notice FOR TESTING ONLY - This contract has a permissionless mint function.
/// @dev DO NOT use this contract in production. Anyone can mint unlimited tokens.
contract TestUSDT is ERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Test Tether USD", "tUSDT") { }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Anyone can mint tokens for testing purposes
    /// @dev WARNING: Permissionless mint - for testnet use only!
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
