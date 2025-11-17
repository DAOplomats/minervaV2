import prisma from "../utils/prisma.js";
import { processTallyDecision } from "../utils/tally.js";
import logger from "../utils/winston.js";

const redecideProposal = async (req, res) => {
  try {
    const { proposalId } = req.params;
    const proposal = await prisma.proposals.findUnique({
      where: {
        id: proposalId,
      },
      include: {
        dao: true,
        decisions: true,
      },
    });

    if (!proposal) {
      return res.json({
        success: false,
        message: "Proposal not found",
      });
    }

    if (proposal.dao.platform === "tally") {
      await processTallyDecision(proposal.dao, proposal.decisions[0], proposal);
    } else {
      return res.json({
        success: false,
        message: "Unsupported platform",
      });
    }

    return res.json({
      success: true,
      message: "Proposal redecided successfully",
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

export { redecideProposal };
