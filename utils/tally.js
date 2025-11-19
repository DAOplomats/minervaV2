import axios from "axios";
import logger from "./winston.js";
import prisma from "./prisma.js";
import { decideProposal, summarizeProposal } from "./ai.js";
import { decisionQueue, executionQueue } from "./queue.js";
import { schedule } from "node-cron";

const checkTallyProposal = async (dao) => {
  try {
    console.log("Checking Tally Proposals for", dao.daoId);

    const headers = {
      "Content-Type": "application/json",
      Host: "api.tally.xyz",
      Origin: "https://www.tally.xyz",
      Referer: "https://www.tally.xyz/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0",
      "Api-Key":
        "365b418f59bd6dc4a0d7f23c2e8c12d982f156e9069695a6f0a2dcc3232448df",
    };

    const body = {
      query:
        "\n    query GovernanceProposals($input: ProposalsInput!) {\n  proposals(input: $input) {\n    nodes {\n      ... on Proposal {\n        id\n        onchainId\n        status\n        originalId\n        createdAt\n        quorum\n        voteStats {\n          votesCount\n          percent\n          type\n          votersCount\n        }\n        metadata {\n      title \n    description\n        }\n        events {\n          type\n          txHash\n        }\n    end {\n      ... on BlocklessTimestamp { timestamp }\n      ... on Block { timestamp }\n    }\n      start {\n          ... on Block {\n            timestamp\n          }\n          ... on BlocklessTimestamp {\n            timestamp\n          }\n        }\n        block {\n          timestamp\n        }\n        governor {\n          id\n          quorum\n          name\n          timelockId\n          token {\n            decimals\n          }\n        }\n      }\n    }\n    pageInfo {\n      firstCursor\n      lastCursor\n      count\n    }\n  }\n}\n    ",
      variables: {
        input: {
          filters: {
            organizationId: dao.alternateId,
          },
          sort: {
            sortBy: "id",
            isDescending: true,
          },
          page: {
            limit: 10,
          },
        },
      },
    };

    const lastProposalResponse = await axios.post(
      "https://api.tally.xyz/query",
      body,
      { headers }
    );

    const lastProposal = lastProposalResponse.data.data.proposals.nodes[0];

    const startTimestamp = lastProposal.start.timestamp;
    const endTimestamp = lastProposal.end.timestamp;

    if (lastProposal.onchainId === dao.latestIndex) {
      return;
    }

    const summary = await summarizeProposal(lastProposal.metadata.description);

    const newProposal = await prisma.proposals.create({
      data: {
        id: lastProposal.onchainId,
        daoId: dao.id,
        title: lastProposal.metadata.title,
        summary: summary,
        choices: ["For", "Against", "Abstain"],
        startDate: startTimestamp,
        endDate: endTimestamp,
      },
    });

    logger.info("Indexed new proposal", newProposal);

    await prisma.dAOs.update({
      where: {
        id: dao.id,
      },
      data: {
        latestIndex: lastProposal.onchainId.toString(),
      },
    });

    const decision = await prisma.decision.create({
      data: {
        proposalId: newProposal.id,
        status: "PENDING",
      },
    });

    decisionQueue.add({ decisionId: decision?.id });
  } catch (error) {
    logger.error(error);
  }
};

export const processTallyDecision = async (
  dao,
  decision,
  proposal,
  skip = false
) => {
  try {
    if (!skip) {
      await new Promise((resolve) => setTimeout(resolve, 120 * 1000));
    }

    logger.info("Processing decision", decision);

    const response = await decideProposal(
      dao.daoId,
      proposal.title,
      proposal.summary,
      JSON.stringify(proposal.choices)
    );

    await prisma.decision.update({
      where: {
        id: decision.id,
      },
      data: {
        vote: Number(response.vote),
        reason: response.reason,
        status: "DECIDED",
      },
    });

    logger.info("Processed decision", decision);

    const delay =
      new Date(proposal.endDate).getTime() - dao.votingDelay - Date.now();

    if (delay > 0) {
      executionQueue.add(
        {
          proposalId: proposal.id,
        },
        {
          delay: delay,
          jobId: decision.id,
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
  } catch (error) {
    await prisma.decision.update({
      where: {
        id: decision.id,
      },
      data: {
        status: "FAILED",
      },
    });
    logger.error(error);
  }
};

export const executeTallyProposal = async (dao, proposalId) => {
  try {
  } catch (error) {}
};

export const indexTallyProposal = async (dao, proposalId) => {
  try {
    const body = {
      query:
        "\n    query ProposalDetails($input: ProposalInput!, $votesInput: VotesInput!) {\n  proposal(input: $input) {\n    id\n    onchainId\n    metadata {\n      title\n      description\n      discourseURL\n      snapshotURL\n    }\n    end {\n      ... on BlocklessTimestamp { timestamp }\n      ... on Block { timestamp }\n    }\n    start {\n      ... on Block { timestamp }\n    }\n   executableCalls {\n      value\n      target\n      calldata\n      signature\n      type\n      decodedCalldata {\n        signature\n        parameters {\n          name\n          type\n          value\n        }\n      }\n      offchaindata {\n        ... on ExecutableCallSwap {\n          amountIn\n          fee\n          buyToken {\n            data {\n              price\n              decimals\n              name\n              symbol\n            }\n          }\n          sellToken {\n            data {\n              price\n              decimals\n              name\n              symbol\n            }\n          }\n          to\n          quote {\n            buyAmount\n            feeAmount\n          }\n          order {\n            id\n            status\n            buyAmount\n            address\n          }\n          priceChecker {\n            tokenPath\n            feePath\n            uniPoolPath\n            slippage\n          }\n        }\n        ... on ExecutableCallRewards {\n          contributorFee\n          tallyFee\n          recipients\n        }\n      }\n    }\n    governor {\n      id\n      chainId\n      slug\n      organization {\n        metadata {\n          description\n        }\n      }\n      contracts {\n        governor {\n          address\n          type\n        }\n      }\n      timelockId\n    }\n  }\n  votes(input: $votesInput) {\n    nodes {\n      ... on OnchainVote {\n        isBridged\n        voter {\n          name\n          picture\n          address\n          twitter\n        }\n        chainId\n        reason\n        type\n        block {\n          timestamp\n        }\n      }\n    }\n  }\n}\n    ",
      variables: {
        input: { id: proposalId },
        votesInput: {
          filters: { proposalId: proposalId },
          sort: { sortBy: "amount", isDescending: true },
          page: { limit: 500 },
        },
      },
    };

    const headers = {
      "Content-Type": "application/json",
      Host: "api.tally.xyz",
      Origin: "https://www.tally.xyz",
      Referer: "https://www.tally.xyz/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0",
      "Api-Key":
        "365b418f59bd6dc4a0d7f23c2e8c12d982f156e9069695a6f0a2dcc3232448df",
    };

    const response = await axios.post("https://api.tally.xyz/query", body, {
      headers,
    });

    const proposal = response.data?.data?.proposal;

    if (!proposal) {
      throw new Error("Proposal not found");
    }

    const dbproposal = await prisma.proposals.findUnique({
      where: {
        id: proposal?.onchainId,
      },
    });

    if (dbproposal) {
      throw new Error("Proposal already indexed");
    }

    const summary = await summarizeProposal(proposal.metadata.description);

    if (Date.now() > proposal.end.timestamp) {
      throw new Error("Proposal already ended");
    }

    const newProposal = await prisma.proposals.create({
      data: {
        id: proposal.onchainId,
        daoId: dao.id,
        title: proposal.metadata.title,
        summary: summary,
        choices: ["For", "Against", "Abstain"],
        startDate: proposal.start.timestamp,
        endDate: proposal.end.timestamp,
      },
    });

    logger.info("Indexed new proposal", newProposal);

    const decision = await prisma.decision.create({
      data: {
        proposalId: newProposal.id,
        status: "PENDING",
      },
    });

    decisionQueue.add({ decisionId: decision?.id });
  } catch (error) {
    logger.error(error);
  }
};

export default checkTallyProposal;
