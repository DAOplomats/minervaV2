import prisma from "./prisma.js";
import logger from "./winston.js";
import checkTallyProposal from "./tally.js";
import { checkSnapshotProposal } from "./snapshot.js";

const checkNewProposals = async () => {
  try {
    const daos = await prisma.dAOs.findMany({
      include: {
        deployments: true,
        chain: true,
      },
    });

    await Promise.all(
      daos.map(async (dao) => {
        if (dao.platform === "tally") {
          await checkTallyProposal(dao);
        }
        if (dao.platform === "snapshot") {
          await checkSnapshotProposal(dao);
        }
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

export const startListener = async () => {
  await checkNewProposals();

  setInterval(() => {
    checkNewProposals();
  }, 60 * 60 * 1000);
};

export default checkNewProposals;
