import logger from "./winston.js";
import prisma from "./prisma.js";
import axios from "axios";
import { decideProposal, summarizeProposal } from "./ai.js";
import { decisionQueue, executionQueue } from "./queue.js";
import {
  createSafeClient,
  offChainMessages,
} from "@safe-global/sdk-starter-kit";

const checkSnapshotProposal = async (dao) => {
  try {
    console.log("Checking Snapshot Proposals for", dao.daoId);

    const query = `
    query Proposals {
      proposals(
        first: 1,
        skip: 0,
        where: {
          space_in: ["${dao.alternateId}"],
        },
        orderBy: "created",
        orderDirection: desc
      ) {
        id
        title
        body
        choices
        start
        end
        snapshot
        state
        author
        space {
          id
          name
        }
      }
    }
  `;

    const response = await axios.post(
      process.env.SNAPSHOT_API_URL,
      { query },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const lastProposal = response.data.data.proposals[0];

    const startTimestamp = new Date(
      Number(lastProposal.start) * 1000
    ).toISOString();
    const endTimestamp = new Date(
      Number(lastProposal.end) * 1000
    ).toISOString();

    const isProposalIndexed = await prisma.proposals.findUnique({
      where: {
        id: lastProposal.id,
      },
    });

    if (isProposalIndexed) {
      return;
    }

    const summary = await summarizeProposal(lastProposal.body);

    const newProposal = await prisma.proposals.create({
      data: {
        id: lastProposal.id,
        daoId: dao.id,
        title: lastProposal.title,
        summary: summary,
        choices: lastProposal.choices,
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
        latestIndex: lastProposal.id.toString(),
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

const processSnapshotDecision = async (
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

const executeSnapshotProposal = async (dao, proposalId) => {
  try {
    logger.info(`Executing Snapshot vote for proposal: ${proposalId}`);
    let execution;

    const allExecutions = await prisma.execution.findMany({
      where: {
        proposalId: proposalId,
      },
    });

    execution = allExecutions[0];

    if (!execution) {
      execution = await prisma.execution.create({
        data: {
          proposalId: proposalId,
          status: "PENDING",
          metadata: {},
        },
      });
    }
    const daoWithDeployments = await prisma.dAOs.findUnique({
      where: {
        id: dao.id,
      },
      include: {
        deployments: true,
        chain: true,
      },
    });

    const proposal = await prisma.proposals.findUnique({
      where: {
        id: proposalId,
      },
      include: {
        decisions: true,
      },
    });

    const domain = {
      name: "snapshot",
      version: "0.1.4",
    };

    const types = {
      Vote: [
        { name: "from", type: "address" },
        { name: "space", type: "string" },
        { name: "timestamp", type: "uint64" },
        { name: "proposal", type: "bytes32" },
        { name: "choice", type: "uint32" },
        { name: "reason", type: "string" },
        { name: "app", type: "string" },
        { name: "metadata", type: "string" },
      ],
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
      ],
    };

    logger.info(
      `Executing Snapshot vote via Safe: ${daoWithDeployments.address}`
    );
    const safeAddress = daoWithDeployments.address;

    const privateKey = process.env.PRIVATE_KEY;

    // Create Safe client
    const safeClient = await createSafeClient({
      provider: daoWithDeployments.chain.rpcUrl,
      signer: privateKey,
      safeAddress: safeAddress,
      apiKey: process.env.SAFE_API_KEY,
    });

    const offchainMessageClient = safeClient.extend(offChainMessages());

    const message = {
      from: safeAddress,
      space: daoWithDeployments.alternateId,
      timestamp: Number((Date.now() / 1000).toFixed(0)),
      proposal: proposal.id,
      choice: proposal.decisions[0].vote,
      reason: proposal.decisions[0].reason,
      app: "snapshot-v2",
      metadata: "{}",
    };

    logger.debug("Snapshot vote message being created:", {
      message,
      types,
      domain,
      primaryType: "Vote",
    });

    // Send off-chain message
    const messageResult = await offchainMessageClient.sendOffChainMessage({
      message: {
        message,
        types,
        domain,
        primaryType: "Vote",
      },
    });

    if (
      !messageResult ||
      !messageResult.messages ||
      !messageResult.messages.messageHash
    ) {
      throw new Error("Failed to create off-chain message");
    }

    logger.info(
      `Off-chain message created with hash: ${messageResult.messages.messageHash}`
    );

    // Get pending messages to find our signature
    const messages = await offchainMessageClient.getPendingOffChainMessages({
      limit: 5,
    });

    const signaturePayload = messages.results.find(
      (msg) => msg.messageHash === messageResult.messages.messageHash
    );

    if (
      !signaturePayload ||
      !signaturePayload.confirmations ||
      signaturePayload.confirmations.length === 0
    ) {
      throw new Error("Signature payload not found for the message");
    }

    const signature = signaturePayload.confirmations[0].signature;
    logger.info(`Signature obtained for Snapshot vote.`);
    logger.debug(`Signature: ${signature}`);

    const snapshotUrl = process.env.SNAPSHOT_VOTING_URL;

    // Send the vote with the signature
    const response = await axios.post(snapshotUrl, {
      address: safeAddress,
      sig: signature,
      data: {
        domain,
        types,
        message,
      },
    });

    logger.debug("Snapshot API Response:", response.data);

    // Verify successful vote submission
    if (!response.data || response.status !== 200) {
      throw new Error(
        `Failed to submit Snapshot vote: ${JSON.stringify(response.data)}`
      );
    }

    await prisma.execution.update({
      where: {
        id: execution.id,
      },
      data: {
        status: "SUCCESS",
      },
    });

    logger.info("Successfully submitted Snapshot vote.");
  } catch (error) {
    const execution = await prisma.execution.findMany({
      where: {
        proposalId: proposalId,
      },
    });

    await prisma.execution.update({
      where: {
        id: execution[0].id,
      },
      data: {
        status: "FAILED",
        metadata: {
          error: error.message,
        },
      },
    });
    logger.error(error);
  }
};

const indexSnapshotProposal = async (dao, proposalId) => {
  try {
    const query = `
    query Proposals {
      proposals(
        first: 1,
        skip: 0,
        where: {
          space_in: ["${dao.alternateId}"],
          id: "${proposalId}"
        },
        orderBy: "created",
        orderDirection: desc
      ) {
        id
        title
        body
        choices
        start
        end
        snapshot
        state
        author
        space {
          id
          name
        }
      }
    }
  `;

    const response = await axios.post(
      process.env.SNAPSHOT_API_URL,
      { query },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const proposal = response.data.data.proposals[0];

    const dbproposal = await prisma.proposals.findUnique({
      where: {
        id: proposal?.id,
      },
    });

    if (dbproposal) {
      throw new Error("Proposal already indexed");
    }

    const summary = await summarizeProposal(proposal.body);

    if (Date.now() > proposal.end * 1000) {
      throw new Error("Proposal already ended");
    }

    const newProposal = await prisma.proposals.create({
      data: {
        id: proposal.id,
        daoId: dao.id,
        title: proposal.title,
        summary: summary,
        choices: proposal.choices,
        startDate: new Date(Number(proposal.start) * 1000).toISOString(),
        endDate: new Date(Number(proposal.end) * 1000).toISOString(),
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

export {
  checkSnapshotProposal,
  processSnapshotDecision,
  executeSnapshotProposal,
  indexSnapshotProposal,
};
