import prisma from "./prisma.js";
import logger from "./winston.js";
import checkTallyProposal from "./tally.js";

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
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

export default checkNewProposals;
