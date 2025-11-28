import prisma from "../utils/prisma.js";
import { processTallyDecision } from "../utils/tally.js";
import logger from "../utils/winston.js";
import { indexTallyProposal } from "../utils/tally.js";

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
      await processTallyDecision(
        proposal.dao,
        proposal.decisions[0],
        proposal,
        true
      );
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

const indexProposal = async (req, res) => {
  try {
    const { daoId, proposalId } = req.params;

    const dao = await prisma.dAOs.findMany({
      where: {
        daoId: daoId,
      },
    });

    if (dao[0].platform === "tally") {
      await indexTallyProposal(dao[0], proposalId);
    }

    return res.json({
      success: true,
      message: "Proposal indexed successfully",
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

const listProposals = async (req, res) => {
  try {
    const proposals = await prisma.proposals.findMany({
      take: 20,
      orderBy: {
        startDate: "desc",
      },
      include: {
        dao: true,
        decisions: true,
        executions: true,
      },
    });

    return res.json({
      success: true,
      message: "Proposals fetched successfully",
      proposals,
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

const getProposal = async (req, res) => {
  try {
    const { proposalId } = req.params;
    const proposal = await prisma.proposals.findUnique({
      where: {
        id: proposalId,
      },
      include: {
        dao: true,
        decisions: true,
        executions: true,
      },
    });

    return res.json({
      success: true,
      message: "Proposal fetched successfully",
      proposal,
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: error.message,
    });
  }
};

export { redecideProposal, indexProposal, listProposals, getProposal };
