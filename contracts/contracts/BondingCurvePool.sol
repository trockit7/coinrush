// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IPancakeV2Router02.sol";

/* ---------------------------------------------------------
 * Minimal factory interface so the pool can live-read
 * platform fee bps & treasury with a safe fallback.
 * --------------------------------------------------------- */
interface ICoinrushFactory {
    function platformTradeFeeBps() external view returns (uint16);
    function treasury() external view returns (address);
}

/**
 * BondingCurvePool (price-preserving migration)
 * - Starter tranche at fixed price p0 (optional)
 * - xy = k curve with virtual reserves (x0,y0) after starter tranche
 * - Fees in BNB go to creator and platform
 * - First-buy gating & % caps + early anti-whale (min/tx/wallet)
 * - Tracks last trade price (18d) and uses it to seed Pancake
 * - On migrate: seed LP at last price; burn leftover tokens; send leftover BNB to platform
 */
contract BondingCurvePool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────────
    // LAUNCH GUARDS + PRICE HELPERS  (PASTE THIS WHOLE BLOCK)
    // ─────────────────────────────────────────────────────────────────────────────
    uint256 public creationTime;
    uint256 public earlyWindowSecs = 15 minutes; // you can change later via setEarlyBuyParams
    uint256 public minEarlyBnb     = 3e15;       // 0.003 BNB minimum buy during early window

    event EarlyBuyParamsUpdated(uint256 minEarlyBnb, uint256 earlyWindowSecs);

    function _initCreationTime() internal {
        if (creationTime == 0) creationTime = block.timestamp;
    }

    function setEarlyBuyParams(uint256 _minEarlyBnb, uint256 _earlyWindowSecs) external onlyOwner {
        minEarlyBnb = _minEarlyBnb;
        earlyWindowSecs = _earlyWindowSecs;
        emit EarlyBuyParamsUpdated(_minEarlyBnb, _earlyWindowSecs);
    }

    // NOTE: If your code uses different names for these storage vars,
    // change them *here once* and you’re done:
    // - replace `x0` with your "virtual native" variable name
    // - replace `y0` with your "virtual token" variable name
    // - replace `reserveNative` with your native reserve variable
    // - replace `reserveToken` with your token reserve variable

    uint256 private constant WAD = 1e18;

    // Return current price (wei per token). If you already have price(), we use it.
    function _priceNowWeiPerToken() internal view returns (uint256 p) {
        // Prefer existing view if present (we have priceWeiPerToken()).
        try this.priceWeiPerToken() returns (uint256 vp) { return vp; } catch {
            // Fallback using (reserves + virtuals)
            uint256 rN = reserveNative + x0;
            uint256 rT = reserveToken + y0;
            if (rT == 0) return 0;
            return (rN * WAD) / rT; // wei per token
        }
    }

    // What price would be AFTER a BUY of (bnbIn -> tokensOut)
    function _priceAfterBuy(uint256 bnbIn, uint256 tokensOut) internal view returns (uint256) {
        uint256 rN = reserveNative + bnbIn + x0;
        uint256 rT = reserveToken - tokensOut + y0;
        require(rT > 0, "POOL_EMPTY_AFTER_BUY");
        return (rN * WAD) / rT;
    }

    // What price would be AFTER a SELL of (tokensIn -> bnbOut)
    function _priceAfterSell(uint256 tokensIn, uint256 bnbOut) internal view returns (uint256) {
        uint256 rN = reserveNative - bnbOut + x0;
        uint256 rT = reserveToken + tokensIn + y0;
        require(rN > 0, "POOL_EMPTY_AFTER_SELL");
        return (rN * WAD) / rT;
    }
    // ─────────────────────────────────────────────────────────────────────────────

    // --- events ---
    event Seeded(uint256 amountBNB);
    event Buy(address indexed buyer, uint256 bnbIn, uint256 tokensOut, uint256 priceWeiPerToken);
    event Sell(address indexed seller, uint256 tokenIn, uint256 bnbOut, uint256 priceWeiPerToken);
    event Migrated(address router, uint256 bnbUsed, uint256 tokenUsed, uint256 lpOut);

    // --- errors ---
    error TradingDisabled();
    error NotFactory();
    error AlreadyInitialized();
    error CapNotReached();

    // --- addresses & fees ---
    address public immutable token;
    address public immutable factory;
    address public immutable creator;
    address public immutable platform;       // fallback platform treasury (constructor)
    uint16  public immutable creatorFeeBps;
    uint16  public immutable platformFeeBps; // fallback platform fee bps (constructor)

    // --- virtual reserves for curve mode ---
    uint256 public immutable x0; // virtual BNB
    uint256 public immutable y0; // virtual token

    // --- tracked real reserves ---
    uint256 public reserveNative; // BNB (net of fees paid)
    uint256 public reserveToken;  // token held by this contract

    uint256 public immutable targetMarketCapWei;
    uint256 public immutable creationBlock;

    // --- migration flag & constants ---
    bool public migrated;
    bool public initialized;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // --- first-buy gating and % caps ---
    bool public firstBuyDone;
    uint16 public immutable creatorFirstBuyCapBps; // e.g. 1000 = 10%
    uint16 public immutable publicBuyCapBps;       // e.g.  100 = 1%
    modifier onlyFactory() { require(msg.sender == factory, "factory only"); _; }

    // --- starter tranche at fixed price p0 ---
// Toggle to disable the fixed-price starter tranche at launch.
// When false, every buy goes through the curve so price moves immediately.
bool public constant STARTER_ENABLED = false;
    uint256 public immutable p0WeiPerToken;        // wei per token
    uint256 public immutable starterTrancheTokens; // 18d
    uint256 public starterSold;

    // BNB collected during starter buys, used to honor sellbacks at p0
    uint256 public escrowBnb;

    // --- early anti-whale (in BNB, gross) ---
    uint256 public immutable minBuyWei;
    uint256 public immutable maxBnbPerTxWei;
    uint256 public immutable maxBnbPerWalletWei;
    uint256 public immutable antiWhaleBlocks;
    mapping(address => uint256) public spentBnb;

    // --- last trade price (BNB per token, 18d) for migration anchoring ---
    uint256 public lastTradePriceWei;

    // --- migration safety knobs ---
    uint16  private constant SLIPPAGE_BPS          = 30;         // 0.30%
    uint256 private constant MIN_BNB_FOR_MIGRATION = 0.02 ether; // avoid dust LP (kept as a hard floor)

    // LP floor for Pancake (factory-configured)
    uint256 public immutable minLiqBnbWei;

    constructor(
        address _factory,
        address _token,
        address _creator,
        address _treasury,              // platform fallback
        uint16  _creatorFeeBps,
        uint16  _platformFeeBps,
        uint256 _x0,
        uint256 _y0,
        uint256 _targetCapWei,
        uint16  _creatorFirstBuyCapBps,
        uint16  _publicBuyCapBps,

        // starter tranche + anti-whale params
        uint256 _p0WeiPerToken,
        uint256 _starterTrancheTokens,
        uint256 _minBuyWei,
        uint256 _maxBnbPerTxWei,
        uint256 _maxBnbPerWalletWei,
        uint256 _antiWhaleBlocks,

        // 18th: LP floor at migration
        uint256 _minLiqBnbWei
    ) payable Ownable(_creator) {
        factory = _factory;
        token = _token;
        creator = _creator;
        platform = _treasury;           // fallback treasury
        creatorFeeBps = _creatorFeeBps;
        platformFeeBps = _platformFeeBps; // fallback fee bps
        x0 = _x0;
        y0 = _y0;
        targetMarketCapWei = _targetCapWei;

        reserveNative = msg.value;
        creationBlock = block.number;
        creatorFirstBuyCapBps = _creatorFirstBuyCapBps;
        publicBuyCapBps = _publicBuyCapBps;

        p0WeiPerToken        = _p0WeiPerToken;
        starterTrancheTokens = _starterTrancheTokens;
        minBuyWei            = _minBuyWei;
        maxBnbPerTxWei       = _maxBnbPerTxWei;
        maxBnbPerWalletWei   = _maxBnbPerWalletWei;
        antiWhaleBlocks      = _antiWhaleBlocks;

        minLiqBnbWei = _minLiqBnbWei;

        if (msg.value > 0) emit Seeded(msg.value);

        // set the creation timestamp once
        _initCreationTime();
    }

    // allow router refunds / airdrops
    receive() external payable {}

    // --- factory-driven dynamic config (with safe fallbacks) ---
    function _platformFeeBpsNow() internal view returns (uint16) {
        // Prefer live read from factory; fallback to constructor value on failure
        try ICoinrushFactory(factory).platformTradeFeeBps() returns (uint16 bps) {
            return bps;
        } catch {
            return platformFeeBps;
        }
    }

    function _platformTreasuryNow() internal view returns (address) {
        // Prefer live read from factory; fallback to constructor value on failure/zero
        try ICoinrushFactory(factory).treasury() returns (address t) {
            return t == address(0) ? platform : t;
        } catch {
            return platform;
        }
    }

    // --- modifiers ---
    modifier active() {
        if (migrated) revert TradingDisabled();
        _;
    }

    // --- init from factory ---
    function initTokenReserve(uint256 amount) external {
        if (msg.sender != factory) revert NotFactory();
        if (initialized) revert AlreadyInitialized();
        reserveToken = amount;
        initialized = true;
    }

    // --- views ---
    function priceWeiPerToken() public view returns (uint256) {
        uint256 rN = reserveNative + x0;
        uint256 rT = reserveToken + y0;
        if (rT == 0) return 0;
        return Math.mulDiv(rN, 1e18, rT);
    }

    function marketCapWei() public view returns (uint256) {
        uint256 p = priceWeiPerToken();
        uint256 ts = IERC20(token).totalSupply();
        return Math.mulDiv(p, ts, 1e18);
    }

    /// @notice UI helper to check if the curve has migrated.
    function isMigrated() external view returns (bool) {
        return migrated;
    }

    /// @notice Current platform fee bps (live from factory if possible).
    function currentPlatformFeeBps() external view returns (uint16) {
        return _platformFeeBpsNow();
    }

    /// @notice Current platform treasury (live from factory if possible).
    function platformTreasury() external view returns (address) {
        return _platformTreasuryNow();
    }

    // === DIAGNOSTIC: proves this is the patched pool ===
    function debugSignature() external pure returns (string memory) {
        return "OPTION_A_V1";
    }

    // --- helpers ---
    function _send(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "BNB send failed");
    }

    // --- buys ---
    function buy(uint256 minTokensOut) external payable nonReentrant active returns (uint256 tokensOut) {
        require(firstBuyDone, "wait: first buy");

        // Early window: block dust so buys actually move price
        if (block.timestamp < creationTime + earlyWindowSecs) {
            require(msg.value >= minEarlyBnb, "BUY_TOO_SMALL");
        }

        // Snapshot old price (used inside _buy for direction check)
        uint256 oldP = _priceNowWeiPerToken();

        tokensOut = _buy(msg.sender, minTokensOut, oldP);
    }

    function buyFor(address to, uint256 minTokensOut)
        external
        payable
        onlyFactory
        nonReentrant
        active
        returns (uint256 tokensOut)
    {
        // Also capture old price for direction check
        uint256 oldP = _priceNowWeiPerToken();

        tokensOut = _buy(to, minTokensOut, oldP);
        if (!firstBuyDone) {
            uint256 cap = (IERC20(token).totalSupply() * creatorFirstBuyCapBps) / 10_000;
            require(tokensOut <= cap, "first-buy cap");
            firstBuyDone = true;
        }
    }

    function openPublic() external onlyFactory {
        require(!firstBuyDone, "already open");
        firstBuyDone = true;
    }

    // fixed-price starter then curve
    function _buy(address to, uint256 minTokensOut, uint256 oldP) internal returns (uint256 tokensOutCurve) {
        uint256 bnbIn = msg.value;
        require(bnbIn > 0, "zero bnb");

        if (!initialized) {
            reserveToken = IERC20(token).balanceOf(address(this));
            initialized = true;
        }

        // early anti-whale on gross bnbIn
        require(bnbIn >= minBuyWei, "min buy");
        require(bnbIn <= maxBnbPerTxWei, "max/tx");
        if (block.number <= creationBlock + antiWhaleBlocks && msg.sender != factory) {
            uint256 newSpent = spentBnb[msg.sender] + bnbIn;
            require(newSpent <= maxBnbPerWalletWei, "max/wallet");
            spentBnb[msg.sender] = newSpent;
        }

        // fees (gross) — use live platform fee + live treasury
        uint16 platBps = _platformFeeBpsNow();
        address platTreasury = _platformTreasuryNow();

        uint256 feeCreator = (bnbIn * creatorFeeBps) / 10_000;
        uint256 feePlat    = (bnbIn * platBps) / 10_000;
        uint256 bnbNet     = bnbIn - feeCreator - feePlat;

        // starter tranche at p0
        if (STARTER_ENABLED && starterSold < starterTrancheTokens) {
            uint256 remaining = starterTrancheTokens - starterSold;
            uint256 tOut = Math.mulDiv(bnbNet, 1e18, p0WeiPerToken);
            if (tOut > remaining) tOut = remaining;
            require(tOut > 0 && tOut >= minTokensOut, "slippage");

            if (msg.sender != factory) {
                uint256 cap = (IERC20(token).totalSupply() * publicBuyCapBps) / 10_000;
                require(tOut <= cap, "public cap");
            }

            // Direction check: price must increase (use net value for accounting)
            uint256 newP = _priceAfterBuy(bnbNet, tOut);
            require(newP > oldP, "BUY_MUST_INCREASE_PRICE");

            // ---- state updates & transfers ----
            reserveNative += bnbNet;
            reserveToken  -= tOut;

            // Starter tranche: keep BNB to honor sellbacks at p0
            escrowBnb += bnbNet;

            if (feeCreator > 0) _send(creator,  feeCreator);
            if (feePlat    > 0) _send(platTreasury, feePlat);

            IERC20(token).safeTransfer(to, tOut);
            starterSold += tOut;

            lastTradePriceWei = p0WeiPerToken; // exact
            emit Buy(to, bnbIn, tOut, p0WeiPerToken);
            return tOut;
        }

        // curve mode
        uint256 xBefore = reserveNative;
        uint256 yBefore = reserveToken;

        uint256 k = (xBefore + x0) * (yBefore + y0);
        uint256 xAfterWithVirtual = (xBefore + bnbNet) + x0;
        require(xAfterWithVirtual > 0, "denom=0");

        uint256 yAfterWithVirtual = k / xAfterWithVirtual;
        require(yAfterWithVirtual >= y0, "math-y0");
        uint256 yAfter = yAfterWithVirtual - y0;
        require(yAfter <= yBefore, "math-y");

        tokensOutCurve = yBefore - yAfter;
        require(tokensOutCurve > 0 && tokensOutCurve >= minTokensOut, "slippage");

        if (msg.sender != factory) {
            uint256 cap2 = (IERC20(token).totalSupply() * publicBuyCapBps) / 10_000;
            require(tokensOutCurve <= cap2, "public cap");
        }

        // Direction check: price must increase (use net value for accounting)
        uint256 newP2 = _priceAfterBuy(bnbNet, tokensOutCurve);
        require(newP2 > oldP, "BUY_MUST_INCREASE_PRICE");

        // ---- state updates & transfers ----
        reserveNative = xBefore + bnbNet;
        reserveToken  = yAfter;

        if (feeCreator > 0) _send(creator,  feeCreator);
        if (feePlat    > 0) _send(platTreasury, feePlat);

        IERC20(token).safeTransfer(to, tokensOutCurve);

        // record **net** price for migration anchoring
        uint256 priceNet = Math.mulDiv(bnbNet, 1e18, tokensOutCurve);
        lastTradePriceWei = priceNet;

        emit Buy(to, bnbIn, tokensOutCurve, priceNet);
        return tokensOutCurve;
    }

    // --- sells ---
    // Starter-phase: if escrowBnb is available, honor sellback at p0 (fees from payout).
    // Otherwise fall back to curve mode.
    function sell(uint256 tokensIn, uint256 minBnbOut) external nonReentrant active {
        require(tokensIn > 0, "no tokens");

        // Snapshot old price for direction check
        uint256 oldP = _priceNowWeiPerToken();

        // Lazy init if needed
        if (!initialized) {
            reserveToken = IERC20(token).balanceOf(address(this));
            initialized = true;
        }

        IERC20 t = IERC20(token);

        // current platform config
        uint16 platBps = _platformFeeBpsNow();
        address platTreasury = _platformTreasuryNow();

        // ---- STARTER-TRANCHE SELLBACK @ p0 (escrow-backed) ----
        if (STARTER_ENABLED && starterSold < starterTrancheTokens && escrowBnb > 0) {
            // Gross BNB needed at fixed price: tokensIn * p0
            uint256 grossNeeded = Math.mulDiv(tokensIn, p0WeiPerToken, 1e18);

            // We only allow sells that the escrow can fully honor
            require(grossNeeded <= escrowBnb, "starter sell limit");

            // Pull tokens now that we know we can pay
            t.safeTransferFrom(msg.sender, address(this), tokensIn);

            // Fees are taken from the BNB out
            uint256 feePlat = (grossNeeded * platBps) / 10_000;
            uint256 feeCre  = (grossNeeded * creatorFeeBps)  / 10_000;
            uint256 net     = grossNeeded - feePlat - feeCre;

            require(net >= minBnbOut, "slippage");

            // Direction check BEFORE state changes: selling should not raise price.
            uint256 newP0 = _priceAfterSell(tokensIn, grossNeeded);
            require(newP0 <= oldP, "SELL_SHOULD_NOT_RAISE_PRICE");

            // Update reserves/escrow
            reserveToken  = reserveToken + tokensIn;
            reserveNative = reserveNative - grossNeeded; // paying out from pool balance
            escrowBnb     = escrowBnb - grossNeeded;

            // Payouts
            if (feePlat > 0) _send(platTreasury, feePlat);
            if (feeCre  > 0) _send(creator,      feeCre);
            _send(msg.sender, net);

            emit Sell(msg.sender, tokensIn, net, p0WeiPerToken);
            return;
        }

        // ---- CURVE MODE ----
        t.safeTransferFrom(msg.sender, address(this), tokensIn);

        uint256 rN = reserveNative + x0;
        uint256 rT = reserveToken + y0;
        uint256 k  = rN * rT;

        uint256 rT2 = rT + tokensIn;
        uint256 rN2 = k / rT2;
        require(rN2 <= rN, "math-x");
        uint256 bnbOut = rN - rN2;
        require(bnbOut > 0, "out=0");

        uint256 feePlat2 = (bnbOut * platBps) / 10_000;
        uint256 feeCre2  = (bnbOut * creatorFeeBps)  / 10_000;
        uint256 net2     = bnbOut - feePlat2 - feeCre2;

        require(net2 >= minBnbOut, "slippage");

        // Direction check BEFORE state changes.
        uint256 newP2s = _priceAfterSell(tokensIn, bnbOut);
        require(newP2s <= oldP, "SELL_SHOULD_NOT_RAISE_PRICE");

        reserveToken  = reserveToken + tokensIn;
        reserveNative = reserveNative - bnbOut;

        if (feePlat2 > 0) _send(platTreasury, feePlat2);
        if (feeCre2  > 0) _send(creator,      feeCre2);
        _send(msg.sender, net2);

        emit Sell(msg.sender, tokensIn, net2, priceWeiPerToken());
    }

    // --- migration (existing path; anchors to lastTradePriceWei or curve price) ---
    function migrate(address router, address lpRecipient) external nonReentrant onlyOwner {
        if (migrated) revert TradingDisabled();
        if (marketCapWei() < targetMarketCapWei) revert CapNotReached();

        IERC20 t = IERC20(token);

        uint256 tokenBal = t.balanceOf(address(this));
        uint256 bnbBal   = address(this).balance;
        require(bnbBal >= MIN_BNB_FOR_MIGRATION, "bnb-too-low");

        // pick target price
        uint256 p = lastTradePriceWei;
        if (p == 0) {
            // no trades yet: fall back to curve marginal price
            p = priceWeiPerToken();
        }
        require(p > 0, "price=0");

        // compute desired pair amounts to hit price p = BNB/TOKEN (18d)
        uint256 bnbNeedAtP = Math.mulDiv(tokenBal, p, 1e18);

        uint256 amountBNBDesired;
        uint256 amountTokenDesired;

        if (bnbBal >= bnbNeedAtP) {
            // enough BNB to pair all tokens at price p
            amountTokenDesired = tokenBal;
            amountBNBDesired   = bnbNeedAtP;
            // leftover BNB -> platform (after LP add)
        } else {
            // not enough BNB: pair ALL BNB, burn leftover tokens
            amountBNBDesired   = bnbBal;
            amountTokenDesired = Math.mulDiv(bnbBal, 1e18, p);
        }

        // enforce LP floor at migration
        require(amountBNBDesired >= minLiqBnbWei, "LP floor");

        // min amounts with 0.30% slippage cushion
        uint256 amountBNBMin   = amountBNBDesired - Math.mulDiv(amountBNBDesired, SLIPPAGE_BPS, 10_000);
        uint256 amountTokenMin = amountTokenDesired - Math.mulDiv(amountTokenDesired, SLIPPAGE_BPS, 10_000);

        // approve exact tokens
        t.approve(router, 0);
        t.approve(router, amountTokenDesired);

        // add liquidity
        (,, uint256 lp) = IPancakeV2Router02(router).addLiquidityETH{value: amountBNBDesired}(
            token,
            amountTokenDesired,
            amountTokenMin,
            amountBNBMin,
            lpRecipient, // pass DEAD if you want LP burned; or an address if you want to keep it
            block.timestamp + 30 minutes
        );

        // leftovers
        uint256 tokenLeft = t.balanceOf(address(this));
        uint256 bnbLeft   = address(this).balance;

        // burn any leftover tokens
        if (tokenLeft > 0) {
            t.safeTransfer(DEAD, tokenLeft);
        }

        // forward leftover BNB (if any) to (live) platform treasury
        if (bnbLeft > 0) {
            _send(_platformTreasuryNow(), bnbLeft);
        }

        reserveToken = 0;
        reserveNative = 0;
        migrated = true;

        emit Migrated(router, amountBNBDesired, amountTokenDesired, lp);
    }

    // --- one-shot graduation of current curve reserves to Pancake v2 ---
    /// @notice Migrate curve reserves to Pancake v2 liquidity using *current* reserves (rN/rT).
    /// @dev Uses the contract's tracked reserves (reserveNative/reserveToken).
    ///      After migration, curve trading is disabled (migrated = true).
    ///      LP is sent to DEAD (burn); change to owner() if you want to keep LP.
    function graduate(
        address router,
        uint256 minTokens,   // slippage floor for tokens added
        uint256 minBNB,      // slippage floor for BNB added
        uint256 deadline
    )
        external
        onlyOwner
        nonReentrant
        active
        returns (uint256 amtToken, uint256 amtBNB, uint256 lpOut)
    {
        if (router == address(0)) revert("bad router");

        uint256 rT = reserveToken;
        uint256 rN = reserveNative;
        if (rT == 0 || rN == 0) revert("empty reserves");

        // lock further curve trading immediately
        migrated = true;

        // Approve router to pull tokens
        IERC20(token).approve(router, 0);
        IERC20(token).approve(router, rT);

        // Add liquidity with all curve reserves
        (amtToken, amtBNB, lpOut) = IPancakeV2Router02(router).addLiquidityETH{value: rN}(
            token,
            rT,
            minTokens,
            minBNB,
            DEAD,       // burn LP; use owner() if you want to keep it
            deadline
        );

        // Zero out curve reserves after moving to AMM
        reserveToken = 0;
        reserveNative = 0;

        emit Migrated(router, amtBNB, amtToken, lpOut);
    }
}
