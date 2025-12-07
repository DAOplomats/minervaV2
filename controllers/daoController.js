import prisma from "../utils/prisma.js";
import logger from "../utils/winston.js";

const addDao = async (req, res) => {
  try {
    const {
      id,
      alternateId,
      chainId,
      platform,
      address,
      latestIndex,
      deployments,
    } = req.body;

    const dao = await prisma.dAOs.create({
      data: {
        daoId: id,
        alternateId,
        chainId,
        platform,
        address,
        latestIndex,
      },
    });

    await Promise.all(
      deployments.map(async (deployment) => {
        await prisma.deployments.create({
          data: {
            address: deployment.address,
            name: deployment.name,
            abi: deployment.abi,
            daoId: dao.id,
          },
        });
      })
    );

    return res.json({
      success: true,
      message: "Dao added successfully",
      data: dao,
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: "Something went wrong",
    });
  }
};

const listDaos = async (req, res) => {
  try {
    const daos = await prisma.dAOs.findMany({
      include: {
        chain: true,
      },
    });

    return res.json({
      success: true,
      message: "Daos fetched successfully",
      daos,
    });
  } catch (error) {
    logger.error(error);
    return res.json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export { addDao, listDaos };
