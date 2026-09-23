// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title OffmintParams — OffmintVault's bounded parameters (SPEC §6.5), validated in a linked library
/// @notice Split out of the vault only to keep it under the EIP-170 size limit.
library OffmintParams {
    struct Params {
        uint16 defaultDeployBps;
        uint16 buybackSlippageBps;
        uint16 perfFeeBps;
        uint32 armDelay;
        uint32 minFrozen;
        uint32 maxPreCloseAge;
        uint32 settleDelay;
        uint32 maxFreshAge;
        uint32 armGrace;
        uint32 settleGrace;
    }

    error ParamOutOfBounds();

    /// @notice Reverts unless every field is inside its hard bound (SPEC §6.5).
    function validate(Params memory p) public pure {
        if (
            p.defaultDeployBps == 0 || p.defaultDeployBps > 5000 || p.buybackSlippageBps > 300 || p.perfFeeBps > 2000
                || p.armDelay < 1 minutes || p.armDelay > 1 hours || p.minFrozen < 5 minutes || p.minFrozen > 2 hours
                || p.maxPreCloseAge < 1 hours || p.maxPreCloseAge > 12 hours || p.settleDelay < 30 minutes
                || p.settleDelay > 12 hours || p.maxFreshAge < 5 minutes || p.maxFreshAge > 2 hours
                || p.armGrace > 12 hours || p.settleGrace > 12 hours
        ) revert ParamOutOfBounds();
    }

    /// @notice SPEC §4 / §6.5 defaults.
    function defaults() public pure returns (Params memory) {
        return Params({
            defaultDeployBps: 3000,
            buybackSlippageBps: 100,
            perfFeeBps: 1000,
            armDelay: 5 minutes,
            minFrozen: 15 minutes,
            maxPreCloseAge: 6 hours,
            settleDelay: 1 hours,
            maxFreshAge: 1 hours,
            armGrace: 2 hours,
            settleGrace: 6 hours
        });
    }
}
