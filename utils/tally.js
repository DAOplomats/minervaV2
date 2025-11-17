import axios from "axios";
import logger from "./winston.js";
import prisma from "./prisma.js";
import { decideProposal, summarizeProposal } from "./ai.js";

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
        "\n    query GovernanceProposals($input: ProposalsInput!) {\n  proposals(input: $input) {\n    nodes {\n      ... on Proposal {\n        id\n        onchainId\n        status\n        originalId\n        createdAt\n        quorum\n        voteStats {\n          votesCount\n          percent\n          type\n          votersCount\n        }\n        metadata {\n      title \n    description\n        }\n        events {\n          type\n          txHash\n        }\n        start {\n          ... on Block {\n            timestamp\n          }\n          ... on BlocklessTimestamp {\n            timestamp\n          }\n        }\n        block {\n          timestamp\n        }\n        governor {\n          id\n          quorum\n          name\n          timelockId\n          token {\n            decimals\n          }\n        }\n      }\n    }\n    pageInfo {\n      firstCursor\n      lastCursor\n      count\n    }\n  }\n}\n    ",
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

    processTallyDecision(dao, decision, newProposal);
  } catch (error) {
    logger.error(error);
  }
};

export const processTallyDecision = async (dao, decision, proposal) => {
  try {
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

export default checkTallyProposal;
