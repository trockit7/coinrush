// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CoinrushToken is ERC20, Ownable {
    address public minter;
    uint256 public immutable creationBlock;

    error NotMinter();

    constructor(string memory name_, string memory symbol_, address initialOwner, address minter_)
        ERC20(name_, symbol_)
        Ownable(initialOwner)
    {
        minter = minter_;
        creationBlock = block.number;
    }

    function setMinter(address m) external onlyOwner {
        minter = m;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }

    function revokeMinter() external onlyOwner {
        minter = address(0);
    }
}
