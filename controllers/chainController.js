import logger from "../utils/winston.js";
import prisma from "../utils/prisma.js";

const addChain = async (req, res) => {
  try {
    const { id, name, rpcUrl, gasLimit, isCandideEnabled } = req.body;

    const chain = await prisma.chains.create({
      data: {
        id,
        name,
        rpcUrl,
        gasLimit,
        isCandideEnabled,
        bundlerUrl: isCandideEnabled ? req.body.bundlerUrl : null,
        paymasterUrl: isCandideEnabled ? req.body.paymasterUrl : null,
        sponsorshipPolicyId: isCandideEnabled
          ? req.body.sponsorshipPolicyId
          : null,
      },
    });

    return res.json({
      success: true,
      message: "Chain added successfully",
      data: chain,
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: "Something went wrong",
    });
  }
};

const listChains = async (req, res) => {
  try {
    const chains = await prisma.chains.findMany({
      select: {
        id: true,
        name: true,
        rpcUrl: true,
        gasLimit: true,
        isCandideEnabled: true,
        fallback: true,
      },
    });

    return res.json({
      success: true,
      message: "Chains fetched successfully",
      chains,
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export { addChain, listChains };
