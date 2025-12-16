import axios from "axios";
import logger from "./winston.js";
import prisma from "./prisma.js";
import { decideProposal, summarizeProposal } from "./ai.js";
import { decisionQueue, executionQueue } from "./queue.js";
import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { OperationType } from "@safe-global/types-kit";
import {
  Simple7702Account,
  createAndSignEip7702DelegationAuthorization,
  CandidePaymaster,
} from "abstractionkit";
import { ethers } from "ethers";
import {
  createSafeClient,
  offChainMessages,
} from "@safe-global/sdk-starter-kit";
import dotenv from "dotenv";
import tgLogger from "./tg.js";
dotenv.config();

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

    const startTimestamp = lastProposal.start.timestamp
      ? lastProposal.start.timestamp
      : new Date().toISOString();
    const endTimestamp = lastProposal.end.timestamp;

    const isProposalIndexed = await prisma.proposals.findUnique({
      where: {
        id: lastProposal.onchainId,
      },
    });

    if (isProposalIndexed) {
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
        startDate: new Date(startTimestamp).toLocaleString(),
        endDate: new Date(endTimestamp).toLocaleString(),
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

    tgLogger.info(`Indexed new Tally proposal: 
        DAO: ${dao.daoId}
        Title: ${lastProposal.metadata.title}
        Summary: ${summary}
        ID: ${lastProposal.onchainId}
        Start Date: ${new Date(startTimestamp).toLocaleString()}
        End Date: ${new Date(endTimestamp).toLocaleString()}
      `);
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

    tgLogger.info(`Processed Tally decision: 
      DAO: ${dao.daoId}
      Proposal: ${proposal.title}
      Vote: ${response.vote}
      Reason: ${response.reason}
      Start Date: ${new Date(proposal.startDate).toLocaleString()}
      End Date: ${new Date(proposal.endDate).toLocaleString()}
      `);

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

    tgLogger.error(
      `Failed to process Tally decision: 
      DAO: ${dao.daoId}
      Proposal: ${proposal.title}
      Decision ID: ${decision.id}
      `,
      error
    );
  }
};

export const executeTallyProposal = async (dao, proposalId) => {
  try {
    logger.info(`Executing Tally vote for proposal: ${proposalId}`);
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

    const governorAddress = daoWithDeployments.deployments.find(
      (deployment) => deployment.name === "governor"
    ).address;

    const proposal = await prisma.proposals.findUnique({
      where: {
        id: proposalId,
      },
      include: {
        decisions: true,
      },
    });

    const onchainId = proposal.decisions[0].proposalId;
    const choice = proposal.decisions[0].vote;
    const reason = proposal.decisions[0].reason;

    const chain = daoWithDeployments.chain;

    logger.info(
      `Governor Address: ${governorAddress}, Onchain ID: ${onchainId}`
    );

    // Convert choice to the format expected by Tally (0-indexed)
    const tallyChoice = Number(choice) === 1 ? 1 : Number(choice) === 2 ? 0 : 2;
    logger.info(
      `Original choice: ${choice}, Tally-formatted choice: ${tallyChoice}`
    );

    // ABI for castVoteWithReason
    const abi = [
      "function castVoteWithReason(uint256 proposalId, uint8 support, string reason)",
    ];

    // Create provider
    const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);

    // Create contract instance
    const contract = new ethers.Contract(governorAddress, abi, provider);

    // Encode function data
    const data = contract.interface.encodeFunctionData("castVoteWithReason", [
      onchainId,
      tallyChoice,
      reason,
    ]);

    logger.debug(`Encoded transaction data for Tally vote: ${data}`);

    const privateKey = process.env.PRIVATE_KEY;

    if (!chain.isCandideEnabled || chain.fallback) {
      logger.info(
        `Executing Tally vote via Safe: ${daoWithDeployments.address}`
      );

      const safeAddress = daoWithDeployments.address;

      // Create Safe client
      const safeClient = await createSafeClient({
        provider: chain.rpcUrl,
        signer: privateKey,
        safeAddress: safeAddress,
        apiKey: process.env.SAFE_API_KEY,
      });

      logger.debug("Safe transaction data:", {
        to: governorAddress,
        data,
        value: "0",
      });

      // Send transaction
      const transaction = await safeClient.send({
        transactions: [
          {
            to: governorAddress,
            data,
            value: "0",
          },
        ],
      });

      if (!transaction) {
        throw new Error("Safe transaction failed or wasn't properly executed");
      }

      await prisma.execution.update({
        where: {
          id: execution.id,
        },
        data: {
          status: "SUCCESS",
        },
      });

      logger.info(
        `Safe transaction for Tally vote sent. Hash: ${transaction.transactions?.safeTxHash}`
      );
    }

    if (chain.isCandideEnabled && !chain.fallback) {
      logger.info(
        `Executing Tally vote via Candide: ${daoWithDeployments.address}`
      );

      const eoaDelegator = new ethers.Wallet(privateKey);
      const eoaDelegatorPublicAddress = eoaDelegator.address;
      const eoaDelegatorPrivateKey = eoaDelegator.privateKey;

      const apiKit = new SafeApiKit({
        chainId: BigInt(chain.id),
        apiKey: process.env.SAFE_API_KEY,
      });

      const protocolKitOwner1 = await Safe.init({
        provider: chain.rpcUrl,
        signer: eoaDelegatorPrivateKey,
        safeAddress: daoWithDeployments.address,
      });

      const safeTransactionData = {
        to: governorAddress,
        value: "0",
        data: data,
        operation: OperationType.Call,
      };

      const safeTransaction = await protocolKitOwner1.createTransaction({
        transactions: [safeTransactionData],
      });

      const safeTxHash = await protocolKitOwner1.getTransactionHash(
        safeTransaction
      );
      const signature = await protocolKitOwner1.signHash(safeTxHash);

      await apiKit.proposeTransaction({
        safeAddress: daoWithDeployments.address,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: eoaDelegatorPublicAddress,
        senderSignature: signature.data,
      });

      logger.info("Transaction proposed successfully");

      const pendingTransactions = await apiKit.getPendingTransactions(
        daoWithDeployments.address
      );

      if (!pendingTransactions.results.length) {
        throw new Error("No pending transactions found");
      }

      const latestTransaction = pendingTransactions.results[0];

      const latestTransactionConfirmations =
        await apiKit.getTransactionConfirmations(latestTransaction.safeTxHash);

      const safeContract = new ethers.Contract(
        "0x992c5653F0502FfcE6D6dd172B8835367A9dCCf4",
        [
          {
            inputs: [
              {
                internalType: "address",
                name: "to",
                type: "address",
              },
              {
                internalType: "uint256",
                name: "value",
                type: "uint256",
              },
              {
                internalType: "bytes",
                name: "data",
                type: "bytes",
              },
              {
                internalType: "enum Enum.Operation",
                name: "operation",
                type: "uint8",
              },
              {
                internalType: "uint256",
                name: "safeTxGas",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "baseGas",
                type: "uint256",
              },
              {
                internalType: "uint256",
                name: "gasPrice",
                type: "uint256",
              },
              {
                internalType: "address",
                name: "gasToken",
                type: "address",
              },
              {
                internalType: "address payable",
                name: "refundReceiver",
                type: "address",
              },
              {
                internalType: "bytes",
                name: "signatures",
                type: "bytes",
              },
            ],
            name: "execTransaction",
            outputs: [
              {
                internalType: "bool",
                name: "success",
                type: "bool",
              },
            ],
            stateMutability: "payable",
            type: "function",
          },
        ]
      );

      const mainData = safeContract.interface.encodeFunctionData(
        "execTransaction",
        [
          latestTransaction.to,
          latestTransaction.value,
          latestTransaction.data ? latestTransaction.data : "0x",
          OperationType.Call,
          0,
          0,
          0,
          "0x0000000000000000000000000000000000000000",
          "0x0000000000000000000000000000000000000000",
          latestTransactionConfirmations.results[0].signature,
        ]
      );

      const chainId = chain.id;
      const bundlerUrl = chain.bundlerUrl;
      const paymasterUrl = chain.paymasterUrl;
      const sponsorshipPolicyId = chain.sponsorshipPolicyId;
      const nodeUrl = chain.rpcUrl;

      const transaction = {
        to: daoWithDeployments.address,
        value: 0,
        data: mainData,
      };

      const smartAccount = new Simple7702Account(eoaDelegatorPublicAddress);

      let userOperation = await smartAccount.createUserOperation(
        [
          //You can batch multiple transactions to be executed in one useroperation.
          transaction,
        ],
        nodeUrl, //the node rpc is used to fetch the current nonce and fetch gas prices.
        bundlerUrl, //the bundler rpc is used to estimate the gas limits.
        {
          eip7702Auth: {
            chainId: chainId, // chainId at which the account will be upgraded
          },
        }
      );

      userOperation.eip7702Auth = createAndSignEip7702DelegationAuthorization(
        BigInt(userOperation.eip7702Auth.chainId),
        userOperation.eip7702Auth.address,
        BigInt(userOperation.eip7702Auth.nonce),
        eoaDelegatorPrivateKey
      );

      const paymaster = new CandidePaymaster(paymasterUrl);

      let [paymasterUserOperation, _sponsorMetadata] =
        await paymaster.createSponsorPaymasterUserOperation(
          userOperation,
          bundlerUrl,
          sponsorshipPolicyId
        ); // sponsorshipPolicyId will have no effect if empty
      userOperation = paymasterUserOperation;

      userOperation.signature = smartAccount.signUserOperation(
        userOperation,
        eoaDelegatorPrivateKey,
        chainId
      );

      let sendUserOperationResponse = await smartAccount.sendUserOperation(
        userOperation,
        bundlerUrl
      );

      console.log("userOperation: ", userOperation);
      logger.log("userOp sent! Waiting for inclusion...");
      console.log("userOp Hash: ", sendUserOperationResponse.userOperationHash);

      logger.log("userOp sent! Waiting for inclusion...");

      await new Promise((resolve) => setTimeout(resolve, 30000));

      let userOperationReceiptResult =
        await sendUserOperationResponse.included();

      console.log("Useroperation receipt received.");
      console.log(userOperationReceiptResult);
      if (userOperationReceiptResult.success) {
        logger.info(
          "The transaction hash is : " +
            userOperationReceiptResult.receipt.transactionHash
        );

        await prisma.execution.update({
          where: {
            id: execution.id,
          },
          data: {
            status: "SUCCESS",
          },
        });
      } else {
        throw new Error("Useroperation execution failed");
      }
    }

    tgLogger.info(`Tally proposal executed successfully: 
      DAO: ${dao.daoId}
      Proposal ID: ${proposalId}
      Proposal Title: ${proposal.title}
      Start Date: ${new Date(proposal.startDate).toLocaleString()}
      End Date: ${new Date(proposal.endDate).toLocaleString()}
      `);
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

    tgLogger.error(`Tally Proposal Failed: 
      DAO: ${dao.daoId}
      Proposal ID: ${proposalId}
      `);
  }
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
        startDate: proposal.start.timestamp
          ? proposal.start.timestamp
          : new Date().toISOString(),
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

    tgLogger.info(`Indexed new Tally proposal: 
      DAO: ${dao.daoId}
      Proposal ID: ${proposal.onchainId}
      Proposal Title: ${proposal.metadata.title}
      Start Date: ${new Date(proposal.startDate).toLocaleString()}
      End Date: ${new Date(proposal.endDate).toLocaleString()}
      `);
  } catch (error) {
    logger.error(error);
    tgLogger.error(`Failed to index proposal: 
      DAO: ${dao.daoId}
      Proposal ID: ${proposalId}
      `);
  }
};

export default checkTallyProposal;
