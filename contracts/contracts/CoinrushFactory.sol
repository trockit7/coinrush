// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./BondingCurvePool.sol";
import "./CoinrushToken.sol";

contract CoinrushFactory is Ownable {
    // ─────────────── Events ───────────────
    event PoolCreated(address indexed creator, address token, address pool);

    // kept for backward-compat with existing tooling/UI
    event CreationFeeUpdated(uint256 oldFeeWei, uint256 newFeeWei);

    // new admin events
    event PlatformFeeUpdated(uint16 oldBps, uint16 newBps);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // ─────────────── Platform config (mutable now) ───────────────
    address public treasury;                 // payout wallet (was immutable)
    uint16  public platformFeeBps;           // platform fee on each curve trade in BPS (was immutable)
    uint256 public creationFeeWei;           // creation fee (mutable)

    // max platform fee safety rail (requested 15%)
    uint16 public constant MAX_PLATFORM_FEE_BPS = 1500; // 15%

    // ─────────────── Fixed tokenomics ───────────────
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether; // 1B tokens (18 decimals)

    // ─────────────── Caps (bps) ───────────────
    // TESTING: send 10000 bps (100%) to the pool so caps are effectively disabled.
    uint16  public constant CREATOR_FEE_CAP_BPS       = 500;    // ≤ 5% creator fee (kept)
    uint16  public constant CREATOR_FIRST_BUY_CAP_BPS = 1000;  // 100% → no creator first-buy cap (testing)
    uint16  public constant PUBLIC_BUY_CAP_BPS        = 1000;  // 100% → no per-tx % cap (testing)

    constructor(address _treasury, uint16 _platformFeeBps, uint256 _creationFeeWei)
        Ownable(msg.sender)
    {
        require(_treasury != address(0), "treasury=0");
        require(_platformFeeBps <= MAX_PLATFORM_FEE_BPS, "platformFee too high");
        treasury        = _treasury;
        platformFeeBps  = _platformFeeBps;
        creationFeeWei  = _creationFeeWei;
    }

    // ─────────────── Admin setters (owner-only) ───────────────
    function setPlatformFeeBps(uint16 bps) external onlyOwner {
        require(bps <= MAX_PLATFORM_FEE_BPS, "fee too high");
        emit PlatformFeeUpdated(platformFeeBps, bps);
        platformFeeBps = bps;
    }

    function setCreationFeeWei(uint256 newFeeWei) external onlyOwner {
        emit CreationFeeUpdated(creationFeeWei, newFeeWei);
        creationFeeWei = newFeeWei;
    }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "treasury=0");
        emit TreasuryUpdated(treasury, t);
        treasury = t;
    }

    /// Create token + pool and perform the creator's first buy in the same tx.
    /// UI supplies: name, symbol, creatorFee% (≤5%), targetCapBNB, initialBuyBNB, minTokensOut(=0 for beginners).
    function createTokenAndPoolWithFirstBuy(
        string calldata name,
        string calldata symbol,
        uint16  creatorFeeBps,        // 0..500
        uint256 /* targetCapWei */,   // kept in signature; we use our constant below
        uint256 initialBuyWei,
        uint256 minTokensOut
    ) external payable returns (address tokenAddr, address poolAddr)
    {
        require(creatorFeeBps <= CREATOR_FEE_CAP_BPS, "creator fee >5%");
        require(msg.value >= creationFeeWei + initialBuyWei, "insufficient value");

        // Send creation fee to treasury
        (bool ok, ) = payable(treasury).call{value: creationFeeWei}("");
        require(ok, "fee xfer failed");

        // Token: factory temporary owner/minter (so it can revoke), then hand to creator
        CoinrushToken token = new CoinrushToken(name, symbol, address(this), address(this));

        // --- Anti-whale limits (TESTING) ---
        uint256 minBuyWei          = 0;
        uint256 maxBnbPerTxWei     = type(uint256).max;   // effectively no per-tx cap
        uint256 maxBnbPerWalletWei = type(uint256).max;   // effectively no per-wallet cap
        uint256 antiWhaleBlocks    = 0;                   // no early window

        // ============================================================
        //           Price & curve shape (jumpier but healthy)
        // ============================================================

        // 0) Read supply (if not minted yet, fallback to constant)
        uint256 totalSupplyWei = IERC20(address(token)).totalSupply();
        if (totalSupplyWei == 0) {
            totalSupplyWei = TOTAL_SUPPLY;
        }

        // 1) Opening market-cap in BNB → starting price P0 = MC0 / supply.
        uint256 MC0_BNB = 10 ether;   // ← CHANGED (was 2 ether)

        // 2) Make initial spot exactly P0 even though the pool holds full supply.
        //    (here we intentionally decouple X0 from MC0 for a jumpier curve)
        uint256 X0 = 5 ether;      // ← CHANGED (was X0 = MC0_BNB)
        uint256 Y0 = 0;

        // 3) Starter fixed price P0 reference (for tranche/UI)
        uint256 P0WeiPerToken = Math.mulDiv(MC0_BNB, 1e18, totalSupplyWei);

        // 4) Starter tranche = 1% of supply (keep for tests; can change to /200 for 0.5%)
        uint256 STARTER_TOKENS = totalSupplyWei / 100;

        // 5) Map limits
        uint256 MIN_BUY        = minBuyWei;
        uint256 MAX_PER_TX     = maxBnbPerTxWei;
        uint256 MAX_PER_WALLET = maxBnbPerWalletWei;
        uint256 EARLY_BLOCKS   = antiWhaleBlocks;

        // 6) Target cap for migration (BNB) — testing
        uint256 TARGET_CAP_BNB = 1 ether;
        // For prod, set to: uint256 TARGET_CAP_BNB = 40 ether;

        // 7) LP floor for Pancake (BNB) — unchanged
        uint256 MIN_LIQ_BNB = 0.05 ether;

        // ============================================================

        // ---- Deploy pool (no seed BNB) ----
        BondingCurvePool p = new BondingCurvePool{value: 0}(
            address(this),                // _factory
            address(token),               // _token
            msg.sender,                   // _creator / owner
            treasury,                     // _treasury (platform)
            creatorFeeBps,                // _creatorFeeBps (from UI)
            platformFeeBps,               // _platformFeeBps (mutable)

            X0,                           // _x0
            Y0,                           // _y0

            TARGET_CAP_BNB,               // _targetCapWei

            CREATOR_FIRST_BUY_CAP_BPS,    // _creatorFirstBuyCapBps (100% during testing)
            PUBLIC_BUY_CAP_BPS,           // _publicBuyCapBps (100% during testing)

            P0WeiPerToken,                // _p0WeiPerToken
            STARTER_TOKENS,               // _starterTrancheTokens

            MIN_BUY,                      // _minBuyWei
            MAX_PER_TX,                   // _maxBnbPerTxWei
            MAX_PER_WALLET,               // _maxBnbPerWalletWei
            EARLY_BLOCKS,                 // _antiWhaleBlocks

            MIN_LIQ_BNB                   // _minLiqBnbWei
        );

        tokenAddr = address(token);
        poolAddr  = address(p);

        // Mint full supply to the pool and init tracked reserve
        token.mint(poolAddr, TOTAL_SUPPLY);
        token.approve(address(p), TOTAL_SUPPLY);
        p.initTokenReserve(TOTAL_SUPPLY);

        // Creator's first buy, or open to public if zero
        if (initialBuyWei > 0) {
            p.buyFor{value: initialBuyWei}(msg.sender, minTokensOut);
        } else {
            p.openPublic();
        }

        // Lock minting and hand token ownership to creator
        token.revokeMinter();
        token.transferOwnership(msg.sender);

        emit PoolCreated(msg.sender, tokenAddr, poolAddr);
    }
}
