import Queue from "bull";
import prisma from "./prisma.js";
import { processTallyDecision, executeTallyProposal } from "./tally.js";
import logger from "./winston.js";

const decisionQueue = new Queue("minervaV2:decisionQueue", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
  },
});

const executionQueue = new Queue("minervaV2:executionQueue", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
  },
});

decisionQueue.process(async (job) => {
  try {
    const { decisionId } = job.data;

    const decision = await prisma.decision.findUnique({
      where: {
        id: decisionId,
      },
      include: {
        proposal: true,
      },
    });

    if (!decision) {
      throw new Error("Decision not found");
    }

    const proposal = decision.proposal;

    const dao = await prisma.dAOs.findUnique({
      where: {
        id: proposal.daoId,
      },
    });

    if (dao.platform === "tally") {
      await processTallyDecision(dao, decision, proposal);
    }
  } catch (error) {
    logger.error(error);
  }
});

executionQueue.process(async (job) => {
  try {
    const { proposalId } = job.data;

    const proposal = await prisma.proposals.findUnique({
      where: {
        id: proposalId,
      },
    });

    const dao = await prisma.dAOs.findUnique({
      where: {
        id: proposal.daoId,
      },
    });

    if (dao.platform === "tally") {
      await executeTallyProposal(dao, proposalId);
    }
  } catch (error) {
    logger.error(error);
  }
});

export { decisionQueue, executionQueue };
