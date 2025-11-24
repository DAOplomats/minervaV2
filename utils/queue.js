import Queue from "bull";
import prisma from "./prisma.js";
import { processTallyDecision, executeTallyProposal } from "./tally.js";
import logger from "./winston.js";
import checkNewProposals from "./listener.js";

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

const listenerQueue = new Queue("minervaV2:listenerQueue", {
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

listenerQueue.process(async (job) => {
  try {
    checkNewProposals();

    listenerQueue.add({}, { delay: 60 * 60 * 1000 });
  } catch (error) {
    logger.error(error);
  }
});

const loadPendingExecutionJobs = async () => {
  try {
    await executionQueue.obliterate();

    let totalJobs = 0;

    const proposals = await prisma.proposals.findMany({
      where: {
        endDate: {
          gte: new Date().toISOString(),
        },
      },
      include: {
        decisions: {
          where: {
            status: "DECIDED",
          },
        },
        executions: true,
        dao: true,
      },
    });

    proposals.forEach((proposal) => {
      const decision = proposal.decisions[0];
      const execution = proposal.executions[0];

      if (execution?.status === "SUCCESS") {
        return;
      }

      totalJobs++;

      const delay =
        new Date(proposal.endDate).getTime() -
        proposal.dao.votingDelay -
        Date.now();

      if (delay > 0) {
        executionQueue.add(
          {
            proposalId: proposal.id,
          },
          {
            delay: delay,
          }
        );

        logger.info(
          `Scheduled execution for proposal ${proposal.id} in ${
            delay / (1000 * 60 * 60 * 24)
          } days`
        );
      } else if (new Date(proposal.endDate).getTime() - Date.now() > 0) {
        executionQueue.add(
          {
            proposalId: proposal.id,
          },
          {
            jobId: decision.id,
          }
        );

        logger.info(`Scheduled execution for proposal ${proposal.id}`);
      } else {
        logger.info("Proposal has already ended");
      }
    });

    logger.info(`Loaded ${totalJobs} pending execution jobs`);
  } catch (error) {
    logger.error("Error loading pending execution jobs", error);
  }
};

export {
  decisionQueue,
  executionQueue,
  loadPendingExecutionJobs,
  listenerQueue,
};
