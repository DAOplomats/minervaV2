import checkNewProposals from "../utils/listener.js";

const checkProposals = async (req, res) => {
  try {
    await checkNewProposals();

    return res.json({
      success: true,
      message: "Proposals checked successfully",
    });
  } catch (error) {
    return res.json({
      success: false,
      message: error,
    });
  }
};

export { checkProposals };
