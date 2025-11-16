import logger from "./winston.js";

const checkTallyProposal = async (dao) => {
  try {
    console.log("Checking Tally Proposals for", dao.id);
  } catch (error) {
    logger.error(error);
  }
};

export default checkTallyProposal;
